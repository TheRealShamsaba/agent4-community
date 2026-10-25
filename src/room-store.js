import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const HISTORY_LIMIT = 100;

function parseState(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function roomFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    version: Number(row.version),
    state: parseState(row.state_json),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
    label: row.last_label
  };
}

function receiptFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    action: row.action_type,
    status: row.status,
    summary: row.summary,
    sources: parseState(row.sources_json) || [],
    result: parseState(row.result_json) || {},
    model: row.model || "",
    actorId: row.actor_id,
    actorName: row.actor_name,
    createdAt: row.created_at
  };
}

export function roomDatabasePath(root) {
  return path.join(root, "data", "agent4-rooms.sqlite");
}

export function createRoomStore(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_by_name TEXT NOT NULL,
      last_label TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS room_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(room_id, version),
      FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS room_revisions_room_version ON room_revisions(room_id, version DESC);
    CREATE TABLE IF NOT EXISTS agent_action_receipts (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      model TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS agent_receipts_room_created ON agent_action_receipts(room_id, created_at DESC);
  `);

  const selectRoom = database.prepare("SELECT * FROM rooms WHERE id = ?");
  const insertRoom = database.prepare(`
    INSERT INTO rooms (id,name,version,state_json,created_at,updated_at,updated_by,updated_by_name,last_label)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  const updateRoom = database.prepare(`
    UPDATE rooms SET version=?,state_json=?,updated_at=?,updated_by=?,updated_by_name=?,last_label=? WHERE id=?
  `);
  const insertRevision = database.prepare(`
    INSERT OR IGNORE INTO room_revisions (room_id,version,state_json,author_id,author_name,label,created_at)
    VALUES (?,?,?,?,?,?,?)
  `);
  const selectRevision = database.prepare("SELECT * FROM room_revisions WHERE room_id = ? AND version = ?");
  const selectHistory = database.prepare(`
    SELECT version,author_id,author_name,label,created_at FROM room_revisions
    WHERE room_id = ? ORDER BY version DESC LIMIT ?
  `);
  const pruneHistory = database.prepare(`
    DELETE FROM room_revisions WHERE room_id = ? AND id NOT IN (
      SELECT id FROM room_revisions WHERE room_id = ? ORDER BY version DESC LIMIT ?
    )
  `);
  const insertReceipt = database.prepare(`
    INSERT OR IGNORE INTO agent_action_receipts
      (id,room_id,action_type,status,summary,sources_json,result_json,model,actor_id,actor_name,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);
  const selectReceipt = database.prepare("SELECT * FROM agent_action_receipts WHERE id = ?");
  const selectReceipts = database.prepare(`
    SELECT * FROM agent_action_receipts WHERE room_id = ? ORDER BY created_at DESC LIMIT ?
  `);

  function getRoom(id) {
    return roomFromRow(selectRoom.get(id));
  }

  function saveRoom({ id, name = "Company room", baseVersion, state, actorId, actorName, label, now = new Date().toISOString() }) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const currentRow = selectRoom.get(id);
      if (!currentRow) {
        if (baseVersion !== 0) {
          database.exec("ROLLBACK");
          return { conflict: true, room: null };
        }
        insertRoom.run(id, name, 1, JSON.stringify(state), now, now, actorId, actorName, label);
        database.exec("COMMIT");
        return { conflict: false, room: getRoom(id) };
      }
      if (Number(currentRow.version) !== baseVersion) {
        database.exec("ROLLBACK");
        return { conflict: true, room: roomFromRow(currentRow) };
      }
      insertRevision.run(
        id,
        Number(currentRow.version),
        currentRow.state_json,
        currentRow.updated_by,
        currentRow.updated_by_name,
        currentRow.last_label,
        currentRow.updated_at
      );
      updateRoom.run(baseVersion + 1, JSON.stringify(state), now, actorId, actorName, label, id);
      pruneHistory.run(id, id, HISTORY_LIMIT);
      database.exec("COMMIT");
      return { conflict: false, room: getRoom(id) };
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* Transaction already closed. */ }
      throw error;
    }
  }

  function listHistory(id, limit = 30) {
    const room = getRoom(id);
    if (!room) return [];
    return [
      {
        version: room.version,
        authorId: room.updatedBy,
        authorName: room.updatedByName,
        label: room.label,
        createdAt: room.updatedAt,
        current: true
      },
      ...selectHistory.all(id, Math.max(1, Math.min(100, limit))).map((row) => ({
        version: Number(row.version),
        authorId: row.author_id,
        authorName: row.author_name,
        label: row.label,
        createdAt: row.created_at,
        current: false
      }))
    ];
  }

  function restoreRoom({ id, version, baseVersion, actorId, actorName, now = new Date().toISOString() }) {
    const target = selectRevision.get(id, version);
    if (!target) return { missing: true, conflict: false, room: getRoom(id) };
    const saved = saveRoom({
      id,
      baseVersion,
      state: parseState(target.state_json),
      actorId,
      actorName,
      label: `Restored version ${version}`,
      now
    });
    return { missing: false, ...saved };
  }

  function recordReceipt({ id, roomId, action, status, summary, sources = [], result = {}, model = "", actorId, actorName, now = new Date().toISOString() }) {
    if (!getRoom(roomId)) return { missing: true, receipt: null };
    insertReceipt.run(
      id,
      roomId,
      action,
      status,
      summary,
      JSON.stringify(sources),
      JSON.stringify(result),
      model,
      actorId,
      actorName,
      now
    );
    return { missing: false, receipt: receiptFromRow(selectReceipt.get(id)) };
  }

  function listReceipts(roomId, limit = 30) {
    return selectReceipts.all(roomId, Math.max(1, Math.min(100, limit))).map(receiptFromRow);
  }

  return {
    getRoom,
    saveRoom,
    listHistory,
    restoreRoom,
    recordReceipt,
    listReceipts,
    close() { database.close(); }
  };
}
