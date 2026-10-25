import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Instagram,
  Linkedin,
  ListTodo,
  LoaderCircle,
  Plus,
  RotateCcw,
  Target,
  Trash2,
  X
} from "lucide-react";
import { addDays, formatDate, localIsoDate } from "../format.js";
import { LoadError, SkeletonRows } from "./HomeStates.jsx";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function weekStart(today) {
  const value = new Date(`${today}T12:00:00`);
  const sinceMonday = value.getDay() === 0 ? 6 : value.getDay() - 1;
  return addDays(today, -sinceMonday);
}

/* One panel, one set of modal manners: a real dialog role, Escape, a Tab loop
   that cannot walk out into the page behind, and the focus put back where the
   user left it. Written once so the event editor and the weekly reset cannot
   drift apart again. */
function Overlay({ label, onClose, className = "", children }) {
  const panelRef = useRef(null);
  const returnRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    returnRef.current = document.activeElement;
    const panel = panelRef.current;
    const items = () => Array.from(panel?.querySelectorAll(FOCUSABLE) || []);
    const opening = panel?.querySelector("input, textarea") || items()[0];
    opening?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = Array.from(document.body.children).filter((node) => !node.contains(panel));
    const inertStates = background.map((node) => node.inert);
    background.forEach((node) => { node.inert = true; });

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = items();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!panel?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const previous = returnRef.current;
      document.body.style.overflow = previousOverflow;
      background.forEach((node, index) => { node.inert = inertStates[index]; });
      if (previous?.isConnected && typeof previous.focus === "function") previous.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="home-event-backdrop" role="presentation" onPointerDown={(pointer) => { if (pointer.target === pointer.currentTarget) onClose(); }}>
      <aside className={`home-event-editor ${className}`} ref={panelRef} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </aside>
    </div>, document.body
  );
}

async function calendarRequest(pathname = "", options = {}) {
  const response = await fetch(`/api/calendar${pathname}`, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "The calendar could not be updated.");
  return body;
}

function EventEditor({ event, busy, error, onChange, onSave, onDelete, onClose }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [timed, setTimed] = useState(Boolean(event.startsAt));
  useEffect(() => { setConfirmDelete(false); }, [event.id]);
  return (
    <Overlay label={event.id ? "Edit event" : "Add to calendar"} onClose={onClose}>
      <header><span><small>Your calendar</small><strong>{event.id ? "Edit event" : "Add to calendar"}</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
      <form onSubmit={onSave} aria-busy={busy}>
        <label className="is-wide">Event title<input required maxLength={240} value={event.title} onChange={(change) => onChange({ title: change.target.value })} placeholder="What is happening?" /></label>
        <div className="calendar-event-kind is-wide" role="group" aria-label="Event schedule">
          <button type="button" aria-pressed={!timed} onClick={() => { setTimed(false); onChange({ startsAt: "" }); }}>All day</button>
          <button type="button" aria-pressed={timed} onClick={() => { setTimed(true); onChange({ startsAt: event.startsAt || "09:00" }); }}><Clock3 size={14} /> Set a time</button>
        </div>
        <label>Date<input required type="date" value={event.startsOn} onChange={(change) => onChange({ startsOn: change.target.value })} /></label>
        {timed ? <label>Start time<input required type="time" value={event.startsAt || ""} onChange={(change) => onChange({ startsAt: change.target.value })} /></label> : null}
        {timed ? <label>Duration<select value={event.durationMinutes || 60} onChange={(change) => onChange({ durationMinutes: Number(change.target.value) })} disabled={!event.startsAt}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option>{![30, 45, 60, 90, 120].includes(event.durationMinutes) && event.durationMinutes ? <option value={event.durationMinutes}>{event.durationMinutes} minutes</option> : null}</select></label> : null}
        <label className="is-wide">Notes<textarea rows="3" maxLength={2000} value={event.notes || ""} onChange={(change) => onChange({ notes: change.target.value })} placeholder="Anything useful to remember…" /></label>
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          {/* Deleting a meeting cannot be undone from here, so it takes two
              deliberate taps rather than one mis-aimed one. */}
          {event.id ? (
            confirmDelete
              ? (
                <span className="home-delete-confirm">
                  <b>Delete this event for good?</b>
                  <button type="button" className="btn btn--quiet" onClick={() => setConfirmDelete(false)}>Keep it</button>
                  <button type="button" className="btn btn--danger" onClick={onDelete} disabled={busy}><Trash2 size={13} /> Delete</button>
                </span>
              )
              : <button type="button" className="is-delete" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete</button>
          ) : <span />}
          {confirmDelete ? null : <button type="button" className="is-cancel" onClick={onClose}>Cancel</button>}
          {confirmDelete ? null : <button type="submit" className="is-save" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />} Save event</button>}
        </footer>
      </form>
    </Overlay>
  );
}

function PlannerItem({ item, onEvent, onOpenTask, onContent }) {
  const Icon = item.type === "post" ? item.platform === "linkedin" ? Linkedin : Instagram : item.type === "task" ? ListTodo : Clock3;
  const action = item.type === "event" ? () => onEvent(item.source) : item.type === "task" ? () => onOpenTask(item.source) : onContent;
  return (
    <button type="button" className={`home-plan-item is-${item.type}${item.platform ? ` is-${item.platform}` : ""}`} onClick={action}>
      <Icon size={12} />
      <span><b dir="auto">{item.title}</b><small>{item.meta}</small></span>
    </button>
  );
}

export function WeekPlanner({ tasks, refreshKey = 0, onOpenTasks, onOpenTask, onOpenContent }) {
  const today = localIsoDate();
  const [start, setStart] = useState(() => weekStart(today));
  const [view, setView] = useState("week");
  const end = addDays(start, 6);
  const requestRef = useRef(0);
  const loadedStartRef = useRef(null);
  const [events, setEvents] = useState([]);
  const [posts, setPosts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setStatus((current) => current === "ready" && loadedStartRef.current === start ? "ready" : "loading");
    try {
      const [calendarBody, contentResponse] = await Promise.all([
        calendarRequest(`?from=${start}&to=${end}`),
        fetch(`/api/content?from=${start}&to=${end}`)
      ]);
      const contentBody = await contentResponse.json().catch(() => ({}));
      if (!contentResponse.ok) throw new Error(contentBody?.error?.message || "The content plan is unavailable.");
      if (request !== requestRef.current) return;
      loadedStartRef.current = start;
      setEvents(calendarBody.events || []);
      setPosts(contentBody.posts || []);
      setStatus("ready");
      setError("");
    } catch (caught) {
      if (request !== requestRef.current) return;
      setStatus("error");
      setError(caught.message);
    }
  }, [start, end]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const items = [
      ...events.filter((event) => event.startsOn === date).map((event) => ({ type: "event", title: event.title, meta: event.startsAt || "All day", sort: event.startsAt || "00:00", source: event })),
      ...tasks.filter((task) => task.status !== "done" && task.dueOn === date).map((task) => ({ type: "task", title: task.title, meta: task.project || "Task due", sort: "20:00", source: task })),
      ...posts.filter((post) => post.status !== "published" && post.plannedOn === date).map((post) => ({ type: "post", platform: post.platform, title: post.title, meta: `${post.platform === "linkedin" ? "LinkedIn" : "Instagram"} · ${post.status}`, sort: "21:00", source: post }))
    ].sort((left, right) => left.sort.localeCompare(right.sort));
    return { date, items };
  }), [start, events, posts, tasks]);

  function addOn(date) {
    setError("");
    setEditor({ title: "", startsOn: date, startsAt: "", durationMinutes: 60, notes: "" });
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const payload = { title: editor.title, startsOn: editor.startsOn, startsAt: editor.startsAt || null, durationMinutes: editor.startsAt ? editor.durationMinutes || 60 : null, notes: editor.notes || "" };
      if (editor.id) await calendarRequest(`/${editor.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await calendarRequest("", { method: "POST", body: JSON.stringify(payload) });
      setEditor(null);
      if (editor.startsOn < start || editor.startsOn > end) setStart(weekStart(editor.startsOn));
      else await load();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editor?.id || busy) return;
    setBusy(true);
    try {
      await calendarRequest(`/${editor.id}`, { method: "DELETE" });
      setEditor(null);
      await load();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="home-week-planner" aria-label="Your calendar">
      <header className="home-block-head">
        <span><small>Your schedule</small><strong>Calendar</strong><p>Make room for what matters. Events, deadlines, and posts in one place.</p></span>
        <button type="button" className="is-primary" onClick={() => addOn(today >= start && today <= end ? today : start)}><Plus size={16} /> New event</button>
      </header>
      {status === "error" && !editor ? (
        <div className="home-block-body"><LoadError title="The week could not be read." detail={error} onRetry={load} /></div>
      ) : null}
      {error && status !== "error" && !editor ? <p className="home-planner-error" role="alert">{error}</p> : null}
      <div className="calendar-toolbar">
        <div className="calendar-navigation"><button type="button" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}><ChevronLeft size={16} /></button><button type="button" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}><ChevronRight size={16} /></button><strong aria-live="polite">{new Date(`${start}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {new Date(`${end}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</strong><button type="button" onClick={() => setStart(weekStart(today))}>Today</button></div>
        <div className="calendar-view-switch" role="group" aria-label="Calendar view"><button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}><CalendarDays size={14} /> Week</button><button type="button" aria-pressed={view === "agenda"} onClick={() => setView("agenda")}><ListTodo size={14} /> Agenda</button></div>
      </div>
      <div className="calendar-legend"><span><i /> Events</span><span><i /> Task deadlines</span><span><i /> Scheduled posts</span></div>
      {status === "loading" ? <div className="home-block-body"><SkeletonRows rows={3} height={48} label="Loading calendar" /></div> : status === "ready" ? <div className={`home-week-days${view === "agenda" ? " is-agenda" : ""}`}>

        {days.map((day) => (
          <article className={day.date === today ? "is-today" : ""} key={day.date}>
            <header><span>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</span><b>{new Date(`${day.date}T12:00:00`).getDate()}</b></header>
            <div>
              {day.items.map((item, itemIndex) => (
                <PlannerItem key={`${item.type}-${item.source.id}-${itemIndex}`} item={item} onEvent={setEditor} onOpenTask={onOpenTask || onOpenTasks} onContent={onOpenContent} />
              ))}
              {!day.items.length ? <p className="calendar-day-empty">Nothing planned</p> : null}
              {/* Every day is its own add button, carrying its own date. The old
                  single button always seeded today, which made Thursday's
                  meeting a three-step job. */}
              <button type="button" className={`home-day-add${day.items.length ? "" : " is-empty"}`} onClick={() => addOn(day.date)}>
                <Plus size={12} />
                <span>{day.items.length ? "Add" : `Add to ${formatDate(day.date, { style: "short", today })}`}</span>
              </button>
            </div>
          </article>
        ))}
      </div> : null}
      {editor ? <EventEditor event={editor} busy={busy} error={error} onChange={(patch) => setEditor((current) => ({ ...current, ...patch }))} onSave={save} onDelete={remove} onClose={() => { if (!busy) { setEditor(null); setError(""); } }} /> : null}
    </section>
  );
}

async function weeklyReviewRequest(pathname, options = {}) {
  const response = await fetch(pathname, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "The weekly review could not be updated.");
  return body;
}

function WeeklyReviewEditor({ value, period, busy, error, onChange, onSave, onClose }) {
  const targetPeriod = period === "next" ? "next week" : "this week";
  return (
    <Overlay label="Weekly reset" className="home-review-editor" onClose={onClose}>
      <header><span><small>Weekly game plan</small><strong>Turn reflection into a clear {targetPeriod}</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
      <form onSubmit={onSave}>
        <label className="is-wide">What worked recently?<textarea rows="5" maxLength={2000} value={value.wins} onChange={(change) => onChange({ wins: change.target.value })} placeholder="Wins, good decisions, moments you want to repeat…" /></label>
        <label className="is-wide">What should change?<textarea rows="5" maxLength={2000} value={value.lessons} onChange={(change) => onChange({ lessons: change.target.value })} placeholder="What felt hard, slipped, or should be handled differently?" /></label>
        <label className="is-wide">The target for {targetPeriod}<textarea required rows="4" maxLength={1000} value={value.nextFocus} onChange={(change) => onChange({ nextFocus: change.target.value })} placeholder={`The single outcome that makes ${targetPeriod} count.`} /></label>
        {error ? <p role="alert">{error}</p> : null}
        <footer><span /><button type="button" className="is-cancel" onClick={onClose}>Cancel</button><button type="submit" className="is-save" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />} Save the target</button></footer>
      </form>
    </Overlay>
  );
}

export function WeeklyReview({ refreshKey = 0, onSaved }) {
  const today = localIsoDate();
  const [state, setState] = useState({ status: "loading", review: null, reviewWeekStart: null, gamePlan: null, gamePlanPeriod: "current", summary: null, week: null, isSunday: false });
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: current.status === "ready" ? "ready" : "loading" }));
    try {
      const body = await weeklyReviewRequest(`/api/weekly-review?today=${today}`);
      setState({ status: "ready", review: body.review, reviewWeekStart: body.reviewWeekStart, gamePlan: body.gamePlan, gamePlanPeriod: body.gamePlanPeriod || "current", summary: body.summary, week: body.week, isSunday: body.isSunday });
      setError("");
    } catch (caught) {
      setState((current) => ({ ...current, status: "error" }));
      setError(caught.message);
    }
  }, [today]);

  useEffect(() => { load(); }, [load, refreshKey]);

  function openEditor() {
    setEditor({
      wins: state.review?.wins || "",
      lessons: state.review?.lessons || "",
      nextFocus: state.review?.nextFocus || ""
    });
  }

  async function save(event) {
    event.preventDefault();
    if (!state.reviewWeekStart) return;
    setBusy(true);
    setError("");
    try {
      const body = await weeklyReviewRequest("/api/weekly-review", {
        method: "PUT",
        body: JSON.stringify({ weekStart: state.reviewWeekStart, ...editor })
      });
      setState((current) => ({
        ...current,
        review: body.review,
        gamePlan: body.gamePlan,
        gamePlanPeriod: body.gamePlan?.targetWeekStart === current.week?.start ? "current" : "next"
      }));
      onSaved?.();
      setEditor(null);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  const summary = state.summary || {};
  const gamePlan = state.gamePlan || { target: "", moves: [], needsTarget: true, guidance: "Lock one outcome so Agent4 can rank the work." };
  const targetLabel = state.gamePlanPeriod === "next" ? "Next week’s target" : "This week’s target";
  const metrics = [
    { label: "IG posts", value: summary.instagramPosts || 0, tone: "pink" },
    { label: "LinkedIn posts", value: summary.linkedinPosts || 0, tone: "blue" },
    { label: "Tasks finished", value: summary.tasksDone || 0, tone: "green" },
    { label: "Momentum", value: summary.momentumPoints || 0, suffix: " pts", tone: "gold" },
    { label: "Missed posts", value: summary.postingMisses || 0, tone: summary.postingMisses ? "red" : "quiet" }
  ];

  return (
    <section id="weekly-game-plan" className={`home-weekly-review ${state.isSunday ? "is-sunday" : ""}`} aria-label="Weekly target and next steps">
      <header className="home-block-head">
        <span><small>{state.isSunday ? "Ready now · Build next week" : "Weekly game plan"}</small><strong>One target. Three next steps.</strong><p>Agent4 ranks the real board against your target, while keeping urgent commitments visible.</p></span>
        <button type="button" className={state.review ? "is-quiet" : "is-primary"} onClick={openEditor} disabled={!state.reviewWeekStart}>{state.review ? <BookOpenCheck size={14} /> : <RotateCcw size={14} />} {state.review ? `Edit ${state.isSunday ? "next week’s" : "this week’s"} target` : `Set ${state.isSunday ? "next week’s" : "this week’s"} target`}</button>
      </header>
      {state.status === "error" && !editor ? (
        <div className="home-block-body"><LoadError title="This week’s target could not be read." detail={error} onRetry={load} /></div>
      ) : null}
      {error && state.status !== "error" && !editor ? <p className="home-planner-error" role="alert">{error}</p> : null}
      <div className={`home-review-body${state.isSunday ? " has-metrics" : ""}`}>
        {state.isSunday ? <div className="home-review-metrics">
          {metrics.map((metric) => <article className={`is-${metric.tone}`} key={metric.label}><b>{state.status === "loading" ? "–" : metric.value}{metric.suffix || ""}</b><small>{metric.label}</small></article>)}
        </div> : null}
        <aside className={gamePlan.target ? "is-saved" : ""}>
          <span>{gamePlan.target ? <Target size={19} /> : <BarChart3 size={19} />}</span>
          <span>
            <small>{gamePlan.target ? targetLabel : "No target set"}</small>
            <strong dir="auto">{gamePlan.target || "The urgent work is ranked, but Agent4 cannot tell strategy from noise yet."}</strong>
            <p>{gamePlan.guidance}</p>
            <ol className="home-game-plan-list">
              {(gamePlan.moves || []).slice(0, 3).map((move, index) => <li key={move.id}><b>{index + 1}</b><span><strong dir="auto">{move.title}</strong><small>{move.reason}</small></span></li>)}
            </ol>
          </span>
        </aside>
      </div>
      {editor ? <WeeklyReviewEditor value={editor} period={state.isSunday ? "next" : "current"} busy={busy} error={error} onChange={(patch) => setEditor((current) => ({ ...current, ...patch }))} onSave={save} onClose={() => { setEditor(null); setError(""); }} /> : null}
    </section>
  );
}
