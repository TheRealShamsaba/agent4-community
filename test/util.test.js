import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, parseCsv, prospectId } from "../src/util.js";

test("normalizeUrl adds HTTPS and removes fragments", () => {
  assert.equal(normalizeUrl("example.com/path#section"), "https://example.com/path");
});

test("parseCsv supports commas and escaped quotes", () => {
  const rows = parseCsv('name,url,segment\n"ACME, Inc.",https://example.com,"B2B ""tools"""\n');
  assert.deepEqual(rows, [{
    name: "ACME, Inc.",
    url: "https://example.com",
    segment: 'B2B "tools"'
  }]);
});

test("prospect IDs fit inside Telegram callback data", () => {
  const id = prospectId(`https://${"long-subdomain-".repeat(8)}example.com`);
  assert.ok(id.length <= 51);
  assert.match(id, /-[a-f0-9]{10}$/);
});
