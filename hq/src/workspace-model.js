import { daysUntil, isOverdue, localIsoDate } from "./format.js";

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function slug(value) {
  return normalized(value).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 80) || "workspace";
}

function companyKey(id, name) {
  return String(id || "").trim() || `name:${normalized(name)}`;
}

function projectKey(companyId, id, name) {
  return String(id || "").trim() || `derived:${companyId}:${slug(name)}`;
}

function addUnique(list, item) {
  if (!list.some((current) => current.id === item.id)) list.push(item);
}

/** Merge every place company work already exists into one navigable model. */
export function buildWorkspaceModel({ dossiers = [], stored = {}, tasks = [], memories = [], roomObjects = [], today = localIsoDate() } = {}) {
  const companies = new Map();
  const aliases = new Map();
  const ensureCompany = ({ id, name, ...fields }) => {
    const cleanName = String(name || "").trim();
    if (!cleanName) return null;
    const key = companyKey(id, cleanName);
    const aliasKey = normalized(cleanName);
    const existingKey = companies.has(key) ? key : aliases.get(aliasKey);
    const resolvedKey = existingKey || key;
    const current = companies.get(resolvedKey) || {
      id: resolvedKey,
      name: cleanName,
      domain: "",
      url: "",
      summary: "",
      pipelineStage: null,
      score: null,
      source: "workspace",
      kind: "",
      stage: "",
      stored: false,
      hidden: false,
      contactName: "",
      contactRole: "",
      contactPhone: "",
      contactTelegram: "",
      contactEmail: "",
      howMet: "",
      nextAction: "",
      nextActionOn: null,
      dealValue: null,
      dealCurrency: "",
      findings: [],
      projects: [],
      tasks: [],
      meetings: [],
      roomItems: [],
      sheets: [],
      timeline: []
    };
    const next = { ...current, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== "")), id: resolvedKey, name: current.name || cleanName };
    companies.set(resolvedKey, next);
    aliases.set(aliasKey, resolvedKey);
    if (id) aliases.set(String(id), resolvedKey);
    return next;
  };

  for (const dossier of dossiers) {
    const company = ensureCompany({
      id: dossier.id,
      name: dossier.name,
      domain: dossier.domain,
      url: dossier.url,
      summary: dossier.offer || dossier.nextStep || "",
      pipelineStage: dossier.stage,
      score: dossier.score,
      source: "pipeline",
      findings: dossier.findings || []
    });
    if (company) company.timeline.push(...(dossier.timeline || []).map((item, index) => ({ ...item, id: `pipeline:${dossier.id}:${index}` })));
  }

  const pipelineIds = new Set((dossiers || []).map((dossier) => String(dossier.id || "")));
  for (const storedCompany of stored.companies || []) {
    const company = ensureCompany({
      id: storedCompany.id,
      name: storedCompany.name,
      url: storedCompany.website,
      summary: storedCompany.summary,
      kind: storedCompany.kind,
      stage: storedCompany.stage,
      contactName: storedCompany.contactName,
      contactRole: storedCompany.contactRole,
      contactPhone: storedCompany.contactPhone,
      contactTelegram: storedCompany.contactTelegram,
      contactEmail: storedCompany.contactEmail,
      howMet: storedCompany.howMet,
      nextAction: storedCompany.nextAction,
      nextActionOn: storedCompany.nextActionOn,
      dealValue: storedCompany.dealValue,
      dealCurrency: storedCompany.dealCurrency,
      source: "workspace"
    });
    if (company) {
      company.stored = true;
      company.storedId = storedCompany.id;
      company.hidden = Boolean(storedCompany.hidden);
      company.updatedAt = storedCompany.updatedAt || storedCompany.createdAt || null;
      // The server keeps a company's own history — stage changes and notes
      // written here rather than imported from the pipeline. It arrives on the
      // stored record, so it has to be merged in alongside the dossier's.
      company.timeline.push(...(storedCompany.timeline || []));
    }
  }

  for (const memory of memories) {
    const company = ensureCompany({ id: memory.clientId, name: memory.clientName, summary: memory.latestSummary, source: "film" });
    if (!company) continue;
    for (const meeting of memory.meetings || []) addUnique(company.meetings, meeting);
  }

  const projectById = new Map();
  const ensureProject = (company, project = {}) => {
    const name = String(project.name || project.projectName || "").trim();
    if (!company || !name) return null;
    const id = projectKey(company.id, project.id || project.projectId, name);
    let existing = company.projects.find((item) => item.id === id || normalized(item.name) === normalized(name));
    if (!existing) {
      existing = { id, companyId: company.id, companyName: company.name, name, summary: "", status: "active", health: "on_track", derived: !project.id, tasks: [], meetings: [], roomItems: [], decisions: [], resources: [], sheets: [] };
      company.projects.push(existing);
    }
    Object.assign(existing, Object.fromEntries(Object.entries(project).filter(([, value]) => value !== undefined && value !== null && value !== "")), { id: existing.id, companyId: company.id, companyName: company.name, name: existing.name || name });
    projectById.set(existing.id, existing);
    if (project.id) projectById.set(project.id, existing);
    return existing;
  };

  for (const project of stored.projects || []) {
    const company = ensureCompany({ id: project.companyId, name: project.companyName, source: "workspace" });
    ensureProject(company, project);
  }
  for (const decision of stored.decisions || []) {
    const project = projectById.get(decision.projectId);
    if (project) addUnique(project.decisions, decision);
  }
  for (const resource of stored.resources || []) {
    const project = projectById.get(resource.projectId);
    if (project) addUnique(project.resources, resource);
  }
  for (const sheet of stored.sheets || []) {
    const company = ensureCompany({ id: sheet.companyId, name: sheet.companyName, source: "workspace" });
    if (!company) continue;
    addUnique(company.sheets, sheet);
    const project = sheet.projectId ? projectById.get(sheet.projectId) : null;
    if (project) addUnique(project.sheets, sheet);
  }
  for (const memory of memories) {
    const company = companies.get(aliases.get(String(memory.clientId || "")) || aliases.get(normalized(memory.clientName)));
    if (!company) continue;
    for (const name of memory.projects || []) ensureProject(company, { name });
    for (const meeting of memory.meetings || []) {
      const project = ensureProject(company, { name: meeting.projectName });
      if (project) {
        addUnique(project.meetings, meeting);
        for (const [index, decision] of (meeting.decisions || []).entries()) {
          addUnique(project.decisions, {
            id: `meeting:${meeting.id}:decision:${index}`,
            projectId: project.id,
            companyId: company.id,
            text: decision,
            source: "film",
            sourceRef: meeting.id,
            meetingTitle: meeting.title,
            createdAt: meeting.createdAt
          });
        }
      }
    }
  }

  const companyFor = (item) => companies.get(aliases.get(String(item.companyId || "")) || aliases.get(normalized(item.companyName)));
  for (const task of tasks) {
    let company = companyFor(task);
    if (!company && task.project) {
      const matches = [...companies.values()].filter((candidate) => candidate.projects.some((project) => normalized(project.name) === normalized(task.project)));
      if (matches.length === 1) company = matches[0];
    }
    if (!company) continue;
    addUnique(company.tasks, task);
    const project = ensureProject(company, { id: task.projectId, name: task.project });
    if (project) addUnique(project.tasks, task);
  }

  for (const object of roomObjects) {
    const company = companyFor(object);
    if (!company) continue;
    addUnique(company.roomItems, object);
    const project = ensureProject(company, { id: object.projectId, name: object.projectName });
    if (project) addUnique(project.roomItems, object);
  }

  for (const company of companies.values()) {
    if (!company.kind) company.kind = pipelineIds.has(String(company.id)) && !company.stored ? "prospect" : "client";
    if (!company.stage) company.stage = company.kind === "prospect" ? "lead" : company.projects.some((project) => project.status === "active") ? "active" : "lead";
    company.projects.sort((left, right) => (left.status === "done") - (right.status === "done") || left.name.localeCompare(right.name));
    company.tasks.sort(byWorkOrder);
    company.meetings.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    company.roomItems.sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)));
    company.timeline.sort((left, right) => String(right.at).localeCompare(String(left.at)));
    company.sheets.sort((left, right) => (left.status === "complete") - (right.status === "complete") || String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)));
    for (const project of company.projects) {
      project.sheets.sort((left, right) => (left.status === "complete") - (right.status === "complete") || String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)));
      project.tasks.sort(byWorkOrder);
      project.meetings.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
      project.decisions.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
      project.resources.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    }
  }

  for (const company of companies.values()) {
    company.lastTouch = companyLastTouch(company);
    company.next = companyNext(company);
    company.overdueDays = company.next?.dueOn && isOverdue(company.next.dueOn, today) ? Math.abs(daysUntil(company.next.dueOn, today)) : 0;
  }

  /* Overdue first, whatever else is true: a relationship with a commitment the
     date has already passed on is the one thing that cannot wait for a sort by
     stage. Within the same urgency the old order still holds. */
  return [...companies.values()].sort((left, right) =>
    (right.overdueDays || 0) - (left.overdueDays || 0)
    || KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind)
    || STAGE_ORDER.indexOf(left.stage) - STAGE_ORDER.indexOf(right.stage)
    || String(right.lastTouch || "").localeCompare(String(left.lastTouch || ""))
    || left.name.localeCompare(right.name));
}

/* One order for every list of tasks in the workspace: what is still open before
   what is finished, then overdue first, then soonest due, then undated. */
function byWorkOrder(left, right) {
  const done = (task) => (task.status === "done" ? 1 : 0);
  const due = (task) => String(task.dueOn || "9999-12-31");
  return done(left) - done(right) || due(left).localeCompare(due(right));
}

export const KIND_ORDER = ["client", "owned", "prospect", "internal"];
export const STAGE_ORDER = ["active", "operating", "proposal", "talking", "lead", "dormant", "lost"];
export const KIND_LABELS = { client: "Client", prospect: "Prospect", owned: "Owned", internal: "Internal" };
export const STAGE_LABELS = { lead: "Lead", talking: "Talking", proposal: "Proposal sent", active: "Active project", operating: "Operating", dormant: "Dormant", lost: "Lost" };

/* "Active project" and "Operating" both meant "they are a client" until someone
   had to choose between them in front of a client. One line each, in the terms
   the studio actually works in, shown wherever the stage can be changed. */
export const STAGE_DEFINITIONS = {
  lead: "Found them, never spoken — no contact yet",
  talking: "Spoken at least once, nothing agreed",
  proposal: "Written proposal sent, waiting on their decision",
  active: "Paid, and a build is running right now",
  operating: "Shipped, and on a monthly retainer",
  dormant: "Nothing running, worth coming back to",
  lost: "They said no, or went quiet for good"
};

/* Every stage implies one obvious next step. Moving the stage without writing it
   is how a relationship goes quiet, so the picker offers this one and a date. */
export const STAGE_PROMPTS = {
  lead: { action: "Make first contact", days: 2 },
  talking: { action: "Book the discovery meeting", days: 5 },
  proposal: { action: "Follow up on the proposal", days: 3 },
  active: { action: "Confirm the current milestone with them", days: 7 },
  operating: { action: "Send this month's update", days: 30 },
  dormant: { action: "Check back in", days: 60 },
  lost: { action: "", days: 0 }
};

/* Project status is an enum in the store and a label everywhere a person reads
   it; "done" on its own next to a proper Health label reads like a bug. */
export const STATUS_LABELS = { active: "Active", paused: "Paused", done: "Done" };

/* The Pipeline board and the CRM each have their own stage words, and showing
   both on one prospect makes neither trustworthy. This is the one mapping;
   PipelinePage can reuse it rather than growing a second copy. */
export const PIPELINE_TO_STAGE = {
  pursued: "lead",
  contacted: "talking",
  replied: "talking",
  meeting: "talking",
  proposal: "proposal",
  won: "active",
  lost: "lost"
};

/** The CRM stage a pipeline stage means, so one prospect speaks one language. */
export function stageFromPipeline(pipelineStage) {
  return PIPELINE_TO_STAGE[String(pipelineStage || "").toLowerCase()] || "";
}

/** The most recent moment anything happened with this company, across every source. */
export function companyLastTouch(company) {
  const stamps = [
    ...(company.meetings || []).map((meeting) => meeting.createdAt),
    ...(company.timeline || []).map((item) => item.at),
    ...(company.roomItems || []).map((item) => item.updatedAt || item.createdAt),
    ...(company.sheets || []).map((sheet) => sheet.updatedAt || sheet.createdAt),
    ...(company.projects || []).flatMap((project) => [project.updatedAt, project.createdAt, ...(project.decisions || []).map((decision) => decision.createdAt)]),
    ...(company.tasks || []).map((task) => task.updatedAt || task.createdAt),
    company.updatedAt
  ].filter(Boolean).map(String);
  return stamps.length ? stamps.sort().at(-1) : null;
}

/**
 * What should happen next with this company: the hand-written next action when
 * there is one, otherwise the most urgent open task linked to the company.
 */
export function companyNext(company) {
  if (company.nextAction) {
    const matchingTasks = (company.tasks || []).filter((task) => normalized(task.title) === normalized(company.nextAction));
    // This also repairs the view for commitments completed before the server
    // started clearing the duplicate saved field. If an open copy still exists,
    // it remains the current commitment.
    const completedOnBoard = matchingTasks.length && matchingTasks.every((task) => task.status === "done");
    if (!completedOnBoard) return { kind: "action", borrowed: false, title: company.nextAction, dueOn: company.nextActionOn || null };
  }
  const open = (company.tasks || []).filter((task) => task.status !== "done");
  if (!open.length) return null;
  const sorted = [...open].sort(byWorkOrder);
  return { kind: "task", borrowed: true, title: sorted[0].title, dueOn: sorted[0].dueOn || null, task: sorted[0] };
}

export function workspaceMention(company, project = null) {
  const companyToken = `@${String(company?.name || "company").trim().replace(/\s+/g, "-")}`;
  if (!project) return companyToken;
  return `${companyToken}/${String(project.name || "project").trim().replace(/\s+/g, "-")}`;
}

function dayDistance(from, to) {
  return daysUntil(to, from);
}

/** Rank only grounded project work; setup gaps are labeled as planning moves. */
export function projectNextMoves(project, { today = localIsoDate() } = {}) {
  if (!project || project.status === "done") return [];
  const moves = [];
  const priorityScore = { urgent: 300, high: 220, normal: 110, low: 40 };
  for (const task of project.tasks || []) {
    if (task.status === "done") continue;
    const distance = task.dueOn ? dayDistance(today, task.dueOn) : null;
    const urgency = distance === null ? 0 : distance < 0 ? 900 + Math.min(Math.abs(distance), 30) : distance === 0 ? 780 : distance === 1 ? 650 : distance <= 7 ? 500 - distance * 20 : 80;
    moves.push({
      id: `task:${task.id}`,
      kind: "task",
      title: task.title,
      reason: distance === null ? "Open project task" : distance < 0 ? `${Math.abs(distance)}d overdue` : distance === 0 ? "Due today" : distance === 1 ? "Due tomorrow" : `Due in ${distance}d`,
      score: 1000 + urgency + (priorityScore[task.priority] || priorityScore.normal) + (task.status === "in_progress" ? 90 : 0),
      task
    });
  }
  for (const [meetingIndex, meeting] of (project.meetings || []).entries()) {
    for (const [actionIndex, action] of (meeting.actionItems || []).entries()) {
      if (!action?.text || action.taskId) continue;
      const distance = action.dueOn ? dayDistance(today, action.dueOn) : null;
      moves.push({
        id: `meeting:${meeting.id}:action:${actionIndex}`,
        kind: "meeting",
        title: action.text,
        reason: action.dueOn ? (distance < 0 ? `Meeting action · ${Math.abs(distance)}d overdue` : distance === 0 ? "Meeting action · due today" : `Meeting action · due ${action.dueOn}`) : `Agreed in ${meeting.title}`,
        score: 1500 + (distance !== null && distance <= 0 ? 400 : 0) - meetingIndex * 5,
        meetingId: meeting.id
      });
    }
  }
  const dueDistance = project.dueOn ? dayDistance(today, project.dueOn) : null;
  if (!project.goal) moves.push({ id: "setup:goal", kind: "setup", title: "Set the project goal", reason: "Agent4 cannot protect a direction it cannot see.", score: 720, setupField: "goal" });
  if (!project.milestone) moves.push({ id: "setup:milestone", kind: "setup", title: "Choose the current milestone", reason: dueDistance !== null && dueDistance <= 14 ? "The deadline is close and the next checkpoint is missing." : "Give the team one visible checkpoint.", score: dueDistance !== null && dueDistance <= 14 ? 760 : 620, setupField: "milestone" });
  if (!project.definitionOfDone) moves.push({ id: "setup:done", kind: "setup", title: "Define what finished means", reason: "A finish line prevents endless polishing.", score: 540, setupField: "definitionOfDone" });
  const seen = new Set();
  return moves
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .filter((move) => {
      const key = normalized(move.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}
