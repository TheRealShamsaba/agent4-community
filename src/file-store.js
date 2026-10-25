import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* A shelf for the documents you keep: the proposals you wrote with Claude, a
   client's brief, a signed agreement. Templates are the ones you reuse. The
   file goes to disk in parts, so a document larger than the proxy's single
   request limit still gets in, and it only ever comes back as a download. */

export const FILE_LIMITS = Object.freeze({ maxBytes: 25 * 1024 * 1024, partBytes: 1_500_000 });
const KINDS = new Set(["template", "document"]);

function text(value, limit = 300) {
  return String(value ?? "").trim().slice(0, limit);
}

/** A name that is safe to show and to hand back in a download header. */
export function cleanFileName(value) {
  const name = text(value, 180).replace(/[\\/\0-\x1f"<>|?*:]+/g, "-").replace(/^\.+/, "").trim();
  return name || "document";
}

function fileFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    mime: row.mime || "application/octet-stream",
    size: row.size,
    complete: row.complete === 1,
    companyId: row.company_id || null,
    companyName: row.company_name || "",
    note: row.note || "",
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

export function createFileStore(databasePath, { now = () => new Date() } = {}) {
  const directory = path.join(path.dirname(databasePath), "files");
  mkdirSync(directory, { recursive: true });
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      mime TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      declared INTEGER NOT NULL DEFAULT 0,
      complete INTEGER NOT NULL DEFAULT 0,
      company_id TEXT,
      company_name TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent4_files_company ON agent4_files(company_id, created_at DESC);
  `);
  const select = database.prepare("SELECT * FROM agent4_files WHERE id = ?");
  const diskPath = (id) => path.join(directory, `${id}.bin`);

  // An upload nobody finished is not a file. Clear the leftovers after a day.
  const stale = database.prepare("SELECT id FROM agent4_files WHERE complete = 0 AND created_at < ?").all(new Date(now().getTime() - 86_400_000).toISOString());
  for (const row of stale) { rmSync(diskPath(row.id), { force: true }); database.prepare("DELETE FROM agent4_files WHERE id = ?").run(row.id); }

  function start(input = {}) {
    const kind = text(input.kind, 20) || "document";
    assert(KINDS.has(kind), "A file is a template or a document.");
    const declared = Number(input.size);
    assert(Number.isSafeInteger(declared) && declared > 0, "That file is empty.");
    assert(declared <= FILE_LIMITS.maxBytes, `Files can be at most ${FILE_LIMITS.maxBytes / 1024 / 1024} MB.`);
    const id = randomUUID();
    database.prepare("INSERT INTO agent4_files (id,name,kind,mime,declared,company_id,company_name,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, cleanFileName(input.name), kind, text(input.mime, 120) || null, declared, text(input.companyId, 140) || null, text(input.companyName, 180) || null, now().toISOString(), text(input.actorId, 140) || "unknown");
    closeSync(openSync(diskPath(id), "w"));
    return fileFrom(select.get(id));
  }

  /** Append one part. Parts must arrive in order, so a repeated or skipped part is refused. */
  function appendPart(id, offset, bytes) {
    const row = select.get(text(id, 80));
    assert(row && row.complete === 0, "That upload is not open.");
    assert(Number(offset) === row.size, "That part is out of order.");
    assert(bytes.byteLength > 0 && bytes.byteLength <= FILE_LIMITS.partBytes, "That part is the wrong size.");
    assert(row.size + bytes.byteLength <= row.declared, "That is more than the file said it would be.");
    const handle = openSync(diskPath(row.id), "a");
    try { writeSync(handle, bytes); } finally { closeSync(handle); }
    database.prepare("UPDATE agent4_files SET size = size + ? WHERE id = ?").run(bytes.byteLength, row.id);
    return fileFrom(select.get(row.id));
  }

  function finish(id) {
    const row = select.get(text(id, 80));
    assert(row, "That upload no longer exists.");
    assert(row.size === row.declared, "The file did not arrive in full.");
    database.prepare("UPDATE agent4_files SET complete = 1 WHERE id = ?").run(row.id);
    return fileFrom(select.get(row.id));
  }

  function list({ companyId, kind } = {}) {
    const clauses = ["complete = 1"];
    const values = [];
    if (companyId) { clauses.push("company_id = ?"); values.push(text(companyId, 140)); }
    if (kind) { clauses.push("kind = ?"); values.push(text(kind, 20)); }
    return database.prepare(`SELECT * FROM agent4_files WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`).all(...values).map(fileFrom);
  }

  function get(id) {
    const row = select.get(text(id, 80));
    return row && row.complete === 1 ? fileFrom(row) : null;
  }

  function open(id) {
    const file = get(id);
    if (!file || !existsSync(diskPath(file.id))) return null;
    return { file, size: statSync(diskPath(file.id)).size, stream: () => createReadStream(diskPath(file.id)) };
  }

  function update(id, updates = {}) {
    const row = select.get(text(id, 80));
    assert(row && row.complete === 1, "That file no longer exists.");
    const kind = updates.kind === undefined ? row.kind : text(updates.kind, 20);
    assert(KINDS.has(kind), "A file is a template or a document.");
    database.prepare("UPDATE agent4_files SET name=?, kind=?, company_id=?, company_name=?, note=? WHERE id=?").run(
      updates.name === undefined ? row.name : cleanFileName(updates.name),
      kind,
      updates.companyId === undefined ? row.company_id : text(updates.companyId, 140) || null,
      updates.companyName === undefined ? row.company_name : text(updates.companyName, 180) || null,
      updates.note === undefined ? row.note : text(updates.note, 500),
      row.id
    );
    return fileFrom(select.get(row.id));
  }

  function remove(id) {
    const row = select.get(text(id, 80));
    if (!row) return false;
    rmSync(diskPath(row.id), { force: true });
    database.prepare("DELETE FROM agent4_files WHERE id = ?").run(row.id);
    return true;
  }

  return { start, appendPart, finish, list, get, open, update, remove, close: () => database.close() };
}
