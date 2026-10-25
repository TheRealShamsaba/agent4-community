import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkspaceStore } from "../src/workspace-store.js";

/** Returns the refusal itself, so a test can read what the screen would be handed. */
function refusal(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("That was accepted when it should have been refused.");
}

test("company workspaces keep durable projects without duplicating names", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent4-workspaces-"));
  const store = createWorkspaceStore(path.join(root, "hq.sqlite"));
  t.after(() => store.close());

  const company = store.ensureCompany({ id: "project", name: "SampleProject", website: "https://project.example", actorId: "owner" });
  const first = store.createProject({
    companyId: company.id,
    companyName: company.name,
    name: "Website redesign",
    summary: "Ship the new website",
    goal: "Make the product easy to understand",
    ownerId: "owner",
    ownerName: "Alex",
    dueOn: "2026-09-30",
    milestone: "Approve the homepage",
    milestoneDueOn: "2026-09-10",
    repositoryUrl: "example/project",
    repositoryBranch: "main",
    actorId: "owner"
  });
  assert.equal(first.created, true);
  assert.throws(
    () => store.createProject({ companyId: company.id, companyName: company.name, name: "website redesign", actorId: "owner" }),
    /already has a project with that name/
  );
  assert.deepEqual(store.list().companies.map((item) => item.name), ["SampleProject"]);
  assert.equal(store.list().projects[0].summary, "Ship the new website");
  assert.equal(store.list().projects[0].goal, "Make the product easy to understand");
  assert.equal(store.list().projects[0].ownerName, "Alex");
  assert.equal(store.list().projects[0].repositoryUrl, "https://github.com/example/project");
  assert.equal(store.getProject(first.project.id).repositoryBranch, "main");

  const decision = store.addDecision({ projectId: first.project.id, text: "Use the lighter homepage direction", actorId: "owner" });
  const resource = store.addResource({ projectId: first.project.id, label: "Figma", url: "https://figma.com/file/demo#screen", kind: "design", actorId: "owner" });
  assert.equal(store.list().decisions[0].text, "Use the lighter homepage direction");
  assert.equal(store.list().resources[0].url, "https://figma.com/file/demo");

  const updated = store.updateProject(first.project.id, { status: "done", health: "at_risk", summary: "Launched", definitionOfDone: "Client accepted the live site", repositoryBranch: "release/v1" });
  assert.equal(updated.status, "done");
  assert.equal(updated.health, "at_risk");
  assert.equal(updated.summary, "Launched");
  assert.equal(updated.definitionOfDone, "Client accepted the live site");
  assert.equal(updated.repositoryBranch, "release/v1");
  assert.equal(store.removeDecision(decision.id), true);
  assert.equal(store.removeResource(resource.id), true);
  assert.equal(store.list().decisions.length, 0);
  assert.equal(store.list().resources.length, 0);
});

test("sheets belong to a company, merge answers key by key, and can move between projects", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent4-sheets-"));
  const store = createWorkspaceStore(path.join(root, "hq.sqlite"));
  t.after(() => store.close());

  const company = store.ensureCompany({ id: "holding", name: "Herbal Holding", actorId: "owner" });
  const { project } = store.createProject({ companyId: company.id, companyName: company.name, name: "New company website", actorId: "owner" });
  const other = store.ensureCompany({ id: "project", name: "SampleProject", actorId: "owner" });
  const { project: foreign } = store.createProject({ companyId: other.id, companyName: other.name, name: "Website", actorId: "owner" });

  const sheet = store.createSheet({ companyId: company.id, companyName: company.name, templateId: "website-discovery", title: "Discovery — Tuesday", actorId: "owner" });
  assert.equal(sheet.status, "open");
  assert.equal(sheet.projectId, null);
  assert.deepEqual(sheet.answers, {});

  const phone = store.updateSheet(sheet.id, { answers: { c1: "Sana Herbal Co.", c4: "Launch in Aban" }, actorId: "phone" });
  const laptop = store.updateSheet(sheet.id, { answers: { f2: "About 40% deposit" }, checks: { p1: true, p2: "true" }, actorId: "laptop" });
  assert.deepEqual(laptop.answers, { c1: "Sana Herbal Co.", c4: "Launch in Aban", f2: "About 40% deposit" }, "different devices never overwrite each other's keys");
  assert.deepEqual(laptop.checks, { p1: true, p2: true });
  assert.equal(phone.updatedBy, "phone");
  assert.equal(laptop.updatedBy, "laptop");

  const cleared = store.updateSheet(sheet.id, { answers: { c4: "" }, checks: { p2: false } });
  assert.deepEqual(cleared.answers, { c1: "Sana Herbal Co.", f2: "About 40% deposit" }, "an empty answer removes the key");
  assert.deepEqual(cleared.checks, { p1: true });

  const moved = store.updateSheet(sheet.id, { projectId: project.id, status: "complete", title: "Discovery — done" });
  assert.equal(moved.projectId, project.id);
  assert.equal(moved.status, "complete");
  assert.equal(moved.title, "Discovery — done");
  assert.equal(store.updateSheet(sheet.id, { projectId: "" }).projectId, null);

  assert.throws(() => store.updateSheet(sheet.id, { projectId: foreign.id }), /different company/);
  assert.throws(() => store.updateSheet(sheet.id, { status: "archived" }), /open or complete/);
  assert.throws(() => store.updateSheet(sheet.id, { answers: ["nope"] }), /object/);
  assert.throws(() => store.updateSheet(sheet.id, { answers: { "bad key!": "x" } }), /identifiers/);
  assert.throws(() => store.createSheet({ companyId: company.id, companyName: company.name, templateId: "Bad Template", title: "x" }), /template/);
  assert.throws(() => store.createSheet({ companyId: company.id, companyName: company.name, templateId: "website-discovery", title: "" }), /title/);

  const listed = store.list().sheets;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].companyName, "Herbal Holding");
  assert.equal(store.getSheet(sheet.id).answers.c1, "Sana Herbal Co.");
  assert.equal(store.removeSheet(sheet.id), true);
  assert.equal(store.removeSheet(sheet.id), false);
  assert.equal(store.list().sheets.length, 0);
});

test("a deal's worth is a whole number in its own currency, never a bare number", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent4-deals-"));
  const store = createWorkspaceStore(path.join(root, "hq.sqlite"));
  t.after(() => store.close());

  const fresh = store.ensureCompany({ id: "acme", name: "Acme", actorId: "owner" });
  assert.equal(fresh.dealValue, null);
  assert.equal(fresh.dealCurrency, "");

  const priced = store.updateCompany("acme", { dealValue: 12000, dealCurrency: "usd" });
  assert.equal(priced.dealValue, 12000);
  assert.equal(priced.dealCurrency, "USD");
  assert.equal(store.updateCompany("acme", { nextAction: "Call" }).dealValue, 12000, "an unrelated edit keeps the deal");
  assert.equal(store.list().companies[0].dealValue, 12000);

  assert.throws(() => store.updateCompany("acme", { dealValue: 1.5 }), /whole number/);
  assert.throws(() => store.updateCompany("acme", { dealValue: -3 }), /whole number/);
  assert.throws(() => store.updateCompany("acme", { dealCurrency: "dollars" }), /three-letter/);

  const cleared = store.updateCompany("acme", { dealValue: null });
  assert.equal(cleared.dealValue, null);
  assert.equal(cleared.dealCurrency, "", "a deal with no value forgets its currency");

  assert.throws(() => store.updateCompany("acme", { dealValue: 500 }), /currency/, "a value with no currency is refused");
  const born = store.ensureCompany({ id: "born", name: "Born priced", dealValue: 900000000, dealCurrency: "IRR", actorId: "owner" });
  assert.equal(born.dealValue, 900000000);
  assert.equal(born.dealCurrency, "IRR");
});

test("companies carry relationship fields the team maintains by hand", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent4-companies-"));
  const store = createWorkspaceStore(path.join(root, "hq.sqlite"));
  t.after(() => store.close());

  const created = store.ensureCompany({ id: "sampleStudio", name: "Sample Studio", kind: "client", stage: "talking", contactTelegram: "https://t.me/someone", actorId: "owner" });
  assert.equal(created.kind, "client");
  assert.equal(created.stage, "talking");
  assert.equal(created.contactTelegram, "@someone");
  assert.equal(created.hidden, false);

  const legacy = store.ensureCompany({ id: "name:project", name: "SampleProject", actorId: "owner" });
  assert.equal(legacy.kind, "client", "companies without a kind default to client");
  assert.equal(legacy.stage, "lead");

  const updated = store.updateCompany("sampleStudio", {
    stage: "proposal",
    contactName: "Marketing lead",
    contactRole: "Marketing",
    contactPhone: "+90 555 000 0000",
    contactEmail: "team@sampleStudio.example",
    howMet: "Introduced through my father; first meeting turned a website request into a group app idea.",
    nextAction: "Send the website proposal",
    nextActionOn: "2026-09-17"
  });
  assert.equal(updated.stage, "proposal");
  assert.equal(updated.contactName, "Marketing lead");
  assert.equal(updated.nextActionOn, "2026-09-17");
  assert.equal(updated.contactEmail, "team@sampleStudio.example");
  assert.match(updated.howMet, /father/);

  assert.equal(store.completeNextActionForTask({ companyId: "sampleStudio", title: "A different task" }), null);
  const completedNext = store.completeNextActionForTask({ companyId: "sampleStudio", title: "Send the website proposal" });
  assert.equal(completedNext.nextAction, "");
  assert.equal(completedNext.nextActionOn, null);

  store.createProject({ companyId: "sampleStudio", companyName: "Sample Studio", name: "New company website", actorId: "owner" });
  const sheet = store.createSheet({ companyId: "sampleStudio", companyName: "Sample Studio", templateId: "website-discovery", title: "Discovery", actorId: "owner" });
  const renamed = store.updateCompany("sampleStudio", { name: "Sample Studio Group", hidden: true, nextAction: "" });
  assert.equal(renamed.name, "Sample Studio Group");
  assert.equal(renamed.hidden, true);
  assert.equal(renamed.nextAction, "");
  assert.equal(store.list().projects[0].companyName, "Sample Studio Group", "renames follow through to projects");
  assert.equal(store.getSheet(sheet.id).companyName, "Sample Studio Group", "renames follow through to sheets");

  assert.throws(() => store.updateCompany("sampleStudio", { kind: "friend" }), /kind/);
  assert.throws(() => store.updateCompany("sampleStudio", { stage: "won" }), /stage/);
  assert.throws(() => store.updateCompany("sampleStudio", { contactEmail: "not-an-email" }), /email/);
  assert.throws(() => store.updateCompany("sampleStudio", { name: "SampleProject" }), /already uses/);
  assert.throws(() => store.updateCompany("missing", { name: "x" }), /no longer exists/);
});

test("a name already on file is a clash the screen can act on, not a silent no-op", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent4-clashes-"));
  const store = createWorkspaceStore(path.join(root, "hq.sqlite"));
  t.after(() => store.close());

  const first = store.createCompany({ name: "Sample Studio", kind: "client", actorId: "owner" });
  assert.equal(first.name, "Sample Studio");

  const clash = refusal(() => store.createCompany({ name: "sample studio", summary: "Everything the owner just typed", actorId: "owner" }));
  assert.match(clash.message, /Another company already uses that name/);
  assert.equal(clash.code, "company_name_taken");
  assert.equal(clash.companyId, first.id, "the screen can offer to open the company that is already there");
  assert.equal(store.getCompany(first.id).summary, "", "a refused creation must not half-apply either");
  assert.throws(() => store.createCompany({ id: first.id, name: "Something else", actorId: "owner" }), /already exists/);

  // Importing a company that may already be on file still means get-or-create.
  const imported = store.ensureCompany({ name: "SAMPLE STUDIO", actorId: "pipeline" });
  assert.equal(imported.id, first.id, "the pipeline asks for the company to exist, not for a new one");

  const project = store.createProject({ companyId: first.id, companyName: first.name, name: "Website", actorId: "owner" });
  const projectClash = refusal(() => store.createProject({ companyId: first.id, companyName: first.name, name: "website", goal: "Typed again", actorId: "owner" }));
  assert.match(projectClash.message, /already has a project with that name/);
  assert.equal(projectClash.code, "project_name_taken");
  assert.equal(projectClash.projectId, project.project.id);
  assert.equal(store.list().projects.length, 1);
});

test("a company or project can be deleted, and says what goes with it first", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent4-removals-"));
  const store = createWorkspaceStore(path.join(root, "hq.sqlite"));
  t.after(() => store.close());

  const company = store.createCompany({ name: "Typo Co", actorId: "owner" });
  const { project } = store.createProject({ companyId: company.id, companyName: company.name, name: "Website", actorId: "owner" });
  store.addDecision({ projectId: project.id, text: "Use the lighter direction", actorId: "owner" });
  store.addResource({ projectId: project.id, label: "Figma", url: "https://figma.com/file/demo", kind: "design", actorId: "owner" });
  const sheet = store.createSheet({
    companyId: company.id, companyName: company.name, projectId: project.id,
    templateId: "website-discovery", title: "Discovery", actorId: "owner"
  });

  const preview = store.removeProject(project.id);
  assert.equal(preview.removed, false, "nothing goes until somebody says so");
  assert.deepEqual(preview.attached, { decisions: 1, resources: 1, sheets: 1, tasks: 0 });
  assert.equal(store.list().projects.length, 1);

  const removedProject = store.removeProject(project.id, { confirm: true });
  assert.equal(removedProject.removed, true);
  assert.equal(store.getProject(project.id), null);
  assert.equal(store.list().decisions.length, 0, "a decision cannot outlive the project it was taken on");
  assert.equal(store.list().resources.length, 0);
  assert.equal(store.getSheet(sheet.id).projectId, null, "the sheet was filled in for the company, so it stays");

  store.createProject({ companyId: company.id, companyName: company.name, name: "Second try", actorId: "owner" });
  const companyPreview = store.removeCompany(company.id);
  assert.equal(companyPreview.removed, false);
  assert.deepEqual(companyPreview.attached, { projects: 1, sheets: 1, decisions: 0, resources: 0, events: 0, meetings: 0, tasks: 0, paperwork: 0 });

  const removedCompany = store.removeCompany(company.id, { confirm: true });
  assert.equal(removedCompany.removed, true);
  assert.equal(removedCompany.company.name, "Typo Co");
  assert.equal(store.getCompany(company.id), null);
  assert.deepEqual(store.list().companies, []);
  assert.deepEqual(store.list().projects, [], "no project is left pointing at a company that is gone");
  assert.deepEqual(store.list().sheets, []);
  assert.throws(() => store.removeCompany(company.id, { confirm: true }), /no longer exists/);
  assert.throws(() => store.removeProject(project.id, { confirm: true }), /no longer exists/);
});

test("a company keeps its own dated history, and loses it with the company", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent4-company-events-"));
  const store = createWorkspaceStore(path.join(root, "hq.sqlite"));
  t.after(() => store.close());

  const company = store.createCompany({ name: "Sample Studio", stage: "lead", actorId: "owner" });
  const other = store.createCompany({ name: "SampleProject", actorId: "owner" });

  const moved = store.addCompanyEvent({ companyId: company.id, type: "stage", detail: "Lead → Proposal sent", actorId: "owner" });
  assert.equal(moved.companyId, company.id);
  assert.equal(moved.type, "stage");
  assert.equal(moved.detail, "Lead → Proposal sent");
  assert.equal(moved.createdBy, "owner");
  assert.match(moved.at, /^\d{4}-\d{2}-\d{2}T/, "an event is dated so a stage can be asked how long it has been there");

  store.addCompanyEvent({ companyId: company.id, type: "MEETING", detail: "Sat down with their marketing lead", actorId: "owner" });
  store.addCompanyEvent({ companyId: other.id, type: "money", detail: "First invoice paid", actorId: "owner" });

  const listed = store.list().companies;
  const sampleStudio = listed.find((item) => item.id === company.id);
  const project = listed.find((item) => item.id === other.id);
  assert.equal(sampleStudio.timeline.length, 2, "history rides along on the company it belongs to");
  assert.equal(project.timeline.length, 1, "and does not leak onto the company next to it");
  assert.equal(sampleStudio.timeline[0].detail, "Sat down with their marketing lead", "newest first, the way the page reads it");
  assert.equal(sampleStudio.timeline[0].type, "meeting", "the type is a slug however it was typed");
  assert.deepEqual(Object.keys(sampleStudio.timeline[0]).sort(), ["at", "companyId", "createdBy", "detail", "id", "type"]);

  const unknown = store.addCompanyEvent({ companyId: company.id, detail: "Nothing in particular", actorId: "owner" });
  assert.equal(unknown.type, "note", "an event without a type is a note");
  const long = store.addCompanyEvent({ companyId: company.id, type: "note", detail: "x".repeat(900), actorId: "owner" });
  assert.equal(long.detail.length, 500, "one sentence, not a document");
  assert.equal(store.addCompanyEvent({ companyId: company.id, type: "s".repeat(90), detail: "Bounded", actorId: "owner" }).type.length, 40);

  assert.throws(() => store.addCompanyEvent({ companyId: company.id, type: "stage", detail: "  ", actorId: "owner" }), /Write what happened/);
  assert.throws(() => store.addCompanyEvent({ companyId: company.id, type: "stage change!", detail: "Moved", actorId: "owner" }), /short slug/);
  assert.throws(() => store.addCompanyEvent({ companyId: "nobody", type: "note", detail: "Moved", actorId: "owner" }), /no longer exists/);

  assert.equal(store.removeCompanyEvent(moved.id), true, "a mistyped line can be taken back");
  assert.equal(store.removeCompanyEvent(moved.id), false);
  assert.equal(store.list().companies.find((item) => item.id === company.id).timeline.length, 4);

  const preview = store.removeCompany(company.id);
  assert.equal(preview.removed, false);
  assert.equal(preview.attached.events, 4, "the confirm dialog says how much history would go with it");
  const removed = store.removeCompany(company.id, { confirm: true });
  assert.equal(removed.removed, true);
  assert.deepEqual(store.list().companies.map((item) => item.timeline.length), [1], "only the other company's history is left");
});
