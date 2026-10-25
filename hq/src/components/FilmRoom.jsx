import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCopy,
  Clock3,
  FileAudio,
  FileText,
  History,
  Languages,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Mic2,
  Play,
  Plus,
  Save,
  Share2,
  ShieldCheck,
  Square,
  Trash2,
  TriangleAlert,
  Upload,
  Wand2
} from "lucide-react";
import { filmCacheForActor } from "../film-upload-cache.js";
import { createActorStorage } from "../actor-storage.js";
import { getActiveActor } from "../room-actor.js";
import { dueLabel, formatDate, isOverdue, localIsoDate } from "../format.js";
import { ConfirmDialog, FilmNotice, ListFailure, ProcessingPanel } from "./FilmRoomStates.jsx";

const FALLBACK_LIMITS = { maxBytes: 20 * 1024 * 1024, maxDurationSeconds: 3600, chunkBytes: 1024 * 1024, maxParts: 20 };
const PAGE_SIZE = 30;
const SESSION_KEY = "agent4.film-room.session";
/* The shell calls a phone "compact" at this width (App.jsx). Film Room repeats
   the query rather than assuming the prop arrives, because when it does not the
   copy says "on this phone" underneath a two-column desktop layout. */
const NARROW_QUERY = "(max-width: 759px)";
/* Whisper listens at 16 kHz mono; anything above that is bytes the transcript
   never uses. */
const SPEECH_SAMPLE_RATE = 16_000;
/* Decoding holds the whole recording in memory as 32-bit floats. Past this the
   conversion is more likely to take the tab down than to rescue the meeting. */
const MAX_DECODE_BYTES = 200 * 1024 * 1024;
/* MediaRecorder hands over a blob this often, and every one is written to
   IndexedDB as it arrives, so a crash costs five seconds and not the meeting. */
const RECORDING_CHUNK_MS = 5_000;

/* What Film Room would lose if the app navigated away right now, as a sentence,
   or "" when it is safe to leave. The component keeps this up to date while it
   is mounted; App can call it from changePlace before bumping the Film Room key
   and remounting the component out from under a running recording. */
let interruptionReason = "";
export function filmRoomInterruption() {
  return interruptionReason;
}

async function filmApi(pathname, options = {}) {
  const response = await fetch(pathname, options);
  let body = {};
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const error = new Error(body?.error?.message || "Film Room could not complete that move.");
    error.code = body?.error?.code || "";
    throw error;
  }
  return body;
}

function recordingMimeType() {
  const Recorder = window.MediaRecorder;
  if (!Recorder) return "";
  return ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"]
    .find((type) => Recorder.isTypeSupported?.(type)) || "";
}

function fileMimeType(file) {
  if (file?.type) return file.type;
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  return { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/opus", webm: "audio/webm" }[extension] || "";
}

function recordingExtension(type) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

function fileDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new window.Audio();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      audio.onloadedmetadata = null;
      audio.onerror = null;
      resolve(Number.isFinite(value) && value > 0 ? Math.ceil(value) : null);
    };
    const timer = window.setTimeout(() => finish(null), 5000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => { window.clearTimeout(timer); finish(audio.duration); };
    audio.onerror = () => { window.clearTimeout(timer); finish(null); };
    audio.src = url;
  });
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

/* createdAt is a UTC timestamp and format.js reads a date as the local day, so
   the timestamp becomes a local date first. Otherwise a meeting recorded before
   03:30 in Tehran is filed under yesterday. */
function meetingDate(value) {
  return formatDate(localIsoDate(value), { style: "short" });
}

function megabytes(bytes) {
  return (Number(bytes || 0) / 1024 / 1024).toFixed(1);
}

function meetingError(code) {
  const localPreview = ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
  return {
    MEETING_MODEL_BUSY: "The server is busy. Your recording is safe; try again in a few minutes.",
    MEETING_MODEL_TIMEOUT: "Agent4 took too long to build the notes. A saved transcript can be used without uploading audio again.",
    AI_PROVIDER_UNAVAILABLE: "The notes model is offline. The saved transcript can be used when it returns.",
    AI_PROVIDER_ERROR: "The notes model rejected this transcript. Retrying unchanged may fail again.",
    AI_EMPTY_RESPONSE: "The notes model returned no usable notes. The transcript is safe.",
    AI_INVALID_RESPONSE: "The notes model returned notes Film Room could not read. The transcript is safe.",
    MEETING_INTERRUPTED: "The server restarted before this recording could be recovered. Choose the file again to retry.",
    MEETING_UPLOAD_EXPIRED: "This upload stayed unfinished for more than 30 minutes, so its temporary server copy was deleted.",
    TRANSCRIPTION_TIMEOUT: "This recording took too long to read. Try a shorter or more compressed file.",
    TRANSCRIPTION_UNAVAILABLE: localPreview
      ? "Local Whisper is offline. Run npm run voice:start, then retry."
      : "Transcription is temporarily unavailable. Try again in a few minutes.",
    TRANSCRIPT_EMPTY: "I could not find understandable speech in this recording.",
    MEETING_PROCESSING_FAILED: "Film Room could not finish this meeting. If a transcript was saved, it is still available."
  }[code] || null;
}

function actionMeta(action) {
  const parts = [];
  if (action.owner) parts.push(`Owner: ${action.owner}`);
  if (action.dueOn) parts.push(dueLabel(action.dueOn));
  if (action.confidence === "inferred") parts.push("Agent4 inference");
  return parts.filter(Boolean).join(" · ");
}

/* ------------------------------------------------------- where you left off --- */

/* App remounts Film Room whenever a nav tab is touched, which used to throw away
   the meeting being read and any half-typed composer. Until that changes, the
   component writes its own place back to localStorage and picks it up on the
   next mount. Anything here is a convenience, so every access is guarded: a
   private window simply forgets where you were. */
function filmSessionForActor(actorId) {
  const storage = createActorStorage(SESSION_KEY, actorId, () => window.localStorage);
  function readSession() {
    const parsed = storage.read({});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  }
  function writeSession(patch) { storage.write({ ...readSession(), ...patch }); }
  function readDrafts(meetingId) {
    const drafts = readSession().drafts;
    return drafts && meetingId && drafts.id === meetingId ? drafts : null;
  }
  return { readSession, writeSession, readDrafts };
}

/* --------------------------------------------------------- speech-only copy --- */

/* 16-bit PCM in a WAV container. The browser can decode and resample any audio
   it can play, but it cannot encode Opus or MP3 offline, so this is the only
   format a page can write without shipping an encoder. */
function encodeWav(buffer) {
  const samples = buffer.getChannelData(0);
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const ascii = (offset, value) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

function speechCopyBytes(durationSeconds) {
  return 44 + Math.ceil(Math.max(0, Number(durationSeconds) || 0) * SPEECH_SAMPLE_RATE * 2);
}

async function makeSpeechCopy(file) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("This browser cannot convert audio. Export a smaller copy from the app that recorded it.");
  const bytes = await file.arrayBuffer();
  // decodeAudioData resamples to the context's rate, so the 44.1 kHz stereo
  // original never has to exist in memory at full size.
  const decoded = await new Offline(1, 1, SPEECH_SAMPLE_RATE).decodeAudioData(bytes);
  const frames = Math.max(1, Math.ceil(decoded.duration * SPEECH_SAMPLE_RATE));
  const offline = new Offline(1, frames, SPEECH_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return encodeWav(await offline.startRendering());
}

/* ---------------------------------------------------------------- viewport --- */

/* App tracks the compact breakpoint but does not pass it here, so the component
   asks the same question itself. An explicit prop still wins, for the day App
   does pass it. */
function useNarrowViewport(override) {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia?.(NARROW_QUERY).matches === true);
  useEffect(() => {
    const query = window.matchMedia?.(NARROW_QUERY);
    if (!query) return undefined;
    const onChange = (event) => setNarrow(event.matches);
    setNarrow(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return typeof override === "boolean" ? override : narrow;
}

/* ------------------------------------------------------------------ pieces --- */

function EmptySection() {
  return <p className="film-empty">Nothing grounded was found in the conversation.</p>;
}

/* dir="auto" per item, never per meeting. A Persian conversation with English
   product names decides its direction line by line; deciding it once for the
   whole debrief pushed every English decision to the right-hand side. */
function DebriefSection({ title, icon: Icon, items }) {
  return (
    <section className="film-debrief-section">
      <header><Icon size={16} /><strong>{title}</strong><b>{items.length}</b></header>
      {items.length ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}><span>{index + 1}</span><p dir="auto">{item}</p></li>)}</ul> : <EmptySection />}
    </section>
  );
}

async function copyText(value) {
  const content = String(value || "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const field = document.createElement("textarea");
  field.value = content;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Copy failed");
}

function RecapDocument({ text }) {
  const blocks = String(text || "").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return (
    <div className="film-recap-document">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        if (blockIndex === 0) return <header key={`${block}-${blockIndex}`}><h3 dir="auto">{lines[0]}</h3>{lines.slice(1).map((line) => <p dir="auto" key={line}>{line}</p>)}</header>;
        if (blockIndex === blocks.length - 1 && lines.length === 1) return <footer dir="auto" key={`${block}-${blockIndex}`}>{lines[0]}</footer>;
        return (
          <section key={`${block}-${blockIndex}`}>
            <strong dir="auto">{lines[0]}</strong>
            {lines.slice(1).map((line, lineIndex) => <p dir="auto" className={line.startsWith("- ") ? "is-bullet" : ""} key={`${line}-${lineIndex}`}>{line.replace(/^-\s+/, "")}</p>)}
          </section>
        );
      })}
    </div>
  );
}

export function FilmRoom({ compact = null, onBack = null, onOpenClient = null, clients = [], onChanged = null, startCreating = false, initialMeetingId = "", onBusy = null }) {
  const actorId = useRef(getActiveActor().id).current;
  const privateCache = useRef(null);
  if (!privateCache.current) privateCache.current = { ...filmCacheForActor(actorId), ...filmSessionForActor(actorId) };
  const { readSession, writeSession, readDrafts, appendRecordingChunk, clearPendingFilmUpload, clearRecordingSession,
    loadPendingFilmUpload, loadRecoveredRecording, savePendingFilmUpload, startRecordingSession, updateRecordingSession } = privateCache.current;

  const restoredRef = useRef(null);
  if (!restoredRef.current) restoredRef.current = readSession();
  const restored = restoredRef.current;
  const narrow = useNarrowViewport(compact);
  const [state, setState] = useState({ loading: true, loadingMore: false, meetings: [], total: 0, hasMore: false, limits: FALLBACK_LIMITS, error: "" });
  const [selected, setSelected] = useState(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryDraft, setRecoveryDraft] = useState({ summary: "", decisions: "", actionItems: "", openQuestions: "" });
  const [savedRecordingId, setSavedRecordingId] = useState("");
  const [composerOpen, setComposerOpen] = useState(startCreating || Boolean(restored.composerOpen));
  const [title, setTitle] = useState(restored.title || "");
  const [clientChoice, setClientChoice] = useState(restored.clientChoice || "");
  const [clientName, setClientName] = useState(restored.clientName || "");
  const [projectName, setProjectName] = useState(restored.projectName || "");
  const [requestedLanguage, setRequestedLanguage] = useState(restored.requestedLanguage || "en");
  const [consent, setConsent] = useState(false);
  const [audio, setAudio] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [upload, setUpload] = useState({ busy: false, progress: 0, error: "" });
  const [repair, setRepair] = useState(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [resumeMeetingId, setResumeMeetingId] = useState("");
  const [selectedActions, setSelectedActions] = useState([]);
  const [taskBusy, setTaskBusy] = useState(false);
  const [recapDraft, setRecapDraft] = useState("");
  const [recapEditing, setRecapEditing] = useState(false);
  const [recapBusy, setRecapBusy] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState({ clientChoice: "", clientId: "", clientName: "", projectName: "", followUpOn: "" });
  const [memoryEditing, setMemoryEditing] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const fileRef = useRef(null);
  const meetingsRef = useRef([]);
  const sessionRef = useRef({ id: "", index: 0 });
  const composerRef = useRef({});

  const showNotice = useCallback((text, tone = "ok") => setNotice({ text: String(text || ""), tone, at: Date.now() }), []);

  useEffect(() => {
    setRecoveryOpen(false);
    setRecoveryDraft({ summary: "", decisions: "", actionItems: "", openQuestions: "" });
  }, [selected?.id]);

  useEffect(() => { meetingsRef.current = state.meetings; }, [state.meetings]);

  /* onstop can fire after this component has been unmounted mid-recording, so
     the values it needs to save the audio live in a ref rather than a closure
     over state that no longer exists. */
  useEffect(() => {
    composerRef.current = { title, clientId: clientChoice === "__manual__" ? "" : clientChoice, clientName, projectName, requestedLanguage };
  }, [title, clientChoice, clientName, projectName, requestedLanguage]);

  const loadMeetings = useCallback(async ({ append = false } = {}) => {
    const loaded = meetingsRef.current.length;
    const offset = append ? loaded : 0;
    // A refresh after a change re-reads everything already on screen, so the
    // fortieth meeting does not disappear because the list reloaded one page.
    const limit = append ? PAGE_SIZE : Math.min(100, Math.max(PAGE_SIZE, loaded));
    setState((current) => (append ? { ...current, loadingMore: true } : { ...current, loading: !current.meetings.length, error: "" }));
    try {
      const body = await filmApi(`/api/meetings?limit=${limit}&offset=${offset}`);
      const page = body.meetings || [];
      const merged = append ? [...meetingsRef.current, ...page.filter((meeting) => !meetingsRef.current.some((known) => known.id === meeting.id))] : page;
      meetingsRef.current = merged;
      setState((current) => ({
        loading: false,
        loadingMore: false,
        meetings: merged,
        total: Number.isFinite(Number(body.total)) ? Number(body.total) : merged.length,
        hasMore: Boolean(body.hasMore),
        limits: body.limits || current.limits,
        error: ""
      }));
      return page;
    } catch (error) {
      setState((current) => ({ ...current, loading: false, loadingMore: false, error: error.message }));
      return [];
    }
  }, []);

  /* Always by id, never by looking in the loaded page: a link from Companies to
     a meeting from last year has to open it. */
  const openMeeting = useCallback(async (id, { quiet = false } = {}) => {
    try {
      const body = await filmApi(`/api/meetings/${encodeURIComponent(id)}`);
      setSelected(body.meeting);
      return body.meeting;
    } catch (error) {
      if (!quiet) showNotice(error.message, "error");
      return null;
    }
  }, [showNotice]);

  useEffect(() => { void loadMeetings(); }, [loadMeetings]);

  useEffect(() => {
    const wanted = startCreating ? "" : initialMeetingId || restored.meetingId || "";
    if (!wanted) return;
    void openMeeting(wanted, { quiet: true }).then((meeting) => {
      if (meeting) setComposerOpen(false);
      else if (!initialMeetingId) writeSession({ meetingId: "", drafts: null });
      else showNotice("That meeting is no longer in Film Room.", "error");
    });
  }, [initialMeetingId, openMeeting, restored.meetingId, showNotice, startCreating]);

  /* Recovery, in the order the audio is most likely to be sitting: a half-sent
     upload first, then a recording that never reached the upload at all. */
  useEffect(() => {
    let active = true;
    void (async () => {
      const pending = await loadPendingFilmUpload();
      if (!active) return;
      if (pending?.blob instanceof Blob) {
        let meeting = null;
        if (pending.meetingId) {
          try {
            meeting = (await filmApi(`/api/meetings/${encodeURIComponent(pending.meetingId)}`)).meeting;
          } catch {
            meeting = null;
          }
        }
        if (!active) return;
        if (meeting && ["processing", "ready", "failed"].includes(meeting.status)) {
          if (meeting.status === "ready") await clearPendingFilmUpload();
          setSelected(meeting);
          setComposerOpen(false);
          await loadMeetings();
          return;
        }
        const canResume = meeting?.status === "uploading";
        restoreDraft({
          blob: pending.blob,
          name: pending.name || "meeting-audio",
          mimeType: pending.mimeType || pending.blob.type,
          durationSeconds: pending.durationSeconds || null
        }, pending, canResume ? meeting : null);
        return;
      }
      const recovered = await loadRecoveredRecording();
      if (!active || !recovered) return;
      // A recording stopped moments ago is still being assembled into the
      // pending record by its own onstop handler, which outlives the component
      // that started it. Give that the second it needs, rather than handing
      // back a copy missing its last few seconds.
      const stoppedMs = Date.parse(recovered.session?.stoppedAt || "") || 0;
      if (stoppedMs && Date.now() - stoppedMs < 15_000) {
        await new Promise((resolve) => { window.setTimeout(resolve, 1500); });
        const settled = await loadPendingFilmUpload();
        if (!active) return;
        if (settled?.blob instanceof Blob) {
          restoreDraft({
            blob: settled.blob,
            name: settled.name || "meeting-audio",
            mimeType: settled.mimeType || settled.blob.type,
            durationSeconds: settled.durationSeconds || null
          }, settled, null);
          showNotice("The recording that was interrupted is saved on this device. Confirm consent again, then upload it.");
          return;
        }
      }
      const meta = recovered.session || {};
      const durationSeconds = meta.durationSeconds || Math.max(1, (recovered.chunks || 1) * Math.round(RECORDING_CHUNK_MS / 1000));
      restoreDraft({
        blob: recovered.blob,
        name: meta.name || `meeting-${Date.parse(meta.startedAt || "") || Date.now()}.${recordingExtension(recovered.mimeType)}`,
        mimeType: recovered.mimeType,
        durationSeconds
      }, meta, null);
      showNotice("A recording that was interrupted was recovered on this device. Check it, confirm consent again, then upload it.");
    })();

    function restoreDraft(recoveredAudio, meta, resumable) {
      setAudio(recoveredAudio);
      setRecordingSeconds(recoveredAudio.durationSeconds || 0);
      setTitle(meta.title || "");
      setClientChoice(meta.clientId || (meta.clientName ? "__manual__" : ""));
      setClientName(meta.clientName || "");
      setProjectName(meta.projectName || "");
      setRequestedLanguage(meta.requestedLanguage || "fa");
      // Consent is the one thing that is never restored. The copy under the box
      // says the owner is responsible for telling the room, so the app must not
      // tick it on his behalf on a recording he may not have made today.
      setConsent(false);
      setResumeMeetingId(resumable ? resumable.id : "");
      setUpload({
        busy: false,
        progress: resumable ? Math.round((resumable.uploadParts / resumable.totalParts) * 100) : 0,
        error: resumable
          ? "Upload paused. Confirm consent again, then tap Resume upload to continue where it stopped."
          : "This recording was recovered on this device. Confirm consent again, then tap Upload meeting."
      });
      setSelected(null);
      setComposerOpen(true);
    }

    return () => { active = false; };
  }, [loadMeetings, showNotice]);

  /* A recording that is still going, or an upload in flight, is the one thing
     in this app that cannot be recreated. Say so before the tab closes, and
     publish the same sentence for App to ask about before it remounts us. */
  useEffect(() => {
    const reason = recording
      ? "This meeting is still recording. Leaving now stops it."
      : upload.busy ? "This meeting is still uploading." : "";
    interruptionReason = reason;
    onBusy?.(Boolean(reason), reason);
    if (!reason) return () => { interruptionReason = ""; };
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = reason;
      return reason;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      interruptionReason = "";
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [onBusy, recording, upload.busy]);

  useEffect(() => {
    if (!selected || !["uploading", "processing"].includes(selected.status)) return undefined;
    // Quick while something is about to change, slow once this is a long wait:
    // a forty-minute transcription used to cost a thousand requests.
    const startedMs = Date.parse(selected.updatedAt || selected.createdAt || "") || Date.now();
    const period = Date.now() - startedMs > 120_000 ? 10_000 : 2_500;
    const timer = window.setInterval(async () => {
      const meeting = await openMeeting(selected.id, { quiet: true });
      if (meeting && !["uploading", "processing"].includes(meeting.status)) await loadMeetings();
    }, period);
    return () => window.clearInterval(timer);
  }, [loadMeetings, openMeeting, selected]);

  useEffect(() => {
    if (selected?.status !== "ready") return;
    void loadPendingFilmUpload().then((pending) => {
      if (pending?.meetingId === selected.id) void clearPendingFilmUpload();
    });
  }, [selected?.id, selected?.status]);

  useEffect(() => {
    let active = true;
    void loadPendingFilmUpload().then((pending) => {
      if (active) setSavedRecordingId(pending?.meetingId || "");
    });
    return () => { active = false; };
  }, [selected?.id, selected?.status]);

  useEffect(() => {
    if (!recording && !(selected && ["uploading", "processing"].includes(selected.status))) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [recording, selected]);

  useEffect(() => { setSelectedActions([]); }, [selected?.id, selected?.status]);

  useEffect(() => {
    const draft = readDrafts(selected?.id)?.recap;
    setRecapDraft(typeof draft === "string" ? draft : selected?.clientRecap || "");
    setRecapEditing(typeof draft === "string");
  }, [selected?.id, selected?.clientRecap]);

  useEffect(() => {
    const draft = readDrafts(selected?.id)?.memory;
    setMemoryDraft(draft || {
      clientChoice: selected?.clientId || (selected?.clientName ? "__manual__" : ""),
      clientId: selected?.clientId || "",
      clientName: selected?.clientName || "",
      projectName: selected?.projectName || "",
      followUpOn: selected?.followUpOn || ""
    });
    setMemoryEditing(Boolean(draft) || (selected?.status === "ready" && !selected?.clientName));
  }, [selected?.id, selected?.status, selected?.clientId, selected?.clientName, selected?.projectName, selected?.followUpOn]);

  useEffect(() => {
    writeSession({ meetingId: selected?.id || "", composerOpen, title, clientChoice, clientName, projectName, requestedLanguage });
  }, [clientChoice, clientName, composerOpen, projectName, requestedLanguage, selected?.id, title]);

  useEffect(() => {
    if (!selected?.id) return;
    const drafts = { id: selected.id };
    if (recapEditing) drafts.recap = recapDraft;
    if (memoryEditing) drafts.memory = memoryDraft;
    writeSession({ drafts: recapEditing || memoryEditing ? drafts : null });
  }, [memoryDraft, memoryEditing, recapDraft, recapEditing, selected?.id]);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setRecordingSeconds(seconds);
      if (seconds >= state.limits.maxDurationSeconds && recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, 500);
    return () => window.clearInterval(timer);
  }, [recording, state.limits.maxDurationSeconds]);

  useEffect(() => () => {
    // App remounts this component whenever a nav tab is touched, so this runs
    // in the middle of real recordings. Stopping fires onstop, which writes the
    // finished blob to IndexedDB even though the component is already gone, and
    // every chunk before it is already on disk — so the worst case is the last
    // few seconds rather than the meeting.
    if (recorderRef.current?.state === "recording") {
      if (sessionRef.current.id) void updateRecordingSession(sessionRef.current.id, { stoppedAt: new Date().toISOString() });
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
  }, []);

  const limits = state.limits || FALLBACK_LIMITS;
  const maxMegabytes = Math.round(limits.maxBytes / 1024 / 1024);
  const maxMinutes = Math.round(limits.maxDurationSeconds / 60);

  function forgetPendingUpload() {
    const meetingId = resumeMeetingId;
    setResumeMeetingId("");
    void clearPendingFilmUpload();
    void clearRecordingSession();
    if (meetingId) void filmApi(`/api/meetings/${encodeURIComponent(meetingId)}`, { method: "DELETE" }).catch(() => {});
  }

  /* Anything that replaces staged audio asks first. "Record here" used to fire a
     DELETE at the server before the microphone was even open, so one stray tap
     took a paused forty-minute upload with it. */
  function replaceStagedAudio(run) {
    if (resumeMeetingId) {
      setConfirming({
        title: "Delete the paused upload first?",
        body: `“${title.trim() || "Untitled meeting"}” is ${upload.progress}% uploaded. Starting again deletes it here and the part the server is holding.`,
        detail: "The audio is gone for good once this is done.",
        confirmLabel: "Delete it and start",
        onConfirm: () => { forgetPendingUpload(); run(); }
      });
      return;
    }
    if (audio) {
      setConfirming({
        title: "Replace the audio you have staged?",
        body: `“${audio.name}” (${megabytes(audio.blob.size)} MB) has not been uploaded yet. Starting again drops it from this device.`,
        confirmLabel: "Drop it and start",
        onConfirm: () => { forgetPendingUpload(); setAudio(null); run(); }
      });
      return;
    }
    run();
  }

  async function startRecording() {
    setUpload({ busy: false, progress: 0, error: "" });
    setRepair(null);
    const Recorder = window.MediaRecorder;
    if (!navigator.mediaDevices?.getUserMedia || !Recorder) {
      setUpload((current) => ({ ...current, error: "This browser cannot record directly. Upload an audio file instead." }));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const mimeType = recordingMimeType();
      const recorder = new Recorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
      const startedAt = new Date().toISOString();
      const type = mimeType || "audio/webm";
      const sessionId = await startRecordingSession({ ...composerRef.current, mimeType: type, startedAt, name: `meeting-${Date.now()}.${recordingExtension(type)}` });
      sessionRef.current = { id: sessionId, index: 0 };
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (!event.data?.size) return;
        chunksRef.current.push(event.data);
        const session = sessionRef.current;
        if (!session.id) return;
        const index = session.index;
        session.index += 1;
        // Deliberately not awaited: a slow disk must never stall the recorder.
        void appendRecordingChunk(session.id, index, event.data);
      };
      recorder.onstop = () => {
        const finalType = recorder.mimeType || type;
        const blob = new Blob(chunksRef.current, { type: finalType });
        const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const name = `meeting-${Date.parse(startedAt) || Date.now()}.${recordingExtension(finalType)}`;
        // Written before any state is touched, because this also runs when the
        // component has already been unmounted mid-recording.
        void savePendingFilmUpload({ ...composerRef.current, blob, name, mimeType: finalType, durationSeconds, meetingId: "" })
          .then(() => clearRecordingSession());
        sessionRef.current = { id: "", index: 0 };
        setAudio({ blob, name, mimeType: finalType, durationSeconds });
        setRecording(false);
        setRecordingSeconds(durationSeconds);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setAudio(null);
      setRecordingSeconds(0);
      setRecording(true);
      recorder.start(RECORDING_CHUNK_MS);
    } catch {
      setUpload((current) => ({ ...current, error: "Microphone access was blocked. Allow it in your phone settings or upload an audio file." }));
    }
  }

  function stopRecording() {
    if (sessionRef.current.id) void updateRecordingSession(sessionRef.current.id, { durationSeconds: recordingSeconds, stoppedAt: new Date().toISOString() });
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    replaceStagedAudio(() => void stageFile(file));
  }

  function tooLargeMessage(file, durationSeconds, canConvert) {
    const size = `${megabytes(file.size)} MB`;
    if (canConvert) return `This file is ${size}; Film Room accepts ${maxMegabytes} MB. It is short enough to convert here — one tap below.`;
    if (!durationSeconds) return `This file is ${size}; Film Room accepts ${maxMegabytes} MB. Export it as mono speech audio at about 32 kbps — a full hour fits inside ${maxMegabytes} MB at that rate.`;
    const kbps = Math.max(8, Math.floor((limits.maxBytes * 8) / durationSeconds / 1000));
    return `This file is ${size}; Film Room accepts ${maxMegabytes} MB. At ${formatDuration(durationSeconds)} it has to be mono at about ${kbps} kbps or less. Recording the meeting here instead already is — an hour of it lands near 14 MB.`;
  }

  async function stageFile(file) {
    setRepair(null);
    const mimeType = fileMimeType(file);
    if (!mimeType) {
      setUpload((current) => ({ ...current, error: "Choose an MP3, M4A, WAV, OGG, or WebM recording." }));
      return;
    }
    const durationSeconds = await fileDuration(file);
    if (durationSeconds && durationSeconds > limits.maxDurationSeconds) {
      setUpload((current) => ({
        ...current,
        error: `This recording is ${formatDuration(durationSeconds)}; Film Room transcribes up to ${maxMinutes} minutes in one meeting. Cut it into parts under ${maxMinutes} minutes and upload each as its own meeting, so each transcript stays with its own debrief.`
      }));
      return;
    }
    if (file.size > limits.maxBytes) {
      const canConvert = Boolean(durationSeconds)
        && file.size <= MAX_DECODE_BYTES
        && speechCopyBytes(durationSeconds) <= limits.maxBytes;
      if (canConvert) setRepair({ file, durationSeconds, targetBytes: speechCopyBytes(durationSeconds) });
      setUpload((current) => ({ ...current, error: tooLargeMessage(file, durationSeconds, canConvert) }));
      return;
    }
    setAudio({ blob: file, name: file.name, mimeType, durationSeconds });
    setRecordingSeconds(0);
    setUpload({ busy: false, progress: 0, error: "" });
  }

  async function convertToSpeechCopy() {
    if (!repair) return;
    setRepairBusy(true);
    try {
      const blob = await makeSpeechCopy(repair.file);
      if (blob.size > limits.maxBytes) throw new Error(`The converted copy is still ${megabytes(blob.size)} MB. Export a shorter part instead.`);
      setAudio({
        blob,
        name: `${repair.file.name.replace(/\.[^.]+$/, "")}-speech.wav`,
        mimeType: "audio/wav",
        durationSeconds: repair.durationSeconds
      });
      setRecordingSeconds(0);
      setUpload({ busy: false, progress: 0, error: "" });
      setRepair(null);
      showNotice(`Converted to a ${megabytes(blob.size)} MB mono 16 kHz copy. The file on your device was not touched.`);
    } catch (error) {
      setUpload((current) => ({ ...current, error: error.message || "That file could not be converted. Export a smaller copy instead." }));
    } finally {
      setRepairBusy(false);
    }
  }

  async function uploadAudio() {
    if (!audio?.blob) {
      setUpload((current) => ({ ...current, error: "Record the meeting or choose an audio file first." }));
      return;
    }
    if (!consent) {
      setUpload((current) => ({ ...current, error: "Confirm that everyone knows the meeting is being recorded." }));
      return;
    }
    const totalParts = Math.ceil(audio.blob.size / limits.chunkBytes);
    if (!totalParts || totalParts > limits.maxParts || audio.blob.size > limits.maxBytes) {
      setUpload((current) => ({ ...current, error: `This file is ${megabytes(audio.blob.size)} MB; Film Room accepts ${maxMegabytes} MB. Export a mono speech-quality version.` }));
      return;
    }
    const draft = {
      blob: audio.blob,
      name: audio.name,
      mimeType: audio.mimeType,
      durationSeconds: audio.durationSeconds,
      title,
      clientId: clientChoice === "__manual__" ? "" : clientChoice,
      clientName,
      projectName,
      requestedLanguage,
      totalParts,
      meetingId: resumeMeetingId
    };
    await savePendingFilmUpload(draft);
    setUpload((current) => ({ busy: true, progress: Math.max(1, current.progress), error: "" }));
    let meetingId = resumeMeetingId;
    try {
      let meeting = null;
      if (meetingId) {
        try {
          meeting = (await filmApi(`/api/meetings/${encodeURIComponent(meetingId)}`)).meeting;
        } catch {
          meeting = null;
          meetingId = "";
          setResumeMeetingId("");
        }
      }
      if (meeting && ["processing", "ready"].includes(meeting.status)) {
        if (meeting.status === "ready") await clearPendingFilmUpload();
        setSelected(meeting);
        setComposerOpen(false);
        setAudio(null);
        setResumeMeetingId("");
        setUpload({ busy: false, progress: 100, error: "" });
        await loadMeetings();
        return;
      }
      if (meeting && (meeting.status === "failed" || meeting.totalParts !== totalParts)) {
        if (meeting.status !== "failed") await filmApi(`/api/meetings/${encodeURIComponent(meeting.id)}`, { method: "DELETE" }).catch(() => {});
        meeting = null;
        meetingId = "";
        setResumeMeetingId("");
      }
      if (!meeting || meeting.status !== "uploading" || meeting.totalParts !== totalParts) {
        const created = await filmApi("/api/meetings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: title.trim() || "Untitled meeting",
            clientId: clientChoice === "__manual__" ? "" : clientChoice,
            clientName,
            projectName,
            requestedLanguage,
            mimeType: audio.mimeType,
            durationSeconds: audio.durationSeconds,
            totalParts,
            // What the owner actually ticked, on this upload. Never a literal.
            consentConfirmed: consent
          })
        });
        meeting = created.meeting;
        meetingId = meeting.id;
        setResumeMeetingId(meetingId);
        await savePendingFilmUpload({ ...draft, meetingId });
      }
      for (let part = meeting.uploadParts; part < totalParts; part += 1) {
        const chunk = audio.blob.slice(part * limits.chunkBytes, Math.min(audio.blob.size, (part + 1) * limits.chunkBytes));
        const body = await filmApi(`/api/meetings/${encodeURIComponent(meeting.id)}/audio?part=${part}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: chunk
        });
        meeting = body.meeting;
        setUpload((current) => ({ ...current, progress: Math.round((meeting.uploadParts / totalParts) * 100) }));
      }
      await savePendingFilmUpload({ ...draft, meetingId });
      await clearRecordingSession();
      setSelected(meeting);
      setComposerOpen(false);
      setTitle("");
      setClientChoice("");
      setClientName("");
      setProjectName("");
      setAudio(null);
      setConsent(false);
      setResumeMeetingId("");
      setUpload({ busy: false, progress: 100, error: "" });
      await loadMeetings();
    } catch (error) {
      await savePendingFilmUpload({ ...draft, meetingId });
      setResumeMeetingId(meetingId);
      setUpload((current) => ({
        busy: false,
        progress: current.progress,
        error: meetingError(error.code) || "Upload paused. Check your connection, then tap Resume upload."
      }));
      await loadMeetings();
    }
  }

  async function retryFailedDebrief() {
    if (!selected?.transcript) return;
    try {
      const body = await filmApi(`/api/meetings/${encodeURIComponent(selected.id)}/retry-debrief`, { method: "POST" });
      setSelected(body.meeting);
      await loadMeetings();
      showNotice("The transcript is safe. Film Room is retrying the notes without uploading audio again.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  }

  async function saveRecoveredNotes() {
    if (!selected?.transcript || !recoveryDraft.summary.trim()) return;
    setRecoveryBusy(true);
    const lines = (value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    try {
      const body = await filmApi(`/api/meetings/${encodeURIComponent(selected.id)}/recovered-notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          summary: recoveryDraft.summary.trim(),
          decisions: lines(recoveryDraft.decisions),
          actionItems: lines(recoveryDraft.actionItems),
          openQuestions: lines(recoveryDraft.openQuestions)
        })
      });
      setSelected(body.meeting);
      setRecoveryOpen(false);
      await loadMeetings();
      showNotice("Recovered notes saved with the original transcript.");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function retrySavedRecording() {
    const pending = await loadPendingFilmUpload();
    if (!pending?.blob || pending.meetingId !== selected?.id) {
      showNotice("There is no saved recording in this browser. Choose the original file on your device to retry.", "error");
      return;
    }
    setAudio({ blob: pending.blob, name: pending.name, mimeType: pending.mimeType, durationSeconds: pending.durationSeconds });
    setTitle(pending.title || selected.title);
    setClientChoice(pending.clientId || (pending.clientName ? "__manual__" : ""));
    setClientName(pending.clientName || "");
    setProjectName(pending.projectName || "");
    setRequestedLanguage(pending.requestedLanguage || "fa");
    setConsent(false);
    setResumeMeetingId("");
    setUpload({ busy: false, progress: 0, error: "The recording is saved on this device. Confirm consent again before retrying." });
    setSelected(null);
    setComposerOpen(true);
  }

  async function createTasks() {
    if (!selectedActions.length || !selected) return;
    setTaskBusy(true);
    try {
      const body = await filmApi(`/api/meetings/${encodeURIComponent(selected.id)}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionIndexes: selectedActions })
      });
      setSelected(body.meeting);
      showNotice(body.created ? `${body.created.toLocaleString("en-US")} ${body.created === 1 ? "task" : "tasks"} added to the task board.` : "Those tasks are already on the task board.");
      await loadMeetings();
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setTaskBusy(false);
    }
  }

  async function copyFollowUp() {
    try {
      await copyText(selected?.followUpDraft || "");
      showNotice("Follow-up copied.");
    } catch {
      showNotice("Could not copy it. Select the text manually.", "error");
    }
  }

  async function saveClientRecap() {
    if (!selected || !recapDraft.trim()) return;
    setRecapBusy(true);
    try {
      const body = await filmApi(`/api/meetings/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientRecap: recapDraft })
      });
      setSelected(body.meeting);
      setRecapDraft(body.meeting.clientRecap);
      setRecapEditing(false);
      showNotice("Client recap saved.");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setRecapBusy(false);
    }
  }

  async function copyClientRecap() {
    try {
      await copyText(recapEditing ? recapDraft : selected?.clientRecap || "");
      showNotice("Client recap copied.");
    } catch {
      showNotice("Could not copy it. Select the text manually.", "error");
    }
  }

  async function shareClientRecap() {
    const text = recapEditing ? recapDraft : selected?.clientRecap || "";
    if (!text) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: selected?.title || "Meeting recap", text });
        showNotice("Client recap shared.");
      } else {
        await copyText(text);
        showNotice("Sharing is not available here, so the recap was copied.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") showNotice("Could not open sharing. Copy the recap instead.", "error");
    }
  }

  function chooseComposerClient(value) {
    setClientChoice(value);
    if (!value || value === "__manual__") {
      setClientName("");
      return;
    }
    setClientName(clients.find((client) => client.id === value)?.name || "");
  }

  function chooseMemoryClient(value) {
    if (!value) {
      setMemoryDraft((current) => ({ ...current, clientChoice: "", clientId: "", clientName: "" }));
      return;
    }
    if (value === "__manual__") {
      setMemoryDraft((current) => ({ ...current, clientChoice: value, clientId: "", clientName: "" }));
      return;
    }
    const client = clients.find((item) => item.id === value);
    setMemoryDraft((current) => ({ ...current, clientChoice: value, clientId: value, clientName: client?.name || "" }));
  }

  async function saveClientMemory() {
    if (!selected) return;
    setMemoryBusy(true);
    try {
      const body = await filmApi(`/api/meetings/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: memoryDraft.clientId,
          clientName: memoryDraft.clientName,
          projectName: memoryDraft.projectName,
          followUpOn: memoryDraft.followUpOn || null
        })
      });
      setSelected(body.meeting);
      setMemoryEditing(false);
      await loadMeetings();
      await onChanged?.();
      showNotice(body.meeting.clientName ? "Client memory saved." : "Meeting unlinked from client memory.");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setMemoryBusy(false);
    }
  }

  async function addFollowUpTask() {
    if (!selected) return;
    setFollowUpBusy(true);
    try {
      const body = await filmApi(`/api/meetings/${encodeURIComponent(selected.id)}/follow-up`, { method: "POST" });
      setSelected(body.meeting);
      await onChanged?.();
      showNotice(body.created ? "Follow-up added to the task board." : "That follow-up is already on the task board.");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setFollowUpBusy(false);
    }
  }

  /* Delete is offered on every row, whatever its status. The meeting you most
     want gone is the one stuck part-way through, and that was the only one with
     no way to remove it. */
  function requestDelete(meeting) {
    const stillRunning = ["uploading", "processing"].includes(meeting.status);
    setConfirming({
      title: `Delete “${meeting.title || "Untitled meeting"}”?`,
      body: stillRunning
        ? "This meeting has not finished. Deleting it stops the upload and removes the copy of the audio the server is holding."
        : "This removes the notes, the client recap and the full transcript.",
      detail: meeting.status === "ready" ? "Tasks already created from it stay on the task board." : "",
      confirmLabel: "Delete meeting",
      onConfirm: () => deleteMeeting(meeting)
    });
  }

  async function deleteMeeting(meeting) {
    setConfirmBusy(true);
    try {
      await filmApi(`/api/meetings/${encodeURIComponent(meeting.id)}`, { method: "DELETE" });
      if (selected?.id === meeting.id) {
        setSelected(null);
        writeSession({ meetingId: "", drafts: null });
      }
      if (resumeMeetingId === meeting.id) {
        setResumeMeetingId("");
        void clearPendingFilmUpload();
      }
      else {
        const pending = await loadPendingFilmUpload();
        if (pending?.meetingId === meeting.id) await clearPendingFilmUpload();
      }
      await loadMeetings();
      await onChanged?.();
      showNotice(`“${meeting.title || "Untitled meeting"}” was deleted.`);
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setConfirmBusy(false);
      setConfirming(null);
    }
  }

  const readyActions = selected?.actionItems || [];
  const selectedClientKey = selected?.clientId || (selected?.clientName ? `name:${selected.clientName.toLocaleLowerCase()}` : "");
  const clientHistory = selectedClientKey ? state.meetings.filter((meeting) => (meeting.clientId || (meeting.clientName ? `name:${meeting.clientName.toLocaleLowerCase()}` : "")) === selectedClientKey) : [];
  const allAvailableSelected = readyActions.every((action, index) => action.taskId || selectedActions.includes(index));
  const latestReady = useMemo(() => state.meetings.find((meeting) => meeting.status === "ready"), [state.meetings]);
  const listCount = state.total || state.meetings.length;

  return (
    <main className={`film-room${narrow ? " is-compact" : ""}`}>
      <div className="film-shell">
        <header className="film-head">
          {onBack ? <button type="button" className="film-back" onClick={onBack} aria-label="Back"><ArrowLeft size={18} /></button> : <span className="film-mark"><Play size={17} fill="currentColor" /></span>}
          <span><small>MEETINGS</small><strong>Meetings that turn into work.</strong><p>Record or upload a conversation. Get the brief, decisions, and next steps back.</p></span>
          <button type="button" className="film-new" onClick={() => { setComposerOpen(true); setSelected(null); }}><Plus size={16} /> <span>New meeting</span></button>
        </header>

        <section className="film-layout">
          <aside className="film-list">
            <header>
              <span>
                <strong>Meetings</strong>
                <small>{state.meetings.length.toLocaleString("en-US")}{state.hasMore || state.meetings.length < listCount ? ` of ${listCount.toLocaleString("en-US")}` : ""} saved</small>
              </span>
            </header>
            {state.loading ? <div className="film-list-state"><LoaderCircle className="is-spinning" size={17} /> Loading meetings…</div> : null}
            {!state.loading && state.error ? <ListFailure detail={state.error} busy={state.loadingMore} onRetry={() => void loadMeetings()} /> : null}
            {!state.loading && !state.error && !state.meetings.length ? (
              <div className="emptystate film-list-empty"><strong><Mic2 size={18} /> No meetings yet</strong><p>Record the first one, or upload audio you already have.</p></div>
            ) : null}
            {state.meetings.map((meeting) => (
              <div className={`film-list-row${selected?.id === meeting.id ? " is-active" : ""}`} key={meeting.id}>
                <button type="button" className="film-list-open" onClick={() => { setComposerOpen(false); void openMeeting(meeting.id); }}>
                  <span className={`film-status is-${meeting.status}`}>{meeting.status === "ready" ? <Check size={13} /> : meeting.status === "failed" ? <CircleAlert size={13} /> : <LoaderCircle className="is-spinning" size={13} />}</span>
                  <span>
                    <strong dir="auto">{meeting.title}</strong>
                    <small dir="auto">{meeting.clientName ? `${meeting.clientName} · ` : ""}{meeting.status === "ready" ? `${meeting.actionItems.length.toLocaleString("en-US")} next steps` : meeting.status === "failed" ? "Needs attention" : meeting.status === "uploading" ? "Upload paused" : "Processing"} · {meetingDate(meeting.createdAt)}</small>
                  </span>
                  <ChevronRight size={14} />
                </button>
                <button type="button" className="film-list-delete" onClick={() => requestDelete(meeting)} aria-label={`Delete ${meeting.title || "Untitled meeting"}`} title={`Delete ${meeting.title || "Untitled meeting"}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {state.hasMore ? (
              <button type="button" className="film-list-more" disabled={state.loadingMore} onClick={() => void loadMeetings({ append: true })}>
                {state.loadingMore ? <LoaderCircle className="is-spinning" size={14} /> : <History size={14} />} Load {Math.min(PAGE_SIZE, Math.max(0, listCount - state.meetings.length)).toLocaleString("en-US")} older
              </button>
            ) : null}
          </aside>

          <div className="film-stage">
            {composerOpen ? (
              <section className="film-composer">
                <header>
                  <span className={recording ? "is-recording" : ""}><Mic2 size={22} /></span>
                  <div>
                    <small>NEW MEETING</small>
                    <strong>{recording ? "Recording…" : resumeMeetingId ? "Your upload is ready to continue" : "Record or upload"}</strong>
                    <p>Up to {maxMinutes} minutes and {maxMegabytes} MB per meeting. Raw audio is deleted after processing.</p>
                  </div>
                </header>
                <div className="film-fields">
                  <label>Meeting name<input dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder="e.g. Sample Project website presentation" /></label>
                  <label>Client / company<select dir="auto" value={clientChoice} onChange={(event) => chooseComposerClient(event.target.value)}><option value="">No client yet</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}<option value="__manual__">Other client…</option></select></label>
                  {clientChoice === "__manual__" ? <label>Client name<input dir="auto" value={clientName} onChange={(event) => setClientName(event.target.value)} maxLength={240} placeholder="e.g. Sample Project" /></label> : null}
                  <label>Project<input dir="auto" value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={240} placeholder="e.g. Website redesign" /></label>
                  <label>Meeting language<select value={requestedLanguage} onChange={(event) => setRequestedLanguage(event.target.value)}><option value="fa">Persian (Farsi)</option><option value="mixed">Persian + English</option><option value="auto">Auto-detect</option><option value="en">English</option></select></label>
                </div>
                <div className={`film-recorder ${recording ? "is-recording" : ""}`}>
                  <span className="film-recorder-time">{formatDuration(recording ? recordingSeconds : audio?.durationSeconds || 0)}</span>
                  <span className="film-wave" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i style={{ height: `${10 + ((index * 17) % 32)}px` }} key={index} />)}</span>
                  {recording
                    ? <button type="button" className="is-stop" onClick={stopRecording}><Square size={16} fill="currentColor" /> Stop</button>
                    : <button type="button" onClick={() => replaceStagedAudio(() => void startRecording())}><Mic2 size={17} /> Record here</button>}
                </div>
                {recording ? <p className="film-recorder-note"><ShieldCheck size={14} /> Saved to this device every {Math.round(RECORDING_CHUNK_MS / 1000)} seconds, so closing the tab costs seconds and not the meeting.</p> : null}
                <div className="film-or"><i /><span>or upload a file</span><i /></div>
                <input ref={fileRef} type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.opus,.webm" hidden onChange={chooseFile} />
                <button type="button" className="film-upload-pick" onClick={() => fileRef.current?.click()}>
                  <Upload size={18} />
                  <span>
                    <strong>Choose audio from this device</strong>
                    <small>MP3, M4A, WAV, OGG or WebM · up to {maxMegabytes} MB and {maxMinutes} minutes</small>
                    <small>A full hour fits when it is mono at about 32 kbps. Recording here already is.</small>
                  </span>
                </button>
                {audio ? <div className="film-file"><FileAudio size={18} /><span><strong dir="auto">{audio.name}</strong><small>{megabytes(audio.blob.size)} MB{audio.durationSeconds ? ` · ${formatDuration(audio.durationSeconds)}` : ""}</small></span><CheckCircle2 size={17} /></div> : null}
                {resumeMeetingId ? <div className="film-resume-note"><Clock3 size={16} /><span><strong>Safe to resume</strong><small>The server already has {upload.progress.toLocaleString("en-US")}% of this recording.</small></span></div> : null}
                <label className="film-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><i>{consent ? <Check size={12} /> : null}</i><span><strong>Everyone knows this meeting is being recorded.</strong><small>You are responsible for informing the people in the room.</small></span></label>
                {upload.error ? <p className="film-error" role="alert"><TriangleAlert size={15} /> <span>{upload.error}</span></p> : null}
                {repair ? (
                  <div className="film-repair">
                    <Wand2 size={16} />
                    <span>
                      <strong>Make a speech-quality copy here</strong>
                      <small>Mono, 16 kHz — what Whisper listens to anyway. About {megabytes(repair.targetBytes)} MB, done in this browser; the file on your device is untouched.</small>
                    </span>
                    <button type="button" className="btn btn--gold btn--lg" disabled={repairBusy} onClick={() => void convertToSpeechCopy()}>
                      {repairBusy ? <LoaderCircle className="is-spinning" size={14} /> : <Wand2 size={14} />} {repairBusy ? "Converting…" : "Convert"}
                    </button>
                  </div>
                ) : null}
                {upload.busy || upload.progress > 0 ? (
                  <div className="film-upload-progress">
                    <span role="progressbar" aria-valuenow={upload.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress"><b style={{ width: `${upload.progress}%` }} /></span>
                    <small>{upload.busy ? "Uploading" : "Paused"} · {upload.progress.toLocaleString("en-US")}%</small>
                  </div>
                ) : null}
                <footer>
                  <button type="button" className="is-quiet" onClick={() => setComposerOpen(false)}>Close</button>
                  <button type="button" className="is-primary" onClick={() => void uploadAudio()} disabled={upload.busy || recording || !audio}><Languages size={17} /> {upload.busy ? "Uploading…" : resumeMeetingId ? "Resume upload" : "Upload meeting"}</button>
                </footer>
              </section>
            ) : selected ? (
              <article className={`film-debrief is-${selected.status}`}>
                {selected.status === "processing" || selected.status === "uploading" ? (
                  <ProcessingPanel
                    meeting={selected}
                    nowMs={nowMs}
                    onRefresh={() => { void openMeeting(selected.id); void loadMeetings(); }}
                    onDelete={() => requestDelete(selected)}
                  />
                ) : null}
                {selected.status === "failed" ? (
                  <div className="film-progress is-failed">
                    <span className="film-progress-mark"><CircleAlert size={26} /></span>
                    <small>NEEDS ATTENTION</small>
                    <h2>This meeting did not finish.</h2>
                    <p>{selected.transcript ? `${meetingError(selected.errorCode) || "The notes model could not finish."} The transcript is safe. You can retry the model or save recovered notes directly.` : meetingError(selected.errorCode) || "Film Room could not complete this recording. Try uploading it again."}</p>
                    {selected.errorCode ? <small className="film-failure-code">Failure code: {selected.errorCode}</small> : null}
                    <div className="film-progress-tools">
                      {selected.transcript ? <button type="button" className="btn btn--gold btn--lg" onClick={() => void retryFailedDebrief()}>Retry meeting notes</button>
                        : savedRecordingId === selected.id ? <button type="button" className="btn btn--gold btn--lg" onClick={() => void retrySavedRecording()}>Retry saved recording</button>
                          : <button type="button" className="btn btn--gold btn--lg" onClick={() => { setComposerOpen(true); setSelected(null); }}>Choose original recording</button>}
                      {selected.transcript ? <button type="button" className="btn btn--quiet btn--lg" onClick={() => setRecoveryOpen((open) => !open)}>{recoveryOpen ? "Close recovered notes" : "Save recovered notes"}</button> : null}
                      <button type="button" className="btn btn--danger btn--lg" onClick={() => requestDelete(selected)}>Delete this meeting</button>
                    </div>
                    {selected.transcript && recoveryOpen ? (
                      <form className="film-recovery-editor" onSubmit={(event) => { event.preventDefault(); void saveRecoveredNotes(); }}>
                        <strong>Save notes without waiting for the model</strong>
                        <p>Paste or type what you recovered. Film Room keeps the original transcript attached to this meeting.</p>
                        <label>Meeting summary<textarea required dir="auto" value={recoveryDraft.summary} onChange={(event) => setRecoveryDraft((draft) => ({ ...draft, summary: event.target.value }))} placeholder="What happened and what matters now" /></label>
                        <label>Decisions · one per line<textarea dir="auto" value={recoveryDraft.decisions} onChange={(event) => setRecoveryDraft((draft) => ({ ...draft, decisions: event.target.value }))} /></label>
                        <label>Next steps · one per line<textarea dir="auto" value={recoveryDraft.actionItems} onChange={(event) => setRecoveryDraft((draft) => ({ ...draft, actionItems: event.target.value }))} /></label>
                        <label>Open questions · one per line<textarea dir="auto" value={recoveryDraft.openQuestions} onChange={(event) => setRecoveryDraft((draft) => ({ ...draft, openQuestions: event.target.value }))} /></label>
                        <button type="submit" className="btn btn--gold btn--lg" disabled={recoveryBusy || !recoveryDraft.summary.trim()}>{recoveryBusy ? "Saving…" : "Save meeting notes"}</button>
                      </form>
                    ) : null}
                    {selected.transcript ? <details className="film-transcript"><summary><FileAudio size={16} /><span><strong>Full transcript</strong><small>The words are available now</small></span><ChevronRight size={15} /></summary><p dir="auto">{selected.transcript}</p></details> : null}
                  </div>
                ) : null}
                {selected.status === "ready" ? (
                  <>
                    <header className="film-debrief-head">
                      <span><small>MEETING DEBRIEF</small><h2 dir="auto">{selected.title}</h2><p>{meetingDate(selected.createdAt)}{selected.durationSeconds ? ` · ${formatDuration(selected.durationSeconds)}` : ""}</p></span>
                      <button type="button" onClick={() => requestDelete(selected)} aria-label={`Delete ${selected.title || "Untitled meeting"}`} title="Delete meeting"><Trash2 size={15} /></button>
                    </header>
                    <section className="film-summary"><small>THE SHORT VERSION</small><p dir="auto">{selected.summary || "No summary was captured."}</p></section>
                    <section className={`film-memory ${selected.clientName ? "is-linked" : "is-empty"}`}>
                      <header><span><Building2 size={18} /><span><small>CLIENT MEMORY</small><strong>{selected.clientName ? "Keep the relationship moving." : "Give this meeting a home."}</strong></span></span>{!memoryEditing ? <span className="film-memory-actions">{onOpenClient && (clients.find((client) => client.id === selected.clientId) || clients.find((client) => selected.clientName && client.name.toLocaleLowerCase() === selected.clientName.trim().toLocaleLowerCase())) ? <button type="button" onClick={() => onOpenClient((clients.find((client) => client.id === selected.clientId) || clients.find((client) => client.name.toLocaleLowerCase() === selected.clientName.trim().toLocaleLowerCase())).id)}>Open client</button> : null}<button type="button" onClick={() => setMemoryEditing(true)}>Manage</button></span> : null}</header>
                      {memoryEditing ? <div className="film-memory-form">
                        <label>Client / company<select dir="auto" value={memoryDraft.clientChoice} onChange={(event) => chooseMemoryClient(event.target.value)}><option value="">No client</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}<option value="__manual__">Other client…</option></select></label>
                        {memoryDraft.clientChoice === "__manual__" ? <label>Client name<input dir="auto" value={memoryDraft.clientName} maxLength={240} onChange={(event) => setMemoryDraft((current) => ({ ...current, clientName: event.target.value }))} placeholder="e.g. Sample Project" /></label> : null}
                        <label>Project<input dir="auto" value={memoryDraft.projectName} maxLength={240} onChange={(event) => setMemoryDraft((current) => ({ ...current, projectName: event.target.value }))} placeholder="e.g. Website redesign" /></label>
                        <label>Next follow-up<input type="date" value={memoryDraft.followUpOn} onChange={(event) => setMemoryDraft((current) => ({ ...current, followUpOn: event.target.value }))} /></label>
                        <footer>{selected.clientName ? <button type="button" onClick={() => { setMemoryEditing(false); writeSession({ drafts: null }); }}>Cancel</button> : <span>Link it now; your future self will know what happened.</span>}<button type="button" className="is-save" disabled={memoryBusy || (memoryDraft.clientChoice !== "" && !memoryDraft.clientName.trim())} onClick={() => void saveClientMemory()}>{memoryBusy ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />} Save memory</button></footer>
                      </div> : <>
                        <div className="film-memory-now">
                          <span><Building2 size={17} /><span><small>CLIENT</small><strong dir="auto">{selected.clientName}</strong></span></span>
                          <span><BriefcaseBusiness size={17} /><span><small>PROJECT</small><strong dir="auto">{selected.projectName || "General relationship"}</strong></span></span>
                          <span><CalendarPlus size={17} /><span><small>NEXT FOLLOW-UP</small><strong className={selected.followUpOn && isOverdue(selected.followUpOn) ? "is-overdue" : ""}>{selected.followUpOn ? dueLabel(selected.followUpOn) : "Not scheduled"}</strong></span></span>
                        </div>
                        {selected.followUpOn ? <div className="film-memory-followup"><span>{selected.followUpTaskId ? <CheckCircle2 size={16} /> : <CalendarPlus size={16} />}<span><strong>{selected.followUpTaskId ? "Follow-up is on the task board" : "Make the follow-up impossible to forget"}</strong><small>{selected.followUpTaskId ? dueLabel(selected.followUpOn) : "The date is saved here. Add it to the task board when you are ready."}</small></span></span>{!selected.followUpTaskId ? <button type="button" disabled={followUpBusy} onClick={() => void addFollowUpTask()}>{followUpBusy ? <LoaderCircle className="is-spinning" size={14} /> : <Plus size={14} />} Add to the task board</button> : null}</div> : null}
                        <div className="film-memory-history"><header><span><History size={16} /><strong>Relationship timeline</strong></span><small>{clientHistory.length} {clientHistory.length === 1 ? "meeting" : "meetings"}</small></header><div>{clientHistory.slice(0, 5).map((meeting) => <button type="button" className={meeting.id === selected.id ? "is-current" : ""} disabled={meeting.id === selected.id} onClick={() => void openMeeting(meeting.id)} key={meeting.id}><span><strong dir="auto">{meeting.title}</strong><small dir="auto">{meeting.projectName || selected.clientName}</small></span><em>{meetingDate(meeting.createdAt)}</em>{meeting.id === selected.id ? <b>NOW</b> : <ChevronRight size={14} />}</button>)}</div></div>
                      </>}
                    </section>
                    {selected.clientRecap ? <section className="film-client-recap">
                      <header>
                        <span><FileText size={18} /><span><small>CLIENT COPY</small><strong>Review it, then send it.</strong></span></span>
                        <div className="film-recap-tools">
                          {!recapEditing ? <button type="button" onClick={() => setRecapEditing(true)}>Edit</button> : null}
                          <button type="button" onClick={() => void copyClientRecap()}><ClipboardCopy size={14} /> Copy</button>
                          <button type="button" className="is-share" onClick={() => void shareClientRecap()}><Share2 size={14} /> Share</button>
                        </div>
                      </header>
                      {recapEditing ? <div className="film-recap-editor">
                        <textarea dir="auto" value={recapDraft} maxLength={20000} onChange={(event) => setRecapDraft(event.target.value)} aria-label="Client recap" />
                        <footer><button type="button" onClick={() => { setRecapDraft(selected.clientRecap); setRecapEditing(false); writeSession({ drafts: null }); }}>Cancel</button><button type="button" className="is-save" disabled={recapBusy || !recapDraft.trim()} onClick={() => void saveClientRecap()}>{recapBusy ? <LoaderCircle className="is-spinning" size={14} /> : <Save size={14} />} Save recap</button></footer>
                      </div> : <RecapDocument text={selected.clientRecap} />}
                      <p className="film-recap-note"><ShieldCheck size={14} /> Uses the summary, explicit decisions, agreed actions, and open items. Review before sending.</p>
                    </section> : null}
                    <div className="film-debrief-grid">
                      <DebriefSection title="Decisions made" icon={CheckCircle2} items={selected.decisions} />
                      <DebriefSection title="Open questions" icon={MessageSquareText} items={selected.openQuestions} />
                      <DebriefSection title="Risks and blockers" icon={CircleAlert} items={selected.risks} />
                    </div>
                    <section className="film-actions">
                      <header><span><ListChecks size={18} /><span><small>NEXT STEPS</small><strong>Create only the work you approve.</strong></span></span>{readyActions.length ? <button type="button" onClick={() => setSelectedActions(allAvailableSelected ? [] : readyActions.map((action, index) => action.taskId ? null : index).filter((index) => index !== null))}>{allAvailableSelected ? "Clear" : "Select all"}</button> : null}</header>
                      {readyActions.length ? readyActions.map((action, index) => (
                        <label className={action.taskId ? "is-created" : ""} key={`${action.text}-${index}`}><input type="checkbox" disabled={Boolean(action.taskId)} checked={Boolean(action.taskId || selectedActions.includes(index))} onChange={() => setSelectedActions((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])} /><i>{action.taskId || selectedActions.includes(index) ? <Check size={12} /> : null}</i><span><strong dir="auto">{action.text}</strong><small dir="auto">{action.taskId ? "On the task board" : actionMeta(action) || "No explicit owner or date"}</small></span></label>
                      )) : <EmptySection />}
                      {selectedActions.length ? <button type="button" className="film-create-tasks" disabled={taskBusy} onClick={() => void createTasks()}>{taskBusy ? <LoaderCircle className="is-spinning" size={16} /> : <Plus size={16} />} Create {selectedActions.length.toLocaleString("en-US")} {selectedActions.length === 1 ? "task" : "tasks"}</button> : null}
                    </section>
                    {selected.followUpDraft ? <section className="film-followup"><header><span><MessageSquareText size={17} /><strong>Follow-up draft</strong></span><button type="button" onClick={() => void copyFollowUp()}><ClipboardCopy size={14} /> Copy</button></header><p dir="auto">{selected.followUpDraft}</p></section> : null}
                    <details className="film-transcript"><summary><FileAudio size={16} /><span><strong>Full transcript</strong><small>Open when you need the exact words</small></span><ChevronRight size={15} /></summary><p dir="auto">{selected.transcript}</p></details>
                  </>
                ) : null}
              </article>
            ) : (
              <section className="film-welcome"><span className="film-welcome-mark"><Play size={26} fill="currentColor" /></span><small>MEETINGS</small><h2>{latestReady ? "Do not leave the next meeting to memory." : "Every meeting should leave with a plan."}</h2><p>Give Agent4 the recording. It returns the useful version: what mattered, what was decided, and what should happen next.</p><div><span><Mic2 size={18} /><b>Capture anywhere</b><small>Record here or upload from your phone</small></span><span><Languages size={18} /><b>Real Farsi support</b><small>Persian, English, or a mixed conversation</small></span><span><ListChecks size={18} /><b>You approve the work</b><small>Nothing reaches the task board automatically</small></span></div><button type="button" onClick={() => setComposerOpen(true)}><Mic2 size={17} /> Start a meeting</button><em><ShieldCheck size={14} /> Resumable upload · raw audio deleted after processing</em></section>
            )}
          </div>
        </section>
      </div>
      <FilmNotice notice={notice} onDismiss={() => setNotice(null)} />
      <ConfirmDialog
        open={Boolean(confirming)}
        title={confirming?.title || ""}
        body={confirming?.body || ""}
        detail={confirming?.detail || ""}
        confirmLabel={confirming?.confirmLabel || "Delete"}
        busy={confirmBusy}
        onCancel={() => { if (!confirmBusy) setConfirming(null); }}
        onConfirm={() => {
          const action = confirming?.onConfirm;
          if (!action) return;
          const result = action();
          if (!(result instanceof Promise)) setConfirming(null);
        }}
      />
    </main>
  );
}
