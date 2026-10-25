import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/*
 * What a client is allowed to see, and the secret that lets them see it.
 *
 * A client link belongs to one company. It carries a long random token, and the
 * token IS the credential: anyone holding the address can open the page, so the
 * address is sent only to the person it is for, and the owner can end it at any
 * time. The owner chooses which of the company's projects the link shows. That
 * choice is the consent: a project nobody ticked is not on the page, whatever
 * else is in HQ.
 *
 * A published update is a snapshot, copied at the moment it was published. The
 * document it came from can be edited, sent, or deleted afterwards without the
 * client's page changing underneath them, and withdrawing it really removes it.
 */

export const CLIENT_LINK_LANGUAGES = ["en", "fa"];
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function text(value, limit = 300) {
  return String(value ?? "").trim().slice(0, limit);
}

export function isClientToken(value) {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

function parseIds(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

function cleanIds(value) {
  if (value === undefined) return undefined;
  assert(Array.isArray(value), "Projects must be a list.");
  return [...new Set(value.map((id) => text(id, 140)).filter(Boolean))].slice(0, 50);
}

function cleanLanguage(value, fallback = "en") {
  const language = text(value, 5) || fallback;
  assert(CLIENT_LINK_LANGUAGES.includes(language), "The page language must be English or Persian.");
  return language;
}

/** WhatsApp, Telegram and friends open a link by themselves to draw its preview. That is not the client reading it. */
export function isLinkPreviewBot(userAgent) {
  return /whatsapp|telegrambot|facebookexternalhit|slackbot|twitterbot|linkedinbot|discordbot|skypeuripreview|googlebot|bingbot|applebot|preview|crawler|spider/i.test(String(userAgent || ""));
}

/** Roughly what opened the page, read from the browser's own description of itself. Nothing finer than that. */
export function describeDevice(userAgent) {
  const agent = String(userAgent || "");
  const os = /iPhone|iPad|iPod/.test(agent) ? "iOS"
    : /Android/.test(agent) ? "Android"
      : /Windows/.test(agent) ? "Windows"
        : /Macintosh|Mac OS X/.test(agent) ? "macOS"
          : /Linux|CrOS/.test(agent) ? "Linux" : "";
  const device = /iPad|Tablet/.test(agent) || (/Android/.test(agent) && !/Mobile/.test(agent)) ? "tablet"
    : /Mobi|iPhone|iPod|Android/.test(agent) ? "phone" : "computer";
  const browser = /Instagram/.test(agent) ? "Instagram"
    : /FBAN|FBAV/.test(agent) ? "Facebook"
      : /Edg\//.test(agent) ? "Edge"
        : /OPR\/|Opera/.test(agent) ? "Opera"
          : /SamsungBrowser/.test(agent) ? "Samsung Internet"
            : /CriOS|Chrome\//.test(agent) ? "Chrome"
              : /FxiOS|Firefox\//.test(agent) ? "Firefox"
                : /Safari\//.test(agent) ? "Safari" : "";
  return { device, os, browser };
}

/* A loopback or private address says nothing about who is calling: it is this
   machine, a test, or a network shared by everyone behind it. */
function isPublicAddress(address) {
  const value = String(address || "").replace(/^::ffff:/, "").toLowerCase();
  if (!value || value === "unknown") return false;
  return !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fe80:|fc|fd)/.test(value);
}

const OWNER_NETWORK_DAYS = 14;
const OWNER_NETWORK_NOTE_MS = 5 * 60 * 1000;

export function createClientLinkStore(databasePath, { workspace = null, now = () => new Date() } = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_client_links (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'en',
      project_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      last_viewed_at TEXT,
      view_count INTEGER NOT NULL DEFAULT 0,
      show_updates INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS client_links_company ON agent4_client_links(company_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS agent4_client_updates (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      project_id TEXT,
      paperwork_id TEXT NOT NULL UNIQUE,
      language TEXT NOT NULL DEFAULT 'en',
      number TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL,
      published_at TEXT NOT NULL,
      published_by TEXT NOT NULL,
      withdrawn_at TEXT
    );
    CREATE INDEX IF NOT EXISTS client_updates_company ON agent4_client_updates(company_id, published_at DESC);

    -- One row each time a person opens a link. No address is kept: "visitor" and
    -- "network" are keyed hashes, enough to say "the same phone again" or "the
    -- owner's own Wi-Fi", and nothing that leads back to where anyone is.
    CREATE TABLE IF NOT EXISTS agent4_client_link_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id TEXT NOT NULL,
      viewed_at TEXT NOT NULL,
      device TEXT NOT NULL DEFAULT '',
      os TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      visitor TEXT NOT NULL DEFAULT '',
      own INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS client_link_views_link ON agent4_client_link_views(link_id, viewed_at DESC);

    -- The networks the owner has used HQ from lately, as the same keyed hash.
    CREATE TABLE IF NOT EXISTS agent4_owner_networks (
      network TEXT PRIMARY KEY,
      seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent4_client_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // A database file that already exists keeps the table it was made with, so a
  // column added later has to arrive as a guarded migration.
  if (!database.prepare("PRAGMA table_info(agent4_client_links)").all().some((column) => column.name === "show_updates")) {
    database.exec("ALTER TABLE agent4_client_links ADD COLUMN show_updates INTEGER NOT NULL DEFAULT 1");
  }

  // The key behind every hash. It never leaves this database, so a hash cannot be
  // turned back into an address by trying every address there is.
  let hashKey = database.prepare("SELECT value FROM agent4_client_meta WHERE key = 'hash_key'").get()?.value;
  if (!hashKey) {
    database.prepare("INSERT OR IGNORE INTO agent4_client_meta (key, value) VALUES ('hash_key', ?)").run(randomBytes(32).toString("base64url"));
    hashKey = database.prepare("SELECT value FROM agent4_client_meta WHERE key = 'hash_key'").get().value;
  }
  const keyed = (...parts) => createHmac("sha256", hashKey).update(parts.join("\n")).digest("base64url").slice(0, 22);
  const networkOf = (address) => (isPublicAddress(address) ? keyed("network", String(address).replace(/^::ffff:/, "").toLowerCase()) : "");
  const ownerNoted = new Map();

  const selectById = database.prepare("SELECT * FROM agent4_client_links WHERE id = ?");
  const selectByToken = database.prepare("SELECT * FROM agent4_client_links WHERE token = ?");

  function stateOf(row, moment = now()) {
    if (row.revoked_at) return "revoked";
    if (row.expires_at && new Date(row.expires_at).getTime() <= moment.getTime()) return "expired";
    return "active";
  }

  function linkFrom(row) {
    if (!row) return null;
    return {
      id: row.id,
      companyId: row.company_id,
      token: row.token,
      label: row.label || "",
      language: row.language === "fa" ? "fa" : "en",
      projectIds: parseIds(row.project_ids),
      showUpdates: row.show_updates !== 0,
      createdAt: row.created_at,
      createdBy: row.created_by,
      expiresAt: row.expires_at || null,
      revokedAt: row.revoked_at || null,
      lastViewedAt: row.last_viewed_at || null,
      viewCount: row.view_count || 0,
      state: stateOf(row)
    };
  }

  function createLink(input = {}) {
    const companyId = text(input.companyId, 140);
    assert(companyId, "Choose a company for the link.");
    if (workspace?.getCompany) assert(workspace.getCompany(companyId), "That company no longer exists.");
    const moment = now();
    const ttlDays = input.ttlDays === undefined || input.ttlDays === null || input.ttlDays === "" ? null : Number(input.ttlDays);
    assert(ttlDays === null || (Number.isInteger(ttlDays) && ttlDays >= 1 && ttlDays <= 3650), "A link lasts between 1 and 3650 days, or has no end date.");
    const id = randomUUID();
    // 256 random bits. Nothing about the company, the project or the date is in it.
    const token = randomBytes(32).toString("base64url");
    database.prepare(`
      INSERT INTO agent4_client_links (id,company_id,token,label,language,project_ids,created_at,created_by,expires_at,show_updates)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      companyId,
      token,
      text(input.label, 120),
      cleanLanguage(input.language),
      JSON.stringify(cleanIds(input.projectIds) || []),
      moment.toISOString(),
      text(input.actorId, 140) || "unknown",
      ttlDays ? new Date(moment.getTime() + ttlDays * 86_400_000).toISOString() : null,
      input.showUpdates === false ? 0 : 1
    );
    return linkFrom(selectById.get(id));
  }

  function getLink(id) {
    return linkFrom(selectById.get(text(id, 140)));
  }

  function listLinks(companyId) {
    return database
      .prepare("SELECT * FROM agent4_client_links WHERE company_id = ? ORDER BY created_at DESC")
      .all(text(companyId, 140))
      .map(linkFrom);
  }

  function updateLink(id, updates = {}) {
    const existing = selectById.get(text(id, 140));
    assert(existing, "That link no longer exists.");
    assert(stateOf(existing) === "active", "A link that has ended cannot be changed. Make a new one.");
    const projectIds = cleanIds(updates.projectIds);
    database.prepare("UPDATE agent4_client_links SET label=?, language=?, project_ids=?, show_updates=? WHERE id=?").run(
      updates.label === undefined ? existing.label : text(updates.label, 120),
      updates.language === undefined ? existing.language : cleanLanguage(updates.language),
      projectIds === undefined ? existing.project_ids : JSON.stringify(projectIds),
      updates.showUpdates === undefined ? existing.show_updates : (updates.showUpdates === false ? 0 : 1),
      existing.id
    );
    return linkFrom(selectById.get(existing.id));
  }

  function revokeLink(id) {
    const existing = selectById.get(text(id, 140));
    assert(existing, "That link no longer exists.");
    if (!existing.revoked_at) {
      database.prepare("UPDATE agent4_client_links SET revoked_at=? WHERE id=?").run(now().toISOString(), existing.id);
    }
    return linkFrom(selectById.get(existing.id));
  }

  /** The link behind a token, only while it is still allowed to open. Unknown, revoked and expired are all just "no". */
  function resolve(token) {
    if (!isClientToken(token)) return null;
    const row = selectByToken.get(token);
    if (!row || stateOf(row) !== "active") return null;
    return linkFrom(row);
  }

  /** The owner is using HQ from this address. Remembered for a while, so their own taps on a link are not taken for the client's. */
  function noteOwnerNetwork(address) {
    const network = networkOf(address);
    if (!network) return;
    const moment = now().getTime();
    if (moment - (ownerNoted.get(network) || 0) < OWNER_NETWORK_NOTE_MS) return;
    ownerNoted.set(network, moment);
    database.prepare("INSERT INTO agent4_owner_networks (network, seen_at) VALUES (?, ?) ON CONFLICT(network) DO UPDATE SET seen_at=excluded.seen_at")
      .run(network, new Date(moment).toISOString());
    database.prepare("DELETE FROM agent4_owner_networks WHERE seen_at < ?").run(new Date(moment - OWNER_NETWORK_DAYS * 86_400_000).toISOString());
  }

  function isOwnerNetwork(network) {
    if (!network) return false;
    const row = database.prepare("SELECT seen_at FROM agent4_owner_networks WHERE network = ?").get(network);
    return Boolean(row) && new Date(row.seen_at).getTime() > now().getTime() - OWNER_NETWORK_DAYS * 86_400_000;
  }

  /**
   * Someone opened the page. Every open is kept with roughly what it was opened
   * on; the count and "last opened" only move for opens that are not the owner's
   * own, so "not opened yet" keeps meaning the client has not.
   */
  function recordView(id, { userAgent = "", address = "" } = {}) {
    const linkId = text(id, 140);
    const moment = now().toISOString();
    const { device, os, browser } = describeDevice(userAgent);
    const own = isOwnerNetwork(networkOf(address));
    const visitor = isPublicAddress(address) || userAgent ? keyed("visitor", String(address), String(userAgent)) : "";
    database.prepare("INSERT INTO agent4_client_link_views (link_id, viewed_at, device, os, browser, visitor, own) VALUES (?,?,?,?,?,?,?)")
      .run(linkId, moment, device, os, browser, visitor, own ? 1 : 0);
    if (!own) {
      database.prepare("UPDATE agent4_client_links SET last_viewed_at=?, view_count=view_count+1 WHERE id=?").run(moment, linkId);
    }
    return { own };
  }

  /** The opens of one link, newest first, and how many different devices the client's opens came from. */
  function viewsFor(id, { limit = 30 } = {}) {
    const linkId = text(id, 140);
    const rows = database
      .prepare("SELECT viewed_at, device, os, browser, visitor, own FROM agent4_client_link_views WHERE link_id = ? ORDER BY viewed_at DESC, id DESC LIMIT ?")
      .all(linkId, Math.min(Math.max(Number(limit) || 30, 1), 200));
    const totals = database
      .prepare("SELECT COUNT(*) AS logged, COUNT(DISTINCT CASE WHEN visitor != '' THEN visitor END) AS devices, MIN(viewed_at) AS first FROM agent4_client_link_views WHERE link_id = ? AND own = 0")
      .get(linkId);
    const ownOpens = database.prepare("SELECT COUNT(*) AS n FROM agent4_client_link_views WHERE link_id = ? AND own = 1").get(linkId).n;
    // Devices are numbered in the order they first turned up, so "device 2" stays device 2.
    const order = database
      .prepare("SELECT visitor FROM agent4_client_link_views WHERE link_id = ? AND own = 0 AND visitor != '' GROUP BY visitor ORDER BY MIN(viewed_at), MIN(id)")
      .all(linkId)
      .map((row) => row.visitor);
    return {
      firstViewedAt: totals.first || null,
      devices: totals.devices || 0,
      // Opens by anyone but the owner since each one began to be kept; the link's
      // own count can be higher, from before.
      logged: totals.logged || 0,
      ownOpens,
      opens: rows.map((row) => ({
        at: row.viewed_at,
        device: row.device || "computer",
        os: row.os,
        browser: row.browser,
        own: row.own === 1,
        visitor: row.own === 1 || !row.visitor ? 0 : order.indexOf(row.visitor) + 1
      }))
    };
  }

  /* ---------------------------------------------------------- updates --- */

  function updateFrom(row) {
    if (!row) return null;
    let payload = {};
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = {};
    }
    return {
      id: row.id,
      companyId: row.company_id,
      projectId: row.project_id || null,
      paperworkId: row.paperwork_id,
      language: row.language === "fa" ? "fa" : "en",
      number: row.number || "",
      payload,
      publishedAt: row.published_at,
      publishedBy: row.published_by,
      withdrawnAt: row.withdrawn_at || null
    };
  }

  /** Publishing again replaces the snapshot, so fixing a typo and republishing does what it looks like. */
  function publishUpdate(input = {}) {
    const paperworkId = text(input.paperworkId, 140);
    const companyId = text(input.companyId, 140);
    assert(paperworkId && companyId, "An update needs a document and a company.");
    assert(input.payload && typeof input.payload === "object" && !Array.isArray(input.payload), "An update needs its content.");
    const moment = now().toISOString();
    const existing = database.prepare("SELECT id FROM agent4_client_updates WHERE paperwork_id = ?").get(paperworkId);
    const id = existing?.id || randomUUID();
    if (existing) {
      database.prepare(`
        UPDATE agent4_client_updates
        SET company_id=?, project_id=?, language=?, number=?, payload=?, published_at=?, published_by=?, withdrawn_at=NULL
        WHERE id=?
      `).run(companyId, text(input.projectId, 140) || null, cleanLanguage(input.language), text(input.number, 40), JSON.stringify(input.payload), moment, text(input.actorId, 140) || "unknown", id);
    } else {
      database.prepare(`
        INSERT INTO agent4_client_updates (id,company_id,project_id,paperwork_id,language,number,payload,published_at,published_by)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(id, companyId, text(input.projectId, 140) || null, paperworkId, cleanLanguage(input.language), text(input.number, 40), JSON.stringify(input.payload), moment, text(input.actorId, 140) || "unknown");
    }
    return updateFrom(database.prepare("SELECT * FROM agent4_client_updates WHERE id = ?").get(id));
  }

  function withdrawUpdate(paperworkId) {
    const row = database.prepare("SELECT * FROM agent4_client_updates WHERE paperwork_id = ?").get(text(paperworkId, 140));
    if (!row) return null;
    if (!row.withdrawn_at) {
      database.prepare("UPDATE agent4_client_updates SET withdrawn_at=? WHERE id=?").run(now().toISOString(), row.id);
    }
    return updateFrom(database.prepare("SELECT * FROM agent4_client_updates WHERE id = ?").get(row.id));
  }

  /**
   * Whatever a company's page may show: every update not withdrawn, newest
   * first. "Newest" is the week an update covers, not the day it was published:
   * fixing last week's update after this week's has gone out must not make last
   * week the latest. Publishing time only breaks a tie between the same week.
   */
  function publishedUpdates(companyId, { limit = 40 } = {}) {
    return database
      .prepare(`
        SELECT * FROM agent4_client_updates
        WHERE company_id = ? AND withdrawn_at IS NULL
        ORDER BY COALESCE(json_extract(payload, '$.weekOf'), '') DESC, published_at DESC, id DESC
        LIMIT ?
      `)
      .all(text(companyId, 140), Math.min(Math.max(Number(limit) || 40, 1), 100))
      .map(updateFrom);
  }

  /** The document is gone, so what was published from it goes too. */
  function removeUpdate(paperworkId) {
    return database.prepare("DELETE FROM agent4_client_updates WHERE paperwork_id = ?").run(text(paperworkId, 140)).changes > 0;
  }

  /** The company is gone, so are its links and everything published for it. */
  function removeCompany(companyId) {
    const id = text(companyId, 140);
    database.prepare("DELETE FROM agent4_client_link_views WHERE link_id IN (SELECT id FROM agent4_client_links WHERE company_id = ?)").run(id);
    const links = database.prepare("DELETE FROM agent4_client_links WHERE company_id = ?").run(id).changes;
    const updates = database.prepare("DELETE FROM agent4_client_updates WHERE company_id = ?").run(id).changes;
    return { links, updates };
  }

  function publicationFor(paperworkId) {
    return updateFrom(database.prepare("SELECT * FROM agent4_client_updates WHERE paperwork_id = ?").get(text(paperworkId, 140)));
  }

  return {
    createLink,
    getLink,
    listLinks,
    updateLink,
    revokeLink,
    resolve,
    recordView,
    viewsFor,
    noteOwnerNetwork,
    publishUpdate,
    withdrawUpdate,
    removeUpdate,
    removeCompany,
    publishedUpdates,
    publicationFor,
    close() { database.close(); }
  };
}
