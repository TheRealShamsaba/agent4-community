import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyseSeo, auditSeo, checkSite, createMonitorRunner, probeCertificate } from "../src/monitor-runner.js";
import { createMonitorStore } from "../src/monitor-store.js";

const GOOD_PAGE = `<!doctype html><html lang="en"><head>
<title>Sample Studio: natural supplements made in Turkey</title>
<meta name="description" content="Sample Studio makes natural-source supplements. Read about our ingredients, how we test every batch, and where to buy them near you.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://studio.example.com/">
<meta property="og:title" content="Sample Studio"><meta property="og:image" content="/og.png">
</head><body><h1>Natural supplements</h1><img src="/a.png" alt="A jar"></body></html>`;

function reply(status, body = "", headers = {}) {
  return new globalThis.Response(body, { status, headers });
}

test("a healthy, well-made page scores 100, and each missing basic costs points with a fix attached", () => {
  const good = analyseSeo({ url: "https://studio.example.com/", html: GOOD_PAGE, robotsTxt: "User-agent: *\nAllow: /", sitemapOk: true, httpsEnforced: true, responseMs: 300 });
  assert.equal(good.score, 100);
  assert.deepEqual(good.issues, []);

  const bare = analyseSeo({ url: "https://x.example/", html: "<html><body><p>hi</p><img src=a.png></body></html>", robotsTxt: null, sitemapOk: false, httpsEnforced: false, responseMs: 2500 });
  const ids = bare.issues.map((issue) => issue.id);
  for (const id of ["title-missing", "description-missing", "h1-missing", "viewport", "alt", "robots-missing", "sitemap", "https", "slow"]) assert.ok(ids.includes(id), id);
  assert.ok(bare.score < 40);
  assert.equal(bare.issues[0].severity, "high", "the worst problems come first");
  assert.ok(bare.issues.every((issue) => issue.detail));
});

test("noindex and a site-wide robots block are the two loudest problems", () => {
  const hidden = analyseSeo({ url: "https://x.example/", html: GOOD_PAGE.replace("<head>", '<head><meta name="robots" content="noindex">'), robotsTxt: "User-agent: *\nDisallow: /", sitemapOk: true, httpsEnforced: true, responseMs: 100 });
  assert.deepEqual(hidden.issues.map((issue) => issue.id).sort(), ["noindex", "robots-blocks"]);
  assert.equal(hidden.score, 50);
});

test("an uptime check reports status and time, treats 4xx and 5xx as down, and never follows a redirect into a private address", async () => {
  const up = await checkSite({ url: "https://example.com/" }, { fetchImpl: async () => reply(200), certificate: async () => 61 });
  assert.equal(up.ok, true);
  assert.equal(up.status, 200);
  assert.equal(up.sslDays, 61);

  const broken = await checkSite({ url: "https://example.com/" }, { fetchImpl: async () => reply(503), certificate: async () => 61 });
  assert.equal(broken.ok, false);
  assert.equal(broken.error, "HTTP 503");

  const unreachable = await checkSite({ url: "https://example.com/" }, { fetchImpl: async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }); } });
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.error, "ECONNREFUSED");

  const sneaky = await checkSite({ url: "https://example.com/" }, { fetchImpl: async () => reply(302, "", { location: "http://127.0.0.1:8782/data/hq.html" }), certificate: async () => 1 });
  assert.equal(sneaky.ok, false, "a redirect to this machine is refused");
});

test("the SEO audit reads the page, robots.txt, sitemap and the http redirect", async () => {
  const seen = [];
  const report = await auditSeo({ url: "https://example.com/" }, {
    fetchImpl: async (url) => {
      seen.push(url);
      if (url === "https://example.com/") return reply(200, GOOD_PAGE);
      if (url.endsWith("/robots.txt")) return reply(200, "User-agent: *\nAllow: /");
      if (url.endsWith("/sitemap.xml")) return reply(200, '<?xml version="1.0"?><urlset></urlset>');
      if (url === "http://example.com/") return reply(301, "", { location: "https://example.com/" });
      return reply(404);
    }
  });
  assert.equal(report.facts.sitemap, true);
  assert.equal(report.facts.httpsEnforced, true);
  assert.equal(report.facts.robotsTxt, true);
  assert.ok(report.score >= 95, `score was ${report.score}`);
  assert.equal(seen.filter(address => new URL(address).origin === "http://example.com").length, 1);
});

async function withRunner(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent4-runner-"));
  const clock = { ms: Date.parse("2026-10-24T10:00:00Z") };
  const store = createMonitorStore(path.join(root, "hq.sqlite"), { now: () => new Date(clock.ms) });
  t.after(() => store.close());
  const sent = [];
  const runner = createMonitorRunner({ store, notify: async (message) => { sent.push(message); }, now: () => clock.ms, audit: async () => ({ score: 88, issues: [], facts: {} }), ...overrides });
  return { store, runner, sent, clock };
}

test("a site that goes down is announced once, a recovery once, and a healthy site says nothing", async (t) => {
  const outcomes = [];
  const { store, runner, sent, clock } = await withRunner(t, { check: async () => outcomes.shift() });
  const site = store.addSite({ name: "Sample Studio", url: "https://studio.example.com" });
  outcomes.push({ ok: true, status: 200, ms: 200, sslDays: 90 });
  await runner.tick();
  assert.deepEqual(sent, [], "a healthy site is silent");
  assert.equal(store.readSeo(site.id).score, 88, "the first tick also audits SEO");

  for (const [minutes, outcome] of [[6, { ok: false, error: "ECONNREFUSED" }], [12, { ok: false, error: "ECONNREFUSED" }], [18, { ok: false, error: "ECONNREFUSED" }]]) {
    clock.ms = Date.parse("2026-10-24T10:00:00Z") + minutes * 60_000;
    outcomes.push(outcome);
    await runner.tick();
  }
  assert.equal(sent.length, 1, "down is announced exactly once");
  assert.match(sent[0], /Sample Studio is down/);
  assert.match(sent[0], /ECONNREFUSED/);

  clock.ms += 6 * 60_000;
  outcomes.push({ ok: true, status: 200, ms: 250, sslDays: 90 });
  await runner.tick();
  assert.equal(sent.length, 2);
  assert.match(sent[1], /back up after 12 min/, "counted from the second failure, when it was called down");
});

test("a certificate close to expiry is flagged once, and new browser errors at most once an hour", async (t) => {
  const { store, runner, sent, clock } = await withRunner(t, { check: async () => ({ ok: true, status: 200, ms: 100, sslDays: 9 }) });
  const site = store.addSite({ name: "Shop", url: "https://shop.example.com" });
  await runner.tick();
  assert.equal(sent.filter((message) => /certificate expires in 9 days/.test(message)).length, 1);
  clock.ms += 6 * 60_000;
  await runner.tick();
  assert.equal(sent.filter((message) => /certificate/.test(message)).length, 1, "not repeated within three days");

  clock.ms += 30_000;
  store.recordError(site.id, { message: "Cannot read properties of undefined", source: "cart.js", line: 4, page: "/cart" });
  clock.ms += 5.5 * 60_000;
  await runner.tick();
  const errorAlerts = () => sent.filter((message) => /new error/.test(message));
  assert.equal(errorAlerts().length, 1);
  clock.ms += 30_000;
  store.recordError(site.id, { message: "Another one", source: "cart.js", line: 9, page: "/cart" });
  clock.ms += 5.5 * 60_000;
  await runner.tick();
  assert.equal(errorAlerts().length, 1, "an hour's cooldown");
});

test("a paused site is not checked", async (t) => {
  let calls = 0;
  const { store, runner } = await withRunner(t, { check: async () => { calls += 1; return { ok: true, status: 200, ms: 1 }; } });
  const site = store.addSite({ url: "https://paused.example.com" });
  store.updateSite(site.id, { paused: true });
  await runner.tick();
  assert.equal(calls, 0);
});

test('certificate checks never connect to loopback or mapped private addresses', async () => {
  for (const address of ['127.0.0.1','::1','::ffff:127.0.0.1','169.254.169.254']) assert.equal(await probeCertificate(address), null);
});
