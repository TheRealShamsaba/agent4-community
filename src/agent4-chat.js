import { AGENT_ACTION_TYPES } from "./ai.js";
import { COMPANY_STAGES } from "./workspace-store.js";

/* What Agent4 knows when you talk to it, and what it is allowed to suggest.
   The context is assembled here, on the server, from the same stores the
   screens read, so it can never see more than the person asking can. */

/* The model settings Agent4 talks with, which may differ from the pipeline's. */
export function agent4GatewayConfig(config) {
  return {
    ...config,
    runtime: {
      ...config.runtime,
      aiProvider: config.runtime.agent4AiProvider || config.runtime.aiProvider,
      analysisModel: config.runtime.agent4Model || config.runtime.analysisModel,
      openaiApiKey: config.runtime.agent4OpenaiApiKey || config.runtime.openaiApiKey
    }
  };
}


export function publicAgentError(error) {
  const message = String(error?.message || "");
  if (/Cannot reach Ollama|not reachable/i.test(message)) {
    return { status: 503, code: "model_offline", message: "Agent4 cannot reach Ollama. Start Ollama, then try again." };
  }
  if (/API_KEY|api key|is required/i.test(message) && /openai|api[_ ]key/i.test(message)) {
    return { status: 503, code: "model_not_configured", message: "Agent4's model is not connected on this server yet. It needs an AI key (OPENAI_API_KEY) or a running Ollama." };
  }
  if (/timed out/i.test(message)) {
    return { status: 504, code: "model_timeout", message: "Agent4 took too long. The model may still be loading; try once more." };
  }
  if (error?.name === "AiCapacityError") {
    return { status: 503, code: "capacity_guard", message: "Agent4 paused to protect this machine. Try again when system load is lower." };
  }
  return { status: 502, code: "model_error", message: "Agent4 could not produce a valid result. Nothing was added to the board." };
}

const CONTEXT_CHARACTERS = 14_000;
/* A 4B model on a shared CPU reads about a thousand tokens a second at best, so
   the local window is a third of the hosted one. */
const COMPACT_CONTEXT_CHARACTERS = 5_500;
const DAY = 86_400_000;

function clip(value, limit) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function isoDay(value) {
  const day = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? day : "";
}

function addDays(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export function buildAgentContext({ actor, today, workspaceStore, taskStore, meetingStore, plannerStore, monitorStore = null, compact = false }) {
  const limits = compact ? { companies: 25, tasks: 20, events: 10, meetings: 6, summary: 200 } : { companies: 40, tasks: 40, events: 20, meetings: 12, summary: 360 };
  const isOwner = actor.role === "owner";
  const listing = workspaceStore.list();
  const openByCompany = new Map();
  const tasks = taskStore.queryTasks({ includeDone: false, limit: 80 }).tasks;
  for (const task of tasks) {
    if (task.companyId) openByCompany.set(task.companyId, (openByCompany.get(task.companyId) || 0) + 1);
  }
  const companies = listing.companies
    .filter((company) => !company.hidden && company.kind !== "internal")
    .slice(0, limits.companies)
    .map((company) => {
      const lastEvent = company.timeline?.[0]?.createdAt || company.updatedAt || company.createdAt || "";
      const quiet = lastEvent ? Math.max(0, Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(lastEvent)) / DAY)) : null;
      return {
        id: company.id,
        name: company.name,
        kind: company.kind,
        stage: company.stage,
        contact: company.contactName || undefined,
        nextStep: company.nextAction || null,
        nextStepDue: company.nextActionOn || null,
        daysSinceTouch: Number.isFinite(quiet) ? quiet : null,
        openTasks: openByCompany.get(company.id) || 0,
        ...(isOwner && company.dealValue ? { deal: `${company.dealValue} ${company.dealCurrency}` } : {})
      };
    });
  const openTasks = tasks.slice(0, limits.tasks).map((task) => ({
    id: task.id,
    title: clip(task.title, 120),
    due: task.dueOn || null,
    status: task.status,
    mine: task.assigneeId === actor.id,
    company: task.companyName || undefined
  }));
  const events = plannerStore.listEvents({ actorId: actor.id, from: today, to: addDays(today, 7) })
    .slice(0, limits.events)
    .map((event) => ({ title: clip(event.title, 100), on: event.startsOn, at: event.startsAt || null }));
  const meetings = meetingStore.listClientMemories({ actorId: actor.id })
    .slice(0, limits.meetings)
    .map((memory) => ({
      client: memory.clientName,
      latest: clip(memory.latestSummary, limits.summary),
      open: (memory.openItems || []).slice(0, 3).map((item) => clip(item, 140)),
      followUpOn: memory.nextFollowUpOn || null
    }));
  // How the sites you built are doing is the owner's, like the rest of the money.
  const sites = isOwner && monitorStore
    ? monitorStore.overview().slice(0, 20).map((site) => ({
      name: site.name,
      client: site.companyName || undefined,
      status: site.status,
      uptime30: site.uptime.percent,
      sslDays: site.sslDays,
      seo: site.seoScore,
      errors7: site.errors7,
      visitors7: site.tracking ? site.visitors7 : null
    }))
    : [];
  const context = { today, you: actor.name || "the owner", companies, openTasks, calendarNext7Days: events, clientMeetings: meetings, ...(sites.length ? { sites } : {}) };
  // The model has a limited window. Drop the least useful parts before the most.
  for (const key of ["clientMeetings", "calendarNext7Days", "openTasks"]) {
    if (JSON.stringify(context).length <= (compact ? COMPACT_CONTEXT_CHARACTERS : CONTEXT_CHARACTERS)) break;
    context[key] = context[key].slice(0, Math.ceil(context[key].length / 2));
  }
  return context;
}

const ACTION_LABELS = {
  create_task: (action) => `Add task: ${action.title}${action.dueOn ? ` · due ${action.dueOn}` : ""}`,
  set_next_step: (action) => `Next step for ${action.companyName}: ${action.text}${action.dueOn ? ` · by ${action.dueOn}` : ""}`,
  add_note: (action) => `Note on ${action.companyName}: ${action.text}`,
  move_stage: (action) => `Move ${action.companyName} to ${action.stage}`,
  set_deal: (action) => `Set ${action.companyName}'s deal to ${action.dealValue} ${action.dealCurrency}`
};

/** Keep only actions that would actually apply, and say in words what each does. */
export function sanitizeAgentActions(actions, { actor, workspaceStore }) {
  const companies = new Map(workspaceStore.list().companies.map((company) => [company.id, company]));
  const clean = [];
  for (const raw of Array.isArray(actions) ? actions : []) {
    if (!AGENT_ACTION_TYPES.includes(raw?.type)) continue;
    const company = raw.companyId ? companies.get(String(raw.companyId)) : null;
    const base = { type: raw.type, reason: clip(raw.reason, 300), companyId: company?.id || null, companyName: company?.name || "" };
    const dueOn = isoDay(raw.dueOn) || null;
    let action = null;
    if (raw.type === "create_task") {
      const title = clip(raw.title || raw.text, 200);
      if (title) action = { ...base, title, dueOn };
    } else if (raw.type === "set_next_step") {
      const text = clip(raw.text || raw.title, 300);
      if (company && text) action = { ...base, text, dueOn };
    } else if (raw.type === "add_note") {
      const text = clip(raw.text || raw.title, 1000);
      if (company && text) action = { ...base, text };
    } else if (raw.type === "move_stage") {
      if (company && COMPANY_STAGES.includes(raw.stage) && raw.stage !== company.stage) action = { ...base, stage: raw.stage };
    } else if (raw.type === "set_deal") {
      const value = Number(raw.dealValue);
      const currency = String(raw.dealCurrency || "").toUpperCase();
      if (actor.role === "owner" && company && Number.isSafeInteger(value) && value > 0 && /^[A-Z]{3}$/.test(currency)) {
        action = { ...base, dealValue: value, dealCurrency: currency };
      }
    }
    if (action) clean.push({ ...action, label: ACTION_LABELS[raw.type](action) });
  }
  return clean.slice(0, 6);
}

export function validateChatInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A message is required.");
  const message = clip(value.message, 1000);
  if (!message) throw new Error("Say something to Agent4 first.");
  const today = isoDay(value.today);
  if (!today) throw new Error("Today's date is required.");
  const history = (Array.isArray(value.history) ? value.history : [])
    .slice(-8)
    .filter((turn) => turn && (turn.role === "user" || turn.role === "agent"))
    .map((turn) => ({ role: turn.role, text: clip(turn.text, 1500) }))
    .filter((turn) => turn.text);
  return { message, today, history };
}

/* An approved suggestion becomes the same write the screens make by hand. */
export function applyAgentAction({ action, actor, workspaceStore, taskStore }) {
  if (action.type === "create_task") {
    return taskStore.createTask({
      title: action.title,
      dueOn: action.dueOn || undefined,
      assigneeId: actor.id,
      companyId: action.companyId || undefined,
      companyName: action.companyName || undefined,
      actorId: actor.id
    });
  }
  if (action.type === "set_next_step") {
    return workspaceStore.updateCompany(action.companyId, { nextAction: action.text, nextActionOn: action.dueOn || null });
  }
  if (action.type === "add_note") {
    return workspaceStore.addCompanyEvent({ companyId: action.companyId, type: "note", detail: action.text, actorId: actor.id });
  }
  if (action.type === "move_stage") {
    const moved = workspaceStore.updateCompany(action.companyId, { stage: action.stage });
    workspaceStore.addCompanyEvent({ companyId: action.companyId, type: "stage", detail: `Moved to ${action.stage}`, actorId: actor.id });
    return moved;
  }
  if (action.type === "set_deal") {
    if (actor.role !== "owner") throw new Error("Only the owner can set what a deal is worth.");
    return workspaceStore.updateCompany(action.companyId, { dealValue: action.dealValue, dealCurrency: action.dealCurrency });
  }
  throw new Error("Agent4 suggested something that cannot be applied.");
}
