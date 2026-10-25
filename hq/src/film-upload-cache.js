import { getActiveActor } from "./room-actor.js";
/* Durable storage for audio Film Room is holding but has not delivered yet.

   Two separate things live here, because they fail at different moments:

   1. A finished recording or picked file that is waiting to upload, or is
      half-uploaded ("pending upload"). One record, one blob.
   2. A recording that is still running ("recording session"). Its chunks are
      written here as MediaRecorder hands them over, every few seconds, so the
      audio survives the tab closing, a crash, or the component being
      remounted mid-sentence. Before this existed a forty-minute client call
      lived only in a JavaScript array until the upload started, and switching
      nav tabs threw it away with no warning. */

const DATABASE_NAME = "agent4-film-room";
const DATABASE_VERSION = 2;
const UPLOAD_STORE = "uploads";
const CHUNK_STORE = "recording-chunks";
const pendingKey = () => `pending-upload:${getActiveActor().id}`;
const recordingKey = () => `recording:${getActiveActor().id}`;
const MAX_RECOVERY_AGE_MS = 24 * 60 * 60 * 1000;

function databaseAvailable() {
  return typeof window !== "undefined" && Boolean(window.indexedDB);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Browser storage is unavailable."));
  });
}

async function openDatabase() {
  if (!databaseAvailable()) return null;
  const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(UPLOAD_STORE)) database.createObjectStore(UPLOAD_STORE, { keyPath: "key" });
    if (!database.objectStoreNames.contains(CHUNK_STORE)) database.createObjectStore(CHUNK_STORE, { keyPath: "key" });
  };
  return requestResult(request);
}

/* One transaction across one or more stores. `operation` receives the stores in
   the order they were named. */
async function useStores(names, mode, operation) {
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(names, mode);
    const completion = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Browser storage is unavailable."));
      transaction.onabort = () => reject(transaction.error || new Error("Browser storage was interrupted."));
    });
    const result = await operation(...names.map((name) => transaction.objectStore(name)));
    await completion;
    return result;
  } finally {
    database.close();
  }
}

function useStore(mode, operation) {
  return useStores([UPLOAD_STORE], mode, operation);
}

function isFresh(record) {
  const savedAt = new Date(record?.savedAt || 0).getTime();
  return Number.isFinite(savedAt) && Date.now() - savedAt <= MAX_RECOVERY_AGE_MS;
}

/* ------------------------------------------------------------ the pending upload --- */

export async function loadPendingFilmUpload() {
  try {
    const pending = await useStore("readonly", (store) => requestResult(store.get(pendingKey())));
    if (pending && !isFresh(pending)) {
      await clearPendingFilmUpload();
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

export async function savePendingFilmUpload(upload) {
  if (!(upload?.blob instanceof Blob)) return false;
  try {
    await useStore("readwrite", (store) => requestResult(store.put({
      ...upload,
      key: pendingKey(),
      savedAt: new Date().toISOString()
    })));
    return true;
  } catch {
    return false;
  }
}

export async function clearPendingFilmUpload() {
  try {
    await useStore("readwrite", (store) => requestResult(store.delete(pendingKey())));
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------- the live recording --- */

function chunkKey(sessionId, index) {
  return `${sessionId}:${String(index).padStart(6, "0")}`;
}

function newSessionId() {
  return globalThis.crypto?.randomUUID?.() || `film-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* Open a recording session and throw away whatever an older one left behind.
   Returns the session id, or "" when the browser has no storage to offer — the
   recording still runs in that case, it simply cannot be recovered. */
export async function startRecordingSession(meta = {}) {
  const sessionId = newSessionId();
  try {
    await clearRecordingSession();
    await useStore("readwrite", (store) => requestResult(store.put({
      ...meta,
      key: recordingKey(),
      sessionId,
      savedAt: new Date().toISOString()
    })));
    return sessionId;
  } catch {
    return "";
  }
}

/* Write one MediaRecorder chunk. Deliberately fire-and-forget at the call site:
   a failed write must never interrupt the recording that is still running, and
   deliberately one store and one request, so the transaction cannot be closed
   by the browser half-way through the only copy of the audio. */
export async function appendRecordingChunk(sessionId, index, blob) {
  if (!sessionId || !(blob instanceof Blob) || !blob.size) return false;
  try {
    await useStores([CHUNK_STORE], "readwrite", (chunks) => requestResult(chunks.put({ key: chunkKey(sessionId, index), sessionId, index, blob })));
    return true;
  } catch {
    return false;
  }
}

/* Add what only becomes known once the recording stops or the composer changes
   underneath it (the title, the client, the final duration). */
export async function updateRecordingSession(sessionId, patch = {}) {
  if (!sessionId) return false;
  try {
    await useStore("readwrite", async (store) => {
      const session = await requestResult(store.get(recordingKey()));
      if (session?.sessionId !== sessionId) return;
      await requestResult(store.put({ ...session, ...patch, key: recordingKey(), sessionId, savedAt: new Date().toISOString() }));
    });
    return true;
  } catch {
    return false;
  }
}

/* Everything a recording that never reached the upload left behind, stitched
   back into one blob in the order the chunks arrived. */
export async function loadRecoveredRecording() {
  try {
    const session = await useStore("readonly", (store) => requestResult(store.get(recordingKey())));
    if (!session?.sessionId) return null;
    if (!isFresh(session)) {
      await clearRecordingSession();
      return null;
    }
    const parts = await useStores([CHUNK_STORE], "readonly", (chunks) => requestResult(chunks.getAll()));
    const ordered = (parts || [])
      .filter((part) => part.sessionId === session.sessionId && part.blob instanceof Blob)
      .sort((left, right) => left.index - right.index)
      .map((part) => part.blob);
    if (!ordered.length) {
      await clearRecordingSession();
      return null;
    }
    const mimeType = session.mimeType || ordered[0].type || "audio/webm";
    return { session, blob: new Blob(ordered, { type: mimeType }), mimeType, chunks: ordered.length };
  } catch {
    return null;
  }
}

export async function clearRecordingSession() {
  try {
    // Both requests are issued before either is awaited: an IndexedDB
    // transaction closes itself the moment it runs out of pending work.
    await useStores([CHUNK_STORE, UPLOAD_STORE], "readwrite", (chunks, uploads) => Promise.all([
      requestResult(chunks.clear()),
      requestResult(uploads.delete(recordingKey()))
    ]));
    return true;
  } catch {
    return false;
  }
}
