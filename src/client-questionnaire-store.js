import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stripHiddenCharacters } from "./hidden-text.js";
import { snapshotTemplate } from "./questionnaire-templates.js";

/*
 * A questionnaire sent to one person's client link, and what they answered.
 *
 * It belongs to the LINK, not the company: a second stakeholder with their own
 * link never sees the first one's questions or answers. The questions are a
 * frozen copy made when it was sent. Answers are text only, each one capped, and
 * only answers to questions that exist in that frozen copy are ever kept.
 *
 * It has three states and nothing else:
 *   open       sent, being answered
 *   submitted  the client pressed send (they can still change answers)
 *   closed     the owner ended it; the client can read but not change
 *
 * A client may also ask to answer on a call instead of typing. That is a note
 * on the questionnaire (when, and the times that suit them), not a state: the
 * owner fills the answers in from the call, and the client can still type.
 */

export const QUESTIONNAIRE_LIMITS = Object.freeze({ answer: 4000, fields: 60, callTimes: 300 });
const STATES = new Set(["open", "submitted", "closed"]);

function text(value, limit = 300) {
  return String(value ?? "").trim().slice(0, limit);
}

/** Control characters out, line breaks kept, a lone half of an emoji never left behind. */
export function cleanAnswer(value) {
  if (typeof value !== "string") return "";
  // What was typed is kept as typed: indentation in a list survives. What goes
  // is control characters, direction overrides, and characters nobody can see.
  const cleaned = stripHiddenCharacters(value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    // Line separators become line breaks; control characters and direction overrides
    // are removed outright, so they cannot leave a stray space behind.
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\t/g, "  "))
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .trimEnd();
  let result = cleaned.slice(0, QUESTIONNAIRE_LIMITS.answer);
  const last = result.charCodeAt(result.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) result = result.slice(0, -1);
  return result;
}

function parseJson(raw, fallback) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

/** How far along it is: every question, and the ones needed to start. */
export function progressOf(content, answers) {
  const questions = (content.sections || []).flatMap((section) => section.questions || []);
  const answered = (question) => Boolean(String(answers[question.id] ?? "").trim());
  const needed = questions.filter((question) => question.must);
  return {
    total: questions.length,
    answered: questions.filter(answered).length,
    needed: needed.length,
    neededAnswered: needed.filter(answered).length
  };
}

export function createClientQuestionnaireStore(databasePath, { now = () => new Date() } = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_client_questionnaires (
      id TEXT PRIMARY KEY,
      link_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      answers TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT,
      submitted_at TEXT,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS client_questionnaires_link ON agent4_client_questionnaires(link_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS client_questionnaires_company ON agent4_client_questionnaires(company_id);
  `);

  // Made before a client could ask for a call: add the two columns in place.
  const columns = new Set(database.prepare("PRAGMA table_info(agent4_client_questionnaires)").all().map((column) => column.name));
  if (!columns.has("call_requested_at")) database.exec("ALTER TABLE agent4_client_questionnaires ADD COLUMN call_requested_at TEXT");
  if (!columns.has("call_times")) database.exec("ALTER TABLE agent4_client_questionnaires ADD COLUMN call_times TEXT NOT NULL DEFAULT ''");

  const selectById = database.prepare("SELECT * FROM agent4_client_questionnaires WHERE id = ?");

  function from(row) {
    if (!row) return null;
    const content = parseJson(row.content, { sections: [] });
    const answers = parseJson(row.answers, {});
    return {
      id: row.id,
      linkId: row.link_id,
      companyId: row.company_id,
      templateId: row.template_id,
      language: row.language === "fa" ? "fa" : "en",
      title: row.title,
      content,
      answers,
      status: STATES.has(row.status) ? row.status : "open",
      progress: progressOf(content, answers),
      createdAt: row.created_at,
      createdBy: row.created_by,
      updatedAt: row.updated_at || null,
      submittedAt: row.submitted_at || null,
      closedAt: row.closed_at || null,
      callRequestedAt: row.call_requested_at || null,
      callTimes: row.call_times || ""
    };
  }

  /** A short form for lists: everything but the questions and the answers themselves. */
  function summary(questionnaire) {
    const { content, answers, ...rest } = questionnaire;
    void content;
    void answers;
    return rest;
  }

  function create({ linkId, companyId, templateId, language, actorId }) {
    const link = text(linkId, 140);
    const company = text(companyId, 140);
    assert(link && company, "A questionnaire needs a link and a company.");
    const lang = language === "fa" ? "fa" : "en";
    const content = snapshotTemplate(templateId, lang);
    assert(content, "That questionnaire does not exist.");
    const existing = database
      .prepare("SELECT id FROM agent4_client_questionnaires WHERE link_id = ? AND template_id = ? AND status != 'closed'")
      .get(link, templateId);
    assert(!existing, "That questionnaire is already with them. Close it first to send it again.");
    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_client_questionnaires (id,link_id,company_id,template_id,language,title,content,answers,status,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,'{}','open',?,?)
    `).run(id, link, company, templateId, lang, content.title, JSON.stringify(content), now().toISOString(), text(actorId, 140) || "unknown");
    return from(selectById.get(id));
  }

  function get(id) {
    return from(selectById.get(text(id, 140)));
  }

  /** The questionnaires on one person's link. The id of the link is the only way in. */
  function listForLink(linkId) {
    return database
      .prepare("SELECT * FROM agent4_client_questionnaires WHERE link_id = ? ORDER BY created_at DESC")
      .all(text(linkId, 140))
      .map(from);
  }

  /** One questionnaire, only if it is on that link: a different person's is "not found". */
  function getForLink(linkId, id) {
    const questionnaire = get(id);
    return questionnaire && questionnaire.linkId === text(linkId, 140) ? questionnaire : null;
  }

  /**
   * Keeps the answers to questions that exist, capped and cleaned, and nothing
   * else. An empty answer removes a previous one. `submit` marks it sent.
   */
  function saveAnswers(id, input = {}) {
    const existing = selectById.get(text(id, 140));
    assert(existing, "That questionnaire no longer exists.");
    assert(existing.status !== "closed", "This questionnaire is closed.");
    const content = parseJson(existing.content, { sections: [] });
    const known = new Set((content.sections || []).flatMap((section) => (section.questions || []).map((question) => question.id)));
    const answers = parseJson(existing.answers, {});
    const given = input.answers && typeof input.answers === "object" ? input.answers : {};
    let changed = false;
    for (const [questionId, value] of Object.entries(given).slice(0, QUESTIONNAIRE_LIMITS.fields)) {
      if (!known.has(questionId)) continue;
      const cleaned = cleanAnswer(value);
      if (cleaned) {
        if (answers[questionId] !== cleaned) changed = true;
        answers[questionId] = cleaned;
      } else if (questionId in answers) {
        delete answers[questionId];
        changed = true;
      }
    }
    const moment = now().toISOString();
    const submit = input.submit === true;
    database.prepare(`
      UPDATE agent4_client_questionnaires
      SET answers = ?, updated_at = ?, status = ?, submitted_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(answers),
      changed || submit ? moment : existing.updated_at,
      submit ? "submitted" : existing.status,
      submit ? moment : existing.submitted_at,
      existing.id
    );
    return { questionnaire: from(selectById.get(existing.id)), changed, submitted: submit };
  }

  /**
   * The client would rather talk than type. Kept: when they asked, and the
   * times they said suit them (plain text, short). Asking again only updates
   * the times; `first` says whether this is news.
   */
  function requestCall(id, input = {}) {
    const existing = selectById.get(text(id, 140));
    assert(existing, "That questionnaire no longer exists.");
    assert(existing.status !== "closed", "This questionnaire is closed.");
    const times = cleanAnswer(String(input.times ?? "")).replace(/\n+/g, " ").slice(0, QUESTIONNAIRE_LIMITS.callTimes).trim();
    const first = !existing.call_requested_at;
    database.prepare("UPDATE agent4_client_questionnaires SET call_requested_at = ?, call_times = ? WHERE id = ?")
      .run(existing.call_requested_at || now().toISOString(), times || existing.call_times || "", existing.id);
    return { questionnaire: from(selectById.get(existing.id)), first };
  }

  function setStatus(id, status) {
    const existing = selectById.get(text(id, 140));
    assert(existing, "That questionnaire no longer exists.");
    assert(STATES.has(status), "A questionnaire is open, submitted or closed.");
    const moment = now().toISOString();
    if (status === "closed") {
      database.prepare("UPDATE agent4_client_questionnaires SET status='closed', closed_at=? WHERE id=?").run(moment, existing.id);
    } else {
      // Reopening goes back to where it was: sent if it had been sent.
      database.prepare("UPDATE agent4_client_questionnaires SET status=?, closed_at=NULL WHERE id=?").run(existing.submitted_at ? "submitted" : "open", existing.id);
    }
    return from(selectById.get(existing.id));
  }

  function remove(id) {
    return database.prepare("DELETE FROM agent4_client_questionnaires WHERE id = ?").run(text(id, 140)).changes > 0;
  }

  function removeCompany(companyId) {
    return database.prepare("DELETE FROM agent4_client_questionnaires WHERE company_id = ?").run(text(companyId, 140)).changes;
  }

  return { create, get, getForLink, listForLink, saveAnswers, requestCall, setStatus, remove, removeCompany, summary, close() { database.close(); } };
}
