import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localIsoDate } from "./local-date.js";

/**
 * Invoices, and the single place they meet the books. An invoice that has been
 * sent is money promised; an invoice that has been paid is money settled. Rather
 * than keeping a second set of figures, sending and settling write through to
 * the money record, so the two can never disagree.
 */

const STATUSES = new Set(["draft", "sent", "paid", "void"]);
const MINOR = 100;

/**
 * The filter value that asks for the invoices with no company against them —
 * the set a person goes looking for in order to fix it. A query string cannot
 * tell an empty value from an absent one, so the ask is spelled out. It is
 * matched exactly, which reserves it: a company whose id were literally "none"
 * could not be filtered for by id. The money record spells it the same way.
 */
const NO_COMPANY = "none";

/**
 * A currency code says what the money is; a display unit says what the client
 * reads. Treating the two as one is how an invoice for 180,000,000 rials goes
 * out reading "180,000,000 Toman" — ten times the real price. So the profile
 * holds, per currency, the words to print and the divisor that turns the stored
 * amount into that unit. The built-in unit for IRR is the rial at divisor one,
 * because that is the currency the amount is actually in. An owner who bills in
 * tomans says so with a divisor of ten rather than by changing the word.
 */
const DEFAULT_UNITS = {
  IRR: { fa: "ریال", en: "Rial", divisor: 1 }
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  assert(/^[A-Z]{3}$/.test(currency), "Currency must be a three-letter code.");
  return currency;
}

function normalizeDate(value, label) {
  const date = String(value || "").trim();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), `${label} must be a YYYY-MM-DD date.`);
  return date;
}

function text(value, limit = 400) {
  return String(value ?? "").trim().slice(0, limit);
}

function toMinor(amount) {
  const value = Number(amount);
  assert(Number.isFinite(value), "Amount must be a number.");
  assert(value >= 0, "Amount cannot be negative.");
  assert(value < 1e12, "Amount is implausibly large.");
  return Math.round(value * MINOR);
}

/** Tax is set per invoice: Alex bills KDV in Turkey and VAT in Iran in the same week. */
function normalizeTaxRate(value) {
  const rate = Number(value);
  assert(Number.isFinite(rate), "Tax rate must be a number.");
  assert(rate >= 0 && rate <= 100, "Tax rate must be between 0 and 100 percent.");
  return Number(rate.toFixed(3));
}

function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);
}

function lineFrom(row) {
  const quantity = Number(row.quantity);
  const unit = row.unit_minor / MINOR;
  return {
    id: row.id,
    description: row.description,
    quantity,
    unitPrice: unit,
    amount: Number((quantity * unit).toFixed(2))
  };
}

/** One currency's display unit, from whatever shape the owner or an old row left behind. */
function unitFrom(value, currency) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") {
    const label = text(value, 60);
    return label ? { fa: label, en: label, divisor: 1 } : null;
  }
  assert(typeof value === "object" && !Array.isArray(value), `The display unit for ${currency} must be a label and a divisor.`);
  const fa = text(value.fa ?? value.label, 60);
  const en = text(value.en ?? value.label, 60);
  const divisor = value.divisor === undefined || value.divisor === null ? 1 : Number(value.divisor);
  assert(Number.isFinite(divisor) && divisor > 0, `The display unit for ${currency} needs a divisor above zero.`);
  if (!fa && !en) return null;
  return { fa: fa || en, en: en || fa, divisor };
}

function normalizeUnits(value) {
  assert(value && typeof value === "object" && !Array.isArray(value), "Unit labels must be an object keyed by currency.");
  const units = {};
  for (const [code, entry] of Object.entries(value)) {
    const currency = normalizeCurrency(code);
    const unit = unitFrom(entry, currency);
    if (unit) units[currency] = unit;
  }
  return units;
}

export function createInvoiceStore(databasePath, { money = null } = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_invoices (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      client_name TEXT NOT NULL,
      client_detail TEXT,
      issue_on TEXT NOT NULL,
      due_on TEXT,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      terms TEXT,
      entry_id TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent4_invoice_lines (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_minor INTEGER NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS invoice_lines_owner ON agent4_invoice_lines(invoice_id, position);
    CREATE TABLE IF NOT EXISTS agent4_invoice_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Columns added after the first release are migrated in place.
  const invoiceColumns = new Set(database.prepare("PRAGMA table_info(agent4_invoices)").all().map((row) => row.name));
  if (!invoiceColumns.has("language")) {
    database.exec("ALTER TABLE agent4_invoices ADD COLUMN language TEXT NOT NULL DEFAULT 'en'");
  }
  for (const [column, definition] of [
    ["tax_rate", "REAL NOT NULL DEFAULT 0"],
    ["tax_label", "TEXT"],
    ["paid_on", "TEXT"],
    ["company_id", "TEXT"]
  ]) {
    if (!invoiceColumns.has(column)) database.exec(`ALTER TABLE agent4_invoices ADD COLUMN ${column} ${definition}`);
  }

  const selectInvoice = database.prepare("SELECT * FROM agent4_invoices WHERE id = ?");
  const selectLines = database.prepare("SELECT * FROM agent4_invoice_lines WHERE invoice_id = ? ORDER BY position ASC");

  /**
   * Companies live in the workspace store, which shares this database file. An
   * invoice store opened on its own has nothing to check against, and refusing
   * every link in that case would be worse than trusting the caller, so the
   * check only bites where it can be made.
   */
  function normalizeCompanyId(value) {
    const companyId = text(value, 140);
    if (!companyId) return null;
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent4_workspace_companies'").get();
    if (table) {
      assert(database.prepare("SELECT id FROM agent4_workspace_companies WHERE id = ?").get(companyId), "That company no longer exists.");
    }
    return companyId;
  }

  function storedUnits() {
    const row = database.prepare("SELECT value FROM agent4_invoice_settings WHERE key = 'unitLabels'").get();
    if (!row) return {};
    try {
      return normalizeUnits(JSON.parse(row.value));
    } catch (error) {
      // A settings row that cannot be read must not take the invoice screen
      // down, and it must not disappear silently either: fall back to the
      // honest built-in unit and say on the server log what was wrong.
      console.warn(`Invoice unit labels could not be read (${error.message}); using the built-in defaults.`);
      return {};
    }
  }

  function unitMap() {
    return { ...DEFAULT_UNITS, ...storedUnits() };
  }

  function taxOf(subtotal, taxRate) {
    return Number((subtotal * (Number(taxRate) || 0) / 100).toFixed(2));
  }

  function hydrate(row, { units, today } = {}) {
    if (!row) return null;
    const resolved = units || unitMap();
    const todayIso = today || localIsoDate();
    const lines = selectLines.all(row.id).map(lineFrom);
    const subtotal = Number(lines.reduce((sum, line) => sum + line.amount, 0).toFixed(2));
    const taxRate = Number(row.tax_rate) || 0;
    const taxAmount = taxOf(subtotal, taxRate);
    const total = Number((subtotal + taxAmount).toFixed(2));
    const unit = resolved[row.currency] || { fa: row.currency, en: row.currency, divisor: 1 };
    const dueOn = row.due_on || null;
    // Overdue is never stored: a row written yesterday would still claim to be
    // on time today. It is worked out from the server's own calendar date each
    // time the invoice is read.
    const overdue = Boolean(dueOn && row.status === "sent" && dueOn < todayIso);
    return {
      id: row.id,
      number: row.number,
      clientName: row.client_name,
      clientDetail: row.client_detail || "",
      companyId: row.company_id || null,
      issueOn: row.issue_on,
      dueOn,
      paidOn: row.paid_on || null,
      currency: row.currency,
      status: row.status,
      language: row.language === "fa" ? "fa" : "en",
      notes: row.notes || "",
      terms: row.terms || "",
      entryId: row.entry_id || null,
      lines,
      subtotal,
      taxRate,
      taxLabel: row.tax_label || "",
      taxAmount,
      total,
      displayUnit: { currency: row.currency, ...unit },
      displayTotal: Number((total / unit.divisor).toFixed(2)),
      overdue,
      daysOverdue: overdue ? daysBetween(dueOn, todayIso) : 0,
      createdAt: row.created_at,
      createdBy: row.created_by,
      updatedAt: row.updated_at || null
    };
  }

  /**
   * Sequential within a year, so an invoice number reads as a real one. The
   * suffix is compared as a number: sorted as text, 2026-1000 falls below
   * 2026-999 and the next invoice would reuse a number already issued.
   */
  function nextNumber(now = new Date()) {
    const year = localIsoDate(now).slice(0, 4);
    const row = database
      .prepare(`
        SELECT number FROM agent4_invoices
        WHERE number LIKE ?
        ORDER BY CAST(substr(number, instr(number, '-') + 1) AS INTEGER) DESC
        LIMIT 1
      `)
      .get(`${year}-%`);
    const last = row ? Number(String(row.number).split("-")[1]) : 0;
    return `${year}-${String(last + 1).padStart(3, "0")}`;
  }

  /** Validates every line and works out what they cost, without writing anything. */
  function prepareLines(lines) {
    const prepared = [];
    for (const line of lines || []) {
      const description = text(line.description, 300);
      if (!description) continue;
      const quantity = Number(line.quantity);
      assert(Number.isFinite(quantity) && quantity > 0, "Every line needs a quantity above zero.");
      prepared.push({ description, quantity, unitMinor: toMinor(line.unitPrice) });
    }
    return prepared;
  }

  function subtotalOf(prepared) {
    return Number(prepared.reduce((sum, line) => sum + Number((line.quantity * (line.unitMinor / MINOR)).toFixed(2)), 0).toFixed(2));
  }

  function writeLines(invoiceId, prepared) {
    database.prepare("DELETE FROM agent4_invoice_lines WHERE invoice_id = ?").run(invoiceId);
    const insert = database.prepare(
      "INSERT INTO agent4_invoice_lines (id,invoice_id,description,quantity,unit_minor,position) VALUES (?,?,?,?,?,?)"
    );
    prepared.forEach((line, index) => {
      insert.run(randomUUID(), invoiceId, line.description, line.quantity, line.unitMinor, index);
    });
  }

  function createInvoice(input = {}) {
    const clientName = text(input.clientName, 160);
    assert(clientName, "An invoice needs a client.");
    const lines = prepareLines(input.lines);
    assert(lines.length, "An invoice needs at least one line.");
    const taxRate = input.taxRate === undefined ? 0 : normalizeTaxRate(input.taxRate);
    const companyId = normalizeCompanyId(input.companyId);
    const id = randomUUID();
    const number = text(input.number) || nextNumber();
    database.prepare(`
      INSERT INTO agent4_invoices
        (id,number,client_name,client_detail,company_id,issue_on,due_on,currency,status,language,notes,terms,tax_rate,tax_label,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?)
    `).run(
      id, number, clientName, text(input.clientDetail), companyId,
      normalizeDate(input.issueOn || localIsoDate(), "Issue date"),
      input.dueOn ? normalizeDate(input.dueOn, "Due date") : null,
      normalizeCurrency(input.currency), input.language === "fa" ? "fa" : "en",
      text(input.notes), text(input.terms), taxRate, text(input.taxLabel, 60),
      new Date().toISOString(), String(input.actorId || "unknown")
    );
    writeLines(id, lines);
    return hydrate(selectInvoice.get(id));
  }

  function updateInvoice(id, updates = {}) {
    const existing = selectInvoice.get(String(id || ""));
    assert(existing, "That invoice no longer exists.");
    assert(existing.status !== "paid", "A paid invoice cannot be edited. Move it back to sent first.");
    const next = {
      clientName: updates.clientName === undefined ? existing.client_name : text(updates.clientName, 160),
      clientDetail: updates.clientDetail === undefined ? existing.client_detail : text(updates.clientDetail),
      companyId: updates.companyId === undefined ? existing.company_id : normalizeCompanyId(updates.companyId),
      issueOn: updates.issueOn ? normalizeDate(updates.issueOn, "Issue date") : existing.issue_on,
      dueOn: updates.dueOn === undefined ? existing.due_on : updates.dueOn ? normalizeDate(updates.dueOn, "Due date") : null,
      currency: updates.currency ? normalizeCurrency(updates.currency) : existing.currency,
      notes: updates.notes === undefined ? existing.notes : text(updates.notes),
      terms: updates.terms === undefined ? existing.terms : text(updates.terms),
      language: updates.language === undefined ? existing.language : updates.language === "fa" ? "fa" : "en",
      taxRate: updates.taxRate === undefined ? Number(existing.tax_rate) || 0 : normalizeTaxRate(updates.taxRate),
      taxLabel: updates.taxLabel === undefined ? existing.tax_label : text(updates.taxLabel, 60)
    };
    assert(next.clientName, "An invoice needs a client.");

    // Everything is checked before anything is written. The money record refuses
    // an entry worth nothing, so an edit that empties an invoice already in the
    // books used to save the emptied invoice and only then fail — leaving the
    // owner with a blank invoice and an error they could not undo.
    const lines = updates.lines === undefined
      ? selectLines.all(existing.id).map((row) => ({ description: row.description, quantity: row.quantity, unitMinor: row.unit_minor }))
      : prepareLines(updates.lines);
    const subtotal = subtotalOf(lines);
    const total = Number((subtotal + taxOf(subtotal, next.taxRate)).toFixed(2));
    assert(
      !(existing.entry_id && total <= 0),
      "This invoice is already in the books, so it must keep a value above zero. Move it back to draft first."
    );

    database.prepare(`
      UPDATE agent4_invoices
      SET client_name=?,client_detail=?,company_id=?,issue_on=?,due_on=?,currency=?,notes=?,terms=?,language=?,tax_rate=?,tax_label=?,updated_at=?
      WHERE id=?
    `).run(
      next.clientName, next.clientDetail, next.companyId, next.issueOn, next.dueOn, next.currency,
      next.notes, next.terms, next.language, next.taxRate, next.taxLabel,
      new Date().toISOString(), existing.id
    );
    if (updates.lines !== undefined) writeLines(existing.id, lines);

    const invoice = hydrate(selectInvoice.get(existing.id));
    // A sent invoice already stands in the books; keep the two in step. The
    // money record refuses a company change on an entry an invoice raised, so
    // that the two cannot drift apart — this is the one writer allowed to make
    // it, because the change started on the invoice.
    if (invoice.entryId && money) {
      money.updateEntry(invoice.entryId, {
        amount: invoice.total,
        currency: invoice.currency,
        // A paid invoice cannot be edited, so the entry being corrected here is
        // still a promise and belongs on the invoice's own issue date.
        occurredOn: invoice.issueOn,
        dueOn: invoice.dueOn,
        counterparty: invoice.clientName,
        companyId: invoice.companyId || "",
        note: `Invoice ${invoice.number}`
      }, { force: true });
    }
    return invoice;
  }

  /**
   * Status is the only thing that touches the books. Sending promises money,
   * paying settles it, and pulling an invoice back withdraws the promise.
   *
   * Payment is dated by when it arrived, not by when the invoice was raised: an
   * invoice issued in June and paid in September belongs in September's books.
   * Without a date given, payment is dated today.
   */
  function setStatus(id, status, { actorId, paidOn } = {}) {
    assert(STATUSES.has(status), "Status must be draft, sent, paid or void.");
    const existing = selectInvoice.get(String(id || ""));
    assert(existing, "That invoice no longer exists.");
    const invoice = hydrate(existing);
    if (invoice.status === status) return invoice;
    const settledOn = status === "paid"
      ? normalizeDate(paidOn || invoice.paidOn || localIsoDate(), "Payment date")
      : null;

    if (status === "sent" || status === "paid") {
      assert(invoice.total > 0, "An invoice with no value cannot be sent.");
      if (!invoice.entryId && money) {
        const entry = money.addEntry({
          direction: "in",
          amount: invoice.total,
          currency: invoice.currency,
          category: "client",
          status: status === "paid" ? "settled" : "pending",
          occurredOn: status === "paid" ? settledOn : invoice.issueOn,
          dueOn: status === "paid" ? undefined : invoice.dueOn || undefined,
          counterparty: invoice.clientName,
          companyId: invoice.companyId || undefined,
          note: `Invoice ${invoice.number}`,
          actorId: actorId || invoice.createdBy
        });
        database.prepare("UPDATE agent4_invoices SET entry_id = ? WHERE id = ?").run(entry.id, invoice.id);
      } else if (invoice.entryId && money) {
        money.updateEntry(invoice.entryId, {
          status: status === "paid" ? "settled" : "pending",
          occurredOn: status === "paid" ? settledOn : invoice.issueOn,
          dueOn: status === "paid" ? null : invoice.dueOn
        });
      }
    } else if (invoice.entryId && money) {
      // Back to draft or voided: the promise is withdrawn, so the books drop it.
      money.removeEntry(invoice.entryId, { force: true });
      database.prepare("UPDATE agent4_invoices SET entry_id = NULL WHERE id = ?").run(invoice.id);
    }

    database.prepare("UPDATE agent4_invoices SET status = ?, paid_on = ?, updated_at = ? WHERE id = ?")
      .run(status, settledOn, new Date().toISOString(), invoice.id);
    return hydrate(selectInvoice.get(invoice.id));
  }

  function removeInvoice(id) {
    const existing = selectInvoice.get(String(id || ""));
    if (!existing) return false;
    if (existing.entry_id && money) money.removeEntry(existing.entry_id, { force: true });
    database.prepare("DELETE FROM agent4_invoice_lines WHERE invoice_id = ?").run(existing.id);
    database.prepare("DELETE FROM agent4_invoices WHERE id = ?").run(existing.id);
    return true;
  }

  function getInvoice(id, { today = new Date() } = {}) {
    return hydrate(selectInvoice.get(String(id || "")), { today: localIsoDate(today) });
  }

  /**
   * Late money first: an overdue invoice is the one that needs a person today.
   *
   * Both filters are applied in the query rather than left to the screen, which
   * could only sieve whatever fitted under the row cap and would quietly leave
   * out the rest.
   */
  function listInvoices({ status, companyId, limit = 100, today = new Date() } = {}) {
    const clauses = [];
    const values = [];
    if (status) {
      clauses.push("status = ?");
      values.push(status);
    }
    if (companyId) {
      const wanted = text(companyId, 140);
      if (wanted === NO_COMPANY) {
        clauses.push("(company_id IS NULL OR company_id = '')");
      } else {
        clauses.push("company_id = ?");
        values.push(wanted);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const capped = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = database
      .prepare(`SELECT * FROM agent4_invoices ${where} ORDER BY issue_on DESC, number DESC LIMIT ?`)
      .all(...values, capped);
    const units = unitMap();
    const todayIso = localIsoDate(today);
    return rows
      .map((row) => hydrate(row, { units, today: todayIso }))
      .sort((left, right) => {
        if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
        if (left.overdue && right.overdue) return right.daysOverdue - left.daysOverdue;
        return right.issueOn.localeCompare(left.issueOn) || right.number.localeCompare(left.number);
      });
  }

  /** Who the invoice is from, how to pay it, and what to call the money. */
  function getProfile() {
    const rows = database.prepare("SELECT key, value FROM agent4_invoice_settings").all();
    const profile = {};
    for (const row of rows) profile[row.key] = row.value;
    return {
      name: profile.name || "",
      detail: profile.detail || "",
      detailFa: profile.detailFa || "",
      payTo: profile.payTo || "",
      payToFa: profile.payToFa || "",
      footer: profile.footer || "",
      taxId: profile.taxId || "",
      unitLabels: unitMap()
    };
  }

  function setProfile(input = {}) {
    const write = database.prepare(
      "INSERT INTO agent4_invoice_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );
    const now = new Date().toISOString();
    for (const key of ["name", "detail", "detailFa", "payTo", "payToFa", "footer", "taxId"]) {
      if (input[key] !== undefined) write.run(key, text(input[key], 600), now);
    }
    // Rejected before it is written, so a bad divisor never becomes the thing
    // every invoice is printed with.
    if (input.unitLabels !== undefined) write.run("unitLabels", JSON.stringify(normalizeUnits(input.unitLabels || {})), now);
    return getProfile();
  }

  function close() {
    database.close();
  }

  return {
    createInvoice,
    updateInvoice,
    setStatus,
    removeInvoice,
    getInvoice,
    listInvoices,
    nextNumber,
    getProfile,
    setProfile,
    close
  };
}
