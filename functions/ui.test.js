"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("registers the EdilKappa AI browser interface", () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = { __EDILKAPPA_AI_TEST__: true };
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
  assert.equal(typeof global.window.edilkappaAiAuditPdf, "function");
  assert.equal(typeof global.window.edilkappaAiDownloadWord, "function");
  assert.equal(typeof global.window.edilkappaAiGenerateVisual, "function");
  assert.equal(typeof global.window.edilkappaAiSetModel, "function");
  assert.equal(typeof global.window.EdilKappaAiTest.pdfTextSection, "function");
  assert.equal(typeof global.window.EdilKappaAiTest.euro, "function");
  assert.equal(typeof global.window.EdilKappaAiTest.formatEstimatedDuration, "function");
  assert.equal(typeof global.window.EdilKappaAiTest.photoCaptionForPreview, "function");
  assert.equal(typeof global.window.EdilKappaAiTest.quoteMissingQuestions, "function");
  assert.equal(typeof global.window.EdilKappaAiTest.runDocumentTable, "function");

  const missingQuestions = global.window.EdilKappaAiTest.quoteMissingQuestions({
    quote: { missingInformation: ["Aliquota IVA da confermare", "Mancano le misure della cucina"] }
  });
  assert.match(missingQuestions[0], /Quale aliquota IVA definitiva/);
  assert.match(missingQuestions[1], /stima a corpo da verificare in sopralluogo/);

  const kitchenQuestions = global.window.EdilKappaAiTest.quoteMissingQuestions({
    quote: {
      estimatedDuration: "812 giorni lavorativi",
      missingInformation: [
        "Rilevare misure della sala e della parete destinata",
        "Verificare distanza e quota dello scarico",
        "Identificare la caldaia a gas installata a parete"
      ]
    }
  });
  assert.ok(kitchenQuestions.some((item) => /lunghezza, larghezza e altezza della sala/i.test(item)));
  assert.ok(kitchenQuestions.some((item) => /distanza tra il punto acqua\/scarico/i.test(item)));
  assert.ok(kitchenQuestions.some((item) => /foto ravvicinata dell’etichetta/i.test(item)));
  assert.ok(kitchenQuestions.every((item) => !/piano a induzione/i.test(item)));
  assert.ok(kitchenQuestions.some((item) => /8-12 giorni/i.test(item)));
  assert.equal(global.window.EdilKappaAiTest.formatEstimatedDuration("8–12 giorni"), "8-12 giorni");
  assert.match(global.window.EdilKappaAiTest.formatEstimatedDuration("812 giorni"), /non è plausibile/i);
  assert.equal(global.window.EdilKappaAiTest.euro(1100), "1.100,00 €");

  const commercialCaption = global.window.EdilKappaAiTest.photoCaptionForPreview({
    report: { evidenceFindings: [{ reference: "Foto 1", observation: "Il cliente chiede pagamento 50% all'accettazione.", assessment: "Condizione commerciale" }] }
  }, { sourceName: "IMG_1001.HEIC" }, 0);
  assert.equal(commercialCaption.caption, "Stato dei luoghi documentato nella fotografia.");
  const visualCaption = global.window.EdilKappaAiTest.photoCaptionForPreview({
    report: { evidenceFindings: [{ reference: "Foto 2", observation: "Parete con rivestimento ceramico visibile.", assessment: "Supporto da verificare" }] }
  }, { sourceName: "IMG_1002.HEIC" }, 1);
  assert.match(visualCaption.caption, /rivestimento ceramico/i);
  const wrongPhotoCaption = global.window.EdilKappaAiTest.photoCaptionForPreview({
    report: { evidenceFindings: [{ reference: "Foto 10", observation: "Serramento visibile.", assessment: "Stato apparente" }] }
  }, { sourceName: "IMG_1001.HEIC" }, 0);
  assert.equal(wrongPhotoCaption.caption, "Stato dei luoghi documentato nella fotografia.");

  let fontStyle = "normal";
  let addedPages = 0;
  const bodyFonts = [];
  const fakeDocument = {
    addPage() { addedPages += 1; },
    addImage() {},
    rect() {},
    setFillColor() {},
    setFont(_name, style) { fontStyle = style; },
    setFontSize() {},
    setTextColor() {},
    splitTextToSize() { return Array.from({ length: 60 }, (_, index) => `riga-${index + 1}`); },
    text(value) { if (String(value).startsWith("riga-")) bodyFonts.push(fontStyle); }
  };
  const context = { company: { legalName: "EdilKappa", activity: "Edilizia", email: "info@example.com", phone: "000" }, logo: "", label: "PREVENTIVO" };
  global.window.EdilKappaAiTest.pdfTextSection(fakeDocument, context, "Elenco", "Testo lungo", 100);
  assert.ok(addedPages > 0);
  assert.ok(bodyFonts.length > 0);
  assert.ok(bodyFonts.every((style) => style === "normal"));

  let tableOptions;
  const fakeTableDocument = {
    autoTable(options) { tableOptions = options; this.lastAutoTable = { finalY: 80 }; }
  };
  global.window.EdilKappaAiTest.runDocumentTable(fakeTableDocument, context, { body: [["Voce"]] });
  assert.equal(tableOptions.rowPageBreak, "avoid");
  assert.equal(tableOptions.showHead, "everyPage");
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
  assert.match(source, /Conferma e salva/);
  assert.match(source, /Chiedi una modifica/);
  assert.match(source, /Anteprima preventivo/);
  assert.match(source, /Salva relazione PDF/);
  assert.match(source, /Scarica Word/);
  assert.match(source, /edilkappaAiSharePdf/);
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
  assert.match(functionSource, /recoverStaleQuoteAgentJobs/);
  assert.match(functionSource, /Agents SDK quote failed; starting Responses fallback/);
  assert.match(functionSource, /fallbackUsed: agentFallbackUsed/);
  assert.match(functionSource, /OpenAI temporary server error; retrying/);
  assert.match(functionSource, /attempt <= 3/);
  assert.match(functionSource, /retryCount \|\| 0\) >= 4/);
  assert.match(functionSource, /action === "retry_agent_job"/);
  assert.match(functionSource, /retryWithoutAttachments/);
  assert.match(functionSource, /AGENT_RUN_TIMEOUT_MS\s*=\s*8 \* 60 \* 1000/);
  assert.match(functionSource, /engine:\s*"agents_sdk"/);
  assert.match(functionSource, /approvalRequired:\s*true/);
  assert.match(source, /Preventivo · Agente SDK/);
  assert.match(source, /approvazione richiesta/);
  assert.match(functionSource, /auditArtifact/);
  assert.match(functionSource, /runQuoteReview/);
  assert.match(functionSource, /callQuoteReviewFallback/);
  assert.match(functionSource, /action === "audit_quote_pdf"/);
  assert.match(functionSource, /callPdfAudit/);
  assert.match(source, /edilkappa-ai-pending-job-v1/);
  assert.match(source, /edilkappaAiResumePending/);
  assert.match(source, /PENDING_JOB_UI_TIMEOUT_MS\s*=\s*11 \* 60 \* 1000/);
  assert.match(source, /pendingJobCanResume/);
  assert.match(source, /Riprova senza ricaricare le foto/);
  assert.match(source, /1\/2 · Analisi tecnica/);
  assert.match(source, /2\/2 · Compongo prezzi/);
  assert.match(source, /edilkappaAiRetry/);
  assert.match(source, /standardDocumentaleApprovato/);
  assert.match(source, /Contenuto revisionato/);
  assert.match(source, /Controllo visivo PDF superato/);
  assert.match(source, /Per rendere definitivo il preventivo, EdilKappa ti chiede/);
  assert.match(source, /Completa i dati mancanti/);
  assert.match(source, /Scarica PDF bozza/);
  assert.match(source, /BOZZA PRELIMINARE · NON INVIARE AL CLIENTE PRIMA DELLA CONFERMA/);
  assert.match(source, /artifactPdfBlob\(artifact, destination, await previewsForReport\(message\), \{ draft \}\)/);
  assert.match(source, /link\.download = `\$\{draft \? "BOZZA-"/);
  assert.match(source, /pdfNumberedListSection\(doc, context, "Dati da confermare"/);
  assert.match(source, /if \(!draft && !deferredSignature\)/);
  assert.match(source, /requireMessageQuoteRelease/);
  assert.match(source, /rowPageBreak:\s*"avoid"/);
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
  assert.match(functionSource, /previewDataUrl/);
  const photoSource = fs.readFileSync(path.join(__dirname, "photo-utils.js"), "utf8");
  assert.match(photoSource, /require\("heic-convert"\)/);
  assert.match(photoSource, /firebaseStorageDownloadTokens/);
  assert.match(source, /discount > 0\.005/);
  assert.match(source, /scenarioIncludedWorks/);
  assert.match(source, /\\bgestionale\\b/);
  assert.match(html, /edilkappa-ai\.js\?v=20/);
  assert.doesNotMatch(source, /const callout = artifact\.revisionReason/);
});

test("supports absences for workers and teams without false hour reminders", () => {
  const attendance = fs.readFileSync(path.join(__dirname, "..", "attendance-center.js"), "utf8");
  const hours = fs.readFileSync(path.join(__dirname, "..", "hours-closeout.js"), "utf8");
  const cloud = fs.readFileSync(path.join(__dirname, "..", "firebase-cloud.js"), "utf8");
  assert.match(attendance, /Tutta la squadra aziendale/);
  assert.match(attendance, /Uno o più operai/);
  assert.match(attendance, /Mezza giornata \/ alcune ore/);
  assert.match(attendance, /In attesa/);
  assert.match(hours, /EdilKappaAttendance\?\.isAbsent/);
  assert.match(cloud, /enablePushNotifications/);
  assert.match(cloud, /pushDevices/);
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

test("loads the central operations agents and keeps every action under confirmation", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const center = fs.readFileSync(path.join(__dirname, "..", "operations-center.js"), "utf8");
  const cloud = fs.readFileSync(path.join(__dirname, "..", "firebase-cloud.js"), "utf8");
  const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  assert.match(html, /operations-center\.js\?v=2/);
  assert.match(center, /latestAttempted: false/);
  assert.match(center, /state\.latestAttempted = true/);
  assert.match(center, /!state\.latestAttempted/);
  assert.match(serviceWorker, /v72-pdf-draft-quality/);
  assert.match(serviceWorker, /"\.\/operations-center\.js"/);
  assert.match(center, /Centro operativo EdilKappa/);
  assert.match(center, /Non inviata: serve la tua conferma/);
  assert.match(center, /Guadagno reale/);
  assert.match(cloud, /callEdilKappaOperations/);
  assert.match(cloud, /operationsRequest/);
  assert.match(backend, /generateMorningOperationsBriefing/);
  assert.match(backend, /schedule:\s*"0 7 \* \* 1-6"/);
  assert.match(backend, /action !== "refresh"/);
});

test("moves Danea intake through the authenticated Gmail bridge", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const cloud = fs.readFileSync(path.join(__dirname, "..", "firebase-cloud.js"), "utf8");
  const danea = fs.readFileSync(path.join(__dirname, "..", "danea-integration.js"), "utf8");
  const backend = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  const bridge = fs.readFileSync(path.join(__dirname, "..", "scripts", "google-apps-script-danea.gs"), "utf8");
  const manifest = fs.readFileSync(path.join(__dirname, "..", "scripts", "appsscript.json"), "utf8");
  assert.match(html, /danea-integration\.js\?v=25/);
  assert.match(html, /firebase-cloud\.js\?v=30/);
  assert.match(cloud, /daneaBridgeRequest/);
  assert.match(danea, /Outlook →/);
  assert.match(danea, /controllo Gmail ogni 5 minuti/);
  assert.match(backend, /exports\.processDaneaInbox/);
  assert.match(backend, /exports\.edilkappaDaneaBridge/);
  assert.match(backend, /document: "daneaInbox\/\{messageId\}"/);
  assert.match(backend, /exports\.edilkappaDaneaBridge = onCall\(\{[^}]*invoker: "public"/);
  assert.match(backend, /exports\.edilkappaOperations = onCall\(\{[\s\S]*?invoker: "public"/);
  assert.doesNotMatch(backend, /DANEA_INGEST_KEY/);
  assert.match(bridge, /ScriptApp\.getOAuthToken\(\)/);
  assert.match(bridge, /databases\/edilkappa\/documents\/daneaInbox/);
  assert.match(manifest, /www\.googleapis\.com\/auth\/datastore/);
  assert.match(bridge, /everyMinutes\(5\)/);
  assert.match(bridge, /no-reply@miocondominio\.eu/);
});
