import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildClientRecap } from "./meeting-recap.js";

const STATUSES = new Set(["uploading", "processing", "ready", "failed"]);
const LANGUAGES = new Set(["auto", "fa", "en", "mixed"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, limit = 400) {
  return String(value ?? "").trim().slice(0, limit);
}

function finiteInteger(value, min, max, fallback = null) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return fallback;
  return number;
}

function optionalDate(value, label = "Follow-up date") {
  const date = text(value, 10);
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date, `${label} must be a real YYYY-MM-DD date.`);
  return date;
}

function parseList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    // A meeting whose notes cannot be read still opens with its transcript,
    // rather than taking Film Room down, but the damage is said out loud
    // instead of looking like a meeting where nothing was decided.
    console.warn(`A meeting's notes could not be read (${error.message}); showing that list as empty.`);
    return [];
  }
}

function meetingFrom(row, { transcript = true, clientRecap = true } = {}) {
  if (!row) return null;
  const meeting = {
    id: row.id,
    actorId: row.actor_id,
    title: row.title,
    clientId: row.client_id || null,
    clientName: row.client_name || "",
    projectName: row.project_name || "",
    followUpOn: row.follow_up_on || null,
    followUpTaskId: row.follow_up_task_id || null,
    requestedLanguage: row.requested_language,
    detectedLanguage: row.detected_language || null,
    status: row.status,
    mimeType: row.mime_type,
    durationSeconds: row.duration_seconds,
    uploadParts: row.upload_parts,
    totalParts: row.total_parts,
    audioBytes: row.audio_bytes,
    ...(transcript ? { transcript: row.transcript || "" } : {}),
    summary: row.summary || "",
    decisions: parseList(row.decisions_json),
    actionItems: parseList(row.action_items_json),
    openQuestions: parseList(row.open_questions_json),
    risks: parseList(row.risks_json),
    followUpDraft: row.follow_up_draft || "",
    ...(clientRecap ? { clientRecap: row.client_recap || "" } : {}),
    readyNotifiedAt: row.ready_notified_at || null,
    errorCode: row.error_code || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    completedAt: row.completed_at || null
  };
  if (clientRecap && meeting.status === "ready" && !meeting.clientRecap) meeting.clientRecap = buildClientRecap(meeting);
  return meeting;
}

export function createMeetingStore(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_meetings (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      title TEXT NOT NULL,
      client_id TEXT,
      client_name TEXT,
      project_name TEXT,
      follow_up_on TEXT,
      follow_up_task_id TEXT,
      requested_language TEXT NOT NULL,
      detected_language TEXT,
      status TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      duration_seconds INTEGER,
      upload_parts INTEGER NOT NULL DEFAULT 0,
      total_parts INTEGER NOT NULL,
      audio_bytes INTEGER NOT NULL DEFAULT 0,
      transcript TEXT,
      summary TEXT,
      decisions_json TEXT NOT NULL DEFAULT '[]',
      action_items_json TEXT NOT NULL DEFAULT '[]',
      open_questions_json TEXT NOT NULL DEFAULT '[]',
      risks_json TEXT NOT NULL DEFAULT '[]',
      follow_up_draft TEXT,
      client_recap TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      completed_at TEXT,
      ready_notified_at TEXT
    );
    CREATE INDEX IF NOT EXISTS meetings_actor_created ON agent4_meetings(actor_id, created_at DESC);
  `);
  const columns = new Set(database.prepare("PRAGMA table_info(agent4_meetings)").all().map((column) => column.name));
  if (!columns.has("ready_notified_at")) {
    database.exec("ALTER TABLE agent4_meetings ADD COLUMN ready_notified_at TEXT");
    // Meetings completed before notifications existed must not all alert the
    // owner on the first deploy containing this migration.
    database.exec("UPDATE agent4_meetings SET ready_notified_at=completed_at WHERE status='ready'");
  }
  if (!columns.has("client_recap")) database.exec("ALTER TABLE agent4_meetings ADD COLUMN client_recap TEXT");
  if (!columns.has("client_id")) database.exec("ALTER TABLE agent4_meetings ADD COLUMN client_id TEXT");
  if (!columns.has("client_name")) database.exec("ALTER TABLE agent4_meetings ADD COLUMN client_name TEXT");
  if (!columns.has("project_name")) database.exec("ALTER TABLE agent4_meetings ADD COLUMN project_name TEXT");
  if (!columns.has("follow_up_on")) database.exec("ALTER TABLE agent4_meetings ADD COLUMN follow_up_on TEXT");
  if (!columns.has("follow_up_task_id")) database.exec("ALTER TABLE agent4_meetings ADD COLUMN follow_up_task_id TEXT");

  const selectMeeting = database.prepare("SELECT * FROM agent4_meetings WHERE id = ?");

  function getMeeting(id, actorId, options = {}) {
    const meeting = meetingFrom(selectMeeting.get(String(id || "")), options);
    if (!meeting || meeting.actorId !== String(actorId || "")) return null;
    return meeting;
  }

  function createMeeting(input = {}) {
    const actorId = text(input.actorId, 140);
    const title = text(input.title, 240) || "Untitled meeting";
    const requestedLanguage = text(input.requestedLanguage, 12).toLowerCase() || "auto";
    const mimeType = text(input.mimeType, 100).toLowerCase();
    const clientId = text(input.clientId, 180) || null;
    const clientName = text(input.clientName, 240);
    const projectName = text(input.projectName, 240);
    const totalParts = finiteInteger(input.totalParts, 1, 64);
    const durationSeconds = input.durationSeconds == null ? null : finiteInteger(input.durationSeconds, 1, 3_600);
    assert(actorId, "A meeting needs an owner.");
    assert(LANGUAGES.has(requestedLanguage), "Choose auto, Farsi, English, or mixed language.");
    assert(mimeType, "The meeting audio type is required.");
    assert(!clientId || clientName, "Choose a company name for this client memory.");
    assert(totalParts, "The meeting upload needs a valid part count.");
    if (input.durationSeconds != null) assert(durationSeconds, "Meeting recordings can be at most 60 minutes.");

    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_meetings
        (id,actor_id,title,client_id,client_name,project_name,requested_language,status,mime_type,duration_seconds,total_parts,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, actorId, title, clientId, clientName, projectName, requestedLanguage, "uploading", mimeType, durationSeconds, totalParts, new Date().toISOString());
    return getMeeting(id, actorId);
  }

  function recordUploadPart(id, actorId, { part, bytes }) {
    const meeting = getMeeting(id, actorId);
    assert(meeting, "That meeting upload is unavailable.");
    assert(meeting.status === "uploading", "That meeting is no longer accepting audio.");
    assert(Number.isInteger(part) && part === meeting.uploadParts, "Send meeting audio parts in order.");
    assert(Number.isInteger(bytes) && bytes > 0, "That audio part is empty.");
    const updatedAt = new Date().toISOString();
    database.prepare(`
      UPDATE agent4_meetings
      SET upload_parts = upload_parts + 1, audio_bytes = audio_bytes + ?, updated_at = ?
      WHERE id = ?
    `).run(bytes, updatedAt, meeting.id);
    return getMeeting(meeting.id, actorId);
  }

  function markProcessing(id, actorId) {
    const meeting = getMeeting(id, actorId);
    assert(meeting, "That meeting is unavailable.");
    assert(meeting.status === "uploading", "That meeting is not ready to process.");
    assert(meeting.uploadParts === meeting.totalParts, "Finish uploading the recording first.");
    database.prepare("UPDATE agent4_meetings SET status = 'processing', error_code = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), meeting.id);
    return getMeeting(meeting.id, actorId);
  }

  function saveTranscript(id, actorId, transcript) {
    const meeting = getMeeting(id, actorId);
    assert(meeting?.status === "processing", "That meeting is not being processed.");
    const readable = text(transcript, 200_000);
    assert(readable, "The meeting transcript is empty.");
    database.prepare("UPDATE agent4_meetings SET transcript=?, updated_at=? WHERE id=?")
      .run(readable, new Date().toISOString(), meeting.id);
    return getMeeting(meeting.id, actorId);
  }

  function retryDebrief(id, actorId) {
    const meeting = getMeeting(id, actorId);
    assert(meeting?.status === "failed" && meeting.transcript, "A transcript is needed before the notes can be retried.");
    database.prepare("UPDATE agent4_meetings SET status='processing', error_code=NULL, updated_at=? WHERE id=?")
      .run(new Date().toISOString(), meeting.id);
    return getMeeting(meeting.id, actorId);
  }

  function completeMeeting(id, actorId, input = {}) {
    const meeting = getMeeting(id, actorId);
    assert(meeting, "That meeting is unavailable.");
    const recovered = input.recovered === true;
    assert(meeting.status === "processing" || (recovered && meeting.status === "failed" && meeting.transcript),
      "A failed meeting needs its saved transcript before recovered notes can be added.");
    const detectedLanguage = text(input.detectedLanguage, 12).toLowerCase();
    assert(["fa", "en", "mixed"].includes(detectedLanguage), "The meeting language is invalid.");
    const completedAt = new Date().toISOString();
    const completedMeeting = {
      ...meeting,
      title: text(input.title, 240) || meeting.title,
      detectedLanguage,
      summary: text(input.summary, 8_000),
      decisions: Array.isArray(input.decisions) ? input.decisions.slice(0, 12) : [],
      actionItems: Array.isArray(input.actionItems) ? input.actionItems.slice(0, 20) : [],
      openQuestions: Array.isArray(input.openQuestions) ? input.openQuestions.slice(0, 12) : []
    };
    const clientRecap = text(input.clientRecap, 20_000) || buildClientRecap(completedMeeting);
    database.prepare(`
      UPDATE agent4_meetings
      SET title=?, detected_language=?, status='ready', transcript=?, summary=?, decisions_json=?,
          action_items_json=?, open_questions_json=?, risks_json=?, follow_up_draft=?, client_recap=?,
          error_code=NULL, updated_at=?, completed_at=?
      WHERE id=?
    `).run(
      text(input.title, 240) || meeting.title,
      detectedLanguage,
      recovered ? meeting.transcript : text(input.transcript, 200_000),
      text(input.summary, 8_000),
      JSON.stringify(Array.isArray(input.decisions) ? input.decisions.slice(0, 12) : []),
      JSON.stringify(Array.isArray(input.actionItems) ? input.actionItems.slice(0, 20) : []),
      JSON.stringify(Array.isArray(input.openQuestions) ? input.openQuestions.slice(0, 12) : []),
      JSON.stringify(Array.isArray(input.risks) ? input.risks.slice(0, 12) : []),
      text(input.followUpDraft, 8_000),
      clientRecap,
      completedAt,
      completedAt,
      meeting.id
    );
    return getMeeting(meeting.id, actorId);
  }

  function updateClientRecap(id, actorId, value) {
    const meeting = getMeeting(id, actorId, { transcript: false });
    assert(meeting, "That meeting is unavailable.");
    assert(meeting.status === "ready", "Wait for the meeting notes first.");
    const clientRecap = text(value, 20_000);
    assert(clientRecap, "The client recap cannot be empty.");
    database.prepare("UPDATE agent4_meetings SET client_recap=?, updated_at=? WHERE id=?")
      .run(clientRecap, new Date().toISOString(), meeting.id);
    return getMeeting(meeting.id, actorId);
  }

  function updateClientMemory(id, actorId, input = {}) {
    const meeting = getMeeting(id, actorId, { transcript: false });
    assert(meeting, "That meeting is unavailable.");
    assert(meeting.status === "ready", "Wait for the meeting notes first.");
    const clientId = Object.hasOwn(input, "clientId") ? text(input.clientId, 180) || null : meeting.clientId;
    const clientName = Object.hasOwn(input, "clientName") ? text(input.clientName, 240) : meeting.clientName;
    const projectName = Object.hasOwn(input, "projectName") ? text(input.projectName, 240) : meeting.projectName;
    const followUpOn = Object.hasOwn(input, "followUpOn") ? optionalDate(input.followUpOn) : meeting.followUpOn;
    assert(!clientId || clientName, "Choose a company name for this client memory.");
    assert(!followUpOn || clientName, "Choose a client before setting a follow-up.");
    database.prepare(`
      UPDATE agent4_meetings
      SET client_id=?, client_name=?, project_name=?, follow_up_on=?, updated_at=?
      WHERE id=?
    `).run(clientId, clientName, projectName, followUpOn, new Date().toISOString(), meeting.id);
    return getMeeting(meeting.id, actorId);
  }

  function attachFollowUpTask(id, actorId, taskId) {
    const meeting = getMeeting(id, actorId, { transcript: false });
    assert(meeting, "That meeting is unavailable.");
    assert(meeting.status === "ready", "Wait for the meeting notes first.");
    const followUpTaskId = text(taskId, 140);
    assert(followUpTaskId, "The follow-up task is unavailable.");
    database.prepare("UPDATE agent4_meetings SET follow_up_task_id=?, updated_at=? WHERE id=?")
      .run(followUpTaskId, new Date().toISOString(), meeting.id);
    return getMeeting(meeting.id, actorId);
  }

  function listClientMemories({ actorId, limit = 50 } = {}) {
    const id = text(actorId, 140);
    assert(id, "A meeting owner is required.");
    const capped = finiteInteger(limit, 1, 100, 50);
    const meetings = database.prepare(`
      SELECT * FROM agent4_meetings
      WHERE actor_id=? AND status='ready' AND client_name IS NOT NULL AND TRIM(client_name) != ''
      ORDER BY created_at DESC
      LIMIT ?
    `).all(id, Math.min(500, capped * 20)).map((row) => meetingFrom(row, { transcript: false, clientRecap: false }));
    const groups = new Map();
    for (const meeting of meetings) {
      const key = meeting.clientId || `name:${meeting.clientName.toLocaleLowerCase()}`;
      const memory = groups.get(key) || {
        key,
        clientId: meeting.clientId,
        clientName: meeting.clientName,
        latestAt: meeting.createdAt,
        latestSummary: meeting.summary,
        nextFollowUpOn: null,
        followUpTaskId: null,
        projects: [],
        openItems: [],
        meetings: []
      };
      const isLatestMeeting = memory.meetings.length === 0;
      if (meeting.projectName && !memory.projects.includes(meeting.projectName)) memory.projects.push(meeting.projectName);
      if (isLatestMeeting) {
        // The newest conversation replaces an older follow-up plan. Carrying an
        // unfinished date from a previous meeting makes Home Court lie about the
        // relationship's real next move.
        memory.nextFollowUpOn = meeting.followUpOn;
        memory.followUpTaskId = meeting.followUpTaskId;
        memory.openItems = meeting.openQuestions.slice(0, 4);
      }
      memory.meetings.push({
        id: meeting.id,
        title: meeting.title,
        projectName: meeting.projectName,
        summary: meeting.summary,
        decisions: meeting.decisions.slice(0, 4),
        openQuestions: meeting.openQuestions.slice(0, 4),
        actionItems: meeting.actionItems.filter((item) => item?.confidence !== "inferred").slice(0, 4),
        followUpOn: meeting.followUpOn,
        followUpTaskId: meeting.followUpTaskId,
        createdAt: meeting.createdAt
      });
      groups.set(key, memory);
    }
    return [...groups.values()]
      .sort((left, right) => {
        if (left.nextFollowUpOn && right.nextFollowUpOn) return left.nextFollowUpOn.localeCompare(right.nextFollowUpOn);
        if (left.nextFollowUpOn) return -1;
        if (right.nextFollowUpOn) return 1;
        return String(right.latestAt).localeCompare(String(left.latestAt));
      })
      .slice(0, capped);
  }

  function failMeeting(id, actorId, errorCode = "PROCESSING_FAILED") {
    const meeting = getMeeting(id, actorId);
    if (!meeting) return null;
    const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(String(errorCode || "")) ? errorCode : "PROCESSING_FAILED";
    database.prepare("UPDATE agent4_meetings SET status='failed', error_code=?, updated_at=? WHERE id=?")
      .run(code, new Date().toISOString(), meeting.id);
    return getMeeting(meeting.id, actorId);
  }

  function attachTaskIds(id, actorId, taskIdsByIndex = {}) {
    const meeting = getMeeting(id, actorId);
    assert(meeting, "That meeting is unavailable.");
    assert(meeting.status === "ready", "Wait for the meeting notes first.");
    const actions = meeting.actionItems.map((action, index) => {
      const taskId = text(taskIdsByIndex[index], 140);
      return taskId ? { ...action, taskId } : action;
    });
    database.prepare("UPDATE agent4_meetings SET action_items_json=?, updated_at=? WHERE id=?")
      .run(JSON.stringify(actions), new Date().toISOString(), meeting.id);
    return getMeeting(meeting.id, actorId);
  }

  /**
   * One page of an owner's meetings, newest first, and how many there are in
   * all. Capping without saying so made everything past the thirtieth meeting
   * unreachable: the list stopped and a link to an older one found nothing.
   *
   *   { meetings, total, limit, offset, hasMore }
   *
   * `offset` is the cursor: the next page is offset + limit, and hasMore says
   * whether there is one. A single meeting is still fetched by id through
   * getMeeting, whatever page it would have fallen on.
   */
  function listMeetings({ actorId, limit = 30, offset = 0 } = {}) {
    const id = text(actorId, 140);
    assert(id, "A meeting owner is required.");
    const capped = finiteInteger(limit, 1, 100, 30);
    const from = finiteInteger(offset, 0, 100_000, 0);
    const total = database.prepare("SELECT COUNT(*) AS total FROM agent4_meetings WHERE actor_id = ?").get(id).total;
    const meetings = database.prepare(`
      SELECT * FROM agent4_meetings
      WHERE actor_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(id, capped, from).map((row) => meetingFrom(row, { transcript: false, clientRecap: false }));
    return { meetings, total, limit: capped, offset: from, hasMore: from + meetings.length < total };
  }

  function listPendingMeetings({ limit = 100 } = {}) {
    const capped = finiteInteger(limit, 1, 500, 100);
    return database.prepare(`
      SELECT * FROM agent4_meetings
      WHERE status IN ('uploading', 'processing')
      ORDER BY created_at ASC
      LIMIT ?
    `).all(capped).map((row) => meetingFrom(row, { transcript: false, clientRecap: false }));
  }

  function listUnnotifiedReady({ limit = 30 } = {}) {
    const capped = finiteInteger(limit, 1, 100, 30);
    return database.prepare(`
      SELECT * FROM agent4_meetings
      WHERE status='ready' AND ready_notified_at IS NULL
      ORDER BY completed_at ASC
      LIMIT ?
    `).all(capped).map((row) => meetingFrom(row, { transcript: false, clientRecap: false }));
  }

  function markReadyNotified(id, actorId) {
    const meeting = getMeeting(id, actorId, { transcript: false });
    assert(meeting, "That meeting is unavailable.");
    assert(meeting.status === "ready", "Wait for the meeting notes first.");
    database.prepare(`
      UPDATE agent4_meetings
      SET ready_notified_at=COALESCE(ready_notified_at, ?)
      WHERE id=?
    `).run(new Date().toISOString(), meeting.id);
    return getMeeting(meeting.id, actorId, { transcript: false });
  }

  function removeMeeting(id, actorId) {
    const meeting = getMeeting(id, actorId);
    if (!meeting) return false;
    return database.prepare("DELETE FROM agent4_meetings WHERE id = ?").run(meeting.id).changes > 0;
  }

  return {
    createMeeting,
    getMeeting,
    recordUploadPart,
    markProcessing,
    saveTranscript,
    retryDebrief,
    completeMeeting,
    updateClientRecap,
    updateClientMemory,
    attachFollowUpTask,
    failMeeting,
    attachTaskIds,
    listMeetings,
    listPendingMeetings,
    listUnnotifiedReady,
    listClientMemories,
    markReadyNotified,
    removeMeeting,
    close: () => database.close()
  };
}
