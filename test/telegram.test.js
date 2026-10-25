import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDraftKeyboard,
  calendarCenterKeyboard,
  calendarEventSelectionKeyboard,
  calendarMoveChoiceKeyboard,
  calendarMutationConfirmKeyboard,
  captureClarificationKeyboard,
  captureDraftKeyboard,
  dailyCloseoutKeyboard,
  dailyCommandKeyboard,
  feedbackKeyboard,
  filmRoomKeyboard,
  getUpdatesWithRetry,
  hqTaskKeyboard,
  mainMenuKeyboard,
  miniAppKeyboard,
  operatorActionsKeyboard,
  pipelineKeyboard,
  postingCheckKeyboard,
  publicTelegramLink,
  readTelegramResponseBounded,
  taskKeyboard,
  taskCenterKeyboard,
  taskChoiceKeyboard,
  taskDateKeyboard,
  taskEditKeyboard,
  taskMemberKeyboard,
  taskPriorityKeyboard,
  taskTextKeyboard,
  telegramMiniAppUrl,
  weeklyResetKeyboard
} from "../src/telegram.js";

test("Home Court Mini App links only use the configured HTTPS HQ origin", () => {
  const config = { runtime: { agent4PublicUrl: "https://hq.example.com/base/" } };
  assert.equal(telegramMiniAppUrl(config), "https://hq.example.com/telegram");
  assert.equal(telegramMiniAppUrl(config, { tab: "calendar" }), "https://hq.example.com/telegram?tab=calendar");
  assert.equal(telegramMiniAppUrl(config, { tab: "film" }), "https://hq.example.com/telegram?tab=film");
  assert.equal(telegramMiniAppUrl(config, { capture: "task" }), "https://hq.example.com/telegram?capture=task");
  assert.deepEqual(miniAppKeyboard(config), {
    inline_keyboard: [[{ text: "Open Home Court", web_app: { url: "https://hq.example.com/telegram" } }]]
  });
  assert.equal(filmRoomKeyboard(config).inline_keyboard[0][0].web_app.url, "https://hq.example.com/telegram?tab=film");
  assert.equal(telegramMiniAppUrl({ runtime: { agent4PublicUrl: "http://127.0.0.1:8799" } }), null);
  assert.equal(miniAppKeyboard({ runtime: {} }), undefined);
  assert.equal(operatorActionsKeyboard(config).inline_keyboard[0][0].web_app.url, "https://hq.example.com/telegram?tab=today");
  const actionButtons = operatorActionsKeyboard(config).inline_keyboard.flat();
  assert.equal(actionButtons.find((button) => button.text === "Calendar").callback_data, "bot:calendar");
  assert.equal(actionButtons.find((button) => button.text === "My tasks").callback_data, "bot:tasks");
  assert.equal(actionButtons.find((button) => button.text === "Meetings").web_app.url, "https://hq.example.com/telegram?tab=film");
  const calendarCenter = calendarCenterKeyboard(config, "today");
  assert.equal(calendarCenter.inline_keyboard[0][0].callback_data, "noop");
  assert.equal(calendarCenter.inline_keyboard.at(-1)[0].web_app.url, "https://hq.example.com/telegram?tab=calendar");
});

test("the daily command card carries real actions and exact Home Court links", () => {
  const config = { runtime: { agent4PublicUrl: "https://hq.example.com" } };
  const keyboard = dailyCommandKeyboard(config, {
    today: "2026-08-30",
    pending: ["instagram"],
    nextMoves: [{ id: "550e8400-e29b-41d4-a716-446655440000", source: "hq", title: "Send proposal" }]
  });
  assert.equal(keyboard.inline_keyboard[0][0].callback_data, "hqtask:done:550e8400-e29b-41d4-a716-446655440000");
  assert.match(keyboard.inline_keyboard[0][2].web_app.url, /tab=more&task=550e8400-e29b-41d4-a716-446655440000/);
  assert.equal(keyboard.inline_keyboard[1][0].callback_data, "rhythm:post:instagram:2026-08-30");
  assert.equal(keyboard.inline_keyboard.at(-1)[0].web_app.url, "https://hq.example.com/telegram?capture=task");
});

test("the evening closeout combines task, posting, reset, and dashboard actions", () => {
  const config = { runtime: { agent4PublicUrl: "https://hq.example.com" } };
  const taskId = "550e8400-e29b-41d4-a716-446655440000";
  const keyboard = dailyCloseoutKeyboard(config, {
    day: "2026-08-30",
    goalCheckinPending: true,
    goalTarget: "Book three useful conversations",
    pending: ["instagram"],
    overdueTasks: [{ id: taskId, title: "Send proposal" }],
    weeklyDue: true,
    weekStart: "2026-08-24"
  });
  assert.equal(keyboard.inline_keyboard[0][0].callback_data, "rhythm:goal:yes:2026-08-30");
  assert.equal(keyboard.inline_keyboard[0][1].callback_data, "rhythm:goal:no:2026-08-30");
  assert.equal(keyboard.inline_keyboard[1][0].callback_data, `hqtask:done:${taskId}`);
  assert.equal(keyboard.inline_keyboard[1][1].callback_data, `hqtask:snooze:${taskId}`);
  assert.equal(keyboard.inline_keyboard[2][0].callback_data, "rhythm:post:instagram:2026-08-30");
  assert.equal(keyboard.inline_keyboard[3][0].callback_data, "rhythm:review:start:2026-08-24");
  assert.equal(keyboard.inline_keyboard.at(-1)[0].web_app.url, "https://hq.example.com/telegram?tab=today");
  assert.equal(keyboard.inline_keyboard.at(-1)[1].web_app.url, "https://hq.example.com/telegram?tab=calendar");
});

test("public Telegram links carry a prefilled Persian message", () => {
  const config = { runtime: { publicTelegramUsername: "workspace" } };
  const link = publicTelegramLink(config, "سلام، درباره سایت پیام می‌دهم");
  assert.match(link, /^https:\/\/t\.me\/workspace\?text=/);
  assert.equal(decodeURIComponent(new URL(link).searchParams.get("text")), "سلام، درباره سایت پیام می‌دهم");
});

test("feedback callback payload stays compact", () => {
  const taskId = "550e8400-e29b-41d4-a716-446655440000";
  const calendarAction = {
    id: taskId,
    version: 2,
    type: "calendar.event.update",
    payload: { events: [{ title: "Partner meeting" }] }
  };
  const keyboards = [
    feedbackKeyboard("example-com-1234567890"),
    pipelineKeyboard("example-com-1234567890"),
    taskKeyboard(taskId),
    hqTaskKeyboard(taskId),
    taskCenterKeyboard({}, { scope: "mine", filter: "all", page: 0, pageCount: 2, tasks: [{ id: taskId, title: "Send the proposal", position: 1 }] }),
    taskEditKeyboard({}, taskId),
    taskDateKeyboard(taskId),
    taskPriorityKeyboard(taskId),
    taskChoiceKeyboard([{ id: taskId, label: "Send the proposal" }]),
    taskMemberKeyboard([{ id: "user-armin", label: "Armin" }]),
    taskTextKeyboard(),
    calendarDraftKeyboard(taskId, 2),
    calendarCenterKeyboard({}, "next7"),
    calendarEventSelectionKeyboard(calendarAction),
    calendarMoveChoiceKeyboard(calendarAction),
    calendarMutationConfirmKeyboard("move", calendarAction),
    captureClarificationKeyboard("task-date"),
    captureClarificationKeyboard("platform"),
    captureDraftKeyboard("550e8400-e29b-41d4-a716-446655440000"),
    operatorActionsKeyboard(),
    dailyCloseoutKeyboard({}, { day: "2026-08-30", goalCheckinPending: true, goalTarget: "Book three calls", pending: ["instagram"], overdueTasks: [{ id: taskId }], weeklyDue: true, weekStart: "2026-08-24" }),
    postingCheckKeyboard("2026-08-30", ["instagram", "linkedin"]),
    weeklyResetKeyboard("2026-08-24")
  ];
  for (const keyboard of keyboards) {
    for (const row of keyboard.inline_keyboard) for (const button of row) {
      if (button.callback_data) assert.ok(Buffer.byteLength(button.callback_data, "utf8") <= 64);
    }
  }
});

test("the task center exposes grouped task controls and exact task links", () => {
  const config = { runtime: { agent4PublicUrl: "https://hq.example.com" } };
  const taskId = "550e8400-e29b-41d4-a716-446655440000";
  const keyboard = taskCenterKeyboard(config, {
    scope: "mine",
    filter: "all",
    page: 0,
    pageCount: 2,
    tasks: [{ id: taskId, title: "Send the revised proposal", position: 1 }]
  });
  assert.equal(keyboard.inline_keyboard[0][0].text, "My tasks ✓");
  assert.match(keyboard.inline_keyboard[1][0].web_app.url, new RegExp(`task=${taskId}`));
  assert.deepEqual(
    keyboard.inline_keyboard[2].map((button) => button.text),
    ["Done", "Tomorrow", "Edit", "Assign"]
  );
  assert.equal(keyboard.inline_keyboard.at(-1)[0].callback_data, "bot:capture");
});

test("capture clarification keyboards expose the choices they ask for", () => {
  const dateChoices = captureClarificationKeyboard("task-date").inline_keyboard.flat();
  assert.deepEqual(dateChoices.map((button) => button.text), ["Today", "Tomorrow", "Next week", "No date", "Cancel"]);
  assert.deepEqual(
    dateChoices.map((button) => button.callback_data),
    ["capture:reply:today", "capture:reply:tomorrow", "capture:reply:next-week", "capture:reply:no-date", "capture:reply:cancel"]
  );
  assert.deepEqual(
    captureClarificationKeyboard("platform").inline_keyboard.flat().map((button) => button.text),
    ["Instagram", "LinkedIn", "Cancel"]
  );
});

test("Telegram voice downloads are streamed and cancelled at the byte limit", async () => {
  let cancelled = false;
  const response = new globalThis.Response(new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
    },
    cancel() {
      cancelled = true;
    }
  }));

  await assert.rejects(
    readTelegramResponseBounded(response, 5),
    /private processing limit/
  );
  assert.equal(cancelled, true);

  const accepted = await readTelegramResponseBounded(
    new globalThis.Response(new Uint8Array([1, 2, 3, 4])),
    4
  );
  assert.deepEqual([...accepted], [1, 2, 3, 4]);
});

test("Telegram polling retries transient failures without exposing provider details", async () => {
  let calls = 0;
  const delays = [];
  const retries = [];
  const result = await getUpdatesWithRetry({}, 42, 20, {
    attempts: 4,
    getUpdatesImpl: async (_config, offset, timeout) => {
      calls += 1;
      assert.equal(offset, 42);
      assert.equal(timeout, 20);
      if (calls < 3) throw Object.assign(new Error("secret provider body"), { name: "AbortError" });
      return [{ update_id: 42 }];
    },
    sleepImpl: async (delayMs) => { delays.push(delayMs); },
    onRetry: (retry) => { retries.push(retry); }
  });

  assert.deepEqual(result, [{ update_id: 42 }]);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1000]);
  assert.deepEqual(retries.map(({ code }) => code), ["AbortError", "AbortError"]);
  assert.doesNotMatch(JSON.stringify(retries), /secret provider body/);

  await assert.rejects(
    getUpdatesWithRetry({}, 1, 0, {
      attempts: 2,
      getUpdatesImpl: async () => { throw new Error("still down"); },
      sleepImpl: async () => {}
    }),
    /still down/
  );
});
