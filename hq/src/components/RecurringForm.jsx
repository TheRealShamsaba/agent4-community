import React, { useRef, useState } from "react";
import { X } from "lucide-react";
import { CurrencyField } from "./CurrencyField.jsx";
import { CompanyPicker } from "./CompanyPicker.jsx";

const CATEGORIES = {
  in: [["client", "Client retainer"], ["other", "Other income"]],
  out: [["running", "Running costs"], ["people", "Us"], ["contractor", "Contractor"], ["billable", "Client-billable"]]
};

/**
 * A standing cost writes itself into the books every month, so it is the one
 * thing here that keeps spending money without being asked again. It could be
 * created over the API but never from the screen, which meant the list on the
 * money page was a read-only record of decisions taken somewhere else.
 *
 * It carries a company for the same reason a one-off entry does, and for one
 * more: every charge it writes into the books carries the link with it. A
 * monthly retainer set up here lands against its client each month without
 * anyone remembering to say so, which is the only way a standing arrangement
 * ever shows up on the company page it belongs to.
 */
export function RecurringForm({ currency, currencies, companies, onCancel, onCreate }) {
  const [form, setForm] = useState({
    direction: "out",
    amount: "",
    currency: currency || currencies[0] || "USD",
    category: "running",
    cadence: "monthly",
    dayOfMonth: "1",
    counterparty: "",
    companyId: "",
    note: ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The name a pick last wrote into the counterparty box, so a name typed by
  // hand is never replaced by one chosen afterwards.
  const filled = useRef("");

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  function pickCompany(id, company) {
    const typed = form.counterparty.trim();
    const replaceable = !typed || typed === filled.current;
    if (company && replaceable) filled.current = company.name;
    setForm((current) => ({
      ...current,
      companyId: id,
      counterparty: company && replaceable ? company.name : current.counterparty
    }));
  }

  function switchDirection(next) {
    setForm((current) => ({ ...current, direction: next, category: CATEGORIES[next][0][0] }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onCreate({
        direction: form.direction,
        amount: Number(form.amount),
        currency: form.currency,
        category: form.category,
        cadence: form.cadence,
        dayOfMonth: Number(form.dayOfMonth) || 1,
        counterparty: form.counterparty,
        companyId: form.companyId || null,
        note: form.note
      });
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="standing-form" onSubmit={submit}>
      <div className="standing-head">
        <strong>A new standing cost</strong>
        <button type="button" className="money-x" onClick={onCancel} aria-label="Cancel"><X size={14} /></button>
      </div>

      <div className="money-dir">
        <button type="button" className={form.direction === "out" ? "on" : ""} onClick={() => switchDirection("out")}>Goes out</button>
        <button type="button" className={form.direction === "in" ? "on" : ""} onClick={() => switchDirection("in")}>Comes in</button>
      </div>

      <div className="money-row">
        <label className="grow"><span>Amount each time</span>
          <input type="number" step="0.01" required value={form.amount} onChange={set("amount")} placeholder="1200000" /></label>
        <CurrencyField value={form.currency} currencies={currencies} onChange={(code) => setForm((current) => ({ ...current, currency: code }))} />
      </div>

      <div className="money-row">
        <label className="grow"><span>{form.direction === "out" ? "Paid to" : "Paid by"}</span>
          <input value={form.counterparty} onChange={set("counterparty")} dir="auto" placeholder="Hetzner" /></label>
        <label className="narrow"><span>How often</span>
          <select value={form.cadence} onChange={set("cadence")}>
            <option value="monthly">Every month</option>
            <option value="yearly">Every year</option>
          </select></label>
      </div>

      <CompanyPicker
        companies={companies}
        value={form.companyId}
        onChange={pickCompany}
        label={form.direction === "out" ? "Which company this is for" : "Which company pays it"}
        noneLabel={"Nobody in the CRM \u2014 just a bill"}
        hint="Every charge this writes into the books carries the company with it, so a retainer set up here keeps showing on that company's page by itself."
      />

      <div className="money-row">
        <label className="grow"><span>What for</span>
          <select value={form.category} onChange={set("category")}>
            {CATEGORIES[form.direction].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        <label className="narrow"><span>Day of month</span>
          <input type="number" min="1" max="28" value={form.dayOfMonth} onChange={set("dayOfMonth")} /></label>
      </div>

      <label><span>Note</span>
        <input value={form.note} onChange={set("note")} dir="auto" placeholder="Servers" /></label>

      <p className="money-hint">
        Every charge this has already missed is written into the books the next time the money page loads, dated to the day it was due.
      </p>
      {error ? <p className="money-error" role="alert">{error}</p> : null}
      <div className="money-foot">
        <button type="button" className="money-cancel" onClick={onCancel}>Cancel</button>
        <button type="submit" className="money-save" disabled={busy}>{busy ? "Saving\u2026" : "Start this standing cost"}</button>
      </div>
    </form>
  );
}
