import React, { useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { TelegramSheet } from "./TelegramSheet.jsx";

const STATUS_OPTIONS = [
  { value: "open", label: "To do" },
  { value: "doing", label: "In progress" },
  { value: "done", label: "Done" }
];

/* Before this, the only interactive thing on a task in the mini-app was the
   26px check circle: a task could not be opened, renamed, rescheduled or handed
   to anyone else from a phone at all. The words match the web on purpose —
   Due date, Assignee, Unassigned. */
export function TelegramTaskSheet({ task, members, onClose, onSave }) {
  const [form, setForm] = useState({
    title: task.title || "",
    dueOn: task.dueOn || "",
    assigneeId: task.assigneeId || "",
    status: task.status || "open"
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(task, {
        title: form.title,
        dueOn: form.dueOn || null,
        assigneeId: form.assigneeId,
        status: form.status
      });
      onClose();
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TelegramSheet label={`Task: ${task.title}`} kicker="TASK" title="Change this task" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Task<input value={form.title} onChange={set("title")} maxLength={240} dir="auto" required /></label>
        <div className="tg-form-row">
          <label>Due date<input type="date" value={form.dueOn} onChange={set("dueOn")} /></label>
          <label>Status
            <select value={form.status} onChange={set("status")}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <label>Assignee
          <select value={form.assigneeId} onChange={set("assigneeId")}>
            <option value="">Unassigned</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        {form.dueOn ? <button type="button" className="tg-clear-date" onClick={() => setForm((current) => ({ ...current, dueOn: "" }))}>Clear the due date</button> : null}
        {error ? <p className="tg-form-error" role="alert">{error}</p> : null}
        <button type="submit" className="tg-submit" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={17} /> : <Check size={17} />} Save changes</button>
      </form>
    </TelegramSheet>
  );
}
