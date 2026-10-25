import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLocalCapacity } from "../src/ai.js";

const config = {
  runtime: {
    minFreeMemoryMb: 4_096,
    maxLoadAverage: 4
  }
};

test("AI capacity guard preserves the server memory reserve", () => {
  const result = evaluateLocalCapacity(config, { freeMemoryMb: 3_500, oneMinuteLoad: 0.2 });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /below the 4096 MB reserve/);
});

test("AI capacity guard pauses work when the host is busy", () => {
  const result = evaluateLocalCapacity(config, { freeMemoryMb: 10_000, oneMinuteLoad: 4.5 });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /load average/);
});

test("AI capacity guard permits work with sufficient headroom", () => {
  const result = evaluateLocalCapacity(config, { freeMemoryMb: 10_000, oneMinuteLoad: 0.5 });
  assert.equal(result.allowed, true);
});
