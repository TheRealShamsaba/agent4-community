import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { createSettingsStore } from "./settings-store.js";
import { clearInterval, setInterval } from "node:timers";
import { pathToFileURL } from "node:url";
import { checkAiProvider, generateAgent4BoardAction, generateAgent4Chat } from "./ai.js";
import { quickAnswer } from "./agent4-quick.js";
import { agent4GatewayConfig, buildAgentContext, publicAgentError, sanitizeAgentActions, validateChatInput } from "./agent4-chat.js";
import { createAuthStore } from "./auth-store.js";
import { loadConfig } from "./config.js";
import { createContentStore } from "./content-store.js";
import { createInvoiceStore } from "./invoice-store.js";
import { applyOwnerTimeZone, localIsoDate } from "./local-date.js";
import { createMoneyStore } from "./money-store.js";
import { createMeetingService, MEETING_LIMITS, normalizeMeetingMimeType } from "./meeting-service.js";
import { createMeetingStore } from "./meeting-store.js";
import { createFileStore, FILE_LIMITS } from "./file-store.js";
import { createMonitorStore } from "./monitor-store.js";
import { createMonitorRunner } from "./monitor-runner.js";
import { MONITOR_SCRIPT } from "./monitor-script.js";
import { createPaperworkStore } from "./paperwork-store.js";
import { createClientApi } from "./client-api.js";
import { createClientHostHandler, isClientHost } from "./client-host.js";
import { createClientLinkStore } from "./client-link-store.js";
import { createClientQuestionnaireStore } from "./client-questionnaire-store.js";
import { clientAddress, createPublicInquiryHandler } from "./public-inquiry.js";
import { createPlannerStore } from "./planner-store.js";
import { createRoomStore, roomDatabasePath } from "./room-store.js";
import { createTaskStore } from "./task-store.js";
import { validateTelegramMiniAppData } from "./telegram-miniapp.js";
import { resolveTelegramAccount } from "./telegram-access.js";
import { filmRoomKeyboard, sendText } from "./telegram.js";
import { checkWhisperService } from "./transcription.js";
import { buildWeeklyGamePlan } from "./weekly-plan.js";
import { createWorkspaceStore } from "./workspace-store.js";
import { createGitHubProjectReader } from "./github-projects.js";

const MAX_REQUEST_BYTES = 96 * 1024;
const MAX_ROOM_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_PRESENCE_REQUEST_BYTES = 24 * 1024;
const PRESENCE_STALE_MS = 20_000;
const LOCAL_ACTOR = { id: "local-owner", email: "local@agent4.dev", name: "You", role: "owner" };
const SESSION_COOKIE = "agent4_session";
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"]
]);

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...headers
  });
  response.end(JSON.stringify(body));
}

/* A deal's worth is money, so it is owner-only everywhere a company is read or
   written, exactly like the money routes it sits beside. */
function withoutDeal(company) {
  if (!company) return company;
  const { dealValue, dealCurrency, ...rest } = company;
  void dealValue;
  void dealCurrency;
  return rest;
}

function ownerOnlyDeal(actor, body = {}) {
  if (actor.role === "owner") return body;
  if (body.dealValue === undefined && body.dealCurrency === undefined) return body;
  const error = new Error("Only the owner can set what a deal is worth.");
  error.statusCode = 403;
  error.code = "owner_required";
  throw error;
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([name]) => name));
}

function sessionCookie(token, { maxAge, secure = false } = {}) {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token || "")}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function requestIsSecure(request, config) {
  return Boolean(config.runtime.agent4SecureCookies || request.socket.encrypted);
}

function meetingReadyMessage(meeting) {
  const actions = Array.isArray(meeting?.actionItems) ? meeting.actionItems.length : 0;
  return [
    "🎬 FILM ROOM · NOTES READY",
    String(meeting?.title || "Untitled meeting"),
    actions
      ? `${actions} next ${actions === 1 ? "move is" : "moves are"} ready for your review.`
      : "Your transcript and meeting brief are ready."
  ].join("\n");
}

function validateCredentials(value) {
  if (!isRecord(value) || typeof value.email !== "string" || value.email.length > 180 || typeof value.password !== "string" || value.password.length > 200) {
    throw new Error("Email and password are required.");
  }
  return { email: value.email, password: value.password };
}

function validateInviteRequest(value) {
  if (!isRecord(value) || typeof value.email !== "string" || value.email.length > 180 || typeof value.name !== "string" || value.name.length > 80) {
    throw new Error("Invite name and email are required.");
  }
  return { email: value.email, name: value.name };
}

function validateRegistration(value) {
  if (!isRecord(value) || typeof value.token !== "string" || value.token.length > 160 || typeof value.password !== "string" || value.password.length > 200) {
    throw new Error("Invite token and password are required.");
  }
  return { token: value.token, password: value.password };
}

function validatePasswordChange(value) {
  if (!isRecord(value) || typeof value.currentPassword !== "string" || value.currentPassword.length > 200 || typeof value.nextPassword !== "string" || value.nextPassword.length > 200) {
    throw new Error("Current and new passwords are required.");
  }
  return { currentPassword: value.currentPassword, nextPassword: value.nextPassword };
}

function sameOrigin(request, config) {
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (!request.headers.origin) return !unsafe;
  try {
    const expected = config.runtime.publicOrigin || `http://${request.headers.host}`;
    return new URL(request.headers.origin).origin === new URL(expected).origin;
  } catch { return false; }
}
function matchesSecret(candidate, expected) {
  if (typeof candidate !== 'string' || !expected) return false;
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(candidate), hash(expected));
}

async function readText(request, maxBytes) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > maxBytes) throw new Error("Too large.");
  }
  return body;
}

async function readJson(request, maxBytes = MAX_REQUEST_BYTES) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error("Request is too large.");
      error.statusCode = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    const error = new Error("Request must contain valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

async function readBytes(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      const error = new Error("Request is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) {
    const error = new Error("The audio part is empty.");
    error.statusCode = 400;
    throw error;
  }
  return new Uint8Array(Buffer.concat(chunks, size));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validRoomId(value) {
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(value);
}

function shiftIsoDate(value, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) throw new Error("Date must be a YYYY-MM-DD date.");
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Date is not a real date.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekBounds(value) {
  const date = new Date(`${shiftIsoDate(value, 0)}T12:00:00Z`);
  const sinceMonday = date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1;
  const start = shiftIsoDate(value, -sinceMonday);
  return { start, end: shiftIsoDate(start, 6) };
}

function buildGoalTracker(plannerStore, actorId, { target = "", weekStart, today }) {
  const start = shiftIsoDate(weekStart, 0);
  const end = shiftIsoDate(start, 6);
  const checkedThrough = today < start ? shiftIsoDate(start, -1) : today > end ? end : today;
  const recordedCheckins = checkedThrough >= start
    ? plannerStore.listGoalCheckins({ actorId, from: start, to: checkedThrough })
    : [];
  const checkins = recordedCheckins.filter((checkin) => checkin.target === target);
  const byDay = new Map(checkins.map((checkin) => [checkin.day, checkin]));
  const canCheckIn = Boolean(target && today >= start && today <= end);
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = shiftIsoDate(start, index);
    const checkin = byDay.get(day) || null;
    const status = checkin
      ? checkin.movedTarget ? "moved" : "stalled"
      : day < today ? "missed"
      : day === today && canCheckIn ? "today" : "future";
    return { day, status, checked: Boolean(checkin), movedTarget: checkin?.movedTarget ?? null };
  });
  return {
    target,
    weekStart: start,
    weekEnd: end,
    canCheckIn,
    todayCheckin: byDay.get(today) || null,
    checkedDays: checkins.length,
    movedDays: checkins.filter((checkin) => checkin.movedTarget).length,
    stalledDays: days.filter((day) => day.status === "stalled" || day.status === "missed").length,
    elapsedDays: days.filter((day) => day.status !== "future").length,
    days
  };
}

function finiteNumber(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

const ROOM_OBJECT_TYPES = new Set(["agent", "doc", "insight", "lead", "link", "note", "notebook", "stamp", "task"]);
const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);

function validEntityId(value, minimum = 3, maximum = 180) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum && /^[a-zA-Z0-9_-]+$/.test(value) && !RESERVED_IDS.has(value);
}

function boundedText(value, label, maximum, { fallback = "", required = false } = {}) {
  if (value == null) value = fallback;
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) {
    throw new Error(`${label} must contain ${required ? `1-${maximum}` : `at most ${maximum}`} characters.`);
  }
  return value;
}

function boundedIdentifier(value, label, maximum = 140, fallback = "") {
  if (value == null || value === "") return fallback;
  if (!validEntityId(value, 1, maximum)) throw new Error(`${label} is invalid.`);
  return value;
}

function roomNumber(value, label, minimum, maximum, fallback) {
  if (value == null && fallback != null) return fallback;
  if (!finiteNumber(value, minimum, maximum)) throw new Error(`${label} is outside its allowed range.`);
  return Math.round(value * 10) / 10;
}

function roomDate(value, label) {
  if (value == null || value === "") return "";
  shiftIsoDate(value, 0);
  return value;
}

function roomTimestamp(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || value.length > 40 || Number.isNaN(Date.parse(value))) throw new Error("A room timestamp is invalid.");
  return value;
}

function roomHttpUrl(value, label, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw new Error(`${label} is required.`);
    return "";
  }
  if (typeof value !== "string" || value.length > 2_048) throw new Error(`${label} is invalid.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${label} must be an HTTP(S) URL without embedded credentials.`);
  }
  return url.href;
}

function normalizeChecklist(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new Error("A task checklist must contain at most 50 items.");
  const seen = new Set();
  return value.map((item) => {
    if (!isRecord(item) || !validEntityId(item.id, 3, 180) || seen.has(item.id)) throw new Error("A checklist item has an invalid or duplicate id.");
    seen.add(item.id);
    return {
      id: item.id,
      title: boundedText(item.title, "Checklist item title", 500),
      done: Boolean(item.done)
    };
  });
}

function normalizeTaskItems(value, actor, now) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("A task board must contain at most 100 tasks.");
  const seen = new Set();
  return value.map((item) => {
    if (!isRecord(item) || !validEntityId(item.id, 3, 180) || seen.has(item.id)) throw new Error("A room task has an invalid or duplicate id.");
    seen.add(item.id);
    const done = Boolean(item.done);
    return {
      id: item.id,
      title: boundedText(item.title, "Room task title", 500, { required: true }),
      notes: boundedText(item.notes, "Room task notes", 4_000),
      when: roomDate(item.when, "Room task date"),
      deadline: roomDate(item.deadline, "Room task deadline"),
      assigneeId: boundedIdentifier(item.assigneeId, "Room task assignee"),
      assigneeName: boundedText(item.assigneeName, "Room task assignee name", 80),
      assignee: boundedText(item.assignee, "Legacy room task assignee", 80),
      done,
      completedAt: done && item.completedAt != null ? roomTimestamp(item.completedAt, now) : null,
      checklist: normalizeChecklist(item.checklist),
      createdAt: roomTimestamp(item.createdAt, now),
      updatedAt: roomTimestamp(item.updatedAt, now),
      createdBy: boundedIdentifier(item.createdBy, "Room task creator", 140, actor.id),
      createdByName: boundedText(item.createdByName, "Room task creator name", 80, { fallback: actor.name })
    };
  });
}

function normalizeGaps(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("An insight must contain at most 20 gaps.");
  return value.map((gap) => {
    if (!isRecord(gap) || !["low", "medium", "high"].includes(gap.severity)) throw new Error("An insight gap has an invalid severity.");
    return {
      severity: gap.severity,
      title: boundedText(gap.title, "Insight gap title", 240, { required: true }),
      detail: boundedText(gap.detail, "Insight gap detail", 2_000),
      nextStep: boundedText(gap.nextStep, "Insight gap next step", 1_000)
    };
  });
}

function normalizeStringList(value, label, maximumItems, maximumLength) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error(`${label} contains too many items.`);
  return value.map((item) => boundedText(item, label, maximumLength, { required: true }));
}

function normalizeRoomObject(object, actor, now) {
  if (!isRecord(object) || !validEntityId(object.id)) throw new Error("A room object has an invalid id.");
  if (!ROOM_OBJECT_TYPES.has(object.type)) throw new Error("A room object has an unsupported type.");
  const normalized = {
    id: object.id,
    type: object.type,
    title: boundedText(object.title, "Room object title", 240, { fallback: "Untitled", required: true }),
    body: boundedText(object.body, "Room object body", 50_000),
    x: roomNumber(object.x, "Room object x position", -10_000, 10_000, 0),
    y: roomNumber(object.y, "Room object y position", -10_000, 10_000, 0),
    w: roomNumber(object.w, "Room object width", 120, 2_000, 280),
    rot: roomNumber(object.rot, "Room object rotation", -30, 30, 0),
    tone: /^[a-z0-9-]{1,32}$/.test(object.tone || "") ? object.tone : "yellow",
    local: object.local !== false,
    editable: Boolean(object.editable),
    eyebrow: boundedText(object.eyebrow, "Room object eyebrow", 120),
    ownerId: boundedIdentifier(object.ownerId, "Room object owner"),
    ownerName: boundedText(object.ownerName, "Room object owner name", 80),
    createdAt: roomTimestamp(object.createdAt, now),
    updatedAt: roomTimestamp(object.updatedAt, now),
    createdBy: boundedIdentifier(object.createdBy, "Room object creator", 140, actor.id),
    createdByName: boundedText(object.createdByName, "Room object creator name", 80, { fallback: actor.name }),
    updatedBy: boundedIdentifier(object.updatedBy, "Room object updater", 140, actor.id),
    updatedByName: boundedText(object.updatedByName, "Room object updater name", 80, { fallback: actor.name })
  };
  if (object.type === "link") {
    normalized.url = roomHttpUrl(object.url, "Room link");
    normalized.image = roomHttpUrl(object.image, "Room link image");
  }
  if (object.type === "task") normalized.items = normalizeTaskItems(object.items, actor, now);
  if (object.type === "notebook") normalized.pageStyle = ["blank", "dots", "grid", "ruled"].includes(object.pageStyle) ? object.pageStyle : "ruled";
  if (object.type === "insight" || object.type === "agent") {
    normalized.agentKind = ["gaps", "summary", "tasks", "connect"].includes(object.agentKind) ? object.agentKind : "summary";
    normalized.model = boundedText(object.model, "Insight model", 120);
    normalized.provider = boundedText(object.provider, "Insight provider", 80);
    normalized.sourceIds = normalizeStringList(object.sourceIds, "Insight source id", 12, 180).map((id) => boundedIdentifier(id, "Insight source id", 180));
    normalized.sourceTitles = normalizeStringList(object.sourceTitles, "Insight source title", 12, 240);
    normalized.gaps = normalizeGaps(object.gaps);
  }
  if (object.type === "lead") {
    normalized.dossierId = boundedIdentifier(object.dossierId, "Lead record id", 180);
    normalized.domain = boundedText(object.domain, "Lead domain", 253);
    normalized.intent = boundedText(object.intent, "Lead intent", 40);
    normalized.score = object.score == null ? null : roomNumber(object.score, "Lead score", 0, 100);
  }
  return normalized;
}

function normalizeLayout(value) {
  if (!isRecord(value) || Object.keys(value).length > 300) throw new Error("Room layout must contain at most 300 items.");
  const normalized = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!validEntityId(id) || !isRecord(entry)) throw new Error("A room layout entry is invalid.");
    normalized[id] = {
      ...(entry.x == null ? {} : { x: roomNumber(entry.x, "Layout x position", -10_000, 10_000) }),
      ...(entry.y == null ? {} : { y: roomNumber(entry.y, "Layout y position", -10_000, 10_000) }),
      ...(entry.w == null ? {} : { w: roomNumber(entry.w, "Layout width", 120, 2_000) }),
      ...(entry.rot == null ? {} : { rot: roomNumber(entry.rot, "Layout rotation", -30, 30) }),
      ...(entry.title == null ? {} : { title: boundedText(entry.title, "Layout title", 240, { required: true }) }),
      ...(entry.body == null ? {} : { body: boundedText(entry.body, "Layout body", 50_000) }),
      ...(entry.ownerId == null ? {} : { ownerId: boundedIdentifier(entry.ownerId, "Layout owner") }),
      ...(entry.ownerName == null ? {} : { ownerName: boundedText(entry.ownerName, "Layout owner name", 80) }),
      ...(entry.updatedAt == null ? {} : { updatedAt: roomTimestamp(entry.updatedAt, new Date().toISOString()) }),
      ...(entry.updatedBy == null ? {} : { updatedBy: boundedIdentifier(entry.updatedBy, "Layout updater") }),
      ...(entry.updatedByName == null ? {} : { updatedByName: boundedText(entry.updatedByName, "Layout updater name", 80) })
    };
  }
  return normalized;
}

function normalizeEdges(value, actor, now) {
  if (!Array.isArray(value) || value.length > 400) throw new Error("Room connections must be an array of at most 400 items.");
  const seen = new Set();
  return value.map((edge) => {
    if (!isRecord(edge) || !validEntityId(edge.id) || seen.has(edge.id) || !validEntityId(edge.from) || !validEntityId(edge.to) || edge.from === edge.to) {
      throw new Error("A room connection has an invalid id or endpoint.");
    }
    seen.add(edge.id);
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: boundedText(edge.label, "Room connection label", 80, { fallback: "relates to", required: true }),
      color: typeof edge.color === "string" && /^#[0-9a-fA-F]{6}$/.test(edge.color) ? edge.color : "#74a7ff",
      dashed: Boolean(edge.dashed),
      createdAt: roomTimestamp(edge.createdAt, now),
      updatedAt: roomTimestamp(edge.updatedAt, now),
      createdBy: boundedIdentifier(edge.createdBy, "Room connection creator", 140, actor.id),
      createdByName: boundedText(edge.createdByName, "Room connection creator name", 80, { fallback: actor.name }),
      updatedBy: boundedIdentifier(edge.updatedBy, "Room connection updater", 140, actor.id),
      updatedByName: boundedText(edge.updatedByName, "Room connection updater name", 80, { fallback: actor.name })
    };
  });
}

function normalizeZones(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 30) throw new Error("Room zones must be an array of at most 30 items.");
  const seen = new Set();
  return value.map((zone) => {
    if (!isRecord(zone) || !validEntityId(zone.id, 3, 120) || seen.has(zone.id)) throw new Error("A room zone has an invalid or duplicate id.");
    seen.add(zone.id);
    if (typeof zone.title !== "string" || zone.title.length > 80) throw new Error("A room zone has an invalid title.");
    if (![zone.x, zone.y].every((number) => finiteNumber(number, -10_000, 10_000)) || !finiteNumber(zone.w, 180, 4_000) || !finiteNumber(zone.h, 160, 4_000)) {
      throw new Error("A room zone has invalid dimensions.");
    }
    return {
      id: zone.id,
      title: zone.title.trim() || "Untitled section",
      x: Math.round(zone.x),
      y: Math.round(zone.y),
      w: Math.round(zone.w),
      h: Math.round(zone.h),
      tone: typeof zone.tone === "string" && /^[a-z-]{1,24}$/.test(zone.tone) ? zone.tone : "blue"
    };
  });
}

function normalizeStrokes(value, actor, now) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 400) throw new Error("Room ink must contain at most 400 strokes.");
  const seen = new Set();
  return value.map((stroke) => {
    if (!isRecord(stroke) || !validEntityId(stroke.id, 8, 140) || seen.has(stroke.id)) throw new Error("A room stroke has an invalid or duplicate id.");
    seen.add(stroke.id);
    if (typeof stroke.scope !== "string" || !/^(board|notebook:[a-zA-Z0-9_-]{3,140})$/.test(stroke.scope)) throw new Error("A room stroke has an invalid scope.");
    if (!Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 600) throw new Error("A room stroke must contain 2-600 points.");
    const points = stroke.points.map((point) => {
      if (!Array.isArray(point) || point.length < 2 || !finiteNumber(point[0], -10_000, 10_000) || !finiteNumber(point[1], -10_000, 10_000)) {
        throw new Error("A room stroke contains an invalid point.");
      }
      return [Math.round(point[0] * 10) / 10, Math.round(point[1] * 10) / 10, finiteNumber(point[2], 0, 1) ? Math.round(point[2] * 100) / 100 : 0.5];
    });
    return {
      id: stroke.id,
      scope: stroke.scope,
      color: typeof stroke.color === "string" && /^#[0-9a-fA-F]{6}$/.test(stroke.color) ? stroke.color : "#f4f1e8",
      width: finiteNumber(stroke.width, 1, 36) ? stroke.width : 4,
      opacity: finiteNumber(stroke.opacity, 0.1, 1) ? stroke.opacity : 1,
      points,
      createdAt: roomTimestamp(stroke.createdAt, now),
      createdBy: boundedIdentifier(stroke.createdBy, "Room stroke creator", 140, actor.id),
      createdByName: boundedText(stroke.createdByName, "Room stroke creator name", 80, { fallback: actor.name })
    };
  });
}

function validatePresence(value) {
  if (!isRecord(value) || typeof value.clientId !== "string" || !/^[a-zA-Z0-9_-]{8,120}$/.test(value.clientId)) throw new Error("Presence client id is invalid.");
  const cursor = value.cursor == null ? null : value.cursor;
  if (cursor && (!isRecord(cursor) || !finiteNumber(cursor.x, -10_000, 10_000) || !finiteNumber(cursor.y, -10_000, 10_000))) {
    throw new Error("Presence cursor is invalid.");
  }
  if (!Array.isArray(value.selectedIds) || value.selectedIds.length > 20 || value.selectedIds.some((id) => !validEntityId(id))) {
    throw new Error("Presence selection is invalid.");
  }
  if (value.editingId != null && !validEntityId(value.editingId)) throw new Error("Presence editor is invalid.");
  return {
    clientId: value.clientId,
    cursor: cursor ? { x: Math.round(cursor.x * 10) / 10, y: Math.round(cursor.y * 10) / 10 } : null,
    selectedIds: [...new Set(value.selectedIds)],
    editingId: value.editingId || null,
    mode: typeof value.mode === "string" && /^[a-z-]{1,24}$/.test(value.mode) ? value.mode : "select"
  };
}

function normalizeRoomState(value, actor = LOCAL_ACTOR, now = new Date().toISOString()) {
  if (!isRecord(value)) throw new Error("Room state must be an object.");
  if (!Array.isArray(value.localObjects) || value.localObjects.length > 200) {
    throw new Error("Room objects must be an array of at most 200 items.");
  }
  const seenObjectIds = new Set();
  const localObjects = value.localObjects.map((object) => {
    const normalized = normalizeRoomObject(object, actor, now);
    if (seenObjectIds.has(normalized.id)) throw new Error("Room object ids must be unique.");
    seenObjectIds.add(normalized.id);
    return normalized;
  });
  return {
    localObjects,
    layout: normalizeLayout(value.layout),
    edges: normalizeEdges(value.edges, actor, now),
    zones: normalizeZones(value.zones),
    strokes: normalizeStrokes(value.strokes, actor, now)
  };
}

const OBJECT_ATTRIBUTION_FIELDS = new Set(["createdAt", "createdBy", "createdByName", "updatedAt", "updatedBy", "updatedByName"]);
const TASK_ATTRIBUTION_FIELDS = new Set(["createdAt", "createdBy", "createdByName", "updatedAt"]);
const LAYOUT_ATTRIBUTION_FIELDS = new Set(["updatedAt", "updatedBy", "updatedByName"]);

function sameWithoutFields(left, right, ignored) {
  if (!left || !right) return false;
  const omit = (value) => Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key)));
  return JSON.stringify(omit(left)) === JSON.stringify(omit(right));
}

function stampTaskItems(nextItems, previousItems, actor, now) {
  const previousById = new Map((previousItems || []).map((item) => [item.id, item]));
  return nextItems.map((item) => {
    const previous = previousById.get(item.id);
    const createdAt = previous?.createdAt || now;
    const createdBy = previous?.createdBy || actor.id;
    const createdByName = previous?.createdByName || actor.name;
    const candidate = { ...item, createdAt, createdBy, createdByName };
    return {
      ...candidate,
      updatedAt: previous && sameWithoutFields(candidate, previous, TASK_ATTRIBUTION_FIELDS) ? (previous.updatedAt || createdAt) : now
    };
  });
}

function stampRoomAttribution(state, previousState, actor, now = new Date().toISOString()) {
  const previousObjects = new Map((previousState?.localObjects || []).map((object) => [object.id, object]));
  const previousEdges = new Map((previousState?.edges || []).map((edge) => [edge.id, edge]));
  const previousStrokes = new Map((previousState?.strokes || []).map((stroke) => [stroke.id, stroke]));
  const previousLayout = previousState?.layout || {};
  const localObjects = state.localObjects.map((object) => {
    const previous = previousObjects.get(object.id);
    const candidate = {
      ...object,
      ...(object.type === "task" ? { items: stampTaskItems(object.items, previous?.items, actor, now) } : {}),
      createdAt: previous?.createdAt || now,
      createdBy: previous?.createdBy || actor.id,
      createdByName: previous?.createdByName || actor.name
    };
    const unchanged = previous && sameWithoutFields(candidate, previous, OBJECT_ATTRIBUTION_FIELDS);
    return {
      ...candidate,
      updatedAt: unchanged ? (previous.updatedAt || candidate.createdAt) : now,
      updatedBy: unchanged ? (previous.updatedBy || candidate.createdBy) : actor.id,
      updatedByName: unchanged ? (previous.updatedByName || candidate.createdByName) : actor.name
    };
  });
  const edges = state.edges.map((edge) => {
    const previous = previousEdges.get(edge.id);
    const candidate = {
      ...edge,
      createdAt: previous?.createdAt || now,
      createdBy: previous?.createdBy || actor.id,
      createdByName: previous?.createdByName || actor.name
    };
    const unchanged = previous && sameWithoutFields(candidate, previous, OBJECT_ATTRIBUTION_FIELDS);
    return {
      ...candidate,
      updatedAt: unchanged ? (previous.updatedAt || candidate.createdAt) : now,
      updatedBy: unchanged ? (previous.updatedBy || candidate.createdBy) : actor.id,
      updatedByName: unchanged ? (previous.updatedByName || candidate.createdByName) : actor.name
    };
  });
  const strokes = state.strokes.map((stroke) => {
    const previous = previousStrokes.get(stroke.id);
    return {
      ...stroke,
      createdAt: previous?.createdAt || now,
      createdBy: previous?.createdBy || actor.id,
      createdByName: previous?.createdByName || actor.name
    };
  });
  const layout = Object.fromEntries(Object.entries(state.layout).map(([id, entry]) => {
    const previous = previousLayout[id];
    const unchanged = previous && sameWithoutFields(entry, previous, LAYOUT_ATTRIBUTION_FIELDS);
    return [id, {
      ...entry,
      updatedAt: unchanged ? (previous.updatedAt || now) : now,
      updatedBy: unchanged ? (previous.updatedBy || actor.id) : actor.id,
      updatedByName: unchanged ? (previous.updatedByName || actor.name) : actor.name
    }];
  }));
  return { ...state, localObjects, edges, strokes, layout };
}

function validateRoomSave(value, actor) {
  if (!isRecord(value) || !Number.isInteger(value.baseVersion) || value.baseVersion < 0) {
    throw new Error("A non-negative baseVersion is required.");
  }
  const label = typeof value.label === "string" ? value.label.trim() : "Room update";
  if (!label || label.length > 120) throw new Error("Room update label must contain 1-120 characters.");
  const clientId = typeof value.clientId === "string" && /^[a-zA-Z0-9_-]{8,120}$/.test(value.clientId) ? value.clientId : "";
  return { baseVersion: value.baseVersion, label, clientId, state: normalizeRoomState(value.state, actor) };
}

function validateReceipt(value) {
  if (!isRecord(value)) throw new Error("An operation receipt is required.");
  if (typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{8,120}$/.test(value.id)) {
    throw new Error("Receipt id is invalid.");
  }
  if (typeof value.action !== "string" || !["tasks", "connect", "gaps"].includes(value.action)) {
    throw new Error("Receipt action is invalid.");
  }
  if (value.status !== "approved" && value.status !== "cancelled") {
    throw new Error("Receipt status is invalid.");
  }
  if (typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 240) {
    throw new Error("Receipt summary must contain 1-240 characters.");
  }
  if (!Array.isArray(value.sources) || value.sources.length > 12 || value.sources.some((source) => typeof source !== "string" || source.length > 180)) {
    throw new Error("Receipt sources are invalid.");
  }
  if (!isRecord(value.result) || JSON.stringify(value.result).length > 16_000) {
    throw new Error("Receipt result is invalid.");
  }
  if (value.model != null && (typeof value.model !== "string" || value.model.length > 120)) {
    throw new Error("Receipt model is invalid.");
  }
  return {
    id: value.id,
    action: value.action,
    status: value.status,
    summary: value.summary.trim(),
    sources: value.sources,
    result: value.result,
    model: value.model || ""
  };
}

function validateActionInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A command payload is required.");
  if (typeof value.command !== "string" || !value.command.trim() || value.command.length > 500) {
    throw new Error("Command must contain 1-500 characters.");
  }
  if (!value.document || typeof value.document !== "object" || Array.isArray(value.document)) {
    throw new Error("Document context is required.");
  }
  if (typeof value.document.title !== "string" || value.document.title.length > 160) {
    throw new Error("Document title is invalid.");
  }
  if (typeof value.document.body !== "string" || value.document.body.length > 8_000) {
    throw new Error("Document body is invalid.");
  }
  if (!Array.isArray(value.references) || value.references.length > 12) {
    throw new Error("References must be an array of at most 12 items.");
  }
  for (const reference of value.references) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) throw new Error("A reference is invalid.");
    if (typeof reference.title !== "string" || reference.title.length > 160) throw new Error("A reference title is invalid.");
    if (typeof reference.body !== "string" || reference.body.length > 4_000) throw new Error("A reference body is invalid.");
    if (typeof reference.type !== "string" || reference.type.length > 30) throw new Error("A reference type is invalid.");
  }
  return value;
}

function redactHqSnapshot(contents) {
  const marker = '<script type="application/json" id="hq-data">';
  const start = contents.indexOf(marker);
  if (start < 0) return contents;
  const dataStart = start + marker.length;
  const dataEnd = contents.indexOf("</script>", dataStart);
  if (dataEnd < 0) return contents;
  return `${contents.slice(0, dataStart)}{}${contents.slice(dataEnd)}`;
}

function teamMember(actor) {
  if (!actor) return actor;
  return { id: actor.id, name: actor.name, role: actor.role };
}

function membersForActor(actor, members) {
  return actor?.role === "owner" ? members : members.map(teamMember);
}

async function serveFile(root, request, response, { redactSnapshot = false, templatePath } = {}) {
  const requested = new URL(request.url, "http://localhost").pathname;
  const pathname = ["/", "/telegram", "/telegram/"].includes(requested) ? "/data/hq.html" : requested;
  if (pathname !== "/data/hq.html") {
    sendJson(response, 404, { error: { code: "not_found", message: "Not found." } });
    return;
  }
  const filePath = templatePath || path.resolve(root, `.${pathname}`);
  let details;
  try {
    details = await stat(filePath);
  } catch {
    sendJson(response, 404, { error: { code: "not_found", message: "Not found." } });
    return;
  }
  if (!details.isFile()) {
    sendJson(response, 404, { error: { code: "not_found", message: "Not found." } });
    return;
  }
  let contents = await readFile(filePath);
  if (redactSnapshot) contents = Buffer.from(redactHqSnapshot(contents.toString("utf8")));
  response.writeHead(200, {
    "content-type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
    "content-length": contents.length,
    "cache-control": path.extname(filePath) === ".html" ? "no-store" : "no-cache",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex, nofollow, noarchive"
  });
  response.end(request.method === "HEAD" ? null : contents);
}

export function createHqServer(config, dependencies = {}) {
  const generateAction = dependencies.generateAction || generateAgent4BoardAction;
  const generateChat = dependencies.generateChat || generateAgent4Chat;
  const providerStatus = dependencies.providerStatus || checkAiProvider;
  const databasePath = config.runtime.roomDatabasePath || roomDatabasePath(config.runtime.root);
  const roomStore = dependencies.roomStore || createRoomStore(databasePath);
  const settingsStore = createSettingsStore(databasePath);
  const authStore = dependencies.authStore || createAuthStore(databasePath);
  const moneyStore = dependencies.moneyStore || createMoneyStore(databasePath);
  const invoiceStore = dependencies.invoiceStore || createInvoiceStore(databasePath, { money: moneyStore });
  const taskStore = dependencies.taskStore || createTaskStore(databasePath);
  const workspaceStore = dependencies.workspaceStore || createWorkspaceStore(databasePath);
  const paperworkStore = dependencies.paperworkStore || createPaperworkStore(databasePath, { workspace: workspaceStore });
  const clientLinkStore = dependencies.clientLinkStore || createClientLinkStore(databasePath, { workspace: workspaceStore });
  const clientQuestionnaireStore = dependencies.clientQuestionnaireStore || createClientQuestionnaireStore(databasePath);
  const githubProjectReader = dependencies.githubProjectReader || createGitHubProjectReader({
    token: config.runtime.agent4GithubToken
  });
  const contentStore = dependencies.contentStore || createContentStore(databasePath);
  const meetingStore = dependencies.meetingStore || createMeetingStore(databasePath);
  const fileStore = dependencies.fileStore || createFileStore(databasePath);
  const monitorStore = dependencies.monitorStore || createMonitorStore(databasePath);
  const monitorRunner = dependencies.monitorRunner || createMonitorRunner({
    store: monitorStore,
    // Only what is urgent reaches the owner's phone. The sender is best effort.
    notify: (message) => sendText(config, message)
  });
  const plannerStore = dependencies.plannerStore || createPlannerStore(databasePath, {
    morningAt: config.runtime.telegramMorningBriefAt,
    weeklyAt: config.runtime.telegramWeeklyResetAt
  });
  const authRequired = Boolean(config.runtime.agent4AuthRequired);
  const gatewayConfig = agent4GatewayConfig(config);
  gatewayConfig.company = { ...config.company, name: settingsStore.get().name };
  const notifyMeetingReady = dependencies.notifyMeetingReady || (
    config.runtime.telegramBotToken && config.runtime.telegramOwnerChatId
      ? (meeting) => sendText(config, meetingReadyMessage(meeting), {
          chatId: config.runtime.telegramOwnerChatId,
          replyMarkup: filmRoomKeyboard(config)
        })
      : null
  );
  const notifyInquiry = dependencies.notifyInquiry || (
    config.runtime.telegramBotToken && config.runtime.telegramOwnerChatId
      ? (message) => sendText(config, message, { chatId: config.runtime.telegramOwnerChatId })
      : null
  );
  const clientApi = createClientApi({ config, linkStore: clientLinkStore, paperworkStore, workspaceStore, questionnaireStore: clientQuestionnaireStore });
  // What happens when a client presses Send on a questionnaire: a line in the
  // company's history, and a Telegram message with the counts but never the
  // answers (they can be personal, and Telegram is not where they belong).
  async function tellOwnerAboutQuestionnaire({ link, company, questionnaire }) {
    const progress = questionnaire.progress;
    const who = link.label || company.contactName || "A client";
    try {
      workspaceStore.addCompanyEvent({
        companyId: company.id,
        type: "questionnaire",
        detail: `${who} sent "${questionnaire.title}" (${progress.answered} of ${progress.total} answered)`,
        actorId: "client"
      });
    } catch (error) {
      console.warn(`A questionnaire was sent but its history line could not be written (${error?.message || error}).`);
    }
    if (!notifyInquiry) return;
    const needed = progress.needed ? `, ${progress.neededAnswered} of ${progress.needed} needed to start` : "";
    await notifyInquiry(`${who} sent "${questionnaire.title}" for ${company.name}: ${progress.answered} of ${progress.total} answered${needed}.\nRead it in HQ → Companies → ${company.name} → Client page.`);
  }
  // A client would rather answer on a call. The times they typed stay in HQ:
  // like answers, what a client writes never goes to Telegram.
  async function tellOwnerAboutCall({ link, company, questionnaire }) {
    const who = link.label || company.contactName || "A client";
    try {
      workspaceStore.addCompanyEvent({
        companyId: company.id,
        type: "questionnaire",
        detail: `${who} asked to answer "${questionnaire.title}" on a call`,
        actorId: "client"
      });
    } catch (error) {
      console.warn(`A call was asked for but its history line could not be written (${error?.message || error}).`);
    }
    if (!notifyInquiry) return;
    const times = questionnaire.callTimes ? " They left times that suit them." : "";
    await notifyInquiry(`${who} would rather answer "${questionnaire.title}" for ${company.name} on a 20-minute call.${times}\nMessage them on WhatsApp to set a time. HQ → Companies → ${company.name} → Client page.`);
  }
  const handleClientHost = createClientHostHandler({
    config,
    linkStore: clientLinkStore,
    workspaceStore,
    questionnaireStore: clientQuestionnaireStore,
    onQuestionnaireSubmitted: tellOwnerAboutQuestionnaire,
    onCallRequested: tellOwnerAboutCall,
    limiter: dependencies.clientPageLimiter,
    saveLimiter: dependencies.clientSaveLimiter,
    formBodyTimeoutMs: dependencies.clientFormBodyTimeoutMs,
    now: dependencies.now
  });
  const handlePublicRequest = createPublicInquiryHandler({
    config,
    workspaceStore,
    notify: notifyInquiry,
    limiter: dependencies.inquiryLimiter
  });
  const meetingService = dependencies.meetingService || createMeetingService({
    config: gatewayConfig,
    store: meetingStore,
    transcribe: dependencies.transcribeMeeting,
    generateDebrief: dependencies.generateMeetingDebrief,
    tempRoot: config.runtime.meetingAudioRoot || path.join(config.runtime.root, "data", "meeting-audio"),
    notifyComplete: notifyMeetingReady
  });
  Promise.resolve(config.runtime.voiceTranscriptionEnabled === false ? undefined : meetingService.recoverPending?.()).catch((error) => {
    // Durable meeting rows remain visible if recovery cannot start. Keep the
    // server available and let the owner retry instead of crashing Home Court,
    // but say why on the log so a stuck upload is not a silent mystery.
    console.warn(`Film Room could not resume pending meetings (${error?.message || error}).`);
  });
  const checkMeetingTranscription = dependencies.checkMeetingTranscription || checkWhisperService;
  authStore.ensureBootstrap({
    email: config.runtime.agent4BootstrapEmail,
    name: config.runtime.agent4BootstrapName,
    password: config.runtime.agent4BootstrapPassword
  });
  if (authRequired && !authStore.hasUsers() && !config.runtime.setupToken) {
    throw new Error('No owner account exists. Run npm run setup (or ./agent4.sh) to get your private setup link.');
  }
  let actionBusy = false;
  const roomListeners = new Map();
  const roomPresence = new Map();
  const agentUsage = [];

  function actorForRequest(request) {
    if (!authRequired) return LOCAL_ACTOR;
    return authStore.getSession(parseCookies(request)[SESSION_COOKIE]);
  }

  function broadcast(roomId, event) {
    const listeners = roomListeners.get(roomId);
    if (!listeners?.size) return;
    const safeEvent = {
      ...event,
      ...(event.actor ? { actor: teamMember(event.actor) } : {}),
      ...(Array.isArray(event.members) ? { members: event.members.map(teamMember) } : {}),
      ...(Array.isArray(event.sessions)
        ? { sessions: event.sessions.map((session) => ({ ...session, actor: teamMember(session.actor) })) }
        : {})
    };
    const payload = `event: ${safeEvent.type}\ndata: ${JSON.stringify(safeEvent)}\n\n`;
    listeners.forEach((listener) => {
      if (authRequired && !authStore.getSession(listener.token)) {
        listener.response.end(); listeners.delete(listener); return;
      }
      listener.response.write(payload);
    });
  }

  function broadcastPresence(roomId) {
    const listeners = roomListeners.get(roomId) || new Set();
    const sessions = roomPresence.get(roomId) || new Map();
    const staleBefore = Date.now() - PRESENCE_STALE_MS;
    sessions.forEach((session, clientId) => {
      if (session.lastSeen < staleBefore) sessions.delete(clientId);
    });
    if (!sessions.size) roomPresence.delete(roomId);
    const activeSessions = [...sessions.values()].map(({ lastSeen: _lastSeen, ...session }) => session);
    const actors = [
      ...[...listeners].map((listener) => listener.actor),
      ...activeSessions.map((session) => session.actor)
    ];
    const members = [...new Map(actors.map((actor) => [actor.id, actor])).values()];
    broadcast(roomId, { type: "presence", members, sessions: activeSessions });
  }

  function openRoomEvents(roomId, actor, clientId, request, response) {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff"
    });
    response.write(`event: ready\ndata: ${JSON.stringify({ type: "ready", actor })}\n\n`);
    const listener = { actor, clientId, response, token: parseCookies(request)[SESSION_COOKIE] };
    const listeners = roomListeners.get(roomId) || new Set();
    listeners.add(listener);
    roomListeners.set(roomId, listeners);
    if (clientId) {
      const sessions = roomPresence.get(roomId) || new Map();
      sessions.set(clientId, { clientId, actor, cursor: null, selectedIds: [], editingId: null, mode: "select", lastSeen: Date.now() });
      roomPresence.set(roomId, sessions);
    }
    broadcastPresence(roomId);
    const heartbeat = setInterval(() => {
      if (authRequired && !authStore.getSession(listener.token)) { response.end(); return; }
      response.write(': heartbeat\n\n');
    }, 25_000);
    request.once("close", () => {
      clearInterval(heartbeat);
      listeners.delete(listener);
      if (!listeners.size) roomListeners.delete(roomId);
      const hasReplacement = [...listeners].some((item) => item.clientId === clientId);
      if (clientId && !hasReplacement) roomPresence.get(roomId)?.delete(clientId);
      broadcastPresence(roomId);
    });
  }

  function updatePresence(roomId, actor, input) {
    const sessions = roomPresence.get(roomId) || new Map();
    sessions.set(input.clientId, { ...input, actor, lastSeen: Date.now() });
    roomPresence.set(roomId, sessions);
    broadcastPresence(roomId);
  }

  function disconnectUser(userId) {
    roomListeners.forEach((listeners, roomId) => {
      listeners.forEach((listener) => {
        if (listener.actor.id !== userId) return;
        listener.response.end();
        listeners.delete(listener);
      });
      if (!listeners.size) roomListeners.delete(roomId);
      const sessions = roomPresence.get(roomId);
      sessions?.forEach((session, clientId) => {
        if (session.actor.id === userId) sessions.delete(clientId);
      });
      broadcastPresence(roomId);
    });
  }

  function agentLimit(actor) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    while (agentUsage[0]?.timestamp < cutoff) agentUsage.shift();
    const companyLimit = config.runtime.agent4HourlyActionLimit || 40;
    const userLimit = config.runtime.agent4UserHourlyActionLimit || 12;
    if (agentUsage.length >= companyLimit) return "Agent4 reached the company hourly limit. Try again later.";
    if (agentUsage.filter((entry) => entry.actorId === actor.id).length >= userLimit) return "You reached the Agent4 hourly limit. Try again later.";
    return "";
  }

  /* Talking to Agent4 is a conversation, not a board action, so it gets its own
     and roomier hourly allowance. */
  const chatUsage = [];
  function chatLimit(actor) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    while (chatUsage[0]?.timestamp < cutoff) chatUsage.shift();
    if (chatUsage.filter((entry) => entry.actorId === actor.id).length >= 80) return "You have talked to Agent4 a lot this hour. Try again shortly.";
    return "";
  }

  const collectHits = new Map();
  const BOT_PATTERN = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|curl|python-requests/i;

  async function handleCollect(request, response) {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400"
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, cors);
      response.end();
      return;
    }
    // Whatever happens, the page that sent this hears nothing about it.
    const done = () => { response.writeHead(204, cors); response.end(); };
    if (request.method !== "POST") { done(); return; }
    let body;
    try {
      body = JSON.parse(await readText(request, 2048));
    } catch {
      done();
      return;
    }
    const site = body && typeof body === "object" ? monitorStore.siteByToken(body.k) : null;
    const agent = String(request.headers["user-agent"] || "");
    if (!site || site.paused) { done(); return; }
    // Only the site that owns the token may report for it.
    let origin = "";
    try { origin = new URL(request.headers.origin || request.headers.referer || "").hostname; } catch { /* no origin */ }
    if (BOT_PATTERN.test(agent)) { monitorStore.recordRejected(site.id, { reason: "bot", host: origin }); done(); return; }
    const strip = (host) => host.replace(/^www\./, "").toLowerCase();
    if (!origin || (strip(origin) !== strip(site.host) && !strip(origin).endsWith(`.${strip(site.host)}`))) {
      monitorStore.recordRejected(site.id, { reason: "domain", host: origin || "no address" });
      done();
      return;
    }
    const address = clientAddress(request);
    const key = `${address}|${site.id}`;
    const nowMs = Date.now();
    const recent = (collectHits.get(key) || []).filter((stamp) => nowMs - stamp < 60_000);
    if (recent.length >= 120) { done(); return; }
    recent.push(nowMs);
    collectHits.set(key, recent);
    if (collectHits.size > 5000) for (const [entry, stamps] of collectHits) if (!stamps.some((stamp) => nowMs - stamp < 60_000)) collectHits.delete(entry);
    try {
      if (body.t === "pv") monitorStore.recordView(site.id, { path: String(body.p || "/"), address, agent });
      else if (body.t === "err") monitorStore.recordError(site.id, { message: body.m, source: body.s, line: body.l, page: body.p });
    } catch (error) {
      console.error(`Monitor could not record a hit: ${error.message}`);
    }
    done();
  }

  const server = createServer(async (request, response) => {
    request.agent4TrustProxy = config.runtime.trustProxy === true;
    try {
      response.setHeader('referrer-policy', 'no-referrer');
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('x-frame-options', 'DENY');
      response.setHeader('permissions-policy', 'camera=(), geolocation=()');
      response.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      const requestUrl = new URL(request.url, "http://localhost");
      if (request.method === 'GET' && requestUrl.pathname === '/api/healthz') {
        sendJson(response, 200, { ok: true }); return;
      }
      if (['GET','HEAD'].includes(request.method) && requestUrl.pathname === '/favicon.svg') {
        const icon = await readFile(path.join(config.runtime.root, 'public/favicon.svg'));
        response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
        response.end(request.method === 'HEAD' ? null : icon); return;
      }
      // The client hostname is a different site run by this program. It is
      // answered here and nowhere else, so it can never reach the rest of HQ.
      if (isClientHost(request, config.runtime.clientPagesHosts)) {
        await handleClientHost(request, response, requestUrl);
        return;
      }
      // The public door decides for itself who may call it (an allow-list of
      // sites, not "same origin as HQ"), so it is answered before the rule
      // below, which exists to protect the signed-in part of HQ and stays as is.
      if (requestUrl.pathname === "/public" || requestUrl.pathname.startsWith("/public/")) {
        await handlePublicRequest(request, response, requestUrl.pathname);
        return;
      }

      // The tracking snippet and its collector are called from other people's
      // websites, so like the public door they answer for themselves before the
      // same-origin rule. They accept only what a registered site may send.
      if (requestUrl.pathname === "/m.js" && (request.method === "GET" || request.method === "HEAD")) {
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" });
        response.end(request.method === "HEAD" ? undefined : MONITOR_SCRIPT);
        return;
      }
      if (requestUrl.pathname === "/m/collect") {
        await handleCollect(request, response);
        return;
      }

      if (!sameOrigin(request, config)) {
        sendJson(response, 403, { error: { code: "cross_origin", message: "Cross-origin requests are not allowed." } });
        return;
      }

      const inviteRoute = /^\/api\/auth\/invites\/([A-Za-z0-9_-]{20,160})$/.exec(requestUrl.pathname);

      if (request.method === "GET" && requestUrl.pathname === "/api/auth/session") {
        const actor = actorForRequest(request);
        const token = parseCookies(request)[SESSION_COOKIE];
        sendJson(response, 200, { authenticated: Boolean(actor), authRequired, actor,
          setupRequired: authRequired && !authStore.hasUsers(), csrfToken: actor ? authStore.getCsrfToken(token) : '', settings: actor ? settingsStore.get() : undefined });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/auth/setup') {
        if (authStore.hasUsers()) { sendJson(response, 409, { error: { code: 'setup_complete', message: 'This workspace already has an owner. Sign in instead.' } }); return; }
        if (!authStore.attemptLogin(clientAddress(request), 'setup')) { sendJson(response, 429, { error: { code: 'setup_limited', message: 'Too many setup attempts. Try again in 15 minutes.' } }); return; }
        try {
          const input = await readJson(request);
          if (!matchesSecret(input.token, config.runtime.setupToken)) { sendJson(response, 403, { error: { code: 'setup_token_required', message: 'Use the private setup link printed by the installer.' } }); return; }
          const credentials = validateCredentials(input);
          if (input.workspace !== undefined && (typeof input.workspace !== "string" || !input.workspace.trim() || input.workspace.length > 80)) throw new Error("Workspace name must contain 1–80 characters.");
          const user = authStore.ensureBootstrap({ ...credentials, name: input.name });
          if (!user) { sendJson(response, 409, { error: { code: 'setup_complete', message: 'The owner account already exists.' } }); return; }
          // Database state is authoritative. An interrupted file cleanup can never
          // reopen setup or create another owner.
          try { if (config.runtime.setupTokenFile) await writeFile(config.runtime.setupTokenFile, ''); } catch { console.warn('Setup completed. You may empty .secrets/setup-token on the host; keep the file present for Compose.'); }
          if (input.workspace) { settingsStore.update({ name: input.workspace }); gatewayConfig.company.name = input.workspace.trim(); }
          const session = authStore.createSession(user.id, { ttlHours: config.runtime.agent4SessionHours || 168 });
          sendJson(response, 201, { authenticated: true, actor: user, csrfToken: session.csrfToken, settings: settingsStore.get() }, {
            'set-cookie': sessionCookie(session.token, { maxAge: 604800, secure: requestIsSecure(request, config) })
          });
        } catch (error) { sendJson(response, 400, { error: { code: 'setup_failed', message: error.message } }); }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/auth/login") {
        let input;
        try {
          input = validateCredentials(await readJson(request));
        } catch (error) {
          sendJson(response, 400, { error: { code: "invalid_login", message: error.message } });
          return;
        }
        if (!authStore.attemptLogin(clientAddress(request), input.email)) {
          sendJson(response, 429, { error: { code: "login_limited", message: "Too many sign-in attempts. Try again later." } });
          return;
        }
        const user = authStore.authenticate(input.email, input.password);
        if (!user) {
          sendJson(response, 401, { error: { code: "invalid_credentials", message: "Email or password is incorrect." } });
          return;
        }
        const session = authStore.createSession(user.id, { ttlHours: config.runtime.agent4SessionHours || 24 * 7 });
        sendJson(response, 200, { authenticated: true, actor: session.user, csrfToken: session.csrfToken }, {
          "set-cookie": sessionCookie(session.token, {
            maxAge: Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
            secure: requestIsSecure(request, config)
          })
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/auth/logout") {
        const token = parseCookies(request)[SESSION_COOKIE];
        if (authRequired && !authStore.verifyCsrfToken(token, request.headers['x-csrf-token'])) {
          sendJson(response, 403, { error: { code: 'csrf_required', message: 'Reload Agent4 and try again.' } }); return;
        }
        authStore.revokeSession(token);
        sendJson(response, 200, { authenticated: false }, {
          "set-cookie": sessionCookie("", { maxAge: 0, secure: requestIsSecure(request, config) })
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/auth/telegram") {
        try {
          const input = await readJson(request);
          const telegramUser = validateTelegramMiniAppData(input.initData, {
            botToken: config.runtime.telegramBotToken
          });
          const actor = resolveTelegramAccount(config, authStore, telegramUser.id);
          if (!actor) throw new Error("This Telegram account is not linked to an active Agent4 member.");
          if (!authRequired) {
            sendJson(response, 200, { authenticated: true, authRequired: false, actor: LOCAL_ACTOR });
            return;
          }
          const session = authStore.createSession(actor.id, { ttlHours: config.runtime.agent4SessionHours || 24 * 7 });
          sendJson(response, 200, { authenticated: true, authRequired: true, actor: session.user, csrfToken: session.csrfToken }, {
            "set-cookie": sessionCookie(session.token, {
              maxAge: Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
              secure: requestIsSecure(request, config)
            })
          });
        } catch (error) {
          sendJson(response, 401, { error: { code: "telegram_auth_failed", message: error.message } });
        }
        return;
      }
      if (request.method === "GET" && inviteRoute) {
        const invite = authStore.getInvite(inviteRoute[1]);
        if (!invite) {
          sendJson(response, 404, { error: { code: "invite_invalid", message: "This invite is invalid or expired." } });
          return;
        }
        sendJson(response, 200, { invite });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/auth/register") {
        let input;
        try {
          input = validateRegistration(await readJson(request));
          const user = authStore.acceptInviteToken(input.token, input.password);
          if (!user) {
            sendJson(response, 404, { error: { code: "invite_invalid", message: "This invite is invalid or expired." } });
            return;
          }
          const session = authStore.createSession(user.id, { ttlHours: config.runtime.agent4SessionHours || 24 * 7 });
          sendJson(response, 200, { authenticated: true, actor: session.user, csrfToken: session.csrfToken }, {
            "set-cookie": sessionCookie(session.token, {
              maxAge: Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
              secure: requestIsSecure(request, config)
            })
          });
        } catch (error) {
          sendJson(response, 400, { error: { code: "registration_failed", message: error.message } });
        }
        return;
      }


      const actor = actorForRequest(request);
      if (requestUrl.pathname.startsWith("/api/") && !actor) {
        sendJson(response, 401, { error: { code: "authentication_required", message: "Sign in to continue." } });
        return;
      }
      if (authRequired && actor && !['GET','HEAD','OPTIONS'].includes(request.method) &&
          !authStore.verifyCsrfToken(parseCookies(request)[SESSION_COOKIE], request.headers['x-csrf-token'])) {
        sendJson(response, 403, { error: { code: 'csrf_required', message: 'Reload Agent4 and try again.' } }); return;
      }
      if (requestUrl.pathname === '/api/settings') {
        if (request.method === 'GET') { sendJson(response, 200, { settings: settingsStore.get() }); return; }
        if (request.method === 'PATCH') {
          if (actor.role !== 'owner') { sendJson(response, 403, { error: { code: 'owner_required', message: 'Only the owner can customize this workspace.' } }); return; }
          try {
            const settings = settingsStore.update(await readJson(request));
            gatewayConfig.company.name = settings.name;
            if (settings.modules.monitor) monitorRunner.start?.(); else monitorRunner.stop?.();
            sendJson(response, 200, { settings });
          }
          catch (error) { sendJson(response, 400, { error: { code: 'invalid_settings', message: error.message } }); }
          return;
        }
      }
      if (request.method === 'GET' && requestUrl.pathname === '/api/auth/invites') {
        if (actor.role !== 'owner') { sendJson(response, 403, { error: { code: 'owner_required', message: 'Only the owner can manage invitations.' } }); return; }
        sendJson(response, 200, { invites: authStore.listInvites() }); return;
      }
      const revokeInviteRoute = /^\/api\/auth\/invites\/([a-f0-9]{64})$/.exec(requestUrl.pathname);
      if (request.method === 'DELETE' && revokeInviteRoute) {
        if (actor.role !== 'owner') { sendJson(response, 403, { error: { code: 'owner_required', message: 'Only the owner can revoke invitations.' } }); return; }
        sendJson(response, 200, { revoked: authStore.revokeInvite(revokeInviteRoute[1]) }); return;
      }
      // Where the owner uses HQ from, so their own taps on a client link are told apart from the client's.
      if (actor?.role === "owner" && requestUrl.pathname.startsWith("/api/")) {
        try {
          clientLinkStore.noteOwnerNetwork?.(clientAddress(request));
        } catch (error) {
          console.warn(`The owner's network could not be noted (${error?.message || error}).`);
        }
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/auth/invites") {
        if (actor.role !== "owner") {
          sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can invite teammates." } });
          return;
        }
        try {
          const input = validateInviteRequest(await readJson(request));
          const invite = authStore.createInvite({ ...input, createdBy: actor.id });
          const publicOrigin = config.runtime.publicOrigin || `http://${request.headers.host}`;
          sendJson(response, 200, { invite: { ...invite, url: `${publicOrigin}/#invite=${invite.token}` } });
        } catch (error) {
          sendJson(response, 400, { error: { code: "invite_failed", message: error.message } });
        }
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/auth/members") {
        const members = authRequired ? authStore.listUsers() : [LOCAL_ACTOR];
        sendJson(response, 200, { members: membersForActor(actor, members) });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/auth/password") {
        if (!authRequired) {
          sendJson(response, 400, { error: { code: "password_unavailable", message: "Password sign-in is not enabled for this Home Court." } });
          return;
        }
        try {
          const input = validatePasswordChange(await readJson(request));
          const user = authStore.changePassword(actor.id, input.currentPassword, input.nextPassword);
          if (!user) {
            sendJson(response, 401, { error: { code: "password_incorrect", message: "Your current password is not correct." } });
            return;
          }
          const session = authStore.createSession(user.id, { ttlHours: config.runtime.agent4SessionHours || 24 * 7 });
          sendJson(response, 200, { changed: true, actor: session.user, csrfToken: session.csrfToken }, {
            "set-cookie": sessionCookie(session.token, {
              maxAge: Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
              secure: requestIsSecure(request, config)
            })
          });
        } catch (error) {
          sendJson(response, 400, { error: { code: "password_change_failed", message: error.message } });
        }
        return;
      }

      const memberTelegramRoute = /^\/api\/auth\/members\/([a-zA-Z0-9_-]{8,140})\/telegram$/.exec(requestUrl.pathname);
      if (request.method === "PUT" && memberTelegramRoute) {
        if (actor.role !== "owner") {
          sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can link Telegram accounts." } });
          return;
        }
        try {
          const input = await readJson(request);
          const member = authStore.linkTelegramUser(memberTelegramRoute[1], input.telegramUserId);
          sendJson(response, 200, { linked: true, member });
        } catch (error) {
          sendJson(response, 400, { error: { code: "telegram_link_failed", message: error.message } });
        }
        return;
      }

      const memberRoute = /^\/api\/auth\/members\/([a-zA-Z0-9_-]{8,140})$/.exec(requestUrl.pathname);
      if (request.method === "DELETE" && memberRoute) {
        if (actor.role !== "owner") {
          sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can remove teammates." } });
          return;
        }
        const userId = memberRoute[1];
        if (userId === actor.id) {
          sendJson(response, 400, { error: { code: "owner_protected", message: "The owner account cannot remove itself." } });
          return;
        }
        if (!authStore.revokeMember(userId)) {
          sendJson(response, 404, { error: { code: "member_not_found", message: "That teammate is unavailable." } });
          return;
        }
        disconnectUser(userId);
        sendJson(response, 200, { removed: userId, members: authStore.listUsers() });
        return;
      }

      const roomRoute = /^\/api\/rooms\/([a-z0-9-]+)(?:\/(history|restore|receipts|events|presence))?$/.exec(requestUrl.pathname);

      if (roomRoute) {
        const [, roomId, roomAction] = roomRoute;
        if (!validRoomId(roomId)) {
          sendJson(response, 400, { error: { code: "invalid_room", message: "Room id is invalid." } });
          return;
        }
        if (request.method === "GET" && !roomAction) {
          const room = roomStore.getRoom(roomId);
          sendJson(response, 200, { exists: Boolean(room), room, actor });
          return;
        }
        if (request.method === "GET" && roomAction === "events") {
          const clientId = /^[a-zA-Z0-9_-]{8,120}$/.test(requestUrl.searchParams.get("clientId") || "") ? requestUrl.searchParams.get("clientId") : "";
          openRoomEvents(roomId, actor, clientId, request, response);
          return;
        }
        if (request.method === "POST" && roomAction === "presence") {
          try {
            const input = validatePresence(await readJson(request, MAX_PRESENCE_REQUEST_BYTES));
            updatePresence(roomId, actor, input);
            sendJson(response, 200, { ok: true });
          } catch (error) {
            sendJson(response, error.statusCode || 400, { error: { code: "invalid_presence", message: error.message } });
          }
          return;
        }
        if (request.method === "PUT" && !roomAction) {
          let input;
          try {
            input = validateRoomSave(await readJson(request, MAX_ROOM_REQUEST_BYTES), actor);
            input.state = stampRoomAttribution(input.state, roomStore.getRoom(roomId)?.state, actor);
          } catch (error) {
            sendJson(response, error.statusCode || 400, { error: { code: "invalid_room_state", message: error.message } });
            return;
          }
          const saved = roomStore.saveRoom({
            id: roomId,
            name: roomId === "company-room" ? "Company room" : roomId,
            ...input,
            actorId: actor.id,
            actorName: actor.name
          });
          if (saved.conflict) {
            sendJson(response, 409, { error: { code: "room_conflict", message: "This room changed in another session." }, room: saved.room });
            return;
          }
          broadcast(roomId, { type: "room.updated", room: saved.room, actor, clientId: input.clientId });
          sendJson(response, 200, { room: saved.room });
          return;
        }
        if (request.method === "GET" && roomAction === "history") {
          sendJson(response, 200, { history: roomStore.listHistory(roomId, 40) });
          return;
        }
        if (request.method === "GET" && roomAction === "receipts") {
          sendJson(response, 200, { receipts: roomStore.listReceipts(roomId, 40) });
          return;
        }
        if (request.method === "POST" && roomAction === "receipts") {
          let input;
          try {
            input = validateReceipt(await readJson(request));
          } catch (error) {
            sendJson(response, error.statusCode || 400, { error: { code: "invalid_receipt", message: error.message } });
            return;
          }
          const recorded = roomStore.recordReceipt({
            ...input,
            roomId,
            actorId: actor.id,
            actorName: actor.name
          });
          if (recorded.missing) {
            sendJson(response, 404, { error: { code: "room_not_found", message: "Save the room before recording an operation." } });
            return;
          }
          broadcast(roomId, { type: "receipt.recorded", receipt: recorded.receipt, actor });
          sendJson(response, 200, { receipt: recorded.receipt });
          return;
        }
        if (request.method === "POST" && roomAction === "restore") {
          if (actor.role !== "owner") {
            sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can restore an earlier room version." } });
            return;
          }
          const body = await readJson(request);
          if (!Number.isInteger(body.version) || body.version < 1 || !Number.isInteger(body.baseVersion) || body.baseVersion < 1) {
            sendJson(response, 400, { error: { code: "invalid_restore", message: "A valid version and baseVersion are required." } });
            return;
          }
          const restored = roomStore.restoreRoom({
            id: roomId,
            version: body.version,
            baseVersion: body.baseVersion,
            actorId: actor.id,
            actorName: actor.name
          });
          if (restored.missing) {
            sendJson(response, 404, { error: { code: "revision_not_found", message: "That room version no longer exists." } });
            return;
          }
          if (restored.conflict) {
            sendJson(response, 409, { error: { code: "room_conflict", message: "This room changed in another session." }, room: restored.room });
            return;
          }
          broadcast(roomId, { type: "room.updated", room: restored.room, actor });
          sendJson(response, 200, { room: restored.room });
          return;
        }
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      // Companies and projects are shared team context. Pipeline dossiers and
      // Film Room clients remain authoritative in their own stores; these rows
      // hold the workspaces the team explicitly creates and organizes.
      if (requestUrl.pathname === "/api/workspaces" || requestUrl.pathname.startsWith("/api/workspaces/")) {
        const announce = () => broadcast("company-room", { type: "workspaces", at: new Date().toISOString(), by: actor.id });
        try {
          if (request.method === "GET" && requestUrl.pathname === "/api/workspaces") {
            const listing = workspaceStore.list();
            // What a deal is worth is money, so it is owner-only like the rest.
            if (actor.role !== "owner") listing.companies = listing.companies.map((company) => withoutDeal(company));
            sendJson(response, 200, listing);
            return;
          }
          if (request.method === "GET" && requestUrl.pathname === "/api/workspaces/github/repositories") {
            try {
              sendJson(response, 200, { repositories: await githubProjectReader.list({ limit: 100 }) });
            } catch (error) {
              sendJson(response, 502, {
                error: { code: String(error.code || "github_unavailable"), message: error.message || "GitHub is unavailable right now." }
              });
            }
            return;
          }
          if (request.method === "POST" && requestUrl.pathname === "/api/workspaces/companies") {
            // The new-company form, so a name already on file is refused rather
            // than quietly returning the old row with everything typed lost.
            const company = workspaceStore.createCompany({ ...ownerOnlyDeal(actor, await readJson(request)), actorId: actor.id });
            announce();
            sendJson(response, 200, { company: actor.role === "owner" ? company : withoutDeal(company) });
            return;
          }
          // One company's money, for its own page. Figures stay owner-only here
          // exactly as they are on the money routes.
          const companyMoneyRoute = /^\/api\/workspaces\/companies\/([a-zA-Z0-9:%._-]{1,200})\/money$/.exec(requestUrl.pathname);
          if (companyMoneyRoute && request.method === "GET") {
            if (actor.role !== "owner") {
              sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can see the company's money." } });
              return;
            }
            const companyId = decodeURIComponent(companyMoneyRoute[1]);
            const company = workspaceStore.getCompany(companyId);
            if (!company) throw new Error("That company no longer exists.");
            sendJson(response, 200, { money: moneyStore.companySummary({ companyId: company.id }) });
            return;
          }
          // One company's paperwork, for the same page. It is owner-only for
          // the same reason the money is: a proposal carries the price.
          const companyPaperworkRoute = /^\/api\/workspaces\/companies\/([a-zA-Z0-9:%._-]{1,200})\/paperwork$/.exec(requestUrl.pathname);
          if (companyPaperworkRoute && request.method === "GET") {
            if (actor.role !== "owner") {
              sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can see the company's paperwork." } });
              return;
            }
            const companyId = decodeURIComponent(companyPaperworkRoute[1]);
            const company = workspaceStore.getCompany(companyId);
            if (!company) throw new Error("That company no longer exists.");
            sendJson(response, 200, { documents: paperworkStore.companyPaperwork(company.id) });
            return;
          }
          // One dated line in the company's own history: a stage move, a note,
          // a meeting, a payment. Decisions are filed under a project, and a
          // relationship that has no project yet had nowhere to put any of this.
          const companyEventRoute = /^\/api\/workspaces\/companies\/([a-zA-Z0-9:%._-]{1,200})\/events$/.exec(requestUrl.pathname);
          if (companyEventRoute && request.method === "POST") {
            const event = workspaceStore.addCompanyEvent({
              ...(await readJson(request)),
              companyId: decodeURIComponent(companyEventRoute[1]),
              actorId: actor.id
            });
            announce();
            sendJson(response, 200, { event });
            return;
          }
          const companyRoute = /^\/api\/workspaces\/companies\/([a-zA-Z0-9:%._-]{1,200})$/.exec(requestUrl.pathname);
          if (companyRoute && request.method === "PATCH") {
            const company = workspaceStore.updateCompany(decodeURIComponent(companyRoute[1]), ownerOnlyDeal(actor, await readJson(request)));
            announce();
            sendJson(response, 200, { company: actor.role === "owner" ? company : withoutDeal(company) });
            return;
          }
          // Deleting says what goes with it. Without confirm=true nothing is
          // touched and the counts come back, so the warning can be shown first.
          if (companyRoute && request.method === "DELETE") {
            if (actor.role !== "owner") {
              sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can delete a company." } });
              return;
            }
            const result = workspaceStore.removeCompany(decodeURIComponent(companyRoute[1]), {
              confirm: requestUrl.searchParams.get("confirm") === "true"
            });
            if (result.removed) {
              // Its links stop opening and what was published for it is deleted.
              clientLinkStore.removeCompany(result.company?.id || decodeURIComponent(companyRoute[1]));
              clientQuestionnaireStore.removeCompany(result.company?.id || decodeURIComponent(companyRoute[1]));
              announce();
            }
            sendJson(response, 200, result);
            return;
          }
          if (request.method === "POST" && requestUrl.pathname === "/api/workspaces/projects") {
            const result = workspaceStore.createProject({ ...(await readJson(request)), actorId: actor.id });
            if (result.created) announce();
            sendJson(response, 200, result);
            return;
          }
          const projectGithubRoute = /^\/api\/workspaces\/projects\/([a-zA-Z0-9-]{8,64})\/github$/.exec(requestUrl.pathname);
          if (projectGithubRoute && request.method === "GET") {
            const project = workspaceStore.getProject(projectGithubRoute[1]);
            if (!project) throw new Error("That project no longer exists.");
            if (!project.repositoryUrl) {
              sendJson(response, 200, { connected: false, available: false, repository: null, commits: [], latest: null });
              return;
            }
            try {
              sendJson(response, 200, await githubProjectReader.read({ repositoryUrl: project.repositoryUrl, branch: project.repositoryBranch, limit: 8 }));
            } catch (error) {
              sendJson(response, 200, {
                connected: true,
                available: false,
                repository: { url: project.repositoryUrl, branch: project.repositoryBranch || "" },
                commits: [],
                latest: null,
                error: { code: String(error.code || "github_unavailable"), message: error.message || "GitHub is unavailable right now." }
              });
            }
            return;
          }
          const projectRoute = /^\/api\/workspaces\/projects\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
          if (projectRoute && request.method === "PATCH") {
            const project = workspaceStore.updateProject(projectRoute[1], await readJson(request));
            announce();
            sendJson(response, 200, { project });
            return;
          }
          if (projectRoute && request.method === "DELETE") {
            if (actor.role !== "owner") {
              sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can delete a project." } });
              return;
            }
            const result = workspaceStore.removeProject(projectRoute[1], {
              confirm: requestUrl.searchParams.get("confirm") === "true"
            });
            if (result.removed) announce();
            sendJson(response, 200, result);
            return;
          }
          const projectDecisionRoute = /^\/api\/workspaces\/projects\/([a-zA-Z0-9-]{8,64})\/decisions$/.exec(requestUrl.pathname);
          if (projectDecisionRoute && request.method === "POST") {
            const decision = workspaceStore.addDecision({ ...(await readJson(request)), projectId: projectDecisionRoute[1], actorId: actor.id });
            announce();
            sendJson(response, 200, { decision });
            return;
          }
          const projectResourceRoute = /^\/api\/workspaces\/projects\/([a-zA-Z0-9-]{8,64})\/resources$/.exec(requestUrl.pathname);
          if (projectResourceRoute && request.method === "POST") {
            const resource = workspaceStore.addResource({ ...(await readJson(request)), projectId: projectResourceRoute[1], actorId: actor.id });
            announce();
            sendJson(response, 200, { resource });
            return;
          }
          const decisionRoute = /^\/api\/workspaces\/decisions\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
          if (decisionRoute && request.method === "DELETE") {
            if (actor.role !== "owner") {
              sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can delete a decision." } });
              return;
            }
            if (!workspaceStore.removeDecision(decisionRoute[1])) throw new Error("That decision no longer exists.");
            announce();
            sendJson(response, 200, { removed: true });
            return;
          }
          const resourceRoute = /^\/api\/workspaces\/resources\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
          if (resourceRoute && request.method === "DELETE") {
            if (actor.role !== "owner") {
              sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can delete a resource." } });
              return;
            }
            if (!workspaceStore.removeResource(resourceRoute[1])) throw new Error("That resource no longer exists.");
            announce();
            sendJson(response, 200, { removed: true });
            return;
          }
          const companyEventItemRoute = /^\/api\/workspaces\/events\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
          if (companyEventItemRoute && request.method === "DELETE") {
            if (actor.role !== "owner") {
              sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can delete company history." } });
              return;
            }
            if (!workspaceStore.removeCompanyEvent(companyEventItemRoute[1])) throw new Error("That history entry no longer exists.");
            announce();
            sendJson(response, 200, { removed: true });
            return;
          }
          // Sheets are filled-in templates (discovery questions, kickoff
          // checklists) that belong to a company or one of its projects.
          // Answers merge key by key, so a phone in the meeting and a laptop
          // at the desk can write to the same sheet without clobbering.
          if (request.method === "POST" && requestUrl.pathname === "/api/workspaces/sheets") {
            const sheet = workspaceStore.createSheet({ ...(await readJson(request)), actorId: actor.id });
            announce();
            sendJson(response, 200, { sheet });
            return;
          }
          const sheetRoute = /^\/api\/workspaces\/sheets\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
          if (sheetRoute && request.method === "GET") {
            const sheet = workspaceStore.getSheet(sheetRoute[1]);
            if (!sheet) throw new Error("That sheet no longer exists.");
            sendJson(response, 200, { sheet });
            return;
          }
          if (sheetRoute && request.method === "PATCH") {
            const sheet = workspaceStore.updateSheet(sheetRoute[1], { ...(await readJson(request)), actorId: actor.id });
            announce();
            sendJson(response, 200, { sheet });
            return;
          }
          if (sheetRoute && request.method === "DELETE") {
            if (actor.role !== "owner") {
              sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can delete a company sheet." } });
              return;
            }
            if (!workspaceStore.removeSheet(sheetRoute[1])) throw new Error("That sheet no longer exists.");
            announce();
            sendJson(response, 200, { removed: true });
            return;
          }
          sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        } catch (error) {
          sendJson(response, error.statusCode === 403 ? 403 : 400, {
            error: {
              code: error.code || "workspace_rejected",
              message: error.message,
              ...(error.companyId ? { companyId: error.companyId } : {}),
              ...(error.projectId ? { projectId: error.projectId } : {})
            }
          });
        }
        return;
      }

      // Tasks are the team's, not the owner's: everybody signed in can see and
      // move the whole board. A change is pushed to whoever is looking.
      if (requestUrl.pathname === "/api/tasks" || requestUrl.pathname.startsWith("/api/tasks/")) {
        const announce = () => broadcast("company-room", { type: "tasks", at: new Date().toISOString(), by: actor.id });

        if (request.method === "GET" && requestUrl.pathname === "/api/tasks") {
          const assigneeParam = requestUrl.searchParams.get("assigneeId");
          const doneDaysParam = requestUrl.searchParams.get("doneWithinDays");
          try {
            const board = taskStore.queryTasks({
              assigneeId: assigneeParam === null ? undefined : assigneeParam === "none" ? null : assigneeParam,
              status: requestUrl.searchParams.get("status") || undefined,
              includeDone: requestUrl.searchParams.get("includeDone") === "true",
              doneWithinDays: doneDaysParam === null ? undefined : doneDaysParam === "all" ? null : Number(doneDaysParam),
              limit: Number(requestUrl.searchParams.get("limit")) || undefined
            });
            sendJson(response, 200, {
              tasks: board.tasks,
              total: board.total,
              truncated: board.truncated,
              workload: taskStore.workload({}),
              members: membersForActor(actor, authRequired ? authStore.listUsers() : [LOCAL_ACTOR])
            });
          } catch (error) {
            sendJson(response, 400, { error: { code: "tasks_failed", message: error.message } });
          }
          return;
        }

        if (request.method === "POST" && requestUrl.pathname === "/api/tasks") {
          try {
            const task = taskStore.createTask({ ...(await readJson(request)), actorId: actor.id });
            announce();
            sendJson(response, 200, { task });
          } catch (error) {
            sendJson(response, 400, { error: { code: "task_rejected", message: error.message } });
          }
          return;
        }

        if (request.method === "POST" && requestUrl.pathname === "/api/tasks/adopt") {
          try {
            const result = taskStore.adopt({ ...(await readJson(request)), actorId: actor.id });
            if (result.adopted) announce();
            sendJson(response, 200, result);
          } catch (error) {
            sendJson(response, 400, { error: { code: "task_rejected", message: error.message } });
          }
          return;
        }

        const commentsRoute = /^\/api\/tasks\/([a-zA-Z0-9-]{8,64})\/comments$/.exec(requestUrl.pathname);
        if (commentsRoute && request.method === "GET") {
          try {
            sendJson(response, 200, { comments: taskStore.listComments(commentsRoute[1]) });
          } catch (error) {
            sendJson(response, 404, { error: { code: "not_found", message: error.message } });
          }
          return;
        }
        if (commentsRoute && request.method === "POST") {
          try {
            const comment = taskStore.addComment(commentsRoute[1], { ...(await readJson(request)), actorId: actor.id });
            announce();
            sendJson(response, 200, { comment });
          } catch (error) {
            sendJson(response, 400, { error: { code: "comment_rejected", message: error.message } });
          }
          return;
        }

        const taskRoute = /^\/api\/tasks\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
        if (taskRoute && request.method === "PATCH") {
          try {
            const task = taskStore.updateTask(taskRoute[1], await readJson(request));
            const company = task.status === "done" ? workspaceStore.completeNextActionForTask(task) : null;
            announce();
            if (company) broadcast("company-room", { type: "workspaces", at: new Date().toISOString(), by: actor.id });
            sendJson(response, 200, { task });
          } catch (error) {
            sendJson(response, 400, { error: { code: "task_rejected", message: error.message } });
          }
          return;
        }
        if (taskRoute && request.method === "DELETE") {
          if (actor.role !== "owner") {
            sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can permanently delete a team task." } });
            return;
          }
          if (!taskStore.removeTask(taskRoute[1])) {
            sendJson(response, 404, { error: { code: "not_found", message: "That task no longer exists." } });
            return;
          }
          announce();
          sendJson(response, 200, { removed: true });
          return;
        }

        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      // Publishing is personal by default: each teammate keeps their own cadence,
      // while the same durable database powers the home summary and reward loop.
      if (requestUrl.pathname === "/api/content" || requestUrl.pathname.startsWith("/api/content/")) {
        const announce = () => broadcast("company-room", { type: "content", at: new Date().toISOString(), by: actor.id });
        const today = requestUrl.searchParams.get("today") || localIsoDate();

        if (request.method === "GET" && requestUrl.pathname === "/api/content/summary") {
          try {
            sendJson(response, 200, { summary: contentStore.contentSummary({ actorId: actor.id, today }) });
          } catch (error) {
            sendJson(response, 400, { error: { code: "content_failed", message: error.message } });
          }
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/content") {
          try {
            sendJson(response, 200, {
              posts: contentStore.listPosts({
                actorId: actor.id,
                platform: requestUrl.searchParams.get("platform") || undefined,
                status: requestUrl.searchParams.get("status") || undefined,
                from: requestUrl.searchParams.get("from") || undefined,
                to: requestUrl.searchParams.get("to") || undefined
              }),
              goals: contentStore.goals(actor.id),
              summary: contentStore.contentSummary({ actorId: actor.id, today })
            });
          } catch (error) {
            sendJson(response, 400, { error: { code: "content_failed", message: error.message } });
          }
          return;
        }
        if (request.method === "PUT" && requestUrl.pathname === "/api/content/goals") {
          try {
            const input = await readJson(request);
            const goals = contentStore.setGoal(actor.id, input.platform, input.weeklyTarget);
            announce();
            sendJson(response, 200, { goals });
          } catch (error) {
            sendJson(response, 400, { error: { code: "goal_rejected", message: error.message } });
          }
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/content") {
          try {
            const post = contentStore.createPost({ ...(await readJson(request)), actorId: actor.id });
            announce();
            sendJson(response, 200, { post });
          } catch (error) {
            sendJson(response, 400, { error: { code: "post_rejected", message: error.message } });
          }
          return;
        }
        const postRoute = /^\/api\/content\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
        if (postRoute && request.method === "PATCH") {
          try {
            const post = contentStore.updatePost(postRoute[1], await readJson(request), actor.id);
            announce();
            sendJson(response, 200, { post });
          } catch (error) {
            sendJson(response, 400, { error: { code: "post_rejected", message: error.message } });
          }
          return;
        }
        if (postRoute && request.method === "DELETE") {
          try {
            if (!contentStore.removePost(postRoute[1], actor.id)) {
              sendJson(response, 404, { error: { code: "not_found", message: "That post no longer exists." } });
              return;
            }
            announce();
            sendJson(response, 200, { removed: true });
          } catch (error) {
            sendJson(response, 403, { error: { code: "post_forbidden", message: error.message } });
          }
          return;
        }
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      if (requestUrl.pathname === "/api/momentum" || requestUrl.pathname === "/api/momentum/check-in") {
        const today = requestUrl.searchParams.get("today") || localIsoDate();
        try {
          if (request.method === "POST" && requestUrl.pathname === "/api/momentum/check-in") {
            const input = await readJson(request);
            const checkIn = contentStore.checkIn(actor.id, input.today || today);
            sendJson(response, 200, { checkIn });
            return;
          }
          if (request.method === "GET" && requestUrl.pathname === "/api/momentum") {
            const tasks = taskStore.listTasks({ assigneeId: actor.id, includeDone: true, limit: 1000 });
            sendJson(response, 200, {
              momentum: contentStore.momentum({ actorId: actor.id, tasks, today, days: requestUrl.searchParams.get("days") || 35 })
            });
            return;
          }
          sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        } catch (error) {
          sendJson(response, 400, { error: { code: "momentum_failed", message: error.message } });
        }
        return;
      }

      if (requestUrl.pathname === "/api/rhythm/settings") {
        const announce = () => broadcast("company-room", { type: "rhythm", at: new Date().toISOString(), by: actor.id });
        try {
          if (request.method === "GET") {
            sendJson(response, 200, { settings: plannerStore.getReminderSettings(actor.id) });
            return;
          }
          if (request.method === "PUT") {
            const settings = plannerStore.setReminderSettings(actor.id, await readJson(request));
            announce();
            sendJson(response, 200, { settings });
            return;
          }
          sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        } catch (error) {
          sendJson(response, 400, { error: { code: "rhythm_settings_failed", message: error.message } });
        }
        return;
      }

      if (requestUrl.pathname === "/api/goal-checkin") {
        const announce = () => broadcast("company-room", { type: "goal-checkin", at: new Date().toISOString(), by: actor.id });
        try {
          if (request.method === "PUT") {
            const input = await readJson(request);
            const day = input.day || localIsoDate();
            const week = weekBounds(day);
            const review = plannerStore.getWeeklyReview(actor.id, shiftIsoDate(week.start, -7));
            const tasks = taskStore.listTasks({ assigneeId: actor.id, includeDone: false, limit: 1000 });
            const gamePlan = buildWeeklyGamePlan({
              today: day,
              review,
              tasks: tasks.map((task) => ({ ...task, source: "hq" })),
              targetWeekStart: week.start
            });
            if (!gamePlan.target) throw new Error("Lock a weekly target before checking in.");
            const checkin = plannerStore.saveGoalCheckin(actor.id, day, {
              target: gamePlan.target,
              movedTarget: input.movedTarget
            });
            const goalTracker = buildGoalTracker(plannerStore, actor.id, {
              target: gamePlan.target,
              weekStart: week.start,
              today: day
            });
            announce();
            sendJson(response, 200, { checkin, goalTracker });
            return;
          }
          sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        } catch (error) {
          sendJson(response, 400, { error: { code: "goal_checkin_failed", message: error.message } });
        }
        return;
      }

      if (requestUrl.pathname === "/api/weekly-review") {
        const announce = () => broadcast("company-room", { type: "weekly-review", at: new Date().toISOString(), by: actor.id });
        try {
          if (request.method === "GET") {
            const today = requestUrl.searchParams.get("today") || localIsoDate();
            const week = weekBounds(today);
            const tasks = taskStore.listTasks({ assigneeId: actor.id, includeDone: true, limit: 1000 });
            const content = contentStore.contentSummary({ actorId: actor.id, today, cadenceDays: 35 });
            const momentum = contentStore.momentum({ actorId: actor.id, tasks, today, days: 35 });
            const inCurrentWeek = (item) => item.day >= week.start && item.day <= today;
            const summary = {
              instagramPosts: content.platforms.instagram.published,
              linkedinPosts: content.platforms.linkedin.published,
              tasksDone: tasks.filter((task) => task.completedAt && String(task.completedAt).slice(0, 10) >= week.start && String(task.completedAt).slice(0, 10) <= week.end).length,
              overdueTasks: tasks.filter((task) => task.status !== "done" && task.dueOn && task.dueOn < today).length,
              momentumPoints: momentum.weeklyPoints,
              postingMisses: ["instagram", "linkedin"].reduce((total, platform) => total + content.platforms[platform].daily.filter((item) => inCurrentWeek(item) && item.status === "missed").length, 0)
            };
            const isSunday = new Date(`${today}T12:00:00Z`).getUTCDay() === 0;
            const reviewWeekStart = isSunday ? week.start : shiftIsoDate(week.start, -7);
            const review = plannerStore.getWeeklyReview(actor.id, reviewWeekStart);
            const activeReview = plannerStore.getWeeklyReview(actor.id, shiftIsoDate(week.start, -7));
            const upcomingPlan = isSunday && Boolean(review);
            const targetWeekStart = upcomingPlan ? shiftIsoDate(week.start, 7) : week.start;
            const targetReview = upcomingPlan ? review : activeReview;
            const gamePlan = buildWeeklyGamePlan({
              today: upcomingPlan ? targetWeekStart : today,
              review: targetReview,
              tasks: tasks.map((task) => ({ ...task, source: "hq" })),
              targetWeekStart
            });
            const goalTracker = buildGoalTracker(plannerStore, actor.id, {
              target: gamePlan.target,
              weekStart: targetWeekStart,
              today
            });
            sendJson(response, 200, {
              review,
              reviewWeekStart,
              gamePlan,
              gamePlanPeriod: upcomingPlan ? "next" : "current",
              goalTracker,
              summary,
              week,
              isSunday
            });
            return;
          }
          if (request.method === "PUT") {
            const input = await readJson(request);
            const review = plannerStore.saveWeeklyReview(actor.id, input.weekStart, input);
            const targetWeekStart = shiftIsoDate(input.weekStart, 7);
            const tasks = taskStore.listTasks({ assigneeId: actor.id, includeDone: false, limit: 1000 });
            const gamePlan = buildWeeklyGamePlan({
              today: targetWeekStart,
              review,
              tasks: tasks.map((task) => ({ ...task, source: "hq" })),
              targetWeekStart
            });
            announce();
            sendJson(response, 200, { review, gamePlan });
            return;
          }
          sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        } catch (error) {
          sendJson(response, 400, { error: { code: "weekly_review_failed", message: error.message } });
        }
        return;
      }

      if (requestUrl.pathname === "/api/calendar" || requestUrl.pathname.startsWith("/api/calendar/")) {
        const announce = () => broadcast("company-room", { type: "calendar", at: new Date().toISOString(), by: actor.id });
        if (request.method === "GET" && requestUrl.pathname === "/api/calendar") {
          try {
            sendJson(response, 200, {
              events: plannerStore.listEvents({
                actorId: actor.id,
                from: requestUrl.searchParams.get("from") || undefined,
                to: requestUrl.searchParams.get("to") || undefined
              })
            });
          } catch (error) {
            sendJson(response, 400, { error: { code: "calendar_failed", message: error.message } });
          }
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/calendar") {
          try {
            const event = plannerStore.createEvent({ ...(await readJson(request)), actorId: actor.id });
            announce();
            sendJson(response, 200, { event });
          } catch (error) {
            sendJson(response, 400, { error: { code: "event_rejected", message: error.message } });
          }
          return;
        }
        const eventRoute = /^\/api\/calendar\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
        if (eventRoute && request.method === "PATCH") {
          try {
            const event = plannerStore.updateEvent(eventRoute[1], await readJson(request), actor.id);
            announce();
            sendJson(response, 200, { event });
          } catch (error) {
            sendJson(response, 400, { error: { code: "event_rejected", message: error.message } });
          }
          return;
        }
        if (eventRoute && request.method === "DELETE") {
          try {
            if (!plannerStore.removeEvent(eventRoute[1], actor.id)) {
              sendJson(response, 404, { error: { code: "not_found", message: "That event no longer exists." } });
              return;
            }
            announce();
            sendJson(response, 200, { removed: true });
          } catch (error) {
            sendJson(response, 403, { error: { code: "event_forbidden", message: error.message } });
          }
          return;
        }
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      // Film Room recordings are private to their uploader. Audio arrives in
      // small same-origin parts, is processed locally, and is deleted as soon
      // as the durable debrief has been written.
      if (requestUrl.pathname === "/api/client-memory") {
        if (request.method === "GET") {
          try {
            sendJson(response, 200, { memories: meetingStore.listClientMemories({ actorId: actor.id }) });
          } catch (error) {
            sendJson(response, 400, { error: { code: "client_memory_failed", message: error.message } });
          }
          return;
        }
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      if (requestUrl.pathname === "/api/meetings" || requestUrl.pathname.startsWith("/api/meetings/")) {
        const meetingRoute = /^\/api\/meetings\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
        const retryRoute = /^\/api\/meetings\/([a-zA-Z0-9-]{8,64})\/retry-debrief$/.exec(requestUrl.pathname);
        const recoveredNotesRoute = /^\/api\/meetings\/([a-zA-Z0-9-]{8,64})\/recovered-notes$/.exec(requestUrl.pathname);
        const audioRoute = /^\/api\/meetings\/([a-zA-Z0-9-]{8,64})\/audio$/.exec(requestUrl.pathname);
        const tasksRoute = /^\/api\/meetings\/([a-zA-Z0-9-]{8,64})\/tasks$/.exec(requestUrl.pathname);
        const followUpRoute = /^\/api\/meetings\/([a-zA-Z0-9-]{8,64})\/follow-up$/.exec(requestUrl.pathname);

        if (request.method === "GET" && requestUrl.pathname === "/api/meetings") {
          const page = meetingStore.listMeetings({
            actorId: actor.id,
            limit: Number(requestUrl.searchParams.get("limit")) || undefined,
            offset: Number(requestUrl.searchParams.get("offset")) || undefined
          });
          sendJson(response, 200, { ...page, limits: MEETING_LIMITS });
          return;
        }

        if (config.runtime.voiceTranscriptionEnabled === false && (
          (request.method === 'POST' && requestUrl.pathname === '/api/meetings') ||
          (audioRoute && !['GET','HEAD'].includes(request.method))
        )) {
          sendJson(response, 503, { error: { code: 'transcription_disabled', message: 'Audio transcription is off. Connect your own transcription service in .env before uploading a recording.' } }); return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/meetings") {
          try {
            const limitMessage = agentLimit(actor);
            if (limitMessage) {
              sendJson(response, 429, { error: { code: "agent_limit", message: limitMessage } });
              return;
            }
            const input = await readJson(request);
            if (input.consentConfirmed !== true) throw new Error("Confirm that everyone knows the meeting is being recorded.");
            const totalParts = Number(input.totalParts);
            if (!Number.isInteger(totalParts) || totalParts < 1 || totalParts > MEETING_LIMITS.maxParts) {
              throw new Error("That recording is too large for one Film Room upload.");
            }
            if (input.durationSeconds != null && (!Number.isInteger(Number(input.durationSeconds)) || Number(input.durationSeconds) < 1 || Number(input.durationSeconds) > MEETING_LIMITS.maxDurationSeconds)) {
              throw new Error("Meeting recordings can be at most 60 minutes.");
            }
            await checkMeetingTranscription({
              whisperEndpoint: config.runtime.voiceTranscriptionUrl,
              timeoutMs: 2_500
            });
            const meeting = meetingStore.createMeeting({
              actorId: actor.id,
              title: input.title,
              clientId: input.clientId,
              clientName: input.clientName,
              projectName: input.projectName,
              requestedLanguage: input.requestedLanguage,
              mimeType: normalizeMeetingMimeType(input.mimeType),
              durationSeconds: input.durationSeconds == null ? null : Number(input.durationSeconds),
              totalParts
            });
            agentUsage.push({ actorId: actor.id, timestamp: Date.now() });
            sendJson(response, 200, { meeting, limits: MEETING_LIMITS });
          } catch (error) {
            const transcriptionCode = ["TRANSCRIPTION_UNAVAILABLE", "INVALID_WHISPER_ENDPOINT"].includes(error?.code) ? error.code : null;
            sendJson(response, transcriptionCode ? 503 : 400, {
              error: {
                code: transcriptionCode || "meeting_rejected",
                message: transcriptionCode ? "The private transcription service is unavailable." : error.message
              }
            });
          }
          return;
        }

        if (meetingRoute && request.method === "GET") {
          const meeting = meetingStore.getMeeting(meetingRoute[1], actor.id);
          if (!meeting) {
            sendJson(response, 404, { error: { code: "not_found", message: "That meeting is unavailable." } });
            return;
          }
          sendJson(response, 200, { meeting });
          return;
        }

        if (retryRoute && request.method === "POST") {
          try {
            const meeting = meetingService.retryDebrief(retryRoute[1], actor.id);
            sendJson(response, 200, { meeting });
          } catch (error) {
            sendJson(response, 400, { error: { code: "meeting_retry_rejected", message: error.message } });
          }
          return;
        }

        if (recoveredNotesRoute && request.method === "POST") {
          try {
            const input = await readJson(request);
            if (!isRecord(input)) throw new Error("Send meeting notes as an object.");
            const existing = meetingStore.getMeeting(recoveredNotesRoute[1], actor.id);
            if (!existing || existing.status !== "failed" || !existing.transcript) throw new Error("A failed meeting needs a saved transcript before notes can be added.");
            const summary = typeof input.summary === "string" ? input.summary.trim().slice(0, 2_400) : "";
            if (!summary) throw new Error("Write a meeting summary before saving recovered notes.");
            const lines = (value, limit) => {
              if (value == null) return [];
              if (!Array.isArray(value)) throw new Error("Meeting note lists must be arrays.");
              return value.slice(0, limit).map((item) => {
                if (typeof item !== "string") throw new Error("Each meeting note must be text.");
                return item.trim().slice(0, 500);
              }).filter(Boolean);
            };
            const actions = input.actionItems == null ? [] : input.actionItems;
            if (!Array.isArray(actions)) throw new Error("Next steps must be an array.");
            const actionItems = actions.slice(0, 20).map((item) => {
              const action = typeof item === "string" ? { text: item } : item;
              const actionText = String(action?.text ?? "").trim().slice(0, 500);
              if (!actionText) return null;
              const owner = String(action?.owner ?? "").trim().slice(0, 120) || null;
              const dueOn = /^\d{4}-\d{2}-\d{2}$/.test(String(action?.dueOn || "")) ? String(action.dueOn) : null;
              return { text: actionText, owner, dueOn, confidence: action?.confidence === "inferred" ? "inferred" : "explicit", taskId: null };
            }).filter(Boolean);
            const decisions = lines(input.decisions, 12);
            const openQuestions = lines(input.openQuestions, 12);
            const risks = lines(input.risks, 12);
            const followUpDraft = typeof input.followUpDraft === "string" ? input.followUpDraft.trim().slice(0, 3_000) : "";
            await meetingService.removeAudio(existing.id);
            const meeting = meetingStore.completeMeeting(existing.id, actor.id, {
              recovered: true,
              title: existing.title,
              detectedLanguage: existing.requestedLanguage === "fa" ? "fa" : existing.requestedLanguage === "en" ? "en" : "mixed",
              summary,
              decisions,
              actionItems,
              openQuestions,
              risks,
              followUpDraft
            });
            meetingStore.markReadyNotified(meeting.id, actor.id);
            sendJson(response, 200, { meeting: meetingStore.getMeeting(meeting.id, actor.id) });
          } catch (error) {
            sendJson(response, 400, { error: { code: "recovered_notes_rejected", message: error.message } });
          }
          return;
        }

        if (meetingRoute && request.method === "PATCH") {
          try {
            const input = await readJson(request);
            const hasRecap = Object.hasOwn(input, "clientRecap");
            const hasMemory = ["clientId", "clientName", "projectName", "followUpOn"].some((key) => Object.hasOwn(input, key));
            if (!hasRecap && !hasMemory) throw new Error("Choose meeting details to update.");
            let meeting = meetingStore.getMeeting(meetingRoute[1], actor.id);
            if (!meeting) throw new Error("That meeting is unavailable.");
            if (hasRecap) meeting = meetingStore.updateClientRecap(meeting.id, actor.id, input.clientRecap);
            if (hasMemory) meeting = meetingStore.updateClientMemory(meeting.id, actor.id, input);
            sendJson(response, 200, { meeting });
          } catch (error) {
            sendJson(response, 400, { error: { code: "meeting_recap_rejected", message: error.message } });
          }
          return;
        }

        if (followUpRoute && request.method === "POST") {
          try {
            const meeting = meetingStore.getMeeting(followUpRoute[1], actor.id, { transcript: false });
            if (!meeting) throw new Error("That meeting is unavailable.");
            if (meeting.status !== "ready") throw new Error("Wait for the meeting notes first.");
            if (!meeting.clientName || !meeting.followUpOn) throw new Error("Choose a client and follow-up date first.");
            const farsi = meeting.detectedLanguage !== "en";
            const result = taskStore.adopt({
              title: farsi ? `پیگیری با ${meeting.clientName}` : `Follow up with ${meeting.clientName}`,
              notes: [
                farsi ? `از جلسه «${meeting.title}»` : `From meeting “${meeting.title}”`,
                meeting.summary
              ].filter(Boolean).join("\n\n"),
              assigneeId: actor.id,
              dueOn: meeting.followUpOn,
              priority: "normal",
              project: meeting.projectName || meeting.clientName,
              companyId: meeting.clientId,
              companyName: meeting.clientName,
              sourceKey: `meeting:${meeting.id}:followup`,
              actorId: actor.id
            });
            const updated = meetingStore.attachFollowUpTask(meeting.id, actor.id, result.task.id);
            if (result.adopted) broadcast("company-room", { type: "tasks", at: new Date().toISOString(), by: actor.id });
            sendJson(response, 200, { meeting: updated, task: result.task, created: result.adopted });
          } catch (error) {
            sendJson(response, 400, { error: { code: "meeting_followup_rejected", message: error.message } });
          }
          return;
        }

        if (audioRoute && request.method === "PUT") {
          try {
            const meeting = meetingStore.getMeeting(audioRoute[1], actor.id, { transcript: false });
            if (!meeting) throw new Error("That meeting upload is unavailable.");
            const part = Number(requestUrl.searchParams.get("part"));
            const bytes = await readBytes(request, MEETING_LIMITS.chunkBytes);
            const updated = await meetingService.acceptChunk({ meeting, actorId: actor.id, part, bytes });
            sendJson(response, 200, { meeting: updated });
          } catch (error) {
            sendJson(response, error.statusCode || (/too large/i.test(error.message) ? 413 : 400), { error: { code: "meeting_upload_failed", message: error.message } });
          }
          return;
        }

        if (tasksRoute && request.method === "POST") {
          try {
            const meeting = meetingStore.getMeeting(tasksRoute[1], actor.id);
            if (!meeting) throw new Error("That meeting is unavailable.");
            if (meeting.status !== "ready") throw new Error("Wait for the meeting notes first.");
            const input = await readJson(request);
            const indexes = [...new Set(Array.isArray(input.actionIndexes) ? input.actionIndexes.map(Number) : [])];
            if (!indexes.length || indexes.length > 20 || indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= meeting.actionItems.length)) {
              throw new Error("Choose at least one valid next move.");
            }
            const taskIdsByIndex = {};
            const tasks = [];
            let created = 0;
            const actorName = String(actor.name || "").trim().toLocaleLowerCase();
            for (const index of indexes) {
              const action = meeting.actionItems[index];
              const owner = String(action.owner || "").trim();
              const normalizedOwner = owner.toLocaleLowerCase();
              const selfOwned = ["me", "myself", "i", "من", actorName].filter(Boolean).includes(normalizedOwner);
              const noteParts = [
                meeting.detectedLanguage === "fa" ? `از جلسه «${meeting.title}»` : `From meeting “${meeting.title}”`,
                owner ? (meeting.detectedLanguage === "fa" ? `مسئول گفته‌شده: ${owner}` : `Named owner: ${owner}`) : "",
                action.confidence === "inferred" ? (meeting.detectedLanguage === "fa" ? "این کار از صحبت‌ها برداشت شده و صریح تأیید نشده بود." : "This move was inferred rather than explicitly assigned.") : ""
              ].filter(Boolean);
              const adopted = taskStore.adopt({
                title: action.text,
                notes: noteParts.join("\n"),
                assigneeId: selfOwned ? actor.id : null,
                dueOn: action.dueOn || null,
                priority: "normal",
                project: meeting.projectName || "Film Room",
                companyId: meeting.clientId,
                companyName: meeting.clientName,
                sourceKey: `meeting:${meeting.id}:action:${index}`,
                actorId: actor.id
              });
              taskIdsByIndex[index] = adopted.task.id;
              tasks.push(adopted.task);
              if (adopted.adopted) created += 1;
            }
            const updated = meetingStore.attachTaskIds(meeting.id, actor.id, taskIdsByIndex);
            if (created) broadcast("company-room", { type: "tasks", at: new Date().toISOString(), by: actor.id });
            sendJson(response, 200, { meeting: updated, tasks, created });
          } catch (error) {
            sendJson(response, 400, { error: { code: "meeting_tasks_rejected", message: error.message } });
          }
          return;
        }

        if (meetingRoute && request.method === "DELETE") {
          const meeting = meetingStore.getMeeting(meetingRoute[1], actor.id, { transcript: false });
          if (!meeting) {
            sendJson(response, 404, { error: { code: "not_found", message: "That meeting is unavailable." } });
            return;
          }
          await meetingService.removeAudio(meeting.id);
          meetingStore.removeMeeting(meeting.id, actor.id);
          sendJson(response, 200, { removed: true });
          return;
        }

        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      // Invoices sit behind the same owner boundary as the books they write to.
      if (requestUrl.pathname === "/api/invoices" || requestUrl.pathname.startsWith("/api/invoices/")) {
        if (actor.role !== "owner") {
          sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can see the company's invoices." } });
          return;
        }

        // `companyId` takes a company's id, or `none` for the invoices with no
        // company against them. Both are answered by the query rather than by
        // the screen, which could only sieve what fitted under the row cap.
        if (request.method === "GET" && requestUrl.pathname === "/api/invoices") {
          sendJson(response, 200, {
            invoices: invoiceStore.listInvoices({
              status: requestUrl.searchParams.get("status") || undefined,
              companyId: requestUrl.searchParams.get("companyId") || undefined
            }),
            profile: invoiceStore.getProfile(),
            nextNumber: invoiceStore.nextNumber()
          });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/invoices") {
          try {
            sendJson(response, 200, { invoice: invoiceStore.createInvoice({ ...(await readJson(request)), actorId: actor.id }) });
          } catch (error) {
            sendJson(response, 400, { error: { code: "invoice_rejected", message: error.message } });
          }
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/invoices/profile") {
          sendJson(response, 200, { profile: invoiceStore.getProfile() });
          return;
        }
        if (request.method === "PUT" && requestUrl.pathname === "/api/invoices/profile") {
          try {
            sendJson(response, 200, { profile: invoiceStore.setProfile(await readJson(request)) });
          } catch (error) {
            sendJson(response, 400, { error: { code: "invoice_profile_rejected", message: error.message } });
          }
          return;
        }

        const statusRoute = /^\/api\/invoices\/([a-zA-Z0-9-]{8,64})\/status$/.exec(requestUrl.pathname);
        if (statusRoute && request.method === "POST") {
          try {
            const input = await readJson(request);
            sendJson(response, 200, {
              invoice: invoiceStore.setStatus(statusRoute[1], input.status, { actorId: actor.id, paidOn: input.paidOn })
            });
          } catch (error) {
            sendJson(response, 400, { error: { code: "invoice_status_rejected", message: error.message } });
          }
          return;
        }

        const invoiceRoute = /^\/api\/invoices\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
        if (invoiceRoute && request.method === "GET") {
          const invoice = invoiceStore.getInvoice(invoiceRoute[1]);
          if (!invoice) {
            sendJson(response, 404, { error: { code: "not_found", message: "That invoice no longer exists." } });
            return;
          }
          sendJson(response, 200, { invoice, profile: invoiceStore.getProfile() });
          return;
        }
        if (invoiceRoute && request.method === "PATCH") {
          try {
            sendJson(response, 200, { invoice: invoiceStore.updateInvoice(invoiceRoute[1], await readJson(request)) });
          } catch (error) {
            sendJson(response, 400, { error: { code: "invoice_rejected", message: error.message } });
          }
          return;
        }
        if (invoiceRoute && request.method === "DELETE") {
          if (!invoiceStore.removeInvoice(invoiceRoute[1])) {
            sendJson(response, 404, { error: { code: "not_found", message: "That invoice no longer exists." } });
            return;
          }
          sendJson(response, 200, { removed: true });
          return;
        }

        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      // Paperwork sits behind the same owner boundary as the invoices it sits
      // beside: a proposal carries the price and an NDA carries the terms, so
      // neither belongs in a member's browser. What is stored is the answers,
      // never the printed page — the layout lives in the HQ client, so an old
      // document is redrawn by whatever the template has since become.
      // The Clients screen: every company's page in one place, and posting
      // progress to one. Owner only, for the same reason as the links below.
      if (requestUrl.pathname === "/api/client-pages" || requestUrl.pathname.startsWith("/api/client-pages/")) {
        if (actor.role !== "owner") {
          sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can manage client pages." } });
          return;
        }
        const reply = (result) => sendJson(response, result.status, result.body);
        const pageRoute = /^\/api\/client-pages\/([^/]{1,300})(\/post)?$/.exec(requestUrl.pathname);
        let pageCompany = "";
        try { pageCompany = pageRoute ? decodeURIComponent(pageRoute[1]) : ""; } catch { pageCompany = ""; }
        try {
          if (request.method === "GET" && requestUrl.pathname === "/api/client-pages") return reply(clientApi.overview());
          if (pageRoute && !pageRoute[2] && request.method === "GET") return reply(clientApi.page(pageCompany));
          if (pageRoute && pageRoute[2] && request.method === "POST") {
            const result = clientApi.post(pageCompany, await readJson(request), actor);
            if (result.status < 400) broadcast("company-room", { type: "paperwork", at: new Date().toISOString(), by: actor.id });
            return reply(result);
          }
        } catch (error) {
          sendJson(response, error.statusCode || 400, { error: { code: "client_page_rejected", message: error.message } });
          return;
        }
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      // What a client can see, and the links that let them see it. Owner only:
      // a link is the key to a client's page, and the list holds the keys.
      if (requestUrl.pathname === "/api/client-links" || requestUrl.pathname.startsWith("/api/client-links/")) {
        if (actor.role !== "owner") {
          sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can manage client links." } });
          return;
        }
        const reply = (result) => sendJson(response, result.status, result.body);
        const linkRoute = /^\/api\/client-links\/([a-zA-Z0-9-]{8,64})(\/revoke)?$/.exec(requestUrl.pathname);
        try {
          if (request.method === "GET" && requestUrl.pathname === "/api/client-links") {
            reply(clientApi.listLinks(requestUrl.searchParams.get("companyId") || ""));
            return;
          }
          if (request.method === "POST" && requestUrl.pathname === "/api/client-links") {
            reply(clientApi.createLink(await readJson(request), actor));
            return;
          }
          const sendRoute = /^\/api\/client-links\/([a-zA-Z0-9-]{8,64})\/questionnaires$/.exec(requestUrl.pathname);
          if (sendRoute && request.method === "POST") {
            reply(clientApi.sendQuestionnaire(sendRoute[1], await readJson(request), actor));
            return;
          }
          if (linkRoute && linkRoute[2] && request.method === "POST") {
            reply(clientApi.revokeLink(linkRoute[1]));
            return;
          }
          if (linkRoute && !linkRoute[2] && request.method === "PATCH") {
            reply(clientApi.updateLink(linkRoute[1], await readJson(request)));
            return;
          }
        } catch (error) {
          sendJson(response, error.statusCode || 400, { error: { code: "client_link_rejected", message: error.message } });
          return;
        }
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      if (requestUrl.pathname === "/api/client-questionnaires" || requestUrl.pathname.startsWith("/api/client-questionnaires/")) {
        if (actor.role !== "owner") {
          sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can read what clients answered." } });
          return;
        }
        const reply = (result) => sendJson(response, result.status, result.body);
        const questionnaireRoute = /^\/api\/client-questionnaires\/([a-zA-Z0-9-]{8,64})(?:\/(close|reopen|answers))?$/.exec(requestUrl.pathname);
        if (questionnaireRoute) {
          const [, id, action] = questionnaireRoute;
          if (request.method === "GET" && !action) return reply(clientApi.getQuestionnaire(id));
          if (request.method === "PUT" && action === "answers") {
            reply(clientApi.fillQuestionnaire(id, await readJson(request)));
            return;
          }
          if (request.method === "POST" && action && action !== "answers") {
            reply(clientApi.setQuestionnaire(id, action));
            return;
          }
          if (request.method === "DELETE" && !action) {
            reply(clientApi.setQuestionnaire(id, "remove"));
            return;
          }
        }
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      if (requestUrl.pathname === "/api/paperwork" || requestUrl.pathname.startsWith("/api/paperwork/")) {
        if (actor.role !== "owner") {
          sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can see the company's paperwork." } });
          return;
        }
        const announce = () => broadcast("company-room", { type: "paperwork", at: new Date().toISOString(), by: actor.id });

        // `companyId` takes a company's id, or `none` for the documents with no
        // company against them. Every filter is answered by the query rather
        // than by the screen, which could only sieve what fitted on one page.
        if (request.method === "GET" && requestUrl.pathname === "/api/paperwork") {
          try {
            sendJson(response, 200, paperworkStore.listDocuments({
              companyId: requestUrl.searchParams.get("companyId") || undefined,
              type: requestUrl.searchParams.get("type") || undefined,
              status: requestUrl.searchParams.get("status") || undefined,
              limit: requestUrl.searchParams.get("limit") || undefined,
              offset: requestUrl.searchParams.get("offset") || undefined
            }));
          } catch (error) {
            sendJson(response, 400, { error: { code: "paperwork_rejected", message: error.message } });
          }
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/paperwork") {
          try {
            const document = paperworkStore.createDocument({ ...(await readJson(request)), actorId: actor.id });
            announce();
            sendJson(response, 200, { document });
          } catch (error) {
            sendJson(response, 400, { error: { code: "paperwork_rejected", message: error.message } });
          }
          return;
        }

        // Putting a weekly update on the client's page, and taking it off again.
        const paperworkClientRoute = /^\/api\/paperwork\/([a-zA-Z0-9-]{8,64})\/(publish|withdraw|publication)$/.exec(requestUrl.pathname);
        if (paperworkClientRoute) {
          const [, documentId, action] = paperworkClientRoute;
          let result;
          if (action === "publication" && request.method === "GET") result = clientApi.publication(documentId);
          else if (action === "publish" && request.method === "POST") result = clientApi.publish(documentId, actor);
          else if (action === "withdraw" && request.method === "POST") result = clientApi.withdraw(documentId);
          if (result) {
            if (result.status < 400 && action !== "publication") announce();
            sendJson(response, result.status, result.body);
            return;
          }
        }

        const paperworkStatusRoute = /^\/api\/paperwork\/([a-zA-Z0-9-]{8,64})\/status$/.exec(requestUrl.pathname);
        if (paperworkStatusRoute && request.method === "POST") {
          try {
            const input = await readJson(request);
            const document = paperworkStore.setStatus(paperworkStatusRoute[1], input.status, { on: input.on });
            // A voided update must not stay on a client's page.
            if (document.status === "void") clientLinkStore.withdrawUpdate(document.id);
            announce();
            sendJson(response, 200, { document });
          } catch (error) {
            sendJson(response, 400, { error: { code: "paperwork_status_rejected", message: error.message } });
          }
          return;
        }

        const paperworkRoute = /^\/api\/paperwork\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
        if (paperworkRoute && request.method === "GET") {
          const document = paperworkStore.getDocument(paperworkRoute[1]);
          if (!document) {
            sendJson(response, 404, { error: { code: "not_found", message: "That document no longer exists." } });
            return;
          }
          sendJson(response, 200, { document });
          return;
        }
        if (paperworkRoute && request.method === "PATCH") {
          try {
            const before = paperworkStore.getDocument(paperworkRoute[1]);
            const document = paperworkStore.updateDocument(paperworkRoute[1], await readJson(request));
            // Written for one company, then filed under another: it must not keep
            // showing on the first one's page. Publish it again for the new one.
            if (before && before.companyId !== document.companyId) clientLinkStore.withdrawUpdate(document.id);
            announce();
            sendJson(response, 200, { document });
          } catch (error) {
            sendJson(response, 400, { error: { code: "paperwork_rejected", message: error.message } });
          }
          return;
        }
        if (paperworkRoute && request.method === "DELETE") {
          if (!paperworkStore.removeDocument(paperworkRoute[1])) {
            sendJson(response, 404, { error: { code: "not_found", message: "That document no longer exists." } });
            return;
          }
          // "The answers go with it" has to be true for the client's copy too.
          clientLinkStore.removeUpdate(paperworkRoute[1]);
          announce();
          sendJson(response, 200, { removed: true });
          return;
        }

        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }


      // Money is owner-only and is never embedded in the page: it is fetched
      // over these routes, so a member's browser is never sent the figures.
      if (requestUrl.pathname.startsWith("/api/money/")) {
        if (actor.role !== "owner") {
          sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can see the company's money." } });
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/api/money/summary") {
          const month = requestUrl.searchParams.get("month") || undefined;
          try {
            moneyStore.postDueRecurring({});
            sendJson(response, 200, {
              summary: moneyStore.summary({ month }),
              commitments: moneyStore.monthlyCommitments()
            });
          } catch (error) {
            sendJson(response, 400, { error: { code: "money_summary_failed", message: error.message } });
          }
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/api/money/report") {
          try {
            const period = requestUrl.searchParams.get("period") || undefined;
            const posted = moneyStore.postDueRecurring({});
            sendJson(response, 200, {
              posted: posted.length,
              cash: moneyStore.cashPosition({}),
              report: moneyStore.periodReport({ period }),
              settings: moneyStore.getSettings(),
              commitments: moneyStore.monthlyCommitments()
            });
          } catch (error) {
            sendJson(response, 400, { error: { code: "money_report_failed", message: error.message } });
          }
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/api/money/series") {
          try {
            sendJson(response, 200, {
              series: moneyStore.series({
                months: Number(requestUrl.searchParams.get("months")) || undefined,
                endMonth: requestUrl.searchParams.get("endMonth") || undefined
              })
            });
          } catch (error) {
            sendJson(response, 400, { error: { code: "money_series_failed", message: error.message } });
          }
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/api/money/cash") {
          sendJson(response, 200, { cash: moneyStore.cashPosition({}) });
          return;
        }
        if (request.method === "PUT" && requestUrl.pathname === "/api/money/settings/opening") {
          try {
            const input = await readJson(request);
            sendJson(response, 200, { settings: moneyStore.setOpeningBalance(input.currency, input.amount) });
          } catch (error) {
            sendJson(response, 400, { error: { code: "money_settings_rejected", message: error.message } });
          }
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/money/export.csv") {
          const csv = moneyStore.exportCsv();
          response.writeHead(200, {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="agent4-money.csv"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff"
          });
          response.end(request.method === "HEAD" ? null : csv);
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/api/money/settings") {
          sendJson(response, 200, { settings: moneyStore.getSettings() });
          return;
        }
        if (request.method === "PUT" && requestUrl.pathname === "/api/money/settings/inflation") {
          try {
            const input = await readJson(request);
            sendJson(response, 200, { settings: moneyStore.setInflation(input.currency, input.rate) });
          } catch (error) {
            sendJson(response, 400, { error: { code: "money_settings_rejected", message: error.message } });
          }
          return;
        }

        // `companyId` takes a company's id, or `none` for the entries with no
        // company against them — the ones a person goes looking for to fix.
        if (request.method === "GET" && requestUrl.pathname === "/api/money/entries") {
          try {
            sendJson(response, 200, {
              entries: moneyStore.listEntries({
                month: requestUrl.searchParams.get("month") || undefined,
                from: requestUrl.searchParams.get("from") || undefined,
                to: requestUrl.searchParams.get("to") || undefined,
                companyId: requestUrl.searchParams.get("companyId") || undefined,
                direction: requestUrl.searchParams.get("direction") || undefined,
                status: requestUrl.searchParams.get("status") || undefined,
                limit: Number(requestUrl.searchParams.get("limit")) || undefined
              })
            });
          } catch (error) {
            sendJson(response, 400, { error: { code: "money_list_failed", message: error.message } });
          }
          return;
        }

        if (request.method === "POST" && requestUrl.pathname === "/api/money/entries") {
          try {
            const entry = moneyStore.addEntry({ ...(await readJson(request)), actorId: actor.id });
            sendJson(response, 200, { entry });
          } catch (error) {
            sendJson(response, 400, { error: { code: "money_entry_rejected", message: error.message } });
          }
          return;
        }

        const entryRoute = /^\/api\/money\/entries\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
        if (entryRoute && request.method === "PATCH") {
          try {
            sendJson(response, 200, { entry: moneyStore.updateEntry(entryRoute[1], await readJson(request)) });
          } catch (error) {
            sendJson(response, 400, { error: { code: "money_entry_rejected", message: error.message } });
          }
          return;
        }
        if (entryRoute && request.method === "DELETE") {
          if (!moneyStore.removeEntry(entryRoute[1])) {
            sendJson(response, 404, { error: { code: "not_found", message: "That entry no longer exists." } });
            return;
          }
          sendJson(response, 200, { removed: true });
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/api/money/recurring") {
          sendJson(response, 200, { recurring: moneyStore.listRecurring({ activeOnly: true }) });
          return;
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/money/recurring") {
          try {
            const recurring = moneyStore.addRecurring({ ...(await readJson(request)), actorId: actor.id });
            sendJson(response, 200, { recurring });
          } catch (error) {
            sendJson(response, 400, { error: { code: "money_recurring_rejected", message: error.message } });
          }
          return;
        }
        const recurringRoute = /^\/api\/money\/recurring\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
        if (recurringRoute && request.method === "DELETE") {
          if (!moneyStore.stopRecurring(recurringRoute[1])) {
            sendJson(response, 404, { error: { code: "not_found", message: "That standing cost is already stopped." } });
            return;
          }
          sendJson(response, 200, { stopped: true });
          return;
        }

        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      if (requestUrl.pathname === "/api/files" || requestUrl.pathname.startsWith("/api/files/")) {
        // Proposals and agreements carry prices, so the shelf is the owner's.
        if (actor.role !== "owner") {
          sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can use the document shelf." } });
          return;
        }
        const fileRoute = /^\/api\/files\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
        const partRoute = /^\/api\/files\/([a-zA-Z0-9-]{8,64})\/part$/.exec(requestUrl.pathname);
        const finishRoute = /^\/api\/files\/([a-zA-Z0-9-]{8,64})\/finish$/.exec(requestUrl.pathname);
        const downloadRoute = /^\/api\/files\/([a-zA-Z0-9-]{8,64})\/download$/.exec(requestUrl.pathname);
        try {
          if (request.method === "GET" && requestUrl.pathname === "/api/files") {
            sendJson(response, 200, { files: fileStore.list({ companyId: requestUrl.searchParams.get("companyId") || undefined, kind: requestUrl.searchParams.get("kind") || undefined }) });
            return;
          }
          if (request.method === "POST" && requestUrl.pathname === "/api/files") {
            sendJson(response, 200, { file: fileStore.start({ ...(await readJson(request)), actorId: actor.id }) });
            return;
          }
          if (partRoute && request.method === "PUT") {
            const bytes = await readBytes(request, FILE_LIMITS.partBytes);
            sendJson(response, 200, { file: fileStore.appendPart(partRoute[1], Number(requestUrl.searchParams.get("offset")), bytes) });
            return;
          }
          if (finishRoute && request.method === "POST") {
            sendJson(response, 200, { file: fileStore.finish(finishRoute[1]) });
            return;
          }
          if (downloadRoute && request.method === "GET") {
            const found = fileStore.open(downloadRoute[1]);
            if (!found) { sendJson(response, 404, { error: { code: "not_found", message: "That file no longer exists." } }); return; }
            const ascii = found.file.name.replace(/[^\x20-\x7e]/g, "_");
            // Only ever a download: a stored page must never run as part of HQ.
            response.writeHead(200, {
              "content-type": /html|svg|xml|javascript/i.test(found.file.mime) ? "application/octet-stream" : found.file.mime,
              "content-length": found.size,
              "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(found.file.name)}`,
              "x-content-type-options": "nosniff",
              "cache-control": "private, no-store"
            });
            found.stream().pipe(response);
            return;
          }
          if (fileRoute && request.method === "PATCH") {
            sendJson(response, 200, { file: fileStore.update(fileRoute[1], await readJson(request)) });
            return;
          }
          if (fileRoute && request.method === "DELETE") {
            sendJson(response, fileStore.remove(fileRoute[1]) ? 200 : 404, { removed: true });
            return;
          }
        } catch (error) {
          sendJson(response, error.statusCode || 400, { error: { code: "file_rejected", message: error.message } });
          return;
        }
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      if (requestUrl.pathname === "/api/monitor/sites" || requestUrl.pathname.startsWith("/api/monitor/")) {
        // What your sites earn and what breaks on them is the owner's business.
        if (actor.role !== "owner") {
          sendJson(response, 403, { error: { code: "owner_required", message: "Only the owner can see the site monitor." } });
          return;
        }
        const siteRoute = /^\/api\/monitor\/sites\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
        const checkRoute = /^\/api\/monitor\/sites\/([a-zA-Z0-9-]{8,64})\/check$/.exec(requestUrl.pathname);
        const errorRoute = /^\/api\/monitor\/errors\/([a-zA-Z0-9-]{8,64})$/.exec(requestUrl.pathname);
        try {
          if (request.method === "GET" && requestUrl.pathname === "/api/monitor/sites") {
            sendJson(response, 200, { sites: monitorStore.overview() });
            return;
          }
          if (request.method === "POST" && requestUrl.pathname === "/api/monitor/sites") {
            const site = monitorStore.addSite({ ...(await readJson(request)), actorId: actor.id });
            // Look at it straight away so the first card is not blank.
            void monitorRunner.checkNow(site.id).catch((error) => console.error(`First check of ${site.url} failed: ${error.message}`));
            sendJson(response, 200, { site });
            return;
          }
          if (siteRoute && request.method === "GET") {
            const detail = monitorStore.detail(siteRoute[1]);
            if (!detail) { sendJson(response, 404, { error: { code: "not_found", message: "That site no longer exists." } }); return; }
            sendJson(response, 200, detail);
            return;
          }
          if (siteRoute && request.method === "PATCH") {
            sendJson(response, 200, { site: monitorStore.updateSite(siteRoute[1], await readJson(request)) });
            return;
          }
          if (siteRoute && request.method === "DELETE") {
            if (!monitorStore.removeSite(siteRoute[1])) { sendJson(response, 404, { error: { code: "not_found", message: "That site no longer exists." } }); return; }
            sendJson(response, 200, { removed: true });
            return;
          }
          if (checkRoute && request.method === "POST") {
            await monitorRunner.checkNow(checkRoute[1]);
            sendJson(response, 200, monitorStore.detail(checkRoute[1]));
            return;
          }
          if (errorRoute && request.method === "DELETE") {
            sendJson(response, monitorStore.removeError(errorRoute[1]) ? 200 : 404, { removed: true });
            return;
          }
        } catch (error) {
          sendJson(response, 400, { error: { code: "monitor_rejected", message: error.message } });
          return;
        }
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/agent4/status") {
        const status = await providerStatus(gatewayConfig);
        sendJson(response, 200, { provider: status.provider, ready: status.ready, model: status.model, message: status.message });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/agent4/chat") {
        let input;
        try {
          input = validateChatInput(await readJson(request));
        } catch (error) {
          sendJson(response, error.statusCode || 400, { error: { code: "invalid_request", message: error.message } });
          return;
        }
        const compact = gatewayConfig.runtime.aiProvider === "ollama";
        let context;
        try {
          context = buildAgentContext({ actor, today: input.today, workspaceStore, taskStore, meetingStore, plannerStore, monitorStore, compact });
        } catch (error) {
          console.error("Agent4 could not read the business for a chat.", error);
          sendJson(response, 500, { error: { code: "context_failed", message: "Agent4 could not read your clients and tasks just now." } });
          return;
        }
        // The common questions are answered from the data itself: instant, free,
        // and the same every time. Only the open-ended ones need the model.
        const quick = quickAnswer({ message: input.message, context });
        if (quick) {
          sendJson(response, 200, { reply: quick.reply, actions: sanitizeAgentActions(quick.actions, { actor, workspaceStore }), provider: "built-in", model: "" });
          return;
        }
        const limitMessage = chatLimit(actor);
        if (limitMessage) {
          sendJson(response, 429, { error: { code: "agent_limit", message: limitMessage } });
          return;
        }
        if (actionBusy) {
          sendJson(response, 429, { error: { code: "agent_busy", message: "Agent4 is still thinking about your last message." } });
          return;
        }
        chatUsage.push({ actorId: actor.id, timestamp: Date.now() });
        actionBusy = true;
        try {
          const result = await generateChat(gatewayConfig, { message: input.message, history: input.history, context });
          sendJson(response, 200, {
            reply: result.reply,
            actions: sanitizeAgentActions(result.actions, { actor, workspaceStore }),
            provider: result.provider || "",
            model: result.model || ""
          });
        } catch (error) {
          const publicError = publicAgentError(error);
          sendJson(response, publicError.status, { error: { code: publicError.code, message: publicError.message } });
        } finally {
          actionBusy = false;
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/agent4/actions") {
        if (actionBusy) {
          sendJson(response, 429, { error: { code: "agent_busy", message: "Agent4 is already working on another board action." } });
          return;
        }
        let input;
        try {
          input = validateActionInput(await readJson(request));
        } catch (error) {
          sendJson(response, error.statusCode || 400, { error: { code: "invalid_request", message: error.message } });
          return;
        }
        const limitMessage = agentLimit(actor);
        if (limitMessage) {
          sendJson(response, 429, { error: { code: "agent_limit", message: limitMessage } });
          return;
        }
        agentUsage.push({ actorId: actor.id, timestamp: Date.now() });
        actionBusy = true;
        try {
          const result = await generateAction(gatewayConfig, input);
          sendJson(response, 200, { result });
        } catch (error) {
          const publicError = publicAgentError(error);
          sendJson(response, publicError.status, { error: { code: publicError.code, message: publicError.message } });
        } finally {
          actionBusy = false;
        }
        return;
      }

      if (request.url?.startsWith("/api/")) {
        sendJson(response, 404, { error: { code: "not_found", message: "API route not found." } });
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
        return;
      }
      // The generated snapshot contains the owner's calendar agenda, sales
      // pipeline and business brief. Members build their personal screens from
      // actor-scoped APIs instead of receiving that owner-only bootstrap data.
      await serveFile(config.runtime.root, request, response, {
        redactSnapshot: authRequired && (!actor || actor.role !== "owner"),
        templatePath: config.runtime.hqTemplatePath
      });
    } catch (error) {
      // The caller gets nothing but a generic failure, on purpose. The server
      // log gets the whole thing, because an unexpected error that nobody ever
      // sees is a bug that never gets fixed.
      // A client page address is a credential, so it never reaches a log.
      console.error(`HQ request failed: ${request.method} ${String(request.url).split("?")[0].replace(/\/c\/[^/?#]+/, "/c/[link]").replace(/\/invites\/[^/]+/, "/invites/[token]")}`, error);
      sendJson(response, 500, { error: { code: "server_error", message: "The HQ server encountered an unexpected error." } });
    }
  });
  server.monitorRunner = monitorRunner;
  server.settingsStore = settingsStore;
  server.once("close", () => {
    roomListeners.forEach((listeners) => listeners.forEach((listener) => listener.response.end()));
    settingsStore.close();
    roomStore.close?.();
    authStore.close?.();
    moneyStore.close?.();
    invoiceStore.close?.();
    taskStore.close?.();
    workspaceStore.close?.();
    paperworkStore.close?.();
    clientLinkStore.close?.();
    clientQuestionnaireStore.close?.();
    contentStore.close?.();
    meetingService.close?.();
    meetingStore.close?.();
    monitorRunner.stop?.();
    fileStore.close?.();
    monitorStore.close?.();
    plannerStore.close?.();
  });
  return server;
}

// AGENT4_HQ_PORT stays authoritative because production pins it; PORT lets a dev
// harness hand us a free port instead of colliding on the default.
export async function startHqServer({
  port = Number(process.env.AGENT4_PORT || process.env.PORT || 8782),
  host = process.env.AGENT4_HOST || "127.0.0.1"
} = {}) {
  process.umask(0o077);
  const config = await loadConfig();
  // The container runs in UTC; every date HQ shows is the owner's day.
  applyOwnerTimeZone(config.runtime.ownerTimeZone);
  const server = createHqServer(config);
  // Checking starts with the real server only, never with a test's.
  if (server.settingsStore.get().modules.monitor) server.monitorRunner?.start();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  console.log(`Agent4 HQ: http://localhost:${port}/data/hq.html`);
  return server;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await startHqServer();
}
