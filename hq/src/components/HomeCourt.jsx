import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, Check, ChevronDown, Plus, Sparkles, Users } from "lucide-react";
import { WeekPlanner, WeeklyReview } from "./HomePlanner.jsx";
import { LoadError, SkeletonRows } from "./HomeStates.jsx";
import { buildClientRoster, buildDailyCommand, isEventRemaining } from "../daily-command.js";
import { daysUntil, dueLabel, formatDate, localIsoDate } from "../format.js";

/* Home answers two questions and nothing else: what do I do now, and who is
   waiting on me. Everything it used to carry besides — points, streaks, the
   workspace cards, the weekly rhythm — either lives one tap away in its own
   place or is gone. The week's planner and Sunday review stay on this page,
   folded away at the bottom, because the weekly target feeds the next move. */

const CLIENT_ROWS_SHOWN = 6;
const TASK_ROWS_SHOWN = 6;

function greeting(hour) {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

async function completeTask(id) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "done" })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "That task could not be closed.");
}

function durationLabel(minutes) {
  const value = Number(minutes);
  if (!value) return "";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/* The one sentence under the greeting: only the numbers that are not zero. */
function DaySummary({ stats }) {
  const parts = [
    stats.overdue ? { tone: "bad", text: `${stats.overdue} overdue` } : null,
    stats.dueToday ? { tone: "warn", text: `${stats.dueToday} due today` } : null,
    stats.eventsToday ? { tone: "", text: plural(stats.eventsToday, "meeting") + " left" } : null,
    stats.clientsDue ? { tone: "warn", text: `${plural(stats.clientsDue, "client")} waiting` } : null,
    stats.clientsWithoutNextStep ? { tone: "", text: `${plural(stats.clientsWithoutNextStep, "client")} without a next step` } : null
  ].filter(Boolean);
  if (!parts.length) return <p className="hm-summary">Nothing is pressing right now. Use the space on something that matters.</p>;
  return (
    <p className="hm-summary">
      {parts.map((part, index) => (
        <React.Fragment key={part.text}>
          {index ? <i aria-hidden="true" /> : null}
          <span className={part.tone ? `is-${part.tone}` : ""}>{part.text}</span>
        </React.Fragment>
      ))}
    </p>
  );
}

function NextMove({ command, onOpen, onAddTask }) {
  return (
    <section className="hm-hero" aria-label="Your next move">
      <span className="hm-hero__label"><Sparkles size={13} aria-hidden="true" /> Next move<em>{command.sourceLabel.replace(/^[A-Z ]+ · /, "")}</em></span>
      <h2 dir="auto">{command.title}</h2>
      <p>{command.reason}</p>
      <div className="hm-hero__actions">
        <button type="button" className="btn btn--gold btn--lg" onClick={onOpen}>{command.actionLabel} <ArrowRight size={16} /></button>
        <button type="button" className="btn btn--quiet btn--lg" onClick={onAddTask}><Plus size={15} /> New task</button>
      </div>
    </section>
  );
}

function TodayCard({ status, events, tasks, openCount, today, busyId, error, onToggle, onOpenTask, onAddTask, onOpenBoard, onRetry }) {
  const empty = !events.length && !tasks.length;
  return (
    <section className="hm-card" aria-label="Today">
      <header className="hm-card__head">
        <h3>Today</h3>
        <button type="button" className="hm-link" onClick={onAddTask}><Plus size={14} /> Add task</button>
      </header>
      {status === "loading" ? <SkeletonRows rows={4} height={48} label="Loading today" /> : null}
      {status === "error" ? <LoadError title="Today could not be read." detail="This is not an empty day — the request failed." onRetry={onRetry} /> : null}
      {status === "ready" ? (
        <>
          {events.length ? (
            <ul className="hm-list" aria-label="Meetings left today">
              {events.map((event) => (
                <li className="hm-row hm-row--event" key={event.id || `${event.title}-${event.startsAt}`}>
                  <time className="hm-time">{event.startsAt || "All day"}</time>
                  <span className="hm-row__main"><strong dir="auto">{event.title}</strong>{durationLabel(event.durationMinutes) ? <small>{durationLabel(event.durationMinutes)}</small> : null}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {tasks.length ? (
            <ul className="hm-list" aria-label="Tasks for today">
              {tasks.map((task) => {
                const distance = daysUntil(task.dueOn, today);
                const late = distance != null && distance < 0;
                return (
                  <li className="hm-row" key={task.id}>
                    {/* A checkbox, not a button: the touch floor makes every button 44px
                        tall, and a tick circle that tall is an oval. */}
                    <label className="hm-tick">
                      <input
                        type="checkbox"
                        checked={busyId === task.id}
                        disabled={busyId === task.id}
                        aria-label={`Mark “${task.title}” done`}
                        onChange={() => onToggle(task)}
                      />
                      <Check size={13} strokeWidth={3} aria-hidden="true" />
                    </label>
                    <button type="button" className="hm-row__main hm-row__open" onClick={() => onOpenTask(task)}>
                      <strong dir="auto">{task.title}</strong>
                      <small>{[task.companyName, task.project].filter(Boolean).join(" · ") || (task.status === "doing" ? "In progress" : "Task")}</small>
                    </button>
                    {task.dueOn ? <span className={`pill ${late ? "pill--bad" : distance === 0 ? "pill--warn" : "pill--quiet"}`}>{late ? dueLabel(task.dueOn, { today }).replace(" overdue", " late") : formatDate(task.dueOn, { today })}</span> : task.status === "doing" ? <span className="pill pill--quiet">Doing</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {empty ? (
            <div className="hm-empty">
              <strong>A clear day.</strong>
              <p>No meetings and nothing due. Add a task, or pick up a client from the list.</p>
            </div>
          ) : null}
          {error ? <p className="hm-error" role="alert">{error}</p> : null}
          {openCount > tasks.length ? (
            <button type="button" className="hm-more" onClick={onOpenBoard}>{plural(openCount - tasks.length, "more open task")} on the task board <ArrowRight size={14} /></button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

const CLIENT_STATE = {
  overdue: { tone: "bad", label: (row, today) => dueLabel(row.dueOn, { today }).replace(" overdue", " late") || "Late" },
  today: { tone: "warn", label: () => "Today" },
  missing: { tone: "quiet", label: () => "No next step" },
  scheduled: { tone: "quiet", label: (row, today) => formatDate(row.dueOn, { today }) },
  undated: { tone: "quiet", label: () => "No date" }
};

function ClientsCard({ status, rows, total, today, onOpen, onOpenAll, onRetry }) {
  const waiting = rows.filter((row) => row.state === "overdue" || row.state === "today").length;
  const missing = rows.filter((row) => row.state === "missing").length;
  const meta = waiting ? `${waiting} waiting on you` : missing ? `${missing} need a next step` : "All caught up";
  return (
    <section className="hm-card" aria-label="Clients">
      <header className="hm-card__head">
        <h3>Clients</h3>
        {status === "ready" && total ? <span className="hm-card__meta">{meta}</span> : null}
        <button type="button" className="hm-link" onClick={onOpenAll}>All <ArrowRight size={14} /></button>
      </header>
      {status === "loading" ? <SkeletonRows rows={4} height={56} label="Loading clients" /> : null}
      {status === "error" ? <LoadError title="The client list could not be read." detail="This is not an empty roster — the request failed." onRetry={onRetry} /> : null}
      {status === "ready" && !rows.length ? (
        <div className="hm-empty">
          <strong><Users size={15} /> No clients yet</strong>
          <p>Add a company, or save a meeting in the Film Room, and its next step shows up here.</p>
        </div>
      ) : null}
      {status === "ready" && rows.length ? (
        <ul className="hm-list">
          {rows.slice(0, CLIENT_ROWS_SHOWN).map((row) => {
            const state = CLIENT_STATE[row.state] || CLIENT_STATE.undated;
            return (
              <li key={row.key}>
                <button type="button" className={`hm-row hm-client is-${row.state}`} onClick={() => onOpen(row)}>
                  <span className="hm-avatar" aria-hidden="true">{[...row.name][0]?.toLocaleUpperCase() || "?"}</span>
                  <span className="hm-row__main">
                    <strong dir="auto">{row.name}</strong>
                    <small dir="auto">{row.nextStep || "Nothing written in the Next box yet"}</small>
                  </span>
                  <span className={`pill pill--${state.tone}`}>{state.label(row, today)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {status === "ready" && rows.length > CLIENT_ROWS_SHOWN ? (
        <button type="button" className="hm-more" onClick={onOpenAll}>{plural(rows.length - CLIENT_ROWS_SHOWN, "more client")} <ArrowRight size={14} /></button>
      ) : null}
    </section>
  );
}

export function HomeCourt({
  actor,
  onOpenCompany,
  onOpenAllTasks,
  onOpenTasks,
  onAddTask,
  onOpenCompanies,
  onOpenFilm,
  onOpenAgent,
  onOpenMonitor,
  taskTick = 0
}) {
  const [taskState, setTaskState] = useState({ status: "loading", tasks: [], members: [] });
  const [gamePlan, setGamePlan] = useState({ plan: null, period: "current" });
  const [dayContext, setDayContext] = useState({ status: "loading", events: [], clientMemories: [], companies: [] });
  const [sites, setSites] = useState([]);
  const [busyId, setBusyId] = useState("");
  const [taskError, setTaskError] = useState("");
  const [weekOpen, setWeekOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const today = localIsoDate(clockNow);

  /* Every loader keeps whatever it last read and only changes `status`, so a
     failed refresh can never blank the page into a calm, empty day. */
  const loadTasks = useCallback(async () => {
    if (!actor?.id) return;
    setTaskState((current) => ({ ...current, status: "loading" }));
    try {
      const response = await fetch("/api/tasks?includeDone=true");
      if (!response.ok) throw new Error("The task board did not answer.");
      const body = await response.json();
      setTaskState({ status: "ready", tasks: body.tasks || [], members: body.members || [] });
    } catch {
      setTaskState((current) => ({ ...current, status: "error" }));
    }
  }, [actor?.id]);

  const loadGamePlan = useCallback(async () => {
    if (!actor?.id) return;
    try {
      const response = await fetch(`/api/weekly-review?today=${today}`);
      if (!response.ok) throw new Error("Weekly plan unavailable");
      const body = await response.json();
      setGamePlan({ plan: body.gamePlan || null, period: body.gamePlanPeriod || "current" });
    } catch {
      /* The next move simply falls back to the board and the calendar. */
    }
  }, [actor?.id, today]);

  const loadDayContext = useCallback(async () => {
    if (!actor?.id) return;
    setDayContext((current) => ({ ...current, status: "loading" }));
    try {
      const [calendarResponse, memoryResponse, workspaceResponse] = await Promise.all([
        fetch(`/api/calendar?from=${today}&to=${today}`),
        fetch("/api/client-memory"),
        fetch("/api/workspaces")
      ]);
      if (!calendarResponse.ok || !memoryResponse.ok || !workspaceResponse.ok) throw new Error("Daily context unavailable");
      const [calendarBody, memoryBody, workspaceBody] = await Promise.all([calendarResponse.json(), memoryResponse.json(), workspaceResponse.json()]);
      setDayContext({ status: "ready", events: calendarBody.events || [], clientMemories: memoryBody.memories || [], companies: workspaceBody.companies || [] });
    } catch {
      setDayContext((current) => ({ ...current, status: "error" }));
    }
  }, [actor?.id, today]);

  /* A site that is down outranks everything else on the page. Owner only, and
     quiet when there is nothing to say or the monitor cannot be read. */
  useEffect(() => {
    if (actor?.role !== "owner") return undefined;
    let live = true;
    fetch("/api/monitor/sites").then((response) => (response.ok ? response.json() : { sites: [] })).then((body) => { if (live) setSites(body.sites || []); }).catch(() => {});
    return () => { live = false; };
  }, [actor?.role, taskTick]);

  useEffect(() => { loadTasks(); }, [loadTasks, taskTick]);
  useEffect(() => { loadGamePlan(); }, [loadGamePlan, taskTick]);
  useEffect(() => { loadDayContext(); }, [loadDayContext, taskTick]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const nowMinutes = (clockNow.getHours() * 60) + clockNow.getMinutes();

  const siteAlerts = useMemo(() => {
    const out = [];
    for (const site of sites) {
      if (site.paused) continue;
      if (site.status === "down") out.push({ down: true, title: `${site.name} is down`, detail: `Since ${new Date(site.downSince).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Open Sites to see what the check said.` });
      else if (site.sslDays != null && site.sslDays <= 14) out.push({ down: false, title: `${site.name}'s certificate ${site.sslDays <= 0 ? "has expired" : `expires in ${site.sslDays} days`}`, detail: "Renew it before visitors see a security warning." });
    }
    return out.sort((left, right) => Number(right.down) - Number(left.down));
  }, [sites]);

  const clientRows = useMemo(() => buildClientRoster({
    today,
    clientMemories: dayContext.clientMemories,
    companies: dayContext.companies,
    tasks: taskState.tasks
  }), [dayContext.clientMemories, dayContext.companies, taskState.tasks, today]);

  const command = useMemo(() => buildDailyCommand({
    today,
    nowMinutes,
    actorId: actor?.id,
    tasks: taskState.tasks,
    events: dayContext.events,
    clientMemories: dayContext.clientMemories,
    companies: dayContext.companies,
    gamePlan: gamePlan.plan
  }), [actor?.id, dayContext.clientMemories, dayContext.companies, dayContext.events, gamePlan.plan, nowMinutes, taskState.tasks, today]);

  const remainingEvents = useMemo(() => (dayContext.events || [])
    .filter((event) => event?.title && event.startsOn === today && isEventRemaining(event, nowMinutes))
    .sort((left, right) => String(left.startsAt || "").localeCompare(String(right.startsAt || ""))),
  [dayContext.events, nowMinutes, today]);

  /* What needs doing today: late first, then due today, then whatever is
     already in motion. The rest of the board is one tap away. */
  const { todayTasks, openCount } = useMemo(() => {
    const mine = taskState.tasks.filter((task) => task?.id && task.title && task.status !== "done" && (!actor?.id || task.assigneeId === actor.id));
    const rank = (task) => {
      const distance = daysUntil(task.dueOn, today);
      if (distance != null && distance < 0) return 0;
      if (distance === 0) return 1;
      return task.status === "doing" ? 2 : null;
    };
    const picked = mine
      .filter((task) => rank(task) != null)
      .sort((left, right) => rank(left) - rank(right) || String(left.dueOn || "9999").localeCompare(String(right.dueOn || "9999")));
    return { todayTasks: picked.slice(0, TASK_ROWS_SHOWN), openCount: mine.length };
  }, [actor?.id, taskState.tasks, today]);

  /* Hold the roster back until both the task board and the day context have
     answered: a half-loaded roster would show "No next step" for every client. */
  const dayStatus = dayContext.status === "error" || taskState.status === "error"
    ? "error"
    : dayContext.status === "loading" || (taskState.status === "loading" && !taskState.tasks.length) ? "loading" : "ready";
  const todayStatus = dayContext.status === "error" || taskState.status === "error"
    ? "error"
    : dayContext.status === "loading" && !dayContext.events.length || taskState.status === "loading" && !taskState.tasks.length ? "loading" : "ready";

  function openWeek(id) {
    setWeekOpen(true);
    window.setTimeout(() => scrollToId(id), 60);
  }

  function openCommand() {
    const reference = command.referenceId || "";
    if (command.action === "film") onOpenFilm?.({ meetingId: reference });
    else if (command.action === "company") onOpenCompany?.(reference);
    else if (command.action === "calendar") openWeek("week-planner");
    else if (command.action === "plan") openWeek("weekly-plan");
    else onOpenTasks?.({ scope: "mine", taskId: reference });
  }

  function openClient(row) {
    if (row.companyId) onOpenCompany?.(row.companyId);
    else if (row.meetingId) onOpenFilm?.({ meetingId: row.meetingId });
  }

  async function toggleDone(task) {
    setBusyId(task.id);
    setTaskError("");
    try {
      await completeTask(task.id);
      await loadTasks();
    } catch (caught) {
      setTaskError(caught.message);
    } finally {
      setBusyId("");
    }
  }

  /* Local development has no accounts and calls the one person "You". */
  const firstName = String(actor?.name || "").trim().split(/\s+/)[0].replace(/^You$/, "");

  return (
    <main className="court hm">
      <div className="hm-wrap">
        <header className="hm-intro">
          <span className="hm-date">{formatDate(today, { style: "long" })}</span>
          <h1>{greeting(clockNow.getHours())}{firstName ? `, ${firstName}` : ""}.</h1>
          <DaySummary stats={command.stats} />
          <button type="button" className="hm-ask" onClick={onOpenAgent}>
            <Sparkles size={16} aria-hidden="true" />
            <span>Ask Agent4 anything, or tell it what to organize</span>
            <kbd>⌘J</kbd>
          </button>
        </header>

        {siteAlerts.length ? (
          <button type="button" className={`hm-alert${siteAlerts.some((alert) => alert.down) ? "" : " is-warn"}`} onClick={onOpenMonitor}>
            <Activity size={20} aria-hidden="true" />
            <span><strong>{siteAlerts[0].title}{siteAlerts.length > 1 ? ` and ${siteAlerts.length - 1} more` : ""}</strong><small>{siteAlerts[0].detail}</small></span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : null}

        <NextMove command={command} onOpen={openCommand} onAddTask={onAddTask} />

        <div className="hm-grid">
          <TodayCard
            status={todayStatus}
            events={remainingEvents}
            tasks={todayTasks}
            openCount={openCount}
            today={today}
            busyId={busyId}
            error={taskError}
            onToggle={toggleDone}
            onOpenTask={(task) => onOpenAllTasks?.({ taskId: task.id })}
            onAddTask={onAddTask}
            onOpenBoard={() => onOpenTasks?.({ scope: "mine" })}
            onRetry={() => { loadTasks(); loadDayContext(); }}
          />
          <ClientsCard
            status={dayStatus}
            rows={clientRows}
            total={clientRows.length}
            today={today}
            onOpen={openClient}
            onOpenAll={onOpenCompanies}
            onRetry={() => { loadTasks(); loadDayContext(); }}
          />
        </div>

        <details className="hm-week" open={weekOpen} onToggle={(event) => setWeekOpen(event.currentTarget.open)}>
          <summary>
            <span><strong>Plan the week</strong><small dir="auto">{command.target ? `Target · ${command.target}` : "Set a target, review the week"}</small></span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          {weekOpen ? (
            <div className="hm-week__body">
              <div id="week-planner">
                <WeekPlanner
                  tasks={taskState.tasks}
                  refreshKey={String(taskTick)}
                  onOpenTasks={onOpenAllTasks}
                  onOpenTask={(task) => onOpenAllTasks?.({ taskId: task.id })}
                />
              </div>
              <div id="weekly-plan"><WeeklyReview refreshKey={String(taskTick)} onSaved={loadGamePlan} /></div>
            </div>
          ) : null}
        </details>
      </div>
    </main>
  );
}
