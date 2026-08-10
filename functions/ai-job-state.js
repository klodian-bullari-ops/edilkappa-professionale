"use strict";

const AGENT_QUEUE_TIMEOUT_MS = 3 * 60 * 1000;
const AGENT_WORK_TIMEOUT_MS = 10 * 60 * 1000;

function positiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function agentJobTimeout(job, now = Date.now()) {
  const status = String(job?.status || "");
  if (!["queued", "working"].includes(status)) return null;

  const createdAtMs = positiveNumber(job?.createdAtMs);
  const startedAtMs = positiveNumber(job?.startedAtMs);
  const referenceAtMs = status === "working" ? (startedAtMs || createdAtMs) : createdAtMs;
  if (!referenceAtMs) return null;

  const timeoutMs = status === "queued" ? AGENT_QUEUE_TIMEOUT_MS : AGENT_WORK_TIMEOUT_MS;
  const ageMs = Math.max(0, positiveNumber(now) - referenceAtMs);
  if (ageMs < timeoutMs) return null;

  return {
    ageMs,
    timeoutMs,
    stage: "timeout",
    error: status === "queued"
      ? "L’agente preventivi non è partito entro il tempo previsto. Premi Riprova: le foto sono già archiviate."
      : "L’agente preventivi ha superato 10 minuti. Premi Riprova: le foto sono già archiviate."
  };
}

function canRetryAgentJob(job, now = Date.now()) {
  return job?.status === "failed" || Boolean(agentJobTimeout(job, now));
}

module.exports = {
  AGENT_QUEUE_TIMEOUT_MS,
  AGENT_WORK_TIMEOUT_MS,
  agentJobTimeout,
  canRetryAgentJob
};
