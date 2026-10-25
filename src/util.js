import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";

export function normalizeUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("A website URL is required.");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only HTTP(S) websites are supported.");
  url.hash = "";
  return url.toString();
}

const reserved = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8],
  ['169.254.0.0',16], ['172.16.0.0',12], ['192.0.0.0',24], ['192.0.2.0',24],
  ['192.168.0.0',16], ['198.18.0.0',15], ['198.51.100.0',24], ['203.0.113.0',24],
  ['224.0.0.0',4], ['240.0.0.0',4]
]) reserved.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::',96], ['fc00::',7], ['fe80::',10], ['fec0::',10], ['ff00::',8],
  ['2001:db8::',32], ['2001::',32], ['2002::',16], ['64:ff9b::',96], ['64:ff9b:1::',48]
]) reserved.addSubnet(address, prefix, 'ipv6');
export function isPrivateIp(address) {
  const family = isIP(address);
  return !family || reserved.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
// Validate the addresses actually used by the connection as well as the URL.
// This closes the DNS-rebinding gap between a preliminary lookup and fetch.
const publicDispatcher = new Agent({ connect: {
  lookup(hostname, options, callback) {
    lookup(hostname, { all: true, verbatim: true }).then(addresses => {
      if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) throw new Error('Only public network destinations are allowed.');
      const candidates = options.family ? addresses.filter(item => item.family === options.family) : addresses;
      if (!candidates.length) throw new Error('No public address matches the requested family.');
      if (options.all) callback(null, candidates); else callback(null, candidates[0].address, candidates[0].family);
    }).catch(error => callback(error));
  }
}});

export async function assertPublicUrl(input) {
  const normalized = normalizeUrl(input);
  const url = new URL(normalized);
  if (url.username || url.password) throw new Error("URL credentials are not allowed.");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) {
    throw new Error("Local addresses are not allowed.");
  }
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error(`The host ${url.hostname} does not resolve only to public addresses.`);
  }
  return normalized;
}

export function prospectId(url) {
  const host = new URL(normalizeUrl(url)).hostname.replace(/^www\./, "");
  const digest = createHash("sha256").update(host).digest("hex").slice(0, 10);
  return `${host.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}-${digest}`;
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const normalized = await assertPublicUrl(url);
    return await fetch(normalized, { ...options, dispatcher: publicDispatcher, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function truncate(text, max = 500) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field.trim());
      field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))
  );
}

export async function readCsv(filePath) {
  return parseCsv(await readFile(filePath, "utf8"));
}

export function makeRunId(prefix = "run") {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

export function isoNow() {
  return new Date().toISOString();
}
