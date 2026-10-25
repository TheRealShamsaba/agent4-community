import { setActiveActor } from "../room-actor.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BellRing,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  CircleCheckBig,
  Clapperboard,
  Droplet,
  Flame,
  House,
  Instagram,
  LayoutDashboard,
  Linkedin,
  ListTodo,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Sunrise,
  TriangleAlert,
  Trophy,
  Users,
  X
} from "lucide-react";
import agent4Doodle from "../assets/falcon.svg";
import { buildDailyCommand } from "../daily-command.js";
import { buildWorkspaceModel } from "../workspace-model.js";
import { addDays, daysUntil, dueLabel, localIsoDate } from "../format.js";
import { FilmRoom } from "./FilmRoom.jsx";
import { GoalTracker } from "./GoalTracker.jsx";
import { TelegramSheet } from "./TelegramSheet.jsx";
import { TelegramTaskSheet } from "./TelegramTaskSheet.jsx";

const TABS = [
  { id: "today", label: "Today", Icon: House },
  { id: "rhythm", label: "Rhythm", Icon: Flame },
  { id: "calendar", label: "Calendar", Icon: CalendarDays },
  { id: "film", label: "Film", Icon: Clapperboard },
  { id: "more", label: "More", Icon: LayoutDashboard }
];

/* Eight cards, eight requests. They are named so a single failure can be
   reported on the one card it belongs to instead of closing the door. */
const SECTIONS = [
  { key: "tasks", path: () => "/api/tasks?includeDone=true", what: "your tasks" },
  { key: "content", path: (today, through) => `/api/content?today=${today}&from=${today}&to=${through}`, what: "your posting rhythm" },
  { key: "momentum", path: (today) => `/api/momentum?today=${today}&days=35`, what: "your momentum" },
  { key: "calendar", path: (today, through) => `/api/calendar?from=${today}&to=${through}`, what: "your calendar" },
  { key: "memory", path: () => "/api/client-memory", what: "client memory" },
  { key: "workspaces", path: () => "/api/workspaces", what: "companies and projects" },
  { key: "weekly", path: (today) => `/api/weekly-review?today=${today}`, what: "this week's plan" },
  { key: "settings", path: () => "/api/rhythm/settings", what: "your bot rhythm" }
];

const EMPTY_STATE = {
  status: "loading",
  actor: null,
  tasks: [],
  members: [],
  summary: null,
  posts: [],
  momentum: null,
  events: [],
  clientMemories: [],
  workspaces: { companies: [], projects: [] },
  gamePlan: null,
  gamePlanPeriod: "current",
  goalTracker: null,
  settings: null,
  failed: [],
  loadedAt: 0,
  errorKind: "",
  error: ""
};

function initialTelegramRoute() {
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get("tab");
  const requestedCapture = params.get("capture");
  const taskId = /^[a-zA-Z0-9-]{8,64}$/.test(params.get("task") || "") ? params.get("task") : "";
  return {
    tab: taskId ? "more" : TABS.some((tab) => tab.id === requestedTab) ? requestedTab : "today",
    capture: ["task", "event", "post"].includes(requestedCapture) ? requestedCapture : null,
    taskId
  };
}

function tapFeedback(style = "light") {
  try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style); } catch { /* Haptics are optional. */ }
}

function distance(value, today) {
  const days = daysUntil(value, today);
  return days === null ? Number.POSITIVE_INFINITY : days;
}

/* "overdue", never "late" — the web board, the aria labels and the bot all say
   the same word, and the magnitude comes from the shared dueLabel. */
function dueBadge(task, today) {
  const days = daysUntil(task.dueOn, today);
  if (days === null) return { text: task.status === "doing" ? "In progress" : "No due date", tone: "quiet" };
  const text = dueLabel(task.dueOn, { today });
  if (days < 0) return { text, tone: "overdue" };
  if (days === 0) return { text, tone: "today" };
  if (days === 1) return { text, tone: "soon" };
  return { text, tone: "quiet" };
}

function sortTasks(tasks, today) {
  const priority = { high: 0, normal: 1, low: 2 };
  return [...tasks].sort((left, right) => {
    const leftDue = distance(left.dueOn, today);
    const rightDue = distance(right.dueOn, today);
    if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
    if (left.status !== right.status) return left.status === "doing" ? -1 : 1;
    return (priority[left.priority] ?? 1) - (priority[right.priority] ?? 1);
  });
}

function formatEventDay(day, today) {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function memberName(task, members) {
  if (!task.assigneeId) return "Unassigned";
  return members.find((member) => member.id === task.assigneeId)?.name || "Teammate";
}

async function api(pathname, options = {}) {
  const response = await fetch(pathname, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
  });
  let body = {};
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    // The status travels with the error so a timeout is never mistaken for
    // "you are not allowed in here".
    const error = new Error(body?.error?.message || "Agent4 could not complete that move.");
    error.status = response.status;
    throw error;
  }
  return body;
}

function AppHeader({ actor, onRefresh, refreshing }) {
  return (
    <header className="tg-head">
      <div className="tg-brand">
        <span>agent4</span>
      </div>
      <span className="tg-standard">STANDARD / 01</span>
      <div className="tg-rule" />
      <div className="tg-heading-copy">
        <span>THE WORK IS THE CULTURE.</span>
        <h1>Make today count.</h1>
        <p>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}{actor?.name ? ` · ${actor.name}` : ""}</p>
        {/* Telegram keeps a mini-app open for days. Without this, a task closed
            on the laptop sits here looking undone until the app is restarted. */}
        <button type="button" className="tg-refresh" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? <LoaderCircle className="is-spinning" size={15} /> : <RefreshCw size={15} />}
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>
    </header>
  );
}

function EmptyRow({ children }) {
  return <div className="tg-empty"><Circle size={13} /> <span>{children}</span></div>;
}

function LoadFailure({ what, onRetry, busy }) {
  return (
    <div className="tg-card-miss" role="alert">
      <TriangleAlert size={15} />
      <p>Couldn’t load {what}. Everything else still works.</p>
      <button type="button" onClick={onRetry} disabled={busy}>{busy ? "Retrying…" : "Retry"}</button>
    </div>
  );
}

function TodayView({ state, today, onComplete, onOpenTask, onGoalCheckIn, onOpenCapture, onTab, onCommand, onRefresh, busyId, refreshing }) {
  const failed = state.failed;
  const mine = sortTasks(state.tasks.filter((task) => task.assigneeId === state.actor?.id && task.status !== "done"), today);
  const gamePlan = state.gamePlan || {
    target: "",
    moves: [],
    needsTarget: true,
    needsGoalTask: false,
    guidance: "Set one weekly target so Agent4 can rank the work."
  };
  const planned = gamePlan.moves?.length ? gamePlan.moves.slice(0, 3) : mine.slice(0, 3);
  /* The list is the plan's top three, not "everything of yours that is late",
     so the counts say out loud which pile they are describing. */
  const overdue = mine.filter((task) => distance(task.dueOn, today) < 0).length;
  const dueToday = mine.filter((task) => distance(task.dueOn, today) === 0).length;
  const listLabel = gamePlan.moves?.length
    ? (gamePlan.target ? "RANKED AGAINST YOUR TARGET" : "RANKED BY URGENCY")
    : "YOUR NEXT THREE BY DUE DATE";
  const nextEvent = state.events[0];
  const momentum = state.momentum;
  const clientMemory = state.clientMemories?.[0] || null;
  const followUpDistance = clientMemory?.nextFollowUpOn ? distance(clientMemory.nextFollowUpOn, today) : null;
  const now = new Date();
  const dailyCommand = buildDailyCommand({
    today,
    nowMinutes: (now.getHours() * 60) + now.getMinutes(),
    actorId: state.actor?.id,
    tasks: state.tasks,
    events: state.events,
    clientMemories: state.clientMemories,
    gamePlan
  });

  return (
    <div className="tg-view tg-view--today">
      <section className="tg-card tg-card--paper tg-tasks-card">
        <div className={`tg-plan-lock is-${dailyCommand.source}`}>
          <span><small>TODAY’S CALL · {dailyCommand.sourceLabel}</small><strong dir="auto">{dailyCommand.title}</strong><p dir="auto">{dailyCommand.reason}</p></span>
          <button type="button" onClick={() => onCommand(dailyCommand)}>{dailyCommand.actionLabel} <ArrowRight size={13} /></button>
          <GoalTracker tracker={state.goalTracker} onCheckIn={onGoalCheckIn} busy={busyId === "goal-checkin"} valext="telegram" />
        </div>

        {/* The weekly target and the plan's read on it used to be fetched, stored
            and never shown. It is the only thing that explains the ranking. */}
        {failed.includes("weekly") ? <LoadFailure what="this week’s plan" onRetry={onRefresh} busy={refreshing} /> : (
          <div className="tg-plan-note">
            <small>{state.gamePlanPeriod === "next" ? "NEXT WEEK’S TARGET" : "THIS WEEK’S TARGET"}</small>
            <strong dir="auto">{gamePlan.target || "No target set yet"}</strong>
            <p>{gamePlan.guidance}</p>
            {gamePlan.needsTarget ? <button type="button" onClick={() => onCommand({ action: "plan" })}>Set the target <ArrowRight size={13} /></button> : null}
            {gamePlan.needsGoalTask ? <button type="button" onClick={() => onOpenCapture()}>Capture the first next step <Plus size={13} /></button> : null}
          </div>
        )}

        <div className="tg-card-head">
          <span><ListTodo size={20} /></span>
          <div><small>YOUR WORK</small><h2>Do this first.</h2></div>
          <b>{mine.length}</b>
        </div>
        <p className="tg-task-pulse">Across your {mine.length} open {mine.length === 1 ? "task" : "tasks"}: <strong>{overdue} overdue</strong><i />{dueToday} due today</p>
        {failed.includes("tasks") ? <LoadFailure what="your tasks" onRetry={onRefresh} busy={refreshing} /> : (
          <>
            <p className="tg-list-label">{listLabel}</p>
            <div className="tg-task-list">
              {planned.length ? planned.map((task) => {
                const timing = dueBadge(task, today);
                return (
                  <div className="tg-task-row" key={task.id}>
                    <button type="button" className="tg-task-check" onClick={() => onComplete(task)} disabled={Boolean(busyId)} aria-label={`Mark ${task.title} done`}>
                      {busyId === task.id ? <LoaderCircle className="is-spinning" size={19} /> : <CircleCheckBig size={21} />}
                    </button>
                    <button type="button" className="tg-task-open" onClick={() => onOpenTask(task.id)}>
                      <strong dir="auto">{task.title}</strong>
                      <small dir="auto">{task.reason || task.project || (task.status === "doing" ? "In progress" : "Personal")}</small>
                    </button>
                    <em className={`is-${timing.tone}`}>{timing.text}</em>
                  </div>
                );
              }) : <EmptyRow>Nothing is assigned to you. Capture the next step.</EmptyRow>}
            </div>
          </>
        )}
        <button type="button" className="tg-card-link" onClick={() => onTab("more")}>See every task <ArrowRight size={15} /></button>
      </section>

      {failed.includes("memory") ? <LoadFailure what="client memory" onRetry={onRefresh} busy={refreshing} /> : null}
      {clientMemory ? <button type="button" className={`tg-client-memory${followUpDistance != null && followUpDistance <= 0 ? " is-due" : ""}`} onClick={() => onTab("film")}>
        <span><Building2 size={19} /></span>
        <div><small>CLIENT MEMORY</small><strong dir="auto">{clientMemory.clientName}</strong><p dir="auto">{clientMemory.meetings?.[0]?.actionItems?.[0]?.text || clientMemory.openItems?.[0] || "Review the last meeting before the next move."}</p></div>
        <em>{followUpDistance == null ? `${clientMemory.meetings?.length || 0} ${(clientMemory.meetings?.length || 0) === 1 ? "meeting" : "meetings"}` : followUpDistance < 0 ? dueLabel(clientMemory.nextFollowUpOn, { today }) : followUpDistance === 0 ? "Today" : followUpDistance === 1 ? "Tomorrow" : new Date(`${clientMemory.nextFollowUpOn}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</em>
        <ChevronRight size={17} />
      </button> : null}

      <section className="tg-card tg-calendar-peek">
        <button type="button" className="tg-section-button" onClick={() => onTab("calendar")}>
          <span className="tg-icon is-blue"><CalendarDays size={18} /></span>
          <span><small>NEXT UP</small><strong>{nextEvent?.title || "Calendar is clear"}</strong><em>{nextEvent ? `${formatEventDay(nextEvent.startsOn, today)}${nextEvent.startsAt ? ` · ${nextEvent.startsAt}` : ""}` : "Add something before it sneaks up on you."}</em></span>
          <ChevronRight size={17} />
        </button>
        {failed.includes("calendar") ? <LoadFailure what="your calendar" onRetry={onRefresh} busy={refreshing} /> : (
          <div className="tg-week-strip">
            {Array.from({ length: 7 }, (_, index) => {
              const day = addDays(today, index);
              const hasEvent = state.events.some((event) => event.startsOn === day);
              return <span className={index === 0 ? "is-today" : ""} key={day}><small>{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}</small><b>{Number(day.slice(-2))}</b>{hasEvent ? <i /> : null}</span>;
            })}
          </div>
        )}
      </section>

      <section className="tg-card tg-rhythm-peek">
        <div className="tg-card-head tg-card-head--compact">
          <span className="is-orange"><Flame size={19} /></span>
          <div><small>POSTING RHYTHM</small><h2>Don’t break the chain.</h2></div>
          <button type="button" onClick={() => onTab("rhythm")}>Open</button>
        </div>
        {failed.includes("content") ? <LoadFailure what="your posting rhythm" onRetry={onRefresh} busy={refreshing} /> : (
          <>
            {[
              { id: "instagram", label: "Instagram", Icon: Instagram },
              { id: "linkedin", label: "LinkedIn", Icon: Linkedin }
            ].map(({ id, label, Icon }) => {
              const platform = state.summary?.platforms?.[id] || {};
              return (
                <div className="tg-platform-row" key={id}>
                  <span className={`tg-platform-logo is-${id}`}><Icon size={15} /></span>
                  <div><span><strong>{label}</strong><small>{platform.streak || 0} day streak</small></span><div className="tg-mini-days">{(platform.daily || []).slice(-14).map((day) => <i className={`is-${day.status}`} key={day.day} title={`${day.day}: ${day.status}`} />)}</div></div>
                </div>
              );
            })}
            <div className="tg-legend"><span><i className="is-posted" /> Posted</span><span><i className="is-missed" /> Missed</span><span><i className="is-pending" /> Today</span></div>
          </>
        )}
      </section>

      <section className="tg-card tg-momentum-card">
        {failed.includes("momentum") ? <LoadFailure what="your momentum" onRetry={onRefresh} busy={refreshing} /> : (
          <>
            <div>
              <span className="tg-icon is-gold"><Trophy size={19} /></span>
              <span><small>MOMENTUM</small><strong>{momentum?.weeklyPoints || 0} / {momentum?.weeklyGoal || 35} points</strong><em>{momentum?.streak || 0} day work streak · Level {momentum?.level || 1}</em></span>
            </div>
            <div className="tg-progress"><i style={{ width: `${Math.min(100, ((momentum?.weeklyPoints || 0) / (momentum?.weeklyGoal || 35)) * 100)}%` }} /></div>
          </>
        )}
      </section>

      <div className="tg-quick-actions">
        <button type="button" className="is-primary" onClick={onOpenCapture}><Plus size={18} /> Capture</button>
        <button type="button" onClick={() => window.location.assign("/data/hq.html")}><LayoutDashboard size={17} /> Open full HQ</button>
      </div>
    </div>
  );
}

function RhythmView({ summary, momentum, posts, today, failed, onMarkPosted, onRefresh, refreshing, busyId }) {
  const planned = (posts || []).filter((post) => post.status !== "published").slice(0, 4);
  return (
    <div className="tg-view tg-detail-view">
      <div className="tg-detail-head"><small>YOUR CONSISTENCY</small><h2>Rhythm</h2><p>Green means you showed up. Red means you missed it. No mystery, no guilt—just the record.</p></div>
      {failed.includes("content") ? <LoadFailure what="your posting rhythm" onRetry={onRefresh} busy={refreshing} /> : null}
      {[
        { id: "instagram", label: "Instagram", Icon: Instagram },
        { id: "linkedin", label: "LinkedIn", Icon: Linkedin }
      ].map(({ id, label, Icon }) => {
        const platform = summary?.platforms?.[id] || {};
        const todayStatus = platform.daily?.[platform.daily.length - 1]?.status;
        return (
          <section className="tg-card tg-rhythm-card" key={id}>
            <div className="tg-rhythm-title"><span className={`tg-platform-logo is-${id}`}><Icon size={17} /></span><div><strong>{label}</strong><small>Best {platform.longestStreak || 0} days</small></div><b>{platform.streak || 0}<small>streak</small></b></div>
            <div className="tg-contribution-grid">{(platform.daily || []).map((day) => <i className={`is-${day.status}`} key={day.day} title={`${day.day}: ${day.status}`} />)}</div>
            <div className="tg-rhythm-meta"><span>{platform.published || 0} / {platform.target || 7} this week</span><span>{platform.missed || 0} missed in view</span></div>
            <button type="button" className={todayStatus === "posted" ? "is-done" : ""} onClick={() => onMarkPosted(id)} disabled={todayStatus === "posted" || busyId === id}>
              {busyId === id ? <LoaderCircle className="is-spinning" size={16} /> : todayStatus === "posted" ? <Check size={16} /> : <Plus size={16} />}
              {todayStatus === "posted" ? "Posted today" : `Mark ${label} posted`}
            </button>
          </section>
        );
      })}
      {planned.length ? <section className="tg-card tg-content-queue"><div><small>COMING UP</small><strong>Content on deck</strong></div>{planned.map((post) => <article key={post.id}><span className={`tg-platform-logo is-${post.platform}`}>{post.platform === "linkedin" ? <Linkedin size={14} /> : <Instagram size={14} />}</span><div><strong dir="auto">{post.title}</strong><small>{post.plannedOn ? formatEventDay(post.plannedOn, today) : "Idea bank"} · {post.status}</small></div></article>)}</section> : null}
      <section className="tg-card tg-reward-card">
        <Flame size={20} />
        <div><small>WORK STREAK</small><strong>{momentum?.streak || 0} days locked in</strong><p>{momentum?.weeklyUnlocked ? "Gold week unlocked. Take the win." : `${Math.max(0, (momentum?.weeklyGoal || 35) - (momentum?.weeklyPoints || 0))} points until your Gold week.`}</p></div>
      </section>
    </div>
  );
}

function CalendarView({ events, today, failed, onOpenCapture, onRefresh, refreshing }) {
  const grouped = useMemo(() => events.reduce((groups, event) => {
    if (!groups[event.startsOn]) groups[event.startsOn] = [];
    groups[event.startsOn].push(event);
    return groups;
  }, {}), [events]);
  return (
    <div className="tg-view tg-detail-view">
      <div className="tg-detail-head tg-detail-head--row"><div><small>WHAT’S COMING</small><h2>Calendar</h2><p>The next two weeks, without opening another app.</p></div><button type="button" onClick={() => onOpenCapture("event")} aria-label="Add an event"><Plus size={18} /></button></div>
      {failed.includes("calendar") ? <LoadFailure what="your calendar" onRetry={onRefresh} busy={refreshing} /> : null}
      <div className="tg-agenda">
        {Object.keys(grouped).length ? Object.entries(grouped).map(([day, dayEvents]) => (
          <section key={day}>
            <div className="tg-agenda-date"><span>{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</span><b>{Number(day.slice(-2))}</b><small>{formatEventDay(day, today)}</small></div>
            <div>{dayEvents.map((event) => <article key={event.id}><span>{event.startsAt || "Anytime"}</span><div><strong dir="auto">{event.title}</strong><small>{event.durationMinutes ? `${event.durationMinutes} min` : "All day"}{event.notes ? ` · ${event.notes}` : ""}</small></div></article>)}</div>
          </section>
        )) : <section className="tg-card tg-empty-calendar"><CalendarDays size={25} /><strong>Nothing on the books</strong><p>Add the first thing that deserves your time.</p><button type="button" onClick={() => onOpenCapture("event")}><Plus size={16} /> Add an event</button></section>}
      </div>
    </div>
  );
}

function NudgeSettings({ settings, onSave, busy }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  if (!draft) return null;
  const rows = [
    { enabled: "morningEnabled", time: "morningAt", label: "Morning command card", detail: "Priorities, calendar, posting, momentum", Icon: Sunrise },
    { enabled: "enabled", time: "remindAt", label: "Evening closeout", detail: "Posting and unfinished work in one useful card", Icon: Flame },
    { enabled: "overdueEnabled", time: "overdueAt", label: "Missed-morning rescue", detail: "One task nudge only if the morning card did not cover it", Icon: ListTodo },
    { enabled: "weeklyEnabled", time: "weeklyAt", label: "Sunday reset", detail: "Joins the closeout instead of sending another card", Icon: Trophy }
  ];
  const changed = JSON.stringify(draft) !== JSON.stringify(settings);
  return (
    <section className="tg-card tg-nudge-card">
      <div className="tg-nudge-head"><span><BellRing size={18} /></span><div><small>BOT RHYTHM</small><strong>Plan once. Close once.</strong><p>A morning game plan, one evening closeout, and a fallback only when useful.</p></div></div>
      <div className="tg-nudge-list">
        {rows.map(({ enabled, time, label, detail, Icon }) => (
          <div className={!draft[enabled] ? "is-off" : ""} key={enabled}>
            <Icon size={16} />
            <span><strong>{label}</strong><small>{detail}</small></span>
            <input type="time" value={draft[time]} onChange={(event) => setDraft((current) => ({ ...current, [time]: event.target.value }))} disabled={!draft[enabled]} aria-label={`${label} time`} />
            <label className="tg-switch" aria-label={`${label} ${draft[enabled] ? "on" : "off"}`}><input type="checkbox" checked={draft[enabled]} onChange={(event) => setDraft((current) => ({ ...current, [enabled]: event.target.checked }))} /><i /></label>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onSave(draft)} disabled={!changed || busy}>{busy ? <LoaderCircle className="is-spinning" size={15} /> : <Save size={15} />} Save bot rhythm</button>
    </section>
  );
}

function MoreView({ state, today, companies, onOpenCompany, onComplete, onOpenTask, busyId, onOpenCapture, focusedTaskId, onSaveSettings, settingsBusy, onRefresh, refreshing }) {
  const failed = state.failed;
  const active = sortTasks(state.tasks.filter((task) => task.status !== "done"), today);
  return (
    <div className="tg-view tg-detail-view">
      <div className="tg-detail-head"><small>THE WHOLE PICTURE</small><h2>Home Court</h2><p>Quick access to the team’s work and the full dashboard.</p></div>
      <section className="tg-agent-card">
        <span><img src={agent4Doodle} alt="Agent4 doodle" /></span>
        <div><small>AGENT4’S READ</small><strong>{active.length ? `${active.length} active moves. Keep the next one obvious.` : "Court is clear. Decide what matters next."}</strong><p>Built to run the day—not just chat about it.</p></div>
      </section>
      <section className="tg-card tg-company-memory">
        <div className="tg-card-head tg-card-head--compact"><span><Building2 size={18} /></span><div><small>COMPANIES & PROJECTS</small><h2>One home per relationship</h2></div><b>{companies.length}</b></div>
        {failed.includes("workspaces") ? <LoadFailure what="companies and projects" onRetry={onRefresh} busy={refreshing} /> : (
          <div>
            {companies.slice(0, 5).map((company) => <button type="button" key={company.id} onClick={() => onOpenCompany(company.id)}><span>{company.name.slice(0, 2).toUpperCase()}</span><div><strong dir="auto">{company.name}</strong><small>{company.projects.length} {company.projects.length === 1 ? "project" : "projects"} · {company.tasks.filter((task) => task.status !== "done").length} open</small></div><ChevronRight size={15} /></button>)}
            {!companies.length ? <EmptyRow>No company workspace yet. Build the first one in full HQ.</EmptyRow> : null}
          </div>
        )}
        <button type="button" className="tg-card-link" onClick={() => onOpenCompany("")}>Open companies & projects <ArrowRight size={15} /></button>
      </section>
      <section className="tg-card tg-all-tasks">
        <div className="tg-card-head tg-card-head--compact"><span><Users size={18} /></span><div><small>EVERYONE’S WORK</small><h2>All active tasks</h2></div><b>{active.length}</b></div>
        {failed.includes("tasks") ? <LoadFailure what="the task board" onRetry={onRefresh} busy={refreshing} /> : (
          <div>
            {active.length ? active.map((task) => {
              const timing = dueBadge(task, today);
              return (
                <article id={`tg-task-${task.id}`} className={focusedTaskId === task.id ? "is-focused" : ""} key={task.id}>
                  <button type="button" className="tg-task-check" onClick={() => onComplete(task)} disabled={Boolean(busyId)} aria-label={`Mark ${task.title} done`}>
                    {busyId === task.id ? <LoaderCircle className="is-spinning" size={19} /> : <CircleCheckBig size={21} />}
                  </button>
                  <button type="button" className="tg-task-open" onClick={() => onOpenTask(task.id)}>
                    <strong dir="auto">{task.title}</strong>
                    <small>{memberName(task, state.members)}{task.project ? ` · ${task.project}` : ""}</small>
                  </button>
                  <em className={`is-${timing.tone}`}>{timing.text}</em>
                </article>
              );
            }) : <EmptyRow>No active tasks. That is either excellent or suspicious.</EmptyRow>}
          </div>
        )}
        <button type="button" className="tg-card-link" onClick={() => onOpenCapture("task")}>Add a task <Plus size={15} /></button>
      </section>
      {failed.includes("settings")
        ? <LoadFailure what="your bot rhythm" onRetry={onRefresh} busy={refreshing} />
        : <NudgeSettings settings={state.settings} onSave={onSaveSettings} busy={settingsBusy} />}
      <button type="button" className="tg-open-hq" onClick={() => window.location.assign("/data/hq.html")}><span><LayoutDashboard size={20} /></span><div><strong>Open full Home Court</strong><small>Board, pipeline, money, content, and every detail</small></div><ArrowRight size={18} /></button>
    </div>
  );
}

function CaptureSheet({ initialType, today, companies, members, actorId, onClose, onCreated }) {
  const [type, setType] = useState(initialType || "task");
  const [title, setTitle] = useState("");
  /* A task with no deadline is normal, and the web has always allowed it. This
     used to default to today and demand a date, which quietly made every
     captured task overdue by the next morning. */
  const [dueOn, setDueOn] = useState("");
  const [eventOn, setEventOn] = useState(today);
  const [time, setTime] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState(actorId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (type === "task") {
        const company = companies.find((item) => item.id === companyId) || null;
        const project = company?.projects.find((item) => item.id === projectId) || null;
        await api("/api/tasks", { method: "POST", body: JSON.stringify({ title, dueOn: dueOn || null, assigneeId, priority: "normal", status: "open", companyId: company?.id || null, companyName: company?.name || "", projectId: project?.id || null, project: project?.name || "" }) });
      }
      if (type === "event") await api("/api/calendar", { method: "POST", body: JSON.stringify({ title, startsOn: eventOn, startsAt: time || null, durationMinutes: time ? 60 : null }) });
      if (type === "post") await api("/api/content", { method: "POST", body: JSON.stringify({ title: title || `Posted on ${platform === "linkedin" ? "LinkedIn" : "Instagram"}`, platform, format: "post", status: "published", publishedOn: today }) });
      await onCreated(type);
      onClose();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TelegramSheet label="Quick capture" kicker="QUICK CAPTURE" title="What are we locking in?" onClose={onClose}>
      <div className="tg-capture-types">
        <button type="button" className={type === "task" ? "is-active" : ""} onClick={() => setType("task")}><ListTodo size={15} /> Task</button>
        <button type="button" className={type === "event" ? "is-active" : ""} onClick={() => setType("event")}><CalendarDays size={15} /> Event</button>
        <button type="button" className={type === "post" ? "is-active" : ""} onClick={() => setType("post")}><Flame size={15} /> Posted</button>
      </div>
      <form onSubmit={submit}>
        {type === "post" ? <div className="tg-platform-picker"><button type="button" className={platform === "instagram" ? "is-active" : ""} onClick={() => setPlatform("instagram")}><Instagram size={17} /> Instagram</button><button type="button" className={platform === "linkedin" ? "is-active" : ""} onClick={() => setPlatform("linkedin")}><Linkedin size={17} /> LinkedIn</button></div> : null}
        <label>{type === "post" ? "What did you post? (optional)" : type === "event" ? "Event" : "Task"}<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={type === "post" ? "Today’s post" : type === "event" ? "What’s happening?" : "What needs doing?"} maxLength={240} required={type !== "post"} dir="auto" /></label>
        {type === "task" ? (
          <div className="tg-form-row">
            <label>Due date<input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label>
            <label>Assignee
              <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                <option value="">Unassigned</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
          </div>
        ) : null}
        {type === "event" ? <div className="tg-form-row"><label>Due date<input type="date" value={eventOn} onChange={(event) => setEventOn(event.target.value)} required /></label><label>Time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label></div> : null}
        {type === "task" && companies.length ? <div className="tg-form-row tg-workspace-fields"><label>Company<select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setProjectId(""); }}><option value="">No company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={!companyId}><option value="">No project</option>{(companies.find((company) => company.id === companyId)?.projects || []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div> : null}
        {error ? <p className="tg-form-error" role="alert">{error}</p> : null}
        <button type="submit" className="tg-submit" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={17} /> : <Check size={17} />} {type === "post" ? "Keep the streak" : "Add it"}</button>
      </form>
    </TelegramSheet>
  );
}

export function TelegramHomeCourt({ snapshot = null }) {
  const today = localIsoDate();
  const [initialRoute] = useState(initialTelegramRoute);
  const [activeTab, setActiveTab] = useState(initialRoute.tab);
  const [state, setState] = useState(EMPTY_STATE);
  setActiveActor(state.actor);
  const [capture, setCapture] = useState(initialRoute.capture);
  const [openTaskId, setOpenTaskId] = useState("");
  const [filmMeetingId, setFilmMeetingId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const refreshRef = useRef(null);

  const say = useCallback((text, action = null) => setNotice({ tone: "ok", text, action }), []);
  /* A failed save used to arrive in the same gold toast as a win, with a
     Sparkles icon and a 2.4 second life. Errors get their own tone, stay until
     they are dismissed, and announce themselves as alerts. */
  const warn = useCallback((text) => setNotice({ tone: "error", text }), []);

  /* Eight independent requests, settled independently. One bad endpoint used to
     take the whole mini-app to "HOME COURT IS PRIVATE", which is an answer to a
     question nobody asked when the real problem was a timeout. */
  const loadData = useCallback(async (actor) => {
    const through = addDays(today, 14);
    const settled = await Promise.allSettled(SECTIONS.map((section) => api(section.path(today, through))));
    const expired = settled.find((result) => result.status === "rejected" && result.reason?.status === 401);
    if (expired) throw Object.assign(new Error(expired.reason.message), { status: 401 });

    const body = {};
    const failed = [];
    SECTIONS.forEach((section, index) => {
      const result = settled[index];
      if (result.status === "fulfilled") body[section.key] = result.value;
      else failed.push(section.key);
    });

    setState((current) => ({
      ...current,
      status: "ready",
      actor,
      tasks: body.tasks ? (body.tasks.tasks || []) : current.tasks,
      members: body.tasks ? (body.tasks.members || []) : current.members,
      summary: body.content ? body.content.summary : current.summary,
      posts: body.content ? (body.content.posts || []) : current.posts,
      momentum: body.momentum ? body.momentum.momentum : current.momentum,
      events: body.calendar ? (body.calendar.events || []) : current.events,
      clientMemories: body.memory ? (body.memory.memories || []) : current.clientMemories,
      workspaces: body.workspaces || current.workspaces,
      gamePlan: body.weekly ? body.weekly.gamePlan : current.gamePlan,
      gamePlanPeriod: body.weekly ? (body.weekly.gamePlanPeriod || "current") : current.gamePlanPeriod,
      goalTracker: body.weekly ? body.weekly.goalTracker : current.goalTracker,
      settings: body.settings ? body.settings.settings : current.settings,
      failed,
      loadedAt: Date.now(),
      errorKind: "",
      error: ""
    }));
  }, [today]);

  const openCourt = useCallback(async () => {
    const webApp = window.Telegram?.WebApp;
    try {
      webApp?.ready?.();
      webApp?.expand?.();
      webApp?.setHeaderColor?.("#151512");
      webApp?.setBackgroundColor?.("#151512");
    } catch { /* Local browsers do not expose every Telegram method. */ }
    try {
      let session = await api("/api/auth/session");
      if (!session.authenticated && webApp?.initData) {
        session = await api("/api/auth/telegram", { method: "POST", body: JSON.stringify({ initData: webApp.initData }) });
      }
      if (!session.authenticated || !session.actor) {
        throw Object.assign(new Error("Open Home Court from Agent4 in Telegram, or sign in to the full HQ first."), { status: 401 });
      }
      await api("/api/momentum/check-in", { method: "POST", body: JSON.stringify({ today }) }).catch(() => null);
      await loadData(session.actor);
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        errorKind: error.status === 401 ? "auth" : "offline",
        error: error.message
      }));
    }
  }, [loadData, today]);

  useEffect(() => { openCourt(); }, [openCourt]);

  async function refresh() {
    if (!state.actor || refreshing) return;
    setRefreshing(true);
    try {
      await loadData(state.actor);
    } catch (error) {
      if (error.status === 401) setState((current) => ({ ...current, status: "error", errorKind: "auth", error: error.message }));
      else warn(error.message);
    } finally {
      setRefreshing(false);
    }
  }
  refreshRef.current = refresh;

  /* Coming back to a mini-app that has been sitting in the background for an
     hour should not show yesterday's board. */
  useEffect(() => {
    if (state.status !== "ready") return undefined;
    function wake() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - state.loadedAt < 20_000) return;
      refreshRef.current?.();
    }
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [state.status, state.loadedAt]);

  useEffect(() => {
    if (!notice || notice.tone === "error") return undefined;
    const timer = window.setTimeout(() => setNotice(null), notice.action ? 7000 : 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const syncViewport = () => document.documentElement.style.setProperty("--tg-viewport-height", `${viewport?.height || window.innerHeight}px`);
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    return () => {
      viewport?.removeEventListener("resize", syncViewport);
      document.documentElement.style.removeProperty("--tg-viewport-height");
    };
  }, []);

  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton) return undefined;
    const goBack = () => {
      const url = new URL(window.location.href);
      if (openTaskId) {
        setOpenTaskId("");
        return;
      }
      if (capture) {
        setCapture(null);
        url.searchParams.delete("capture");
      } else {
        setActiveTab("today");
        url.searchParams.set("tab", "today");
        url.searchParams.delete("task");
      }
      window.history.replaceState({}, "", url);
    };
    if (capture || openTaskId || activeTab !== "today") backButton.show?.();
    else backButton.hide?.();
    backButton.onClick?.(goBack);
    return () => backButton.offClick?.(goBack);
  }, [activeTab, capture, openTaskId]);

  useEffect(() => {
    if (state.status !== "ready" || activeTab !== "more" || !initialRoute.taskId) return undefined;
    const timer = window.setTimeout(() => document.getElementById(`tg-task-${initialRoute.taskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 180);
    return () => window.clearTimeout(timer);
  }, [activeTab, initialRoute.taskId, state.status]);

  function changeTab(tab) {
    tapFeedback();
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    url.searchParams.delete("capture");
    if (tab !== "more") url.searchParams.delete("task");
    window.history.replaceState({}, "", url);
  }

  function openCapture(type = "task") {
    tapFeedback("medium");
    setCapture(type);
  }

  function openCompany(companyId = "") {
    const target = new URL("/data/hq.html", window.location.origin);
    target.searchParams.set("place", "workspaces");
    if (companyId) target.searchParams.set("company", companyId);
    window.location.assign(target.href);
  }

  function runDailyCommand(command) {
    if (command.action === "plan") {
      window.location.assign("/data/hq.html#weekly-plan");
      return;
    }
    if (command.action === "film") {
      setFilmMeetingId(command.referenceId || "");
      changeTab("film");
    }
    else if (command.action === "calendar") changeTab("calendar");
    else changeTab("more");
  }

  function closeCapture() {
    setCapture(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("capture");
    window.history.replaceState({}, "", url);
  }

  async function patchTask(task, updates) {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "PATCH", body: JSON.stringify(updates) });
    await loadData(state.actor);
  }

  /* Completing is one tap and every Telegram list hides done work, so without an
     undo a mis-tap removes the task from the mini-app for good. */
  async function completeTask(task) {
    if (busyId) return;
    setBusyId(task.id);
    const previousStatus = task.status;
    try {
      await patchTask(task, { status: "done" });
      tapFeedback("medium");
      say("Move closed. Keep going.", { label: "Undo", run: () => reopenTask(task, previousStatus) });
    } catch (error) {
      warn(error.message);
    } finally {
      setBusyId("");
    }
  }

  async function reopenTask(task, previousStatus) {
    setBusyId(task.id);
    try {
      await patchTask(task, { status: previousStatus === "done" ? "open" : previousStatus });
      tapFeedback("light");
      say(`“${task.title}” is back on the board.`);
    } catch (error) {
      warn(error.message);
    } finally {
      setBusyId("");
    }
  }

  async function saveTask(task, updates) {
    await patchTask(task, updates);
    tapFeedback("medium");
    say("Task updated.");
  }

  async function markPosted(platform) {
    setBusyId(platform);
    try {
      await api("/api/content", { method: "POST", body: JSON.stringify({ title: `Posted on ${platform === "linkedin" ? "LinkedIn" : "Instagram"}`, platform, format: "post", status: "published", publishedOn: today }) });
      await loadData(state.actor);
      tapFeedback("medium");
      say(`${platform === "linkedin" ? "LinkedIn" : "Instagram"} streak saved.`);
    } catch (error) {
      warn(error.message);
    } finally {
      setBusyId("");
    }
  }

  async function markGoalProgress(movedTarget) {
    setBusyId("goal-checkin");
    try {
      const body = await api("/api/goal-checkin", { method: "PUT", body: JSON.stringify({ day: today, movedTarget }) });
      setState((current) => ({ ...current, goalTracker: body.goalTracker }));
      tapFeedback("medium");
      say(movedTarget ? "Target moved. Keep the chain alive." : "Honest reset. Tomorrow starts cleaner.");
    } catch (error) {
      warn(error.message);
    } finally {
      setBusyId("");
    }
  }

  async function saveSettings(settings) {
    setSettingsBusy(true);
    try {
      const body = await api("/api/rhythm/settings", { method: "PUT", body: JSON.stringify(settings) });
      setState((current) => ({ ...current, settings: body.settings }));
      tapFeedback("medium");
      say("Bot rhythm saved. No spam, just the useful stuff.");
    } catch (error) {
      warn(error.message);
    } finally {
      setSettingsBusy(false);
    }
  }

  const companies = buildWorkspaceModel({ dossiers: snapshot?.dossiers || [], stored: state.workspaces, tasks: state.tasks, memories: state.clientMemories });
  const openTask = state.tasks.find((task) => task.id === openTaskId) || null;

  if (state.status === "loading") return <main className="tg-app tg-loading"><LoaderCircle className="is-spinning" size={25} /><strong>Opening Home Court</strong><small>Getting the short version…</small></main>;
  if (state.status === "error") {
    return state.errorKind === "auth"
      ? (
        <main className="tg-app tg-auth-error">
          <img src={agent4Doodle} alt="Agent4 doodle" />
          <small>HOME COURT IS PRIVATE</small>
          <h1>Couldn’t open the door.</h1>
          <p>{state.error}</p>
          <button type="button" onClick={() => window.location.assign("/data/hq.html")}><ArrowRight size={17} /> Open full HQ sign-in</button>
        </main>
      )
      : (
        <main className="tg-app tg-auth-error tg-load-error">
          <TriangleAlert size={34} />
          <small>COULDN’T REACH AGENT4</small>
          <h1>Home Court didn’t answer.</h1>
          <p>{state.error}</p>
          <button type="button" onClick={() => { setState((current) => ({ ...current, status: "loading", errorKind: "", error: "" })); openCourt(); }}><RefreshCw size={16} /> Try again</button>
        </main>
      );
  }

  const isOwner = state.actor?.role === "owner";
  const tabs = TABS;

  return (
    <main className="tg-app">
      <div className="tg-shell">
        {activeTab !== "film" ? <AppHeader actor={state.actor} onRefresh={refresh} refreshing={refreshing} /> : null}
        {activeTab === "today" ? <TodayView state={state} today={today} onComplete={completeTask} onOpenTask={setOpenTaskId} onGoalCheckIn={markGoalProgress} onOpenCapture={() => openCapture("task")} onTab={changeTab} onCommand={runDailyCommand} onRefresh={refresh} busyId={busyId} refreshing={refreshing} /> : null}
        {activeTab === "rhythm" ? <RhythmView summary={state.summary} momentum={state.momentum} posts={state.posts} today={today} failed={state.failed} onMarkPosted={markPosted} onRefresh={refresh} refreshing={refreshing} busyId={busyId} /> : null}
        {activeTab === "calendar" ? <CalendarView events={state.events} today={today} failed={state.failed} onOpenCapture={(type) => openCapture(type || "event")} onRefresh={refresh} refreshing={refreshing} /> : null}
        {activeTab === "film" ? <FilmRoom key={state.actor?.id} compact clients={snapshot?.dossiers || []} onChanged={() => loadData(state.actor)} initialMeetingId={filmMeetingId} /> : null}
        {activeTab === "more" ? <MoreView state={state} today={today} companies={companies} onOpenCompany={openCompany} onComplete={completeTask} onOpenTask={setOpenTaskId} busyId={busyId} onOpenCapture={(type) => openCapture(type || "task")} focusedTaskId={initialRoute.taskId} onSaveSettings={saveSettings} settingsBusy={settingsBusy} onRefresh={refresh} refreshing={refreshing} /> : null}
      </div>
      <nav className="tg-tabs" aria-label="Home Court sections" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map(({ id, label, Icon }) => <button type="button" className={activeTab === id ? "is-active" : ""} onClick={() => changeTab(id)} key={id}><Icon size={19} /><span>{label}</span></button>)}
      </nav>
      {capture ? <CaptureSheet initialType={capture} today={today} companies={companies} members={state.members} actorId={state.actor?.id || ""} onClose={closeCapture} onCreated={async (type) => { await loadData(state.actor); tapFeedback("medium"); say(type === "post" ? "Streak saved." : type === "event" ? "Event added." : "Task added."); }} /> : null}
      {openTask ? <TelegramTaskSheet task={openTask} members={state.members} onClose={() => setOpenTaskId("")} onSave={saveTask} /> : null}
      {notice ? (
        <div className={`tg-toast is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.tone === "error" ? <TriangleAlert size={15} /> : <Sparkles size={15} />}
          <span>{notice.text}</span>
          {notice.action ? <button type="button" className="tg-toast-action" onClick={() => { const { run } = notice.action; setNotice(null); run(); }}>{notice.action.label}</button> : null}
          {notice.tone === "error" || notice.action ? <button type="button" className="tg-toast-close" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={15} /></button> : null}
        </div>
      ) : null}
    </main>
  );
}
