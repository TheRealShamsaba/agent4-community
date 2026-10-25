import { appendFile, chmod, mkdir, readFile, readdir, rm, stat, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { generateMeetingDebrief } from "./ai.js";
import { MEETING_TRANSCRIPTION_LIMITS, transcribeMeetingAudio } from "./transcription.js";

export const MEETING_LIMITS = Object.freeze({
  maxBytes: MEETING_TRANSCRIPTION_LIMITS.maxBytes,
  maxDurationSeconds: MEETING_TRANSCRIPTION_LIMITS.maxDurationSeconds,
  chunkBytes: 1024 * 1024,
  maxParts: 20
});

const SUPPORTED_AUDIO = new Set([
  "audio/ogg",
  "audio/opus",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mpeg",
  "audio/webm",
  "audio/wav",
  "audio/wave",
  "audio/x-wav"
]);

const DEFAULT_CAPACITY_RETRY_DELAYS = Object.freeze([30_000, 60_000, 120_000, 180_000]);

export function normalizeMeetingMimeType(value) {
  const mimeType = String(value || "").split(";", 1)[0].trim().toLowerCase();
  if (!SUPPORTED_AUDIO.has(mimeType)) throw new Error("Choose an MP3, M4A, WAV, OGG, or Opus recording.");
  return mimeType;
}

function safeMeetingId(value) {
  const id = String(value || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("That meeting is unavailable.");
  return id;
}

function processingCode(error) {
  const code = String(error?.code || "");
  if (code === "AI_TIMEOUT") return "MEETING_MODEL_TIMEOUT";
  if (/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
  if (error?.name === "AiCapacityError") return "MEETING_MODEL_BUSY";
  return "MEETING_PROCESSING_FAILED";
}

export function createMeetingService({
  config,
  store,
  transcribe = transcribeMeetingAudio,
  generateDebrief = generateMeetingDebrief,
  tempRoot = path.join("/tmp", "agent4-film-room"),
  uploadTtlMs = 30 * 60 * 1000,
  notifyComplete = null,
  capacityRetryDelays = DEFAULT_CAPACITY_RETRY_DELAYS,
  wait = delay
}) {
  let queue = Promise.resolve();
  let recoveryPromise = Promise.resolve();
  const expiryTimers = new Map();
  const notificationTimers = new Map();
  const uploadQueues = new Map();

  function audioPath(meetingId) {
    return path.join(tempRoot, `${safeMeetingId(meetingId)}.audio`);
  }

  async function ensureTempRoot() {
    await mkdir(tempRoot, { recursive: true, mode: 0o700 });
    await chmod(tempRoot, 0o700);
  }

  async function generateDebriefAfterCapacitySettles(input, meetingId) {
    const retryDelays = Array.isArray(capacityRetryDelays) ? capacityRetryDelays : DEFAULT_CAPACITY_RETRY_DELAYS;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await generateDebrief(config, input);
      } catch (error) {
        if (error?.name !== "AiCapacityError" || attempt >= retryDelays.length) throw error;
        const waitMs = Math.max(0, Number(retryDelays[attempt]) || 0);
        console.warn(`Film Room ${meetingId}: model capacity is busy; retrying debrief in ${Math.round(waitMs / 1000)}s.`);
        await wait(waitMs);
      }
    }
  }

  async function processMeeting(meetingId, actorId) {
    clearUploadExpiry(meetingId);
    const meeting = store.getMeeting(meetingId, actorId);
    if (!meeting || meeting.status !== "processing") return;
    const filePath = audioPath(meeting.id);
    let stage = "transcription";
    try {
      let transcript = meeting.transcript;
      if (!transcript) {
        const audio = await readFile(filePath);
        transcript = await transcribe(audio, {
          mimeType: meeting.mimeType,
          language: meeting.requestedLanguage,
          whisperEndpoint: config.runtime.voiceTranscriptionUrl,
          transcriptionTimeoutMs: MEETING_TRANSCRIPTION_LIMITS.transcriptionTimeoutMs,
          maxTranscriptChars: MEETING_TRANSCRIPTION_LIMITS.maxTranscriptChars
        });
        store.saveTranscript(meeting.id, actorId, transcript);
      }
      stage = "debrief";
      // Once the words are durable, a restart or model failure can retry notes
      // without retaining or uploading the private recording again.
      await rm(filePath, { force: true });
      const debrief = await generateDebriefAfterCapacitySettles({
        transcript,
        title: meeting.title,
        requestedLanguage: meeting.requestedLanguage
      }, meeting.id);
      const completed = store.completeMeeting(meeting.id, actorId, { ...debrief, transcript });
      // The durable notes are enough from this point forward. Remove the raw
      // recording before announcing readiness so "ready" never races privacy.
      await rm(filePath, { force: true });
      await deliverReadyNotification(completed);
    } catch (error) {
      await rm(filePath, { force: true }).catch(() => {});
      const code = processingCode(error);
      console.warn(`Film Room ${meeting.id} failed during ${stage} (${code}; ${error?.name || "Error"}).`);
      store.failMeeting(meeting.id, actorId, code);
    } finally {
      await rm(filePath, { force: true }).catch(() => {});
    }
  }

  async function deliverReadyNotification(meeting, attempt = 0) {
    if (typeof notifyComplete !== "function" || !meeting || meeting.status !== "ready" || meeting.readyNotifiedAt) return;
    try {
      await notifyComplete(meeting);
      store.markReadyNotified(meeting.id, meeting.actorId);
      const timer = notificationTimers.get(meeting.id);
      if (timer) clearTimeout(timer);
      notificationTimers.delete(meeting.id);
    } catch {
      if (attempt >= 2 || notificationTimers.has(meeting.id)) return;
      const timer = setTimeout(() => {
        notificationTimers.delete(meeting.id);
        const current = store.getMeeting(meeting.id, meeting.actorId, { transcript: false });
        void deliverReadyNotification(current, attempt + 1);
      }, 15_000 * (attempt + 1));
      timer.unref?.();
      notificationTimers.set(meeting.id, timer);
    }
  }

  function enqueue(meetingId, actorId) {
    queue = queue.then(() => processMeeting(meetingId, actorId), () => processMeeting(meetingId, actorId));
    // The durable meeting row carries success/failure. Do not leave an
    // unhandled background rejection attached to the HTTP request lifecycle.
    queue = queue.catch(() => {});
  }

  function clearUploadExpiry(meetingId) {
    const timer = expiryTimers.get(meetingId);
    if (timer) clearTimeout(timer);
    expiryTimers.delete(meetingId);
  }

  function scheduleUploadExpiry(meetingId, actorId, delayMs = uploadTtlMs) {
    clearUploadExpiry(meetingId);
    const timer = setTimeout(async () => {
      expiryTimers.delete(meetingId);
      const meeting = store.getMeeting(meetingId, actorId);
      if (meeting?.status !== "uploading") return;
      await rm(audioPath(meetingId), { force: true }).catch(() => {});
      store.failMeeting(meetingId, actorId, "MEETING_UPLOAD_EXPIRED");
    }, Math.max(0, delayMs));
    timer.unref?.();
    expiryTimers.set(meetingId, timer);
  }

  async function acceptChunkInternal({ meeting, actorId, part, bytes }) {
    if (!meeting || meeting.actorId !== String(actorId || "")) throw new Error("That meeting upload is unavailable.");
    const current = store.getMeeting(meeting.id, actorId, { transcript: false });
    if (!current) throw new Error("That meeting upload is unavailable.");
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) throw new Error("That audio part is empty.");
    if (bytes.byteLength > MEETING_LIMITS.chunkBytes) throw new Error("That audio part is too large.");
    if (!Number.isInteger(part) || part < 0) throw new Error("Send meeting audio parts in order.");
    // A mobile client may retry after the server committed a chunk but its
    // response was lost. Return the durable position instead of appending it
    // twice or forcing the user to restart the recording.
    if (part < current.uploadParts || (["processing", "ready"].includes(current.status) && part < current.totalParts)) return current;
    if (current.status !== "uploading" || part !== current.uploadParts) throw new Error("Send meeting audio parts in order.");
    if (current.audioBytes + bytes.byteLength > MEETING_LIMITS.maxBytes) throw new Error("Meeting recordings can be at most 20 MB.");

    await ensureTempRoot();
    const filePath = audioPath(current.id);
    if (part === 0) {
      await writeFile(filePath, bytes, { flag: "w", mode: 0o600 });
      scheduleUploadExpiry(meeting.id, actorId);
    }
    else await appendFile(filePath, bytes);
    const updated = store.recordUploadPart(current.id, actorId, { part, bytes: bytes.byteLength });
    if (updated.uploadParts === updated.totalParts) {
      clearUploadExpiry(updated.id);
      const processing = store.markProcessing(updated.id, actorId);
      enqueue(processing.id, actorId);
      return processing;
    }
    return updated;
  }

  function acceptChunk(input) {
    const meetingId = safeMeetingId(input?.meeting?.id);
    const previous = uploadQueues.get(meetingId) || Promise.resolve();
    const next = Promise.all([recoveryPromise, previous]).then(() => acceptChunkInternal(input));
    const settled = next.catch(() => {});
    uploadQueues.set(meetingId, settled);
    return next.finally(() => {
      if (uploadQueues.get(meetingId) === settled) uploadQueues.delete(meetingId);
    });
  }

  async function performRecovery() {
    await ensureTempRoot();
    const pending = store.listPendingMeetings();
    const pendingFiles = new Set(pending.map((meeting) => `${meeting.id}.audio`));
    for (const entry of await readdir(tempRoot, { withFileTypes: true })) {
      if (entry.isFile() && /^[0-9a-f-]{36}\.audio$/i.test(entry.name) && !pendingFiles.has(entry.name)) {
        await rm(path.join(tempRoot, entry.name), { force: true }).catch(() => {});
      }
    }

    for (const meeting of pending) {
      const filePath = audioPath(meeting.id);
      const details = await stat(filePath).catch(() => null);
      if (!details && meeting.audioBytes > 0 && !meeting.transcript) {
        store.failMeeting(meeting.id, meeting.actorId, "MEETING_INTERRUPTED");
        continue;
      }
      if (details && details.size < meeting.audioBytes) {
        await rm(filePath, { force: true }).catch(() => {});
        store.failMeeting(meeting.id, meeting.actorId, "MEETING_INTERRUPTED");
        continue;
      }
      if (details && details.size > meeting.audioBytes) await truncate(filePath, meeting.audioBytes);
      if (meeting.status === "processing") {
        enqueue(meeting.id, meeting.actorId);
        continue;
      }
      const updatedAt = new Date(meeting.updatedAt || meeting.createdAt).getTime();
      const elapsed = Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : 0;
      scheduleUploadExpiry(meeting.id, meeting.actorId, uploadTtlMs - elapsed);
    }
    for (const meeting of store.listUnnotifiedReady()) void deliverReadyNotification(meeting);
  }

  function recoverPending() {
    recoveryPromise = recoveryPromise.then(performRecovery);
    return recoveryPromise;
  }

  function retryDebrief(meetingId, actorId) {
    const meeting = store.retryDebrief(meetingId, actorId);
    enqueue(meeting.id, actorId);
    return meeting;
  }

  async function removeAudio(meetingId) {
    clearUploadExpiry(meetingId);
    await rm(audioPath(meetingId), { force: true }).catch(() => {});
  }

  function close() {
    expiryTimers.forEach((timer) => clearTimeout(timer));
    expiryTimers.clear();
    notificationTimers.forEach((timer) => clearTimeout(timer));
    notificationTimers.clear();
  }

  return { acceptChunk, recoverPending, retryDebrief, removeAudio, close };
}
