import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createAuthStore } from "../src/auth-store.js";

test("auth store supports bootstrap login, expiring sessions, and single-use invites", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-auth-"));
  const store = createAuthStore(path.join(directory, "rooms.sqlite"));
  try {
    const owner = store.ensureBootstrap({ email: "owner@example.com", name: "Alex", password: "a-long-owner-password" });
    assert.equal(owner.role, "owner");
    assert.equal(store.ensureBootstrap({ email: "other@example.com", name: "Other", password: "another-long-password" }), null);
    assert.equal(store.authenticate("OWNER@example.com", "a-long-owner-password").id, owner.id);
    assert.equal(store.authenticate("owner@example.com", "wrong-password"), null);

    const session = store.createSession(owner.id, { ttlHours: 1, now: new Date("2026-08-29T10:00:00.000Z") });
    assert.equal(store.getSession(session.token, "2026-08-29T10:30:00.000Z").name, "Alex");
    assert.equal(store.getSession(session.token, "2026-08-29T11:01:00.000Z"), null);

    const invite = store.createInvite({
      email: "teammate@example.com",
      name: "Teammate",
      createdBy: owner.id,
      now: new Date("2026-08-29T10:00:00.000Z")
    });
    assert.equal(store.getInvite(invite.token, "2026-08-29T10:30:00.000Z").email, "teammate@example.com");
    const member = store.acceptInviteToken(invite.token, "a-long-member-password", "2026-08-29T10:40:00.000Z");
    assert.equal(member.role, "member");
    assert.equal(store.findUserByTelegramId("100000001"), null);
    assert.equal(store.linkTelegramUser(member.id, "100000001").id, member.id);
    assert.equal(store.findUserByTelegramId("100000001").email, "teammate@example.com");
    assert.throws(() => store.linkTelegramUser(owner.id, "100000001"), /UNIQUE/);
    const memberSession = store.createSession(member.id);
    assert.deepEqual(store.listUsers().map((user) => user.name), ["Alex", "Teammate"]);

    const ownerSessionBeforePasswordChange = store.createSession(owner.id);
    assert.equal(store.changePassword(owner.id, "not-the-current-password", "a-brand-new-owner-password"), null);
    assert.equal(store.changePassword(owner.id, "a-long-owner-password", "a-brand-new-owner-password").id, owner.id);
    assert.equal(store.getSession(ownerSessionBeforePasswordChange.token), null, "changing a password signs out older sessions");
    assert.equal(store.authenticate("owner@example.com", "a-long-owner-password"), null);
    assert.equal(store.authenticate("owner@example.com", "a-brand-new-owner-password").id, owner.id);

    assert.equal(store.getInvite(invite.token, "2026-08-29T10:41:00.000Z"), null);
    assert.equal(store.revokeMember(owner.id), false);
    assert.equal(store.revokeMember(member.id), true);
    assert.equal(store.findUserByTelegramId("100000001"), null);
    assert.equal(store.getSession(memberSession.token), null);
    assert.deepEqual(store.listUsers().map((user) => user.name), ["Alex"]);
    assert.equal(store.revokeMember(member.id), false);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
