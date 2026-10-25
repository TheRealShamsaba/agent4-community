import { createHmac, timingSafeEqual } from "node:crypto";
import { URLSearchParams } from "node:url";

function safeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Validate Telegram WebApp init data before it is allowed to mint an HQ session.
 * Telegram's user payload is identity context only. The caller must still map the
 * verified Telegram id to an active Agent4 account before creating a session.
 */
export function validateTelegramMiniAppData(initData, {
  botToken,
  ownerUserId,
  now = new Date(),
  maxAgeSeconds = 15 * 60
} = {}) {
  if (!botToken) throw new Error("Telegram Mini App authentication is not configured.");
  if (typeof initData !== "string" || !initData.trim() || initData.length > 16_384) {
    throw new Error("Telegram did not provide valid launch data.");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash") || "";
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!safeHexEqual(receivedHash, expectedHash)) throw new Error("Telegram launch data could not be verified.");

  const authDate = Number(params.get("auth_date"));
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!Number.isInteger(authDate) || authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new Error("This Telegram launch has expired. Open Home Court from the bot again.");
  }

  let user;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    throw new Error("Telegram did not provide a readable user identity.");
  }
  if (!user || !user.id) throw new Error("Telegram did not provide a readable user identity.");
  if (ownerUserId && String(user.id) !== String(ownerUserId)) {
    throw new Error("This Home Court belongs to its configured Telegram owner.");
  }

  return {
    id: String(user.id),
    firstName: String(user.first_name || ""),
    lastName: String(user.last_name || ""),
    username: String(user.username || "")
  };
}
