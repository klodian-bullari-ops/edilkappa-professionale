"use strict";

const { Agent, Runner, setDefaultOpenAIKey, setOpenAIAPI } = require("@openai/agents");

const OPERATIONS_AGENT_NAME = "EdilKappa Coordinatore Operativo";
const OPERATIONS_WORKFLOW = "EdilKappa · Coordinamento operativo";
const OPERATIONS_OUTPUT_TYPE = Object.freeze({
  type: "json_schema",
  name: "edilkappa_operations_briefing",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["headline", "summary", "priorities", "agentReports", "draftMessages", "warnings"],
    properties: {
      headline: { type: "string" },
      summary: { type: "string" },
      priorities: { type: "array", items: { type: "object", additionalProperties: false, required: ["rank", "severity", "category", "title", "reason", "recommendedAction", "evidenceIds", "requiresConfirmation"], properties: {
        rank: { type: "integer" }, severity: { type: "string", enum: ["high", "medium", "low"] }, category: { type: "string" }, title: { type: "string" }, reason: { type: "string" }, recommendedAction: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } }, requiresConfirmation: { type: "boolean" }
      } } },
      agentReports: { type: "array", items: { type: "object", additionalProperties: false, required: ["agent", "status", "finding", "nextAction"], properties: { agent: { type: "string" }, status: { type: "string", enum: ["ok", "attention", "urgent"] }, finding: { type: "string" }, nextAction: { type: "string" } } } },
      draftMessages: { type: "array", items: { type: "object", additionalProperties: false, required: ["channel", "recipient", "subject", "body", "evidenceIds", "requiresConfirmation"], properties: { channel: { type: "string", enum: ["email", "whatsapp"] }, recipient: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } }, requiresConfirmation: { type: "boolean" } } } },
      warnings: { type: "array", items: { type: "string" } }
    }
  }
});

function specialist(name, instructions, model) {
  return new Agent({
    name,
    instructions: `${instructions}\nUsa soltanto i fatti e gli identificativi presenti nell’input. Non inventare date, importi, persone o stati. Non eseguire azioni e non dichiarare che un messaggio è stato inviato. Rispondi in italiano con un rapporto operativo sintetico.`,
    model,
    modelSettings: { reasoning: { effort: "low" }, text: { verbosity: "medium" }, maxTokens: 1800, store: false },
    handoffs: [],
    tools: []
  });
}

function createOperationsAgents({ model = "gpt-5.6-terra" } = {}) {
  const sites = specialist("Agente Cantieri", "Controlla avanzamento, rapportini, fotografie iniziali/finali, ore, assenze e lavori fermi.", model);
  const quotes = specialist("Agente Preventivi", "Controlla bozze, preventivi senza risposta, prezzi da verificare e collegamenti con costi reali. Non modificare il listino DEI.", model);
  const administration = specialist("Agente Amministrativo", "Controlla richieste, preventivi inviati o accettati, pagamenti, documenti e scadenze. Puoi proporre bozze di email o WhatsApp, mai inviarle.", model);
  const profit = specialist("Agente Guadagno Reale", "Confronta ricavi, costi registrati, consuntivi e margini. Evidenzia dati mancanti e lavori con margine basso o negativo.", model);
  const notifications = specialist("Agente Notifiche", "Ordina gli avvisi in urgente oggi, nuove richieste, cantieri fermi, foto, ore mancanti, pagamenti e scadenze. Elimina duplicati.", model);
  const tools = [
    sites.asTool({ toolName: "controlla_cantieri", toolDescription: "Analizza cantieri, rapportini, foto, ore e assenze." }),
    quotes.asTool({ toolName: "controlla_preventivi", toolDescription: "Analizza preventivi, prezzi e dati da verificare." }),
    administration.asTool({ toolName: "controlla_amministrazione", toolDescription: "Analizza richieste, solleciti, pagamenti e scadenze." }),
    profit.asTool({ toolName: "controlla_guadagno", toolDescription: "Analizza utile previsto e reale dei lavori." }),
    notifications.asTool({ toolName: "ordina_notifiche", toolDescription: "Costruisce un centro notifiche senza duplicati." })
  ];
  const central = new Agent({
    name: OPERATIONS_AGENT_NAME,
    instructions: [
      "Sei il coordinatore operativo centrale di EdilKappa.",
      "Per il riepilogo completo usa una volta ciascuno dei cinque specialisti disponibili e poi componi una sola risposta strutturata.",
      "I fatti deterministici ricevuti sono l’unica fonte di verità: non cambiare conteggi o importi e cita gli id delle priorità in evidenceIds.",
      "Non creare clienti, interventi, cantieri o preventivi e non inviare comunicazioni. Proponi l’azione e imposta requiresConfirmation=true per ogni modifica o messaggio.",
      "Il listino DEI non può essere modificato dall’agente. Prezzi e quantità stimati devono restare da verificare.",
      "Dai precedenza a sicurezza, richieste nuove non collegate, cantieri fermi, ore mancanti, scadenze e pagamenti."
    ].join("\n"),
    model,
    modelSettings: { reasoning: { effort: "medium" }, text: { verbosity: "medium" }, maxTokens: 6500, store: false },
    outputType: OPERATIONS_OUTPUT_TYPE,
    tools,
    handoffs: []
  });
  return { central, specialists: { sites, quotes, administration, profit, notifications } };
}

function normalizeOperationsOutput(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.priorities) || !Array.isArray(value.agentReports)) throw new Error("Il coordinatore operativo non ha prodotto un riepilogo valido.");
  return {
    headline: String(value.headline || "Riepilogo operativo EdilKappa").slice(0, 180),
    summary: String(value.summary || "").slice(0, 3000),
    priorities: value.priorities.slice(0, 20),
    agentReports: value.agentReports.slice(0, 10),
    draftMessages: Array.isArray(value.draftMessages) ? value.draftMessages.slice(0, 10) : [],
    warnings: Array.isArray(value.warnings) ? value.warnings.slice(0, 20).map((item) => String(item).slice(0, 500)) : []
  };
}

async function runOperationsAgent({ apiKey, snapshot, model = "gpt-5.6-terra", groupId = "morning", signal }) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY non disponibile per il coordinatore operativo.");
  setDefaultOpenAIKey(key);
  setOpenAIAPI("responses");
  const { central } = createOperationsAgents({ model });
  const runner = new Runner({ workflowName: OPERATIONS_WORKFLOW, groupId: String(groupId).slice(0, 120), traceMetadata: { application: "edilkappa", agent: "operations" }, traceIncludeSensitiveData: false, tracingDisabled: false });
  const result = await runner.run(central, `Prepara il briefing operativo usando questi fatti deterministici:\n${JSON.stringify(snapshot)}`, { maxTurns: 8, signal });
  return { briefing: normalizeOperationsOutput(result.finalOutput), responseId: String(result.lastResponseId || "").slice(0, 200), usage: result.state?.usage || null };
}

module.exports = { OPERATIONS_AGENT_NAME, OPERATIONS_OUTPUT_TYPE, OPERATIONS_WORKFLOW, createOperationsAgents, normalizeOperationsOutput, runOperationsAgent };
