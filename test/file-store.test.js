import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanFileName, createFileStore, FILE_LIMITS } from "../src/file-store.js";

async function open(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent4-files-"));
  const store = createFileStore(path.join(root, "hq.sqlite"));
  t.after(() => store.close());
  return { store, root };
}

test("file names are made safe to show and to send back in a header", () => {
  assert.ok(!cleanFileName("../../etc/passwd").includes("/"), "a path cannot be smuggled in a name");
  assert.ok(!cleanFileName("..\\..\\windows").includes("\\"));
  assert.equal(cleanFileName('Proposal "final" <v2>.pdf'), "Proposal -final- -v2-.pdf");
  assert.equal(cleanFileName("   "), "document");
  assert.equal(cleanFileName(".hidden"), "hidden");
});

test("a file arrives in parts, in order, and only a complete one can be listed or downloaded", async (t) => {
  const { store } = await open(t);
  const bytes = Buffer.from("proposal ".repeat(500));
  const started = store.start({ name: "Sample Studio proposal.docx", kind: "document", size: bytes.length, companyId: "sampleStudio", companyName: "Sample Studio", actorId: "owner" });
  assert.equal(started.complete, false);
  assert.deepEqual(store.list(), [], "an unfinished upload is not a file");

  store.appendPart(started.id, 0, bytes.subarray(0, 2000));
  assert.throws(() => store.appendPart(started.id, 0, bytes.subarray(0, 2000)), /out of order/, "a repeated part is refused");
  assert.throws(() => store.appendPart(started.id, 5000, bytes.subarray(2000, 2500)), /out of order/, "a skipped part is refused");
  assert.throws(() => store.finish(started.id), /did not arrive in full/);
  store.appendPart(started.id, 2000, bytes.subarray(2000));
  assert.throws(() => store.appendPart(started.id, bytes.length, Buffer.from("x")), /more than the file said/);
  const done = store.finish(started.id);
  assert.equal(done.complete, true);
  assert.equal(done.size, bytes.length);

  assert.deepEqual(store.list({ companyId: "sampleStudio" }).map((file) => file.name), ["Sample Studio proposal.docx"]);
  assert.deepEqual(store.list({ kind: "template" }), []);
  const opened = store.open(started.id);
  assert.equal(opened.size, bytes.length);
  const chunks = [];
  for await (const chunk of opened.stream()) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), bytes.toString());
});

test("limits are enforced and a file can be promoted to a template, renamed, and deleted", async (t) => {
  const { store, root } = await open(t);
  assert.throws(() => store.start({ name: "x", size: 0 }), /empty/);
  assert.throws(() => store.start({ name: "x", size: FILE_LIMITS.maxBytes + 1 }), /at most/);
  assert.throws(() => store.start({ name: "x", size: 10, kind: "secret" }), /template or a document/);
  const file = store.start({ name: "Proposal.pdf", size: 4, actorId: "owner" });
  assert.throws(() => store.appendPart(file.id, 0, Buffer.alloc(FILE_LIMITS.partBytes + 1)), /wrong size/);
  store.appendPart(file.id, 0, Buffer.from("abcd"));
  store.finish(file.id);
  const promoted = store.update(file.id, { kind: "template", name: "Website proposal (template).pdf", companyId: "", note: "My usual website proposal" });
  assert.equal(promoted.kind, "template");
  assert.equal(promoted.companyId, null);
  assert.equal(store.list({ kind: "template" })[0].note, "My usual website proposal");
  assert.equal(store.remove(file.id), true);
  assert.equal(store.get(file.id), null);
  assert.equal(store.open(file.id), null);
  assert.equal(store.remove(file.id), false);
  await assert.rejects(readFile(path.join(root, "files", `${file.id}.bin`)), /ENOENT/, "the bytes are gone too");
});
