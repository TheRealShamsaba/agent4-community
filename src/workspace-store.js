import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeGitHubBranch, parseGitHubRepository } from "./github-projects.js";

const PROJECT_STATUSES = new Set(["active", "paused", "done"]);
const PROJECT_HEALTH = new Set(["on_track", "at_risk", "blocked"]);
const RESOURCE_KINDS = new Set(["link", "document", "design", "folder"]);
const SHEET_STATUSES = new Set(["open", "complete"]);
const SHEET_LIMITS = { entries: 400, key: 80, answer: 6000 };
const COMPANY_EVENT_LIMITS = { type: 40, detail: 500 };
export const COMPANY_KINDS = ["client", "prospect", "owned", "internal"];
export const COMPANY_STAGES = ["lead", "talking", "proposal", "active", "operating", "dormant", "lost"];
const COMPANY_KIND_SET = new Set(COMPANY_KINDS);
const COMPANY_STAGE_SET = new Set(COMPANY_STAGES);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * A name clash is not a failure the person can do nothing about: the record
 * they meant is already there. The error carries its id so the screen can offer
 * to open it instead of asking them to type the whole form again.
 */
function clashError(message, code, existingId) {
  const error = new Error(message);
  error.code = code;
  if (code === "company_name_taken") error.companyId = existingId;
  else error.projectId = existingId;
  return error;
}

function sheetKey(value) {
  const key = String(value ?? "").trim();
  assert(/^[\p{L}\p{N}_.:-]{1,80}$/u.test(key), "Sheet answer keys must be short identifiers.");
  return key;
}

/** Answers are a flat map of question id → text. An empty string removes the answer. */
function cleanAnswers(value, existing = {}) {
  if (value === undefined) return { ...existing };
  assert(value && typeof value === "object" && !Array.isArray(value), "Sheet answers must be an object.");
  const next = { ...existing };
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = sheetKey(rawKey);
    assert(rawValue === null || ["string", "number", "boolean"].includes(typeof rawValue), "Sheet answers must be text.");
    const answer = String(rawValue ?? "").trim().slice(0, SHEET_LIMITS.answer);
    if (answer) next[key] = answer;
    else delete next[key];
  }
  assert(Object.keys(next).length <= SHEET_LIMITS.entries, "This sheet holds too many answers.");
  return next;
}

/** Checks are a flat map of item id → true. Anything falsy removes the check. */
function cleanChecks(value, existing = {}) {
  if (value === undefined) return { ...existing };
  assert(value && typeof value === "object" && !Array.isArray(value), "Sheet checks must be an object.");
  const next = { ...existing };
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = sheetKey(rawKey);
    if (rawValue === true || rawValue === "true" || rawValue === 1) next[key] = true;
    else delete next[key];
  }
  assert(Object.keys(next).length <= SHEET_LIMITS.entries, "This sheet holds too many checks.");
  return next;
}

function parseJsonObject(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    // A sheet whose answers cannot be read still opens, rather than taking the
    // page down, but the damage is reported instead of looking like an empty
    // sheet somebody forgot to fill in.
    console.warn(`A workspace sheet's answers could not be read (${error.message}); showing it as empty.`);
    return {};
  }
}

function text(value, limit = 300) {
  return String(value ?? "").trim().slice(0, limit);
}

function optionalDate(value, label) {
  const date = text(value, 10);
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date, `${label} must be a real date.`);
  return date;
}

function safeUrl(value) {
  const raw = text(value, 1000);
  assert(raw, "A resource needs a URL.");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Use a valid http or https URL.");
  }
  assert(["http:", "https:"].includes(parsed.protocol), "Use a valid http or https URL.");
  parsed.hash = "";
  return parsed.toString();
}

function companyFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    website: row.website || "",
    summary: row.summary || "",
    kind: COMPANY_KIND_SET.has(row.kind) ? row.kind : "client",
    stage: COMPANY_STAGE_SET.has(row.stage) ? row.stage : "lead",
    contactName: row.contact_name || "",
    contactRole: row.contact_role || "",
    contactPhone: row.contact_phone || "",
    contactTelegram: row.contact_telegram || "",
    contactEmail: row.contact_email || "",
    howMet: row.how_met || "",
    nextAction: row.next_action || "",
    nextActionOn: row.next_action_on || null,
    dealValue: Number.isSafeInteger(row.deal_value) && row.deal_value > 0 ? row.deal_value : null,
    dealCurrency: row.deal_currency || "",
    hidden: row.hidden === 1,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at || null
  };
}

/* What a deal is worth, in whole units of its own currency. Estimates do not
   need cents, and a currency is never guessed: a value with no currency is
   refused, because a rial and a euro added together is a number that lies. */
function dealFields(value, currency, existing = {}) {
  const hasValue = value !== undefined;
  const hasCurrency = currency !== undefined;
  let dealValue = existing.deal_value ?? null;
  let dealCurrency = existing.deal_currency || "";
  if (hasValue) {
    if (value === null || value === "") dealValue = null;
    else {
      const number = Number(value);
      assert(Number.isSafeInteger(number) && number >= 0, "A deal value is a whole number, zero or more.");
      dealValue = number === 0 ? null : number;
    }
  }
  if (hasCurrency) {
    const code = text(currency, 20).toUpperCase();
    assert(code === "" || /^[A-Z]{3}$/.test(code), "Currency must be a three-letter code, such as IRR, USD or EUR.");
    dealCurrency = code;
  }
  if (dealValue === null) dealCurrency = hasCurrency ? dealCurrency : "";
  else assert(dealCurrency, "Say which currency the deal is in.");
  return { dealValue, dealCurrency };
}

function telegramHandle(value) {
  const raw = text(value, 120).replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "").replace(/^@/, "");
  return raw ? `@${raw}` : "";
}

function emailAddress(value) {
  const raw = text(value, 200);
  if (!raw) return "";
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw), "Use a valid email address.");
  return raw;
}

function projectFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    name: row.name,
    summary: row.summary || "",
    status: row.status,
    goal: row.goal || "",
    definitionOfDone: row.definition_of_done || "",
    ownerId: row.owner_id || null,
    ownerName: row.owner_name || "",
    dueOn: row.due_on || null,
    health: row.health || "on_track",
    milestone: row.milestone || "",
    milestoneDueOn: row.milestone_due_on || null,
    repositoryUrl: row.repository_url || "",
    repositoryBranch: row.repository_branch || "",
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at || null
  };
}

function decisionFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    companyId: row.company_id,
    text: row.summary,
    source: row.source || "manual",
    sourceRef: row.source_ref || null,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

function resourceFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    companyId: row.company_id,
    label: row.label,
    url: row.url,
    kind: row.kind,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

function sheetFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    projectId: row.project_id || null,
    templateId: row.template_id,
    title: row.title,
    status: row.status || "open",
    answers: parseJsonObject(row.answers),
    checks: parseJsonObject(row.checks),
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null
  };
}

function companyEventFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    type: row.type,
    detail: row.detail,
    at: row.created_at,
    createdBy: row.created_by
  };
}

/**
 * Durable homes for team-created companies and projects. Pipeline prospects and
 * Film Room clients are merged into these records by the UI, so neither system
 * has to duplicate its source of truth just to appear in a workspace.
 */
export function createWorkspaceStore(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_workspace_companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      website TEXT,
      summary TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workspace_company_name
      ON agent4_workspace_companies(name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS agent4_workspace_projects (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL,
      goal TEXT,
      definition_of_done TEXT,
      owner_id TEXT,
      owner_name TEXT,
      due_on TEXT,
      health TEXT,
      milestone TEXT,
      milestone_due_on TEXT,
      repository_url TEXT,
      repository_branch TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT,
      UNIQUE(company_id, name COLLATE NOCASE)
    );
    CREATE INDEX IF NOT EXISTS workspace_projects_company
      ON agent4_workspace_projects(company_id, status, updated_at);
    CREATE TABLE IF NOT EXISTS agent4_workspace_decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_decisions_project
      ON agent4_workspace_decisions(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS agent4_workspace_resources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_resources_project
      ON agent4_workspace_resources(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS agent4_workspace_sheets (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      project_id TEXT,
      template_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      answers TEXT NOT NULL,
      checks TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT,
      updated_by TEXT
    );
    CREATE INDEX IF NOT EXISTS workspace_sheets_company
      ON agent4_workspace_sheets(company_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS agent4_workspace_company_events (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      type TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_company_events_company
      ON agent4_workspace_company_events(company_id, created_at DESC);
  `);
  const companyColumns = new Set(database.prepare("PRAGMA table_info(agent4_workspace_companies)").all().map((column) => column.name));
  for (const [column, definition] of [
    ["kind", "TEXT"],
    ["stage", "TEXT"],
    ["contact_name", "TEXT"],
    ["contact_role", "TEXT"],
    ["contact_phone", "TEXT"],
    ["contact_telegram", "TEXT"],
    ["contact_email", "TEXT"],
    ["how_met", "TEXT"],
    ["next_action", "TEXT"],
    ["next_action_on", "TEXT"],
    ["deal_value", "INTEGER"],
    ["deal_currency", "TEXT"],
    ["hidden", "INTEGER NOT NULL DEFAULT 0"]
  ]) {
    if (!companyColumns.has(column)) database.exec(`ALTER TABLE agent4_workspace_companies ADD COLUMN ${column} ${definition}`);
  }
  database.exec("UPDATE agent4_workspace_companies SET kind='client' WHERE kind IS NULL OR kind=''");
  database.exec("UPDATE agent4_workspace_companies SET stage='lead' WHERE stage IS NULL OR stage=''");
  const projectColumns = new Set(database.prepare("PRAGMA table_info(agent4_workspace_projects)").all().map((column) => column.name));
  for (const [column, definition] of [
    ["goal", "TEXT"],
    ["definition_of_done", "TEXT"],
    ["owner_id", "TEXT"],
    ["owner_name", "TEXT"],
    ["due_on", "TEXT"],
    ["health", "TEXT"],
    ["milestone", "TEXT"],
    ["milestone_due_on", "TEXT"],
    ["repository_url", "TEXT"],
    ["repository_branch", "TEXT"]
  ]) {
    if (!projectColumns.has(column)) database.exec(`ALTER TABLE agent4_workspace_projects ADD COLUMN ${column} ${definition}`);
  }
  database.exec("UPDATE agent4_workspace_projects SET health='on_track' WHERE health IS NULL OR health=''");

  const selectCompany = database.prepare("SELECT * FROM agent4_workspace_companies WHERE id = ?");
  const selectProject = database.prepare("SELECT * FROM agent4_workspace_projects WHERE id = ?");

  function repositoryUrl(value) {
    const raw = text(value, 500);
    return raw ? parseGitHubRepository(raw).url : "";
  }

  /**
   * Get-or-create, for the paths that import a company that may already be on
   * file: a pipeline dossier, a Film Room client, a project or sheet naming its
   * owner. Those callers mean "make sure this company exists". A person filling
   * in the new-company form means something else entirely, and goes through
   * createCompany, which refuses to swallow what they typed.
   */
  function ensureCompany(input = {}, { getOrCreate = true } = {}) {
    const id = text(input.id, 140) || randomUUID();
    const name = text(input.name, 180);
    assert(name, "A company needs a name.");
    const existing = selectCompany.get(id);
    if (existing) {
      if (getOrCreate) return companyFrom(existing);
      throw clashError("A company with that id already exists.", "company_name_taken", existing.id);
    }
    const named = database.prepare("SELECT * FROM agent4_workspace_companies WHERE name = ? COLLATE NOCASE").get(name);
    if (named) {
      if (getOrCreate) return companyFrom(named);
      throw clashError("Another company already uses that name.", "company_name_taken", named.id);
    }
    const kind = text(input.kind, 20) || "client";
    assert(COMPANY_KIND_SET.has(kind), "Company kind must be client, prospect, owned or internal.");
    const stage = text(input.stage, 20) || "lead";
    assert(COMPANY_STAGE_SET.has(stage), "Company stage is not one of the known stages.");
    const deal = dealFields(input.dealValue, input.dealCurrency);
    database.prepare(`
      INSERT INTO agent4_workspace_companies
        (id,name,website,summary,kind,stage,contact_name,contact_role,contact_phone,contact_telegram,contact_email,how_met,next_action,next_action_on,deal_value,deal_currency,hidden,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      name,
      text(input.website, 500),
      text(input.summary, 2000),
      kind,
      stage,
      text(input.contactName, 180),
      text(input.contactRole, 180),
      text(input.contactPhone, 60),
      telegramHandle(input.contactTelegram),
      emailAddress(input.contactEmail),
      text(input.howMet, 1000),
      text(input.nextAction, 500),
      optionalDate(input.nextActionOn, "Next action date"),
      deal.dealValue,
      deal.dealCurrency,
      input.hidden === true ? 1 : 0,
      new Date().toISOString(),
      text(input.actorId, 140) || "unknown"
    );
    return companyFrom(selectCompany.get(id));
  }

  /** Relationship fields the team maintains by hand. Unset keys keep their current value. */
  function updateCompany(id, updates = {}) {
    const existing = selectCompany.get(text(id, 140));
    assert(existing, "That company no longer exists.");
    const pick = (key, column, limit) => (updates[key] === undefined ? existing[column] || "" : text(updates[key], limit));
    const next = {
      name: pick("name", "name", 180),
      website: pick("website", "website", 500),
      summary: pick("summary", "summary", 2000),
      kind: updates.kind === undefined ? existing.kind || "client" : text(updates.kind, 20),
      stage: updates.stage === undefined ? existing.stage || "lead" : text(updates.stage, 20),
      contactName: pick("contactName", "contact_name", 180),
      contactRole: pick("contactRole", "contact_role", 180),
      contactPhone: pick("contactPhone", "contact_phone", 60),
      contactTelegram: updates.contactTelegram === undefined ? existing.contact_telegram || "" : telegramHandle(updates.contactTelegram),
      contactEmail: updates.contactEmail === undefined ? existing.contact_email || "" : emailAddress(updates.contactEmail),
      howMet: pick("howMet", "how_met", 1000),
      nextAction: pick("nextAction", "next_action", 500),
      nextActionOn: updates.nextActionOn === undefined ? existing.next_action_on : optionalDate(updates.nextActionOn, "Next action date"),
      hidden: updates.hidden === undefined ? existing.hidden === 1 : updates.hidden === true,
      ...dealFields(updates.dealValue, updates.dealCurrency, existing)
    };
    assert(next.name, "A company needs a name.");
    assert(COMPANY_KIND_SET.has(next.kind), "Company kind must be client, prospect, owned or internal.");
    assert(COMPANY_STAGE_SET.has(next.stage), "Company stage is not one of the known stages.");
    if (next.name.toLocaleLowerCase() !== String(existing.name).toLocaleLowerCase()) {
      const clash = database.prepare("SELECT id FROM agent4_workspace_companies WHERE name = ? COLLATE NOCASE AND id <> ?").get(next.name, existing.id);
      if (clash) throw clashError("Another company already uses that name.", "company_name_taken", clash.id);
    }
    database.prepare(`
      UPDATE agent4_workspace_companies
      SET name=?,website=?,summary=?,kind=?,stage=?,contact_name=?,contact_role=?,contact_phone=?,contact_telegram=?,contact_email=?,how_met=?,next_action=?,next_action_on=?,deal_value=?,deal_currency=?,hidden=?,updated_at=?
      WHERE id=?
    `).run(next.name, next.website, next.summary, next.kind, next.stage, next.contactName, next.contactRole, next.contactPhone, next.contactTelegram, next.contactEmail, next.howMet, next.nextAction, next.nextActionOn, next.dealValue, next.dealCurrency, next.hidden ? 1 : 0, new Date().toISOString(), existing.id);
    if (next.name !== existing.name) {
      database.prepare("UPDATE agent4_workspace_projects SET company_name=? WHERE company_id=?").run(next.name, existing.id);
      database.prepare("UPDATE agent4_workspace_sheets SET company_name=? WHERE company_id=?").run(next.name, existing.id);
    }
    return companyFrom(selectCompany.get(existing.id));
  }

  /**
   * A company Next box and a linked board task used to be two independent
   * copies of the same commitment. Close the saved copy when that exact task
   * is finished, so Home, Companies and Tasks all tell the same story.
   */
  function completeNextActionForTask(task = {}) {
    const companyId = text(task.companyId, 140);
    const companyName = text(task.companyName, 180);
    const title = text(task.title, 500);
    if ((!companyId && !companyName) || !title) return null;
    const existing = companyId
      ? selectCompany.get(companyId)
      : database.prepare("SELECT * FROM agent4_workspace_companies WHERE name = ? COLLATE NOCASE").get(companyName);
    if (!existing) return null;
    const sameCommitment = String(existing.next_action || "").trim().toLocaleLowerCase() === title.toLocaleLowerCase();
    if (!sameCommitment) return null;
    database.prepare(`
      UPDATE agent4_workspace_companies
      SET next_action='', next_action_on=NULL, updated_at=?
      WHERE id=?
    `).run(new Date().toISOString(), existing.id);
    return companyFrom(selectCompany.get(existing.id));
  }

  function createProject(input = {}) {
    const company = ensureCompany({
      id: input.companyId,
      name: input.companyName,
      website: input.companyWebsite,
      actorId: input.actorId
    });
    const name = text(input.name, 180);
    assert(name, "A project needs a name.");
    const duplicate = database.prepare(`
      SELECT * FROM agent4_workspace_projects WHERE company_id = ? AND name = ? COLLATE NOCASE
    `).get(company.id, name);
    // Returning the untouched row read as success, so every field the person
    // had just typed was thrown away without a word.
    if (duplicate) throw clashError("This company already has a project with that name.", "project_name_taken", duplicate.id);
    const status = text(input.status) || "active";
    assert(PROJECT_STATUSES.has(status), "Project status must be active, paused or done.");
    const health = text(input.health) || "on_track";
    assert(PROJECT_HEALTH.has(health), "Project health must be on track, at risk or blocked.");
    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_workspace_projects
        (id,company_id,company_name,name,summary,status,goal,definition_of_done,owner_id,owner_name,due_on,health,milestone,milestone_due_on,repository_url,repository_branch,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      company.id,
      company.name,
      name,
      text(input.summary, 2000),
      status,
      text(input.goal, 3000),
      text(input.definitionOfDone, 3000),
      text(input.ownerId, 140) || null,
      text(input.ownerName, 180),
      optionalDate(input.dueOn, "Project deadline"),
      health,
      text(input.milestone, 1000),
      optionalDate(input.milestoneDueOn, "Milestone deadline"),
      repositoryUrl(input.repositoryUrl),
      normalizeGitHubBranch(input.repositoryBranch),
      new Date().toISOString(),
      text(input.actorId, 140) || "unknown"
    );
    return { project: projectFrom(selectProject.get(id)), created: true };
  }

  function updateProject(id, updates = {}) {
    const existing = selectProject.get(text(id, 140));
    assert(existing, "That project no longer exists.");
    const next = {
      name: updates.name === undefined ? existing.name : text(updates.name, 180),
      summary: updates.summary === undefined ? existing.summary : text(updates.summary, 2000),
      status: updates.status === undefined ? existing.status : text(updates.status),
      goal: updates.goal === undefined ? existing.goal : text(updates.goal, 3000),
      definitionOfDone: updates.definitionOfDone === undefined ? existing.definition_of_done : text(updates.definitionOfDone, 3000),
      ownerId: updates.ownerId === undefined ? existing.owner_id : text(updates.ownerId, 140) || null,
      ownerName: updates.ownerName === undefined ? existing.owner_name : text(updates.ownerName, 180),
      dueOn: updates.dueOn === undefined ? existing.due_on : optionalDate(updates.dueOn, "Project deadline"),
      health: updates.health === undefined ? existing.health || "on_track" : text(updates.health),
      milestone: updates.milestone === undefined ? existing.milestone : text(updates.milestone, 1000),
      milestoneDueOn: updates.milestoneDueOn === undefined ? existing.milestone_due_on : optionalDate(updates.milestoneDueOn, "Milestone deadline"),
      repositoryUrl: updates.repositoryUrl === undefined ? existing.repository_url : repositoryUrl(updates.repositoryUrl),
      repositoryBranch: updates.repositoryBranch === undefined ? existing.repository_branch : normalizeGitHubBranch(updates.repositoryBranch)
    };
    assert(next.name, "A project needs a name.");
    assert(PROJECT_STATUSES.has(next.status), "Project status must be active, paused or done.");
    assert(PROJECT_HEALTH.has(next.health), "Project health must be on track, at risk or blocked.");
    database.prepare(`
      UPDATE agent4_workspace_projects
      SET name=?,summary=?,status=?,goal=?,definition_of_done=?,owner_id=?,owner_name=?,due_on=?,health=?,milestone=?,milestone_due_on=?,repository_url=?,repository_branch=?,updated_at=?
      WHERE id=?
    `).run(next.name, next.summary, next.status, next.goal, next.definitionOfDone, next.ownerId, next.ownerName, next.dueOn, next.health, next.milestone, next.milestoneDueOn, next.repositoryUrl, next.repositoryBranch, new Date().toISOString(), existing.id);
    return projectFrom(selectProject.get(existing.id));
  }

  function addDecision(input = {}) {
    const project = selectProject.get(text(input.projectId, 140));
    assert(project, "That project no longer exists.");
    const summary = text(input.text, 2000);
    assert(summary, "Write the decision first.");
    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_workspace_decisions (id,project_id,company_id,summary,source,source_ref,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, project.id, project.company_id, summary, text(input.source, 40) || "manual", text(input.sourceRef, 140) || null, new Date().toISOString(), text(input.actorId, 140) || "unknown");
    return decisionFrom(database.prepare("SELECT * FROM agent4_workspace_decisions WHERE id=?").get(id));
  }

  function removeDecision(id) {
    return database.prepare("DELETE FROM agent4_workspace_decisions WHERE id=?").run(text(id, 140)).changes > 0;
  }

  function addResource(input = {}) {
    const project = selectProject.get(text(input.projectId, 140));
    assert(project, "That project no longer exists.");
    const label = text(input.label, 240);
    assert(label, "Give the resource a label.");
    const kind = text(input.kind, 40) || "link";
    assert(RESOURCE_KINDS.has(kind), "Choose a valid resource type.");
    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_workspace_resources (id,project_id,company_id,label,url,kind,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, project.id, project.company_id, label, safeUrl(input.url), kind, new Date().toISOString(), text(input.actorId, 140) || "unknown");
    return resourceFrom(database.prepare("SELECT * FROM agent4_workspace_resources WHERE id=?").get(id));
  }

  function removeResource(id) {
    return database.prepare("DELETE FROM agent4_workspace_resources WHERE id=?").run(text(id, 140)).changes > 0;
  }

  /**
   * A decision belongs to a project, but a relationship moves between projects
   * and between stages, and until now nothing wrote that down: the history on a
   * company page could only ever repeat what the pipeline dossier already said.
   * An event is one dated sentence about the company itself, so a question like
   * "how long has this been in Proposal?" has somewhere to be answered from.
   *
   * The type is a short slug the screen chooses its own wording from, kept open
   * so a new kind of moment does not need a migration, and bounded so it stays
   * something a person could read in a filter.
   */
  function addCompanyEvent(input = {}) {
    const company = selectCompany.get(text(input.companyId, 140));
    assert(company, "That company no longer exists.");
    const type = text(input.type, COMPANY_EVENT_LIMITS.type).toLocaleLowerCase() || "note";
    assert(/^[a-z0-9][a-z0-9-]*$/.test(type), "An event type is a short slug like stage, note, meeting or money.");
    const detail = text(input.detail, COMPANY_EVENT_LIMITS.detail);
    assert(detail, "Write what happened first.");
    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_workspace_company_events (id,company_id,type,detail,created_at,created_by)
      VALUES (?,?,?,?,?,?)
    `).run(id, company.id, type, detail, new Date().toISOString(), text(input.actorId, 140) || "unknown");
    return companyEventFrom(database.prepare("SELECT * FROM agent4_workspace_company_events WHERE id=?").get(id));
  }

  function removeCompanyEvent(id) {
    return database.prepare("DELETE FROM agent4_workspace_company_events WHERE id=?").run(text(id, 140)).changes > 0;
  }

  const selectSheet = database.prepare("SELECT * FROM agent4_workspace_sheets WHERE id = ?");

  function sheetProject(companyId, projectId) {
    const id = text(projectId, 140);
    if (!id) return null;
    const project = selectProject.get(id);
    assert(project, "That project no longer exists.");
    assert(project.company_id === companyId, "That project belongs to a different company.");
    return project;
  }

  /**
   * A sheet is a filled-in template (a discovery questionnaire, a kickoff
   * checklist) that belongs to a company and optionally to one of its projects.
   * The template itself lives in the HQ client; the store keeps the answers.
   */
  function createSheet(input = {}) {
    const company = ensureCompany({
      id: input.companyId,
      name: input.companyName,
      website: input.companyWebsite,
      actorId: input.actorId
    });
    const templateId = text(input.templateId, 80);
    assert(/^[a-z0-9][a-z0-9-]{1,79}$/.test(templateId), "Choose a sheet template.");
    const title = text(input.title, 180);
    assert(title, "Give the sheet a title.");
    const project = sheetProject(company.id, input.projectId);
    const now = new Date().toISOString();
    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_workspace_sheets
        (id,company_id,company_name,project_id,template_id,title,status,answers,checks,created_at,created_by,updated_at,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      company.id,
      company.name,
      project ? project.id : null,
      templateId,
      title,
      "open",
      JSON.stringify(cleanAnswers(input.answers)),
      JSON.stringify(cleanChecks(input.checks)),
      now,
      text(input.actorId, 140) || "unknown",
      now,
      text(input.actorId, 140) || "unknown"
    );
    return sheetFrom(selectSheet.get(id));
  }

  /** Answers and checks merge key by key so two devices editing different questions never overwrite each other. */
  function updateSheet(id, updates = {}) {
    const existing = selectSheet.get(text(id, 140));
    assert(existing, "That sheet no longer exists.");
    const title = updates.title === undefined ? existing.title : text(updates.title, 180);
    assert(title, "Give the sheet a title.");
    const status = updates.status === undefined ? existing.status : text(updates.status, 20);
    assert(SHEET_STATUSES.has(status), "Sheet status must be open or complete.");
    let projectId = existing.project_id;
    if (updates.projectId !== undefined) {
      const project = sheetProject(existing.company_id, updates.projectId);
      projectId = project ? project.id : null;
    }
    const answers = cleanAnswers(updates.answers, parseJsonObject(existing.answers));
    const checks = cleanChecks(updates.checks, parseJsonObject(existing.checks));
    database.prepare(`
      UPDATE agent4_workspace_sheets
      SET title=?,status=?,project_id=?,answers=?,checks=?,updated_at=?,updated_by=?
      WHERE id=?
    `).run(title, status, projectId, JSON.stringify(answers), JSON.stringify(checks), new Date().toISOString(), text(updates.actorId, 140) || existing.updated_by || existing.created_by, existing.id);
    return sheetFrom(selectSheet.get(existing.id));
  }

  function removeSheet(id) {
    return database.prepare("DELETE FROM agent4_workspace_sheets WHERE id=?").run(text(id, 140)).changes > 0;
  }

  function tableExists(name) {
    return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  }

  /** The other stores share this database file, but not always this version of it. */
  function hasColumn(table, column) {
    if (!tableExists(table)) return false;
    return database.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  }

  function countRows(sql, ...values) {
    return database.prepare(sql).get(...values).total;
  }

  /** Everything that would go or be let loose, so the screen can warn before anyone agrees. */
  function companyAttachments(companyId) {
    return {
      projects: countRows("SELECT COUNT(*) AS total FROM agent4_workspace_projects WHERE company_id = ?", companyId),
      sheets: countRows("SELECT COUNT(*) AS total FROM agent4_workspace_sheets WHERE company_id = ?", companyId),
      decisions: countRows("SELECT COUNT(*) AS total FROM agent4_workspace_decisions WHERE company_id = ?", companyId),
      resources: countRows("SELECT COUNT(*) AS total FROM agent4_workspace_resources WHERE company_id = ?", companyId),
      events: countRows("SELECT COUNT(*) AS total FROM agent4_workspace_company_events WHERE company_id = ?", companyId),
      meetings: hasColumn("agent4_meetings", "client_id")
        ? countRows("SELECT COUNT(*) AS total FROM agent4_meetings WHERE client_id = ?", companyId)
        : 0,
      // Tasks are let loose rather than deleted, but the confirm dialog has
      // always had a line for them and was being handed nothing to put in it.
      tasks: hasColumn("agent4_tasks", "company_id")
        ? countRows("SELECT COUNT(*) AS total FROM agent4_tasks WHERE company_id = ?", companyId)
        : 0,
      // Paperwork is let loose rather than deleted, but the count still belongs
      // in the warning: a person deleting a company should see that the signed
      // proposal it holds is about to stop pointing anywhere.
      paperwork: hasColumn("agent4_paperwork", "company_id")
        ? countRows("SELECT COUNT(*) AS total FROM agent4_paperwork WHERE company_id = ?", companyId)
        : 0
    };
  }

  function projectAttachments(projectId) {
    return {
      decisions: countRows("SELECT COUNT(*) AS total FROM agent4_workspace_decisions WHERE project_id = ?", projectId),
      resources: countRows("SELECT COUNT(*) AS total FROM agent4_workspace_resources WHERE project_id = ?", projectId),
      sheets: countRows("SELECT COUNT(*) AS total FROM agent4_workspace_sheets WHERE project_id = ?", projectId),
      tasks: hasColumn("agent4_tasks", "project_id")
        ? countRows("SELECT COUNT(*) AS total FROM agent4_tasks WHERE project_id = ?", projectId)
        : 0
    };
  }

  /** Records that are somebody's own work let go of the company rather than going with it. */
  function unlinkCompany(companyId) {
    if (hasColumn("agent4_meetings", "client_id")) {
      database.prepare("UPDATE agent4_meetings SET client_id = NULL WHERE client_id = ?").run(companyId);
    }
    if (hasColumn("agent4_tasks", "company_id")) {
      database.prepare("UPDATE agent4_tasks SET company_id = NULL, project_id = NULL WHERE company_id = ?").run(companyId);
    }
    if (hasColumn("agent4_money_entries", "company_id")) {
      database.prepare("UPDATE agent4_money_entries SET company_id = NULL WHERE company_id = ?").run(companyId);
    }
    if (hasColumn("agent4_invoices", "company_id")) {
      database.prepare("UPDATE agent4_invoices SET company_id = NULL WHERE company_id = ?").run(companyId);
    }
    // A document keeps the company's name as free text beside the id, so a
    // signed proposal still reads properly once the CRM row it was filed under
    // is gone. Only the link is dropped.
    if (hasColumn("agent4_paperwork", "company_id")) {
      database.prepare("UPDATE agent4_paperwork SET company_id = NULL WHERE company_id = ?").run(companyId);
    }
  }

  /**
   * A mistyped company could previously only be hidden, never removed. Deleting
   * one takes the records that exist only because of it — its projects, sheets,
   * decisions, resources and history — and lets go of the ones that are
   * somebody's own work: a meeting, a task, a money entry, an invoice or a
 * document keeps its row
   * and simply stops pointing at a company that is gone. Either way nothing is
   * left pointing at a row that no longer exists.
   *
   * Without confirm nothing is touched and the counts come back on their own,
   * so deletion is always something the person agreed to with the list in view.
   */
  function removeCompany(id, { confirm = false } = {}) {
    const existing = selectCompany.get(text(id, 140));
    assert(existing, "That company no longer exists.");
    const company = companyFrom(existing);
    const attached = companyAttachments(existing.id);
    if (!confirm) return { removed: false, company, attached };
    database.prepare("DELETE FROM agent4_workspace_company_events WHERE company_id = ?").run(existing.id);
    database.prepare("DELETE FROM agent4_workspace_decisions WHERE company_id = ?").run(existing.id);
    database.prepare("DELETE FROM agent4_workspace_resources WHERE company_id = ?").run(existing.id);
    database.prepare("DELETE FROM agent4_workspace_sheets WHERE company_id = ?").run(existing.id);
    database.prepare("DELETE FROM agent4_workspace_projects WHERE company_id = ?").run(existing.id);
    unlinkCompany(existing.id);
    database.prepare("DELETE FROM agent4_workspace_companies WHERE id = ?").run(existing.id);
    return { removed: true, company, attached };
  }

  function removeProject(id, { confirm = false } = {}) {
    const existing = selectProject.get(text(id, 140));
    assert(existing, "That project no longer exists.");
    const project = projectFrom(existing);
    const attached = projectAttachments(existing.id);
    if (!confirm) return { removed: false, project, attached };
    database.prepare("DELETE FROM agent4_workspace_decisions WHERE project_id = ?").run(existing.id);
    database.prepare("DELETE FROM agent4_workspace_resources WHERE project_id = ?").run(existing.id);
    // A sheet was filled in for the company, not only for the project, so it
    // keeps its answers and only loses the project it was filed under.
    database.prepare("UPDATE agent4_workspace_sheets SET project_id = NULL WHERE project_id = ?").run(existing.id);
    if (hasColumn("agent4_tasks", "project_id")) {
      database.prepare("UPDATE agent4_tasks SET project_id = NULL WHERE project_id = ?").run(existing.id);
    }
    database.prepare("DELETE FROM agent4_workspace_projects WHERE id = ?").run(existing.id);
    return { removed: true, project, attached };
  }

  /**
   * The history rides along on the company rather than arriving as its own
   * list: the page merges it with the pipeline dossier's timeline into one
   * story, and a second request would let the two halves land at different
   * moments and redraw the section twice.
   */
  function list() {
    const timelines = new Map();
    // Two events written in the same millisecond share a timestamp, so the row
    // order breaks the tie and the later one still reads as the later one.
    for (const row of database.prepare("SELECT * FROM agent4_workspace_company_events ORDER BY created_at DESC, rowid DESC").all()) {
      const event = companyEventFrom(row);
      const existing = timelines.get(event.companyId);
      if (existing) existing.push(event);
      else timelines.set(event.companyId, [event]);
    }
    return {
      companies: database.prepare("SELECT * FROM agent4_workspace_companies ORDER BY name COLLATE NOCASE").all()
        .map((row) => ({ ...companyFrom(row), timeline: timelines.get(row.id) || [] })),
      projects: database.prepare(`
        SELECT * FROM agent4_workspace_projects
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC, created_at DESC
      `).all().map(projectFrom),
      decisions: database.prepare("SELECT * FROM agent4_workspace_decisions ORDER BY created_at DESC").all().map(decisionFrom),
      resources: database.prepare("SELECT * FROM agent4_workspace_resources ORDER BY created_at DESC").all().map(resourceFrom),
      sheets: database.prepare(`
        SELECT * FROM agent4_workspace_sheets
        ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, updated_at DESC, created_at DESC
      `).all().map(sheetFrom)
    };
  }

  return {
    ensureCompany,
    /** The new-company form: a name already on file is a clash, not a quiet no-op. */
    createCompany(input = {}) { return ensureCompany(input, { getOrCreate: false }); },
    getCompany(id) { return companyFrom(selectCompany.get(text(id, 140))); },
    updateCompany,
    completeNextActionForTask,
    removeCompany,
    createProject,
    getProject(id) { return projectFrom(selectProject.get(text(id, 140))); },
    /** One company's projects, without reading the whole CRM. Used by every client page view. */
    projectsFor(companyId) {
      return database.prepare("SELECT * FROM agent4_workspace_projects WHERE company_id = ?").all(text(companyId, 140)).map(projectFrom);
    },
    updateProject,
    removeProject,
    addDecision,
    removeDecision,
    addResource,
    removeResource,
    addCompanyEvent,
    removeCompanyEvent,
    createSheet,
    getSheet(id) { return sheetFrom(selectSheet.get(text(id, 140))); },
    updateSheet,
    removeSheet,
    list,
    close() { database.close(); }
  };
}
