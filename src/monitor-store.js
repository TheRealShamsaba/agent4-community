import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* What is known about the sites you have built: whether each one is up, how
   fast, what its SEO looks like, who visits and what breaks. Visitors are
   counted, never identified: a visitor is a hash that changes every day, and
   nothing here can say who anybody was. */

const DAY = 86_400_000;
const CHECK_RETENTION_DAYS = 35;
const ERROR_RETENTION_DAYS = 60;
const MAX_PATHS_PER_DAY = 200;

function text(value, limit = 300) {
  return String(value ?? "").trim().slice(0, limit);
}

function dayOf(date) {
  return date.toISOString().slice(0, 10);
}

/** A site address, reduced to one public http(s) page with no credentials. */
export function normalizeSiteUrl(input) {
  const raw = text(input, 500);
  assert(raw, "Give the site's address.");
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  assert(["http:", "https:"].includes(url.protocol), "Use an http or https address.");
  assert(url.hostname.includes("."), "That does not look like a public address.");
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString();
}

function siteFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    host: new URL(row.url).hostname,
    token: row.token,
    companyId: row.company_id || null,
    companyName: row.company_name || "",
    paused: row.paused === 1,
    status: row.status || "unknown",
    downSince: row.down_since || null,
    createdAt: row.created_at
  };
}

export function createMonitorStore(databasePath, { now = () => new Date() } = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_monitor_sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      company_id TEXT,
      company_name TEXT,
      paused INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unknown',
      down_since TEXT,
      failures INTEGER NOT NULL DEFAULT 0,
      ssl_alerted_at TEXT,
      error_alerted_at TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent4_monitor_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL,
      at TEXT NOT NULL,
      ok INTEGER NOT NULL,
      status INTEGER,
      ms INTEGER,
      ssl_days INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS agent4_monitor_checks_site ON agent4_monitor_checks(site_id, at DESC);
    CREATE TABLE IF NOT EXISTS agent4_monitor_seo (
      site_id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      score INTEGER NOT NULL,
      issues TEXT NOT NULL,
      facts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent4_monitor_days (
      site_id TEXT NOT NULL,
      day TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      visitors INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, day)
    );
    CREATE TABLE IF NOT EXISTS agent4_monitor_visitors (
      site_id TEXT NOT NULL,
      day TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (site_id, day, hash)
    );
    CREATE TABLE IF NOT EXISTS agent4_monitor_pages (
      site_id TEXT NOT NULL,
      day TEXT NOT NULL,
      path TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, day, path)
    );
    CREATE TABLE IF NOT EXISTS agent4_monitor_errors (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT,
      line INTEGER,
      page TEXT,
      count INTEGER NOT NULL DEFAULT 1,
      first_at TEXT NOT NULL,
      last_at TEXT NOT NULL,
      UNIQUE (site_id, fingerprint)
    );
    CREATE TABLE IF NOT EXISTS agent4_monitor_rejects (
      site_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      host TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      last_at TEXT NOT NULL,
      PRIMARY KEY (site_id, reason, host)
    );
    CREATE TABLE IF NOT EXISTS agent4_monitor_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  const selectSite = database.prepare("SELECT * FROM agent4_monitor_sites WHERE id = ?");
  const selectByToken = database.prepare("SELECT * FROM agent4_monitor_sites WHERE token = ?");

  /* One secret for the life of the database; the day is mixed in, so the same
     person is a different, unlinkable hash tomorrow. */
  function salt() {
    const row = database.prepare("SELECT value FROM agent4_monitor_meta WHERE key = 'salt'").get();
    if (row) return row.value;
    const value = randomBytes(24).toString("hex");
    database.prepare("INSERT INTO agent4_monitor_meta (key, value) VALUES ('salt', ?)").run(value);
    return value;
  }

  function addSite(input = {}) {
    const url = normalizeSiteUrl(input.url);
    const name = text(input.name, 120) || new URL(url).hostname.replace(/^www\./, "");
    const clash = database.prepare("SELECT id FROM agent4_monitor_sites WHERE url = ?").get(url);
    assert(!clash, "That site is already being watched.");
    const id = randomUUID();
    database.prepare(`
      INSERT INTO agent4_monitor_sites (id,name,url,token,company_id,company_name,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, name, url, randomBytes(9).toString("hex"), text(input.companyId, 140) || null, text(input.companyName, 180) || null, now().toISOString(), text(input.actorId, 140) || "unknown");
    return siteFrom(selectSite.get(id));
  }

  function updateSite(id, updates = {}) {
    const existing = selectSite.get(text(id, 80));
    assert(existing, "That site no longer exists.");
    const url = updates.url === undefined ? existing.url : normalizeSiteUrl(updates.url);
    database.prepare("UPDATE agent4_monitor_sites SET name=?, url=?, company_id=?, company_name=?, paused=? WHERE id=?").run(
      updates.name === undefined ? existing.name : text(updates.name, 120) || existing.name,
      url,
      updates.companyId === undefined ? existing.company_id : text(updates.companyId, 140) || null,
      updates.companyName === undefined ? existing.company_name : text(updates.companyName, 180) || null,
      updates.paused === undefined ? existing.paused : updates.paused === true ? 1 : 0,
      existing.id
    );
    return siteFrom(selectSite.get(existing.id));
  }

  function removeSite(id) {
    const existing = selectSite.get(text(id, 80));
    if (!existing) return false;
    for (const table of ["checks", "seo", "days", "visitors", "pages", "errors", "rejects"]) {
      database.prepare(`DELETE FROM agent4_monitor_${table} WHERE site_id = ?`).run(existing.id);
    }
    database.prepare("DELETE FROM agent4_monitor_sites WHERE id = ?").run(existing.id);
    return true;
  }

  const getSite = (id) => siteFrom(selectSite.get(text(id, 80)));
  const siteByToken = (token) => siteFrom(selectByToken.get(text(token, 40)));
  const listSites = () => database.prepare("SELECT * FROM agent4_monitor_sites ORDER BY name COLLATE NOCASE").all().map(siteFrom);

  /* ------------------------------------------------------------- checks --- */

  /**
   * Record one uptime check and say what it changed. A site is only called
   * down after two failures in a row, so one dropped packet never wakes anyone.
   */
  function recordCheck(siteId, result) {
    const site = selectSite.get(siteId);
    assert(site, "That site no longer exists.");
    const at = (result.at || now()).toISOString();
    database.prepare("INSERT INTO agent4_monitor_checks (site_id,at,ok,status,ms,ssl_days,error) VALUES (?,?,?,?,?,?,?)")
      .run(siteId, at, result.ok ? 1 : 0, result.status ?? null, result.ms ?? null, result.sslDays ?? null, result.ok ? null : text(result.error, 300) || `HTTP ${result.status}`);
    const failures = result.ok ? 0 : site.failures + 1;
    let status = site.status;
    let downSince = site.down_since;
    let transition = null;
    if (result.ok) {
      if (site.status === "down") {
        transition = { type: "recovered", downSince: site.down_since };
      }
      status = "up";
      downSince = null;
    } else if (failures >= 2 && site.status !== "down") {
      status = "down";
      downSince = at;
      transition = { type: "down", error: text(result.error, 300) || `HTTP ${result.status}` };
    }
    database.prepare("UPDATE agent4_monitor_sites SET status=?, down_since=?, failures=? WHERE id=?").run(status, downSince, failures, siteId);
    database.prepare("DELETE FROM agent4_monitor_checks WHERE site_id = ? AND at < ?").run(siteId, new Date(now().getTime() - CHECK_RETENTION_DAYS * DAY).toISOString());
    return transition;
  }

  function lastCheckAt(siteId) {
    return database.prepare("SELECT at FROM agent4_monitor_checks WHERE site_id = ? ORDER BY at DESC LIMIT 1").get(siteId)?.at || null;
  }

  function saveSeo(siteId, report) {
    database.prepare("INSERT INTO agent4_monitor_seo (site_id,at,score,issues,facts) VALUES (?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET at=excluded.at, score=excluded.score, issues=excluded.issues, facts=excluded.facts")
      .run(siteId, now().toISOString(), report.score, JSON.stringify(report.issues || []), JSON.stringify(report.facts || {}));
  }

  function readSeo(siteId) {
    const row = database.prepare("SELECT * FROM agent4_monitor_seo WHERE site_id = ?").get(siteId);
    return row ? { at: row.at, score: row.score, issues: JSON.parse(row.issues), facts: JSON.parse(row.facts) } : null;
  }

  /** Mark an alert as sent, or report that one went out recently enough. */
  function claimAlert(siteId, kind, cooldownMs) {
    const column = kind === "ssl" ? "ssl_alerted_at" : "error_alerted_at";
    const row = selectSite.get(siteId);
    if (!row) return false;
    const last = row[column] ? Date.parse(row[column]) : 0;
    if (now().getTime() - last < cooldownMs) return false;
    database.prepare(`UPDATE agent4_monitor_sites SET ${column} = ? WHERE id = ?`).run(now().toISOString(), siteId);
    return true;
  }

  function clearAlert(siteId, kind) {
    database.prepare(`UPDATE agent4_monitor_sites SET ${kind === "ssl" ? "ssl_alerted_at" : "error_alerted_at"} = NULL WHERE id = ?`).run(siteId);
  }

  /* ------------------------------------------------------------ visitors --- */

  /** Count one page view. The visitor is a daily hash and is stored as nothing else. */
  function recordView(siteId, { path: pagePath, address, agent }) {
    const moment = now();
    const day = dayOf(moment);
    const hash = createHash("sha256").update(`${salt()}|${day}|${siteId}|${address}|${agent}`).digest("hex").slice(0, 24);
    const cleanPath = text(pagePath, 200).split("?")[0].split("#")[0] || "/";
    database.exec("BEGIN");
    try {
      database.prepare("INSERT INTO agent4_monitor_days (site_id,day,views,visitors) VALUES (?,?,0,0) ON CONFLICT DO NOTHING").run(siteId, day);
      const isNew = database.prepare("INSERT INTO agent4_monitor_visitors (site_id,day,hash) VALUES (?,?,?) ON CONFLICT DO NOTHING").run(siteId, day, hash).changes === 1;
      database.prepare("UPDATE agent4_monitor_days SET views = views + 1, visitors = visitors + ? WHERE site_id = ? AND day = ?").run(isNew ? 1 : 0, siteId, day);
      const known = database.prepare("SELECT 1 FROM agent4_monitor_pages WHERE site_id = ? AND day = ? AND path = ?").get(siteId, day, cleanPath);
      const total = database.prepare("SELECT COUNT(*) AS total FROM agent4_monitor_pages WHERE site_id = ? AND day = ?").get(siteId, day).total;
      if (known || total < MAX_PATHS_PER_DAY) {
        database.prepare("INSERT INTO agent4_monitor_pages (site_id,day,path,views) VALUES (?,?,?,1) ON CONFLICT(site_id,day,path) DO UPDATE SET views = views + 1").run(siteId, day, cleanPath);
      }
      database.prepare("DELETE FROM agent4_monitor_visitors WHERE day < ?").run(dayOf(new Date(moment.getTime() - 2 * DAY)));
      database.prepare("DELETE FROM agent4_monitor_pages WHERE day < ?").run(dayOf(new Date(moment.getTime() - 35 * DAY)));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Count a browser error, grouped by what it said and where. */
  function recordError(siteId, { message, source, line, page }) {
    const moment = now().toISOString();
    const cleanMessage = text(message, 300) || "Unknown error";
    const cleanSource = text(source, 300);
    const fingerprint = createHash("sha1").update(`${cleanMessage}|${cleanSource}|${Number(line) || 0}`).digest("hex").slice(0, 16);
    const existing = database.prepare("SELECT id FROM agent4_monitor_errors WHERE site_id = ? AND fingerprint = ?").get(siteId, fingerprint);
    if (existing) {
      database.prepare("UPDATE agent4_monitor_errors SET count = count + 1, last_at = ?, page = ? WHERE id = ?").run(moment, text(page, 200).split("?")[0], existing.id);
      return { created: false };
    }
    const total = database.prepare("SELECT COUNT(*) AS total FROM agent4_monitor_errors WHERE site_id = ?").get(siteId).total;
    if (total >= 200) return { created: false };
    database.prepare("INSERT INTO agent4_monitor_errors (id,site_id,fingerprint,message,source,line,page,first_at,last_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), siteId, fingerprint, cleanMessage, cleanSource, Number.isFinite(Number(line)) ? Number(line) : null, text(page, 200).split("?")[0], moment, moment);
    database.prepare("DELETE FROM agent4_monitor_errors WHERE last_at < ?").run(new Date(now().getTime() - ERROR_RETENTION_DAYS * DAY).toISOString());
    return { created: true };
  }

  /**
   * Remember that a report reached HQ with the right key and was turned away,
   * and from where. Silence is the worst way to fail: it leaves "nothing
   * comes up" with no clue whether the snippet, the address or the visitor
   * is the problem.
   */
  function recordRejected(siteId, { reason, host }) {
    const cleanHost = text(host, 120).toLowerCase() || "unknown";
    const known = database.prepare("SELECT 1 FROM agent4_monitor_rejects WHERE site_id = ? AND reason = ? AND host = ?").get(siteId, reason, cleanHost);
    if (!known && database.prepare("SELECT COUNT(*) AS total FROM agent4_monitor_rejects WHERE site_id = ?").get(siteId).total >= 20) return;
    database.prepare(`
      INSERT INTO agent4_monitor_rejects (site_id,reason,host,count,last_at) VALUES (?,?,?,1,?)
      ON CONFLICT(site_id,reason,host) DO UPDATE SET count = count + 1, last_at = excluded.last_at
    `).run(siteId, text(reason, 20), cleanHost, now().toISOString());
  }

  const removeError = (id) => database.prepare("DELETE FROM agent4_monitor_errors WHERE id = ?").run(text(id, 80)).changes === 1;

  function newErrorsSince(siteId, sinceIso) {
    return database.prepare("SELECT message FROM agent4_monitor_errors WHERE site_id = ? AND first_at >= ? ORDER BY first_at").all(siteId, sinceIso).map((row) => row.message);
  }

  /* ------------------------------------------------------------ read side --- */

  function uptime(siteId, days = 30) {
    const since = new Date(now().getTime() - days * DAY).toISOString();
    const row = database.prepare("SELECT COUNT(*) AS total, SUM(ok) AS good, AVG(CASE WHEN ok = 1 THEN ms END) AS ms FROM agent4_monitor_checks WHERE site_id = ? AND at >= ?").get(siteId, since);
    return { checks: row.total, percent: row.total ? Math.round(((row.good || 0) / row.total) * 1000) / 10 : null, avgMs: row.ms ? Math.round(row.ms) : null };
  }

  function series(siteId, days = 30) {
    const out = [];
    const rows = new Map(database.prepare("SELECT day, views, visitors FROM agent4_monitor_days WHERE site_id = ? AND day >= ?").all(siteId, dayOf(new Date(now().getTime() - (days - 1) * DAY))).map((row) => [row.day, row]));
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = dayOf(new Date(now().getTime() - offset * DAY));
      out.push({ day, views: rows.get(day)?.views || 0, visitors: rows.get(day)?.visitors || 0 });
    }
    return out;
  }

  function overview() {
    return listSites().map((site) => {
      const last = database.prepare("SELECT at, ok, ms, ssl_days FROM agent4_monitor_checks WHERE site_id = ? ORDER BY at DESC LIMIT 1").get(site.id);
      const week = series(site.id, 7);
      const errors = database.prepare("SELECT COALESCE(SUM(count),0) AS total, COUNT(*) AS kinds FROM agent4_monitor_errors WHERE site_id = ? AND last_at >= ?").get(site.id, new Date(now().getTime() - 7 * DAY).toISOString());
      const seo = readSeo(site.id);
      const everSeen = database.prepare("SELECT 1 FROM agent4_monitor_days WHERE site_id = ? LIMIT 1").get(site.id);
      return {
        ...site,
        lastCheckAt: last?.at || null,
        lastMs: last?.ms ?? null,
        sslDays: last?.ssl_days ?? null,
        uptime: uptime(site.id, 30),
        visitors7: week.reduce((sum, day) => sum + day.visitors, 0),
        views7: week.reduce((sum, day) => sum + day.views, 0),
        trend: week.map((day) => day.visitors),
        tracking: Boolean(everSeen),
        errors7: errors.total,
        errorKinds7: errors.kinds,
        seoScore: seo?.score ?? null
      };
    });
  }

  function detail(siteId) {
    const site = getSite(siteId);
    if (!site) return null;
    const checks = database.prepare("SELECT at, ok, status, ms, ssl_days AS sslDays, error FROM agent4_monitor_checks WHERE site_id = ? ORDER BY at DESC LIMIT 120").all(siteId)
      .map((row) => ({ ...row, ok: row.ok === 1 })).reverse();
    const pages = database.prepare("SELECT path, SUM(views) AS views FROM agent4_monitor_pages WHERE site_id = ? AND day >= ? GROUP BY path ORDER BY views DESC LIMIT 8").all(siteId, dayOf(new Date(now().getTime() - 29 * DAY)));
    const errors = database.prepare("SELECT id, message, source, line, page, count, first_at AS firstAt, last_at AS lastAt FROM agent4_monitor_errors WHERE site_id = ? ORDER BY last_at DESC LIMIT 30").all(siteId);
    return {
      site,
      uptime: uptime(siteId, 30),
      series: series(siteId, 30),
      checks,
      pages,
      errors,
      rejected: database.prepare("SELECT reason, host, count, last_at AS lastAt FROM agent4_monitor_rejects WHERE site_id = ? ORDER BY last_at DESC LIMIT 5").all(siteId),
      seo: readSeo(siteId),
      lastCheckAt: checks.at(-1)?.at || null,
      sslDays: [...checks].reverse().find((check) => check.sslDays != null)?.sslDays ?? null
    };
  }

  return { addSite, updateSite, removeSite, getSite, siteByToken, listSites, recordCheck, lastCheckAt, saveSeo, readSeo, claimAlert, clearAlert, recordView, recordError, recordRejected, removeError, newErrorsSince, overview, detail, close: () => database.close() };
}
