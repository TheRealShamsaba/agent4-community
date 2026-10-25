import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localIsoDate, localIsoMonth } from "./local-date.js";

/**
 * The company's money record. Currencies never mix: every total is reported per
 * currency, because a rial and a euro added together is a number that lies.
 *
 * Amounts are stored as integer minor units so repeated arithmetic cannot drift
 * the way floating point does.
 */

const DIRECTIONS = new Set(["in", "out"]);
const STATUSES = new Set(["settled", "pending"]);
const CADENCES = new Set(["monthly", "yearly"]);

/** What money is for. Chosen so "profit" has an agreed meaning. */
const CATEGORIES = {
  in: new Set(["client", "other"]),
  out: new Set(["running", "people", "contractor", "billable"])
};

const MINOR = 100;
const MAX_MAJOR = 1e12;

/**
 * The filter value that asks for the rows with nothing against them — the set a
 * person goes looking for in order to fix it. A query string cannot tell an
 * empty value from an absent one, so the ask is spelled out. It is matched
 * exactly, which reserves it: a company whose id were literally "none" could not
 * be filtered for by id.
 */
const NO_COMPANY = "none";

/** What the report calls an entry whose counterparty was left blank. */
const NO_COUNTERPARTY = "No name given";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  assert(/^[A-Z]{3}$/.test(currency), "Currency must be a three-letter code, such as IRR, USD or EUR.");
  return currency;
}

function normalizeDate(value, label) {
  const date = String(value || "").trim();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), `${label} must be a YYYY-MM-DD date.`);
  assert(!Number.isNaN(Date.parse(`${date}T00:00:00Z`)), `${label} is not a real date.`);
  return date;
}

/**
 * A negative amount is a real event: a refund to a client, a chargeback, a
 * supplier crediting a bill back. It is recorded against the same direction it
 * reverses, so a refunded fee reduces the income it came from instead of being
 * filed as an unrelated cost. Zero is still refused — an entry worth nothing is
 * a mistake, not a movement.
 */
function toMinor(amount) {
  const value = Number(amount);
  assert(Number.isFinite(value), "Amount must be a number.");
  assert(value !== 0, "Amount cannot be zero.");
  assert(Math.abs(value) < MAX_MAJOR, "Amount is implausibly large.");
  return Math.round(value * MINOR);
}

function toMajor(minor) {
  return Number(minor) / MINOR;
}

function normalizeText(value, limit = 200) {
  const text = String(value ?? "").trim();
  return text.slice(0, limit);
}

function normalizeMonth(value) {
  const month = String(value || "").trim();
  assert(/^\d{4}-\d{2}$/.test(month), "Month must be YYYY-MM.");
  return month;
}

function entryFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    direction: row.direction,
    amount: toMajor(row.amount_minor),
    currency: row.currency,
    category: row.category,
    status: row.status,
    occurredOn: row.occurred_on,
    dueOn: row.due_on || null,
    counterparty: row.counterparty || "",
    note: row.note || "",
    project: row.project || "",
    companyId: row.company_id || null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at || null,
    fromRecurring: row.source_recurring_id || null
  };
}

function recurringFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    direction: row.direction,
    amount: toMajor(row.amount_minor),
    currency: row.currency,
    category: row.category,
    cadence: row.cadence,
    dayOfMonth: row.day_of_month ?? null,
    counterparty: row.counterparty || "",
    note: row.note || "",
    companyId: row.company_id || null,
    active: Boolean(row.active),
    lastPostedOn: row.last_posted_on || null,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

/**
 * Rounds a breakdown and drops the lines that came to nothing. A category whose
 * only charge was later refunded nets to zero, and showing it as an empty slice
 * of "where it went" invites the reader to look for money that is not there.
 * Lines that stay negative are kept: money genuinely came back.
 */
function settledSpend(totals) {
  const cleaned = {};
  for (const [key, value] of Object.entries(totals || {})) {
    const amount = Number(value.toFixed(2));
    if (amount !== 0) cleaned[key] = amount;
  }
  return cleaned;
}

/**
 * Turns the report's "who paid, who got paid" groups into rows, dropping the
 * ones that came to nothing for the same reason a spend line is dropped: a
 * charge that was fully refunded is not somebody the money moved with. Biggest
 * first, because that is the order the question is asked in.
 */
function partyRows(groups) {
  return [...groups.values()]
    .map((group) => ({ companyId: group.companyId, name: group.name, amount: Number(group.amount.toFixed(2)) }))
    .filter((row) => row.amount !== 0)
    .sort((left, right) => right.amount - left.amount || left.name.localeCompare(right.name));
}

function validateEntry({ direction, category, status, dueOn }) {
  assert(DIRECTIONS.has(direction), "Direction must be in or out.");
  assert(STATUSES.has(status), "Status must be settled or pending.");
  assert(CATEGORIES[direction].has(category), `Category ${category} is not valid for money ${direction}.`);
  if (status === "settled") assert(!dueOn, "A settled entry has no due date.");
}

export function moneyDatabasePath(root) {
  return path.join(root, "data", "agent4-rooms.sqlite");
}

export function createMoneyStore(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_money_entries (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      occurred_on TEXT NOT NULL,
      due_on TEXT,
      counterparty TEXT,
      note TEXT,
      project TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS money_entries_when ON agent4_money_entries(occurred_on DESC);
    CREATE INDEX IF NOT EXISTS money_entries_open ON agent4_money_entries(status, direction, due_on);
    CREATE TABLE IF NOT EXISTS agent4_money_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent4_money_recurring (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      category TEXT NOT NULL,
      cadence TEXT NOT NULL,
      day_of_month INTEGER,
      counterparty TEXT,
      note TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
  `);

  // Columns added after the first release are migrated in place.
  const entryColumns = new Set(database.prepare("PRAGMA table_info(agent4_money_entries)").all().map((row) => row.name));
  if (!entryColumns.has("source_recurring_id")) {
    database.exec("ALTER TABLE agent4_money_entries ADD COLUMN source_recurring_id TEXT");
  }
  if (!entryColumns.has("company_id")) {
    database.exec("ALTER TABLE agent4_money_entries ADD COLUMN company_id TEXT");
  }
  const recurringColumns = new Set(database.prepare("PRAGMA table_info(agent4_money_recurring)").all().map((row) => row.name));
  if (!recurringColumns.has("last_posted_on")) {
    database.exec("ALTER TABLE agent4_money_recurring ADD COLUMN last_posted_on TEXT");
  }
  if (!recurringColumns.has("company_id")) {
    database.exec("ALTER TABLE agent4_money_recurring ADD COLUMN company_id TEXT");
  }

  const insertEntry = database.prepare(`
    INSERT INTO agent4_money_entries
      (id,direction,amount_minor,currency,category,status,occurred_on,due_on,counterparty,note,project,company_id,created_at,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const selectEntry = database.prepare("SELECT * FROM agent4_money_entries WHERE id = ?");
  const deleteEntryRow = database.prepare("DELETE FROM agent4_money_entries WHERE id = ?");

  function tableExists(name) {
    return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  }

  /**
   * Companies live in the workspace store, which shares this database file. A
   * money store opened on its own (a test, an import script) has no company
   * table to check against, and refusing every link in that case would be worse
   * than trusting the caller, so the check only bites where it can be made.
   */
  function companyExists(companyId) {
    if (!tableExists("agent4_workspace_companies")) return true;
    return Boolean(database.prepare("SELECT id FROM agent4_workspace_companies WHERE id = ?").get(companyId));
  }

  function normalizeCompanyId(value) {
    const companyId = normalizeText(value, 140);
    if (!companyId) return null;
    assert(companyExists(companyId), "That company no longer exists.");
    return companyId;
  }

  /**
   * The company's own name, which is what a report should print. The spelling
   * typed into an entry is whatever the owner reached for that day, and showing
   * that instead is how one client ends up looking like three.
   */
  function companyName(companyId) {
    if (!tableExists("agent4_workspace_companies")) return "";
    const company = database.prepare("SELECT name FROM agent4_workspace_companies WHERE id = ?").get(companyId);
    return company ? String(company.name || "") : "";
  }

  /**
   * An entry raised by an invoice belongs to that invoice. Deleting it from
   * here would leave the invoice pointing at an entry that is gone, and the
   * next status change would fail with a puzzle instead of a reason. Refusing
   * loses nothing — voiding or deleting the invoice withdraws the promise and
   * takes the entry with it — whereas quietly unlinking would drop a sent
   * invoice out of the books without telling anyone.
   */
  function invoiceHolding(entryId) {
    if (!tableExists("agent4_invoices")) return null;
    return database.prepare("SELECT id, number FROM agent4_invoices WHERE entry_id = ?").get(entryId) || null;
  }

  function addEntry(input = {}) {
    const direction = String(input.direction || "").trim();
    const status = String(input.status || "settled").trim();
    const category = String(input.category || "").trim();
    const dueOn = input.dueOn ? normalizeDate(input.dueOn, "Due date") : null;
    validateEntry({ direction, category, status, dueOn });

    const row = {
      id: randomUUID(),
      direction,
      amountMinor: toMinor(input.amount),
      currency: normalizeCurrency(input.currency),
      category,
      status,
      occurredOn: normalizeDate(input.occurredOn || localIsoDate(), "Date"),
      dueOn,
      counterparty: normalizeText(input.counterparty),
      note: normalizeText(input.note, 500),
      project: normalizeText(input.project),
      companyId: normalizeCompanyId(input.companyId),
      createdAt: new Date().toISOString(),
      createdBy: String(input.actorId || "").trim() || "unknown"
    };

    insertEntry.run(
      row.id, row.direction, row.amountMinor, row.currency, row.category, row.status,
      row.occurredOn, row.dueOn, row.counterparty, row.note, row.project, row.companyId,
      row.createdAt, row.createdBy
    );
    return entryFromRow(selectEntry.get(row.id));
  }

  function updateEntry(id, updates = {}, { force = false } = {}) {
    const existing = selectEntry.get(String(id || ""));
    assert(existing, "That money entry no longer exists.");
    const next = {
      direction: updates.direction ?? existing.direction,
      category: updates.category ?? existing.category,
      status: updates.status ?? existing.status,
      currency: updates.currency ? normalizeCurrency(updates.currency) : existing.currency,
      amountMinor: updates.amount === undefined ? existing.amount_minor : toMinor(updates.amount),
      occurredOn: updates.occurredOn ? normalizeDate(updates.occurredOn, "Date") : existing.occurred_on,
      counterparty: updates.counterparty === undefined ? existing.counterparty : normalizeText(updates.counterparty),
      note: updates.note === undefined ? existing.note : normalizeText(updates.note, 500),
      project: updates.project === undefined ? existing.project : normalizeText(updates.project),
      companyId: updates.companyId === undefined ? existing.company_id : normalizeCompanyId(updates.companyId)
    };
    // Settling an invoice clears its due date rather than leaving a stale one behind.
    next.dueOn = next.status === "settled"
      ? null
      : updates.dueOn === undefined
        ? existing.due_on
        : updates.dueOn ? normalizeDate(updates.dueOn, "Due date") : null;
    validateEntry(next);

    // An entry raised by an invoice takes its company from that invoice, the
    // same way it takes its amount and its client. Changing it here would let
    // the money row and the invoice that created it point at two different
    // companies, and neither screen would say which one was right. The invoice
    // writes its own changes through with force.
    if (!force && (next.companyId || null) !== (existing.company_id || null)) {
      const holder = invoiceHolding(existing.id);
      assert(!holder, `Invoice ${holder ? holder.number : ""} raised this entry. Change the company on that invoice instead.`);
    }

    database.prepare(`
      UPDATE agent4_money_entries
      SET direction=?,amount_minor=?,currency=?,category=?,status=?,occurred_on=?,due_on=?,
          counterparty=?,note=?,project=?,company_id=?,updated_at=?
      WHERE id=?
    `).run(
      next.direction, next.amountMinor, next.currency, next.category, next.status, next.occurredOn,
      next.dueOn, next.counterparty, next.note, next.project, next.companyId,
      new Date().toISOString(), existing.id
    );
    return entryFromRow(selectEntry.get(existing.id));
  }

  function removeEntry(id, { force = false } = {}) {
    const existing = selectEntry.get(String(id || ""));
    if (!existing) return false;
    const holder = force ? null : invoiceHolding(existing.id);
    assert(!holder, `Invoice ${holder ? holder.number : ""} raised this entry. Void or delete that invoice instead.`);
    deleteEntryRow.run(existing.id);
    return true;
  }

  /**
   * The period switcher asks for a quarter or a year, not only a month, so the
   * list takes explicit date bounds. `month` stays as the shorthand it always
   * was; `from` and `to` are inclusive and can be used on their own.
   */
  function listEntries({ month, from, to, direction, status, companyId, limit = 100 } = {}) {
    const clauses = [];
    const values = [];
    if (month) {
      clauses.push("occurred_on LIKE ?");
      values.push(`${normalizeMonth(month)}-%`);
    }
    if (from) {
      clauses.push("occurred_on >= ?");
      values.push(normalizeDate(from, "From date"));
    }
    if (to) {
      clauses.push("occurred_on <= ?");
      values.push(normalizeDate(to, "To date"));
    }
    if (companyId) {
      // `companyId=none` asks for the entries with no company against them.
      // Sieving for those in the browser is only right up to the row cap, and
      // the whole point of asking is to see every one of them.
      const wanted = normalizeText(companyId, 140);
      if (wanted === NO_COMPANY) {
        clauses.push("(company_id IS NULL OR company_id = '')");
      } else {
        clauses.push("company_id = ?");
        values.push(wanted);
      }
    }
    if (direction) {
      assert(DIRECTIONS.has(direction), "Direction must be in or out.");
      clauses.push("direction = ?");
      values.push(direction);
    }
    if (status) {
      assert(STATUSES.has(status), "Status must be settled or pending.");
      clauses.push("status = ?");
      values.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const capped = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = database
      .prepare(`SELECT * FROM agent4_money_entries ${where} ORDER BY occurred_on DESC, created_at DESC LIMIT ?`)
      .all(...values, capped);
    return rows.map(entryFromRow);
  }

  /**
   * A month's picture, per currency. Settled money is what actually moved;
   * pending income is what has been promised but not received.
   */
  function summary({ month, today = new Date() } = {}) {
    const target = month ? normalizeMonth(month) : localIsoMonth(today);
    const todayDate = localIsoDate(today);
    const byCurrency = new Map();

    const ensure = (currency) => {
      if (!byCurrency.has(currency)) {
        byCurrency.set(currency, {
          currency, in: 0, out: 0, net: 0, outstanding: 0, overdue: 0, overdueCount: 0, spend: {}
        });
      }
      return byCurrency.get(currency);
    };

    for (const row of database
      .prepare("SELECT * FROM agent4_money_entries WHERE occurred_on LIKE ? AND status = 'settled'")
      .all(`${target}-%`)) {
      const bucket = ensure(row.currency);
      const amount = toMajor(row.amount_minor);
      if (row.direction === "in") bucket.in += amount;
      else {
        bucket.out += amount;
        bucket.spend[row.category] = (bucket.spend[row.category] || 0) + amount;
      }
    }

    // Money owed to us is not bound to the month being viewed: a late invoice
    // from March is still money missing today.
    for (const row of database
      .prepare("SELECT * FROM agent4_money_entries WHERE status = 'pending' AND direction = 'in'")
      .all()) {
      const bucket = ensure(row.currency);
      const amount = toMajor(row.amount_minor);
      bucket.outstanding += amount;
      if (row.due_on && row.due_on < todayDate) {
        bucket.overdue += amount;
        bucket.overdueCount += 1;
      }
    }

    const currencies = [...byCurrency.values()].map((bucket) => ({
      ...bucket,
      net: Number((bucket.in - bucket.out).toFixed(2)),
      in: Number(bucket.in.toFixed(2)),
      out: Number(bucket.out.toFixed(2)),
      outstanding: Number(bucket.outstanding.toFixed(2)),
      overdue: Number(bucket.overdue.toFixed(2)),
      spend: settledSpend(bucket.spend)
    }));
    currencies.sort((left, right) => right.in - left.in || left.currency.localeCompare(right.currency));
    return { month: target, currencies };
  }

  function addRecurring(input = {}) {
    const direction = String(input.direction || "").trim();
    const category = String(input.category || "").trim();
    const cadence = String(input.cadence || "monthly").trim();
    assert(CADENCES.has(cadence), "Cadence must be monthly or yearly.");
    validateEntry({ direction, category, status: "settled", dueOn: null });
    const dayOfMonth = input.dayOfMonth === undefined || input.dayOfMonth === null
      ? null
      : Math.max(1, Math.min(28, Number(input.dayOfMonth) || 1));

    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_money_recurring
        (id,direction,amount_minor,currency,category,cadence,day_of_month,counterparty,note,company_id,active,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)
    `).run(
      id, direction, toMinor(input.amount), normalizeCurrency(input.currency), category, cadence,
      dayOfMonth, normalizeText(input.counterparty), normalizeText(input.note, 500),
      normalizeCompanyId(input.companyId),
      new Date().toISOString(), String(input.actorId || "").trim() || "unknown"
    );
    return recurringFromRow(database.prepare("SELECT * FROM agent4_money_recurring WHERE id = ?").get(id));
  }

  function listRecurring({ activeOnly = true } = {}) {
    const rows = activeOnly
      ? database.prepare("SELECT * FROM agent4_money_recurring WHERE active = 1 ORDER BY created_at DESC").all()
      : database.prepare("SELECT * FROM agent4_money_recurring ORDER BY created_at DESC").all();
    return rows.map(recurringFromRow);
  }

  function stopRecurring(id) {
    const result = database.prepare("UPDATE agent4_money_recurring SET active = 0 WHERE id = ? AND active = 1").run(String(id || ""));
    return result.changes > 0;
  }

  /** What the standing costs come to each month, per currency. Yearly is spread over twelve. */
  function monthlyCommitments() {
    const byCurrency = new Map();
    for (const row of listRecurring({ activeOnly: true })) {
      if (row.direction !== "out") continue;
      const monthly = row.cadence === "yearly" ? row.amount / 12 : row.amount;
      byCurrency.set(row.currency, (byCurrency.get(row.currency) || 0) + monthly);
    }
    return [...byCurrency.entries()]
      .map(([currency, amount]) => ({ currency, amount: Number(amount.toFixed(2)) }))
      .sort((left, right) => right.amount - left.amount);
  }


  /** Inclusive date bounds for a month (2026-08), quarter (2026-Q3) or year (2026). */
  function periodBounds(period) {
    const value = String(period || "").trim();
    let match = /^(\d{4})-(\d{2})$/.exec(value);
    if (match) {
      const last = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
      return { from: `${value}-01`, to: `${value}-${String(last).padStart(2, "0")}`, granularity: "month" };
    }
    match = /^(\d{4})-Q([1-4])$/i.exec(value);
    if (match) {
      const startMonth = (Number(match[2]) - 1) * 3 + 1;
      const endMonth = startMonth + 2;
      const last = new Date(Date.UTC(Number(match[1]), endMonth, 0)).getUTCDate();
      return {
        from: `${match[1]}-${String(startMonth).padStart(2, "0")}-01`,
        to: `${match[1]}-${String(endMonth).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
        granularity: "quarter"
      };
    }
    match = /^(\d{4})$/.exec(value);
    if (match) return { from: `${value}-01-01`, to: `${value}-12-31`, granularity: "year" };
    throw new Error("Period must be YYYY-MM, YYYY-Qn or YYYY.");
  }

  /**
   * Everything a period is made of, per currency: what came in, what went out,
   * where it went, and who it moved between. Outstanding money is deliberately
   * not bounded by the period — an unpaid invoice is missing today regardless
   * of the month it was raised in.
   *
   * `earners` and `payees` are lists of { companyId, name, amount }, biggest
   * first. They are grouped by company wherever an entry carries one, so the
   * row can be clicked through to that company and so the three spellings of a
   * client's name that a year of typing produces stay one client.
   */
  function periodReport({ period, today = new Date() } = {}) {
    const target = period || localIsoMonth(today);
    const { from, to, granularity } = periodBounds(target);
    const todayDate = localIsoDate(today);
    const byCurrency = new Map();
    const ensure = (currency) => {
      if (!byCurrency.has(currency)) {
        byCurrency.set(currency, {
          currency, in: 0, out: 0, net: 0, outstanding: 0, overdue: 0, overdueCount: 0,
          spend: {}, earners: new Map(), payees: new Map(), entries: 0
        });
      }
      return byCurrency.get(currency);
    };

    // Company names are looked up once each rather than per entry: a year's
    // report reads the same handful of companies thousands of times.
    const names = new Map();
    const nameOf = (companyId) => {
      if (!names.has(companyId)) names.set(companyId, companyName(companyId));
      return names.get(companyId);
    };

    /**
     * Who an entry moved money with. A company is the sturdy handle and is used
     * whenever there is one; without it the only handle is the counterparty
     * text, matched case-insensitively so "sara" and "Sara" stay one person.
     */
    const partyOf = (row) => {
      const written = row.counterparty || NO_COUNTERPARTY;
      if (!row.company_id) return { key: `text:${written.toLowerCase()}`, companyId: null, name: written };
      return { key: `company:${row.company_id}`, companyId: row.company_id, name: nameOf(row.company_id) || written };
    };

    const credit = (groups, party, amount) => {
      const group = groups.get(party.key) || { companyId: party.companyId, name: party.name, amount: 0 };
      group.amount += amount;
      groups.set(party.key, group);
    };

    for (const row of database
      .prepare("SELECT * FROM agent4_money_entries WHERE occurred_on >= ? AND occurred_on <= ? AND status = 'settled'")
      .all(from, to)) {
      const bucket = ensure(row.currency);
      const amount = toMajor(row.amount_minor);
      const party = partyOf(row);
      bucket.entries += 1;
      if (row.direction === "in") {
        bucket.in += amount;
        credit(bucket.earners, party, amount);
      } else {
        bucket.out += amount;
        bucket.spend[row.category] = Number(((bucket.spend[row.category] || 0) + amount).toFixed(2));
        credit(bucket.payees, party, amount);
      }
    }

    for (const row of database
      .prepare("SELECT * FROM agent4_money_entries WHERE status = 'pending' AND direction = 'in'")
      .all()) {
      const bucket = ensure(row.currency);
      const amount = toMajor(row.amount_minor);
      bucket.outstanding += amount;
      if (row.due_on && row.due_on < todayDate) {
        bucket.overdue += amount;
        bucket.overdueCount += 1;
      }
    }

    const currencies = [...byCurrency.values()]
      .map(({ earners, payees, ...bucket }) => ({
        ...bucket,
        in: Number(bucket.in.toFixed(2)),
        out: Number(bucket.out.toFixed(2)),
        net: Number((bucket.in - bucket.out).toFixed(2)),
        outstanding: Number(bucket.outstanding.toFixed(2)),
        overdue: Number(bucket.overdue.toFixed(2)),
        spend: settledSpend(bucket.spend),
        earners: partyRows(earners),
        payees: partyRows(payees)
      }))
      .sort((left, right) => right.in - left.in || left.currency.localeCompare(right.currency));
    return { period: target, from, to, granularity, currencies };
  }

  /** A run of consecutive months, for drawing a trend. */
  function series({ months = 12, endMonth, today = new Date() } = {}) {
    const end = endMonth ? normalizeMonth(endMonth) : localIsoMonth(today);
    const count = Math.max(1, Math.min(60, Number(months) || 12));
    const [endYear, endIndex] = end.split("-").map(Number);
    const keys = [];
    for (let step = count - 1; step >= 0; step -= 1) {
      const date = new Date(Date.UTC(endYear, endIndex - 1 - step, 1));
      keys.push(date.toISOString().slice(0, 7));
    }

    const byCurrency = new Map();
    for (const key of keys) {
      const { from, to } = periodBounds(key);
      for (const row of database
        .prepare("SELECT currency, direction, SUM(amount_minor) AS total FROM agent4_money_entries WHERE occurred_on >= ? AND occurred_on <= ? AND status = 'settled' GROUP BY currency, direction")
        .all(from, to)) {
        if (!byCurrency.has(row.currency)) {
          byCurrency.set(row.currency, new Map(keys.map((month) => [month, { month, in: 0, out: 0 }])));
        }
        const point = byCurrency.get(row.currency).get(key);
        point[row.direction] = toMajor(row.total);
      }
    }

    return [...byCurrency.entries()].map(([currency, points]) => ({
      currency,
      points: [...points.values()].map((point) => ({
        ...point,
        net: Number((point.in - point.out).toFixed(2))
      }))
    }));
  }

  function getSettings() {
    const rows = database.prepare("SELECT key, value FROM agent4_money_settings").all();
    const inflation = {};
    const opening = {};
    for (const row of rows) {
      const inflationMatch = /^inflation:([A-Z]{3})$/.exec(row.key);
      if (inflationMatch) inflation[inflationMatch[1]] = Number(row.value);
      const openingMatch = /^opening:([A-Z]{3})$/.exec(row.key);
      if (openingMatch) opening[openingMatch[1]] = Number(row.value);
    }
    return { inflation, opening };
  }

  /** The owner's own assumption about what a currency loses in a year. */
  function setInflation(currency, annualRate) {
    const code = normalizeCurrency(currency);
    const rate = Number(annualRate);
    assert(Number.isFinite(rate), "Inflation must be a number.");
    assert(rate >= 0 && rate <= 10, "Inflation must be between 0 and 10 (1 = 100% a year).");
    database
      .prepare("INSERT INTO agent4_money_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(`inflation:${code}`, String(rate), new Date().toISOString());
    return getSettings();
  }

  /**
   * Restates an amount from when it moved into what it would be worth today, so
   * two years can be compared honestly. Uses the rate the owner set; with no
   * rate, nothing is changed.
   */
  function inTodaysMoney({ amount, currency, on, today = new Date(), rates } = {}) {
    const inflation = rates || getSettings().inflation;
    const rate = inflation[normalizeCurrency(currency)];
    const value = Number(amount) || 0;
    if (!rate) return { amount: Number(value.toFixed(2)), adjusted: false, rate: 0 };
    const thenMs = Date.parse(`${normalizeDate(on, "Date")}T00:00:00Z`);
    const years = (new Date(today).getTime() - thenMs) / (365.25 * 24 * 60 * 60 * 1000);
    if (years <= 0) return { amount: Number(value.toFixed(2)), adjusted: false, rate };
    return { amount: Number((value * (1 + rate) ** years).toFixed(2)), adjusted: true, rate };
  }


  /** What the company is actually holding, and how long that lasts. */
  function cashPosition({ today = new Date(), burnMonths = 3 } = {}) {
    const settings = getSettings();
    const todayIso = localIsoDate(today);
    const byCurrency = new Map();
    const ensure = (currency) => {
      if (!byCurrency.has(currency)) {
        byCurrency.set(currency, { currency, opening: 0, in: 0, out: 0, cash: 0, burn: 0, runwayMonths: null });
      }
      return byCurrency.get(currency);
    };
    for (const [currency, amount] of Object.entries(settings.opening || {})) ensure(currency).opening = amount;

    for (const row of database
      .prepare("SELECT currency, direction, SUM(amount_minor) AS total FROM agent4_money_entries WHERE status = 'settled' AND occurred_on <= ? GROUP BY currency, direction")
      .all(todayIso)) {
      ensure(row.currency)[row.direction] = toMajor(row.total);
    }

    // Burn is measured over whole months only: a half-finished month would
    // flatter the figure and overstate how long the money lasts.
    const months = [];
    for (let step = 1; step <= Math.max(1, burnMonths); step += 1) {
      const date = new Date(today);
      months.push(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - step, 1)).toISOString().slice(0, 7));
    }
    for (const currency of byCurrency.keys()) {
      let spent = 0;
      for (const month of months) {
        const { from, to } = periodBounds(month);
        const row = database
          .prepare("SELECT SUM(amount_minor) AS total FROM agent4_money_entries WHERE currency = ? AND direction = 'out' AND status = 'settled' AND occurred_on >= ? AND occurred_on <= ?")
          .get(currency, from, to);
        spent += toMajor(row?.total || 0);
      }
      const bucket = byCurrency.get(currency);
      // Refunds can push a month's spending below zero. A negative burn is not
      // a runway, it is a month where money came back, so it is reported as it
      // stands and the runway below is left unknown rather than invented.
      bucket.burn = Number((spent / months.length).toFixed(2));
      bucket.cash = Number((bucket.opening + bucket.in - bucket.out).toFixed(2));
      bucket.in = Number(bucket.in.toFixed(2));
      bucket.out = Number(bucket.out.toFixed(2));
      bucket.runwayMonths = bucket.burn > 0 ? Number((bucket.cash / bucket.burn).toFixed(1)) : null;
    }

    return [...byCurrency.values()].sort((left, right) => right.cash - left.cash);
  }

  function setOpeningBalance(currency, amount) {
    const code = normalizeCurrency(currency);
    const value = Number(amount);
    assert(Number.isFinite(value), "Opening balance must be a number.");
    assert(value >= 0, "Opening balance cannot be negative.");
    database
      .prepare("INSERT INTO agent4_money_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(`opening:${code}`, String(value), new Date().toISOString());
    return getSettings();
  }

  /** Every date a standing cost should have been charged, up to today. */
  function dueDates(item, todayIso) {
    const start = (item.lastPostedOn || item.createdAt.slice(0, 10));
    const dates = [];
    const day = Math.min(item.dayOfMonth || 1, 28);
    const startDate = new Date(`${start}T00:00:00Z`);
    const today = new Date(`${todayIso}T00:00:00Z`);
    if (item.cadence === "yearly") {
      for (let year = startDate.getUTCFullYear(); year <= today.getUTCFullYear(); year += 1) {
        const when = new Date(Date.UTC(year, startDate.getUTCMonth(), day)).toISOString().slice(0, 10);
        if (when > start && when <= todayIso) dates.push(when);
      }
      return dates;
    }
    let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), day));
    while (cursor <= today) {
      const when = cursor.toISOString().slice(0, 10);
      if (when > start && when <= todayIso) dates.push(when);
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, day));
    }
    return dates;
  }

  /**
   * Writes the charges a standing cost has already incurred into the books, so
   * the record reflects what the bank did rather than what someone remembered
   * to type. Safe to call repeatedly: each charge is posted once.
   *
   * The company the cost belongs to is carried onto every entry posted, which
   * is the whole reason a standing cost can hold one: a monthly retainer that
   * posted unattributed never showed up against the client paying it.
   */
  function postDueRecurring({ today = new Date() } = {}) {
    const todayIso = localIsoDate(today);
    const posted = [];
    for (const item of listRecurring({ activeOnly: true })) {
      const dates = dueDates(item, todayIso);
      // Deleting a company lets go of the links pointing at it, but a standing
      // cost keeps running. Its charges still belong in the books, so a link to
      // a company that is gone is dropped rather than allowed to stop them.
      const companyId = item.companyId && companyExists(item.companyId) ? item.companyId : null;
      for (const when of dates) {
        const already = database
          .prepare("SELECT id FROM agent4_money_entries WHERE source_recurring_id = ? AND occurred_on = ?")
          .get(item.id, when);
        if (already) continue;
        const id = randomUUID();
        insertEntry.run(
          id, item.direction, Math.round(item.amount * MINOR), item.currency, item.category, "settled",
          when, null, item.counterparty, item.note || "Standing cost", "", companyId,
          new Date().toISOString(), item.createdBy
        );
        database.prepare("UPDATE agent4_money_entries SET source_recurring_id = ? WHERE id = ?").run(item.id, id);
        posted.push(entryFromRow(selectEntry.get(id)));
      }
      if (dates.length) {
        database.prepare("UPDATE agent4_money_recurring SET last_posted_on = ? WHERE id = ?").run(dates[dates.length - 1], item.id);
      }
    }
    return posted;
  }

  /**
   * One company's money, ready to put straight on its page. Currencies are kept
   * apart as everywhere else, so the shape is:
   *
   *   {
   *     companyId,
   *     today,
   *     currencies: [{ currency, in, out, net, outstanding, overdue, overdueCount, entries }],
   *     entries  // the company's most recent movements, newest first
   *   }
   *
   * `in` and `out` are settled money only and are net of any refunds against
   * them. `outstanding` is money promised and not yet received, whatever month
   * it was raised in, and `overdueCount` is how many of those promises are past
   * their due date today.
   */
  function companySummary({ companyId, today = new Date(), limit = 20 } = {}) {
    const id = normalizeText(companyId, 140);
    assert(id, "A company is required.");
    const todayIso = localIsoDate(today);
    const byCurrency = new Map();
    const ensure = (currency) => {
      if (!byCurrency.has(currency)) {
        byCurrency.set(currency, {
          currency, in: 0, out: 0, net: 0, outstanding: 0, overdue: 0, overdueCount: 0, entries: 0
        });
      }
      return byCurrency.get(currency);
    };

    for (const row of database.prepare("SELECT * FROM agent4_money_entries WHERE company_id = ?").all(id)) {
      const bucket = ensure(row.currency);
      const amount = toMajor(row.amount_minor);
      bucket.entries += 1;
      if (row.status === "settled") {
        if (row.direction === "in") bucket.in += amount;
        else bucket.out += amount;
      } else if (row.direction === "in") {
        bucket.outstanding += amount;
        if (row.due_on && row.due_on < todayIso) {
          bucket.overdue += amount;
          bucket.overdueCount += 1;
        }
      }
    }

    const currencies = [...byCurrency.values()]
      .map((bucket) => ({
        ...bucket,
        in: Number(bucket.in.toFixed(2)),
        out: Number(bucket.out.toFixed(2)),
        net: Number((bucket.in - bucket.out).toFixed(2)),
        outstanding: Number(bucket.outstanding.toFixed(2)),
        overdue: Number(bucket.overdue.toFixed(2))
      }))
      .sort((left, right) => right.in - left.in || left.currency.localeCompare(right.currency));
    return { companyId: id, today: todayIso, currencies, entries: listEntries({ companyId: id, limit }) };
  }

  /** Everything, flat, for an accountant or a tax return. */
  function exportCsv() {
    const header = ["date", "direction", "amount", "currency", "category", "status", "due", "counterparty", "note", "auto"];
    const escape = (value) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const rows = database.prepare("SELECT * FROM agent4_money_entries ORDER BY occurred_on ASC, created_at ASC").all().map((row) => [
      row.occurred_on, row.direction, toMajor(row.amount_minor), row.currency, row.category,
      row.status, row.due_on || "", row.counterparty || "", row.note || "", row.source_recurring_id ? "yes" : ""
    ].map(escape).join(","));
    return [header.join(","), ...rows].join("\n");
  }

  function close() {
    database.close();
  }

  return {
    addEntry,
    updateEntry,
    removeEntry,
    listEntries,
    summary,
    addRecurring,
    listRecurring,
    stopRecurring,
    monthlyCommitments,
    periodReport,
    periodBounds,
    series,
    getSettings,
    setInflation,
    setOpeningBalance,
    cashPosition,
    companySummary,
    postDueRecurring,
    exportCsv,
    inTodaysMoney,
    close
  };
}
