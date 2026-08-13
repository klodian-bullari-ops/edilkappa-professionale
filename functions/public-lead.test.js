"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DAILY_SUBMISSION_LIMIT,
  MAX_PHOTO_BYTES,
  MIN_SUBMISSION_INTERVAL_MS,
  PublicLeadError,
  evaluateRateRecord,
  newPublicLeadId,
  nextRateRecord,
  publicLeadFingerprint,
  publicLeadPayload,
  publicLeadRateKey,
  validatePublicLeadInput
} = require("./public-lead");

const now = Date.parse("2026-08-12T12:00:00.000Z");

function validInput(overrides = {}) {
  return {
    requestId: "request-1234567890-abcdef",
    openedAtMs: now - 5000,
    website: "",
    privacy: true,
    name: "Condominio Qualità",
    phone: "+39 333 1234567",
    email: "amministratore@example.com",
    contactPreference: "Telefono",
    address: "Via Qualità 10, Milano",
    request: "Richiedo un sopralluogo per una perdita dal tetto.",
    photos: [`data:image/jpeg;base64,${Buffer.from("foto").toString("base64")}`],
    ...overrides
  };
}

test("valida e normalizza una richiesta pubblica completa", () => {
  const result = validatePublicLeadInput(validInput(), now);
  assert.equal(result.email, "amministratore@example.com");
  assert.equal(result.photos.length, 1);
  assert.match(result.photos[0], /^data:image\/jpeg;base64,/);
});

test("rifiuta bot, moduli troppo rapidi e fotografie eccessive", () => {
  assert.throws(() => validatePublicLeadInput(validInput({ website: "spam" }), now), PublicLeadError);
  assert.throws(() => validatePublicLeadInput(validInput({ openedAtMs: now - 100 }), now), /Riapri il modulo/);
  const oversized = `data:image/jpeg;base64,${Buffer.alloc(MAX_PHOTO_BYTES + 1).toString("base64")}`;
  assert.throws(() => validatePublicLeadInput(validInput({ photos: [oversized] }), now), /supera il limite/);
});

test("genera identificativi server e impronte deterministiche senza conservare l'IP", () => {
  const lead = validatePublicLeadInput(validInput(), now);
  const id = newPublicLeadId(now);
  assert.match(id, /^lead-[a-z0-9]+-[a-f0-9]{16}$/);
  assert.equal(publicLeadFingerprint(lead), publicLeadFingerprint({ ...lead }));
  const key = publicLeadRateKey({ headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" } }, now);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /203\.0\.113\.10/);
  const payload = publicLeadPayload(lead, id, now);
  assert.equal(payload.source, "Modulo pubblico protetto");
  assert.equal(payload.status, "Nuova");
});

test("riconosce i duplicati e applica intervallo e limite giornaliero", () => {
  const current = { count: 1, lastAtMs: now - 1000, lastFingerprint: "same", lastLeadId: "lead-existing" };
  assert.equal(evaluateRateRecord(current, "same", now).duplicateLeadId, "lead-existing");
  assert.throws(() => evaluateRateRecord({ ...current, lastFingerprint: "other" }, "new", now), /Attendi qualche secondo/);
  assert.throws(() => evaluateRateRecord({ count: DAILY_SUBMISSION_LIMIT, lastAtMs: now - MIN_SUBMISSION_INTERVAL_MS }, "new", now), /Limite giornaliero/);
  const next = nextRateRecord({ current: { count: 3 }, fingerprint: "new", leadId: "lead-new", nowMs: now });
  assert.equal(next.count, 4);
  assert.equal(next.lastLeadId, "lead-new");
  assert.ok(next.expiresAtMs > now);
});
