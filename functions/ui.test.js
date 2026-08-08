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
  assert.equal(typeof global.window.edilkappaAiSaveArtifact, "function");
  assert.equal(typeof global.window.edilkappaAiDownloadPdf, "function");
  assert.equal(typeof global.window.edilkappaAiDownloadWord, "function");
  assert.equal(typeof global.window.edilkappaAiGenerateVisual, "function");
  assert.equal(typeof global.window.edilkappaAiSetModel, "function");
  global.window = previousWindow;
  global.document = previousDocument;
});

test("supports construction photos, video workflows and managed artifacts", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "edilkappa-ai.js"), "utf8");
  assert.match(source, /video\/mp4/);
  assert.match(source, /extractVideoFrames/);
  assert.match(source, /uploadMedia/);
  assert.match(source, /listinoEdilKappa/);
  assert.match(source, /Salva e modifica preventivo/);
  assert.match(source, /Salva relazione PDF/);
  assert.match(source, /Scarica Word/);
  assert.match(source, /Scarica PDF EdilKappa/);
  assert.match(source, /priceItem\.salePrice/);
  assert.match(source, /priceSource:\s*"da_definire"/);
  assert.match(source, /archiveWarnings/);
  assert.match(source, /GPT‑5\.6 Sol/);
  assert.match(source, /generate_visual/);
  assert.match(source, /visualBriefs/);
  assert.match(source, /quote\.options/);
  assert.match(source, /memoriaPrezziValidati/);
  assert.match(source, /Controllo economico interno · non esportato al cliente/);
  assert.match(source, /EDILKAPPA S\.A\.S\. DI BULLARI KLODIAN & C\./);
  assert.match(source, /Lavori di completamento e finitura degli edifici/);
  assert.match(source, /Via Sant’Ambrogio 38, 20055 Vimodrone \(MI\)/);
  assert.match(source, /PREVENTIVO DI VARIANTE/);
  assert.match(source, /ALLEGATO FOTOGRAFICO/);
  assert.match(source, /TOTALE COMPLESSIVO/);
  const cloudSource = fs.readFileSync(path.join(__dirname, "..", "firebase-cloud.js"), "utf8");
  assert.match(cloudSource, /'text\/plain'/);
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
