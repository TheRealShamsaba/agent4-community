import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCalendarPreview,
  isCalendarDraftReady,
  parseCalendarRequest,
  refineCalendarDraft
} from "../src/calendar.js";

const mondayMorning = () => new Date("2026-08-24T07:00:00.000Z");

test("parses a forward weekday in the configured timezone", () => {
  const draft = parseCalendarRequest("I have a meeting with Arman on Wednesday at 3:00 PM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });

  assert.equal(draft.status, "ready");
  assert.equal(draft.title, "Meeting with Arman");
  assert.equal(draft.date, "2026-08-26");
  assert.equal(draft.time, "15:00");
  assert.equal(draft.durationMinutes, 60);
  assert.equal(draft.start, "2026-08-26T15:00:00+03:00");
  assert.equal(draft.end, "2026-08-26T16:00:00+03:00");
  assert.deepEqual(draft.missing, []);
  assert.equal(isCalendarDraftReady(draft), true);
});

test("uses the IANA timezone offset across DST instead of the server timezone", () => {
  const draft = parseCalendarRequest("Customer planning on March 30, 2026 at 9:00 AM", {
    timezone: "Europe/London",
    now: () => new Date("2026-03-20T12:00:00.000Z")
  });

  assert.equal(draft.start, "2026-03-30T09:00:00+01:00");
  assert.equal(draft.end, "2026-03-30T10:00:00+01:00");
});

test("honors a validated runtime default duration across follow-ups", () => {
  const initial = parseCalendarRequest("Meeting with Darya on Wednesday", {
    timezone: "Europe/Istanbul",
    now: mondayMorning,
    defaultDurationMinutes: 45
  });
  assert.equal(initial.defaultDurationMinutes, 45);
  assert.equal(initial.durationMinutes, null);

  const completed = refineCalendarDraft(initial, "at 2:00 PM", { now: mondayMorning });
  assert.equal(completed.defaultDurationMinutes, 45);
  assert.equal(completed.durationMinutes, 45);
  assert.equal(completed.end, "2026-08-26T14:45:00+03:00");

  const overridden = refineCalendarDraft(initial, "at 2:00 PM", {
    now: mondayMorning,
    defaultDurationMinutes: 30
  });
  assert.equal(overridden.durationMinutes, 30);

  for (const invalid of [14, 481, 30.5, Number.NaN]) {
    assert.throws(
      () => parseCalendarRequest("Meeting Wednesday at noon", { timezone: "UTC", defaultDurationMinutes: invalid }),
      /integer between 15 and 480/
    );
  }
});

test("does not invent an omitted time or apply the default duration early", () => {
  const draft = parseCalendarRequest("Meeting with Reza on Wednesday", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });

  assert.equal(draft.status, "needs_clarification");
  assert.equal(draft.date, "2026-08-26");
  assert.equal(draft.time, null);
  assert.equal(draft.start, null);
  assert.equal(draft.end, null);
  assert.equal(draft.durationMinutes, null);
  assert.deepEqual(draft.missing, ["time"]);
  assert.match(draft.questions[0].prompt, /AM\/PM/);
});

test("does not invent an omitted date", () => {
  const draft = parseCalendarRequest("Lunch with Ada at 1:00 PM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });

  assert.equal(draft.title, "Lunch with Ada");
  assert.equal(draft.date, null);
  assert.equal(draft.time, "13:00");
  assert.equal(draft.durationMinutes, null);
  assert.deepEqual(draft.missing, ["date"]);
});

test("merges standalone date replies without corrupting known calendar fields", () => {
  const initial = parseCalendarRequest("Meeting with Chubin at 7 AM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning,
    defaultDurationMinutes: 45
  });
  assert.deepEqual(initial.missing, ["date"]);

  for (const reply of ["Tomorrow", "Tommrow", "Tomorow", "Tommorow", "tmrw"]) {
    const refined = refineCalendarDraft(initial, reply, { now: mondayMorning });
    assert.equal(refined.status, "ready", reply);
    assert.equal(refined.title, "Meeting with Chubin", reply);
    assert.equal(refined.date, "2026-08-25", reply);
    assert.equal(refined.time, "07:00", reply);
    assert.equal(refined.durationMinutes, 45, reply);
  }

  for (const reply of ["banana", "banana at 8 PM", "banana for 2 hours"]) {
    const unrecognized = refineCalendarDraft(initial, reply, { now: mondayMorning });
    assert.equal(unrecognized.status, "needs_clarification", reply);
    assert.equal(unrecognized.code, "UNRECOGNIZED_DATE_REPLY", reply);
    assert.equal(unrecognized.title, initial.title, reply);
    assert.equal(unrecognized.date, initial.date, reply);
    assert.equal(unrecognized.time, initial.time, reply);
    assert.equal(unrecognized.durationMinutes, initial.durationMinutes, reply);
    assert.equal(unrecognized.start, initial.start, reply);
    assert.equal(unrecognized.end, initial.end, reply);
    assert.match(unrecognized.questions[0].prompt, /tomorrow.*Wednesday.*August 26/i, reply);
  }
});

test("treats an hour without AM/PM as unresolved instead of guessing", () => {
  const draft = parseCalendarRequest("Sales call Wednesday at 3", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });

  assert.equal(draft.date, "2026-08-26");
  assert.equal(draft.time, null);
  assert.deepEqual(draft.missing, ["time"]);
});

test("supports explicit duration phrases and time ranges", () => {
  const duration = parseCalendarRequest("Product review Friday at 15:30 for 90 minutes", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  assert.equal(duration.durationMinutes, 90);
  assert.equal(duration.end, "2026-08-28T17:00:00+03:00");

  const range = parseCalendarRequest("Vendor call Wednesday from 3:00 PM to 4:30 PM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  assert.equal(range.durationMinutes, 90);
  assert.equal(range.end, "2026-08-26T16:30:00+03:00");

  const decimalHours = parseCalendarRequest("Product review Friday at 3 PM for 1.5 hours", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  assert.equal(decimalHours.status, "ready");
  assert.equal(decimalHours.durationMinutes, 90);
  assert.equal(decimalHours.end, "2026-08-28T16:30:00+03:00");
});

test("asks for a valid duration instead of applying the default", () => {
  for (const phrase of ["for 0 minutes", "for 1441 minutes", "for -1 minutes", "for 1.5 minutes"]) {
    const draft = parseCalendarRequest(`Meeting Wednesday at 3 PM ${phrase}`, {
      timezone: "Europe/Istanbul",
      now: mondayMorning
    });
    assert.equal(draft.status, "needs_clarification", phrase);
    assert.equal(draft.code, "INVALID_DURATION", phrase);
    assert.equal(draft.durationMinutes, null, phrase);
    assert.equal(draft.end, null, phrase);
  }

  const initial = parseCalendarRequest("Meeting Wednesday at 3 PM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  const refined = refineCalendarDraft(initial, "make it 1.5 hours", { now: mondayMorning });
  assert.equal(refined.status, "ready");
  assert.equal(refined.durationMinutes, 90);
  assert.equal(refined.date, initial.date);

  for (const phrase of ["make it .5 hours", "make it 1,5 hours"]) {
    const decimal = refineCalendarDraft(initial, phrase, { now: mondayMorning });
    assert.equal(decimal.status, "ready", phrase);
    assert.equal(decimal.durationMinutes, phrase.includes(".5") ? 30 : 90, phrase);
    assert.equal(decimal.title, initial.title, phrase);
    assert.equal(decimal.date, initial.date, phrase);
    assert.equal(decimal.time, initial.time, phrase);
  }

  const invalid = parseCalendarRequest("Meeting Wednesday at 3 PM for 0 minutes", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  for (const reply of ["call it Sales sync", "at 4 PM", "actually Thursday", "no idea"]) {
    const locked = refineCalendarDraft(invalid, reply, { now: mondayMorning });
    assert.equal(locked.status, "needs_clarification", reply);
    assert.equal(locked.code, "INVALID_DURATION", reply);
    assert.equal(locked.durationMinutes, null, reply);
    assert.equal(locked.title, invalid.title, reply);
    assert.equal(locked.date, invalid.date, reply);
    assert.equal(locked.time, invalid.time, reply);
  }

  for (const reply of ["make it +2 hours", "please, make it +2 hours", "set it to +2 hours", "make it -2 hours"]) {
    const signed = refineCalendarDraft(initial, reply, { now: mondayMorning });
    assert.equal(signed.status, "needs_clarification", reply);
    assert.equal(signed.code, "INVALID_DURATION", reply);
    assert.equal(signed.title, initial.title, reply);
    assert.equal(signed.date, initial.date, reply);
    assert.equal(signed.time, initial.time, reply);
    assert.equal(signed.start, initial.start, reply);
    assert.equal(signed.end, null, reply);

    const recovered = refineCalendarDraft(signed, "for 60 minutes", { now: mondayMorning });
    assert.equal(recovered.status, "ready", reply);
    assert.equal(recovered.start, initial.start, reply);
    assert.equal(recovered.durationMinutes, 60, reply);
  }
});

test("normalizes common voice-style times and durations", () => {
  const draft = parseCalendarRequest("Meeting with Nima Wednesday at three PM for forty-five minutes", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });

  assert.equal(draft.status, "ready");
  assert.equal(draft.title, "Meeting with Nima");
  assert.equal(draft.time, "15:00");
  assert.equal(draft.durationMinutes, 45);
  assert.equal(draft.end, "2026-08-26T15:45:00+03:00");
});

test("asks before using an ambiguous numeric date or a past date", () => {
  const ambiguous = parseCalendarRequest("Meeting on 08/09/2026 at 3 PM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  assert.equal(ambiguous.status, "needs_clarification");
  assert.equal(ambiguous.code, "AMBIGUOUS_DATE");
  assert.equal(ambiguous.date, null);
  assert.equal(ambiguous.start, null);
  assert.equal(isCalendarDraftReady(ambiguous), false);
  assert.match(ambiguous.questions[0].prompt, /month name/i);

  const ambiguousHyphen = parseCalendarRequest("Meeting on 09-10-2026 at 3 PM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  assert.equal(ambiguousHyphen.status, "needs_clarification");
  assert.equal(ambiguousHyphen.code, "AMBIGUOUS_DATE");
  assert.equal(ambiguousHyphen.date, null);

  const ambiguousShortHyphen = parseCalendarRequest("Meeting on 09-10 at 3 PM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  assert.equal(ambiguousShortHyphen.status, "needs_clarification");
  assert.equal(ambiguousShortHyphen.code, "AMBIGUOUS_DATE");
  assert.equal(ambiguousShortHyphen.date, null);

  for (const token of [
    "10-10", "13-10", "31-12", "12-31", "13-13", "13/13", "31.12", "2026-13-13",
    "2027-01-01-02", "2027-01-01/02", "11-2027-01-01"
  ]) {
    const unsafe = parseCalendarRequest(`Meeting on ${token} at 3 PM`, {
      timezone: "Europe/Istanbul",
      now: mondayMorning
    });
    assert.equal(unsafe.status, "needs_clarification", token);
    assert.equal(unsafe.code, "AMBIGUOUS_DATE", token);
    assert.equal(unsafe.date, null, token);
  }

  const iso = parseCalendarRequest("Meeting on 2026-09-10 at 3 PM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  assert.equal(iso.status, "ready");
  assert.equal(iso.date, "2026-09-10");

  const past = parseCalendarRequest("Meeting August 20 2026 at 3 PM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  assert.equal(past.status, "needs_clarification");
  assert.equal(past.code, "PAST_DATE_TIME");
  assert.equal(past.date, null);
  assert.match(past.questions[0].prompt, /past/i);
});

test("does not silently choose one of two repeated DST clock times", () => {
  const draft = parseCalendarRequest("Meeting October 25 2026 at 1:30 AM", {
    timezone: "Europe/London",
    now: () => new Date("2026-10-01T12:00:00.000Z")
  });

  assert.equal(draft.status, "needs_clarification");
  assert.equal(draft.code, "AMBIGUOUS_TIMEZONE_OFFSET");
  assert.equal(draft.date, "2026-10-25");
  assert.equal(draft.time, null);
  assert.equal(draft.start, null);
  assert.match(draft.questions[0].prompt, /daylight-saving/i);
});

test("does not normalize invalid or repeated DST range end times", () => {
  const nonexistent = parseCalendarRequest("Meeting March 29 2026 from 12:30 AM to 1:30 AM", {
    timezone: "Europe/London",
    now: () => new Date("2026-03-01T12:00:00.000Z")
  });
  assert.equal(nonexistent.status, "needs_clarification");
  assert.equal(nonexistent.code, "NONEXISTENT_RANGE_END");
  assert.equal(nonexistent.time, "00:30");
  assert.equal(nonexistent.end, null);
  assert.equal(nonexistent.durationMinutes, null);
  assert.deepEqual(nonexistent.missing, ["endTime"]);
  assert.match(nonexistent.questions[0].prompt, /does not exist/i);
  assert.equal(isCalendarDraftReady(nonexistent), false);

  const repeated = parseCalendarRequest("Meeting October 25 2026 from 12:30 AM to 1:30 AM", {
    timezone: "Europe/London",
    now: () => new Date("2026-10-01T12:00:00.000Z")
  });
  assert.equal(repeated.status, "needs_clarification");
  assert.equal(repeated.code, "AMBIGUOUS_RANGE_END");
  assert.equal(repeated.end, null);
  assert.match(repeated.questions[0].prompt, /occurs twice/i);

  const correctedEnd = refineCalendarDraft(nonexistent, "to 2:30 AM", {
    now: () => new Date("2026-03-01T12:00:00.000Z")
  });
  assert.equal(correctedEnd.status, "ready");
  assert.equal(correctedEnd.start, "2026-03-29T00:30:00+00:00");
  assert.equal(correctedEnd.end, "2026-03-29T02:30:00+01:00");
  assert.equal(correctedEnd.durationMinutes, 60);

  const invalidReply = refineCalendarDraft(nonexistent, "change it however you want", {
    now: () => new Date("2026-03-01T12:00:00.000Z")
  });
  assert.equal(invalidReply.status, "needs_clarification");
  assert.equal(invalidReply.start, nonexistent.start);
  assert.equal(invalidReply.time, "00:30");

  const correctedDuration = refineCalendarDraft(nonexistent, "for 60 minutes", {
    now: () => new Date("2026-03-01T12:00:00.000Z")
  });
  assert.equal(correctedDuration.status, "ready");
  assert.equal(correctedDuration.start, "2026-03-29T00:30:00+00:00");
  assert.equal(correctedDuration.end, "2026-03-29T02:30:00+01:00");
});

test("does not replace a DST-overlong range with the default duration", () => {
  const overlong = parseCalendarRequest("Meeting October 25 2026 from 12:30 AM to 12:30 AM", {
    timezone: "Europe/London",
    now: () => new Date("2026-10-01T12:00:00.000Z")
  });
  assert.equal(overlong.status, "needs_clarification");
  assert.equal(overlong.code, "RANGE_TOO_LONG");
  assert.equal(overlong.start, "2026-10-25T00:30:00+01:00");
  assert.equal(overlong.end, null);
  assert.equal(overlong.durationMinutes, null);
  assert.match(overlong.questions[0].prompt, /longer than 24 hours/i);

  const stillOverlong = refineCalendarDraft(overlong, "to 12:30 AM", {
    now: () => new Date("2026-10-01T12:00:00.000Z")
  });
  assert.equal(stillOverlong.status, "needs_clarification");
  assert.equal(stillOverlong.code, "RANGE_TOO_LONG");
  assert.equal(stillOverlong.start, overlong.start);
  assert.equal(stillOverlong.end, null);

  const corrected = refineCalendarDraft(overlong, "to 2:30 AM", {
    now: () => new Date("2026-10-01T12:00:00.000Z")
  });
  assert.equal(corrected.status, "ready");
  assert.equal(corrected.start, overlong.start);
  assert.equal(corrected.end, "2026-10-25T02:30:00+00:00");
  assert.equal(corrected.durationMinutes, 180);
});

test("fails closed on malformed or meridiem-ambiguous written range ends", () => {
  for (const endpoint of ["25:00", "13:99", "3"]) {
    const draft = parseCalendarRequest(`Meeting tomorrow from 3 PM to ${endpoint}`, {
      timezone: "Europe/Istanbul",
      now: mondayMorning
    });
    assert.equal(draft.status, "needs_clarification", endpoint);
    assert.equal(draft.code, "INVALID_RANGE_END", endpoint);
    assert.equal(draft.end, null, endpoint);
    assert.equal(draft.durationMinutes, null, endpoint);
    assert.match(draft.questions[0].prompt, /AM\/PM|24-hour/i, endpoint);
  }

  const inferredMeridiem = parseCalendarRequest("Meeting Wednesday from 11 AM to 1", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  assert.equal(inferredMeridiem.status, "needs_clarification");
  assert.equal(inferredMeridiem.code, "INVALID_RANGE_END");

  for (const punctuation of [",", ";"]) {
    const punctuated = parseCalendarRequest(`Meeting tomorrow from 3 PM${punctuation} to 5 PM`, {
      timezone: "Europe/Istanbul",
      now: mondayMorning
    });
    assert.equal(punctuated.status, "needs_clarification", punctuation);
    assert.equal(punctuated.code, "INVALID_RANGE_END", punctuation);
    assert.equal(punctuated.end, null, punctuation);
  }

  for (const separator of ["-", "–", "—"]) {
    const malformedDash = parseCalendarRequest(`Meeting tomorrow at 3 PM ${separator} 25:00`, {
      timezone: "Europe/Istanbul",
      now: mondayMorning
    });
    assert.equal(malformedDash.status, "needs_clarification", separator);
    assert.equal(malformedDash.code, "INVALID_RANGE_END", separator);

    const ambiguousDash = parseCalendarRequest(`Meeting tomorrow at 3 PM ${separator} 4`, {
      timezone: "Europe/Istanbul",
      now: mondayMorning
    });
    assert.equal(ambiguousDash.status, "needs_clarification", separator);
    assert.equal(ambiguousDash.code, "INVALID_RANGE_END", separator);

    const malformedTightDash = parseCalendarRequest(`Meeting tomorrow at 3 PM${separator}25:00`, {
      timezone: "Europe/Istanbul",
      now: mondayMorning
    });
    assert.equal(malformedTightDash.status, "needs_clarification", `tight ${separator}`);
    assert.equal(malformedTightDash.code, "INVALID_RANGE_END", `tight ${separator}`);
  }

  for (const purpose of ["to discuss Q4", "to review item 4"]) {
    const notARange = parseCalendarRequest(`Meeting tomorrow at 3 PM ${purpose}`, {
      timezone: "Europe/Istanbul",
      now: mondayMorning
    });
    assert.equal(notARange.status, "ready", purpose);
    assert.notEqual(notARange.code, "INVALID_RANGE_END", purpose);
  }

  for (const endpoint of ["noon", "midnight"]) {
    const swappedByParser = parseCalendarRequest(`Meeting March 28 2026 from 3 PM to ${endpoint}`, {
      timezone: "Europe/London",
      now: () => new Date("2026-03-01T12:00:00.000Z")
    });
    assert.equal(swappedByParser.status, "needs_clarification", endpoint);
    assert.equal(swappedByParser.code, "INVALID_TIME_RANGE", endpoint);
    assert.equal(swappedByParser.start, null, endpoint);
    assert.equal(swappedByParser.time, null, endpoint);

    const repaired = refineCalendarDraft(swappedByParser, "from 3 PM to 4 PM", {
      now: () => new Date("2026-03-01T12:00:00.000Z")
    });
    assert.equal(repaired.status, "ready", endpoint);
    assert.equal(repaired.time, "15:00", endpoint);
    assert.equal(repaired.durationMinutes, 60, endpoint);
  }

  const specialStart = parseCalendarRequest("Meeting March 28 2026 from noon to 3 PM", {
    timezone: "Europe/London",
    now: () => new Date("2026-03-01T12:00:00.000Z")
  });
  assert.equal(specialStart.status, "needs_clarification");
  assert.equal(specialStart.code, "INVALID_TIME_RANGE");
  assert.equal(specialStart.start, null);

  const repairedSpecialStart = refineCalendarDraft(specialStart, "from 12 PM to 3 PM", {
    now: () => new Date("2026-03-01T12:00:00.000Z")
  });
  assert.equal(repairedSpecialStart.status, "ready");
  assert.equal(repairedSpecialStart.time, "12:00");
  assert.equal(repairedSpecialStart.durationMinutes, 180);
});

test("honors an explicit range-end date instead of shortening it", () => {
  const withinLimit = parseCalendarRequest("Meeting March 28 2026 from 11:30 PM to March 29 2026 at 2:30 AM", {
    timezone: "Europe/London",
    now: () => new Date("2026-03-01T12:00:00.000Z")
  });
  assert.equal(withinLimit.status, "ready");
  assert.equal(withinLimit.start, "2026-03-28T23:30:00+00:00");
  assert.equal(withinLimit.end, "2026-03-29T02:30:00+01:00");
  assert.equal(withinLimit.durationMinutes, 120);

  const overLimit = parseCalendarRequest("Meeting March 28 2026 from 11:30 PM to March 30 2026 at 2:30 AM", {
    timezone: "Europe/London",
    now: () => new Date("2026-03-01T12:00:00.000Z")
  });
  assert.equal(overLimit.status, "needs_clarification");
  assert.equal(overLimit.code, "RANGE_TOO_LONG");
  assert.equal(overLimit.end, null);

  for (const request of [
    "Meeting from Wednesday 10 PM to Friday 9 AM",
    "Meeting August 26 2026 from 10 PM to August 28 at 9 AM",
    "Meeting Wednesday from 10 AM to Thursday at 11 AM",
    "Meeting August 26 2026 from 10 AM to August 27 at 11 AM"
  ]) {
    const partialEndDate = parseCalendarRequest(request, {
      timezone: "UTC",
      now: () => new Date("2026-08-01T12:00:00.000Z")
    });
    assert.equal(partialEndDate.status, "needs_clarification", request);
    assert.equal(partialEndDate.code, "INVALID_RANGE_END_DATE", request);
    assert.equal(partialEndDate.end, null, request);
  }

  for (const request of [
    "Meeting August 26 2026 from 10 PM to 9 AM August 28 2026",
    "Meeting August 26 2026 from 10 PM to 9 AM on August 28 2026"
  ]) {
    const suffixEndDate = parseCalendarRequest(request, {
      timezone: "UTC",
      now: () => new Date("2026-08-01T12:00:00.000Z")
    });
    assert.equal(suffixEndDate.status, "needs_clarification", request);
    assert.equal(suffixEndDate.code, "INVALID_RANGE_END_DATE", request);
    assert.equal(suffixEndDate.end, null, request);
  }
});

test("clarifies conflicting durations and competing schedules", () => {
  for (const duration of ["30 minutes", "2 hours"]) {
    const conflict = parseCalendarRequest(`Meeting Wednesday from 3 PM to 4 PM for ${duration}`, {
      timezone: "Europe/Istanbul",
      now: mondayMorning
    });
    assert.equal(conflict.status, "needs_clarification", duration);
    assert.equal(conflict.code, "CONFLICTING_DURATION", duration);
    assert.equal(conflict.end, null, duration);
  }

  const consistent = parseCalendarRequest("Meeting Wednesday from 3 PM to 4 PM for 60 minutes", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  assert.equal(consistent.status, "ready");
  assert.equal(consistent.durationMinutes, 60);

  for (const request of [
    "Meeting Wednesday at 3 PM, actually Thursday at 4 PM",
    "Meeting Wednesday at 3 PM or 4 PM",
    "Meeting Wednesday at 3 PM and Friday at 4 PM"
  ]) {
    const multiple = parseCalendarRequest(request, {
      timezone: "Europe/Istanbul",
      now: mondayMorning
    });
    assert.equal(multiple.status, "needs_clarification", request);
    assert.equal(multiple.code, "MULTIPLE_DATE_TIMES", request);
    assert.equal(multiple.start, null, request);
    assert.equal(multiple.end, null, request);
  }
});

test("refines missing fields without losing known fields", () => {
  const initial = parseCalendarRequest("Meeting with Reza on Wednesday", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  const timed = refineCalendarDraft(initial, "at 3:00 PM for 30 minutes", { now: mondayMorning });

  assert.equal(timed.status, "ready");
  assert.equal(timed.title, "Meeting with Reza");
  assert.equal(timed.date, "2026-08-26");
  assert.equal(timed.time, "15:00");
  assert.equal(timed.durationMinutes, 30);

  const retitled = refineCalendarDraft(timed, "call it Export partner sync", { now: mondayMorning });
  assert.equal(retitled.title, "Export partner sync");
  assert.equal(retitled.start, timed.start);
  assert.equal(retitled.end, timed.end);

  const shortened = refineCalendarDraft(retitled, "make it 15 minutes", { now: mondayMorning });
  assert.equal(shortened.title, "Export partner sync");
  assert.equal(shortened.durationMinutes, 15);
  assert.equal(shortened.end, "2026-08-26T15:15:00+03:00");

  const corrected = refineCalendarDraft(shortened, "actually Thursday at 4:00 PM", { now: mondayMorning });
  assert.equal(corrected.title, "Export partner sync");
  assert.equal(corrected.date, "2026-08-27");
  assert.equal(corrected.time, "16:00");

  const halfHour = refineCalendarDraft(corrected, "for half an hour", { now: mondayMorning });
  assert.equal(halfHour.title, "Export partner sync");
  assert.equal(halfHour.date, "2026-08-27");
  assert.equal(halfHour.time, "16:00");
  assert.equal(halfHour.durationMinutes, 30);

  const ready = parseCalendarRequest("Sales sync Wednesday at 3 PM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  for (const [reply, expectedTitle] of [
    ["call it Monday planning", "Monday planning"],
    ["call it 4 PM follow-up", "4 PM follow-up"],
    ["call it September 10 launch", "September 10 launch"],
    ["title this Midnight review", "Midnight review"]
  ]) {
    const titleOnly = refineCalendarDraft(ready, reply, { now: mondayMorning });
    assert.equal(titleOnly.title, expectedTitle, reply);
    assert.equal(titleOnly.start, ready.start, reply);
    assert.equal(titleOnly.end, ready.end, reply);
  }

  for (const reply of [
    "make it 4 PM",
    "set it to 4 PM",
    "change date to Friday",
    "set time to 4 PM",
    "reschedule for Friday at 4 PM",
    "move to Friday at 4 PM"
  ]) {
    const fieldOnly = refineCalendarDraft(ready, reply, { now: mondayMorning });
    assert.equal(fieldOnly.title, ready.title, reply);
  }

  for (const reply of [
    "please change date to Friday",
    "can you set time to 4 PM",
    "could you reschedule for Friday at 4 PM"
  ]) {
    const politeFieldEdit = refineCalendarDraft(ready, reply, { now: mondayMorning });
    assert.equal(politeFieldEdit.title, ready.title, reply);
  }

  for (const [reply, expectedTitle] of [
    ["please call it Monday planning", "Monday planning"],
    ["can you call it 4 PM follow-up", "4 PM follow-up"],
    ["could you change the title to Friday review", "Friday review"],
    ["please, call it Monday planning", "Monday planning"],
    ["can you, call it 4 PM follow-up", "4 PM follow-up"]
  ]) {
    const politeTitleEdit = refineCalendarDraft(ready, reply, { now: mondayMorning });
    assert.equal(politeTitleEdit.title, expectedTitle, reply);
    assert.equal(politeTitleEdit.start, ready.start, reply);
    assert.equal(politeTitleEdit.end, ready.end, reply);
  }
});

test("formats a compact preview for confirmation", () => {
  const draft = parseCalendarRequest("I have a meeting with Arman on Wednesday at 3:00 PM", {
    timezone: "Europe/Istanbul",
    now: mondayMorning
  });
  assert.equal(formatCalendarPreview(draft), [
    "📅 Meeting with Arman",
    "Wed, Aug 26, 2026 · 3:00 PM–4:00 PM",
    "Europe/Istanbul · 60 minutes"
  ].join("\n"));
});

test("rejects invalid timezones and bounds oversized input", () => {
  assert.throws(
    () => parseCalendarRequest("Meeting tomorrow at noon", { timezone: "Mars/Olympus" }),
    /valid IANA timezone/
  );
  const draft = parseCalendarRequest("x".repeat(501), { timezone: "UTC" });
  assert.equal(draft.status, "invalid");
  assert.equal(draft.code, "INPUT_TOO_LONG");
});
