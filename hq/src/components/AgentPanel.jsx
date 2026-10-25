import { requestForActor } from "../actor-request.js";
import { createActorStorage } from "../actor-storage.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, CircleAlert, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { Agent4Avatar } from "./Agent4Avatar.jsx";
import { localIsoDate } from "../format.js";

/* Talk to Agent4 from anywhere. It answers from your companies, tasks,
   meetings and calendar, and when it wants something changed it proposes the
   change as a card. Nothing is written until you press Apply. */

const STORAGE_KEY = "agent4-chat-v1";
const SUGGESTIONS = [
  "What should I do today?",
  "Who have I gone quiet on?",
  "What could make me money this week?",
  "Plan my week"
];

async function call(pathname, { method = "GET", body } = {}) {
  const response = await fetch(pathname, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(parsed?.error?.message || "That did not go through.");
  return parsed;
}

/* Each proposal maps onto a route the screens already use, so an approved
   change is indistinguishable from one made by hand. */
async function applyAction(action, actor, request) {
  const company = action.companyId ? `/api/workspaces/companies/${encodeURIComponent(action.companyId)}` : "";
  if (action.type === "create_task") {
    await request("/api/tasks", { method: "POST", body: { title: action.title, dueOn: action.dueOn || undefined, assigneeId: actor?.id, companyId: action.companyId || undefined, companyName: action.companyName || undefined } });
  } else if (action.type === "set_next_step") {
    await request(company, { method: "PATCH", body: { nextAction: action.text, nextActionOn: action.dueOn || null } });
  } else if (action.type === "add_note") {
    await request(`${company}/events`, { method: "POST", body: { type: "note", detail: action.text } });
  } else if (action.type === "move_stage") {
    await request(company, { method: "PATCH", body: { stage: action.stage } });
    await request(`${company}/events`, { method: "POST", body: { type: "stage", detail: `Moved to ${action.stage}` } }).catch(() => {});
  } else if (action.type === "set_deal") {
    await request(company, { method: "PATCH", body: { dealValue: action.dealValue, dealCurrency: action.dealCurrency } });
  } else {
    throw new Error("Agent4 suggested something this screen cannot do yet.");
  }
}

function ActionCard({ action, state, onApply, onSkip }) {
  return (
    <li className={`ap-action is-${state.status}`}>
      <span className="ap-action__body">
        <strong dir="auto">{action.label}</strong>
        {action.reason ? <small dir="auto">{action.reason}</small> : null}
        {state.status === "error" ? <small className="ap-action__error">{state.message}</small> : null}
      </span>
      {state.status === "done" ? <span className="ap-action__done"><Check size={14} /> Done</span> : null}
      {state.status === "skipped" ? <span className="ap-action__skipped">Skipped</span> : null}
      {state.status === "idle" || state.status === "error" ? (
        <span className="ap-action__buttons">
          <button type="button" className="btn btn--gold" onClick={onApply}><Plus size={13} /> Apply</button>
          <button type="button" className="btn btn--quiet" onClick={onSkip} aria-label="Skip this suggestion"><X size={14} /></button>
        </span>
      ) : null}
      {state.status === "busy" ? <LoaderCircle className="is-spinning" size={16} /> : null}
    </li>
  );
}

export function AgentPanel({ open, actor, place, onClose }) {
  const request = useRef(null);
  if (!request.current) request.current = requestForActor(actor?.id, call);
  const storage = useRef(null);
  if (!storage.current) storage.current = createActorStorage(STORAGE_KEY, actor?.id, () => window.sessionStorage);
  const readTranscript = () => { const saved = storage.current.read([]); return Array.isArray(saved) ? saved.slice(-30) : []; };
  const writeTranscript = turns => storage.current.write(turns.slice(-30));
  const [turns, setTurns] = useState(readTranscript);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const [status, setStatus] = useState({ state: "checking", model: "", message: "" });
  const [actionState, setActionState] = useState({});
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { writeTranscript(turns); }, [turns]);

  /* The model on your own server is not instant. Say so instead of looking stuck. */
  useEffect(() => {
    if (!busy) { setSlow(false); return undefined; }
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [busy]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    fetch("/api/agent4/status").then((response) => response.json()).then((body) => {
      if (active) setStatus({ state: body.ready ? "ready" : "down", model: body.model || "", message: body.message || "" });
    }).catch(() => { if (active) setStatus({ state: "down", model: "", message: "Agent4 could not be reached." }); });
    window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function close(event) { if (event.key === "Escape") onClose(); }
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, onClose]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [turns, busy, open]);

  const send = useCallback(async (text) => {
    const message = String(text ?? draft).trim();
    if (!message || busy) return;
    setDraft("");
    setError("");
    const history = turns.map((turn) => ({ role: turn.role, text: turn.text }));
    setTurns((current) => [...current, { id: `u-${Date.now()}`, role: "user", text: message }]);
    setBusy(true);
    /* Where you are is part of what you mean by "this client". */
    const params = new URLSearchParams(window.location.search);
    const viewing = place === "workspaces" && params.get("company") ? `(The owner is looking at the company with id ${params.get("company")}.) ` : "";
    try {
      const body = await request.current("/api/agent4/chat", { method: "POST", body: { message: `${viewing}${message}`, today: localIsoDate(), history } });
      setTurns((current) => [...current, { id: `a-${Date.now()}`, role: "agent", text: body.reply, actions: body.actions || [] }]);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }, [busy, draft, place, turns]);

  async function apply(turnId, index, action) {
    const key = `${turnId}:${index}`;
    setActionState((current) => ({ ...current, [key]: { status: "busy" } }));
    try {
      await applyAction(action, actor, request.current);
      setActionState((current) => ({ ...current, [key]: { status: "done" } }));
    } catch (caught) {
      setActionState((current) => ({ ...current, [key]: { status: "error", message: caught.message } }));
    }
  }

  function skip(turnId, index) {
    setActionState((current) => ({ ...current, [`${turnId}:${index}`]: { status: "skipped" } }));
  }

  async function applyAll(turn) {
    for (const [index, action] of (turn.actions || []).entries()) {
      const state = actionState[`${turn.id}:${index}`]?.status || "idle";
      if (state === "idle" || state === "error") await apply(turn.id, index, action);
    }
  }

  function clear() {
    setTurns([]);
    setActionState({});
    setError("");
    writeTranscript([]);
  }

  if (!open) return null;

  return (
    <aside className="ap" role="dialog" aria-label="Agent4" aria-modal="false">
      <header className="ap-head">
        <Agent4Avatar size="small" />
        <span className="ap-head__title"><strong>Agent4</strong><small className={`is-${status.state}`}>{status.state === "ready" ? `Online · ${status.model}` : status.state === "checking" ? "Checking…" : "Not connected"}</small></span>
        {turns.length ? <button type="button" className="ap-icon" onClick={clear} aria-label="Clear the conversation" title="Clear"><Trash2 size={15} /></button> : null}
        <button type="button" className="ap-icon" onClick={onClose} aria-label="Close Agent4"><X size={17} /></button>
      </header>

      {status.state === "down" ? (
        <p className="ap-offline" role="alert"><CircleAlert size={15} /> <span><strong>Agent4's model is not connected.</strong> {status.message || "It cannot answer until the server has an AI key or a running Ollama."}</span></p>
      ) : null}

      <div className="ap-thread" ref={listRef}>
        {!turns.length ? (
          <div className="ap-welcome">
            <h2>What do you need?</h2>
            <p>I know your clients, tasks, meetings and calendar. Ask me anything, or tell me what to organize and I will propose the changes for you to approve.</p>
            <div className="ap-chips">{SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => void send(suggestion)} disabled={status.state === "down"}>{suggestion}</button>)}</div>
          </div>
        ) : null}
        {turns.map((turn) => (
          <div className={`ap-turn is-${turn.role}`} key={turn.id}>
            <p dir="auto">{turn.text}</p>
            {turn.actions?.length ? (
              <>
                <ul className="ap-actions">
                  {turn.actions.map((action, index) => (
                    <ActionCard key={index} action={action} state={actionState[`${turn.id}:${index}`] || { status: "idle" }} onApply={() => void apply(turn.id, index, action)} onSkip={() => skip(turn.id, index)} />
                  ))}
                </ul>
                {turn.actions.length > 1 ? <button type="button" className="ap-all" onClick={() => void applyAll(turn)}>Apply all {turn.actions.length}</button> : null}
              </>
            ) : null}
          </div>
        ))}
        {busy ? <div className="ap-turn is-agent is-thinking"><LoaderCircle className="is-spinning" size={14} /> {slow ? "Still thinking. The model on your server can take a minute." : "Thinking…"}</div> : null}
        {error ? <p className="ap-error" role="alert">{error}</p> : null}
      </div>

      <form className="ap-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          placeholder={status.state === "down" ? "Agent4 is offline" : "Ask, or tell me what to do…"}
          aria-label="Message Agent4"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
        />
        <button type="submit" className="ap-send" disabled={busy || !draft.trim()} aria-label="Send"><ArrowUp size={17} /></button>
      </form>
    </aside>
  );
}
