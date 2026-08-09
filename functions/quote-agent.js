"use strict";

const {
  Agent,
  Runner,
  setDefaultOpenAIKey,
  setOpenAIAPI,
  webSearchTool
} = require("@openai/agents");
const {
  AI_RESPONSE_SCHEMA,
  cleanText,
  normalizeArtifact
} = require("./ai-core");

const QUOTE_AGENT_NAME = "EdilKappa Preventivi";
const QUOTE_AGENT_WORKFLOW = "EdilKappa AI · Preventivi";
const QUOTE_OUTPUT_TYPE = Object.freeze({
  type: "json_schema",
  name: "edilkappa_ai_response",
  strict: true,
  schema: AI_RESPONSE_SCHEMA
});

function createQuoteAgent({ instructions, modelChoice, useWeb = false }) {
  const choice = modelChoice || {};
  return new Agent({
    name: QUOTE_AGENT_NAME,
    handoffDescription: "Prepara e revisiona preventivi EdilKappa strutturati, senza salvarli autonomamente.",
    instructions: [
      cleanText(instructions, 100000),
      "RUOLO AGENTE: sei lo specialista unico dei preventivi EdilKappa.",
      "Concludi il lavoro in questo turno: non delegare, non eseguire handoff e non chiedere di salvare automaticamente.",
      "Il risultato è sempre una bozza. Il titolare deve controllare e approvare cliente, intervento, misure, prezzi, IVA e condizioni prima del salvataggio.",
      "Scrivi un preventivo compatto e senza ripetizioni: sintesi di 2-4 frasi, valutazione tecnica fino a 6 punti, 5-9 fasi operative e 4-8 gruppi di materiali, salvo reale necessità documentale.",
      "Non impostare quote.readyToSave=true se mancano misure decisive. Indica ogni misura mancante in quote.missingInformation; sono ammesse ipotesi a corpo soltanto se dichiarate chiaramente e accettate dall'utente.",
      "Descrivi sempre il mezzo di accesso o l'apprestamento previsto (per esempio scala, trabattello o piattaforma); se non è determinabile, inseriscilo tra i dati da confermare e non nasconderlo in una voce generica.",
      "Proponi alternative soltanto quando sono tecnicamente utili e descrivi per ciascuna le opere comprese, le differenze e l'imponibile.",
      "Restituisci esclusivamente l'oggetto strutturato richiesto. Per un preventivo usa artifact.kind=quote e artifact.documentType=preventivo o variante."
    ].filter(Boolean).join("\n\n"),
    model: cleanText(choice.model, 120) || "gpt-5.6-terra",
    modelSettings: {
      reasoning: { effort: cleanText(choice.reasoningEffort, 20) || "medium" },
      text: { verbosity: cleanText(choice.verbosity, 20) || "high" },
      maxTokens: Math.max(1000, Math.min(18000, Number(choice.maxOutputTokens) || 18000)),
      store: false
    },
    outputType: QUOTE_OUTPUT_TYPE,
    tools: useWeb ? [webSearchTool({
      searchContextSize: "medium",
      userLocation: { type: "approximate", country: "IT", city: "Milano", region: "Lombardia" }
    })] : [],
    handoffs: []
  });
}

function normalizeAgentOutput(value) {
  const answer = cleanText(value?.answer, 20000);
  const artifact = normalizeArtifact(value?.artifact);
  if (!answer || artifact?.kind !== "quote") {
    throw new Error("L'agente preventivi non ha prodotto una bozza strutturata completa.");
  }
  return { answer, artifact, sources: [] };
}

function toAgentInput(value) {
  return (Array.isArray(value) ? value : []).map((item) => {
    if (item?.role === "assistant") {
      const text = typeof item.content === "string"
        ? item.content
        : (Array.isArray(item.content) ? item.content.map((part) => part?.text || "").join("\n") : "");
      return { role: "assistant", status: "completed", content: [{ type: "output_text", text: cleanText(text, 24000) }] };
    }
    if (item?.role !== "user") return null;
    if (typeof item.content === "string") return { role: "user", content: cleanText(item.content, 24000) };
    const content = (Array.isArray(item.content) ? item.content : []).map((part) => {
      if (part?.type === "input_text") return { type: "input_text", text: cleanText(part.text, 24000) };
      if (part?.type === "input_image" && part.image_url) {
        return { type: "input_image", image: part.image_url, detail: cleanText(part.detail, 20) || "auto" };
      }
      if (part?.type === "input_file" && part.file_data) {
        return { type: "input_file", file: part.file_data, filename: cleanText(part.filename, 240) || "allegato" };
      }
      return null;
    }).filter(Boolean);
    return content.length ? { role: "user", content } : null;
  }).filter(Boolean);
}

function serializeUsage(usage) {
  if (!usage) return null;
  return {
    requests: Number(usage.requests || 0),
    inputTokens: Number(usage.inputTokens || 0),
    outputTokens: Number(usage.outputTokens || 0),
    totalTokens: Number(usage.totalTokens || 0)
  };
}

async function runQuoteAgent({ apiKey, instructions, input, modelChoice, useWeb, conversationId, userId, signal }) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY non disponibile per l'agente preventivi.");
  setDefaultOpenAIKey(key);
  setOpenAIAPI("responses");

  const agent = createQuoteAgent({ instructions, modelChoice, useWeb });
  const runner = new Runner({
    workflowName: QUOTE_AGENT_WORKFLOW,
    groupId: cleanText(conversationId, 120) || undefined,
    traceMetadata: {
      application: "edilkappa-ai",
      agent: "preventivi",
      user: cleanText(userId, 120) || "unknown"
    },
    traceIncludeSensitiveData: false,
    tracingDisabled: false
  });
  const agentInput = toAgentInput(input);
  if (!agentInput.length) throw new Error("Input non disponibile per l'agente preventivi.");
  const result = await runner.run(agent, agentInput, {
    maxTurns: useWeb ? 3 : 1,
    signal
  });
  const output = normalizeAgentOutput(result.finalOutput);
  return {
    ...output,
    responseId: cleanText(result.lastResponseId, 200),
    usage: serializeUsage(result.state?.usage)
  };
}

module.exports = {
  QUOTE_AGENT_NAME,
  QUOTE_AGENT_WORKFLOW,
  QUOTE_OUTPUT_TYPE,
  createQuoteAgent,
  normalizeAgentOutput,
  runQuoteAgent,
  serializeUsage,
  toAgentInput
};
