"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(file) {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8");
}

test("keeps heavy features out of the initial browser path", () => {
  const html = source("index.html");
  const loader = source("edilkappa-loader.js");
  assert.match(html, /edilkappa-loader\.js\?v=3/);
  assert.doesNotMatch(html, /<script[^>]+(?:jspdf|edilkappa-ai|leaflet|smart-operations|operations-center)/i);
  assert.doesNotMatch(html, /<link[^>]+leaflet/i);
  assert.match(loader, /critical:\s*\[/);
  assert.match(loader, /ai:\s*\[/);
  assert.match(loader, /pdf:\s*\[/);
  assert.match(loader, /ensureMap/);
  assert.match(loader, /requestIdleCallback/);
  assert.ok(loader.indexOf("edilkappa-ai-route.js") > loader.indexOf("edilkappa-ai.js"));
  assert.ok(loader.indexOf("jspdf.plugin.autotable.min.js") > loader.indexOf("jspdf.umd.min.js"));
});

test("preserves critical workflow ordering during progressive startup", () => {
  const loader = source("edilkappa-loader.js");
  assert.ok(loader.indexOf("professional-extensions.js") < loader.indexOf("business-suite.js"));
  assert.ok(loader.indexOf("danea-integration.js") < loader.indexOf("intervention-lifecycle.js"));
  assert.ok(loader.indexOf("completion-center.js") < loader.indexOf("hours-closeout.js"));
  assert.ok(loader.indexOf("hours-closeout.js") < loader.indexOf("attendance-center.js"));
  assert.match(loader, /viewName === "ai"/);
  assert.match(loader, /TOOL_VIEWS\.has\(viewName\)/);
});

test("avoids full cloud renders for unrelated data and active forms", () => {
  const html = source("index.html");
  const cloud = source("firebase-cloud.js");
  assert.match(html, /function renderFromCloud\(\)/);
  assert.match(html, /dialog\?\.open/);
  assert.match(cloud, /CLOUD_VIEW_DEPENDENCIES/);
  assert.match(cloud, /cloudEventsAffectCurrentView/);
  assert.match(cloud, /local\.refreshChrome\?\.\(\)/);
  assert.match(cloud, /local\.renderFromCloud/);
  assert.match(cloud, /requestIdleCallback\(persist/);
});

test("keeps the offline shell small while caching daily workflows", () => {
  const worker = source("sw.js");
  assert.match(worker, /v92-avvio-gestione-foto/);
  assert.match(worker, /"\.\/media-contract\.js\?v=1"/);
  assert.match(worker, /"\.\/edilkappa-loader\.js\?v=3"/);
  assert.match(worker, /"\.\/danea-integration\.js"/);
  assert.match(worker, /"\.\/inspection-workflow\.js\?v=8"/);
  assert.match(worker, /"\.\/hours-closeout\.js"/);
  assert.match(worker, /"\.\/attendance-center\.js"/);
  assert.doesNotMatch(worker, /"\.\/edilkappa-ai\.js"/);
  assert.doesNotMatch(worker, /"\.\/smart-operations\.js"/);
  assert.doesNotMatch(worker, /ignoreSearch/);
});

test("debounces global search instead of rebuilding on every keystroke", () => {
  const html = source("index.html");
  assert.match(html, /let searchRenderTimer=0/);
  assert.match(html, /searchRenderTimer=setTimeout\(\(\)=>/);
  assert.match(html, /\},120\)/);
});
