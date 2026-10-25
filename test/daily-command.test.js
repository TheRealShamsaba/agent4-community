import assert from "node:assert/strict";
import test from "node:test";
import { buildClientRoster, buildDailyCommand } from "../hq/src/daily-command.js";

const TODAY = "2026-08-31";

test("daily command favors a near calendar commitment", () => {
  const command = buildDailyCommand({
    today: TODAY,
    nowMinutes: (9 * 60) + 10,
    actorId: "owner",
    tasks: [{ id: "task-1", title: "Ship the website", assigneeId: "owner", status: "open", dueOn: TODAY }],
    events: [{ id: "event-1", title: "SampleProject presentation", startsOn: TODAY, startsAt: "10:00" }]
  });
  assert.equal(command.source, "calendar");
  assert.equal(command.title, "Prepare for SampleProject presentation");
});

test("daily command protects an overdue client follow-up before strategy", () => {
  const command = buildDailyCommand({
    today: TODAY,
    actorId: "owner",
    tasks: [{ id: "goal-task", title: "Publish the launch", assigneeId: "owner", status: "open" }],
    gamePlan: { target: "Launch the website", primaryMove: { id: "goal-task" } },
    clientMemories: [{
      clientName: "SampleProject",
      nextFollowUpOn: "2026-08-30",
      meetings: [{ id: "meeting-1", actionItems: [{ text: "Send the approved examples" }] }]
    }]
  });
  assert.equal(command.source, "client");
  assert.equal(command.title, "Send the approved examples");
  assert.equal(command.stats.clientsDue, 1);
});

test("daily command uses the weekly target before unrelated overdue busywork", () => {
  const command = buildDailyCommand({
    today: TODAY,
    actorId: "owner",
    tasks: [
      { id: "goal-task", title: "Call three prospects", assigneeId: "owner", status: "open" },
      { id: "late-task", title: "Rename an old folder", assigneeId: "owner", status: "open", dueOn: "2026-08-28" }
    ],
    gamePlan: { target: "Book three useful conversations", primaryMove: { id: "goal-task" } }
  });
  assert.equal(command.source, "goal");
  assert.equal(command.title, "Call three prospects");
  assert.equal(command.stats.overdue, 1);
});

test("daily command can pull an unscheduled next move from client memory", () => {
  const command = buildDailyCommand({
    today: TODAY,
    actorId: "owner",
    clientMemories: [{
      clientName: "SampleProject",
      meetings: [{ id: "meeting-1", actionItems: [{ text: "Send successful Iranian website examples" }] }]
    }]
  });
  assert.equal(command.source, "client");
  assert.equal(command.action, "film");
  assert.equal(command.stats.clientsOpen, 1);
  assert.match(command.reason, /latest SampleProject meeting/);
});

test("daily command exposes the direction gap when nothing is planned", () => {
  const command = buildDailyCommand({ today: TODAY, actorId: "owner" });
  assert.equal(command.source, "goal");
  assert.equal(command.action, "plan");
  assert.match(command.title, /one outcome/);
});

test("home client roster advances when its matching task is done", () => {
  const [row] = buildClientRoster({
    today: TODAY,
    companies: [{ id: "project", name: "SampleProject", kind: "client", stage: "active", nextAction: "Send the update", nextActionOn: "2026-08-30" }],
    tasks: [
      { id: "done", title: "Send the update", companyId: "project", status: "done", dueOn: "2026-08-30" },
      { id: "next", title: "Book the review", companyId: "project", status: "open", dueOn: "2026-09-02" }
    ]
  });

  assert.equal(row.nextStep, "Book the review");
  assert.equal(row.dueOn, "2026-09-02");
  assert.equal(row.hasTask, true);
});
