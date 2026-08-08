"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildInput, buildInstructions, extractAnswer, parseAttachments } = require("./ai-core");

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
  assert.equal(input[0].content[1].type, "input_image");
  assert.equal(input[0].content[1].detail, "low");
});

test("extracts answer and unique web citations", () => {
  const response = { output: [{ content: [{ type: "output_text", text: "Risposta", annotations: [
    { type: "url_citation", title: "Fonte", url: "https://example.com" },
    { type: "url_citation", title: "Fonte", url: "https://example.com" }
  ] }] }] };
  assert.deepEqual(extractAnswer(response), {
    answer: "Risposta",
    sources: [{ title: "Fonte", url: "https://example.com" }]
  });
});

test("rejects unsupported attachments", () => {
  assert.throws(() => parseAttachments([{ name: "video.mp4", dataUrl: "data:video/mp4;base64,AAAA" }]), /Formato non supportato/);
});
