import { stripHiddenCharacters } from "./hidden-text.js";
import { localIsoDate } from "./local-date.js";

/*
 * The one door in HQ that opens without a sign-in: the website's project
 * inquiry. Everything here is written for a caller who may be a stranger, a
 * bot, or a first-time client whose first impression of us is whether this
 * worked, so the rules are:
 *
 *   - Be strict about what we need to answer (a name, a way to reach them, the
 *     problem) and lenient about everything else. A mistyped link must never
 *     cost us a lead.
 *   - Never trust the caller's text. It is cleaned, length-capped, and only
 *     ever stored or shown as plain text.
 *   - Never tell the caller anything about what is already on file.
 *   - Saving the inquiry is the job. Telling the owner is best effort, and a
 *     failed Telegram message must not fail the request.
 */

export const INQUIRY_LIMITS = Object.freeze({
  bodyBytes: 16 * 1024,
  name: 120,
  company: 160,
  contact: 160,
  link: 300,
  choice: 80,
  problem: 1500,
  source: 80
});

const ACTOR_ID = "website";
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const NOTIFY_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

/* Control characters, and the bidirectional overrides that can make plain text
   read differently from how it is stored. Persian text legitimately uses the
   zero-width non-joiner and the left/right marks, so those stay. */
const UNSAFE_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

function clip(value, max) {
  let result = value.slice(0, max);
  const last = result.charCodeAt(result.length - 1);
  // Never leave half of an emoji behind: a lone surrogate is rejected by some
  // of the places this text is sent to.
  if (last >= 0xd800 && last <= 0xdbff) result = result.slice(0, -1);
  return result;
}

function singleLine(value, max) {
  if (typeof value !== "string") return "";
  return clip(stripHiddenCharacters(value.normalize("NFC").replace(UNSAFE_CHARACTERS, " ")).replace(/\s+/g, " ").trim(), max);
}

function multiLine(value, max) {
  if (typeof value !== "string") return "";
  const cleaned = stripHiddenCharacters(value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(UNSAFE_CHARACTERS, " "))
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clip(cleaned, max);
}

/* A person typing a Persian number should not be told it is invalid. */
function asciiDigits(value) {
  return value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

const EMAIL = /^[^\s@<>(),;:\\"[\]]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
/* The @ is required: without it, any word typed into the box ("tomorrow")
   would be saved as somebody's Telegram handle. */
const TELEGRAM_HANDLE = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** An email address, a phone number (WhatsApp), or a Telegram handle: whatever lets us write back. */
export function parseContact(raw) {
  const value = singleLine(asciiDigits(typeof raw === "string" ? raw : ""), INQUIRY_LIMITS.contact);
  if (!value) return null;
  if (EMAIL.test(value)) return { kind: "email", value: value.toLowerCase() };

  const digits = value.replace(/[\s\-().]/g, "");
  const international = digits.startsWith("00") ? `+${digits.slice(2)}` : digits;
  if (/^\+?[0-9]{7,15}$/.test(international)) return { kind: "phone", value: international };

  if (TELEGRAM_HANDLE.test(value)) return { kind: "telegram", value };
  return null;
}

function parseLink(raw) {
  const value = singleLine(typeof raw === "string" ? raw : "", INQUIRY_LIMITS.link);
  if (!value) return "";
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return "";
    url.hash = "";
    return url.toString();
  } catch {
    // An unreadable link is dropped, not an error: the visitor is here to talk
    // to us, not to pass validation.
    return "";
  }
}

/**
 * Turns whatever arrived into either a clean inquiry or a list of the fields
 * that need fixing. Field problems are codes, not sentences, so the page can
 * answer in the visitor's own language.
 */
export function parseInquiry(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, fields: { form: "invalid" } };

  // A field a person never sees. Anything typed into it was typed by a script,
  // which is told it worked so that it has nothing to adapt to. Its name is
  // deliberately plain: a browser's autofill fills fields called "website" or
  // "url", and a real visitor's inquiry must never be thrown away because their
  // password manager helped.
  if (singleLine(body.extra_note, 50)) return { ok: true, spam: true };

  const fields = {};
  const name = singleLine(body.name, INQUIRY_LIMITS.name);
  const company = singleLine(body.company, INQUIRY_LIMITS.company);
  const problem = multiLine(body.problem, INQUIRY_LIMITS.problem);
  const contact = parseContact(body.contact);
  if (!name) fields.name = "required";
  if (!company) fields.company = "required";
  if (!problem) fields.problem = "required";
  if (!contact) fields.contact = singleLine(body.contact, 10) ? "invalid" : "required";
  if (Object.keys(fields).length) return { ok: false, fields };

  const source = singleLine(body.source, INQUIRY_LIMITS.source);
  return {
    ok: true,
    value: {
      name,
      company,
      contact,
      link: parseLink(body.link),
      type: singleLine(body.type, INQUIRY_LIMITS.choice),
      timing: singleLine(body.timing, INQUIRY_LIMITS.choice),
      problem,
      source: /^[a-z0-9-]{1,80}$/i.test(source) ? source : "direct",
      lang: body.lang === "fa" ? "fa" : "en"
    }
  };
}

/**
 * A sliding window per address and one for the whole site. A visitor correcting
 * a typo needs a few tries; a script needs thousands. The window only grows by
 * requests that were let through, so it cannot be used to fill memory.
 */
export function createInquiryLimiter({ perAddress = 8, perHour = 60, windowMs = HOUR_MS, now = () => Date.now() } = {}) {
  const byAddress = new Map();
  let everyone = [];

  /* An address that never comes back would otherwise stay in the map for good,
     and a script rotating addresses could grow it without bound. */
  function sweep(cutoff) {
    for (const [address, list] of byAddress) {
      if (!list.length || list[list.length - 1] <= cutoff) byAddress.delete(address);
    }
  }

  function recent(list, cutoff) {
    let start = 0;
    while (start < list.length && list[start] <= cutoff) start += 1;
    return start ? list.slice(start) : list;
  }

  return {
    /** How many addresses are being remembered right now. */
    size() { return byAddress.size; },
    take(address) {
      const moment = now();
      const cutoff = moment - windowMs;
      everyone = recent(everyone, cutoff);
      if (byAddress.size > 500) sweep(cutoff);
      const own = recent(byAddress.get(address) || [], cutoff);
      if (own.length) byAddress.set(address, own);
      else byAddress.delete(address);

      if (own.length >= perAddress || everyone.length >= perHour) {
        const oldest = own.length >= perAddress ? own[0] : everyone[0];
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - moment) / 1000)) };
      }
      byAddress.set(address, [...own, moment]);
      everyone = [...everyone, moment];
      return { allowed: true };
    }
  };
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function sameContact(company, contact) {
  if (contact.kind === "email") return String(company.contactEmail || "").toLowerCase() === contact.value;
  if (contact.kind === "telegram") return String(company.contactTelegram || "").toLowerCase() === contact.value.toLowerCase();
  const wanted = digitsOnly(contact.value);
  return wanted.length >= 7 && digitsOnly(company.contactPhone) === wanted;
}

function contactFields(contact) {
  if (contact.kind === "email") return { contactEmail: contact.value };
  if (contact.kind === "telegram") return { contactTelegram: contact.value };
  return { contactPhone: contact.value };
}

function eventDetail(inquiry) {
  const choices = [inquiry.type || "no project type chosen", inquiry.timing || "no timing chosen"].join(" · ");
  return `Website inquiry (${inquiry.lang}) · ${choices} · from ${inquiry.source}\n${inquiry.problem}`;
}

/**
 * Puts the inquiry where the owner will see it: a prospect at stage "lead" with
 * a reply due today (every relationship here has a next step with a date), and
 * a dated line in its history.
 *
 * Someone already on file with the same contact details is the same person
 * writing again, so they get a new line in their history, not a second company.
 * Someone who merely typed a name that is already taken gets a company of their
 * own, so a stranger can never write into a client's record by typing its name.
 */
export function recordInquiry({ workspaceStore, inquiry, now = new Date() }) {
  const today = localIsoDate(now);
  const nextAction = `Reply to ${inquiry.name} — website inquiry`;
  const lower = (value) => String(value).toLocaleLowerCase();
  const { companies } = workspaceStore.list();
  const sameName = companies.find((company) => lower(company.name) === lower(inquiry.company));

  if (sameName && sameContact(sameName, inquiry.contact)) {
    const detail = eventDetail(inquiry);
    const latest = (sameName.timeline || []).find((event) => event.type === "inquiry");
    const repeated = latest
      && String(latest.detail).startsWith(detail.slice(0, 120))
      && now.getTime() - new Date(latest.at || latest.createdAt || 0).getTime() < DUPLICATE_WINDOW_MS;
    // The same request sent twice (a retry after a slow connection) is one inquiry.
    if (!repeated) workspaceStore.addCompanyEvent({ companyId: sameName.id, type: "inquiry", detail, actorId: ACTOR_ID });
    if (!sameName.nextAction) {
      workspaceStore.updateCompany(sameName.id, { nextAction, nextActionOn: today, actorId: ACTOR_ID });
    }
    return { company: workspaceStore.getCompany(sameName.id), created: false, repeated: Boolean(repeated) };
  }

  const names = [inquiry.company, `${inquiry.company} (${inquiry.name})`];
  for (let attempt = 2; attempt <= 6; attempt += 1) names.push(`${inquiry.company} (${inquiry.name}) ${attempt}`);
  let company = null;
  for (const name of names) {
    if (companies.some((existing) => lower(existing.name) === lower(name))) continue;
    try {
      company = workspaceStore.createCompany({
        name,
        website: inquiry.link,
        summary: inquiry.problem,
        kind: "prospect",
        stage: "lead",
        contactName: inquiry.name,
        howMet: `Website inquiry · ${inquiry.source}`,
        nextAction,
        nextActionOn: today,
        ...contactFields(inquiry.contact),
        actorId: ACTOR_ID
      });
      break;
    } catch (error) {
      // Two inquiries naming the same company at the same moment: try the next name.
      if (error?.code !== "company_name_taken") throw error;
    }
  }
  if (!company) throw new Error("No free company name was found for this inquiry.");
  workspaceStore.addCompanyEvent({ companyId: company.id, type: "inquiry", detail: eventDetail(inquiry), actorId: ACTOR_ID });
  return { company: workspaceStore.getCompany(company.id), created: true, repeated: false };
}

function excerpt(value, max) {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${clip(flat, max - 1)}…` : flat;
}

/** Plain text on purpose: nothing a stranger typed is ever parsed as formatting. */
export function inquiryMessage({ inquiry, company, created }) {
  const lines = [
    `New website inquiry — ${company.name}`,
    `${inquiry.name} · ${inquiry.contact.value}`,
    [inquiry.type, inquiry.timing].filter(Boolean).join(" · "),
    `"${excerpt(inquiry.problem, 400)}"`,
    inquiry.link ? `Their link: ${inquiry.link}` : "",
    `From: ${inquiry.source} · ${inquiry.lang.toUpperCase()}`,
    created
      ? "Saved as a new lead in HQ → Companies. Reply is due today."
      : `They are already on file (stage: ${company.stage}). Added to their history.`
  ];
  return lines.filter(Boolean).join("\n");
}

export function clientAddress(request) {
  const socketAddress = request.socket?.remoteAddress || "unknown";
  // Trust is an explicit deployment choice. The configured reverse proxy must
  // overwrite this header and the app port must remain on a protected network.
  const forwarded = request.agent4TrustProxy ? String(request.headers["x-real-ip"] || "").trim() : "";
  return /^[0-9a-fA-F:.]{3,45}$/.test(forwarded) ? forwarded : socketAddress;
}

export async function readBody(request, maxBytes) {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) return { tooLarge: true };
    chunks.push(chunk);
  }
  return { text: Buffer.concat(chunks).toString("utf8") };
}

/**
 * Builds the handler for everything under /public. It answers true when it has
 * dealt with the request. It is deliberately a separate door: it shares no
 * session, cookie, or permission with the signed-in part of HQ.
 */
export function createPublicInquiryHandler({ config, workspaceStore, notify = null, limiter = createInquiryLimiter(), now = () => new Date(), log = console }) {
  const origins = new Set((config.runtime.publicInquiryOrigins || []).map((origin) => String(origin).replace(/\/$/, "")));
  const notified = [];
  let lastBurstNoticeAt = 0;

  function respond(response, status, body, extra = {}) {
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      ...extra
    });
    response.end(JSON.stringify(body));
  }

  function fail(response, status, code, extra = {}, more = {}) {
    respond(response, status, { error: { code, ...more } }, extra);
  }

  /* One message per inquiry, but never a flood: after a burst, one notice per
     hour tells the owner to look in HQ, where every inquiry is saved anyway. */
  async function tellOwner(message) {
    if (!notify) return;
    const moment = now().getTime();
    while (notified.length && notified[0] <= moment - HOUR_MS) notified.shift();
    if (notified.length >= NOTIFY_PER_HOUR) {
      if (moment - lastBurstNoticeAt < HOUR_MS) return;
      lastBurstNoticeAt = moment;
      await notify("Website inquiries are arriving faster than usual. Every one is saved in HQ → Companies.");
      return;
    }
    notified.push(moment);
    await notify(message);
  }

  return async function handlePublicRequest(request, response, pathname) {
    if (!config.runtime.publicInquiryEnabled || pathname !== "/public/inquiry") {
      fail(response, 404, "not_found");
      return true;
    }

    const origin = String(request.headers.origin || "").replace(/\/$/, "");
    if (!origins.has(origin)) {
      fail(response, 403, "forbidden_origin");
      return true;
    }
    const allowOrigin = { "access-control-allow-origin": origin, vary: "Origin" };

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...allowOrigin,
        "access-control-allow-methods": "POST",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        "cache-control": "no-store"
      });
      response.end();
      return true;
    }
    if (request.method !== "POST") {
      fail(response, 405, "method_not_allowed", { ...allowOrigin, allow: "POST, OPTIONS" });
      return true;
    }
    if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      fail(response, 415, "json_required", allowOrigin);
      return true;
    }

    const turn = limiter.take(clientAddress(request));
    if (!turn.allowed) {
      fail(response, 429, "rate_limited", { ...allowOrigin, "retry-after": String(turn.retryAfterSeconds) }, { retryAfterSeconds: turn.retryAfterSeconds });
      return true;
    }

    const body = await readBody(request, INQUIRY_LIMITS.bodyBytes);
    if (body.tooLarge) {
      fail(response, 413, "payload_too_large", { ...allowOrigin, connection: "close" });
      return true;
    }
    let parsedBody;
    try {
      parsedBody = JSON.parse(body.text || "null");
    } catch {
      fail(response, 400, "invalid_json", allowOrigin);
      return true;
    }

    const parsed = parseInquiry(parsedBody);
    if (!parsed.ok) {
      fail(response, 400, "invalid_inquiry", allowOrigin, { fields: parsed.fields });
      return true;
    }
    if (parsed.spam) {
      respond(response, 201, { ok: true }, allowOrigin);
      return true;
    }

    let saved;
    try {
      saved = recordInquiry({ workspaceStore, inquiry: parsed.value, now: now() });
    } catch (error) {
      // The visitor sees a plain failure and the page falls back to WhatsApp.
      // The log says what happened, without what the visitor wrote.
      log.error?.(`Public inquiry could not be saved (${error?.message || error}).`);
      fail(response, 500, "could_not_save", allowOrigin);
      return true;
    }

    respond(response, 201, { ok: true }, allowOrigin);
    log.info?.(`Public inquiry saved (${saved.created ? "new lead" : saved.repeated ? "repeat" : "known contact"}).`);

    if (!saved.repeated) {
      // After the answer, and never allowed to throw: the lead is already safe.
      tellOwner(inquiryMessage({ inquiry: parsed.value, company: saved.company, created: saved.created })).catch((error) => {
        log.warn?.(`Public inquiry saved, but the owner could not be told (${error?.message || error}).`);
      });
    }
    return true;
  };
}
