import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createMeetingService } from "../src/meeting-service.js";
import { createMeetingStore } from "../src/meeting-store.js";

async function waitForMeeting(store, id, actorId, status) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const meeting = store.getMeeting(id, actorId);
    if (meeting?.status === status) return meeting;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Meeting ${id} did not reach ${status}.`);
}

async function waitForNotification(store, id, actorId) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const meeting = store.getMeeting(id, actorId);
    if (meeting?.readyNotifiedAt) return meeting;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Meeting ${id} did not record its ready notification.`);
}

test("Film Room joins chunks, produces a Farsi debrief, and deletes raw audio", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-film-room-"));
  const tempRoot = path.join(directory, "audio");
  const store = createMeetingStore(path.join(directory, "meetings.sqlite"));
  let service;
  t.after(async () => {
    service?.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  let transcriptionOptions;
  let debriefInput;
  const notifications = [];
  service = createMeetingService({
    config: { runtime: { voiceTranscriptionUrl: "http://127.0.0.1:8178/inference" } },
    store,
    tempRoot,
    transcribe: async (audio, options) => {
      transcriptionOptions = options;
      assert.equal(audio.toString("utf8"), "جلسه فارسی");
      return "قرار شد نسخه نهایی را فردا بفرستم.";
    },
    generateDebrief: async (_config, input) => {
      debriefInput = input;
      return {
        detectedLanguage: "fa",
        title: "جلسه معرفی سایت",
        summary: "نسخه نهایی باید فردا ارسال شود.",
        decisions: ["نسخه فعلی تأیید شد."],
        actionItems: [{ text: "نسخه نهایی را بفرست", owner: "من", dueOn: "2026-09-01", confidence: "explicit", taskId: null }],
        openQuestions: [],
        risks: [],
        followUpDraft: "سلام، طبق جلسه نسخه نهایی را فردا می‌فرستم."
      };
    },
    notifyComplete: async (meeting) => notifications.push(meeting.title)
  });

  const raw = Buffer.from("جلسه فارسی");
  const splitAt = 8;
  let meeting = store.createMeeting({
    actorId: "owner-1",
    title: "جلسه معرفی سایت",
    requestedLanguage: "fa",
    mimeType: "audio/webm",
    durationSeconds: 75,
    totalParts: 2
  });
  meeting = await service.acceptChunk({ meeting, actorId: "owner-1", part: 0, bytes: raw.subarray(0, splitAt) });
  meeting = await service.acceptChunk({ meeting, actorId: "owner-1", part: 1, bytes: raw.subarray(splitAt) });
  assert.equal(meeting.status, "processing");

  const ready = await waitForMeeting(store, meeting.id, "owner-1", "ready");
  assert.equal(ready.detectedLanguage, "fa");
  assert.match(ready.summary, /فردا/);
  assert.equal(transcriptionOptions.mimeType, "audio/webm");
  assert.equal(transcriptionOptions.language, "fa");
  assert.equal(transcriptionOptions.whisperEndpoint, "http://127.0.0.1:8178/inference");
  assert.equal(debriefInput.requestedLanguage, "fa");
  assert.match(debriefInput.transcript, /قرار شد/);
  const notified = await waitForNotification(store, meeting.id, "owner-1");
  assert.ok(notified.readyNotifiedAt);
  assert.deepEqual(notifications, ["جلسه معرفی سایت"]);
  await assert.rejects(stat(path.join(tempRoot, `${meeting.id}.audio`)), /ENOENT/);
});

test("Film Room waits for transient model capacity after transcription", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-film-room-capacity-"));
  const tempRoot = path.join(directory, "audio");
  const store = createMeetingStore(path.join(directory, "meetings.sqlite"));
  let attempts = 0;
  const waits = [];
  const service = createMeetingService({
    config: { runtime: { voiceTranscriptionUrl: "http://127.0.0.1:8178/inference" } },
    store,
    tempRoot,
    capacityRetryDelays: [25],
    wait: async (milliseconds) => waits.push(milliseconds),
    transcribe: async () => "The team approved the launch.",
    generateDebrief: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("temporary server pressure");
        error.name = "AiCapacityError";
        throw error;
      }
      return {
        detectedLanguage: "en",
        title: "Launch review",
        summary: "The launch was approved.",
        decisions: ["Launch approved"],
        actionItems: [],
        openQuestions: [],
        risks: [],
        followUpDraft: ""
      };
    }
  });
  t.after(async () => {
    service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  let meeting = store.createMeeting({
    actorId: "owner-1",
    requestedLanguage: "en",
    mimeType: "audio/webm",
    totalParts: 1
  });
  meeting = await service.acceptChunk({ meeting, actorId: "owner-1", part: 0, bytes: Buffer.from("audio") });

  const ready = await waitForMeeting(store, meeting.id, "owner-1", "ready");
  assert.equal(ready.summary, "The launch was approved.");
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [25]);
});

test("Film Room resumes an interrupted mobile upload without duplicating committed chunks", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-film-room-resume-"));
  const tempRoot = path.join(directory, "audio");
  const databasePath = path.join(directory, "meetings.sqlite");
  let store = createMeetingStore(databasePath);
  let service = createMeetingService({
    config: { runtime: { voiceTranscriptionUrl: "http://127.0.0.1:8178/inference" } },
    store,
    tempRoot
  });
  t.after(async () => {
    service?.close();
    store?.close();
    await rm(directory, { recursive: true, force: true });
  });

  const firstPart = Buffer.from("first-");
  const secondPart = Buffer.from("second");
  let meeting = store.createMeeting({
    actorId: "owner-1",
    requestedLanguage: "fa",
    mimeType: "audio/webm",
    totalParts: 2
  });
  meeting = await service.acceptChunk({ meeting, actorId: "owner-1", part: 0, bytes: firstPart });
  service.close();
  store.close();

  store = createMeetingStore(databasePath);
  let transcribedAudio = "";
  service = createMeetingService({
    config: { runtime: { voiceTranscriptionUrl: "http://127.0.0.1:8178/inference" } },
    store,
    tempRoot,
    transcribe: async (audio) => {
      transcribedAudio = audio.toString("utf8");
      return "جلسه کامل شد";
    },
    generateDebrief: async () => ({
      detectedLanguage: "fa",
      title: "جلسه بازیابی‌شده",
      summary: "بارگذاری کامل شد.",
      decisions: [],
      actionItems: [],
      openQuestions: [],
      risks: [],
      followUpDraft: ""
    })
  });
  await service.recoverPending();
  meeting = store.getMeeting(meeting.id, "owner-1");
  const duplicate = await service.acceptChunk({ meeting, actorId: "owner-1", part: 0, bytes: firstPart });
  assert.equal(duplicate.uploadParts, 1);
  await service.acceptChunk({ meeting: duplicate, actorId: "owner-1", part: 1, bytes: secondPart });

  await waitForMeeting(store, meeting.id, "owner-1", "ready");
  assert.equal(transcribedAudio, "first-second");
});

test("Film Room restarts a durable processing job after the HQ server restarts", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-film-room-processing-recovery-"));
  const tempRoot = path.join(directory, "audio");
  const databasePath = path.join(directory, "meetings.sqlite");
  let store = createMeetingStore(databasePath);
  t.after(async () => {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  });

  const meeting = store.createMeeting({
    actorId: "owner-1",
    requestedLanguage: "en",
    mimeType: "audio/mpeg",
    totalParts: 1
  });
  await mkdir(tempRoot, { recursive: true });
  await writeFile(path.join(tempRoot, `${meeting.id}.audio`), "durable audio", { mode: 0o600 });
  store.recordUploadPart(meeting.id, "owner-1", { part: 0, bytes: Buffer.byteLength("durable audio") });
  store.markProcessing(meeting.id, "owner-1");
  store.close();

  store = createMeetingStore(databasePath);
  const service = createMeetingService({
    config: { runtime: { voiceTranscriptionUrl: "http://127.0.0.1:8178/inference" } },
    store,
    tempRoot,
    transcribe: async () => "The team approved the launch.",
    generateDebrief: async () => ({
      detectedLanguage: "en",
      title: "Launch review",
      summary: "The launch was approved.",
      decisions: ["Launch approved"],
      actionItems: [],
      openQuestions: [],
      risks: [],
      followUpDraft: ""
    })
  });
  t.after(() => service.close());
  await service.recoverPending();
  const ready = await waitForMeeting(store, meeting.id, "owner-1", "ready");
  assert.equal(ready.summary, "The launch was approved.");
});

test("Film Room removes raw audio when processing fails", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-film-room-failure-"));
  const tempRoot = path.join(directory, "audio");
  const store = createMeetingStore(path.join(directory, "meetings.sqlite"));
  let service;
  t.after(async () => {
    service?.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  service = createMeetingService({
    config: { runtime: { voiceTranscriptionUrl: "http://127.0.0.1:8178/inference" } },
    store,
    tempRoot,
    transcribe: async () => {
      const error = new Error("private provider details");
      error.code = "TRANSCRIPTION_TIMEOUT";
      throw error;
    }
  });
  let meeting = store.createMeeting({
    actorId: "owner-1",
    requestedLanguage: "fa",
    mimeType: "audio/webm",
    totalParts: 1
  });
  meeting = await service.acceptChunk({ meeting, actorId: "owner-1", part: 0, bytes: Buffer.from("audio") });

  const failed = await waitForMeeting(store, meeting.id, "owner-1", "failed");
  assert.equal(failed.errorCode, "TRANSCRIPTION_TIMEOUT");
  await assert.rejects(readFile(path.join(tempRoot, `${meeting.id}.audio`)), /ENOENT/);
});

test("Film Room keeps words after a debrief failure and retries without the recording", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-film-room-notes-retry-"));
  const tempRoot = path.join(directory, "audio");
  const store = createMeetingStore(path.join(directory, "meetings.sqlite"));
  let transcriptionCalls = 0;
  let debriefCalls = 0;
  let service;
  t.after(async () => {
    service?.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  service = createMeetingService({
    config: { runtime: { voiceTranscriptionUrl: "http://127.0.0.1:8178/inference" } },
    store,
    tempRoot,
    transcribe: async () => { transcriptionCalls += 1; return "The client approved the homepage. Send the revised copy Friday."; },
    generateDebrief: async () => {
      debriefCalls += 1;
      if (debriefCalls === 1) throw new Error("model refused the first response");
      return { detectedLanguage: "en", title: "Homepage review", summary: "Homepage approved; send copy Friday.", decisions: ["Homepage approved"], actionItems: [], openQuestions: [], risks: [] };
    }
  });
  let meeting = store.createMeeting({ actorId: "owner-1", title: "Homepage review", mimeType: "audio/webm", totalParts: 1 });
  meeting = await service.acceptChunk({ meeting, actorId: "owner-1", part: 0, bytes: Buffer.from("recording") });
  const failed = await waitForMeeting(store, meeting.id, "owner-1", "failed");
  assert.match(failed.transcript, /homepage/);
  await assert.rejects(stat(path.join(tempRoot, `${meeting.id}.audio`)), /ENOENT/);
  assert.throws(() => service.retryDebrief(meeting.id, "another-user"), /transcript is needed/);
  service.retryDebrief(meeting.id, "owner-1");
  const ready = await waitForMeeting(store, meeting.id, "owner-1", "ready");
  assert.match(ready.summary, /Friday/);
  assert.equal(transcriptionCalls, 1);
  assert.equal(debriefCalls, 2);
});

test("Film Room expires abandoned partial uploads and removes their audio", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-film-room-expiry-"));
  const tempRoot = path.join(directory, "audio");
  const store = createMeetingStore(path.join(directory, "meetings.sqlite"));
  let service;
  t.after(async () => {
    service?.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  service = createMeetingService({
    config: { runtime: { voiceTranscriptionUrl: "http://127.0.0.1:8178/inference" } },
    store,
    tempRoot,
    uploadTtlMs: 20
  });
  let meeting = store.createMeeting({
    actorId: "owner-1",
    requestedLanguage: "fa",
    mimeType: "audio/webm",
    totalParts: 2
  });
  meeting = await service.acceptChunk({ meeting, actorId: "owner-1", part: 0, bytes: Buffer.from("partial") });
  assert.equal(meeting.status, "uploading");

  const failed = await waitForMeeting(store, meeting.id, "owner-1", "failed");
  assert.equal(failed.errorCode, "MEETING_UPLOAD_EXPIRED");
  await assert.rejects(readFile(path.join(tempRoot, `${meeting.id}.audio`)), /ENOENT/);
});
