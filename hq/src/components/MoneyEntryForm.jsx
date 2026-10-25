import React, { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { exactAmount, localIsoDate } from "../format.js";
import { CurrencyField } from "./CurrencyField.jsx";
import { CompanyPicker, companyName } from "./CompanyPicker.jsx";
import { jalaliInputValue, jalaliLabel, parseJalaliInput } from "./persian-date.js";

const CATEGORIES = {
  in: [["client", "Client payment"], ["other", "Other income"]],
  out: [["running", "Running costs"], ["people", "Us"], ["contractor", "Contractor"], ["billable", "Client-billable"]]
};

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

/**
 * The date, in both calendars.
 *
 * Half of what Alex records comes off an Iranian receipt, where the date is
 * Jalali and nothing else. Typing that into a Gregorian box by hand is exactly
 * where a day goes missing, so the Persian reading is always shown and can be
 * typed into directly.
 */
function DateField({ label, value, onChange, required = false }) {
  const [persian, setPersian] = useState(false);
  const [draft, setDraft] = useState("");

  const shown = persian ? (draft || jalaliInputValue(value)) : value;

  function typePersian(text) {
    setDraft(text);
    const iso = parseJalaliInput(text);
    if (iso) onChange(iso);
  }

  return (
    <label className="narrow money-date">
      <span>
        {label}
        <button type="button" className="money-cal" onClick={() => { setPersian((on) => !on); setDraft(""); }}>
          {persian ? "Gregorian" : "\u0634\u0645\u0633\u06cc"}
        </button>
      </span>
      {persian ? (
        <input
          value={shown}
          onChange={(event) => typePersian(event.target.value)}
          placeholder="1405/06/23"
          inputMode="numeric"
          dir="ltr"
          aria-label={`${label}, Persian calendar`}
        />
      ) : (
        <input type="date" value={value} onChange={(event) => onChange(event.target.value)} required={required} />
      )}
      <em dir="rtl" lang="fa">{persian ? (value || "no date yet") : (jalaliLabel(value) || "\u2014")}</em>
    </label>
  );
}

/** A single movement of money: recorded, corrected, or struck out. */
export function MoneyEntryForm({ onClose, onSaved, currencies = [], entry = null, companies = { status: "ready", list: [] }, raisedBy = null }) {
  const editing = Boolean(entry);
  const [direction, setDirection] = useState(entry?.direction || "in");
  const [form, setForm] = useState({
    amount: entry ? String(entry.amount) : "",
    currency: entry?.currency || currencies[0] || "USD",
    category: entry?.category || "client",
    occurredOn: entry?.occurredOn || localIsoDate(),
    counterparty: entry?.counterparty || "",
    companyId: entry?.companyId || "",
    note: entry?.note || "",
    status: entry?.status || "settled",
    dueOn: entry?.dueOn || ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = useRef(false);
  // The name a pick last wrote into the counterparty box. Anything else in
  // there was typed by hand and is never overwritten.
  const filled = useRef("");
  /* Normally the caller knows which invoice raised this entry and the picker is
     never offered. It can still be wrong — the invoice list it looks in is
     capped — so a refusal from the server locks the field the same way rather
     than leaving a choice on screen that cannot be saved. */
  const [refusedBy, setRefusedBy] = useState("");

  const heldByInvoice = Boolean(raisedBy) || Boolean(refusedBy);
  const holdingNumber = raisedBy?.number || refusedBy;

  const set = (key) => (event) => {
    dirty.current = true;
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  /**
   * A stray click on the backdrop used to throw away everything typed. Nothing
   * here is recoverable, so the backdrop no longer closes at all: the X, Cancel
   * and Escape do, and any of them asks first once something has been typed.
   */
  function requestClose() {
    if (dirty.current && !window.confirm("Close without saving? What you typed here is not kept.")) return;
    onClose();
  }

  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
  useEffect(() => {
    function onKey(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Linking a company also offers its name to the ledger, because a row with
   * no name against it tells nobody anything. It only fills an empty box, or
   * one still holding the name a previous pick put there: a name typed by hand
   * is the one that should print, and quietly replacing it would be a lie
   * about what was actually recorded.
   */
  function pickCompany(id, company) {
    dirty.current = true;
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
    dirty.current = true;
    setDirection(next);
    setForm((current) => ({ ...current, category: CATEGORIES[next][0][0], status: "settled", dueOn: "" }));
  }

  const amount = Number(form.amount);
  const refund = Number.isFinite(amount) && amount < 0;

  async function submit(event) {
    event.preventDefault();
    if (!Number.isFinite(amount) || amount === 0) {
      setError("Amount cannot be zero. A refund is recorded as a negative amount against the direction it reverses.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await moneyRequest(editing ? `/entries/${entry.id}` : "/entries", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          direction,
          amount,
          currency: form.currency,
          category: form.category,
          occurredOn: form.occurredOn,
          counterparty: form.counterparty,
          /* Always sent, never left out: an edit that clears the company has to
             reach the server as an empty one, not as a field it never saw. The
             exception is an entry an invoice raised, whose company is the
             invoice's to set — leaving the field out is how the server is told
             to keep what it has. */
          ...(heldByInvoice ? {} : { companyId: form.companyId || null }),
          note: form.note,
          status: form.status,
          dueOn: form.status === "pending" && form.dueOn ? form.dueOn : undefined
        })
      });
      dirty.current = false;
      onSaved();
      onClose();
    } catch (problem) {
      /* The one refusal worth reading rather than repeating: the company on
         this row belongs to the invoice that raised it. Put the entry's own
         company back and stop offering the choice, so the next attempt is not
         the same attempt. */
      const held = /^Invoice (.+) raised this entry\./.exec(problem.message);
      if (held) {
        setRefusedBy(held[1]);
        setForm((current) => ({ ...current, companyId: entry?.companyId || "" }));
      }
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this entry? The books will no longer include it.")) return;
    setBusy(true);
    setError("");
    try {
      await moneyRequest(`/entries/${entry.id}`, { method: "DELETE" });
      dirty.current = false;
      onSaved();
      onClose();
    } catch (problem) {
      setError(problem.message);
      setBusy(false);
    }
  }

  return (
    <div className="money-scrim" role="presentation">
      <div className="money-sheet money-sheet--page" role="dialog" aria-label={editing ? "Edit entry" : "Record money"}>
        <form onSubmit={submit}>
          <header>
            <div className="money-dir">
              <button type="button" className={direction === "in" ? "on" : ""} onClick={() => switchDirection("in")}>Money in</button>
              <button type="button" className={direction === "out" ? "on" : ""} onClick={() => switchDirection("out")}>Money out</button>
            </div>
            <button type="button" className="money-x" onClick={requestClose} aria-label="Close"><X size={15} /></button>
          </header>

          <div className="money-row">
            <label className="grow">
              <span>Amount</span>
              <input type="number" step="0.01" required value={form.amount} onChange={set("amount")} placeholder="240000000" autoFocus />
            </label>
            <CurrencyField
              value={form.currency}
              currencies={currencies}
              onChange={(code) => { dirty.current = true; setForm((current) => ({ ...current, currency: code })); }}
            />
          </div>
          <p className="money-hint">
            {refund
              ? `A negative amount reverses money ${direction === "in" ? "that came in" : "that went out"}: ${exactAmount(Math.abs(amount), { currency: form.currency })} goes back. It is filed against the same direction, so the original is reduced rather than a stray cost appearing.`
              : "A refund or a chargeback is a negative amount here, recorded against the direction it reverses."}
          </p>

          <div className="money-row">
            <label className="grow">
              <span>{direction === "in" ? "From" : "To"}</span>
              <input value={form.counterparty} onChange={set("counterparty")} placeholder={direction === "in" ? "Client name" : "Hetzner"} dir="auto" />
            </label>
            <DateField
              label="Date"
              value={form.occurredOn}
              required
              onChange={(iso) => { dirty.current = true; setForm((current) => ({ ...current, occurredOn: iso })); }}
            />
          </div>

          {heldByInvoice ? (
            <div className="company-held">
              <span>Which company this is for</span>
              <strong dir="auto">{companyName(companies, form.companyId) || (form.companyId ? "A company" : "Nobody")}</strong>
              <em>
                Invoice {holdingNumber} raised this entry, so its company is the invoice's to set. Change it on the invoice and this
                row follows.
              </em>
            </div>
          ) : (
            <CompanyPicker
              companies={companies}
              value={form.companyId}
              onChange={pickCompany}
              label={direction === "in" ? "Which company paid" : "Which company this is for"}
              noneLabel={"Nobody in the CRM \u2014 a one-off"}
              hint={"Optional. Running costs and what you pay yourselves usually belong to no company; linking one is what makes it show on that company's page."}
            />
          )}

          <label>
            <span>What for</span>
            <select value={form.category} onChange={set("category")}>
              {CATEGORIES[direction].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>

          <label>
            <span>Note</span>
            <input value={form.note} onChange={set("note")} placeholder="What this was for" dir="auto" />
          </label>

          {direction === "in" ? (
            <div className="money-row">
              <label className="grow">
                <span>Status</span>
                <select value={form.status} onChange={set("status")}>
                  <option value="settled">Paid</option>
                  <option value="pending">Invoiced, not paid</option>
                </select>
              </label>
              {form.status === "pending" ? (
                <DateField
                  label="Due"
                  value={form.dueOn}
                  onChange={(iso) => { dirty.current = true; setForm((current) => ({ ...current, dueOn: iso })); }}
                />
              ) : null}
            </div>
          ) : null}

          {entry?.fromRecurring ? (
            <p className="money-hint">This was posted automatically by a standing cost. Editing it here changes the books, not the standing cost.</p>
          ) : null}
          {error ? <p className="money-error" role="alert">{error}</p> : null}
          <div className="money-foot">
            {editing ? (
              <button type="button" className="money-del" onClick={remove} disabled={busy}><Trash2 size={13} /> Delete</button>
            ) : null}
            <button type="button" className="money-cancel" onClick={requestClose}>Cancel</button>
            <button type="submit" className="money-save" disabled={busy}>{busy ? "Saving\u2026" : editing ? "Save changes" : "Save entry"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
