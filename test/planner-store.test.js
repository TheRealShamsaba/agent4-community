import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createPlannerStore } from "../src/planner-store.js";

async function withStore(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-planner-"));
  const store = createPlannerStore(path.join(directory, "rooms.sqlite"));
  try {
    await run(store);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("calendar events round-trip in day and time order", async () => {
  await withStore((store) => {
    store.createEvent({ title: "Write LinkedIn post", startsOn: "2026-09-01", actorId: "alex" });
    const meeting = store.createEvent({ title: "Client call", startsOn: "2026-08-31", startsAt: "10:30", durationMinutes: 45, externalId: "google-event-1", actorId: "alex" });
    const edited = store.updateEvent(meeting.id, { startsAt: "11:00", notes: "Bring the proposal" }, "alex");
    assert.equal(edited.durationMinutes, 45);
    assert.equal(edited.notes, "Bring the proposal");
    assert.equal(store.findEventByExternalId("google-event-1", "alex").id, meeting.id);
    assert.equal(store.findEventByExternalId("google-event-1", "sara"), null);
    assert.deepEqual(store.listEvents({ actorId: "alex", from: "2026-08-30", to: "2026-09-02" }).map((event) => event.title), ["Client call", "Write LinkedIn post"]);
  });
});

test("calendar events are personal and validate dates and times", async () => {
  await withStore((store) => {
    const event = store.createEvent({ title: "Owner review", startsOn: "2026-08-30", actorId: "alex" });
    assert.equal(store.listEvents({ actorId: "sara" }).length, 0);
    assert.throws(() => store.updateEvent(event.id, { title: "Changed" }, "sara"), /belongs to someone else/);
    assert.throws(() => store.createEvent({ title: "Bad time", startsOn: "2026-08-30", startsAt: "25:00", actorId: "alex" }), /HH:MM/);
    assert.equal(store.removeEvent(event.id, "alex"), true);
  });
});

test("posting reminder settings have useful defaults and stay personal", async () => {
  await withStore((store) => {
    const defaults = {
      enabled: true,
      remindAt: "18:30",
      morningEnabled: true,
      morningAt: "08:30",
      overdueEnabled: true,
      overdueAt: "10:30",
      weeklyEnabled: true,
      weeklyAt: "18:00",
      updatedAt: null
    };
    assert.deepEqual(store.getReminderSettings("alex"), defaults);
    const settings = store.setReminderSettings("alex", { enabled: false, remindAt: "20:15", overdueEnabled: false, morningAt: "09:15" });
    assert.equal(settings.enabled, false);
    assert.equal(settings.remindAt, "20:15");
    assert.equal(settings.overdueEnabled, false);
    assert.equal(settings.morningAt, "09:15");
    assert.deepEqual(store.getReminderSettings("sara"), defaults);
    assert.throws(() => store.setReminderSettings("alex", { remindAt: "25:00" }), /HH:MM/);
  });
});

test("capture drafts are owner-bound and transition exactly once", async () => {
  await withStore((store) => {
    const draft = store.createCaptureDraft("alex", { kind: "task", payload: { title: "Send proposal" } });
    assert.equal(draft.status, "ready");
    assert.equal(store.getCaptureDraft("sara", draft.id), null);
    const claim = store.transitionCaptureDraft("alex", draft.id, "ready", "executing");
    assert.equal(claim.changed, true);
    assert.equal(store.transitionCaptureDraft("alex", draft.id, "ready", "executing").changed, false);
    assert.equal(store.transitionCaptureDraft("alex", draft.id, "executing", "confirmed").draft.status, "confirmed");
    const update = store.createCaptureDraft("alex", { kind: "task-update", payload: { taskId: "task-1", updates: { dueOn: "2026-08-31" } } });
    assert.equal(update.kind, "task-update");
  });
});

test("weekly reviews persist one editable reset per person and week", async () => {
  await withStore((store) => {
    assert.equal(store.getWeeklyReview("alex", "2026-08-24"), null);
    const first = store.saveWeeklyReview("alex", "2026-08-24", {
      wins: "Published every day",
      lessons: "Batch the drafts",
      nextFocus: "Book three sales calls"
    });
    assert.equal(first.nextFocus, "Book three sales calls");
    const edited = store.saveWeeklyReview("alex", "2026-08-24", { wins: "Kept the streak alive" });
    assert.equal(edited.wins, "Kept the streak alive");
    assert.equal(edited.lessons, "");
    assert.equal(store.getWeeklyReview("sara", "2026-08-24"), null);
    assert.throws(() => store.saveWeeklyReview("alex", "bad-date", { wins: "Nope" }), /YYYY-MM-DD/);
    assert.throws(() => store.saveWeeklyReview("alex", "2026-08-24", {}), /at least one note/);
  });
});

test("daily target check-ins preserve the target and can be corrected", async () => {
  await withStore((store) => {
    assert.equal(store.getGoalCheckin("alex", "2026-08-31"), null);
    const first = store.saveGoalCheckin("alex", "2026-08-31", {
      target: "Book three useful conversations",
      movedTarget: true
    });
    assert.equal(first.movedTarget, true);
    assert.equal(first.target, "Book three useful conversations");
    store.saveGoalCheckin("alex", "2026-09-01", {
      target: "Book three useful conversations",
      movedTarget: false
    });
    const corrected = store.saveGoalCheckin("alex", "2026-09-01", {
      target: "Book three useful conversations",
      movedTarget: true
    });
    assert.equal(corrected.movedTarget, true);
    assert.deepEqual(
      store.listGoalCheckins({ actorId: "alex", from: "2026-08-31", to: "2026-09-01" }).map((checkin) => checkin.day),
      ["2026-08-31", "2026-09-01"]
    );
    assert.deepEqual(store.listGoalCheckins({ actorId: "sara" }), []);
    assert.throws(() => store.saveGoalCheckin("alex", "2026-09-02", { target: "", movedTarget: true }), /needs the target/);
    assert.throws(() => store.saveGoalCheckin("alex", "2026-09-02", { target: "Grow revenue" }), /Choose whether/);
  });
});

test("bot sessions survive restarts and scheduled deliveries are idempotent", async () => {
  await withStore((store) => {
    assert.equal(store.getBotSession("alex"), null);
    const session = store.setBotSession("alex", {
      kind: "weekly-review",
      step: "lessons",
      payload: { wins: "Shipped daily" }
    });
    assert.deepEqual(session.payload, { wins: "Shipped daily" });
    assert.equal(session.step, "lessons");
    assert.equal(store.getBotSession("sara"), null);
    assert.equal(store.clearBotSession("alex"), true);
    assert.equal(store.getBotSession("alex"), null);

    assert.equal(store.hasBotDelivery("alex", "posting:2026-08-30"), false);
    assert.equal(store.markBotDelivery("alex", "posting:2026-08-30"), true);
    assert.equal(store.markBotDelivery("alex", "posting:2026-08-30"), false);
    assert.equal(store.hasBotDelivery("alex", "posting:2026-08-30"), true);
    assert.equal(store.hasBotDelivery("sara", "posting:2026-08-30"), false);
  });
});
