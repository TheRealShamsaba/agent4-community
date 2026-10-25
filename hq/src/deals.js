import { stageFromPipeline } from "./workspace-model.js";

/* What a client is worth, and where each one sits on the way to being paid.
   The board, its totals and the company page all read this one file. */

export const DEAL_CURRENCIES = ["USD", "EUR", "IRR"];

/* The journey, left to right. Dormant and lost are parked, not a column: they
   are not going anywhere, and a column of them would shout over the live ones. */
export const BOARD_STAGES = ["lead", "talking", "proposal", "active", "operating"];
export const PARKED_STAGES = ["dormant", "lost"];
const OPEN_STAGES = new Set(["lead", "talking", "proposal"]);
const PURSUED = new Set(["pursued", "contacted", "replied", "meeting", "proposal", "won", "lost"]);

/** The stage a company is at, in the one vocabulary the CRM speaks. */
export function effectiveStage(company) {
  return company.stage || stageFromPipeline(company.pipelineStage) || "lead";
}

/* Only relationships somebody chose to keep. A company the pipeline merely
   discovered is a lead to review, not a client, until it is pursued or saved. */
export function onBoard(company) {
  if (company.hidden || company.kind === "internal") return false;
  if (company.stored) return true;
  return PURSUED.has(String(company.pipelineStage || "").toLowerCase());
}

export function formatDeal(value, currency) {
  if (!value || !currency) return "";
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

export function formatDealExact(value, currency) {
  if (!value || !currency) return "";
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

/** Totals per currency, never across them: a rial and a euro added is a lie. */
export function sumDeals(companies, stages) {
  const wanted = new Set(stages);
  const totals = new Map();
  for (const company of companies) {
    if (!wanted.has(effectiveStage(company)) || !company.dealValue || !company.dealCurrency) continue;
    totals.set(company.dealCurrency, (totals.get(company.dealCurrency) || 0) + company.dealValue);
  }
  return [...totals].map(([currency, total]) => ({ currency, total })).sort((left, right) => right.total - left.total);
}

export function totalsLabel(totals) {
  return totals.length ? totals.map((entry) => formatDeal(entry.total, entry.currency)).join(" · ") : "";
}

export function daysQuiet(company, now = Date.now()) {
  const stamp = Date.parse(company.lastTouch || "");
  return Number.isFinite(stamp) ? Math.max(0, Math.floor((now - stamp) / 86_400_000)) : null;
}
