"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");

const monitorPath = path.join(__dirname, "..", "scripts", "check-production.mjs");

function responseBody(pathname) {
  if (pathname === "/index.html") return '<title>EDILKAPPA · Gestionale cantieri</title><main id="app"></main><script src="firebase-cloud.js"></script>';
  if (pathname === "/richiesta.html") return "Richiedi un sopralluogo";
  if (pathname === "/privacy.html") return "Informativa sulla privacy";
  if (pathname === "/manifest.json") return JSON.stringify({ name: "EDILKAPPA", display: "standalone" });
  if (pathname === "/version.json") return JSON.stringify({ version: "abcdef123456", builtAt: "2026-08-20T19:00:00.000Z", appCheckConfigured: false, appCheckMode: "observe" });
  if (pathname === "/app-config.js") return "window.EdilKappaRuntimeConfig = {};";
  return "";
}

function runMonitor(baseUrl) {
  return new Promise((resolve) => {
    execFile(process.execPath, [monitorPath, baseUrl], {
      env: { ...process.env, EDILKAPPA_MONITOR_FAST_RETRY: "1" }
    }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
}

async function withServer(versionHandler, assertion) {
  let versionRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/version.json") {
      versionRequests += 1;
      if (versionHandler(request, response, versionRequests)) return;
    }
    response.setHeader("cache-control", "no-cache, no-store, must-revalidate");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("strict-transport-security", "max-age=31536000");
    response.setHeader("content-security-policy", "default-src 'self'");
    response.end(responseBody(request.url));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await assertion(`http://127.0.0.1:${address.port}/`, () => versionRequests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("production monitor recovers after three temporary network failures", async () => {
  await withServer((request, response, attempt) => {
    if (attempt <= 3) {
      response.destroy();
      return true;
    }
    return false;
  }, async (baseUrl, requests) => {
    const result = await runMonitor(baseUrl);
    assert.equal(result.error, null);
    assert.match(result.stdout, /Produzione EdilKappa raggiungibile e coerente/);
    assert.match(result.stderr, /nuovo tentativo 4\/4/);
    assert.equal(requests(), 4);
  });
});

test("production monitor reports one failure after exhausting retries", async () => {
  await withServer((request, response) => {
    response.destroy();
    return true;
  }, async (baseUrl, requests) => {
    const result = await runMonitor(baseUrl);
    assert.equal(result.error?.code, 1);
    assert.match(result.stderr, /Monitor produzione non superato \(1\):/);
    assert.doesNotMatch(result.stderr, /version\.json: JSON non valido/);
    assert.equal(requests(), 4);
  });
});
