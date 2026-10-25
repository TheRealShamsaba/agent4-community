import React, { useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, Wallet } from "lucide-react";
import { exactAmount, formatDate, isOverdue } from "../format.js";

/* Money is the reason a one-person studio keeps a CRM at all, so the company
   page says what this relationship has actually paid and what it still owes.
   The figures are owner-only on the server; for anyone else the panel is simply
   not there, rather than an error nobody can act on. */

const DIRECTION_LABELS = { in: "In", out: "Out" };
const PREVIEW = 5;

export function CompanyMoney({ company, onOpenMoney }) {
  const [state, setState] = useState({ status: "loading", money: null, error: "" });
  const [expanded, setExpanded] = useState(false);
  const companyId = company.storedId || company.id;
  const stored = company.stored;

  useEffect(() => {
    if (!stored) {
      setState({ status: "hidden", money: null, error: "" });
      return undefined;
    }
    let active = true;
    setState({ status: "loading", money: null, error: "" });
    fetch(`/api/workspaces/companies/${encodeURIComponent(companyId)}/money`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!active) return;
        // A member rather than the owner: show nothing at all, not a locked box.
        if (response.status === 403) setState({ status: "hidden", money: null, error: "" });
        else if (!response.ok) setState({ status: "error", money: null, error: body?.error?.message || "The money for this company could not be read." });
        else setState({ status: "ready", money: body.money, error: "" });
      })
      .catch((caught) => { if (active) setState({ status: "error", money: null, error: caught.message }); });
    return () => { active = false; };
  }, [companyId, stored]);

  if (state.status === "hidden") return null;

  const currencies = state.money?.currencies || [];
  const entries = state.money?.entries || [];
  const shown = expanded ? entries : entries.slice(0, PREVIEW);

  return (
    <section className="cd-block cd-money">
      <header><span><small>MONEY</small><h2>Settled, outstanding, overdue</h2></span>{onOpenMoney ? <button type="button" onClick={onOpenMoney}>Open the money page</button> : null}</header>

      {state.status === "loading" ? <p className="cd-money-state"><LoaderCircle className="is-spinning" size={14} /> Reading the ledger…</p> : null}
      {state.status === "error" ? <div className="errorstate" role="alert"><strong>The money could not be read.</strong><p>{state.error}</p></div> : null}

      {state.status === "ready" && !currencies.length
        ? <div className="cp-empty"><Wallet size={18} /><strong>Nothing invoiced yet</strong><p>Invoices and payments recorded against {company.name} show up here — what is settled, what is still outstanding, and what has gone past its date.</p></div>
        : null}

      {currencies.map((bucket) => (
        <dl className="cd-money-row" key={bucket.currency}>
          <div><dt>Settled in</dt><dd className="is-in">{exactAmount(bucket.in, { currency: bucket.currency })}</dd></div>
          <div><dt>Outstanding</dt><dd>{exactAmount(bucket.outstanding, { currency: bucket.currency })}</dd></div>
          <div><dt>Overdue</dt><dd className={bucket.overdueCount ? "is-overdue" : ""}>{bucket.overdueCount ? <><CircleAlert size={13} /> {exactAmount(bucket.overdue, { currency: bucket.currency })} · {bucket.overdueCount} invoice{bucket.overdueCount === 1 ? "" : "s"}</> : "None"}</dd></div>
        </dl>
      ))}

      {shown.length ? <div className="cd-money-entries">
        {shown.map((entry) => (
          <article key={entry.id} className={`is-${entry.direction}`}>
            <span><strong dir="auto">{entry.counterparty || entry.note || DIRECTION_LABELS[entry.direction]}</strong><small>{entry.category}{entry.project ? ` · ${entry.project}` : ""} · {formatDate(entry.occurredOn, { style: "short" })}</small></span>
            <em className={entry.status !== "settled" && entry.dueOn && isOverdue(entry.dueOn) ? "is-overdue" : ""}>{entry.direction === "out" ? "−" : "+"}{exactAmount(entry.amount, { currency: entry.currency })}<small>{entry.status === "settled" ? "settled" : entry.dueOn ? `due ${formatDate(entry.dueOn, { style: "short" })}` : "open"}</small></em>
          </article>
        ))}
      </div> : null}

      {entries.length > PREVIEW
        ? <button type="button" className="cd-more" onClick={() => setExpanded((current) => !current)}>{expanded ? "Show fewer" : `Showing ${PREVIEW} of ${entries.length} — show all`}</button>
        : null}
    </section>
  );
}
