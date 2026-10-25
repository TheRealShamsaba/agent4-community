/**
 * Every date in this system is a calendar date somebody lives in, not an
 * instant. The owner is in Istanbul, so reading "today" off a UTC timestamp
 * moves the books over to the next day in the middle of the evening. These
 * helpers read the day and the month the process's own clock is showing, which
 * is the day the owner means.
 *
 * That only holds if the process runs in the owner's timezone, and a container
 * runs in UTC unless told otherwise. So every real entry point calls
 * applyOwnerTimeZone() once, from AGENT4_TIME_ZONE (UTC by
 * default). It does not depend on the operating system having timezone files:
 * Node resolves the name from its own data.
 */

/**
 * Makes this process's clock show the owner's day. Returns the zone applied.
 * An unknown zone is an error, not a quiet fallback to UTC.
 */
export function applyOwnerTimeZone(timeZone, env = process.env) {
  const zone = String(timeZone || "").trim();
  if (!zone) return env.TZ || "";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
  } catch {
    throw new Error(`"${zone}" is not a time zone HQ can use. Set AGENT4_TIME_ZONE to an IANA name such as UTC.`);
  }
  // Node re-reads TZ whenever it is assigned, so this takes effect at once.
  env.TZ = zone;
  return zone;
}

function localParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Date is not a real date.");
  return date;
}

/** The YYYY-MM-DD the given moment falls on, in the server's own timezone. */
export function localIsoDate(date = new Date()) {
  const value = localParts(date);
  return [
    String(value.getFullYear()).padStart(4, "0"),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("-");
}

/** The YYYY-MM the given moment falls in, in the server's own timezone. */
export function localIsoMonth(date = new Date()) {
  return localIsoDate(date).slice(0, 7);
}
