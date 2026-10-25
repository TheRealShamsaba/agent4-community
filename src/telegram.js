import { fetchWithTimeout } from "./util.js";
import { requireSetting } from "./config.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

function endpoint(config, method) {
  const token = requireSetting(config.runtime.telegramBotToken, "TELEGRAM_BOT_TOKEN");
  return `https://api.telegram.org/bot${token}/${method}`;
}

function fileEndpoint(config, filePath) {
  const token = requireSetting(config.runtime.telegramBotToken, "TELEGRAM_BOT_TOKEN");
  const normalized = String(filePath || "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || !/^[A-Za-z0-9_./-]+$/.test(normalized)) {
    throw new Error("Telegram returned an unsafe voice file path.");
  }
  return `https://api.telegram.org/file/bot${token}/${normalized}`;
}

async function callTelegram(config, method, payload) {
  const response = await fetchWithTimeout(
    endpoint(config, method),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    },
    Math.max(config.runtime.requestTimeoutMs, 30_000)
  );
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram ${method} failed: ${result.description || response.status}`);
  return result.result;
}

function splitMessage(text, max = 3900) {
  const chunks = [];
  let remaining = String(text || "").trim();
  while (remaining.length > max) {
    let splitAt = remaining.lastIndexOf("\n", max);
    if (splitAt < max * 0.6) splitAt = max;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function sendText(config, text, options = {}) {
  const chatId = options.chatId || requireSetting(config.runtime.telegramOwnerChatId, "TELEGRAM_OWNER_CHAT_ID");
  const chunks = splitMessage(text);
  const sent = [];
  for (let index = 0; index < chunks.length; index += 1) {
    sent.push(await callTelegram(config, "sendMessage", {
      chat_id: chatId,
      text: chunks[index],
      disable_web_page_preview: true,
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
      ...(index === chunks.length - 1 && options.replyMarkup
        ? { reply_markup: options.replyMarkup }
        : {})
    }));
  }
  return sent;
}

export async function editText(config, callbackQuery, text, replyMarkup, options = {}) {
  if (!callbackQuery.message) return;
  return callTelegram(config, "editMessageText", {
    chat_id: callbackQuery.message.chat.id,
    message_id: callbackQuery.message.message_id,
    text: String(text || "").trim().slice(0, 3900),
    disable_web_page_preview: true,
    ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

const DOCUMENT_CONTENT_TYPES = Object.freeze({
  ".csv": "text/csv;charset=utf-8",
  ".html": "text/html;charset=utf-8",
  ".json": "application/json",
  ".md": "text/markdown;charset=utf-8"
});

export async function sendDocument(config, filePath, { chatId, caption = "" } = {}) {
  const form = new FormData();
  form.append("chat_id", chatId || requireSetting(config.runtime.telegramOwnerChatId, "TELEGRAM_OWNER_CHAT_ID"));
  if (caption) form.append("caption", caption);
  const bytes = await readFile(filePath);
  const contentType = DOCUMENT_CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  form.append("document", new Blob([bytes], { type: contentType }), path.basename(filePath));
  const response = await fetchWithTimeout(endpoint(config, "sendDocument"), { method: "POST", body: form }, 60_000);
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram sendDocument failed: ${result.description || response.status}`);
  return result.result;
}

export async function getTelegramFile(config, fileId) {
  const result = await callTelegram(config, "getFile", { file_id: fileId });
  if (!result?.file_path) throw new Error("Telegram did not make the voice note available.");
  return result;
}

function voiceTooLargeError() {
  return Object.assign(
    new Error("The voice note is larger than Agent4's private processing limit."),
    { code: "TELEGRAM_VOICE_TOO_LARGE" }
  );
}

export async function readTelegramResponseBounded(response, maxBytes, signal) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new TypeError("maxBytes must be a positive integer.");
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > maxBytes) throw voiceTooLargeError();
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error("Telegram voice download failed.");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("Telegram voice download failed.");
      total += value.byteLength;
      if (total > maxBytes) {
        cancel();
        throw voiceTooLargeError();
      }
      chunks.push(value);
    }
    if (signal?.aborted) throw new Error("Telegram voice download failed.");
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function downloadTelegramFile(config, filePath, {
  maxBytes = 10 * 1024 * 1024,
  fetchImpl = globalThis.fetch,
  timeoutMs = Math.max(config.runtime.requestTimeoutMs, 30_000)
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      fileEndpoint(config, filePath),
      { method: "GET", signal: controller.signal }
    );
    if (!response.ok) throw new Error("Telegram voice download failed.");
    const bytes = await readTelegramResponseBounded(response, maxBytes, controller.signal);
    return {
      bytes,
      contentType: response.headers.get("content-type") || "application/octet-stream"
    };
  } catch (error) {
    if (error?.code === "TELEGRAM_VOICE_TOO_LARGE") throw error;
    throw new Error("Telegram voice download failed.");
  } finally {
    clearTimeout(timer);
  }
}

export function mainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: "Today" }, { text: "My tasks" }],
      [{ text: "Calendar" }, { text: "Capture" }],
      [{ text: "Meetings" }]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Ask Agent4 anything, or say what happened"
  };
}

export function telegramMiniAppUrl(config, route = {}) {
  const configured = String(config?.runtime?.agent4PublicUrl || "").trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:") return null;
    url.pathname = "/telegram";
    url.search = "";
    url.hash = "";
    if (["today", "rhythm", "calendar", "film", "more"].includes(route.tab)) url.searchParams.set("tab", route.tab);
    if (["task", "event", "post"].includes(route.capture)) url.searchParams.set("capture", route.capture);
    if (/^[a-zA-Z0-9-]{8,64}$/.test(String(route.taskId || ""))) {
      url.searchParams.set("tab", "more");
      url.searchParams.set("task", route.taskId);
    }
    return url.href;
  } catch {
    return null;
  }
}

export function miniAppKeyboard(config) {
  const url = telegramMiniAppUrl(config);
  return url ? { inline_keyboard: [[{ text: "Open Home Court", web_app: { url } }]] } : undefined;
}

export function filmRoomKeyboard(config) {
  const url = telegramMiniAppUrl(config, { tab: "film" });
  return url ? { inline_keyboard: [[{ text: "Open Film Room", web_app: { url } }]] } : undefined;
}

export function operatorActionsKeyboard(config) {
  const todayUrl = telegramMiniAppUrl(config, { tab: "today" });
  const captureUrl = telegramMiniAppUrl(config, { capture: "task" });
  const filmUrl = telegramMiniAppUrl(config, { tab: "film" });
  const rows = todayUrl ? [
    [
      { text: "Today", web_app: { url: todayUrl } },
      { text: "My tasks", callback_data: "bot:tasks" }
    ],
    [
      { text: "Capture", web_app: { url: captureUrl } },
      { text: "Calendar", callback_data: "bot:calendar" }
    ],
    [
      { text: "Meetings", web_app: { url: filmUrl } },
      { text: "Sales", callback_data: "bot:sales" }
    ]
  ] : [
    [
      { text: "My tasks", callback_data: "bot:tasks" },
      { text: "Capture", callback_data: "bot:capture" }
    ],
    [
      { text: "Sales", callback_data: "bot:sales" }
    ]
  ];
  return { inline_keyboard: rows };
}

export function dailyCommandKeyboard(config, state = {}) {
  const rows = [];
  for (const [index, task] of (state.nextMoves || []).slice(0, 3).entries()) {
    const prefix = task.source === "sales" ? "task" : "hqtask";
    const row = [
      { text: `Done ${index + 1}`, callback_data: `${prefix}:done:${task.id}` },
      { text: "Tomorrow", callback_data: `${prefix}:snooze:${task.id}` }
    ];
    const taskUrl = task.source === "sales" ? null : telegramMiniAppUrl(config, { taskId: task.id });
    if (taskUrl) row.push({ text: "Open", web_app: { url: taskUrl } });
    rows.push(row);
  }
  const posting = postingCheckKeyboard(state.today, state.pending || [])?.inline_keyboard || [];
  rows.push(...posting);
  const captureUrl = telegramMiniAppUrl(config, { capture: "task" });
  const todayUrl = telegramMiniAppUrl(config, { tab: "today" });
  rows.push(captureUrl ? [
    { text: "Capture", web_app: { url: captureUrl } },
    { text: "My tasks", callback_data: "bot:tasks" },
    { text: "Open today", web_app: { url: todayUrl } }
  ] : [
    { text: "Capture", callback_data: "bot:capture" },
    { text: "My tasks", callback_data: "bot:tasks" }
  ]);
  return { inline_keyboard: rows };
}

export function dailyCloseoutKeyboard(config, prompt = {}) {
  const rows = [];
  if (prompt.goalCheckinPending && prompt.goalTarget && prompt.day) {
    rows.push([
      { text: "Yes — moved it", callback_data: `rhythm:goal:yes:${prompt.day}` },
      { text: "No — mostly noise", callback_data: `rhythm:goal:no:${prompt.day}` }
    ]);
  }
  for (const [index, task] of (prompt.overdueTasks || []).slice(0, 2).entries()) {
    const row = [
      { text: `Done overdue ${index + 1}`, callback_data: `hqtask:done:${task.id}` },
      { text: `Tomorrow ${index + 1}`, callback_data: `hqtask:snooze:${task.id}` }
    ];
    const taskUrl = telegramMiniAppUrl(config, { taskId: task.id });
    if (taskUrl) row.push({ text: "Open", web_app: { url: taskUrl } });
    rows.push(row);
  }
  rows.push(...(postingCheckKeyboard(prompt.day, prompt.pending || [])?.inline_keyboard || []));
  if (prompt.weeklyDue && prompt.weekStart) {
    rows.push(...weeklyResetKeyboard(prompt.weekStart, false).inline_keyboard);
  }
  const todayUrl = telegramMiniAppUrl(config, { tab: "today" });
  const calendarUrl = telegramMiniAppUrl(config, { tab: "calendar" });
  if (todayUrl && calendarUrl) {
    rows.push([
      { text: "Open Home Court", web_app: { url: todayUrl } },
      { text: "Calendar", web_app: { url: calendarUrl } }
    ]);
  }
  return rows.length ? { inline_keyboard: rows } : undefined;
}

function shortButtonLabel(value, limit = 34) {
  const label = String(value || "Task").trim().replace(/\s+/g, " ");
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
}

export function taskCenterKeyboard(config, center = {}) {
  const scope = center.scope === "team" ? "team" : "mine";
  const filter = center.filter === "urgent" ? "urgent" : "all";
  const rows = [[
    { text: scope === "mine" && filter === "all" ? "My tasks ✓" : "My tasks", callback_data: "tasks:mine:all:0" },
    { text: scope === "team" && filter === "all" ? "Team ✓" : "Team", callback_data: "tasks:team:all:0" },
    { text: filter === "urgent" ? "Urgent ✓" : "Urgent", callback_data: `tasks:${scope}:urgent:0` }
  ]];
  for (const task of center.tasks || []) {
    const url = telegramMiniAppUrl(config, { taskId: task.id });
    rows.push([url
      ? { text: `Open ${task.position} · ${shortButtonLabel(task.title)}`, web_app: { url } }
      : { text: `View ${task.position} · ${shortButtonLabel(task.title)}`, callback_data: `tv:${task.id}` }]);
    rows.push([
      { text: "Done", callback_data: `tca:done:${task.id}` },
      { text: "Tomorrow", callback_data: `tca:tomorrow:${task.id}` },
      { text: "Edit", callback_data: `te:${task.id}` },
      { text: "Assign", callback_data: `ta:${task.id}` }
    ]);
  }
  if ((center.pageCount || 1) > 1) {
    const navigation = [];
    if (center.page > 0) navigation.push({ text: "← Previous", callback_data: `tasks:${scope}:${filter}:${center.page - 1}` });
    navigation.push({ text: `${center.page + 1}/${center.pageCount}`, callback_data: "noop" });
    if (center.page < center.pageCount - 1) navigation.push({ text: "Next →", callback_data: `tasks:${scope}:${filter}:${center.page + 1}` });
    rows.push(navigation);
  }
  rows.push([{ text: "Add a task", callback_data: "bot:capture" }]);
  return { inline_keyboard: rows };
}

export function taskEditKeyboard(config, taskId) {
  const rows = [
    [
      { text: "Change date", callback_data: `ted:${taskId}` },
      { text: "Priority", callback_data: `tep:${taskId}` }
    ],
    [
      { text: "Rename", callback_data: `tr:${taskId}` },
      { text: "Assign", callback_data: `ta:${taskId}` }
    ]
  ];
  const url = telegramMiniAppUrl(config, { taskId });
  if (url) rows.push([{ text: "Open full task", web_app: { url } }]);
  rows.push([{ text: "Cancel", callback_data: "ts:cancel" }]);
  return { inline_keyboard: rows };
}

export function taskDateKeyboard(taskId) {
  return {
    inline_keyboard: [
      [
        { text: "Today", callback_data: `td:today:${taskId}` },
        { text: "Tomorrow", callback_data: `td:tomorrow:${taskId}` }
      ],
      [
        { text: "Next week", callback_data: `td:next-week:${taskId}` },
        { text: "No date", callback_data: `td:no-date:${taskId}` }
      ],
      [{ text: "Cancel", callback_data: "ts:cancel" }]
    ]
  };
}

export function taskPriorityKeyboard(taskId) {
  return {
    inline_keyboard: [
      [
        { text: "Low", callback_data: `tp:low:${taskId}` },
        { text: "Normal", callback_data: `tp:normal:${taskId}` },
        { text: "High", callback_data: `tp:high:${taskId}` }
      ],
      [{ text: "Cancel", callback_data: "ts:cancel" }]
    ]
  };
}

export function taskChoiceKeyboard(choices = []) {
  const rows = choices.slice(0, 8).map((choice) => [{
    text: shortButtonLabel(choice.label, 48),
    callback_data: `tc:${choice.id}`
  }]);
  rows.push([{ text: "Cancel", callback_data: "ts:cancel" }]);
  return { inline_keyboard: rows };
}

export function taskMemberKeyboard(choices = []) {
  const rows = choices.slice(0, 12).map((choice) => [{
    text: shortButtonLabel(choice.label, 48),
    callback_data: `tm:${choice.id}`
  }]);
  rows.push([{ text: "Cancel", callback_data: "ts:cancel" }]);
  return { inline_keyboard: rows };
}

export function taskTextKeyboard() {
  return { inline_keyboard: [[{ text: "Cancel", callback_data: "ts:cancel" }]] };
}

export function captureDraftKeyboard(draftId) {
  return {
    inline_keyboard: [[
      { text: "Lock it in", callback_data: `capture:add:${draftId}` },
      { text: "Cancel", callback_data: `capture:cancel:${draftId}` }
    ]]
  };
}

export function captureClarificationKeyboard(step) {
  if (step === "task-date") {
    return {
      inline_keyboard: [
        [
          { text: "Today", callback_data: "capture:reply:today" },
          { text: "Tomorrow", callback_data: "capture:reply:tomorrow" }
        ],
        [
          { text: "Next week", callback_data: "capture:reply:next-week" },
          { text: "No date", callback_data: "capture:reply:no-date" }
        ],
        [{ text: "Cancel", callback_data: "capture:reply:cancel" }]
      ]
    };
  }
  if (step === "platform") {
    return {
      inline_keyboard: [
        [
          { text: "Instagram", callback_data: "capture:reply:instagram" },
          { text: "LinkedIn", callback_data: "capture:reply:linkedin" }
        ],
        [{ text: "Cancel", callback_data: "capture:reply:cancel" }]
      ]
    };
  }
  return undefined;
}

export function captureReceiptKeyboard(config, result = {}) {
  const draft = result.draft || {};
  const route = draft.kind === "task" || draft.kind === "task-update"
    ? { taskId: result.item?.id }
    : draft.kind === "content" || draft.kind === "posted"
      ? { tab: "rhythm" }
      : { tab: "more" };
  const url = telegramMiniAppUrl(config, route);
  return url ? { inline_keyboard: [[{ text: "See it in Home Court", web_app: { url } }]] } : undefined;
}

export function overdueRescueKeyboard(config, task) {
  const row = [
    { text: "Done", callback_data: `hqtask:done:${task.id}` },
    { text: "Tomorrow", callback_data: `hqtask:snooze:${task.id}` }
  ];
  const url = telegramMiniAppUrl(config, { taskId: task.id });
  if (url) row.push({ text: "Open", web_app: { url } });
  return { inline_keyboard: [row] };
}

export function postingCheckKeyboard(day, pending = []) {
  const labels = { instagram: "Posted on Instagram", linkedin: "Posted on LinkedIn" };
  const buttons = pending.filter((platform) => labels[platform]).map((platform) => ({
    text: labels[platform],
    callback_data: `rhythm:post:${platform}:${day}`
  }));
  return buttons.length ? { inline_keyboard: buttons.map((button) => [button]) } : undefined;
}

export function weeklyResetKeyboard(weekStart, saved = false) {
  return {
    inline_keyboard: [[{
      text: saved ? "Edit my reset" : "Start my reset",
      callback_data: `rhythm:review:start:${weekStart}`
    }]]
  };
}

export function hqTaskKeyboard(taskId) {
  return {
    inline_keyboard: [[
      { text: "Done", callback_data: `hqtask:done:${taskId}` },
      { text: "Tomorrow", callback_data: `hqtask:snooze:${taskId}` }
    ]]
  };
}

export function calendarDraftKeyboard(actionId, version) {
  return {
    inline_keyboard: [[
      { text: "Add to calendar", callback_data: `cal:add:${actionId}:${version}` },
      { text: "Edit", callback_data: `cal:edit:${actionId}:${version}` },
      { text: "Cancel", callback_data: `cal:cancel:${actionId}:${version}` }
    ]]
  };
}

export function calendarCenterKeyboard(config, period = "today") {
  const selected = ["today", "tomorrow", "week", "next7"].includes(period) ? period : "today";
  const label = (value, text) => value === selected ? `${text} ✓` : text;
  const action = (value) => value === selected ? "noop" : `cal:center:${value}`;
  const rows = [
    [
      { text: label("today", "Today"), callback_data: action("today") },
      { text: label("tomorrow", "Tomorrow"), callback_data: action("tomorrow") }
    ],
    [
      { text: label("week", "This week"), callback_data: action("week") },
      { text: label("next7", "Next 7 days"), callback_data: action("next7") }
    ],
    [
      { text: "Add event", callback_data: "cal:new" },
      { text: "Move", callback_data: "cal:manage:move" },
      { text: "Cancel event", callback_data: "cal:manage:cancel" }
    ]
  ];
  const url = telegramMiniAppUrl(config, { tab: "calendar" });
  if (url) rows.push([{ text: "Open full calendar", web_app: { url } }]);
  return { inline_keyboard: rows };
}

export function calendarEventSelectionKeyboard(action) {
  const operation = action?.type === "calendar.event.delete" ? "cancel" : "move";
  const rows = (action?.payload?.events || []).slice(0, 8).map((event, index) => [{
    text: shortButtonLabel(event?.label || event?.title || `Event ${index + 1}`, 46),
    callback_data: `cal:select:${operation}:${action.id}:${index}`
  }]);
  rows.push([{ text: "Back to calendar", callback_data: "cal:center:next7" }]);
  return { inline_keyboard: rows };
}

export function calendarMoveChoiceKeyboard(action) {
  return {
    inline_keyboard: [
      [
        { text: "Tomorrow", callback_data: `cal:move:tomorrow:${action.id}:${action.version}` },
        { text: "Next week", callback_data: `cal:move:next-week:${action.id}:${action.version}` }
      ],
      [{ text: "Choose another time", callback_data: `cal:move:custom:${action.id}:${action.version}` }],
      [{ text: "Cancel", callback_data: `cal:event:abort:${action.id}:${action.version}` }]
    ]
  };
}

export function calendarMutationConfirmKeyboard(operation, action) {
  const normalized = operation === "cancel" ? "cancel" : "move";
  return {
    inline_keyboard: [[
      {
        text: normalized === "cancel" ? "Cancel this event" : "Confirm move",
        callback_data: `cal:event:${normalized}:${action.id}:${action.version}`
      },
      { text: "Keep it", callback_data: `cal:event:abort:${action.id}:${action.version}` }
    ]]
  };
}

export function calendarReceiptKeyboard(htmlLink) {
  if (!/^https:\/\/calendar\.google\.com\//.test(String(htmlLink || ""))) return undefined;
  return { inline_keyboard: [[{ text: "Open calendar", url: htmlLink }]] };
}

export function feedbackKeyboard(prospectId) {
  return {
    inline_keyboard: [[
      { text: "Pursue", callback_data: `lead:pursue:${prospectId}` },
      { text: "Watch", callback_data: `lead:watch:${prospectId}` },
      { text: "Skip", callback_data: `lead:skip:${prospectId}` }
    ]]
  };
}

export function pipelineKeyboard(prospectId) {
  return {
    inline_keyboard: [
      [
        { text: "Contacted", callback_data: `stage:contacted:${prospectId}` },
        { text: "Replied", callback_data: `stage:replied:${prospectId}` },
        { text: "Meeting", callback_data: `stage:meeting:${prospectId}` }
      ],
      [
        { text: "Proposal", callback_data: `stage:proposal:${prospectId}` },
        { text: "Won", callback_data: `stage:won:${prospectId}` },
        { text: "Lost", callback_data: `stage:lost:${prospectId}` }
      ]
    ]
  };
}

export function taskKeyboard(taskId) {
  return {
    inline_keyboard: [[
      { text: "Done", callback_data: `task:done:${taskId}` },
      { text: "Tomorrow", callback_data: `task:snooze:${taskId}` }
    ]]
  };
}

export async function configureTelegramBot(config) {
  const scope = { type: "chat", chat_id: requireSetting(config.runtime.telegramOwnerChatId, "TELEGRAM_OWNER_CHAT_ID") };
  await callTelegram(config, "setMyCommands", {
    scope,
    commands: [
      { command: "today", description: "The short version of your day" },
      { command: "tasks", description: "Your task command center" },
      { command: "capture", description: "Add a task, event, post, or note" },
      { command: "posts", description: "Instagram and LinkedIn streaks" },
      { command: "review", description: "Your guided Sunday reset" },
      { command: "calendar", description: "View, add, move, or cancel events" },
      { command: "film", description: "Record and review meeting notes" },
      { command: "sales", description: "Leads and pipeline decisions" },
      { command: "hq", description: "Open the full Home Court" },
      { command: "help", description: "Examples and secondary actions" }
    ]
  });
  await callTelegram(config, "setMyDescription", {
    description: "Agent4 is your private daily operator: priorities, meeting notes, quick capture, posting streaks, calendar, sales decisions, and a guided weekly reset. Nothing is sent externally without you."
  });
  await callTelegram(config, "setMyShortDescription", {
    short_description: "Agent4 · Run the day. Keep the streak. Close the loop."
  });
  const miniAppUrl = telegramMiniAppUrl(config);
  if (miniAppUrl) {
    await callTelegram(config, "setChatMenuButton", {
      chat_id: scope.chat_id,
      menu_button: { type: "web_app", text: "Home Court", web_app: { url: miniAppUrl } }
    });
  }
  return true;
}

export function publicTelegramLink(config, draftText) {
  const username = config.runtime.publicTelegramUsername;
  if (!username) return null;
  return `https://t.me/${encodeURIComponent(username)}?text=${encodeURIComponent(draftText)}`;
}

export async function getUpdates(config, offset, timeout = 20) {
  return callTelegram(config, "getUpdates", {
    offset,
    timeout,
    allowed_updates: ["callback_query", "message"]
  });
}

export async function getUpdatesWithRetry(config, offset, timeout = 20, {
  attempts = 5,
  getUpdatesImpl = getUpdates,
  sleepImpl = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  onRetry = () => {}
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new RangeError("Telegram poll retry attempts must be an integer from 1 to 10.");
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await getUpdatesImpl(config, offset, timeout);
    } catch (error) {
      if (attempt === attempts) throw error;
      const delayMs = Math.min(5_000, 500 * (2 ** (attempt - 1)));
      const code = String(error?.code || error?.name || "TELEGRAM_POLL_FAILED")
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 80);
      onRetry({ attempt, code, delayMs });
      await sleepImpl(delayMs);
    }
  }
  throw new Error("Telegram polling failed.");
}

export async function answerCallback(config, callbackQueryId, text) {
  return callTelegram(config, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false
  });
}

export async function editKeyboard(config, callbackQuery, label) {
  if (!callbackQuery.message) return;
  return callTelegram(config, "editMessageReplyMarkup", {
    chat_id: callbackQuery.message.chat.id,
    message_id: callbackQuery.message.message_id,
    reply_markup: { inline_keyboard: [[{ text: label, callback_data: "noop" }]] }
  });
}

export async function editReplyMarkup(config, callbackQuery, replyMarkup) {
  if (!callbackQuery.message) return;
  return callTelegram(config, "editMessageReplyMarkup", {
    chat_id: callbackQuery.message.chat.id,
    message_id: callbackQuery.message.message_id,
    reply_markup: replyMarkup || { inline_keyboard: [] }
  });
}
