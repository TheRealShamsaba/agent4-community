import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Link2, LoaderCircle, Plus, Send, X } from "lucide-react";
import { copyText } from "../clipboard.js";
import { answersAsText } from "../client-answers.js";
import { buildClientMessage } from "../client-message.js";
import { relativeTime } from "../format.js";
import { LinkOpens } from "./LinkOpens.jsx";

/* The owner's side of a client's page: make a link for the person, choose what
   it shows, end it when it should end, and put a weekly update on it.

   A link is a key. Whoever holds the address can read the page, so the screens
   say plainly what a link will show, never show the whole address on screen,
   and make ending one a single click. Nothing here is visible to a teammate:
   the server refuses them, and the screens that mount this are owner-only. */

export async function api(pathname, options = {}) {
  let response;
  try {
    response = await fetch(pathname, {
      ...options,
      headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
    });
  } catch {
    throw new Error("HQ could not be reached.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || "HQ refused that.");
    error.code = body?.error?.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

const LANGUAGES = [["en", "English"], ["fa", "فارسی"]];

/** One read of a company's links, shared by everything on screen that needs it. */
export function useClientLinks(companyId) {
  const [state, setState] = useState({ status: companyId ? "loading" : "idle", enabled: true, baseUrl: "", company: null, links: [], projects: [], templates: [], message: "" });

  const load = useCallback(async () => {
    if (!companyId) {
      setState((current) => ({ ...current, status: "idle", links: [], projects: [], company: null }));
      return;
    }
    setState((current) => ({ ...current, status: current.links.length ? "ready" : "loading", message: "" }));
    try {
      const body = await api(`/api/client-links?companyId=${encodeURIComponent(companyId)}`);
      setState({ status: "ready", message: "", ...body });
    } catch (error) {
      setState((current) => ({ ...current, status: "error", message: error.message }));
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}

/** Enough of the address to recognise it, never enough to read it over a shoulder. */
function masked(url) {
  return String(url || "").replace(/^https?:\/\//, "").replace(/(\/c\/.{5}).+$/, "$1…");
}

function LinkForm({ projects, initial, busy, error, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    label: initial?.label || "",
    language: initial?.language || "en",
    showUpdates: initial ? initial.showUpdates !== false : true,
    projectIds: initial?.projectIds || []
  });
  const toggle = (id) => setForm((current) => ({
    ...current,
    projectIds: current.projectIds.includes(id) ? current.projectIds.filter((item) => item !== id) : [...current.projectIds, id]
  }));

  return (
    <form className="cl-form" onSubmit={(event) => { event.preventDefault(); void onSubmit(form); }}>
      <label className="field">
        <span>Who is it for</span>
        <input value={form.label} maxLength={120} placeholder="e.g. Dr. Ahmadi" dir="auto" onChange={(event) => setForm({ ...form, label: event.target.value })} />
      </label>
      <div className="field">
        <span>Language of the page</span>
        <span className="cl-segment" role="group" aria-label="Language of the page">
          {LANGUAGES.map(([id, label]) => (
            <button key={id} type="button" className={form.language === id ? "is-on" : ""} aria-pressed={form.language === id} onClick={() => setForm({ ...form, language: id })}>{label}</button>
          ))}
        </span>
      </div>
      <fieldset className="cl-projects">
        <legend>What this link shows</legend>
        <label className="cl-check">
          <input type="checkbox" checked={form.showUpdates} onChange={(event) => setForm({ ...form, showUpdates: event.target.checked })} />
          <span>Weekly updates</span>
          <em>what moved, what is stuck, what waits on them, and any note about money</em>
        </label>
        <p className="cl-sub">Projects</p>
        {projects.length ? projects.map((project) => (
          <label key={project.id} className="cl-check">
            <input type="checkbox" checked={form.projectIds.includes(project.id)} onChange={() => toggle(project.id)} />
            <span dir="auto">{project.name}</span>
            {project.status !== "active" ? <em>{project.status}</em> : null}
          </label>
        )) : <p className="cl-hint">This company has no projects yet.</p>}
        <p className="cl-hint">Only what is ticked appears. A project shows its name, status, health and milestone. Nothing else about the company or its projects is ever shown: not notes, contacts, or other projects.</p>
      </fieldset>
      {error ? <p className="errorstate" role="alert">{error}</p> : null}
      <div className="cl-form-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={13} /> : <Check size={13} />} {submitLabel}</button>
        <button type="button" className="btn btn--quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const STATE_PILL = { open: ["pill--warn", "Waiting for them"], submitted: ["pill--ok", "Sent by them"], closed: ["pill--quiet", "Closed"] };

function QuestionnaireItem({ item, onChanged }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  // Typing in what they said on a call: a draft of every answer, saved in one go.
  const [draft, setDraft] = useState(null);
  const wantsCall = item.status === "open" && item.callRequestedAt;
  const [pillClass, pillLabel] = wantsCall ? ["pill--warn", "Wants a call"] : STATE_PILL[item.status] || STATE_PILL.open;
  const progress = item.progress;
  const edited = item.submittedAt && item.updatedAt && item.updatedAt > item.submittedAt;

  async function read() {
    setBusy(true);
    setError("");
    try {
      const body = await api(`/api/client-questionnaires/${item.id}`);
      setDetail(body.questionnaire);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await read();
  }

  async function change(action) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/client-questionnaires/${item.id}/${action}`, { method: "POST" });
      await onChanged();
      if (open) await read();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove "${item.title}" and everything they answered?\n\nThis cannot be undone. If you only want to stop more answers, close it instead.`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/client-questionnaires/${item.id}`, { method: "DELETE" });
      await onChanged();
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  }

  function startFilling() {
    if (!detail) return;
    setDraft({ ...detail.answers });
  }

  async function fill(submit) {
    setBusy(true);
    setError("");
    try {
      const body = await api(`/api/client-questionnaires/${item.id}/answers`, { method: "PUT", body: JSON.stringify({ answers: draft, submit }) });
      setDetail(body.questionnaire);
      setDraft(null);
      await onChanged();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (detail && await copyText(answersAsText(detail))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    }
  }

  return (
    <div className={`cl-q is-${item.status}`}>
      <div className="cl-q-head">
        <strong dir="auto" lang={item.language}>{item.title}</strong>
        <span className={`pill ${pillClass}`}>{pillLabel}</span>
      </div>
      <p className="cl-q-meta">
        {progress.answered} of {progress.total} answered
        {progress.needed ? ` · ${progress.neededAnswered} of ${progress.needed} needed to start` : ""}
        {item.submittedAt ? ` · sent ${relativeTime(item.submittedAt)}` : ""}
        {edited ? ` · edited ${relativeTime(item.updatedAt)}` : ""}
        {item.callRequestedAt ? ` · asked for a call ${relativeTime(item.callRequestedAt)}` : ""}
      </p>
      {item.callRequestedAt && item.callTimes ? <p className="cl-q-meta" dir="auto">Good times for them: {item.callTimes}</p> : null}
      <div className="cl-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void toggle()}>{open ? "Hide answers" : "Read answers"}</button>
        {item.status === "closed"
          ? <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void change("reopen")}>Reopen</button>
          : <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void change("close")}>Close it</button>}
        <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void remove()}><X size={13} /> Remove</button>
      </div>
      {error ? <p className="errorstate" role="alert">{error}</p> : null}
      {open ? (
        <div className="cl-answers">
          {busy && !detail ? <p className="quiet"><LoaderCircle className="is-spinning" size={13} /> Reading…</p> : null}
          {detail ? (
            <>
              {(detail.content.sections || []).map((section) => (
                <section key={section.id}>
                  <h4 dir="auto" lang={detail.language}>{section.title}</h4>
                  <dl>
                    {(section.questions || []).map((question) => (
                      <div key={question.id}>
                        <dt dir="auto" lang={detail.language}>{question.text}{question.must ? <em> · needed to start</em> : null}</dt>
                        {draft ? (
                          <dd><textarea dir="auto" lang={detail.language} rows={3} maxLength={4000} aria-label={question.text} value={draft[question.id] || ""} onChange={(event) => setDraft({ ...draft, [question.id]: event.target.value })} /></dd>
                        ) : (
                          <dd dir="auto" lang={detail.language} className={detail.answers[question.id] ? "" : "is-empty"}>{detail.answers[question.id] || "No answer yet"}</dd>
                        )}
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
              {draft ? (
                <div className="cl-actions">
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void fill(false)}><Check size={13} /> Save answers</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void fill(true)}>Save and mark as sent</button>
                  <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
                </div>
              ) : (
                <div className="cl-actions">
                  <button type="button" className="btn" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy answers as text"}</button>
                  {item.status !== "closed" ? <button type="button" className="btn btn--quiet" onClick={startFilling}>Type in answers from a call</button> : null}
                </div>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The questions sent to one person's link, and a way to send another set. */
function LinkQuestions({ link, templates, onChanged }) {
  const items = link.questionnaires || [];
  const available = templates.filter((template) => !items.some((item) => item.templateId === template.id && item.status !== "closed"));
  const [templateId, setTemplateId] = useState("");
  const [language, setLanguage] = useState(link.language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = available.find((template) => template.id === templateId) || available[0] || null;

  async function send() {
    if (!chosen) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/client-links/${link.id}/questionnaires`, { method: "POST", body: JSON.stringify({ templateId: chosen.id, language }) });
      setTemplateId("");
      await onChanged();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  if (link.state !== "active" && !items.length) return null;
  return (
    <div className="cl-questions">
      <p className="cl-sub">Questions for them</p>
      {items.map((item) => <QuestionnaireItem key={item.id} item={item} onChanged={onChanged} />)}
      {link.state === "active" ? (
        available.length ? (
          <div className="cl-send">
            <select value={chosen?.id || ""} onChange={(event) => setTemplateId(event.target.value)} aria-label="Which questions to send">
              {available.map((template) => <option key={template.id} value={template.id}>{template.name.en} · {template.questions} questions</option>)}
            </select>
            <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Language of the questions">
              {LANGUAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <button type="button" className="btn" disabled={busy} onClick={() => void send()}>{busy ? <LoaderCircle className="is-spinning" size={13} /> : <Plus size={13} />} Send</button>
          </div>
        ) : <p className="cl-hint">Every set of questions is already with them.</p>
      ) : null}
      {chosen && link.state === "active" ? <p className="cl-hint">{chosen.blurb.en}</p> : null}
      {error ? <p className="errorstate" role="alert">{error}</p> : null}
    </div>
  );
}

function LinkRow({ link, projects, templates, onChanged, busyId, onCopy, copied, onEdit, onRevoke, editing, onSave, onCancel, error }) {
  const shown = projects.filter((project) => link.projectIds.includes(project.id));
  const state = link.state;
  return (
    <article className={`cl-link is-${state}`}>
      <div className="cl-link-head">
        <strong dir="auto">{link.label || "Client link"}</strong>
        <span className={`pill ${state === "active" ? "pill--ok" : "pill--quiet"}`}>{state === "active" ? "Active" : state === "revoked" ? "Ended" : "Expired"}</span>
        <small>{LANGUAGES.find(([id]) => id === link.language)?.[1]} · {shown.length ? shown.map((project) => project.name).join(", ") : "no projects"} · {link.showUpdates ? "weekly updates" : "no updates"}</small>
      </div>
      <LinkOpens link={link} className="cl-link-views" />
      {state === "active" ? (
        <>
          <code className="cl-address" dir="ltr">{masked(link.url)}</code>
          <div className="cl-actions">
            <button type="button" className="btn" onClick={() => onCopy(link)}>{copied === link.id ? <Check size={13} /> : <Copy size={13} />} {copied === link.id ? "Copied" : "Copy link"}</button>
            <a className="btn" href={`${link.url}?preview=1`} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} /> Open as the client</a>
            <button type="button" className="btn btn--quiet" onClick={() => onEdit(link.id)}>Change</button>
            <button type="button" className="btn btn--quiet" disabled={busyId === link.id} onClick={() => void onRevoke(link)}><X size={13} /> End it</button>
          </div>
        </>
      ) : null}
      <LinkQuestions link={link} templates={templates} onChanged={onChanged} />
      {editing ? (
        <LinkForm projects={projects} initial={link} busy={busyId === link.id} error={error} submitLabel="Save changes" onSubmit={(form) => onSave(link, form)} onCancel={onCancel} />
      ) : null}
    </article>
  );
}

/** Make, change, copy and end the links for one company. */
export function ClientLinks({ data, companyName, compact = false }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");

  async function create(form) {
    setBusyId("new");
    setError("");
    try {
      await api("/api/client-links", { method: "POST", body: JSON.stringify({ companyId: data.companyId, ...form }) });
      setCreating(false);
      await data.reload();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusyId("");
    }
  }

  async function save(link, form) {
    setBusyId(link.id);
    setError("");
    try {
      await api(`/api/client-links/${link.id}`, { method: "PATCH", body: JSON.stringify(form) });
      setEditingId("");
      await data.reload();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusyId("");
    }
  }

  async function revoke(link) {
    if (!window.confirm(`End ${link.label ? `${link.label}'s` : "this"} link?\n\nAnyone using it will see "this link is no longer active". You can make a new one at any time.`)) return;
    setBusyId(link.id);
    setError("");
    try {
      await api(`/api/client-links/${link.id}/revoke`, { method: "POST" });
      await data.reload();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusyId("");
    }
  }

  async function copy(link) {
    if (await copyText(link.url)) {
      setCopied(link.id);
      window.setTimeout(() => setCopied((current) => (current === link.id ? "" : current)), 2200);
    } else {
      setError("Your browser would not let HQ copy that. Open the link and copy it from the address bar.");
    }
  }

  if (data.status === "loading" || data.status === "idle") {
    return <div className="cl-box"><p className="quiet"><LoaderCircle className="is-spinning" size={13} /> Reading the client links…</p></div>;
  }
  if (data.status === "error") {
    return (
      <div className="cl-box">
        <p className="errorstate" role="alert">{data.message}</p>
        <button type="button" className="btn" onClick={() => void data.reload()}>Try again</button>
      </div>
    );
  }
  if (!data.enabled) {
    return (
      <div className="cl-box">
        <div className="emptystate">
          <strong>Client pages are switched off on this server</strong>
          <p>A link made now would not open. Set <code>AGENT4_CLIENT_PAGES=true</code> in HQ's environment and restart it.</p>
        </div>
      </div>
    );
  }

  const active = data.links.filter((link) => link.state === "active");
  const ended = data.links.filter((link) => link.state !== "active");

  return (
    <div className={`cl-box ${compact ? "is-compact" : ""}`}>
      {!data.links.length && !creating ? (
        <div className="emptystate">
          <strong>{companyName} has no page yet</strong>
          <p>Make a private link for the person you talk to, choose which projects it shows, and send it to them. They see where the work stands and each weekly update, in their language.</p>
          <button type="button" className="btn btn--primary" onClick={() => { setCreating(true); setError(""); }}><Plus size={13} /> Make a client link</button>
        </div>
      ) : null}

      {[...active, ...ended].map((link) => (
        <LinkRow
          key={link.id}
          link={link}
          projects={data.projects}
          templates={data.templates || []}
          onChanged={data.reload}
          busyId={busyId}
          copied={copied}
          editing={editingId === link.id}
          error={editingId === link.id ? error : ""}
          onCopy={copy}
          onEdit={(id) => { setEditingId(id); setError(""); setCreating(false); }}
          onRevoke={revoke}
          onSave={save}
          onCancel={() => setEditingId("")}
        />
      ))}

      {creating ? (
        <LinkForm projects={data.projects} busy={busyId === "new"} error={error} submitLabel="Make the link" onSubmit={create} onCancel={() => setCreating(false)} />
      ) : null}

      {data.links.length && !creating ? (
        <button type="button" className="btn btn--quiet cl-new" onClick={() => { setCreating(true); setEditingId(""); setError(""); }}><Plus size={13} /> Another link</button>
      ) : null}
      {error && !creating && !editingId ? <p className="errorstate" role="alert">{error}</p> : null}
    </div>
  );
}

/** The company page's section. */
export function ClientPageSection({ company }) {
  const data = useClientLinks(company.storedId || company.id);
  return (
    <section className="cd-block cl-section">
      <header>
        <span><small>CLIENT PAGE</small><h2>What {company.name} sees</h2></span>
        <p>A private page of their own: where the work stands and each weekly update.</p>
      </header>
      <ClientLinks data={{ ...data, companyId: company.storedId || company.id }} companyName={company.name} />
    </section>
  );
}

/* ----------------------------------------------- publishing an update --- */

const REQUIRED = [["weekOf", "the week it covers"]];

/** The strip above a weekly update: is it on the client's page, and the message that carries it there. */
export function ClientPublish({ record, form, settle, onDocument }) {
  const companyId = form.companyId || "";
  const links = useClientLinks(companyId);
  const [publication, setPublication] = useState({ status: "loading", published: false, publishedAt: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [chosen, setChosen] = useState("");

  const loadPublication = useCallback(async () => {
    try {
      const body = await api(`/api/paperwork/${record.id}/publication`);
      setPublication({ status: "ready", ...body });
    } catch (caught) {
      setPublication({ status: "error", published: false, publishedAt: null, message: caught.message });
    }
  }, [record.id]);
  useEffect(() => { void loadPublication(); }, [loadPublication]);

  const missing = useMemo(
    () => {
      const missing = REQUIRED.filter(([key]) => !String(form.values?.[key] ?? "").trim()).map(([, label]) => label);
      const steps = (form.values?.pieces || []).filter((row) => Array.isArray(row) && String(row[0] || "").trim() && row[1]);
      if (!String(form.values?.moved ?? "").trim() && !steps.length) missing.push("a short note or the steps");
      return missing;
    },
    [form.values]
  );
  const activeLinks = links.links.filter((link) => link.state === "active");
  const link = activeLinks.find((candidate) => candidate.id === chosen) || activeLinks[0] || null;
  const message = useMemo(
    () => (link ? buildClientMessage({ lang: form.language, contactName: links.company?.contactName, url: link.url, values: form.values }) : ""),
    [link, form.language, form.values, links.company]
  );
  const phone = String(links.company?.contactPhone || "").replace(/\D/g, "");
  const whatsapp = message ? `https://wa.me/${phone.length >= 7 ? phone : ""}?text=${encodeURIComponent(message)}` : "";

  async function publish() {
    setBusy(true);
    setError("");
    try {
      // The page shows what was saved, so everything typed must be saved first.
      if (settle && !(await settle())) throw new Error("Your last edits are still saving. Try again in a moment.");
      const body = await api(`/api/paperwork/${record.id}/publish`, { method: "POST" });
      if (body.document) onDocument?.(body.document);
      await Promise.all([loadPublication(), links.reload()]);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!window.confirm("Take this update off the client's page?\n\nThey will no longer see it. The document stays here.")) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/paperwork/${record.id}/withdraw`, { method: "POST" });
      await loadPublication();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyMessage() {
    if (await copyText(message)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    }
  }

  if (!companyId) {
    return (
      <section className="cl-strip no-print" aria-label="Client page">
        <span className="cl-strip-title"><Link2 size={14} /> Client page</span>
        <p className="cl-hint">Choose who this update is for, above, to put it on their page.</p>
      </section>
    );
  }
  if (links.status === "ready" && !links.enabled) {
    return (
      <section className="cl-strip no-print" aria-label="Client page">
        <span className="cl-strip-title"><Link2 size={14} /> Client page</span>
        <p className="cl-hint">Client pages are switched off on this server.</p>
      </section>
    );
  }

  const published = publication.published;
  const noActiveLink = links.status === "ready" && !activeLinks.length;

  return (
    <section className="cl-strip no-print" aria-label="Client page">
      <div className="cl-strip-row">
        <span className="cl-strip-title"><Link2 size={14} /> Client page</span>
        {publication.status === "loading" ? <span className="pill pill--quiet">Checking…</span> : published
          ? <span className="pill pill--ok">On their page · {relativeTime(publication.publishedAt)}</span>
          : <span className="pill pill--quiet">{publication.withdrawnAt ? "Taken off their page" : "Not on their page"}</span>}
        <span className="cl-strip-actions">
          <button type="button" className="btn btn--primary" disabled={busy || missing.length > 0 || publication.status === "loading"} onClick={() => void publish()}>
            {busy ? <LoaderCircle className="is-spinning" size={13} /> : <Send size={13} />} {published ? "Update their page" : "Put on their page"}
          </button>
          {published ? <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void withdraw()}>Take it off</button> : null}
        </span>
      </div>

      {missing.length ? <p className="cl-hint">Before it can go on their page, fill in {missing.join(", ")}.</p> : null}
      {error ? <p className="errorstate" role="alert">{error}</p> : null}
      {noActiveLink ? <p className="cl-warn">No active link for this company yet, so nobody can see it. Make one below.</p> : null}

      {published && message ? (
        <div className="cl-message">
          <div className="cl-message-head">
            <strong>Message to send</strong>
            {activeLinks.length > 1 ? (
              <select value={link?.id || ""} onChange={(event) => setChosen(event.target.value)} aria-label="Which link to send">
                {activeLinks.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label || "Client link"}</option>)}
              </select>
            ) : null}
          </div>
          <pre dir="auto" lang={form.language}>{message}</pre>
          <div className="cl-actions">
            <button type="button" className="btn" onClick={() => void copyMessage()}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy message"}</button>
            <a className="btn" href={whatsapp} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} /> Open in WhatsApp</a>
            <a className="btn btn--quiet" href={`${link.url}?preview=1`} target="_blank" rel="noreferrer noopener">See their page</a>
          </div>
        </div>
      ) : null}

      <details className="cl-details" open={noActiveLink}>
        <summary>Links for {links.company?.name || "this company"}{activeLinks.length ? ` · ${activeLinks.length} active` : ""}</summary>
        <ClientLinks data={{ ...links, companyId }} companyName={links.company?.name || "This company"} compact />
      </details>
    </section>
  );
}
