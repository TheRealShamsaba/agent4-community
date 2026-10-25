import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createMeetingStore } from "../src/meeting-store.js";

test("Film Room keeps private Farsi debriefs and confirms task links exactly once", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-meetings-"));
  const store = createMeetingStore(path.join(directory, "meetings.sqlite"));
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  const created = store.createMeeting({
    actorId: "owner-1",
    title: "جلسه معرفی سایت",
    clientId: "project",
    clientName: "SampleProject",
    projectName: "Website",
    requestedLanguage: "fa",
    mimeType: "audio/webm",
    durationSeconds: 900,
    totalParts: 2
  });
  assert.equal(created.status, "uploading");
  assert.equal(created.clientName, "SampleProject");
  assert.equal(store.getMeeting(created.id, "someone-else"), null);

  const first = store.recordUploadPart(created.id, "owner-1", { part: 0, bytes: 512 });
  assert.equal(first.uploadParts, 1);
  assert.throws(() => store.recordUploadPart(created.id, "owner-1", { part: 0, bytes: 10 }), /in order/);
  const uploaded = store.recordUploadPart(created.id, "owner-1", { part: 1, bytes: 256 });
  assert.equal(uploaded.audioBytes, 768);

  const processing = store.markProcessing(created.id, "owner-1");
  assert.equal(processing.status, "processing");
  const ready = store.completeMeeting(created.id, "owner-1", {
    detectedLanguage: "fa",
    title: "جلسه معرفی سایت",
    transcript: "قرار شد نسخه نهایی را فردا بفرستیم.",
    summary: "تیم درباره نسخه نهایی سایت تصمیم گرفت.",
    decisions: ["نسخه فعلی تأیید شد."],
    actionItems: [{ text: "نسخه نهایی را بفرست", owner: "من", dueOn: "2026-09-01", confidence: "explicit", taskId: null }],
    openQuestions: ["قیمت نهایی چیست؟"],
    risks: [],
    followUpDraft: "سلام، طبق جلسه نسخه نهایی را فردا می‌فرستم."
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.detectedLanguage, "fa");
  assert.match(ready.summary, /تصمیم/);
  assert.match(ready.transcript, /قرار شد/);
  assert.match(ready.clientRecap, /جمع‌بندی جلسه/);
  assert.match(ready.clientRecap, /نسخه نهایی را بفرست/);
  assert.doesNotMatch(ready.clientRecap, /ریسک/);

  const page = store.listMeetings({ actorId: "owner-1" });
  assert.equal(page.meetings.length, 1);
  assert.equal(page.total, 1);
  assert.equal(page.hasMore, false);
  assert.equal(Object.hasOwn(page.meetings[0], "transcript"), false);
  assert.equal(Object.hasOwn(page.meetings[0], "clientRecap"), false);
  const edited = store.updateClientRecap(created.id, "owner-1", "جمع‌بندی تأییدشده برای مشتری");
  assert.equal(edited.clientRecap, "جمع‌بندی تأییدشده برای مشتری");
  assert.throws(() => store.updateClientRecap(created.id, "someone-else", "Nope"), /unavailable/);
  const remembered = store.updateClientMemory(created.id, "owner-1", {
    clientId: "project",
    clientName: "SampleProject",
    projectName: "Website redesign",
    followUpOn: "2026-09-03"
  });
  assert.equal(remembered.followUpOn, "2026-09-03");
  assert.equal(remembered.projectName, "Website redesign");
  const partiallyEdited = store.updateClientMemory(created.id, "owner-1", { projectName: "SampleProject website" });
  assert.equal(partiallyEdited.clientName, "SampleProject");
  assert.equal(partiallyEdited.followUpOn, "2026-09-03");
  assert.throws(() => store.updateClientMemory(created.id, "owner-1", { followUpOn: "2026-02-31" }), /real YYYY-MM-DD/);
  const withFollowUp = store.attachFollowUpTask(created.id, "owner-1", "task-follow-up");
  assert.equal(withFollowUp.followUpTaskId, "task-follow-up");
  const memories = store.listClientMemories({ actorId: "owner-1" });
  assert.equal(memories[0].clientName, "SampleProject");
  assert.equal(memories[0].meetings[0].id, created.id);
  assert.equal(memories[0].nextFollowUpOn, "2026-09-03");
  const linked = store.attachTaskIds(created.id, "owner-1", { 0: "task-1" });
  assert.equal(linked.actionItems[0].taskId, "task-1");
});

test("Film Room client recaps omit inferred work and internal risks", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-client-recap-"));
  const store = createMeetingStore(path.join(directory, "meetings.sqlite"));
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const created = store.createMeeting({ actorId: "owner-1", requestedLanguage: "en", mimeType: "audio/webm", totalParts: 1 });
  store.recordUploadPart(created.id, "owner-1", { part: 0, bytes: 10 });
  store.markProcessing(created.id, "owner-1");
  const ready = store.completeMeeting(created.id, "owner-1", {
    detectedLanguage: "en",
    title: "Website review",
    summary: "We reviewed the launch plan.",
    decisions: ["Launch on Tuesday."],
    actionItems: [
      { text: "Send the approved files", owner: "Sam", confidence: "explicit" },
      { text: "Replace the entire CMS", confidence: "inferred" }
    ],
    openQuestions: ["Who owns analytics?"],
    risks: ["The budget may be too small."]
  });
  assert.match(ready.clientRecap, /Meeting recap/);
  assert.match(ready.clientRecap, /Send the approved files/);
  assert.doesNotMatch(ready.clientRecap, /Replace the entire CMS/);
  assert.doesNotMatch(ready.clientRecap, /budget/);
});

test("Film Room rejects oversized durations and invalid upload order", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-meeting-limits-"));
  const store = createMeetingStore(path.join(directory, "meetings.sqlite"));
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  assert.throws(() => store.createMeeting({
    actorId: "owner-1",
    requestedLanguage: "fa",
    mimeType: "audio/mp4",
    durationSeconds: 3601,
    totalParts: 1
  }), /60 minutes/);
  assert.throws(() => store.createMeeting({
    actorId: "owner-1",
    requestedLanguage: "fa",
    mimeType: "audio/mp4",
    totalParts: 65
  }), /part count/);
  assert.throws(() => store.updateClientMemory("missing", "owner-1", { followUpOn: "not-a-date" }), /unavailable/);
});

test("Film Room meetings past the first page are still reachable", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-meeting-pages-"));
  const store = createMeetingStore(path.join(directory, "meetings.sqlite"));
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  for (let index = 0; index < 7; index += 1) {
    store.createMeeting({
      actorId: "owner-1",
      title: `Meeting ${index}`,
      requestedLanguage: "en",
      mimeType: "audio/webm",
      totalParts: 1
    });
  }
  store.createMeeting({ actorId: "someone-else", title: "Not mine", requestedLanguage: "en", mimeType: "audio/webm", totalParts: 1 });

  const first = store.listMeetings({ actorId: "owner-1", limit: 3 });
  assert.equal(first.meetings.length, 3);
  assert.equal(first.total, 7, "the count is the whole list, not the page");
  assert.equal(first.offset, 0);
  assert.equal(first.hasMore, true);

  const second = store.listMeetings({ actorId: "owner-1", limit: 3, offset: 3 });
  assert.equal(second.meetings.length, 3);
  assert.equal(second.hasMore, true);
  const last = store.listMeetings({ actorId: "owner-1", limit: 3, offset: 6 });
  assert.equal(last.meetings.length, 1);
  assert.equal(last.hasMore, false, "the end of the list says so instead of just stopping");

  const seen = [...first.meetings, ...second.meetings, ...last.meetings].map((meeting) => meeting.id);
  assert.equal(new Set(seen).size, 7, "no meeting is shown twice or skipped between pages");

  const offThePage = last.meetings[0];
  assert.equal(first.meetings.some((meeting) => meeting.id === offThePage.id), false, "this one is past the first page");
  assert.equal(store.getMeeting(offThePage.id, "owner-1").id, offThePage.id, "but a link to it still finds it");
  assert.equal(store.getMeeting(offThePage.id, "someone-else"), null, "and only for its owner");
  assert.equal(store.listMeetings({ actorId: "someone-else" }).total, 1);
});
