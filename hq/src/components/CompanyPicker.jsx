import React, { useCallback, useEffect, useState } from "react";
import { Building2, RotateCcw } from "lucide-react";

/**
 * Which of your companies a movement of money belongs to.
 *
 * Until now "who paid" was only the free-typed counterparty, deduplicated by
 * lowercasing the string, so Sample Studio, sample-studio and Sample Studio Holding were three
 * different clients as far as the books were concerned. The company page could
 * therefore never answer the one question it exists to answer — has this client
 * actually paid us. The workspace companies are the id space both sides already
 * agree on, so the ledger borrows it rather than inventing a second one.
 *
 * Everything here stays optional. A running cost, a salary, or a one-off from
 * someone who was never a client are all normal, and forcing a company onto
 * them would put a name against money that does not belong to it.
 */

/** The id a select uses for a link whose company has since gone or been hidden. */
const GONE = "__gone";

/**
 * The filter value that asks for the rows with no company against them. It is
 * the server's own spelling, matched exactly on both the money entries and the
 * invoices, so it is sent as-is rather than translated at the edge.
 */
export const NO_COMPANY = "none";

/**
 * The workspace companies. Every screen that attributes money loads them the
 * same way, and a failure here is never allowed to stop money being recorded —
 * the free-text counterparty still works on its own, as it always did.
 */
export function useCompanies() {
  const [state, setState] = useState({ status: "loading", list: [], message: "" });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading", message: "" }));
    try {
      const response = await fetch("/api/workspaces");
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || "The company list could not be read.");
      const list = (body.companies || [])
        .map((company) => ({
          id: company.id,
          name: company.name || "Untitled company",
          kind: company.kind || "client",
          hidden: Boolean(company.hidden)
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
      setState({ status: "ready", list, message: "" });
    } catch (error) {
      setState({ status: "error", list: [], message: error.message || "The company list could not be read." });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { ...state, reload: load };
}

/** The name to show for a linked company, or nothing if the id is a stranger. */
export function companyName(companies, id) {
  if (!id) return "";
  return companies.list.find((company) => company.id === id)?.name || "";
}

/**
 * The picker itself. Alex has a handful of companies, not a directory, so a
 * plain select is faster and more honest than a typeahead — and the first
 * option is the one-off, because that is the common case and it should not be
 * something to discover.
 */
export function CompanyPicker({
  companies = { status: "ready", list: [], message: "" },
  value,
  onChange,
  label = "Which company",
  noneLabel = "Not one of my companies \u2014 a one-off",
  hint,
  className = ""
}) {
  const ready = companies.status === "ready";
  const linked = companies.list.find((company) => company.id === value) || null;
  // A hidden company is not offered, but one that is already linked stays on
  // the list: quietly dropping it would unlink the entry on the next save.
  const offered = companies.list.filter((company) => !company.hidden || company.id === value);
  /* A link the list cannot account for. Until the list has arrived that means
     nothing at all, so it is held rather than reported: showing "no longer on
     the list" for the half-second before the companies load would tell the
     owner their entry had lost its company when it had not. */
  const unknown = Boolean(value) && !linked;

  function pick(event) {
    const id = event.target.value;
    if (id === GONE) return;
    onChange(id, companies.list.find((company) => company.id === id) || null);
  }

  return (
    <div className={`company-pick ${className}`}>
      <label>
        <span>{label}</span>
        <select value={unknown ? GONE : value || ""} onChange={pick}>
          <option value="">{noneLabel}</option>
          {offered.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}{company.hidden ? " \u00b7 hidden" : ""}
            </option>
          ))}
          {unknown ? (
            <option value={GONE}>{ready ? "A company that is no longer on the list" : "The company this is linked to"}</option>
          ) : null}
        </select>
      </label>

      {companies.status === "loading" ? <em className="company-pick-note">Reading your companies…</em> : null}
      {companies.status === "error" ? (
        <div className="errorstate company-pick-error" role="alert">
          <strong>Your companies could not be read</strong>
          <p>{companies.message} Nothing is blocked — save this with the name typed above and link it later.</p>
          <button type="button" className="btn" onClick={companies.reload}><RotateCcw size={13} /> Try again</button>
        </div>
      ) : null}
      {ready && !companies.list.length ? (
        <em className="company-pick-note">No companies in the CRM yet, so the typed name is all the books will have.</em>
      ) : null}
      {ready && unknown ? (
        <em className="company-pick-note">
          This is linked to a company that is no longer on the list. Pick another, or choose the first option to unlink it.
        </em>
      ) : null}
      {hint ? <em className="company-pick-note">{hint}</em> : null}
    </div>
  );
}

/**
 * The company a row is filed against, and the way to see only that company.
 * The same tag serves the ledger, the invoice list and the standing costs, so
 * that "click the company to see only its money" means one thing everywhere.
 */
export function CompanyTag({ name, active = false, onClick, title }) {
  return (
    <button type="button" className={`firm-tag ${active ? "on" : ""}`} onClick={onClick} title={title} aria-pressed={active}>
      <Building2 size={11} /> <span dir="auto">{name}</span>
    </button>
  );
}

/**
 * The same link read back: a row of chips over a list. Counts come with them
 * because "four entries against nobody" is the number that makes a person go
 * and fix it, and a chip with a count is already the filter for doing so.
 */
export function CompanyFilterBar({ label, options, value, onChange }) {
  if (options.length < 2) return null;
  return (
    <div className="firm-filters">
      <span className="firm-filters-lbl">{label}</span>
      {options.map((option) => (
        <button
          key={option.value || "__all"}
          type="button"
          className={`firm-chip ${option.value === value ? "on" : ""} ${option.tone || ""}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <span dir="auto">{option.label}</span>
          {option.count === undefined ? null : <b>{option.count}</b>}
        </button>
      ))}
    </div>
  );
}
