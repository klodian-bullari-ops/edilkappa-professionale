"use strict";

const { cleanText } = require("./ai-core");

const MAX_PDF_AUDIT_BYTES = 5 * 1024 * 1024;
const PDF_AUDIT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    passed: { type: "boolean" },
    pagesReviewed: { type: "integer", minimum: 0, maximum: 200 },
    summary: { type: "string" },
    issues: { type: "array", items: { type: "string" }, maxItems: 30 },
    warnings: { type: "array", items: { type: "string" }, maxItems: 30 }
  },
  required: ["passed", "pagesReviewed", "summary", "issues", "warnings"]
});

function parsePdfDataUrl(value) {
  const dataUrl = String(value || "");
  const match = /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("Il PDF da controllare non è valido.");
  const bytes = Math.floor(match[1].length * 3 / 4)
    - (match[1].endsWith("==") ? 2 : match[1].endsWith("=") ? 1 : 0);
  if (bytes < 100) throw new Error("Il PDF da controllare è vuoto.");
  if (bytes > MAX_PDF_AUDIT_BYTES) throw new Error("Il PDF da controllare supera 5 MB.");
  return { dataUrl, bytes };
}

function pdfAuditPrompt(artifact) {
  return cleanText([
    "Sei il controllo finale di stampa di EdilKappa. Esamina visivamente TUTTE le pagine del PDF allegato prima che sia consegnato al cliente.",
    "Segnala come issues, e imposta passed=false, se trovi testo tagliato o oltre i margini, sovrapposizioni, righe di tabella spezzate in modo illeggibile, paragrafi o elenchi separati male, intestazioni o piè di pagina sovrapposti, caratteri mancanti, pagine vuote anomale, numerazione errata oppure informazioni essenziali non leggibili.",
    "Controlla anche gli errori evidenti emersi nella stampa: durata numerica senza separatore (per esempio 710 invece di 7-10), contraddizioni visibili tra soluzione raccomandata e alternativa marcata come raccomandata, totali o IVA discordanti fra sezioni.",
    "Non riscrivere il preventivo e non inventare problemi. warnings contiene soltanto osservazioni estetiche non bloccanti. Indica il numero reale di pagine esaminate.",
    "DATI STRUTTURATI ATTESI PER IL CONFRONTO:",
    JSON.stringify(artifact || {})
  ].join("\n\n"), 60000);
}

function buildPdfAuditBody({ pdfDataUrl, artifact, model = "gpt-5.6-terra", safetyId }) {
  const parsed = parsePdfDataUrl(pdfDataUrl);
  return {
    model: cleanText(model, 120) || "gpt-5.6-terra",
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: pdfAuditPrompt(artifact) },
        { type: "input_file", filename: "preventivo-edilkappa.pdf", file_data: parsed.dataUrl }
      ]
    }],
    reasoning: { effort: "high" },
    text: {
      verbosity: "medium",
      format: {
        type: "json_schema",
        name: "edilkappa_pdf_audit",
        strict: true,
        schema: PDF_AUDIT_SCHEMA
      }
    },
    max_output_tokens: 4000,
    store: false,
    safety_identifier: cleanText(safetyId, 200)
  };
}

function responseOutputText(response) {
  const parts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  if (!parts.length && response?.output_text) parts.push(response.output_text);
  return cleanText(parts.join("\n"), 20000);
}

function normalizePdfAudit(value) {
  const issues = (Array.isArray(value?.issues) ? value.issues : []).map((item) => cleanText(item, 1000)).filter(Boolean).slice(0, 30);
  const warnings = (Array.isArray(value?.warnings) ? value.warnings : []).map((item) => cleanText(item, 1000)).filter(Boolean).slice(0, 30);
  const passed = value?.passed === true && issues.length === 0 && Number(value?.pagesReviewed || 0) > 0;
  return {
    status: passed ? "passed" : "failed",
    passed,
    pagesReviewed: Math.max(0, Math.min(200, Math.floor(Number(value?.pagesReviewed) || 0))),
    summary: cleanText(value?.summary, 2000) || (passed ? "Impaginazione controllata." : "Il PDF richiede una correzione."),
    issues,
    warnings
  };
}

function extractPdfAudit(response) {
  const text = responseOutputText(response);
  if (!text) throw new Error("Il revisore PDF non ha restituito un risultato.");
  try {
    return normalizePdfAudit(JSON.parse(text));
  } catch (_) {
    throw new Error("Il revisore PDF ha restituito un risultato non leggibile.");
  }
}

module.exports = {
  MAX_PDF_AUDIT_BYTES,
  PDF_AUDIT_SCHEMA,
  buildPdfAuditBody,
  extractPdfAudit,
  normalizePdfAudit,
  parsePdfDataUrl,
  pdfAuditPrompt,
  responseOutputText
};
