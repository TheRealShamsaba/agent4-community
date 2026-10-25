import * as cheerio from "cheerio";
import { clearInterval, setInterval } from "node:timers";
import { connect } from "node:tls";
import { lookup } from "node:dns/promises";
import robotsParser from "robots-parser";
import { assertPublicUrl, fetchWithTimeout, isPrivateIp, mapLimit } from "./util.js";

/* The checking half of site monitoring: is it up, is the certificate about to
   lapse, and does the page do the basics search engines look for. Everything
   it fetches is public, goes through the same private-address guard as the
   prospect audits, and is read-only. */

const USER_AGENT = "Agent4-Monitor/1.0 (+uptime check for the site owner)";
const CHECK_TIMEOUT_MS = 10_000;
const MAX_HOPS = 5;
const MAX_BYTES = 3_000_000;
const MINUTE = 60_000;

async function followRedirects(startUrl, { fetchImpl, timeoutMs, accept = "text/html,*/*;q=0.5" }) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    await assertPublicUrl(url);
    const response = await fetchImpl(url, { redirect: "manual", headers: { "user-agent": USER_AGENT, accept } }, timeoutMs);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    return { response, finalUrl: url };
  }
  throw new Error("Too many redirects.");
}

async function readBody(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) { await response.body?.cancel(); throw new Error('Page exceeds the monitoring size limit.'); }
  const chunks = []; let bytes = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('Page exceeds the monitoring size limit.'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes };
}

/** Days until the certificate on this host expires, or null when it cannot be read. */
export async function probeCertificate(hostname, { timeoutMs = 5000 } = {}) {
  let addresses;
  try {
    addresses = await lookup(hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true });
    if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) return null;
  } catch { return null; }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const socket = connect({ host: addresses[0].address, port: 443, servername: hostname, timeout: timeoutMs }, () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      const expires = certificate?.valid_to ? Date.parse(certificate.valid_to) : NaN;
      finish(Number.isFinite(expires) ? Math.floor((expires - Date.now()) / 86_400_000) : null);
    });
    socket.on("timeout", () => { socket.destroy(); finish(null); });
    socket.on("error", () => finish(null));
  });
}

/** One uptime check: reachable, status, how long it took, certificate days. */
export async function checkSite(site, { fetchImpl = fetchWithTimeout, certificate = probeCertificate } = {}) {
  const started = Date.now();
  try {
    const { response } = await followRedirects(site.url, { fetchImpl, timeoutMs: CHECK_TIMEOUT_MS });
    await response.body?.cancel?.().catch(() => {});
    const ms = Date.now() - started;
    const sslDays = new URL(site.url).protocol === "https:" ? await certificate(new URL(site.url).hostname) : null;
    const ok = response.status < 400;
    return { ok, status: response.status, ms, sslDays, error: ok ? null : `HTTP ${response.status}` };
  } catch (error) {
    const message = error?.name === "TimeoutError" || /abort|timed? ?out/i.test(String(error?.message)) ? "Timed out after 10 seconds" : String(error?.cause?.code || error?.message || "Could not connect");
    return { ok: false, status: null, ms: Date.now() - started, sslDays: null, error: message };
  }
}

/* ----------------------------------------------------------------- SEO --- */

function check(issues, id, failed, severity, points, title, detail) {
  if (failed) issues.push({ id, severity, points, title, detail });
}

/** The page-level facts and the basics a search engine looks for. */
export function analyseSeo({ url, html, headers = {}, robotsTxt = null, sitemapOk = false, httpsEnforced = null, responseMs = null }) {
  const $ = cheerio.load(html || "");
  const title = $("head title").first().text().replace(/\s+/g, " ").trim();
  const description = ($('meta[name="description"]').attr("content") || "").replace(/\s+/g, " ").trim();
  const h1s = $("h1").length;
  const canonical = $('link[rel="canonical"]').attr("href") || "";
  const lang = $("html").attr("lang") || "";
  const viewport = $('meta[name="viewport"]').attr("content") || "";
  const robotsMeta = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  const images = $("img").toArray();
  const missingAlt = images.filter((image) => !($(image).attr("alt") ?? "").trim() && $(image).attr("role") !== "presentation").length;
  const weightKb = Math.round(Buffer.byteLength(html || "") / 1024);
  let disallowsAll = false;
  if (robotsTxt) {
    try {
      const parser = robotsParser(new URL("/robots.txt", url).toString(), robotsTxt);
      disallowsAll = parser.isAllowed(new URL("/", url).toString(), "*") === false;
    } catch { /* an unreadable robots file is treated as absent */ }
  }
  const issues = [];
  check(issues, "title-missing", !title, "high", 15, "The page has no title", "Add a <title>. It is the headline in search results.");
  check(issues, "title-length", title && (title.length < 15 || title.length > 60), "low", 4, `The title is ${title.length} characters`, "Aim for 15 to 60 so it is not cut off in search results.");
  check(issues, "description-missing", !description, "high", 10, "No meta description", "Write a one-sentence summary for search results, 70 to 160 characters.");
  check(issues, "description-length", description && (description.length < 70 || description.length > 160), "low", 3, `The description is ${description.length} characters`, "Aim for 70 to 160 characters.");
  check(issues, "h1-missing", h1s === 0, "medium", 8, "No main heading (h1)", "Give the page one h1 that says what it is about.");
  check(issues, "h1-many", h1s > 1, "low", 3, `${h1s} main headings`, "Use a single h1 per page.");
  check(issues, "noindex", /noindex/.test(robotsMeta) || /noindex/i.test(headers["x-robots-tag"] || ""), "high", 25, "The page tells search engines to ignore it", "Remove noindex unless the page is meant to stay private.");
  check(issues, "viewport", !viewport, "high", 10, "Not set up for phones", "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.");
  check(issues, "canonical", !canonical, "low", 3, "No canonical link", "Add a canonical link so duplicates do not compete.");
  check(issues, "lang", !lang, "low", 3, "No language set", "Add lang=\"en\" (or fa) to the <html> tag.");
  check(issues, "social", !ogTitle || !ogImage, "low", 3, "No social preview", "Add og:title and og:image so links look right when shared.");
  check(issues, "alt", missingAlt > 0, "medium", Math.min(8, missingAlt), `${missingAlt} ${missingAlt === 1 ? "image has" : "images have"} no alt text`, "Describe each image. It helps search and screen readers.");
  check(issues, "robots-missing", robotsTxt === null, "low", 3, "No robots.txt", "Add a robots.txt, even a minimal one.");
  check(issues, "robots-blocks", disallowsAll, "high", 25, "robots.txt blocks the whole site", "Remove Disallow: / unless the site is meant to be hidden.");
  check(issues, "sitemap", !sitemapOk, "medium", 5, "No sitemap.xml", "Publish a sitemap so search engines find every page.");
  check(issues, "weight", weightKb > 2048, "medium", 5, `The page is ${weightKb} KB of HTML`, "Trim inline scripts and styles.");
  check(issues, "https", httpsEnforced === false, "medium", 8, "Plain http does not redirect to https", "Redirect http to https so visitors and search engines land on the secure page.");
  check(issues, "slow", responseMs != null && responseMs > 1500, "medium", 5, `Slow to respond (${responseMs} ms)`, "Aim for under a second. Check hosting, caching and heavy server work.");
  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + issue.points, 0));
  issues.sort((left, right) => ({ high: 0, medium: 1, low: 2 })[left.severity] - ({ high: 0, medium: 1, low: 2 })[right.severity] || right.points - left.points);
  return { score, issues, facts: { title, description, h1s, canonical, lang, viewport: Boolean(viewport), ogImage: Boolean(ogImage), images: images.length, missingAlt, weightKb, robotsTxt: robotsTxt !== null, sitemap: sitemapOk, httpsEnforced } };
}

/** Fetch the page and its neighbours and score them. */
export async function auditSeo(site, { fetchImpl = fetchWithTimeout } = {}) {
  const started = Date.now();
  const { response, finalUrl } = await followRedirects(site.url, { fetchImpl, timeoutMs: CHECK_TIMEOUT_MS });
  const responseMs = Date.now() - started;
  const headers = Object.fromEntries(response.headers.entries());
  const { text: html } = await readBody(response);
  const origin = new URL(finalUrl).origin;
  const optional = async (pathname) => {
    try {
      const { response: neighbour } = await followRedirects(`${origin}${pathname}`, { fetchImpl, timeoutMs: 6000, accept: "text/plain,application/xml,*/*;q=0.5" });
      if (neighbour.status >= 400) { await neighbour.body?.cancel?.().catch(() => {}); return null; }
      return (await readBody(neighbour)).text;
    } catch { return null; }
  };
  const robotsTxt = await optional("/robots.txt");
  const sitemap = await optional("/sitemap.xml");
  let httpsEnforced = null;
  if (new URL(site.url).protocol === "https:") {
    try {
      const plain = new URL(site.url);
      plain.protocol = "http:";
      const { finalUrl: landed, response: plainResponse } = await followRedirects(plain.toString(), { fetchImpl, timeoutMs: 6000 });
      await plainResponse.body?.cancel?.().catch(() => {});
      httpsEnforced = new URL(landed).protocol === "https:";
    } catch { httpsEnforced = null; }
  }
  return analyseSeo({ url: finalUrl, html, headers, robotsTxt, sitemapOk: Boolean(sitemap && /<(urlset|sitemapindex)/i.test(sitemap)), httpsEnforced, responseMs });
}

/* -------------------------------------------------------------- the loop --- */

/**
 * Run the checks on a schedule and tell the owner only what matters: a site
 * that went down, one that came back, a certificate about to lapse, a burst of
 * new errors. A healthy site never sends anything.
 */
export function createMonitorRunner({ store, notify = async () => {}, check: runCheck = checkSite, audit = auditSeo, checkEveryMs = 5 * MINUTE, seoEveryMs = 24 * 60 * MINUTE, now = () => Date.now() }) {
  let timer = null;
  let busy = false;

  async function say(message) {
    try { await notify(message); } catch (error) { console.error(`Monitor alert could not be delivered: ${error.message}`); }
  }

  async function checkOne(site) {
    // Errors count as new if they first appeared since the previous check.
    const previousCheck = store.lastCheckAt(site.id);
    const result = await runCheck(site);
    const transition = store.recordCheck(site.id, result);
    if (transition?.type === "down") await say(`🔴 ${site.name} is down\n${transition.error}\n${site.url}`);
    if (transition?.type === "recovered") {
      const minutes = transition.downSince ? Math.max(1, Math.round((now() - Date.parse(transition.downSince)) / MINUTE)) : null;
      await say(`🟢 ${site.name} is back up${minutes ? ` after ${minutes} min` : ""}`);
    }
    if (result.sslDays != null) {
      if (result.sslDays <= 14 && store.claimAlert(site.id, "ssl", 3 * 24 * 60 * MINUTE)) {
        await say(`🔒 ${site.name}'s certificate ${result.sslDays <= 0 ? "has expired" : `expires in ${result.sslDays} day${result.sslDays === 1 ? "" : "s"}`}\n${site.url}`);
      } else if (result.sslDays > 30) {
        store.clearAlert(site.id, "ssl");
      }
    }
    const fresh = store.newErrorsSince(site.id, previousCheck || new Date(now() - checkEveryMs).toISOString());
    if (fresh.length && store.claimAlert(site.id, "error", 60 * MINUTE)) {
      await say(`⚠️ ${site.name} is throwing ${fresh.length === 1 ? "a new error" : `${fresh.length} new errors`}\n“${fresh[0].slice(0, 160)}”`);
    }
    return result;
  }

  async function seoOne(site) {
    try {
      store.saveSeo(site.id, await audit(site));
    } catch (error) {
      console.error(`SEO check for ${site.url} failed: ${error.message}`);
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const sites = store.listSites().filter((site) => !site.paused);
      await mapLimit(sites, 3, async (site) => {
        const last = store.lastCheckAt(site.id);
        if (!last || now() - Date.parse(last) >= checkEveryMs) await checkOne(site);
        const seo = store.readSeo(site.id);
        if (!seo || now() - Date.parse(seo.at) >= seoEveryMs) await seoOne(site);
      });
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    async checkNow(siteId) {
      const site = store.getSite(siteId);
      if (!site) throw new Error("That site no longer exists.");
      const result = await checkOne(site);
      await seoOne(site);
      return result;
    },
    start(tickMs = MINUTE) {
      if (timer) return;
      timer = setInterval(() => { void tick().catch((error) => console.error(`Monitor tick failed: ${error.message}`)); }, tickMs);
      timer.unref?.();
      void tick().catch((error) => console.error(`Monitor tick failed: ${error.message}`));
    },
    stop() { if (timer) clearInterval(timer); timer = null; }
  };
}
