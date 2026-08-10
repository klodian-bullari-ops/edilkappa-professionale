"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDaneaMessage, stableId } = require("./danea-outlook");

test("imports only authentic Danea request emails", () => {
  const parsed = parseDaneaMessage({ id: "graph-1", internetMessageId: "<mail-1@test>", subject: "Richiesta intervento - infiltrazione", receivedDateTime: "2026-08-10T08:30:00Z", from: { emailAddress: { address: "no-reply@miocondominio.eu" } }, body: { contentType: "html", content: "<p>Codice attività: 45678</p><p>Studio: Rossi</p><p>Condominio: Aurora</p><p>Indirizzo: Via Roma 1</p><a href=\"https://fornitori.miocondominio.eu/interventi/45678\">Apri</a>" } });
  assert.equal(parsed.daneaId, "45678");
  assert.equal(parsed.studio, "Rossi");
  assert.equal(parsed.client, "Aurora");
  assert.match(parsed.sourceUrl, /^https:\/\/fornitori\.miocondominio\.eu/);
  assert.equal(parseDaneaMessage({ subject: "Richiesta intervento", from: { emailAddress: { address: "truffa@example.com" } } }), null);
});

test("uses stable ids for Gmail bridge deduplication", () => {
  assert.equal(stableId("danea-mail", ["ABC"]), stableId("danea-mail", ["abc"]));
});
