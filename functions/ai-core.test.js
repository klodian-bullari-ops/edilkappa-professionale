"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AI_RESPONSE_SCHEMA,
  buildInput,
  buildInstructions,
  chooseModel,
  extractGeneratedImage,
  extractAnswer,
  parseAttachments,
  parseMediaReferences
} = require("./ai-core");

test("keeps work and personal instructions separate", () => {
  const work = buildInstructions({ mode: "work", displayName: "Klodian", businessContext: { sites: 2 } });
  const personal = buildInstructions({ mode: "personal", displayName: "Klodian" });
  assert.match(work, /DATI OPERATIVI EDILKAPPA/);
  assert.match(personal, /modalità PERSONALE/);
  assert.doesNotMatch(personal, /sites/);
});

test("validates and converts image attachments", () => {
  const attachments = parseAttachments([{ name: "tetto.jpg", dataUrl: "data:image/jpeg;base64,AAAA" }]);
  const input = buildInput([], "Cosa vedi?", attachments);
  assert.equal(input[0].content[1].type, "input_text");
  assert.equal(input[0].content[2].type, "input_image");
  assert.equal(input[0].content[2].detail, "high");
});

test("labels video frames and keeps their capture time", () => {
  const attachments = parseAttachments([{
    name: "tetto-fotogramma-1.jpg",
    sourceName: "sopralluogo.mp4",
    kind: "video_frame",
    capturedAtSeconds: 12.5,
    dataUrl: "data:image/jpeg;base64,AAAA"
  }]);
  const input = buildInput([], "Analizza", attachments);
  assert.match(input[0].content[1].text, /sopralluogo\.mp4/);
  assert.match(input[0].content[1].text, /12\.5/);
  assert.equal(input[0].content[2].detail, "high");
});

test("adds video transcripts to the request", () => {
  const input = buildInput([], "Analizza", [], [{ name: "sopralluogo.mp4", text: "La perdita è vicino al pluviale." }]);
  assert.match(input[0].content[1].text, /TRASCRIZIONE AUDIO/);
  assert.match(input[0].content[1].text, /pluviale/);
});

test("routes complex construction work to GPT-5.6 Sol and simple chat to Terra", () => {
  const quote = chooseModel({ requestedModelMode: "auto", mode: "work", taskType: "quote", message: "Prepara il preventivo" });
  const simple = chooseModel({ requestedModelMode: "auto", mode: "work", taskType: "auto", message: "Ciao" });
  const forced = chooseModel({ requestedModelMode: "sol", mode: "personal", message: "Aiutami" });
  assert.equal(quote.model, "gpt-5.6-sol");
  assert.equal(quote.reasoningEffort, "high");
  assert.equal(simple.model, "gpt-5.6-terra");
  assert.equal(forced.model, "gpt-5.6-sol");
});

test("replays the previous structured quote when the user asks for a cheaper revision", () => {
  const previous = {
    role: "assistant",
    text: "Preventivo Condominio Tucidide 17.",
    artifact: {
      id: "ai-tucidide-rev01",
      kind: "quote",
      title: "Condominio Tucidide 17",
      quote: {
        lines: [{ description: "Struttura zincata modulare", quantity: 1, unit: "a corpo", unitPrice: 8200, priceSource: "stima_ai", priceReference: "", confidence: "media", notes: "" }],
        vatRate: 22
      }
    }
  };
  const input = buildInput([previous], "È troppo caro: trovami una soluzione più economica", []);
  assert.match(input[0].content, /DOCUMENTO_STRUTTURATO_PRECEDENTE/);
  assert.match(input[0].content, /Struttura zincata modulare/);
  assert.match(input[0].content, /8200/);
  assert.match(input.at(-1).content[0].text, /RICHIESTA DI REVISIONE/);
});

test("extracts a generated image safely", () => {
  const base64 = Buffer.alloc(256, 7).toString("base64");
  const image = extractGeneratedImage({ output: [{ type: "image_generation_call", result: base64 }] });
  assert.equal(image.length, 256);
  assert.equal(extractGeneratedImage({ output: [{ type: "image_generation_call", result: "not base64" }] }), null);
});

test("extracts answer and unique web citations", () => {
  const response = { output: [{ content: [{ type: "output_text", text: "Risposta", annotations: [
    { type: "url_citation", title: "Fonte", url: "https://example.com" },
    { type: "url_citation", title: "Fonte", url: "https://example.com" }
  ] }] }] };
  assert.deepEqual(extractAnswer(response), {
    answer: "Risposta",
    artifact: null,
    sources: [{ title: "Fonte", url: "https://example.com" }]
  });
});

test("extracts and normalizes a structured quote", () => {
  const payload = {
    answer: "Ho preparato la bozza.",
    artifact: {
      kind: "quote",
      title: "Ripristino copertura",
      client: "Condominio Alfa",
      clientId: "c-1",
      interventionId: "i-1",
      address: "Via Roma 1",
      subject: "Ripristino copertura",
      summary: "Bozza da verificare",
      currency: "EUR",
      quote: {
        lines: [{ description: "Manodopera", quantity: 8, unit: "h", unitPrice: 45, priceSource: "tariffario", priceReference: "MAN-01", confidence: "alta", notes: "" }],
        discountPct: 0,
        vatRate: 22,
        validityDays: 30,
        paymentTerms: "30% acconto",
        notes: "",
        assumptions: [],
        missingInformation: [],
        readyToSave: true
      },
      report: {
        executiveSummary: "",
        observations: [],
        probableCauses: [],
        recommendedWorks: [],
        safetyNotes: [],
        limitations: [],
        conclusions: "",
        missingInformation: [],
        readyToSave: false
      }
    }
  };
  const result = extractAnswer({ output: [{ content: [{ type: "output_text", text: JSON.stringify(payload) }] }] });
  assert.equal(result.artifact.kind, "quote");
  assert.equal(result.artifact.quote.lines[0].unitPrice, 45);
  assert.equal(result.artifact.quote.lines[0].priceSource, "tariffario");
});

test("accepts only archived media belonging to the authenticated user", () => {
  const path = "organisations/edilkappa/documents/user-1/ai-video/sopralluogo.mp4";
  const references = parseMediaReferences([{ storagePath: path, fileName: "sopralluogo.mp4", fileType: "video/mp4", fileSize: 1000 }], "user-1", "work");
  assert.equal(references[0].kind, "video");
  assert.throws(() => parseMediaReferences([{ storagePath: path, fileName: "x.mp4", fileType: "video/mp4" }], "user-2", "work"), /Percorso/);
  assert.deepEqual(parseMediaReferences([{ storagePath: path }], "user-1", "personal"), []);
});

test("structured response schema requires safe complete objects", () => {
  assert.equal(AI_RESPONSE_SCHEMA.additionalProperties, false);
  assert.deepEqual(AI_RESPONSE_SCHEMA.required, ["answer", "artifact"]);
  assert.ok(AI_RESPONSE_SCHEMA.properties.artifact.required.includes("quote"));
  assert.ok(AI_RESPONSE_SCHEMA.properties.artifact.required.includes("report"));
  assert.ok(AI_RESPONSE_SCHEMA.properties.artifact.required.includes("visualBriefs"));
  assert.ok(AI_RESPONSE_SCHEMA.properties.artifact.properties.quote.required.includes("options"));
});

test("rejects unsupported attachments", () => {
  assert.throws(() => parseAttachments([{ name: "video.mp4", dataUrl: "data:video/mp4;base64,AAAA" }]), /Formato non supportato/);
});
