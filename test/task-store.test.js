import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createTaskStore } from "../src/task-store.js";

async function withStore(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-tasks-"));
  const store = createTaskStore(path.join(directory, "tasks.sqlite"));
  try {
    await run(store);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const NOW = new Date("2026-08-30T00:00:00Z");

test("a task can be given to someone, and taken back", async () => {
  await withStore((store) => {
    const task = store.createTask({ title: "Chase Parsian", actorId: "alex" });
    assert.equal(task.assigneeId, null, "work starts unassigned rather than silently mine");
    assert.equal(task.status, "open");
    assert.equal(task.priority, "normal");

    const given = store.updateTask(task.id, { assigneeId: "sara" });
    assert.equal(given.assigneeId, "sara");

    const moved = store.updateTask(task.id, { assigneeId: "nima" });
    assert.equal(moved.assigneeId, "nima", "reassignment is just another edit");

    const returned = store.updateTask(task.id, { assigneeId: "" });
    assert.equal(returned.assigneeId, null, "it can go back to nobody");
  });
});

test("tasks keep explicit company and project links", async () => {
  await withStore((store) => {
    const task = store.createTask({
      title: "Send the revised homepage",
      companyId: "project",
      companyName: "SampleProject",
      projectId: "project-website",
      project: "Website redesign",
      actorId: "alex"
    });
    assert.equal(task.companyId, "project");
    assert.equal(task.companyName, "SampleProject");
    assert.equal(task.projectId, "project-website");
    assert.equal(task.project, "Website redesign");

    const moved = store.updateTask(task.id, {
      projectId: "project-campaign",
      project: "Launch campaign"
    });
    assert.equal(moved.projectId, "project-campaign");
    assert.equal(moved.companyId, "project", "moving between company projects keeps the company link");
  });
});

test("finishing stamps the time and reopening clears it", async () => {
  await withStore((store) => {
    const task = store.createTask({ title: "Write the post", actorId: "alex" });
    const done = store.updateTask(task.id, { status: "done" });
    assert.equal(done.status, "done");
    assert.ok(done.completedAt, "a finished task knows when it finished");

    const reopened = store.updateTask(task.id, { status: "open" });
    assert.equal(reopened.completedAt, null, "reopening must not leave a stale completion date");
  });
});

test("done work stays finished when it is edited again", async () => {
  await withStore((store) => {
    const task = store.createTask({ title: "Ship it", actorId: "alex" });
    const done = store.updateTask(task.id, { status: "done" });
    const renamed = store.updateTask(task.id, { title: "Ship it properly" });
    assert.equal(renamed.completedAt, done.completedAt, "editing a done task must not reset when it was done");
  });
});

test("the list puts late work first, then what is due soonest", async () => {
  await withStore((store) => {
    store.createTask({ title: "Someday", actorId: "a" });
    store.createTask({ title: "Next week", dueOn: "2026-09-06", actorId: "a" });
    store.createTask({ title: "Late", dueOn: "2026-08-20", actorId: "a" });
    store.createTask({ title: "Today", dueOn: "2026-08-30", actorId: "a" });
    store.createTask({ title: "Urgent someday", priority: "high", actorId: "a" });

    const titles = store.listTasks({ today: NOW }).map((task) => task.title);
    assert.deepEqual(titles, ["Late", "Today", "Next week", "Urgent someday", "Someday"]);
  });
});

test("done work is out of the way unless asked for", async () => {
  await withStore((store) => {
    const task = store.createTask({ title: "Finished thing", actorId: "a" });
    store.updateTask(task.id, { status: "done" });
    store.createTask({ title: "Still open", actorId: "a" });

    assert.deepEqual(store.listTasks({ today: NOW }).map((item) => item.title), ["Still open"]);
    assert.equal(store.listTasks({ today: NOW, includeDone: true }).length, 2);
    assert.equal(store.listTasks({ today: NOW, status: "done" }).length, 1);
  });
});

test("a person's list is only their own, and nobody's work is findable", async () => {
  await withStore((store) => {
    store.createTask({ title: "Sara's", assigneeId: "sara", actorId: "a" });
    store.createTask({ title: "Nima's", assigneeId: "nima", actorId: "a" });
    store.createTask({ title: "Nobody's", actorId: "a" });

    assert.deepEqual(store.listTasks({ assigneeId: "sara", today: NOW }).map((t) => t.title), ["Sara's"]);
    assert.deepEqual(store.listTasks({ assigneeId: null, today: NOW }).map((t) => t.title), ["Nobody's"]);
    assert.equal(store.listTasks({ today: NOW }).length, 3);
  });
});

test("workload shows what each person is carrying, unassigned included", async () => {
  await withStore((store) => {
    store.createTask({ title: "Late one", assigneeId: "sara", dueOn: "2026-08-20", actorId: "a" });
    store.createTask({ title: "Due today", assigneeId: "sara", dueOn: "2026-08-30", actorId: "a" });
    const doing = store.createTask({ title: "In progress", assigneeId: "sara", actorId: "a" });
    store.updateTask(doing.id, { status: "doing" });
    store.createTask({ title: "Nima's", assigneeId: "nima", actorId: "a" });
    store.createTask({ title: "Nobody has this", actorId: "a" });

    const load = store.workload({ today: NOW });
    const bySara = load.find((row) => row.assigneeId === "sara");
    assert.equal(bySara.overdue, 1);
    assert.equal(bySara.dueToday, 1);
    assert.equal(bySara.doing, 1);
    assert.equal(bySara.open, 2);
    assert.equal(load[0].assigneeId, "sara", "whoever is most behind is listed first");

    const unassigned = load.find((row) => row.assigneeId === null);
    assert.equal(unassigned.open, 1, "work nobody owns is shown, not hidden");
  });
});

test("recently finished work is counted for the week", async () => {
  await withStore((store) => {
    const task = store.createTask({ title: "Shipped", assigneeId: "sara", actorId: "a" });
    store.updateTask(task.id, { status: "done" });
    const load = store.workload({ today: new Date() });
    assert.equal(load.find((row) => row.assigneeId === "sara").done7, 1);
  });
});

test("task comments keep their author and follow the task lifecycle", async () => {
  await withStore((store) => {
    const task = store.createTask({ title: "Review launch", actorId: "alex" });
    const first = store.addComment(task.id, { body: "Waiting on the final screenshot.", actorId: "sara" });
    const second = store.addComment(task.id, { body: "I can send it today.", actorId: "nima" });

    assert.equal(first.taskId, task.id);
    assert.equal(first.createdBy, "sara");
    assert.deepEqual(store.listComments(task.id).map((comment) => comment.id), [first.id, second.id]);
    assert.throws(() => store.addComment(task.id, { body: "   " }), /cannot be empty/);

    store.removeTask(task.id);
    assert.throws(() => store.listComments(task.id), /no longer exists/, "comments cannot outlive their task");
  });
});

test("adopting a AGENT4 follow-up happens once, however often the pipeline runs", async () => {
  await withStore((store) => {
    const first = store.adopt({ title: "Follow up Example Metals", sourceKey: "agent4:example-metals:followup", assigneeId: "alex", actorId: "alex" });
    assert.equal(first.adopted, true);

    const again = store.adopt({ title: "Follow up Example Metals", sourceKey: "agent4:example-metals:followup", actorId: "alex" });
    assert.equal(again.adopted, false, "the same follow-up must not become a second task");
    assert.equal(again.task.id, first.task.id);
    assert.equal(again.task.assigneeId, "alex", "adopting again must not wipe who took it on");
    assert.equal(store.listTasks({ today: NOW }).length, 1);
  });
});

test("nonsense tasks are refused", async () => {
  await withStore((store) => {
    assert.throws(() => store.createTask({ title: "   " }), /needs a title/);
    assert.throws(() => store.createTask({ title: "x", status: "maybe" }), /open, doing or done/);
    assert.throws(() => store.createTask({ title: "x", priority: "urgent" }), /low, normal or high/);
    assert.throws(() => store.createTask({ title: "x", dueOn: "30-08-2026" }), /YYYY-MM-DD/);
    assert.throws(() => store.adopt({ title: "x" }), /key of what it came from/);
  });
});

test("tasks can be deleted", async () => {
  await withStore((store) => {
    const task = store.createTask({ title: "Mistake", actorId: "a" });
    assert.equal(store.removeTask(task.id), true);
    assert.equal(store.removeTask(task.id), false);
    assert.equal(store.listTasks({ today: NOW }).length, 0);
  });
});

test("the board's cap keeps the work that matters, and owns up to what it dropped", async () => {
  await withStore((store) => {
    for (let index = 0; index < 8; index += 1) {
      const done = store.createTask({ title: `Finished ${index}`, actorId: "a" });
      store.updateTask(done.id, { status: "done" });
    }
    store.createTask({ title: "Late one", dueOn: "2026-08-20", actorId: "a" });
    store.createTask({ title: "Due soon", dueOn: "2026-09-02", actorId: "a" });
    store.createTask({ title: "No date", actorId: "a" });

    const board = store.queryTasks({ today: NOW, includeDone: true, limit: 3 });
    assert.deepEqual(
      board.tasks.map((task) => task.title),
      ["Late one", "Due soon", "No date"],
      "open work first and soonest due first, so the cap never spends itself on finished tasks"
    );
    assert.equal(board.total, 11, "the board can say how much there really is");
    assert.equal(board.truncated, true);

    const whole = store.queryTasks({ today: NOW, includeDone: true });
    assert.equal(whole.truncated, false);
    assert.equal(whole.tasks.length, 11);
    assert.equal(whole.tasks.at(-1).status, "done", "finished work sits at the bottom, not in the way");

    const openOnly = store.queryTasks({ today: NOW });
    assert.equal(openOnly.total, 3);
    assert.equal(openOnly.truncated, false);
  });
});

test("finished work older than the window stays out of the board's way", async () => {
  await withStore((store) => {
    const old = store.createTask({ title: "Done last season", actorId: "a" });
    store.updateTask(old.id, { status: "done" });
    store.createTask({ title: "Still open", actorId: "a" });

    const future = new Date("2027-03-01T09:00:00Z");
    assert.deepEqual(store.queryTasks({ today: future, includeDone: true }).tasks.map((task) => task.title), ["Still open"]);
    assert.equal(store.queryTasks({ today: future, includeDone: true }).total, 1);
    assert.equal(store.queryTasks({ today: future, includeDone: true, doneWithinDays: null }).total, 2, "asking for all of it still works");
    assert.equal(store.listTasks({ today: future, includeDone: true }).length, 2, "the plain list keeps the whole history for lookups by id");
  });
});

test("today is the server's own day, so a late-evening board is not tomorrow's", async () => {
  await withStore((store) => {
    const previous = process.env.TZ;
    process.env.TZ = "Europe/Istanbul";
    try {
      store.createTask({ title: "Due tonight", assigneeId: "alex", dueOn: "2026-09-15", actorId: "a" });
      // Half past one in the morning in Istanbul: UTC still calls this the 14th.
      const [carrying] = store.workload({ today: new Date("2026-09-14T22:30:00Z") });
      assert.equal(carrying.dueToday, 1, "the owner's own calendar day decides what is due today");
      assert.equal(carrying.overdue, 0);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
