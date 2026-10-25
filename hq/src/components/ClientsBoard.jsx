import React, { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, CircleAlert, Plus, Search, Target, Users } from "lucide-react";
import { BOARD_STAGES, PARKED_STAGES, daysQuiet, effectiveStage, formatDeal, onBoard, sumDeals, totalsLabel } from "../deals.js";
import { STAGE_LABELS } from "../workspace-model.js";
import { dueLabel, isOverdue, localIsoDate } from "../format.js";
import { LoadError, SkeletonRows } from "./HomeStates.jsx";

/* The whole business on one screen: every relationship in the order it becomes
   money, what each one is worth, and which ones have gone quiet. A lead the
   pipeline found sits in the inbox above the board until you decide it is
   worth your time. */

const QUIET_AFTER_DAYS = 14;
const COLUMN_HINTS = {
  lead: "Not spoken yet",
  talking: "Conversation open",
  proposal: "Waiting on their answer",
  active: "Paid, being built",
  operating: "On retainer"
};

function Card({ company, today, showMoney, onOpen }) {
  const quiet = daysQuiet(company);
  const next = company.next;
  const late = Boolean(next?.dueOn && isOverdue(next.dueOn, today));
  const stale = quiet != null && quiet >= QUIET_AFTER_DAYS && ["lead", "talking", "proposal"].includes(effectiveStage(company));
  return (
    <button type="button" className={`cb-card${stale || late ? " is-hot" : ""}`} onClick={() => onOpen(company.id)}>
      <span className="cb-card__top">
        <strong dir="auto">{company.name}</strong>
        {showMoney && company.dealValue ? <b>{formatDeal(company.dealValue, company.dealCurrency)}</b> : null}
      </span>
      <span className={`cb-card__next${!next ? " is-empty" : ""}${next?.borrowed ? " is-borrowed" : ""}${late ? " is-late" : ""}`} dir="auto">
        {next ? next.title : "No next step"}
      </span>
      <span className="cb-card__foot">
        {company.kind === "prospect" ? <em>Prospect</em> : null}
        {next?.dueOn ? <span className={late ? "is-late" : ""}>{dueLabel(next.dueOn, { today })}</span> : null}
        {quiet != null && quiet >= 7 ? <span className={stale ? "is-stale" : ""}>{quiet}d quiet</span> : null}
      </span>
    </button>
  );
}

function Stat({ label, value, tone = "", sub = "" }) {
  return (
    <div className={`cb-stat${tone ? ` is-${tone}` : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {sub ? <span>{sub}</span> : null}
    </div>
  );
}

export function ClientsBoard({ status, error, companies, leads, showMoney, onOpen, onNew, onRetry, onAsk }) {
  const [query, setQuery] = useState("");
  const [parkedOpen, setParkedOpen] = useState(false);
  const today = localIsoDate();

  const board = useMemo(() => companies.filter(onBoard), [companies]);
  const wanted = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => (wanted ? board.filter((company) => company.name.toLocaleLowerCase().includes(wanted)) : board), [board, wanted]);
  const byStage = useMemo(() => {
    const groups = new Map([...BOARD_STAGES, ...PARKED_STAGES].map((stage) => [stage, []]));
    for (const company of visible) (groups.get(effectiveStage(company)) || groups.get("lead")).push(company);
    return groups;
  }, [visible]);

  const openPipeline = totalsLabel(sumDeals(board, ["lead", "talking", "proposal"]));
  const inDelivery = totalsLabel(sumDeals(board, ["active", "operating"]));
  const needAttention = board.filter((company) => {
    const stage = effectiveStage(company);
    if (!BOARD_STAGES.includes(stage)) return false;
    const quiet = daysQuiet(company);
    return !company.next || company.next.borrowed || (company.next.dueOn && isOverdue(company.next.dueOn, today)) || (quiet != null && quiet >= QUIET_AFTER_DAYS && ["lead", "talking", "proposal"].includes(stage));
  }).length;
  const parked = PARKED_STAGES.flatMap((stage) => byStage.get(stage));

  return (
    <section className="cb">
      <header className="cb-head">
        <div>
          <h1>Clients</h1>
          <p>Every relationship, in the order it turns into money.</p>
        </div>
        <label className="cb-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a client" aria-label="Find a client" />
        </label>
        <button type="button" className="btn btn--gold btn--lg" onClick={onNew}><Plus size={16} /> New client</button>
      </header>

      {status === "error" && !companies.length ? <LoadError title="The clients could not be loaded." detail={error} onRetry={onRetry} /> : null}
      {status === "loading" && !companies.length ? <SkeletonRows rows={4} height={72} label="Loading clients" /> : null}

      {(status === "ready" || companies.length) ? (
        <>
          <div className="cb-stats">
            {showMoney ? <Stat label="In the pipeline" value={openPipeline || "—"} sub={openPipeline ? "Lead, talking, proposal" : "Set a value on a deal"} /> : null}
            {showMoney ? <Stat label="In delivery" value={inDelivery || "—"} sub={inDelivery ? "Active and retainers" : "Nothing valued yet"} /> : null}
            <Stat label="Need attention" value={needAttention} tone={needAttention ? "warn" : "ok"} sub={needAttention ? "No next step, late, or quiet" : "Everyone has a next step"} />
            <Stat label="Clients" value={board.length} sub={leads.length ? `${leads.length} new ${leads.length === 1 ? "lead" : "leads"} to review` : "No new leads"} />
          </div>

          {leads.length ? (
            <details className="cb-leads">
              <summary>
                <Target size={16} aria-hidden="true" />
                <span><strong>{leads.length} new {leads.length === 1 ? "lead" : "leads"} found for you</strong><small>Companies the radar thinks are worth a conversation</small></span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <ul>
                {leads.slice(0, 8).map((lead) => (
                  <li key={lead.id || lead.domain}>
                    <button type="button" disabled={!lead.known} onClick={() => onOpen(lead.id)}>
                      <i>{lead.score || 0}</i>
                      <span><strong dir="auto">{lead.name}</strong><small dir="auto">{lead.topGap || lead.domain}</small></span>
                      {lead.known ? <ArrowRight size={15} /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {!board.length ? (
            <div className="cb-empty">
              <Users size={28} aria-hidden="true" />
              <h2>No clients yet</h2>
              <p>Add the first one, or ask Agent4 who to go after. Everything you learn about them lives on their page.</p>
              <div>
                <button type="button" className="btn btn--gold btn--lg" onClick={onNew}><Plus size={16} /> New client</button>
                <button type="button" className="btn btn--lg" onClick={onAsk}>Ask Agent4</button>
              </div>
            </div>
          ) : (
            <div className="cb-board" role="list">
              {BOARD_STAGES.map((stage) => {
                const list = byStage.get(stage);
                const total = totalsLabel(sumDeals(list, [stage]));
                return (
                  <section className={`cb-col is-${stage}`} key={stage} role="listitem" aria-label={STAGE_LABELS[stage]}>
                    <header>
                      <span><strong>{STAGE_LABELS[stage]}</strong><small>{COLUMN_HINTS[stage]}</small></span>
                      <b>{list.length}</b>
                      {showMoney && total ? <em>{total}</em> : null}
                    </header>
                    <div>
                      {list.map((company) => <Card key={company.id} company={company} today={today} showMoney={showMoney} onOpen={onOpen} />)}
                      {!list.length ? <p>{wanted ? "No match" : "Nothing here"}</p> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {parked.length ? (
            <section className="cb-parked">
              <button type="button" onClick={() => setParkedOpen((open) => !open)} aria-expanded={parkedOpen}>
                <span>Parked <b>{parked.length}</b></span>
                <small>Dormant and lost</small>
                <ChevronDown size={17} aria-hidden="true" />
              </button>
              {parkedOpen ? (
                <div>
                  {parked.map((company) => (
                    <button type="button" key={company.id} onClick={() => onOpen(company.id)}>
                      <strong dir="auto">{company.name}</strong>
                      <small>{STAGE_LABELS[effectiveStage(company)]}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
          {status === "error" ? <p className="cb-warning" role="alert"><CircleAlert size={14} /> The last refresh failed, so this may be out of date. <button type="button" onClick={onRetry}>Try again</button></p> : null}
        </>
      ) : null}
    </section>
  );
}
