import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMonitorStore, normalizeSiteUrl } from "../src/monitor-store.js";

async function open(t, clock = { at: new Date("2026-10-24T10:00:00Z") }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent4-monitor-"));
  const store = createMonitorStore(path.join(root, "hq.sqlite"), { now: () => clock.at });
  t.after(() => store.close());
  return { store, clock };
}

test("site addresses are reduced to one public http(s) page", () => {
  assert.equal(normalizeSiteUrl("studio.example.com"), "https://studio.example.com/");
  assert.equal(normalizeSiteUrl("https://user:pw@Example.com/path#top"), "https://example.com/path");
  assert.throws(() => normalizeSiteUrl(""), /address/);
  assert.throws(() => normalizeSiteUrl("ftp://example.com"), /http/);
  assert.throws(() => normalizeSiteUrl("localhost"), /public/);
});

test("a site is only called down after two failures, and recovery is reported once", async (t) => {
  const { store, clock } = await open(t);
  const site = store.addSite({ name: "Sample Studio", url: "studio.example.com", actorId: "owner" });
  assert.throws(() => store.addSite({ url: "https://studio.example.com" }), /already/);

  assert.equal(store.recordCheck(site.id, { ok: true, status: 200, ms: 220, sslDays: 80 }), null);
  assert.equal(store.getSite(site.id).status, "up");
  assert.equal(store.recordCheck(site.id, { ok: false, error: "ECONNREFUSED" }), null, "one failure is not an outage");
  assert.equal(store.getSite(site.id).status, "up");
  const down = store.recordCheck(site.id, { ok: false, error: "ECONNREFUSED" });
  assert.equal(down.type, "down");
  assert.equal(store.getSite(site.id).status, "down");
  assert.equal(store.recordCheck(site.id, { ok: false, error: "ECONNREFUSED" }), null, "still down is not news");

  clock.at = new Date("2026-10-24T10:20:00Z");
  const back = store.recordCheck(site.id, { ok: true, status: 200, ms: 300, sslDays: 80 });
  assert.equal(back.type, "recovered");
  assert.equal(store.getSite(site.id).downSince, null);
  assert.equal(store.recordCheck(site.id, { ok: true, status: 200, ms: 250 }), null);

  const uptime = store.overview()[0].uptime;
  assert.equal(uptime.checks, 6);
  assert.equal(uptime.percent, 50);
});

test("visitors are counted by a daily hash and never stored as anyone", async (t) => {
  const { store, clock } = await open(t);
  const site = store.addSite({ name: "Shop", url: "https://shop.example.com" });
  store.recordView(site.id, { path: "/", address: "1.2.3.4", agent: "Mozilla" });
  store.recordView(site.id, { path: "/pricing?utm=x#top", address: "1.2.3.4", agent: "Mozilla" });
  store.recordView(site.id, { path: "/", address: "5.6.7.8", agent: "Mozilla" });
  let today = store.detail(site.id).series.at(-1);
  assert.equal(today.views, 3);
  assert.equal(today.visitors, 2, "the same person twice is one visitor");
  assert.deepEqual(store.detail(site.id).pages.map((page) => [page.path, page.views]), [["/", 2], ["/pricing", 1]], "query strings and fragments are dropped");

  clock.at = new Date("2026-10-25T09:00:00Z");
  store.recordView(site.id, { path: "/", address: "1.2.3.4", agent: "Mozilla" });
  today = store.detail(site.id).series.at(-1);
  assert.equal(today.visitors, 1, "tomorrow the same person is counted afresh");
  const overview = store.overview()[0];
  assert.equal(overview.visitors7, 3);
  assert.equal(overview.tracking, true);
});

test("errors are grouped by what they said and where, and can be dismissed", async (t) => {
  const { store } = await open(t);
  const site = store.addSite({ url: "https://shop.example.com" });
  assert.equal(store.recordError(site.id, { message: "x is undefined", source: "app.js", line: 10, page: "/cart?x=1" }).created, true);
  assert.equal(store.recordError(site.id, { message: "x is undefined", source: "app.js", line: 10, page: "/cart" }).created, false);
  store.recordError(site.id, { message: "y failed", source: "app.js", line: 22, page: "/" });
  const { errors } = store.detail(site.id);
  assert.equal(errors.length, 2);
  assert.equal(errors.find((error) => error.message === "x is undefined").count, 2);
  assert.equal(errors.find((error) => error.message === "x is undefined").page, "/cart");
  assert.equal(store.overview()[0].errorKinds7, 2);
  assert.equal(store.removeError(errors[0].id), true);
  assert.equal(store.detail(site.id).errors.length, 1);
});

test("an alert is claimed once per cooldown, and removing a site removes everything about it", async (t) => {
  const { store, clock } = await open(t);
  const site = store.addSite({ url: "https://shop.example.com" });
  assert.equal(store.claimAlert(site.id, "ssl", 3600_000), true);
  assert.equal(store.claimAlert(site.id, "ssl", 3600_000), false);
  clock.at = new Date("2026-10-24T11:30:00Z");
  assert.equal(store.claimAlert(site.id, "ssl", 3600_000), true);
  store.clearAlert(site.id, "ssl");
  assert.equal(store.claimAlert(site.id, "ssl", 3600_000), true);
  store.recordView(site.id, { path: "/", address: "1.1.1.1", agent: "a" });
  assert.equal(store.removeSite(site.id), true);
  assert.equal(store.getSite(site.id), null);
  assert.equal(store.removeSite(site.id), false);
  assert.deepEqual(store.overview(), []);
});
