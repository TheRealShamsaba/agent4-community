import { FilesPanel } from "./FilesPanel.jsx";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Languages,
  LoaderCircle,
  Lock,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  X
} from "lucide-react";
import { ClientPublish } from "./ClientPage.jsx";
import { PaperworkDoc } from "./PaperworkDoc.jsx";
import { PaperworkField, isAnswered } from "./PaperworkFields.jsx";
import { CompanyPicker, CompanyTag, NO_COMPANY, companyName, useCompanies } from "./CompanyPicker.jsx";
import { PAPERWORK_TEMPLATES, pick, templateById } from "../paperwork-templates.js";
import { formatDate, localIsoDate, relativeTime } from "../format.js";

/* Paperwork: the shelf of blank Your company paper, everything already written
   on it, and the desk where one document is filled in.

   The store keeps answers, never a rendered page, so the layout in
   PaperworkDoc.jsx can keep improving and a proposal written last year
   improves with it. This file is the other half of that bargain: it asks the
   template's questions, saves the answers one key at a time, and shows the
   paper next to the form so that what is being typed and what the client will
   read are never two different things. */

/* The list is asked for a page at a time, and a hundred documents is far more
   than a one-person studio writes in a year. Past that the counts beside the
   filters can no longer speak for everything, and the page says so rather than
   quietly filtering a slice. */
const LIST_LIMIT = 100;

/* Long enough that a sentence is typed rather than saved letter by letter,
   short enough that closing the laptop mid-thought loses nothing. */
const SAVE_DELAY_MS = 700;
const RETRY_DELAY_MS = 4000;

const STATUS_LABEL = { draft: "Draft", sent: "Sent", signed: "Signed", void: "Void" };
const STATUS_FILTERS = [["", "All"], ["draft", "Drafts"], ["sent", "Sent"], ["signed", "Signed"], ["void", "Void"]];

const LANGUAGES = [["en", "English"], ["fa", "فارسی"]];

async function request(pathname, options = {}) {
  let response;
  try {
    response = await fetch(`/api/paperwork${pathname}`, {
      ...options,
      headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
    });
  } catch {
    throw new Error("The paperwork service is offline.");
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The paperwork service returned an unreadable response.");
  }
  if (!response.ok) {
    const error = new Error(body?.error?.message || "The paperwork service refused that.");
    error.code = body?.error?.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

/** A 403 here is not a broken page — it is a teammate looking at the owner's paper. */
function isOwnerOnly(error) {
  return error?.code === "owner_required" || error?.status === 403;
}

/** When the document last actually moved, which is rarely when the row was touched. */
function movedLabel(record) {
  if (record.status === "signed" && record.signedOn) return `Signed ${formatDate(record.signedOn, { style: "short" })}`;
  if (record.status === "sent" && record.sentOn) return `Sent ${formatDate(record.sentOn, { style: "short" })}`;
  return relativeTime(record.updatedAt || record.createdAt) || "";
}

/* ------------------------------------------------------------- the shelf --- */

/* Naming it and filing it before the first number is spent. The run of numbers
   is per prefix per year and it is what a client quotes back in an email, so a
   proposal created by a stray click and deleted an hour later leaves a hole in
   a sequence somebody else is reading. One short dialog is cheaper than that. */
function NewDocument({ template, companies, companyId, onClose, onCreate }) {
  const [lang, setLang] = useState("en");
  const suggested = companyName(companies, companyId);
  const [title, setTitle] = useState(() => `${pick(template.name, "en")}${suggested ? ` — ${suggested}` : ""}`);
  const [company, setCompany] = useState({ id: companyId === NO_COMPANY ? "" : companyId || "", name: suggested || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Give the document a title — it is what you will recognise it by in the list.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCreate({
        type: template.id,
        title: title.trim(),
        numberPrefix: template.prefix,
        companyId: company.id || undefined,
        companyName: company.name || undefined,
        language: lang
      });
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  }

  return (
    <div className="pw-scrim" role="dialog" aria-modal="true" aria-label={`New ${pick(template.name, "en")}`}>
      {/* Escape closes it; the backdrop does not. Nothing here is expensive to
          retype, but a stray click landing on the scrim while reading the blurb
          should not be the thing that cancels the document. */}
      <form className="pw-dialog" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
        <header>
          <span className={`pw-dialog-mark pw-card--${template.accent}`}>{template.prefix}</span>
          <span>
            <strong>{pick(template.name, "en")}</strong>
            <small>{pick(template.blurb, "en")}</small>
          </span>
          <button type="button" className="pw-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <label className="field">
          <span>Title</span>
          <input value={title} dir="auto" autoFocus onChange={(event) => setTitle(event.target.value)} />
        </label>

        <CompanyPicker
          companies={companies}
          value={company.id}
          label="Who it is for"
          noneLabel="Nobody in the CRM — a one-off"
          hint="The name is kept on the document, so deleting a company later never blanks a signed page."
          onChange={(id, picked) => setCompany({ id, name: picked?.name || "" })}
        />

        <fieldset className="pw-langs">
          <legend>Language of the document</legend>
          {LANGUAGES.map(([id, label]) => (
            <button key={id} type="button" className={lang === id ? "is-on" : ""} aria-pressed={lang === id} onClick={() => setLang(id)}>{label}</button>
          ))}
        </fieldset>

        {error ? <p className="errorstate" role="alert">{error}</p> : null}

        <div className="pw-dialog-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? <LoaderCircle className="is-spinning" size={14} /> : <Plus size={14} />} Create the draft
          </button>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------- the desk --- */

/**
 * One document: its questions on the left, the paper it becomes on the right.
 *
 * Answers are held here and PATCHed key by key — the store merges, so a change
 * to one field sends one field. The indicator says what is actually true about
 * the save, because two editors in this app used to render the word "Saved"
 * whatever had happened.
 */
function Editor({ document: initial, companies, profile, onBack, onChanged, onDeleted }) {
  const template = templateById(initial.type);
  const [record, setRecord] = useState(initial);
  const [form, setForm] = useState({
    title: initial.title,
    companyId: initial.companyId || "",
    companyName: initial.companyName || "",
    language: initial.language === "fa" ? "fa" : "en",
    values: { ...(initial.values || {}) }
  });
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [on, setOn] = useState(localIsoDate());
  const [busy, setBusy] = useState(false);

  const dirty = useRef({ meta: {}, values: {} });
  const timer = useRef(null);
  const inflight = useRef(false);
  const idRef = useRef(initial.id);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const flush = useCallback(async ({ keepalive = false } = {}) => {
    if (inflight.current && !keepalive) {
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
      return;
    }
    const payload = { ...dirty.current.meta };
    if (Object.keys(dirty.current.values).length) payload.values = { ...dirty.current.values };
    if (!Object.keys(payload).length) return;
    dirty.current = { meta: {}, values: {} };
    inflight.current = true;
    setSaveState("saving");
    try {
      const body = await request(`/${idRef.current}`, { method: "PATCH", body: JSON.stringify(payload), keepalive });
      setSaveState("saved");
      setError("");
      setRecord(body.document);
      onChangedRef.current?.(body.document);
    } catch (caught) {
      /* Put back anything that has not been re-typed since, and try again. A
         dropped request must not leave "not saved" on screen for the session
         the way it would if the payload were simply lost. */
      for (const [key, value] of Object.entries(payload.values || {})) {
        if (!(key in dirty.current.values)) dirty.current.values[key] = value;
      }
      for (const [key, value] of Object.entries(payload)) {
        if (key !== "values" && !(key in dirty.current.meta)) dirty.current.meta[key] = value;
      }
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

  /* A closed laptop, a switched tab and a navigation away are all the same
     thing to the person typing: they expect what they wrote to be there. */
  useEffect(() => {
    const onHide = () => {
      if (window.document.visibilityState !== "hidden") return;
      window.clearTimeout(timer.current);
      void flush({ keepalive: true });
    };
    window.document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      window.clearTimeout(timer.current);
      void flush({ keepalive: true });
    };
  }, [flush]);

  function changeValue(key, value) {
    setForm((current) => ({ ...current, values: { ...current.values, [key]: value } }));
    dirty.current.values[key] = value;
    setSaveState("pending");
    schedule();
  }

  function changeMeta(updates) {
    setForm((current) => ({ ...current, ...updates }));
    Object.assign(dirty.current.meta, updates);
    setSaveState("pending");
    schedule();
  }

  async function move(status) {
    window.clearTimeout(timer.current);
    await flush();
    setActionError("");
    setBusy(true);
    try {
      const body = await request(`/${record.id}/status`, { method: "POST", body: JSON.stringify({ status, on }) });
      setRecord(body.document);
      onChangedRef.current?.(body.document);
    } catch (caught) {
      setActionError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  /* Resolves true once everything typed has been saved. The client's page shows
     what is saved, never what is on the screen, so publishing waits for this. */
  async function settle() {
    window.clearTimeout(timer.current);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const pending = Object.keys(dirty.current.meta).length || Object.keys(dirty.current.values).length;
      if (!inflight.current && !pending) return true;
      if (!inflight.current) await flush();
      else await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    return false;
  }

  async function remove() {
    if (!window.confirm(`Delete ${record.number} — ${form.title}? The answers go with it, and the number is not reissued.`)) return;
    window.clearTimeout(timer.current);
    dirty.current = { meta: {}, values: {} };
    setActionError("");
    setBusy(true);
    try {
      await request(`/${record.id}`, { method: "DELETE" });
      onDeleted();
    } catch (caught) {
      setActionError(caught.message);
      setBusy(false);
    }
  }

  const live = useMemo(() => ({ ...record, ...form }), [record, form]);
  const missing = useMemo(() => {
    if (!template) return [];
    return template.fields.filter((field) => field.required && !isAnswered(field, form.values[field.id]));
  }, [template, form.values]);

  if (!template) {
    return (
      <div className="pw-stage">
        <div className="pw-top no-print">
          <button type="button" className="pw-back" onClick={onBack}><ArrowLeft size={14} /> Paperwork</button>
        </div>
        <div className="errorstate" role="alert">
          <strong>This document uses a template this version of HQ does not know.</strong>
          <p>Its type is “{record.type}”. The answers are safe on the server — update HQ and it will open.</p>
        </div>
      </div>
    );
  }

  const saveLabel = saveState === "saving"
    ? "Saving"
    : saveState === "pending"
      ? "Unsaved changes"
      : saveState === "error"
        ? "Not saved — retrying"
        : saveState === "saved"
          ? "Saved"
          : record.updatedAt ? `Edited ${relativeTime(record.updatedAt)}` : "No changes yet";

  return (
    <div className="pw-stage">
      <div className="pw-top no-print">
        <button type="button" className="pw-back" onClick={onBack}><ArrowLeft size={14} /> Paperwork</button>
        <span className="pw-top-id">
          <span className="pw-no" dir="ltr">{record.number}</span>
          <span className={`pw-status s-${record.status}`}>{STATUS_LABEL[record.status]}</span>
        </span>
        <span className={`pw-save is-${saveState}`} role="status">
          {saveState === "saving" ? <LoaderCircle className="is-spinning" size={12} /> : saveState === "saved" ? <Check size={12} /> : null}
          {saveLabel}
        </span>
        <span className="pw-top-actions">
          {record.status === "draft" || record.status === "sent" ? (
            <label className="pw-on">
              <span>On</span>
              <input type="date" value={on} onChange={(event) => setOn(event.target.value)} aria-label="The day this moved" />
            </label>
          ) : null}
          {record.status === "draft" ? <button type="button" className="btn" disabled={busy} onClick={() => void move("sent")}>Mark sent</button> : null}
          {record.status === "sent" ? <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void move("signed")}>Mark signed</button> : null}
          {record.status === "sent" ? <button type="button" className="btn" disabled={busy} onClick={() => void move("draft")}>Back to draft</button> : null}
          {record.status === "signed" ? <button type="button" className="btn" disabled={busy} onClick={() => void move("sent")}>Back to sent</button> : null}
          {record.status === "void" ? <button type="button" className="btn" disabled={busy} onClick={() => void move("draft")}>Back to draft</button> : null}
          {record.status !== "void" ? <button type="button" className="btn" disabled={busy} onClick={() => void move("void")}>Void</button> : null}
          <button type="button" className="btn" onClick={() => window.print()}><Printer size={13} /> Print</button>
          <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void remove()}><Trash2 size={13} /> Delete</button>
        </span>
      </div>

      {error ? <p className="errorstate no-print" role="alert">{error}</p> : null}
      {actionError ? <p className="errorstate no-print" role="alert">{actionError}</p> : null}

      {record.type === "update" ? (
        <ClientPublish
          record={record}
          form={form}
          settle={settle}
          onDocument={(document) => { setRecord(document); onChangedRef.current?.(document); }}
        />
      ) : null}

      <div className="pw-desk">
        <section className="pw-form no-print" dir={form.language === "fa" ? "rtl" : "ltr"} lang={form.language}>
          <div className="pw-form-meta" dir="ltr" lang="en">
            <label className="field">
              <span>Title</span>
              <input value={form.title} dir="auto" onChange={(event) => changeMeta({ title: event.target.value })} />
            </label>
            <CompanyPicker
              companies={companies}
              value={form.companyId}
              label="Who it is for"
              noneLabel="Nobody in the CRM — a one-off"
              onChange={(id, picked) => changeMeta({ companyId: id, companyName: picked?.name || "" })}
            />
            <span className="pw-lang" role="group" aria-label="Language of the document">
              <Languages size={13} />
              {LANGUAGES.map(([id, label]) => (
                <button key={id} type="button" className={form.language === id ? "is-on" : ""} aria-pressed={form.language === id} onClick={() => changeMeta({ language: id })}>{label}</button>
              ))}
            </span>
          </div>

          {missing.length ? (
            <p className="pw-missing" role="status" dir="ltr" lang="en">
              {missing.length} {missing.length === 1 ? "answer the page needs is" : "answers the page needs are"} still blank.
            </p>
          ) : null}

          <div className="pw-fields">
            {template.fields.map((field) => (
              <PaperworkField
                key={field.id}
                field={field}
                lang={form.language}
                value={form.values[field.id]}
                missing={missing.includes(field)}
                onChange={changeValue}
              />
            ))}
          </div>
        </section>

        <section className="pw-paper">
          <PaperworkDoc document={live} template={template} profile={profile} lang={form.language} />
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the place --- */

export function PaperworkPage({ onBack, initialCompanyId = "", initialDocId = "", onDocument, onCompany }) {
  const companies = useCompanies();
  const [data, setData] = useState({ status: "loading", documents: [], total: 0, hasMore: false, message: "", locked: false });
  const [profile, setProfile] = useState(null);
  const [companyFilter, setCompanyFilter] = useState(initialCompanyId);
  const [statusFilter, setStatusFilter] = useState("");
  const [creating, setCreating] = useState(null);
  const [open, setOpen] = useState({ status: "idle", record: null, message: "" });
  const [actionError, setActionError] = useState("");
  const wantedDoc = useRef(initialDocId);
  const onDocumentRef = useRef(onDocument);
  onDocumentRef.current = onDocument;

  const load = useCallback(async () => {
    setData((current) => ({ ...current, status: "loading", message: "", locked: false }));
    try {
      const body = await request(`?limit=${LIST_LIMIT}`);
      setData({
        status: "ready",
        documents: body.documents || [],
        total: body.total || 0,
        hasMore: Boolean(body.hasMore),
        message: "",
        locked: false
      });
    } catch (error) {
      setData({ status: "error", documents: [], total: 0, hasMore: false, message: error.message, locked: isOwnerOnly(error) });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* The invoice profile is Your company's own details, and it is the only
     place they are kept. A second profile for paperwork would be two answers
     to "what is our tax number", and one of them would be wrong. */
  useEffect(() => {
    let alive = true;
    fetch("/api/invoices/profile")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (alive && body?.profile) setProfile(body.profile); })
      .catch(() => { /* The paper falls back to its own name; nothing is blocked. */ });
    return () => { alive = false; };
  }, []);

  const openDocument = useCallback(async (id) => {
    setActionError("");
    setOpen({ status: "loading", record: null, message: "" });
    onDocumentRef.current?.(id);
    try {
      const body = await request(`/${id}`);
      // A reply without a document is a server that answered the wrong question.
      // Reading straight through it renders the editor against nothing and takes
      // the section down, so it is treated as the failure it is.
      if (!body?.document?.id) throw new Error("That document could not be read.");
      setOpen({ status: "ready", record: body.document, message: "" });
    } catch (error) {
      setOpen({ status: "error", record: null, message: error.message });
    }
  }, []);

  /* A link straight to one document — the way a company page or a message from
     yesterday reaches it — opens that document rather than the shelf. */
  useEffect(() => {
    if (!wantedDoc.current) return;
    const id = wantedDoc.current;
    wantedDoc.current = "";
    void openDocument(id);
  }, [openDocument]);

  function closeDocument() {
    setOpen({ status: "idle", record: null, message: "" });
    onDocumentRef.current?.("");
    void load();
  }

  function filterByCompany(id) {
    const next = companyFilter === id ? "" : id;
    setCompanyFilter(next);
    onCompany?.(next);
  }

  async function create(input) {
    const body = await request("", { method: "POST", body: JSON.stringify(input) });
    setCreating(null);
    await load();
    setOpen({ status: "ready", record: body.document, message: "" });
    onDocumentRef.current?.(body.document.id);
  }

  const counts = useMemo(() => {
    const byCompany = new Map();
    let loose = 0;
    for (const record of data.documents) {
      if (record.companyId) byCompany.set(record.companyId, (byCompany.get(record.companyId) || 0) + 1);
      else loose += 1;
    }
    return { byCompany, loose };
  }, [data.documents]);

  const shown = useMemo(() => data.documents.filter((record) => {
    if (statusFilter && record.status !== statusFilter) return false;
    if (companyFilter === NO_COMPANY) return !record.companyId;
    if (companyFilter) return record.companyId === companyFilter;
    return true;
  }), [data.documents, statusFilter, companyFilter]);

  if (open.status === "ready") {
    return (
      <div className="court pw-page">
        <div className="bento">
          <div className="c12">
            <Editor
              key={open.record.id}
              document={open.record}
              companies={companies}
              profile={profile}
              onBack={closeDocument}
              onChanged={(record) => setOpen((current) => ({ ...current, record: { ...current.record, ...record } }))}
              onDeleted={closeDocument}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="court pw-page">
      <div className="bento">
        <header className="pg-head c12">
          <div>
            <h1>Paperwork</h1>
            <p>Proposals, agreements and receipts, and the templates you start from.</p>
          </div>
          <span className="pg-count">{data.status === "ready" ? `${data.total} written` : ""}</span>
        </header>

        {open.status === "loading" ? <p className="quiet c12">Opening the document…</p> : null}
        {open.status === "error" ? (
          <div className="c12 errorstate" role="alert">
            <strong>That document could not be opened</strong>
            <p>{open.message}</p>
            <button type="button" className="btn" onClick={() => { setOpen({ status: "idle", record: null, message: "" }); onDocumentRef.current?.(""); }}>Back to the shelf</button>
          </div>
        ) : null}

        {data.locked ? (
          <section className="mod c12">
            <div className="emptystate pw-locked">
              <strong><Lock size={16} /> Paperwork is the owner's</strong>
              <p>
                Proposals, agreements and receipts carry prices and client terms, so the server only hands them to the account that owns the
                company. Everything else in HQ is still yours.
              </p>
              <button type="button" className="btn" onClick={onBack}>Back to the home court</button>
            </div>
          </section>
        ) : null}

        {!data.locked ? (
          <>
            <section className="mod c12 pw-shelf">
              <FilesPanel
                title="Your templates"
                hint="The proposals and agreements you have already written, with Claude or by hand. Keep them here and download one whenever you need to start from it."
                kind="template"
                empty={{ title: "Drop your proposal template here", body: "A .docx, .pdf or .md you reuse. It stays here until you delete it." }}
              />
            </section>

            <section className="mod c12 pw-start">
              <div className="mh">
                <h3>Start a new document</h3>
                <span className="cnt">Numbered, and nothing leaves until you say so</span>
              </div>
              <div className="pw-start-row">
                {PAPERWORK_TEMPLATES.map((template) => (
                  <button type="button" key={template.id} className={`pw-start-chip pw-card--${template.accent}`} title={pick(template.blurb, "en")} onClick={() => setCreating(template)}>
                    <b>{template.prefix}</b>
                    <span dir="auto">{pick(template.name, "en")}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="mod c12">
              <div className="mh">
                <h3>Already written</h3>
                <span className="cnt">{shown.length}</span>
              </div>

              <div className="pw-filters">
                {STATUS_FILTERS.map(([value, label]) => (
                  <button key={value || "all"} type="button" className={statusFilter === value ? "on" : ""} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>
                    {label}
                  </button>
                ))}
              </div>

              {companies.list.length ? (
                <div className="firm-filters pw-firms">
                  <span className="firm-filters-lbl">For</span>
                  <button type="button" className={`firm-chip ${companyFilter === "" ? "on" : ""}`} aria-pressed={companyFilter === ""} onClick={() => filterByCompany("")}>
                    <span>Everyone</span><b>{data.documents.length}</b>
                  </button>
                  {companies.list.filter((company) => counts.byCompany.has(company.id)).map((company) => (
                    <button key={company.id} type="button" className={`firm-chip ${companyFilter === company.id ? "on" : ""}`} aria-pressed={companyFilter === company.id} onClick={() => filterByCompany(company.id)}>
                      <span dir="auto">{company.name}</span><b>{counts.byCompany.get(company.id)}</b>
                    </button>
                  ))}
                  {counts.loose ? (
                    <button type="button" className={`firm-chip warn ${companyFilter === NO_COMPANY ? "on" : ""}`} aria-pressed={companyFilter === NO_COMPANY} onClick={() => filterByCompany(NO_COMPANY)}>
                      <span>Nobody</span><b>{counts.loose}</b>
                    </button>
                  ) : null}
                </div>
              ) : null}

              {actionError ? <p className="errorstate" role="alert">{actionError}</p> : null}

              {data.status === "loading" ? <p className="quiet">Reading the file…</p> : null}

              {data.status === "error" ? (
                <div className="errorstate" role="alert">
                  <strong>The paperwork could not be read</strong>
                  <p>{data.message}</p>
                  <button type="button" className="btn" onClick={() => void load()}><RotateCcw size={13} /> Try again</button>
                </div>
              ) : null}

              {data.status === "ready" && !data.documents.length ? (
                <div className="emptystate">
                  <strong>Nothing written yet</strong>
                  <p>Pick a document type above — a proposal is usually the first piece of paper a client ever sees from you.</p>
                  <button type="button" className="btn btn--primary" onClick={() => setCreating(PAPERWORK_TEMPLATES[0])}>
                    <Plus size={13} /> Start a proposal
                  </button>
                </div>
              ) : null}

              {data.status === "ready" && data.documents.length > 0 && !shown.length ? (
                <div className="emptystate">
                  <strong>Nothing here</strong>
                  <p>No document matches that filter.</p>
                  <button type="button" className="btn" onClick={() => { setStatusFilter(""); filterByCompany(""); }}>Show everything</button>
                </div>
              ) : null}

              {shown.map((record) => {
                const template = templateById(record.type);
                const firm = record.companyName || (record.companyId ? companyName(companies, record.companyId) : "");
                return (
                  <div key={record.id} className={`pw-row is-${record.status}`}>
                    <button type="button" className="pw-row-main" onClick={() => void openDocument(record.id)}>
                      <span className="pw-no" dir="ltr">{record.number}</span>
                      <span className={`pw-status s-${record.status}`}>{STATUS_LABEL[record.status]}</span>
                      <span className="pw-row-title" dir="auto">{record.title}</span>
                      <span className="pw-row-kind">{template ? pick(template.name, "en") : record.type}</span>
                      <span className="pw-row-when">{movedLabel(record)}</span>
                      <ChevronRight className="pw-row-go" size={15} />
                    </button>
                    {firm ? (
                      <CompanyTag
                        name={firm}
                        active={companyFilter === record.companyId}
                        title={`Only ${firm}'s paperwork`}
                        onClick={() => filterByCompany(record.companyId || NO_COMPANY)}
                      />
                    ) : null}
                  </div>
                );
              })}

              {data.hasMore ? (
                <p className="quiet pw-capped">
                  Showing the {LIST_LIMIT} most recent of {data.total}. The counts above speak for these only.
                </p>
              ) : null}
            </section>

          </>
        ) : null}
      </div>

      {creating ? (
        <NewDocument
          template={creating}
          companies={companies}
          companyId={companyFilter}
          onClose={() => setCreating(null)}
          onCreate={create}
        />
      ) : null}
    </div>
  );
}
