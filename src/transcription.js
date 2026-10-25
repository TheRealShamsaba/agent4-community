import { isIP } from "node:net";
import { Agent } from "undici";

const MEBIBYTE = 1024 * 1024;

export const VOICE_LIMITS = Object.freeze({
  maxBytes: 10 * MEBIBYTE,
  minDurationSeconds: 1,
  maxDurationSeconds: 120,
  maxTranscriptChars: 12_000,
  maxProviderResponseBytes: 512 * 1024,
  telegramTimeoutMs: 15_000,
  downloadTimeoutMs: 30_000,
  transcriptionTimeoutMs: 60_000
});

export const MEETING_TRANSCRIPTION_LIMITS = Object.freeze({
  maxBytes: 20 * MEBIBYTE,
  maxDurationSeconds: 60 * 60,
  maxTranscriptChars: 200_000,
  maxProviderResponseBytes: 4 * MEBIBYTE,
  transcriptionTimeoutMs: 30 * 60_000
});

const AUDIO_TYPES = new Map([
  ["audio/ogg", "ogg"],
  ["audio/opus", "opus"],
  ["audio/mp4", "m4a"],
  ["audio/m4a", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/webm", "webm"],
  ["audio/wav", "wav"],
  ["audio/wave", "wav"],
  ["audio/x-wav", "wav"]
]);

const ERROR_DEFINITIONS = Object.freeze({
  INVALID_VOICE_METADATA: ["The voice note metadata is incomplete.", false],
  VOICE_TOO_SHORT: ["Voice notes must be at least 1 second long.", false],
  VOICE_TOO_LONG: ["Voice notes can be at most 2 minutes long.", false],
  VOICE_TOO_LARGE: ["Voice notes can be at most 10 MB.", false],
  UNSUPPORTED_AUDIO_TYPE: ["That voice-note audio format is not supported.", false],
  TELEGRAM_FILE_TIMEOUT: ["Telegram took too long to prepare the voice note.", true],
  TELEGRAM_FILE_UNAVAILABLE: ["Telegram could not prepare the voice note.", true],
  VOICE_DOWNLOAD_TIMEOUT: ["The voice note download timed out.", true],
  VOICE_DOWNLOAD_FAILED: ["The voice note could not be downloaded.", true],
  VOICE_DOWNLOAD_TOO_LARGE: ["The downloaded voice note exceeds the 10 MB limit.", false],
  VOICE_AUDIO_EMPTY: ["The downloaded voice note is empty.", false],
  INVALID_WHISPER_ENDPOINT: ["The private transcription service is not configured safely.", false],
  TRANSCRIPTION_TIMEOUT: ["Voice transcription timed out. Please try a shorter note.", true],
  TRANSCRIPTION_UNAVAILABLE: ["The private transcription service is unavailable.", true],
  TRANSCRIPTION_INVALID_RESPONSE: ["The private transcription service returned an invalid response.", true],
  TRANSCRIPT_EMPTY: ["No speech was detected in the voice note.", false],
  TRANSCRIPT_TOO_LONG: ["The voice-note transcript is too long to process safely.", false]
});

export class TranscriptionError extends Error {
  constructor(code) {
    const [message, retryable] = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.TRANSCRIPTION_UNAVAILABLE;
    super(message);
    this.name = "TranscriptionError";
    this.code = ERROR_DEFINITIONS[code] ? code : "TRANSCRIPTION_UNAVAILABLE";
    this.retryable = retryable;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable
    };
  }
}

function fail(code) {
  throw new TranscriptionError(code);
}

function finiteNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeMimeType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function normalizeWhisperLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  // whisper.cpp accepts ISO-639-1 language codes. A mixed-language meeting
  // still needs detection, while an explicit Farsi or English choice should
  // never be discarded and re-guessed from the first seconds of audio.
  return ["fa", "en"].includes(language) ? language : "auto";
}

function validateVoiceMetadata(voice) {
  if (!voice || typeof voice !== "object") fail("INVALID_VOICE_METADATA");

  const fileId = String(voice.file_id ?? voice.fileId ?? "").trim();
  const fileSize = finiteNumber(voice.file_size ?? voice.fileSize);
  const durationSeconds = finiteNumber(voice.duration);
  const mimeType = normalizeMimeType(voice.mime_type ?? voice.mimeType);

  if (!fileId || fileId.length > 512 || (fileSize !== null && fileSize <= 0) || durationSeconds === null) {
    fail("INVALID_VOICE_METADATA");
  }
  if (durationSeconds < VOICE_LIMITS.minDurationSeconds) fail("VOICE_TOO_SHORT");
  if (durationSeconds > VOICE_LIMITS.maxDurationSeconds) fail("VOICE_TOO_LONG");
  if (fileSize !== null && fileSize > VOICE_LIMITS.maxBytes) fail("VOICE_TOO_LARGE");
  if (!AUDIO_TYPES.has(mimeType)) fail("UNSUPPORTED_AUDIO_TYPE");

  return { fileId, fileSize, durationSeconds, mimeType };
}

function boundedOption(value, hardMaximum, fallback) {
  const number = finiteNumber(value);
  if (number === null || number <= 0) return fallback;
  return Math.min(Math.floor(number), hardMaximum);
}

function timeoutOption(value, fallback) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? Math.floor(number) : fallback;
}

export function whisperTransportTimeouts(timeoutMs) {
  const operationTimeoutMs = timeoutOption(timeoutMs, VOICE_LIMITS.transcriptionTimeoutMs);
  // Node's built-in fetch stops waiting for response headers after 5 minutes,
  // even when the caller's AbortSignal allows a longer Film Room job. Keep the
  // transport just beyond our own deadline so withTimeout remains authoritative.
  return {
    headersTimeout: operationTimeoutMs + 5_000,
    bodyTimeout: operationTimeoutMs + 5_000,
    connectTimeout: Math.min(operationTimeoutMs, 10_000)
  };
}

async function withTimeout(timeoutMs, timeoutCode, operation) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TranscriptionError(timeoutCode));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeout
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function safeFilePath(file) {
  const filePath = typeof file === "string"
    ? file
    : file?.file_path ?? file?.filePath;
  const value = String(filePath || "").trim();

  // Telegram returns a relative opaque path. Reject URLs and traversal so bot
  // credentials stay inside the caller-owned download adapter.
  if (
    !value ||
    value.length > 512 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.split("/").includes("..") ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  ) {
    fail("TELEGRAM_FILE_UNAVAILABLE");
  }
  return value;
}

function headerNumber(headers, name) {
  if (!headers || typeof headers.get !== "function") return null;
  const value = finiteNumber(headers.get(name));
  return value !== null && value >= 0 ? value : null;
}

function byteView(value) {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

async function readWebStream(stream, maxBytes, tooLargeCode, invalidCode, signal) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = byteView(value);
      if (!chunk) fail(invalidCode);
      total += chunk.byteLength;
      if (total > maxBytes) {
        cancel();
        fail(tooLargeCode);
      }
      chunks.push(chunk);
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readBodyBounded(value, maxBytes, tooLargeCode, invalidCode, signal) {
  const directBytes = byteView(value);
  if (directBytes) {
    if (directBytes.byteLength > maxBytes) fail(tooLargeCode);
    return new Uint8Array(directBytes);
  }

  if (value instanceof Blob) {
    if (value.size > maxBytes) fail(tooLargeCode);
    return new Uint8Array(await value.arrayBuffer());
  }

  if (!value || typeof value !== "object") fail(invalidCode);
  if (value.ok === false) fail(invalidCode);

  const contentLength = headerNumber(value.headers, "content-length");
  if (contentLength !== null && contentLength > maxBytes) fail(tooLargeCode);
  if (!value.body || typeof value.body.getReader !== "function") fail(invalidCode);

  return readWebStream(value.body, maxBytes, tooLargeCode, invalidCode, signal);
}

function loopbackWhisperEndpoint(input) {
  let endpoint;
  try {
    endpoint = new URL(String(input || ""));
  } catch {
    fail("INVALID_WHISPER_ENDPOINT");
  }

  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = isIP(hostname);
  const isLoopback = hostname === "localhost" || hostname === "::1" || (ipVersion === 4 && hostname.startsWith("127."));
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    !isLoopback ||
    endpoint.username ||
    endpoint.password
  ) {
    fail("INVALID_WHISPER_ENDPOINT");
  }
  return endpoint.toString();
}

/** Fail quickly before a long private recording is uploaded to an offline worker. */
export async function checkWhisperService(options = {}) {
  const endpoint = new URL(loopbackWhisperEndpoint(options.whisperEndpoint));
  endpoint.pathname = "/";
  endpoint.search = "";
  endpoint.hash = "";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") fail("TRANSCRIPTION_UNAVAILABLE");
  try {
    await withTimeout(timeoutOption(options.timeoutMs, 2_500), "TRANSCRIPTION_UNAVAILABLE", async (signal) => {
      const response = await fetchImpl(endpoint, { method: "GET", signal });
      if (!response || response.ok !== true) fail("TRANSCRIPTION_UNAVAILABLE");
    });
    return true;
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    fail("TRANSCRIPTION_UNAVAILABLE");
  }
}

function segmentText(payload, separator = " ") {
  if (!Array.isArray(payload?.segments)) return null;
  const text = payload.segments
    .map((segment) => typeof segment?.text === "string" ? segment.text.trim() : "")
    .filter(Boolean)
    .join(separator);
  return text || null;
}

function paragraphText(payload, targetChars = 360) {
  if (!Array.isArray(payload?.segments)) return null;
  const paragraphs = [];
  let paragraph = "";
  for (const segment of payload.segments) {
    const text = typeof segment?.text === "string" ? segment.text.trim() : "";
    if (!text) continue;
    if (paragraph && paragraph.length + text.length + 1 > targetChars) {
      paragraphs.push(paragraph);
      paragraph = text;
    } else {
      paragraph = paragraph ? `${paragraph} ${text}` : text;
    }
  }
  if (paragraph) paragraphs.push(paragraph);
  return paragraphs.length ? paragraphs.join("\n\n") : null;
}

function transcriptFromPayload(payload, preferSegments = false) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (preferSegments) {
    const segmented = paragraphText(payload);
    if (segmented) return segmented;
  }
  for (const value of [payload.text, payload.transcript, payload.transcription, payload.result?.text]) {
    if (typeof value === "string") return value;
  }

  for (const value of [payload.transcription]) {
    if (Array.isArray(value)) {
      const segmentText = value
        .map((segment) => typeof segment?.text === "string" ? segment.text : "")
        .filter(Boolean)
        .join(" ");
      if (segmentText) return segmentText;
    }
  }
  return segmentText(payload);
}

function normalizeTranscript(value, maxChars, preserveParagraphs = false) {
  if (typeof value !== "string") fail("TRANSCRIPTION_INVALID_RESPONSE");
  let text = value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  text = preserveParagraphs
    ? text
        .replace(/\r\n?/g, "\n")
        .split(/\n+/)
        .map((paragraph) => paragraph.replace(/[\t ]+/g, " ").trim())
        .filter(Boolean)
        .join("\n\n")
    : text.replace(/\s+/g, " ").trim();
  if (!text) fail("TRANSCRIPT_EMPTY");
  if (text.length > maxChars) fail("TRANSCRIPT_TOO_LONG");
  return text;
}

async function getTelegramFile(getFile, metadata, timeoutMs) {
  try {
    return await withTimeout(timeoutMs, "TELEGRAM_FILE_TIMEOUT", (signal) =>
      getFile(metadata.fileId, { signal })
    );
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    fail("TELEGRAM_FILE_UNAVAILABLE");
  }
}

async function downloadTelegramFile(downloadFile, filePath, timeoutMs) {
  try {
    return await withTimeout(timeoutMs, "VOICE_DOWNLOAD_TIMEOUT", async (signal) => {
      const response = await downloadFile(filePath, {
        signal,
        maxBytes: VOICE_LIMITS.maxBytes
      });
      return readBodyBounded(
        response,
        VOICE_LIMITS.maxBytes,
        "VOICE_DOWNLOAD_TOO_LARGE",
        "VOICE_DOWNLOAD_FAILED",
        signal
      );
    });
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    fail("VOICE_DOWNLOAD_FAILED");
  }
}

async function requestWhisper({
  audio,
  mimeType,
  language,
  fetchImpl,
  endpoint,
  timeoutMs,
  maxProviderResponseBytes,
  maxTranscriptChars,
  preserveSegments = false
}) {
  const extension = AUDIO_TYPES.get(mimeType);
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mimeType }), `voice.${extension}`);
  // Film Room only stores the transcript text. Asking whisper.cpp for token
  // timestamps and every segment adds measurable work on long recordings;
  // the compact JSON response keeps Whisper's paragraph breaks in `text`.
  form.append("response_format", "json");
  form.append("language", normalizeWhisperLanguage(language));

  const dispatcher = fetchImpl ? null : new Agent(whisperTransportTimeouts(timeoutMs));
  // Keep Node's native FormData and fetch paired; the explicit dispatcher
  // replaces only its hidden five-minute transport deadline.
  const whisperFetch = fetchImpl || globalThis.fetch;
  let responseBytes;
  try {
    responseBytes = await withTimeout(timeoutMs, "TRANSCRIPTION_TIMEOUT", async (signal) => {
      const response = await whisperFetch(endpoint, {
        method: "POST",
        body: form,
        signal,
        ...(dispatcher ? { dispatcher } : {})
      });
      if (!response || response.ok !== true) fail("TRANSCRIPTION_UNAVAILABLE");
      return readBodyBounded(
        response,
        maxProviderResponseBytes,
        "TRANSCRIPTION_INVALID_RESPONSE",
        "TRANSCRIPTION_INVALID_RESPONSE",
        signal
      );
    });
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    if (["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(error?.cause?.code || error?.code)) {
      fail("TRANSCRIPTION_TIMEOUT");
    }
    fail("TRANSCRIPTION_UNAVAILABLE");
  } finally {
    await dispatcher?.close().catch(() => dispatcher.destroy());
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(responseBytes).toString("utf8"));
  } catch {
    fail("TRANSCRIPTION_INVALID_RESPONSE");
  }
  return normalizeTranscript(
    transcriptFromPayload(payload, preserveSegments),
    maxTranscriptChars,
    preserveSegments
  );
}

/**
 * Transcribe one private Telegram voice note without persisting its audio.
 *
 * `getFile` receives the opaque Telegram file id and must return Telegram's
 * relative `file_path`. `downloadFile` receives only that relative path and
 * owns all bot-token handling. It may return a Fetch Response, Uint8Array,
 * ArrayBuffer, or Blob. No provider error body or adapter error is surfaced.
 */
export async function transcribeTelegramVoice(voice, options = {}) {
  const metadata = validateVoiceMetadata(voice);
  const getFile = options.getFile;
  const downloadFile = options.downloadFile;
  const fetchImpl = options.fetchImpl;
  if (typeof getFile !== "function" || typeof downloadFile !== "function") {
    fail("INVALID_VOICE_METADATA");
  }
  if (fetchImpl != null && typeof fetchImpl !== "function") fail("TRANSCRIPTION_UNAVAILABLE");

  const endpoint = loopbackWhisperEndpoint(options.whisperEndpoint);
  const telegramTimeoutMs = timeoutOption(options.telegramTimeoutMs, VOICE_LIMITS.telegramTimeoutMs);
  const downloadTimeoutMs = timeoutOption(options.downloadTimeoutMs, VOICE_LIMITS.downloadTimeoutMs);
  const transcriptionTimeoutMs = timeoutOption(
    options.transcriptionTimeoutMs,
    VOICE_LIMITS.transcriptionTimeoutMs
  );
  const maxTranscriptChars = boundedOption(
    options.maxTranscriptChars,
    VOICE_LIMITS.maxTranscriptChars,
    VOICE_LIMITS.maxTranscriptChars
  );
  const maxProviderResponseBytes = boundedOption(
    options.maxProviderResponseBytes,
    VOICE_LIMITS.maxProviderResponseBytes,
    VOICE_LIMITS.maxProviderResponseBytes
  );

  const telegramFile = await getTelegramFile(getFile, metadata, telegramTimeoutMs);
  const resolvedSize = finiteNumber(telegramFile?.file_size ?? telegramFile?.fileSize);
  if (resolvedSize !== null && resolvedSize > VOICE_LIMITS.maxBytes) fail("VOICE_TOO_LARGE");
  const filePath = safeFilePath(telegramFile);
  const audio = await downloadTelegramFile(downloadFile, filePath, downloadTimeoutMs);
  if (audio.byteLength === 0) fail("VOICE_AUDIO_EMPTY");

  return requestWhisper({
    audio,
    mimeType: metadata.mimeType,
    language: options.language,
    fetchImpl,
    endpoint,
    timeoutMs: transcriptionTimeoutMs,
    maxProviderResponseBytes,
    maxTranscriptChars
  });
}

/** Transcribe one private long-form meeting recording already held by Agent4. */
export async function transcribeMeetingAudio(audio, options = {}) {
  const bytes = byteView(audio);
  if (!bytes || bytes.byteLength === 0) fail("VOICE_AUDIO_EMPTY");
  if (bytes.byteLength > MEETING_TRANSCRIPTION_LIMITS.maxBytes) fail("VOICE_TOO_LARGE");
  const mimeType = normalizeMimeType(options.mimeType);
  if (!AUDIO_TYPES.has(mimeType)) fail("UNSUPPORTED_AUDIO_TYPE");
  const fetchImpl = options.fetchImpl;
  if (fetchImpl != null && typeof fetchImpl !== "function") fail("TRANSCRIPTION_UNAVAILABLE");
  return requestWhisper({
    audio: bytes,
    mimeType,
    language: options.language,
    fetchImpl,
    endpoint: loopbackWhisperEndpoint(options.whisperEndpoint),
    timeoutMs: timeoutOption(options.transcriptionTimeoutMs, MEETING_TRANSCRIPTION_LIMITS.transcriptionTimeoutMs),
    maxProviderResponseBytes: boundedOption(
      options.maxProviderResponseBytes,
      MEETING_TRANSCRIPTION_LIMITS.maxProviderResponseBytes,
      MEETING_TRANSCRIPTION_LIMITS.maxProviderResponseBytes
    ),
    maxTranscriptChars: boundedOption(
      options.maxTranscriptChars,
      MEETING_TRANSCRIPTION_LIMITS.maxTranscriptChars,
      MEETING_TRANSCRIPTION_LIMITS.maxTranscriptChars
    ),
    preserveSegments: true
  });
}

export function createTelegramVoiceTranscriber(options) {
  return (voice) => transcribeTelegramVoice(voice, options);
}
