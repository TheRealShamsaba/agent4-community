import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ArrowRight, Building2, Check, CircleAlert, Clock3, ListFilter, MessageSquare, Plus, Search, Send, Trash2, UserRound, X } from "lucide-react";
import { daysUntil, dueLabel, formatDate, formatTime, isOverdue, localIsoDate } from "../format.js";
import { TaskListView } from "./TaskListView.jsx";

const AVATAR_INK = ["var(--gold)", "var(--sky)", "var(--go)", "var(--plum)", "var(--orange)", "#d98cb0", "#8ac6d9", "#c9b06a"];

/* One word per state. The board columns, the drawer's status switch and the
   drawer's kicker all read this map, so a task is never "Open" in one place and
   "To do" in the next. */
const STATUS_LABEL = { open: "To do", doing: "In progress", done: "Done" };
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

async function request(pathname, options = {}) {
  const response = await fetch(`/api/tasks${pathname}`, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The task service returned an unreadable response.");
  }
  if (!response.ok) throw new Error(body?.error?.message || "The task service refused that.");
  return body;
}

async function workspaceRequest(pathname) {
  const response = await fetch(pathname);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "Company workspaces are unavailable.");
  return body;
}

/* One vocabulary for lateness: "overdue", never "late". The wording itself comes
   from the shared dueLabel so the board, the drawer and Telegram agree, and the
   day is the local one — computing it in UTC made the same task read "Today"
   here and "1 day overdue" in the mini-app for the first hours of every day. */
function dueBadge(dueOn, today) {
  const days = daysUntil(dueOn, today);
  if (days === null) return null;
  const text = dueLabel(dueOn, { today });
  if (days < 0) return { text, tone: "overdue" };
  if (days === 0) return { text, tone: "due" };
  if (days <= 7) return { text, tone: "soon" };
  return { text, tone: "later" };
}

/* Activity needs both halves: the day says which conversation this was, the
   clock says whether it landed before or after the call. */
function stamp(value) {
  const day = formatDate(String(value || "").slice(0, 10), { style: "day" });
  const time = formatTime(value);
  if (!day) return time;
  return time ? `${day} at ${time}` : day;
}

function initial(name) {
  return String(name || "?").trim().slice(0, 1).toUpperCase();
}

function Avatar({ member, index, size = 28 }) {
  return (
    <span
      className="tk-av"
      style={{
        width: size,
        height: size,
        background: member ? AVATAR_INK[Math.max(0, index) % AVATAR_INK.length] : "rgba(248,241,227,.12)",
        color: member ? "#15110d" : "var(--court-dim)"
      }}
      aria-hidden="true"
    >
      {member ? initial(member.name) : "—"}
    </span>
  );
}

function compare(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/* Every mode sorts. "Urgency" used to return the array untouched and trust the
   server's order, which meant the sort control silently did nothing for the one
   option that is selected by default. An unexpected priority ranks as normal
   rather than poisoning the comparison with NaN. */
function sortTasks(tasks, mode, today) {
  const rank = (task) => PRIORITY_RANK[task.priority] ?? PRIORITY_RANK.normal;
  const due = (task) => {
    const days = daysUntil(task.dueOn, today);
    return days === null ? Number.POSITIVE_INFINITY : days;
  };
  return [...tasks].sort((left, right) => {
    if (mode === "recent") {
      return String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt));
    }
    if (mode === "priority") {
      return (rank(left) - rank(right)) || compare(due(left), due(right)) || left.title.localeCompare(right.title);
    }
    return compare(due(left), due(right)) || (rank(left) - rank(right)) || left.title.localeCompare(right.title);
  });
}

function TeamFilter({ member, index, selected, load, onSelect, onAssign }) {
  const [over, setOver] = useState(false);
  const active = load?.active || 0;
  const assigneeId = member?.id || "none";

  return (
    <button
      type="button"
      className={`tk-team-filter ${selected ? "is-active" : ""} ${over ? "is-over" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(assigneeId)}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { setOver(false); onAssign(event, member?.id || null); }}
    >
      <Avatar member={member} index={index} size={30} />
      <span>
        <b>{member?.name || "Unassigned"}</b>
        <small>{active} active</small>
      </span>
      {load?.overdue ? <i>{load.overdue} overdue</i> : null}
    </button>
  );
}

const BOARD_COLUMNS = [
  { key: "open", title: STATUS_LABEL.open, help: "Ready to pick up", empty: "Nothing waiting to start." },
  { key: "doing", title: STATUS_LABEL.doing, help: "Work happening now", empty: "Nothing is moving right now." },
  { key: "done", title: STATUS_LABEL.done, help: "Finished work", empty: "Completed tasks will land here." }
];

function BoardCard({ task, today, members, busy, onOpen, onPatch, onAssign, onOpenCompany, onDragStart }) {
  const assignee = members.find((member) => member.id === task.assigneeId) || null;
  const memberIndex = assignee ? members.findIndex((member) => member.id === assignee.id) : members.length;
  const due = dueBadge(task.dueOn, today);
  const next = task.status === "open"
    ? { status: "doing", label: "Start", pending: "Starting…" }
    : task.status === "doing"
      ? { status: "done", label: "Complete", pending: "Completing…" }
      : null;

  return (
    <article
      className={`tk-board-card is-${task.status}`}
      /* The board scrolls: a task opened from a link or the command palette has
         to be findable on the page, not only in the drawer over it. */
      data-task-id={task.id}
      draggable
      onDragStart={(event) => onDragStart(event, task)}
    >
      <button type="button" className="tk-task-main" onClick={() => onOpen(task)}>
        <span className="tk-task-title" dir="auto">{task.title}</span>
        <span className="tk-task-meta">
          {due ? <i className={`tk-pill ${due.tone}`}>{due.text}</i> : <i className="tk-pill later">No due date</i>}
          {task.priority === "high" ? <i className="tk-pill high">High priority</i> : null}
          {task.sourceKey ? <i className="tk-pill agent">agent4</i> : null}
        </span>
      </button>
      {task.companyName || task.project ? (
        <div className="tk-task-links">
          {task.companyName ? (
            onOpenCompany && task.companyId
              ? (
                <button type="button" className="tk-pill company is-link" onClick={() => onOpenCompany(task.companyId)}>
                  <Building2 size={11} aria-hidden="true" />
                  <span dir="auto">@{task.companyName}</span>
                  <span className="sr-only">— open this company</span>
                </button>
              )
              : <i className="tk-pill company" dir="auto">@{task.companyName}</i>
          ) : null}
          {task.project ? <i className="tk-pill project" dir="auto">{task.project}</i> : null}
        </div>
      ) : null}
      <footer className="tk-board-card-foot">
        {/* A visible assignee control, because dragging a card onto a teammate
            chip is a mouse-only gesture and this board is read on a phone. */}
        <label className="tk-card-owner">
          <Avatar member={assignee} index={memberIndex} size={25} />
          <span className="sr-only">Assignee for {task.title}</span>
          <select value={task.assigneeId || ""} disabled={busy} onChange={(event) => onAssign(task, event.target.value)}>
            <option value="">Unassigned</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        {next ? (
          <button
            type="button"
            className="tk-card-next"
            disabled={busy}
            aria-label={`${next.label} ${task.title}`}
            onClick={() => onPatch(task, { status: next.status })}
          >
            {busy ? next.pending : <>{next.label}<ArrowRight size={13} /></>}
          </button>
        ) : <span className="tk-card-finished"><Check size={13} /> Finished</span>}
      </footer>
    </article>
  );
}

function BoardLane({ column, tasks, today, members, busyId, onOpen, onPatch, onAssign, onOpenCompany, onDragStart, onDropStatus, onAdd }) {
  const [over, setOver] = useState(false);
  return (
    <section
      className={`tk-board-lane is-${column.key} ${over ? "is-over" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(false); }}
      onDrop={(event) => { setOver(false); onDropStatus(event, column.key); }}
    >
      <header className="tk-board-lane-head">
        <span className="tk-board-lane-dot" aria-hidden="true" />
        <div>
          <h2>{column.title}</h2>
          <p>{column.help}</p>
        </div>
        <b>{tasks.length}</b>
      </header>
      <div className="tk-board-list">
        {tasks.length ? tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            today={today}
            members={members}
            busy={busyId === task.id}
            onOpen={onOpen}
            onPatch={onPatch}
            onAssign={onAssign}
            onOpenCompany={onOpenCompany}
            onDragStart={onDragStart}
          />
        )) : <div className="tk-board-empty"><span>{column.key === "done" ? <Check size={17} /> : <Clock3 size={17} />}</span><p>{column.empty}</p></div>}
        {column.key === "open" ? <button type="button" className="tk-board-add" onClick={onAdd}><Plus size={15} /> Add a task</button> : null}
      </div>
    </section>
  );
}

function TaskDrawer({ editor, members, projects, companies, workspaceProjects, actor, error, onClose, onSave, onCreate, onRemove, onComment, onOpenCompany }) {
  const task = editor.mode === "edit" ? editor.task : null;
  const [initialForm] = useState(() => task ? {
    title: task.title,
    notes: task.notes,
    dueOn: task.dueOn || "",
    priority: task.priority,
    assigneeId: task.assigneeId || "",
    project: task.project,
    projectId: task.projectId || "",
    companyId: task.companyId || "",
    companyName: task.companyName || "",
    status: task.status
  } : {
    title: "",
    notes: "",
    dueOn: "",
    priority: "normal",
    assigneeId: editor.assigneeId || "",
    project: editor.context?.project?.name || "",
    projectId: editor.context?.project?.id || "",
    companyId: editor.context?.company?.id || "",
    companyName: editor.context?.company?.name || "",
    status: "open"
  });
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsBusy, setCommentsBusy] = useState(Boolean(task));
  const [commentDraft, setCommentDraft] = useState("");
  const [commentError, setCommentError] = useState("");
  const drawerRef = useRef(null);
  const titleRef = useRef(null);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const linkedProjects = workspaceProjects.filter((project) => !form.companyId || project.companyId === form.companyId);

  /* The footer used to read "Last saved 14:20" next to a manual save button,
     which reads like autosave — and then Escape, the scrim and the X threw the
     edits away without a word. Nothing closes over unsaved work silently. */
  const dirty = useMemo(
    () => Object.keys(initialForm).some((key) => String(form[key] ?? "") !== String(initialForm[key] ?? "")),
    [form, initialForm]
  );
  const closeRef = useRef(null);
  closeRef.current = function requestClose() {
    if (dirty && !window.confirm("Discard your unsaved changes to this task?")) return;
    onClose();
  };

  useEffect(() => {
    const previousFocus = document.activeElement;
    titleRef.current?.focus();

    function keydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...drawerRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !drawerRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if (previousFocus?.isConnected && typeof previousFocus.focus === "function") previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (!task) return undefined;
    let ignore = false;
    setCommentsBusy(true);
    request(`/${task.id}/comments`)
      .then((body) => { if (!ignore) setComments(body.comments); })
      .catch((problem) => { if (!ignore) setCommentError(problem.message); })
      .finally(() => { if (!ignore) setCommentsBusy(false); });
    return () => { ignore = true; };
  }, [task]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const values = { ...form, dueOn: form.dueOn || null };
      const saved = task ? await onSave(task, values) : await onCreate(values);
      if (saved) onClose();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const removed = await onRemove(task);
    if (removed) onClose();
  }

  /* A failed comment belongs under the comment box, not at the top of the drawer
     and in the page banner where the reader has already looked away. */
  async function submitComment(event) {
    event.preventDefault();
    const body = commentDraft.trim();
    if (!body) return;
    setCommentError("");
    try {
      const comment = await onComment(task, body);
      setComments((current) => [...current, comment]);
      setCommentDraft("");
    } catch (problem) {
      setCommentError(problem.message);
    }
  }

  const activity = task ? [
    { id: "created", at: task.createdAt, body: `Created by ${members.find((member) => member.id === task.createdBy)?.name || "a teammate"}`, kind: "system" },
    ...(task.updatedAt ? [{ id: "updated", at: task.updatedAt, body: "Task details updated", kind: "system" }] : []),
    ...(task.completedAt ? [{ id: "completed", at: task.completedAt, body: "Marked complete", kind: "completed" }] : []),
    ...comments.map((comment) => ({ ...comment, at: comment.createdAt, kind: "comment" }))
  ].sort((left, right) => String(right.at).localeCompare(String(left.at))) : [];

  return (
    <div className="tk-drawer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
      <aside ref={drawerRef} className="tk-drawer" role="dialog" aria-modal="true" aria-labelledby="task-drawer-title">
        <header className="tk-drawer-head">
          <div>
            <span>{task ? STATUS_LABEL[form.status] : "New task"}</span>
            <h2 id="task-drawer-title" dir="auto">{form.title.trim() || "What needs doing?"}</h2>
          </div>
          <div className="tk-drawer-actions">
            <button type="button" onClick={() => closeRef.current()} aria-label="Close task drawer"><X size={18} /></button>
          </div>
        </header>

        <form className="tk-drawer-form" onSubmit={submit}>
          {error ? <p className="tk-form-error" role="alert">{error}</p> : null}

          <fieldset className="tk-status-field">
            <legend>Status</legend>
            <div>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={form.status === value ? `is-active is-${value}` : ""}
                  aria-pressed={form.status === value}
                  onClick={() => setForm((current) => ({ ...current, status: value }))}
                >
                  {value === "done" ? <Check size={14} /> : <span className="tk-status-dot" />}
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="tk-title-field">
            <span>Task</span>
            <input ref={titleRef} value={form.title} onChange={set("title")} required dir="auto" placeholder="What needs doing?" />
          </label>

          <label>
            <span>Notes</span>
            <textarea value={form.notes} onChange={set("notes")} dir="auto" placeholder="Context, decisions, or a useful next step…" rows={5} />
          </label>

          <div className="tk-form-grid">
            <label>
              <span>Assignee</span>
              <select value={form.assigneeId} onChange={set("assigneeId")}>
                <option value="">Unassigned</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
            <label>
              <span>Due date</span>
              <input type="date" value={form.dueOn} onChange={set("dueOn")} />
            </label>
            <label>
              <span>Priority</span>
              <select value={form.priority} onChange={set("priority")}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              <span>Company</span>
              <select value={form.companyId} onChange={(event) => {
                const company = companies.find((item) => item.id === event.target.value);
                setForm((current) => ({ ...current, companyId: company?.id || "", companyName: company?.name || "", projectId: "", project: "" }));
              }}>
                <option value="">No company</option>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </label>
            <label>
              <span>Project</span>
              <input list="task-project-options" value={form.project} onChange={(event) => {
                const match = linkedProjects.find((project) => project.name.toLocaleLowerCase() === event.target.value.trim().toLocaleLowerCase());
                setForm((current) => ({ ...current, project: event.target.value, projectId: match?.id || "" }));
              }} dir="auto" placeholder="Choose or create" />
              <datalist id="task-project-options">
                {[...new Set([...linkedProjects.map((project) => project.name), ...projects])].map((project) => <option key={project} value={project} />)}
              </datalist>
            </label>
          </div>

          {onOpenCompany && form.companyId ? (
            <button type="button" className="tk-open-company" onClick={() => onOpenCompany(form.companyId)}>
              <Building2 size={15} /> Open {form.companyName || "this company"}<ArrowRight size={14} />
            </button>
          ) : null}

          <footer className="tk-drawer-foot">
            {task && onRemove ? <button type="button" className="tk-delete" onClick={remove}><Trash2 size={15} /> Delete task</button> : null}
            <span className={dirty ? "is-dirty" : ""}>
              {dirty
                ? "Unsaved changes"
                : task
                  ? `Saved ${stamp(task.updatedAt || task.createdAt)}`
                  : "You can fill in the details now or keep it simple."}
            </span>
            <button type="submit" className="tk-save" disabled={busy}>{busy ? "Saving…" : task ? "Save changes" : "Create task"}</button>
          </footer>
        </form>

        {task ? (
          <section className="tk-activity">
            <header>
              <div><MessageSquare size={16} /><h3>Activity</h3></div>
              <span>{comments.length} {comments.length === 1 ? "comment" : "comments"}</span>
            </header>

            <form className="tk-comment-form" onSubmit={submitComment}>
              <Avatar member={actor} index={Math.max(0, members.findIndex((member) => member.id === actor?.id))} size={30} />
              <input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Add a comment…" aria-label="Add a comment" />
              <button type="submit" disabled={!commentDraft.trim()} aria-label="Post comment"><Send size={15} /></button>
            </form>
            {commentError ? <p className="tk-form-error" role="alert">{commentError}</p> : null}

            <div className="tk-activity-list">
              {commentsBusy ? <p className="quiet">Loading activity…</p> : null}
              {!commentsBusy && activity.map((item) => {
                const author = item.kind === "comment" ? members.find((member) => member.id === item.createdBy) : null;
                const authorIndex = author ? members.findIndex((member) => member.id === author.id) : 0;
                return (
                  <article key={item.id} className={`tk-activity-item is-${item.kind}`}>
                    {item.kind === "comment"
                      ? <Avatar member={author} index={authorIndex} size={28} />
                      : <span className="tk-activity-icon">{item.kind === "completed" ? <Check size={13} /> : <Clock3 size={13} />}</span>}
                    <div>
                      {item.kind === "comment" ? <b>{author?.name || "Teammate"}</b> : null}
                      <p dir="auto">{item.body}</p>
                      <time dateTime={item.at}>{stamp(item.at)}</time>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

export function Tasks({ onBack, actor, liveTick = 0, initialFilter = "all", startCreating = false, initialContext = null, initialTaskId = "", dossierCompanies = [], onOpenCompany = null, onTaskOpened = null }) {
  const today = localIsoDate();
  const [data, setData] = useState({ status: "loading", tasks: [], members: [] });
  const [workspaceData, setWorkspaceData] = useState({ companies: [], projects: [] });
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("urgency");
  const [view, setView] = useState(() => {
    try { return window.localStorage.getItem("agent4-task-view") === "board" ? "board" : "list"; } catch { return "list"; }
  });
  function chooseView(next) {
    setView(next);
    try { window.localStorage.setItem("agent4-task-view", next); } catch { /* the choice just will not be remembered */ }
  }
  const [editor, setEditor] = useState(() => startCreating
    ? { mode: "create", assigneeId: initialFilter !== "all" && initialFilter !== "none" ? initialFilter : "", context: initialContext }
    : null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const scrolledTaskRef = useRef("");

  const load = useCallback(async () => {
    try {
      const body = await request("?includeDone=true");
      setData({ status: "ready", tasks: body.tasks, members: body.members });
      setEditor((current) => {
        if (current?.mode !== "edit") return current;
        const refreshed = body.tasks.find((task) => task.id === current.task.id);
        return refreshed ? { ...current, task: refreshed } : null;
      });
    } catch (problem) {
      setData((current) => ({ ...current, status: "error", message: problem.message }));
    }
  }, []);

  useEffect(() => { load(); }, [load, liveTick]);

  /* A task can arrive as a prop — from a URL, the command palette, or a card on
     Home court. Open its drawer once the board has actually loaded, and scroll
     the card underneath into view so closing the drawer does not leave the
     reader somewhere they have to search. */
  useEffect(() => {
    if (!initialTaskId || data.status !== "ready") return;
    const wanted = data.tasks.find((task) => task.id === initialTaskId);
    if (!wanted) return;
    setEditor((current) => (current?.mode === "edit" && current.task.id === wanted.id ? current : { mode: "edit", task: wanted }));
    // Scroll once per task, not on every background refresh of the board.
    if (scrolledTaskRef.current === wanted.id) return;
    scrolledTaskRef.current = wanted.id;
    const card = [...document.querySelectorAll("[data-task-id]")].find((node) => node.dataset.taskId === wanted.id);
    card?.scrollIntoView({ block: "center" });
  }, [initialTaskId, data.status, data.tasks]);
  useEffect(() => {
    workspaceRequest("/api/workspaces")
      .then((body) => setWorkspaceData({ companies: body.companies || [], projects: body.projects || [] }))
      .catch(() => setWorkspaceData({ companies: [], projects: [] }));
  }, []);

  async function run(work) {
    setError("");
    try {
      const result = await work();
      await load();
      return result;
    } catch (problem) {
      setError(problem.message);
      return null;
    }
  }

  const projects = useMemo(
    () => [...new Set(data.tasks.map((task) => task.project).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [data.tasks]
  );
  const companies = useMemo(() => {
    const byId = new Map();
    for (const company of [...dossierCompanies, ...workspaceData.companies, initialContext?.company].filter(Boolean)) {
      if (company?.id && company?.name) byId.set(company.id, { id: company.id, name: company.name });
    }
    for (const task of data.tasks) {
      if (task.companyId && task.companyName && !byId.has(task.companyId)) byId.set(task.companyId, { id: task.companyId, name: task.companyName });
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [data.tasks, dossierCompanies, initialContext, workspaceData.companies]);

  const searched = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return data.tasks;
    return data.tasks.filter((task) => {
      const assignee = data.members.find((member) => member.id === task.assigneeId)?.name || "unassigned";
      return [task.title, task.notes, task.project, task.companyName, assignee].some((value) => String(value || "").toLocaleLowerCase().includes(needle));
    });
  }, [data.members, data.tasks, query]);

  /* The strip counts what the board is actually showing. It used to count the
     whole board while the lanes were filtered by the search, so a two-card
     result sat under a chip claiming "24 active". */
  const counts = useMemo(() => {
    const byAssignee = new Map();
    let everyone = 0;
    for (const task of searched) {
      if (task.status === "done") continue;
      everyone += 1;
      const key = task.assigneeId || "none";
      if (!byAssignee.has(key)) byAssignee.set(key, { active: 0, overdue: 0 });
      const row = byAssignee.get(key);
      row.active += 1;
      if (isOverdue(task.dueOn, today)) row.overdue += 1;
    }
    return { everyone, byAssignee };
  }, [searched, today]);

  const unassignedCount = counts.byAssignee.get("none")?.active || 0;

  const visibleTasks = useMemo(() => searched.filter((task) => {
    if (filter === "none") return !task.assigneeId;
    if (filter === "all") return true;
    return task.assigneeId === filter;
  }), [filter, searched]);

  const board = useMemo(() => ({
    open: sortTasks(visibleTasks.filter((task) => task.status === "open"), sort, today),
    doing: sortTasks(visibleTasks.filter((task) => task.status === "doing"), sort, today),
    done: sortTasks(visibleTasks.filter((task) => task.status === "done"), sort, today)
  }), [visibleTasks, sort, today]);
  const pulse = useMemo(() => {
    const live = [...board.open, ...board.doing];
    return {
      active: live.length,
      today: live.filter((task) => daysUntil(task.dueOn, today) === 0).length,
      overdue: live.filter((task) => isOverdue(task.dueOn, today)).length
    };
  }, [board, today]);
  const serviceError = error || (data.status === "error" ? data.message : "");
  const personalView = filter === actor?.id;

  function openCreate() {
    const assigneeId = filter !== "all" && filter !== "none" ? filter : "";
    setError("");
    setEditor({ mode: "create", assigneeId, context: initialContext });
  }

  function openTask(task) {
    setError("");
    setEditor({ mode: "edit", task });
    onTaskOpened?.(task.id);
  }

  function dragStart(event, task) {
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.effectAllowed = "move";
  }

  function assignDrop(event, assigneeId) {
    const id = event.dataTransfer.getData("text/plain");
    const task = data.tasks.find((item) => item.id === id);
    if (!task) return;
    assignTask(task, assigneeId || "");
  }

  function assignTask(task, assigneeId) {
    if ((task.assigneeId || "") === (assigneeId || "")) return;
    patchTask(task, { assigneeId: assigneeId || "" });
  }

  function statusDrop(event, status) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    const task = data.tasks.find((item) => item.id === id);
    if (!task || task.status === status) return;
    patchTask(task, { status });
  }

  /* Every write marks the task busy for its whole round trip. A PATCH reloads
     the entire board, so without this a second tap during the wait fired a
     second PATCH — the same mistake Telegram already avoids with busyId. */
  async function patchTask(task, updates) {
    if (busyId === task.id) return null;
    setBusyId(task.id);
    try {
      return await run(() => request(`/${task.id}`, { method: "PATCH", body: JSON.stringify(updates) }));
    } finally {
      setBusyId("");
    }
  }

  const createTask = (values) =>
    run(() => request("", { method: "POST", body: JSON.stringify(values) }));

  async function removeTask(task) {
    if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return false;
    return Boolean(await run(() => request(`/${task.id}`, { method: "DELETE" })));
  }

  async function addComment(task, body) {
    const result = await request(`/${task.id}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    await load();
    return result.comment;
  }

  return (
    <div className="court taskspage">
      <div className="bento tk-layout">
        <header className="pg-head c12">
          <div>
            <h1>Tasks</h1>
            <p>{personalView ? "What needs your attention." : "Everything that has to be done, across the team."}</p>
          </div>
          <button type="button" className="tk-add-task" onClick={openCreate}><Plus size={17} /> Add task</button>
        </header>

        <div className="tk-toolbar c12">
          <label className="tk-search">
            <Search size={16} />
            <span className="sr-only">Search tasks</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks, projects, or people" />
            {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button> : null}
          </label>
          <label className="tk-sort">
            <ListFilter size={15} />
            <span className="sr-only">Sort tasks</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort tasks">
              <option value="urgency">Urgency</option>
              <option value="priority">Priority</option>
              <option value="recent">Recently updated</option>
            </select>
          </label>
          <div className="tk-viewswitch" role="group" aria-label="How to show tasks">
            <button type="button" className={view === "list" ? "is-on" : ""} aria-pressed={view === "list"} onClick={() => chooseView("list")}>List</button>
            <button type="button" className={view === "board" ? "is-on" : ""} aria-pressed={view === "board"} onClick={() => chooseView("board")}>Board</button>
          </div>
          <div className="tk-pulse" aria-label={`${pulse.active} active, ${pulse.today} due today, ${pulse.overdue} overdue`}>
            <span><b>{pulse.active}</b> active</span><span className={pulse.today ? "is-warm" : ""}><b>{pulse.today}</b> today</span><span className={pulse.overdue ? "is-overdue" : ""}><b>{pulse.overdue}</b> overdue</span>
          </div>
        </div>

        <nav className="tk-team-strip c12" aria-label="Filter tasks by teammate">
          <button type="button" className={`tk-team-all ${filter === "all" ? "is-active" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            <span><UserRound size={17} /></span>
            <b>Everyone</b>
            <small>{counts.everyone} active</small>
          </button>
          {data.members.map((member, index) => (
            <TeamFilter
              key={member.id}
              member={member}
              index={index}
              selected={filter === member.id}
              load={counts.byAssignee.get(member.id)}
              onSelect={setFilter}
              onAssign={assignDrop}
            />
          ))}
          {/* The chip stays while its filter is active even at zero, so clearing
              the last unassigned task leaves a visible reason for the empty board. */}
          {unassignedCount || filter === "none" ? (
            <TeamFilter
              member={null}
              index={data.members.length}
              selected={filter === "none"}
              load={counts.byAssignee.get("none")}
              onSelect={setFilter}
              onAssign={assignDrop}
            />
          ) : null}
        </nav>

        {unassignedCount && filter !== "none" ? (
          <button type="button" className="tk-unassigned-alert c12" onClick={() => setFilter("none")}>
            <span><CircleAlert size={18} /></span>
            <span><b>{unassignedCount} {unassignedCount === 1 ? "task needs" : "tasks need"} an owner</b><small>Review unassigned work before it becomes invisible.</small></span>
            <i>Review now</i>
          </button>
        ) : null}

        {serviceError ? <section className="tk-service-error c12" role="alert">{serviceError}</section> : null}
        {data.status === "loading" ? <section className="mod c12"><p className="quiet">Loading the team's work…</p></section> : null}

        {data.status !== "loading" && view === "list" ? (
          <main className="c12" aria-label="Task list">
            <TaskListView
              tasks={visibleTasks}
              members={data.members}
              today={today}
              busyId={busyId}
              onOpen={openTask}
              onPatch={patchTask}
              onOpenCompany={onOpenCompany}
              onQuickAdd={(title) => createTask({ title, assigneeId: filter !== "all" && filter !== "none" ? filter : actor?.id })}
            />
          </main>
        ) : null}

        {data.status !== "loading" && view === "board" ? (
          <main className="tk-board c12" aria-label="Task status board">
            {BOARD_COLUMNS.map((column) => (
              <BoardLane
                key={column.key}
                column={column}
                tasks={board[column.key]}
                today={today}
                members={data.members}
                busyId={busyId}
                onOpen={openTask}
                onPatch={patchTask}
                onAssign={assignTask}
                onOpenCompany={onOpenCompany}
                onDragStart={dragStart}
                onDropStatus={statusDrop}
                onAdd={openCreate}
              />
            ))}
          </main>
        ) : null}
      </div>

      {editor ? (
        <TaskDrawer
          key={editor.mode === "edit" ? editor.task.id : `create-${editor.assigneeId}`}
          editor={editor}
          members={data.members}
          projects={projects}
          companies={companies}
          workspaceProjects={workspaceData.projects}
          actor={actor}
          error={serviceError}
          onClose={() => { setEditor(null); onTaskOpened?.(""); }}
          onSave={patchTask}
          onCreate={createTask}
          onRemove={actor?.role === "owner" ? removeTask : null}
          onComment={addComment}
          onOpenCompany={onOpenCompany}
        />
      ) : null}
    </div>
  );
}
