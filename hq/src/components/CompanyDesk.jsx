import React, { useState } from "react";
import { Check, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { addDays, localIsoDate } from "../format.js";
import { KIND_LABELS, STAGE_DEFINITIONS, STAGE_LABELS, STAGE_PROMPTS } from "../workspace-model.js";

const KINDS = ["client", "prospect", "owned", "internal"];
const STAGES = ["lead", "talking", "proposal", "active", "operating", "dormant", "lost"];
export async function companyRequest(pathname, options = {}) {
  const response = await fetch(pathname, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // The server now refuses a duplicate name instead of handing back the row it
    // already had, so the code and the id it names have to survive the throw.
    const error = new Error(body?.error?.message || "The company could not be saved.");
    error.code = body?.error?.code || "";
    error.companyId = body?.error?.companyId || "";
    throw error;
  }
  return body;
}

/** Pipeline prospects and Film Room clients exist only in their own stores until the team edits them. */
export async function materializeCompany(company) {
  if (company.stored) return company;
  try {
    const body = await companyRequest("/api/workspaces/companies", {
      method: "POST",
      body: JSON.stringify({ id: company.id, name: company.name, website: company.url, summary: company.summary, kind: company.kind, stage: company.stage })
    });
    return { ...company, ...body.company, stored: true, storedId: body.company.id };
  } catch (caught) {
    // The route now refuses a duplicate rather than handing back the existing
    // row. Giving it a home is not a duplicate: adopt the row it names.
    if (caught.code === "company_name_taken" && caught.companyId) return { ...company, id: caught.companyId, stored: true, storedId: caught.companyId };
    throw caught;
  }
}

export async function patchCompany(company, updates) {
  const ready = await materializeCompany(company);
  const body = await companyRequest(`/api/workspaces/companies/${encodeURIComponent(ready.storedId || ready.id)}`, { method: "PATCH", body: JSON.stringify(updates) });
  return body.company;
}

/** Preview first: with no confirm nothing is deleted and the counts come back. */
export async function removeCompany(company, { confirm = false } = {}) {
  const id = encodeURIComponent(company.storedId || company.id);
  return companyRequest(`/api/workspaces/companies/${id}${confirm ? "?confirm=true" : ""}`, { method: "DELETE" });
}

/** What the attached counts from a delete preview read like in a sentence. */
function attachedSummary(attached = {}) {
  const parts = [
    [attached.projects, "project", "projects"],
    [attached.sheets, "questionnaire", "questionnaires"],
    [attached.decisions, "decision", "decisions"],
    [attached.resources, "file or link", "files and links"],
    [attached.meetings, "meeting", "meetings"],
    [attached.tasks, "task", "tasks"],
    [attached.events, "history entry", "history entries"]
  ].filter(([count]) => Number(count) > 0).map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  return parts;
}

/* ------------------------------------------------------------- dialog --- */

export function CompanyDetailsDialog({ company = null, focusField = "name", onClose, onSaved, onDeleted, onOpenCompany }) {
  const creating = !company;
  const [form, setForm] = useState({
    name: company?.name || "",
    kind: company?.kind || "client",
    stage: company?.stage || "lead",
    website: company?.url || company?.website || "",
    contactName: company?.contactName || "",
    contactRole: company?.contactRole || "",
    contactPhone: company?.contactPhone || "",
    contactTelegram: company?.contactTelegram || "",
    contactEmail: company?.contactEmail || "",
    howMet: company?.howMet || "",
    summary: company?.summary || "",
    nextAction: company?.nextAction || "",
    nextActionOn: company?.nextActionOn || "",
    hidden: Boolean(company?.hidden)
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clash, setClash] = useState("");
  const [removal, setRemoval] = useState(null);
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setClash("");
    try {
      if (creating) {
        const body = await companyRequest("/api/workspaces/companies", { method: "POST", body: JSON.stringify(form) });
        onSaved(body.company, { created: true });
      } else {
        onSaved(await patchCompany(company, form), { created: false });
      }
    } catch (caught) {
      setError(caught.message);
      if (caught.code === "company_name_taken" && caught.companyId) setClash(caught.companyId);
    } finally {
      setBusy(false);
    }
  }

  async function askToDelete() {
    setBusy(true);
    setError("");
    try {
      setRemoval(await removeCompany(company));
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setError("");
    try {
      await removeCompany(company, { confirm: true });
      onDeleted?.(company);
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  }

  const auto = (field) => field === focusField;

  if (removal) {
    const attached = attachedSummary(removal.attached);
    return (
      <div className="cp-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <aside className="cp-dialog cd-dialog cd-confirm" role="dialog" aria-modal="true" aria-label={`Delete ${company.name}`}>
          <header><span><small>DELETE COMPANY</small><strong dir="auto">{company.name}</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
          <div className="cd-confirm-body">
            <p className="cd-confirm-lead"><TriangleAlert size={15} /> Deleting {company.name} deletes everything filed under it. This cannot be undone.</p>
            {attached.length
              ? <ul className="cd-confirm-list">{attached.map((line) => <li key={line}>{line}</li>)}</ul>
              : <p className="cd-confirm-empty">Nothing is filed under this company yet.</p>}
            {error ? <p role="alert">{error}</p> : null}
            <footer><button type="button" onClick={() => setRemoval(null)}>Keep it</button><button type="button" className="is-danger" disabled={busy} onClick={() => void confirmDelete()}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : null} Delete {company.name} and everything above</button></footer>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="cp-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="cp-dialog cd-dialog" role="dialog" aria-modal="true" aria-label={creating ? "New company" : `Edit ${company.name}`}>
        <header><span><small>{creating ? "NEW COMPANY" : "COMPANY DETAILS"}</small><strong>{creating ? "Who are they, and where do things stand?" : company.name}</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <form onSubmit={submit}>
          <div className="cd-form-grid">
            <label className="is-wide">Company name<input autoFocus={auto("name")} required maxLength={180} dir="auto" value={form.name} onChange={(event) => change("name", event.target.value)} placeholder="Sample Studio" /></label>
            <label>Kind<select value={form.kind} onChange={(event) => change("kind", event.target.value)}>{KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}</select></label>
            <label>Stage<select autoFocus={auto("stage")} value={form.stage} onChange={(event) => change("stage", event.target.value)}>{STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]} — {STAGE_DEFINITIONS[stage]}</option>)}</select><small>{STAGE_DEFINITIONS[form.stage]}</small></label>
            <label className="is-wide">Website<input type="url" maxLength={500} value={form.website} onChange={(event) => change("website", event.target.value)} placeholder="https://…" /></label>
          </div>

          <fieldset className="cd-fieldset">
            <legend>The person you talk to</legend>
            <div className="cd-form-grid">
              <label>Name<input autoFocus={auto("contactName")} maxLength={180} dir="auto" value={form.contactName} onChange={(event) => change("contactName", event.target.value)} /></label>
              <label>Role<input maxLength={180} dir="auto" value={form.contactRole} onChange={(event) => change("contactRole", event.target.value)} placeholder="Marketing lead" /></label>
              <label>Phone / WhatsApp<input maxLength={60} value={form.contactPhone} onChange={(event) => change("contactPhone", event.target.value)} placeholder="+90 …" /></label>
              <label>Telegram<input maxLength={120} value={form.contactTelegram} onChange={(event) => change("contactTelegram", event.target.value)} placeholder="@handle" /></label>
              <label className="is-wide">Email<input type="email" maxLength={200} value={form.contactEmail} onChange={(event) => change("contactEmail", event.target.value)} /></label>
            </div>
          </fieldset>

          <label>How you met<textarea rows="2" maxLength={1000} dir="auto" value={form.howMet} onChange={(event) => change("howMet", event.target.value)} placeholder="Introduced by …, first meeting on …" /></label>
          <label>About them<textarea rows="3" maxLength={2000} dir="auto" value={form.summary} onChange={(event) => change("summary", event.target.value)} placeholder="What they do, what they want, what matters to them." /></label>

          <fieldset className="cd-fieldset">
            <legend>Next step</legend>
            <div className="cd-form-grid cd-next-grid">
              <label className="is-wide">What happens next<input autoFocus={auto("nextAction")} maxLength={500} dir="auto" value={form.nextAction} onChange={(event) => change("nextAction", event.target.value)} placeholder="Send the proposal" /></label>
              <label>By<input type="date" value={form.nextActionOn} onChange={(event) => change("nextActionOn", event.target.value)} /></label>
            </div>
          </fieldset>

          {!creating ? <label className="cd-hidden-toggle"><input type="checkbox" checked={form.hidden} onChange={(event) => change("hidden", event.target.checked)} /> Hide from the list (tests, dead leads)</label> : null}
          {error ? <p role="alert">{error}{clash && onOpenCompany ? <> <button type="button" className="cd-error-link" onClick={() => onOpenCompany(clash)}>Open the existing company</button></> : null}</p> : null}
          <footer>
            {!creating && onDeleted ? <button type="button" className="is-danger cd-delete" disabled={busy} onClick={() => void askToDelete()}>Delete company</button> : null}
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="is-primary" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />} {creating ? "Create company" : "Save"}</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

/** A stage move implies a next step. Asking for it here is the only moment the
    answer is obvious, and a silent change is how the ★ field goes stale. */
export function StageChangeDialog({ company, stage, onClose, onSave }) {
  const prompt = STAGE_PROMPTS[stage] || { action: "", days: 7 };
  const [action, setAction] = useState(prompt.action);
  const [on, setOn] = useState(prompt.days ? addDays(localIsoDate(), prompt.days) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      // A blank step means "just move the stage" — it must not wipe a next step
      // that is already written down.
      await onSave(action.trim() ? { stage, nextAction: action.trim(), nextActionOn: on || "" } : { stage });
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  }

  return (
    <div className="cp-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="cp-dialog cd-dialog cd-stage-dialog" role="dialog" aria-modal="true" aria-label={`Move ${company.name} to ${STAGE_LABELS[stage]}`}>
        <header><span><small>STAGE CHANGE</small><strong dir="auto">{company.name} → {STAGE_LABELS[stage]}</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <form onSubmit={submit}>
          <p className="cd-stage-meaning"><strong>{STAGE_LABELS[stage]}</strong> — {STAGE_DEFINITIONS[stage]}</p>
          <div className="cd-form-grid cd-next-grid">
            <label className="is-wide">What happens next <small>Leave it blank to move the stage without a step.</small><input autoFocus maxLength={500} dir="auto" value={action} onChange={(event) => setAction(event.target.value)} placeholder={prompt.action || "Send the proposal"} /></label>
            <label>By<input type="date" value={on} disabled={!action.trim()} onChange={(event) => setOn(event.target.value)} /></label>
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="is-primary" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />} Move to {STAGE_LABELS[stage]}</button></footer>
        </form>
      </aside>
    </div>
  );
}

/* --------------------------------------------------------------- page --- */

/* A timeline row can come from the pipeline audit, from a note, or from a stage
   change recorded on the company itself. Anything unrecognised is most likely a
   pipeline import, which is where the timeline originally came from. */
const TIMELINE_TITLES = { decision: "Decision", note: "Note", stage: "Stage", meeting: "Meeting", money: "Money" };

function timelineTitle(type) {
  return TIMELINE_TITLES[type] || "Pipeline";
}

export function historyFor(company) {
  const items = [];
  for (const meeting of company.meetings || []) items.push({ id: `meeting:${meeting.id}`, type: "meeting", title: meeting.title || "Film Room meeting", detail: meeting.projectName || "", at: meeting.createdAt, meetingId: meeting.id });
  /* A note is its own headline; every other kind says what it is, then what happened. */
  for (const item of company.timeline || []) items.push({ id: `timeline:${item.id}`, type: item.type === "decision" ? "decision" : "update", title: item.type === "note" && item.detail ? item.detail : timelineTitle(item.type), detail: item.type === "note" ? "Note" : item.detail, at: item.at });
  for (const project of company.projects || []) for (const decision of project.decisions || []) items.push({ id: `decision:${decision.id}`, type: "decision", title: decision.text, detail: project.name, at: decision.createdAt, meetingId: decision.source === "film" ? decision.sourceRef : "", projectId: project.id });
  for (const sheet of company.sheets || []) if (sheet.status === "complete") items.push({ id: `sheet:${sheet.id}`, type: "sheet", title: `${sheet.title} completed`, detail: "", at: sheet.updatedAt || sheet.createdAt, sheetId: sheet.id });
  return items.filter((item) => item.at).sort((left, right) => String(right.at).localeCompare(String(left.at)));
}
