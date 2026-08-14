"use strict";

function finite(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(maximum, Math.max(minimum, number));
}

function percentile(values, quantile = 0.75) {
  const sorted = (values || []).map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return Math.round(sorted[index] * 1000) / 1000;
}

function metricTime(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizePerformance(rows = [], options = {}) {
  const nowMs = finite(options.nowMs) || Date.now();
  const sinceMs = nowMs - finite(options.windowMs || 24 * 60 * 60 * 1000, 60_000);
  const recent = rows.filter((row) => {
    const createdAtMs = finite(row.createdAtMs) || metricTime(row.createdAt);
    return createdAtMs >= sinceMs && createdAtMs <= nowMs + 60_000;
  });
  const load = recent.map((row) => finite(row.loadMs, 0, 120000)).filter(Boolean);
  const lcp = recent.map((row) => finite(row.lcpMs, 0, 120000)).filter(Boolean);
  const cls = recent.map((row) => finite(row.cls, 0, 10));
  return {
    samples24h: recent.length,
    p75LoadMs: percentile(load),
    p75LcpMs: percentile(lcp),
    p75Cls: percentile(cls),
    mobileSamples24h: recent.filter((row) => row.device === "mobile").length,
    offlineSamples24h: recent.filter((row) => row.online === false).length
  };
}

module.exports = { finite, metricTime, percentile, summarizePerformance };
