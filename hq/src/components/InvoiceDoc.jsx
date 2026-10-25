import React, { useEffect } from "react";
import { jalaliLabel } from "./persian-date.js";

const STRINGS = {
  en: {
    invoice: "Invoice",
    billedTo: "Billed to",
    issued: "Issued",
    due: "Due",
    description: "Description",
    qty: "Qty",
    unitPrice: "Unit price",
    amount: "Amount",
    subtotal: "Subtotal",
    total: "Total",
    payment: "How to pay",
    notes: "Notes",
    terms: "Terms",
    taxId: "Tax number",
    paid: "Paid",
    void: "Void",
    overdue: "Overdue",
    noDate: "\u2014"
  },
  fa: {
    invoice: "\u0641\u0627\u06a9\u062a\u0648\u0631",
    billedTo: "\u0635\u0648\u0631\u062a\u062d\u0633\u0627\u0628 \u0628\u0631\u0627\u06cc",
    issued: "\u062a\u0627\u0631\u06cc\u062e \u0635\u062f\u0648\u0631",
    due: "\u0633\u0631\u0631\u0633\u06cc\u062f",
    description: "\u0634\u0631\u062d",
    qty: "\u062a\u0639\u062f\u0627\u062f",
    unitPrice: "\u0642\u06cc\u0645\u062a \u0648\u0627\u062d\u062f",
    amount: "\u0645\u0628\u0644\u063a",
    subtotal: "\u062c\u0645\u0639 \u062c\u0632\u0621",
    total: "\u062c\u0645\u0639 \u06a9\u0644",
    payment: "\u0627\u0637\u0644\u0627\u0639\u0627\u062a \u067e\u0631\u062f\u0627\u062e\u062a",
    notes: "\u062a\u0648\u0636\u06cc\u062d\u0627\u062a",
    terms: "\u0634\u0631\u0627\u06cc\u0637",
    taxId: "\u0634\u0646\u0627\u0633\u0647 \u0645\u0627\u0644\u06cc\u0627\u062a\u06cc",
    paid: "\u067e\u0631\u062f\u0627\u062e\u062a \u0634\u062f",
    void: "\u0628\u0627\u0637\u0644",
    overdue: "\u0645\u0639\u0648\u0642",
    noDate: "\u2014"
  }
};

/** Digits in the reader's own numerals, grouped so a nine-figure sum is legible. */
function money(amount, language) {
  return new Intl.NumberFormat(language === "fa" ? "fa-IR" : "en-US", {
    maximumFractionDigits: 2,
    useGrouping: true
  }).format(Number(amount) || 0);
}

/**
 * Dates on the document follow the reader, not the app. A client in Tehran
 * reads Shahrivar and a client in Istanbul reads September, and this is the one
 * surface where that matters — everywhere else in HQ the date is the app's own
 * single format so two dates can be compared.
 */
function showDate(iso, language, fallback) {
  if (!iso) return fallback;
  if (language === "fa") return jalaliLabel(iso) || iso;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * What the money is called on the page, and what the stored amount has to be
 * divided by to be that. A currency code says what the money is; a display unit
 * says what the client reads. Getting that wrong is how an invoice for
 * 180,000,000 rials goes out reading "180,000,000 Toman" — ten times the price.
 */
function displayUnit(invoice, profile, language) {
  const stored = invoice.displayUnit || profile?.unitLabels?.[invoice.currency] || null;
  if (!stored) return { label: invoice.currency, divisor: 1 };
  if (typeof stored === "object") {
    const divisor = Number(stored.divisor) > 0 ? Number(stored.divisor) : 1;
    return { label: stored[language] || stored.en || stored.fa || invoice.currency, divisor };
  }
  // Older profiles stored one bilingual string and no divisor at all.
  const halves = String(stored).split("/").map((part) => part.trim()).filter(Boolean);
  if (halves.length === 2) return { label: language === "fa" ? halves[0] : halves[1], divisor: 1 };
  return { label: String(stored), divisor: 1 };
}

/**
 * The document a client receives. Written in one language throughout — a
 * document that says everything twice reads like a form, not like a company.
 */
export function InvoiceDoc({ invoice, profile }) {
  const language = invoice.language === "fa" ? "fa" : "en";
  const t = STRINGS[language];
  const rtl = language === "fa";
  const unit = displayUnit(invoice, profile, language);
  const detail = rtl ? (profile?.detailFa || profile?.detail) : (profile?.detail || profile?.detailFa);
  const payTo = rtl ? (profile?.payToFa || profile?.payTo) : (profile?.payTo || profile?.payToFa);

  // Everything printed is in the display unit, lines included: a total in
  // tomans over unit prices in rials is a document nobody can check.
  const inUnit = (amount) => (Number(amount) || 0) / unit.divisor;
  const subtotal = invoice.subtotal === undefined
    ? invoice.lines.reduce((sum, line) => sum + line.amount, 0)
    : invoice.subtotal;
  const taxRate = Number(invoice.taxRate) || 0;
  const taxAmount = Number(invoice.taxAmount) || 0;
  const total = invoice.displayTotal === undefined ? inUnit(invoice.total) : invoice.displayTotal;
  const taxLabel = invoice.taxLabel || (language === "fa" ? "\u0645\u0627\u0644\u06cc\u0627\u062a" : "Tax");

  /* Printing is scoped to this class rather than to every page in the app. The
     print rules used to hide `body *` unconditionally, which is why printing
     anything else in HQ came out blank. */
  useEffect(() => {
    document.documentElement.classList.add("is-printing-invoice");
    return () => document.documentElement.classList.remove("is-printing-invoice");
  }, []);

  return (
    <article className={`invoice-doc ${rtl ? "is-rtl" : ""}`} dir={rtl ? "rtl" : "ltr"} lang={language}>
      <div className="idoc-rule" />

      <header className="idoc-head">
        <div className="idoc-from">
          <div className="idoc-brand">
            <span className="idoc-ball" aria-hidden="true" />
            <h1 dir="ltr">{profile?.name || "Your company"}</h1>
          </div>
          {detail ? <p dir="auto">{detail}</p> : null}
          {profile?.taxId ? <p className="idoc-taxid" dir="auto">{t.taxId}: {profile.taxId}</p> : null}
        </div>
        <div className="idoc-mark">
          <div className="idoc-title">{t.invoice}</div>
          <div className="idoc-number" dir="ltr">{invoice.number}</div>
          {invoice.status === "paid" ? <div className="idoc-stamp paid">{t.paid}</div> : null}
          {invoice.status === "void" ? <div className="idoc-stamp void">{t.void}</div> : null}
          {invoice.overdue ? <div className="idoc-stamp overdue">{t.overdue}</div> : null}
        </div>
      </header>

      <section className="idoc-meta">
        <div className="idoc-client">
          <span className="idoc-lbl">{t.billedTo}</span>
          <strong dir="auto">{invoice.clientName}</strong>
          {invoice.clientDetail ? <p dir="auto">{invoice.clientDetail}</p> : null}
        </div>
        <div>
          <span className="idoc-lbl">{t.issued}</span>
          <strong>{showDate(invoice.issueOn, language, t.noDate)}</strong>
        </div>
        <div>
          <span className="idoc-lbl">{invoice.status === "paid" ? t.paid : t.due}</span>
          <strong>{showDate(invoice.status === "paid" ? invoice.paidOn || invoice.dueOn : invoice.dueOn, language, t.noDate)}</strong>
        </div>
      </section>

      <div className="idoc-tablewrap">
        <table className="idoc-table">
          <thead>
            <tr>
              <th className="c-desc">{t.description}</th>
              <th className="c-num">{t.qty}</th>
              <th className="c-num">{t.unitPrice}</th>
              <th className="c-num">{t.amount}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td className="c-desc" dir="auto">{line.description}</td>
                <td className="c-num">{money(line.quantity, language)}</td>
                <td className="c-num">{money(inUnit(line.unitPrice), language)}</td>
                <td className="c-num">{money(inUnit(line.amount), language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="idoc-total">
        <div className="idoc-sums">
          <div className="idoc-sum">
            <span>{t.subtotal}</span>
            <b>{money(inUnit(subtotal), language)}</b>
          </div>
          {taxRate ? (
            <div className="idoc-sum">
              <span>{taxLabel} {money(taxRate, language)}%</span>
              <b>{money(inUnit(taxAmount), language)}</b>
            </div>
          ) : null}
          <div className="idoc-total-box">
            <span className="idoc-lbl on-ink">{t.total}</span>
            <div className="idoc-amount">
              <span>{money(total, language)}</span>
              <em dir="auto">{unit.label}</em>
            </div>
          </div>
        </div>
      </section>

      <section className="idoc-tail">
        {payTo ? (
          <div>
            <span className="idoc-lbl">{t.payment}</span>
            <p dir="auto">{payTo}</p>
          </div>
        ) : null}
        {invoice.notes ? (
          <div>
            <span className="idoc-lbl">{t.notes}</span>
            <p dir="auto">{invoice.notes}</p>
          </div>
        ) : null}
        {invoice.terms ? (
          <div>
            <span className="idoc-lbl">{t.terms}</span>
            <p dir="auto">{invoice.terms}</p>
          </div>
        ) : null}
      </section>

      {profile?.footer ? <footer className="idoc-foot" dir="auto">{profile.footer}</footer> : null}
    </article>
  );
}
