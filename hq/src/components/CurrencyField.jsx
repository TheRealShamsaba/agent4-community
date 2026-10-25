import React, { useState } from "react";
import { Check, X } from "lucide-react";

/**
 * Choosing a currency, not typing one.
 *
 * A three-letter free-text box passes "IRT" as happily as "IRR", and a typo
 * becomes a fourth bucket that every report counts separately and nothing can
 * merge back. So the normal path is a list of the currencies already in the
 * books, and opening a genuinely new one is a deliberate second step.
 */
export function CurrencyField({ value, onChange, currencies = [], label = "Currency", className = "narrow" }) {
  const known = [...new Set(currencies.filter(Boolean))].sort();
  const [adding, setAdding] = useState(() => Boolean(value) && !known.includes(value));
  const [draft, setDraft] = useState("");

  function confirm() {
    const code = draft.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return;
    onChange(code);
    setDraft("");
    setAdding(false);
  }

  if (adding || !known.length) {
    return (
      <label className={`${className} currency-field`}>
        <span>New currency</span>
        <div className="currency-new">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); confirm(); } }}
            maxLength={3}
            placeholder="USD"
            aria-label="Three-letter currency code"
            autoFocus={known.length > 0}
          />
          <button type="button" onClick={confirm} disabled={!/^[A-Z]{3}$/.test(draft.trim())} aria-label="Use this currency">
            <Check size={14} />
          </button>
          {known.length ? (
            <button type="button" onClick={() => { setAdding(false); setDraft(""); }} aria-label="Back to the currencies you already use">
              <X size={14} />
            </button>
          ) : null}
        </div>
        <em>Three letters, as the bank writes it: IRR, TRY, USD.</em>
      </label>
    );
  }

  return (
    <label className={`${className} currency-field`}>
      <span>{label}</span>
      <select
        value={known.includes(value) ? value : ""}
        onChange={(event) => {
          if (event.target.value === "__new") { setAdding(true); return; }
          onChange(event.target.value);
        }}
      >
        {known.includes(value) ? null : <option value="" disabled>Pick a currency</option>}
        {known.map((code) => <option key={code} value={code}>{code}</option>)}
        <option value="__new">Add a new currency…</option>
      </select>
    </label>
  );
}

/** The same choice as a row of buttons, where there is room for it. */
export function CurrencyTabs({ value, currencies, onChange }) {
  if (currencies.length < 2) return null;
  return (
    <div className="mp-cur c12">
      {currencies.map((code) => (
        <button key={code} type="button" className={code === value ? "on" : ""} onClick={() => onChange(code)}>
          {code}
        </button>
      ))}
      <span className="mp-note">Currencies are never added together.</span>
    </div>
  );
}
