import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localIsoDate } from "./local-date.js";

/**
 * The paperwork a studio hands a client: a proposal, a scope agreement, a
 * weekly update, a receipt, a referral one-pager, a case study, an NDA, a
 * kickoff sheet. What is kept here is what was answered, never the page that
 * was printed from it. The layout lives in the HQ client and will keep getting
 * better, and a document that stores its answers improves with it, while one
 * that stored its rendered page would be stuck looking like the day it was
 * written.
 */

const STATUSES = new Set(["draft", "sent", "signed", "void"]);
const LANGUAGES = new Set(["fa", "en"]);

/**
 * The filter value that asks for the documents with no company against them.
 * A query string cannot tell an empty value from an absent one, so the ask is
 * spelled out, exactly as the invoice and money lists spell it.
 */
const NO_COMPANY = "none";

/**
 * Answers are free-form, so the only honest limit is a size one. It is checked
 * before anything is written: a blob cut in half would be a document nobody
 * could open, and it would look like a document that had simply been filled in
 * badly. Sixty-four kilobytes is far more than a page of answers and far less
 * than anything that would slow the list down.
 */
const MAX_VALUES_BYTES = 64 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, limit = 400) {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeDate(value, label) {
  const date = String(value || "").trim();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), `${label} must be a YYYY-MM-DD date.`);
  return date;
}

/**
 * The template ids the front end knows. The shape is checked and the list is
 * not: the eight kinds Alex sends today are the start of the set, and a store
 * that held the list would have to be edited every time the client learned to
 * draw another page.
 */
function normalizeType(value) {
  const type = text(value, 40).toLowerCase();
  assert(/^[a-z0-9][a-z0-9-]{1,39}$/.test(type), "Choose a document type.");
  return type;
}

function normalizeLanguage(value, fallback = "en") {
  const language = text(value, 5).toLowerCase();
  if (!language) return fallback;
  assert(LANGUAGES.has(language), "Language must be fa or en.");
  return language;
}

/**
 * The letters a number is filed under, e.g. PR for a proposal. The caller picks
 * them, because the caller is the thing that knows what it is writing; the
 * fallback is only so that a document created in a test or a script still gets
 * a number that reads like one.
 */
function normalizePrefix(value, type) {
  const prefix = text(value, 8).toUpperCase() || type.replace(/[^a-z0-9]/g, "").slice(0, 2).toUpperCase();
  assert(/^[A-Z][A-Z0-9]{0,7}$/.test(prefix), "A document number prefix must be one to eight letters or digits.");
  return prefix;
}

/** Answers on the way in: an object, and small enough to survive the trip whole. */
function normalizeValues(value) {
  assert(value && typeof value === "object" && !Array.isArray(value), "Document answers must be an object.");
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error(`Those answers cannot be saved (${error.message}).`);
  }
  assert(typeof serialized === "string", "Document answers must be an object.");
  assert(
    Buffer.byteLength(serialized) <= MAX_VALUES_BYTES,
    "Those answers are too long to save. Shorten them, or attach the long part as a resource instead."
  );
  return serialized;
}

/**
 * Answers on the way out. A row that cannot be read still opens the document,
 * rather than taking the paperwork screen down with it, but the damage is said
 * out loud on the server log instead of passing for a document somebody never
 * got around to filling in.
 */
function readValues(raw, id) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn(`Paperwork ${id} could not be read (${error.message}); showing it as empty.`);
    return {};
  }
}

/**
 * Answers merge key by key rather than being replaced wholesale: a draft is
 * filled in one field at a time, often from two devices, and a phone that sent
 * back the two questions it asked must not wipe the six answered at the desk.
 * A key set to null is the way to take an answer back out.
 */
function mergeValues(existing, updates) {
  if (updates === undefined) return { ...existing };
  assert(updates && typeof updates === "object" && !Array.isArray(updates), "Document answers must be an object.");
  const next = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

export function createPaperworkStore(databasePath, { workspace = null } = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_paperwork (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      company_id TEXT,
      company_name TEXT,
      project_id TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      "values" TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      created_by TEXT NOT NULL,
      sent_on TEXT,
      signed_on TEXT
    );
    CREATE INDEX IF NOT EXISTS paperwork_company ON agent4_paperwork(company_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS paperwork_type ON agent4_paperwork(type, created_at DESC);
  `);

  // HQ upgrades over a database file that is already on disk, so any column
  // added to this table later has to arrive as a guarded migration rather than
  // as a change to the CREATE above, which only ever runs on an empty file.
  const columns = new Set(database.prepare("PRAGMA table_info(agent4_paperwork)").all().map((row) => row.name));
  for (const [column, definition] of [
    ["project_id", "TEXT"],
    ["sent_on", "TEXT"],
    ["signed_on", "TEXT"]
  ]) {
    if (!columns.has(column)) database.exec(`ALTER TABLE agent4_paperwork ADD COLUMN ${column} ${definition}`);
  }

  const selectDocument = database.prepare("SELECT * FROM agent4_paperwork WHERE id = ?");

  function tableExists(name) {
    return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  }

  /**
   * Companies live in the workspace store, which shares this database file. A
   * paperwork store opened on its own has nothing to check against, and
   * refusing every link in that case would be worse than trusting the caller,
   * so the check only bites where it can be made.
   */
  function findCompany(value) {
    const companyId = text(value, 140);
    if (!companyId) return null;
    if (workspace?.getCompany) {
      const company = workspace.getCompany(companyId);
      assert(company, "That company no longer exists.");
      return { id: company.id, name: company.name };
    }
    if (tableExists("agent4_workspace_companies")) {
      const row = database.prepare("SELECT id, name FROM agent4_workspace_companies WHERE id = ?").get(companyId);
      assert(row, "That company no longer exists.");
      return { id: row.id, name: row.name };
    }
    return { id: companyId, name: "" };
  }

  function hydrate(row) {
    if (!row) return null;
    return {
      id: row.id,
      number: row.number,
      type: row.type,
      companyId: row.company_id || null,
      companyName: row.company_name || "",
      projectId: row.project_id || null,
      language: row.language === "fa" ? "fa" : "en",
      title: row.title,
      status: STATUSES.has(row.status) ? row.status : "draft",
      values: readValues(row.values, row.id),
      sentOn: row.sent_on || null,
      signedOn: row.signed_on || null,
      createdAt: row.created_at,
      createdBy: row.created_by,
      updatedAt: row.updated_at || null
    };
  }

  /**
   * Sequential within a prefix and a year, so PR-2026-004 reads as the fourth
   * proposal of the year. The suffix is compared as a number: sorted as text,
   * PR-2026-1000 falls below PR-2026-999 and the next proposal would be handed
   * a number already sent to a client.
   *
   * The run is scoped by the prefix rather than by the type, so two types that
   * were ever given the same letters share one run of numbers instead of
   * issuing the same number twice.
   */
  function nextNumber(type, { prefix, now = new Date() } = {}) {
    const letters = normalizePrefix(prefix, normalizeType(type));
    const year = localIsoDate(now).slice(0, 4);
    const stem = `${letters}-${year}-`;
    const row = database
      .prepare(`
        SELECT number FROM agent4_paperwork
        WHERE number LIKE ?
        ORDER BY CAST(substr(number, ?) AS INTEGER) DESC
        LIMIT 1
      `)
      .get(`${stem}%`, stem.length + 1);
    const last = row ? Number(String(row.number).slice(stem.length)) : 0;
    return `${stem}${String(last + 1).padStart(3, "0")}`;
  }

  /**
   * A weekly update starts from last week's pieces, so the owner changes only
   * what moved instead of typing the whole project out again.
   */
  function carriedOver(type, company, values) {
    if (type !== "update" || !company || !values || typeof values !== "object" || Array.isArray(values) || values.pieces !== undefined) return values;
    const last = database
      .prepare(`SELECT id, "values" FROM agent4_paperwork WHERE type = 'update' AND company_id = ? AND status != 'void' ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(company.id);
    const pieces = last ? readValues(last.values, last.id).pieces : null;
    return Array.isArray(pieces) && pieces.length ? { ...values, pieces } : values;
  }

  function createDocument(input = {}) {
    const type = normalizeType(input.type);
    const title = text(input.title, 180);
    assert(title, "Give the document a title.");
    const company = findCompany(input.companyId);
    // The name is kept as free text beside the id, not read off the CRM row
    // each time it is shown: a document written for somebody who is not in the
    // CRM still reads properly, and deleting a company does not blank the name
    // off a proposal that was signed a year ago.
    const companyName = text(input.companyName, 160) || (company ? company.name : "");
    const id = randomUUID();
    const number = text(input.number, 40) || nextNumber(type, { prefix: input.numberPrefix });
    database.prepare(`
      INSERT INTO agent4_paperwork
        (id,number,type,company_id,company_name,project_id,language,title,status,"values",created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,'draft',?,?,?)
    `).run(
      id, number, type, company ? company.id : null, companyName,
      text(input.projectId, 140) || null,
      normalizeLanguage(input.language), title,
      normalizeValues(carriedOver(type, company, input.values === undefined ? {} : input.values)),
      new Date().toISOString(), text(input.actorId, 140) || "unknown"
    );
    return hydrate(selectDocument.get(id));
  }

  function updateDocument(id, updates = {}) {
    const existing = selectDocument.get(text(id, 140));
    assert(existing, "That document no longer exists.");
    const title = updates.title === undefined ? existing.title : text(updates.title, 180);
    assert(title, "Give the document a title.");
    let companyId = existing.company_id;
    let companyName = existing.company_name;
    if (updates.companyId !== undefined) {
      const company = findCompany(updates.companyId);
      companyId = company ? company.id : null;
      // A document moved onto a company takes that company's name unless the
      // caller is renaming it in the same breath, so the two never disagree.
      if (updates.companyName === undefined && company) companyName = company.name;
    }
    if (updates.companyName !== undefined) companyName = text(updates.companyName, 160);
    // Everything is checked before anything is written, so an oversized bag of
    // answers leaves the document exactly as it was rather than saving the
    // title and losing the answers.
    const values = normalizeValues(mergeValues(readValues(existing.values, existing.id), updates.values));
    database.prepare(`
      UPDATE agent4_paperwork
      SET title=?,type=?,company_id=?,company_name=?,project_id=?,language=?,"values"=?,updated_at=?
      WHERE id=?
    `).run(
      title,
      updates.type === undefined ? existing.type : normalizeType(updates.type),
      companyId,
      companyName,
      updates.projectId === undefined ? existing.project_id : text(updates.projectId, 140) || null,
      updates.language === undefined ? existing.language : normalizeLanguage(updates.language, existing.language),
      values,
      new Date().toISOString(),
      existing.id
    );
    return hydrate(selectDocument.get(existing.id));
  }

  /**
   * A document is drafted, sent, and signed, or it is voided. The two dates are
   * when those things happened, not when the row was written: a proposal
   * drafted in June and signed in September was signed in September, and an
   * invoice store that stamped the creation date instead once made every
   * document look as though it had been settled the day it was typed. A date
   * can be given; without one it is today, on the owner's own calendar.
   *
   * Going back clears what is no longer true. Voiding does not: a document that
   * was sent and then withdrawn was still sent, and the date it went out is the
   * part of that story worth keeping.
   */
  function setStatus(id, status, { on } = {}) {
    assert(STATUSES.has(status), "Status must be draft, sent, signed or void.");
    const existing = selectDocument.get(text(id, 140));
    assert(existing, "That document no longer exists.");
    if (existing.status === status) return hydrate(existing);
    let sentOn = existing.sent_on || null;
    let signedOn = existing.signed_on || null;
    if (status === "draft") {
      sentOn = null;
      signedOn = null;
    } else if (status === "sent") {
      sentOn = normalizeDate(on || sentOn || localIsoDate(), "Sent date");
      signedOn = null;
    } else if (status === "signed") {
      signedOn = normalizeDate(on || signedOn || localIsoDate(), "Signed date");
    }
    database.prepare("UPDATE agent4_paperwork SET status=?,sent_on=?,signed_on=?,updated_at=? WHERE id=?")
      .run(status, sentOn, signedOn, new Date().toISOString(), existing.id);
    return hydrate(selectDocument.get(existing.id));
  }

  function getDocument(id) {
    return hydrate(selectDocument.get(text(id, 140)));
  }

  function removeDocument(id) {
    return database.prepare("DELETE FROM agent4_paperwork WHERE id = ?").run(text(id, 140)).changes > 0;
  }

  /** The where clause the list and its count both run, so a page and its total can never disagree. */
  function filterOf({ companyId, type, status }) {
    const clauses = [];
    const values = [];
    if (companyId) {
      const wanted = text(companyId, 140);
      if (wanted === NO_COMPANY) {
        clauses.push("(company_id IS NULL OR company_id = '')");
      } else {
        clauses.push("company_id = ?");
        values.push(wanted);
      }
    }
    if (type) {
      clauses.push("type = ?");
      values.push(normalizeType(type));
    }
    if (status) {
      const wanted = text(status, 20);
      assert(STATUSES.has(wanted), "Status must be draft, sent, signed or void.");
      clauses.push("status = ?");
      values.push(wanted);
    }
    return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
  }

  /**
   * Drafts first, because an unsent document is the one still asking for a
   * person, then newest. Filtering happens in the query rather than on the
   * screen, which could only sieve whatever fitted under the page cap and would
   * quietly leave out the rest. Two rows written in the same millisecond share
   * a timestamp, so the row order breaks the tie and the page boundary lands in
   * the same place every time.
   */
  function listDocuments({ companyId, type, status, limit = 50, offset = 0 } = {}) {
    const { where, values } = filterOf({ companyId, type, status });
    const capped = Math.max(1, Math.min(200, Number(limit) || 50));
    const from = Math.max(0, Math.floor(Number(offset) || 0));
    const total = database.prepare(`SELECT COUNT(*) AS total FROM agent4_paperwork ${where}`).get(...values).total;
    const rows = database
      .prepare(`
        SELECT * FROM agent4_paperwork ${where}
        ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, created_at DESC, rowid DESC
        LIMIT ? OFFSET ?
      `)
      .all(...values, capped, from);
    const documents = rows.map(hydrate);
    return { documents, total, hasMore: from + documents.length < total };
  }

  /** One company's paperwork for its own page, newest first, however it stands. */
  function companyPaperwork(companyId) {
    const wanted = text(companyId, 140);
    if (!wanted) return [];
    return database
      .prepare("SELECT * FROM agent4_paperwork WHERE company_id = ? ORDER BY created_at DESC, rowid DESC")
      .all(wanted)
      .map(hydrate);
  }

  function close() {
    database.close();
  }

  return {
    createDocument,
    updateDocument,
    setStatus,
    getDocument,
    listDocuments,
    companyPaperwork,
    removeDocument,
    nextNumber,
    close
  };
}
