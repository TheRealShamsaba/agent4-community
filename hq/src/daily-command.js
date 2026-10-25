import { daysUntil } from "./format.js";
import { companyNext } from "./workspace-model.js";

/* Stages that still describe a live relationship. A lost or internal company
   has no "next step" worth putting in front of anyone on a Monday morning. */
const LIVE_CLIENT_STAGES = new Set(["talking", "proposal", "active", "operating"]);

function clockMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

/* An event still counts as "today" only while it has not finished. Counting the
   9am stand-up at 11pm is how a calendar lens turns into wallpaper. */
export function isEventRemaining(event, nowMinutes) {
  const startsAt = clockMinutes(event?.startsAt);
  if (startsAt == null) return true;
  const ends = startsAt + Math.max(0, Number(event?.durationMinutes) || 60);
  return ends > Number(nowMinutes || 0);
}

function rosterKey(id, name) {
  return id ? `id:${id}` : `name:${String(name || "").toLocaleLowerCase()}`;
}

function rowState(row, today) {
  if (!row.nextStep) return "missing";
  const distance = daysUntil(row.dueOn, today);
  if (distance === null) return "undated";
  if (distance < 0) return "overdue";
  if (distance === 0) return "today";
  return "scheduled";
}

const STATE_RANK = { overdue: 0, today: 1, missing: 2, scheduled: 3, undated: 4 };

/* Every client and the one thing that moves them next.
   The morning ritual is "read every client's Next box", so the roster has to be
   the whole list — including the companies with nothing written down, which are
   exactly the ones worth seeing first. Two sources feed it: the Next box the
   owner writes on a company, and the action item the last meeting produced. The
   written box wins, because a person decided it. */
export function buildClientRoster({ today, clientMemories = [], companies = [], tasks = [] } = {}) {
  const rows = new Map();

  for (const company of companies || []) {
    if (!company?.id || !company.name || company.hidden) continue;
    if (company.kind === "internal" || company.stage === "lost") continue;
    const key = rosterKey(company.id, company.name);
    const companyTasks = (tasks || []).filter((task) => (
      task.companyId === company.id
      || (!task.companyId && String(task.companyName || "").trim().toLocaleLowerCase() === company.name.trim().toLocaleLowerCase())
    ));
    const next = companyNext({ ...company, tasks: companyTasks });
    rows.set(key, {
      key,
      name: company.name,
      companyId: company.id,
      meetingId: null,
      meetingCount: 0,
      nextStep: String(next?.title || "").trim(),
      dueOn: next?.dueOn || null,
      stage: company.stage || "",
      live: LIVE_CLIENT_STAGES.has(company.stage),
      hasTask: next?.kind === "task",
      state: "missing"
    });
  }

  for (const memory of clientMemories || []) {
    if (!memory?.clientName) continue;
    const key = rosterKey(memory.clientId, memory.clientName);
    const row = rows.get(key) || {
      key,
      name: memory.clientName,
      companyId: memory.clientId || null,
      meetingId: null,
      meetingCount: 0,
      nextStep: "",
      dueOn: null,
      stage: "",
      live: true,
      hasTask: false,
      state: "missing"
    };
    const fromMeeting = String(memory.meetings?.[0]?.actionItems?.[0]?.text || memory.openItems?.[0] || "").trim();
    row.meetingId = memory.meetings?.[0]?.id || row.meetingId;
    row.meetingCount = memory.meetings?.length || 0;
    row.hasTask = Boolean(memory.followUpTaskId);
    if (!row.nextStep && fromMeeting) row.nextStep = fromMeeting;
    if (!row.dueOn && memory.nextFollowUpOn) row.dueOn = memory.nextFollowUpOn;
    rows.set(key, row);
  }

  return [...rows.values()]
    .map((row) => ({ ...row, state: rowState(row, today) }))
    .sort((left, right) => (
      STATE_RANK[left.state] - STATE_RANK[right.state]
      || String(left.dueOn || "9999-12-31").localeCompare(String(right.dueOn || "9999-12-31"))
      || left.name.localeCompare(right.name)
    ));
}

function taskReason(task, distance) {
  if (distance != null && distance < 0) return `This commitment is ${Math.abs(distance)} ${Math.abs(distance) === 1 ? "day" : "days"} late. Clear it before it becomes background noise.`;
  if (distance === 0) return "This is due today. Close the commitment before taking on more work.";
  if (task.status === "doing") return "This is already in motion. Finish the open loop before starting another one.";
  if (distance === 1) return "This is due tomorrow. Moving it now protects tomorrow from becoming a rescue mission.";
  return task.project ? `This is the strongest available next step in ${task.project}.` : "This is the strongest concrete next step currently on your board.";
}

function publicCommand(candidate, stats, target) {
  return {
    title: candidate.title,
    reason: candidate.reason,
    source: candidate.source,
    sourceLabel: candidate.sourceLabel,
    action: candidate.action,
    actionLabel: candidate.actionLabel,
    referenceId: candidate.referenceId || null,
    clientKey: candidate.clientKey || null,
    target: target || "",
    stats
  };
}

/**
 * Pick one honest next step from the four places that shape a workday:
 * strategy, promises, the calendar, and the latest client conversation.
 */
export function buildDailyCommand({
  today,
  nowMinutes = 9 * 60,
  actorId = "",
  tasks = [],
  events = [],
  clientMemories = [],
  companies = [],
  gamePlan = null
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ""))) throw new Error("Daily command needs a valid day.");
  const activeTasks = (tasks || []).filter((task) => task?.id && task?.title && task.status !== "done" && (!actorId || task.assigneeId === actorId));
  const todayEvents = (events || []).filter((event) => event?.title && event.startsOn === today);
  const remainingEvents = todayEvents.filter((event) => isEventRemaining(event, nowMinutes));
  const roster = buildClientRoster({ today, clientMemories, companies, tasks });
  const overdue = activeTasks.filter((task) => {
    const distance = daysUntil(task.dueOn, today);
    return distance != null && distance < 0;
  }).length;
  const dueToday = activeTasks.filter((task) => daysUntil(task.dueOn, today) === 0).length;
  const stats = {
    overdue,
    dueToday,
    /* Only what is still ahead of you. A meeting that ended at 10am is history,
       not a commitment. */
    eventsToday: remainingEvents.length,
    clientsDue: roster.filter((row) => !row.hasTask && (row.state === "overdue" || row.state === "today")).length,
    clientsWithoutNextStep: roster.filter((row) => row.state === "missing").length,
    clientsTotal: roster.length,
    /* Legacy: the old "every client with a name" count. Nothing renders it any
       more; it stays only because an existing test still reads it. */
    clientsOpen: (clientMemories || []).filter((memory) => memory?.clientName).length
  };
  const candidates = [];

  for (const event of todayEvents) {
    const startsAt = clockMinutes(event.startsAt);
    const untilStart = startsAt == null ? null : startsAt - Number(nowMinutes || 0);
    if (untilStart != null && untilStart >= -30 && untilStart <= 120) {
      candidates.push({
        tier: 0,
        title: untilStart < 0 ? `Join ${event.title}` : `Prepare for ${event.title}`,
        reason: untilStart <= 0
          ? `Your calendar says this starts at ${event.startsAt}. Stop the drift and enter prepared.`
          : `This starts in ${untilStart} minutes. Protect the time before it begins.`,
        source: "calendar",
        sourceLabel: `CALENDAR · ${event.startsAt}`,
        action: "calendar",
        actionLabel: "Open the week",
        referenceId: event.id
      });
    } else if (startsAt == null || untilStart > 120) {
      candidates.push({
        tier: 5,
        title: startsAt == null ? event.title : `Prepare for ${event.title}`,
        reason: startsAt == null ? "This is on today's calendar. Give it a real place in the day." : `Your next fixed commitment is at ${event.startsAt}. Make progress before the clock owns you.`,
        source: "calendar",
        sourceLabel: startsAt == null ? "CALENDAR · TODAY" : `CALENDAR · ${event.startsAt}`,
        action: "calendar",
        actionLabel: "Open the week",
        referenceId: event.id
      });
    }
  }

  for (const row of roster) {
    if (row.hasTask) continue;
    const openAction = row.meetingId ? "film" : "company";
    const openLabel = row.meetingId ? `Open ${row.name} memory` : `Open ${row.name}`;
    const reference = row.meetingId || row.companyId;
    if (row.state === "overdue" || row.state === "today") {
      const late = Math.abs(daysUntil(row.dueOn, today) || 0);
      candidates.push({
        tier: 1,
        title: row.nextStep,
        reason: row.state === "overdue"
          ? `${row.name} is waiting on a next step that is ${late} ${late === 1 ? "day" : "days"} late.`
          : `${row.name} is waiting on this next step today. Close the loop before new work.`,
        source: "client",
        sourceLabel: `CLIENT · ${row.name}`,
        action: openAction,
        actionLabel: openLabel,
        referenceId: reference,
        clientKey: row.key
      });
    } else if (row.state === "scheduled" && daysUntil(row.dueOn, today) === 1) {
      candidates.push({
        tier: 6,
        title: row.nextStep,
        reason: `${row.name} needs this tomorrow. A small move today protects the relationship.`,
        source: "client",
        sourceLabel: `CLIENT · ${row.name}`,
        action: openAction,
        actionLabel: openLabel,
        referenceId: reference,
        clientKey: row.key
      });
    } else if (row.state === "undated") {
      candidates.push({
        tier: 7,
        title: row.nextStep,
        reason: `This came directly from the latest ${row.name} meeting and is not scheduled yet.`,
        source: "client",
        sourceLabel: `CLIENT · ${row.name}`,
        action: openAction,
        actionLabel: openLabel,
        referenceId: reference,
        clientKey: row.key
      });
    } else if (row.state === "missing" && row.live) {
      candidates.push({
        tier: 7,
        title: `Write the next step for ${row.name}`,
        reason: `${row.name} is a live relationship with nothing written in its Next box. An empty box is how a client goes quiet.`,
        source: "client",
        sourceLabel: `CLIENT · ${row.name}`,
        action: openAction,
        actionLabel: openLabel,
        referenceId: reference,
        clientKey: row.key
      });
    }
  }

  const target = String(gamePlan?.target || "").trim();
  const primaryMove = gamePlan?.primaryMove || gamePlan?.moves?.[0] || null;
  const targetTask = primaryMove?.id ? activeTasks.find((task) => task.id === primaryMove.id) : null;
  if (target && targetTask) {
    candidates.push({
      tier: 2,
      title: targetTask.title,
      reason: `This is the clearest next step toward this week's target: “${target}”.`,
      source: "goal",
      sourceLabel: "WEEKLY TARGET",
      action: "tasks",
      actionLabel: "Open this task",
      referenceId: targetTask.id
    });
  } else if (target && gamePlan?.needsGoalTask) {
    candidates.push({
      tier: 2,
      title: `Add the first next step for “${target}”`,
      reason: "The target is clear, but nothing on the board moves it yet. Fix that before doing more busywork.",
      source: "goal",
      sourceLabel: "PLANNING GAP",
      action: "tasks",
      actionLabel: "Open the task board"
    });
  }

  for (const task of activeTasks) {
    if (targetTask?.id === task.id) continue;
    const distance = daysUntil(task.dueOn, today);
    const tier = distance != null && distance < 0
      ? 3
      : distance === 0
        ? 4
        : task.status === "doing"
          ? 6
          : distance === 1
            ? 7
            : 8;
    candidates.push({
      tier,
      title: task.title,
      reason: taskReason(task, distance),
      source: "task",
      sourceLabel: distance != null && distance < 0 ? "TASK BOARD · OVERDUE" : distance === 0 ? "TASK BOARD · DUE TODAY" : task.status === "doing" ? "TASK BOARD · IN PROGRESS" : "TASK BOARD",
      action: "tasks",
      actionLabel: "Open this task",
      referenceId: task.id,
      dueOn: task.dueOn || "9999-12-31"
    });
  }

  candidates.sort((left, right) => left.tier - right.tier || String(left.dueOn || "9999-12-31").localeCompare(String(right.dueOn || "9999-12-31")) || left.title.localeCompare(right.title));
  if (candidates[0]) return publicCommand(candidates[0], stats, target);

  return publicCommand({
    title: target ? `Protect time for “${target}”` : "Choose the one outcome this week must produce",
    reason: target
      ? "The direction is clear, but the board is empty. Turn the target into one concrete next step."
      : "Without one outcome, Agent4 can only rank urgency—not direction.",
    source: "goal",
    sourceLabel: target ? "WEEKLY TARGET" : "DIRECTION NEEDED",
    action: "plan",
    actionLabel: target ? "Add the first next step" : "Plan this week"
  }, stats, target);
}
