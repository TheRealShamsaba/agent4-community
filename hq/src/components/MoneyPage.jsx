import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MoneyOutlook } from "./MoneyOutlook.jsx";
import { ChevronLeft, ChevronRight, Download, FileText, Lock, Plus, Repeat, X } from "lucide-react";
import { MoneyEntryForm } from "./MoneyEntryForm.jsx";
import { Invoices } from "./Invoices.jsx";
import { RecurringForm } from "./RecurringForm.jsx";
import { CurrencyTabs } from "./CurrencyField.jsx";
import { CompanyFilterBar, CompanyTag, companyName, NO_COMPANY, useCompanies } from "./CompanyPicker.jsx";
import { compactAmount, dueLabel, exactAmount, formatDate, isOverdue, localIsoDate } from "../format.js";

const SPEND_LABEL = {
  running: "Running costs",
  people: "Us",
  contractor: "Contractors",
  billable: "Client-billable"
};

const SPEND_INK = {
  running: "var(--sky)",
  people: "var(--gold)",
  contractor: "var(--plum)",
  billable: "var(--go)"
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* The server caps a listing at 500. A year of a busy currency can reach it, and
   a ledger silently missing its oldest rows is worse than one that says so. */
const LEDGER_LIMIT = 500;

/* "No company at all" is a real filter now, answered in SQL, so the page sends
   the server's own spelling of it rather than sieving the rows it happens to
   be holding. */
const UNATTRIBUTED = NO_COMPANY;

async function moneyRequest(pathname, options = {}) {
  const response = await fetch(`/api/money${pathname}`, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The money service returned an unreadable response.");
  }
  if (!response.ok) throw new Error(body?.error?.message || "The money service refused that.");
  return body;
}

async function invoiceRequest(pathname, options = {}) {
  const response = await fetch(`/api/invoices${pathname}`, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The invoice service returned an unreadable response.");
  }
  if (!response.ok) throw new Error(body?.error?.message || "The invoice service refused that.");
  return body;
}

function shiftPeriod(period, step) {
  let match = /^(\d{4})-(\d{2})$/.exec(period);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1 + step, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  match = /^(\d{4})-Q([1-4])$/.exec(period);
  if (match) {
    const index = (Number(match[1]) * 4 + (Number(match[2]) - 1)) + step;
    return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
  }
  return String(Number(period) + step);
}

function periodLabel(period) {
  let match = /^(\d{4})-(\d{2})$/.exec(period);
  if (match) return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
  match = /^(\d{4})-Q([1-4])$/.exec(period);
  if (match) return `Q${match[2]} ${match[1]}`;
  return period;
}

/** The inclusive day bounds of a period, matching what the server means by it. */
function periodBounds(period) {
  let match = /^(\d{4})-(\d{2})$/.exec(period);
  if (match) {
    const last = new Date(Number(match[1]), Number(match[2]), 0).getDate();
    return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
  }
  match = /^(\d{4})-Q([1-4])$/.exec(period);
  if (match) {
    const startMonth = (Number(match[2]) - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const last = new Date(Number(match[1]), endMonth, 0).getDate();
    return {
      from: `${match[1]}-${String(startMonth).padStart(2, "0")}-01`,
      to: `${match[1]}-${String(endMonth).padStart(2, "0")}-${String(last).padStart(2, "0")}`
    };
  }
  return { from: `${period}-01-01`, to: `${period}-12-31` };
}

function currentPeriod(granularity, today = new Date()) {
  const iso = localIsoDate(today);
  const year = iso.slice(0, 4);
  if (granularity === "year") return year;
  if (granularity === "quarter") return `${year}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
  return iso.slice(0, 7);
}

/** "9 days overdue", or "Due 20 Sep". A bare date does not say it is a due one. */
function dueText(iso) {
  if (!iso) return "No due date";
  return isOverdue(iso) ? dueLabel(iso) : `Due ${dueLabel(iso)}`;
}

/** Restates an amount into today's money using the owner's own assumed rate. */
function restate(amount, monthKey, rate, today = new Date()) {
  if (!rate) return amount;
  const [year, month] = monthKey.split("-").map(Number);
  const then = new Date(year, month - 1, 15);
  const years = (today.getTime() - then.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 0) return amount;
  return amount * (1 + rate) ** years;
}

/** Months side by side: what came in against what went out. Drawn, not tabulated. */
function Trend({ points, real, rate }) {
  if (!points?.length) return <p className="quiet">No months with movement yet.</p>;
  const shown = points.map((point) => ({
    month: point.month,
    in: real ? restate(point.in, point.month, rate) : point.in,
    out: real ? restate(point.out, point.month, rate) : point.out
  }));
  // A refunded month can be negative in either direction, so the bars are drawn
  // from the largest distance from zero rather than from the largest number.
  const peak = Math.max(1, ...shown.map((point) => Math.max(Math.abs(point.in), Math.abs(point.out))));
  const width = 100 / shown.length;

  return (
    <div className="trend">
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" role="img" aria-label="Money in and out by month">
        {shown.map((point, index) => {
          const left = index * width;
          const inHeight = (Math.abs(point.in) / peak) * 38;
          const outHeight = (Math.abs(point.out) / peak) * 38;
          return (
            <g key={point.month}>
              <rect x={left + width * 0.16} y={40 - inHeight} width={width * 0.3} height={Math.max(inHeight, 0.4)} fill="var(--go)" rx="0.4" opacity={point.in < 0 ? 0.45 : 1} />
              <rect x={left + width * 0.52} y={40 - outHeight} width={width * 0.3} height={Math.max(outHeight, 0.4)} fill="var(--orange)" rx="0.4" opacity={point.out < 0 ? 0.45 : 1} />
            </g>
          );
        })}
        <line x1="0" y1="40.4" x2="100" y2="40.4" stroke="rgba(248,241,227,.14)" strokeWidth="0.3" />
      </svg>
      <div className="trend-axis">
        {shown.map((point) => (
          <span key={point.month}>{MONTHS[Number(point.month.split("-")[1]) - 1].slice(0, 1)}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * Where a period's spending went. A category can be negative now that refunds
 * are recordable, so the bars are sized against the largest line by distance
 * from zero and the share is taken over the gross — a share of a net that a
 * refund has pushed towards zero is a number in the hundreds of percent.
 */
function Breakdown({ spend, currency }) {
  const rows = Object.entries(spend || {}).sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]));
  if (!rows.length) return <p className="quiet">Nothing spent in this period.</p>;
  const gross = rows.reduce((sum, [, amount]) => sum + Math.abs(amount), 0);
  const peak = Math.max(...rows.map(([, amount]) => Math.abs(amount)), 1);
  const refunded = rows.some(([, amount]) => amount < 0);
  return (
    <div className="breakdown">
      {rows.map(([category, amount]) => (
        <div key={category} className={`bd-row ${amount < 0 ? "is-back" : ""}`}>
          <span className="bd-name">{SPEND_LABEL[category] || category}</span>
          <span className="bd-track">
            <i style={{ width: `${(Math.abs(amount) / peak) * 100}%`, background: SPEND_INK[category] || "var(--sky)" }} />
          </span>
          <span className="bd-val mono" title={exactAmount(amount, { currency })}>{exactAmount(amount)}</span>
          <span className="bd-pct mono">{gross ? Math.round((Math.abs(amount) / gross) * 100) : 0}%</span>
        </div>
      ))}
      {refunded ? <p className="quiet">A negative line is money that came back — a refund or a credit against that category.</p> : null}
    </div>
  );
}

const PEOPLE_SHOWN = 6;

/**
 * Who the money moved with, biggest first.
 *
 * The report used to hand back a map keyed by whatever counterparty text was
 * typed, which is how one client became three. It now hands back rows, grouped
 * by company wherever an entry carries one, and a row that names a company is
 * a way into that company's money rather than a label. A company row and a
 * typed-text row can carry the same name and are still two different things,
 * so the key says which kind it is.
 */
function People({ label, rows = [], ink, currency, chosenCompany, onPickCompany }) {
  if (!rows.length) return null;
  const shown = rows.slice(0, PEOPLE_SHOWN);
  const top = Math.max(...shown.map((row) => Math.abs(row.amount)), 1);
  return (
    <div className="people">
      <h4>{label}</h4>
      {shown.map((row) => {
        const bars = (
          <>
            <span className="pp-name" dir="auto">{row.name}</span>
            <span className="pp-track"><i style={{ width: `${(Math.abs(row.amount) / top) * 100}%`, background: ink }} /></span>
            <span className="pp-val mono" title={exactAmount(row.amount, { currency })}>{exactAmount(row.amount)}</span>
          </>
        );
        if (!row.companyId) return <div key={`text:${row.name}`} className="pp-row">{bars}</div>;
        const on = chosenCompany === row.companyId;
        return (
          <button
            key={`company:${row.companyId}`}
            type="button"
            className={`pp-row pp-row--firm ${on ? "on" : ""}`}
            onClick={() => onPickCompany(on ? "" : row.companyId)}
            title={on ? "Back to everyone" : `Show only ${row.name} in the ledger below`}
            aria-pressed={on}
          >
            {bars}
          </button>
        );
      })}
      {rows.length > PEOPLE_SHOWN ? (
        <p className="quiet">and {rows.length - PEOPLE_SHOWN} more.</p>
      ) : null}
    </div>
  );
}

/** A headline tile: the shape of the number big, the number itself on hover. */
function Head({ tone, value, currency, label, note }) {
  return (
    <div className={`head ${tone || ""}`}>
      <b className="mono" title={exactAmount(value, { currency })}>{compactAmount(value)}</b>
      <span>{label}</span>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

/**
 * The full money view: a period, a currency, and everything that made it.
 * Currencies are chosen one at a time because they are never comparable.
 */
export function MoneyPage({ onBack, onOpenCompany }) {
  const [granularity, setGranularity] = useState("month");
  const [period, setPeriod] = useState(() => currentPeriod("month"));
  const [currency, setCurrency] = useState(null);
  const [real, setReal] = useState(false);
  const [data, setData] = useState({ status: "loading" });
  const [rateDraft, setRateDraft] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [openingDraft, setOpeningDraft] = useState("");
  const [showInvoices, setShowInvoices] = useState(false);
  const [standingOpen, setStandingOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [scoped, setScoped] = useState({ status: "idle", entries: [], message: "" });
  const [refresh, setRefresh] = useState(0);
  const companies = useCompanies();

  const load = useCallback(async (targetPeriod) => {
    const { from, to } = periodBounds(targetPeriod);
    /* The filtered ledger is its own request, so a save that refreshes this one
       has to tell it to refresh as well; otherwise settling a row while looking
       at one company left that company's list showing the old figure. */
    setRefresh((count) => count + 1);
    try {
      const [reportBody, seriesBody, pendingBody, entriesBody, recurringBody, invoiceBody] = await Promise.all([
        moneyRequest(`/report?period=${encodeURIComponent(targetPeriod)}`),
        moneyRequest("/series?months=12"),
        moneyRequest("/entries?status=pending&limit=50"),
        // The ledger is the period's ledger. Without these bounds every tile
        // above it moved with the period and the rows below never did.
        moneyRequest(`/entries?from=${from}&to=${to}&limit=${LEDGER_LIMIT}`),
        moneyRequest("/recurring"),
        /* So that settling a row can settle the invoice that raised it, and so
           that the entry form knows not to offer a company on a row whose
           company belongs to an invoice. Draft and void invoices hold no entry,
           so the whole list is the right question to ask. */
        invoiceRequest("").catch(() => ({ invoices: [] }))
      ]);
      setData({
        status: "ready",
        report: reportBody.report,
        cash: reportBody.cash || [],
        posted: reportBody.posted || 0,
        settings: reportBody.settings,
        commitments: reportBody.commitments || [],
        series: seriesBody.series,
        pending: pendingBody.entries,
        entries: entriesBody.entries,
        recurring: recurringBody.recurring,
        invoices: invoiceBody.invoices || []
      });
    } catch (error) {
      setData({ status: "error", message: error.message });
    }
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  /**
   * Narrowing the ledger asks the server rather than sieving what is on screen.
   * A busy period stops at five hundred rows, and sieving a truncated list
   * would quietly hide the oldest thing a client ever paid. This is true of
   * "nobody" as much as of a named company, and the server answers both in the
   * same query, so both go the same way.
   */
  useEffect(() => {
    if (!companyFilter) {
      setScoped({ status: "idle", entries: [], message: "" });
      return undefined;
    }
    let live = true;
    const { from, to } = periodBounds(period);
    setScoped({ status: "loading", entries: [], message: "" });
    moneyRequest(`/entries?from=${from}&to=${to}&companyId=${encodeURIComponent(companyFilter)}&limit=${LEDGER_LIMIT}`)
      .then((body) => { if (live) setScoped({ status: "ready", entries: body.entries || [], message: "" }); })
      .catch((error) => { if (live) setScoped({ status: "error", entries: [], message: error.message }); });
    return () => { live = false; };
  }, [companyFilter, period, refresh]);

  function changeGranularity(next) {
    setGranularity(next);
    setPeriod(currentPeriod(next));
  }

  const currencies = useMemo(() => data.report?.currencies || [], [data.report]);

  /* The currency the owner picked stays picked. Falling back to whichever
     bucket happened to be first left every figure on the page in a different
     unit from the one named above it. */
  const chosen = currency || currencies[0]?.currency || (data.cash || [])[0]?.currency || null;
  const known = useMemo(() => {
    const codes = new Set();
    for (const bucket of currencies) codes.add(bucket.currency);
    for (const purse of data.cash || []) codes.add(purse.currency);
    for (const item of data.recurring || []) codes.add(item.currency);
    if (chosen) codes.add(chosen);
    return [...codes].sort();
  }, [currencies, data.cash, data.recurring, chosen]);

  const active = currencies.find((bucket) => bucket.currency === chosen) || null;
  const rate = chosen ? (data.settings?.inflation?.[chosen] || 0) : 0;
  const track = data.series?.find((item) => item.currency === chosen);
  const pending = (data.pending || []).filter((entry) => entry.currency === chosen);
  const entries = (data.entries || []).filter((entry) => entry.currency === chosen);
  const recurring = (data.recurring || []).filter((item) => item.currency === chosen);
  const purse = (data.cash || []).find((item) => item.currency === chosen) || null;
  const committed = (data.commitments || []).find((item) => item.currency === chosen) || null;

  /* What the period holds, what the ledger is currently showing, and how much
     of it has nobody against it. The counts come from the unfiltered period so
     that the chips keep saying the same thing while a filter is on. */
  const unattributed = entries.filter((entry) => !entry.companyId);
  const ledgerEntries = companyFilter ? scoped.entries.filter((entry) => entry.currency === chosen) : entries;
  /* The period's own ledger is capped, so the count of unattributed rows is a
     floor rather than a total whenever that cap was reached. The filter itself
     is exact — it is the count, not the list, that has to hedge. */
  const truncated = data.entries?.length === LEDGER_LIMIT;

  const firmOptions = useMemo(() => {
    const counts = new Map();
    for (const entry of entries) {
      if (entry.companyId) counts.set(entry.companyId, (counts.get(entry.companyId) || 0) + 1);
    }
    const options = [{ value: "", label: "Everyone", count: entries.length }];
    for (const company of companies.list) {
      if (counts.has(company.id)) options.push({ value: company.id, label: company.name, count: counts.get(company.id) });
    }
    // A chosen company can have nothing in the period being looked at. Dropping
    // its chip would leave a filtered ledger with nothing saying what filtered it.
    if (companyFilter && companyFilter !== UNATTRIBUTED && !options.some((option) => option.value === companyFilter)) {
      options.push({ value: companyFilter, label: companyName(companies, companyFilter) || "This company", count: 0 });
    }
    // With no companies in the CRM at all there is nothing to attribute money
    // to, and a standing "against nobody" chip would be a reproach, not a task.
    if (unattributed.length && companies.list.length) {
      options.push({
        value: UNATTRIBUTED,
        label: truncated ? "Nobody (at least)" : "Nobody",
        count: unattributed.length,
        tone: "warn"
      });
    }
    return options;
  }, [entries, companies, companyFilter, unattributed.length, truncated]);

  const invoiceByEntry = useMemo(() => {
    const map = new Map();
    for (const invoice of data.invoices || []) {
      if (invoice.entryId) map.set(invoice.entryId, invoice);
    }
    return map;
  }, [data.invoices]);

  // The control is always on screen, so it starts holding whatever is set.
  useEffect(() => { setRateDraft(rate ? String(Math.round(rate * 100)) : ""); }, [rate, chosen]);

  /**
   * Settling a row that an invoice raised has to go through the invoice.
   * Patching the entry alone left the invoice reading "Sent", printing without
   * its paid stamp, and the two screens disagreeing with no way back.
   */
  async function settle(entry) {
    setActionError("");
    try {
      const invoice = invoiceByEntry.get(entry.id);
      if (invoice) {
        await invoiceRequest(`/${invoice.id}/status`, {
          method: "POST",
          body: JSON.stringify({ status: "paid", paidOn: localIsoDate() })
        });
      } else {
        await moneyRequest(`/entries/${entry.id}`, { method: "PATCH", body: JSON.stringify({ status: "settled" }) });
      }
      await load(period);
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function saveOpening(event) {
    event.preventDefault();
    if (!chosen) return;
    setActionError("");
    try {
      await moneyRequest("/settings/opening", {
        method: "PUT",
        body: JSON.stringify({ currency: chosen, amount: Number(openingDraft) })
      });
      setOpeningDraft("");
      await load(period);
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function saveRate(event) {
    event.preventDefault();
    if (!chosen) return;
    setActionError("");
    try {
      await moneyRequest("/settings/inflation", {
        method: "PUT",
        body: JSON.stringify({ currency: chosen, rate: Number(rateDraft) / 100 })
      });
      await load(period);
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function clearRate() {
    if (!chosen) return;
    setActionError("");
    try {
      await moneyRequest("/settings/inflation", { method: "PUT", body: JSON.stringify({ currency: chosen, rate: 0 }) });
      setReal(false);
      await load(period);
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function createRecurring(payload) {
    await moneyRequest("/recurring", { method: "POST", body: JSON.stringify(payload) });
    setStandingOpen(false);
    await load(period);
  }

  async function stopRecurring(item) {
    if (!window.confirm(`Stop ${item.counterparty || item.note || "this standing cost"}? Charges already in the books stay there.`)) return;
    setActionError("");
    try {
      await moneyRequest(`/recurring/${item.id}`, { method: "DELETE" });
      await load(period);
    } catch (error) {
      setActionError(error.message);
    }
  }

  if (showInvoices) {
    return <Invoices onBack={() => { setShowInvoices(false); load(period); }} currencies={known} />;
  }

  return (
    <div className="court moneypage">
      <div className="bento">
        <header className="pg-head c12">
          <div>
            <h1>Money</h1>
            <p>Who owes you, what is on its way, and what you have made.</p>
          </div>
          <span className="lock"><Lock size={9} /> Only you</span>
        </header>
        <div className="mp-top c12">
          <div className="mp-gran">
            {["month", "quarter", "year"].map((value) => (
              <button key={value} type="button" className={granularity === value ? "on" : ""} onClick={() => changeGranularity(value)}>
                {value === "month" ? "Month" : value === "quarter" ? "Quarter" : "Year"}
              </button>
            ))}
          </div>
          <div className="mp-nav">
            <button type="button" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Previous period"><ChevronLeft size={15} /></button>
            <strong>{periodLabel(period)}</strong>
            <button type="button" onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Next period"><ChevronRight size={15} /></button>
          </div>
          <button type="button" className="mp-record" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus size={14} /> Record money</button>
          <button type="button" className="mp-plain" onClick={() => setShowInvoices(true)}><FileText size={13} /> Invoices</button>
          <a className="mp-export" href="/api/money/export.csv" download><Download size={13} /> CSV</a>
        </div>

        {data.status === "ready" ? <MoneyOutlook pending={data.pending} onOpenCompany={onOpenCompany} onOpenInvoices={() => setShowInvoices(true)} /> : null}

        {formOpen ? (
          <MoneyEntryForm
            currencies={known}
            companies={companies}
            entry={editing}
            raisedBy={editing ? invoiceByEntry.get(editing.id) || null : null}
            onClose={() => { setFormOpen(false); setEditing(null); }}
            onSaved={() => load(period)}
          />
        ) : null}

        {data.status === "loading" ? (
          <section className="mod c12"><div className="skeleton" style={{ height: 96 }} /><p className="quiet">Counting…</p></section>
        ) : null}
        {data.status === "error" ? (
          <section className="mod c12">
            <div className="errorstate" role="alert">
              <strong>The books could not be read</strong>
              <p>{data.message}</p>
              <button type="button" className="btn" onClick={() => load(period)}>Try again</button>
            </div>
          </section>
        ) : null}

        {data.status === "ready" && !known.length ? (
          <section className="mod c12">
            <div className="emptystate">
              <strong>Nothing recorded yet</strong>
              <p>Record the first movement of money and every figure on this page fills in.</p>
              <button type="button" className="btn btn--primary" onClick={() => { setEditing(null); setFormOpen(true); }}>Record money</button>
            </div>
          </section>
        ) : null}

        {data.status === "ready" && known.length > 0 ? (
          <>
            <CurrencyTabs value={chosen} currencies={known} onChange={setCurrency} />

            {actionError ? (
              <section className="mod c12"><p className="errorstate" role="alert">{actionError}</p></section>
            ) : null}

            {purse ? (
              <div className="mod c12 mp-purse">
                <div className="mh">
                  <h3>What you are holding <em className="mh-scope">as of today</em></h3>
                  {data.posted ? <span className="cnt"><Repeat size={11} /> {data.posted} standing charge{data.posted === 1 ? "" : "s"} posted</span> : null}
                </div>
                <div className="purse-row">
                  <div className="purse-cell">
                    <b className={`mono ${purse.cash < 0 ? "bad" : ""}`} title={exactAmount(purse.cash, { currency: purse.currency })}>{compactAmount(purse.cash)}</b>
                    <span>Cash · {purse.currency}</span>
                  </div>
                  <div className="purse-cell">
                    <b className="mono" title={exactAmount(purse.burn, { currency: purse.currency })}>{compactAmount(purse.burn)}</b>
                    <span>Burn a month</span>
                  </div>
                  <div className="purse-cell">
                    {purse.runwayMonths === null
                      ? <b className="mono dim">—</b>
                      : <b className={`mono ${purse.runwayMonths < 3 ? "bad" : purse.runwayMonths < 6 ? "warn" : "good"}`}>{purse.runwayMonths}</b>}
                    <span>{purse.runwayMonths === null ? "No spending yet" : "Months of runway"}</span>
                  </div>
                  <form className="purse-open" onSubmit={saveOpening}>
                    <label>
                      <span>Opening balance</span>
                      <input type="number" min="0" step="0.01" placeholder={String(purse.opening || 0)} value={openingDraft} onChange={(event) => setOpeningDraft(event.target.value)} required />
                    </label>
                    <button type="submit">Set</button>
                  </form>
                </div>
                <p className="purse-note">
                  Cash is the opening balance plus everything settled up to today, whatever period is showing above. Runway divides it by the
                  last three whole months of spending — the current month is still running, so it is left out.
                </p>
              </div>
            ) : null}

            {active ? (
              <div className="mp-heads c12">
                <Head tone="in" value={active.in} currency={chosen} label={`In \u00b7 ${chosen}`} note={periodLabel(period)} />
                <Head tone="out" value={active.out} currency={chosen} label="Out" note={periodLabel(period)} />
                <Head tone={active.net >= 0 ? "good" : "bad"} value={active.net} currency={chosen} label="Net" note={periodLabel(period)} />
                <Head value={active.outstanding} currency={chosen} label="Owed to you" note="as of today" />
                <Head tone={active.overdue ? "bad" : ""} value={active.overdue} currency={chosen}
                  label={active.overdue ? `${active.overdueCount} overdue` : "Nothing overdue"} note="as of today" />
              </div>
            ) : (
              <section className="mod c12">
                <div className="emptystate">
                  <strong>No {chosen} activity in {periodLabel(period)}</strong>
                  <p>
                    Nothing settled in {chosen} inside this period, so there is no total to show. The currency stays chosen — move the
                    period, or pick another currency above.
                  </p>
                </div>
              </section>
            )}

            <section className="mod c8">
              <div className="mh">
                <h3>Twelve months</h3>
                <span className="cnt">
                  <label className="mp-toggle">
                    <input type="checkbox" checked={real} onChange={(event) => setReal(event.target.checked)} disabled={!rate} />
                    In today's money
                  </label>
                </span>
              </div>
              <Trend points={track?.points} real={real} rate={rate} />
              <div className="mp-legend">
                <span><i style={{ background: "var(--go)" }} /> In</span>
                <span><i style={{ background: "var(--orange)" }} /> Out</span>
                <form className="mp-rate" onSubmit={saveRate}>
                  <label>
                    <span className="sr-only">Assumed inflation a year for {chosen}, as a percentage</span>
                    <input type="number" min="0" max="1000" step="1" placeholder="Inflation %"
                      value={rateDraft} onChange={(event) => setRateDraft(event.target.value)} required />
                  </label>
                  <button type="submit">{rate ? "Update" : `Set for ${chosen}`}</button>
                  {rate ? <button type="button" className="quiet-btn" onClick={clearRate}>Clear</button> : null}
                </form>
                {rate ? (
                  <em>{real ? `Restated at ${Math.round(rate * 100)}% a year` : `${Math.round(rate * 100)}% a year assumed`}</em>
                ) : null}
              </div>
            </section>

            <section className="mod c4">
              <div className="mh">
                <h3>Where it went</h3>
                <span className="cnt" title={exactAmount(active?.out || 0, { currency: chosen })}>{compactAmount(active?.out || 0)}</span>
              </div>
              <Breakdown spend={active?.spend} currency={chosen} />
            </section>

            <section className="mod c6">
              <div className="mh"><h3>Who paid, who got paid</h3></div>
              <People label="Money in" rows={active?.earners} ink="var(--go)" currency={chosen}
                chosenCompany={companyFilter} onPickCompany={setCompanyFilter} />
              <People label="Money out" rows={active?.payees} ink="var(--orange)" currency={chosen}
                chosenCompany={companyFilter} onPickCompany={setCompanyFilter} />
              {!(active?.earners || []).length && !(active?.payees || []).length
                ? <p className="quiet">No movement in this period.</p>
                : <p className="quiet">A row with a company behind it opens that company's ledger below. The rest are grouped by the name that was typed.</p>}
            </section>

            <section className="mod c6">
              <div className="mh">
                <h3>Owed to you <em className="mh-scope">as of today</em></h3>
                <span className="cnt">{pending.length}</span>
              </div>
              {pending.length ? pending.map((entry) => {
                // What is still owed is the sharpest form of "has this client
                // paid us", so the company shows here as it does in the ledger.
                const firm = entry.companyId ? (companyName(companies, entry.companyId) || "A company") : "";
                return (
                  <div key={entry.id} className={`inv ${isOverdue(entry.dueOn) ? "is-overdue" : ""}`}>
                    <div className="inv-b">
                      <b dir="auto">{entry.counterparty || "No name given"}</b>
                      <span>{dueText(entry.dueOn)}{invoiceByEntry.has(entry.id) ? ` \u00b7 invoice ${invoiceByEntry.get(entry.id).number}` : ""}</span>
                    </div>
                    {entry.companyId ? (
                      <CompanyTag
                        name={firm}
                        active={companyFilter === entry.companyId}
                        onClick={() => setCompanyFilter(companyFilter === entry.companyId ? "" : entry.companyId)}
                        title={companyFilter === entry.companyId ? "Back to everyone" : `Show only ${firm} in the ledger below`}
                      />
                    ) : null}
                    <span className="inv-v mono" title={exactAmount(entry.amount, { currency: entry.currency })}>{exactAmount(entry.amount)}</span>
                    <button type="button" onClick={() => settle(entry)}>Mark paid</button>
                  </div>
                );
              }) : <p className="quiet">Nothing outstanding. Everyone has paid.</p>}

              <div className="mh standing-mh">
                <h3>Standing costs</h3>
                {committed ? <span className="cnt" title={exactAmount(committed.amount, { currency: chosen })}>{compactAmount(committed.amount)} a month</span> : null}
              </div>
              {recurring.length ? recurring.map((item) => {
                const firm = item.companyId ? (companyName(companies, item.companyId) || "A company") : "";
                return (
                  <div key={item.id} className="inv">
                    <div className="inv-b">
                      <b dir="auto">{item.counterparty || item.note || "Standing cost"}</b>
                      <span>{item.cadence === "yearly" ? "Every year" : "Every month"}{item.dayOfMonth ? ` on the ${item.dayOfMonth}` : ""} · {SPEND_LABEL[item.category] || item.category}</span>
                    </div>
                    {item.companyId ? (
                      <CompanyTag
                        name={firm}
                        active={companyFilter === item.companyId}
                        onClick={() => setCompanyFilter(companyFilter === item.companyId ? "" : item.companyId)}
                        title={companyFilter === item.companyId ? "Back to everyone" : `Show only ${firm} in the ledger below`}
                      />
                    ) : null}
                    <span className="inv-v mono" title={exactAmount(item.amount, { currency: item.currency })}>{exactAmount(item.amount)}</span>
                    <button type="button" onClick={() => stopRecurring(item)}><X size={12} /> Stop</button>
                  </div>
                );
              }) : <p className="quiet">Nothing charges itself yet.</p>}
              {standingOpen ? (
                <RecurringForm currency={chosen} currencies={known} companies={companies}
                  onCancel={() => setStandingOpen(false)} onCreate={createRecurring} />
              ) : (
                <button type="button" className="standing-add" onClick={() => setStandingOpen(true)}><Plus size={13} /> Add a standing cost</button>
              )}
            </section>

            <section className="mod c12">
              <div className="mh">
                <h3>Every entry <em className="mh-scope">{periodLabel(period)}</em></h3>
                <span className="cnt">{ledgerEntries.length}</span>
              </div>

              <CompanyFilterBar label="Filed against" options={firmOptions} value={companyFilter} onChange={setCompanyFilter} />
              {companies.status === "error" ? (
                <div className="errorstate" role="alert">
                  <strong>Your companies could not be read</strong>
                  <p>{companies.message} The ledger below is complete; only the company names are missing.</p>
                  <button type="button" className="btn" onClick={companies.reload}>Try again</button>
                </div>
              ) : null}
              {unattributed.length && companies.list.length && companyFilter !== UNATTRIBUTED ? (
                <p className="mp-unattributed">
                  {truncated ? "At least " : ""}{unattributed.length} {unattributed.length === 1 ? "entry has" : "entries have"} no
                  company against {unattributed.length === 1 ? "it" : "them"}, so {unattributed.length === 1 ? "it reaches" : "they reach"} no
                  company page. {"\u201cNobody\u201d"} above is the whole list of them
                  {truncated ? ", counted properly \u2014 only this tally is capped with the period" : ""}.
                </p>
              ) : null}
              {scoped.status === "error" ? (
                <div className="errorstate" role="alert">
                  <strong>That company's entries could not be read</strong>
                  <p>{scoped.message}</p>
                  <button type="button" className="btn" onClick={() => setCompanyFilter("")}>Back to everyone</button>
                </div>
              ) : null}

              <div className="ledger">
                {scoped.status === "loading" ? <div className="skeleton" style={{ height: 72 }} /> : null}
                {scoped.status !== "loading" ? ledgerEntries.map((entry) => {
                  // Direction says which way the money was meant to go; a negative
                  // amount reverses it. The row shows where the money actually went.
                  const signed = entry.direction === "in" ? entry.amount : -entry.amount;
                  const firm = entry.companyId ? (companyName(companies, entry.companyId) || "A company") : "";
                  return (
                    <div key={entry.id} className="lg-row">
                      <button type="button" className="lg-open" onClick={() => { setEditing(entry); setFormOpen(true); }}>
                        <span className="lg-date">{formatDate(entry.occurredOn, { style: "short" })}</span>
                        <span className={`lg-dir ${entry.direction}`}>{entry.direction === "in" ? "in" : "out"}</span>
                        <span className="lg-who" dir="auto">{entry.counterparty || "\u2014"}</span>
                        <span className="lg-cat">{SPEND_LABEL[entry.category] || entry.category}</span>
                        <span className="lg-note" dir="auto">{entry.note}</span>
                        {entry.status === "pending" ? <span className="lg-pending">unpaid</span> : null}
                        {entry.fromRecurring ? <span className="lg-auto" title="Posted by a standing cost"><Repeat size={10} /></span> : null}
                      </button>
                      {entry.companyId ? (
                        <CompanyTag
                          name={firm}
                          active={companyFilter === entry.companyId}
                          onClick={() => setCompanyFilter(companyFilter === entry.companyId ? "" : entry.companyId)}
                          title={companyFilter === entry.companyId ? "Back to everyone" : `Show only ${firm}`}
                        />
                      ) : null}
                      <span className={`lg-amt mono ${signed >= 0 ? "in" : "out"}`}>
                        {signed >= 0 ? "+" : "\u2212"}{exactAmount(Math.abs(signed), { currency: entry.currency })}
                      </span>
                    </div>
                  );
                }) : null}
                {scoped.status !== "loading" && scoped.status !== "error" && !ledgerEntries.length ? (
                  companyFilter ? (
                    <div className="emptystate">
                      <strong>Nothing here against {companyFilter === UNATTRIBUTED ? "nobody" : (companyName(companies, companyFilter) || "that company")}</strong>
                      <p>No {chosen} entry in {periodLabel(period)} matches. Move the period, or go back to the whole ledger.</p>
                      <button type="button" className="btn" onClick={() => setCompanyFilter("")}>Show everyone</button>
                    </div>
                  ) : <p className="quiet">No {chosen} entries in {periodLabel(period)}.</p>
                ) : null}
                {companyFilter
                  ? scoped.entries.length === LEDGER_LIMIT
                    ? <p className="quiet">Showing the first {LEDGER_LIMIT} of this one's entries in the period. Narrow the period, or take the CSV.</p>
                    : null
                  : truncated
                    ? <p className="quiet">Showing the first {LEDGER_LIMIT} entries of this period. Narrow the period, or take the CSV.</p>
                    : null}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
