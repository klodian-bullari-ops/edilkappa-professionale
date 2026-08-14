"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { percentile, summarizePerformance } = require("./performance-core");

test("calcola il percentile 75 in modo deterministico", () => {
  assert.equal(percentile([100, 200, 300, 400]), 300);
  assert.equal(percentile([400, 100, 300, 200]), 300);
  assert.equal(percentile([]), 0);
});

test("riassume soltanto le misure recenti e distingue telefono e offline", () => {
  const nowMs = Date.parse("2026-08-13T12:00:00.000Z");
  const rows = [
    { createdAtMs: nowMs - 1000, loadMs: 1100, lcpMs: 900, cls: 0.02, device: "desktop", online: true },
    { createdAtMs: nowMs - 2000, loadMs: 2100, lcpMs: 1900, cls: 0.08, device: "mobile", online: true },
    { createdAtMs: nowMs - 3000, loadMs: 4100, lcpMs: 4500, cls: 0.3, device: "mobile", online: false },
    { createdAtMs: nowMs - 48 * 60 * 60 * 1000, loadMs: 99999, lcpMs: 99999, cls: 9, device: "mobile", online: false }
  ];
  assert.deepEqual(summarizePerformance(rows, { nowMs }), {
    samples24h: 3,
    p75LoadMs: 4100,
    p75LcpMs: 4500,
    p75Cls: 0.3,
    mobileSamples24h: 2,
    offlineSamples24h: 1
  });
});
