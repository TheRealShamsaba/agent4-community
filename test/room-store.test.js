import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRoomStore } from "../src/room-store.js";

function state(title) {
  return {
    localObjects: [{ id: "note-1", type: "note", title }],
    layout: {},
    edges: []
  };
}

test("room store versions durable state, rejects stale writes, and restores history", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-rooms-"));
  const databasePath = path.join(directory, "rooms.sqlite");
  const store = createRoomStore(databasePath);
  try {
    assert.equal(store.getRoom("company-room"), null);

    const first = store.saveRoom({
      id: "company-room",
      baseVersion: 0,
      state: state("First"),
      actorId: "owner",
      actorName: "Alex",
      label: "Imported browser room",
      now: "2026-08-29T10:00:00.000Z"
    });
    assert.equal(first.room.version, 1);
    assert.equal(first.room.state.localObjects[0].title, "First");

    const stale = store.saveRoom({
      id: "company-room",
      baseVersion: 0,
      state: state("Stale"),
      actorId: "owner",
      actorName: "Alex",
      label: "Stale write"
    });
    assert.equal(stale.conflict, true);
    assert.equal(stale.room.version, 1);

    const second = store.saveRoom({
      id: "company-room",
      baseVersion: 1,
      state: state("Second"),
      actorId: "owner",
      actorName: "Alex",
      label: "Edited note",
      now: "2026-08-29T10:01:00.000Z"
    });
    assert.equal(second.room.version, 2);
    assert.deepEqual(store.listHistory("company-room").map((item) => item.version), [2, 1]);

    const receipt = store.recordReceipt({
      id: "proposal-12345678",
      roomId: "company-room",
      action: "tasks",
      status: "approved",
      summary: "Created 3 tasks from Research",
      sources: ["Research"],
      result: { created: 3 },
      model: "qwen3.5:4b",
      actorId: "owner",
      actorName: "Alex",
      now: "2026-08-29T10:01:30.000Z"
    });
    assert.equal(receipt.receipt.status, "approved");
    assert.equal(store.listReceipts("company-room")[0].result.created, 3);

    const duplicate = store.recordReceipt({
      id: "proposal-12345678",
      roomId: "company-room",
      action: "tasks",
      status: "cancelled",
      summary: "Duplicate",
      actorId: "owner",
      actorName: "Alex"
    });
    assert.equal(duplicate.receipt.status, "approved");

    const restored = store.restoreRoom({
      id: "company-room",
      version: 1,
      baseVersion: 2,
      actorId: "owner",
      actorName: "Alex",
      now: "2026-08-29T10:02:00.000Z"
    });
    assert.equal(restored.room.version, 3);
    assert.equal(restored.room.state.localObjects[0].title, "First");
    assert.equal(restored.room.label, "Restored version 1");
  } finally {
    store.close();
  }

  const reopened = createRoomStore(databasePath);
  try {
    assert.equal(reopened.getRoom("company-room").version, 3);
    assert.equal(reopened.getRoom("company-room").state.localObjects[0].title, "First");
    assert.equal(reopened.listReceipts("company-room")[0].summary, "Created 3 tasks from Research");
  } finally {
    reopened.close();
    await rm(directory, { recursive: true, force: true });
  }
});
