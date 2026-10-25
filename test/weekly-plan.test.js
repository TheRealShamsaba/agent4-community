import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyGamePlan } from "../src/weekly-plan.js";

const TODAY = "2026-08-31";

test("a goal-aligned move outranks unrelated overdue busywork", () => {
  const plan = buildWeeklyGamePlan({
    today: TODAY,
    review: { nextFocus: "Book three useful sales conversations" },
    tasks: [
      { id: "old", title: "Fix old button spacing", dueOn: "2026-08-25", status: "open", priority: "high" },
      { id: "call", title: "Call the Acme lead", dueOn: "2026-09-02", status: "open", priority: "normal" }
    ]
  });
  assert.equal(plan.primaryMove.id, "call");
  assert.equal(plan.primaryMove.aligned, true);
  assert.equal(plan.moves[1].id, "old");
  assert.match(plan.guidance, /directly at the weekly target/);
});

test("a target with no supporting task exposes the planning gap", () => {
  const plan = buildWeeklyGamePlan({
    today: TODAY,
    review: { nextFocus: "Publish the new website" },
    tasks: [{ id: "invoice", title: "Approve August invoice", dueOn: TODAY, status: "open" }]
  });
  assert.equal(plan.needsGoalTask, true);
  assert.equal(plan.primaryMove.id, "invoice");
  assert.match(plan.guidance, /Capture the first concrete move/);
});

test("without a weekly target the plan stays honest and ranks commitments", () => {
  const plan = buildWeeklyGamePlan({
    today: TODAY,
    tasks: [
      { id: "later", title: "Write notes", dueOn: "2026-09-04", status: "open" },
      { id: "late", title: "Send proposal", dueOn: "2026-08-30", status: "open" }
    ]
  });
  assert.equal(plan.needsTarget, true);
  assert.equal(plan.primaryMove.id, "late");
  assert.match(plan.guidance, /Lock one weekly outcome/);
});
