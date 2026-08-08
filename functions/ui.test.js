"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("registers the EdilKappa AI browser interface", () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = {};
  global.document = {
    createElement: () => ({ textContent: "" }),
    head: { appendChild: () => {} }
  };
  const modulePath = require.resolve("../edilkappa-ai.js");
  delete require.cache[modulePath];
  require(modulePath);
  assert.equal(typeof global.window.edilkappaAiView, "function");
  assert.equal(typeof global.window.edilkappaAiSend, "function");
  assert.equal(typeof global.window.edilkappaAiReset, "function");
  global.window = previousWindow;
  global.document = previousDocument;
});

test("keeps EdilKappa AI available after professional extensions replace render", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "professional-extensions.js"), "utf8");
  assert.match(source, /ai:\s*\(\)\s*=>\s*window\.edilkappaAiView/);
  assert.match(source, /\['ai','✦','EdilKappa AI'\]/);
});

test("loads the final AI route guard after the AI interface", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const routeSource = fs.readFileSync(path.join(__dirname, "..", "edilkappa-ai-route.js"), "utf8");
  assert.ok(indexSource.indexOf("edilkappa-ai-route.js") > indexSource.indexOf("edilkappa-ai.js"));
  assert.match(routeSource, /view === "ai"/);
  assert.match(routeSource, /window\.edilkappaAiView/);
});
