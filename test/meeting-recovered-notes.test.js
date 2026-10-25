import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createHqServer } from "../src/hq-server.js";
import { createMeetingStore } from "../src/meeting-store.js";

test("Film Room saves recovered notes from a failed transcript without rerunning the model", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-recovered-notes-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const databasePath = path.join(root, "data", "rooms.sqlite");
  const store = createMeetingStore(databasePath);
  const removedAudio = [];
  const server = createHqServer({ company: { name: "Your company" }, runtime: { root, roomDatabasePath: databasePath } }, {
    meetingStore: store,
    meetingService: { removeAudio: async (id) => removedAudio.push(id) }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { "content-type": "application/json", origin: base };

  try {
    function failedMeeting(actorId, transcript = "") {
      const created = store.createMeeting({ actorId, title: "Sample Studio first meeting", requestedLanguage: "fa", mimeType: "audio/mpeg", totalParts: 1 });
      store.recordUploadPart(created.id, actorId, { part: 0, bytes: 4 });
      store.markProcessing(created.id, actorId);
      if (transcript) store.saveTranscript(created.id, actorId, transcript);
      return store.failMeeting(created.id, actorId, "AI_PROVIDER_ERROR");
    }

    const words = "قرار شد ابتدا نقشه سایت و تجربه کاربری آماده شود.";
    const meeting = failedMeeting("local-owner", words);
    const withoutWords = failedMeeting("local-owner");
    const someoneElse = failedMeeting("other-owner", words);
    const payload = {
      summary: "The team will launch a presentation site before online sales.",
      decisions: ["Sitemap and UX come before interface design."],
      actionItems: [{ text: "Share the brand guide", owner: "Sample Studio team", dueOn: null, confidence: "explicit" }],
      openQuestions: ["Which languages are required at launch?"]
    };

    for (const id of [withoutWords.id, someoneElse.id]) {
      const rejected = await fetch(`${base}/api/meetings/${id}/recovered-notes`, { method: "POST", headers, body: JSON.stringify(payload) });
      assert.equal(rejected.status, 400);
    }
    const malformed = await fetch(`${base}/api/meetings/${meeting.id}/recovered-notes`, {
      method: "POST", headers, body: JSON.stringify({ ...payload, decisions: [{}] })
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(removedAudio, [], "bad notes do not touch the saved meeting");
    const saved = await fetch(`${base}/api/meetings/${meeting.id}/recovered-notes`, { method: "POST", headers, body: JSON.stringify(payload) });
    assert.equal(saved.status, 200);
    const ready = (await saved.json()).meeting;
    assert.equal(ready.status, "ready");
    assert.equal(ready.transcript, words);
    assert.equal(ready.summary, payload.summary);
    assert.deepEqual(ready.decisions, payload.decisions);
    assert.equal(ready.actionItems[0].owner, "Sample Studio team");
    assert.ok(ready.readyNotifiedAt, "manual recovery does not queue a delayed model-ready notification");
    assert.deepEqual(removedAudio, [meeting.id]);

    const repeat = await fetch(`${base}/api/meetings/${meeting.id}/recovered-notes`, { method: "POST", headers, body: JSON.stringify({ summary: "Overwrite" }) });
    assert.equal(repeat.status, 400, "saved notes cannot be replaced through a failed-meeting route");
    assert.equal(store.getMeeting(meeting.id, "local-owner").summary, payload.summary);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
