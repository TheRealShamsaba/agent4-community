import { casual } from "chrono-node";
import { DateTime } from "luxon";

const DEFAULT_DURATION_MINUTES = 60;
const MAX_INPUT_LENGTH = 500;
const MAX_TITLE_LENGTH = 160;

const DATE_WORDS = /\b(?:today|tomorrow|day\s+after\s+tomorrow|this\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const MONTH_DATE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{4})?\b/i;
const NUMERIC_DATE = /\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?)\b/;
const RELATIVE_DATE = /\b(?:in\s+\d+\s+days?|\d+\s+days?\s+(?:from\s+now|later)|on\s+the\s+\d{1,2}(?:st|nd|rd|th)?)\b/i;
const EXPLICIT_TIME = /\b(?:noon|midnight|(?:0?\d|1[0-2])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)|(?:[01]?\d|2[0-3]):[0-5]\d|(?:1[3-9]|2[0-3])\s*(?:h(?:ours?)?)?)\b/i;
const AMBIGUOUS_TIME = /\b(?:at|from|@)\s*(?:[1-9]|1[0-2])(?:\s*o['’]?clock)?\b/i;
const RANGE_END_REPLY = /^(?:(?:to|until|till|at|end(?:ing|s)?(?:\s+at)?)\s+)?(?:noon|midnight|(?:0?\d|1[0-2])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)|(?:[01]?\d|2[0-3]):[0-5]\d|(?:1[3-9]|2[0-3])\s*(?:h(?:ours?)?)?)[.!]?$/i;
const RANGE_MARKER = /\b(?:to|until|till)\b|[-–—]/gi;
const TIME_LIKE_AT_START = /^(?:noon|midnight|[+-]?\d{1,4}(?::\d{1,4})?\s*(?:a\.?m\.?|p\.?m\.?)?)(?=\s|[,!?;.]|$)/i;
const TIME_LIKE_AT_END = /(?:noon|midnight|[+-]?\d{1,4}(?::\d{1,4})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*[,;]?\s*$/i;
const FIELD_EDIT_PREFIX = /^(?:(?:make|set)\s+it(?:\s+to)?|(?:change|set)\s+(?:the\s+)?(?:date|time)(?:\s+to)?|reschedule(?:\s+(?:to|for))?|move(?:\s+to)?)(?:\s+|$)/i;

const SPOKEN_NUMBERS = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6],
  ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10], ["eleven", 11], ["twelve", 12],
  ["fifteen", 15], ["twenty", 20], ["thirty", 30], ["forty five", 45], ["sixty", 60],
  ["ninety", 90], ["one hundred twenty", 120]
]);

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function stripRequestCourtesy(value) {
  return value
    .replace(/^please(?:\s*,\s*|\s+)/i, "")
    .replace(/^(?:can|could|would)\s+you(?:\s*,\s*|\s+)/i, "")
    .replace(/^please(?:\s*,\s*|\s+)/i, "");
}

function spokenNumber(value) {
  return SPOKEN_NUMBERS.get(String(value || "").toLowerCase().replaceAll("-", " ").replace(/\s+/g, " "));
}

function normalizeSpokenCalendarNumbers(value) {
  const hourWords = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
  const durationWords = `${hourWords}|fifteen|twenty|thirty|forty[- ]five|sixty|ninety|one[- ]hundred[- ]twenty`;
  const normalizedDecimals = value.replace(
    /(?<![A-Za-z0-9.])([+-]?)(?:(\d+)[.,](\d+)|[.,](\d+))(?=\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b)/gi,
    (_match, sign, whole, fraction, leadingFraction) => `${sign}${whole ?? "0"}.${fraction ?? leadingFraction}`
  );
  return normalizedDecimals
    .replace(new RegExp(`\\b(${hourWords})\\s*(a\\.?m\\.?|p\\.?m\\.?)\\b`, "gi"), (_match, word, meridiem) => `${spokenNumber(word)} ${meridiem}`)
    .replace(new RegExp(`\\b(at|from|@)\\s+(${hourWords})(?=\\b)`, "gi"), (_match, prefix, word) => `${prefix} ${spokenNumber(word)}`)
    .replace(new RegExp(`\\b(for|lasting|duration(?:\\s+of)?)\\s+(${durationWords})\\s+(hours?|hrs?|h|minutes?|mins?|m)\\b`, "gi"),
      (_match, prefix, word, unit) => `${prefix} ${spokenNumber(word)} ${unit}`);
}

function normalizeStandaloneDateReply(value, expectedField) {
  if (expectedField !== "date") return value;
  const match = /^(?:(on)\s+)?(tmr|tmrw|tomorow|tommorow|tommorrow|tommrow|tomorroww)([.!]?)$/i.exec(value);
  if (!match) return value;
  return `${match[1] ? "on " : ""}tomorrow${match[3] || ""}`;
}

function expectedClarificationField(draft) {
  return draft?.questions?.[0]?.field || draft?.missing?.[0] || null;
}

function unrecognizedClarificationDraft(previousDraft, field, input) {
  const prompts = {
    date: "I couldn't recognize that date. Try ‘tomorrow’, ‘Wednesday’, or ‘August 26’.",
    time: "I couldn't recognize that time. Try ‘7 AM’, ‘3:30 PM’, or ‘15:30’.",
    title: "I couldn't recognize the event name. Send a short title, such as ‘Meeting with Chubin’."
  };
  const prompt = prompts[field];
  if (!prompt) return previousDraft;
  return {
    ...previousDraft,
    status: "needs_clarification",
    code: `UNRECOGNIZED_${field.toUpperCase()}_REPLY`,
    questions: [
      { field, prompt },
      ...(previousDraft.questions || []).filter((question) => question.field !== field)
    ],
    sourceText: input
  };
}

function unsafeNumericDate(input) {
  // Canonical ISO dates are deterministic. Other numeric forms vary by locale,
  // and some are not parsed by Chrono at all; fail closed rather than borrowing
  // today's date from the parser reference.
  const withoutDurations = input
    .replace(/\b(?:for|lasting|duration(?:\s+of)?|make\s+it|set\s+it)\s+[+-]?\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/gi, " ")
    .replace(/(?<![\d.])[+-]?\d+(?:\.\d+)?\s*[- ]\s*(?:hour|hr|minute|min)s?\b/gi, " ");
  const withoutValidIso = withoutDurations.replace(/(?<![\d./-])\b(\d{4})-(\d{1,2})-(\d{1,2})\b(?![-/.]\d)/g, (token, year, month, day) => {
    const parsed = DateTime.fromObject({ year: Number(year), month: Number(month), day: Number(day) }, { zone: "UTC" });
    return parsed.isValid && parsed.year === Number(year) && parsed.month === Number(month) && parsed.day === Number(day)
      ? " ".repeat(token.length)
      : token;
  });
  return /\b\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?\b/.exec(withoutValidIso)?.[0] ?? null;
}

function writtenClock(token) {
  const compact = token.toLowerCase().replaceAll(".", "").replace(/\s+/g, "");
  if (compact === "noon") return { hour: 12, minute: 0 };
  if (compact === "midnight") return { hour: 0, minute: 0 };
  const match = /^(\d{1,2})(?::(\d{1,2}))?(am|pm)?$/.exec(compact);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] == null ? 0 : Number(match[2]);
  if (minute > 59) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    if (match[3] === "am") hour = hour === 12 ? 0 : hour;
    if (match[3] === "pm") hour = hour === 12 ? 12 : hour + 12;
    return { hour, minute };
  }
  if (match[2] != null && hour >= 0 && hour <= 23) return { hour, minute };
  return hour >= 13 && hour <= 23 ? { hour, minute } : null;
}

function dateSyntaxAtStart(value) {
  const input = value.trimStart().replace(/^on\s+/i, "");
  const matches = [DATE_WORDS, MONTH_DATE, NUMERIC_DATE, RELATIVE_DATE]
    .map((pattern) => pattern.exec(input))
    .filter((match) => match?.index === 0)
    .sort((a, b) => b[0].length - a[0].length);
  if (!matches.length) return null;
  return input.slice(matches[0][0].length).replace(/^[\s,]*(?:(?:at|@)\s*)?/i, "");
}

function hasDateSyntax(value) {
  return DATE_WORDS.test(value) || MONTH_DATE.test(value) || NUMERIC_DATE.test(value) || RELATIVE_DATE.test(value);
}

function writtenRangeEnd(input) {
  const markers = [...input.matchAll(RANGE_MARKER)];
  for (const marker of markers.reverse()) {
    const before = input.slice(0, marker.index);
    const startMatch = TIME_LIKE_AT_END.exec(before.trimEnd());
    if (!startMatch) continue;
    const startClock = writtenClock(startMatch[0].trim().replace(/[,;]$/, "").trim());
    if (/^[-–—]$/.test(marker[0]) && !startClock) continue;
    const tail = input.slice(marker.index + marker[0].length).trimStart();
    const directTime = TIME_LIKE_AT_START.exec(tail);
    const afterDate = directTime ? null : dateSyntaxAtStart(tail);
    const datedTime = afterDate == null ? null : TIME_LIKE_AT_START.exec(afterDate);
    const timeMatch = directTime ?? datedTime;
    if (!timeMatch) {
      if (afterDate != null) return { present: true, valid: false, token: null, clock: null, startClock, hasExplicitDate: true };
      continue;
    }
    const token = timeMatch[0].trim();
    const clock = writtenClock(token);
    const dateAfterTime = Boolean(directTime && hasDateSyntax(tail.slice(directTime[0].length)));
    return {
      present: true,
      valid: Boolean(clock),
      token,
      clock,
      startClock,
      hasExplicitDate: hasDateSyntax(tail),
      dateAfterTime
    };
  }
  return { present: false, valid: false, token: null, clock: null, startClock: null, hasExplicitDate: false, dateAfterTime: false };
}

function unresolvedDateDraft(draft, code, prompt) {
  return {
    ...draft,
    status: "needs_clarification",
    code,
    date: null,
    start: null,
    end: null,
    missing: ["date", ...(draft.missing || []).filter((field) => field !== "date")],
    questions: [
      { field: "date", prompt },
      ...(draft.questions || []).filter((question) => question.field !== "date")
    ]
  };
}

function unresolvedTimeDraft(draft, code, prompt) {
  return {
    ...draft,
    status: "needs_clarification",
    code,
    time: null,
    start: null,
    end: null,
    missing: ["time", ...(draft.missing || []).filter((field) => field !== "time")],
    questions: [
      { field: "time", prompt },
      ...(draft.questions || []).filter((question) => question.field !== "time")
    ]
  };
}

function unresolvedRangeEndDraft(draft, code, prompt) {
  return {
    ...draft,
    status: "needs_clarification",
    code,
    durationMinutes: null,
    end: null,
    missing: ["endTime", ...(draft.missing || []).filter((field) => field !== "endTime")],
    questions: [
      { field: "endTime", prompt },
      ...(draft.questions || []).filter((question) => question.field !== "endTime")
    ]
  };
}

function unresolvedDurationDraft(draft, code = "INVALID_DURATION", prompt = "That duration is invalid. Please use a duration from 1 minute through 24 hours.") {
  return {
    ...draft,
    status: "needs_clarification",
    code,
    durationMinutes: null,
    end: null,
    missing: ["duration", ...(draft.missing || []).filter((field) => field !== "duration")],
    questions: [
      { field: "duration", prompt },
      ...(draft.questions || []).filter((question) => question.field !== "duration")
    ]
  };
}

function unresolvedScheduleDraft(draft) {
  return {
    ...draft,
    status: "needs_clarification",
    code: "MULTIPLE_DATE_TIMES",
    date: null,
    time: null,
    durationMinutes: null,
    start: null,
    end: null,
    missing: ["schedule"],
    questions: [{ field: "schedule", prompt: "I found more than one date or time. Please send one event with one date and one start time." }]
  };
}

function rangeEndPrompt(problem) {
  if (problem === "AMBIGUOUS_RANGE_END") {
    return "That end time occurs twice because of a daylight-saving change. Please send a different end time or a duration.";
  }
  if (problem === "NONEXISTENT_RANGE_END") {
    return "That end time does not exist because of a daylight-saving change. Please send a different end time or a duration.";
  }
  if (problem === "RANGE_TOO_LONG") {
    return "That time range is longer than 24 hours. Please send a closer end time or a duration up to 24 hours.";
  }
  if (problem === "INVALID_RANGE_END_DATE") {
    return "I need the full end date to use a multi-day range safely. Please include the month, day, and year, or send a duration.";
  }
  return "I could not safely resolve that end time. Please send a different end time or a duration.";
}

function hasRepeatedLocalTime(draft) {
  if (!draft?.date || !draft?.time || !draft?.timezone) return false;
  const local = DateTime.fromISO(`${draft.date}T${draft.time}`, { zone: draft.timezone });
  return local.isValid && typeof local.getPossibleOffsets === "function" && local.getPossibleOffsets().length > 1;
}

function assertTimezone(timezone) {
  const probe = DateTime.fromMillis(0, { zone: timezone });
  if (!timezone || !probe.isValid) {
    throw new RangeError(`A valid IANA timezone is required (received ${JSON.stringify(timezone)}).`);
  }
}

function asDate(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new TypeError("now must resolve to a valid Date.");
  return date;
}

function parsingReference(now, timezone) {
  const local = DateTime.fromJSDate(asDate(now), { zone: "utc" }).setZone(timezone);
  const wallClockAsUtc = new Date(Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    local.millisecond
  ));
  return { instant: wallClockAsUtc, timezone: 0 };
}

function isCertain(component, name) {
  return typeof component?.isCertain === "function" && component.isCertain(name);
}

function getComponent(component, name) {
  if (!component) return null;
  const value = typeof component.get === "function" ? component.get(name) : component.knownValues?.[name] ?? component.impliedValues?.[name];
  return Number.isFinite(value) ? value : null;
}

function hasExplicitDate(input, component) {
  if (DATE_WORDS.test(input) || MONTH_DATE.test(input) || NUMERIC_DATE.test(input) || RELATIVE_DATE.test(input)) return true;
  return isCertain(component, "weekday") || isCertain(component, "day");
}

function hasExplicitTime(input, component) {
  if (!isCertain(component, "hour")) return false;
  if (EXPLICIT_TIME.test(input)) return true;
  if (AMBIGUOUS_TIME.test(input) && !isCertain(component, "meridiem")) return false;
  return isCertain(component, "meridiem") || isCertain(component, "minute");
}

function isDurationOnlyParseResult(result) {
  return /^(?:for|lasting|duration(?:\s+of)?)\b.*\b(?:hours?|hrs?|h|minutes?|mins?|m)$/i.test(result?.text?.trim() || "");
}

function durationFromText(input) {
  if (/\b(?:for|lasting|duration(?:\s+of)?|make\s+it|set\s+it)\s+(?:a\s+)?half(?:\s+an?)?\s+hour\b/i.test(input)) return 30;
  const phrase = /\b(?:for|lasting|duration(?:\s+of)?)\s+(?:(an?)\s+)?(\d+(?:\.\d+)?)?\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i.exec(input);
  const compound = /\b(\d+(?:\.\d+)?)\s*[- ]\s*(hour|hr|minute|min)s?\b/i.exec(input);
  if (!phrase && !compound) return null;

  const article = phrase?.[1]?.toLowerCase();
  const rawAmount = phrase ? (phrase[2] ?? (article ? "1" : null)) : compound[1];
  const unit = (phrase?.[3] ?? compound?.[2])?.toLowerCase();
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null;
  const minutes = unit.startsWith("h") ? amount * 60 : amount;
  return Number.isInteger(minutes) && minutes <= 24 * 60 ? minutes : null;
}

function hasInvalidWrittenDuration(input) {
  const prefixed = /\b(?:for|lasting|duration(?:\s+of)?|make\s+it|set\s+it)\s+([+-]?\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i.exec(input);
  const compound = /(?<![\d.])([+-]?\d+(?:\.\d+)?)\s*[- ]\s*(hour|hr|minute|min)s?\b/i.exec(input);
  const match = prefixed ?? compound;
  if (!match) return false;
  if (/^[+-]/.test(match[1])) return true;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const minutes = unit.startsWith("h") ? amount * 60 : amount;
  return !Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60;
}

function looksOnlyLikeDuration(input) {
  return /^(?:(?:make|set)\s+it(?:\s+to)?\s+|(?:for|lasting|duration(?:\s+of)?)\s+)?[+-]?\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)[.!]?$/i.test(input);
}

function rangeEndFromClock(startLocal, endHour, endMinute, timezone, explicitEndDate = null) {
  if (!startLocal?.isValid || !Number.isFinite(endHour) || !Number.isFinite(endMinute)) {
    return { minutes: null, problem: "INVALID_RANGE_END" };
  }
  const isNextDay = (endHour * 60) + endMinute <= (startLocal.hour * 60) + startLocal.minute;
  const endDate = explicitEndDate ?? (isNextDay ? startLocal.plus({ days: 1 }) : startLocal);
  const requested = {
    year: endDate.year,
    month: endDate.month,
    day: endDate.day,
    hour: endHour,
    minute: endMinute
  };
  const end = DateTime.fromObject(requested, { zone: timezone });
  if (!end.isValid
    || end.year !== requested.year
    || end.month !== requested.month
    || end.day !== requested.day
    || end.hour !== requested.hour
    || end.minute !== requested.minute) {
    return { minutes: null, problem: "NONEXISTENT_RANGE_END" };
  }
  if (typeof end.getPossibleOffsets === "function" && end.getPossibleOffsets().length > 1) {
    return { minutes: null, problem: "AMBIGUOUS_RANGE_END" };
  }
  const minutes = Math.round(end.diff(startLocal, "minutes").minutes);
  if (minutes > 24 * 60) return { minutes: null, problem: "RANGE_TOO_LONG" };
  if (minutes <= 0) return { minutes: null, problem: "INVALID_RANGE_END" };
  return {
    minutes,
    problem: null
  };
}

function rangeEndInfo(result, startLocal, timezone, useExplicitEndDate = false) {
  if (!result?.end || !isCertain(result.end, "hour")) return { minutes: null, problem: null };
  const hasCompleteEndDate = ["year", "month", "day"].every((part) => isCertain(result.end, part));
  if (useExplicitEndDate && !hasCompleteEndDate) return { minutes: null, problem: "INVALID_RANGE_END_DATE" };
  const explicitEndDate = useExplicitEndDate
    ? { year: getComponent(result.end, "year"), month: getComponent(result.end, "month"), day: getComponent(result.end, "day") }
    : null;
  return rangeEndFromClock(
    startLocal,
    getComponent(result.end, "hour"),
    getComponent(result.end, "minute") ?? 0,
    timezone,
    explicitEndDate
  );
}

function durationFromRange(result, startLocal, timezone, useExplicitEndDate = false) {
  return rangeEndInfo(result, startLocal, timezone, useExplicitEndDate).minutes;
}

function rangeEndClockRefinement(input, timezone, referenceDate) {
  if (!RANGE_END_REPLY.test(input)) return null;
  const result = casual.parse(input, parsingReference(referenceDate, timezone), { forwardDate: true })[0];
  if (!result?.start || !hasExplicitTime(input, result.start)) return null;
  const hour = getComponent(result.start, "hour");
  const minute = getComponent(result.start, "minute") ?? 0;
  return Number.isFinite(hour) && Number.isFinite(minute) ? { hour, minute } : null;
}

function localDateTime(component, timezone, fallback = {}) {
  if (!component) return null;
  const values = {
    year: getComponent(component, "year") ?? fallback.year,
    month: getComponent(component, "month") ?? fallback.month,
    day: getComponent(component, "day") ?? fallback.day,
    hour: getComponent(component, "hour") ?? fallback.hour,
    minute: getComponent(component, "minute") ?? fallback.minute ?? 0,
    second: getComponent(component, "second") ?? 0,
    millisecond: 0
  };
  if (![values.year, values.month, values.day, values.hour, values.minute].every(Number.isFinite)) return null;

  const local = DateTime.fromObject(values, { zone: timezone });
  if (!local.isValid) return null;
  // Luxon normalizes nonexistent wall-clock times during a DST jump. Treat that
  // as unresolved instead of silently moving somebody's meeting.
  if (local.year !== values.year || local.month !== values.month || local.day !== values.day || local.hour !== values.hour || local.minute !== values.minute) {
    return null;
  }
  return local;
}

function removeRanges(input, results) {
  if (!results.length) return input;
  let output = "";
  let cursor = 0;
  for (const result of [...results].sort((a, b) => a.index - b.index)) {
    output += input.slice(cursor, result.index);
    output += " ";
    cursor = result.index + result.text.length;
  }
  return output + input.slice(cursor);
}

function cleanTitle(input, results) {
  let title = removeRanges(input, results);
  title = title
    .replace(/\b(?:for|lasting|duration(?:\s+of)?)\s+(?:an?\s+|\d+(?:\.\d+)?\s*)?(?:hours?|hrs?|h|minutes?|mins?|m)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*[- ]\s*(?:hour|hr|minute|min)s?\b/gi, " ")
    .replace(/\b(?:on|in|at|from|until|till|to)\s*$/i, " ")
    .replace(/\b(?:to|in|on)\s+my\s+calendar\b/gi, " ")
    .replace(/\bcalendar\s+event\b/gi, " ")
    .replace(/^\s*(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|would\s+you\s+)?/i, "")
    .replace(/^\s*(?:add|create|schedule|book|put)\s+(?:an?\s+)?/i, "")
    .replace(/^\s*i\s+(?:have|got|need)\s+(?:an?\s+)?/i, "")
    .replace(/^\s*(?:(?:actually|instead|no)[,\s]+|(?:change|move|reschedule)\s+it\s+(?:to\s+)?)/i, "")
    .replace(/^\s*(?:a|an)\s+/i, "")
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return title.slice(0, MAX_TITLE_LENGTH);
}

function titleRefinement(input) {
  const match = /^(?:call|name|title)\s+(?:it|this)\s+(.+)$/i.exec(input)
    || /^(?:change|set)\s+(?:the\s+)?title\s+to\s+(.+)$/i.exec(input);
  if (!match) return null;
  const title = normalizeText(match[1]).replace(/[.!]+$/, "").trim();
  return title ? `${title.charAt(0).toUpperCase()}${title.slice(1)}`.slice(0, MAX_TITLE_LENGTH) : null;
}

function durationRefinement(input) {
  if (/^(?:make|set)\s+it\s+(?:a\s+)?half(?:\s+an?)?\s+hour\b/i.test(input)) return 30;
  const article = /^(?:make|set)\s+it\s+an?\s+(hour|minute)\b/i.exec(input);
  if (article) return article[1].toLowerCase().startsWith("h") ? 60 : 1;
  const match = /^(?:make|set)\s+it\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i.exec(input);
  if (!match) return durationFromText(input);
  const amount = Number(match[1]);
  const minutes = match[2].toLowerCase().startsWith("h") ? amount * 60 : amount;
  return Number.isInteger(minutes) && minutes > 0 && minutes <= 24 * 60 ? minutes : null;
}

function changesOnlyDuration(input) {
  return /^(?:(?:make|set)\s+it\s+|(?:for|lasting|duration(?:\s+of)?)\s+)?(?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)|an?\s+(?:hour|minute)|(?:a\s+)?half(?:\s+an?)?\s+hour)[.!]?$/i.test(input);
}

function validateDefaultDuration(value) {
  if (!Number.isInteger(value) || value < 15 || value > 480) {
    throw new RangeError("defaultDurationMinutes must be an integer between 15 and 480.");
  }
  return value;
}

function buildDraft({ input, timezone, result, results, title, explicitDate, explicitTime, durationMinutes, defaultDurationMinutes, previousDraft = null, explicitRangeEndDate = false }) {
  const component = result?.start;
  const parsedDate = explicitDate && component
    ? DateTime.fromObject({
      year: getComponent(component, "year"),
      month: getComponent(component, "month"),
      day: getComponent(component, "day")
    }, { zone: timezone })
    : null;
  const date = parsedDate?.isValid ? parsedDate.toISODate() : null;
  const hour = explicitTime ? getComponent(component, "hour") : null;
  const minute = explicitTime ? (getComponent(component, "minute") ?? 0) : null;
  const time = Number.isFinite(hour) && Number.isFinite(minute)
    ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    : null;

  const mergedDate = date ?? previousDraft?.date ?? null;
  const mergedTime = time ?? previousDraft?.time ?? null;
  const mergedTitle = title ?? previousDraft?.title ?? null;
  let mergedDuration = durationMinutes ?? previousDraft?.durationMinutes ?? null;

  let startLocal = null;
  if (mergedDate && mergedTime) {
    startLocal = DateTime.fromISO(`${mergedDate}T${mergedTime}`, { zone: timezone });
    const [requestedHour, requestedMinute] = mergedTime.split(":").map(Number);
    if (!startLocal.isValid || startLocal.hour !== requestedHour || startLocal.minute !== requestedMinute) startLocal = null;
  }

  const rangeDuration = startLocal && result ? durationFromRange(result, startLocal, timezone, explicitRangeEndDate) : null;
  if (durationMinutes == null && rangeDuration != null) mergedDuration = rangeDuration;
  if (startLocal && mergedDuration == null) mergedDuration = defaultDurationMinutes;

  const missing = [];
  if (!mergedTitle) missing.push("title");
  if (!mergedDate) missing.push("date");
  if (!mergedTime || (mergedDate && mergedTime && !startLocal)) missing.push("time");

  const start = startLocal?.isValid ? startLocal.toISO({ suppressMilliseconds: true }) : null;
  const end = startLocal?.isValid && mergedDuration
    ? startLocal.plus({ minutes: mergedDuration }).toISO({ suppressMilliseconds: true })
    : null;

  return {
    type: "calendar-event-draft",
    status: missing.length ? "needs_clarification" : "ready",
    title: mergedTitle,
    timezone,
    defaultDurationMinutes,
    date: mergedDate,
    time: mergedTime,
    durationMinutes: startLocal ? mergedDuration : (durationMinutes ?? previousDraft?.durationMinutes ?? null),
    start,
    end,
    missing,
    questions: missing.map((field) => ({
      field,
      prompt: field === "date"
        ? "What date should I use?"
        : field === "time"
          ? "What time should I use? Please include AM/PM or use 24-hour time."
          : "What should I call this event?"
    })),
    sourceText: input
  };
}

/**
 * Parse a single English calendar request into a non-mutating event draft.
 * This function never writes to a calendar and never fills in an omitted date
 * or time. It only applies the 60-minute default after both are explicit.
 */
export function parseCalendarRequest(text, {
  timezone = "UTC",
  now = () => new Date(),
  previousDraft = null,
  defaultDurationMinutes = previousDraft?.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES
} = {}) {
  assertTimezone(timezone);
  const safeDefaultDuration = validateDefaultDuration(defaultDurationMinutes);
  const input = normalizeSpokenCalendarNumbers(normalizeText(text));
  if (!input) {
    return buildDraft({ input, timezone, result: null, results: [], title: null, explicitDate: false, explicitTime: false, durationMinutes: null, defaultDurationMinutes: safeDefaultDuration, previousDraft });
  }
  if (input.length > MAX_INPUT_LENGTH) {
    return {
      type: "calendar-event-draft",
      status: "invalid",
      code: "INPUT_TOO_LONG",
      title: previousDraft?.title ?? null,
      timezone,
      defaultDurationMinutes: safeDefaultDuration,
      date: previousDraft?.date ?? null,
      time: previousDraft?.time ?? null,
      durationMinutes: previousDraft?.durationMinutes ?? null,
      start: previousDraft?.start ?? null,
      end: previousDraft?.end ?? null,
      missing: [],
      questions: [],
      sourceText: input.slice(0, MAX_INPUT_LENGTH)
    };
  }

  const referenceDate = asDate(now);
  const commandInput = previousDraft ? stripRequestCourtesy(input) : input;
  const invalidDuration = hasInvalidWrittenDuration(input);
  if (invalidDuration && previousDraft && looksOnlyLikeDuration(commandInput)) {
    return unresolvedDurationDraft({ ...previousDraft, sourceText: input });
  }
  const results = casual.parse(input, parsingReference(referenceDate, timezone), { forwardDate: true });
  const scheduleResults = results.filter((item) => !isDurationOnlyParseResult(item));
  const result = scheduleResults[0] ?? null;
  const writtenEnd = writtenRangeEnd(input);
  const explicitDuration = durationRefinement(commandInput);
  const onlyChangesDuration = changesOnlyDuration(commandInput);
  const editsExistingFields = Boolean(previousDraft && FIELD_EDIT_PREFIX.test(commandInput));
  const explicitDate = Boolean(!onlyChangesDuration && result && hasExplicitDate(input, result.start));
  const explicitTime = Boolean(!onlyChangesDuration && result && hasExplicitTime(input, result.start));
  const preserveKnownTitleDuringClarification = Boolean(previousDraft?.title && previousDraft?.missing?.length);
  const title = titleRefinement(commandInput) ?? (
    onlyChangesDuration || editsExistingFields || preserveKnownTitleDuringClarification
      ? null
      : cleanTitle(input, scheduleResults)
  );

  const draft = buildDraft({
    input,
    timezone,
    result: onlyChangesDuration ? null : result,
    results: scheduleResults,
    title,
    explicitDate,
    explicitTime,
    durationMinutes: explicitDuration,
    defaultDurationMinutes: safeDefaultDuration,
    previousDraft,
    explicitRangeEndDate: writtenEnd.hasExplicitDate
  });
  if (invalidDuration) return unresolvedDurationDraft(draft);
  if (unsafeNumericDate(input)) {
    return unresolvedDateDraft(
      draft,
      "AMBIGUOUS_DATE",
      "That numeric date is ambiguous. Please write the month name, for example 9 August 2026."
    );
  }
  if (writtenEnd.present && (!writtenEnd.startClock || !result?.start || !isCertain(result.start, "hour") || (
    getComponent(result.start, "hour") !== writtenEnd.startClock.hour
    || (getComponent(result.start, "minute") ?? 0) !== writtenEnd.startClock.minute
  ))) {
    return unresolvedTimeDraft(
      { ...draft, durationMinutes: null },
      "INVALID_TIME_RANGE",
      "I could not safely match those times. Please resend both times, for example ‘from 3 PM to 4 PM’."
    );
  }
  if (writtenEnd.present && (!writtenEnd.valid || !result?.end)) {
    return unresolvedRangeEndDraft(
      draft,
      "INVALID_RANGE_END",
      "I could not safely resolve that end time. Please include AM/PM, use a valid 24-hour time, or send a duration."
    );
  }
  if (writtenEnd.dateAfterTime) {
    return unresolvedRangeEndDraft(
      draft,
      "INVALID_RANGE_END_DATE",
      "Please put the full end date before its time, for example ‘to August 28 2026 at 9 AM’, or send a duration."
    );
  }
  if (writtenEnd.present && result?.end && (
    getComponent(result.end, "hour") !== writtenEnd.clock.hour
    || (getComponent(result.end, "minute") ?? 0) !== writtenEnd.clock.minute
  )) {
    return unresolvedRangeEndDraft(
      draft,
      "INVALID_RANGE_END",
      "I could not safely match the written end time. Please send a numeric end time with AM/PM, or send a duration."
    );
  }
  if (hasRepeatedLocalTime(draft)) {
    return unresolvedTimeDraft(
      draft,
      "AMBIGUOUS_TIMEZONE_OFFSET",
      "That clock time occurs twice because of a daylight-saving change. Please choose another nearby time, for example 2:30 AM."
    );
  }
  if (draft.date && draft.time && result?.end) {
    const startLocal = DateTime.fromISO(`${draft.date}T${draft.time}`, { zone: timezone });
    const range = rangeEndInfo(result, startLocal, timezone, writtenEnd.hasExplicitDate);
    if (range.problem) {
      return unresolvedRangeEndDraft(
        draft,
        range.problem,
        rangeEndPrompt(range.problem)
      );
    }
    if (explicitDuration != null && range.minutes != null && explicitDuration !== range.minutes) {
      return unresolvedDurationDraft(
        draft,
        "CONFLICTING_DURATION",
        `The written range is ${range.minutes} minutes, but the duration says ${explicitDuration} minutes. Please send one duration or a new end time.`
      );
    }
  }
  if (scheduleResults.length > 1) return unresolvedScheduleDraft(draft);
  if (draft.start && DateTime.fromISO(draft.start, { setZone: true }).toMillis() <= referenceDate.getTime()) {
    return unresolvedDateDraft(
      draft,
      "PAST_DATE_TIME",
      "That time is in the past. What future date should I use?"
    );
  }
  return draft;
}

export function refineCalendarDraft(previousDraft, text, options = {}) {
  if (!previousDraft || previousDraft.type !== "calendar-event-draft") {
    throw new TypeError("A calendar event draft is required for refinement.");
  }
  const timezone = options.timezone ?? previousDraft.timezone;
  const referenceDate = asDate(options.now ?? (() => new Date()));
  const expectedField = expectedClarificationField(previousDraft);
  const input = normalizeStandaloneDateReply(
    normalizeSpokenCalendarNumbers(normalizeText(text)),
    expectedField
  );
  const commandInput = stripRequestCourtesy(input);
  if (previousDraft.code === "INVALID_TIME_RANGE" && !writtenRangeEnd(commandInput).present) {
    return unresolvedTimeDraft(
      { ...previousDraft, durationMinutes: null, sourceText: input },
      "INVALID_TIME_RANGE",
      "Please resend both times, for example ‘from 3 PM to 4 PM’."
    );
  }
  if (previousDraft.code === "INVALID_DURATION") {
    const explicitDuration = durationRefinement(commandInput);
    if (!(changesOnlyDuration(commandInput) && explicitDuration != null && !hasInvalidWrittenDuration(commandInput))) {
      return unresolvedDurationDraft({ ...previousDraft, sourceText: input });
    }
  }
  if (["NONEXISTENT_RANGE_END", "AMBIGUOUS_RANGE_END", "RANGE_TOO_LONG", "INVALID_RANGE_END", "INVALID_RANGE_END_DATE"].includes(previousDraft.code)) {
    const explicitDuration = durationRefinement(commandInput);
    if (!(changesOnlyDuration(commandInput) && explicitDuration != null)) {
      const endClock = rangeEndClockRefinement(commandInput, timezone, referenceDate);
      if (!endClock) {
        return unresolvedRangeEndDraft(
          { ...previousDraft, sourceText: input },
          previousDraft.code,
          "Please reply with only a new end time, such as ‘to 2:30 AM’, or a duration, such as ‘for 60 minutes’."
        );
      }
      const startLocal = DateTime.fromISO(`${previousDraft.date}T${previousDraft.time}`, { zone: timezone });
      const rangeEnd = rangeEndFromClock(startLocal, endClock.hour, endClock.minute, timezone);
      if (rangeEnd.problem) {
        return unresolvedRangeEndDraft(
          { ...previousDraft, sourceText: input },
          rangeEnd.problem,
          rangeEndPrompt(rangeEnd.problem)
        );
      }
      return buildDraft({
        input,
        timezone,
        result: null,
        results: [],
        title: null,
        explicitDate: false,
        explicitTime: false,
        durationMinutes: rangeEnd.minutes,
        defaultDurationMinutes: options.defaultDurationMinutes ?? previousDraft.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES,
        previousDraft
      });
    }
  }
  const refinedTitle = titleRefinement(commandInput);
  if (refinedTitle) {
    return buildDraft({
      input,
      timezone,
      result: null,
      results: [],
      title: refinedTitle,
      explicitDate: false,
      explicitTime: false,
      durationMinutes: null,
      defaultDurationMinutes: options.defaultDurationMinutes ?? previousDraft.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES,
      previousDraft
    });
  }
  const refined = parseCalendarRequest(input, {
    timezone,
    now: () => referenceDate,
    defaultDurationMinutes: options.defaultDurationMinutes ?? previousDraft.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES,
    previousDraft
  });
  if (refined.code || !expectedField) return refined;
  if (expectedField === "date" && !refined.date) return unrecognizedClarificationDraft(previousDraft, expectedField, input);
  if (expectedField === "time" && !refined.time) return unrecognizedClarificationDraft(previousDraft, expectedField, input);
  if (expectedField === "title" && !refined.title) return unrecognizedClarificationDraft(previousDraft, expectedField, input);
  return refined;
}

export function isCalendarDraftReady(draft) {
  return Boolean(draft?.status === "ready" && draft.title && draft.start && draft.end && draft.timezone);
}

export function formatCalendarPreview(draft, { locale = "en" } = {}) {
  if (!draft || draft.type !== "calendar-event-draft") throw new TypeError("A calendar event draft is required.");
  const heading = `📅 ${draft.title || "Untitled event"}`;
  const date = draft.date
    ? DateTime.fromISO(draft.date, { zone: draft.timezone }).setLocale(locale).toFormat("ccc, LLL d, yyyy")
    : "Date needed";
  const timing = draft.start && draft.end
    ? `${DateTime.fromISO(draft.start, { setZone: true }).setLocale(locale).toFormat("h:mm a")}–${DateTime.fromISO(draft.end, { setZone: true }).setLocale(locale).toFormat("h:mm a")}`
    : draft.time
      ? DateTime.fromISO(`${draft.date || "2000-01-01"}T${draft.time}`, { zone: draft.timezone }).setLocale(locale).toFormat("h:mm a")
      : "Time needed";
  const lines = [heading, `${date} · ${timing}`, draft.timezone];
  if (draft.durationMinutes) lines[2] += ` · ${draft.durationMinutes} minutes`;
  if (draft.missing?.length) lines.push(`Missing: ${draft.missing.join(", ")}`);
  return lines.join("\n");
}
