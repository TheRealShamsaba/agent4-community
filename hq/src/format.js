/* Shared formatting for the whole HQ front end.
   Every date, amount and relative time goes through here. Before this file the
   app had four copies of compactAmount that disagreed ("240k" vs "240K") and
   twelve places computing "today" in UTC, which put the whole app a day out
   between local midnight and 03:30 in Tehran. Import from here; do not
   re-implement. */

/* ------------------------------------------------------------------ dates --- */

/* Today, in the browser's own timezone. Never new Date().toISOString(): that is
   the UTC day, which is yesterday for the first hours of every Tehran morning. */
export function localIsoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(iso, days) {
  const parsed = parseIsoDate(iso);
  if (!parsed) return "";
  parsed.setDate(parsed.getDate() + Number(days || 0));
  return localIsoDate(parsed);
}

/* An ISO yyyy-mm-dd read as a local date, not as UTC midnight. */
export function parseIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(date.getTime()) ? date : null;
}

/* Whole days from today to `iso`. Negative is in the past. */
export function daysUntil(iso, today = localIsoDate()) {
  const target = parseIsoDate(iso);
  const from = parseIsoDate(today);
  if (!target || !from) return null;
  return Math.round((target - from) / 86400000);
}

export function isOverdue(iso, today = localIsoDate()) {
  const days = daysUntil(iso, today);
  return days !== null && days < 0;
}

/* One date format for the whole app.
   style "day"   → Today · Tomorrow · Yesterday · Sat 20 Sep · 20 Sep 2025
   style "short" → 20 Sep · 20 Sep 2025
   style "long"  → Saturday, 20 September 2026 */
export function formatDate(iso, { style = "day", today = localIsoDate(), locale } = {}) {
  const date = parseIsoDate(iso);
  if (!date) return "";
  const diff = daysUntil(iso, today);
  if (style === "day") {
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
  }
  const sameYear = date.getFullYear() === (parseIsoDate(today)?.getFullYear() ?? date.getFullYear());
  if (style === "long") {
    return date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  const options = { day: "numeric", month: "short" };
  if (!sameYear) options.year = "numeric";
  if (style === "day" && diff !== null && diff > -7 && diff < 7) options.weekday = "short";
  return date.toLocaleDateString(locale, options);
}

/* How late something is, with the magnitude. "overdue" on its own hides the
   difference between one day and three months. */
export function dueLabel(iso, { today = localIsoDate(), locale } = {}) {
  const diff = daysUntil(iso, today);
  if (diff === null) return "";
  if (diff < 0) {
    const late = Math.abs(diff);
    return late === 1 ? "1 day overdue" : `${late} days overdue`;
  }
  return formatDate(iso, { style: "day", today, locale });
}

export function formatTime(iso, { locale } = {}) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/* ----------------------------------------------------------------- amounts --- */

/* The exact figure, grouped. Use this anywhere the number is the point: a
   ledger row, an invoice line, what someone owes you. */
export function exactAmount(amount, { locale, currency } = {}) {
  if (!Number.isFinite(amount)) return "—";
  const digits = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(amount));
  return currency ? `${digits} ${currency}` : digits;
}

/* A rounded figure for a headline tile only, where the shape matters more than
   the digits. Never use it where the reader needs the real number. */
export function compactAmount(amount) {
  if (!Number.isFinite(amount)) return "—";
  const sign = amount < 0 ? "-" : "";
  const size = Math.abs(amount);
  if (size >= 1e9) return `${sign}${trimZero(size / 1e9)}B`;
  if (size >= 1e6) return `${sign}${trimZero(size / 1e6)}M`;
  if (size >= 1e3) return `${sign}${trimZero(size / 1e3)}K`;
  return `${sign}${Math.round(size)}`;
}

function trimZero(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/* --------------------------------------------------------------- the rest --- */

export function daysLabel(days) {
  if (days === null || days === undefined) return "";
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function relativeTime(iso, nowMs = Date.now()) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor((nowMs - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function percent(value) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}
