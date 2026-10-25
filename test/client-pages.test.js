import { fetch } from "./helpers/http.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildUpdateSnapshot } from "../src/client-api.js";
import { DatabaseSync } from "node:sqlite";
import { createClientHostHandler } from "../src/client-host.js";
import { createClientLinkStore, describeDevice, isClientToken, isLinkPreviewBot } from "../src/client-link-store.js";
import { escapeHtml, renderClientCalendar, renderClientPage, renderUnavailablePage } from "../src/client-page.js";
import { createHqServer } from "../src/hq-server.js";
import { createInquiryLimiter } from "../src/public-inquiry.js";
import { createPaperworkStore } from "../src/paperwork-store.js";
import { createWorkspaceStore } from "../src/workspace-store.js";

const CLIENT_HOST = "client.test";

const UPDATE_VALUES = {
  weekOf: "2026-10-04",
  moved: "The booking page now works on phones.\n\nThe form saves its progress.",
  stuck: "We still need the clinic's logo file.",
  need: [["Logo file (vector)", "Dr. Ahmadi", "2026-10-09"], ["Opening hours", "Reception", "next week"]],
  nextStep: "Show you the first working version",
  nextDate: "2026-10-12",
  moneyNote: "Second invoice goes out on the 15th."
};

async function startHq({ enabled = true, authRequired = false, clientPageLimiter, seed = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-client-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ PRIVATE</h1>");
  const databasePath = path.join(root, "data", "rooms.sqlite");
  const workspaceStore = createWorkspaceStore(databasePath);
  const paperworkStore = createPaperworkStore(databasePath, { workspace: workspaceStore });
  const config = {
    company: { name: "Your company", positioning: "x" },
    runtime: {
      root,
      roomDatabasePath: databasePath,
      trustProxy: true,
      clientPagesEnabled: enabled,
      clientPagesHosts: [CLIENT_HOST],
      clientPagesUrl: "https://client.example",
      clientWhatsapp: "",
      clientEmail: "owner@example.com",
      ...(authRequired
        ? { agent4AuthRequired: true, agent4SecureCookies: false, agent4BootstrapEmail: "owner@example.com", agent4BootstrapName: "Owner", agent4BootstrapPassword: "a-long-owner-password" }
        : {})
    }
  };

  let company = null;
  let shown = null;
  let hidden = null;
  let document = null;
  if (seed) {
    company = workspaceStore.createCompany({
      name: "Ahmadi Clinic",
      kind: "client",
      stage: "active",
      summary: "PRIVATE-COMPANY-SUMMARY",
      contactName: "Dr. Ahmadi",
      contactEmail: "ahmadi@clinic.example",
      nextAction: "PRIVATE-NEXT-ACTION",
      howMet: "PRIVATE-HOW-MET",
      actorId: "owner"
    });
    shown = workspaceStore.createProject({
      companyId: company.id,
      companyName: company.name,
      name: "New booking website",
      summary: "PRIVATE-PROJECT-SUMMARY",
      goal: "PRIVATE-GOAL",
      definitionOfDone: "PRIVATE-DONE",
      health: "at_risk",
      milestone: "First working version",
      milestoneDueOn: "2026-10-12",
      actorId: "owner"
    }).project;
    hidden = workspaceStore.createProject({ companyId: company.id, companyName: company.name, name: "SECRET-SIDE-PROJECT", health: "blocked", actorId: "owner" }).project;
    document = paperworkStore.createDocument({
      type: "update",
      title: "Week 40 update",
      companyId: company.id,
      language: "en",
      values: UPDATE_VALUES,
      actorId: "owner"
    });
  }

  const linkStore = createClientLinkStore(databasePath, { workspace: workspaceStore });
  const server = createHqServer(config, { workspaceStore, paperworkStore, clientLinkStore: linkStore, clientPageLimiter });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  /** A request that arrives for the client hostname, which is how Nginx will hand it over. */
  function asClient(pathname, { method = "GET", headers = {}, host = CLIENT_HOST } = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port, path: pathname, method, headers: { host, ...headers } }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) , text: Buffer.concat(chunks).toString("utf8") }));
      });
      request.on("error", reject);
      request.end();
    });
  }

  const owner = (pathname, options = {}) => fetch(`${base}${pathname}`, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), origin: base, ...(options.headers || {}) }
  });
  const makeLink = async (body = {}) => {
    const response = await owner("/api/client-links", { method: "POST", body: JSON.stringify({ companyId: company.id, projectIds: [shown.id], language: "en", label: "Dr. Ahmadi", ...body }) });
    return { response, body: await response.json() };
  };

  return {
    base, asClient, owner, makeLink, company, shown, hidden, document, workspaceStore, paperworkStore, linkStore,
    pageFor: (link, query = "") => asClient(`/c/${link.token}${query}`),
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  };
}

/* ------------------------------------------------------------ the store --- */

test("a link is 256 random bits, ends when revoked or expired, and every other token is just 'no'", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-links-"));
  let clock = new Date("2026-10-01T10:00:00Z");
  const store = createClientLinkStore(path.join(root, "links.sqlite"), { now: () => clock });
  try {
    const first = store.createLink({ companyId: "c1", language: "fa", label: "Sara", projectIds: ["p1", "p1", "p2"], actorId: "owner" });
    const second = store.createLink({ companyId: "c1", ttlDays: 7, actorId: "owner" });
    assert.equal(isClientToken(first.token), true);
    assert.equal(first.token.length, 43);
    assert.notEqual(first.token, second.token);
    assert.deepEqual(first.projectIds, ["p1", "p2"], "a project is listed once");
    assert.equal(first.language, "fa");

    assert.equal(store.resolve(first.token)?.id, first.id);
    for (const bad of ["", "short", `${first.token}x`, first.token.slice(0, 42), "../etc/passwd", null, undefined, 42, `${"A".repeat(43)}`]) {
      assert.equal(store.resolve(bad), null, `${String(bad)} opens nothing`);
    }

    clock = new Date("2026-10-09T10:00:00Z");
    assert.equal(store.resolve(second.token), null, "an expired link stops opening");
    assert.equal(store.resolve(first.token)?.id, first.id, "a link with no end date keeps opening");
    assert.equal(store.listLinks("c1").find((link) => link.id === second.id).state, "expired");

    store.revokeLink(first.id);
    assert.equal(store.resolve(first.token), null, "a revoked link stops at once");
    assert.equal(store.getLink(first.id).state, "revoked");
    assert.throws(() => store.updateLink(first.id, { label: "x" }), /ended/);
    assert.throws(() => store.createLink({ companyId: "c1", language: "de", actorId: "owner" }), /English or Persian/);
    assert.throws(() => store.createLink({ companyId: "c1", ttlDays: 0, actorId: "owner" }), /between 1 and 3650/);
    assert.throws(() => store.createLink({ companyId: "", actorId: "owner" }), /Choose a company/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("link-preview robots are not mistaken for the client reading the page", () => {
  for (const agent of ["WhatsApp/2.24.5 A", "TelegramBot (like TwitterBot)", "facebookexternalhit/1.1", "Slackbot-LinkExpanding 1.0", "Mozilla/5.0 (compatible; Googlebot/2.1)"]) {
    assert.equal(isLinkPreviewBot(agent), true, agent);
  }
  for (const agent of ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36", ""]) {
    assert.equal(isLinkPreviewBot(agent), false, agent);
  }
});

test("a published update is exactly the fields meant for a client, and nothing else", () => {
  const { payload, missing } = buildUpdateSnapshot({ ...UPDATE_VALUES, internalNote: "never", price: 9000, need: [["Logo", "Dr", "2026-10-09"], [], "oops", ["", "x", "y"]] });
  assert.deepEqual(missing, []);
  assert.deepEqual(Object.keys(payload).sort(), ["moneyNote", "moved", "need", "nextDate", "nextStep", "pieces", "stuck", "weekOf"]);
  assert.deepEqual(payload.need, [["Logo", "Dr", "2026-10-09"]], "empty and malformed rows are dropped");

  const incomplete = buildUpdateSnapshot({ moved: "x", nextStep: "y", weekOf: "not a date" });
  assert.deepEqual(incomplete.missing, ["the week it covers"], "a note with no stuck, next step or date is a fine update");
  assert.deepEqual(buildUpdateSnapshot({ weekOf: "2026-10-04" }).missing, ["a short note or the steps"]);
  assert.deepEqual(buildUpdateSnapshot({ weekOf: "2026-10-04", pieces: [["Design", "done"]] }).missing, [], "steps alone are an update");

  const long = buildUpdateSnapshot({ ...UPDATE_VALUES, moved: "m".repeat(9000), nextStep: "n".repeat(900) });
  assert.equal(long.payload.moved.length, 4000);
  assert.equal(long.payload.nextStep.length, 300);
});

/* ----------------------------------------------------------- the page --- */

test("everything a person wrote is escaped, and the page loads nothing from anywhere else", () => {
  const evil = `<script>alert("x")</script><img src=x onerror=alert(1)>"'&`;
  const html = renderClientPage({
    lang: "en",
    company: { name: evil },
    projects: [{ name: evil, status: "active", health: "at_risk", milestone: evil, milestoneDueOn: "2026-10-12" }],
    updates: [{
      number: "WU-1", language: "en", publishedAt: "2026-10-06T08:00:00Z",
      payload: { weekOf: "2026-10-04", moved: evil, stuck: evil, need: [[evil, evil, evil]], nextStep: evil, nextDate: "2026-10-12", moneyNote: evil }
    }],
    contact: { whatsapp: "+12025550123", email: "owner@example.com" },
    baseUrl: "https://client.example"
  });
  assert.equal(html.includes("<script"), false, "no script, and none can be injected");
  assert.equal(html.includes("<img src=x"), false, "a person's image markup never becomes an image");
  assert.match(html, /<img class="wordmark-on-dark" src="\/assets\/company-wordmark-light\.svg"/, "the only document images here are fixed first-party brand assets");
  // WhatsApp links carry the client's message URL-encoded, which is text, not markup.
  assert.equal(/onerror|onload/i.test(html.replace(/&lt;img[^]*?&gt;/g, "").replace(/href="https:\/\/wa\.me\/[^"]*"/g, "")), false);
  assert.ok(html.includes(escapeHtml(evil)), "the text is shown, as text");

  // The only addresses in the document are its own assets, WhatsApp, and email.
  const urls = [...html.matchAll(/(?:href|src)="([^"]+)"|url\("([^"]+)"\)/g)].map((match) => match[1] || match[2]);
  for (const url of urls) {
    assert.ok(url.startsWith("/assets/") || url.startsWith("?lang=") || url.startsWith("https://wa.me/") || url.startsWith("mailto:") || url.startsWith("tel:") || url.endsWith("/calendar.ics") || url === "https://client.example/assets/falcon.svg", `unexpected address: ${url}`);
  }
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(html, /name="referrer" content="no-referrer"/);
});

test("the Persian page is right-to-left, in Jalali dates and Persian words", () => {
  const html = renderClientPage({
    lang: "fa",
    company: { name: "کلینیک احمدی" },
    projects: [{ name: "سایت نوبت‌دهی", status: "active", health: "on_track", milestone: "نسخهٔ اول", milestoneDueOn: "2026-10-12" }],
    updates: [{ number: "WU-1", language: "fa", publishedAt: "2026-10-06T08:00:00Z", payload: { weekOf: "2026-10-04", moved: "صفحهٔ نوبت‌دهی روی موبایل کار می‌کند.", stuck: "فایل لوگو را لازم داریم.", need: [["فایل لوگو", "دکتر احمدی", "2026-10-09"]], nextStep: "نمایش نسخهٔ اول", nextDate: "2026-10-12", moneyNote: "" } }],
    contact: { whatsapp: "+12025550123", email: "owner@example.com" }
  });
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /۷ روز آینده/);
  assert.match(html, /طبق برنامه/);
  assert.match(html, /[۰-۹]{1,2}\s*مهر/, "dates are Jalali, in Persian digits");
  assert.equal(html.includes('class="lang"'), false, "no switch: the page is in the language the owner writes in");
  assert.equal(/PROOF, NOT PERFORMANCE/.test(html), false, "and no English motto on a Persian page");
});

test("the 'no longer active' page says the same thing for every reason", () => {
  const html = renderUnavailablePage({ lang: "en", contact: { whatsapp: "+12025550123" } });
  assert.match(html, /This link is no longer active/);
  assert.match(html, /wa\.me\/12025550123/);
  assert.equal(html.includes("<script"), false);
});

/* -------------------------------------------------- the client hostname --- */

test("a client with a link sees their page, their chosen project, their published update, and nothing private", async () => {
  const hq = await startHq();
  try {
    const { response, body } = await hq.makeLink();
    assert.equal(response.status, 200);
    assert.equal(body.link.url, `https://client.example/c/${body.link.token}`);

    const published = await hq.owner(`/api/paperwork/${hq.document.id}/publish`, { method: "POST" });
    assert.equal(published.status, 200);

    const page = await hq.pageFor(body.link);
    assert.equal(page.status, 200);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.match(page.headers["x-robots-tag"], /noindex/);
    assert.equal(page.headers["referrer-policy"], "no-referrer");
    assert.match(page.headers["content-security-policy"], /default-src 'none'/);
    assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal(page.headers["set-cookie"], undefined, "no cookie, ever");

    assert.match(page.text, /Ahmadi Clinic/);
    assert.match(page.text, /New booking website/);
    assert.match(page.text, /Needs attention/, "the project's health, in plain words");
    assert.match(page.text, /First working version/);
    assert.match(page.text, /The booking page now works on phones\./);
    assert.match(page.text, /Logo file \(vector\)/, "what is waiting on the client");
    assert.match(page.text, /next week/, "free-text 'by' survives");
    assert.match(page.text, /Show you the first working version/);
    assert.match(page.text, /Second invoice goes out on the 15th\./);

    for (const secret of ["PRIVATE-COMPANY-SUMMARY", "PRIVATE-NEXT-ACTION", "PRIVATE-HOW-MET", "PRIVATE-PROJECT-SUMMARY", "PRIVATE-GOAL", "PRIVATE-DONE", "SECRET-SIDE-PROJECT", "ahmadi@clinic.example"]) {
      assert.equal(page.text.includes(secret), false, `${secret} must never reach a client page`);
    }
  } finally {
    await hq.stop();
  }
});

test("ended, unknown and mistyped links all get the same plain answer", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink();
    const live = body.link;
    assert.equal((await hq.pageFor(live)).status, 200);

    const unknown = await hq.asClient(`/c/${"A".repeat(43)}`);
    const malformed = await hq.asClient("/c/not-a-token");
    const traversal = await hq.asClient("/c/..%2F..%2Fdata%2Fhq.html");
    await hq.owner(`/api/client-links/${live.id}/revoke`, { method: "POST" });
    const revoked = await hq.pageFor(live);

    for (const response of [unknown, malformed, traversal, revoked]) {
      assert.equal(response.status, 404);
      assert.match(response.text, /This link is no longer active/);
      assert.equal(response.text.includes("Ahmadi"), false);
    }
    assert.equal(unknown.text, revoked.text, "a revoked link looks exactly like one that never existed");
    assert.equal(unknown.text, malformed.text);
  } finally {
    await hq.stop();
  }
});

test("guessing is slowed down, and a real link still opens for the same caller", async () => {
  const hq = await startHq({ clientPageLimiter: createInquiryLimiter({ perAddress: 3, perHour: 100, windowMs: 60_000 }) });
  try {
    const { body } = await hq.makeLink();
    for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await hq.asClient(`/c/${"B".repeat(42)}${attempt}`)).status, 404);
    const limited = await hq.asClient(`/c/${"C".repeat(43)}`);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers["retry-after"]) >= 1);
    assert.equal((await hq.pageFor(body.link)).status, 200, "a person with the right link is never the one locked out");
  } finally {
    await hq.stop();
  }
});

test("the page follows the language of the link and can be switched", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink({ language: "fa" });
    assert.match((await hq.pageFor(body.link)).text, /<html lang="fa" dir="rtl">/);
    assert.match((await hq.pageFor(body.link, "?lang=en")).text, /<html lang="en" dir="ltr">/);
    assert.match((await hq.pageFor(body.link, "?lang=zz")).text, /<html lang="fa"/, "an unknown language falls back to the link's own");
  } finally {
    await hq.stop();
  }
});

test("the client hostname can reach client pages and nothing else of HQ", async () => {
  const hq = await startHq({ authRequired: false });
  try {
    for (const pathname of ["/", "/api/workspaces", "/api/paperwork", "/api/auth/session", "/data/hq.html", "/telegram", "/public/inquiry", "/c", "/c/", "/c/a/b", "/assets/../data/hq.html", "/assets/nope.png", "/api/client-links"]) {
      const response = await hq.asClient(pathname);
      assert.ok([404, 405].includes(response.status), `${pathname} -> ${response.status}`);
      assert.equal(/Agent4 HQ PRIVATE|"companies"|"documents"/.test(response.text), false, `${pathname} leaked HQ`);
    }
    assert.equal((await hq.asClient("/api/workspaces", { method: "POST" })).status, 405, "no writes at all");

    const robots = await hq.asClient("/robots.txt");
    assert.equal(robots.status, 200);
    assert.match(robots.text, /Disallow: \//);

    const mark = await hq.asClient("/assets/falcon.svg");
    assert.equal(mark.status, 200);
    assert.equal(mark.headers["content-type"], "image/svg+xml");
    for (const wordmark of ["company-wordmark.svg", "company-wordmark-light.svg"]) {
      const served = await hq.asClient(`/assets/${wordmark}`);
      assert.equal(served.status, 200, wordmark);
      assert.equal(served.headers["content-type"], "image/svg+xml");
    }
    assert.equal((await hq.asClient('/assets/vazirmatn-arabic.woff2')).status, 404, 'private font assets are not distributed');
    assert.equal((await hq.asClient('/assets/mascot-wave.webp')).status, 404, 'private mascots are not distributed');
    assert.equal((await hq.asClient("/assets/mascot-other.webp")).status, 404, "only the listed pictures are served");

    // And the other way round: HQ's own address does not serve client pages.
    const { body } = await hq.makeLink();
    const viaHq = await fetch(`${hq.base}/c/${body.link.token}`);
    assert.equal((await viaHq.text()).includes("Ahmadi Clinic"), false);
  } finally {
    await hq.stop();
  }
});

test("a HEAD request gets headers and no body, and a write gets refused", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink();
    const head = await hq.asClient(`/c/${body.link.token}`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.text, "");
    const post = await hq.asClient(`/c/${body.link.token}`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, "GET, HEAD");
  } finally {
    await hq.stop();
  }
});

test("client pages are off until switched on", async () => {
  const hq = await startHq({ enabled: false });
  try {
    const refused = await hq.makeLink();
    assert.equal(refused.response.status, 409);
    assert.equal(refused.body.error.code, "client_pages_off");
    const publish = await hq.owner(`/api/paperwork/${hq.document.id}/publish`, { method: "POST" });
    assert.equal(publish.status, 409);
    assert.equal((await hq.asClient(`/c/${"A".repeat(43)}`)).status, 404);
  } finally {
    await hq.stop();
  }
});

test("views count the client, not WhatsApp drawing a preview", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink();
    await hq.asClient(`/c/${body.link.token}`, { headers: { "user-agent": "WhatsApp/2.24.5 A" } });
    await hq.asClient(`/c/${body.link.token}`, { headers: { "user-agent": "TelegramBot (like TwitterBot)" } });
    let list = await (await hq.owner(`/api/client-links?companyId=${hq.company.id}`)).json();
    assert.equal(list.links[0].viewCount, 0);
    assert.equal(list.links[0].lastViewedAt, null);

    const phone = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1" };
    await hq.asClient(`/c/${body.link.token}?preview=1`, { headers: phone });
    list = await (await hq.owner(`/api/client-links?companyId=${hq.company.id}`)).json();
    assert.equal(list.links[0].viewCount, 0, "the owner checking the page is not the client opening it");

    await hq.asClient(`/c/${body.link.token}`, { headers: phone });
    list = await (await hq.owner(`/api/client-links?companyId=${hq.company.id}`)).json();
    assert.equal(list.links[0].viewCount, 1);
    assert.ok(list.links[0].lastViewedAt);
    assert.deepEqual(list.company, { name: "Ahmadi Clinic", contactName: "Dr. Ahmadi", contactPhone: "" });
  } finally {
    await hq.stop();
  }
});

/* ----------------------------------------------------- publishing updates --- */

test("publishing is a snapshot: editing later changes nothing until it is published again", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink();
    assert.match((await hq.pageFor(body.link)).text, /Your first update will appear here/, "a new client sees a calm empty page, not an error");

    const published = await hq.owner(`/api/paperwork/${hq.document.id}/publish`, { method: "POST" });
    const result = await published.json();
    assert.equal(published.status, 200);
    assert.equal(result.document.status, "sent", "putting it on the page is sending it");
    assert.equal(result.activeLinks, 1);

    hq.paperworkStore.updateDocument(hq.document.id, { values: { moved: "CHANGED AFTER PUBLISHING" } });
    assert.equal((await hq.pageFor(body.link)).text.includes("CHANGED AFTER PUBLISHING"), false, "the client's copy did not move");

    await hq.owner(`/api/paperwork/${hq.document.id}/publish`, { method: "POST" });
    assert.match((await hq.pageFor(body.link)).text, /CHANGED AFTER PUBLISHING/, "publishing again replaces it");
  } finally {
    await hq.stop();
  }
});

test("withdrawing really removes it, and an older update moves down rather than vanishing", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink();
    const older = hq.paperworkStore.createDocument({ type: "update", title: "Week 39", companyId: hq.company.id, language: "en", values: { ...UPDATE_VALUES, weekOf: "2026-09-27", moved: "OLDER-WEEK-NEWS", need: [] }, actorId: "owner" });
    // This week first, then a correction to last week: publishing order must not decide which is "latest".
    await hq.owner(`/api/paperwork/${hq.document.id}/publish`, { method: "POST" });
    await hq.owner(`/api/paperwork/${older.id}/publish`, { method: "POST" });

    let page = (await hq.pageFor(body.link)).text;
    assert.match(page, /Earlier updates/);
    assert.match(page, /OLDER-WEEK-NEWS/, "the older update is still there, tucked under 'earlier'");
    assert.ok(page.indexOf("The booking page now works") < page.indexOf("Earlier updates"), "the newest comes first");

    const withdrawn = await hq.owner(`/api/paperwork/${hq.document.id}/withdraw`, { method: "POST" });
    assert.equal(withdrawn.status, 200);
    page = (await hq.pageFor(body.link)).text;
    assert.equal(page.includes("The booking page now works"), false, "withdrawn means gone");
    assert.match(page, /OLDER-WEEK-NEWS/);
    assert.equal(page.includes('class="late-card"'), false, "and the page falls back to the update that is still live");

    const state = await (await hq.owner(`/api/paperwork/${hq.document.id}/publication`)).json();
    assert.equal(state.published, false);
    assert.ok(state.withdrawnAt);
    assert.equal((await hq.owner(`/api/paperwork/${hq.company.id}-nope/withdraw`, { method: "POST" })).status, 404);
  } finally {
    await hq.stop();
  }
});

test("an update that is not ready, not an update, or not for anyone cannot be published", async () => {
  const hq = await startHq();
  try {
    const incomplete = hq.paperworkStore.createDocument({ type: "update", title: "Half done", companyId: hq.company.id, language: "en", values: { weekOf: "2026-10-04" }, actorId: "owner" });
    const response = await hq.owner(`/api/paperwork/${incomplete.id}/publish`, { method: "POST" });
    assert.equal(response.status, 400);
    const { error } = await response.json();
    assert.equal(error.code, "update_incomplete");
    assert.match(error.message, /a short note or the steps/);

    const proposal = hq.paperworkStore.createDocument({ type: "proposal", title: "A proposal", companyId: hq.company.id, language: "en", values: {}, actorId: "owner" });
    assert.equal((await (await hq.owner(`/api/paperwork/${proposal.id}/publish`, { method: "POST" })).json()).error.code, "not_an_update");

    const nobody = hq.paperworkStore.createDocument({ type: "update", title: "For nobody", language: "en", values: UPDATE_VALUES, actorId: "owner" });
    assert.equal((await (await hq.owner(`/api/paperwork/${nobody.id}/publish`, { method: "POST" })).json()).error.code, "no_company");

    hq.paperworkStore.setStatus(hq.document.id, "void");
    assert.equal((await (await hq.owner(`/api/paperwork/${hq.document.id}/publish`, { method: "POST" })).json()).error.code, "void_document");
  } finally {
    await hq.stop();
  }
});

/* ------------------------------------------------------ owner-only rules --- */

test("a link can only show its own company's projects, and can be changed or ended", async () => {
  const hq = await startHq();
  try {
    const stranger = hq.workspaceStore.createCompany({ name: "Someone Else", kind: "client", actorId: "owner" });
    const foreign = hq.workspaceStore.createProject({ companyId: stranger.id, companyName: stranger.name, name: "Their project", actorId: "owner" }).project;

    const refused = await hq.makeLink({ projectIds: [foreign.id] });
    assert.equal(refused.response.status, 400);
    assert.match(refused.body.error.message, /own company/);
    assert.equal((await hq.makeLink({ companyId: "no-such-company" })).response.status, 400);

    const { body } = await hq.makeLink({ projectIds: [] });
    assert.equal((await hq.pageFor(body.link)).text.includes("New booking website"), false, "a link with no projects ticked shows none");

    const changed = await hq.owner(`/api/client-links/${body.link.id}`, { method: "PATCH", body: JSON.stringify({ projectIds: [hq.shown.id], label: "Renamed" }) });
    assert.equal(changed.status, 200);
    assert.match((await hq.pageFor(body.link)).text, /New booking website/);

    const sneaky = await hq.owner(`/api/client-links/${body.link.id}`, { method: "PATCH", body: JSON.stringify({ projectIds: [foreign.id] }) });
    assert.equal(sneaky.status, 400);

    await hq.owner(`/api/client-links/${body.link.id}/revoke`, { method: "POST" });
    const ended = await hq.owner(`/api/client-links/${body.link.id}`, { method: "PATCH", body: JSON.stringify({ label: "x" }) });
    assert.equal(ended.status, 400, "an ended link cannot be edited back to life");

    const list = await (await hq.owner(`/api/client-links?companyId=${hq.company.id}`)).json();
    assert.equal(list.links[0].state, "revoked");
    assert.deepEqual(list.projects.map((project) => project.name).sort(), ["New booking website", "SECRET-SIDE-PROJECT"]);
  } finally {
    await hq.stop();
  }
});

test("only the signed-in owner can see or change client links and publish updates", async () => {
  const hq = await startHq({ authRequired: true });
  try {
    for (const [method, pathname] of [["GET", "/api/client-links?companyId=x"], ["POST", "/api/client-links"], ["POST", `/api/paperwork/${hq.document.id}/publish`], ["POST", `/api/paperwork/${hq.document.id}/withdraw`], ["GET", `/api/paperwork/${hq.document.id}/publication`], ["GET", "/api/client-pages"], ["POST", `/api/client-pages/${hq.company.id}/post`]]) {
      const response = await hq.owner(pathname, { method, ...(method === "POST" ? { body: "{}" } : {}) });
      assert.equal(response.status, 401, `${method} ${pathname} needs a sign-in`);
    }

    const login = await hq.owner("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "owner@example.com", password: "a-long-owner-password" }) });
    const ownerCookie = String(login.headers.get("set-cookie")).split(";", 1)[0];
    const invite = await (await hq.owner("/api/auth/invites", { method: "POST", headers: { cookie: ownerCookie }, body: JSON.stringify({ email: "member@example.com", name: "Member" }) })).json();
    const token = invite.invite.token || String(invite.invite.url).split("invite=")[1];
    const registered = await hq.owner("/api/auth/register", { method: "POST", body: JSON.stringify({ token, password: "a-long-friend-password" }) });
    const memberCookie = String(registered.headers.get("set-cookie")).split(";", 1)[0];
    assert.ok(memberCookie, "a teammate exists");

    for (const [method, pathname] of [["GET", `/api/client-links?companyId=${hq.company.id}`], ["POST", "/api/client-links"], ["POST", `/api/paperwork/${hq.document.id}/publish`], ["GET", "/api/client-pages"], ["GET", `/api/client-pages/${hq.company.id}`], ["POST", `/api/client-pages/${hq.company.id}/post`]]) {
      const response = await hq.owner(pathname, { method, headers: { cookie: memberCookie }, ...(method === "POST" ? { body: JSON.stringify({ companyId: hq.company.id }) } : {}) });
      assert.equal(response.status, 403, `a teammate must not ${method} ${pathname}`);
    }

    const allowed = await hq.owner(`/api/client-links?companyId=${hq.company.id}`, { headers: { cookie: ownerCookie } });
    assert.equal(allowed.status, 200);
  } finally {
    await hq.stop();
  }
});


/* ------------------------------------------------- the Clients screen --- */

test("posting progress from the Clients screen puts steps and a note on the client's page in one go", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink();
    const overview = await (await hq.owner("/api/client-pages")).json();
    const row = overview.companies.find((item) => item.id === hq.company.id);
    assert.equal(row.hasPage, true);
    assert.equal(row.lastPostedAt, null, "nothing posted yet");

    const empty = await hq.owner(`/api/client-pages/${hq.company.id}/post`, { method: "POST", body: JSON.stringify({ note: "  " }) });
    assert.equal(empty.status, 400, "an update needs a note or steps");

    const posted = await hq.owner(`/api/client-pages/${hq.company.id}/post`, {
      method: "POST",
      body: JSON.stringify({ note: "STEPS-NOTE: the homepage is done.", steps: [["Design", "done"], ["Build", "half"], ["Launch", "nonsense"], ["", "done"]], nextStep: "Show the booking form", nextDate: "2026-11-02", need: [["Logo file", "2026-10-30"]] })
    });
    assert.equal(posted.status, 200);
    const result = await posted.json();
    assert.deepEqual(result.values.pieces, [["Design", "done", "", "", ""], ["Build", "half", "", "", ""], ["Launch", "todo", "", "", ""]], "unknown states become 'not yet', nameless steps are dropped");
    assert.equal(result.document.status, "sent", "behind it is an ordinary weekly update, marked sent");

    let page = (await hq.pageFor(body.link)).text;
    assert.match(page, /STEPS-NOTE: the homepage is done\./);
    assert.match(page, /We&#39;re working on Build\./);
    assert.match(page, /Show the booking form/);
    assert.match(page, /Logo file/);

    const detail = await (await hq.owner(`/api/client-pages/${hq.company.id}`)).json();
    assert.equal(detail.updates.length, 1);
    assert.deepEqual(detail.draft.steps, [["Design", "done", "", "", ""], ["Build", "half", "", "", ""], ["Launch", "todo", "", "", ""]], "the next update starts from these steps");
    assert.deepEqual(detail.draft.need, [["Logo file", "2026-10-30"]]);

    // Fixing the same update replaces it instead of adding another.
    const fixed = await hq.owner(`/api/client-pages/${hq.company.id}/post`, { method: "POST", body: JSON.stringify({ paperworkId: detail.updates[0].paperworkId, note: "FIXED-NOTE", steps: [["Design", "done"]] }) });
    assert.equal(fixed.status, 200);
    page = (await hq.pageFor(body.link)).text;
    assert.match(page, /FIXED-NOTE/);
    assert.equal(page.includes("STEPS-NOTE"), false);
    assert.equal((await (await hq.owner(`/api/client-pages/${hq.company.id}`)).json()).updates.length, 1);

    const foreign = await hq.owner(`/api/client-pages/${hq.company.id}/post`, { method: "POST", body: JSON.stringify({ paperworkId: "not-a-real-document", note: "x" }) });
    assert.equal(foreign.status, 404, "only an update of this company can be fixed from here");
    assert.equal((await hq.owner("/api/client-pages/no-such-company")).status, 404);
  } finally {
    await hq.stop();
  }
});

/* ------------------------------- findings from the independent review --- */

test("an update cannot outlive its document: delete, void and re-filing all take it off the page", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink();
    const publish = (id) => hq.owner(`/api/paperwork/${id}/publish`, { method: "POST" });
    const onPage = async (marker) => (await hq.pageFor(body.link)).text.includes(marker);
    const make = (title, moved) => hq.paperworkStore.createDocument({ type: "update", title, companyId: hq.company.id, language: "en", values: { ...UPDATE_VALUES, moved }, actorId: "owner" });

    // Deleting the document deletes the client's copy.
    const doomed = make("Doomed", "DELETE-ME-NEWS");
    await publish(doomed.id);
    assert.equal(await onPage("DELETE-ME-NEWS"), true);
    assert.equal((await hq.owner(`/api/paperwork/${doomed.id}`, { method: "DELETE" })).status, 200);
    assert.equal(await onPage("DELETE-ME-NEWS"), false, "deleted means gone from the client's page too");
    assert.equal(hq.linkStore.publicationFor(doomed.id), null, "and gone from the store");

    // Voiding it takes it off.
    const voided = make("Voided", "VOID-ME-NEWS");
    await publish(voided.id);
    assert.equal(await onPage("VOID-ME-NEWS"), true);
    await hq.owner(`/api/paperwork/${voided.id}/status`, { method: "POST", body: JSON.stringify({ status: "void" }) });
    assert.equal(await onPage("VOID-ME-NEWS"), false);

    // Filing it under another company takes it off the first company's page, and
    // HQ no longer claims it is published for the new one.
    const other = hq.workspaceStore.createCompany({ name: "Other Co", kind: "client", actorId: "owner" });
    const moved = make("Moved", "MOVE-ME-NEWS");
    await publish(moved.id);
    assert.equal(await onPage("MOVE-ME-NEWS"), true);
    const patched = await hq.owner(`/api/paperwork/${moved.id}`, { method: "PATCH", body: JSON.stringify({ companyId: other.id }) });
    assert.equal(patched.status, 200);
    assert.equal(await onPage("MOVE-ME-NEWS"), false, "it left the first company's page");
    const state = await (await hq.owner(`/api/paperwork/${moved.id}/publication`)).json();
    assert.equal(state.published, false, "and HQ does not say it is on the other company's page");
  } finally {
    await hq.stop();
  }
});

test("deleting a company deletes its client links and everything published for it", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink();
    await hq.owner(`/api/paperwork/${hq.document.id}/publish`, { method: "POST" });
    assert.equal(hq.linkStore.publishedUpdates(hq.company.id).length, 1);

    const removed = await hq.owner(`/api/workspaces/companies/${hq.company.id}?confirm=true`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.equal(hq.linkStore.publishedUpdates(hq.company.id).length, 0);
    assert.equal(hq.linkStore.listLinks(hq.company.id).length, 0);
    assert.equal((await hq.pageFor(body.link)).status, 404);
  } finally {
    await hq.stop();
  }
});

test("a link can leave weekly updates off, and an update tied to a project follows that project", async () => {
  const hq = await startHq();
  try {
    await hq.owner(`/api/paperwork/${hq.document.id}/publish`, { method: "POST" });
    const quiet = (await hq.makeLink({ showUpdates: false, label: "Billing contact" })).body.link;
    const page = (await hq.pageFor(quiet)).text;
    assert.match(page, /New booking website/, "the ticked project still shows");
    assert.equal(page.includes("Second invoice goes out"), false, "no money note on a link that has updates off");
    assert.equal(page.includes("Logo file"), false);
    assert.equal(page.includes("Your first update will appear here"), false, "and no promise of updates it will never show");
    assert.equal(quiet.showUpdates, false);

    const changed = await hq.owner(`/api/client-links/${quiet.id}`, { method: "PATCH", body: JSON.stringify({ showUpdates: true }) });
    assert.equal((await changed.json()).link.showUpdates, true);
    assert.match((await hq.pageFor(quiet)).text, /Second invoice goes out/);

    // An update tied to a project the link does not show stays off that link.
    const scoped = hq.paperworkStore.createDocument({ type: "update", title: "Side project", companyId: hq.company.id, projectId: hq.hidden.id, language: "en", values: { ...UPDATE_VALUES, weekOf: "2026-10-11", moved: "SIDE-PROJECT-NEWS" }, actorId: "owner" });
    await hq.owner(`/api/paperwork/${scoped.id}/publish`, { method: "POST" });
    assert.equal((await hq.pageFor(quiet)).text.includes("SIDE-PROJECT-NEWS"), false);
    const both = (await hq.makeLink({ projectIds: [hq.shown.id, hq.hidden.id] })).body.link;
    assert.match((await hq.pageFor(both)).text, /SIDE-PROJECT-NEWS/);
  } finally {
    await hq.stop();
  }
});

test("odd hostnames: the client site by any spelling of its name, and nothing that merely resembles it", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink();
    const path = `/c/${body.link.token}`;
    for (const host of [CLIENT_HOST, "CLIENT.TEST", `${CLIENT_HOST}.`, `${CLIENT_HOST}:8443`, `${CLIENT_HOST}.:8443`]) {
      const response = await hq.asClient(path, { host });
      assert.equal(response.status, 200, `${host} is the client site`);
    }
    for (const host of [`${CLIENT_HOST}.evil.test`, `evil-${CLIENT_HOST}`, `x.${CLIENT_HOST}`]) {
      const response = await hq.asClient(path, { host });
      assert.equal(response.text.includes("Ahmadi Clinic"), false, `${host} is not the client site`);
    }
  } finally {
    await hq.stop();
  }
});

test("every open is kept with its device, and the owner's own taps are not counted as the client's", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink();
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
    const list = async () => (await (await hq.owner(`/api/client-links?companyId=${hq.company.id}`, { headers: { "x-real-ip": "203.0.113.5" } })).json()).links[0];

    // The owner uses HQ from 203.0.113.5, then taps the link in their own chat.
    await list();
    await hq.asClient(`/c/${body.link.token}`, { headers: { "user-agent": iphone, "x-real-ip": "203.0.113.5" } });
    let link = await list();
    assert.equal(link.viewCount, 0, "the owner opening their own link is not the client opening it");
    assert.equal(link.views.ownOpens, 1);
    assert.equal(link.views.opens[0].own, true);

    // The client opens it on their phone, twice, then on a computer.
    await hq.asClient(`/c/${body.link.token}`, { headers: { "user-agent": iphone, "x-real-ip": "198.51.100.7" } });
    await hq.asClient(`/c/${body.link.token}`, { headers: { "user-agent": iphone, "x-real-ip": "198.51.100.7" } });
    await hq.asClient(`/c/${body.link.token}`, { headers: { "user-agent": windows, "x-real-ip": "198.51.100.8" } });
    await hq.asClient(`/c/${body.link.token}`, { headers: { "user-agent": "WhatsApp/2.24.5 A", "x-real-ip": "198.51.100.9" } });
    link = await list();
    assert.equal(link.viewCount, 3);
    assert.equal(link.views.devices, 2);
    assert.equal(link.views.logged, 3);
    assert.ok(link.views.firstViewedAt);
    assert.equal(link.views.opens.length, 4, "three of theirs and one of the owner's; the preview robot is not an open");
    assert.deepEqual(link.views.opens.map(({ device, os, browser, own, visitor }) => ({ device, os, browser, own, visitor })), [
      { device: "computer", os: "Windows", browser: "Chrome", own: false, visitor: 2 },
      { device: "phone", os: "iOS", browser: "Safari", own: false, visitor: 1 },
      { device: "phone", os: "iOS", browser: "Safari", own: false, visitor: 1 },
      { device: "phone", os: "iOS", browser: "Safari", own: true, visitor: 0 }
    ]);
    assert.equal(JSON.stringify(link.views).includes("198.51.100"), false, "no address is kept or shown");
  } finally {
    await hq.stop();
  }
});

test("a device is described from its browser string, and nothing finer", () => {
  assert.deepEqual(describeDevice("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36"), { device: "phone", os: "Android", browser: "Samsung Internet" });
  assert.deepEqual(describeDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1"), { device: "tablet", os: "iOS", browser: "Chrome" });
  assert.deepEqual(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"), { device: "computer", os: "macOS", browser: "Safari" });
  assert.deepEqual(describeDevice(""), { device: "computer", os: "", browser: "" });
});

test("a HEAD request is not a view, and the page asks browsers to stay on https", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.makeLink();
    await hq.asClient(`/c/${body.link.token}`, { method: "HEAD", headers: { "user-agent": "Mozilla/5.0 Safari/604.1" } });
    assert.equal(hq.linkStore.getLink(body.link.id).viewCount, 0);

    const plain = await hq.asClient(`/c/${body.link.token}?preview=1`);
    assert.equal(plain.headers["strict-transport-security"], undefined, "no HSTS promise over plain http");
    const secure = await hq.asClient(`/c/${body.link.token}?preview=1`, { headers: { "x-forwarded-proto": "https" } });
    assert.match(secure.headers["strict-transport-security"], /max-age=31536000/);
  } finally {
    await hq.stop();
  }
});

test("web addresses in an update become links that cannot break the page or smuggle anything in", () => {
  const html = renderClientPage({
    lang: "en", company: { name: "Acme" }, projects: [],
    updates: [{ language: "en", publishedAt: "2026-10-06T08:00:00Z", payload: {
      weekOf: "2026-10-04", stuck: "x", nextStep: "y", nextDate: "2026-10-12",
      moved: `Preview is here: https://staging.example.com/preview?a=1&b=2.\nAlso (https://docs.example.org/guide), and "https://quoted.example.net/x" onfocus=alert(1) plus javascript:alert(1) and https://nodot and <https://angle.example.io/p> and https://inject.example/x"onmouseover="alert(1)#y.`
    } }],
    contact: {}
  });
  assert.match(html, /<a href="https:\/\/staging\.example\.com\/preview\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">https:\/\/staging\.example\.com\/preview\?a=1&amp;b=2<\/a>\./, "the full stop stays outside the link");
  assert.match(html, /<a href="https:\/\/docs\.example\.org\/guide"[^>]*>[^<]*<\/a>\)/, "so does a closing bracket");
  assert.match(html, /<a href="https:\/\/quoted\.example\.net\/x"/);
  assert.equal(/<a [^>]*onfocus/.test(html), false, "a quote cannot close the attribute and add one");
  // Every link in the update is exactly <a href="..." target="_blank" rel="noopener noreferrer"> with no raw quote
  // in the address, so there is no room for a second attribute, whatever was typed.
  const updateHtml = html.slice(html.indexOf('class="note-dark"'), html.indexOf("</section>", html.indexOf('class="note-dark"')));
  const tags = updateHtml.match(/<a [^>]*>/g) || [];
  assert.ok(tags.length >= 4, "the addresses were linked");
  for (const tag of tags) assert.match(tag, /^<a href="[^"]*" target="_blank" rel="noopener noreferrer">$/, `unexpected link tag: ${tag}`);
  assert.match(html, /<a href="https:\/\/inject\.example\/x&quot;onmouseover=&quot;alert\(1\)#y"/, "the quotes stay inside the address, as text");
  assert.equal(html.includes('href="javascript'), false, "only http and https are ever linked");
  assert.equal(html.includes('href="https://nodot'), false, "an address with no real host is left as text");
  assert.ok(html.includes('&lt;<a href="https://angle.example.io/p"') && html.includes("</a>&gt; and"), "angle brackets stay text around the link");
  assert.match(html, /\.update p\{[^}]*overflow-wrap:anywhere/, "a long address cannot push a phone sideways");
});

test("a Persian page showing an English update keeps its own headings Persian", () => {
  const html = renderClientPage({
    lang: "fa", company: { name: "کلینیک" }, projects: [],
    updates: [{ language: "en", publishedAt: "2026-10-06T08:00:00Z", payload: { weekOf: "2026-10-04", moved: "The booking page works.", stuck: "Nothing.", nextStep: "Show it", nextDate: "2026-10-12" } }],
    contact: {}
  });
  assert.equal(/<article class="update"[^>]*lang=/.test(html), false, "the card is not marked English, so :lang(fa) headings keep joining their letters");
  assert.match(html, /<p dir="auto" lang="en">The booking page works\.<\/p>/, "the writing itself is marked English");
  assert.match(html, /<h4 class="stuck">کجا گیر کرده<\/h4>/);
});

test("a date that does not exist is left out instead of becoming another date", () => {
  assert.deepEqual(buildUpdateSnapshot({ ...UPDATE_VALUES, weekOf: "2026-02-31" }).missing, ["the week it covers"]);
  const html = renderClientPage({
    lang: "en", company: { name: "Acme" }, projects: [{ name: "P", status: "active", health: "on_track", milestone: "M", milestoneDueOn: "2026-02-31" }],
    updates: [{ language: "en", publishedAt: "2026-10-06T08:00:00Z", payload: { weekOf: "2026-10-04", moved: "m", stuck: "s", need: [["Thing", "", "2026-04-31"]], nextStep: "n", nextDate: "2026-11-31" } }],
    contact: {}
  });
  assert.equal(/3 Mar|1 May|1 Dec/.test(html), false, "31 February, 31 April and 31 November do not roll into the next month");
});

test("a database failure shows a calm page and never writes the link to the log", async () => {
  const logged = [];
  const log = { error: (message) => logged.push(String(message)), warn: (message) => logged.push(String(message)) };
  const token = "T".repeat(43);
  const handler = createClientHostHandler({
    config: { runtime: { clientPagesEnabled: true, clientWhatsapp: "" } },
    linkStore: { resolve() { throw new Error(`SQLITE_BUSY while reading /c/${token}`); } },
    workspaceStore: {},
    log
  });
  let status;
  let text = "";
  const response = { writeHead(code) { status = code; }, end(body) { text = String(body || ""); } };
  await handler({ method: "GET", headers: { host: CLIENT_HOST } }, response, new URL(`http://x/c/${token}`));
  assert.equal(status, 503);
  assert.match(text, /no longer active/);
  assert.ok(logged.length >= 1);
  assert.equal(logged.some((line) => line.includes(token)), false, "the log line names no link");
});

test("the guess limiter forgets addresses that never come back", () => {
  let moment = 0;
  const limiter = createInquiryLimiter({ perAddress: 5, perHour: 100_000, windowMs: 1000, now: () => moment });
  for (let index = 0; index < 600; index += 1) limiter.take(`2001:db8::${index}`);
  assert.equal(limiter.size(), 600);
  moment += 5000;
  limiter.take("someone-new");
  assert.equal(limiter.size() <= 2, true, "stale addresses were swept, so rotating addresses cannot grow it");
});

test("a database made before links could hide weekly updates is upgraded in place", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-migrate-"));
  const file = path.join(root, "old.sqlite");
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE agent4_client_links (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'en', project_ids TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, created_by TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, last_viewed_at TEXT, view_count INTEGER NOT NULL DEFAULT 0);`);
    old.prepare("INSERT INTO agent4_client_links (id,company_id,token,created_at,created_by) VALUES ('l1','c1',?, '2026-10-01T00:00:00Z','owner')").run("O".repeat(43));
    old.close();

    const store = createClientLinkStore(file);
    try {
      assert.equal(store.getLink("l1").showUpdates, true, "an existing link keeps showing updates, as it always did");
      assert.equal(store.resolve("O".repeat(43)).id, "l1");
    } finally {
      store.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------ how it is laid out --- */

test("the contact band has its own heading, and the questions are a to-do", () => {
  const html = renderClientPage({
    lang: "en",
    company: { name: "Ahmadi Clinic" },
    questionnaires: [{ id: "q-1", title: "Getting started", language: "en", status: "open", progress: { total: 3, answered: 0, needed: 1, neededAnswered: 0 } }],
    contact: { whatsapp: "+12025550123", email: "owner@example.com" },
    base: "/c/TOKEN"
  });
  const talk = html.slice(html.indexOf('class="band"'));
  assert.match(talk, /<h2 id="talk">Questions\? Just ask\.<\/h2>/);
  assert.match(talk, /href="tel:\+12025550123"/, "they can call too");
  assert.match(html, /Answer the “Getting started” questions/);
  assert.match(html, /href="\/c\/TOKEN\/q\/q-1">Start<i/);
  assert.match(html, /Rather talk\? Ask for a call/);
  const persian = renderClientPage({ lang: "fa", company: { name: "کلینیک" }, contact: { whatsapp: "+12025550123" } });
  assert.match(persian, /<h2 id="talk">سؤالی دارید؟ بپرسید\.<\/h2>/);
});

test("a milestone date is shown in the page's own calendar, and a date that does not exist is not drawn", () => {
  const project = { name: "Site", status: "active", health: "on_track", milestone: "First version", milestoneDueOn: "2026-10-12" };
  const english = renderClientPage({ lang: "en", company: { name: "C" }, projects: [project] });
  assert.match(english, /<time class="d" datetime="2026-10-12">Mon 12 Oct<\/time>/);
  const persian = renderClientPage({ lang: "fa", company: { name: "C" }, projects: [project] });
  assert.match(persian, /<time class="d" datetime="2026-10-12">[^<]*[۰-۹]{1,2} مهر<\/time>/, "Jalali month, Persian digits");
  for (const impossible of ["2026-02-31", "tomorrow", "", "2026-10-12T00:00"]) {
    const html = renderClientPage({ lang: "en", company: { name: "C" }, projects: [{ ...project, milestoneDueOn: impossible }] });
    assert.equal(html.includes('class="d" datetime'), false, `${impossible || "(empty)"} draws no date`);
    assert.match(html, /First version/, "but the milestone itself still shows");
  }
});

test("the client is greeted by name, a titled name keeps its title", () => {
  const helloOf = (person) => renderClientPage({ lang: "en", company: { name: "C" }, person }).match(/<p class="hello">([^<]*)<\/p>/)[1];
  assert.equal(helloOf("Lena Vogt"), "Hi Lena,");
  assert.equal(helloOf("Dr. Ahmadi"), "Hi Dr. Ahmadi,");
  assert.equal(helloOf(""), "Hello,");
  assert.equal(helloOf("<b>x</b>"), "Hi &lt;b&gt;x&lt;/b&gt;,", "the name is only ever text");
});

test("what the owner typed in 'needed by' is shown exactly as typed, with one button to send it", () => {
  const html = renderClientPage({
    lang: "en",
    company: { name: "Acme" },
    contact: { whatsapp: "+12025550123" },
    updates: [{ number: "WU-1", language: "en", publishedAt: "2026-10-06T08:00:00Z", payload: { weekOf: "2026-10-04", need: [["Logo", "Dr. Ahmadi", "next week"]] } }]
  });
  assert.match(html, /<p dir="auto">by next week<\/p>/, "an undated ask goes under 'any time', with its words");
  assert.match(html, /href="https:\/\/wa\.me\/12025550123\?text=Hi%20Alex%2C%20for%20Acme%3A%20Logo"/, "the message to us is already written");
});

test("the opening leads with the day it goes live, the days left, and plain badges", () => {
  const now = new Date("2026-10-23T09:00:00Z");
  const steps = [["Brief", "done", "2026-10-09"], ["Design", "done", "2026-10-16"], ["Build", "half", "2026-10-30"], ["Launch", "todo", "2026-11-14"]];
  const update = (pieces, need = []) => [{ language: "en", publishedAt: "2026-10-23T06:00:00Z", payload: { weekOf: "2026-10-23", moved: "x", nextStep: "Show you the booking form", nextDate: "2026-10-27", need, pieces } }];
  const page = renderClientPage({ lang: "en", company: { name: "C" }, person: "Lena Vogt", now, updates: update(steps) });
  assert.match(page, /<p class="hello">Hi Lena, your project goes live<\/p>/);
  assert.match(page, /<h1 class="big-date">Sat <span>14 Nov<\/span><\/h1><p class="countdown"><b>22<\/b><span class="mono">days to go<\/span><\/p>/);
  assert.match(page, /<span class="badge ok"><i aria-hidden="true"><\/i>On schedule<\/span>/);
  assert.match(page, /Week 3 of 6/);
  assert.match(page, /Show you the booking form/, "what we do next is on the page");

  const behind = renderClientPage({ lang: "en", company: { name: "C" }, now, updates: update([["Design", "half", "2026-10-20"], ["Launch", "todo", "2026-11-14"]]) });
  assert.match(behind, /Running a little late/, "a step past its date says so");

  const persian = renderClientPage({ lang: "fa", company: { name: "C" }, now, updates: update(steps) });
  assert.match(persian, /<b>۲۲<\/b>/, "Persian digits");
  assert.match(persian, /طبق برنامه/);

  const undated = renderClientPage({ lang: "en", company: { name: "C" }, now, updates: update([["Design", "done"], ["Build", "half"]]) });
  assert.match(undated, /<h1 class="big-line">We&#39;re working on Build\.<\/h1>/, "no dates: the sentence leads instead");
});

test("something of theirs that is late comes first, and what is due today is on today", () => {
  const now = new Date("2026-10-21T09:00:00Z");
  const html = renderClientPage({
    lang: "en", company: { name: "C" }, now,
    updates: [{ language: "en", publishedAt: "2026-10-13T06:00:00Z", payload: { weekOf: "2026-10-11", need: [["Clinic photos", "Dr. Weber", "2026-10-20"], ["Domain invite", "Office", "2026-10-21"]] } }]
  });
  assert.match(html, /<div class="late-card">/);
  assert.match(html, /Was due Tue 20 Oct/);
  assert.match(html, /1 thing late/);
  const today = html.slice(html.indexOf('id="dp0"'), html.indexOf('id="dp1"'));
  assert.match(today, /Send: Domain invite/, "due today sits on today");
  assert.equal(today.includes("Clinic photos"), false, "the late one is not repeated on today");
});

test("no middle dot sits beside Persian digits, where it would read as a zero", () => {
  const html = renderClientPage({
    lang: "fa", company: { name: "کلینیک" }, now: new Date("2026-10-21T09:00:00Z"),
    projects: [{ name: "سایت", status: "active", health: "on_track", milestone: "نسخهٔ اول", milestoneDueOn: "2026-10-25" }],
    questionnaires: [{ id: "q-1", title: "شروع", language: "fa", status: "open", progress: { total: 12, answered: 3, needed: 2, neededAnswered: 1 } }],
    updates: [{ language: "fa", publishedAt: "2026-10-13T06:00:00Z", payload: { weekOf: "2026-10-11", nextStep: "نمایش", nextDate: "2026-10-24", need: [["عکس‌ها", "", "2026-10-20"], ["دامنه", "", "2026-10-25"]], pieces: [["طراحی", "done", "2026-10-15"], ["ساخت", "half", "2026-11-01"]] } }]
  });
  const text = html.slice(html.indexOf("<body")).replace(/<[^>]+>/g, " ");
  assert.equal(/[۰-۹]\s*·|·\s*[۰-۹]/.test(text), false);
  assert.match(html, /۱ کار عقب افتاده/);
});

test("days are counted where the owner works", () => {
  const page = (now) => renderClientPage({ lang: "en", company: { name: "C" }, now, timeZone: "Europe/Istanbul", updates: [{ language: "en", publishedAt: "2026-10-01T06:00:00Z", payload: { weekOf: "2026-09-27", moved: "x", pieces: [["Build", "half", "2026-10-20"]] } }] });
  // 22:30 UTC on the 7th is already the 8th in Istanbul.
  assert.match(page(new Date("2026-10-07T22:30:00Z")), /Today, Thu 8 Oct/);
  assert.match(page(new Date("2026-10-07T20:30:00Z")), /Today, Wed 7 Oct/);
});

test("without dates, the opening says what we are on", () => {
  const steps = (pieces) => [{ language: "en", publishedAt: "2026-10-13T08:00:00Z", payload: { weekOf: "2026-10-11", pieces } }];
  const lineOf = (options) => renderClientPage({ lang: "en", company: { name: "C" }, now: new Date("2026-10-14T09:00:00Z"), ...options }).match(/<h1 class="big[^"]*">([^]*?)<\/h1>/)[1];
  assert.equal(lineOf({ updates: steps([["Design", "done"], ["Build", "half"], ["Launch", "todo"]]) }), "We&#39;re working on Build.");
  assert.equal(lineOf({ updates: steps([["Design", "done"], ["Content", "waiting"], ["Launch", "todo"]]) }), "Content is waiting on you.");
  assert.equal(lineOf({ updates: steps([["Design", "done"], ["Build", "todo"]]) }), "Up next: Build.");
  assert.equal(lineOf({ updates: steps([["Design", "done"], ["Build", "done"]]) }), "Your project is live.");
  assert.equal(lineOf({ updates: [] }), "This is your project page.", "a new client is welcomed, not shown a zero");
});

test("the company name is only ever text", () => {
  const html = renderClientPage({ lang: "en", company: { name: "<b>x</b>" } });
  assert.match(html, /<p class="kicker"><span dir="auto">&lt;b&gt;x&lt;\/b&gt;<\/span>/);
});

/* --------------------------------------------------------- the build map --- */

test("an update keeps only pieces with a name and a known state", () => {
  const { payload } = buildUpdateSnapshot({ ...UPDATE_VALUES, pieces: [["Home", "done"], ["Booking", "nearly"], ["", "done"], "junk", ["Photos", "waiting"], ...Array.from({ length: 30 }, (_, i) => [`P${i}`, "todo"])] });
  assert.deepEqual(payload.pieces.slice(0, 2), [["Home", "done", "", "", ""], ["Photos", "waiting", "", "", ""]]);
  const dated = buildUpdateSnapshot({ ...UPDATE_VALUES, pieces: [["Build", "half", "2026-10-30", "https://preview.example.com/x", "2026-10-10"], ["Test", "todo", "2026-02-31", "javascript:alert(1)", "2026-02-30"], ["Ship", "todo", "soon", "https://x.example/\"onmouseover=1", "soon"]] });
  assert.deepEqual(dated.payload.pieces, [["Build", "half", "2026-10-30", "https://preview.example.com/x", "2026-10-10"], ["Test", "todo", "", "", ""], ["Ship", "todo", "", "", ""]], "only real days and plain web links survive");
  assert.ok(payload.pieces.length <= 24);
});

test("the plan draws each step on the weeks, today, and opens a step's details without a script", () => {
  const week = (pieces, at) => ({ language: "en", publishedAt: at, payload: { weekOf: at.slice(0, 10), moved: "x", pieces } });
  const updates = [
    week([["Home", "done", "2026-10-08"], ["Booking", "done", "", "https://preview.example.com/booking"], ["About", "half", "2026-10-30", "", "2026-10-10"], ["Contact", "todo", "2026-11-03"], ["<b>Photos</b>", "waiting"], ["Launch", "todo", "2026-11-14"]], "2026-10-20T08:00:00Z"),
    week([["Home", "done"], ["Booking", "half"]], "2026-10-13T08:00:00Z"),
    week([["Home", "done"]], "2026-10-06T08:00:00Z")
  ];
  const html = renderClientPage({ lang: "en", company: { name: "C" }, updates, now: new Date("2026-10-23T09:00:00Z") });
  assert.equal(html.includes("<script"), false, "still no script");
  assert.match(html, /<input class="sr" type="radio" name="step" id="st2" checked>/, "the step we are on is open first");
  assert.match(html, /<label for="st2" class="row half[^"]*"/);
  assert.match(html, /<label for="st4" class="row waiting[^"]*"[^>]*><span class="row-in"[^>]*><span class="row-name" dir="auto">&lt;b&gt;Photos&lt;\/b&gt;/, "desktop timeline names are text");
  assert.match(html, /#st2:checked~\.details #d2\{display:grid\}/, "tapping a step shows its details, in CSS");
  assert.match(html, /<div class="detail" id="d1">[^]*?Done 20 Oct[^]*?<a class="look" href="https:\/\/preview\.example\.com\/booking"/, "done on the day the first update showed it done, with its link");
  assert.match(html, /<div class="detail" id="d2">[^]*?Sat 10 Oct – Fri 30 Oct/, "an explicit start date preserves overlapping work instead of chaining every phase");
  assert.match(html, /<div class="plan-scroll" dir="ltr" tabindex="0" role="region" aria-label="Scrollable project timeline">/, "the English timeline is keyboard reachable and left-to-right");
  assert.match(html, /\.plan-scroll\{[^}]*overflow-x:auto[^}]*touch-action:pan-x pan-y[^}]*\}/, "the full timeline scrolls horizontally");
  assert.match(html, /@media \(max-width:63\.99rem\)\{[^]*?\.plan-scroll \.chart\{width:58rem;min-width:58rem/, "phone and tablet keep the real chart at a readable width instead of crushing it");
  assert.equal(html.includes("mobile-timeline"), false, "small screens use the same timeline rather than a second representation");
  assert.match(html, /\.row-name\{position:absolute;[^}]*inset-inline-start:0;[^}]*text-overflow:ellipsis[^}]*\}\s*\.row\.end \.row-name\{inset-inline-start:auto;inset-inline-end:0\}/, "edge phase labels anchor inward instead of overflowing the timeline");
  assert.match(html, /company-wordmark-light\.svg[^]*company-wordmark\.svg/, "the exact Your company light and dark lockups replace the drawn approximation");
  assert.match(html, /<i class="today"/);
  assert.match(html, /mascot rider build/);
  assert.match(html, /<b>22<\/b>/, "22 days to the last step");

  const persian = renderClientPage({ lang: "fa", company: { name: "C" }, updates: updates.map((update) => ({ ...update, language: "fa" })), now: new Date("2026-10-23T09:00:00Z") });
  assert.match(persian, /<div class="plan-scroll" dir="rtl" tabindex="0" role="region" aria-label="برنامهٔ زمانی پروژه">/, "the Persian timeline starts from today on the right");
  assert.match(persian, /برنامه/);
  assert.match(persian, /<b>۲۲<\/b>/);

  const atStart = renderClientPage({ lang: "fa", company: { name: "C" }, updates: [week([["شروع", "half", "2026-11-06"]], "2026-10-23T08:00:00Z")], now: new Date("2026-10-23T09:00:00Z") });
  assert.match(atStart, /<i class="today" style="inset-inline-start:2\.50%"/, "today is pulled inside the edge so its marker and label are not clipped on phones");

  const none = renderClientPage({ lang: "en", company: { name: "C" }, updates: [week([], "2026-10-13T08:00:00Z")] });
  assert.equal(none.includes('class="card plan"'), false, "no steps, no plan");
});

test("the calendar file holds each dated thing on its own day, and says whose it is", () => {
  const ics = renderClientCalendar({
    lang: "en",
    company: { name: "Sample Studio" },
    now: new Date("2026-10-23T09:00:00Z"),
    updates: [{ language: "en", publishedAt: "2026-10-23T06:00:00Z", payload: { weekOf: "2026-10-23", moved: "x", nextStep: "Show you the booking form", nextDate: "2026-10-27", need: [["Logo; vector", "", "2026-10-28"]], pieces: [["Build", "half", "2026-10-30"], ["Launch", "todo", "2026-11-14"]] } }]
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261027\r\nDTEND;VALUE=DATE:20261028\r\nSUMMARY:Us: Show you the booking form/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261028\r\nDTEND;VALUE=DATE:20261029\r\nSUMMARY:You: Send: Logo\\; vector/, "the day as written, and a semicolon escaped");
  assert.match(ics, /DTSTART;VALUE=DATE:20261114\r\nDTEND;VALUE=DATE:20261115\r\nSUMMARY:Us: Launch: it goes live/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});
