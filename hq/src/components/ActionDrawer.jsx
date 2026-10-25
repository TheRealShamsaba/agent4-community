import React, { useEffect, useState } from "react";
import { IntentBadge } from "./IntentBadge.jsx";
import { addDays, daysLabel, formatDate, localIsoDate, relativeTime } from "../format.js";

const STAGE_LABELS = {
  pursued: "Pursued",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost"
};

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based copy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function CopyAction({ label, value, primary = false }) {
  const [state, setState] = useState("idle");
  async function copy() {
    const ok = await copyText(value);
    setState(ok ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 1300);
  }
  return (
    <button type="button" className={primary ? "drawer-action drawer-action--primary" : "drawer-action"} onClick={copy}>
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

function buildNoteTemplate(dossier) {
  return `note ${dossier.name} `;
}

/* This was a CopyAction that put "task Follow up with X tomorrow" on the
   clipboard and called itself an action, with "tomorrow" hardcoded into the
   string. POST /api/tasks has been there the whole time, so it creates the
   task — assigned to whoever is signed in, because an unassigned task drops
   out of the daily plan and out of every "my work" view. */
function FollowUpAction({ dossier, actorId }) {
  const [state, setState] = useState("idle");
  const [problem, setProblem] = useState("");
  const dueOn = addDays(localIsoDate(), 1);

  async function create() {
    setState("busy");
    setProblem("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `Follow up with ${dossier.name}`,
          dueOn,
          priority: "normal",
          status: "open",
          assigneeId: actorId || "",
          companyId: dossier.id || null,
          companyName: dossier.name || ""
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || "The task service refused that.");
      setState("done");
    } catch (failure) {
      setState("failed");
      setProblem(failure.message);
    }
  }

  return (
    <>
      <button type="button" className="drawer-action" onClick={create} disabled={state === "busy" || state === "done"}>
        {state === "busy" ? "Adding…" : state === "done" ? `Follow-up due ${formatDate(dueOn, { style: "day" })}` : "Add follow-up task"}
      </button>
      {state === "failed" ? <span className="badge badge--critical">{problem}</span> : null}
    </>
  );
}

export function ActionDrawer({ dossier, onClose, onOpenWorkspace }) {
  const [clientMemory, setClientMemory] = useState(null);
  const [actorId, setActorId] = useState("");
  const dossierId = dossier?.id || "";

  /* A task created here has to belong to somebody, and the drawer is not given
     the actor, so it asks. */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("No session")))
      .then((body) => { if (!cancelled) setActorId(body?.actor?.id || ""); })
      .catch(() => { if (!cancelled) setActorId(""); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!dossierId) {
      setClientMemory(null);
      return undefined;
    }
    setClientMemory(null);
    fetch("/api/client-memory")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Client memory unavailable")))
      .then((body) => {
        if (!cancelled) setClientMemory((body.memories || []).find((memory) => memory.clientId === dossierId) || null);
      })
      .catch(() => {
        if (!cancelled) setClientMemory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dossierId]);

  if (!dossier) return null;
  const packCommand = `/pack ${dossier.name}`;
  const contactedCommand = `outcome ${dossier.name} contacted`;
  const primaryCopy = dossier.openingFa
    ? { label: "Copy opening", value: dossier.openingFa }
    : { label: "Copy /pack", value: packCommand };
  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="action-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Actions for ${dossier.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <span className="drawer-kicker">Work this lead</span>
            <h3 dir="auto">{dossier.name}</h3>
            <div className="drawer-meta">
              <a href={dossier.url} target="_blank" rel="noreferrer noopener">{dossier.domain}</a>
              {dossier.stage ? <span>{STAGE_LABELS[dossier.stage] ?? dossier.stage}</span> : null}
              <IntentBadge intent={dossier.intent} />
            </div>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">Close</button>
        </header>

        <section className="drawer-score">
          <strong>{dossier.score}</strong>
          <span>opportunity score</span>
          {dossier.daysSinceActivity != null ? (
            <span>last activity {dossier.daysSinceActivity === 0 ? "today" : `${daysLabel(dossier.daysSinceActivity)} ago`}</span>
          ) : null}
        </section>

        <section className="drawer-actions">
          {onOpenWorkspace ? <button type="button" className="drawer-action drawer-action--primary" onClick={() => onOpenWorkspace(dossier.id)}>Open company workspace</button> : null}
          <CopyAction label={primaryCopy.label} value={primaryCopy.value} primary={!onOpenWorkspace} />
          {dossier.openingFa ? <CopyAction label="Copy /pack" value={packCommand} /> : null}
          <CopyAction label="Copy “mark contacted”" value={contactedCommand} />
          <CopyAction label="Copy note command" value={buildNoteTemplate(dossier)} />
          <FollowUpAction dossier={dossier} actorId={actorId} />
        </section>

        {(dossier.offer || dossier.nextStep) && (
          <section className="drawer-section">
            <h4>Angle</h4>
            {dossier.offer ? <p dir="auto">{dossier.offer}</p> : null}
            {dossier.nextStep ? <p dir="auto">Next: {dossier.nextStep}</p> : null}
          </section>
        )}

        {dossier.findings?.length > 0 && (
          <section className="drawer-section">
            <h4>Why it matters</h4>
            <ul>
              {dossier.findings.slice(0, 4).map((finding, index) => (
                <li key={index} dir="auto">{finding}</li>
              ))}
            </ul>
          </section>
        )}

        {dossier.openingFa ? (
          <section className="drawer-section">
            <h4>Opening</h4>
            <p className="drawer-opening" dir="rtl" lang="fa">{dossier.openingFa}</p>
          </section>
        ) : null}

        {clientMemory ? (
          <section className="drawer-section drawer-client-memory">
            <div className="drawer-memory-title">
              <h4>Client memory</h4>
              <span>{clientMemory.meetings.length} {clientMemory.meetings.length === 1 ? "meeting" : "meetings"}</span>
            </div>
            {clientMemory.nextFollowUpOn ? (
              <p className="drawer-memory-followup">
                Next follow-up <strong>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${clientMemory.nextFollowUpOn}T12:00:00`))}</strong>
              </p>
            ) : null}
            <ul className="drawer-meeting-timeline">
              {clientMemory.meetings.slice(0, 4).map((meeting) => (
                <li key={meeting.id}>
                  <time dateTime={meeting.createdAt}>{relativeTime(meeting.createdAt)}</time>
                  <div>
                    <strong dir="auto">{meeting.title}</strong>
                    {meeting.projectName ? <span dir="auto">{meeting.projectName}</span> : null}
                    <p dir="auto">{meeting.summary || "Meeting notes saved."}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {dossier.timeline?.length > 0 ? (
          <section className="drawer-section">
            <h4>Recent history</h4>
            <ul className="drawer-timeline">
              {dossier.timeline.slice(0, 5).map((item, index) => (
                <li key={index}>
                  <span>{relativeTime(item.at)}</span>
                  <p dir="auto">{item.type === "note" ? item.detail : item.type === "decision" ? `marked ${item.detail}` : item.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
