import { createHash } from "node:crypto";
import { URL, URLSearchParams } from "node:url";

export const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const MAX_AGENDA_RESULTS = 100;
const MAX_AGENDA_PAGES = 10;

export class GoogleCalendarError extends Error {
  constructor(message, { code = "GOOGLE_CALENDAR_ERROR", status = null, cause } = {}) {
    super(message, { cause });
    this.name = "GoogleCalendarError";
    this.code = code;
    this.status = status;
  }
}

function requireText(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new TypeError(`${name} is required.`);
  return text;
}

function currentMillis(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new TypeError("now must resolve to a valid Date.");
  return date.getTime();
}

function requireRfc3339(value, name) {
  const text = requireText(value, name);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new TypeError(`${name} must be an RFC3339 timestamp with a timezone offset.`);
  }
  return text;
}

function requireTimezone(value) {
  const timezone = requireText(value, "timeZone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new RangeError("timeZone must be a valid IANA timezone.");
  }
  return timezone;
}

function requireEventId(value) {
  const id = requireText(value, "eventId");
  if (id.length > 1024 || /[\u0000-\u001f\u007f]/.test(id)) throw new TypeError("eventId is invalid.");
  return id;
}

function cleanEventTitle(value) {
  const title = String(value || "Busy")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (title || "Busy").slice(0, 160);
}

function agendaEvent(value) {
  if (!value || value.status === "cancelled") return null;
  const start = String(value.start?.dateTime || value.start?.date || "").trim();
  if (!start) return null;
  const end = String(value.end?.dateTime || value.end?.date || "").trim() || null;
  return {
    id: String(value.id || "").trim().slice(0, 1024) || null,
    title: cleanEventTitle(value.summary),
    start,
    end,
    allDay: Boolean(value.start?.date && !value.start?.dateTime),
    htmlLink: /^https:\/\/calendar\.google\.com\//.test(String(value.htmlLink || "")) ? String(value.htmlLink).slice(0, 2048) : null
  };
}

export function googleEventId(actionKey) {
  const key = requireText(actionKey, "actionKey");
  // Google event IDs accept base32hex characters (a-v and 0-9). A lowercase
  // SHA-256 hex digest is a safe subset and hides the original action key.
  return `lp${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
}

function validateDraft(draft) {
  if (!draft || draft.status !== "ready" || !draft.title || !draft.start || !draft.end || !draft.timezone) {
    throw new GoogleCalendarError("The calendar draft is incomplete and was not created.", { code: "DRAFT_NOT_READY" });
  }
}

function createFailureCode(status) {
  if (status === 401) return "GOOGLE_AUTH_FAILED";
  if (status === 403) return "GOOGLE_PERMISSION_DENIED";
  if (status === 404) return "GOOGLE_CALENDAR_NOT_FOUND";
  if (status === 429) return "GOOGLE_RATE_LIMITED";
  if (status >= 500) return "GOOGLE_UNAVAILABLE";
  return "GOOGLE_CREATE_FAILED";
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class GoogleCalendarConnector {
  constructor({
    clientId,
    clientSecret,
    refreshToken,
    calendarId = "primary",
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    timeoutMs = 10_000
  } = {}) {
    this.clientId = requireText(clientId, "clientId");
    this.clientSecret = requireText(clientSecret, "clientSecret");
    this.refreshToken = requireText(refreshToken, "refreshToken");
    this.calendarId = requireText(calendarId, "calendarId");
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function.");
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new RangeError("timeoutMs must be between 100 and 60000.");
    this.fetch = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  async request(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        throw new GoogleCalendarError("Google Calendar did not respond in time.", { code: "GOOGLE_TIMEOUT" });
      }
      throw new GoogleCalendarError("Google Calendar is currently unreachable.", { code: "GOOGLE_UNREACHABLE" });
    } finally {
      clearTimeout(timer);
    }
  }

  async getAccessToken({ force = false } = {}) {
    const nowMs = currentMillis(this.now);
    if (!force && this.accessToken && nowMs < this.accessTokenExpiresAt - 60_000) return this.accessToken;

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: "refresh_token"
    });
    const response = await this.request(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.access_token) {
      throw new GoogleCalendarError("Google Calendar authorization failed. Reconnect the calendar and try again.", {
        code: "GOOGLE_AUTH_FAILED",
        status: response.status
      });
    }

    this.accessToken = String(payload.access_token);
    const expiresIn = Number(payload.expires_in);
    this.accessTokenExpiresAt = nowMs + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000;
    return this.accessToken;
  }

  eventUrl(eventId = null) {
    const base = `${CALENDAR_API}/calendars/${encodeURIComponent(this.calendarId)}/events`;
    return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
  }

  eventBody(draft, id) {
    return {
      id,
      summary: draft.title,
      start: { dateTime: draft.start, timeZone: draft.timezone },
      end: { dateTime: draft.end, timeZone: draft.timezone },
      reminders: { useDefault: true },
      extendedProperties: { private: { agent4EventId: id } }
    };
  }

  eventPatch(draft) {
    const allDay = Boolean(draft.allDay || (/^\d{4}-\d{2}-\d{2}$/.test(String(draft.start || "")) && /^\d{4}-\d{2}-\d{2}$/.test(String(draft.end || ""))));
    return {
      summary: draft.title,
      start: allDay
        ? { date: draft.start }
        : { dateTime: draft.start, timeZone: draft.timezone },
      end: allDay
        ? { date: draft.end }
        : { dateTime: draft.end, timeZone: draft.timezone }
    };
  }

  async authorizedRequest(url, options, { retryAuth = true } = {}) {
    const accessToken = await this.getAccessToken();
    const response = await this.request(url, {
      ...options,
      headers: {
        ...options.headers,
        authorization: `Bearer ${accessToken}`
      }
    });
    if (response.status === 401 && retryAuth) {
      await this.getAccessToken({ force: true });
      return this.authorizedRequest(url, options, { retryAuth: false });
    }
    return response;
  }

  async getEvent(id) {
    const response = await this.authorizedRequest(this.eventUrl(id), { method: "GET" });
    if (!response.ok) {
      throw new GoogleCalendarError("Google Calendar could not verify the existing event.", {
        code: "GOOGLE_IDEMPOTENCY_CHECK_FAILED",
        status: response.status
      });
    }
    const event = await safeJson(response);
    if (!event?.id) {
      throw new GoogleCalendarError("Google Calendar returned an invalid event response.", { code: "GOOGLE_INVALID_RESPONSE" });
    }
    return event;
  }

  /** Read only the minimal fields needed for a private owner agenda. */
  async listEvents({
    timeMin,
    timeMax,
    timeZone,
    maxResults = MAX_AGENDA_RESULTS
  } = {}) {
    const lowerBound = requireRfc3339(timeMin, "timeMin");
    const upperBound = requireRfc3339(timeMax, "timeMax");
    if (Date.parse(upperBound) <= Date.parse(lowerBound)) throw new RangeError("timeMax must be later than timeMin.");
    const timezone = requireTimezone(timeZone);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_AGENDA_RESULTS) {
      throw new RangeError(`maxResults must be between 1 and ${MAX_AGENDA_RESULTS}.`);
    }

    const events = [];
    let nextPageToken = null;
    let pages = 0;
    do {
      const url = new URL(this.eventUrl());
      url.searchParams.set("timeMin", lowerBound);
      url.searchParams.set("timeMax", upperBound);
      url.searchParams.set("timeZone", timezone);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("showDeleted", "false");
      url.searchParams.set("maxResults", String(maxResults - events.length));
      url.searchParams.set("fields", "nextPageToken,items(id,htmlLink,summary,status,start(date,dateTime),end(date,dateTime))");
      if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);

      const response = await this.authorizedRequest(url.toString(), { method: "GET" });
      if (!response.ok) {
        throw new GoogleCalendarError("Google Calendar could not read the agenda.", {
          code: "GOOGLE_LIST_FAILED",
          status: response.status
        });
      }
      const payload = await safeJson(response);
      if (!payload || (payload.items != null && !Array.isArray(payload.items))) {
        throw new GoogleCalendarError("Google Calendar returned an invalid agenda response.", {
          code: "GOOGLE_INVALID_RESPONSE"
        });
      }
      for (const item of payload.items || []) {
        const event = agendaEvent(item);
        if (event) events.push(event);
        if (events.length >= maxResults) break;
      }
      nextPageToken = String(payload.nextPageToken || "").trim() || null;
      pages += 1;
    } while (nextPageToken && events.length < maxResults && pages < MAX_AGENDA_PAGES);

    return { events, truncated: Boolean(nextPageToken) };
  }

  /** Create only when the caller has already obtained explicit user confirmation. */
  async createEvent({ draft, actionKey } = {}) {
    validateDraft(draft);
    const id = googleEventId(actionKey);
    const response = await this.authorizedRequest(this.eventUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.eventBody(draft, id))
    });

    if (response.status === 409) {
      const event = await this.getEvent(id);
      return { created: false, idempotent: true, event };
    }
    if (!response.ok) {
      throw new GoogleCalendarError("Google Calendar could not create the event. Nothing was added.", {
        code: createFailureCode(response.status),
        status: response.status
      });
    }

    const event = await safeJson(response);
    if (!event?.id) {
      throw new GoogleCalendarError("Google Calendar returned an invalid event response.", { code: "GOOGLE_INVALID_RESPONSE" });
    }
    return { created: true, idempotent: false, event };
  }

  /** Update only after the caller has shown and confirmed the exact move. */
  async updateEvent({ eventId, draft } = {}) {
    const id = requireEventId(eventId);
    validateDraft(draft);
    const response = await this.authorizedRequest(this.eventUrl(id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.eventPatch(draft))
    });
    if (!response.ok) {
      throw new GoogleCalendarError("Google Calendar could not move the event. Nothing was changed.", {
        code: "GOOGLE_UPDATE_FAILED",
        status: response.status
      });
    }
    const event = await safeJson(response);
    if (!event?.id) {
      throw new GoogleCalendarError("Google Calendar returned an invalid event response.", { code: "GOOGLE_INVALID_RESPONSE" });
    }
    return { updated: true, event };
  }

  /** Delete only after the caller has shown and confirmed the exact event. */
  async deleteEvent({ eventId } = {}) {
    const id = requireEventId(eventId);
    const response = await this.authorizedRequest(this.eventUrl(id), { method: "DELETE" });
    if (response.status === 404 || response.status === 410) return { deleted: false, idempotent: true, event: { id } };
    if (!response.ok) {
      throw new GoogleCalendarError("Google Calendar could not cancel the event. Nothing was changed.", {
        code: "GOOGLE_DELETE_FAILED",
        status: response.status
      });
    }
    return { deleted: true, idempotent: false, event: { id } };
  }
}

export function createGoogleCalendarConnector(options) {
  return new GoogleCalendarConnector(options);
}
