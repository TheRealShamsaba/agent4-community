import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, limit = 300) {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeDate(value, label = "Date") {
  const date = text(value, 10);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), `${label} must be a YYYY-MM-DD date.`);
  assert(!Number.isNaN(Date.parse(`${date}T12:00:00Z`)), `${label} is not a real date.`);
  return date;
}

function normalizeTime(value) {
  if (!value) return null;
  const time = text(value, 5);
  assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(time), "Time must use HH:MM.");
  return time;
}

function normalizeDuration(value, hasTime) {
  if (!hasTime) return null;
  const duration = value === undefined || value === null || value === "" ? 60 : Number(value);
  assert(Number.isInteger(duration) && duration >= 15 && duration <= 720, "Duration must be between 15 minutes and 12 hours.");
  return duration;
}

function eventFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    startsOn: row.starts_on,
    startsAt: row.starts_at || null,
    durationMinutes: row.duration_minutes ?? null,
    notes: row.notes || "",
    externalId: row.external_id || null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at || null
  };
}

function reminderFrom(row, defaults = {}) {
  return {
    enabled: row ? Boolean(row.reminder_enabled) : true,
    remindAt: row?.reminder_at || "18:30",
    morningEnabled: row ? Boolean(row.morning_enabled) : true,
    morningAt: row?.morning_at || defaults.morningAt || "08:30",
    overdueEnabled: row ? Boolean(row.overdue_enabled) : true,
    overdueAt: row?.overdue_at || "10:30",
    weeklyEnabled: row ? Boolean(row.weekly_enabled) : true,
    weeklyAt: row?.weekly_at || defaults.weeklyAt || "18:00",
    updatedAt: row?.updated_at || null
  };
}

function reviewFrom(row) {
  if (!row) return null;
  return {
    weekStart: row.week_start,
    wins: row.wins || "",
    lessons: row.lessons || "",
    nextFocus: row.next_focus || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at || null
  };
}

function goalCheckinFrom(row) {
  if (!row) return null;
  return {
    actorId: row.actor_id,
    day: row.day,
    target: row.target,
    movedTarget: Boolean(row.moved_target),
    createdAt: row.created_at,
    updatedAt: row.updated_at || null
  };
}

function sessionFrom(row) {
  if (!row) return null;
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json || "{}");
  } catch {
    payload = {};
  }
  return {
    kind: row.kind,
    step: row.step,
    payload,
    updatedAt: row.updated_at
  };
}

function captureFrom(row) {
  if (!row) return null;
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json || "{}");
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    actorId: row.actor_id,
    kind: row.kind,
    payload,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null
  };
}

export function createPlannerStore(databasePath, options = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_calendar_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      starts_on TEXT NOT NULL,
      starts_at TEXT,
      duration_minutes INTEGER,
      notes TEXT,
      external_id TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS calendar_events_owner_day ON agent4_calendar_events(created_by, starts_on, starts_at);
    CREATE TABLE IF NOT EXISTS agent4_rhythm_settings (
      actor_id TEXT PRIMARY KEY,
      reminder_enabled INTEGER NOT NULL,
      reminder_at TEXT NOT NULL,
      morning_enabled INTEGER NOT NULL DEFAULT 1,
      morning_at TEXT NOT NULL DEFAULT '08:30',
      overdue_enabled INTEGER NOT NULL DEFAULT 1,
      overdue_at TEXT NOT NULL DEFAULT '10:30',
      weekly_enabled INTEGER NOT NULL DEFAULT 1,
      weekly_at TEXT NOT NULL DEFAULT '18:00',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent4_weekly_reviews (
      actor_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      wins TEXT,
      lessons TEXT,
      next_focus TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (actor_id, week_start)
    );
    CREATE INDEX IF NOT EXISTS weekly_reviews_owner_week ON agent4_weekly_reviews(actor_id, week_start DESC);
    CREATE TABLE IF NOT EXISTS agent4_goal_checkins (
      actor_id TEXT NOT NULL,
      day TEXT NOT NULL,
      target TEXT NOT NULL,
      moved_target INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (actor_id, day)
    );
    CREATE INDEX IF NOT EXISTS goal_checkins_owner_day ON agent4_goal_checkins(actor_id, day DESC);
    CREATE TABLE IF NOT EXISTS agent4_bot_sessions (
      actor_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      step TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent4_bot_deliveries (
      actor_id TEXT NOT NULL,
      delivery_key TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (actor_id, delivery_key)
    );
    CREATE INDEX IF NOT EXISTS bot_deliveries_owner_sent ON agent4_bot_deliveries(actor_id, sent_at DESC);
    CREATE TABLE IF NOT EXISTS agent4_capture_drafts (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS capture_drafts_owner_created ON agent4_capture_drafts(actor_id, created_at DESC);
  `);

  const calendarColumns = new Set(database.prepare("PRAGMA table_info(agent4_calendar_events)").all().map((column) => column.name));
  if (!calendarColumns.has("external_id")) {
    try {
      database.exec("ALTER TABLE agent4_calendar_events ADD COLUMN external_id TEXT;");
    } catch (error) {
      if (!/duplicate column name/i.test(String(error?.message || ""))) throw error;
    }
  }
  database.exec("CREATE INDEX IF NOT EXISTS calendar_events_external_id ON agent4_calendar_events(external_id);");

  const rhythmColumns = new Set(database.prepare("PRAGMA table_info(agent4_rhythm_settings)").all().map((column) => column.name));
  for (const [name, definition] of [
    ["morning_enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["morning_at", "TEXT NOT NULL DEFAULT '08:30'"],
    ["overdue_enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["overdue_at", "TEXT NOT NULL DEFAULT '10:30'"],
    ["weekly_enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["weekly_at", "TEXT NOT NULL DEFAULT '18:00'"]
  ]) {
    if (!rhythmColumns.has(name)) {
      try {
        database.exec(`ALTER TABLE agent4_rhythm_settings ADD COLUMN ${name} ${definition};`);
      } catch (error) {
        if (!/duplicate column name/i.test(String(error?.message || ""))) throw error;
      }
    }
  }

  const selectEvent = database.prepare("SELECT * FROM agent4_calendar_events WHERE id = ?");
  const selectExternalEvent = database.prepare("SELECT * FROM agent4_calendar_events WHERE external_id = ? ORDER BY created_at DESC LIMIT 1");

  function createEvent(input = {}) {
    const title = text(input.title, 240);
    const startsAt = normalizeTime(input.startsAt);
    assert(title, "An event needs a title.");
    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_calendar_events
        (id,title,starts_on,starts_at,duration_minutes,notes,external_id,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      title,
      normalizeDate(input.startsOn, "Event date"),
      startsAt,
      normalizeDuration(input.durationMinutes, Boolean(startsAt)),
      text(input.notes, 2000),
      text(input.externalId, 1024) || null,
      new Date().toISOString(),
      text(input.actorId, 140) || "unknown"
    );
    return eventFrom(selectEvent.get(id));
  }

  function updateEvent(id, updates = {}, actorId) {
    const existing = selectEvent.get(String(id || ""));
    assert(existing, "That event no longer exists.");
    assert(!actorId || existing.created_by === String(actorId), "That event belongs to someone else.");
    const next = {
      title: updates.title === undefined ? existing.title : text(updates.title, 240),
      startsOn: updates.startsOn === undefined ? existing.starts_on : normalizeDate(updates.startsOn, "Event date"),
      startsAt: updates.startsAt === undefined ? existing.starts_at : normalizeTime(updates.startsAt),
      notes: updates.notes === undefined ? existing.notes : text(updates.notes, 2000)
    };
    assert(next.title, "An event needs a title.");
    next.durationMinutes = updates.durationMinutes === undefined
      ? next.startsAt ? existing.duration_minutes || 60 : null
      : normalizeDuration(updates.durationMinutes, Boolean(next.startsAt));
    database.prepare(`
      UPDATE agent4_calendar_events
      SET title=?,starts_on=?,starts_at=?,duration_minutes=?,notes=?,updated_at=?
      WHERE id=?
    `).run(next.title, next.startsOn, next.startsAt, next.durationMinutes, next.notes, new Date().toISOString(), existing.id);
    return eventFrom(selectEvent.get(existing.id));
  }

  function removeEvent(id, actorId) {
    const existing = selectEvent.get(String(id || ""));
    if (!existing) return false;
    assert(!actorId || existing.created_by === String(actorId), "That event belongs to someone else.");
    return database.prepare("DELETE FROM agent4_calendar_events WHERE id = ?").run(existing.id).changes > 0;
  }

  function findEventByExternalId(externalId, actorId) {
    const event = eventFrom(selectExternalEvent.get(text(externalId, 1024)));
    if (!event || (actorId && event.createdBy !== String(actorId))) return null;
    return event;
  }

  function attachEventExternalId(id, externalId, actorId) {
    const existing = selectEvent.get(String(id || ""));
    assert(existing, "That event no longer exists.");
    assert(!actorId || existing.created_by === String(actorId), "That event belongs to someone else.");
    const external = text(externalId, 1024);
    assert(external, "An external event id is required.");
    database.prepare("UPDATE agent4_calendar_events SET external_id = ?, updated_at = ? WHERE id = ?")
      .run(external, new Date().toISOString(), existing.id);
    return eventFrom(selectEvent.get(existing.id));
  }

  function listEvents({ actorId, from, to, limit = 500 } = {}) {
    const clauses = [];
    const values = [];
    if (actorId) {
      clauses.push("created_by = ?");
      values.push(String(actorId));
    }
    if (from) {
      clauses.push("starts_on >= ?");
      values.push(normalizeDate(from, "From date"));
    }
    if (to) {
      clauses.push("starts_on <= ?");
      values.push(normalizeDate(to, "To date"));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const capped = Math.max(1, Math.min(1000, Number(limit) || 500));
    return database.prepare(`
      SELECT * FROM agent4_calendar_events ${where}
      ORDER BY starts_on ASC, COALESCE(starts_at, '99:99') ASC, created_at ASC
      LIMIT ?
    `).all(...values, capped).map(eventFrom);
  }

  function getReminderSettings(actorId) {
    const id = text(actorId, 140) || "unknown";
    return reminderFrom(database.prepare("SELECT * FROM agent4_rhythm_settings WHERE actor_id = ?").get(id), options);
  }

  function setReminderSettings(actorId, input = {}) {
    const id = text(actorId, 140) || "unknown";
    const current = getReminderSettings(id);
    const enabled = input.enabled === undefined ? current.enabled : Boolean(input.enabled);
    const remindAt = input.remindAt === undefined ? current.remindAt : normalizeTime(input.remindAt);
    const morningEnabled = input.morningEnabled === undefined ? current.morningEnabled : Boolean(input.morningEnabled);
    const morningAt = input.morningAt === undefined ? current.morningAt : normalizeTime(input.morningAt);
    const overdueEnabled = input.overdueEnabled === undefined ? current.overdueEnabled : Boolean(input.overdueEnabled);
    const overdueAt = input.overdueAt === undefined ? current.overdueAt : normalizeTime(input.overdueAt);
    const weeklyEnabled = input.weeklyEnabled === undefined ? current.weeklyEnabled : Boolean(input.weeklyEnabled);
    const weeklyAt = input.weeklyAt === undefined ? current.weeklyAt : normalizeTime(input.weeklyAt);
    assert(remindAt && morningAt && overdueAt && weeklyAt, "Every enabled nudge needs a valid time.");
    const updatedAt = new Date().toISOString();
    database.prepare(`
      INSERT INTO agent4_rhythm_settings
        (actor_id,reminder_enabled,reminder_at,morning_enabled,morning_at,overdue_enabled,overdue_at,weekly_enabled,weekly_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(actor_id) DO UPDATE SET
        reminder_enabled=excluded.reminder_enabled,
        reminder_at=excluded.reminder_at,
        morning_enabled=excluded.morning_enabled,
        morning_at=excluded.morning_at,
        overdue_enabled=excluded.overdue_enabled,
        overdue_at=excluded.overdue_at,
        weekly_enabled=excluded.weekly_enabled,
        weekly_at=excluded.weekly_at,
        updated_at=excluded.updated_at
    `).run(
      id,
      enabled ? 1 : 0,
      remindAt,
      morningEnabled ? 1 : 0,
      morningAt,
      overdueEnabled ? 1 : 0,
      overdueAt,
      weeklyEnabled ? 1 : 0,
      weeklyAt,
      updatedAt
    );
    return getReminderSettings(id);
  }

  function getWeeklyReview(actorId, weekStart) {
    const id = text(actorId, 140) || "unknown";
    const week = normalizeDate(weekStart, "Week start");
    return reviewFrom(database.prepare(`
      SELECT * FROM agent4_weekly_reviews WHERE actor_id = ? AND week_start = ?
    `).get(id, week));
  }

  function saveWeeklyReview(actorId, weekStart, input = {}) {
    const id = text(actorId, 140) || "unknown";
    const week = normalizeDate(weekStart, "Week start");
    const wins = text(input.wins, 2000);
    const lessons = text(input.lessons, 2000);
    const nextFocus = text(input.nextFocus, 1000);
    assert(wins || lessons || nextFocus, "Add at least one note before saving the review.");
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO agent4_weekly_reviews
        (actor_id,week_start,wins,lessons,next_focus,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(actor_id,week_start) DO UPDATE SET
        wins=excluded.wins,
        lessons=excluded.lessons,
        next_focus=excluded.next_focus,
        updated_at=excluded.updated_at
    `).run(id, week, wins, lessons, nextFocus, now, now);
    return getWeeklyReview(id, week);
  }

  function getGoalCheckin(actorId, day) {
    const id = text(actorId, 140) || "unknown";
    const checkedDay = normalizeDate(day, "Check-in day");
    return goalCheckinFrom(database.prepare(`
      SELECT * FROM agent4_goal_checkins WHERE actor_id = ? AND day = ?
    `).get(id, checkedDay));
  }

  function listGoalCheckins({ actorId, from, to, limit = 100 } = {}) {
    const id = text(actorId, 140) || "unknown";
    const conditions = ["actor_id = ?"];
    const values = [id];
    if (from) {
      conditions.push("day >= ?");
      values.push(normalizeDate(from, "Start date"));
    }
    if (to) {
      conditions.push("day <= ?");
      values.push(normalizeDate(to, "End date"));
    }
    const capped = Math.max(1, Math.min(366, Number(limit) || 100));
    return database.prepare(`
      SELECT * FROM agent4_goal_checkins
      WHERE ${conditions.join(" AND ")}
      ORDER BY day ASC
      LIMIT ?
    `).all(...values, capped).map(goalCheckinFrom);
  }

  function saveGoalCheckin(actorId, day, input = {}) {
    const id = text(actorId, 140) || "unknown";
    const checkedDay = normalizeDate(day, "Check-in day");
    const target = text(input.target, 1000);
    assert(target, "A goal check-in needs the target it measured.");
    assert(typeof input.movedTarget === "boolean", "Choose whether the day moved the target.");
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO agent4_goal_checkins
        (actor_id,day,target,moved_target,created_at,updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(actor_id,day) DO UPDATE SET
        target=excluded.target,
        moved_target=excluded.moved_target,
        updated_at=excluded.updated_at
    `).run(id, checkedDay, target, input.movedTarget ? 1 : 0, now, now);
    return getGoalCheckin(id, checkedDay);
  }

  function getBotSession(actorId) {
    const id = text(actorId, 140) || "unknown";
    return sessionFrom(database.prepare("SELECT * FROM agent4_bot_sessions WHERE actor_id = ?").get(id));
  }

  function setBotSession(actorId, input = {}) {
    const id = text(actorId, 140) || "unknown";
    const kind = text(input.kind, 80);
    const step = text(input.step, 80);
    assert(kind && step, "Bot session kind and step are required.");
    const payloadJson = JSON.stringify(input.payload && typeof input.payload === "object" ? input.payload : {});
    assert(payloadJson.length <= 6000, "Bot session context is too large.");
    database.prepare(`
      INSERT INTO agent4_bot_sessions (actor_id,kind,step,payload_json,updated_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(actor_id) DO UPDATE SET
        kind=excluded.kind,
        step=excluded.step,
        payload_json=excluded.payload_json,
        updated_at=excluded.updated_at
    `).run(id, kind, step, payloadJson, new Date().toISOString());
    return getBotSession(id);
  }

  function clearBotSession(actorId) {
    const id = text(actorId, 140) || "unknown";
    return database.prepare("DELETE FROM agent4_bot_sessions WHERE actor_id = ?").run(id).changes > 0;
  }

  function hasBotDelivery(actorId, deliveryKey) {
    const id = text(actorId, 140) || "unknown";
    const key = text(deliveryKey, 240);
    assert(key, "Delivery key is required.");
    return Boolean(database.prepare(`
      SELECT 1 FROM agent4_bot_deliveries WHERE actor_id = ? AND delivery_key = ?
    `).get(id, key));
  }

  function markBotDelivery(actorId, deliveryKey) {
    const id = text(actorId, 140) || "unknown";
    const key = text(deliveryKey, 240);
    assert(key, "Delivery key is required.");
    return database.prepare(`
      INSERT OR IGNORE INTO agent4_bot_deliveries (actor_id,delivery_key,sent_at) VALUES (?,?,?)
    `).run(id, key, new Date().toISOString()).changes > 0;
  }

  function createCaptureDraft(actorId, input = {}) {
    const id = randomUUID();
    const ownerId = text(actorId, 140) || "unknown";
    const kind = text(input.kind, 40);
    assert(["task", "task-update", "content", "posted", "note"].includes(kind), "Choose a supported capture type.");
    const payloadJson = JSON.stringify(input.payload && typeof input.payload === "object" ? input.payload : {});
    assert(payloadJson.length <= 6000, "Capture context is too large.");
    const createdAt = new Date().toISOString();
    database.prepare(`
      INSERT INTO agent4_capture_drafts (id,actor_id,kind,payload_json,status,created_at)
      VALUES (?,?,?,?,?,?)
    `).run(id, ownerId, kind, payloadJson, "ready", createdAt);
    return getCaptureDraft(ownerId, id);
  }

  function getCaptureDraft(actorId, draftId) {
    const ownerId = text(actorId, 140) || "unknown";
    return captureFrom(database.prepare(`
      SELECT * FROM agent4_capture_drafts WHERE id = ? AND actor_id = ?
    `).get(String(draftId || ""), ownerId));
  }

  function transitionCaptureDraft(actorId, draftId, from, to) {
    const ownerId = text(actorId, 140) || "unknown";
    const allowed = new Set(["ready", "executing", "confirmed", "cancelled"]);
    assert(allowed.has(from) && allowed.has(to), "Invalid capture transition.");
    const updatedAt = new Date().toISOString();
    const result = database.prepare(`
      UPDATE agent4_capture_drafts SET status = ?, updated_at = ?
      WHERE id = ? AND actor_id = ? AND status = ?
    `).run(to, updatedAt, String(draftId || ""), ownerId, from);
    return { changed: result.changes > 0, draft: getCaptureDraft(ownerId, draftId) };
  }

  function close() {
    database.close();
  }

  return {
    createEvent,
    updateEvent,
    removeEvent,
    findEventByExternalId,
    attachEventExternalId,
    listEvents,
    getReminderSettings,
    setReminderSettings,
    getWeeklyReview,
    saveWeeklyReview,
    getGoalCheckin,
    listGoalCheckins,
    saveGoalCheckin,
    getBotSession,
    setBotSession,
    clearBotSession,
    hasBotDelivery,
    markBotDelivery,
    createCaptureDraft,
    getCaptureDraft,
    transitionCaptureDraft,
    close
  };
}
