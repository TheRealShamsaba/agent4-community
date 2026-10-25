import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, Copy, ExternalLink, LoaderCircle, Pencil, Plus, Send, X } from "lucide-react";
import { copyText } from "../clipboard.js";
import { buildClientMessage, buildWelcomeMessage } from "../client-message.js";
import { relativeTime } from "../format.js";
import { api, ClientLinks } from "./ClientPage.jsx";
import { LinkOpens } from "./LinkOpens.jsx";
import { CompanyMark } from "./PaperworkDoc.jsx";

/* Clients: every client's page in one place. Pick a client on the left; on the
   right is their page — make it, copy or open its link, and post progress to
   it. Posting progress is the whole weekly routine: tick the steps that moved,
   write a line or two, set the next date, press Post, send the message.

   Behind "Post" is an ordinary weekly update in Paperwork, so everything that
   already worked there (print, withdraw, the list) keeps working. */

const STATES = [
  ["done", "Done"],
  ["half", "Doing"],
  ["todo", "Not yet"],
  ["waiting", "Needs them"]
];

const USUAL_STEPS = {
  en: ["Brief and plan", "Design", "Build", "Content", "Testing", "Launch"],
  fa: ["بریف و برنامه", "طراحی", "ساخت", "محتوا", "تست", "راه‌اندازی"]
};

const STAGE_RANK = { active: 0, operating: 1, proposal: 2, talking: 3, lead: 4, dormant: 5, lost: 6 };

function whatsappHref(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  return `https://wa.me/${digits.length >= 7 ? digits : ""}?text=${encodeURIComponent(message)}`;
}

function shortDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function dateRange(start, due) {
  if (start && due) return `${shortDay(start)} – ${shortDay(due)}`;
  if (due) return `Due ${shortDay(due)}`;
  if (start) return `Starts ${shortDay(start)}`;
  return "Dates not set";
}

/* ----------------------------------------------------------- the list --- */

function ClientList({ rows, chosen, onChoose }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...rows].sort((a, b) => Number(b.hasPage) - Number(a.hasPage) || (STAGE_RANK[a.stage] ?? 9) - (STAGE_RANK[b.stage] ?? 9) || a.name.localeCompare(b.name));
  // Leads and lost companies are noise here until they become clients.
  const likely = sorted.filter((row) => row.hasPage || row.ended || ["active", "operating", "proposal"].includes(row.stage) || row.id === chosen);
  const shown = showAll ? sorted : likely;
  return (
    <nav className="clx-list" aria-label="Clients">
      {shown.map((row) => (
        <button key={row.id} type="button" className={`clx-row${row.id === chosen ? " is-on" : ""}`} aria-current={row.id === chosen ? "true" : undefined} onClick={() => onChoose(row.id)}>
          <span className={`clx-dot${row.hasPage ? " is-live" : ""}`} aria-hidden="true" />
          <span className="clx-row-text">
            <strong dir="auto">{row.name}</strong>
            <small>
              {row.hasPage
                ? row.lastPostedAt ? `Posted ${relativeTime(row.lastPostedAt)}` : "Page made, nothing posted yet"
                : row.ended ? "Link ended" : "No page yet"}
            </small>
          </span>
        </button>
      ))}
      {!shown.length ? <p className="cl-hint">No clients yet. Add a company in Companies first.</p> : null}
      {sorted.length > likely.length ? (
        <button type="button" className="btn btn--quiet clx-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Only clients" : `Show all companies (${sorted.length})`}
        </button>
      ) : null}
    </nav>
  );
}

/* ------------------------------------------------- making the page --- */

function MakePage({ data, onMade }) {
  const company = data.company || {};
  const [language, setLanguage] = useState("en");
  const [projectIds, setProjectIds] = useState(() => data.projects.filter((project) => project.status !== "done").map((project) => project.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function make() {
    setBusy(true);
    setError("");
    try {
      await api("/api/client-links", { method: "POST", body: JSON.stringify({ companyId: data.companyId, label: company.contactName || company.name, language, showUpdates: true, projectIds }) });
      await onMade();
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  }

  return (
    <section className="clx-card clx-make">
      <p className="clx-kicker">Step 1</p>
      <h2 dir="auto">Make {company.name}'s page</h2>
      <p className="clx-lede">One private link for them. No account, no password. You post progress here and it shows up on their page.</p>
      <div className="field">
        <span>Their language: the whole page is in it, and you write your updates in it</span>
        <span className="cl-segment" role="group" aria-label="Their language">
          {[["en", "English"], ["fa", "فارسی"]].map(([id, label]) => (
            <button key={id} type="button" className={language === id ? "is-on" : ""} aria-pressed={language === id} onClick={() => setLanguage(id)}>{label}</button>
          ))}
        </span>
      </div>
      {data.projects.length ? (
        <fieldset className="cl-projects">
          <legend>Projects on the page</legend>
          {data.projects.map((project) => (
            <label key={project.id} className="cl-check">
              <input type="checkbox" checked={projectIds.includes(project.id)} onChange={() => setProjectIds((ids) => (ids.includes(project.id) ? ids.filter((id) => id !== project.id) : [...ids, project.id]))} />
              <span dir="auto">{project.name}</span>
              {project.status !== "active" ? <em>{project.status}</em> : null}
            </label>
          ))}
        </fieldset>
      ) : null}
      {error ? <p className="errorstate" role="alert">{error}</p> : null}
      <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => void make()}>
        {busy ? <LoaderCircle className="is-spinning" size={14} /> : <Plus size={14} />} Make the page
      </button>
    </section>
  );
}

/* ---------------------------------------------------- the link bar --- */

function LinkBar({ link, company }) {
  const [copied, setCopied] = useState("");
  const welcome = buildWelcomeMessage({ lang: link.language, contactName: company.contactName, url: link.url });
  async function copy(kind, value) {
    if (await copyText(value)) {
      setCopied(kind);
      window.setTimeout(() => setCopied(""), 2200);
    }
  }
  return (
    <section className="clx-card clx-linkbar">
      <div className="clx-linkbar-head">
        <span className="pill pill--ok">Live</span>
      </div>
      <LinkOpens link={link} className="clx-views" />
      <code className="clx-url" dir="ltr">{link.url.replace(/^https?:\/\//, "").replace(/(\/c\/.{6}).+$/, "$1…")}</code>
      <div className="cl-actions">
        <button type="button" className="btn" onClick={() => void copy("link", link.url)}>{copied === "link" ? <Check size={13} /> : <Copy size={13} />} {copied === "link" ? "Copied" : "Copy link"}</button>
        <a className="btn" href={`${link.url}?preview=1`} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} /> See their page</a>
        <a className="btn" href={whatsappHref(company.contactPhone, welcome)} target="_blank" rel="noreferrer noopener"><Send size={13} /> Send them the link</a>
      </div>
    </section>
  );
}

/* ------------------------------------------------- posting progress --- */

function emptyForm(draft) {
  return {
    steps: (draft?.steps || []).map(([name, state, due, link, start]) => [name, state, due || "", link || "", start || ""]),
    note: "",
    nextStep: draft?.nextStep || "",
    nextDate: draft?.nextDate || "",
    need: (draft?.need || []).map(([what, by]) => [what, by])
  };
}

function formFrom(update) {
  return {
    steps: (update.pieces || []).map(([name, state, due, link, start]) => [name, state, due || "", link || "", start || ""]),
    note: update.moved || "",
    nextStep: update.nextStep || "",
    nextDate: update.nextDate || "",
    need: (update.need || []).map((row) => [row[0], row[2] || ""])
  };
}

function StepRow({ step, index, count, expanded, onToggle, onChange, onMove, onRemove, language }) {
  const [name, state, due = "", link = "", start = ""] = step;
  const set = (patch) => onChange(Object.assign([name, state, due, link, start], patch));
  const stateLabel = STATES.find(([value]) => value === state)?.[1] || "Not yet";
  return (
    <li className={`clx-step is-${state}${expanded ? " is-open" : ""}`}>
      <button type="button" className="clx-step-summary" aria-expanded={expanded} onClick={onToggle}>
        <span className="clx-step-n">{String(index + 1).padStart(2, "0")}</span>
        <span className="clx-step-copy">
          <strong dir="auto" lang={language}>{name || "Untitled phase"}</strong>
          <small>{dateRange(start, due)}</small>
        </span>
        <span className={`clx-state-pill is-${state}`}>{stateLabel}</span>
        <ChevronDown className="clx-step-chevron" size={16} aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="clx-step-editor">
          <label className="field clx-step-name">
            <span>Phase name</span>
            <input value={name} maxLength={80} dir="auto" lang={language} placeholder="e.g. Design" aria-label={`Step ${index + 1}`} onChange={(event) => set({ 0: event.target.value })} />
          </label>
          <div className="field clx-step-state">
            <span>Status</span>
            <span className="clx-states" role="group" aria-label={`State of step ${index + 1}`}>
              {STATES.map(([value, label]) => (
                <button key={value} type="button" className={`is-${value}${state === value ? " is-on" : ""}`} aria-pressed={state === value} onClick={() => set({ 1: value })}>{label}</button>
              ))}
            </span>
          </div>
          <div className="clx-step-extra">
            <label><span>Starts</span><input type="date" value={start} aria-label={`Step ${index + 1} start date`} onChange={(event) => set({ 4: event.target.value })} /></label>
            <label><span>{state === "done" ? "Finished" : "Due"}</span><input type="date" value={due} aria-label={`Step ${index + 1} date`} onChange={(event) => set({ 2: event.target.value })} /></label>
            <label className="clx-step-link"><span>Link</span><input type="url" value={link} maxLength={500} placeholder="https://… optional" dir="ltr" aria-label={`Step ${index + 1} link`} onChange={(event) => set({ 3: event.target.value })} /></label>
          </div>
          <div className="clx-step-tools">
            <span>Order</span>
            <button type="button" className="btn btn--quiet btn--icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp size={13} /></button>
            <button type="button" className="btn btn--quiet btn--icon" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down"><ArrowDown size={13} /></button>
            <button type="button" className="btn btn--quiet clx-remove-step" onClick={onRemove}><X size={13} /> Remove phase</button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function PostProgress({ data, link, editing, onCancelEdit, onPosted }) {
  const language = link?.language || "en";
  const [form, setForm] = useState(() => (editing ? formFrom(editing) : emptyForm(data.draft)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const [openStep, setOpenStep] = useState(null);
  const [needsOpen, setNeedsOpen] = useState(false);
  useEffect(() => {
    const next = editing ? formFrom(editing) : emptyForm(data.draft);
    setForm(next);
    setPlanOpen(!next.steps.length);
    setOpenStep(next.steps.length ? null : 0);
    setNeedsOpen(false);
    setError("");
  }, [editing, data.draft]);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const setStep = (index, value) => set({ steps: form.steps.map((step, at) => (at === index ? value : step)) });
  const moveStep = (index, by) => {
    const steps = [...form.steps];
    const [step] = steps.splice(index, 1);
    steps.splice(index + by, 0, step);
    set({ steps });
    setOpenStep(index + by);
  };
  const done = form.steps.filter(([name, state]) => name.trim() && state === "done").length;
  const named = form.steps.filter(([name]) => name.trim()).length;
  const ready = form.note.trim() || named;

  async function post() {
    setBusy(true);
    setError("");
    try {
      const body = await api(`/api/client-pages/${encodeURIComponent(data.companyId)}/post`, {
        method: "POST",
        body: JSON.stringify({ ...form, language, paperworkId: editing?.paperworkId || undefined })
      });
      await onPosted({ values: body.values, language, corrected: Boolean(editing) });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="clx-card clx-post" aria-labelledby="clx-post-title">
      <div className="clx-post-head">
        <span>
          <p className="clx-kicker">{editing ? "Fixing an update" : "Post progress"}</p>
          <h2 id="clx-post-title">{editing ? `Update from ${relativeTime(editing.publishedAt)}` : "Update their page"}</h2>
          <p className="clx-lang-note">Write the client-facing update in <b>{language === "fa" ? "فارسی" : "English"}</b>.</p>
        </span>
        {named ? <span className="clx-tally"><b>{done}</b>/{named} done</span> : null}
      </div>

      <label className="clx-block field clx-note">
        <span className="clx-label">Short note</span>
        <textarea rows={3} maxLength={4000} dir="auto" lang={language} value={form.note} placeholder={language === "fa" ? "مثلاً: طراحی صفحهٔ اصلی تمام شد. این هفته فرم رزرو را می‌سازیم." : "e.g. The homepage design is done. This week we build the booking form."} onChange={(event) => set({ note: event.target.value })} />
      </label>

      <div className="clx-block clx-next">
        <label className="field">
          <span className="clx-label">Next</span>
          <input value={form.nextStep} maxLength={300} dir="auto" lang={language} placeholder={language === "fa" ? "مثلاً: نشان دادن نسخهٔ اول" : "e.g. Show you the first version"} onChange={(event) => set({ nextStep: event.target.value })} />
        </label>
        <label className="field">
          <span className="clx-label">On</span>
          <input type="date" value={form.nextDate} onChange={(event) => set({ nextDate: event.target.value })} />
        </label>
      </div>

      <div className={`clx-disclosure clx-needs${needsOpen ? " is-open" : ""}`}>
        <button type="button" className="clx-disclosure-head" aria-expanded={needsOpen} onClick={() => setNeedsOpen((value) => !value)}>
          <span>
            <strong>Need from them</strong>
            <small>{form.need.filter(([what]) => what.trim()).length ? `${form.need.filter(([what]) => what.trim()).length} request${form.need.filter(([what]) => what.trim()).length === 1 ? "" : "s"} on their page` : "Nothing requested"}</small>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {needsOpen ? (
          <div className="clx-disclosure-body">
            {form.need.map((row, index) => (
              <div key={index} className="clx-need">
                <input value={row[0]} maxLength={200} dir="auto" lang={language} placeholder={language === "fa" ? "مثلاً: فایل لوگو" : "e.g. Logo file"} aria-label={`Need ${index + 1}`} onChange={(event) => set({ need: form.need.map((item, at) => (at === index ? [event.target.value, item[1]] : item)) })} />
                <input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(row[1]) ? row[1] : ""} aria-label={`Need ${index + 1} by`} onChange={(event) => set({ need: form.need.map((item, at) => (at === index ? [item[0], event.target.value] : item)) })} />
                <button type="button" className="btn btn--quiet btn--icon" onClick={() => set({ need: form.need.filter((_, at) => at !== index) })} aria-label="Remove"><X size={13} /></button>
              </div>
            ))}
            <button type="button" className="btn btn--quiet" onClick={() => set({ need: [...form.need, ["", ""]] })}><Plus size={13} /> Add a request</button>
          </div>
        ) : null}
      </div>

      <div className={`clx-disclosure clx-plan${planOpen ? " is-open" : ""}`}>
        <button type="button" className="clx-disclosure-head" aria-expanded={planOpen} onClick={() => setPlanOpen((value) => !value)}>
          <span>
            <strong>Project plan</strong>
            <small>{named ? `${named} phases · ${done} complete${form.steps.some(([, state]) => state === "waiting") ? " · waiting on client" : ""}` : "No phases yet"}</small>
          </span>
          <span className="clx-edit-plan"><Pencil size={14} aria-hidden="true" /> {planOpen ? "Close editor" : "Edit plan"}</span>
        </button>
        {planOpen ? (
          <div className="clx-disclosure-body">
            {form.steps.length ? (
              <ol className="clx-steps">
                {form.steps.map((step, index) => (
                  <StepRow key={index} step={step} index={index} count={form.steps.length} language={language}
                    expanded={openStep === index}
                    onToggle={() => setOpenStep((current) => (current === index ? null : index))}
                    onChange={(value) => setStep(index, value)}
                    onMove={(by) => moveStep(index, by)}
                    onRemove={() => {
                      set({ steps: form.steps.filter((_, at) => at !== index) });
                      setOpenStep(null);
                    }} />
                ))}
              </ol>
            ) : (
              <div className="clx-empty-steps">
                <p>No phases yet. Start from the usual ones and rename them to fit this project.</p>
                <button type="button" className="btn" onClick={() => {
                  set({ steps: USUAL_STEPS[language].map((name, index) => [name, index === 0 ? "half" : "todo", "", "", ""]) });
                  setOpenStep(0);
                }}>Use the usual phases</button>
              </div>
            )}
            <button type="button" className="btn btn--quiet" onClick={() => {
              set({ steps: [...form.steps, ["", "todo", "", "", ""]] });
              setOpenStep(form.steps.length);
            }}><Plus size={13} /> Add a phase</button>
          </div>
        ) : null}
      </div>

      {error ? <p className="errorstate" role="alert">{error}</p> : null}
      {!link ? <p className="cl-warn">Make their page first, then post.</p> : null}
      <div className="cl-actions clx-post-actions">
        <button type="button" className="btn btn--primary btn--lg" disabled={busy || !ready || !link} onClick={() => void post()}>
          {busy ? <LoaderCircle className="is-spinning" size={14} /> : <Send size={14} />} {editing ? "Save the fix" : "Post to their page"}
        </button>
        {editing ? <button type="button" className="btn btn--quiet" onClick={onCancelEdit}>Cancel</button> : null}
        {!ready ? <span className="clx-help">Add a note or at least one step.</span> : null}
      </div>
    </section>
  );
}

function Posted({ posted, link, company, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const message = buildClientMessage({ lang: posted.language, contactName: company.contactName, url: link.url, values: posted.values });
  async function copy() {
    if (await copyText(message)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    }
  }
  return (
    <section className="clx-card clx-posted" role="status">
      <div className="clx-posted-head">
        <span className="clx-tick" aria-hidden="true"><Check size={16} /></span>
        <span>
          <strong>{posted.corrected ? "Fixed. Their page shows the new version." : "Posted. It's on their page now."}</strong>
          <small>{posted.corrected ? "No need to message them about a small fix." : "Last step: tell them."}</small>
        </span>
        <button type="button" className="btn btn--quiet btn--icon" onClick={onDismiss} aria-label="Close"><X size={14} /></button>
      </div>
      {!posted.corrected ? (
        <>
          <pre dir="auto" lang={posted.language}>{message}</pre>
          <div className="cl-actions">
            <a className="btn btn--primary" href={whatsappHref(company.contactPhone, message)} target="_blank" rel="noreferrer noopener"><Send size={13} /> Send on WhatsApp</a>
            <button type="button" className="btn" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy message"}</button>
            <a className="btn btn--quiet" href={`${link.url}?preview=1`} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} /> See their page</a>
          </div>
        </>
      ) : null}
    </section>
  );
}

function OnTheirPage({ updates, onFix, onChanged }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function takeOff(update) {
    if (!window.confirm("Take this update off their page?\n\nThey will no longer see it. It stays in Paperwork.")) return;
    setBusy(update.paperworkId);
    setError("");
    try {
      await api(`/api/paperwork/${update.paperworkId}/withdraw`, { method: "POST" });
      await onChanged();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy("");
    }
  }
  if (!updates.length) return null;
  return (
    <section className="clx-card">
      <p className="clx-kicker">On their page now</p>
      <ul className="clx-updates">
        {updates.map((update, index) => {
          const pieces = (update.pieces || []).filter((row) => row[0]);
          const done = pieces.filter((row) => row[1] === "done").length;
          return (
            <li key={update.paperworkId}>
              <span className="clx-update-when">{index === 0 ? <b>Latest</b> : null}{new Date(update.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              <span className="clx-update-text" dir="auto" lang={update.language}>
                {update.moved ? update.moved.split("\n")[0] : <em>Steps only</em>}
                <small>
                  {pieces.length ? `${done}/${pieces.length} steps done` : ""}
                  {update.nextStep ? `${pieces.length ? " · " : ""}Next: ${update.nextStep}${update.nextDate ? ` (${shortDay(update.nextDate)})` : ""}` : ""}
                </small>
              </span>
              <span className="clx-update-tools">
                <button type="button" className="btn btn--quiet" onClick={() => onFix(update)}>Fix</button>
                <button type="button" className="btn btn--quiet" disabled={busy === update.paperworkId} onClick={() => void takeOff(update)}>Take off</button>
              </span>
            </li>
          );
        })}
      </ul>
      {error ? <p className="errorstate" role="alert">{error}</p> : null}
    </section>
  );
}

/* --------------------------------------------------- one client --- */

export function ClientDetail({ companyId, onChanged = async () => {}, embedded = false }) {
  const [data, setData] = useState({ status: "loading" });
  const [editing, setEditing] = useState(null);
  const [posted, setPosted] = useState(null);

  const load = useCallback(async () => {
    try {
      const body = await api(`/api/client-pages/${encodeURIComponent(companyId)}`);
      setData({ status: "ready", companyId, ...body });
    } catch (caught) {
      setData({ status: "error", message: caught.message });
    }
  }, [companyId]);
  useEffect(() => { setData({ status: "loading" }); setEditing(null); setPosted(null); void load(); }, [load]);

  const reloadAll = useCallback(async () => { await load(); await onChanged(); }, [load, onChanged]);
  const linksData = useMemo(() => (data.status === "ready" ? { ...data, status: "ready", reload: reloadAll } : null), [data, reloadAll]);

  if (data.status === "loading") return <div className={`clx-detail${embedded ? " is-embedded" : ""}`}><p className="quiet"><LoaderCircle className="is-spinning" size={13} /> Opening…</p></div>;
  if (data.status === "error") return <div className={`clx-detail${embedded ? " is-embedded" : ""}`}><p className="errorstate" role="alert">{data.message}</p><button type="button" className="btn" onClick={() => void load()}>Try again</button></div>;

  const company = data.company || {};
  const link = data.links.find((item) => item.state === "active") || null;

  return (
    <div className={`clx-detail${embedded ? " is-embedded" : ""}`}>
      {embedded ? null : (
        <header className="clx-detail-head">
          <h1 dir="auto">{company.name}</h1>
          {company.contactName ? <p dir="auto">For {company.contactName}</p> : null}
        </header>
      )}

      {!data.enabled ? (
        <div className="clx-card"><strong>Client pages are switched off on this server.</strong><p className="cl-hint">Set <code>AGENT4_CLIENT_PAGES=true</code> in HQ's environment and restart it.</p></div>
      ) : !link ? (
        <MakePage data={data} onMade={reloadAll} />
      ) : (
        <>
          <LinkBar link={link} company={company} />
          {posted ? <Posted posted={posted} link={link} company={company} onDismiss={() => setPosted(null)} /> : null}
          <PostProgress
            data={data}
            link={link}
            editing={editing}
            onCancelEdit={() => setEditing(null)}
            onPosted={async (result) => { setEditing(null); setPosted(result); await reloadAll(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          />
          <OnTheirPage updates={data.updates} onFix={(update) => { setPosted(null); setEditing(update); window.scrollTo({ top: 0, behavior: "smooth" }); }} onChanged={reloadAll} />
        </>
      )}

      {data.enabled && data.links.length ? (
        <details className="clx-card clx-settings">
          <summary>Link settings and questions for them</summary>
          <p className="cl-hint">Change the page's language or projects, send a questionnaire, or end the link.</p>
          <ClientLinks data={linksData} companyName={company.name} compact />
        </details>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------- the screen --- */

export function ClientsPage({ onBack, initialCompanyId = "" }) {
  const [overview, setOverview] = useState({ status: "loading", companies: [] });
  const [chosen, setChosen] = useState(initialCompanyId);

  const load = useCallback(async () => {
    try {
      const body = await api("/api/client-pages");
      setOverview({ status: "ready", ...body });
      setChosen((current) => current || body.companies.find((row) => row.hasPage)?.id || body.companies.find((row) => row.stage === "active")?.id || "");
    } catch (caught) {
      setOverview({ status: "error", companies: [], message: caught.message });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="court clx-page">
      <div className="bento">
        <div className="pw-head c12">
          <button type="button" className="pw-back" onClick={onBack}><ArrowLeft size={14} /> Home court</button>
          <span className="pw-head-title">
            <CompanyMark size={40} />
            <span>
              <small>CLIENT PAGES</small>
              <strong>Clients</strong>
            </span>
          </span>
          <span className="pw-head-count">{overview.status === "ready" ? `${overview.companies.filter((row) => row.hasPage).length} live` : ""}</span>
        </div>
        {overview.status === "error" ? <p className="errorstate c12" role="alert">{overview.message}</p> : null}
        {overview.status === "loading" ? <p className="quiet c12"><LoaderCircle className="is-spinning" size={13} /> Reading your clients…</p> : null}
        {overview.status === "ready" ? (
          <div className="clx-layout c12">
            <ClientList rows={overview.companies} chosen={chosen} onChoose={setChosen} />
            {chosen ? <ClientDetail key={chosen} companyId={chosen} onChanged={load} /> : (
              <div className="clx-detail"><div className="clx-card"><strong>Pick a client on the left.</strong></div></div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
