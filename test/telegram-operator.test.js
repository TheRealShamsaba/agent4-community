import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createContentStore } from "../src/content-store.js";
import { createPlannerStore } from "../src/planner-store.js";
import { createTaskStore } from "../src/task-store.js";
import { createTelegramOperator } from "../src/telegram-operator.js";

async function withOperator(run, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-telegram-operator-"));
  const databasePath = path.join(directory, "rooms.sqlite");
  const taskStore = createTaskStore(databasePath);
  const contentStore = createContentStore(databasePath);
  const plannerStore = createPlannerStore(databasePath);
  const scoutStore = options.scoutStore || {
    listProspects: () => [{ id: "acme", name: "Acme", status: "new", opportunityScore: 72 }]
  };
  const operator = createTelegramOperator({
    actorId: "local-owner",
    taskStore,
    contentStore,
    plannerStore,
    scoutStore,
    membersProvider: () => options.members || [{ id: "local-owner", name: "Alex", role: "owner" }],
    timeZone: "Europe/Istanbul",
    now: options.now || (() => new Date("2026-08-30T16:30:00Z"))
  });
  try {
    await run({ operator, taskStore, contentStore, plannerStore });
  } finally {
    taskStore.close();
    contentStore.close();
    plannerStore.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("the Telegram operator turns HQ state into one useful daily brief", async () => {
  await withOperator(({ operator }) => {
    operator.addTask("Send the proposal", { dueOn: "2026-08-30" });
    const brief = operator.formatToday();
    assert.match(brief, /TODAY · Sunday, Aug 30/);
    assert.match(brief, /Send the proposal · Today/);
    assert.doesNotMatch(brief, /Instagram|LinkedIn|Posting|MOMENTUM/, "the hidden content plan and the points game stay out of the brief");
    assert.match(brief, /1 lead to review/);
    assert.match(brief, /Sunday reset is ready/);
    assert.doesNotMatch(brief, /RADAR|LENS|COMPASS|VAULT/);
    const html = operator.formatTodayHtml();
    assert.match(html, /^<b>🏀 TODAY/);
    assert.match(html, /<b>1\. Send the proposal<\/b>/);
    assert.doesNotMatch(html, /MOMENTUM|Posting/);
  });
});

test("Today merges sales follow-ups and the confirmed Google agenda", async () => {
  const scoutStore = {
    state: { prospects: { acme: { name: "Acme" } } },
    listProspects: () => [],
    listTasks: () => [{ id: "sales-1", title: "Follow up on proposal", prospectId: "acme", dueAt: "2026-08-30T09:00:00Z", priority: "high" }]
  };
  await withOperator(({ operator }) => {
    const brief = operator.formatToday(undefined, { agenda: [{ title: "Client call", start: "2026-08-30T14:00:00Z" }] });
    assert.match(brief, /Follow up on proposal · Today/);
    assert.match(brief, /Calendar · 1 event · Client call/);
    assert.equal(operator.snapshot().nextMoves[0].source, "sales");
  }, { scoutStore });
});

test("post check buttons are idempotent and protect each platform separately", async () => {
  await withOperator(({ operator }) => {
    assert.match(operator.formatPostCheck(), /Instagram · Waiting/);
    const first = operator.markPosted("instagram");
    assert.equal(first.created, true);
    const second = operator.markPosted("instagram");
    assert.equal(second.created, false);
    const check = operator.formatPostCheck();
    assert.match(check, /Instagram · Posted/);
    assert.match(check, /LinkedIn · Waiting/);
    assert.match(operator.formatPostCheckHtml(), /<b>📣 POST CHECK/);
  });
});

test("universal capture confirms before it writes and duplicate taps stay safe", async () => {
  await withOperator(async ({ operator, taskStore, contentStore, plannerStore }) => {
    const taskPlan = operator.prepareCapture({ type: "add-task", title: "Call Ali", dueAt: "2026-08-31T09:00:00.000Z" });
    assert.equal(taskStore.listTasks({ includeDone: true }).length, 0);
    assert.match(taskPlan.message, /READY TO LOCK IN/);
    assert.match(taskPlan.messageHtml, /<b>TASK · READY TO LOCK IN<\/b>/);
    const savedTask = await operator.confirmCapture(taskPlan.draft.id);
    assert.equal(savedTask.ok, true);
    assert.equal(taskStore.listTasks({ includeDone: true })[0].title, "Call Ali");
    const duplicate = await operator.confirmCapture(taskPlan.draft.id);
    assert.equal(duplicate.already, true);
    assert.equal(taskStore.listTasks({ includeDone: true }).length, 1);

    const clarification = operator.prepareCapture({ type: "add-post", title: "Pricing lesson", platform: null, plannedOn: "2026-08-31" });
    assert.equal(clarification.needsClarification, true);
    assert.equal(plannerStore.getBotSession("local-owner").step, "platform");
    const contentPlan = operator.handleSessionText("LinkedIn");
    assert.equal(contentPlan.draft.kind, "content");
    assert.equal(contentStore.listPosts({ actorId: "local-owner" }).length, 0);
    await operator.confirmCapture(contentPlan.draft.id);
    const [post] = contentStore.listPosts({ actorId: "local-owner" });
    assert.equal(post.platform, "linkedin");
    assert.equal(post.status, "scheduled");

    const dateClarification = operator.prepareCapture({
      type: "add-task",
      title: "call Sina",
      dueAt: null,
      needsDueDate: true
    });
    assert.equal(dateClarification.needsClarification, true);
    assert.match(dateClarification.message, /When should I put it/);
    assert.equal(plannerStore.getBotSession("local-owner").step, "task-date");
    const invalidDate = operator.handleSessionText("Later");
    assert.match(invalidDate.message, /Today, Tomorrow, Next week, or No date/);
    assert.equal(invalidDate.clarification, "task-date");
    const datedTaskPlan = operator.handleSessionText("Tommrow");
    assert.equal(datedTaskPlan.draft.kind, "task");
    assert.equal(datedTaskPlan.draft.payload.dueOn, "2026-08-31");
    assert.equal(taskStore.listTasks({ includeDone: true }).length, 1);
    await operator.confirmCapture(datedTaskPlan.draft.id);
    const tasks = taskStore.listTasks({ includeDone: true });
    assert.equal(tasks.length, 2);
    assert.equal(tasks.find((task) => task.title === "call Sina").dueOn, "2026-08-31");
  });
});

test("the task command center groups the real board and supports safe conversational changes", async () => {
  const members = [
    { id: "local-owner", name: "Alex", role: "owner" },
    { id: "user-armin", name: "Armin", role: "member" }
  ];
  await withOperator(async ({ operator, taskStore }) => {
    const late = taskStore.createTask({ title: "Send revised proposal", assigneeId: "local-owner", dueOn: "2026-08-29", priority: "high", actorId: "local-owner", project: "Website" });
    taskStore.createTask({ title: "Call Sina", assigneeId: "local-owner", dueOn: "2026-08-30", actorId: "local-owner" });
    taskStore.createTask({ title: "Review analytics", assigneeId: "local-owner", dueOn: "2026-09-02", actorId: "local-owner" });
    taskStore.createTask({ title: "Write launch notes", assigneeId: "local-owner", actorId: "local-owner" });
    taskStore.createTask({ title: "Plan the sprint", assigneeId: "local-owner", dueOn: "2026-09-03", actorId: "local-owner" });
    taskStore.createTask({ title: "Clean up the brief", assigneeId: "local-owner", actorId: "local-owner" });
    taskStore.createTask({ title: "Prepare assets", assigneeId: "user-armin", dueOn: "2026-08-31", actorId: "user-armin" });

    const mine = operator.taskCenter({ pageSize: 8 });
    assert.equal(mine.total, 6);
    assert.match(mine.message, /OVERDUE[\s\S]*Send revised proposal/);
    assert.match(mine.message, /TODAY[\s\S]*Call Sina/);
    assert.match(mine.message, /UPCOMING[\s\S]*Review analytics/);
    assert.match(mine.message, /NO DATE[\s\S]*Write launch notes/);
    assert.match(mine.messageHtml, /<b>🔴 OVERDUE<\/b>/);
    assert.match(mine.messageHtml, /<b>1\. Send revised proposal<\/b>/);
    assert.doesNotMatch(mine.message, /Prepare assets/);
    assert.equal(operator.taskCenter().pageCount, 2);
    assert.equal(operator.taskCenter({ page: 1 }).tasks.length, 1);
    assert.equal(operator.taskCenter({ scope: "team", pageSize: 8 }).total, 7);
    assert.equal(operator.handleTaskCommand("what's urgent?").total, 2);
    assert.equal(operator.handleTaskCommand("Move client meeting to Friday").handled, false);

    const moved = operator.handleTaskCommand("Move the Call Sina task to Friday");
    assert.equal(moved.draft.kind, "task-update");
    assert.equal(taskStore.listTasks({ includeDone: true }).find((task) => task.title === "Call Sina").dueOn, "2026-08-30");
    await operator.confirmCapture(moved.draft.id);
    assert.equal(taskStore.listTasks({ includeDone: true }).find((task) => task.title === "Call Sina").dueOn, "2026-09-04");

    const assigned = operator.handleTaskCommand("Give Call Sina to Armin");
    assert.match(assigned.message, /Assigned to · Armin/);
    await operator.confirmCapture(assigned.draft.id);
    assert.equal(taskStore.listTasks({ includeDone: true }).find((task) => task.title === "Call Sina").assigneeId, "user-armin");

    const completed = operator.handleTaskCommand("Finish the revised proposal task");
    assert.equal(taskStore.listTasks({ includeDone: true }).find((task) => task.id === late.id).status, "open");
    await operator.confirmCapture(completed.draft.id);
    assert.equal(taskStore.listTasks({ includeDone: true }).find((task) => task.id === late.id).status, "done");
  }, { members });
});

test("Telegram task formatting escapes user-authored text before enabling HTML", async () => {
  await withOperator(({ operator, taskStore }) => {
    const task = taskStore.createTask({
      title: "Review <script> & proposal",
      notes: "Use <b>their</b> wording & ours",
      assigneeId: "local-owner",
      actorId: "local-owner"
    });
    const center = operator.taskCenter();
    assert.match(center.messageHtml, /Review &lt;script&gt; &amp; proposal/);
    assert.doesNotMatch(center.messageHtml, /<script\b/i);
    const detail = operator.taskDetail(task.id);
    assert.match(detail.messageHtml, /Use &lt;b&gt;their&lt;\/b&gt; wording &amp; ours/);
    const capture = operator.prepareCapture({ type: "add-task", title: "Use <b>safe</b> & clear", dueAt: null });
    assert.match(capture.messageHtml, /Use &lt;b&gt;safe&lt;\/b&gt; &amp; clear/);
    assert.doesNotMatch(capture.messageHtml, /<b>safe<\/b>/);
  });
});

test("ambiguous task commands clarify with buttons and task edits stay conversational", async () => {
  await withOperator(async ({ operator, taskStore, plannerStore }) => {
    const send = taskStore.createTask({ title: "Send proposal", assigneeId: "local-owner", actorId: "local-owner" });
    taskStore.createTask({ title: "Review proposal", assigneeId: "local-owner", actorId: "local-owner" });
    const ambiguous = operator.handleTaskCommand("Complete proposal");
    assert.equal(ambiguous.clarification, "task-choice");
    assert.equal(ambiguous.choices.length, 2);
    assert.equal(taskStore.listTasks({ includeDone: true }).every((task) => task.status === "open"), true);
    const selected = operator.handleTaskChoice(send.id);
    assert.equal(selected.draft.kind, "task-update");
    await operator.confirmCapture(selected.draft.id);
    assert.equal(taskStore.listTasks({ includeDone: true }).find((task) => task.id === send.id).status, "done");

    const review = taskStore.listTasks({ includeDone: true }).find((task) => task.title === "Review proposal");
    const renamePrompt = operator.startTaskRename(review.id);
    assert.equal(renamePrompt.clarification, "task-text");
    assert.equal(plannerStore.getBotSession("local-owner").step, "rename");
    const renameDraft = operator.handleSessionText("Review final proposal");
    assert.equal(renameDraft.draft.payload.updates.title, "Review final proposal");
    await operator.confirmCapture(renameDraft.draft.id);
    assert.equal(taskStore.listTasks({ includeDone: true }).find((task) => task.id === review.id).title, "Review final proposal");

    const priorityDraft = operator.prepareTaskPriority(review.id, "high");
    assert.equal(priorityDraft.draft.payload.updates.priority, "high");
    await operator.confirmCapture(priorityDraft.draft.id);
    assert.equal(taskStore.listTasks({ includeDone: true }).find((task) => task.id === review.id).priority, "high");

    const assignment = operator.startTaskAssignment(review.id);
    assert.equal(assignment.clarification, "task-member");
    assert.ok(assignment.choices.some((choice) => choice.id === "none"));
    const unassignedDraft = operator.handleTaskMember("none");
    await operator.confirmCapture(unassignedDraft.draft.id);
    assert.equal(taskStore.listTasks({ includeDone: true }).find((task) => task.id === review.id).assigneeId, null);
  });
});

test("confirmed Google events mirror into Home Court without duplicates", async () => {
  await withOperator(({ operator, plannerStore }) => {
    const payload = { title: "Client call", date: "2026-08-31", time: "15:00", durationMinutes: 45 };
    operator.recordCalendarEvent(payload, { id: "google-client-call" });
    operator.recordCalendarEvent(payload, { id: "google-client-call" });
    let events = plannerStore.listEvents({ actorId: "local-owner", from: "2026-08-31", to: "2026-08-31" });
    assert.equal(events.length, 1);
    assert.equal(events[0].durationMinutes, 45);
    assert.equal(events[0].externalId, "google-client-call");

    operator.recordCalendarUpdate({
      event: { id: "google-client-call" },
      draft: { title: "Client call", date: "2026-09-01", time: "16:00", durationMinutes: 60 }
    });
    events = plannerStore.listEvents({ actorId: "local-owner", from: "2026-09-01", to: "2026-09-01" });
    assert.equal(events[0].startsAt, "16:00");
    assert.equal(operator.recordCalendarDeletion({ event: { id: "google-client-call" } }), true);
    assert.equal(plannerStore.listEvents({ actorId: "local-owner" }).length, 0);
  });
});

test("the Sunday reset is a short guided conversation that persists its result", async () => {
  await withOperator(({ operator, plannerStore }) => {
    operator.addTask("Call the Acme lead", { dueOn: "2026-09-01" });
    assert.match(operator.startWeeklyReview(), /1\/3/);
    assert.match(operator.handleSessionText("I shipped the important work").message, /2\/3/);
    assert.match(operator.handleSessionText("Batch content earlier").message, /3\/3/);
    const saved = operator.handleSessionText("Book three useful conversations");
    assert.equal(saved.complete, true);
    assert.match(saved.message, /GAME PLAN LOCKED/);
    assert.match(saved.message, /Call the Acme lead/);
    assert.match(saved.messageHtml, /<b>🏀 GAME PLAN LOCKED<\/b>/);
    assert.equal(saved.gamePlan.primaryMove.title, "Call the Acme lead");
    assert.equal(plannerStore.getWeeklyReview("local-owner", "2026-08-24").nextFocus, "Book three useful conversations");
    assert.equal(plannerStore.getBotSession("local-owner"), null);
  });
});

test("Monday inherits the target chosen in the previous Sunday reset", async () => {
  await withOperator(({ operator, plannerStore }) => {
    plannerStore.saveWeeklyReview("local-owner", "2026-08-24", { nextFocus: "Book three useful conversations" });
    operator.addTask("Call the Acme lead", { dueOn: "2026-09-01" });
    operator.addTask("Polish button spacing", { dueOn: "2026-08-30", priority: "high" });
    const state = operator.snapshot();
    assert.equal(state.gamePlan.target, "Book three useful conversations");
    assert.equal(state.gamePlan.targetWeekStart, "2026-08-31");
    assert.equal(state.nextMoves[0].title, "Call the Acme lead");
    assert.match(operator.formatToday(), /THIS WEEK'S TARGET[\s\S]*Book three useful conversations/);
    assert.match(operator.formatTodayHtml(), /<b>🎯 THIS WEEK'S TARGET<\/b>/);
  }, { now: () => new Date("2026-08-31T06:00:00Z") });
});

test("a missed Sunday reset can still plan the current week on Monday", async () => {
  await withOperator(({ operator, plannerStore }) => {
    operator.addTask("Publish the launch website", { dueOn: "2026-09-03" });
    operator.startWeeklyReview();
    operator.handleSessionText("We shipped consistently");
    operator.handleSessionText("Too much random work");
    const saved = operator.handleSessionText("Launch the new website");
    assert.equal(saved.gamePlan.targetWeekStart, "2026-08-31");
    assert.equal(saved.gamePlan.primaryMove.title, "Publish the launch website");
    assert.equal(plannerStore.getWeeklyReview("local-owner", "2026-08-24").nextFocus, "Launch the new website");
    assert.equal(plannerStore.getWeeklyReview("local-owner", "2026-08-31"), null);
  }, { now: () => new Date("2026-08-31T06:00:00Z") });
});

test("the closeout asks whether the weekly target moved and teaches the next morning", async () => {
  await withOperator(({ operator, plannerStore }) => {
    plannerStore.saveWeeklyReview("local-owner", "2026-08-24", { nextFocus: "Book <three> & win" });
    operator.markPosted("instagram", "2026-08-31");
    operator.markPosted("linkedin", "2026-08-31");

    const prompts = operator.scheduledPrompts();
    assert.deepEqual(prompts.map((prompt) => prompt.type), ["closeout"]);
    assert.equal(prompts[0].goalCheckinPending, true);
    assert.equal(prompts[0].goalTarget, "Book <three> & win");
    assert.match(prompts[0].text, /TARGET CHECK[\s\S]*Did today move it/);
    assert.match(prompts[0].textHtml, /Book &lt;three&gt; &amp; win/);

    const moved = operator.markGoalProgress("2026-08-31", true);
    assert.equal(moved.ok, true);
    assert.equal(moved.progress.movedDays, 1);
    assert.match(moved.message, /TARGET MOVED/);
    assert.equal(plannerStore.getGoalCheckin("local-owner", "2026-08-31").movedTarget, true);
    assert.match(operator.formatToday("2026-09-01"), /Yesterday moved the target/);
    assert.match(operator.formatTodayHtml("2026-09-01"), /<code>1\/1<\/code> target days moved/);
    assert.deepEqual(operator.scheduledPrompts(), []);

    const corrected = operator.markGoalProgress("2026-08-31", false);
    assert.match(corrected.message, /motion, not progress/);
    assert.equal(plannerStore.getGoalCheckin("local-owner", "2026-08-31").movedTarget, false);
    assert.match(operator.formatToday("2026-09-01"), /Yesterday was motion, not progress/);
  }, { now: () => new Date("2026-08-31T16:30:00Z") });
});

test("the Sunday reset closes out without nagging about the hidden content plan", async () => {
  await withOperator(({ operator, plannerStore }) => {
    const prompts = operator.scheduledPrompts();
    assert.deepEqual(prompts.map((prompt) => prompt.type), ["closeout"]);
    assert.deepEqual(prompts[0].pending, []);
    assert.equal(prompts[0].weeklyDue, true);
    assert.deepEqual(prompts[0].deliveryKeys, ["closeout:2026-08-30", "weekly-reset:2026-08-24"]);
    assert.match(prompts[0].textHtml, /<b>🌙 CLOSE THE LOOP/);
    assert.match(prompts[0].textHtml, /<b>🏁 SUNDAY RESET<\/b>/);
    operator.markDelivered(prompts[0].deliveryKeys);
    assert.equal(plannerStore.hasBotDelivery("local-owner", "posting:2026-08-30"), false);
    assert.equal(plannerStore.hasBotDelivery("local-owner", "weekly-reset:2026-08-24"), true);
    assert.deepEqual(operator.scheduledPrompts(), []);
  });
});

test("the morning brief has a bounded delivery window", async () => {
  await withOperator(({ operator }) => {
    operator.addTask("Send the late proposal", { dueOn: "2026-08-29" });
    const prompts = operator.scheduledPrompts();
    assert.deepEqual(prompts.map((prompt) => prompt.type), ["morning"]);
  }, { now: () => new Date("2026-08-31T06:00:00Z") });
});

test("overdue rescue sends once and respects the owner's bot controls", async () => {
  await withOperator(({ operator, plannerStore }) => {
    operator.addTask("Send the late proposal", { dueOn: "2026-08-29" });
    assert.ok(operator.scheduledPrompts().some((prompt) => prompt.type === "overdue"));
    const overdue = operator.scheduledPrompts().find((prompt) => prompt.type === "overdue");
    operator.markDelivered(overdue.key);
    assert.equal(operator.scheduledPrompts().some((prompt) => prompt.type === "overdue"), false);
    plannerStore.setReminderSettings("local-owner", { overdueEnabled: false });
    assert.equal(plannerStore.getReminderSettings("local-owner").overdueEnabled, false);
  }, { now: () => new Date("2026-08-30T09:30:00Z") });
});

test("the closeout carries unresolved overdue work without leaking task HTML", async () => {
  await withOperator(({ operator }) => {
    operator.addTask("Review <script> & proposal", { dueOn: "2026-08-29" });
    const closeout = operator.scheduledPrompts().find((prompt) => prompt.type === "closeout");
    assert.ok(closeout);
    assert.equal(closeout.overdueCount, 1);
    assert.match(closeout.textHtml, /Review &lt;script&gt; &amp; proposal/);
    assert.doesNotMatch(closeout.textHtml, /<script\b/i);
  });
});
