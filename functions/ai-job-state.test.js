"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AGENT_QUEUE_TIMEOUT_MS,
  AGENT_WORK_TIMEOUT_MS,
  agentJobTimeout,
  canRetryAgentJob
} = require("./ai-job-state");

test("expires an agent job that never leaves the queue", () => {
  const now = 1_000_000;
  assert.equal(agentJobTimeout({ status: "queued", createdAtMs: now - AGENT_QUEUE_TIMEOUT_MS + 1 }, now), null);
  const timeout = agentJobTimeout({ status: "queued", createdAtMs: now - AGENT_QUEUE_TIMEOUT_MS }, now);
  assert.equal(timeout.stage, "timeout");
  assert.match(timeout.error, /non è partito/i);
  assert.match(timeout.error, /foto sono già archiviate/i);
});

test("expires a working agent ten minutes after the worker starts", () => {
  const now = 2_000_000;
  const job = {
    status: "working",
    createdAtMs: now - AGENT_WORK_TIMEOUT_MS * 2,
    startedAtMs: now - AGENT_WORK_TIMEOUT_MS + 1
  };
  assert.equal(agentJobTimeout(job, now), null);
  job.startedAtMs -= 1;
  const timeout = agentJobTimeout(job, now);
  assert.equal(timeout.timeoutMs, AGENT_WORK_TIMEOUT_MS);
  assert.match(timeout.error, /superato 10 minuti/i);
});

test("uses creation time for older jobs without a numeric worker start", () => {
  const now = 3_000_000;
  const timeout = agentJobTimeout({ status: "working", createdAtMs: now - AGENT_WORK_TIMEOUT_MS }, now);
  assert.equal(timeout.stage, "timeout");
});

test("only failed or stale agent jobs can be retried", () => {
  const now = 4_000_000;
  assert.equal(canRetryAgentJob({ status: "failed" }, now), true);
  assert.equal(canRetryAgentJob({ status: "completed" }, now), false);
  assert.equal(canRetryAgentJob({ status: "working", startedAtMs: now - 1000 }, now), false);
  assert.equal(canRetryAgentJob({ status: "working", startedAtMs: now - AGENT_WORK_TIMEOUT_MS }, now), true);
});
