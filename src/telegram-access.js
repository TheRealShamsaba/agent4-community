function sameId(left, right) {
  return String(left ?? "") !== "" && String(left) === String(right ?? "");
}

export function resolveTelegramAccount(config, authStore, telegramUserId) {
  const value = String(telegramUserId || "").trim();
  if (!value) return null;
  const linked = authStore.findUserByTelegramId(value);
  if (linked) return linked;
  if (!sameId(value, config?.runtime?.telegramOwnerUserId)) return null;
  return authStore.listUsers().find((user) => user.role === "owner") || null;
}

export function resolveTelegramUpdateAccount(config, authStore, update) {
  const callback = update?.callback_query;
  const message = update?.message;
  const from = callback?.from || message?.from;
  const chat = callback?.message?.chat || message?.chat;
  if (chat?.type !== "private" || !sameId(chat?.id, from?.id)) return null;
  return resolveTelegramAccount(config, authStore, from.id);
}
