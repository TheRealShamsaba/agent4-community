import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FileText, Plus, Printer, Trash2, X } from "lucide-react";
import { InvoiceDoc } from "./InvoiceDoc.jsx";
import { InvoiceProfile } from "./InvoiceProfile.jsx";
import { CurrencyField } from "./CurrencyField.jsx";
import { CompanyFilterBar, CompanyPicker, CompanyTag, companyName, NO_COMPANY, useCompanies } from "./CompanyPicker.jsx";
import { addDays, dueLabel, exactAmount, formatDate, localIsoDate } from "../format.js";

const STATUS_LABEL = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  void: "Void"
};

/* The invoices raised against nobody in the CRM — the ones that never reach a
   company page. The server answers for them in SQL, before the row cap and
   before the overdue-first sort, so the page sends its spelling unchanged. */
const UNATTRIBUTED = NO_COMPANY;

/* The server's own page size for a listing. Reaching it means there are more
   invoices than the counts beside the filters can honestly speak for. */
const LIST_LIMIT = 100;

const FILTERS = [
  ["all", "All"],
  ["overdue", "Overdue"],
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["paid", "Paid"],
  ["void", "Void"]
];

async function request(pathname, options = {}) {
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

/** The pill an invoice wears in the list. Overdue outranks the status it is in. */
function StatusPill({ invoice }) {
  if (invoice.overdue) {
    return <span className="pill pill--bad inv-status">Overdue</span>;
  }
  return <span className={`inv-status s-${invoice.status}`}>{STATUS_LABEL[invoice.status]}</span>;
}

function Editor({ invoice, currencies, companies, nextNumber, onClose, onSaved }) {
  const editing = Boolean(invoice);
  const [form, setForm] = useState({
    number: invoice?.number || nextNumber || "",
    companyId: invoice?.companyId || "",
    clientName: invoice?.clientName || "",
    clientDetail: invoice?.clientDetail || "",
    issueOn: invoice?.issueOn || localIsoDate(),
    dueOn: invoice?.dueOn || addDays(localIsoDate(), 30),
    currency: invoice?.currency || currencies[0] || "USD",
    notes: invoice?.notes || "",
    terms: invoice?.terms || "",
    language: invoice?.language || "en",
    taxRate: invoice ? String(invoice.taxRate ?? 0) : "0",
    taxLabel: invoice?.taxLabel || ""
  });
  const [lines, setLines] = useState(
    invoice?.lines?.length
      ? invoice.lines.map((line) => ({ description: line.description, quantity: String(line.quantity), unitPrice: String(line.unitPrice) }))
      : [{ description: "", quantity: "1", unitPrice: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = useRef(false);
  // The name a pick last wrote into the client box. Anything else there was
  // typed by hand and is the name that should print on the paper.
  const filled = useRef("");

  const set = (key) => (event) => {
    dirty.current = true;
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };
  const setLine = (index, key) => (event) => {
    dirty.current = true;
    setLines((current) => current.map((line, position) => (position === index ? { ...line, [key]: event.target.value } : line)));
  };

  /* The picked company decides where the money is counted; the typed name is
     what the client reads on the paper. They start the same and are allowed to
     diverge — a company filed as "Sample Studio" can still be invoiced to "Sample Studio
     Holding A.Ş." without breaking the link. */
  function pickCompany(id, company) {
    dirty.current = true;
    const typed = form.clientName.trim();
    const replaceable = !typed || typed === filled.current;
    if (company && replaceable) filled.current = company.name;
    setForm((current) => ({
      ...current,
      companyId: id,
      clientName: company && replaceable ? company.name : current.clientName
    }));
  }

  const subtotal = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), 0);
  const taxRate = Math.min(100, Math.max(0, Number(form.taxRate) || 0));
  const taxAmount = subtotal * taxRate / 100;

  /* An invoice with ten typed lines is not recoverable, so the backdrop no
     longer closes the dialog and every deliberate close asks once. */
  function requestClose() {
    if (dirty.current && !window.confirm("Close without saving? The lines you typed are not kept.")) return;
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

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        number: form.number.trim(),
        taxRate,
        lines: lines
          .filter((line) => line.description.trim())
          .map((line) => ({ description: line.description, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }))
      };
      // The number is the invoice's identity; an edit never renumbers one.
      if (editing) delete payload.number;
      const body = editing
        ? await request(`/${invoice.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await request("", { method: "POST", body: JSON.stringify(payload) });
      dirty.current = false;
      onSaved(body.invoice);
      onClose();
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="money-scrim" role="presentation">
      <div className="inv-editor" role="dialog" aria-label={editing ? "Edit invoice" : "New invoice"}>
        <form onSubmit={submit}>
          <header>
            <strong>{editing ? `Invoice ${invoice.number}` : "New invoice"}</strong>
            {editing ? null : (
              <label className="inv-number">
                <span>Number</span>
                <input value={form.number} onChange={set("number")} required dir="ltr" placeholder={nextNumber || "2026-001"} />
              </label>
            )}
            <button type="button" className="money-x" onClick={requestClose} aria-label="Close"><X size={15} /></button>
          </header>

          <CompanyPicker
            companies={companies}
            value={form.companyId}
            onChange={pickCompany}
            label="Which company this is for"
            noneLabel={"Nobody in the CRM \u2014 a one-off"}
            hint="Nearly every invoice is for a company already in the CRM, and linking it is what puts the invoice — and the money it raises — on that company's page."
          />

          <div className="money-row">
            <label className="grow"><span>Name on the invoice</span>
              <input value={form.clientName} onChange={set("clientName")} required dir="auto" placeholder="Parsian" /></label>
            <CurrencyField
              value={form.currency}
              currencies={currencies}
              onChange={(code) => { dirty.current = true; setForm((current) => ({ ...current, currency: code })); }}
            />
          </div>

          <label><span>Client address or details</span>
            <input value={form.clientDetail} onChange={set("clientDetail")} dir="auto" placeholder="City · contact details" /></label>

          <div className="inv-lang">
            <span>Written in</span>
            <button type="button" className={form.language === "en" ? "on" : ""} onClick={() => { dirty.current = true; setForm((c) => ({ ...c, language: "en" })); }}>English</button>
            <button type="button" className={form.language === "fa" ? "on" : ""} onClick={() => { dirty.current = true; setForm((c) => ({ ...c, language: "fa" })); }}>{"\u0641\u0627\u0631\u0633\u06cc"}</button>
          </div>

          <div className="money-row">
            <label className="grow"><span>Issued</span>
              <input type="date" value={form.issueOn} onChange={set("issueOn")} required /></label>
            <label className="grow"><span>Due</span>
              <input type="date" value={form.dueOn} onChange={set("dueOn")} /></label>
          </div>

          <div className="inv-lines">
            <div className="inv-lines-head">
              <span>Description</span><span>Qty</span><span>Unit price</span><span />
            </div>
            {lines.map((line, index) => (
              <div key={index} className="inv-line">
                <label className="inv-line-field inv-line-description"><span>Description</span><input aria-label={`Line ${index + 1} description`} value={line.description} onChange={setLine(index, "description")} dir="auto" placeholder="Website redesign" /></label>
                <label className="inv-line-field"><span>Quantity</span><input aria-label={`Line ${index + 1} quantity`} type="number" min="0" step="any" value={line.quantity} onChange={setLine(index, "quantity")} /></label>
                <label className="inv-line-field"><span>Unit price</span><input aria-label={`Line ${index + 1} unit price`} type="number" min="0" step="any" value={line.unitPrice} onChange={setLine(index, "unitPrice")} placeholder="180000000" /></label>
                <button type="button" onClick={() => { dirty.current = true; setLines((current) => current.filter((_, position) => position !== index)); }}
                  disabled={lines.length === 1} aria-label="Remove line"><Trash2 size={13} /></button>
              </div>
            ))}
            <button type="button" className="inv-addline" onClick={() => setLines((current) => [...current, { description: "", quantity: "1", unitPrice: "" }])}>
              <Plus size={13} /> Add a line
            </button>
          </div>

          <div className="money-row">
            <label className="narrow"><span>Tax rate</span>
              <input type="number" min="0" max="100" step="any" value={form.taxRate} onChange={set("taxRate")} /></label>
            <label className="grow"><span>What the tax is called</span>
              <input value={form.taxLabel} onChange={set("taxLabel")} dir="auto" placeholder="KDV, VAT, or leave blank" />
              <em>Turkey bills KDV and Iran bills VAT, so the rate and the word both belong to the invoice, not to the company.</em>
            </label>
          </div>

          <div className="inv-total-preview">
            <div className="inv-sum"><span>Subtotal</span><b className="mono">{exactAmount(subtotal, { currency: form.currency })}</b></div>
            {taxRate ? (
              <div className="inv-sum"><span>{form.taxLabel.trim() || "Tax"} {taxRate}%</span><b className="mono">{exactAmount(taxAmount, { currency: form.currency })}</b></div>
            ) : null}
            <div className="inv-sum inv-sum--total"><span>Total</span><b className="mono">{exactAmount(subtotal + taxAmount, { currency: form.currency })}</b></div>
          </div>

          <label><span>Notes</span>
            <input value={form.notes} onChange={set("notes")} dir="auto" placeholder="Thanks for the work" /></label>
          <label><span>Terms</span>
            <input value={form.terms} onChange={set("terms")} dir="auto" placeholder="Payment within 30 days" /></label>

          {error ? <p className="money-error" role="alert">{error}</p> : null}
          <div className="money-foot">
            <button type="button" className="money-cancel" onClick={requestClose}>Cancel</button>
            <button type="submit" className="money-save" disabled={busy}>{busy ? "Saving\u2026" : editing ? "Save invoice" : "Create invoice"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Invoices, and the one that is open for reading. */
export function Invoices({ onBack, currencies = [] }) {
  const [data, setData] = useState({ status: "loading", invoices: [], profile: {}, nextNumber: "" });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("");
  const [paidOn, setPaidOn] = useState(() => localIsoDate());
  const [actionError, setActionError] = useState("");
  const [scoped, setScoped] = useState({ status: "idle", invoices: [], message: "" });
  const [refresh, setRefresh] = useState(0);
  const companies = useCompanies();

  const load = useCallback(async () => {
    // The filtered list is its own request, so anything that refreshes this one
    // has to tell it to refresh too.
    setRefresh((count) => count + 1);
    try {
      const body = await request("");
      setData({ status: "ready", invoices: body.invoices, profile: body.profile, nextNumber: body.nextNumber || "" });
      setOpen((current) => (current ? body.invoices.find((item) => item.id === current.id) || null : null));
    } catch (error) {
      setData({ status: "error", message: error.message, invoices: [], profile: {}, nextNumber: "" });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Narrowing to one company is the server's query, not a sieve over what is
   * on screen: it is applied before the hundred-row cap and before the
   * overdue-first sort, so the company's oldest invoice cannot fall off the end
   * of a list it was never really in. The unfiltered list stays loaded because
   * the counts beside the filters are counts of everything.
   */
  useEffect(() => {
    if (!companyFilter) {
      setScoped({ status: "idle", invoices: [], message: "" });
      return undefined;
    }
    let live = true;
    setScoped({ status: "loading", invoices: [], message: "" });
    request(`?companyId=${encodeURIComponent(companyFilter)}`)
      .then((body) => { if (live) setScoped({ status: "ready", invoices: body.invoices || [], message: "" }); })
      .catch((error) => { if (live) setScoped({ status: "error", invoices: [], message: error.message }); });
    return () => { live = false; };
  }, [companyFilter, refresh]);

  const listed = companyFilter ? scoped.invoices : data.invoices;
  const shown = useMemo(() => {
    if (filter === "all") return listed;
    if (filter === "overdue") return listed.filter((invoice) => invoice.overdue);
    return listed.filter((invoice) => invoice.status === filter);
  }, [listed, filter]);

  const overdueCount = listed.filter((invoice) => invoice.overdue).length;
  const looseCount = data.invoices.filter((invoice) => !invoice.companyId).length;
  /* Counts beside the filters are counts of everything, and everything stops at
     the server's page size. The filters themselves are exact; only the tallies
     have to hedge. */
  const capped = data.invoices.length === LIST_LIMIT;
  const firmOptions = useMemo(() => {
    const counts = new Map();
    for (const invoice of data.invoices) {
      if (invoice.companyId) counts.set(invoice.companyId, (counts.get(invoice.companyId) || 0) + 1);
    }
    const options = [{ value: "", label: "Everyone", count: data.invoices.length }];
    for (const company of companies.list) {
      if (counts.has(company.id)) options.push({ value: company.id, label: company.name, count: counts.get(company.id) });
    }
    if (companyFilter && companyFilter !== UNATTRIBUTED && !options.some((option) => option.value === companyFilter)) {
      options.push({ value: companyFilter, label: companyName(companies, companyFilter) || "This company", count: 0 });
    }
    if (looseCount && companies.list.length) {
      options.push({ value: UNATTRIBUTED, label: capped ? "Nobody (at least)" : "Nobody", count: looseCount, tone: "warn" });
    }
    return options;
  }, [data.invoices, companies, companyFilter, looseCount, capped]);

  /* Every one of these can be refused — a paid invoice cannot be edited, an
     empty one cannot be sent — and silence used to be the only answer. */
  async function move(invoice, status, extra = {}) {
    setActionError("");
    try {
      await request(`/${invoice.id}/status`, { method: "POST", body: JSON.stringify({ status, ...extra }) });
      await load();
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function remove(invoice) {
    if (!window.confirm(`Delete invoice ${invoice.number}? This also removes it from the books.`)) return;
    setActionError("");
    try {
      await request(`/${invoice.id}`, { method: "DELETE" });
      setOpen(null);
      await load();
    } catch (error) {
      setActionError(error.message);
    }
  }

  if (open) {
    return (
      <div className="court moneypage">
        <div className="bento">
          <div className="mp-top c12 no-print">
            <button type="button" className="mp-back" onClick={() => setOpen(null)}><ArrowLeft size={14} /> Invoices</button>
            <div className="inv-actions">
              {open.status === "draft" ? <button type="button" onClick={() => move(open, "sent")}>Mark sent</button> : null}
              {open.status === "sent" ? (
                <label className="inv-paidon">
                  <span>Paid on</span>
                  <input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} aria-label="The day the money arrived" />
                </label>
              ) : null}
              {open.status === "sent" ? <button type="button" className="go" onClick={() => move(open, "paid", { paidOn })}>Mark paid</button> : null}
              {open.status === "sent" ? <button type="button" onClick={() => move(open, "draft")}>Back to draft</button> : null}
              {open.status === "paid" ? <button type="button" onClick={() => move(open, "sent")}>Unpay</button> : null}
              {open.status !== "void" ? <button type="button" onClick={() => move(open, "void")}>Void</button> : null}
              {/* A sent invoice is editable too, and has to be: the money record
                  refuses a company change on the entry an invoice raised and
                  says to change it on the invoice, which was advice with no
                  button behind it while only drafts could be opened. A paid one
                  the server refuses outright — "Unpay" above is its way back. */}
              {open.status === "draft" || open.status === "sent" ? (
                <button type="button" onClick={() => { setEditing(open); setEditorOpen(true); }}>Edit</button>
              ) : null}
              <button type="button" className="inv-delete" onClick={() => remove(open)}><Trash2 size={13} /> Delete</button>
            </div>
            <button type="button" className="mp-record" onClick={() => window.print()}><Printer size={14} /> Print / PDF</button>
          </div>
          {open.overdue ? (
            <p className="inv-overdue-note c12 no-print">{dueLabel(open.dueOn)} · issued {formatDate(open.issueOn, { style: "short" })} and still unpaid.</p>
          ) : null}
          {actionError ? <p className="errorstate c12 no-print" role="alert">{actionError}</p> : null}
          <div className="c12 invoice-paper">
            <InvoiceDoc invoice={open} profile={data.profile} />
          </div>
        </div>
        {editorOpen ? (
          <Editor invoice={editing} currencies={currencies} companies={companies} nextNumber={data.nextNumber}
            onClose={() => { setEditorOpen(false); setEditing(null); }} onSaved={() => load()} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="court moneypage">
      <div className="bento">
        <div className="mp-top c12">
          <button type="button" className="mp-back" onClick={onBack}><ArrowLeft size={14} /> The books</button>
          <button type="button" className="mp-plain" onClick={() => setProfileOpen(true)} disabled={data.status !== "ready"}>Your details</button>
          <button type="button" className="mp-record" onClick={() => { setEditing(null); setEditorOpen(true); }} disabled={data.status !== "ready"}>
            <Plus size={14} /> New invoice {data.nextNumber ? <em className="mp-next">{data.nextNumber}</em> : null}
          </button>
        </div>

        <section className="mod c12">
          <div className="mh">
            <h3>Invoices</h3>
            <span className="cnt">{listed.length}</span>
          </div>
          <div className="inv-filters">
            {FILTERS.map(([value, label]) => (
              <button key={value} type="button" className={filter === value ? "on" : ""} onClick={() => setFilter(value)}>
                {label}{value === "overdue" && overdueCount ? ` \u00b7 ${overdueCount}` : ""}
              </button>
            ))}
          </div>
          <CompanyFilterBar label="Raised for" options={firmOptions} value={companyFilter} onChange={setCompanyFilter} />
          {companies.status === "error" ? (
            <div className="errorstate" role="alert">
              <strong>Your companies could not be read</strong>
              <p>{companies.message} The invoices below are all here; only the company names are missing.</p>
              <button type="button" className="btn" onClick={companies.reload}>Try again</button>
            </div>
          ) : null}
          {actionError ? <p className="errorstate" role="alert">{actionError}</p> : null}
          {scoped.status === "error" ? (
            <div className="errorstate" role="alert">
              <strong>That company's invoices could not be read</strong>
              <p>{scoped.message}</p>
              <button type="button" className="btn" onClick={() => setCompanyFilter("")}>Back to everyone</button>
            </div>
          ) : null}
          {data.status === "loading" || scoped.status === "loading" ? <p className="quiet">Loading…</p> : null}
          {data.status === "error" ? <p className="errorstate" role="alert">{data.message}</p> : null}
          {data.status === "ready" && !data.invoices.length ? (
            <div className="emptystate">
              <strong>No invoices yet</strong>
              <p>Make one and it stays a draft until you send it — nothing reaches the books before then.</p>
            </div>
          ) : null}
          {data.status === "ready" && data.invoices.length > 0 && scoped.status !== "loading" && scoped.status !== "error" && !shown.length ? (
            <div className="emptystate">
              <strong>Nothing here</strong>
              <p>
                {companyFilter
                  ? `No invoice for ${companyFilter === UNATTRIBUTED ? "nobody in the CRM" : (companyName(companies, companyFilter) || "that company")} matches that filter.`
                  : "No invoice matches that filter."}
              </p>
              {companyFilter ? <button type="button" className="btn" onClick={() => setCompanyFilter("")}>Show everyone</button> : null}
            </div>
          ) : null}
          {shown.map((invoice) => {
            const firm = invoice.companyId ? (companyName(companies, invoice.companyId) || "A company") : "";
            return (
              <div key={invoice.id} className={`inv-row ${invoice.overdue ? "is-overdue" : ""}`}>
                <button type="button" className="inv-main" onClick={() => { setPaidOn(localIsoDate()); setActionError(""); setOpen(invoice); }}>
                  <span className="inv-no mono">{invoice.number}</span>
                  <StatusPill invoice={invoice} />
                  <span className="inv-client" dir="auto">{invoice.clientName}</span>
                  <span className="inv-date">
                    {invoice.status === "paid" && invoice.paidOn
                      ? `Paid ${formatDate(invoice.paidOn, { style: "short" })}`
                      : invoice.dueOn
                        ? invoice.overdue ? dueLabel(invoice.dueOn) : `Due ${dueLabel(invoice.dueOn)}`
                        : `Issued ${formatDate(invoice.issueOn, { style: "short" })}`}
                  </span>
                </button>
                {invoice.companyId ? (
                  <CompanyTag
                    name={firm}
                    active={companyFilter === invoice.companyId}
                    onClick={() => setCompanyFilter(companyFilter === invoice.companyId ? "" : invoice.companyId)}
                    title={companyFilter === invoice.companyId ? "Back to everyone" : `Show only ${firm}`}
                  />
                ) : null}
                <span className="inv-amount mono">{exactAmount(invoice.total, { currency: invoice.currency })}</span>
                <span className="inv-open"><FileText size={13} /></span>
              </div>
            );
          })}
          {capped && !companyFilter ? (
            <p className="quiet">Showing the first {LIST_LIMIT} invoices. Pick a company above to see every one of that client's.</p>
          ) : null}
        </section>
      </div>

      {editorOpen ? (
        <Editor invoice={editing} currencies={currencies} companies={companies} nextNumber={data.nextNumber}
          onClose={() => { setEditorOpen(false); setEditing(null); }}
          onSaved={(invoice) => { load(); setOpen(invoice); }} />
      ) : null}
      {profileOpen && data.status === "ready" ? (
        <InvoiceProfile profile={data.profile} request={request} onClose={() => setProfileOpen(false)} onSaved={() => load()} />
      ) : null}
    </div>
  );
}
