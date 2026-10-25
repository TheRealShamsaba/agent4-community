import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Copy,
  FolderKanban,
  Languages,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X
} from "lucide-react";
import { relativeTime } from "../format.js";
import { SHEET_LANGUAGES, SHEET_TEMPLATES, sheetLanguage, sheetProgress, sheetTemplate, sheetText } from "../sheet-templates.js";

const LANG_KEY = "agent4-sheet-lang";
const SAVE_DELAY_MS = 650;
const RETRY_DELAY_MS = 2500;

async function sheetRequest(pathname, options = {}) {
  const response = await fetch(pathname, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "The sheet could not be saved.");
  return body;
}

/* The reading language is one choice for the whole desk, not one per sheet: the
   rows and the stage have to agree or the row stays English under a Persian
   sheet. Persian is the working language in the room, so it is the default. */
export function readSheetLanguage() {
  try {
    const saved = window.localStorage?.getItem(LANG_KEY);
    if (SHEET_LANGUAGES.some((language) => language.id === saved)) return saved;
  } catch {
    // Storage can be unavailable; fall through to the default.
  }
  return SHEET_LANGUAGES[0].id;
}

export function rememberSheetLanguage(lang) {
  try { window.localStorage?.setItem(LANG_KEY, lang); } catch { /* best effort */ }
}

function digits(value, lang) {
  return Number(value || 0).toLocaleString(lang === "fa" ? "fa-IR" : "en-US");
}

/** Who to credit for a sheet edit. A phone in the meeting and a laptop at the
    desk write to the same sheet, so "edited 12h ago" alone hides half the story. */
function memberName(members, id) {
  if (!id || id === "unknown") return "";
  const found = (members || []).find((member) => member.id === id);
  return found?.name || "";
}

/** Plain-text export of a sheet, in one language, for pasting into a proposal or a chat. */
export function sheetAsText(template, sheet, lang) {
  const L = (value) => sheetText(value, lang);
  const lines = [`${sheet.title}`, `${L(template.name)} · ${sheet.companyName}`, ""];
  for (const section of template.sections || []) {
    lines.push(`## ${L(section.title)}`);
    for (const item of section.items || []) {
      if (section.kind === "checklist") {
        lines.push(`${sheet.checks?.[item.id] ? "[x]" : "[ ]"} ${L(item.text)}`);
      } else {
        const answer = String(sheet.answers?.[item.id] || "").trim();
        lines.push(`${item.must ? "★ " : ""}${L(item.text)}`);
        lines.push(answer ? `→ ${answer}` : "→ —");
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function ProgressBar({ value, total, className = "" }) {
  const percent = total ? Math.round((value / total) * 100) : 0;
  return <span className={`sh-progress ${className}`} role="progressbar" aria-valuemin="0" aria-valuemax={total} aria-valuenow={value}><i style={{ width: `${percent}%` }} /></span>;
}

export function SheetRow({ sheet, lang = "fa", members = [], onOpen }) {
  const template = sheetTemplate(sheet.templateId);
  const progress = sheetProgress(template, sheet);
  const L = (value) => sheetText(value, lang);
  const touchedBy = memberName(members, sheet.updatedBy || sheet.createdBy);
  const status = sheet.status === "complete"
    ? (lang === "fa" ? "کامل" : "complete")
    : `${digits(progress.answered, lang)} ${lang === "fa" ? "از" : "of"} ${digits(progress.questions, lang)} ${lang === "fa" ? "پاسخ داده شده" : "answered"}`;
  return (
    <button type="button" className={`sh-row ${sheet.status === "complete" ? "is-complete" : ""}`} onClick={() => onOpen(sheet.id)}>
      <span className="sh-row-icon">{sheet.status === "complete" ? <CheckCircle2 size={19} /> : <ClipboardList size={19} />}</span>
      <span className="sh-row-body">
        <strong dir="auto">{sheet.title}</strong>
        <small dir="auto">{template ? L(template.name) : sheet.templateId} · {status}{sheet.updatedAt ? ` · ${relativeTime(sheet.updatedAt)}` : ""}{touchedBy ? ` · ${touchedBy}` : ""}</small>
        <ProgressBar value={progress.answered} total={progress.questions} />
      </span>
      <span className="sh-row-stat"><b>{progress.answered}<em>/{progress.questions}</em></b><small>ANSWERED</small></span>
      <span className="sh-row-stat is-must"><b className={progress.must && progress.mustAnswered < progress.must ? "is-short" : ""}>{progress.mustAnswered}<em>/{progress.must}</em></b><small>MUST-HAVE</small></span>
      <ChevronRight size={15} />
    </button>
  );
}

export function SheetsPanel({ sheets = [], lang = "fa", members = [], onOpen, onNew }) {
  return (
    <section className="cp-panel sh-panel">
      <header><span><ClipboardList size={16} /><strong>Sheets</strong></span><span className="sh-panel-actions"><small>{sheets.length ? `${sheets.length} filled in` : ""}</small><button type="button" onClick={onNew}><Plus size={13} /> Start one</button></span></header>
      <div>
        {sheets.map((sheet) => <SheetRow key={sheet.id} sheet={sheet} lang={lang} members={members} onOpen={onOpen} />)}
        {!sheets.length ? <div className="cp-empty"><ClipboardList size={18} /><strong>No questionnaires here yet</strong><p>A questionnaire is a fixed set of questions you answer for one client. Two exist: the website discovery for the first meeting, and the proposal checklist for everything that must be settled before a price goes out. The answers stay here.</p></div> : null}
      </div>
    </section>
  );
}

export function NewSheetDialog({ company, projects = [], initialProjectId = "", initialTemplateId = "", onClose, onCreated }) {
  const [templateId, setTemplateId] = useState(sheetTemplate(initialTemplateId)?.id || SHEET_TEMPLATES[0]?.id || "");
  const template = sheetTemplate(templateId);
  const [title, setTitle] = useState(() => (template ? sheetText(template.name, "en") : ""));
  const [touched, setTouched] = useState(false);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const writableProjects = projects.filter((project) => !project.derived);

  useEffect(() => {
    if (!touched && template) setTitle(sheetText(template.name, "en"));
  }, [template, touched]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = await sheetRequest("/api/workspaces/sheets", {
        method: "POST",
        body: JSON.stringify({ companyId: company.id, companyName: company.name, companyWebsite: company.url, projectId: projectId || undefined, templateId, title })
      });
      onCreated(body.sheet);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cp-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="cp-dialog sh-dialog" role="dialog" aria-modal="true" aria-label={`New sheet for ${company.name}`}>
        <header><span><small>QUESTIONNAIRE</small><strong>{company.name}</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <form onSubmit={submit}>
          <div className="sh-template-pick" role="radiogroup" aria-label="Questionnaire">
            {SHEET_TEMPLATES.map((item) => {
              const questions = item.sections.filter((section) => section.kind === "questions").reduce((sum, section) => sum + section.items.length, 0);
              const checklists = item.sections.filter((section) => section.kind === "checklist").length;
              return <label key={item.id} className={item.id === templateId ? "is-active" : ""}>
                <input type="radio" name="sheet-template" value={item.id} checked={item.id === templateId} onChange={() => setTemplateId(item.id)} />
                <span><strong>{sheetText(item.name, "en")}</strong><small>{questions} questions · {checklists} checklists · {sheetText(item.description, "en")}</small></span>
              </label>;
            })}
          </div>
          <label>Name this copy <small>So you can tell it apart later — the meeting, the date, the person.</small><input autoFocus required maxLength={180} dir="auto" value={title} onChange={(event) => { setTouched(true); setTitle(event.target.value); }} /></label>
          {writableProjects.length ? <label>Attach to a project <small>Optional. Leave it at company level if it's about the relationship, not one piece of work.</small>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Company level</option>
              {writableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label> : null}
          {error ? <p role="alert">{error}</p> : null}
          <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="is-primary" disabled={busy || !template}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Plus size={14} />} Start {template ? sheetText(template.name, "en").toLowerCase() : "questionnaire"}</button></footer>
        </form>
      </aside>
    </div>
  );
}

function useAutoGrow(value) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight + 2}px`;
  }, [value]);
  return ref;
}

function QuestionField({ item, index, sectionNumber, lang, value, onChange }) {
  const ref = useAutoGrow(value);
  const L = (text) => sheetText(text, lang);
  const id = `sheet-q-${item.id}`;
  return (
    <div className={`sh-question ${item.must ? "is-must" : ""} ${String(value || "").trim() ? "is-answered" : ""}`}>
      <span className="sh-question-id">{item.must ? <b aria-label="required for pricing">★</b> : null}{digits(sectionNumber, lang)}.{digits(index + 1, lang)}</span>
      <div>
        <label htmlFor={id} dir="auto">{L(item.text)}</label>
        {L(item.why) ? <p className="sh-why" dir="auto"><span>{lang === "fa" ? "چرا" : "Why"}</span> {L(item.why)}</p> : null}
        <textarea id={id} ref={ref} rows="1" dir="auto" value={value || ""} placeholder={lang === "fa" ? "پاسخ…" : "Answer…"} onChange={(event) => onChange(item.id, event.target.value)} />
      </div>
    </div>
  );
}

function CheckItem({ item, lang, checked, onChange }) {
  const L = (text) => sheetText(text, lang);
  const id = `sheet-k-${item.id}`;
  return (
    <label className={`sh-check ${checked ? "is-done" : ""}`} htmlFor={id}>
      <input id={id} type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(item.id, event.target.checked)} />
      <span><strong dir="auto">{L(item.text)}</strong>{L(item.note) ? <small dir="auto">{L(item.note)}</small> : null}</span>
    </label>
  );
}

/** Rename and delete live behind one button: on a phone a bare red trash icon
    beside "Mark complete" is deletion under the thumb at the end of a meeting. */
function SheetMenu({ busy, onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <span className="sh-menu" ref={ref}>
      <button type="button" disabled={busy} aria-haspopup="menu" aria-expanded={open} aria-label="More sheet actions" onClick={() => setOpen((current) => !current)}><MoreHorizontal size={14} /></button>
      {open ? <span className="sh-menu-list" role="menu">
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onRename(); }}><Pencil size={13} /> Rename sheet</button>
        {onDelete ? <button type="button" role="menuitem" className="is-danger" onClick={() => { setOpen(false); onDelete(); }}><Trash2 size={13} /> Delete sheet</button> : null}
      </span> : null}
    </span>
  );
}

/**
 * The sheet editor. Edits are kept locally, batched, and PATCHed key by key;
 * a fresher copy of the sheet arriving from the server (another device, the
 * live stream) only replaces fields that are not mid-edit here.
 */
export function SheetStage({ company, project = null, sheet, projects = [], members = [], canDelete = false, lang = "fa", onLang, onBack, onOpenProject, onChanged, onDeleted }) {
  /* Printing is scoped to this class the way every other printable surface in
     the app scopes its own. The rules that put the sheet on the page also hide
     everything else, so they must only bite while a sheet is actually open —
     unscoped, they turned every other document's print into a blank sheet. */
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.add("is-printing-sheet");
    return () => root.classList.remove("is-printing-sheet");
  }, []);

  const template = sheetTemplate(sheet.templateId);
  const language = sheetLanguage(lang);
  const L = useCallback((value) => sheetText(value, lang), [lang]);
  const [draft, setDraft] = useState({ answers: { ...(sheet.answers || {}) }, checks: { ...(sheet.checks || {}) } });
  // Nothing has been written this session yet, so the indicator claims nothing.
  const [saveState, setSaveState] = useState("idle");
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState(template?.sections?.[0]?.id || "");
  const dirty = useRef({ answers: {}, checks: {} });
  const timer = useRef(null);
  const inflight = useRef(false);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    setDraft((current) => {
      const answers = { ...(sheet.answers || {}) };
      const checks = { ...(sheet.checks || {}) };
      for (const key of Object.keys(dirty.current.answers)) answers[key] = current.answers[key] ?? "";
      for (const key of Object.keys(dirty.current.checks)) checks[key] = Boolean(current.checks[key]);
      return { answers, checks };
    });
  }, [sheet]);

  const flush = useCallback(async ({ keepalive = false } = {}) => {
    if (inflight.current && !keepalive) {
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
      return;
    }
    const payload = { answers: { ...dirty.current.answers }, checks: { ...dirty.current.checks } };
    if (!Object.keys(payload.answers).length && !Object.keys(payload.checks).length) return;
    dirty.current = { answers: {}, checks: {} };
    inflight.current = true;
    setSaveState("saving");
    try {
      const body = await sheetRequest(`/api/workspaces/sheets/${sheetRef.current.id}`, { method: "PATCH", body: JSON.stringify(payload), keepalive });
      setSaveState("saved");
      // The retry worked, so the red banner goes with it. Without this one line
      // a single dropped request leaves "not saved" on screen for the session.
      setError("");
      onChangedRef.current?.(body.sheet);
    } catch (caught) {
      // Put back anything that has not been re-edited since, and try again shortly.
      for (const [key, value] of Object.entries(payload.answers)) if (!(key in dirty.current.answers)) dirty.current.answers[key] = value;
      for (const [key, value] of Object.entries(payload.checks)) if (!(key in dirty.current.checks)) dirty.current.checks[key] = value;
      setSaveState("error");
      setError(caught.message);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), RETRY_DELAY_MS);
    } finally {
      inflight.current = false;
    }
  }, []);

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") { window.clearTimeout(timer.current); void flush({ keepalive: true }); } };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      window.clearTimeout(timer.current);
      void flush({ keepalive: true });
    };
  }, [flush]);

  function changeAnswer(key, value) {
    setDraft((current) => ({ ...current, answers: { ...current.answers, [key]: value } }));
    dirty.current.answers[key] = value;
    setSaveState("pending");
    schedule();
  }

  function changeCheck(key, value) {
    setDraft((current) => ({ ...current, checks: { ...current.checks, [key]: value } }));
    dirty.current.checks[key] = value;
    setSaveState("pending");
    schedule();
  }

  async function patchMeta(updates) {
    setBusy(true);
    setError("");
    try {
      const body = await sheetRequest(`/api/workspaces/sheets/${sheet.id}`, { method: "PATCH", body: JSON.stringify(updates) });
      onChanged?.(body.sheet);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    const next = window.prompt("Sheet title", sheet.title);
    if (next === null || !next.trim() || next.trim() === sheet.title) return;
    await patchMeta({ title: next.trim() });
  }

  async function remove() {
    if (!window.confirm(`Delete “${sheet.title}”? The answers cannot be recovered.`)) return;
    setBusy(true);
    try {
      await sheetRequest(`/api/workspaces/sheets/${sheet.id}`, { method: "DELETE" });
      onDeleted?.(sheet);
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  }

  /* The clipboard API is unavailable on plain http, which is exactly how the
     phone reaches HQ over the LAN in a meeting. Say so and hand over the text
     instead of reporting a copy that never happened. */
  async function copyText() {
    if (!template) return;
    const text = sheetAsText(template, { ...sheet, ...draft }, lang);
    try {
      if (typeof navigator.clipboard?.writeText !== "function") throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      setCopyFallback(text);
    }
  }

  async function markComplete() {
    // The template's own intro says the ★ questions are required for pricing.
    // Completing without them is allowed, but never by accident.
    if (progress.must && progress.mustAnswered < progress.must) {
      const missing = progress.must - progress.mustAnswered;
      const ok = window.confirm(`${missing} must-have${missing === 1 ? " is" : "s are"} still blank — complete anyway?`);
      if (!ok) {
        setOnlyMissing(true);
        return;
      }
    }
    await patchMeta({ status: "complete" });
  }

  const progress = useMemo(() => sheetProgress(template, draft), [template, draft]);
  const writableProjects = projects.filter((item) => !item.derived);
  const missingCount = progress.must - progress.mustAnswered;
  const editedBy = memberName(members, sheet.updatedBy || sheet.createdBy);

  /* With the must-have filter on, a section keeps only its unanswered ★ items
     and a section left with nothing drops out entirely — in a live meeting the
     one thing you want on screen is what is still missing. */
  const sections = useMemo(() => {
    const all = template?.sections || [];
    if (!onlyMissing) return all.map((section, index) => ({ section, number: index + 1, items: section.items || [] }));
    return all
      .map((section, index) => ({
        section,
        number: index + 1,
        items: section.kind === "questions" ? (section.items || []).filter((item) => item.must && !String(draft.answers[item.id] || "").trim()) : []
      }))
      .filter((entry) => entry.items.length);
  }, [draft.answers, onlyMissing, template]);

  if (!template) {
    return (
      <section className="cp-project-stage sh-stage">
        <nav className="cp-project-breadcrumb" aria-label="Sheet breadcrumb"><button type="button" onClick={onBack}><ArrowLeft size={14} /> {company.name}</button><ChevronRight size={13} /><span dir="auto">{sheet.title}</span></nav>
        <div className="cp-empty sh-missing"><ClipboardList size={18} /><strong>This sheet uses a template this version of HQ does not know.</strong><p>Template “{sheet.templateId}”. Update HQ, or ask the owner to delete the sheet.</p>{canDelete ? <button type="button" onClick={() => void remove()}><Trash2 size={13} /> Delete sheet</button> : null}</div>
      </section>
    );
  }

  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "pending" ? "Unsaved changes" : saveState === "error" ? "Not saved — retrying" : saveState === "saved" ? "Saved" : "No changes yet";

  return (
    <section className="cp-project-stage sh-stage" dir={language.dir} lang={lang}>
      <nav className="cp-project-breadcrumb" aria-label="Sheet breadcrumb" dir="ltr">
        <button type="button" onClick={onBack}><ArrowLeft size={14} /> {company.name}</button>
        {project ? <><ChevronRight size={13} /><button type="button" onClick={() => onOpenProject?.(project.id)}>{project.name}</button></> : null}
        <ChevronRight size={13} /><span dir="auto">{sheet.title}</span>
      </nav>

      <header className="sh-head" dir="ltr">
        <span className="cp-company-mark">{company.name.slice(0, 2).toUpperCase()}</span>
        <span className="sh-head-title">
          <small>{L(template.name).toUpperCase()}{sheet.status === "complete" ? " · COMPLETE" : ""}</small>
          <h1 dir="auto">{sheet.title}</h1>
          <p>{company.name}{project ? ` · ${project.name}` : ""}{sheet.updatedAt ? ` · edited ${relativeTime(sheet.updatedAt)}` : ""}{editedBy ? ` by ${editedBy}` : ""}</p>
        </span>
        <dl className="sh-kpis">
          <div><dt>Answered</dt><dd>{progress.answered}<em>/{progress.questions}</em></dd></div>
          <div className="sh-kpi-must">
            <dt>Must-have</dt>
            <dd>
              <button type="button" className={`sh-kpi-filter ${onlyMissing ? "is-on" : ""} ${progress.mustAnswered < progress.must ? "is-short" : "is-good"}`} aria-pressed={onlyMissing} onClick={() => setOnlyMissing((current) => !current)}>
                {progress.mustAnswered}<em>/{progress.must}</em>
                <small>{onlyMissing ? "show all" : missingCount > 0 ? "show missing" : "all answered"}</small>
              </button>
            </dd>
          </div>
          <div><dt>Checks</dt><dd>{progress.checked}<em>/{progress.checks}</em></dd></div>
        </dl>
        <div className="sh-head-actions">
          <span className={`sh-save is-${saveState}`}>{saveState === "saving" ? <LoaderCircle className="is-spinning" size={12} /> : saveState === "saved" ? <Check size={12} /> : null} {saveLabel}</span>
          <span className="sh-lang" role="group" aria-label="Sheet language"><Languages size={13} />{SHEET_LANGUAGES.map((item) => <button type="button" key={item.id} className={item.id === lang ? "is-active" : ""} aria-pressed={item.id === lang} onClick={() => onLang?.(item.id)}>{item.label}</button>)}</span>
          {writableProjects.length ? <select aria-label="Project" value={sheet.projectId || ""} disabled={busy} onChange={(event) => void patchMeta({ projectId: event.target.value || "" })}><option value="">Company level</option>{writableProjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
          <button type="button" onClick={() => void copyText()} aria-label="Copy sheet as text"><Copy size={13} /> {copied ? "Copied" : "Copy as text"}</button>
          {sheet.status === "complete"
            ? <button type="button" disabled={busy} onClick={() => void patchMeta({ status: "open" })}><RotateCcw size={13} /> Reopen</button>
            : <button type="button" className="is-primary" disabled={busy} onClick={() => void markComplete()}><CheckCircle2 size={13} /> Mark complete</button>}
          <SheetMenu busy={busy} onRename={() => void rename()} onDelete={canDelete ? () => void remove() : null} />
        </div>
        <ProgressBar className="sh-head-progress" value={progress.answered} total={progress.questions} />
      </header>

      {copyFallback ? <div className="sh-copy-fallback" dir="ltr">
        <p><strong>This connection cannot reach the clipboard.</strong> Select the text below and copy it by hand — on a phone, long-press then Select all.</p>
        <textarea readOnly value={copyFallback} aria-label="Sheet as text" onFocus={(event) => event.target.select()} />
        <button type="button" onClick={() => setCopyFallback("")}><X size={13} /> Close</button>
      </div> : null}

      {error ? <p className="cp-error" role="alert" dir="ltr">{error}</p> : null}

      <div className="sh-body">
        {onlyMissing ? <p className="sh-filter-note" dir="auto" role="status">{missingCount > 0
          ? (lang === "fa" ? `فقط ${digits(missingCount, lang)} سؤال ★ بی‌پاسخ نشان داده می‌شود.` : `Showing the ${missingCount} unanswered must-have${missingCount === 1 ? "" : "s"} only.`)
          : (lang === "fa" ? "همهٔ سؤال‌های ★ جواب دارند." : "Every must-have is answered.")}</p> : null}

        {template.intro?.length && !onlyMissing ? <aside className="sh-intro">{template.intro.map((line, index) => <p key={index} dir="auto">{L(line)}</p>)}</aside> : null}

        {!onlyMissing ? <nav className="sh-sections" aria-label="Sheet sections">
          {template.sections.map((section, index) => {
            const part = progress.sections[section.id] || { total: 0, done: 0 };
            return <a key={section.id} href={`#sheet-section-${section.id}`} className={`${activeSection === section.id ? "is-active" : ""} ${part.total && part.done === part.total ? "is-done" : ""}`} onClick={() => setActiveSection(section.id)}><b>{digits(index + 1, lang)}</b> {L(section.title)} <small>{digits(part.done, lang)}/{digits(part.total, lang)}</small></a>;
          })}
        </nav> : null}

        {sections.map(({ section, number, items }) => {
          const part = progress.sections[section.id] || { total: 0, done: 0 };
          return (
            <section key={section.id} id={`sheet-section-${section.id}`} className={`sh-section is-${section.kind}`}>
              <header>
                <span className="sh-section-n">{digits(number, lang)}</span>
                <h2 dir="auto">{L(section.title)}</h2>
                <small>{digits(part.done, lang)} / {digits(part.total, lang)}</small>
              </header>
              {L(section.lead) && !onlyMissing ? <p className="sh-lead" dir="auto">{L(section.lead)}</p> : null}
              <div className="sh-items">
                {section.kind === "checklist"
                  ? items.map((item) => <CheckItem key={item.id} item={item} lang={lang} checked={draft.checks[item.id]} onChange={changeCheck} />)
                  : items.map((item) => <QuestionField key={item.id} item={item} index={(section.items || []).indexOf(item)} sectionNumber={number} lang={lang} value={draft.answers[item.id]} onChange={changeAnswer} />)}
              </div>
              {section.scripts?.length && !onlyMissing ? section.scripts.map((script, scriptIndex) => <blockquote key={scriptIndex} className="sh-script"><small dir="auto">{L(script.label)}</small><p dir="auto">{L(script.text)}</p></blockquote>) : null}
              {section.kind === "questions" ? <p className="sh-legend"><b>★</b> {lang === "fa" ? "برای قیمت‌گذاری ضروری" : "required for pricing"}</p> : null}
            </section>
          );
        })}

        {onlyMissing && !sections.length ? <div className="cp-empty"><CheckCircle2 size={18} /><strong>{lang === "fa" ? "هیچ ★ بی‌پاسخی نمانده." : "No must-have is left blank."}</strong><p>{lang === "fa" ? "فیلتر را بردارید تا کل برگه را ببینید." : "Turn the filter off to see the whole sheet."}</p></div> : null}
      </div>

      <footer className="sh-foot">
        <span><FolderKanban size={13} /> {project ? project.name : "Company level"}</span>
        <span>{lang === "fa" ? "قیمت نگویید. یادداشت بردارید." : "Don't quote. Take notes."}</span>
      </footer>
    </section>
  );
}
