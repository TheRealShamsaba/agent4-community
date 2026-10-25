import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createPaperworkStore } from "../src/paperwork-store.js";
import { createWorkspaceStore } from "../src/workspace-store.js";

async function withStore(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-paperwork-"));
  const databasePath = path.join(directory, "hq.sqlite");
  const paperwork = createPaperworkStore(databasePath);
  try {
    await run({ paperwork, databasePath });
  } finally {
    paperwork.close();
    await rm(directory, { recursive: true, force: true });
  }
}

/** The two stores the server runs, sharing one file, so a company link can be checked. */
async function withWorkspace(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-paperwork-company-"));
  const databasePath = path.join(directory, "hq.sqlite");
  const workspace = createWorkspaceStore(databasePath);
  const paperwork = createPaperworkStore(databasePath, { workspace });
  try {
    await run({ paperwork, workspace, databasePath });
  } finally {
    paperwork.close();
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const proposal = {
  type: "proposal",
  numberPrefix: "PR",
  title: "Landing page rebuild",
  language: "fa",
  actorId: "owner-1",
  values: { scope: "One page, two rounds", price: "180,000,000" }
};

test("a document keeps its answers, not a printed page", async () => {
  await withStore(({ paperwork }) => {
    const document = paperwork.createDocument(proposal);
    assert.equal(document.type, "proposal");
    assert.equal(document.status, "draft");
    assert.equal(document.language, "fa");
    assert.equal(document.title, "Landing page rebuild");
    assert.deepEqual(document.values, { scope: "One page, two rounds", price: "180,000,000" });
    assert.match(document.number, /^PR-\d{4}-001$/);
    assert.equal(document.sentOn, null);
    assert.equal(document.signedOn, null);
    assert.equal(document.createdBy, "owner-1");
    assert.deepEqual(paperwork.getDocument(document.id), document);
  });
});

test("a document type is checked for shape, not against a list the front end owns", async () => {
  await withStore(({ paperwork }) => {
    for (const type of ["proposal", "scope", "update", "receipt", "referral", "case-study", "nda", "kickoff"]) {
      assert.equal(paperwork.createDocument({ ...proposal, type }).type, type);
    }
    // The eighth kind is not the last kind: a template the client learns to
    // draw next year must not need this store edited to be saved.
    assert.equal(paperwork.createDocument({ ...proposal, type: "retainer-2027" }).type, "retainer-2027");
    assert.throws(() => paperwork.createDocument({ ...proposal, type: "" }), /Choose a document type/);
    assert.throws(() => paperwork.createDocument({ ...proposal, type: "Proposal Letter" }), /Choose a document type/);
    assert.throws(() => paperwork.createDocument({ ...proposal, title: "  " }), /Give the document a title/);
    assert.throws(() => paperwork.createDocument({ ...proposal, language: "tr" }), /Language must be fa or en/);
  });
});

test("document numbers run in sequence per prefix per year, and keep counting past 999", async () => {
  await withStore(({ paperwork, databasePath }) => {
    const first = paperwork.createDocument(proposal);
    const second = paperwork.createDocument(proposal);
    const year = first.number.split("-")[1];
    assert.equal(second.number, `PR-${year}-002`);

    // Each type is filed under its own letters, so a scope agreement does not
    // take a number off the proposals.
    assert.equal(paperwork.createDocument({ ...proposal, type: "scope", numberPrefix: "SC" }).number, `SC-${year}-001`);

    // Sorted as text, PR-2026-1000 falls below PR-2026-999, and the next
    // proposal is handed a number a client has already been sent. The rows are
    // written straight in rather than one at a time, because the point is the
    // sort and not the thousand inserts.
    const database = new DatabaseSync(databasePath);
    const insert = database.prepare(`
      INSERT INTO agent4_paperwork (id,number,type,company_id,company_name,project_id,language,title,status,"values",created_at,created_by)
      VALUES (?,?,'proposal',NULL,'','','en','Bulk','draft','{}',?,'owner-1')
    `);
    for (let index = 3; index <= 1000; index += 1) {
      insert.run(`seed-${index}`, `PR-${year}-${String(index).padStart(3, "0")}`, new Date().toISOString());
    }
    database.close();

    assert.equal(paperwork.nextNumber("proposal", { prefix: "PR" }), `PR-${year}-1001`);
    assert.equal(paperwork.createDocument(proposal).number, `PR-${year}-1001`, "a number already sent to a client is never reissued");
    assert.equal(paperwork.createDocument(proposal).number, `PR-${year}-1002`);
  });
});

test("answers merge field by field, because a draft is filled in one field at a time", async () => {
  await withStore(({ paperwork }) => {
    const document = paperwork.createDocument(proposal);
    const edited = paperwork.updateDocument(document.id, { values: { rounds: 2 } });
    assert.deepEqual(edited.values, { scope: "One page, two rounds", price: "180,000,000", rounds: 2 }, "the phone that answered one question did not wipe the rest");
    assert.ok(edited.updatedAt);

    assert.deepEqual(paperwork.updateDocument(document.id, { values: { price: "200,000,000" } }).values.price, "200,000,000");
    assert.deepEqual(
      Object.keys(paperwork.updateDocument(document.id, { values: { rounds: null } }).values).sort(),
      ["price", "scope"],
      "a null takes an answer back out"
    );

    const retitled = paperwork.updateDocument(document.id, { title: "Landing page, second pass", language: "en" });
    assert.equal(retitled.title, "Landing page, second pass");
    assert.equal(retitled.language, "en");
    assert.deepEqual(retitled.values, { scope: "One page, two rounds", price: "200,000,000" }, "an edit that says nothing about the answers leaves them alone");

    assert.throws(() => paperwork.updateDocument("nobody", { title: "Ghost" }), /no longer exists/);
    assert.throws(() => paperwork.updateDocument(document.id, { values: [1, 2] }), /must be an object/);
  });
});

test("answers too long to store are refused rather than written in half", async () => {
  await withStore(({ paperwork }) => {
    const document = paperwork.createDocument(proposal);
    const huge = { brief: "x".repeat(70 * 1024) };
    assert.throws(() => paperwork.updateDocument(document.id, { values: huge }), /too long to save/);
    assert.deepEqual(paperwork.getDocument(document.id).values, proposal.values, "the refused edit changed nothing");
    assert.throws(() => paperwork.createDocument({ ...proposal, values: huge }), /too long to save/);
    assert.throws(() => paperwork.createDocument({ ...proposal, values: "just text" }), /must be an object/);
  });
});

test("a document whose answers cannot be read still opens", async () => {
  await withStore(({ paperwork, databasePath }) => {
    const document = paperwork.createDocument(proposal);
    const database = new DatabaseSync(databasePath);
    database.prepare('UPDATE agent4_paperwork SET "values" = ? WHERE id = ?').run("{not json", document.id);
    database.close();

    const warnings = [];
    const warn = console.warn;
    console.warn = (message) => warnings.push(message);
    try {
      assert.deepEqual(paperwork.getDocument(document.id).values, {}, "a corrupt row must not take the paperwork screen down");
      assert.equal(paperwork.listDocuments({}).documents.length, 1);
    } finally {
      console.warn = warn;
    }
    assert.equal(warnings.length, 2, "the damage is said out loud rather than passing for an empty document");
    assert.match(warnings[0], /could not be read/);

    // The next edit writes over the damage with something readable.
    assert.deepEqual(paperwork.updateDocument(document.id, { values: { scope: "Retyped" } }).values, { scope: "Retyped" });
  });
});

test("the dates say when the document went out and when it came back signed", async () => {
  await withStore(({ paperwork }) => {
    const document = paperwork.createDocument(proposal);

    const sent = paperwork.setStatus(document.id, "sent", { on: "2026-06-02" });
    assert.equal(sent.status, "sent");
    assert.equal(sent.sentOn, "2026-06-02");
    assert.equal(sent.signedOn, null);

    // A proposal drafted in June and signed in September was signed in
    // September, not on the day the row happened to be written.
    const signed = paperwork.setStatus(document.id, "signed", { on: "2026-09-11" });
    assert.equal(signed.sentOn, "2026-06-02", "signing does not rewrite the day it went out");
    assert.equal(signed.signedOn, "2026-09-11");

    const back = paperwork.setStatus(document.id, "sent");
    assert.equal(back.signedOn, null, "a signature taken back is not still on file");
    assert.equal(back.sentOn, "2026-06-02");

    const voided = paperwork.setStatus(document.id, "void");
    assert.equal(voided.sentOn, "2026-06-02", "a document that was withdrawn was still sent");

    const drafted = paperwork.setStatus(document.id, "draft");
    assert.equal(drafted.sentOn, null);
    assert.equal(drafted.signedOn, null);

    assert.throws(() => paperwork.setStatus(document.id, "posted"), /draft, sent, signed or void/);
    assert.throws(() => paperwork.setStatus(document.id, "sent", { on: "2 June" }), /Sent date must be a YYYY-MM-DD date/);
    assert.throws(() => paperwork.setStatus("nobody", "sent"), /no longer exists/);
  });
});

test("a status left where it is defaults to today, on the owner's own calendar", async () => {
  await withStore(({ paperwork }) => {
    const document = paperwork.createDocument(proposal);
    const sent = paperwork.setStatus(document.id, "sent");
    assert.match(sent.sentOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(paperwork.setStatus(document.id, "sent").sentOn, sent.sentOn, "a status it already holds changes nothing");
  });
});

test("the list puts drafts first, then the newest, and pages without losing its place", async () => {
  await withStore(({ paperwork }) => {
    const older = paperwork.createDocument({ ...proposal, title: "First" });
    const newer = paperwork.createDocument({ ...proposal, title: "Second" });
    const draft = paperwork.createDocument({ ...proposal, title: "Third" });
    paperwork.setStatus(older.id, "sent");
    paperwork.setStatus(newer.id, "signed");

    const page = paperwork.listDocuments({});
    assert.deepEqual(page.documents.map((row) => row.title), ["Third", "Second", "First"], "an unsent document is the one still asking for a person");
    assert.equal(page.total, 3);
    assert.equal(page.hasMore, false);

    const first = paperwork.listDocuments({ limit: 2 });
    assert.deepEqual(first.documents.map((row) => row.title), ["Third", "Second"]);
    assert.equal(first.total, 3, "the total counts everything that matched, not what fitted on the page");
    assert.equal(first.hasMore, true);

    const second = paperwork.listDocuments({ limit: 2, offset: 2 });
    assert.deepEqual(second.documents.map((row) => row.title), ["First"]);
    assert.equal(second.hasMore, false);
    assert.equal(paperwork.listDocuments({ limit: 2, offset: 9 }).documents.length, 0);
  });
});

test("the list narrows by type and by status together", async () => {
  await withStore(({ paperwork }) => {
    const nda = paperwork.createDocument({ ...proposal, type: "nda", numberPrefix: "ND", title: "Mutual NDA" });
    paperwork.createDocument({ ...proposal, title: "Rebuild" });
    paperwork.setStatus(nda.id, "signed");

    assert.deepEqual(paperwork.listDocuments({ type: "nda" }).documents.map((row) => row.id), [nda.id]);
    assert.equal(paperwork.listDocuments({ type: "proposal" }).total, 1);
    assert.equal(paperwork.listDocuments({ status: "signed" }).total, 1);
    assert.equal(paperwork.listDocuments({ type: "nda", status: "draft" }).total, 0, "the two filters narrow together");
    assert.equal(paperwork.listDocuments({ type: "nda", status: "signed" }).total, 1);
    assert.throws(() => paperwork.listDocuments({ status: "posted" }), /draft, sent, signed or void/);
  });
});

test("a document removed is gone, and one that was never there says so", async () => {
  await withStore(({ paperwork }) => {
    const document = paperwork.createDocument(proposal);
    assert.equal(paperwork.removeDocument(document.id), true);
    assert.equal(paperwork.getDocument(document.id), null);
    assert.equal(paperwork.removeDocument(document.id), false);
    assert.equal(paperwork.removeDocument(""), false);
    assert.equal(paperwork.listDocuments({}).total, 0);
  });
});

test("a company is checked when it is given, and the name written on the paper is kept either way", async () => {
  await withWorkspace(({ paperwork, workspace }) => {
    const client = workspace.ensureCompany({ id: "project", name: "SampleProject", actorId: "owner" });
    const theirs = paperwork.createDocument({ ...proposal, companyId: client.id });
    assert.equal(theirs.companyId, "project");
    assert.equal(theirs.companyName, "SampleProject", "the name is filled in from the CRM row when nobody typed one");

    // Somebody who is not in the CRM still gets a document that reads properly.
    const stranger = paperwork.createDocument({ ...proposal, companyName: "A friend of Reza's" });
    assert.equal(stranger.companyId, null);
    assert.equal(stranger.companyName, "A friend of Reza's");

    assert.throws(() => paperwork.createDocument({ ...proposal, companyId: "nobody" }), /That company no longer exists/);
    assert.throws(() => paperwork.updateDocument(stranger.id, { companyId: "nobody" }), /That company no longer exists/);

    const moved = paperwork.updateDocument(stranger.id, { companyId: "project" });
    assert.equal(moved.companyName, "SampleProject");
    assert.equal(paperwork.updateDocument(moved.id, { companyId: "" }).companyId, null);
  });
});

test("a document written for a company that is later deleted still reads properly", async () => {
  await withWorkspace(({ paperwork, workspace }) => {
    const client = workspace.ensureCompany({ id: "project", name: "SampleProject", actorId: "owner" });
    const signed = paperwork.createDocument({ ...proposal, companyId: client.id });
    paperwork.setStatus(signed.id, "signed", { on: "2026-05-04" });

    const preview = workspace.removeCompany("project");
    assert.equal(preview.attached.paperwork, 1, "the confirm dialog says the document would stop pointing anywhere");

    workspace.removeCompany("project", { confirm: true });
    const kept = paperwork.getDocument(signed.id);
    assert.equal(kept.companyId, null, "the link is dropped, not the document");
    assert.equal(kept.companyName, "SampleProject", "a signed proposal outlives the CRM row it was filed under");
    assert.equal(kept.signedOn, "2026-05-04");
  });
});

test("a company's own page gets its paperwork newest first", async () => {
  await withWorkspace(({ paperwork, workspace }) => {
    const client = workspace.ensureCompany({ id: "project", name: "SampleProject", actorId: "owner" });
    workspace.ensureCompany({ id: "example-metals", name: "Kavir", actorId: "owner" });
    const older = paperwork.createDocument({ ...proposal, companyId: client.id, title: "Proposal" });
    const newer = paperwork.createDocument({ ...proposal, companyId: client.id, type: "nda", numberPrefix: "ND", title: "NDA" });
    paperwork.createDocument({ ...proposal, companyId: "example-metals", title: "Someone else's" });
    paperwork.createDocument(proposal);
    paperwork.setStatus(newer.id, "signed");

    assert.deepEqual(paperwork.companyPaperwork("project").map((row) => row.id), [newer.id, older.id], "however it stands, newest first");
    assert.equal(paperwork.companyPaperwork("example-metals").length, 1);
    assert.deepEqual(paperwork.companyPaperwork(""), []);
    assert.deepEqual(paperwork.listDocuments({ companyId: "none" }).documents.map((row) => row.title), ["Landing page rebuild"], "the set a person goes looking for to fix");
    assert.equal(paperwork.listDocuments({ companyId: "project" }).total, 2);
  });
});

test("a new weekly update starts from the last one's pieces, so only what moved needs changing", async () => {
  await withWorkspace(async ({ paperwork, workspace }) => {
    const company = workspace.createCompany({ name: "Sample Studio", kind: "client", stage: "active", actorId: "owner-1" });
    const pieces = [["Home", "done"], ["Booking", "half"], ["Photos", "waiting"]];
    const first = paperwork.createDocument({ type: "update", title: "Week 1", companyId: company.id, actorId: "owner-1", values: { pieces } });
    const second = paperwork.createDocument({ type: "update", title: "Week 2", companyId: company.id, actorId: "owner-1" });
    assert.deepEqual(second.values.pieces, pieces, "carried over from the last update");

    const chosen = paperwork.createDocument({ type: "update", title: "Week 3", companyId: company.id, actorId: "owner-1", values: { pieces: [] } });
    assert.deepEqual(chosen.values.pieces, [], "pieces given on purpose, even none, are kept as given");

    paperwork.setStatus(chosen.id, "void");
    paperwork.setStatus(second.id, "void");
    const fourth = paperwork.createDocument({ type: "update", title: "Week 4", companyId: company.id, actorId: "owner-1" });
    assert.deepEqual(fourth.values.pieces, pieces, "a voided update is skipped");
    void first;

    const other = workspace.createCompany({ name: "Someone else", kind: "client", stage: "active", actorId: "owner-1" });
    assert.equal(paperwork.createDocument({ type: "update", title: "Theirs", companyId: other.id, actorId: "owner-1" }).values.pieces, undefined, "never another company's pieces");
    assert.equal(paperwork.createDocument({ type: "proposal", title: "Not an update", companyId: company.id, actorId: "owner-1" }).values.pieces, undefined);
  });
});
