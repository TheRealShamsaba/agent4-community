import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createAuthStore } from "../src/auth-store.js";
import { resolveTelegramAccount, resolveTelegramUpdateAccount } from "../src/telegram-access.js";

test("Telegram access resolves the legacy owner and linked active members", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-telegram-access-"));
  const store = createAuthStore(path.join(directory, "rooms.sqlite"));
  try {
    const owner = store.ensureBootstrap({ email: "owner@example.com", name: "Owner", password: "a-long-owner-password" });
    const member = store.createUser({ email: "member@example.com", name: "Member", password: "a-long-member-password" });
    store.linkTelegramUser(member.id, "100000001");
    const config = { runtime: { telegramOwnerUserId: "4200" } };

    assert.equal(resolveTelegramAccount(config, store, "4200").id, owner.id);
    assert.equal(resolveTelegramAccount(config, store, "100000001").id, member.id);
    assert.equal(resolveTelegramAccount(config, store, "99999"), null);
    assert.equal(resolveTelegramUpdateAccount(config, store, {
      message: { chat: { id: 100000001, type: "private" }, from: { id: 100000001 } }
    }).id, member.id);
    assert.equal(resolveTelegramUpdateAccount(config, store, {
      message: { chat: { id: -10, type: "group" }, from: { id: 100000001 } }
    }), null);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
