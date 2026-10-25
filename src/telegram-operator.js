import { buildWeeklyGamePlan } from "./weekly-plan.js";

const PLATFORMS = ["instagram", "linkedin"];

function localClock(value, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  }).formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday
  };
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekBounds(value) {
  const date = new Date(`${value}T12:00:00Z`);
  const sinceMonday = date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1;
  const start = shiftDate(value, -sinceMonday);
  return { start, end: shiftDate(start, 6) };
}

function shortDate(value) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}

function dayLabel(value) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

function platformLabel(platform) {
  return platform === "linkedin" ? "LinkedIn" : "Instagram";
}

function latestStatus(summary, platform, today) {
  const daily = summary?.platforms?.[platform]?.daily || [];
  const latest = daily[daily.length - 1];
  return latest?.day === today ? latest.status : "off";
}

function pendingPlatforms(summary, today) {
  return PLATFORMS.filter((platform) => latestStatus(summary, platform, today) === "pending");
}

function dueLabel(task, today) {
  if (!task.dueOn) return "No due date";
  if (task.dueOn < today) return "Overdue";
  if (task.dueOn === today) return "Today";
  if (task.dueOn === shiftDate(today, 1)) return "Tomorrow";
  return shortDate(task.dueOn);
}

function cleanReply(value, limit = 2000) {
  const text = String(value || "").trim().slice(0, limit);
  return /^skip$/i.test(text) ? "" : text;
}

function escapeTelegramHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function captureKindLabel(kind) {
  return {
    task: "TASK",
    "task-update": "TASK UPDATE",
    content: "CONTENT PLAN",
    posted: "POST CHECK",
    note: "SALES NOTE"
  }[kind] || "CAPTURE";
}

export function createTelegramOperator({
  actorId,
  taskStore,
  contentStore,
  plannerStore,
  scoutStore,
  membersProvider = () => [],
  timeZone = "Europe/Istanbul",
  morningBriefAt = "08:30",
  weeklyResetAt = "18:00",
  now = () => new Date()
}) {
  if (!actorId || !taskStore || !contentStore || !plannerStore) throw new TypeError("Telegram operator needs the HQ owner and stores.");

  function clock(date = now()) {
    return localClock(date, timeZone);
  }

  function members() {
    try {
      const provided = membersProvider?.() || [];
      return provided.some((member) => member.id === actorId)
        ? provided
        : [{ id: actorId, name: "You", role: "owner" }, ...provided];
    } catch {
      return [{ id: actorId, name: "You", role: "owner" }];
    }
  }

  function memberLabel(memberId) {
    if (!memberId) return "Unassigned";
    if (memberId === actorId) return "You";
    return members().find((member) => member.id === memberId)?.name || "Teammate";
  }

  function getTask(taskId, { includeDone = true } = {}) {
    return taskStore.listTasks({ includeDone, limit: 1000 }).find((task) => task.id === taskId) || null;
  }

  function snapshot(today = clock().date) {
    const tasks = taskStore.listTasks({ assigneeId: actorId, includeDone: true, limit: 1000 });
    const activeTasks = tasks.filter((task) => task.status !== "done");
    const content = contentStore.contentSummary({ actorId, today, cadenceDays: 35 });
    const momentum = contentStore.momentum({ actorId, tasks, today, days: 35 });
    const events = plannerStore.listEvents({ actorId, from: today, to: today });
    const leads = scoutStore?.listProspects?.({ statuses: ["new", "watch", "pursue"] }) || [];
    const salesTasks = (scoutStore?.listTasks?.() || []).map((task) => ({
      ...task,
      dueOn: task.dueAt ? String(task.dueAt).slice(0, 10) : null,
      project: task.prospectId ? scoutStore?.state?.prospects?.[task.prospectId]?.name || "Sales follow-up" : "Sales follow-up",
      source: "sales"
    }));
    const candidateMoves = [
      ...activeTasks.map((task) => ({ ...task, source: "hq" })),
      ...salesTasks
    ].sort((left, right) => String(left.dueOn || "9999-12-31").localeCompare(String(right.dueOn || "9999-12-31")));
    const week = weekBounds(today);
    const review = plannerStore.getWeeklyReview(actorId, week.start);
    const targetReview = plannerStore.getWeeklyReview(actorId, shiftDate(week.start, -7));
    const gamePlan = buildWeeklyGamePlan({ today, review: targetReview, tasks: candidateMoves, targetWeekStart: week.start });
    const nextMoves = gamePlan.moves;
    const goalCheckins = plannerStore.listGoalCheckins({ actorId, from: week.start, to: today })
      .filter((checkin) => checkin.target === gamePlan.target);
    const goalCheckin = goalCheckins.find((checkin) => checkin.day === today) || null;
    const previousCheckin = plannerStore.getGoalCheckin(actorId, shiftDate(today, -1));
    const previousGoalCheckin = previousCheckin?.target === gamePlan.target ? previousCheckin : null;
    const goalProgress = {
      checkedDays: goalCheckins.length,
      movedDays: goalCheckins.filter((checkin) => checkin.movedTarget).length,
      missedDays: goalCheckins.filter((checkin) => !checkin.movedTarget).length
    };
    const misses = PLATFORMS.reduce((total, platform) => total + content.platforms[platform].daily
      .filter((item) => item.day >= week.start && item.day <= today && item.status === "missed").length, 0);
    return {
      today,
      week,
      tasks,
      activeTasks,
      salesTasks,
      nextMoves,
      events,
      content,
      momentum,
      leads,
      review,
      targetReview,
      gamePlan,
      goalCheckin,
      previousGoalCheckin,
      goalProgress,
      /* The content plan is out of the daily flow, so nothing is ever "pending". */
      pending: [],
      summary: {
        instagramPosts: content.platforms.instagram.published,
        linkedinPosts: content.platforms.linkedin.published,
        tasksDone: tasks.filter((task) => task.completedAt && String(task.completedAt).slice(0, 10) >= week.start && String(task.completedAt).slice(0, 10) <= week.end).length,
        overdueTasks: activeTasks.filter((task) => task.dueOn && task.dueOn < today).length,
        momentumPoints: momentum.weeklyPoints,
        postingMisses: misses
      }
    };
  }

  function formatToday(today = clock().date, { agenda = [] } = {}) {
    const state = snapshot(today);
    const calendarItems = [...state.events, ...(agenda || [])];
    const lines = [`TODAY · ${dayLabel(today)}`, ""];
    lines.push("THIS WEEK'S TARGET", state.gamePlan.target || "No target locked yet.");
    if (state.gamePlan.needsGoalTask) lines.push("Planning gap · No task on the board clearly supports it yet.");
    if (state.previousGoalCheckin?.day >= state.week.start) {
      lines.push(state.previousGoalCheckin.movedTarget
        ? "Yesterday moved the target. Keep the chain alive."
        : "Yesterday was motion, not progress. Start with the target move.");
    }
    if (state.goalProgress.checkedDays) lines.push(`Target days · ${state.goalProgress.movedDays} moved / ${state.goalProgress.checkedDays} checked`);
    lines.push("");
    if (state.nextMoves.length) {
      lines.push("DO THIS FIRST");
      for (const [index, task] of state.nextMoves.slice(0, 3).entries()) {
        lines.push(`${index + 1}. ${task.title} · ${dueLabel(task, today)}`);
        lines.push(`   ${task.reason}`);
      }
    } else {
      lines.push("NEXT MOVE", "Your task list is clear. Capture the one thing that would make today count.");
    }
    lines.push("", "AT A GLANCE");
    lines.push(`Calendar · ${calendarItems.length ? `${calendarItems.length} ${calendarItems.length === 1 ? "event" : "events"}${calendarItems[0]?.title ? ` · ${calendarItems[0].title}` : ""}` : "Clear"}`);
    lines.push(`Sales · ${state.leads.length ? `${state.leads.length} ${state.leads.length === 1 ? "lead" : "leads"} to review` : "No decisions waiting"}`);
    if (clock(new Date(`${today}T12:00:00Z`)).weekday === "Sun") {
      lines.push(state.review ? `Sunday reset saved · Focus: ${state.review.nextFocus || "Review complete"}` : "Sunday reset is ready when you are.");
    }
    return lines.join("\n");
  }

  function formatTodayHtml(today = clock().date, { agenda = [] } = {}) {
    const state = snapshot(today);
    const calendarItems = [...state.events, ...(agenda || [])];
    const lines = [`<b>🏀 TODAY · ${escapeTelegramHtml(dayLabel(today))}</b>`, ""];
    lines.push(
      "<b>🎯 THIS WEEK'S TARGET</b>",
      state.gamePlan.target ? `<b>${escapeTelegramHtml(state.gamePlan.target)}</b>` : "<i>No target locked yet.</i>"
    );
    if (state.gamePlan.needsGoalTask) lines.push("<i>⚠️ No task on the board clearly supports it yet.</i>");
    if (state.previousGoalCheckin?.day >= state.week.start) {
      lines.push(state.previousGoalCheckin.movedTarget
        ? "<i>Yesterday moved the target. Keep the chain alive.</i>"
        : "<i>Yesterday was motion, not progress. Start with the target move.</i>");
    }
    if (state.goalProgress.checkedDays) lines.push(`<code>${state.goalProgress.movedDays}/${state.goalProgress.checkedDays}</code> target days moved this week`);
    lines.push("");
    if (state.nextMoves.length) {
      lines.push("<b>🔥 DO THIS FIRST</b>");
      for (const [index, task] of state.nextMoves.slice(0, 3).entries()) {
        lines.push(`<b>${index + 1}. ${escapeTelegramHtml(task.title)}</b>`, `<i>${escapeTelegramHtml(task.reason)} · ${escapeTelegramHtml(dueLabel(task, today))}</i>`);
      }
    } else {
      lines.push("<b>🔥 NEXT MOVE</b>", "<i>Your list is clear. Capture the one thing that would make today count.</i>");
    }
    lines.push("", "<b>👀 AT A GLANCE</b>");
    lines.push(`📅 Calendar · ${calendarItems.length ? `<b>${calendarItems.length} ${calendarItems.length === 1 ? "event" : "events"}</b>${calendarItems[0]?.title ? ` · ${escapeTelegramHtml(calendarItems[0].title)}` : ""}` : "Clear"}`);
    lines.push(`🤝 Sales · ${state.leads.length ? `<b>${state.leads.length} ${state.leads.length === 1 ? "lead" : "leads"}</b> to review` : "No decisions waiting"}`);
    if (clock(new Date(`${today}T12:00:00Z`)).weekday === "Sun") {
      lines.push(state.review
        ? `Sunday reset saved · Focus: <b>${escapeTelegramHtml(state.review.nextFocus || "Review complete")}</b>`
        : "<i>Sunday reset is ready when you are.</i>");
    }
    return lines.join("\n");
  }

  function formatTasks(today = clock().date) {
    return taskCenter({ today }).message;
  }

  function taskCenter({ scope = "mine", filter = "all", page = 0, pageSize = 5, today = clock().date } = {}) {
    const all = taskStore.listTasks({ includeDone: false, today: new Date(`${today}T12:00:00Z`), limit: 1000 });
    const scoped = scope === "team" ? all : all.filter((task) => task.assigneeId === actorId);
    const visible = filter === "urgent"
      ? scoped.filter((task) => task.priority === "high" || (task.dueOn && task.dueOn <= today))
      : scoped;
    const grouped = [
      ["overdue", "OVERDUE", visible.filter((task) => task.dueOn && task.dueOn < today)],
      ["today", "TODAY", visible.filter((task) => task.dueOn === today)],
      ["upcoming", "UPCOMING", visible.filter((task) => task.dueOn && task.dueOn > today)],
      ["no-date", "NO DATE", visible.filter((task) => !task.dueOn)]
    ];
    const ordered = grouped.flatMap(([group, groupLabel, tasks]) => tasks.map((task) => ({ ...task, group, groupLabel })));
    const boundedSize = Math.max(1, Math.min(8, Number(pageSize) || 5));
    const pageCount = Math.max(1, Math.ceil(ordered.length / boundedSize));
    const selectedPage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
    const pageTasks = ordered.slice(selectedPage * boundedSize, (selectedPage + 1) * boundedSize);
    const heading = filter === "urgent"
      ? scope === "team" ? "TEAM URGENT TASKS" : "MY URGENT TASKS"
      : scope === "team" ? "TEAM TASKS" : "MY TASKS";
    const lines = [
      `${heading} · ${ordered.length} ACTIVE`,
      `Page ${selectedPage + 1}/${pageCount} · ${grouped[0][2].length} overdue · ${grouped[1][2].length} today`,
      ""
    ];
    const htmlLines = [
      `<b>${heading}</b>`,
      `<code>${ordered.length} active</code> · Page ${selectedPage + 1}/${pageCount} · ${grouped[0][2].length} overdue · ${grouped[1][2].length} today`,
      ""
    ];
    if (!pageTasks.length) {
      const empty = filter === "urgent"
        ? "Nothing urgent. The list can breathe."
        : scope === "team" ? "The team board is clear." : "Your list is clear. Capture the next real move.";
      lines.push(empty);
      htmlLines.push(`<i>${escapeTelegramHtml(empty)}</i>`);
    } else {
      let lastGroup = null;
      for (const [index, task] of pageTasks.entries()) {
        if (task.group !== lastGroup) {
          if (lastGroup) lines.push("");
          lines.push(task.groupLabel);
          if (lastGroup) htmlLines.push("");
          const icon = { overdue: "🔴", today: "🟡", upcoming: "🔵", "no-date": "⚪️" }[task.group] || "•";
          htmlLines.push(`<b>${icon} ${task.groupLabel}</b>`);
          lastGroup = task.group;
        }
        const position = selectedPage * boundedSize + index + 1;
        const meta = [memberLabel(task.assigneeId), task.project || "General", dueLabel(task, today)];
        if (task.status === "doing") meta.push("In progress");
        if (task.priority === "high") meta.push("High priority");
        lines.push(`${position}. ${task.title}`, `   ${meta.join(" · ")}`);
        htmlLines.push(
          `<b>${position}. ${escapeTelegramHtml(task.title)}</b>`,
          `<i>${meta.map(escapeTelegramHtml).join(" · ")}</i>`
        );
      }
      lines.push("", "Open a task, or use the action row beneath it.");
      htmlLines.push("", "<i>Open a task, or use the action row beneath it.</i>");
    }
    return {
      handled: true,
      kind: "task-center",
      message: lines.join("\n"),
      messageHtml: htmlLines.join("\n"),
      scope,
      filter,
      page: selectedPage,
      pageCount,
      pageSize: boundedSize,
      total: ordered.length,
      tasks: pageTasks.map((task, index) => ({ ...task, position: selectedPage * boundedSize + index + 1 })),
      members: members()
    };
  }

  function taskDetail(taskId, today = clock().date) {
    const task = getTask(taskId);
    if (!task) return { handled: true, message: "That task no longer exists." };
    return {
      handled: true,
      task,
      message: [
        "TASK",
        task.title,
        "",
        `Owner · ${memberLabel(task.assigneeId)}`,
        `Due · ${dueLabel(task, today)}`,
        `Priority · ${task.priority}`,
        `Status · ${task.status === "doing" ? "In progress" : task.status}`,
        task.project ? `Project · ${task.project}` : null,
        task.notes ? `\n${task.notes}` : null
      ].filter(Boolean).join("\n"),
      messageHtml: [
        "<b>TASK</b>",
        `<b>${escapeTelegramHtml(task.title)}</b>`,
        "",
        `Owner · <b>${escapeTelegramHtml(memberLabel(task.assigneeId))}</b>`,
        `Due · <b>${escapeTelegramHtml(dueLabel(task, today))}</b>`,
        `Priority · <b>${escapeTelegramHtml(task.priority)}</b>`,
        `Status · <b>${escapeTelegramHtml(task.status === "doing" ? "In progress" : task.status)}</b>`,
        task.project ? `Project · ${escapeTelegramHtml(task.project)}` : null,
        task.notes ? `\n<i>${escapeTelegramHtml(task.notes)}</i>` : null
      ].filter(Boolean).join("\n")
    };
  }

  function formatPostCheck(today = clock().date) {
    const state = snapshot(today);
    const settings = plannerStore.getReminderSettings(actorId);
    return [
      `POST CHECK · ${shortDate(today)}`,
      "",
      ...PLATFORMS.map((platform) => {
        const status = latestStatus(state.content, platform, today);
        const cadence = state.content.platforms[platform];
        return `${platformLabel(platform)} · ${status === "posted" ? "Posted" : "Waiting"} · ${cadence.streak}d streak`;
      }),
      "",
      settings.enabled ? `Evening closeout · ${settings.remindAt}` : "Evening closeout · Off"
    ].join("\n");
  }

  function formatPostCheckHtml(today = clock().date) {
    const state = snapshot(today);
    const settings = plannerStore.getReminderSettings(actorId);
    const lines = [`<b>📣 POST CHECK · ${escapeTelegramHtml(shortDate(today))}</b>`, ""];
    for (const platform of PLATFORMS) {
      const status = latestStatus(state.content, platform, today);
      const cadence = state.content.platforms[platform];
      const marker = status === "posted" ? "🟢" : "🟡";
      lines.push(`${marker} <b>${platformLabel(platform)}</b>`, `<i>${status === "posted" ? "Posted today" : "Still waiting"} · ${cadence.streak}d streak</i>`, "");
    }
    lines.push(settings.enabled ? `⏰ Evening closeout · <code>${escapeTelegramHtml(settings.remindAt)}</code>` : "⏰ Evening closeout · Off");
    return lines.join("\n").trim();
  }

  function formatWeeklyReset(today = clock().date) {
    const state = snapshot(today);
    const summary = state.summary;
    const lines = [
      `SUNDAY RESET · ${shortDate(state.week.start)}–${shortDate(state.week.end)}`,
      "",
      `${summary.tasksDone} tasks finished · ${summary.momentumPoints} momentum points`,
      `${summary.overdueTasks} overdue tasks`
    ];
    if (state.review) {
      const targetWeekStart = shiftDate(state.week.start, 7);
      const plan = buildWeeklyGamePlan({
        today: targetWeekStart,
        review: state.review,
        tasks: [...state.activeTasks.map((task) => ({ ...task, source: "hq" })), ...state.salesTasks],
        targetWeekStart
      });
      lines.push("", "NEXT WEEK'S TARGET", state.review.nextFocus || "Review saved.", "", "FIRST MOVES");
      if (plan.moves.length) for (const [index, task] of plan.moves.entries()) lines.push(`${index + 1}. ${task.title} · ${task.reason}`);
      else lines.push("No move is on the board yet. Capture the first one.");
      if (plan.needsGoalTask) lines.push("Planning gap · None of these tasks clearly supports the target yet.");
    } else {
      lines.push("", "The facts are ready. Take ten minutes to choose what to repeat, change, and focus on.");
    }
    return lines.join("\n");
  }

  function formatWeeklyResetHtml(today = clock().date) {
    const state = snapshot(today);
    const summary = state.summary;
    const lines = [
      `<b>🏁 SUNDAY RESET · ${escapeTelegramHtml(shortDate(state.week.start))}–${escapeTelegramHtml(shortDate(state.week.end))}</b>`,
      "",
      `✅ <b>${summary.tasksDone}</b> tasks finished · <b>${summary.momentumPoints}</b> momentum points`,
      `🔴 <b>${summary.overdueTasks}</b> overdue tasks`
    ];
    if (state.review) {
      const targetWeekStart = shiftDate(state.week.start, 7);
      const plan = buildWeeklyGamePlan({
        today: targetWeekStart,
        review: state.review,
        tasks: [...state.activeTasks.map((task) => ({ ...task, source: "hq" })), ...state.salesTasks],
        targetWeekStart
      });
      lines.push("", "<b>🎯 NEXT WEEK'S TARGET</b>", `<b>${escapeTelegramHtml(state.review.nextFocus || "Review saved.")}</b>`, "", "<b>🔥 FIRST MOVES</b>");
      if (plan.moves.length) for (const [index, task] of plan.moves.entries()) lines.push(`<b>${index + 1}. ${escapeTelegramHtml(task.title)}</b>`, `<i>${escapeTelegramHtml(task.reason)}</i>`);
      else lines.push("<i>No move is on the board yet. Capture the first one.</i>");
      if (plan.needsGoalTask) lines.push("<i>⚠️ None of these tasks clearly supports the target yet.</i>");
    } else {
      lines.push("", "<i>The facts are ready. Take ten minutes to choose what to repeat, change, and focus on.</i>");
    }
    return lines.join("\n");
  }

  function formatDailyCloseout(today = clock().date, { pending = [], overdueTasks = [], overdueCount = overdueTasks.length, weeklyDue = false, goalCheckinPending = false } = {}) {
    const state = snapshot(today);
    const lines = [
      `CLOSE THE LOOP · ${shortDate(today)}`,
      "One card. Finish what matters, move what does not."
    ];
    if (goalCheckinPending && state.gamePlan.target) {
      lines.push("", "TARGET CHECK", state.gamePlan.target, "Did today move it?");
    }
    if (pending.length) {
      lines.push("", "POSTING", `${pending.map(platformLabel).join(" + ")} · Waiting`);
    }
    if (overdueTasks.length) {
      lines.push("", `OVERDUE · ${overdueCount}`);
      for (const [index, task] of overdueTasks.entries()) lines.push(`${index + 1}. ${task.title}`);
      if (overdueCount > overdueTasks.length) lines.push(`+ ${overdueCount - overdueTasks.length} more in Home Court`);
    }
    if (weeklyDue) {
      lines.push(
        "",
        "SUNDAY RESET",
        `${state.summary.tasksDone} tasks finished · ${state.summary.momentumPoints} momentum points`,
        "Your ten-minute reset is ready."
      );
    }
    lines.push("", goalCheckinPending
      ? "Answer honestly. Then finish what matters and move what does not."
      : "Tap what you finished. Move what you did not. No speeches.");
    return lines.join("\n");
  }

  function formatDailyCloseoutHtml(today = clock().date, { pending = [], overdueTasks = [], overdueCount = overdueTasks.length, weeklyDue = false, goalCheckinPending = false } = {}) {
    const state = snapshot(today);
    const lines = [
      `<b>🌙 CLOSE THE LOOP · ${escapeTelegramHtml(shortDate(today))}</b>`,
      "<i>One card. Finish what matters, move what does not.</i>"
    ];
    if (goalCheckinPending && state.gamePlan.target) {
      lines.push(
        "",
        "<b>🎯 TARGET CHECK</b>",
        `<b>${escapeTelegramHtml(state.gamePlan.target)}</b>`,
        "<i>Did today move it?</i>"
      );
    }
    if (pending.length) {
      lines.push("", "<b>📣 POSTING</b>", `🟡 <b>${escapeTelegramHtml(pending.map(platformLabel).join(" + "))}</b> · Waiting`);
    }
    if (overdueTasks.length) {
      lines.push("", `<b>🔴 OVERDUE · ${overdueCount}</b>`);
      for (const [index, task] of overdueTasks.entries()) lines.push(`<b>${index + 1}. ${escapeTelegramHtml(task.title)}</b>`);
      if (overdueCount > overdueTasks.length) lines.push(`<i>+ ${overdueCount - overdueTasks.length} more in Home Court</i>`);
    }
    if (weeklyDue) {
      lines.push(
        "",
        "<b>🏁 SUNDAY RESET</b>",
        `✅ <b>${state.summary.tasksDone}</b> tasks finished · <b>${state.summary.momentumPoints}</b> momentum points`,
        "<i>Your ten-minute reset is ready.</i>"
      );
    }
    lines.push("", goalCheckinPending
      ? "<i>Answer honestly. Then finish what matters and move what does not.</i>"
      : "<i>Tap what you finished. Move what you did not. No speeches.</i>");
    return lines.join("\n");
  }

  function markGoalProgress(day = clock().date, movedTarget) {
    const state = snapshot(day);
    const target = state.gamePlan.target;
    if (!target) {
      return {
        ok: false,
        message: "No weekly target is locked yet. Run the weekly reset first.",
        messageHtml: "<b>No weekly target is locked yet.</b> Run the weekly reset first."
      };
    }
    const checkin = plannerStore.saveGoalCheckin(actorId, day, { target, movedTarget: Boolean(movedTarget) });
    const progress = snapshot(day).goalProgress;
    if (checkin.movedTarget) {
      return {
        ok: true,
        checkin,
        progress,
        message: [
          "TARGET MOVED ✓",
          target,
          `${progress.movedDays} target ${progress.movedDays === 1 ? "day" : "days"} this week. Keep the chain alive.`
        ].join("\n"),
        messageHtml: [
          "<b>🎯 TARGET MOVED ✓</b>",
          `<b>${escapeTelegramHtml(target)}</b>`,
          `<code>${progress.movedDays}</code> target ${progress.movedDays === 1 ? "day" : "days"} this week. Keep the chain alive.`
        ].join("\n")
      };
    }
    return {
      ok: true,
      checkin,
      progress,
      message: [
        "HONEST RESET",
        target,
        "Today was motion, not progress. Tomorrow starts with the target move."
      ].join("\n"),
      messageHtml: [
        "<b>🎯 HONEST RESET</b>",
        `<b>${escapeTelegramHtml(target)}</b>`,
        "<i>Today was motion, not progress. Tomorrow starts with the target move.</i>"
      ].join("\n")
    };
  }

  function formatCapturePrompt() {
    return [
      "CAPTURE",
      "Send one thing in normal language. I’ll put it in the right place.",
      "",
      "Task · “task: Send the proposal tomorrow”",
      "Calendar · “Meeting with Sara Wednesday at 3 PM”",
      "Content · “LinkedIn post about pricing tomorrow”",
      "Posting · “posted on LinkedIn”",
      "Sales note · “note Acme asked for pricing”",
      "",
      "Voice notes work too. Nothing external is sent automatically."
    ].join("\n");
  }

  function formatCapturePromptHtml() {
    return [
      "<b>➕ CAPTURE</b>",
      "<i>Send one thing in normal language. I’ll put it in the right place.</i>",
      "",
      "<b>Task</b> · <code>task: Send the proposal tomorrow</code>",
      "<b>Calendar</b> · <code>Meeting with Sara Wednesday at 3 PM</code>",
      "<b>Content</b> · <code>LinkedIn post about pricing tomorrow</code>",
      "<b>Posting</b> · <code>posted on LinkedIn</code>",
      "<b>Sales note</b> · <code>note Acme asked for pricing</code>",
      "",
      "<i>Voice notes work too. Nothing external is sent automatically.</i>"
    ].join("\n");
  }

  function formatCaptureDraft(draft) {
    if (!draft) return "That capture draft is no longer available.";
    const payload = draft.payload || {};
    const lines = [`${captureKindLabel(draft.kind)} · READY TO LOCK IN`, ""];
    if (draft.kind === "task") {
      lines.push(payload.title, payload.dueOn ? `Due · ${dayLabel(payload.dueOn)}` : "Due · No date");
    } else if (draft.kind === "task-update") {
      lines.push(payload.title, payload.change || "Update task");
    } else if (draft.kind === "content") {
      lines.push(payload.title, `Platform · ${platformLabel(payload.platform)}`, payload.plannedOn ? `Plan · ${dayLabel(payload.plannedOn)}` : "Plan · Idea bank");
    } else if (draft.kind === "posted") {
      lines.push(`${platformLabel(payload.platform)} · Mark posted`, `Day · ${dayLabel(payload.day)}`);
    } else if (draft.kind === "note") {
      lines.push(payload.prospectName || "Company", payload.text);
    }
    lines.push("", "Nothing changes until you confirm.");
    return lines.join("\n");
  }

  function formatCaptureDraftHtml(draft) {
    if (!draft) return "That capture draft is no longer available.";
    const payload = draft.payload || {};
    const lines = [`<b>${escapeTelegramHtml(captureKindLabel(draft.kind))} · READY TO LOCK IN</b>`, ""];
    if (draft.kind === "task") {
      lines.push(`<b>${escapeTelegramHtml(payload.title)}</b>`, payload.dueOn ? `Due · ${escapeTelegramHtml(dayLabel(payload.dueOn))}` : "Due · No date");
    } else if (draft.kind === "task-update") {
      lines.push(`<b>${escapeTelegramHtml(payload.title)}</b>`, escapeTelegramHtml(payload.change || "Update task"));
    } else if (draft.kind === "content") {
      lines.push(`<b>${escapeTelegramHtml(payload.title)}</b>`, `Platform · ${escapeTelegramHtml(platformLabel(payload.platform))}`, payload.plannedOn ? `Plan · ${escapeTelegramHtml(dayLabel(payload.plannedOn))}` : "Plan · Idea bank");
    } else if (draft.kind === "posted") {
      lines.push(`<b>${escapeTelegramHtml(platformLabel(payload.platform))} · Mark posted</b>`, `Day · ${escapeTelegramHtml(dayLabel(payload.day))}`);
    } else if (draft.kind === "note") {
      lines.push(`<b>${escapeTelegramHtml(payload.prospectName || "Company")}</b>`, escapeTelegramHtml(payload.text));
    }
    lines.push("", "<i>Nothing changes until you confirm.</i>");
    return lines.join("\n");
  }

  function prepareCapture(intent, today = clock().date) {
    if (!intent || typeof intent !== "object") return { handled: false };
    if (intent.type === "add-task" && intent.needsDueDate) {
      plannerStore.setBotSession(actorId, {
        kind: "capture-clarification",
        step: "task-date",
        payload: { title: cleanReply(intent.title, 240) }
      });
      return {
        handled: true,
        needsClarification: true,
        clarification: "task-date",
        message: "TASK\nWhen should I put it?\nReply Today, Tomorrow, Next week, or No date."
      };
    }
    if (intent.type === "add-post" && !intent.platform) {
      plannerStore.setBotSession(actorId, {
        kind: "capture-clarification",
        step: "platform",
        payload: { title: intent.title, plannedOn: intent.plannedOn || null }
      });
      return { handled: true, needsClarification: true, clarification: "platform", message: "CONTENT PLAN\nInstagram or LinkedIn?" };
    }

    let kind;
    let payload;
    if (intent.type === "add-task") {
      kind = "task";
      payload = { title: cleanReply(intent.title, 240), dueOn: intent.dueAt ? String(intent.dueAt).slice(0, 10) : null };
    } else if (intent.type === "add-post") {
      kind = "content";
      payload = { title: cleanReply(intent.title, 240), platform: intent.platform, plannedOn: intent.plannedOn || null };
    } else if (intent.type === "mark-posted") {
      kind = "posted";
      payload = { platform: intent.platform, day: today };
    } else if (intent.type === "note" && intent.prospect) {
      kind = "note";
      payload = { prospectId: intent.prospect.id, prospectName: intent.prospect.name || "Company", text: cleanReply(intent.text, 2000) };
    } else {
      return { handled: false };
    }
    if (!payload.title && ["task", "content"].includes(kind)) return { handled: true, error: "Give the capture a short title." };
    const draft = plannerStore.createCaptureDraft(actorId, { kind, payload });
    return { handled: true, draft, message: formatCaptureDraft(draft), messageHtml: formatCaptureDraftHtml(draft) };
  }

  function prepareTaskUpdate(taskOrId, updates = {}, change = "Update task") {
    const task = typeof taskOrId === "string" ? getTask(taskOrId) : taskOrId;
    if (!task) return { handled: true, error: "That task no longer exists.", message: "That task no longer exists." };
    const safeUpdates = {};
    if (updates.status === "done") safeUpdates.status = "done";
    if (Object.prototype.hasOwnProperty.call(updates, "dueOn")) safeUpdates.dueOn = updates.dueOn || null;
    if (Object.prototype.hasOwnProperty.call(updates, "assigneeId")) safeUpdates.assigneeId = updates.assigneeId || null;
    if (["low", "normal", "high"].includes(updates.priority)) safeUpdates.priority = updates.priority;
    if (typeof updates.title === "string" && updates.title.trim()) safeUpdates.title = updates.title.trim().slice(0, 240);
    if (!Object.keys(safeUpdates).length) return { handled: true, error: "There is no valid task change to make.", message: "There is no valid task change to make." };
    const draft = plannerStore.createCaptureDraft(actorId, {
      kind: "task-update",
      payload: { taskId: task.id, title: task.title, updates: safeUpdates, change }
    });
    return { handled: true, draft, message: formatCaptureDraft(draft), messageHtml: formatCaptureDraftHtml(draft) };
  }

  async function confirmCapture(draftId) {
    const claim = plannerStore.transitionCaptureDraft(actorId, draftId, "ready", "executing");
    if (!claim.changed) {
      const draft = claim.draft;
      if (!draft) return { ok: false, message: "That capture expired or belongs to another owner." };
      if (draft.status === "confirmed") return { ok: true, already: true, draft, message: "Already locked in." };
      if (draft.status === "cancelled") return { ok: false, draft, message: "That capture was cancelled." };
      return { ok: false, draft, message: "That capture is already being handled." };
    }

    const draft = claim.draft;
    let item;
    try {
      if (draft.kind === "task") item = addTask(draft.payload.title, { dueOn: draft.payload.dueOn || null });
      if (draft.kind === "task-update") {
        const updates = draft.payload.updates || {};
        const safeUpdates = {};
        if (updates.status === "done") safeUpdates.status = "done";
        if (Object.prototype.hasOwnProperty.call(updates, "dueOn")) safeUpdates.dueOn = updates.dueOn || null;
        if (Object.prototype.hasOwnProperty.call(updates, "assigneeId")) safeUpdates.assigneeId = updates.assigneeId || null;
        if (["low", "normal", "high"].includes(updates.priority)) safeUpdates.priority = updates.priority;
        if (typeof updates.title === "string" && updates.title.trim()) safeUpdates.title = updates.title.trim().slice(0, 240);
        item = taskStore.updateTask(draft.payload.taskId, safeUpdates);
      }
      if (draft.kind === "content") {
        item = contentStore.createPost({
          title: draft.payload.title,
          platform: draft.payload.platform,
          format: "post",
          status: draft.payload.plannedOn ? "scheduled" : "idea",
          plannedOn: draft.payload.plannedOn || null,
          actorId
        });
      }
      if (draft.kind === "posted") item = markPosted(draft.payload.platform, draft.payload.day);
      if (draft.kind === "note") item = await scoutStore?.addNote?.(draft.payload.prospectId, draft.payload.text);
      if (!item) throw new Error("That capture type is not connected yet.");
      const completed = plannerStore.transitionCaptureDraft(actorId, draftId, "executing", "confirmed");
      return { ok: true, draft: completed.draft, item, message: `${captureKindLabel(draft.kind)} · LOCKED IN` };
    } catch (error) {
      plannerStore.transitionCaptureDraft(actorId, draftId, "executing", "ready");
      throw error;
    }
  }

  function cancelCapture(draftId) {
    const result = plannerStore.transitionCaptureDraft(actorId, draftId, "ready", "cancelled");
    if (result.changed) return { ok: true, draft: result.draft, message: "Capture cancelled. Nothing changed." };
    if (result.draft?.status === "cancelled") return { ok: true, already: true, draft: result.draft, message: "Already cancelled." };
    return { ok: false, draft: result.draft, message: result.draft?.status === "confirmed" ? "That capture was already locked in." : "That capture is no longer available." };
  }

  function recordCalendarEvent(payload = {}, externalRef = {}) {
    if (!payload.title || !payload.date) return null;
    const existing = plannerStore.listEvents({ actorId, from: payload.date, to: payload.date })
      .find((event) => event.title === payload.title && event.startsAt === (payload.time || null));
    if (existing) {
      return externalRef.id && !existing.externalId
        ? plannerStore.attachEventExternalId(existing.id, externalRef.id, actorId)
        : existing;
    }
    return plannerStore.createEvent({
      title: payload.title,
      startsOn: payload.date,
      startsAt: payload.time || null,
      durationMinutes: payload.time ? payload.durationMinutes || 60 : null,
      externalId: externalRef.id || null,
      actorId
    });
  }

  function recordCalendarUpdate(payload = {}, externalRef = {}) {
    const externalId = payload.event?.id || externalRef.id;
    const event = externalId ? plannerStore.findEventByExternalId(externalId, actorId) : null;
    const draft = payload.draft || {};
    if (!event || !draft.date) return null;
    return plannerStore.updateEvent(event.id, {
      title: draft.title || event.title,
      startsOn: draft.date,
      startsAt: draft.time || null,
      durationMinutes: draft.time ? draft.durationMinutes || 60 : null
    }, actorId);
  }

  function recordCalendarDeletion(payload = {}, externalRef = {}) {
    const externalId = payload.event?.id || externalRef.id;
    const event = externalId ? plannerStore.findEventByExternalId(externalId, actorId) : null;
    return event ? plannerStore.removeEvent(event.id, actorId) : false;
  }

  function addTask(title, { dueOn = null } = {}) {
    return taskStore.createTask({
      title: String(title || "").trim(),
      assigneeId: actorId,
      dueOn,
      priority: "normal",
      actorId,
      project: "Captured in Telegram"
    });
  }

  function updateTask(taskId, action, today = clock().date) {
    if (action === "done") return taskStore.updateTask(taskId, { status: "done" });
    if (action === "snooze") return taskStore.updateTask(taskId, { dueOn: shiftDate(today, 1) });
    throw new Error("Unknown task action.");
  }

  function resolveTaskDate(value, today = clock().date) {
    let input = String(value || "").trim().toLowerCase().replace(/[.!?]+$/, "");
    if (/^(?:tmr|tmrw|tomorow|tommorow|tommorrow|tommrow|tomrrow|tomorroww)$/.test(input)) input = "tomorrow";
    if (input === "today") return today;
    if (input === "tomorrow") return shiftDate(today, 1);
    if (input === "next week") return shiftDate(today, 7);
    if (/^(?:no date|anytime|someday)$/.test(input)) return null;
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const weekday = weekdays.indexOf(input.replace(/^next\s+/, ""));
    if (weekday >= 0) {
      const current = new Date(`${today}T12:00:00Z`).getUTCDay();
      let days = (weekday - current + 7) % 7;
      if (!days || input.startsWith("next ")) days += 7;
      return shiftDate(today, days);
    }
    return undefined;
  }

  function normalizedTaskQuery(value) {
    return String(value || "").trim().replace(/^(?:the|this)\s+/i, "").replace(/\s+task$/i, "").trim().toLowerCase();
  }

  function taskMatches(query, candidateIds) {
    const needle = normalizedTaskQuery(query);
    if (!needle || needle === "this") return [];
    const allowed = candidateIds ? new Set(candidateIds) : null;
    const tasks = taskStore.listTasks({ includeDone: false, limit: 1000 })
      .filter((task) => !allowed || allowed.has(task.id));
    const exact = tasks.filter((task) => task.title.toLowerCase() === needle);
    if (exact.length) return exact;
    return tasks.filter((task) => {
      const title = task.title.toLowerCase();
      return title.includes(needle) || needle.includes(title);
    });
  }

  function memberMatches(value) {
    const needle = String(value || "").trim().toLowerCase();
    if (/^(?:nobody|no one|unassigned)$/.test(needle)) return [{ id: null, name: "Unassigned" }];
    if (/^(?:me|myself)$/.test(needle)) return members().filter((member) => member.id === actorId);
    const exact = members().filter((member) => member.name.toLowerCase() === needle);
    if (exact.length) return exact;
    return members().filter((member) => member.name.toLowerCase().includes(needle));
  }

  function taskChoiceResult(message, payload, tasks) {
    plannerStore.setBotSession(actorId, {
      kind: "task-command",
      step: "choose-task",
      payload: { ...payload, candidateIds: tasks.map((task) => task.id) }
    });
    return {
      handled: true,
      needsClarification: true,
      clarification: "task-choice",
      choices: tasks.slice(0, 8).map((task) => ({ id: task.id, label: task.title })),
      message
    };
  }

  function memberChoiceResult(taskId, message = "Who should own it?") {
    const choices = [...members().map((member) => ({ id: member.id, label: member.id === actorId ? "Me" : member.name })), { id: "none", label: "Unassigned" }];
    plannerStore.setBotSession(actorId, { kind: "task-command", step: "choose-member", payload: { taskId } });
    return { handled: true, needsClarification: true, clarification: "task-member", choices, message };
  }

  function finishTaskCommand(task, payload) {
    if (payload.action === "done") return prepareTaskUpdate(task, { status: "done" }, "Status · Done");
    if (payload.action === "due") {
      return prepareTaskUpdate(task, { dueOn: payload.dueOn }, payload.dueOn ? `Due · ${dayLabel(payload.dueOn)}` : "Due · No date");
    }
    if (payload.action === "priority") {
      return prepareTaskUpdate(task, { priority: payload.priority }, `Priority · ${payload.priority[0].toUpperCase()}${payload.priority.slice(1)}`);
    }
    if (payload.action === "rename") return prepareTaskUpdate(task, { title: payload.title }, `Rename to · ${payload.title}`);
    if (payload.action === "assign") {
      if (!Object.prototype.hasOwnProperty.call(payload, "assigneeId")) return memberChoiceResult(task.id);
      return prepareTaskUpdate(task, { assigneeId: payload.assigneeId }, `Assigned to · ${memberLabel(payload.assigneeId)}`);
    }
    return { handled: false };
  }

  function resolveTaskCommand(query, payload) {
    const matches = taskMatches(query, payload.candidateIds);
    if (!matches.length) {
      if (!payload.explicit) return { handled: false };
      return { handled: true, message: `I couldn't find one active task matching “${String(query || "").trim()}”. Open My tasks and choose it there.` };
    }
    if (matches.length > 1) return taskChoiceResult("Which task did you mean?", payload, matches);
    return finishTaskCommand(matches[0], payload);
  }

  function handleTaskCommand(input, today = clock().date) {
    const text = String(input || "").trim().replace(/[.!?]+$/, "");
    const explicit = /\btask\b/i.test(text);
    if (/^(?:what(?:'s| is) urgent|show (?:me )?(?:the )?urgent tasks|urgent tasks|what needs attention)$/i.test(text)) {
      return taskCenter({ filter: "urgent", today });
    }
    if (/^(?:all|team) tasks$/i.test(text)) return taskCenter({ scope: "team", today });

    const move = /^(?:move|reschedule|snooze)\s+(.+?)\s+(?:to|for)\s+(today|tomorrow|next week|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.exec(text);
    if (move) {
      const dueOn = resolveTaskDate(move[2], today);
      return resolveTaskCommand(move[1], { action: "due", dueOn, explicit });
    }
    const assign = /^(?:assign|give)\s+(.+?)\s+to\s+(.+)$/i.exec(text);
    if (assign) {
      const assignees = memberMatches(assign[2]);
      if (!assignees.length) {
        return { handled: true, message: `I couldn't find ${assign[2]} on the team. Available: ${members().map((member) => member.name).join(", ")}.` };
      }
      if (assignees.length > 1) return { handled: true, message: "That teammate name matches more than one person. Use the full name." };
      return resolveTaskCommand(assign[1], { action: "assign", assigneeId: assignees[0].id, explicit });
    }
    const rename = /^rename\s+(.+?)\s+to\s+(.+)$/i.exec(text);
    if (rename) return resolveTaskCommand(rename[1], { action: "rename", title: rename[2].trim().slice(0, 240), explicit });
    const priority = /^(?:make|set)\s+(.+?)\s+(?:to\s+)?(low|normal|high)(?:\s+priority)?$/i.exec(text);
    if (priority) return resolveTaskCommand(priority[1], { action: "priority", priority: priority[2].toLowerCase(), explicit });
    const done = /^(?:finish|complete|close|mark)\s+(.+?)(?:\s+as\s+done)?$/i.exec(text);
    if (done) return resolveTaskCommand(done[1], { action: "done", explicit });
    return { handled: false };
  }

  function prepareTaskDueChoice(taskId, choice, today = clock().date) {
    const dueOn = resolveTaskDate(String(choice || "").replaceAll("-", " "), today);
    if (dueOn === undefined) return { handled: true, message: "Choose Today, Tomorrow, Next week, or No date." };
    return prepareTaskUpdate(taskId, { dueOn }, dueOn ? `Due · ${dayLabel(dueOn)}` : "Due · No date");
  }

  function prepareTaskPriority(taskId, priority) {
    const value = String(priority || "").toLowerCase();
    if (!["low", "normal", "high"].includes(value)) return { handled: true, message: "Choose Low, Normal, or High priority." };
    return prepareTaskUpdate(taskId, { priority: value }, `Priority · ${value[0].toUpperCase()}${value.slice(1)}`);
  }

  function startTaskRename(taskId) {
    const task = getTask(taskId, { includeDone: false });
    if (!task) return { handled: true, message: "That task no longer exists." };
    plannerStore.setBotSession(actorId, { kind: "task-command", step: "rename", payload: { taskId } });
    return { handled: true, needsClarification: true, clarification: "task-text", message: `RENAME TASK\n${task.title}\n\nSend the new title—or Cancel.` };
  }

  function startTaskAssignment(taskId) {
    const task = getTask(taskId, { includeDone: false });
    if (!task) return { handled: true, message: "That task no longer exists." };
    return memberChoiceResult(task.id, `ASSIGN TASK\n${task.title}\n\nWho should own it?`);
  }

  function handleTaskChoice(taskId) {
    const session = plannerStore.getBotSession(actorId);
    if (session?.kind !== "task-command" || session.step !== "choose-task" || !session.payload.candidateIds?.includes(taskId)) {
      return { handled: false, message: "That task question has expired." };
    }
    const task = getTask(taskId, { includeDone: false });
    plannerStore.clearBotSession(actorId);
    return task ? finishTaskCommand(task, session.payload) : { handled: true, message: "That task no longer exists." };
  }

  function handleTaskMember(memberId) {
    const session = plannerStore.getBotSession(actorId);
    if (session?.kind !== "task-command" || session.step !== "choose-member") return { handled: false, message: "That assignment question has expired." };
    const assigneeId = memberId === "none" ? null : memberId;
    if (assigneeId && !members().some((member) => member.id === assigneeId)) return { handled: false, message: "That teammate is unavailable." };
    const task = getTask(session.payload.taskId, { includeDone: false });
    plannerStore.clearBotSession(actorId);
    return task ? finishTaskCommand(task, { action: "assign", assigneeId }) : { handled: true, message: "That task no longer exists." };
  }

  function markPosted(platform, today = clock().date) {
    if (!PLATFORMS.includes(platform)) throw new Error("Unknown posting platform.");
    const state = snapshot(today);
    if (latestStatus(state.content, platform, today) === "posted") {
      return { created: false, platform, today, message: `${platformLabel(platform)} was already marked posted today.` };
    }
    contentStore.createPost({
      title: `${platformLabel(platform)} post · ${today}`,
      platform,
      format: "post",
      status: "published",
      publishedOn: today,
      actorId
    });
    return { created: true, platform, today, message: `${platformLabel(platform)} marked posted. Streak protected.` };
  }

  function startWeeklyReview(today = clock().date) {
    const week = weekBounds(today);
    const isSunday = new Date(`${today}T12:00:00Z`).getUTCDay() === 0;
    const reviewWeekStart = isSunday ? week.start : shiftDate(week.start, -7);
    plannerStore.setBotSession(actorId, {
      kind: "weekly-review",
      step: "wins",
      payload: { weekStart: reviewWeekStart, targetWeekStart: shiftDate(reviewWeekStart, 7) }
    });
    return "WEEKLY GAME PLAN · 1/3\nWhat worked this week that we should repeat? Reply “skip” if nothing comes to mind.";
  }

  function handleSessionText(input) {
    const session = plannerStore.getBotSession(actorId);
    if (!session) return { handled: false };
    if (/^\/?cancel$/i.test(String(input || "").trim())) {
      plannerStore.clearBotSession(actorId);
      return { handled: true, complete: true, message: session.kind === "weekly-review" ? "Reset cancelled. Nothing was saved." : "Capture cancelled. Nothing was saved." };
    }
    if (session.kind === "capture-clarification") {
      let clarificationInput = String(input || "").trim().toLowerCase().replace(/[.!?]+$/, "");
      if (session.step === "task-date") {
        if (/^(?:tmr|tmrw|tomorow|tommorow|tommorrow|tommrow|tomrrow|tomorroww)$/.test(clarificationInput)) {
          clarificationInput = "tomorrow";
        }
        const today = clock().date;
        const dueOn = clarificationInput === "today"
          ? today
          : clarificationInput === "tomorrow"
            ? shiftDate(today, 1)
            : clarificationInput === "next week"
              ? shiftDate(today, 7)
              : /^(?:no date|anytime|someday)$/.test(clarificationInput)
                ? null
                : undefined;
        if (dueOn === undefined) {
          return {
            handled: true,
            needsClarification: true,
            clarification: "task-date",
            message: "Reply Today, Tomorrow, Next week, or No date—or Cancel."
          };
        }
        plannerStore.clearBotSession(actorId);
        return prepareCapture({
          type: "add-task",
          title: session.payload.title,
          dueAt: dueOn ? `${dueOn}T12:00:00.000Z` : null
        });
      }
      const platformInput = clarificationInput;
      const platform = /^(?:ig|instagram)$/.test(platformInput) ? "instagram" : platformInput === "linkedin" ? "linkedin" : null;
      if (!platform) {
        return {
          handled: true,
          needsClarification: true,
          clarification: "platform",
          message: "Reply Instagram or LinkedIn—or Cancel."
        };
      }
      plannerStore.clearBotSession(actorId);
      return prepareCapture({ type: "add-post", platform, ...session.payload });
    }
    if (session.kind === "task-command") {
      if (session.step === "rename") {
        const title = cleanReply(input, 240);
        if (!title) return { handled: true, needsClarification: true, clarification: "task-text", message: "Send a real task title—or Cancel." };
        const task = getTask(session.payload.taskId, { includeDone: false });
        plannerStore.clearBotSession(actorId);
        return task ? finishTaskCommand(task, { action: "rename", title }) : { handled: true, message: "That task no longer exists." };
      }
      if (session.step === "choose-task") {
        const matches = taskMatches(input, session.payload.candidateIds);
        if (matches.length !== 1) return taskChoiceResult("Choose one of these tasks—or Cancel.", session.payload, matches.length ? matches : session.payload.candidateIds.map((id) => getTask(id)).filter(Boolean));
        plannerStore.clearBotSession(actorId);
        return finishTaskCommand(matches[0], session.payload);
      }
      if (session.step === "choose-member") {
        const matches = memberMatches(input);
        if (matches.length !== 1) return memberChoiceResult(session.payload.taskId, "Choose one teammate—or Cancel.");
        const task = getTask(session.payload.taskId, { includeDone: false });
        plannerStore.clearBotSession(actorId);
        return task ? finishTaskCommand(task, { action: "assign", assigneeId: matches[0].id }) : { handled: true, message: "That task no longer exists." };
      }
    }
    if (session.kind !== "weekly-review") {
      plannerStore.clearBotSession(actorId);
      return { handled: false };
    }
    const reply = cleanReply(input);
    if (session.step === "wins") {
      plannerStore.setBotSession(actorId, { kind: session.kind, step: "lessons", payload: { ...session.payload, wins: reply } });
      return { handled: true, message: "WEEKLY GAME PLAN · 2/3\nWhat stole time or created noise this week? Reply “skip” if you want." };
    }
    if (session.step === "lessons") {
      plannerStore.setBotSession(actorId, { kind: session.kind, step: "focus", payload: { ...session.payload, lessons: reply } });
      return { handled: true, message: "WEEKLY GAME PLAN · 3/3\nBy next Sunday, what must be true for the week to count? Give me one concrete outcome." };
    }
    if (!reply) return { handled: true, message: "Give next week one concrete outcome, even if it is small." };
    const review = plannerStore.saveWeeklyReview(actorId, session.payload.weekStart, {
      wins: session.payload.wins || "",
      lessons: session.payload.lessons || "",
      nextFocus: reply
    });
    const targetWeekStart = session.payload.targetWeekStart || shiftDate(session.payload.weekStart, 7);
    const state = snapshot(clock().date);
    const gamePlan = buildWeeklyGamePlan({
      today: targetWeekStart,
      review,
      tasks: [...state.activeTasks.map((task) => ({ ...task, source: "hq" })), ...state.salesTasks],
      targetWeekStart
    });
    plannerStore.clearBotSession(actorId);
    const moveLines = gamePlan.moves.length
      ? gamePlan.moves.map((task, index) => `${index + 1}. ${task.title}\n   ${task.reason}`)
      : ["No move is on the board yet. Capture the first one now."];
    const moveHtml = gamePlan.moves.length
      ? gamePlan.moves.flatMap((task, index) => [`<b>${index + 1}. ${escapeTelegramHtml(task.title)}</b>`, `<i>${escapeTelegramHtml(task.reason)}</i>`])
      : ["<i>No move is on the board yet. Capture the first one now.</i>"];
    const warning = gamePlan.needsGoalTask ? "\n\nPLANNING GAP\nNone of these tasks clearly supports the target yet. Capture that move before Monday gets noisy." : "";
    const warningHtml = gamePlan.needsGoalTask ? ["", "<b>⚠️ PLANNING GAP</b>", "<i>None of these tasks clearly supports the target yet. Capture that move before Monday gets noisy.</i>"] : [];
    return {
      handled: true,
      complete: true,
      review,
      gamePlan,
      today: targetWeekStart,
      message: ["GAME PLAN LOCKED", `Target · ${review.nextFocus}`, "", "FIRST MOVES", ...moveLines].join("\n") + warning,
      messageHtml: ["<b>🏀 GAME PLAN LOCKED</b>", `<b>Target · ${escapeTelegramHtml(review.nextFocus)}</b>`, "", "<b>🔥 FIRST MOVES</b>", ...moveHtml, ...warningHtml].join("\n")
    };
  }

  function scheduledPrompts(date = now()) {
    const current = clock(date);
    const prompts = [];
    const state = snapshot(current.date);
    const settings = plannerStore.getReminderSettings(actorId);
    const morningKey = `morning:${current.date}`;
    const morningTime = settings.updatedAt ? settings.morningAt : morningBriefAt;
    const morningDelivered = plannerStore.hasBotDelivery(actorId, morningKey);
    const morningWillSend = settings.morningEnabled && current.time >= morningTime && current.time < "12:00" && !morningDelivered;
    if (morningWillSend) {
      prompts.push({ type: "morning", key: morningKey, day: current.date, text: formatToday(current.date), textHtml: formatTodayHtml(current.date) });
    }
    const overdueKey = `overdue:${current.date}`;
    const overdueTasks = state.activeTasks.filter((task) => task.dueOn && task.dueOn < current.date);
    const firstOverdue = overdueTasks[0];
    const overdueDelivered = plannerStore.hasBotDelivery(actorId, overdueKey);
    const postingKey = `posting:${current.date}`;
    const postingDelivered = plannerStore.hasBotDelivery(actorId, postingKey);
    const reviewKey = `weekly-reset:${state.week.start}`;
    const reviewDelivered = plannerStore.hasBotDelivery(actorId, reviewKey);
    const closeoutKey = `closeout:${current.date}`;
    const closeoutDelivered = plannerStore.hasBotDelivery(actorId, closeoutKey);
    const weeklyTime = settings.updatedAt ? settings.weeklyAt : weeklyResetAt;
    const legacyEveningDelivered = !closeoutDelivered && (postingDelivered || reviewDelivered);
    /* The content plan is out of the daily flow, so the evening closeout no longer
       nags about posts. The plan and its data are untouched. */
    const postingOutstanding = false;
    const weeklyOutstanding = settings.weeklyEnabled && current.weekday === "Sun" && !state.review && !reviewDelivered && !legacyEveningDelivered;
    const overdueOutstanding = settings.enabled && settings.overdueEnabled && overdueTasks.length > 0 && !overdueDelivered && !legacyEveningDelivered;
    const goalCheckinOutstanding = settings.enabled && Boolean(state.gamePlan.target) && !state.goalCheckin && !legacyEveningDelivered;
    const closeoutTimes = [
      postingOutstanding || overdueOutstanding || goalCheckinOutstanding ? settings.remindAt : null,
      weeklyOutstanding ? weeklyTime : null
    ].filter(Boolean);
    const closeoutAt = closeoutTimes.sort().at(-1);
    const closeoutWillSend = Boolean(
      closeoutAt
      && current.time >= closeoutAt
      && (postingOutstanding || overdueOutstanding || weeklyOutstanding || goalCheckinOutstanding)
      && !closeoutDelivered
    );
    const morningCovered = morningDelivered || morningWillSend;
    const overdueWillSend = settings.overdueEnabled
      && current.time >= settings.overdueAt
      && current.time < "16:00"
      && firstOverdue
      && !overdueDelivered
      && !morningCovered
      && !closeoutWillSend;
    if (overdueWillSend) {
      prompts.push({
        type: "overdue",
        key: overdueKey,
        day: current.date,
        task: firstOverdue,
        text: `OVERDUE RESCUE\n${firstOverdue.title}\nClose it, or move it to tomorrow—do not let it become wallpaper.`,
        textHtml: `<b>🔴 OVERDUE RESCUE</b>\n\n<b>${escapeTelegramHtml(firstOverdue.title)}</b>\n<i>Close it, or move it to tomorrow—do not let it become wallpaper.</i>`
      });
    }
    if (closeoutWillSend) {
      const closeoutOverdue = overdueOutstanding ? overdueTasks.slice(0, 2) : [];
      const details = {
        pending: postingOutstanding ? state.pending : [],
        overdueTasks: closeoutOverdue,
        overdueCount: overdueOutstanding ? overdueTasks.length : 0,
        weeklyDue: weeklyOutstanding,
        goalCheckinPending: goalCheckinOutstanding,
        goalTarget: state.gamePlan.target || null
      };
      prompts.push({
        type: "closeout",
        key: closeoutKey,
        deliveryKeys: [
          closeoutKey,
          postingOutstanding ? postingKey : null,
          overdueOutstanding ? overdueKey : null,
          weeklyOutstanding ? reviewKey : null
        ].filter(Boolean),
        day: current.date,
        weekStart: state.week.start,
        ...details,
        text: formatDailyCloseout(current.date, details),
        textHtml: formatDailyCloseoutHtml(current.date, details)
      });
    }
    return prompts;
  }

  function markDelivered(keys) {
    const deliveryKeys = Array.isArray(keys) ? keys : [keys];
    let changed = false;
    for (const key of new Set(deliveryKeys.filter(Boolean))) {
      if (plannerStore.markBotDelivery(actorId, key)) changed = true;
    }
    return changed;
  }

  return {
    actorId,
    clock,
    snapshot,
    formatToday,
    formatTodayHtml,
    formatTasks,
    taskCenter,
    taskDetail,
    formatPostCheck,
    formatPostCheckHtml,
    formatWeeklyReset,
    formatWeeklyResetHtml,
    formatDailyCloseout,
    formatDailyCloseoutHtml,
    formatCapturePrompt,
    formatCapturePromptHtml,
    formatCaptureDraft,
    formatCaptureDraftHtml,
    prepareCapture,
    prepareTaskUpdate,
    prepareTaskDueChoice,
    prepareTaskPriority,
    startTaskRename,
    startTaskAssignment,
    handleTaskCommand,
    handleTaskChoice,
    handleTaskMember,
    confirmCapture,
    cancelCapture,
    recordCalendarEvent,
    recordCalendarUpdate,
    recordCalendarDeletion,
    addTask,
    updateTask,
    markPosted,
    markGoalProgress,
    startWeeklyReview,
    handleSessionText,
    scheduledPrompts,
    markDelivered
  };
}
