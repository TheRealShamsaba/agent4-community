import { DateTime } from "luxon";

const MAX_AGENDA_EVENTS = 12;
const MAX_EVENT_TITLE_LENGTH = 96;

function normalize(value) {
  return String(value || "")
    .trim()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
}

function intentText(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/^(?:(?:okay|ok|so|well|um+|uh+|hey(?:\s+(?:agent\s*4|agent4))?)[,!.]?\s+)+/i, "")
    .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+/i, "")
    .replace(/^please\s+/i, "");
}

function asDate(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new TypeError("now must resolve to a valid Date.");
  return date;
}

function assertTimezone(timezone) {
  const probe = DateTime.fromMillis(0, { zone: timezone });
  if (!timezone || !probe.isValid) {
    throw new RangeError(`A valid IANA timezone is required (received ${JSON.stringify(timezone)}).`);
  }
}

/** Strong read intent only. Event-creation language must not match this. */
export function looksLikeCalendarAgendaRequest(text) {
  const input = normalize(text).toLowerCase();
  if (!input) return false;
  if (/^\/agenda(?:@\w+)?(?:\s|$)/i.test(input)) return true;

  const request = intentText(input);
  if (/\b(?:the\s+)?agenda\s+for\s+(?:today'?s?\s+)?(?:meeting|call)\b/i.test(request)) return false;
  const period = "(?:today|tomorrow|this week|the rest of (?:this )?week|the next (?:7|seven) days?|next (?:7|seven) days?|upcoming)";
  const calendar = "(?:my |the )?(?:calendar|agenda|schedule)";
  const events = "(?:meetings?|appointments?|events?|calls?)";

  return [
    new RegExp(`^(?:what(?:'s| is)|whats)\\s+(?:on|in)\\s+${calendar}(?:\\s+(?:for\\s+|on\\s+)?)?`),
    new RegExp(`^(?:what(?:'s| is)|whats)\\s+${calendar}(?:\\s+(?:for\\s+|on\\s+)?)?${period}?`),
    new RegExp(`^(?:what(?:'s| is)|whats)\\s+(?:today's|tomorrow's)\\s+(?:calendar|agenda|schedule)`),
    new RegExp(`^(?:today's|tomorrow's)\\s+(?:calendar|agenda|schedule|${events})\\b`),
    new RegExp(`^(?:what\\s+do\\s+i\\s+have)\\s+(?:on|in)\\s+${calendar}`),
    new RegExp(`^what\\s+does\\s+${calendar}\\s+look\\s+like`),
    new RegExp(`^(?:tell|show|check)(?:\\s+me)?\\s+(?:what(?:'s| is)|whats)\\s+(?:on|in)\\s+${calendar}`),
    new RegExp(`^(?:tell|show|check)(?:\\s+me)?\\s+what\\s+i\\s+have\\s+(?:on\\s+)?${period}\\b`),
    new RegExp(`^(?:tell|show|check|list|read)(?:\\s+me)?\\s+${calendar}(?:\\s+(?:for\\s+|on\\s+)?)?`),
    new RegExp(`^(?:tell|show|check|list|read)(?:\\s+me)?\\s+(?:(?:my|the|today's|tomorrow's)\\s+)?${events}\\b`),
    new RegExp(`^(?:what|which)\\s+${events}\\s+(?:do\\s+i\\s+have|are\\s+there)`),
    new RegExp(`^what\\s+are\\s+(?:my|the)\\s+${events}\\b`),
    new RegExp(`^are\\s+there\\s+${events}\\b`),
    new RegExp(`^(?:are\\s+there\\s+)?any\\s+${events}\\b`),
    new RegExp(`^(?:what\\s+do\\s+i\\s+have|do\\s+i\\s+have\\s+(?:anything|(?:(?:any|an?)\\s+)?${events}))\\s+(?:on\\s+)?${period}\\b`),
    new RegExp(`^${calendar}\\s+(?:for\\s+|on\\s+)?${period}\\b`)
  ].some((pattern) => pattern.test(request));
}

function clarificationQuery(timezone) {
  return {
    type: "calendar-agenda-query",
    status: "needs_clarification",
    timezone,
    question: "I can read today, tomorrow, this week, or the next 7 days. Try: “/agenda tomorrow”."
  };
}

function hasUnsupportedNaturalTail(input, knownPeriods) {
  if (/^\/agenda(?:@\w+)?(?:\s|$)/i.test(input)) return false;
  const nouns = [...input.matchAll(/\b(?:calendar|agenda|schedule|meetings?|appointments?|events?|calls?)\b/gi)];
  const last = nouns.at(-1);
  if (!last) return false;
  let tail = input
    .slice((last.index ?? 0) + last[0].length)
    .replace(/[?!.]+$/g, "")
    .replace(/\bplease$/i, "")
    .trim();
  if (!tail) return false;
  tail = tail.replace(/^(?:do\s+i\s+have|are\s+there|look\s+like)\s*/i, "").trim();
  if (!tail || tail === "right now") return false;
  if (knownPeriods === 0) return true;
  const supportedTail = /^(?:(?:for|on)\s+)?(?:today|tomorrow|this week|the rest of (?:this )?week|(?:(?:the )?next (?:7|seven) days?|upcoming)(?:\s+(?:starting|from)\s+tomorrow)?|today\s+(?:and|&)\s+tomorrow|today\s+through\s+tomorrow|(?:from|starting)\s+tomorrow\s+(?:for\s+)?(?:the\s+)?next\s+(?:7|seven)\s+days?)$/i;
  return !supportedTail.test(tail);
}

/** Resolve a read request to exclusive, timezone-aware Calendar API bounds. */
export function resolveCalendarAgendaRequest(text, {
  timezone = "UTC",
  now = () => new Date()
} = {}) {
  if (!looksLikeCalendarAgendaRequest(text)) return null;
  assertTimezone(timezone);

  const input = normalize(text).toLowerCase();
  const localNow = DateTime.fromJSDate(asDate(now), { zone: timezone });
  const hasToday = /\btoday\b/.test(input);
  const hasTomorrow = /\btomorrow\b/.test(input);
  const hasThisWeek = /\b(?:this week|the rest of (?:this )?week)\b/.test(input);
  const hasNextSeven = /\b(?:(?:the )?next (?:7|seven) days?|upcoming)\b/.test(input);
  const unsupportedDate = /\b(?:day after tomorrow|yesterday|this weekend|next weekend|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\bin\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b|\b(?:the\s+)?next\s+(?!(?:7|seven)\s+days?\b)(?:\d+|one|two|three|four|five|six|eight|nine|ten)\s+days?\b|\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?)\b/i.test(input);
  const twoDays = hasToday && hasTomorrow && /\btoday\s+(?:and|&)\s+tomorrow\b|\btoday\s+through\s+tomorrow\b/.test(input);
  const nextSevenFromTomorrow = hasTomorrow && hasNextSeven && /\b(?:starting|from)\s+tomorrow\b|\btomorrow\b[^.!?]*\bnext\s+(?:7|seven)\s+days?\b/.test(input);
  const knownPeriods = [hasToday, hasTomorrow, hasThisWeek, hasNextSeven].filter(Boolean).length;
  const commandTail = /^\/agenda(?:@\w+)?\s+(.+)$/i.exec(input)?.[1] || "";
  if (unsupportedDate || (knownPeriods > 1 && !twoDays && !nextSevenFromTomorrow) || (
    commandTail && knownPeriods === 0
  ) || hasUnsupportedNaturalTail(input, knownPeriods)) {
    return clarificationQuery(timezone);
  }

  let period = "today";
  let start = localNow.startOf("day");
  let end = start.plus({ days: 1 });

  if (twoDays) {
    period = "today-and-tomorrow";
    end = start.plus({ days: 2 });
  } else if (nextSevenFromTomorrow) {
    period = "next-seven-days";
    start = start.plus({ days: 1 });
    end = start.plus({ days: 7 });
  } else if (hasTomorrow) {
    period = "tomorrow";
    start = start.plus({ days: 1 });
    end = start.plus({ days: 1 });
  } else if (hasThisWeek) {
    period = "this-week";
    end = localNow.startOf("week").plus({ weeks: 1 });
  } else if (hasNextSeven) {
    period = "next-seven-days";
    end = start.plus({ days: 7 });
  }

  return {
    type: "calendar-agenda-query",
    period,
    timezone,
    timeMin: start.toISO({ suppressMilliseconds: true }),
    timeMax: end.toISO({ suppressMilliseconds: true })
  };
}

function cleanTitle(value) {
  const title = String(value || "Busy").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!title) return "Busy";
  return title.length <= MAX_EVENT_TITLE_LENGTH ? title : `${title.slice(0, MAX_EVENT_TITLE_LENGTH - 1).trimEnd()}…`;
}

function escapeTelegramHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function localDateTime(value, timezone, { allDay = false } = {}) {
  if (!value) return null;
  return allDay
    ? DateTime.fromISO(value, { zone: timezone })
    : DateTime.fromISO(value, { setZone: true, zone: timezone }).setZone(timezone);
}

function eventLine(event, query, locale) {
  const allDay = Boolean(event?.allDay || /^\d{4}-\d{2}-\d{2}$/.test(String(event?.start || "")));
  const start = localDateTime(event?.start, query.timezone, { allDay });
  const end = localDateTime(event?.end, query.timezone, { allDay });
  const includeDate = ["today-and-tomorrow", "this-week", "next-seven-days"].includes(query.period);
  const datePrefix = includeDate && start?.isValid ? `${start.setLocale(locale).toFormat("ccc, LLL d")} · ` : "";
  const timing = allDay
    ? "All day"
    : start?.isValid
      ? end?.isValid
        ? `${start.setLocale(locale).toFormat("h:mm a")}–${end.setLocale(locale).toFormat("h:mm a")}`
        : start.setLocale(locale).toFormat("h:mm a")
      : "Time unavailable";
  return `• ${datePrefix}${timing} — ${cleanTitle(event?.title)}`;
}

function agendaHeading(query, locale) {
  const start = DateTime.fromISO(query.timeMin, { setZone: true }).setZone(query.timezone).setLocale(locale);
  return {
    today: `📅 Today · ${start.toFormat("ccc, LLL d")}`,
    tomorrow: `📅 Tomorrow · ${start.toFormat("ccc, LLL d")}`,
    "today-and-tomorrow": "📅 Today + tomorrow",
    "this-week": "📅 The rest of this week",
    "next-seven-days": "📅 Next 7 days"
  }[query.period] || "📅 Calendar";
}

function sortedAgendaEvents(events, query) {
  const eventMillis = (event) => {
    const allDay = Boolean(event?.allDay || /^\d{4}-\d{2}-\d{2}$/.test(String(event?.start || "")));
    const value = localDateTime(event?.start, query.timezone, { allDay });
    return value?.isValid ? value.toMillis() : Number.POSITIVE_INFINITY;
  };
  return [...events].sort((left, right) => eventMillis(left) - eventMillis(right));
}

/** Format an ephemeral, compact Telegram agenda without descriptions or attendees. */
export function formatCalendarAgenda(query, { events = [], truncated = false } = {}, {
  locale = "en",
  maxEvents = MAX_AGENDA_EVENTS
} = {}) {
  if (!query || query.type !== "calendar-agenda-query") throw new TypeError("A calendar agenda query is required.");
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 50) throw new RangeError("maxEvents must be between 1 and 50.");

  const heading = agendaHeading(query, locale);
  const sorted = sortedAgendaEvents(events, query);
  if (!sorted.length) return `${heading}\nNothing scheduled. Your calendar is clear.`;

  const visible = sorted.slice(0, maxEvents);
  const lines = [heading, ...visible.map((event) => eventLine(event, query, locale))];
  const hidden = sorted.length - visible.length;
  if (hidden > 0) lines.push(`…and ${hidden} more ${hidden === 1 ? "event" : "events"}.`);
  else if (truncated) lines.push("More events are available in Google Calendar.");
  return lines.join("\n");
}

/** Telegram HTML companion for the agenda command center. */
export function formatCalendarAgendaHtml(query, { events = [], truncated = false } = {}, {
  locale = "en",
  maxEvents = MAX_AGENDA_EVENTS
} = {}) {
  if (!query || query.type !== "calendar-agenda-query") throw new TypeError("A calendar agenda query is required.");
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 50) throw new RangeError("maxEvents must be between 1 and 50.");

  const heading = agendaHeading(query, locale);
  const sorted = sortedAgendaEvents(events, query);
  if (!sorted.length) {
    return `<b>${escapeTelegramHtml(heading)}</b>\n\n<i>Nothing scheduled. Your calendar is clear.</i>`;
  }

  const visible = sorted.slice(0, maxEvents);
  const includeDate = ["today-and-tomorrow", "this-week", "next-seven-days"].includes(query.period);
  const lines = [
    `<b>${escapeTelegramHtml(heading)}</b>`,
    `<code>${sorted.length} ${sorted.length === 1 ? "event" : "events"}</code>`,
    ""
  ];
  for (const event of visible) {
    const allDay = Boolean(event?.allDay || /^\d{4}-\d{2}-\d{2}$/.test(String(event?.start || "")));
    const start = localDateTime(event?.start, query.timezone, { allDay });
    const end = localDateTime(event?.end, query.timezone, { allDay });
    const date = includeDate && start?.isValid ? `${start.setLocale(locale).toFormat("ccc, LLL d")} · ` : "";
    const timing = allDay
      ? "All day"
      : start?.isValid
        ? end?.isValid
          ? `${start.setLocale(locale).toFormat("h:mm a")}–${end.setLocale(locale).toFormat("h:mm a")}`
          : start.setLocale(locale).toFormat("h:mm a")
        : "Time unavailable";
    lines.push(`🕘 <b>${escapeTelegramHtml(`${date}${timing}`)}</b>`, escapeTelegramHtml(cleanTitle(event?.title)), "");
  }
  const hidden = sorted.length - visible.length;
  if (hidden > 0) lines.push(`<i>…and ${hidden} more ${hidden === 1 ? "event" : "events"}.</i>`);
  else if (truncated) lines.push("<i>More events are available in Google Calendar.</i>");
  return lines.join("\n").trim();
}
