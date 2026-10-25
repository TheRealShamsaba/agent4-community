import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  CircleAlert,
  ClipboardList,
  Copy,
  ExternalLink,
  Flag,
  GitBranch,
  GitCommitHorizontal,
  Github,
  Link2,
  ListTodo,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Target,
  Trash2,
  TriangleAlert,
  UserRound,
  X
} from "lucide-react";
import { dueLabel, formatDate, localIsoDate, relativeTime } from "../format.js";
import { STATUS_LABELS, buildWorkspaceModel, projectNextMoves, workspaceMention } from "../workspace-model.js";
import { NewSheetDialog, SheetStage, SheetsPanel, readSheetLanguage, rememberSheetLanguage } from "./CompanySheets.jsx";
import { CompanyDetailsDialog, patchCompany } from "./CompanyDesk.jsx";
import { ClientsBoard } from "./ClientsBoard.jsx";
import { CompanyWorkspace } from "./CompanyWorkspace.jsx";

/* How many rows a panel shows before it says how many it is hiding. A silent
   cap turns the record into a half-truth, which is worse than a long list. */
const PANEL_PREVIEW = 12;
/* Enough of the board to answer any one company honestly; the server tells us
   when even this was not the whole thing. */
const TASK_LIMIT = 500;

async function workspaceRequest(pathname, options = {}) {
  const response = await fetch(pathname, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || "The company workspace could not be updated.");
    error.code = body?.error?.code || "";
    error.companyId = body?.error?.companyId || "";
    error.projectId = body?.error?.projectId || "";
    throw error;
  }
  return body;
}

/* "Overdue" on its own made one day late and three months late look identical,
   so the shared label carries the magnitude instead. */
function taskDue(task) {
  if (!task.dueOn) return "No date";
  return dueLabel(task.dueOn);
}

function projectDate(value, fallback = "Not set") {
  if (!value) return fallback;
  return formatDate(value, { style: "short", today: localIsoDate() }) || fallback;
}

/* One row under a capped panel, saying what is not on screen. */
function ShowAll({ total, shown, open, noun, onToggle }) {
  if (total <= shown) return null;
  return <button type="button" className="cp-show-all" onClick={onToggle}>{open ? `Showing all ${total} ${noun} — show fewer` : `Showing ${shown} of ${total} ${noun} — show all`}</button>;
}

const HEALTH_LABELS = { on_track: "On track", at_risk: "At risk", blocked: "Blocked" };

function ProjectSettingsDialog({ company, project, members, focusField = "goal", onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState({
    name: project.name || "",
    summary: project.summary || "",
    goal: project.goal || "",
    definitionOfDone: project.definitionOfDone || "",
    ownerId: project.ownerId || "",
    dueOn: project.dueOn || "",
    status: project.status || "active",
    health: project.health || "on_track",
    milestone: project.milestone || "",
    milestoneDueOn: project.milestoneDueOn || ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removal, setRemoval] = useState(null);
  function change(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const owner = members.find((member) => member.id === form.ownerId);
      const payload = { ...form, ownerName: owner?.name || (form.ownerId === project.ownerId ? project.ownerName : "") };
      let saved;
      if (project.derived) {
        // A derived project is created on first save. The server answers
        // { project, created } and created:false means a row of that name was
        // already there — the goal, milestone and definition of done typed into
        // this form are not in it, so they have to be PATCHed on afterwards
        // rather than thrown away as they used to be.
        const body = await workspaceRequest("/api/workspaces/projects", { method: "POST", body: JSON.stringify({ ...payload, companyId: company.id, companyName: company.name, companyWebsite: company.url }) });
        saved = body.created
          ? body.project
          : (await workspaceRequest(`/api/workspaces/projects/${body.project.id}`, { method: "PATCH", body: JSON.stringify(payload) })).project;
      } else {
        saved = (await workspaceRequest(`/api/workspaces/projects/${project.id}`, { method: "PATCH", body: JSON.stringify(payload) })).project;
      }
      onSaved(saved);
    } catch (caught) {
      setError(caught.code === "project_name_taken" ? `${caught.message} Rename this one, or open the project that already has that name.` : caught.message);
    } finally {
      setBusy(false);
    }
  }
  async function askToDelete() {
    setBusy(true);
    setError("");
    try {
      setRemoval(await workspaceRequest(`/api/workspaces/projects/${project.id}`, { method: "DELETE" }));
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
      await workspaceRequest(`/api/workspaces/projects/${project.id}?confirm=true`, { method: "DELETE" });
      onDeleted?.(project);
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  }
  if (removal) {
    const attached = [
      [removal.attached?.tasks, "task", "tasks"],
      [removal.attached?.decisions, "decision", "decisions"],
      [removal.attached?.resources, "file or link", "files and links"],
      [removal.attached?.sheets, "questionnaire", "questionnaires"]
    ].filter(([count]) => Number(count) > 0).map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
    return (
      <div className="cp-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <aside className="cp-dialog cp-mini-dialog cd-confirm" role="dialog" aria-modal="true" aria-label={`Delete ${project.name}`}>
          <header><span><small>DELETE PROJECT</small><strong dir="auto">{project.name}</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
          <div className="cd-confirm-body">
            <p className="cd-confirm-lead"><TriangleAlert size={15} /> Deleting {project.name} deletes everything filed under it. This cannot be undone.</p>
            {attached.length ? <ul className="cd-confirm-list">{attached.map((line) => <li key={line}>{line}</li>)}</ul> : <p className="cd-confirm-empty">Nothing is filed under this project yet.</p>}
            {error ? <p role="alert">{error}</p> : null}
            <footer><button type="button" onClick={() => setRemoval(null)}>Keep it</button><button type="button" className="is-danger" disabled={busy} onClick={() => void confirmDelete()}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : null} Delete {project.name} and everything above</button></footer>
          </div>
        </aside>
      </div>
    );
  }
  return (
    <div className="cp-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="cp-dialog cp-project-dialog" role="dialog" aria-modal="true" aria-label={`Project setup for ${project.name}`}>
        <header><span><small>PROJECT COMMAND</small><strong>Make the direction obvious</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <form className="cp-project-form" onSubmit={submit}>
          <div className="cp-form-grid">
            <label>Project name<input required maxLength={180} value={form.name} onChange={(event) => change("name", event.target.value)} /></label>
            <label>Owner<select value={form.ownerId} onChange={(event) => change("ownerId", event.target.value)}><option value="">Unassigned</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}{project.ownerId && !members.some((member) => member.id === project.ownerId) ? <option value={project.ownerId}>{project.ownerName || "Current owner"}</option> : null}</select></label>
            <label>Status<select value={form.status} onChange={(event) => change("status", event.target.value)}><option value="active">Active</option><option value="paused">Paused</option><option value="done">Done</option></select></label>
            <label>Health<select value={form.health} onChange={(event) => change("health", event.target.value)}><option value="on_track">On track</option><option value="at_risk">At risk</option><option value="blocked">Blocked</option></select></label>
            <label>Project deadline<input type="date" value={form.dueOn} onChange={(event) => change("dueOn", event.target.value)} /></label>
            <label>Milestone deadline<input type="date" value={form.milestoneDueOn} onChange={(event) => change("milestoneDueOn", event.target.value)} /></label>
          </div>
          <label>Goal<textarea autoFocus={focusField === "goal"} rows="3" maxLength={3000} value={form.goal} onChange={(event) => change("goal", event.target.value)} placeholder="What changes when this project succeeds?" /></label>
          <label>Current milestone<textarea autoFocus={focusField === "milestone"} rows="2" maxLength={1000} value={form.milestone} onChange={(event) => change("milestone", event.target.value)} placeholder="The checkpoint everyone is driving toward now." /></label>
          <label>Definition of done<textarea autoFocus={focusField === "definitionOfDone"} rows="3" maxLength={3000} value={form.definitionOfDone} onChange={(event) => change("definitionOfDone", event.target.value)} placeholder="The observable conditions that mean this is finished." /></label>
          <label>Context<textarea rows="2" maxLength={2000} value={form.summary} onChange={(event) => change("summary", event.target.value)} placeholder="Scope, constraints, and useful background." /></label>
          {error ? <p role="alert">{error}</p> : null}
          <footer>{!project.derived && onDeleted ? <button type="button" className="is-danger cd-delete" disabled={busy} onClick={() => void askToDelete()}>Delete project</button> : null}<button type="button" onClick={onClose}>Cancel</button><button type="submit" className="is-primary" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />} Save project command</button></footer>
        </form>
      </aside>
    </div>
  );
}

function DecisionDialog({ project, onClose, onSaved }) {
  const [decision, setDecision] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = await workspaceRequest(`/api/workspaces/projects/${project.id}/decisions`, { method: "POST", body: JSON.stringify({ text: decision }) });
      onSaved(body.decision);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cp-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="cp-dialog cp-mini-dialog" role="dialog" aria-modal="true" aria-label="Record project decision">
        <header><span><small>DECISION LOG</small><strong>Record what the team decided</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <form onSubmit={submit}><label>Decision<textarea autoFocus required rows="5" maxLength={2000} value={decision} onChange={(event) => setDecision(event.target.value)} placeholder="We decided to…" /></label>{error ? <p role="alert">{error}</p> : null}<footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="is-primary" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <CheckCircle2 size={14} />} Record decision</button></footer></form>
      </aside>
    </div>
  );
}

function ResourceDialog({ project, onClose, onSaved }) {
  const [form, setForm] = useState({ label: "", url: "", kind: "link" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = await workspaceRequest(`/api/workspaces/projects/${project.id}/resources`, { method: "POST", body: JSON.stringify(form) });
      onSaved(body.resource);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cp-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="cp-dialog cp-mini-dialog" role="dialog" aria-modal="true" aria-label="Add project resource">
        <header><span><small>FILES & LINKS</small><strong>Keep the important path here</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <form onSubmit={submit}><label>Label<input autoFocus required maxLength={240} value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="Figma design" /></label><label>Type<select value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}><option value="link">Link</option><option value="document">Document</option><option value="design">Design</option><option value="folder">Folder</option></select></label><label>URL<input required type="url" maxLength={1000} value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://…" /></label>{error ? <p role="alert">{error}</p> : null}<footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="is-primary" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Link2 size={14} />} Add resource</button></footer></form>
      </aside>
    </div>
  );
}

function GitHubDialog({ project, onClose, onSaved }) {
  const [form, setForm] = useState({ repositoryUrl: project.repositoryUrl || "", repositoryBranch: project.repositoryBranch || "" });
  const [repositories, setRepositories] = useState([]);
  const [repositoryState, setRepositoryState] = useState("loading");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    workspaceRequest("/api/workspaces/github/repositories")
      .then((body) => {
        if (!active) return;
        setRepositories(Array.isArray(body.repositories) ? body.repositories : []);
        setRepositoryState("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setRepositoryState("error");
        setError(caught.message);
      });
    return () => { active = false; };
  }, []);
  const visibleRepositories = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return repositories;
    return repositories.filter((repository) => `${repository.slug} ${repository.description}`.toLowerCase().includes(needle));
  }, [query, repositories]);
  async function save(repositoryUrl = form.repositoryUrl, repositoryBranch = form.repositoryBranch) {
    setBusy(true);
    setConnecting(repositoryUrl);
    setError("");
    try {
      const body = await workspaceRequest(`/api/workspaces/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ repositoryUrl, repositoryBranch })
      });
      onSaved(body.project);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
      setConnecting("");
    }
  }
  return (
    <div className="cp-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="cp-dialog cp-github-dialog" role="dialog" aria-modal="true" aria-label={`Connect GitHub to ${project.name}`}>
        <header><span><small>PROJECT CODE</small><strong>Connect a GitHub repository</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="cp-github-dialog-intro"><Github size={23} /><p>Choose a repository and Agent4 connects it immediately. Access stays read-only and the credential never reaches this device.</p></div>
          <section className="cp-github-picker" aria-label="Available GitHub repositories">
            <div className="cp-github-picker-head"><strong>Your repositories</strong>{repositoryState === "ready" ? <small>{repositories.length} available</small> : null}</div>
            <label className="cp-github-search"><Search size={14} /><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repositories" aria-label="Search repositories" /></label>
            <div className="cp-github-repositories">
              {repositoryState === "loading" ? <div className="cp-github-picker-state"><LoaderCircle className="is-spinning" size={16} /> Reading GitHub…</div> : null}
              {repositoryState === "ready" && !visibleRepositories.length ? <div className="cp-github-picker-state">{repositories.length ? "No repository matches that search." : "No repositories are available to this connection."}</div> : null}
              {visibleRepositories.map((repository) => {
                const selected = project.repositoryUrl.replace(/\.git$/i, "") === repository.url;
                const isConnecting = connecting === repository.url;
                return <button key={repository.slug} type="button" className={selected ? "is-selected" : ""} disabled={busy} onClick={() => void save(repository.url, "")}>
                  <span className="cp-github-repository-icon"><Github size={16} /></span>
                  <span><strong>{repository.name}</strong><small>{repository.slug.split("/")[0]} · {repository.private ? "Private" : "Public"}{repository.updatedAt ? ` · ${relativeTime(repository.updatedAt)}` : ""}</small>{repository.description ? <em>{repository.description}</em> : null}</span>
                  {isConnecting ? <LoaderCircle className="is-spinning" size={15} /> : selected ? <Check size={15} /> : <ChevronRight size={15} />}
                </button>;
              })}
            </div>
          </section>
          <details className="cp-github-manual">
            <summary>Paste a repository instead</summary>
            <label>Repository<input type="text" maxLength={500} value={form.repositoryUrl} onChange={(event) => setForm((current) => ({ ...current, repositoryUrl: event.target.value }))} placeholder="https://github.com/owner/repository" /></label>
            <label>Branch <small>Optional—leave blank to follow the default branch.</small><input type="text" maxLength={200} value={form.repositoryBranch} onChange={(event) => setForm((current) => ({ ...current, repositoryBranch: event.target.value }))} placeholder="main" /></label>
            <button type="submit" className="cp-github-manual-connect" disabled={busy || !form.repositoryUrl.trim()}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Github size={14} />} Connect pasted repository</button>
          </details>
          {error ? <p role="alert">{error}</p> : null}
          <footer>{project.repositoryUrl ? <button type="button" className="is-danger" disabled={busy} onClick={() => void save("", "")}>Disconnect</button> : <span />}
            <span><button type="button" onClick={onClose}>Cancel</button></span>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function GitHubPanel({ project, activity, loading, onConnect, onRefresh }) {
  if (!project.repositoryUrl) {
    return <section className="cp-github-empty"><span><Github size={28} /></span><small>PROJECT CODE</small><h2>Bring the build history into the work.</h2><p>Connect this project to its repository to see the latest commits, changed files, branch, and direct links back to every change.</p><button type="button" onClick={onConnect}><Github size={15} /> Connect GitHub repository</button></section>;
  }
  if (loading && !activity) return <section className="cp-github-loading"><LoaderCircle className="is-spinning" size={20} /><strong>Reading the latest changes…</strong></section>;
  if (activity && !activity.available) {
    return <section className="cp-github-empty is-error"><span><Github size={28} /></span><small>GITHUB NEEDS ATTENTION</small><h2>Agent4 could not read this repository.</h2><p>{activity.error?.message || "Check the repository connection and try again."}</p><div><button type="button" onClick={onRefresh}><RefreshCw size={14} /> Try again</button><button type="button" onClick={onConnect}>Edit connection</button></div></section>;
  }
  const latest = activity?.latest;
  return (
    <section className="cp-github-panel">
      <header>
        <span><Github size={19} /><span><small>CONNECTED REPOSITORY</small><strong>{activity?.repository?.slug || project.repositoryUrl.replace("https://github.com/", "")}</strong></span></span>
        <span><i><GitBranch size={13} /> {activity?.repository?.branch || project.repositoryBranch || "default"}</i><button type="button" aria-label="Refresh GitHub activity" onClick={onRefresh}><RefreshCw size={14} /></button><button type="button" onClick={onConnect}>Settings</button></span>
      </header>
      {latest ? <article className="cp-github-latest">
        <span><small>LATEST CHANGE · {relativeTime(latest.committedAt)}</small><a href={latest.url} target="_blank" rel="noreferrer noopener">{latest.title} <ExternalLink size={13} /></a><p>{latest.author} · <code>{latest.shortSha}</code></p></span>
        <dl><div><dt>Files</dt><dd>{latest.filesChanged}</dd></div><div className="is-add"><dt>Added</dt><dd>+{latest.additions}</dd></div><div className="is-delete"><dt>Removed</dt><dd>−{latest.deletions}</dd></div></dl>
        {latest.files?.length ? <div className="cp-github-files">{latest.files.map((file) => <a key={file.path} href={file.url || latest.url} target="_blank" rel="noreferrer noopener"><span><strong>{file.path}</strong><small>{file.status}</small></span><i>+{file.additions} −{file.deletions}</i></a>)}</div> : null}
      </article> : <div className="cp-github-no-commits">No commits were found on this branch.</div>}
      <div className="cp-commit-list"><header><strong>Recent commits</strong><small>{activity?.commits?.length || 0} loaded</small></header>{(activity?.commits || []).map((commit) => <a key={commit.sha} href={commit.url} target="_blank" rel="noreferrer noopener"><GitCommitHorizontal size={15} /><span><strong>{commit.title}</strong><small>{commit.author} · {relativeTime(commit.committedAt)}</small></span><code>{commit.shortSha}</code><ExternalLink size={12} /></a>)}</div>
    </section>
  );
}

function ProjectGitHubPulse({ project, activity, loading, onConnect, onOpenCode }) {
  const latest = activity?.available ? activity.latest : null;
  const connectionLabel = activity?.available
    ? activity.repository?.slug || "Repository connected"
    : activity?.error
      ? "Connection needs attention"
      : project.repositoryUrl
        ? "Checking repository…"
        : "Code history is not connected";
  return <section className={`cp-github-pulse ${activity?.available ? "is-connected" : ""}`}>
    <header><span><Github size={17} /><span><small>GITHUB</small><strong>{connectionLabel}</strong></span></span>{project.repositoryUrl ? <button type="button" onClick={onOpenCode}>Open code history <ArrowRight size={13} /></button> : <button type="button" onClick={onConnect}>Connect repository</button>}</header>
    {loading && !activity ? <p>Reading the latest change…</p> : latest ? <div><span><small>LATEST CHANGE · {relativeTime(latest.committedAt)}</small><strong>{latest.title}</strong><em>{latest.author} · {latest.shortSha}</em></span><dl><div><dt>Files</dt><dd>{latest.filesChanged}</dd></div><div><dt>Added</dt><dd className="is-add">+{latest.additions}</dd></div><div><dt>Removed</dt><dd className="is-delete">−{latest.deletions}</dd></div></dl></div> : project.repositoryUrl ? <p>{activity?.error?.message || "No commit history found yet."}</p> : <p>See your latest commit, changed files, and jump straight back to the diff without leaving the project context.</p>}
  </section>;
}

function ProjectCommand({ project, nextMoves, onEdit, onAddTask, onOpenTasks, onOpenMeeting }) {
  return (
    <section className="cp-command">
      <div className="cp-next-three">
        <header><span><small>START HERE</small><strong>Your next three moves</strong></span><button type="button" onClick={onAddTask}><Plus size={13} /> Add linked task</button></header>
        <div>{nextMoves.map((move, index) => <article className={`is-${move.kind}`} key={move.id}><b>0{index + 1}</b><span><strong dir="auto">{move.title}</strong><small>{move.reason}</small></span>{move.kind === "meeting" ? <button type="button" onClick={() => onOpenMeeting(move.meetingId)}>Open meeting <ArrowRight size={12} /></button> : move.kind === "task" ? <button type="button" onClick={onOpenTasks}>Open work <ArrowRight size={12} /></button> : <button type="button" onClick={() => onEdit(move.setupField)}>Set it now <ArrowRight size={12} /></button>}</article>)}</div>
      </div>
      <div className="cp-command-context">
        <article className="cp-command-goal"><small><Target size={13} /> NORTH STAR</small><strong dir="auto">{project.goal || "No goal set yet."}</strong><p dir="auto">{project.definitionOfDone || "Define what must be true before this project can be called finished."}</p></article>
        <article className="cp-command-milestone"><small><Flag size={13} /> CURRENT MILESTONE</small><strong dir="auto">{project.milestone || "No milestone chosen."}</strong><p>{project.milestoneDueOn ? `Checkpoint · ${projectDate(project.milestoneDueOn)}` : "Give the team one visible checkpoint."}</p></article>
        <dl>
          <div><dt><UserRound size={13} /> Owner</dt><dd>{project.ownerName || "Unassigned"}</dd></div>
          <div><dt><CalendarDays size={13} /> Deadline</dt><dd>{projectDate(project.dueOn)}</dd></div>
          <div><dt><CircleAlert size={13} /> Status</dt><dd>{STATUS_LABELS[project.status] || STATUS_LABELS.active}</dd></div>
        </dl>
      </div>
    </section>
  );
}

function ProjectDialog({ company, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = await workspaceRequest("/api/workspaces/projects", {
        method: "POST",
        body: JSON.stringify({ companyId: company.id, companyName: company.name, companyWebsite: company.url, name, summary })
      });
      onCreated(body.project);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cp-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="cp-dialog" role="dialog" aria-modal="true" aria-label={`New project for ${company.name}`}>
        <header><span><small>NEW PROJECT</small><strong>{company.name}</strong></span><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <form onSubmit={submit}>
          <label>Project name<input autoFocus required maxLength={180} value={name} onChange={(event) => setName(event.target.value)} placeholder="Website redesign" /></label>
          <label>What is this project for?<textarea rows="4" maxLength={2000} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="The outcome, scope, or promise everyone should remember." /></label>
          {error ? <p role="alert">{error}</p> : null}
          <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="is-primary" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Plus size={14} />} Create project</button></footer>
        </form>
      </aside>
    </div>
  );
}

function EmptyColumn({ icon: Icon, title, copy }) {
  return <div className="cp-empty"><Icon size={18} /><strong>{title}</strong><p>{copy}</p></div>;
}

export function CompanyProjects({ snapshot, roomObjects, members = [], canDelete = false, onOpenAgent, onOpenSite, initialTab = "", onTabChange, liveTick = 0, initialCompanyId = "", initialProjectId = "", initialSheetId = "", onAddTask, onOpenTasks, onOpenMeeting, onOpenMoney, onPinReference, onOpenRoomItem, onOpenPaperwork }) {
  const [data, setData] = useState({ status: "loading", stored: { companies: [], projects: [], sheets: [] }, tasks: [], taskTotal: 0, tasksTruncated: false, memories: [], error: "" });
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompanyId);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || "all");
  const [selectedSheetId, setSelectedSheetId] = useState(initialSheetId);
  const pageRef = useRef(null);
  useEffect(() => { pageRef.current?.scrollTo({ top: 0, left: 0 }); }, [selectedCompanyId, selectedProjectId, selectedSheetId]);
  const [sheetDialogProjectId, setSheetDialogProjectId] = useState("");
  const [sheetLang, setSheetLang] = useState(() => readSheetLanguage());
  const [sheetDialogTemplateId, setSheetDialogTemplateId] = useState("");
  const [detailsDialog, setDetailsDialog] = useState(null);
  const [dialog, setDialog] = useState("");
  const [copied, setCopied] = useState("");
  const [writableProject, setWritableProject] = useState(null);
  const [projectFocusField, setProjectFocusField] = useState("goal");
  const [projectSection, setProjectSection] = useState("overview");
  const [githubActivity, setGithubActivity] = useState({});
  const [githubLoading, setGithubLoading] = useState(new Set());
  const [expanded, setExpanded] = useState({});
  const [copyFallback, setCopyFallback] = useState("");
  const isOpen = (panel) => Boolean(expanded[panel]);
  const toggle = (panel) => setExpanded((current) => ({ ...current, [panel]: !current[panel] }));

  const load = useCallback(async () => {
    setData((current) => (current.status === "ready" ? current : { ...current, status: "loading", error: "" }));
    try {
      const [stored, taskBody, memoryBody] = await Promise.all([
        workspaceRequest("/api/workspaces"),
        // Done tasks are capped to the recent past by the server; ask for enough
        // of the board that a single company's history is honest.
        workspaceRequest(`/api/tasks?includeDone=true&limit=${TASK_LIMIT}`),
        workspaceRequest("/api/client-memory")
      ]);
      setData({
        status: "ready",
        stored,
        tasks: taskBody.tasks || [],
        taskTotal: Number(taskBody.total) || (taskBody.tasks || []).length,
        tasksTruncated: Boolean(taskBody.truncated),
        memories: memoryBody.memories || [],
        error: ""
      });
    } catch (caught) {
      setData((current) => ({ ...current, status: "error", error: caught.message }));
    }
  }, []);

  useEffect(() => { void load(); }, [load, liveTick]);
  const companies = useMemo(() => buildWorkspaceModel({
    dossiers: snapshot.dossiers || [],
    stored: data.stored,
    tasks: data.tasks,
    memories: data.memories,
    roomObjects
  }), [data.memories, data.stored, data.tasks, roomObjects, snapshot.dossiers]);
  /* No company chosen is the Clients board, not "the first company". */
  useEffect(() => {
    if (data.status !== "ready") return;
    if (selectedCompanyId && !companies.some((candidate) => candidate.id === selectedCompanyId)) setSelectedCompanyId("");
  }, [companies, data.status, selectedCompanyId]);
  useEffect(() => {
    if (data.status !== "ready") return;
    const url = new URL(window.location.href);
    url.searchParams.set("place", "workspaces");
    if (!selectedCompanyId) {
      for (const key of ["company", "project", "sheet", "tab"]) url.searchParams.delete(key);
    } else {
      url.searchParams.set("company", selectedCompanyId);
      if (selectedProjectId === "all") url.searchParams.delete("project");
      else url.searchParams.set("project", selectedProjectId);
      if (selectedSheetId) url.searchParams.set("sheet", selectedSheetId);
      else url.searchParams.delete("sheet");
    }
    window.history.replaceState(null, "", url);
  }, [data.status, selectedCompanyId, selectedProjectId, selectedSheetId]);
  const company = selectedCompanyId ? companies.find((item) => item.id === selectedCompanyId) || null : null;
  const project = selectedProjectId === "all" ? null : company?.projects.find((item) => item.id === selectedProjectId) || null;
  const sheet = selectedSheetId ? (company?.sheets || []).find((item) => item.id === selectedSheetId) || null : null;
  const sheetProject = sheet?.projectId ? company?.projects.find((item) => item.id === sheet.projectId) || null : null;
  useEffect(() => {
    if (data.status === "ready" && company && selectedProjectId !== "all" && !project) setSelectedProjectId("all");
  }, [company, data.status, project, selectedProjectId]);
  useEffect(() => {
    // A sheet opened from a link may belong to a different company than the one selected.
    if (data.status !== "ready" || !selectedSheetId || sheet) return;
    const owner = companies.find((item) => item.sheets.some((candidate) => candidate.id === selectedSheetId));
    if (owner && owner.id !== selectedCompanyId) setSelectedCompanyId(owner.id);
    else if (!owner) setSelectedSheetId("");
  }, [companies, data.status, selectedCompanyId, selectedSheetId, sheet]);
  const tasks = project ? project.tasks : company?.tasks || [];
  const meetings = project ? project.meetings : company?.meetings || [];
  const mention = company ? workspaceMention(company, project) : "";
  const nextMoves = useMemo(() => projectNextMoves(project), [project]);
  const githubProjectKey = useMemo(() => (company?.projects || []).filter((item) => item.repositoryUrl).map((item) => `${item.id}:${item.repositoryUrl}:${item.repositoryBranch || ""}`).join("|"), [company]);
  const loadGitHubActivity = useCallback(async (item) => {
    if (!item?.id || !item.repositoryUrl) return;
    setGithubLoading((current) => new Set(current).add(item.id));
    try {
      const body = await workspaceRequest(`/api/workspaces/projects/${item.id}/github`);
      setGithubActivity((current) => ({ ...current, [item.id]: body }));
    } catch (caught) {
      setGithubActivity((current) => ({ ...current, [item.id]: { connected: true, available: false, error: { message: caught.message }, commits: [], latest: null } }));
    } finally {
      setGithubLoading((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }, []);
  useEffect(() => {
    for (const item of company?.projects || []) if (item.repositoryUrl) void loadGitHubActivity(item);
  }, [company, githubProjectKey, loadGitHubActivity]);

  /* Over plain http on the LAN — the phone in the meeting — there is no
     clipboard at all, and reporting "Copied" for nothing is worse than saying
     it failed. Hand the text over to be selected instead. */
  async function copyMention() {
    if (!mention) return;
    try {
      if (typeof navigator.clipboard?.writeText !== "function") throw new Error("no clipboard");
      await navigator.clipboard.writeText(mention);
      setCopied(mention);
      window.setTimeout(() => setCopied(""), 1300);
    } catch {
      setCopyFallback(mention);
    }
  }

  function chooseCompany(id) {
    setSelectedCompanyId(id);
    setSelectedProjectId("all");
    setProjectSection("overview");
  }

  function chooseProject(id, section = "overview") {
    setSelectedProjectId(id);
    setProjectSection(section);
  }

  async function materializeProject() {
    if (!project?.derived) return project;
    const body = await workspaceRequest("/api/workspaces/projects", {
      method: "POST",
      body: JSON.stringify({
        companyId: company.id,
        companyName: company.name,
        companyWebsite: company.url,
        name: project.name,
        summary: project.summary,
        goal: project.goal,
        definitionOfDone: project.definitionOfDone,
        ownerId: project.ownerId,
        ownerName: project.ownerName,
        dueOn: project.dueOn,
        health: project.health,
        milestone: project.milestone,
        milestoneDueOn: project.milestoneDueOn,
        repositoryUrl: project.repositoryUrl,
        repositoryBranch: project.repositoryBranch
      })
    });
    setSelectedProjectId(body.project.id);
    await load();
    return body.project;
  }

  async function openProjectTool(kind) {
    try {
      const ready = await materializeProject();
      if (!ready) return;
      setWritableProject(ready);
      setDialog(kind);
    } catch (caught) {
      setData((current) => ({ ...current, error: caught.message }));
    }
  }

  async function openGitHubSettings() {
    try {
      const ready = await materializeProject();
      if (!ready) return;
      setWritableProject(ready);
      setDialog("github");
    } catch (caught) {
      setData((current) => ({ ...current, error: caught.message }));
    }
  }

  function replaceCompany(saved) {
    setData((current) => {
      const list = current.stored.companies || [];
      const next = list.some((item) => item.id === saved.id) ? list.map((item) => (item.id === saved.id ? saved : item)) : [...list, saved];
      return { ...current, stored: { ...current.stored, companies: next } };
    });
  }

  /* Throws on purpose: the stage dialog has to keep the form open and show the
     message rather than closing over a change that did not happen. */
  async function saveCompany(updates) {
    if (!company) return;
    const saved = await patchCompany(company, updates);
    replaceCompany(saved);
    if (saved.id !== company.id) setSelectedCompanyId(saved.id);
    void load();
  }

  function forgetCompany(removed) {
    setData((current) => ({ ...current, stored: { ...current.stored, companies: (current.stored.companies || []).filter((item) => item.id !== removed.id && item.id !== removed.storedId) } }));
    setDetailsDialog(null);
    setSelectedCompanyId("");
    setSelectedProjectId("all");
    setSelectedSheetId("");
    void load();
  }

  function chooseSheet(id) {
    setSelectedSheetId(id);
  }

  function closeSheet() {
    const current = sheet;
    setSelectedSheetId("");
    if (current?.projectId && company?.projects.some((item) => item.id === current.projectId)) {
      setSelectedProjectId(current.projectId);
      setProjectSection("sheets");
    }
  }

  async function openSheetDialog(forProject = null, templateId = "") {
    try {
      setSheetDialogTemplateId(templateId);
      let projectId = "";
      if (forProject) {
        const ready = forProject.derived ? await materializeProject() : forProject;
        if (!ready) return;
        projectId = ready.id;
      }
      setSheetDialogProjectId(projectId);
      setDialog("sheet");
    } catch (caught) {
      setData((current) => ({ ...current, error: caught.message }));
    }
  }

  function replaceSheet(saved) {
    setData((current) => {
      const sheets = current.stored.sheets || [];
      const next = sheets.some((item) => item.id === saved.id) ? sheets.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...sheets];
      return { ...current, stored: { ...current.stored, sheets: next } };
    });
  }

  function forgetSheet(removed) {
    setData((current) => ({ ...current, stored: { ...current.stored, sheets: (current.stored.sheets || []).filter((item) => item.id !== removed.id) } }));
    setSelectedSheetId("");
    if (removed.projectId) { setSelectedProjectId(removed.projectId); setProjectSection("sheets"); }
    void load();
  }

  async function removeProjectItem(kind, id) {
    if (!window.confirm(`Remove this ${kind}?`)) return;
    try {
      await workspaceRequest(`/api/workspaces/${kind}s/${id}`, { method: "DELETE" });
      await load();
    } catch (caught) {
      setData((current) => ({ ...current, error: caught.message }));
    }
  }

  const leads = useMemo(() => (snapshot.topLeads || []).map((lead) => ({ ...lead, known: companies.some((candidate) => candidate.id === lead.id) })), [companies, snapshot.topLeads]);

  return (
    <main className="court cp-page cw-page" ref={pageRef}>
      <div className="cp-shell">
        <div className={`cp-layout ${project || sheet ? "is-project-open" : "is-solo"}`}>
          {!company && !project && !sheet ? <ClientsBoard
            status={data.status}
            error={data.error}
            companies={companies}
            leads={leads}
            showMoney={canDelete}
            onOpen={chooseCompany}
            onNew={() => setDetailsDialog({ mode: "new", focusField: "name" })}
            onRetry={() => void load()}
            onAsk={onOpenAgent}
          /> : null}

          {company && sheet ? <SheetStage
            key={sheet.id}
            company={company}
            project={sheetProject}
            sheet={sheet}
            projects={company.projects}
            members={members}
            canDelete={canDelete}
            lang={sheetLang}
            onLang={(next) => { setSheetLang(next); rememberSheetLanguage(next); }}
            onBack={closeSheet}
            onOpenProject={(id) => { setSelectedSheetId(""); chooseProject(id, "sheets"); }}
            onChanged={replaceSheet}
            onDeleted={forgetSheet}
          /> : null}

          {company && !project && !sheet ? <CompanyWorkspace
            company={company}
            canSeeMoney={canDelete}
            sheetLang={sheetLang}
            members={members}
            copied={copied === mention}
            initialTab={initialTab || "overview"}
            onTabChange={onTabChange}
            onBack={() => { setSelectedCompanyId(""); setSelectedProjectId("all"); }}
            onEdit={(field) => setDetailsDialog({ mode: "edit", focusField: field || "name" })}
            onSave={(updates) => saveCompany(updates)}
            onCopyMention={() => void copyMention()}
            onOpenProject={chooseProject}
            onNewProject={() => setDialog("project")}
            onOpenSheet={chooseSheet}
            onNewSheet={(templateId) => void openSheetDialog(null, templateId)}
            onOpenTasks={(context) => onOpenTasks(context || { company, project: null })}
            onAddTask={() => onAddTask(company, null)}
            onOpenMeeting={onOpenMeeting}
            onOpenPaperwork={onOpenPaperwork ? (target, docId) => onOpenPaperwork(target || company, docId) : undefined}
            onOpenMoney={onOpenMoney ? () => onOpenMoney(company) : undefined}
            onAsk={onOpenAgent}
            onOpenSite={onOpenSite}
            onChanged={() => void load()}
          /> : null}

          {company && project && !sheet ? <section className="cp-project-stage">
            <nav className="cp-project-breadcrumb" aria-label="Project breadcrumb"><button type="button" onClick={() => chooseProject("all")}><ArrowLeft size={14} /> {company.name}</button><ChevronRight size={13} /><span dir="auto">{project.name}</span></nav>
            <header className="cp-project-hero">
              <span className="cp-company-mark">{company.name.slice(0, 2).toUpperCase()}</span>
              <span><small>PROJECT COMMAND</small><h1 dir="auto">{project.name}</h1><p dir="auto">{project.summary || `Everything connected to ${project.name}, without the noise.`}</p></span>
              <dl><div><dt>Health</dt><dd className={`is-${project.health || "on_track"}`}>{HEALTH_LABELS[project.health] || "On track"}</dd></div><div><dt>Owner</dt><dd>{project.ownerName || "Unassigned"}</dd></div><div><dt>Deadline</dt><dd>{projectDate(project.dueOn)}</dd></div></dl>
              <div className="cp-project-actions"><button type="button" className="is-primary" onClick={() => onAddTask(company, project)}><Plus size={15} /> Add task</button><button type="button" onClick={() => { setProjectFocusField("goal"); setDialog("project-settings"); }}><Pencil size={14} /> Edit direction</button><button type="button" aria-label="Copy project mention" onClick={() => void copyMention()}><Copy size={14} /></button></div>
            </header>
            <nav className="cp-project-sections" aria-label={`${project.name} sections`}>
              {[{ id: "overview", label: "Overview", icon: Target }, { id: "work", label: "Work", icon: ListTodo }, { id: "meetings", label: "Meetings", icon: Clapperboard }, { id: "decisions", label: "Decisions", icon: CheckCircle2 }, { id: "sheets", label: "Sheets", icon: ClipboardList }, { id: "github", label: "GitHub", icon: Github }, { id: "files", label: "Files", icon: Link2 }].map((item) => <button type="button" key={item.id} className={projectSection === item.id ? "is-active" : ""} aria-current={projectSection === item.id ? "page" : undefined} onClick={() => setProjectSection(item.id)}><item.icon size={15} /> {item.label}</button>)}
            </nav>
            <div className="cp-project-section">
              {projectSection === "overview" ? <><ProjectGitHubPulse project={project} activity={githubActivity[project.id]} loading={githubLoading.has(project.id)} onConnect={() => void openGitHubSettings()} onOpenCode={() => setProjectSection("github")} /><ProjectCommand project={project} nextMoves={nextMoves} onEdit={(field) => { setProjectFocusField(field || "goal"); setDialog("project-settings"); }} onAddTask={() => onAddTask(company, project)} onOpenTasks={() => onOpenTasks({ company, project })} onOpenMeeting={onOpenMeeting} /></> : null}
              {projectSection === "work" ? <section className="cp-panel cp-tasks">
                <header><span><ListTodo size={16} /><strong>Work</strong></span><span className="cp-panel-meta"><small>{tasks.filter((task) => task.status !== "done").length} open of {tasks.length}</small><button type="button" onClick={() => onOpenTasks({ company, project })}>Open the task board <ArrowRight size={13} /></button></span></header>
                <div>
                  {/* Open work first, overdue first within that: the old cap of
                      twelve over a list sorted only by date buried every open
                      task behind a dozen finished ones. */}
                  {(isOpen("work") ? tasks : tasks.slice(0, PANEL_PREVIEW)).map((task) => <article key={task.id} className={`is-${task.status}`}><span>{task.status === "done" ? <Check size={13} /> : <i />}</span><span><strong dir="auto">{task.title}</strong><small>{task.project || company.name}</small></span><em>{task.status === "done" ? "Done" : taskDue(task)}</em></article>)}
                  {!tasks.length ? <EmptyColumn icon={ListTodo} title="No linked work yet" copy="Add a task here and it will stay connected everywhere." /> : null}
                  <ShowAll total={tasks.length} shown={PANEL_PREVIEW} open={isOpen("work")} noun="tasks" onToggle={() => toggle("work")} />
                  {data.tasksTruncated ? <p className="cp-panel-note"><TriangleAlert size={12} /> The board holds more than the {data.taskTotal} tasks HQ loaded. Open the task board for the complete list.</p> : null}
                </div>
              </section> : null}
              {projectSection === "meetings" ? <section className="cp-panel cp-meetings"><header><span><Clapperboard size={16} /><strong>Film Room</strong></span><small>{meetings.length} saved</small></header><div>{(isOpen("meetings") ? meetings : meetings.slice(0, PANEL_PREVIEW)).map((meeting) => <button type="button" key={meeting.id} onClick={() => onOpenMeeting(meeting.id)}><span><strong dir="auto">{meeting.title}</strong><small dir="auto">{meeting.summary || "Meeting notes saved."}</small></span><time dateTime={meeting.createdAt}>{relativeTime(meeting.createdAt)}</time><ChevronRight size={13} /></button>)}{!meetings.length ? <EmptyColumn icon={Clapperboard} title="No meetings here" copy="Link the next Film Room session to this project." /> : null}<ShowAll total={meetings.length} shown={PANEL_PREVIEW} open={isOpen("meetings")} noun="meetings" onToggle={() => toggle("meetings")} /></div></section> : null}
              {projectSection === "decisions" ? <section className="cp-panel cp-decisions"><header><span><CheckCircle2 size={16} /><strong>Decision log</strong></span><button type="button" onClick={() => void openProjectTool("decision")}><Plus size={13} /> Record decision</button></header><div>{(isOpen("decisions") ? project.decisions : project.decisions.slice(0, PANEL_PREVIEW)).map((decision) => <article key={decision.id}><span><strong dir="auto">{decision.text}</strong><small>{decision.source === "film" ? `Film Room · ${decision.meetingTitle || "meeting"}` : `Recorded ${relativeTime(decision.createdAt)}`}</small></span>{decision.source === "film" ? <button type="button" onClick={() => onOpenMeeting(decision.sourceRef)} aria-label="Open source meeting"><Clapperboard size={13} /></button> : canDelete ? <button type="button" onClick={() => void removeProjectItem("decision", decision.id)} aria-label="Remove decision"><Trash2 size={13} /></button> : null}</article>)}{!project.decisions.length ? <EmptyColumn icon={CheckCircle2} title="No decisions recorded" copy="Film Room decisions appear automatically. Add manual calls here too." /> : null}<ShowAll total={project.decisions.length} shown={PANEL_PREVIEW} open={isOpen("decisions")} noun="decisions" onToggle={() => toggle("decisions")} /></div></section> : null}
              {projectSection === "sheets" ? <SheetsPanel sheets={project.sheets || []} lang={sheetLang} members={members} onOpen={chooseSheet} onNew={() => void openSheetDialog(project, "")} /> : null}
              {projectSection === "github" ? <GitHubPanel project={project} activity={githubActivity[project.id]} loading={githubLoading.has(project.id)} onConnect={() => void openGitHubSettings()} onRefresh={() => void loadGitHubActivity(project)} /> : null}
              {projectSection === "files" ? <section className="cp-panel cp-resources"><header><span><Link2 size={16} /><strong>Files & links</strong></span><button type="button" onClick={() => void openProjectTool("resource")}><Plus size={13} /> Add resource</button></header><div>{(isOpen("files") ? project.resources : project.resources.slice(0, PANEL_PREVIEW)).map((resource) => <article key={resource.id}><a href={resource.url} target="_blank" rel="noreferrer noopener"><span><strong dir="auto">{resource.label}</strong><small>{resource.kind}</small></span><ExternalLink size={13} /></a>{canDelete ? <button type="button" onClick={() => void removeProjectItem("resource", resource.id)} aria-label="Remove resource"><Trash2 size={13} /></button> : null}</article>)}{!project.resources.length ? <EmptyColumn icon={Link2} title="Nothing important linked" copy="Keep the design, shared folder, brief, and working documents one click away." /> : null}<ShowAll total={project.resources.length} shown={PANEL_PREVIEW} open={isOpen("files")} noun="links" onToggle={() => toggle("files")} /></div></section> : null}
            </div>
          </section> : null}

          {/* A workspace that could not be read is not a workspace with nothing
              in it. Saying "create your first company" over a failed fetch is
              the app lying about the state of the business. */}
        </div>
        {copyFallback ? <div className="cp-copy-fallback"><p><strong>This connection cannot reach the clipboard.</strong> Select the mention and copy it by hand.</p><input readOnly value={copyFallback} aria-label="Workspace mention" onFocus={(event) => event.target.select()} /><button type="button" onClick={() => setCopyFallback("")}><X size={13} /> Close</button></div> : null}
        {data.error && !(data.status === "error" && !company) ? <p className="cp-error" role="alert">{data.error}</p> : null}
      </div>
      {detailsDialog ? <CompanyDetailsDialog
        company={detailsDialog.mode === "edit" ? company : null}
        focusField={detailsDialog.focusField}
        onClose={() => setDetailsDialog(null)}
        onSaved={(saved) => { setDetailsDialog(null); replaceCompany(saved); setSelectedCompanyId(saved.id); void load(); }}
        onDeleted={canDelete ? forgetCompany : undefined}
        onOpenCompany={(id) => { setDetailsDialog(null); chooseCompany(id); void load(); }}
      /> : null}
      {dialog === "sheet" && company ? <NewSheetDialog company={company} projects={company.projects} initialProjectId={sheetDialogProjectId} initialTemplateId={sheetDialogTemplateId} onClose={() => setDialog("")} onCreated={(created) => { setDialog(""); replaceSheet(created); setSelectedSheetId(created.id); void load(); }} /> : null}
      {dialog === "project" && company ? <ProjectDialog company={company} onClose={() => setDialog("")} onCreated={(created) => { setDialog(""); setSelectedProjectId(created.id); void load(); }} /> : null}
      {dialog === "project-settings" && company && project ? <ProjectSettingsDialog company={company} project={project} members={members} focusField={projectFocusField} onClose={() => setDialog("")} onSaved={(saved) => { setDialog(""); setSelectedProjectId(saved.id); void load(); }} onDeleted={canDelete ? () => { setDialog(""); setSelectedProjectId("all"); void load(); } : undefined} /> : null}
      {dialog === "decision" && writableProject ? <DecisionDialog project={writableProject} onClose={() => setDialog("")} onSaved={() => { setDialog(""); void load(); }} /> : null}
      {dialog === "resource" && writableProject ? <ResourceDialog project={writableProject} onClose={() => setDialog("")} onSaved={() => { setDialog(""); void load(); }} /> : null}
      {dialog === "github" && writableProject ? <GitHubDialog project={writableProject} onClose={() => setDialog("")} onSaved={(saved) => { setDialog(""); setSelectedProjectId(saved.id); void load(); if (saved.repositoryUrl) void loadGitHubActivity(saved); else setGithubActivity((current) => { const next = { ...current }; delete next[saved.id]; return next; }); }} /> : null}
    </main>
  );
}
