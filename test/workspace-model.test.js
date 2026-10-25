import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceModel, projectNextMoves, workspaceMention } from "../hq/src/workspace-model.js";

test("workspace model joins pipeline, meeting, task and room context", () => {
  const [company] = buildWorkspaceModel({
    dossiers: [{ id: "project", name: "SampleProject", stage: "meeting", timeline: [] }],
    stored: {
      projects: [{ id: "website", companyId: "project", companyName: "SampleProject", name: "Website", status: "active" }],
      decisions: [{ id: "decision-1", projectId: "website", companyId: "project", text: "Lead with proof", source: "manual", createdAt: "2026-08-29T10:00:00Z" }],
      resources: [{ id: "resource-1", projectId: "website", companyId: "project", label: "Figma", url: "https://figma.com", kind: "design", createdAt: "2026-08-29T10:00:00Z" }]
    },
    memories: [{ clientId: "project", clientName: "SampleProject", projects: ["Website"], meetings: [{ id: "meeting-1", title: "Kickoff", projectName: "Website", decisions: ["Use the new logo"], actionItems: [{ text: "Send the sitemap", taskId: null }], createdAt: "2026-08-30T10:00:00Z" }] }],
    tasks: [{ id: "task-1", title: "Send homepage", companyId: "project", companyName: "SampleProject", projectId: "website", project: "Website", status: "open" }],
    roomObjects: [{ id: "room-1", title: "Homepage notes", companyId: "project", companyName: "SampleProject", projectId: "website", projectName: "Website", type: "doc" }]
  });

  assert.equal(company.name, "SampleProject");
  assert.equal(company.tasks.length, 1);
  assert.equal(company.meetings.length, 1);
  assert.equal(company.roomItems.length, 1);
  assert.equal(company.projects.length, 1, "the same named project is merged across sources");
  assert.equal(company.projects[0].tasks[0].id, "task-1");
  assert.equal(company.projects[0].meetings[0].id, "meeting-1");
  assert.equal(company.projects[0].roomItems[0].id, "room-1");
  assert.deepEqual(company.projects[0].decisions.map((item) => item.text), ["Use the new logo", "Lead with proof"]);
  assert.equal(company.projects[0].resources[0].label, "Figma");
  assert.equal(workspaceMention(company, company.projects[0]), "@SampleProject/Website");
});

test("an old loose task joins only when its project has one unambiguous company", () => {
  const companies = buildWorkspaceModel({
    stored: {
      companies: [{ id: "project", name: "SampleProject" }],
      projects: [{ id: "website", companyId: "project", companyName: "SampleProject", name: "Website", status: "active" }]
    },
    tasks: [{ id: "legacy", title: "Review design", project: "Website", status: "open" }]
  });
  assert.equal(companies[0].tasks[0].id, "legacy");
});

test("project next moves rank real urgent work, meeting commitments, then setup gaps", () => {
  const moves = projectNextMoves({
    status: "active",
    goal: "Ship the site",
    definitionOfDone: "Client approved production",
    milestone: "",
    dueOn: "2026-09-10",
    tasks: [
      { id: "later", title: "Polish animations", status: "open", priority: "normal", dueOn: "2026-09-08" },
      { id: "late", title: "Send homepage", status: "open", priority: "high", dueOn: "2026-08-31" }
    ],
    meetings: [{ id: "meeting", title: "Review", actionItems: [{ text: "Confirm the mobile menu", taskId: null }], createdAt: "2026-09-01T08:00:00Z" }]
  }, { today: "2026-09-01" });

  assert.deepEqual(moves.map((move) => move.title), ["Send homepage", "Confirm the mobile menu", "Polish animations"]);
  assert.equal(moves[0].reason, "1d overdue");
});

test("sheets attach to their company and, when linked, to the project", () => {
  const [company] = buildWorkspaceModel({
    stored: {
      companies: [{ id: "holding", name: "Herbal Holding" }],
      projects: [{ id: "site", companyId: "holding", companyName: "Herbal Holding", name: "New company website", status: "active" }],
      sheets: [
        { id: "sheet-company", companyId: "holding", companyName: "Herbal Holding", projectId: null, templateId: "website-discovery", title: "Company discovery", status: "complete", answers: {}, checks: {}, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-02T10:00:00Z" },
        { id: "sheet-project", companyId: "holding", companyName: "Herbal Holding", projectId: "site", templateId: "website-discovery", title: "Tuesday meeting", status: "open", answers: { c1: "Sana" }, checks: {}, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T12:00:00Z" }
      ]
    }
  });

  assert.deepEqual(company.sheets.map((sheet) => sheet.id), ["sheet-project", "sheet-company"], "open sheets come first, then most recently edited");
  assert.deepEqual(company.projects[0].sheets.map((sheet) => sheet.id), ["sheet-project"]);
});

test("companies get a kind, a stage, a last touch and a next step", () => {
  const companies = buildWorkspaceModel({
    // Pinned: the order puts overdue commitments first, so the real date would
    // slowly turn these September fixtures into a different expected order.
    today: "2026-09-14",
    dossiers: [
      { id: "example-metals", name: "Example Metals", stage: "new", timeline: [{ type: "note", detail: "Audited", at: "2026-09-02T09:00:00Z" }] },
      { id: "project", name: "SampleProject", stage: "meeting", timeline: [] }
    ],
    stored: {
      companies: [
        { id: "project", name: "SampleProject", kind: "client", stage: "operating", nextAction: "Ask for the testimonial", nextActionOn: "2099-09-20", updatedAt: "2026-09-10T10:00:00Z" },
        { id: "sampleStudio", name: "Sample Studio", kind: "client", stage: "talking", hidden: false, createdAt: "2026-09-12T20:00:00Z" },
        { id: "sandbox", name: "Local Model Verification", kind: "internal", stage: "lead", hidden: true, createdAt: "2026-08-01T10:00:00Z" }
      ],
      projects: [{ id: "site", companyId: "sampleStudio", companyName: "Sample Studio", name: "New company website", status: "active", createdAt: "2026-09-12T21:00:00Z" }]
    },
    tasks: [{ id: "t1", title: "Send proposal", companyId: "sampleStudio", companyName: "Sample Studio", status: "open", dueOn: "2099-09-17" }]
  });

  const byName = Object.fromEntries(companies.map((company) => [company.name, company]));
  assert.equal(byName["Example Metals"].kind, "prospect", "pipeline-only companies are prospects");
  assert.equal(byName["Example Metals"].stage, "lead");
  assert.equal(byName["Example Metals"].stored, false);
  assert.equal(byName["Example Metals"].lastTouch, "2026-09-02T09:00:00Z");
  assert.equal(byName.SampleProject.kind, "client", "a stored kind wins over the pipeline default");
  assert.equal(byName.SampleProject.stage, "operating");
  // A next step the owner wrote by hand is never "borrowed": the borrowed flag
  // marks the fallback where the model stands an open task in for a real
  // commitment, so the page can say so instead of pretending one was written.
  assert.deepEqual(byName.SampleProject.next, { kind: "action", title: "Ask for the testimonial", dueOn: "2099-09-20", borrowed: false });
  assert.equal(byName["Sample Studio"].next.kind, "task", "without a written next action the most urgent open task stands in");
  assert.equal(byName["Sample Studio"].next.title, "Send proposal");
  assert.equal(byName["Sample Studio"].lastTouch, "2026-09-12T21:00:00Z");
  assert.equal(byName["Local Model Verification"].hidden, true);
  assert.deepEqual(companies.map((company) => company.name), ["SampleProject", "Sample Studio", "Example Metals", "Local Model Verification"], "clients first, ordered by stage, then prospects, then internal");
});

test("a completed linked task retires the duplicate company next action", () => {
  const [company] = buildWorkspaceModel({
    stored: {
      companies: [{ id: "project", name: "SampleProject", kind: "client", stage: "active", nextAction: "Send the update", nextActionOn: "2026-09-15" }]
    },
    tasks: [
      { id: "finished", title: "Send the update", companyId: "project", status: "done", dueOn: "2026-09-15" },
      { id: "next", title: "Book the review", companyId: "project", status: "open", dueOn: "2026-09-18" }
    ]
  });

  assert.equal(company.next.title, "Book the review");
  assert.equal(company.next.kind, "task");
  assert.equal(company.next.borrowed, true);
});

test("a company whose next step is overdue comes first, whatever its stage", () => {
  const stored = {
    companies: [
      { id: "calm", name: "Calm Co", kind: "client", stage: "active", nextAction: "Send the update", nextActionOn: "2026-10-20" },
      { id: "late", name: "Late Co", kind: "client", stage: "talking", nextAction: "Reply to the proposal", nextActionOn: "2026-10-01" }
    ]
  };

  const order = (today) => buildWorkspaceModel({ stored, today }).map((company) => company.name);

  assert.deepEqual(order("2026-10-07"), ["Late Co", "Calm Co"], "six days overdue outranks a better stage");
  assert.deepEqual(order("2026-09-25"), ["Calm Co", "Late Co"], "before the date passes, the stage order holds");
});
