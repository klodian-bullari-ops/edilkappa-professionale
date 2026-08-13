"use strict";

const BACKUP_STALE_MS = 36 * 60 * 60 * 1000;
const DANEA_STALE_MS = 30 * 60 * 1000;

function finite(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function evaluateSystemHealth(input = {}) {
  const nowMs = finite(input.nowMs) || Date.now();
  const backup = input.backup || {};
  const danea = input.danea || {};
  const errors = Math.max(0, finite(input.clientErrors24h));
  const devices = Math.max(0, finite(input.notificationDevices));
  const issues = [];
  const add = (code, severity, title, detail) => issues.push({ code, severity, title, detail });

  const backupAtMs = finite(backup.generatedAtMs || backup.verifiedAtMs);
  if (!backup.available) {
    add("backup_missing", "error", "Backup non disponibile", "Non risulta ancora un backup verificato e ripristinabile.");
  } else if (backup.valid !== true) {
    add("backup_invalid", "error", "Backup da verificare", "L’ultimo backup non ha superato il controllo di integrità.");
  } else if (!backupAtMs || nowMs - backupAtMs > BACKUP_STALE_MS) {
    add("backup_stale", "error", "Backup non aggiornato", "L’ultimo backup valido risale a oltre 36 ore fa.");
  }

  const daneaAtMs = finite(danea.lastPollAtMs);
  if (danea.lastPollError) {
    add("danea_error", "error", "Collegamento Danea in errore", String(danea.lastPollError).slice(0, 300));
  } else if (!daneaAtMs) {
    add("danea_waiting", "warning", "Collegamento Danea da confermare", "Non è ancora arrivato il primo controllo automatico.");
  } else if (nowMs - daneaAtMs > DANEA_STALE_MS) {
    add("danea_stale", "error", "Collegamento Danea fermo", "Il controllo automatico non risponde da oltre 30 minuti.");
  }

  if (errors >= 10) add("client_errors_high", "error", "Troppi errori applicativi", `${errors} errori client registrati nelle ultime 24 ore.`);
  else if (errors >= 3) add("client_errors_warning", "warning", "Errori applicativi da controllare", `${errors} errori client registrati nelle ultime 24 ore.`);

  if (!devices) add("notifications_missing", "warning", "Nessun dispositivo notifiche", "Attiva almeno un dispositivo per ricevere gli avvisi operativi.");

  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.filter((item) => item.severity === "warning").length;
  return {
    status: errorCount ? "error" : warningCount ? "warning" : "healthy",
    score: Math.max(0, 100 - (errorCount * 25) - (warningCount * 8)),
    checkedAtMs: nowMs,
    errorCount,
    warningCount,
    clientErrors24h: errors,
    notificationDevices: devices,
    issues
  };
}

module.exports = { BACKUP_STALE_MS, DANEA_STALE_MS, evaluateSystemHealth };
