"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { OPERATIONS_AGENT_NAME, OPERATIONS_OUTPUT_TYPE, createOperationsAgents, normalizeOperationsOutput } = require("./operations-agent");

test("configures one central manager with five bounded specialist agents", () => {
  const { central, specialists } = createOperationsAgents({ model: "gpt-5.6-terra" });
  assert.equal(central.name, OPERATIONS_AGENT_NAME);
  assert.equal(central.model, "gpt-5.6-terra");
  assert.equal(central.outputType, OPERATIONS_OUTPUT_TYPE);
  assert.equal(central.tools.length, 5);
  assert.equal(central.handoffs.length, 0);
  assert.deepEqual(Object.keys(specialists).sort(), ["administration", "notifications", "profit", "quotes", "sites"]);
  Object.values(specialists).forEach((agent) => {
    assert.equal(agent.tools.length, 0);
    assert.equal(agent.handoffs.length, 0);
    assert.equal(agent.modelSettings.store, false);
    assert.match(agent.instructions, /non eseguire azioni/i);
  });
  assert.match(central.instructions, /requiresConfirmation=true/);
  assert.match(central.instructions, /non può essere modificato dall’agente/i);
});

test("accepts only a structured operational briefing", () => {
  const output = normalizeOperationsOutput({ headline: "Oggi", summary: "Controlla le urgenze", priorities: [], agentReports: [], draftMessages: [], warnings: [] });
  assert.equal(output.headline, "Oggi");
  assert.throws(() => normalizeOperationsOutput({ headline: "Non valido" }), /riepilogo valido/i);
});
