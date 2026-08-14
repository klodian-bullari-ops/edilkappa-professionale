"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BACKUP_STALE_MS, DANEA_STALE_MS, RESTORE_DRILL_STALE_MS, evaluateSystemHealth } = require("./health-core");

const nowMs = 2_000_000_000_000;

function healthy(overrides = {}) {
  return evaluateSystemHealth({
    nowMs,
    backup: { available: true, valid: true, verifiedAtMs: nowMs - 60_000 },
    restoreDrill: { valid: true, checkedAtMs: nowMs - 60_000, recordCount: 100 },
    danea: { lastPollAtMs: nowMs - 60_000, lastPollError: "" },
    performance: { samples24h: 8, p75LoadMs: 1800, p75LcpMs: 1400, p75Cls: 0.04, mobileSamples24h: 4 },
    appCheck: { mode: "enforce" },
    clientErrors24h: 0,
    notificationDevices: 1,
    ...overrides
  });
}

test("segnala un sistema sano con punteggio pieno", () => {
  const result = healthy();
  assert.equal(result.status, "healthy");
  assert.equal(result.score, 100);
  assert.deepEqual(result.issues, []);
});

test("blocca il verde quando il backup manca, è invalido o vecchio", () => {
  assert.equal(healthy({ backup: { available: false } }).issues[0].code, "backup_missing");
  assert.equal(healthy({ backup: { available: true, valid: false } }).issues[0].code, "backup_invalid");
  const result = healthy({ backup: { available: true, valid: true, verifiedAtMs: nowMs - BACKUP_STALE_MS - 1 } });
  assert.equal(result.status, "error");
  assert.equal(result.issues[0].code, "backup_stale");
  const reverifiedOld = healthy({ backup: { available: true, valid: true, generatedAtMs: nowMs - BACKUP_STALE_MS - 1, verifiedAtMs: nowMs } });
  assert.equal(reverifiedOld.issues[0].code, "backup_stale");
});

test("rileva un ponte Danea fermo o in errore", () => {
  assert.equal(healthy({ danea: { lastPollAtMs: nowMs - DANEA_STALE_MS - 1 } }).issues[0].code, "danea_stale");
  assert.equal(healthy({ danea: { lastPollAtMs: nowMs, lastPollError: "Mailbox non raggiungibile" } }).issues[0].code, "danea_error");
});

test("richiede una prova di ripristino recente", () => {
  assert.equal(healthy({ restoreDrill: {} }).issues[0].code, "restore_drill_waiting");
  assert.equal(healthy({ restoreDrill: { valid: false, checkedAtMs: nowMs } }).issues[0].code, "restore_drill_invalid");
  const stale = healthy({ restoreDrill: { valid: true, checkedAtMs: nowMs - RESTORE_DRILL_STALE_MS - 1 } });
  assert.equal(stale.issues[0].code, "restore_drill_stale");
});

test("valuta la velocità reale con soglie P75", () => {
  assert.equal(healthy({ performance: {} }).issues[0].code, "performance_waiting");
  const warning = healthy({ performance: { samples24h: 5, p75LoadMs: 5100, p75LcpMs: 2600, p75Cls: 0.11 } });
  assert.equal(warning.issues.some((item) => item.code === "performance_warning"), true);
  const error = healthy({ performance: { samples24h: 5, p75LoadMs: 9000, p75LcpMs: 5000, p75Cls: 0.3 } });
  assert.equal(error.issues.some((item) => item.code === "performance_slow"), true);
});

test("mantiene il punteggio sotto 100 finché App Check è solo in osservazione", () => {
  const result = healthy({ appCheck: { mode: "observe" } });
  assert.equal(result.status, "warning");
  assert.equal(result.issues.some((item) => item.code === "app_check_observe"), true);
  assert.equal(result.score < 100, true);
});

test("scala gli errori client e tratta le notifiche mancanti come avviso", () => {
  const warning = healthy({ clientErrors24h: 3, notificationDevices: 0 });
  assert.equal(warning.status, "warning");
  assert.equal(warning.warningCount, 2);
  const error = healthy({ clientErrors24h: 10 });
  assert.equal(error.status, "error");
  assert.equal(error.issues.some((item) => item.code === "client_errors_high"), true);
});
