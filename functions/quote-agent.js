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
const QUOTE_REVIEWER_NAME = "EdilKappa Revisore Preventivi";
const QUOTE_REVIEW_WORKFLOW = "EdilKappa AI · Revisione indipendente";
const QUOTE_OUTPUT_TYPE = Object.freeze({
  type: "json_schema",
  name: "edilkappa_ai_response",
  strict: true,
  schema: AI_RESPONSE_SCHEMA
});
const REVIEW_STRING_LIST_SCHEMA = {
  type: "array",
  items: { type: "string" },
  maxItems: 30
};
const QUOTE_REVIEW_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["approved", "corrected", "blocked"] },
    corrections: REVIEW_STRING_LIST_SCHEMA,
    blockingIssues: REVIEW_STRING_LIST_SCHEMA,
    warnings: REVIEW_STRING_LIST_SCHEMA,
    response: AI_RESPONSE_SCHEMA
  },
  required: ["verdict", "corrections", "blockingIssues", "warnings", "response"]
});
const QUOTE_REVIEW_OUTPUT_TYPE = Object.freeze({
  type: "json_schema",
  name: "edilkappa_quote_review",
  strict: true,
  schema: QUOTE_REVIEW_SCHEMA
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
      "Non impostare quote.readyToSave=true se mancano misure decisive. Indica ogni dato mancante in quote.missingInformation come domanda diretta e specifica, chiarendo cosa deve rispondere il titolare. Se una misura non è disponibile, chiedi se autorizza una stima a corpo da verificare in sopralluogo; sono ammesse ipotesi a corpo soltanto se dichiarate chiaramente e accettate dall'utente.",
      "Descrivi sempre il mezzo di accesso o l'apprestamento previsto (per esempio scala, trabattello o piattaforma); se non è determinabile, inseriscilo tra i dati da confermare e non nasconderlo in una voce generica.",
      "Proponi alternative soltanto quando sono tecnicamente utili e descrivi per ciascuna le opere comprese, le differenze e l'imponibile.",
      "Non inserire nel preventivo cliente istruzioni interne sul gestionale, sul salvataggio, su clientId o interventionId.",
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

function buildQuoteReviewerInstructions(instructions) {
  return [
    cleanText(instructions, 100000),
    "RUOLO REVISORE INDIPENDENTE: non fidarti della bozza né del suo campo readyToSave. Ricontrolla la richiesta originale, gli allegati e ogni dato del preventivo.",
    "Esegui un controllo editoriale, tecnico, economico e contrattuale completo. Non limitarti agli errori già segnalati dal primo controllo.",
    "Verifica almeno: somme, sconti e IVA; durata e intervalli numerici (per esempio 710 invece di 7-10 è un errore bloccante); coerenza fra titolo, opere promesse, voci, opere comprese ed esclusioni; una sola alternativa raccomandata e assenza di contraddizioni fra gas e induzione; misure e fattibilità decisive; caldaia, cappa, scarichi e accessi quando pertinenti; chiarezza di fornitura, posa e adattamenti per top, zoccolo, mobili e cappa; Dichiarazione di Conformità (Di.Co.) per modifiche agli impianti; ambiguità nei pagamenti; refusi e testo destinato al cliente.",
    "Se il titolo promette una trasformazione completa ma le finiture o le verifiche necessarie sono escluse, riduci correttamente la promessa oppure blocca la bozza. Non presentare come camera abitabile un locale senza le verifiche pertinenti.",
    "Correggi direttamente soltanto ciò che è sostenuto dai dati. Non inventare misure, aliquote, conformità, autorizzazioni, materiali, prezzi o esiti di sopralluogo.",
    "Usa verdict=corrected quando hai corretto in sicurezza la risposta. Usa verdict=approved soltanto se non serve alcuna correzione. Usa verdict=blocked quando manca un dato decisivo o resta una contraddizione; in tal caso imposta response.artifact.quote.readyToSave=false e descrivi ogni blocco in blockingIssues.",
    "Ogni correzione deve comparire sia in corrections sia nella response restituita. warnings contiene soltanto osservazioni non bloccanti.",
    "Restituisci esclusivamente l'oggetto strutturato richiesto. Non salvare, non condividere e non approvare per conto del titolare."
  ].filter(Boolean).join("\n\n");
}

function createQuoteReviewer({ instructions, modelChoice }) {
  const choice = modelChoice || {};
  const requestedEffort = cleanText(choice.reasoningEffort, 20);
  const reasoningEffort = ["high", "xhigh"].includes(requestedEffort) ? requestedEffort : "high";
  return new Agent({
    name: QUOTE_REVIEWER_NAME,
    handoffDescription: "Controlla in modo indipendente e corregge una bozza di preventivo prima del rilascio.",
    instructions: buildQuoteReviewerInstructions(instructions),
    model: cleanText(choice.model, 120) || "gpt-5.6-terra",
    modelSettings: {
      reasoning: { effort: reasoningEffort },
      text: { verbosity: "high" },
      maxTokens: Math.max(4000, Math.min(18000, Number(choice.maxOutputTokens) || 16000)),
      store: false
    },
    outputType: QUOTE_REVIEW_OUTPUT_TYPE,
    tools: [],
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

function normalizeReviewList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, 1000))
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeQuoteReview(value) {
  const response = normalizeAgentOutput(value?.response);
  const blockingIssues = normalizeReviewList(value?.blockingIssues);
  const requestedVerdict = ["approved", "corrected", "blocked"].includes(value?.verdict)
    ? value.verdict
    : "blocked";
  const verdict = blockingIssues.length ? "blocked" : requestedVerdict;
  if (verdict === "blocked") response.artifact.quote.readyToSave = false;
  return {
    verdict,
    corrections: normalizeReviewList(value?.corrections),
    blockingIssues,
    warnings: normalizeReviewList(value?.warnings),
    response
  };
}

function buildQuoteReviewPrompt(draft, initialAudit) {
  return cleanText([
    "REVISIONE FINALE OBBLIGATORIA DELLA BOZZA SEGUENTE.",
    "Confrontala con tutta la richiesta originale e con gli allegati presenti nello stesso input.",
    "BOZZA_STRUTTURATA:",
    JSON.stringify({ answer: draft?.answer || "", artifact: draft?.artifact || null }),
    "PRIMO_CONTROLLO_DETERMINISTICO:",
    JSON.stringify({
      score: Number(initialAudit?.score || 0),
      passed: initialAudit?.passed === true,
      issues: Array.isArray(initialAudit?.issues) ? initialAudit.issues : []
    }),
    "Restituisci il preventivo completo corretto nel campo response, anche quando il verdetto è blocked."
  ].join("\n\n"), 100000);
}

function mergeQuoteAudit(deterministicAudit, review) {
  const audit = deterministicAudit || { score: 0, passed: false, blocking: true, checks: [], issues: [], blockingIssues: [] };
  const reviewerPassed = review?.verdict !== "blocked" && !(review?.blockingIssues || []).length;
  const reviewerDetail = reviewerPassed
    ? (review?.verdict === "corrected" ? "bozza corretta e ricontrollata" : "bozza ricontrollata senza correzioni")
    : ((review?.blockingIssues || ["revisione indipendente non superata"])[0]);
  const reviewerCheck = {
    label: "Revisione AI indipendente",
    passed: reviewerPassed,
    detail: cleanText(reviewerDetail, 500),
    blocking: !reviewerPassed
  };
  const reviewIssues = reviewerPassed ? [] : (review?.blockingIssues || ["Revisione AI indipendente non completata."])
    .map((item) => `Revisione AI indipendente: ${cleanText(item, 500)}`);
  const issues = Array.from(new Set([...(audit.issues || []), ...reviewIssues]));
  const blockingIssues = Array.from(new Set([...(audit.blockingIssues || []), ...reviewIssues]));
  const passed = audit.passed === true && reviewerPassed;
  return {
    ...audit,
    score: reviewerPassed ? Number(audit.score || 0) : Math.min(Number(audit.score || 0), 70),
    passed,
    blocking: audit.blocking === true || !reviewerPassed,
    checks: [...(audit.checks || []), reviewerCheck],
    issues,
    blockingIssues,
    reviewer: {
      verdict: review?.verdict || "blocked",
      corrections: review?.corrections || [],
      blockingIssues: review?.blockingIssues || ["Revisore automatico non disponibile."],
      warnings: review?.warnings || []
    }
  };
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

async function runQuoteReview({ apiKey, instructions, input, draft, initialAudit, modelChoice, conversationId, userId, signal }) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY non disponibile per il revisore preventivi.");
  setDefaultOpenAIKey(key);
  setOpenAIAPI("responses");

  const reviewer = createQuoteReviewer({ instructions, modelChoice });
  const runner = new Runner({
    workflowName: QUOTE_REVIEW_WORKFLOW,
    groupId: cleanText(conversationId, 120) || undefined,
    traceMetadata: {
      application: "edilkappa-ai",
      agent: "revisore-preventivi",
      user: cleanText(userId, 120) || "unknown"
    },
    traceIncludeSensitiveData: false,
    tracingDisabled: false
  });
  const reviewInput = toAgentInput(input);
  if (!reviewInput.length) throw new Error("Input non disponibile per il revisore preventivi.");
  reviewInput.push({
    role: "user",
    content: [{ type: "input_text", text: buildQuoteReviewPrompt(draft, initialAudit) }]
  });
  const result = await runner.run(reviewer, reviewInput, { maxTurns: 1, signal });
  return {
    ...normalizeQuoteReview(result.finalOutput),
    responseId: cleanText(result.lastResponseId, 200),
    usage: serializeUsage(result.state?.usage)
  };
}

module.exports = {
  QUOTE_AGENT_NAME,
  QUOTE_AGENT_WORKFLOW,
  QUOTE_OUTPUT_TYPE,
  QUOTE_REVIEWER_NAME,
  QUOTE_REVIEW_SCHEMA,
  QUOTE_REVIEW_OUTPUT_TYPE,
  buildQuoteReviewPrompt,
  buildQuoteReviewerInstructions,
  createQuoteAgent,
  createQuoteReviewer,
  mergeQuoteAudit,
  normalizeAgentOutput,
  normalizeQuoteReview,
  runQuoteAgent,
  runQuoteReview,
  serializeUsage,
  toAgentInput
};
