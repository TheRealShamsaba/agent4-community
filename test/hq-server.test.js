import { fetch } from "./helpers/http.js";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { URLSearchParams } from "node:url";
import { TextDecoder } from "node:util";
import { createAuthStore } from "../src/auth-store.js";
import { createHqServer } from "../src/hq-server.js";
import { createMeetingStore } from "../src/meeting-store.js";

function cookieFrom(response) {
  return String(response.headers.get("set-cookie") || "").split(";", 1)[0];
}

function signedTelegramInitData({ botToken, userId, now = new Date() }) {
  const values = {
    auth_date: String(Math.floor(now.getTime() / 1000)),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: Number(userId), first_name: "Member" })
  };
  const dataCheckString = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

function shiftIsoDay(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function readServerEvent(response, expectedType, timeoutMs = 2_000) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    while (!timeout.aborted) {
      const read = reader.read();
      const result = await Promise.race([
        read,
        new Promise((_, reject) => timeout.addEventListener("abort", () => reject(new Error(`Timed out waiting for ${expectedType}.`)), { once: true }))
      ]);
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop() || "";
      for (const message of messages) {
        const data = message.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.type === expectedType) return event;
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error(`Event stream closed before ${expectedType}.`);
}

test("HQ server keeps model actions same-origin, bounded, and structured", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-hq-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  let received;
  const config = {
    company: { name: "Your company", positioning: "build useful business software" },
    runtime: { root }
  };
  const server = createHqServer(config, {
    providerStatus: async () => ({ provider: "ollama", ready: true, model: "qwen3.5:4b", message: "ready" }),
    githubProjectReader: {
      list: async () => [{ slug: "example/project", name: "agent4", url: "https://github.com/example/project", description: "Agent4 HQ", private: true, defaultBranch: "main", updatedAt: "2026-09-01T10:00:00Z" }],
      read: async ({ repositoryUrl, branch }) => ({
        connected: true,
        available: true,
        repository: { slug: "example/project", url: repositoryUrl, branch: branch || "main", private: true },
        commits: [{ sha: "abcdef123", shortSha: "abcdef1", title: "Improve company overview", author: "Alex", committedAt: "2026-09-01T09:00:00Z", url: `${repositoryUrl}/commit/abcdef123` }],
        latest: { sha: "abcdef123", shortSha: "abcdef1", title: "Improve company overview", author: "Alex", committedAt: "2026-09-01T09:00:00Z", url: `${repositoryUrl}/commit/abcdef123`, additions: 20, deletions: 4, filesChanged: 1, files: [] }
      })
    },
    generateAction: async (_config, input) => {
      received = input;
      return {
        action: "tasks",
        title: "Next moves · Acme",
        summary: "",
        tasks: [{ title: "Verify the contact path", notes: "Use public evidence." }],
        rationale: "Grounded in the supplied room item.",
        provider: "ollama",
        model: "qwen3.5:4b",
        responseId: "test"
      };
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Agent4 HQ/);
    const miniAppPage = await fetch(`${base}/telegram`);
    assert.equal(miniAppPage.status, 200);
    assert.match(await miniAppPage.text(), /Agent4 HQ/);

    const status = await fetch(`${base}/api/agent4/status`);
    assert.deepEqual(await status.json(), { provider: "ollama", ready: true, model: "qwen3.5:4b", message: "ready" });

    const emptyRoom = await fetch(`${base}/api/rooms/company-room`);
    assert.deepEqual(await emptyRoom.json(), {
      exists: false,
      room: null,
      actor: { id: "local-owner", email: "local@agent4.dev", name: "You", role: "owner" }
    });

    const roomState = {
      localObjects: [{ id: "note-1", type: "note", title: "First note" }],
      layout: {},
      edges: [{ id: "edge-1", from: "note-1", to: "seed", label: "supports" }]
    };
    const firstSave = await fetch(`${base}/api/rooms/company-room`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ baseVersion: 0, label: "Imported browser room", state: roomState })
    });
    assert.equal(firstSave.status, 200);
    const firstRoom = (await firstSave.json()).room;
    assert.equal(firstRoom.version, 1);
    assert.equal(firstRoom.state.localObjects[0].createdByName, "You");
    assert.equal(firstRoom.state.edges[0].updatedBy, "local-owner");

    const conflict = await fetch(`${base}/api/rooms/company-room`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ baseVersion: 0, label: "Stale edit", state: roomState })
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).room.version, 1);

    const companyResponse = await fetch(`${base}/api/workspaces/companies`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ id: "project", name: "SampleProject", website: "https://project.example" })
    });
    assert.equal(companyResponse.status, 200);
    const companyPatch = await fetch(`${base}/api/workspaces/companies/project`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ kind: "client", stage: "operating", contactName: "Owner", contactTelegram: "@project_owner", nextAction: "Ask for a testimonial", nextActionOn: "2026-09-20" })
    });
    assert.equal(companyPatch.status, 200);
    const patchedCompany = (await companyPatch.json()).company;
    assert.equal(patchedCompany.stage, "operating");
    assert.equal(patchedCompany.contactTelegram, "@project_owner");
    assert.equal(patchedCompany.nextActionOn, "2026-09-20");
    const badCompany = await fetch(`${base}/api/workspaces/companies/project`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ stage: "won" })
    });
    assert.equal(badCompany.status, 400);
    const repositoryList = await fetch(`${base}/api/workspaces/github/repositories`);
    assert.equal(repositoryList.status, 200);
    assert.equal((await repositoryList.json()).repositories[0].slug, "example/project");
    const projectResponse = await fetch(`${base}/api/workspaces/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ companyId: "project", companyName: "SampleProject", name: "Website redesign" })
    });
    assert.equal(projectResponse.status, 200);
    const project = (await projectResponse.json()).project;
    const projectUpdate = await fetch(`${base}/api/workspaces/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ goal: "Launch the new client site", health: "at_risk", dueOn: "2026-09-30", milestone: "Approve homepage", repositoryUrl: "https://github.com/example/project", repositoryBranch: "main" })
    });
    assert.equal(projectUpdate.status, 200);
    assert.equal((await projectUpdate.json()).project.health, "at_risk");
    const githubActivity = await fetch(`${base}/api/workspaces/projects/${project.id}/github`);
    assert.equal(githubActivity.status, 200);
    assert.equal((await githubActivity.json()).latest.additions, 20);
    const decisionResponse = await fetch(`${base}/api/workspaces/projects/${project.id}/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ text: "Use the focused homepage direction" })
    });
    assert.equal(decisionResponse.status, 200);
    const resourceResponse = await fetch(`${base}/api/workspaces/projects/${project.id}/resources`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ label: "Project brief", url: "https://docs.example/project", kind: "document" })
    });
    assert.equal(resourceResponse.status, 200);
    const workspaces = await (await fetch(`${base}/api/workspaces`)).json();
    assert.equal(workspaces.companies[0].name, "SampleProject");
    assert.equal(workspaces.projects[0].id, project.id);
    assert.equal(workspaces.projects[0].goal, "Launch the new client site");
    assert.equal(workspaces.decisions[0].text, "Use the focused homepage direction");
    assert.equal(workspaces.resources[0].label, "Project brief");

    const sheetResponse = await fetch(`${base}/api/workspaces/sheets`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ companyId: "project", companyName: "SampleProject", projectId: project.id, templateId: "website-discovery", title: "Discovery meeting" })
    });
    assert.equal(sheetResponse.status, 200);
    const sheet = (await sheetResponse.json()).sheet;
    assert.equal(sheet.projectId, project.id);
    assert.equal(sheet.createdBy, "local-owner");
    const sheetPatch = await fetch(`${base}/api/workspaces/sheets/${sheet.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ answers: { c1: "SampleProject Trading" }, checks: { p1: true } })
    });
    assert.equal(sheetPatch.status, 200);
    const secondPatch = await fetch(`${base}/api/workspaces/sheets/${sheet.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ answers: { f2: "No budget yet" }, status: "complete" })
    });
    assert.deepEqual((await secondPatch.json()).sheet.answers, { c1: "SampleProject Trading", f2: "No budget yet" }, "answers merge across requests");
    const sheetRead = await (await fetch(`${base}/api/workspaces/sheets/${sheet.id}`)).json();
    assert.equal(sheetRead.sheet.status, "complete");
    assert.deepEqual(sheetRead.sheet.checks, { p1: true });
    assert.equal((await (await fetch(`${base}/api/workspaces`)).json()).sheets[0].id, sheet.id);
    const badSheet = await fetch(`${base}/api/workspaces/sheets/${sheet.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ status: "archived" })
    });
    assert.equal(badSheet.status, 400);
    const sheetDelete = await fetch(`${base}/api/workspaces/sheets/${sheet.id}`, { method: "DELETE", headers: { origin: base } });
    assert.equal(sheetDelete.status, 200);
    assert.equal((await (await fetch(`${base}/api/workspaces`)).json()).sheets.length, 0);

    roomState.localObjects[0].title = "Second note";
    const secondSave = await fetch(`${base}/api/rooms/company-room`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ baseVersion: 1, label: "Edited note", state: roomState })
    });
    assert.equal((await secondSave.json()).room.version, 2);

    const history = await fetch(`${base}/api/rooms/company-room/history`);
    assert.deepEqual((await history.json()).history.map((item) => item.version), [2, 1]);

    const recordedReceipt = await fetch(`${base}/api/rooms/company-room/receipts`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({
        id: "proposal-test-1234",
        action: "tasks",
        status: "approved",
        summary: "Created one task from Research",
        sources: ["Research"],
        result: { created: 1 },
        model: "qwen3.5:4b"
      })
    });
    assert.equal(recordedReceipt.status, 200);
    assert.equal((await recordedReceipt.json()).receipt.actorName, "You");
    const receipts = await fetch(`${base}/api/rooms/company-room/receipts`);
    assert.equal((await receipts.json()).receipts[0].result.created, 1);

    const restore = await fetch(`${base}/api/rooms/company-room/restore`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ version: 1, baseVersion: 2 })
    });
    const restoredRoom = (await restore.json()).room;
    assert.equal(restoredRoom.version, 3);
    assert.equal(restoredRoom.state.localObjects[0].title, "First note");

    const action = await fetch(`${base}/api/agent4/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({
        command: "Create one task",
        document: { title: "Research", body: "Known evidence" },
        references: [{ type: "lead", title: "Acme", body: "No contact form was observed." }]
      })
    });
    assert.equal(action.status, 200);
    assert.equal((await action.json()).result.provider, "ollama");
    assert.equal(received.references[0].title, "Acme");

    const crossOrigin = await fetch(`${base}/api/agent4/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body: "{}"
    });
    assert.equal(crossOrigin.status, 403);

    const invalid = await fetch(`${base}/api/agent4/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ command: "", document: {}, references: [] })
    });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("HQ server persists the personal content plan and momentum score", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-rhythm-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const server = createHqServer({ company: { name: "Your company" }, runtime: { root } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const today = new Date().toISOString().slice(0, 10);
  const json = { "content-type": "application/json", origin: base };

  try {
    const created = await fetch(`${base}/api/content`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "Build in public", platform: "linkedin", format: "post", plannedOn: today })
    });
    assert.equal(created.status, 200);
    const post = (await created.json()).post;

    const published = await fetch(`${base}/api/content/${post.id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ status: "published", publishedOn: today })
    });
    assert.equal((await published.json()).post.publishedOn, today);

    const goal = await fetch(`${base}/api/content/goals`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ platform: "linkedin", weeklyTarget: 5 })
    });
    assert.equal((await goal.json()).goals.linkedin, 5);

    const taskResponse = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "Ship the landing page", assigneeId: "local-owner" })
    });
    const task = (await taskResponse.json()).task;
    await fetch(`${base}/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ status: "done" })
    });
    await fetch(`${base}/api/momentum/check-in`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ today })
    });

    const summary = await (await fetch(`${base}/api/content/summary?today=${today}`)).json();
    assert.equal(summary.summary.platforms.linkedin.published, 1);
    assert.equal(summary.summary.platforms.linkedin.target, 5);

    const momentum = await (await fetch(`${base}/api/momentum?today=${today}`)).json();
    assert.equal(momentum.momentum.weeklyPoints, 9, "check-in + completed task + published post");
    assert.equal(momentum.momentum.checkedIn, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("HQ server keeps a personal calendar for the Home Court planner", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-calendar-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const server = createHqServer({ company: { name: "Your company" }, runtime: { root } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json", origin: base };

  try {
    const created = await fetch(`${base}/api/calendar`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "Review the week", startsOn: "2026-09-01", startsAt: "16:00", durationMinutes: 30 })
    });
    assert.equal(created.status, 200);
    const event = (await created.json()).event;
    assert.equal(event.startsAt, "16:00");

    const listed = await (await fetch(`${base}/api/calendar?from=2026-08-30&to=2026-09-05`)).json();
    assert.deepEqual(listed.events.map((item) => item.title), ["Review the week"]);

    const removed = await fetch(`${base}/api/calendar/${event.id}`, { method: "DELETE", headers: { origin: base } });
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).removed, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("HQ Film Room accepts chunked Farsi audio and creates only approved meeting tasks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-film-room-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const databasePath = path.join(root, "data", "rooms.sqlite");
  const meetingStore = createMeetingStore(databasePath);
  const meetingService = {
    acceptChunk: async ({ meeting, actorId, part, bytes }) => {
      const uploaded = meetingStore.recordUploadPart(meeting.id, actorId, { part, bytes: bytes.byteLength });
      meetingStore.markProcessing(uploaded.id, actorId);
      return meetingStore.completeMeeting(uploaded.id, actorId, {
        detectedLanguage: "fa",
        title: "جلسه معرفی سایت",
        transcript: "قرار شد نسخه کامل را فردا بفرستم.",
        summary: "نسخه سایت بررسی شد و مرحله بعد مشخص شد.",
        decisions: ["نسخه فعلی تأیید شد."],
        actionItems: [{ text: "نسخه کامل را بفرست", owner: "من", dueOn: "2026-09-01", confidence: "explicit", taskId: null }],
        openQuestions: [],
        risks: [],
        followUpDraft: "سلام، طبق جلسه نسخه کامل را فردا می‌فرستم."
      });
    },
    removeAudio: async () => {}
  };
  const config = { company: { name: "Your company" }, runtime: { root, roomDatabasePath: databasePath } };
  let transcriptionReady = false;
  let transcriptionChecks = 0;
  const checkMeetingTranscription = async () => {
    transcriptionChecks += 1;
    if (!transcriptionReady) {
      const error = new Error("private provider details");
      error.code = "TRANSCRIPTION_UNAVAILABLE";
      throw error;
    }
  };
  const server = createHqServer(config, { meetingStore, meetingService, checkMeetingTranscription });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json", origin: base };

  try {
    const noConsent = await fetch(`${base}/api/meetings`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "جلسه", requestedLanguage: "fa", mimeType: "audio/webm", totalParts: 1 })
    });
    assert.equal(noConsent.status, 400);
    assert.equal(transcriptionChecks, 0, "consent rejects before contacting Whisper");

    const unavailable = await fetch(`${base}/api/meetings`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "جلسه معرفی سایت", clientId: "project", clientName: "SampleProject", projectName: "Website", requestedLanguage: "fa", mimeType: "audio/webm", durationSeconds: 300, totalParts: 1, consentConfirmed: true })
    });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), {
      error: { code: "TRANSCRIPTION_UNAVAILABLE", message: "The private transcription service is unavailable." }
    });
    assert.equal((await (await fetch(`${base}/api/meetings`)).json()).meetings.length, 0, "offline preflight creates no meeting row");

    transcriptionReady = true;

    const createdResponse = await fetch(`${base}/api/meetings`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "جلسه معرفی سایت", clientId: "project", clientName: "SampleProject", projectName: "Website", requestedLanguage: "fa", mimeType: "audio/webm", durationSeconds: 300, totalParts: 1, consentConfirmed: true })
    });
    assert.equal(createdResponse.status, 200);
    assert.equal(transcriptionChecks, 2);
    const created = (await createdResponse.json()).meeting;
    assert.equal(created.status, "uploading");
    assert.equal(created.clientName, "SampleProject");

    const upload = await fetch(`${base}/api/meetings/${created.id}/audio?part=0`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", origin: base },
      body: new Uint8Array([1, 2, 3, 4])
    });
    assert.equal(upload.status, 200);
    assert.equal((await upload.json()).meeting.status, "ready");

    const meeting = (await (await fetch(`${base}/api/meetings/${created.id}`)).json()).meeting;
    assert.equal(meeting.detectedLanguage, "fa");
    assert.match(meeting.transcript, /قرار شد/);
    assert.match(meeting.clientRecap, /جمع‌بندی جلسه/);

    const recapUpdate = await fetch(`${base}/api/meetings/${created.id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ clientRecap: "نسخه نهایی جمع‌بندی برای مشتری" })
    });
    assert.equal(recapUpdate.status, 200);
    assert.equal((await recapUpdate.json()).meeting.clientRecap, "نسخه نهایی جمع‌بندی برای مشتری");

    const memoryUpdate = await fetch(`${base}/api/meetings/${created.id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ clientId: "project", clientName: "SampleProject", projectName: "Website redesign", followUpOn: "2026-09-03" })
    });
    assert.equal(memoryUpdate.status, 200);
    assert.equal((await memoryUpdate.json()).meeting.followUpOn, "2026-09-03");

    const followUp = await fetch(`${base}/api/meetings/${created.id}/follow-up`, { method: "POST", headers: json });
    const followUpBody = await followUp.json();
    assert.equal(followUp.status, 200);
    assert.equal(followUpBody.created, true);
    assert.equal(followUpBody.task.assigneeId, "local-owner");
    assert.equal(followUpBody.task.dueOn, "2026-09-03");
    assert.equal(followUpBody.task.project, "Website redesign");
    assert.equal(followUpBody.meeting.followUpTaskId, followUpBody.task.id);

    const memories = await (await fetch(`${base}/api/client-memory`)).json();
    assert.equal(memories.memories[0].clientName, "SampleProject");
    assert.equal(memories.memories[0].nextFollowUpOn, "2026-09-03");

    const approved = await fetch(`${base}/api/meetings/${created.id}/tasks`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ actionIndexes: [0] })
    });
    const approvedBody = await approved.json();
    assert.equal(approved.status, 200);
    assert.equal(approvedBody.created, 1);
    assert.equal(approvedBody.tasks[0].assigneeId, "local-owner");
    assert.equal(approvedBody.tasks[0].dueOn, "2026-09-01");

    const duplicate = await fetch(`${base}/api/meetings/${created.id}/tasks`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ actionIndexes: [0] })
    });
    assert.equal((await duplicate.json()).created, 0);
    const list = await (await fetch(`${base}/api/meetings`)).json();
    assert.equal(list.meetings[0].actionItems[0].taskId, approvedBody.tasks[0].id);
    assert.equal(Object.hasOwn(list.meetings[0], "transcript"), false);
    assert.equal(Object.hasOwn(list.meetings[0], "clientRecap"), false);
    assert.equal(list.total, 1);
    assert.equal(list.hasMore, false);

    // A link to a meeting that has fallen off the first page must still open it.
    const older = [0, 1, 2].map((index) => meetingStore.createMeeting({
      actorId: "local-owner",
      title: `Older meeting ${index}`,
      requestedLanguage: "en",
      mimeType: "audio/webm",
      totalParts: 1
    }));
    const firstPage = await (await fetch(`${base}/api/meetings?limit=2`)).json();
    assert.equal(firstPage.meetings.length, 2);
    assert.equal(firstPage.total, 4, "the list says how many meetings there really are");
    assert.equal(firstPage.hasMore, true);
    const secondPage = await (await fetch(`${base}/api/meetings?limit=2&offset=2`)).json();
    assert.equal(secondPage.meetings.length, 2);
    assert.equal(secondPage.hasMore, false);
    assert.equal(
      new Set([...firstPage.meetings, ...secondPage.meetings].map((meeting) => meeting.id)).size,
      4,
      "paging shows each meeting once"
    );
    const deepLink = await fetch(`${base}/api/meetings/${older[0].id}`);
    assert.equal(deepLink.status, 200);
    assert.equal((await deepLink.json()).meeting.id, older[0].id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("HQ server saves reminder preferences and builds a weekly reset from real work", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-weekly-reset-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const server = createHqServer({ company: { name: "Your company" }, runtime: { root } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json", origin: base };
  const currentDay = new Date().toISOString().slice(0, 10);
  const currentWeekday = new Date(`${currentDay}T12:00:00Z`).getUTCDay();
  const today = shiftIsoDay(currentDay, (7 - currentWeekday) % 7);
  const weekStart = shiftIsoDay(today, -6);

  try {
    const defaults = await (await fetch(`${base}/api/rhythm/settings`)).json();
    assert.deepEqual(defaults.settings, {
      enabled: true,
      remindAt: "18:30",
      morningEnabled: true,
      morningAt: "08:30",
      overdueEnabled: true,
      overdueAt: "10:30",
      weeklyEnabled: true,
      weeklyAt: "18:00",
      updatedAt: null
    });
    const changed = await fetch(`${base}/api/rhythm/settings`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ enabled: true, remindAt: "19:45", morningAt: "09:00", overdueEnabled: false })
    });
    assert.equal(changed.status, 200);
    const savedSettings = (await changed.json()).settings;
    assert.equal(savedSettings.remindAt, "19:45");
    assert.equal(savedSettings.morningAt, "09:00");
    assert.equal(savedSettings.overdueEnabled, false);

    const post = await fetch(`${base}/api/content`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "Weekly lesson", platform: "linkedin", status: "published", publishedOn: today })
    });
    assert.equal(post.status, 200);
    const task = await (await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "Close the loop", assigneeId: "local-owner" })
    })).json();
    await fetch(`${base}/api/tasks/${task.task.id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ status: "done" })
    });
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "Call the Acme lead", assigneeId: "local-owner", dueOn: "2026-09-01" })
    });

    const reset = await (await fetch(`${base}/api/weekly-review?today=${today}`)).json();
    assert.deepEqual(reset.week, { start: weekStart, end: today });
    assert.equal(reset.isSunday, true);
    assert.equal(reset.summary.linkedinPosts, 1);
    assert.equal(reset.summary.tasksDone, 1);

    const saved = await fetch(`${base}/api/weekly-review`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({
        weekStart: reset.week.start,
        wins: "Kept publishing",
        lessons: "Write earlier",
        nextFocus: "Three useful conversations"
      })
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.review.nextFocus, "Three useful conversations");
    assert.equal(savedBody.gamePlan.target, "Three useful conversations");
    assert.equal(savedBody.gamePlan.primaryMove.title, "Call the Acme lead");
    assert.equal(savedBody.gamePlan.targetWeekStart, shiftIsoDay(weekStart, 7));
    const reread = await (await fetch(`${base}/api/weekly-review?today=${today}`)).json();
    assert.equal(reread.review.wins, "Kept publishing");
    assert.equal(reread.reviewWeekStart, weekStart);
    assert.equal(reread.gamePlan.target, "Three useful conversations");
    assert.equal(reread.gamePlanPeriod, "next");
    assert.equal(reread.goalTracker.canCheckIn, false);
    assert.equal(reread.goalTracker.days.length, 7);

    const monday = shiftIsoDay(today, 1);
    const targetCheckin = await fetch(`${base}/api/goal-checkin`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ day: monday, movedTarget: true })
    });
    assert.equal(targetCheckin.status, 200);
    const targetCheckinBody = await targetCheckin.json();
    assert.equal(targetCheckinBody.checkin.target, "Three useful conversations");
    assert.equal(targetCheckinBody.checkin.movedTarget, true);
    assert.equal(targetCheckinBody.goalTracker.movedDays, 1);
    assert.equal(targetCheckinBody.goalTracker.days[0].status, "moved");

    const mondayRead = await (await fetch(`${base}/api/weekly-review?today=${monday}`)).json();
    assert.equal(mondayRead.gamePlanPeriod, "current");
    assert.equal(mondayRead.goalTracker.canCheckIn, true);
    assert.equal(mondayRead.goalTracker.todayCheckin.movedTarget, true);
    assert.equal(mondayRead.goalTracker.elapsedDays, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("HQ server protects the room with invite-only auth and broadcasts live updates", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-private-hq-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), '<h1>Private Agent4 HQ</h1><script type="application/json" id="hq-data">{"secret":"classified-company-snapshot"}</script>');
  await writeFile(path.join(root, "data", "state.json"), '{"secret":"private-ledger"}');
  const config = {
    company: { name: "Your company", positioning: "build useful business software" },
    runtime: {
      root,
      roomDatabasePath: path.join(root, "data", "rooms.sqlite"),
      agent4AuthRequired: true,
      agent4SecureCookies: false,
      agent4BootstrapEmail: "owner@example.com",
      agent4BootstrapName: "Alex",
      agent4BootstrapPassword: "a-long-owner-password",
      agent4SessionHours: 24
    }
  };
  const server = createHqServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const anonymousPage = await fetch(`${base}/data/hq.html`);
    const anonymousHtml = await anonymousPage.text();
    assert.equal(anonymousPage.status, 200);
    assert.doesNotMatch(anonymousHtml, /classified-company-snapshot/);
    assert.match(anonymousHtml, /id="hq-data">{}<\/script>/);

    const privateFile = await fetch(`${base}/data/state.json`);
    assert.equal(privateFile.status, 404);
    assert.doesNotMatch(await privateFile.text(), /private-ledger/);

    const anonymousRoom = await fetch(`${base}/api/rooms/company-room`);
    assert.equal(anonymousRoom.status, 401);
    assert.equal((await anonymousRoom.json()).error.code, "authentication_required");

    const signedOut = await fetch(`${base}/api/auth/session`);
    assert.deepEqual(await signedOut.json(), { authenticated: false, authRequired: true, actor: null, setupRequired: false, csrfToken: "" });

    const invalidLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ email: "owner@example.com", password: "wrong-password" })
    });
    assert.equal(invalidLogin.status, 401);

    const ownerLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ email: "owner@example.com", password: "a-long-owner-password" })
    });
    assert.equal(ownerLogin.status, 200);
    const ownerCookie = cookieFrom(ownerLogin);
    assert.match(ownerCookie, /^agent4_session=/);
    assert.equal((await ownerLogin.json()).actor.role, "owner");

    const ownerPage = await fetch(`${base}/data/hq.html`, { headers: { cookie: ownerCookie } });
    assert.match(await ownerPage.text(), /classified-company-snapshot/);

    const inviteResponse = await fetch(`${base}/api/auth/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie, origin: base },
      body: JSON.stringify({ email: "teammate@example.com", name: "Teammate" })
    });
    assert.equal(inviteResponse.status, 200);
    const invite = (await inviteResponse.json()).invite;
    assert.match(invite.url, /\/#invite=/);

    const publicInvite = await fetch(`${base}/api/auth/invites/${invite.token}`);
    assert.equal((await publicInvite.json()).invite.email, "teammate@example.com");

    const memberRegistration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ token: invite.token, password: "a-long-member-password" })
    });
    assert.equal(memberRegistration.status, 200);
    const memberCookie = cookieFrom(memberRegistration);
    assert.equal((await memberRegistration.json()).actor.role, "member");

    const memberPage = await fetch(`${base}/data/hq.html`, { headers: { cookie: memberCookie } });
    const memberHtml = await memberPage.text();
    assert.doesNotMatch(memberHtml, /classified-company-snapshot/, "a member never receives the owner's generated snapshot");
    assert.match(memberHtml, /id="hq-data">{}<\/script>/);

    const membersResponse = await fetch(`${base}/api/auth/members`, { headers: { cookie: memberCookie } });
    const memberListBody = await membersResponse.json();
    assert.deepEqual(memberListBody.members.map((member) => member.name), ["Alex", "Teammate"]);
    assert.ok(memberListBody.members.every((member) => !Object.hasOwn(member, "email")), "members do not receive teammates' sign-in emails");

    const memberInvite = await fetch(`${base}/api/auth/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: memberCookie, origin: base },
      body: JSON.stringify({ email: "another@example.com", name: "Another" })
    });
    assert.equal(memberInvite.status, 403);

    const ownerPresence = await fetch(`${base}/api/rooms/company-room/presence`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie, origin: base },
      body: JSON.stringify({
        clientId: "owner-client-123",
        cursor: { x: 412.25, y: 233.75 },
        selectedIds: ["note-1"],
        editingId: "note-1",
        mode: "pen"
      })
    });
    assert.equal(ownerPresence.status, 200);

    const presenceController = new AbortController();
    const presenceStream = await fetch(`${base}/api/rooms/company-room/events?clientId=member-presence-123`, {
      headers: { cookie: memberCookie },
      signal: presenceController.signal
    });
    const livePresence = await readServerEvent(presenceStream, "presence");
    presenceController.abort();
    const ownerSession = livePresence.sessions.find((session) => session.clientId === "owner-client-123");
    assert.equal(ownerSession.actor.name, "Alex");
    assert.equal(Object.hasOwn(ownerSession.actor, "email"), false, "presence does not broadcast sign-in emails");
    assert.deepEqual(ownerSession.cursor, { x: 412.3, y: 233.8 });
    assert.deepEqual(ownerSession.selectedIds, ["note-1"]);
    assert.equal(ownerSession.editingId, "note-1");

    const streamController = new AbortController();
    const stream = await fetch(`${base}/api/rooms/company-room/events?clientId=member-client-123`, {
      headers: { cookie: memberCookie },
      signal: streamController.signal
    });
    assert.equal(stream.status, 200);
    const updateEvent = readServerEvent(stream, "room.updated");
    const savedRoom = await fetch(`${base}/api/rooms/company-room`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: ownerCookie, origin: base },
      body: JSON.stringify({
        baseVersion: 0,
        clientId: "owner-client-123",
        label: "Owner added the first thought",
        state: {
          localObjects: [{ id: "note-1", type: "note", title: "First thought" }],
          layout: {},
          edges: [],
          zones: [{ id: "zone-now", title: "Now", x: 20, y: 80, w: 460, h: 320, tone: "yellow" }],
          strokes: [{
            id: "stroke-owner-123",
            scope: "board",
            color: "#f4f1e8",
            width: 4,
            opacity: 1,
            points: [[20, 30, 0.2], [25.25, 34.75, 0.8]]
          }]
        }
      })
    });
    assert.equal(savedRoom.status, 200);
    const liveUpdate = await updateEvent;
    streamController.abort();
    assert.equal(liveUpdate.actor.name, "Alex");
    assert.equal(liveUpdate.clientId, "owner-client-123");
    assert.equal(liveUpdate.room.version, 1);
    assert.equal(liveUpdate.room.state.zones[0].title, "Now");
    assert.deepEqual(liveUpdate.room.state.strokes[0].points[1], [25.3, 34.8, 0.8]);

    const memberRoom = await fetch(`${base}/api/rooms/company-room`, { headers: { cookie: memberCookie } });
    assert.equal(memberRoom.status, 200);
    assert.equal((await memberRoom.json()).room.state.localObjects[0].createdByName, "Alex");

    const memberCannotRestore = await fetch(`${base}/api/rooms/company-room/restore`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: memberCookie, origin: base },
      body: JSON.stringify({ version: 1, baseVersion: 1 })
    });
    assert.equal(memberCannotRestore.status, 403);

    const ownerTaskResponse = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie, origin: base },
      body: JSON.stringify({ title: "Owner-controlled shared task" })
    });
    const ownerTask = (await ownerTaskResponse.json()).task;
    const memberTasks = await (await fetch(`${base}/api/tasks`, { headers: { cookie: memberCookie } })).json();
    assert.ok(memberTasks.members.every((member) => !Object.hasOwn(member, "email")));
    const memberCannotDeleteTask = await fetch(`${base}/api/tasks/${ownerTask.id}`, {
      method: "DELETE",
      headers: { cookie: memberCookie, origin: base }
    });
    assert.equal(memberCannotDeleteTask.status, 403);
    for (const path of [
      "/api/workspaces/companies/company-test?confirm=true",
      "/api/workspaces/projects/12345678?confirm=true",
      "/api/workspaces/decisions/12345678",
      "/api/workspaces/resources/12345678",
      "/api/workspaces/events/12345678",
      "/api/workspaces/sheets/12345678"
    ]) {
      const rejectedDelete = await fetch(`${base}${path}`, {
        method: "DELETE",
        headers: { cookie: memberCookie, origin: base }
      });
      assert.equal(rejectedDelete.status, 403, `${path} stays under owner control`);
      assert.equal((await rejectedDelete.json()).error.code, "owner_required");
    }

    const memberCannotRemove = await fetch(`${base}/api/auth/members/${encodeURIComponent(memberListBody.members[0].id)}`, {
      method: "DELETE",
      headers: { cookie: memberCookie, origin: base }
    });
    assert.equal(memberCannotRemove.status, 403);

    const currentMembers = (await (await fetch(`${base}/api/auth/members`, { headers: { cookie: ownerCookie } })).json()).members;
    const memberId = currentMembers.find((member) => member.role === "member").id;
    const memberCannotLinkTelegram = await fetch(`${base}/api/auth/members/${encodeURIComponent(memberId)}/telegram`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: memberCookie, origin: base },
      body: JSON.stringify({ telegramUserId: "100000001" })
    });
    assert.equal(memberCannotLinkTelegram.status, 403);
    const ownerLinksTelegram = await fetch(`${base}/api/auth/members/${encodeURIComponent(memberId)}/telegram`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: ownerCookie, origin: base },
      body: JSON.stringify({ telegramUserId: "100000001" })
    });
    assert.equal(ownerLinksTelegram.status, 200);
    assert.equal((await ownerLinksTelegram.json()).member.id, memberId);
    const removeMember = await fetch(`${base}/api/auth/members/${encodeURIComponent(memberId)}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie, origin: base }
    });
    assert.equal(removeMember.status, 200);
    assert.deepEqual((await removeMember.json()).members.map((member) => member.name), ["Alex"]);
    const revokedMember = await fetch(`${base}/api/rooms/company-room`, { headers: { cookie: memberCookie } });
    assert.equal(revokedMember.status, 401);

    const wrongPasswordChange = await fetch(`${base}/api/auth/password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie, origin: base },
      body: JSON.stringify({ currentPassword: "wrong-password", nextPassword: "a-brand-new-owner-password" })
    });
    assert.equal(wrongPasswordChange.status, 401);

    const passwordChange = await fetch(`${base}/api/auth/password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie, origin: base },
      body: JSON.stringify({ currentPassword: "a-long-owner-password", nextPassword: "a-brand-new-owner-password" })
    });
    assert.equal(passwordChange.status, 200);
    const refreshedOwnerCookie = cookieFrom(passwordChange);
    assert.match(refreshedOwnerCookie, /^agent4_session=/);
    assert.equal((await fetch(`${base}/api/rooms/company-room`, { headers: { cookie: ownerCookie } })).status, 401, "older owner sessions are revoked");

    const logout = await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: refreshedOwnerCookie, origin: base }
    });
    assert.equal(logout.status, 200);
    const rejectedSession = await fetch(`${base}/api/rooms/company-room`, { headers: { cookie: refreshedOwnerCookie } });
    assert.equal(rejectedSession.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("two signed-in people cannot read or change each other's personal work", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-member-isolation-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), '<script type="application/json" id="hq-data">{"agenda":[{"title":"Owner private call"}]}</script>');
  const databasePath = path.join(root, "data", "rooms.sqlite");
  const meetingStore = createMeetingStore(databasePath);
  const config = {
    company: { name: "Your company" },
    runtime: {
      root,
      roomDatabasePath: databasePath,
      agent4AuthRequired: true,
      agent4SecureCookies: false,
      agent4BootstrapEmail: "owner@example.com",
      agent4BootstrapName: "Owner",
      agent4BootstrapPassword: "a-long-owner-password"
    }
  };
  const server = createHqServer(config, {
    meetingStore,
    meetingService: { removeAudio: async () => {}, recoverPending: async () => {} }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const requestHeaders = (cookie) => ({ "content-type": "application/json", cookie, origin: base });

  try {
    const ownerLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ email: "owner@example.com", password: "a-long-owner-password" })
    });
    const owner = (await ownerLogin.clone().json()).actor;
    const ownerCookie = cookieFrom(ownerLogin);
    const inviteResponse = await fetch(`${base}/api/auth/invites`, {
      method: "POST",
      headers: requestHeaders(ownerCookie),
      body: JSON.stringify({ email: "friend@example.com", name: "Friend" })
    });
    const invite = (await inviteResponse.json()).invite;
    const registration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ token: invite.token, password: "a-long-friend-password" })
    });
    const friend = (await registration.clone().json()).actor;
    const friendCookie = cookieFrom(registration);

    const ownerPostResponse = await fetch(`${base}/api/content`, {
      method: "POST",
      headers: requestHeaders(ownerCookie),
      body: JSON.stringify({ title: "Owner private draft", platform: "linkedin", format: "post", plannedOn: "2026-09-18" })
    });
    const ownerPost = (await ownerPostResponse.json()).post;
    await fetch(`${base}/api/content`, {
      method: "POST",
      headers: requestHeaders(friendCookie),
      body: JSON.stringify({ title: "Friend private draft", platform: "instagram", format: "post", plannedOn: "2026-09-19" })
    });
    const ownerPosts = (await (await fetch(`${base}/api/content`, { headers: { cookie: ownerCookie } })).json()).posts;
    const friendPosts = (await (await fetch(`${base}/api/content`, { headers: { cookie: friendCookie } })).json()).posts;
    assert.deepEqual(ownerPosts.map((post) => post.title), ["Owner private draft"]);
    assert.deepEqual(friendPosts.map((post) => post.title), ["Friend private draft"]);
    const crossPostUpdate = await fetch(`${base}/api/content/${ownerPost.id}`, {
      method: "PATCH",
      headers: requestHeaders(friendCookie),
      body: JSON.stringify({ title: "Changed by friend" })
    });
    assert.equal(crossPostUpdate.status, 400);

    const ownerEventResponse = await fetch(`${base}/api/calendar`, {
      method: "POST",
      headers: requestHeaders(ownerCookie),
      body: JSON.stringify({ title: "Owner private calendar", startsOn: "2026-09-20", startsAt: "10:00", durationMinutes: 30 })
    });
    const ownerEvent = (await ownerEventResponse.json()).event;
    await fetch(`${base}/api/calendar`, {
      method: "POST",
      headers: requestHeaders(friendCookie),
      body: JSON.stringify({ title: "Friend private calendar", startsOn: "2026-09-21", startsAt: "11:00", durationMinutes: 30 })
    });
    const ownerCalendar = (await (await fetch(`${base}/api/calendar`, { headers: { cookie: ownerCookie } })).json()).events;
    const friendCalendar = (await (await fetch(`${base}/api/calendar`, { headers: { cookie: friendCookie } })).json()).events;
    assert.deepEqual(ownerCalendar.map((event) => event.title), ["Owner private calendar"]);
    assert.deepEqual(friendCalendar.map((event) => event.title), ["Friend private calendar"]);
    const crossEventDelete = await fetch(`${base}/api/calendar/${ownerEvent.id}`, {
      method: "DELETE",
      headers: { cookie: friendCookie, origin: base }
    });
    assert.equal(crossEventDelete.status, 403);

    const ownerMeeting = meetingStore.createMeeting({ actorId: owner.id, title: "Owner private meeting", requestedLanguage: "auto", mimeType: "audio/webm", totalParts: 1 });
    meetingStore.createMeeting({ actorId: friend.id, title: "Friend private meeting", requestedLanguage: "auto", mimeType: "audio/webm", totalParts: 1 });
    const ownerMeetings = (await (await fetch(`${base}/api/meetings`, { headers: { cookie: ownerCookie } })).json()).meetings;
    const friendMeetings = (await (await fetch(`${base}/api/meetings`, { headers: { cookie: friendCookie } })).json()).meetings;
    assert.deepEqual(ownerMeetings.map((meeting) => meeting.title), ["Owner private meeting"]);
    assert.deepEqual(friendMeetings.map((meeting) => meeting.title), ["Friend private meeting"]);
    assert.equal((await fetch(`${base}/api/meetings/${ownerMeeting.id}`, { headers: { cookie: friendCookie } })).status, 404);
    assert.equal((await fetch(`${base}/api/meetings/${ownerMeeting.id}`, { method: "DELETE", headers: { cookie: friendCookie, origin: base } })).status, 404);

    const memberHtml = await (await fetch(`${base}/data/hq.html`, { headers: { cookie: friendCookie } })).text();
    assert.doesNotMatch(memberHtml, /Owner private call/);
    assert.match(memberHtml, /id="hq-data">{}<\/script>/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("Telegram Mini App creates the linked member's own HQ session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-telegram-hq-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), '<script type="application/json" id="hq-data">{}</script>');
  const databasePath = path.join(root, "data", "rooms.sqlite");
  const authStore = createAuthStore(databasePath);
  const owner = authStore.ensureBootstrap({ email: "owner@example.com", name: "Owner", password: "a-long-owner-password" });
  const member = authStore.createUser({ email: "member@example.com", name: "Member", password: "a-long-member-password" });
  authStore.linkTelegramUser(member.id, "100000001");
  authStore.close();

  const botToken = "123456:unit-test-token";
  const config = {
    company: { name: "Your company" },
    runtime: {
      root,
      roomDatabasePath: databasePath,
      agent4AuthRequired: true,
      agent4SecureCookies: false,
      agent4SessionHours: 24,
      telegramBotToken: botToken,
      telegramOwnerUserId: "4200"
    }
  };
  const server = createHqServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const memberLogin = await fetch(`${base}/api/auth/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ initData: signedTelegramInitData({ botToken, userId: "100000001" }) })
    });
    assert.equal(memberLogin.status, 200);
    assert.deepEqual((await memberLogin.json()).actor, member);
    assert.match(cookieFrom(memberLogin), /^agent4_session=/);

    const ownerLogin = await fetch(`${base}/api/auth/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ initData: signedTelegramInitData({ botToken, userId: "4200" }) })
    });
    assert.equal(ownerLogin.status, 200);
    assert.equal((await ownerLogin.json()).actor.id, owner.id);

    const unlinked = await fetch(`${base}/api/auth/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ initData: signedTelegramInitData({ botToken, userId: "99999" }) })
    });
    assert.equal(unlinked.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("money is owner-only at every route and never reaches a member", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-money-hq-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), '<h1>HQ</h1><script type="application/json" id="hq-data">{"counts":{}}</script>');
  const config = {
    company: { name: "Your company", positioning: "build useful business software" },
    runtime: {
      root,
      roomDatabasePath: path.join(root, "data", "rooms.sqlite"),
      agent4AuthRequired: true,
      agent4SecureCookies: false,
      agent4BootstrapEmail: "owner@example.com",
      agent4BootstrapName: "Alex",
      agent4BootstrapPassword: "a-long-owner-password",
      agent4SessionHours: 24
    }
  };
  const server = createHqServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json" };

  try {
    const ownerLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { ...json, origin: base },
      body: JSON.stringify({ email: "owner@example.com", password: "a-long-owner-password" })
    });
    const ownerCookie = cookieFrom(ownerLogin);

    const invite = (await (await fetch(`${base}/api/auth/invites`, {
      method: "POST",
      headers: { ...json, cookie: ownerCookie, origin: base },
      body: JSON.stringify({ email: "teammate@example.com", name: "Teammate" })
    })).json()).invite;
    const memberRegistration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { ...json, origin: base },
      body: JSON.stringify({ token: invite.token, password: "a-long-member-password" })
    });
    const memberCookie = cookieFrom(memberRegistration);

    const created = await fetch(`${base}/api/money/entries`, {
      method: "POST",
      headers: { ...json, cookie: ownerCookie, origin: base },
      body: JSON.stringify({
        direction: "in", amount: 240, currency: "IRR", category: "client",
        occurredOn: "2026-08-04", counterparty: "Parsian"
      })
    });
    assert.equal(created.status, 200);
    const entry = (await created.json()).entry;
    assert.equal(entry.amount, 240);

    const summary = await fetch(`${base}/api/money/summary?month=2026-08`, { headers: { cookie: ownerCookie } });
    assert.equal(summary.status, 200);
    assert.equal((await summary.json()).summary.currencies[0].in, 240);

    const rejected = await fetch(`${base}/api/money/entries`, {
      method: "POST",
      headers: { ...json, cookie: ownerCookie, origin: base },
      body: JSON.stringify({ direction: "out", amount: 5, currency: "IRR", category: "client", occurredOn: "2026-08-04" })
    });
    assert.equal(rejected.status, 400, "an income category cannot be used for spending");

    // The member boundary: every money route refuses, including reads.
    for (const [method, route] of [
      ["GET", "/api/money/summary"],
      ["GET", "/api/money/entries"],
      ["GET", "/api/money/recurring"],
      ["POST", "/api/money/entries"],
      ["POST", "/api/money/recurring"],
      ["PATCH", `/api/money/entries/${entry.id}`],
      ["DELETE", `/api/money/entries/${entry.id}`],
      ["GET", "/api/money/cash"],
      ["GET", "/api/money/report"],
      ["GET", "/api/money/series"],
      ["GET", "/api/money/settings"],
      ["PUT", "/api/money/settings/inflation"],
      ["PUT", "/api/money/settings/opening"],
      ["GET", "/api/money/export.csv"],
      ["GET", "/api/monitor/sites"],
      ["POST", "/api/monitor/sites"],
      ["GET", "/api/files"],
      ["POST", "/api/files"]
    ]) {
      const blocked = await fetch(`${base}${route}`, {
        method,
        headers: { ...json, cookie: memberCookie, origin: base },
        body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify({})
      });
      assert.equal(blocked.status, 403, `${method} ${route} must refuse a member`);
      const refusal = await blocked.text();
      assert.equal(JSON.parse(refusal).error.code, "owner_required");
      assert.doesNotMatch(refusal, /Parsian|240/, "a refusal must not leak the figures it is protecting");
    }

    // A company page is a workspace route, but its money is still money.
    const memberCompanyMoney = await fetch(`${base}/api/workspaces/companies/project/money`, { headers: { cookie: memberCookie } });
    assert.equal(memberCompanyMoney.status, 403);
    assert.equal((await memberCompanyMoney.json()).error.code, "owner_required");

    // What a deal is worth is money too: the owner sets it, a member never sees or sets it.
    await fetch(`${base}/api/workspaces/companies`, {
      method: "POST",
      headers: { ...json, cookie: ownerCookie, origin: base },
      body: JSON.stringify({ id: "project", name: "SampleProject" })
    });
    const priceDeal = await fetch(`${base}/api/workspaces/companies/project`, {
      method: "PATCH",
      headers: { ...json, cookie: ownerCookie, origin: base },
      body: JSON.stringify({ dealValue: 7300, dealCurrency: "USD" })
    });
    assert.equal(priceDeal.status, 200);
    assert.equal((await priceDeal.json()).company.dealValue, 7300);
    const ownerList = await (await fetch(`${base}/api/workspaces`, { headers: { cookie: ownerCookie } })).json();
    assert.equal(ownerList.companies.find((company) => company.id === "project").dealValue, 7300);
    const memberListText = await (await fetch(`${base}/api/workspaces`, { headers: { cookie: memberCookie } })).text();
    assert.doesNotMatch(memberListText, /dealValue|7300/, "a member's company list must not carry what a deal is worth");
    const memberPrice = await fetch(`${base}/api/workspaces/companies/project`, {
      method: "PATCH",
      headers: { ...json, cookie: memberCookie, origin: base },
      body: JSON.stringify({ dealValue: 1, dealCurrency: "USD" })
    });
    assert.equal(memberPrice.status, 403);
    assert.equal((await memberPrice.json()).error.code, "owner_required");

    const memberPage = await fetch(`${base}/data/hq.html`, { headers: { cookie: memberCookie } });
    const memberHtml = await memberPage.text();
    assert.doesNotMatch(memberHtml, /Parsian/, "the served page must never carry money figures");
    assert.doesNotMatch(memberHtml, /240/);

    const stillThere = await fetch(`${base}/api/money/entries?month=2026-08`, { headers: { cookie: ownerCookie } });
    assert.equal((await stillThere.json()).entries.length, 1, "a member's DELETE must not have removed anything");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("tasks are the whole team's, and changes reach everyone", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-tasks-hq-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), '<h1>HQ</h1><script type="application/json" id="hq-data">{}</script>');
  const config = {
    company: { name: "Your company", positioning: "build useful business software" },
    runtime: {
      root,
      roomDatabasePath: path.join(root, "data", "rooms.sqlite"),
      agent4AuthRequired: true,
      agent4SecureCookies: false,
      agent4BootstrapEmail: "owner@example.com",
      agent4BootstrapName: "Alex",
      agent4BootstrapPassword: "a-long-owner-password",
      agent4SessionHours: 24
    }
  };
  const server = createHqServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json" };

  try {
    const ownerCookie = cookieFrom(await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { ...json, origin: base },
      body: JSON.stringify({ email: "owner@example.com", password: "a-long-owner-password" })
    }));
    const invite = (await (await fetch(`${base}/api/auth/invites`, {
      method: "POST",
      headers: { ...json, cookie: ownerCookie, origin: base },
      body: JSON.stringify({ email: "teammate@example.com", name: "Sara" })
    })).json()).invite;
    const registration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { ...json, origin: base },
      body: JSON.stringify({ token: invite.token, password: "a-long-member-password" })
    });
    const memberCookie = cookieFrom(registration);
    const memberId = (await registration.json()).actor.id;

    const companyCreated = await fetch(`${base}/api/workspaces/companies`, {
      method: "POST",
      headers: { ...json, cookie: ownerCookie, origin: base },
      body: JSON.stringify({ id: "project", name: "SampleProject", kind: "client", stage: "active", nextAction: "Draft the pricing page", nextActionOn: "2026-09-10" })
    });
    assert.equal(companyCreated.status, 200);

    // Unlike the books, a member can create work and hand it to someone.
    const created = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { ...json, cookie: memberCookie, origin: base },
      body: JSON.stringify({ title: "Draft the pricing page", assigneeId: memberId, dueOn: "2026-09-10", companyId: "project", companyName: "SampleProject" })
    });
    assert.equal(created.status, 200, "a member can add a task");
    const task = (await created.json()).task;
    assert.equal(task.assigneeId, memberId);

    const seenByOwner = await fetch(`${base}/api/tasks`, { headers: { cookie: ownerCookie } });
    const body = await seenByOwner.json();
    assert.equal(body.tasks.length, 1, "the owner sees the same board");
    assert.ok(body.members.some((member) => member.id === memberId), "assignees can be named from the member list");
    assert.equal(body.workload.find((row) => row.assigneeId === memberId).open, 1);

    const commented = await fetch(`${base}/api/tasks/${task.id}/comments`, {
      method: "POST",
      headers: { ...json, cookie: memberCookie, origin: base },
      body: JSON.stringify({ body: "Copy is ready for review." })
    });
    assert.equal(commented.status, 200, "a teammate can comment on shared work");
    assert.equal((await commented.json()).comment.createdBy, memberId);

    const activity = await fetch(`${base}/api/tasks/${task.id}/comments`, { headers: { cookie: ownerCookie } });
    assert.equal(activity.status, 200);
    assert.deepEqual((await activity.json()).comments.map((comment) => comment.body), ["Copy is ready for review."]);

    // A live listener is told when the board moves.
    const controller = new AbortController();
    const stream = await fetch(`${base}/api/rooms/company-room/events?clientId=task-watcher-1`, {
      headers: { cookie: ownerCookie },
      signal: controller.signal
    });
    const announced = readServerEvent(stream, "tasks");
    await fetch(`${base}/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { ...json, cookie: memberCookie, origin: base },
      body: JSON.stringify({ status: "done" })
    });
    const event = await announced;
    assert.equal(event.type, "tasks", "finishing a task reaches the other person's screen");
    controller.abort();

    const workspace = await (await fetch(`${base}/api/workspaces`, { headers: { cookie: ownerCookie } })).json();
    const project = workspace.companies.find((company) => company.id === "project");
    assert.equal(project.nextAction, "", "finishing the linked task retires the same commitment on company and Home views");
    assert.equal(project.nextActionOn, null);

    const anonymous = await fetch(`${base}/api/tasks`);
    assert.equal(anonymous.status, 401, "a signed-out visitor sees no work at all");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("a company is created once, deleted on purpose, and carries its own money", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-company-page-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const server = createHqServer({ company: { name: "Your company" }, runtime: { root } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json", origin: base };

  try {
    const created = await fetch(`${base}/api/workspaces/companies`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ id: "project", name: "SampleProject", kind: "client" })
    });
    assert.equal(created.status, 200);

    const duplicate = await fetch(`${base}/api/workspaces/companies`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ name: "SampleProject", summary: "Everything the owner just typed", contactName: "Reza" })
    });
    assert.equal(duplicate.status, 400, "submitting the form twice must not report success and throw the form away");
    const clash = (await duplicate.json()).error;
    assert.equal(clash.code, "company_name_taken");
    assert.equal(clash.companyId, "project", "the screen can offer to open the company already on file");
    assert.equal((await (await fetch(`${base}/api/workspaces`)).json()).companies.length, 1);

    const project = (await (await fetch(`${base}/api/workspaces/projects`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ companyId: "project", companyName: "SampleProject", name: "Website redesign" })
    })).json()).project;
    const projectClash = await fetch(`${base}/api/workspaces/projects`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ companyId: "project", companyName: "SampleProject", name: "website redesign", goal: "Typed again" })
    });
    assert.equal(projectClash.status, 400);
    assert.equal((await projectClash.json()).error.projectId, project.id);

    await fetch(`${base}/api/workspaces/projects/${project.id}/decisions`, {
      method: "POST", headers: json, body: JSON.stringify({ text: "Ship the lighter homepage" })
    });

    const warning = await fetch(`${base}/api/workspaces/projects/${project.id}`, { method: "DELETE", headers: json });
    const warningBody = await warning.json();
    assert.equal(warningBody.removed, false, "deleting without confirming only reports what would go");
    assert.equal(warningBody.attached.decisions, 1);
    assert.equal((await (await fetch(`${base}/api/workspaces`)).json()).projects.length, 1);

    const removedProject = await fetch(`${base}/api/workspaces/projects/${project.id}?confirm=true`, { method: "DELETE", headers: json });
    assert.equal((await removedProject.json()).removed, true);
    const afterProject = await (await fetch(`${base}/api/workspaces`)).json();
    assert.equal(afterProject.projects.length, 0);
    assert.equal(afterProject.decisions.length, 0, "nothing is left pointing at a project that is gone");

    // Money attributed to a company comes back ready for that company's page.
    await fetch(`${base}/api/money/entries`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ direction: "in", amount: 500, currency: "EUR", category: "client", occurredOn: "2026-08-04", counterparty: "SampleProject", companyId: "project" })
    });
    await fetch(`${base}/api/money/entries`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ direction: "in", amount: 300, currency: "EUR", category: "client", occurredOn: "2026-08-20", status: "pending", dueOn: "2026-09-01", counterparty: "SampleProject", companyId: "project" })
    });
    await fetch(`${base}/api/money/entries`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ direction: "in", amount: 90, currency: "EUR", category: "other", occurredOn: "2026-10-04", counterparty: "Someone else" })
    });

    const companyMoney = await fetch(`${base}/api/workspaces/companies/project/money`);
    assert.equal(companyMoney.status, 200);
    const totals = (await companyMoney.json()).money.currencies[0];
    assert.equal(totals.in, 500);
    assert.equal(totals.outstanding, 300);
    assert.equal(totals.overdueCount, 1);
    assert.equal((await (await fetch(`${base}/api/workspaces/companies/nobody/money`)).json()).error.code, "workspace_rejected");

    // The period switcher asks for real bounds, not only the newest rows.
    const quarter = await (await fetch(`${base}/api/money/entries?from=2026-07-01&to=2026-09-30`)).json();
    assert.equal(quarter.entries.length, 2, "a quarter is a quarter, not the newest sixty rows");
    const october = await (await fetch(`${base}/api/money/entries?from=2026-10-01&to=2026-12-31`)).json();
    assert.equal(october.entries.length, 1);
    const byCompany = await (await fetch(`${base}/api/money/entries?companyId=project`)).json();
    assert.equal(byCompany.entries.length, 2);
    assert.equal((await (await fetch(`${base}/api/money/entries?from=nonsense`)).json()).error.code, "money_list_failed");

    const removedCompany = await fetch(`${base}/api/workspaces/companies/project?confirm=true`, { method: "DELETE", headers: json });
    assert.equal((await removedCompany.json()).removed, true);
    assert.equal((await (await fetch(`${base}/api/workspaces`)).json()).companies.length, 0);
    const orphaned = await (await fetch(`${base}/api/money/entries?companyId=project`)).json();
    assert.equal(orphaned.entries.length, 0, "the entries keep their own rows but stop pointing at a company that is gone");
    assert.equal((await (await fetch(`${base}/api/money/entries`)).json()).entries.length, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("the task board says how much work it could not show", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-board-cap-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const server = createHqServer({ company: { name: "Your company" }, runtime: { root } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json", origin: base };

  try {
    for (const title of ["Late one", "Due soon", "No date"]) {
      const created = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ title, dueOn: title === "Late one" ? "2026-08-20" : title === "Due soon" ? "2099-01-01" : undefined })
      });
      assert.equal(created.status, 200);
    }
    const finished = (await (await fetch(`${base}/api/tasks`, {
      method: "POST", headers: json, body: JSON.stringify({ title: "Finished" })
    })).json()).task;
    await fetch(`${base}/api/tasks/${finished.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ status: "done" }) });

    const capped = await (await fetch(`${base}/api/tasks?includeDone=true&limit=2`)).json();
    assert.deepEqual(capped.tasks.map((task) => task.title), ["Late one", "Due soon"], "the cap keeps the open work, not whatever the database reached first");
    assert.equal(capped.total, 4);
    assert.equal(capped.truncated, true, "the board can say out loud that it is showing part of the list");

    const whole = await (await fetch(`${base}/api/tasks?includeDone=true`)).json();
    assert.equal(whole.truncated, false);
    assert.equal(whole.tasks.length, 4);
    assert.equal(whole.tasks.at(-1).title, "Finished");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("a company's own history is written, read back on its company, and taken back", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-company-events-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const server = createHqServer({
    company: { name: "Your company" },
    runtime: {
      root,
      agent4AuthRequired: true,
      agent4SecureCookies: false,
      agent4BootstrapEmail: "owner@example.com",
      agent4BootstrapName: "Alex",
      agent4BootstrapPassword: "a-long-owner-password",
      agent4SessionHours: 24
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json" };

  try {
    const ownerCookie = cookieFrom(await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { ...json, origin: base },
      body: JSON.stringify({ email: "owner@example.com", password: "a-long-owner-password" })
    }));
    const invite = (await (await fetch(`${base}/api/auth/invites`, {
      method: "POST",
      headers: { ...json, cookie: ownerCookie, origin: base },
      body: JSON.stringify({ email: "teammate@example.com", name: "Teammate" })
    })).json()).invite;
    const registration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { ...json, origin: base },
      body: JSON.stringify({ token: invite.token, password: "a-long-member-password" })
    });
    const memberCookie = cookieFrom(registration);
    const member = (await registration.json()).actor;

    for (const body of [{ id: "sampleStudio", name: "Sample Studio", stage: "lead" }, { id: "project", name: "SampleProject" }]) {
      const created = await fetch(`${base}/api/workspaces/companies`, {
        method: "POST", headers: { ...json, cookie: ownerCookie, origin: base }, body: JSON.stringify(body)
      });
      assert.equal(created.status, 200);
    }

    const signedOut = await fetch(`${base}/api/workspaces/companies/sampleStudio/events`, {
      method: "POST", headers: { ...json, origin: base }, body: JSON.stringify({ type: "stage", detail: "Lead → Proposal sent" })
    });
    assert.equal(signedOut.status, 401, "a signed-out visitor cannot write history either");

    const written = await fetch(`${base}/api/workspaces/companies/sampleStudio/events`, {
      method: "POST",
      headers: { ...json, cookie: memberCookie, origin: base },
      body: JSON.stringify({ type: "stage", detail: "Lead → Proposal sent" })
    });
    assert.equal(written.status, 200);
    const event = (await written.json()).event;
    assert.equal(event.companyId, "sampleStudio");
    assert.equal(event.type, "stage");
    assert.equal(event.createdBy, member.id, "the line says who moved the stage, not who happens to own the app");

    await fetch(`${base}/api/workspaces/companies/project/events`, {
      method: "POST", headers: { ...json, cookie: ownerCookie, origin: base }, body: JSON.stringify({ type: "money", detail: "First invoice paid" })
    });

    const workspaces = await (await fetch(`${base}/api/workspaces`, { headers: { cookie: ownerCookie } })).json();
    const sampleStudio = workspaces.companies.find((item) => item.id === "sampleStudio");
    const project = workspaces.companies.find((item) => item.id === "project");
    assert.deepEqual(sampleStudio.timeline.map((item) => item.detail), ["Lead → Proposal sent"], "history comes back on the company it happened to");
    assert.deepEqual(project.timeline.map((item) => item.detail), ["First invoice paid"]);
    assert.equal(sampleStudio.timeline[0].at, event.at);

    const empty = await fetch(`${base}/api/workspaces/companies/sampleStudio/events`, {
      method: "POST", headers: { ...json, cookie: ownerCookie, origin: base }, body: JSON.stringify({ type: "stage", detail: "" })
    });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.code, "workspace_rejected");
    const nobody = await fetch(`${base}/api/workspaces/companies/nobody/events`, {
      method: "POST", headers: { ...json, cookie: ownerCookie, origin: base }, body: JSON.stringify({ type: "note", detail: "Said hello" })
    });
    assert.equal(nobody.status, 400);

    const warning = await (await fetch(`${base}/api/workspaces/companies/sampleStudio`, { method: "DELETE", headers: { ...json, cookie: ownerCookie, origin: base } })).json();
    assert.equal(warning.removed, false);
    assert.equal(warning.attached.events, 1, "the confirm dialog is told the history would go too");

    const removed = await fetch(`${base}/api/workspaces/events/${event.id}`, { method: "DELETE", headers: { cookie: ownerCookie, origin: base } });
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).removed, true);
    const again = await fetch(`${base}/api/workspaces/events/${event.id}`, { method: "DELETE", headers: { cookie: ownerCookie, origin: base } });
    assert.equal(again.status, 400, "taking back a line that is already gone is refused, not silently accepted");
    const after = await (await fetch(`${base}/api/workspaces`, { headers: { cookie: ownerCookie } })).json();
    assert.deepEqual(after.companies.find((item) => item.id === "sampleStudio").timeline, []);
    assert.equal(after.companies.find((item) => item.id === "project").timeline.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("money and invoices can both be narrowed to one company, or to the ones with none", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-company-filter-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const server = createHqServer({ company: { name: "Your company" }, runtime: { root } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json", origin: base };

  try {
    await fetch(`${base}/api/workspaces/companies`, {
      method: "POST", headers: json, body: JSON.stringify({ id: "project", name: "SampleProject", kind: "client" })
    });
    await fetch(`${base}/api/workspaces/companies`, {
      method: "POST", headers: json, body: JSON.stringify({ id: "example-metals", name: "Kavir", kind: "client" })
    });

    const entry = { direction: "in", currency: "EUR", category: "client", occurredOn: "2026-08-04", counterparty: "SampleProject" };
    await fetch(`${base}/api/money/entries`, { method: "POST", headers: json, body: JSON.stringify({ ...entry, amount: 500, companyId: "project" }) });
    await fetch(`${base}/api/money/entries`, { method: "POST", headers: json, body: JSON.stringify({ ...entry, amount: 90, counterparty: "Someone else" }) });
    await fetch(`${base}/api/money/entries`, { method: "POST", headers: json, body: JSON.stringify({ ...entry, amount: 20 }) });

    const loose = await (await fetch(`${base}/api/money/entries?companyId=none`)).json();
    assert.equal(loose.entries.length, 2, "the entries with nothing against them are asked for, not sieved for");
    assert.ok(loose.entries.every((row) => row.companyId === null));
    assert.equal((await (await fetch(`${base}/api/money/entries?companyId=project`)).json()).entries.length, 1);
    assert.equal((await (await fetch(`${base}/api/money/entries?companyId=none&direction=out`)).json()).entries.length, 0);

    // A standing cost holds a company, which it then carries onto every charge
    // it posts, so a monthly retainer shows up against the client paying it.
    // The posting itself is dated, so it is proved in the money store's tests.
    await fetch(`${base}/api/money/recurring`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        direction: "out", amount: 200, currency: "EUR", category: "contractor",
        cadence: "monthly", dayOfMonth: 5, counterparty: "Kavir", companyId: "example-metals"
      })
    });
    assert.equal((await (await fetch(`${base}/api/money/recurring`)).json()).recurring[0].companyId, "example-metals");
    const report = await (await fetch(`${base}/api/money/report?period=2026-08`)).json();
    const earners = report.report.currencies[0].earners;
    assert.deepEqual(earners, [
      { companyId: "project", name: "SampleProject", amount: 500 },
      { companyId: null, name: "Someone else", amount: 90 },
      { companyId: null, name: "SampleProject", amount: 20 }
    ], "the company's row carries its id, so the screen can link it; loose text stays its own line");

    const invoice = { clientName: "SampleProject", currency: "EUR", issueOn: "2026-08-04", lines: [{ description: "Retainer", quantity: 1, unitPrice: 500 }] };
    await fetch(`${base}/api/invoices`, { method: "POST", headers: json, body: JSON.stringify({ ...invoice, companyId: "project" }) });
    await fetch(`${base}/api/invoices`, { method: "POST", headers: json, body: JSON.stringify({ ...invoice, companyId: "example-metals", clientName: "Kavir" }) });
    const unfiled = (await (await fetch(`${base}/api/invoices`, { method: "POST", headers: json, body: JSON.stringify(invoice) })).json()).invoice;
    await fetch(`${base}/api/invoices/${unfiled.id}/status`, { method: "POST", headers: json, body: JSON.stringify({ status: "sent" }) });

    assert.equal((await (await fetch(`${base}/api/invoices`)).json()).invoices.length, 3);
    assert.equal((await (await fetch(`${base}/api/invoices?companyId=project`)).json()).invoices.length, 1);
    const unattributed = await (await fetch(`${base}/api/invoices?companyId=none`)).json();
    assert.deepEqual(unattributed.invoices.map((row) => row.id), [unfiled.id]);
    assert.equal((await (await fetch(`${base}/api/invoices?companyId=none&status=draft`)).json()).invoices.length, 0, "the two filters narrow together");
    assert.equal((await (await fetch(`${base}/api/invoices?companyId=none&status=sent`)).json()).invoices.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("paperwork is created, edited, moved along and listed over its own routes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-paperwork-hq-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const server = createHqServer({ company: { name: "Your company" }, runtime: { root } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json", origin: base };

  try {
    await fetch(`${base}/api/workspaces/companies`, {
      method: "POST", headers: json, body: JSON.stringify({ id: "project", name: "SampleProject", kind: "client" })
    });

    const created = await fetch(`${base}/api/paperwork`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        type: "proposal", numberPrefix: "PR", companyId: "project", language: "fa",
        title: "Landing page rebuild", values: { scope: "One page", price: "180,000,000" }
      })
    });
    assert.equal(created.status, 200);
    const document = (await created.json()).document;
    assert.match(document.number, /^PR-\d{4}-001$/);
    assert.equal(document.status, "draft");
    assert.equal(document.companyName, "SampleProject", "the name written on the paper is filled in from the CRM row");
    assert.deepEqual(document.values, { scope: "One page", price: "180,000,000" });

    const rejected = await fetch(`${base}/api/paperwork`, {
      method: "POST", headers: json, body: JSON.stringify({ type: "Proposal Letter", title: "Nope" })
    });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error.code, "paperwork_rejected");

    const patched = await fetch(`${base}/api/paperwork/${document.id}`, {
      method: "PATCH", headers: json, body: JSON.stringify({ values: { rounds: 2 } })
    });
    assert.deepEqual((await patched.json()).document.values, { scope: "One page", price: "180,000,000", rounds: 2 }, "an edit merges rather than replacing");

    const sent = await fetch(`${base}/api/paperwork/${document.id}/status`, {
      method: "POST", headers: json, body: JSON.stringify({ status: "signed", on: "2026-09-11" })
    });
    const signed = (await sent.json()).document;
    assert.equal(signed.status, "signed");
    assert.equal(signed.signedOn, "2026-09-11", "the date is when it was signed, not when the row was written");

    const badStatus = await fetch(`${base}/api/paperwork/${document.id}/status`, {
      method: "POST", headers: json, body: JSON.stringify({ status: "posted" })
    });
    assert.equal(badStatus.status, 400);
    assert.equal((await badStatus.json()).error.code, "paperwork_status_rejected");

    const nda = (await (await fetch(`${base}/api/paperwork`, {
      method: "POST", headers: json, body: JSON.stringify({ type: "nda", numberPrefix: "ND", title: "Mutual NDA" })
    })).json()).document;

    const list = await (await fetch(`${base}/api/paperwork`)).json();
    assert.deepEqual(list.documents.map((row) => row.id), [nda.id, document.id], "drafts first, then the newest");
    assert.equal(list.total, 2);
    assert.equal(list.hasMore, false);

    const page = await (await fetch(`${base}/api/paperwork?limit=1`)).json();
    assert.equal(page.documents.length, 1);
    assert.equal(page.total, 2, "the total counts everything that matched, not what fitted on the page");
    assert.equal(page.hasMore, true);
    assert.deepEqual((await (await fetch(`${base}/api/paperwork?limit=1&offset=1`)).json()).documents.map((row) => row.id), [document.id]);

    assert.equal((await (await fetch(`${base}/api/paperwork?type=nda`)).json()).total, 1);
    assert.equal((await (await fetch(`${base}/api/paperwork?status=signed`)).json()).total, 1);
    assert.equal((await (await fetch(`${base}/api/paperwork?companyId=project`)).json()).total, 1);
    assert.deepEqual((await (await fetch(`${base}/api/paperwork?companyId=none`)).json()).documents.map((row) => row.id), [nda.id], "the set a person goes looking for to fix");
    const badFilter = await fetch(`${base}/api/paperwork?status=posted`);
    assert.equal(badFilter.status, 400);
    assert.equal((await badFilter.json()).error.code, "paperwork_rejected");

    assert.deepEqual((await (await fetch(`${base}/api/paperwork/${document.id}`)).json()).document, signed);
    assert.equal((await fetch(`${base}/api/paperwork/00000000-0000-4000-8000-000000000000`)).status, 404);

    // The company page asks for its own documents beside its own money.
    const companyPaperwork = await fetch(`${base}/api/workspaces/companies/project/paperwork`);
    assert.deepEqual((await companyPaperwork.json()).documents.map((row) => row.id), [document.id]);

    // Deleting the company lets the document go rather than taking it along.
    const warning = await (await fetch(`${base}/api/workspaces/companies/project`, { method: "DELETE", headers: json })).json();
    assert.equal(warning.attached.paperwork, 1, "the confirm dialog says the document would stop pointing anywhere");
    await fetch(`${base}/api/workspaces/companies/project?confirm=true`, { method: "DELETE", headers: json });
    const orphan = (await (await fetch(`${base}/api/paperwork/${document.id}`)).json()).document;
    assert.equal(orphan.companyId, null);
    assert.equal(orphan.companyName, "SampleProject", "a signed proposal outlives the CRM row it was filed under");

    const removed = await fetch(`${base}/api/paperwork/${nda.id}`, { method: "DELETE", headers: json });
    assert.deepEqual(await removed.json(), { removed: true });
    assert.equal((await fetch(`${base}/api/paperwork/${nda.id}`, { method: "DELETE", headers: json })).status, 404);
    assert.equal((await (await fetch(`${base}/api/paperwork`)).json()).total, 1);

    assert.equal((await fetch(`${base}/api/paperwork`, { method: "PUT", headers: json, body: "{}" })).status, 405);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("paperwork is owner-only, like the invoices it sits beside", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-paperwork-auth-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>HQ</h1>");
  const server = createHqServer({
    company: { name: "Your company" },
    runtime: {
      root,
      roomDatabasePath: path.join(root, "data", "rooms.sqlite"),
      agent4AuthRequired: true,
      agent4SecureCookies: false,
      agent4BootstrapEmail: "owner@example.com",
      agent4BootstrapName: "Alex",
      agent4BootstrapPassword: "a-long-owner-password",
      agent4SessionHours: 24
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json" };

  try {
    const ownerCookie = cookieFrom(await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { ...json, origin: base },
      body: JSON.stringify({ email: "owner@example.com", password: "a-long-owner-password" })
    }));
    const invite = (await (await fetch(`${base}/api/auth/invites`, {
      method: "POST",
      headers: { ...json, cookie: ownerCookie, origin: base },
      body: JSON.stringify({ email: "teammate@example.com", name: "Teammate" })
    })).json()).invite;
    const memberCookie = cookieFrom(await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { ...json, origin: base },
      body: JSON.stringify({ token: invite.token, password: "a-long-member-password" })
    }));

    const document = (await (await fetch(`${base}/api/paperwork`, {
      method: "POST",
      headers: { ...json, cookie: ownerCookie, origin: base },
      body: JSON.stringify({ type: "proposal", numberPrefix: "PR", title: "Landing page rebuild", values: { price: "180,000,000" } })
    })).json()).document;

    // A proposal carries the price and an NDA carries the terms, so the member
    // boundary is the same one the money sits behind — reads included.
    for (const [method, route] of [
      ["GET", "/api/paperwork"],
      ["POST", "/api/paperwork"],
      ["GET", `/api/paperwork/${document.id}`],
      ["PATCH", `/api/paperwork/${document.id}`],
      ["POST", `/api/paperwork/${document.id}/status`],
      ["DELETE", `/api/paperwork/${document.id}`],
      ["GET", "/api/workspaces/companies/project/paperwork"]
    ]) {
      const blocked = await fetch(`${base}${route}`, {
        method,
        headers: { ...json, cookie: memberCookie, origin: base },
        body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify({})
      });
      assert.equal(blocked.status, 403, `${method} ${route} must refuse a member`);
      const refusal = await blocked.text();
      assert.equal(JSON.parse(refusal).error.code, "owner_required");
      assert.doesNotMatch(refusal, /180,000,000|Landing page/, "a refusal must not leak what it is protecting");
    }

    const stillThere = await (await fetch(`${base}/api/paperwork`, { headers: { cookie: ownerCookie } })).json();
    assert.equal(stillThere.total, 1, "a member's DELETE must not have removed anything");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent4 chat answers from the business, and only proposes changes that would apply", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-chat-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  let seen;
  const config = {
    company: { name: "Your company", positioning: "build useful business software" },
    runtime: { root }
  };
  const server = createHqServer(config, {
    providerStatus: async () => ({ provider: "openai", ready: true, model: "test", message: "ready" }),
    generateChat: async (_config, input) => {
      seen = input;
      return {
        reply: "Sample Studio has gone quiet. Write them a next step.",
        provider: "openai",
        model: "test",
        actions: [
          { type: "set_next_step", companyId: "sampleStudio", title: null, text: "Send the proposal", dueOn: "2026-10-27", stage: null, dealValue: null, dealCurrency: null, reason: "No next step for 41 days." },
          { type: "move_stage", companyId: "sampleStudio", title: null, text: null, dueOn: null, stage: "proposal", dealValue: null, dealCurrency: null, reason: "Proposal is next." },
          { type: "move_stage", companyId: "ghost", title: null, text: null, dueOn: null, stage: "active", dealValue: null, dealCurrency: null, reason: "Not a company." },
          { type: "move_stage", companyId: "sampleStudio", title: null, text: null, dueOn: null, stage: "won", dealValue: null, dealCurrency: null, reason: "Not a stage." },
          { type: "set_deal", companyId: "sampleStudio", title: null, text: null, dueOn: null, stage: null, dealValue: 8000, dealCurrency: "usd", reason: "Quoted in the meeting." },
          { type: "create_task", companyId: null, title: "Reply to the launch list", text: null, dueOn: "not a date", stage: null, dealValue: null, dealCurrency: null, reason: "Waiting." }
        ]
      };
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json", origin: base };
  try {
    await fetch(`${base}/api/workspaces/companies`, { method: "POST", headers: json, body: JSON.stringify({ id: "sampleStudio", name: "Sample Studio", stage: "talking", dealValue: 8000, dealCurrency: "USD" }) });
    await fetch(`${base}/api/tasks`, { method: "POST", headers: json, body: JSON.stringify({ title: "Chase the logo files", companyId: "sampleStudio", companyName: "Sample Studio" }) });

    const bad = await fetch(`${base}/api/agent4/chat`, { method: "POST", headers: json, body: JSON.stringify({ message: "", today: "2026-10-24" }) });
    assert.equal(bad.status, 400);

    const answer = await fetch(`${base}/api/agent4/chat`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ message: "Draft a nudge to Sample Studio about the logo files", today: "2026-10-24", history: [{ role: "user", text: "hi" }, { role: "robot", text: "ignored" }] })
    });
    assert.equal(answer.status, 200);
    const body = await answer.json();
    assert.match(body.reply, /Sample Studio/);
    assert.deepEqual(body.actions.map((action) => action.type), ["set_next_step", "move_stage", "set_deal", "create_task"], "ghosts, bad stages and no-ops are dropped");
    assert.equal(body.actions[2].dealCurrency, "USD");
    assert.equal(body.actions[3].dueOn, null, "a made-up date is not carried through");
    assert.match(body.actions[0].label, /Sample Studio.*Send the proposal/);

    assert.equal(seen.context.today, "2026-10-24");
    assert.equal(seen.context.companies[0].id, "sampleStudio");
    assert.equal(seen.context.companies[0].deal, "8000 USD", "the owner sees deal values in context");
    assert.equal(seen.context.companies[0].openTasks, 1);
    assert.equal(seen.context.openTasks[0].title, "Chase the logo files");
    assert.deepEqual(seen.history, [{ role: "user", text: "hi" }], "only user and agent turns are kept");

    // A common question never reaches the model: it is answered from the data.
    seen = null;
    const quiet = await (await fetch(`${base}/api/agent4/chat`, { method: "POST", headers: json, body: JSON.stringify({ message: "Who have I gone quiet on?", today: "2026-10-24" }) })).json();
    assert.equal(seen, null, "the model was not called");
    assert.equal(quiet.provider, "built-in");
    assert.match(quiet.reply, /Sample Studio/);
    assert.equal(quiet.actions[0].type, "set_next_step");
    assert.equal(quiet.actions[0].companyId, "sampleStudio");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Agent4 chat says plainly when no model is connected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-chat-down-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const server = createHqServer({ company: { name: "Your company", positioning: "x" }, runtime: { root } }, {
    generateChat: async () => { throw new Error("OPENAI_API_KEY is required."); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/agent4/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ message: "hello", today: "2026-10-24" })
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "model_not_configured");
    assert.match(body.error.message, /AGENT4_OPENAI_API_KEY/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("a company whose id has a colon can still be edited through its encoded address", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-colon-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const server = createHqServer({ company: { name: "Your company", positioning: "x" }, runtime: { root } }, {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json", origin: base };
  try {
    const created = await fetch(`${base}/api/workspaces/companies`, { method: "POST", headers: json, body: JSON.stringify({ id: "name:project", name: "SampleProject" }) });
    assert.equal(created.status, 200);
    const patched = await fetch(`${base}/api/workspaces/companies/${encodeURIComponent("name:project")}`, {
      method: "PATCH", headers: json, body: JSON.stringify({ nextAction: "Send the proposal", nextActionOn: "2026-10-27" })
    });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).company.nextAction, "Send the proposal");
    const event = await fetch(`${base}/api/workspaces/companies/${encodeURIComponent("name:project")}/events`, {
      method: "POST", headers: json, body: JSON.stringify({ type: "note", detail: "Called them" })
    });
    assert.equal(event.status, 200);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("site monitoring counts visitors and errors only for the site that owns the token", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-monitor-hq-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const checked = [];
  const server = createHqServer({ company: { name: "Your company", positioning: "x" }, runtime: { root } }, {
    monitorRunner: { checkNow: async (id) => { checked.push(id); }, start() {}, stop() {} }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json", origin: base };
  const browser = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15";
  const beacon = (body, headers = {}) => fetch(`${base}/m/collect`, { method: "POST", headers: { "content-type": "text/plain", "user-agent": browser, origin: "https://shop.example.com", ...headers }, body: JSON.stringify(body) });
  try {
    const created = await fetch(`${base}/api/monitor/sites`, { method: "POST", headers: json, body: JSON.stringify({ name: "Shop", url: "shop.example.com" }) });
    assert.equal(created.status, 200);
    const { site } = await created.json();
    assert.equal(site.url, "https://shop.example.com/");
    assert.equal(site.host, "shop.example.com");
    assert.deepEqual(checked, [site.id], "a new site is looked at straight away");
    assert.equal((await fetch(`${base}/api/monitor/sites`, { method: "POST", headers: json, body: JSON.stringify({ url: "shop.example.com" }) })).status, 400, "the same site twice is refused");

    const script = await fetch(`${base}/m.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /javascript/);
    assert.match(await script.text(), /\/m\/collect/);
    const preflight = await fetch(`${base}/m/collect`, { method: "OPTIONS", headers: { origin: "https://shop.example.com" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");

    assert.equal((await beacon({ k: site.token, t: "pv", p: "/" })).status, 204);
    assert.equal((await beacon({ k: site.token, t: "pv", p: "/pricing" })).status, 204);
    await beacon({ k: site.token, t: "pv", p: "/" }, { origin: "https://evil.example.org" });
    await beacon({ k: site.token, t: "pv", p: "/" }, { "user-agent": "Googlebot/2.1" });
    await beacon({ k: "not-a-real-token", t: "pv", p: "/" });
    await beacon({ k: site.token, t: "err", m: "x is undefined", s: "https://shop.example.com/app.js", l: 12, p: "/pricing" });
    await beacon({ k: site.token, t: "pv", p: "/", extra: "x".repeat(5000) });

    const refused = (await (await fetch(`${base}/api/monitor/sites/${site.id}`)).json()).rejected;
    assert.deepEqual(refused.map((row) => [row.reason, row.host]).sort(), [["bot", "shop.example.com"], ["domain", "evil.example.org"]], "an ignored report is explained, with where it came from");

    const overview = (await (await fetch(`${base}/api/monitor/sites`)).json()).sites[0];
    assert.equal(overview.views7, 2, "a foreign origin, a bot, a wrong token and an oversize body are all ignored");
    assert.equal(overview.visitors7, 1);
    assert.equal(overview.errorKinds7, 1);
    assert.equal(overview.tracking, true);

    const detail = await (await fetch(`${base}/api/monitor/sites/${site.id}`)).json();
    assert.equal(detail.errors[0].message, "x is undefined");
    assert.equal((await fetch(`${base}/api/monitor/errors/${detail.errors[0].id}`, { method: "DELETE", headers: json })).status, 200);

    const paused = await fetch(`${base}/api/monitor/sites/${site.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ paused: true }) });
    assert.equal((await paused.json()).site.paused, true);
    await beacon({ k: site.token, t: "pv", p: "/more" });
    assert.equal((await (await fetch(`${base}/api/monitor/sites`)).json()).sites[0].views7, 2, "a paused site stops counting");

    assert.equal((await fetch(`${base}/api/monitor/sites/${site.id}`, { method: "DELETE", headers: json })).status, 200);
    assert.equal((await fetch(`${base}/api/monitor/sites/${site.id}`)).status, 404);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the document shelf takes a file in parts and gives it back only as a download", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-shelf-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const server = createHqServer({ company: { name: "Your company", positioning: "x" }, runtime: { root } }, {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json", origin: base };
  const body = Buffer.from("<script>alert('this is a page, not a document')</script>".repeat(40));
  try {
    const started = await (await fetch(`${base}/api/files`, { method: "POST", headers: json, body: JSON.stringify({ name: "Proposal – Sample Studio.html", kind: "template", size: body.length, mime: "text/html" }) })).json();
    const id = started.file.id;
    let offset = 0;
    while (offset < body.length) {
      const part = body.subarray(offset, offset + 1000);
      const sent = await fetch(`${base}/api/files/${id}/part?offset=${offset}`, { method: "PUT", headers: { origin: base, "content-type": "application/octet-stream" }, body: part });
      assert.equal(sent.status, 200);
      offset += part.length;
    }
    const repeated = await fetch(`${base}/api/files/${id}/part?offset=0`, { method: "PUT", headers: { origin: base }, body: body.subarray(0, 10) });
    assert.equal(repeated.status, 400, "a part cannot be sent twice");
    assert.equal((await fetch(`${base}/api/files/${id}/finish`, { method: "POST", headers: json })).status, 200);

    const listed = await (await fetch(`${base}/api/files?kind=template`)).json();
    assert.deepEqual(listed.files.map((file) => file.name), ["Proposal – Sample Studio.html"]);

    const download = await fetch(`${base}/api/files/${id}/download`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /^attachment; filename="Proposal _ Sample Studio\.html"; filename\*=UTF-8''/);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.equal(download.headers.get("content-type"), "application/octet-stream", "a stored page can never be served as a page");
    assert.equal(Buffer.from(await download.arrayBuffer()).toString(), body.toString());

    const renamed = await (await fetch(`${base}/api/files/${id}`, { method: "PATCH", headers: json, body: JSON.stringify({ kind: "document", companyId: "sampleStudio", companyName: "Sample Studio" }) })).json();
    assert.equal(renamed.file.kind, "document");
    assert.equal((await (await fetch(`${base}/api/files?companyId=sampleStudio`)).json()).files.length, 1);
    assert.equal((await fetch(`${base}/api/files/${id}`, { method: "DELETE", headers: json })).status, 200);
    assert.equal((await fetch(`${base}/api/files/${id}/download`)).status, 404);
  } finally {
    server.close();
    await once(server, "close");
  }
});
