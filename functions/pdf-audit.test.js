"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PDF_AUDIT_SCHEMA,
  buildPdfAuditBody,
  extractPdfAudit,
  normalizePdfAudit,
  parsePdfDataUrl
} = require("./pdf-audit");

function samplePdfDataUrl() {
  return `data:application/pdf;base64,${Buffer.alloc(256, 7).toString("base64")}`;
}

test("accepts only bounded PDF data URLs", () => {
  assert.equal(parsePdfDataUrl(samplePdfDataUrl()).bytes, 256);
  assert.throws(() => parsePdfDataUrl("data:text/plain;base64,AAAA"), /PDF.*non è valido/i);
  assert.throws(() => parsePdfDataUrl("data:application/pdf;base64,AAAA"), /vuoto/i);
});

test("builds a strict stored-off PDF review request", () => {
  const body = buildPdfAuditBody({
    pdfDataUrl: samplePdfDataUrl(),
    artifact: { kind: "quote", title: "Preventivo di prova" },
    safetyId: "user-hash"
  });
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, "high");
  assert.equal(body.input[0].content[1].type, "input_file");
  assert.equal(body.input[0].content[1].file_data, samplePdfDataUrl());
  assert.equal(body.text.format.schema, PDF_AUDIT_SCHEMA);
  assert.match(body.input[0].content[0].text, /TUTTE le pagine/);
  assert.match(body.input[0].content[0].text, /710 invece di 7-10/);
});

test("normalizes visual findings as blocking when issues exist", () => {
  const audit = normalizePdfAudit({
    passed: true,
    pagesReviewed: 4,
    summary: "Testo oltre il margine.",
    issues: ["Pagina 3: testo tagliato"],
    warnings: []
  });
  assert.equal(audit.status, "failed");
  assert.equal(audit.passed, false);
  assert.equal(audit.pagesReviewed, 4);
});

test("extracts a successful structured PDF audit", () => {
  const payload = { passed: true, pagesReviewed: 4, summary: "Impaginazione leggibile.", issues: [], warnings: [] };
  const audit = extractPdfAudit({ output: [{ content: [{ type: "output_text", text: JSON.stringify(payload) }] }] });
  assert.equal(audit.status, "passed");
  assert.equal(audit.passed, true);
  assert.equal(audit.pagesReviewed, 4);
});
