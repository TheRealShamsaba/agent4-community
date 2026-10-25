import React, { useMemo, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { daysUntil, dueLabel } from "../format.js";

/* The task list a person actually works from: what is late, what is today,
   what is coming, in that order, with the client on every row and a tick that
   finishes the task. The board stays one tap away for moving work around. */

const GROUPS = [
  { id: "overdue", label: "Late", tone: "bad" },
  { id: "today", label: "Today", tone: "warn" },
  { id: "week", label: "This week", tone: "" },
  { id: "later", label: "Later", tone: "" },
  { id: "none", label: "No date", tone: "" }
];
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

function groupOf(task, today) {
  const days = daysUntil(task.dueOn, today);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return days <= 7 ? "week" : "later";
}

function initialOf(member) {
  return String(member?.name || "?").trim().slice(0, 1).toUpperCase();
}

function Row({ task, today, member, busy, onOpen, onPatch, onOpenCompany }) {
  const done = task.status === "done";
  const days = daysUntil(task.dueOn, today);
  return (
    <li className={`tl-row${done ? " is-done" : ""}`}>
      <label className="tl-tick">
        <input type="checkbox" checked={done} disabled={busy} aria-label={done ? `Reopen “${task.title}”` : `Mark “${task.title}” done`} onChange={() => onPatch(task, { status: done ? "open" : "done" })} />
        <Check size={13} strokeWidth={3} aria-hidden="true" />
      </label>
      <button type="button" className="tl-main" onClick={() => onOpen(task)}>
        <strong dir="auto">{task.title}</strong>
        <small>
          {task.priority === "high" ? <em className="is-high">High</em> : null}
          {task.status === "doing" ? <em className="is-doing">Doing</em> : null}
          {task.project ? <span>{task.project}</span> : null}
        </small>
      </button>
      {task.companyName && task.companyId ? <button type="button" className="tl-company" onClick={() => onOpenCompany(task.companyId)} dir="auto">{task.companyName}</button> : null}
      {task.dueOn ? <span className={`tl-due${days !== null && days < 0 && !done ? " is-late" : days === 0 && !done ? " is-today" : ""}`}>{dueLabel(task.dueOn, { today })}</span> : null}
      <span className="tl-who" title={member?.name || "Unassigned"}>{member ? initialOf(member) : "–"}</span>
    </li>
  );
}

export function TaskListView({ tasks, members, today, busyId, onOpen, onPatch, onOpenCompany, onQuickAdd }) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const byId = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  const { groups, done } = useMemo(() => {
    const buckets = new Map(GROUPS.map((group) => [group.id, []]));
    const finished = [];
    for (const task of tasks) {
      if (task.status === "done") finished.push(task);
      else buckets.get(groupOf(task, today)).push(task);
    }
    for (const list of buckets.values()) {
      list.sort((left, right) => String(left.dueOn || "9999").localeCompare(String(right.dueOn || "9999"))
        || (PRIORITY_RANK[left.priority] ?? 1) - (PRIORITY_RANK[right.priority] ?? 1)
        || String(left.title).localeCompare(String(right.title)));
    }
    finished.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
    return { groups: buckets, done: finished };
  }, [tasks, today]);

  const openCount = [...groups.values()].reduce((sum, list) => sum + list.length, 0);

  async function submit(event) {
    event.preventDefault();
    const title = draft.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await onQuickAdd(title);
      setDraft("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="tl">
      <form className="tl-add" onSubmit={submit}>
        <Plus size={17} aria-hidden="true" />
        <input value={draft} dir="auto" onChange={(event) => setDraft(event.target.value)} placeholder="Add a task and press Enter" aria-label="Add a task" disabled={adding} />
        {draft.trim() ? <button type="submit" className="btn btn--gold" disabled={adding}>Add</button> : null}
      </form>

      {GROUPS.map((group) => {
        const list = groups.get(group.id);
        if (!list.length) return null;
        return (
          <section className="tl-group" key={group.id} aria-label={group.label}>
            <h3 className={group.tone ? `is-${group.tone}` : ""}>{group.label}<b>{list.length}</b></h3>
            <ul>{list.map((task) => <Row key={task.id} task={task} today={today} member={byId.get(task.assigneeId)} busy={busyId === task.id} onOpen={onOpen} onPatch={onPatch} onOpenCompany={onOpenCompany} />)}</ul>
          </section>
        );
      })}

      {!openCount ? (
        <div className="tl-empty">
          <strong>{done.length ? "All clear." : "No tasks yet."}</strong>
          <p>{done.length ? "Everything on this list is done. Add the next thing above." : "Type one above, or ask Agent4 what to do first."}</p>
        </div>
      ) : null}

      {done.length ? (
        <section className="tl-group tl-done" aria-label="Done">
          <button type="button" className="tl-done__toggle" onClick={() => setShowDone((open) => !open)} aria-expanded={showDone}>Done<b>{done.length}</b><ChevronDown size={15} aria-hidden="true" /></button>
          {showDone ? <ul>{done.slice(0, 15).map((task) => <Row key={task.id} task={task} today={today} member={byId.get(task.assigneeId)} busy={busyId === task.id} onOpen={onOpen} onPatch={onPatch} onOpenCompany={onOpenCompany} />)}</ul> : null}
        </section>
      ) : null}
    </div>
  );
}
