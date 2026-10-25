import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCalendarAgenda,
  formatCalendarAgendaHtml,
  looksLikeCalendarAgendaRequest,
  resolveCalendarAgendaRequest
} from "../src/calendar-agenda.js";

const fixedNow = () => new Date("2026-08-25T20:20:00.000Z");

test("recognizes agenda reads without claiming calendar writes", () => {
  for (const input of [
    "What's on my calendar today?",
    "What’s on my calendar today?",
    "Whats on my calendar today?",
    "What is on my calendar tomorrow?",
    "What do I have on my calendar today?",
    "Tell me what's on my calendar today",
    "Show me what's on my calendar tomorrow",
    "What's my agenda for today?",
    "What's today's schedule?",
    "Do I have a meeting tomorrow?",
    "Can you tell me what I have today?",
    "Okay, what do I have tomorrow?",
    "So, do I have any meetings tomorrow?",
    "Show my meetings tomorrow",
    "List meetings today",
    "Tell me my schedule tomorrow",
    "Tomorrow's schedule",
    "Do I have meetings tomorrow?",
    "Show me today's meetings",
    "Are there meetings tomorrow?",
    "Can you show me my schedule for this week?",
    "What do I have today?",
    "Do I have any meetings tomorrow?",
    "Any calls today?",
    "/agenda",
    "/agenda tomorrow"
  ]) {
    assert.equal(looksLikeCalendarAgendaRequest(input), true, input);
  }

  for (const input of [
    "Could you schedule a meeting tomorrow at 3 PM?",
    "Add a call today at 4 PM",
    "Meeting with Nika tomorrow at 10 AM",
    "Move my meeting to tomorrow",
    "What's the weather today?",
    "What is on the agenda for today's meeting?"
  ]) {
    assert.equal(looksLikeCalendarAgendaRequest(input), false, input);
  }
});

test("resolves agenda periods with exclusive local-day boundaries", () => {
  const cases = [
    ["What's on my calendar?", "today", "2026-08-25T00:00:00+03:00", "2026-08-26T00:00:00+03:00"],
    ["What meetings do I have?", "today", "2026-08-25T00:00:00+03:00", "2026-08-26T00:00:00+03:00"],
    ["What's on my calendar today?", "today", "2026-08-25T00:00:00+03:00", "2026-08-26T00:00:00+03:00"],
    ["/agenda tomorrow", "tomorrow", "2026-08-26T00:00:00+03:00", "2026-08-27T00:00:00+03:00"],
    ["Show my calendar this week", "this-week", "2026-08-25T00:00:00+03:00", "2026-08-31T00:00:00+03:00"],
    ["Show my calendar for the next 7 days", "next-seven-days", "2026-08-25T00:00:00+03:00", "2026-09-01T00:00:00+03:00"],
    ["What's on my calendar today and tomorrow?", "today-and-tomorrow", "2026-08-25T00:00:00+03:00", "2026-08-27T00:00:00+03:00"],
    ["Show my calendar for the next 7 days starting tomorrow", "next-seven-days", "2026-08-26T00:00:00+03:00", "2026-09-02T00:00:00+03:00"]
  ];

  for (const [input, period, timeMin, timeMax] of cases) {
    assert.deepEqual(resolveCalendarAgendaRequest(input, {
      timezone: "Europe/Istanbul",
      now: fixedNow
    }), {
      type: "calendar-agenda-query",
      period,
      timezone: "Europe/Istanbul",
      timeMin,
      timeMax
    });
  }
});

test("clarifies unsupported or competing agenda periods instead of silently using today", () => {
  for (const input of [
    "/agenda Friday",
    "/agenda next week",
    "/agenda 2026-09-02",
    "What's on my calendar Wednesday?",
    "Show my calendar next month",
    "What's on my calendar today or tomorrow?",
    "What's on my calendar the day after tomorrow?",
    "What's on my calendar in two days?",
    "What's on my calendar this weekend?",
    "What's on my calendar for the next 2 days?",
    "What's on my calendar this month?",
    "What's on my calendar next year?",
    "What's on my calendar over the weekend?",
    "What's on my calendar on the 27th?",
    "Show my calendar for work",
    "What's on my calendar later today?",
    "What's on my calendar today after 3 PM?",
    "What's on my calendar tomorrow morning?"
  ]) {
    const query = resolveCalendarAgendaRequest(input, {
      timezone: "Europe/Istanbul",
      now: fixedNow
    });
    assert.equal(query.status, "needs_clarification", input);
    assert.equal(query.timeMin, undefined, input);
    assert.match(query.question, /today, tomorrow, this week, or the next 7 days/i, input);
  }
});

test("uses timezone-aware midnight across daylight-saving changes", () => {
  const query = resolveCalendarAgendaRequest("What's on my calendar today?", {
    timezone: "America/New_York",
    now: () => new Date("2026-03-08T16:00:00.000Z")
  });
  assert.equal(query.timeMin, "2026-03-08T00:00:00-05:00");
  assert.equal(query.timeMax, "2026-03-09T00:00:00-04:00");
  assert.equal(Date.parse(query.timeMax) - Date.parse(query.timeMin), 23 * 60 * 60 * 1000);
});

test("formats a compact chronological agenda with timed and all-day events", () => {
  const query = resolveCalendarAgendaRequest("What's on my calendar today?", {
    timezone: "Europe/Istanbul",
    now: fixedNow
  });
  const output = formatCalendarAgenda(query, {
    events: [
      { title: "Lunch", start: "2026-08-25T12:30:00+03:00", end: "2026-08-25T13:00:00+03:00", allDay: false },
      { title: "Product review", start: "2026-08-25T09:00:00+03:00", end: "2026-08-25T09:45:00+03:00", allDay: false },
      { title: "Company offsite", start: "2026-08-25", end: "2026-08-26", allDay: true }
    ]
  });

  assert.equal(output, [
    "📅 Today · Tue, Aug 25",
    "• All day — Company offsite",
    "• 9:00 AM–9:45 AM — Product review",
    "• 12:30 PM–1:00 PM — Lunch"
  ].join("\n"));
});

test("formats empty and truncated agendas cleanly", () => {
  const query = resolveCalendarAgendaRequest("/agenda tomorrow", {
    timezone: "Europe/Istanbul",
    now: fixedNow
  });
  assert.equal(
    formatCalendarAgenda(query, { events: [] }),
    "📅 Tomorrow · Wed, Aug 26\nNothing scheduled. Your calendar is clear."
  );
  assert.match(formatCalendarAgenda(query, {
    events: [
      { title: "One", start: "2026-08-26T09:00:00+03:00", end: "2026-08-26T10:00:00+03:00" },
      { title: "Two", start: "2026-08-26T11:00:00+03:00", end: "2026-08-26T12:00:00+03:00" }
    ]
  }, { maxEvents: 1 }), /…and 1 more event\.$/);
  assert.match(formatCalendarAgenda(query, {
    events: [{ title: "One", start: "2026-08-26T09:00:00+03:00", end: "2026-08-26T10:00:00+03:00" }],
    truncated: true
  }), /More events are available in Google Calendar\.$/);
});

test("formats a safe, scannable Telegram calendar card", () => {
  const query = resolveCalendarAgendaRequest("/agenda this week", {
    timezone: "Europe/Istanbul",
    now: fixedNow
  });
  const html = formatCalendarAgendaHtml(query, {
    events: [{
      title: "Review <launch> & pricing",
      start: "2026-08-25T09:00:00+03:00",
      end: "2026-08-25T09:45:00+03:00"
    }]
  });
  assert.match(html, /^<b>📅 The rest of this week<\/b>/);
  assert.match(html, /<code>1 event<\/code>/);
  assert.match(html, /<b>Tue, Aug 25 · 9:00 AM–9:45 AM<\/b>/);
  assert.match(html, /Review &lt;launch&gt; &amp; pricing/);
  assert.doesNotMatch(html, /<launch>/);
});
