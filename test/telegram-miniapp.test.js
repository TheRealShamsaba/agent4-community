import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { URLSearchParams } from "node:url";
import { validateTelegramMiniAppData } from "../src/telegram-miniapp.js";

function signedInitData({ botToken, authDate, user }) {
  const values = {
    auth_date: String(authDate),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify(user)
  };
  const dataCheckString = Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

test("Telegram Mini App launch data is signed, fresh, and can optionally be owner-bound", () => {
  const botToken = "123456:unit-test-token";
  const now = new Date("2026-08-30T12:00:00Z");
  const authDate = Math.floor(now.getTime() / 1000) - 30;
  const initData = signedInitData({ botToken, authDate, user: { id: 4200, first_name: "Sham", username: "owner" } });

  assert.deepEqual(validateTelegramMiniAppData(initData, { botToken, ownerUserId: "4200", now }), {
    id: "4200",
    firstName: "Sham",
    lastName: "",
    username: "owner"
  });
  assert.equal(validateTelegramMiniAppData(initData, { botToken, now }).id, "4200");
  assert.throws(() => validateTelegramMiniAppData(initData.replace("Sham", "NotSham"), { botToken, ownerUserId: "4200", now }), /verified/);
  assert.throws(() => validateTelegramMiniAppData(initData, { botToken, ownerUserId: "99", now }), /configured Telegram owner/);

  const expired = signedInitData({ botToken, authDate: authDate - 3600, user: { id: 4200, first_name: "Sham" } });
  assert.throws(() => validateTelegramMiniAppData(expired, { botToken, ownerUserId: "4200", now }), /expired/);
});
