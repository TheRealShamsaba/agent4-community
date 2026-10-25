import React, { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

const TEXT_FIELDS = ["name", "detail", "detailFa", "payTo", "payToFa", "footer", "taxId"];

/** The stored map turned into rows, so a currency can be added or dropped. */
function unitRows(unitLabels) {
  return Object.entries(unitLabels || {}).map(([currency, unit]) => ({
    currency,
    fa: unit?.fa || "",
    en: unit?.en || "",
    divisor: String(unit?.divisor ?? 1)
  }));
}

/**
 * Who the invoice is from, and what the money on it is called.
 *
 * The unit editor is here because the default lied for a year: it printed IRR
 * as "Toman" while dividing by nothing, so every Iranian invoice went out at
 * ten times the real price. A unit is now a word plus the number the stored
 * amount is divided by, and both are the owner's to set.
 */
export function InvoiceProfile({ profile, onClose, onSaved, request }) {
  const [form, setForm] = useState(() => Object.fromEntries(TEXT_FIELDS.map((key) => [key, profile?.[key] || ""])));
  const [units, setUnits] = useState(() => unitRows(profile?.unitLabels));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const patchUnit = (index, patch) => setUnits((current) =>
    current.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  const setUnit = (index, key) => (event) => patchUnit(index, { [key]: event.target.value });

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const unitLabels = {};
      for (const row of units) {
        const currency = row.currency.trim().toUpperCase();
        if (!currency) continue;
        unitLabels[currency] = { fa: row.fa.trim(), en: row.en.trim(), divisor: Number(row.divisor) };
      }
      const body = await request("/profile", { method: "PUT", body: JSON.stringify({ ...form, unitLabels }) });
      onSaved(body.profile);
      onClose();
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="money-scrim" role="presentation">
      <div className="inv-editor" role="dialog" aria-label="Your details on invoices">
        <form onSubmit={submit}>
          <header>
            <strong>Your details on invoices</strong>
            <button type="button" className="money-x" onClick={onClose} aria-label="Close"><X size={15} /></button>
          </header>

          <label><span>Company name</span><input value={form.name} onChange={set("name")} placeholder="Your company" /></label>
          <label><span>Address and contact</span><input value={form.detail} onChange={set("detail")} dir="auto" /></label>
          <label><span>{"\u0622\u062f\u0631\u0633 \u0648 \u062a\u0645\u0627\u0633"}</span><input value={form.detailFa} onChange={set("detailFa")} dir="rtl" /></label>
          <label>
            <span>Tax number</span>
            <input value={form.taxId} onChange={set("taxId")} dir="auto" placeholder="KDV / VAT registration" />
            <em>Printed under your address. Turkey and Iran both want it on the face of the invoice.</em>
          </label>
          <label><span>How to pay</span><input value={form.payTo} onChange={set("payTo")} dir="auto" placeholder="Bank Mellat · 1234 5678" /></label>
          <label><span>{"\u0627\u0637\u0644\u0627\u0639\u0627\u062a \u067e\u0631\u062f\u0627\u062e\u062a"}</span><input value={form.payToFa} onChange={set("payToFa")} dir="rtl" /></label>
          <label><span>Footer line</span><input value={form.footer} onChange={set("footer")} dir="auto" /></label>

          <div className="inv-units">
            <div className="inv-units-head">
              <strong>What the money is called</strong>
              <p>The divisor turns the stored amount into the unit you print. One rial is one rial, so IRR divides by 1; to bill in tomans, keep the currency IRR and divide by 10.</p>
            </div>
            <div className="inv-unit-row inv-unit-row--head">
              <span>Currency</span><span>{"\u0641\u0627\u0631\u0633\u06cc"}</span><span>English</span><span>Divide by</span><span />
            </div>
            {units.map((row, index) => (
              <div key={index} className="inv-unit-row">
                <input value={row.currency} onChange={(event) => patchUnit(index, { currency: event.target.value.toUpperCase() })}
                  maxLength={3} aria-label="Currency code" placeholder="IRR" />
                <input value={row.fa} onChange={setUnit(index, "fa")} dir="rtl" aria-label="Unit in Persian" placeholder={"\u0631\u06cc\u0627\u0644"} />
                <input value={row.en} onChange={setUnit(index, "en")} dir="auto" aria-label="Unit in English" placeholder="Rial" />
                <input value={row.divisor} onChange={setUnit(index, "divisor")} type="number" min="0.0001" step="any" aria-label="Divisor" />
                <button type="button" onClick={() => setUnits((current) => current.filter((_, position) => position !== index))} aria-label="Remove this unit">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button type="button" className="inv-addline" onClick={() => setUnits((current) => [...current, { currency: "", fa: "", en: "", divisor: "1" }])}>
              <Plus size={13} /> Add a currency
            </button>
          </div>

          {error ? <p className="money-error" role="alert">{error}</p> : null}
          <button type="submit" className="money-save" disabled={busy}>{busy ? "Saving\u2026" : "Save details"}</button>
        </form>
      </div>
    </div>
  );
}
