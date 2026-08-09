"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  QUOTE_AGENT_NAME,
  QUOTE_OUTPUT_TYPE,
  createQuoteAgent,
  normalizeAgentOutput,
  serializeUsage,
  toAgentInput
} = require("./quote-agent");

function emptyReport() {
  return {
    executiveSummary: "", observations: [], probableCauses: [], evidenceFindings: [],
    recommendedVerifications: [], interventionPriority: "media", recommendedWorks: [],
    safetyNotes: [], limitations: [], conclusions: "", missingInformation: [], readyToSave: false
  };
}

test("configures one bounded Agents SDK quote specialist", () => {
  const agent = createQuoteAgent({
    instructions: "Applica il Metodo EdilKappa.",
    modelChoice: { model: "gpt-5.6-terra", reasoningEffort: "medium", verbosity: "high", maxOutputTokens: 12000 }
  });
  assert.equal(agent.name, QUOTE_AGENT_NAME);
  assert.equal(agent.model, "gpt-5.6-terra");
  assert.equal(agent.tools.length, 0);
  assert.equal(agent.handoffs.length, 0);
  assert.equal(agent.outputType, QUOTE_OUTPUT_TYPE);
  assert.equal(agent.modelSettings.store, false);
  assert.match(agent.instructions, /titolare deve controllare e approvare/i);
  assert.match(agent.instructions, /preventivo compatto e senza ripetizioni/i);
  assert.match(agent.instructions, /misure decisive/i);
  assert.match(agent.instructions, /scala, trabattello o piattaforma/i);
  assert.match(agent.instructions, /alternative soltanto quando sono tecnicamente utili/i);
  const researchAgent = createQuoteAgent({ instructions: "Preventivo.", modelChoice: {}, useWeb: true });
  assert.equal(researchAgent.tools.length, 1);
});

test("accepts only a structured quote as the final agent output", () => {
  const output = normalizeAgentOutput({
    answer: "Ho preparato una bozza da controllare.",
    artifact: {
      kind: "quote", documentType: "preventivo", title: "Prova", documentSubtitle: "",
      client: "Cliente", clientId: "", interventionId: "", address: "Via di prova 1", subject: "Prova",
      summary: "Bozza", currency: "EUR", revisionOf: "", revisionReason: "", evidence: [], uncertainties: [],
      decisionRationale: "", recommendedSolution: "", technicalAssessment: [], workPhases: [], materials: [], visualBriefs: [],
      quote: {
        lines: [{ description: "Lavorazione", quantity: 1, unit: "a corpo", unitPrice: 100, priceSource: "stima_ai", priceReference: "", confidence: "bassa", notes: "Da verificare" }],
        discountPct: 0, vatRate: 10, validityDays: 30, paymentTerms: "Da confermare", notes: "", estimatedDuration: "Da confermare",
        includedWorks: [], exclusions: [], options: [],
        pricingAnalysis: { laborCost: 0, materialCost: 0, equipmentCost: 0, transportAndDisposalCost: 0, subcontractCost: 0, overheadAndRiskCost: 0, contingencyCost: 0, estimatedDirectCost: 0, targetMarginPct: 0, proposedNetPrice: 100, rationale: [], verificationChecks: [] },
        assumptions: [], missingInformation: ["Prezzi da confermare"], readyToSave: false
      },
      report: emptyReport()
    }
  });
  assert.equal(output.artifact.kind, "quote");
  assert.equal(output.artifact.quote.readyToSave, false);
  assert.throws(() => normalizeAgentOutput({ answer: "Solo testo", artifact: null }), /bozza strutturata/i);
});

test("serializes only aggregate SDK usage fields", () => {
  assert.deepEqual(serializeUsage({ requests: 1, inputTokens: 120, outputTokens: 30, totalTokens: 150 }), {
    requests: 1, inputTokens: 120, outputTokens: 30, totalTokens: 150
  });
  assert.equal(serializeUsage(null), null);
});

test("converts the existing EdilKappa history and attachments to SDK input items", () => {
  const converted = toAgentInput([
    { role: "assistant", content: "Bozza precedente" },
    { role: "user", content: [
      { type: "input_text", text: "Prepara il preventivo" },
      { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "high" },
      { type: "input_file", filename: "rilievo.pdf", file_data: "data:application/pdf;base64,AAAA" }
    ] }
  ]);
  assert.deepEqual(converted[0], { role: "assistant", status: "completed", content: [{ type: "output_text", text: "Bozza precedente" }] });
  assert.equal(converted[1].content[1].image, "data:image/png;base64,AAAA");
  assert.equal(converted[1].content[2].file, "data:application/pdf;base64,AAAA");
});
