import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { applyOwnerTimeZone, localIsoDate, localIsoMonth } from "../src/local-date.js";

/** Runs a check with the process pinned to one timezone, then puts it back. */
function inTimezone(zone, run) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test("today is the day the person is living in, not the UTC day", () => {
  const lateEvening = new Date("2026-09-14T22:30:00Z");
  inTimezone("Europe/Istanbul", () => {
    assert.equal(lateEvening.toISOString().slice(0, 10), "2026-09-14");
    assert.equal(localIsoDate(lateEvening), "2026-09-15", "half past one in the morning in Istanbul is already the next day");
    assert.equal(localIsoMonth(new Date("2026-09-30T22:30:00Z")), "2026-10", "and the last evening of a month is already the next month");
  });
});

test("a day that has not begun yet in UTC is still yesterday in the west", () => {
  inTimezone("America/New_York", () => {
    assert.equal(localIsoDate(new Date("2026-09-14T02:30:00Z")), "2026-09-13");
  });
});

test("a date can be given as a string or a moment, but never as nonsense", () => {
  inTimezone("UTC", () => {
    assert.equal(localIsoDate("2026-01-05T09:00:00Z"), "2026-01-05");
    assert.equal(localIsoDate(new Date("2026-01-05T09:00:00Z")), "2026-01-05");
    assert.match(localIsoDate(), /^\d{4}-\d{2}-\d{2}$/);
    assert.throws(() => localIsoDate("not a date"), /not a real date/);
  });
});

test("the owner's timezone is applied to a process that starts in UTC, as a container does", () => {
  const module = new URL("../src/local-date.js", import.meta.url).href;
  const run = (script) => execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: "UTC", NODE_OPTIONS: "" },
    encoding: "utf8"
  }).trim();
  const lateEvening = "2026-09-14T22:30:00Z";

  const before = run(`import { localIsoDate } from "${module}"; console.log(localIsoDate(new Date("${lateEvening}")));`);
  assert.equal(before, "2026-09-14", "a UTC container shows yesterday to someone who is already asleep in Istanbul");

  const after = run(`import { applyOwnerTimeZone, localIsoDate } from "${module}"; applyOwnerTimeZone("Europe/Istanbul"); console.log(localIsoDate(new Date("${lateEvening}")));`);
  assert.equal(after, "2026-09-15", "after the entry point applies the owner's zone it shows the owner's day");
});

test("an unknown timezone is an error, and a blank one changes nothing", () => {
  const env = { TZ: "UTC" };
  assert.equal(applyOwnerTimeZone("Europe/Istanbul", env), "Europe/Istanbul");
  assert.equal(env.TZ, "Europe/Istanbul");
  assert.equal(applyOwnerTimeZone("", env), "Europe/Istanbul", "blank leaves the zone as it was");
  assert.equal(applyOwnerTimeZone("   ", env), "Europe/Istanbul");
  assert.throws(() => applyOwnerTimeZone("Mars/Olympus", env), /not a time zone HQ can use/);
  assert.equal(env.TZ, "Europe/Istanbul", "a bad name does not half-apply");
});
