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
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
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
  assert.match(source, /Automatico · Sol solo se necessario/);
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
  assert.match(source, /Le foto iPhone HEIC vengono convertite automaticamente e inserite anche nel PDF/);
  assert.match(source, /prepare_photo_preview/);
  assert.match(source, /previewStoragePath/);
  assert.match(source, /edilkappaAiDownloadSavedQuote/);
  assert.match(source, /TOTALE COMPLESSIVO/);
  const cloudSource = fs.readFileSync(path.join(__dirname, "..", "firebase-cloud.js"), "utf8");
  assert.match(cloudSource, /'text\/plain'/);
  assert.match(cloudSource, /timeout:\s*610000/);
  const functionSource = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  assert.match(functionSource, /OPENAI_REQUEST_TIMEOUT_MS\s*=\s*540000/);
  assert.match(functionSource, /timeoutSeconds:\s*600/);
  assert.match(functionSource, /deadline-exceeded/);
  assert.match(functionSource, /background:\s*true/);
  assert.match(functionSource, /action === "job_status"/);
  assert.match(functionSource, /FASE 1 — ANALISI PRELIMINARE/);
  assert.match(functionSource, /GPT‑5\.6 Terra · recupero automatico/);
  assert.match(functionSource, /automatic retry/);
  assert.match(functionSource, /quality repair/);
  assert.match(functionSource, /edilkappaQuoteAgentWorker/);
  assert.match(functionSource, /engine:\s*"agents_sdk"/);
  assert.match(functionSource, /approvalRequired:\s*true/);
  assert.match(source, /Preventivo · Agente SDK/);
  assert.match(source, /approvazione richiesta/);
  assert.match(functionSource, /auditArtifact/);
  assert.match(source, /edilkappa-ai-pending-job-v1/);
  assert.match(source, /edilkappaAiResumePending/);
  assert.match(source, /1\/2 · Analisi tecnica/);
  assert.match(source, /2\/2 · Compongo prezzi/);
  assert.match(source, /edilkappaAiRetry/);
  assert.match(source, /standardDocumentaleApprovato/);
  assert.match(source, /Controllo qualità/);
  assert.match(source, /function quoteReleaseCheck/);
  assert.match(source, /Preventivo bloccato/);
  assert.match(source, /prezzo unitario mancante o pari a zero/);
  assert.match(source, /inferiore al costo complessivo stimato/);
  assert.match(source, /normalizedReference\.includes/);
  assert.match(source, /screenshot\|schermata\|preventiv\|tabella/);
  assert.match(source, /const EDILKAPPA_PDF_FONT = "DejaVuSans"/);
  assert.match(source, /loadDocumentFonts\(doc\)/);
  assert.match(source, /DejaVuSans-EdilKappa\.ttf/);
  assert.match(source, /6 \* 1024 \* 1024/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/);
  assert.match(functionSource, /convertHeicAttachments/);
  assert.match(functionSource, /prepareArchivedHeicPhotos/);
  assert.match(functionSource, /action === "prepare_photo_preview"/);
  const photoSource = fs.readFileSync(path.join(__dirname, "photo-utils.js"), "utf8");
  assert.match(photoSource, /require\("heic-convert"\)/);
  assert.match(photoSource, /firebaseStorageDownloadTokens/);
  assert.match(source, /discount > 0\.005/);
  assert.match(source, /scenarioIncludedWorks/);
  assert.match(source, /\\bgestionale\\b/);
  assert.match(html, /edilkappa-ai\.js\?v=14/);
  assert.doesNotMatch(source, /const callout = artifact\.revisionReason/);
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
