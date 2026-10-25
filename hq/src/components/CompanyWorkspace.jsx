import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileSignature,
  FolderKanban,
  History,
  LoaderCircle,
  Mail,
  MessageSquareText,
  Pencil,
  Phone,
  Plus,
  Send,
  Sparkles,
  TriangleAlert,
  UserRound,
  Wallet,
  Activity
} from "lucide-react";
import { dueLabel, formatDate, isOverdue, localIsoDate, relativeTime } from "../format.js";
import { KIND_LABELS, STAGE_DEFINITIONS, STAGE_LABELS, projectNextMoves, stageFromPipeline } from "../workspace-model.js";
import { DEAL_CURRENCIES, effectiveStage, formatDealExact } from "../deals.js";
import { SHEET_TEMPLATES, sheetText } from "../sheet-templates.js";
import { SheetRow } from "./CompanySheets.jsx";
import { CompanyMoney } from "./CompanyMoney.jsx";
import { ClientDetail } from "./ClientsPage.jsx";
import { FilesPanel } from "./FilesPanel.jsx";
import { buildProposalBrief } from "../proposal-brief.js";
import { StageChangeDialog, companyRequest, historyFor } from "./CompanyDesk.jsx";

/* One client, everything about them, in tabs. The top never changes: who they
   are, where they stand on the way to being paid, what they are worth, and the
   one thing that happens next. What you can open under it is the work, what
   you know, the paper, and the money. */

const HEALTH_LABELS = { on_track: "On track", at_risk: "At risk", blocked: "Blocked" };
const JOURNEY = ["lead", "talking", "proposal", "active", "operating"];
const PARKED = ["dormant", "lost"];
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "work", label: "Work" },
  { id: "brain", label: "Brain" },
  { id: "docs", label: "Documents" },
  { id: "money", label: "Money", owner: true }
];
const RECENT = 5;

function telegramUrl(handle) {
  return `https://t.me/${String(handle || "").replace(/^@/, "")}`;
}

function DealChip({ company, onSave }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(company.dealCurrency || localStorage.getItem("agent4-deal-currency") || "USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function begin() {
    setValue(company.dealValue ? String(company.dealValue) : "");
    setCurrency(company.dealCurrency || localStorage.getItem("agent4-deal-currency") || "USD");
    setError("");
    setOpen(true);
  }

  async function submit(event) {
    event.preventDefault();
    const digits = value.replace(/[,\s]/g, "");
    if (digits && !/^\d+$/.test(digits)) { setError("Use a whole number."); return; }
    setBusy(true);
    setError("");
    try {
      await onSave(digits ? { dealValue: Number(digits), dealCurrency: currency } : { dealValue: null });
      if (digits) { try { localStorage.setItem("agent4-deal-currency", currency); } catch { /* optional */ } }
      setOpen(false);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cw-deal">
      <button type="button" className={`cw-deal__chip${company.dealValue ? "" : " is-empty"}`} onClick={begin} aria-expanded={open}>
        <Wallet size={15} aria-hidden="true" />
        <span>{company.dealValue ? formatDealExact(company.dealValue, company.dealCurrency) : "Set deal value"}</span>
      </button>
      {open ? (
        <form className="cw-deal__form" onSubmit={submit}>
          <label>What is this worth?
            <span>
              <input autoFocus inputMode="numeric" value={value} placeholder="12000" aria-label="Deal value" onChange={(event) => setValue(event.target.value)} />
              <select value={currency} aria-label="Currency" onChange={(event) => setCurrency(event.target.value)}>{DEAL_CURRENCIES.map((code) => <option key={code}>{code}</option>)}</select>
            </span>
          </label>
          <small>An estimate is fine. Leave it empty to clear it.</small>
          {error ? <p role="alert">{error}</p> : null}
          <footer>
            <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn--gold" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />} Save</button>
          </footer>
        </form>
      ) : null}
    </div>
  );
}

/* The live sites that belong to this client, when the owner is watching any. */
function LiveSites({ company, onOpenSite }) {
  const [sites, setSites] = useState([]);
  useEffect(() => {
    let live = true;
    fetch("/api/monitor/sites").then((response) => (response.ok ? response.json() : { sites: [] })).then((body) => {
      if (live) setSites((body.sites || []).filter((site) => site.companyId && (site.companyId === company.id || site.companyId === company.storedId)));
    }).catch(() => {});
    return () => { live = false; };
  }, [company.id, company.storedId]);
  if (!sites.length) return null;
  return (
    <section className="cw-card">
      <header><h3>Live sites</h3></header>
      <ul className="cw-sites">
        {sites.map((site) => (
          <li key={site.id}>
            <button type="button" onClick={() => onOpenSite(site.id)}>
              <i className={`mn-dot is-${site.paused ? "paused" : site.status === "down" ? "down" : site.status === "up" ? "up" : "unknown"}`} aria-hidden="true" />
              <span><strong dir="auto">{site.name}</strong><small>{site.host}</small></span>
              <em>{site.uptime.percent != null ? `${site.uptime.percent}% up` : "checking"}</em>
              <em>{site.tracking ? `${site.visitors7} visitors / 7d` : "not counting visitors"}</em>
              <Activity size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Overview({ company, history, today, onTab, onOpenMeeting, onOpenProject, onOpenSheet, onAsk, onOpenSite }) {
  const openTasks = company.tasks.filter((task) => task.status !== "done");
  const late = openTasks.filter((task) => task.dueOn && isOverdue(task.dueOn, today)).length;
  const recent = history.slice(0, RECENT);
  return (
    <div className="cw-overview">
      <div className="cw-tiles">
        <button type="button" onClick={() => onTab("work")}><small>Open tasks</small><strong>{openTasks.length}</strong><span className={late ? "is-late" : ""}>{late ? `${late} late` : openTasks.length ? "On track" : "None"}</span></button>
        <button type="button" onClick={() => onTab("brain")}><small>Meetings</small><strong>{company.meetings.length}</strong><span>{company.meetings[0] ? `Last ${relativeTime(company.meetings[0].createdAt)}` : "None yet"}</span></button>
        <button type="button" onClick={() => onTab("work")}><small>Projects</small><strong>{company.projects.length}</strong><span>{company.projects.length ? "In progress" : "None yet"}</span></button>
        <button type="button" onClick={() => onTab("brain")}><small>Last touch</small><strong className="is-text">{company.lastTouch ? relativeTime(company.lastTouch) : "Never"}</strong><span>Anything logged</span></button>
      </div>

      {onOpenSite ? <LiveSites company={company} onOpenSite={onOpenSite} /> : null}

      {company.kind === "prospect" && company.findings?.length ? (
        <section className="cw-card">
          <header><h3>Why this prospect</h3></header>
          <ul className="cw-findings">{company.findings.map((finding, index) => <li key={index} dir="auto">{finding}</li>)}</ul>
        </section>
      ) : null}

      <section className="cw-card">
        <header><h3>Recently</h3>{history.length > RECENT ? <button type="button" className="cw-link" onClick={() => onTab("brain")}>Everything <ArrowRight size={13} /></button> : null}</header>
        {recent.length ? <HistoryList items={recent} onOpenMeeting={onOpenMeeting} onOpenProject={onOpenProject} onOpenSheet={onOpenSheet} /> : (
          <div className="cw-empty">
            <History size={20} aria-hidden="true" />
            <strong>Nothing logged yet</strong>
            <p>Meetings, notes, decisions and stage moves collect here. Save a meeting in the Film Room, or write what you know on the Brain tab.</p>
            <button type="button" className="btn" onClick={onAsk}><Sparkles size={14} /> Ask Agent4 what to do first</button>
          </div>
        )}
      </section>
    </div>
  );
}

function HistoryList({ items, onOpenMeeting, onOpenProject, onOpenSheet }) {
  const iconFor = (type) => (type === "meeting" ? CalendarDays : type === "decision" ? CheckCircle2 : type === "sheet" ? ClipboardList : MessageSquareText);
  return (
    <ul className="cw-timeline">
      {items.map((item) => {
        const Icon = iconFor(item.type);
        const action = item.meetingId ? () => onOpenMeeting(item.meetingId) : item.sheetId ? () => onOpenSheet(item.sheetId) : item.projectId ? () => onOpenProject(item.projectId) : null;
        const body = (
          <>
            <span className={`cw-timeline__icon is-${item.type}`}><Icon size={15} /></span>
            <span className="cw-timeline__text"><strong dir="auto">{item.title}</strong>{item.detail ? <small dir="auto">{item.detail}</small> : null}</span>
            <time dateTime={item.at}>{relativeTime(item.at)}</time>
          </>
        );
        return <li key={item.id}>{action ? <button type="button" onClick={action}>{body}</button> : <div>{body}</div>}</li>;
      })}
    </ul>
  );
}

function Work({ company, onOpenProject, onNewProject, onOpenTasks, onAddTask }) {
  const today = localIsoDate();
  const open = company.tasks.filter((task) => task.status !== "done").sort((a, b) => String(a.dueOn || "9999").localeCompare(String(b.dueOn || "9999")));
  return (
    <div className="cw-stack">
      <section className="cw-card">
        <header><h3>Tasks</h3><span className="cw-head-actions"><button type="button" className="cw-link" onClick={() => onOpenTasks({ company, project: null })}>Task board <ArrowRight size={13} /></button><button type="button" className="btn btn--gold" onClick={onAddTask}><Plus size={14} /> Task</button></span></header>
        {open.length ? (
          <ul className="cw-tasks">
            {open.slice(0, 8).map((task) => {
              const late = task.dueOn && isOverdue(task.dueOn, today);
              return (
                <li key={task.id}>
                  <button type="button" onClick={() => onOpenTasks({ company, project: null })}>
                    <i className={task.status === "doing" ? "is-doing" : ""} aria-hidden="true" />
                    <span><strong dir="auto">{task.title}</strong>{task.project ? <small>{task.project}</small> : null}</span>
                    {task.dueOn ? <em className={late ? "is-late" : ""}>{dueLabel(task.dueOn, { today })}</em> : null}
                  </button>
                </li>
              );
            })}
            {open.length > 8 ? <li className="cw-tasks__more">{open.length - 8} more on the task board</li> : null}
          </ul>
        ) : <p className="cw-quiet">No open tasks for {company.name}.</p>}
      </section>

      <section className="cw-card">
        <header><h3>Projects</h3><button type="button" className="btn" onClick={onNewProject}><Plus size={14} /> Project</button></header>
        <div className="cw-projects">
          {company.projects.map((project) => {
            const openTasks = project.tasks.filter((task) => task.status !== "done").length;
            const moves = projectNextMoves(project).length;
            return (
              <button type="button" key={project.id} onClick={() => onOpenProject(project.id)}>
                <span className="cw-projects__icon"><FolderKanban size={20} /></span>
                <span className="cw-projects__name"><strong dir="auto">{project.name}</strong><i className={`is-${project.health || "on_track"}`}>{HEALTH_LABELS[project.health] || "On track"}</i></span>
                <span className="cw-projects__stat"><b>{openTasks}</b><small>open</small></span>
                <span className="cw-projects__stat"><b>{project.meetings.length}</b><small>meetings</small></span>
                <span className="cw-projects__stat"><b>{moves}</b><small>next moves</small></span>
                <ArrowRight size={15} />
              </button>
            );
          })}
          {!company.projects.length ? <p className="cw-quiet">A project is a piece of work with a goal and a deadline. Add one when this client says yes.</p> : null}
        </div>
      </section>
    </div>
  );
}

function Brain({ company, history, sheetLang, members, onChanged, onAsk, onOpenMeeting, onOpenProject, onOpenSheet, onNewSheet }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const shown = filter === "all" ? history : history.filter((item) => item.type === filter);

  async function saveNote(event) {
    event.preventDefault();
    const detail = draft.trim();
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await companyRequest(`/api/workspaces/companies/${encodeURIComponent(company.storedId || company.id)}/events`, { method: "POST", body: JSON.stringify({ type: "note", detail }) });
      setDraft("");
      onChanged();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cw-stack">
      <section className="cw-card">
        <header><h3>What you know</h3><button type="button" className="btn" onClick={onAsk}><Sparkles size={14} /> Ask about {company.name}</button></header>
        <form className="cw-note" onSubmit={saveNote}>
          <textarea
            value={draft}
            rows={3}
            dir="auto"
            placeholder={`Write down anything about ${company.name}: what they said, what they want, what worries them.`}
            aria-label="Add a note"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void saveNote(event); } }}
          />
          <footer>
            <small>⌘ Enter to save</small>
            <button type="submit" className="btn btn--gold" disabled={busy || !draft.trim()}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Plus size={14} />} Save note</button>
          </footer>
          {error ? <p role="alert">{error}</p> : null}
        </form>
      </section>

      <section className="cw-card">
        <header>
          <h3>Timeline</h3>
          <span className="cw-filters" role="group" aria-label="Filter the timeline">
            {[["all", "All"], ["meeting", "Meetings"], ["update", "Notes"], ["decision", "Decisions"]].map(([id, label]) => <button type="button" key={id} className={filter === id ? "is-on" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
          </span>
        </header>
        {shown.length ? <HistoryList items={shown} onOpenMeeting={onOpenMeeting} onOpenProject={onOpenProject} onOpenSheet={onOpenSheet} /> : <p className="cw-quiet">{filter === "all" ? "Nothing logged yet." : "Nothing of that kind yet."}</p>}
      </section>

      <section className="cw-card">
        <header><h3>Questionnaires</h3><small>Same questions for every client; the answers stay here.</small></header>
        <div className="cw-sheets">
          {company.sheets.map((sheet) => <SheetRow key={sheet.id} sheet={sheet} lang={sheetLang} members={members} onOpen={onOpenSheet} />)}
          {SHEET_TEMPLATES.map((template) => {
            const existing = company.sheets.filter((sheet) => sheet.templateId === template.id);
            const questions = template.sections.filter((section) => section.kind === "questions").reduce((sum, section) => sum + section.items.length, 0);
            return (
              <button type="button" className="cw-template" key={template.id} onClick={() => onNewSheet(template.id)}>
                <span><ClipboardList size={17} /></span>
                <span><strong>{existing.length ? "Start another " : "Start "}{sheetText(template.name, "en").toLowerCase()}</strong><small>{questions} questions · {sheetText(template.description, "en")}</small></span>
                <ArrowRight size={14} />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* The whole picture of a client as plain text, for the proposal you write with Claude. */
function ProposalBrief({ company, lang }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const brief = useMemo(() => buildProposalBrief(company, { lang, showMoney: true }), [company, lang]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { setOpen(true); }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([brief], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${company.name} proposal brief.md`.replace(/[\\/:*?"<>|]+/g, "-");
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="cw-card cw-brief">
      <header><h3>Proposal brief</h3><small>Everything about {company.name}, ready to give Claude</small></header>
      <p className="cw-quiet">Meetings, questionnaire answers, notes, contacts and open work in one document. Paste it into Claude with one of your templates and ask for the proposal.</p>
      <div className="cw-brief__actions">
        <button type="button" className="btn btn--gold" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy for Claude"}</button>
        <button type="button" className="btn" onClick={download}><Download size={14} /> Download .md</button>
        <button type="button" className="btn btn--quiet" onClick={() => setOpen((value) => !value)}>{open ? "Hide" : "Preview"}</button>
      </div>
      {open ? <pre className="cw-brief__preview" dir="auto">{brief}</pre> : null}
    </section>
  );
}

function Documents({ company, sheetLang, onOpenPaperwork }) {
  const [state, setState] = useState({ status: "loading", documents: [], message: "" });
  const id = company.storedId || company.id;

  useEffect(() => {
    let active = true;
    if (!company.stored) { setState({ status: "ready", documents: [], message: "" }); return undefined; }
    fetch(`/api/workspaces/companies/${encodeURIComponent(id)}/paperwork`).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!active) return;
      if (!response.ok) setState({ status: "error", documents: [], message: body?.error?.message || "The documents could not be read." });
      else setState({ status: "ready", documents: body.documents || [], message: "" });
    }).catch((caught) => { if (active) setState({ status: "error", documents: [], message: caught.message }); });
    return () => { active = false; };
  }, [company.stored, id]);

  return (
    <div className="cw-stack">
      <ProposalBrief company={company} lang={sheetLang === "fa" ? "fa" : "en"} />

      <section className="cw-card">
        <FilesPanel
          title="Files"
          hint={`What you have written for or received from ${company.name}.`}
          kind="document"
          companyId={company.storedId || company.id}
          companyName={company.name}
          empty={{ title: "Drop a proposal or a client file here", body: "Anything you want to find again, up to 25 MB." }}
        />
      </section>

      <section className="cw-card">
        <FilesPanel
          compact
          title="Your templates"
          hint="Start from one of these."
          kind="template"
          empty={{ title: "No templates yet", body: "Upload your proposal template on the Paperwork page and it appears here." }}
        />
      </section>

      <section className="cw-card">
        <header><h3>Paperwork</h3><button type="button" className="btn btn--gold" onClick={() => onOpenPaperwork(company)}><FileSignature size={14} /> New document</button></header>
        {state.status === "loading" ? <p className="cw-quiet"><LoaderCircle className="is-spinning" size={14} /> Reading…</p> : null}
        {state.status === "error" ? <p className="cw-error" role="alert">{state.message}</p> : null}
        {state.status === "ready" && state.documents.length ? (
          <ul className="cw-docs">
            {state.documents.map((doc) => (
              <li key={doc.id}>
                <button type="button" onClick={() => onOpenPaperwork(company, doc.id)}>
                  <i><FileSignature size={16} /></i>
                  <span><strong dir="auto">{doc.title || doc.number}</strong><small>{doc.number} · {formatDate(String(doc.createdAt).slice(0, 10))}</small></span>
                  <em className={`is-${doc.status}`}>{doc.status}</em>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {state.status === "ready" && !state.documents.length ? <p className="cw-quiet">No proposals, agreements or receipts for {company.name} yet. A proposal is usually the first piece of paper a client sees.</p> : null}
      </section>

      <section className="cw-card">
        <header><h3>Their page</h3><small>A private page where {company.name} sees where the work stands.</small></header>
        {company.stored ? <ClientDetail embedded companyId={company.storedId || company.id} /> : <p className="cw-quiet">Save {company.name} as a client first, then you can give them a page.</p>}
      </section>
    </div>
  );
}

export function CompanyWorkspace({ company, canSeeMoney, sheetLang, members = [], copied, initialTab = "overview", onTabChange, onBack, onEdit, onSave, onCopyMention, onOpenProject, onNewProject, onOpenSheet, onNewSheet, onOpenTasks, onAddTask, onOpenMeeting, onOpenMoney, onOpenPaperwork, onOpenSite, onAsk, onChanged }) {
  const [tab, setTab] = useState(TABS.some((item) => item.id === initialTab) ? initialTab : "overview");
  const [pendingStage, setPendingStage] = useState("");
  const history = useMemo(() => historyFor(company), [company]);
  const today = localIsoDate();
  const next = company.next;
  const late = Boolean(next?.dueOn && isOverdue(next.dueOn, today));
  const stage = effectiveStage(company);
  const hasContact = company.contactName || company.contactPhone || company.contactTelegram || company.contactEmail;
  const about = company.summary || company.howMet;
  const website = company.url || company.website;
  const pipelineStage = company.kind === "prospect" ? stageFromPipeline(company.pipelineStage) : "";
  const tabs = TABS.filter((item) => !item.owner || canSeeMoney);

  useEffect(() => { setTab(TABS.some((item) => item.id === initialTab) ? initialTab : "overview"); }, [company.id, initialTab]);

  const changeTab = useCallback((next) => {
    setTab(next);
    onTabChange?.(next === "overview" ? "" : next);
  }, [onTabChange]);

  async function saveStage(updates) {
    const before = company.stage;
    await onSave(updates);
    if (updates.stage && updates.stage !== before) {
      void companyRequest(`/api/workspaces/companies/${encodeURIComponent(company.storedId || company.id)}/events`, {
        method: "POST",
        body: JSON.stringify({ type: "stage", detail: `${STAGE_LABELS[before] || before} → ${STAGE_LABELS[updates.stage] || updates.stage}` })
      }).then(() => onChanged?.()).catch((caught) => console.warn(`The stage moved, but its history line was not saved: ${caught.message}`));
    }
    setPendingStage("");
  }

  return (
    <section className="cw">
      <button type="button" className="cw-back" onClick={onBack}><ArrowLeft size={15} /> Clients</button>

      <header className="cw-head">
        <span className="cw-mark" aria-hidden="true">{[...company.name].slice(0, 2).join("").toUpperCase()}</span>
        <div className="cw-title">
          <h1 dir="auto">{company.name}</h1>
          <p className="cw-meta">
            <span className={`cw-kind is-${company.kind || "client"}`}>{KIND_LABELS[company.kind] || "Client"}</span>
            {pipelineStage && pipelineStage !== stage ? <span>Radar says {STAGE_LABELS[pipelineStage]}{company.score ? ` · score ${company.score}` : ""}</span> : null}
            {company.hidden ? <span>Hidden</span> : null}
          </p>
          {about ? <p className="cw-about" dir="auto">{about}</p> : <button type="button" className="cw-add" onClick={() => onEdit("summary")}>Add a line on what they do and how you met</button>}
        </div>
        <div className="cw-head__actions">
          {canSeeMoney ? <DealChip company={company} onSave={onSave} /> : null}
          <button type="button" className="btn" onClick={() => onEdit("name")}><Pencil size={14} /> Edit</button>
          {website ? <a className="btn btn--icon" href={website} target="_blank" rel="noreferrer noopener" aria-label="Open website"><ExternalLink size={15} /></a> : null}
          <button type="button" className="btn btn--icon" aria-label={copied ? "Mention copied" : "Copy mention"} onClick={onCopyMention}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
        </div>
      </header>

      <nav className="cw-journey" aria-label="Where this client stands">
        {JOURNEY.map((id) => (
          <button type="button" key={id} className={stage === id ? "is-current" : ""} aria-current={stage === id ? "step" : undefined} onClick={() => stage !== id && setPendingStage(id)} title={STAGE_DEFINITIONS[id]}>{STAGE_LABELS[id]}</button>
        ))}
        <span className="cw-journey__gap" aria-hidden="true" />
        {PARKED.map((id) => (
          <button type="button" key={id} className={`is-parked${stage === id ? " is-current" : ""}`} aria-current={stage === id ? "step" : undefined} onClick={() => stage !== id && setPendingStage(id)} title={STAGE_DEFINITIONS[id]}>{STAGE_LABELS[id]}</button>
        ))}
      </nav>
      <p className="cw-stage-meaning">{STAGE_DEFINITIONS[stage]}</p>

      <div className="cw-contact">
        {hasContact ? (
          <>
            <span className="cw-person"><UserRound size={14} /><strong dir="auto">{company.contactName || "Contact"}</strong>{company.contactRole ? <em dir="auto">{company.contactRole}</em> : null}</span>
            {company.contactPhone ? <a href={`tel:${company.contactPhone.replace(/\s+/g, "")}`}><Phone size={13} /> {company.contactPhone}</a> : null}
            {company.contactTelegram ? <a href={telegramUrl(company.contactTelegram)} target="_blank" rel="noreferrer noopener"><Send size={13} /> {company.contactTelegram}</a> : null}
            {company.contactEmail ? <a href={`mailto:${company.contactEmail}`}><Mail size={13} /> {company.contactEmail}</a> : null}
          </>
        ) : <button type="button" className="cw-add" onClick={() => onEdit("contactName")}><AtSign size={13} /> Add the person you talk to</button>}
      </div>

      <section className={`cw-next${late ? " is-late" : ""}${!next || next.borrowed ? " is-empty" : ""}`} aria-label="Next step">
        <div>
          <small>Next step</small>
          {next ? <strong dir="auto">{next.title}</strong> : <strong>Nothing written down for what happens next.</strong>}
          <p>
            {next?.dueOn ? <span><CalendarDays size={12} /> {dueLabel(next.dueOn, { today })} · {formatDate(next.dueOn, { style: "short", today })}</span> : next ? <span>No date</span> : <span>A relationship without a next step goes quiet.</span>}
            {company.lastTouch ? <span> · last touch {relativeTime(company.lastTouch)}</span> : null}
          </p>
          {next?.borrowed ? <p className="cw-next__borrowed"><TriangleAlert size={12} /> No next step set. This is your most urgent open task standing in for one.</p> : null}
        </div>
        <div className="cw-next__actions">
          <button type="button" className="btn btn--gold" onClick={() => onEdit("nextAction")}>{next && !next.borrowed ? "Change" : "Set next step"}</button>
          <button type="button" className="btn" onClick={onAddTask}><Plus size={14} /> Task</button>
        </div>
      </section>

      <div className="cw-tabs" role="tablist" aria-label={`${company.name} sections`}>
        {tabs.map((item) => <button type="button" role="tab" key={item.id} id={`cw-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="cw-panel" className={tab === item.id ? "is-on" : ""} onClick={() => changeTab(item.id)}>{item.label}</button>)}
      </div>

      <div className="cw-panel" id="cw-panel" role="tabpanel" aria-labelledby={`cw-tab-${tab}`}>
        {tab === "overview" ? <Overview company={company} history={history} today={today} onTab={changeTab} onOpenMeeting={onOpenMeeting} onOpenProject={onOpenProject} onOpenSheet={onOpenSheet} onAsk={onAsk} onOpenSite={canSeeMoney ? onOpenSite : undefined} /> : null}
        {tab === "work" ? <Work company={company} onOpenProject={onOpenProject} onNewProject={onNewProject} onOpenTasks={onOpenTasks} onAddTask={onAddTask} /> : null}
        {tab === "brain" ? <Brain company={company} history={history} sheetLang={sheetLang} members={members} onChanged={onChanged} onAsk={onAsk} onOpenMeeting={onOpenMeeting} onOpenProject={onOpenProject} onOpenSheet={onOpenSheet} onNewSheet={onNewSheet} /> : null}
        {tab === "docs" ? <Documents company={company} sheetLang={sheetLang} onOpenPaperwork={onOpenPaperwork} /> : null}
        {tab === "money" && canSeeMoney ? <CompanyMoney company={company} onOpenMoney={onOpenMoney} /> : null}
      </div>

      {pendingStage ? <StageChangeDialog company={company} stage={pendingStage} onClose={() => setPendingStage("")} onSave={saveStage} /> : null}
    </section>
  );
}
