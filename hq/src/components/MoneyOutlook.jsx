import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, CircleAlert, Hourglass, Target } from "lucide-react";
import { dueLabel, exactAmount, isOverdue, localIsoDate } from "../format.js";
import { effectiveStage, formatDealExact, onBoard } from "../deals.js";
import { buildWorkspaceModel } from "../workspace-model.js";

/* The two questions money exists to answer: who owes me, and what is on its
   way. The ledger and the charts below answer what already happened. */

const PIPELINE_STAGES = [
  { id: "proposal", label: "Proposal sent", hint: "Waiting on their answer" },
  { id: "talking", label: "Talking", hint: "Conversation open" },
  { id: "lead", label: "Lead", hint: "Not spoken yet" }
];

function totalLine(totals) {
  return [...totals].map(([currency, total]) => exactAmount(total, { currency })).join(" · ");
}

export function MoneyOutlook({ pending, onOpenCompany, onOpenInvoices }) {
  const [deals, setDeals] = useState({ status: "loading", companies: [] });
  const today = localIsoDate();

  useEffect(() => {
    let live = true;
    fetch("/api/workspaces").then((response) => (response.ok ? response.json() : Promise.reject(new Error("The clients could not be read.")))).then((stored) => {
      if (live) setDeals({ status: "ready", companies: buildWorkspaceModel({ stored }) });
    }).catch(() => { if (live) setDeals({ status: "error", companies: [] }); });
    return () => { live = false; };
  }, []);

  const owed = useMemo(() => (pending || [])
    .filter((entry) => entry.direction === "in")
    .sort((left, right) => String(left.dueOn || "9999").localeCompare(String(right.dueOn || "9999"))), [pending]);
  const overdue = owed.filter((entry) => entry.dueOn && isOverdue(entry.dueOn, today));
  const owedTotals = new Map();
  for (const entry of owed) owedTotals.set(entry.currency, (owedTotals.get(entry.currency) || 0) + entry.amount);
  const overdueTotals = new Map();
  for (const entry of overdue) overdueTotals.set(entry.currency, (overdueTotals.get(entry.currency) || 0) + entry.amount);

  const board = useMemo(() => deals.companies.filter(onBoard), [deals.companies]);
  const byStage = (stage) => board.filter((company) => effectiveStage(company) === stage && company.dealValue);
  const stageTotals = (stage) => {
    const totals = new Map();
    for (const company of byStage(stage)) totals.set(company.dealCurrency, (totals.get(company.dealCurrency) || 0) + company.dealValue);
    return totals;
  };
  const proposals = byStage("proposal").sort((left, right) => right.dealValue - left.dealValue);
  const unvalued = board.filter((company) => ["lead", "talking", "proposal"].includes(effectiveStage(company)) && !company.dealValue).length;

  return (
    <section className="mo c12" aria-label="Money outlook">
      <article className={`mo-card${overdue.length ? " is-alert" : ""}`}>
        <header>
          <span className="mo-icon"><Hourglass size={16} /></span>
          <h3>Owed to you</h3>
          {onOpenInvoices ? <button type="button" onClick={onOpenInvoices}>Invoices <ArrowRight size={13} /></button> : null}
        </header>
        <strong className="mo-total">{owed.length ? totalLine(owedTotals) : "Nothing outstanding"}</strong>
        {overdue.length ? <p className="mo-alert"><CircleAlert size={14} /> {totalLine(overdueTotals)} is past its date ({overdue.length} {overdue.length === 1 ? "invoice" : "invoices"}).</p> : owed.length ? <p className="mo-note">Nothing is late.</p> : <p className="mo-note">Invoice a client and what they owe shows up here.</p>}
        {owed.length ? (
          <ul>
            {owed.slice(0, 5).map((entry) => {
              const late = entry.dueOn && isOverdue(entry.dueOn, today);
              return (
                <li key={entry.id}>
                  <span><strong dir="auto">{entry.counterparty || entry.note || "Payment"}</strong><small className={late ? "is-late" : ""}>{entry.dueOn ? dueLabel(entry.dueOn, { today }) : "No due date"}</small></span>
                  <b className="mono">{exactAmount(entry.amount, { currency: entry.currency })}</b>
                </li>
              );
            })}
          </ul>
        ) : null}
      </article>

      <article className="mo-card">
        <header>
          <span className="mo-icon is-gold"><Target size={16} /></span>
          <h3>On its way</h3>
          <small>From your Clients board</small>
        </header>
        {deals.status === "loading" ? <strong className="mo-total">…</strong> : null}
        {deals.status === "error" ? <p className="mo-alert"><CircleAlert size={14} /> The deals could not be read.</p> : null}
        {deals.status === "ready" ? (
          <>
            <div className="mo-stages">
              {PIPELINE_STAGES.map((stage) => {
                const totals = stageTotals(stage.id);
                return (
                  <div key={stage.id}>
                    <small>{stage.label}</small>
                    <b>{totals.size ? [...totals].map(([currency, total]) => formatDealExact(total, currency)).join(" · ") : "—"}</b>
                    <span>{byStage(stage.id).length ? `${byStage(stage.id).length} ${byStage(stage.id).length === 1 ? "deal" : "deals"}` : stage.hint}</span>
                  </div>
                );
              })}
            </div>
            {proposals.length ? (
              <ul>
                {proposals.slice(0, 4).map((company) => (
                  <li key={company.id}>
                    <button type="button" onClick={() => onOpenCompany(company.id)}>
                      <span><strong dir="auto">{company.name}</strong><small>Proposal sent</small></span>
                      <b className="mono">{formatDealExact(company.dealValue, company.dealCurrency)}</b>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {unvalued ? <p className="mo-note">{unvalued} open {unvalued === 1 ? "deal has" : "deals have"} no value yet. Set one on the client's page and it counts here.</p> : null}
          </>
        ) : null}
      </article>
    </section>
  );
}
