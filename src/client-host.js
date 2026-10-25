import { readFile } from "node:fs/promises";
import { fileURLToPath, URLSearchParams } from "node:url";
import { isClientToken, isLinkPreviewBot } from "./client-link-store.js";
import { cleanAnswer } from "./client-questionnaire-store.js";
import { renderClientCalendar, renderClientPage, renderQuestionnairePage, renderUnavailablePage } from "./client-page.js";
import { clientAddress, createInquiryLimiter, readBody } from "./public-inquiry.js";

/*
 * The client hostname (clients.example.com) is a different site from HQ
 * that happens to be run by the same program. Everything that arrives for that
 * hostname is answered here and nowhere else, so even if the web server in
 * front of it were set up carelessly and forwarded every path, the hostname
 * could still only ever reach a client's own page: no sign-in, no API, no HQ.
 *
 * It sets no cookie, runs no script, and makes the visitor's browser fetch
 * nothing from anywhere but itself.
 */

const ASSETS = new Map([
  ["falcon.svg", { file: "falcon.svg", type: "image/svg+xml" }],
  ["company-wordmark.svg", { file: "company-wordmark.svg", type: "image/svg+xml" }],
  ["company-wordmark-light.svg", { file: "company-wordmark-light.svg", type: "image/svg+xml" }]
]);

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  // No script anywhere, styles are inline, and the only things it loads are its own font and mark.
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

/* The one page that has a form may send it to itself, and nowhere else. */
const FORM_HEADERS = { ...PAGE_HEADERS, "content-security-policy": PAGE_HEADERS["content-security-policy"].replace("form-action 'none'", "form-action 'self'") };
/* Twelve answers of 4,000 characters is 288 KB when every letter is Persian (six
   bytes each once a form encodes it) and up to 432 KB for scripts that take nine,
   so the limit has to sit above that. Anything bigger is not a person typing. */
const FORM_BODY_LIMIT = 512 * 1024;
const BANNER_SECONDS = 120;
const NOTIFY_EVERY_MS = 10 * 60 * 1000;
const NOTIFY_PER_DAY = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const FORM_BODY_TIMEOUT_MS = 20_000;

/** Which hostnames are the client site. A Host header may carry a port; the list may or may not. */
export function isClientHost(request, hosts = []) {
  // "clients.example.com." with the trailing dot is the same hostname.
  const header = String(request.headers.host || "").toLowerCase().replace(/\.(?=:\d+$|$)/, "");
  if (!header || !hosts.length) return false;
  return hosts.includes(header) || hosts.includes(header.replace(/:\d+$/, ""));
}

/** Anything in a log line that looks like a client link (or is shaped like its secret) is hidden. */
function scrub(value) {
  return String(value).replace(/\/c\/[^\s/?#]+/g, "/c/[link]").replace(/[A-Za-z0-9_-]{40,}/g, "[link]");
}

export function createClientHostHandler({
  config,
  linkStore,
  workspaceStore,
  questionnaireStore = null,
  onQuestionnaireSubmitted = null,
  onCallRequested = null,
  now = () => new Date(),
  limiter = createInquiryLimiter({ perAddress: 40, perHour: 2000, windowMs: 10 * 60 * 1000 }),
  saveLimiter = createInquiryLimiter({ perAddress: 60, perHour: 100000, windowMs: 10 * 60 * 1000 }),
  formBodyTimeoutMs = FORM_BODY_TIMEOUT_MS,
  log = console
}) {
  const assetRoot = new URL("./public-assets/", import.meta.url);
  const assetCache = new Map();
  const notified = new Map();
  const notifiedToday = new Map();
  const enabled = Boolean(config.runtime.clientPagesEnabled);
  const contact = { whatsapp: config.runtime.clientWhatsapp || "", email: config.runtime.clientEmail || "" };
  const baseUrl = String(config.runtime.clientPagesUrl || "").replace(/\/$/, "");
  const timeZone = config.runtime.ownerTimeZone || "UTC";

  async function readAsset(name) {
    if (!assetCache.has(name)) assetCache.set(name, await readFile(fileURLToPath(new URL(name, assetRoot))));
    return assetCache.get(name);
  }

  /** Asks browsers to stay on https once they have been here over it. */
  function secured(headers, request) {
    return request.headers["x-forwarded-proto"] === "https" ? { ...headers, "strict-transport-security": "max-age=31536000" } : headers;
  }

  function send(response, request, status, headers, body) {
    response.writeHead(status, secured(headers, request));
    response.end(request.method === "HEAD" ? undefined : body);
  }

  function unavailable(response, request, lang, status = 404, extra = {}) {
    send(response, request, status, { ...PAGE_HEADERS, ...extra }, renderUnavailablePage({ lang, contact, baseUrl }));
  }

  /** Only what the owner chose to show, and only the fields meant for a client. */
  function visibleProjects(link) {
    if (!link.projectIds.length) return [];
    const chosen = new Set(link.projectIds);
    return workspaceStore.projectsFor(link.companyId)
      .filter((project) => chosen.has(project.id))
      .map((project) => ({
        name: project.name,
        status: project.status,
        health: project.health,
        milestone: project.milestone,
        milestoneDueOn: project.milestoneDueOn,
        // The deadline and the day the project was opened draw the row of weeks.
        dueOn: project.dueOn,
        createdAt: project.createdAt
      }));
  }

  /**
   * A form posted from somebody else's page. Browsers say so in Sec-Fetch-Site.
   * Origin is looked at too, but "null" is let through: these pages send no
   * referrer, and a browser then reports even a same-site post as "null". The
   * secret in the address is the real protection, since a stranger's page does
   * not know it.
   */
  function fromAnotherSite(request) {
    if (String(request.headers["sec-fetch-site"] || "") === "cross-site") return true;
    const origin = request.headers.origin;
    if (!origin || origin === "null") return false;
    const normal = (value) => String(value || "").toLowerCase().replace(/\.(?=:\d+$|$)/, "");
    try {
      return normal(new URL(origin).host) !== normal(request.headers.host);
    } catch {
      return true;
    }
  }

  /** "sent" when they press Send; "call" when they ask to answer on a call instead. */
  function tellOwner(link, company, questionnaire, kind = "sent") {
    const tell = kind === "call" ? onCallRequested : onQuestionnaireSubmitted;
    if (!tell) return;
    const key = `${questionnaire.id}:${kind}`;
    const moment = now().getTime();
    // Sending the same form three times in a minute is one thing to tell the owner, not three.
    if (moment - (notified.get(key) || 0) < NOTIFY_EVERY_MS) return;
    // And nobody can keep the owner's phone buzzing: a few messages a day for any one form.
    const today = (notifiedToday.get(key) || []).filter((at) => moment - at < DAY_MS);
    if (today.length >= NOTIFY_PER_DAY) {
      notifiedToday.set(key, today);
      return;
    }
    notifiedToday.set(key, [...today, moment]);
    notified.set(key, moment);
    Promise.resolve()
      .then(() => tell({ link, company, questionnaire }))
      .catch((error) => log.warn?.(`A questionnaire changed but the owner could not be told (${scrub(error?.message || error)}).`));
  }

  /** Which screen of a questionnaire: 0 is the start, 1..n a part, "check" the last look before sending. */
  function stepOf(value, questionnaire) {
    const raw = String(value || "");
    if (raw === "check") return "check";
    const parts = (questionnaire.content.sections || []).length;
    const number = /^\d{1,2}$/.test(raw) ? Number(raw) : 0;
    return number >= 1 && number <= parts ? number : 0;
  }

  async function questionnaireRoute({ request, response, url, token, link, company, id, lang }) {
    const questionnaire = questionnaireStore ? questionnaireStore.getForLink(link.id, id) : null;
    if (!questionnaire) {
      // Another person's questionnaire, or one that never existed: the same answer.
      const turn = limiter.take(clientAddress(request));
      unavailable(response, request, lang || link.language, turn.allowed ? 404 : 429, turn.allowed ? {} : { "retry-after": String(turn.retryAfterSeconds) });
      return;
    }
    const base = `/c/${token}`;
    const draw = (current, status, notice = "", extra = {}, view = {}) => send(response, request, status, { ...FORM_HEADERS, ...extra }, renderQuestionnairePage({ questionnaire: current, company: { name: company.name }, base, notice, contact, baseUrl, step: view.step || 0, savedPart: view.savedPart || 0 }));

    if (request.method !== "POST") {
      // "Saved just now" is only said just after saving. The address carries the
      // moment, so a bookmark or a reload an hour later does not claim it.
      const done = url.searchParams.get("done");
      const at = Number(url.searchParams.get("t"));
      const recent = Number.isFinite(at) && Math.abs(now().getTime() / 1000 - at) < BANNER_SECONDS;
      const step = stepOf(url.searchParams.get("step"), questionnaire);
      const savedPart = stepOf(url.searchParams.get("part"), questionnaire);
      const notice = !recent ? ""
        : done === "saved" ? "saved"
          : done === "sent" && questionnaire.status === "submitted" ? "sent"
            : done === "call" && questionnaire.callRequestedAt ? "call"
              : done === "part" && typeof savedPart === "number" && savedPart > 0 ? "part"
                : "";
      draw(questionnaire, 200, notice, {}, { step, savedPart: notice === "part" ? savedPart : 0 });
      return;
    }

    if (fromAnotherSite(request)) return unavailable(response, request, lang || link.language, 403);
    if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      return unavailable(response, request, lang || link.language, 415);
    }
    const turn = saveLimiter.take(`link:${link.id}`);
    if (!turn.allowed) return draw(questionnaire, 429, "slow", { "retry-after": String(turn.retryAfterSeconds) });
    if (questionnaire.status === "closed") return draw(questionnaire, 409);

    // A body that never finishes does not get to hold the connection open.
    let timer;
    const body = await Promise.race([
      readBody(request, FORM_BODY_LIMIT),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), formBodyTimeoutMs); })
    ]);
    clearTimeout(timer);
    if (body.timedOut) {
      // Say so first, then drop the connection once the answer has gone out.
      response.once("finish", () => request.destroy());
      unavailable(response, request, lang || link.language, 408, { connection: "close" });
      return;
    }
    if (body.tooLarge) return unavailable(response, request, lang || link.language, 413, { connection: "close" });

    // The link may have been ended while the answers were still arriving.
    const stillActive = linkStore.resolve(token);
    if (!stillActive || stillActive.id !== link.id) return unavailable(response, request, lang || link.language);

    // Only fields named a_<question> for a question that exists are read, so junk
    // fields cannot crowd real answers out.
    const known = new Set((questionnaire.content.sections || []).flatMap((section) => (section.questions || []).map((question) => question.id)));
    const form = new URLSearchParams(body.text);
    const action = String(form.get("action") || "save");
    const step = stepOf(form.get("step"), questionnaire);
    const moment = Math.floor(now().getTime() / 1000);
    const go = (query) => {
      // Post, then redirect: reloading the page never sends anything a second time.
      response.writeHead(303, secured({ ...FORM_HEADERS, location: `${base}/q/${questionnaire.id}${query ? `?${query}` : ""}` }, request));
      response.end();
    };

    if (action === "call") {
      let asked;
      try {
        asked = questionnaireStore.requestCall(questionnaire.id, { times: form.get("times") || "" });
      } catch (error) {
        log.warn?.(`A call request could not be saved (${scrub(error?.message || error)}).`);
        const current = questionnaireStore.get(questionnaire.id) || questionnaire;
        return draw(current, current.status === "closed" ? 409 : 500, current.status === "closed" ? "" : "failed");
      }
      if (asked.first) tellOwner(link, company, asked.questionnaire, "call");
      return go(`done=call&t=${moment}`);
    }

    const answers = {};
    for (const [key, value] of form) {
      if (key.startsWith("a_") && known.has(key.slice(2))) answers[key.slice(2)] = value;
    }
    const submit = action === "submit";

    let saved;
    try {
      saved = questionnaireStore.saveAnswers(questionnaire.id, { answers, submit });
    } catch (error) {
      log.warn?.(`A questionnaire could not be saved (${scrub(error?.message || error)}).`);
      const current = questionnaireStore.get(questionnaire.id) || questionnaire;
      if (current.status === "closed") return draw(current, 409);
      // Anything else: show the form again with what they typed still in it.
      const typed = Object.fromEntries(Object.entries(answers).map(([id, value]) => [id, cleanAnswer(value)]).filter(([, value]) => value));
      // Back on the part they were typing in; a post from an older page names no part, so find it.
      const sections = current.content.sections || [];
      const firstTyped = Object.keys(typed)[0];
      const typedIn = sections.findIndex((section) => (section.questions || []).some((question) => question.id === firstTyped)) + 1;
      return draw({ ...current, answers: { ...current.answers, ...typed } }, 500, "failed", {}, { step: typeof step === "number" && step > 0 ? step : typedIn || 1 });
    }
    // Sending the same answers again is not news; the first send, or a send with something changed, is.
    if (submit && (questionnaire.status !== "submitted" || saved.changed)) tellOwner(link, company, saved.questionnaire);
    if (submit) return go(`done=sent&t=${moment}`);

    // Moving between parts saves the part they were on, then shows the next one.
    const parts = (questionnaire.content.sections || []).length;
    if (action === "next" && typeof step === "number" && step > 0) {
      return go(step < parts ? `step=${step + 1}&done=part&part=${step}&t=${moment}` : `step=check&done=part&part=${step}&t=${moment}`);
    }
    if (action === "back" && typeof step === "number" && step > 1) return go(`step=${step - 1}`);
    if (action === "back" && step === "check") return go(`step=${parts}`);
    if (action === "check") return go("step=check");
    return go(`done=saved&t=${moment}`);
  }

  return async function handleClientHost(request, response, url) {
    const lang = url.searchParams.get("lang") === "fa" ? "fa" : url.searchParams.get("lang") === "en" ? "en" : "";
    const formMatch = /^\/c\/([^/]+)\/q\/([A-Za-z0-9-]{8,64})\/?$/.exec(url.pathname);
    const calendarMatch = /^\/c\/([^/]+)\/calendar\.ics$/.exec(url.pathname);
    const match = formMatch || calendarMatch || /^\/c\/([^/]+)\/?$/.exec(url.pathname);

    const posting = request.method === "POST" && Boolean(formMatch);
    if (request.method !== "GET" && request.method !== "HEAD" && !posting) {
      send(response, request, 405, { ...PAGE_HEADERS, allow: formMatch ? "GET, HEAD, POST" : "GET, HEAD" }, renderUnavailablePage({ lang: lang || "en", contact, baseUrl }));
      return;
    }
    if (url.pathname === "/robots.txt") {
      send(response, request, 200, { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" }, "User-agent: *\nDisallow: /\n");
      return;
    }

    const assetName = url.pathname.startsWith("/assets/") ? url.pathname.slice("/assets/".length) : "";
    if (assetName) {
      const asset = ASSETS.get(assetName);
      if (!asset) return unavailable(response, request, lang || "en");
      send(response, request, 200, {
        "content-type": asset.type,
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin"
      }, await readAsset(asset.file));
      return;
    }

    if (!match || !enabled) return unavailable(response, request, lang || "en");

    const token = match[1];
    let link = null;
    let company = null;
    try {
      link = isClientToken(token) ? linkStore.resolve(token) : null;
      company = link ? workspaceStore.getCompany(link.companyId) : null;
    } catch (error) {
      // A busy or full database. The address is a credential, so it is not in this line.
      log.error?.(`Client page lookup failed (${scrub(error?.message || error)}).`);
      unavailable(response, request, lang || "en", 503, { "retry-after": "30" });
      return;
    }
    if (!link || !company) {
      // Wrong, mistyped, ended, or never existed: one answer for all of them.
      // Guessing is slowed down, though with 256 random bits it was never going to work.
      const turn = limiter.take(clientAddress(request));
      if (!turn.allowed) {
        unavailable(response, request, lang || "en", 429, { "retry-after": String(turn.retryAfterSeconds) });
        return;
      }
      unavailable(response, request, lang || "en");
      return;
    }

    if (formMatch) {
      try {
        await questionnaireRoute({ request, response, url, token, link, company, id: formMatch[2], lang });
      } catch (error) {
        log.error?.(`A questionnaire page failed (${scrub(error?.message || error)}).`);
        if (!response.headersSent) unavailable(response, request, lang || link.language, 500);
      }
      return;
    }

    // The page's dates, as a file for the client's own calendar. Not a view.
    if (calendarMatch) {
      try {
        const updates = link.showUpdates
          ? linkStore.publishedUpdates(link.companyId).filter((update) => !update.projectId || link.projectIds.includes(update.projectId))
          : [];
        const ics = renderClientCalendar({
          lang: lang || link.language,
          company: { name: company.name },
          projects: visibleProjects(link),
          updates,
          showUpdates: link.showUpdates,
          questionnaires: questionnaireStore ? questionnaireStore.listForLink(link.id).map((item) => questionnaireStore.summary(item)) : [],
          timeZone,
          host: String(request.headers.host || "").replace(/:\d+$/, "").replace(/[^a-z0-9.-]/gi, "") || "clients.example.com"
        });
        send(response, request, 200, {
          "content-type": "text/calendar; charset=utf-8",
          "content-disposition": "attachment; filename=\"real-co-project.ics\"",
          "cache-control": "no-store",
          "x-robots-tag": "noindex, nofollow, noarchive",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff"
        }, ics);
      } catch (error) {
        log.error?.(`Client calendar could not be made (${scrub(error?.message || error)}).`);
        unavailable(response, request, lang || link.language, 500);
      }
      return;
    }

    // Only a person opening the page counts as a view: not a preview robot, not a
    // HEAD request, and not the owner checking it (?preview=1).
    if (request.method === "GET" && url.searchParams.get("preview") !== "1" && !isLinkPreviewBot(request.headers["user-agent"])) {
      try {
        linkStore.recordView(link.id, { userAgent: request.headers["user-agent"], address: clientAddress(request) });
      } catch (error) {
        // Counting a view is never worth failing the page the client came to read.
        log.warn?.(`Client page view could not be counted (${scrub(error?.message || error)}).`);
      }
    }

    let html;
    try {
      // Updates are written for the company. A link shows them only if the owner
      // left that on, and an update tied to one project only on links that show
      // that project.
      const updates = link.showUpdates
        ? linkStore.publishedUpdates(link.companyId).filter((update) => !update.projectId || link.projectIds.includes(update.projectId))
        : [];
      html = renderClientPage({
        lang: lang || link.language,
        company: { name: company.name },
        person: link.label,
        projects: visibleProjects(link),
        updates,
        showUpdates: link.showUpdates,
        questionnaires: questionnaireStore ? questionnaireStore.listForLink(link.id).map((item) => questionnaireStore.summary(item)) : [],
        base: `/c/${token}`,
        contact,
        baseUrl,
        timeZone,
        otherHref: ""
      });
    } catch (error) {
      log.error?.(`Client page could not be drawn (${scrub(error?.message || error)}).`);
      unavailable(response, request, lang || link.language, 500);
      return;
    }
    send(response, request, 200, PAGE_HEADERS, html);
  };
}
