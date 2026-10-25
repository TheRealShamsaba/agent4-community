import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GoogleCalendarConnector,
  googleEventId
} from "../src/connectors/google-calendar.js";

const readyDraft = {
  type: "calendar-event-draft",
  status: "ready",
  title: "Partner meeting",
  timezone: "Europe/Istanbul",
  date: "2026-08-26",
  time: "15:00",
  durationMinutes: 60,
  start: "2026-08-26T15:00:00+03:00",
  end: "2026-08-26T16:00:00+03:00",
  missing: []
};

function json(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  };
}

function connector(fetchImpl) {
  return new GoogleCalendarConnector({
    clientId: "client-id",
    clientSecret: "client-secret",
    refreshToken: "refresh-token",
    fetchImpl,
    now: () => new Date("2026-08-24T10:00:00.000Z")
  });
}

test("documents the narrow Google Calendar events scope and makes safe deterministic IDs", () => {
  assert.equal(GOOGLE_CALENDAR_EVENTS_SCOPE, "https://www.googleapis.com/auth/calendar.events.owned");
  const first = googleEventId("telegram:42:update:987");
  assert.equal(first, googleEventId("telegram:42:update:987"));
  assert.notEqual(first, googleEventId("telegram:42:update:988"));
  assert.match(first, /^[a-v0-9]{5,1024}$/);
  assert.doesNotMatch(first, /telegram|987/);
});

test("refreshes OAuth and creates the exact confirmed event", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "access-one", expires_in: 3600 });
    return json({ id: JSON.parse(options.body).id, htmlLink: "https://calendar.google.com/event/1" });
  };

  const result = await connector(fetchImpl).createEvent({ draft: readyDraft, actionKey: "chat-42:message-9" });
  assert.equal(result.created, true);
  assert.equal(result.idempotent, false);
  assert.equal(calls.length, 2);

  const tokenBody = calls[0].options.body;
  assert.equal(tokenBody.get("grant_type"), "refresh_token");
  assert.equal(calls[1].options.headers.authorization, "Bearer access-one");
  const event = JSON.parse(calls[1].options.body);
  assert.deepEqual(event, {
    id: googleEventId("chat-42:message-9"),
    summary: "Partner meeting",
    start: { dateTime: readyDraft.start, timeZone: "Europe/Istanbul" },
    end: { dateTime: readyDraft.end, timeZone: "Europe/Istanbul" },
    reminders: { useDefault: true },
    extendedProperties: { private: { agent4EventId: googleEventId("chat-42:message-9") } }
  });
  assert.doesNotMatch(calls[1].options.body, /chat-42|message-9|transcript/i);
});

test("recovers a deterministic duplicate with GET after Google returns 409", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (new URL(url).origin === "https://oauth2.googleapis.com") return json({ access_token: "access-one", expires_in: 3600 });
    if (options.method === "POST") return json({ error: { message: "duplicate" } }, 409);
    return json({ id: googleEventId("same-action"), summary: "Partner meeting" });
  };

  const result = await connector(fetchImpl).createEvent({ draft: readyDraft, actionKey: "same-action" });
  assert.equal(result.created, false);
  assert.equal(result.idempotent, true);
  assert.equal(result.event.id, googleEventId("same-action"));
  assert.equal(calls.length, 3);
  assert.match(calls[2].url, new RegExp(`/events/${googleEventId("same-action")}$`));
  assert.equal(calls[2].options.method, "GET");
});

test("rejects incomplete drafts before making a network request", async () => {
  let called = false;
  const calendar = connector(async () => {
    called = true;
    return json({});
  });
  await assert.rejects(
    calendar.createEvent({ draft: { ...readyDraft, status: "needs_clarification", start: null }, actionKey: "draft" }),
    (error) => error.code === "DRAFT_NOT_READY"
  );
  assert.equal(called, false);
});

test("sanitizes OAuth, API, and transport failures", async (t) => {
  await t.test("OAuth payload is not reflected", async () => {
    const calendar = connector(async () => json({ error_description: "refresh-token client-secret" }, 400));
    await assert.rejects(calendar.createEvent({ draft: readyDraft, actionKey: "oauth" }), (error) => {
      assert.equal(error.code, "GOOGLE_AUTH_FAILED");
      assert.doesNotMatch(error.message, /refresh-token|client-secret/);
      return true;
    });
  });

  await t.test("API payload is not reflected", async () => {
    let count = 0;
    const calendar = connector(async () => {
      count += 1;
      return count === 1
        ? json({ access_token: "access-one", expires_in: 3600 })
        : json({ error: { message: "refresh-token client-secret" } }, 403);
    });
    await assert.rejects(calendar.createEvent({ draft: readyDraft, actionKey: "api" }), (error) => {
      assert.equal(error.code, "GOOGLE_PERMISSION_DENIED");
      assert.equal(error.status, 403);
      assert.doesNotMatch(error.message, /refresh-token|client-secret/);
      return true;
    });
  });

  await t.test("rate limits stay retryable and explicit", async () => {
    let count = 0;
    const calendar = connector(async () => {
      count += 1;
      return count === 1
        ? json({ access_token: "access-one", expires_in: 3600 })
        : json({ error: { message: "provider detail" } }, 429);
    });
    await assert.rejects(
      calendar.createEvent({ draft: readyDraft, actionKey: "rate-limit" }),
      (error) => error.code === "GOOGLE_RATE_LIMITED" && error.status === 429
    );
  });

  await t.test("transport details are not reflected or attached", async () => {
    const calendar = connector(async () => {
      throw new Error("client-secret refresh-token");
    });
    await assert.rejects(calendar.createEvent({ draft: readyDraft, actionKey: "network" }), (error) => {
      assert.equal(error.code, "GOOGLE_UNREACHABLE");
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(error.message, /refresh-token|client-secret/);
      return true;
    });
  });
});

test("refreshes once and retries a 401 without changing the event id", async () => {
  const calls = [];
  let token = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (new URL(url).origin === "https://oauth2.googleapis.com") {
      token += 1;
      return json({ access_token: `access-${token}`, expires_in: 3600 });
    }
    if (options.headers.authorization === "Bearer access-1") return json({}, 401);
    const body = JSON.parse(options.body);
    return json({ id: body.id });
  };

  const result = await connector(fetchImpl).createEvent({ draft: readyDraft, actionKey: "retry-action" });
  assert.equal(result.created, true);
  assert.equal(calls.length, 4);
  assert.equal(JSON.parse(calls[1].options.body).id, JSON.parse(calls[3].options.body).id);
});

test("lists a bounded agenda with only the fields needed to view and manage events", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "access-one", expires_in: 3600 });
    return json({
      items: [
        {
          id: "event-123",
          htmlLink: "https://calendar.google.com/calendar/event?eid=123",
          summary: "Partner meeting",
          description: "not-returned",
          attendees: [{ email: "not-returned@example.com" }],
          status: "confirmed",
          start: { dateTime: "2026-08-25T09:00:00+03:00" },
          end: { dateTime: "2026-08-25T09:45:00+03:00" }
        },
        {
          summary: "Offsite",
          status: "confirmed",
          start: { date: "2026-08-25" },
          end: { date: "2026-08-26" }
        },
        {
          summary: "Deleted",
          status: "cancelled",
          start: { dateTime: "2026-08-25T10:00:00+03:00" },
          end: { dateTime: "2026-08-25T10:30:00+03:00" }
        }
      ]
    });
  };

  const result = await connector(fetchImpl).listEvents({
    timeMin: "2026-08-25T00:00:00+03:00",
    timeMax: "2026-08-26T00:00:00+03:00",
    timeZone: "Europe/Istanbul",
    maxResults: 20
  });

  assert.deepEqual(result, {
    events: [
      {
        id: "event-123",
        title: "Partner meeting",
        start: "2026-08-25T09:00:00+03:00",
        end: "2026-08-25T09:45:00+03:00",
        allDay: false,
        htmlLink: "https://calendar.google.com/calendar/event?eid=123"
      },
      {
        id: null,
        title: "Offsite",
        start: "2026-08-25",
        end: "2026-08-26",
        allDay: true,
        htmlLink: null
      }
    ],
    truncated: false
  });
  assert.equal(calls.length, 2);
  const request = new URL(calls[1].url);
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[1].options.body, undefined);
  assert.equal(calls[1].options.headers.authorization, "Bearer access-one");
  assert.equal(request.searchParams.get("timeMin"), "2026-08-25T00:00:00+03:00");
  assert.equal(request.searchParams.get("timeMax"), "2026-08-26T00:00:00+03:00");
  assert.equal(request.searchParams.get("timeZone"), "Europe/Istanbul");
  assert.equal(request.searchParams.get("singleEvents"), "true");
  assert.equal(request.searchParams.get("orderBy"), "startTime");
  assert.equal(request.searchParams.get("showDeleted"), "false");
  assert.equal(request.searchParams.get("maxResults"), "20");
  assert.match(request.searchParams.get("fields"), /items\(id,htmlLink/);
  assert.doesNotMatch(request.searchParams.get("fields"), /description|attendees/);
  assert.doesNotMatch(JSON.stringify(result), /not-returned@example/);
});

test("moves and cancels only the explicitly selected Google event", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "access-one", expires_in: 3600 });
    if (options.method === "PATCH") return json({ id: "event-123", htmlLink: "https://calendar.google.com/calendar/event?eid=123" });
    return json({}, 204);
  };
  const calendar = connector(fetchImpl);
  const moved = await calendar.updateEvent({ eventId: "event-123", draft: readyDraft });
  const cancelled = await calendar.deleteEvent({ eventId: "event-123" });

  assert.equal(moved.updated, true);
  assert.equal(cancelled.deleted, true);
  assert.match(calls[1].url, /\/events\/event-123$/);
  assert.equal(calls[1].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    summary: "Partner meeting",
    start: { dateTime: readyDraft.start, timeZone: readyDraft.timezone },
    end: { dateTime: readyDraft.end, timeZone: readyDraft.timezone }
  });
  assert.match(calls[2].url, /\/events\/event-123$/);
  assert.equal(calls[2].options.method, "DELETE");
  assert.equal(calls[2].options.body, undefined);
});

test("paginates agenda reads without exceeding the caller's cap", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "access-one", expires_in: 3600 });
    requests.push({ url, options });
    const page = new URL(url).searchParams.get("pageToken");
    if (!page) {
      return json({
        items: [{ summary: "First", start: { dateTime: "2026-08-25T09:00:00+03:00" }, end: { dateTime: "2026-08-25T10:00:00+03:00" } }],
        nextPageToken: "page-two"
      });
    }
    return json({
      items: [{ summary: "Second", start: { dateTime: "2026-08-25T11:00:00+03:00" }, end: { dateTime: "2026-08-25T12:00:00+03:00" } }],
      nextPageToken: "page-three"
    });
  };

  const result = await connector(fetchImpl).listEvents({
    timeMin: "2026-08-25T00:00:00+03:00",
    timeMax: "2026-08-26T00:00:00+03:00",
    timeZone: "Europe/Istanbul",
    maxResults: 2
  });

  assert.deepEqual(result.events.map((event) => event.title), ["First", "Second"]);
  assert.equal(result.truncated, true);
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url).searchParams.get("pageToken"), "page-two");
  assert.equal(new URL(requests[1].url).searchParams.get("maxResults"), "1");
});

test("agenda reads retry one expired access token and preserve the query", async () => {
  let token = 0;
  const requests = [];
  const fetchImpl = async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") {
      token += 1;
      return json({ access_token: `access-${token}`, expires_in: 3600 });
    }
    requests.push({ url, options });
    if (options.headers.authorization === "Bearer access-1") return json({}, 401);
    return json({ items: [] });
  };

  const result = await connector(fetchImpl).listEvents({
    timeMin: "2026-08-25T00:00:00+03:00",
    timeMax: "2026-08-26T00:00:00+03:00",
    timeZone: "Europe/Istanbul"
  });
  assert.deepEqual(result, { events: [], truncated: false });
  assert.equal(token, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, requests[1].url);
});

test("agenda validation and provider failures are sanitized", async (t) => {
  await t.test("invalid range fails before network access", async () => {
    let called = false;
    const calendar = connector(async () => {
      called = true;
      return json({});
    });
    await assert.rejects(calendar.listEvents({
      timeMin: "2026-08-26T00:00:00+03:00",
      timeMax: "2026-08-25T00:00:00+03:00",
      timeZone: "Europe/Istanbul"
    }), /timeMax must be later/);
    assert.equal(called, false);
  });

  await t.test("API payload is not reflected", async () => {
    let count = 0;
    const calendar = connector(async () => {
      count += 1;
      return count === 1
        ? json({ access_token: "access-one", expires_in: 3600 })
        : json({ error: { message: "refresh-token client-secret" } }, 403);
    });
    await assert.rejects(calendar.listEvents({
      timeMin: "2026-08-25T00:00:00+03:00",
      timeMax: "2026-08-26T00:00:00+03:00",
      timeZone: "Europe/Istanbul"
    }), (error) => {
      assert.equal(error.code, "GOOGLE_LIST_FAILED");
      assert.equal(error.status, 403);
      assert.doesNotMatch(error.message, /refresh-token|client-secret/);
      return true;
    });
  });

  await t.test("malformed successful payload is rejected", async () => {
    let count = 0;
    const calendar = connector(async () => {
      count += 1;
      return count === 1
        ? json({ access_token: "access-one", expires_in: 3600 })
        : json({ items: "not-an-array" });
    });
    await assert.rejects(calendar.listEvents({
      timeMin: "2026-08-25T00:00:00+03:00",
      timeMax: "2026-08-26T00:00:00+03:00",
      timeZone: "Europe/Istanbul"
    }), (error) => error.code === "GOOGLE_INVALID_RESPONSE");
  });
});
