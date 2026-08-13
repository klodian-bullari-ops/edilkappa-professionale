"use strict";

const BACKUP_STALE_MS = 36 * 60 * 60 * 1000;
const DANEA_STALE_MS = 30 * 60 * 1000;
const RESTORE_DRILL_STALE_MS = 48 * 60 * 60 * 1000;

function finite(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function evaluateSystemHealth(input = {}) {
  const nowMs = finite(input.nowMs) || Date.now();
  const backup = input.backup || {};
  const restoreDrill = input.restoreDrill || {};
  const danea = input.danea || {};
  const performance = input.performance || {};
  const appCheck = input.appCheck || {};
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

  const restoreCheckedAtMs = finite(restoreDrill.checkedAtMs);
  if (!restoreCheckedAtMs) {
    add("restore_drill_waiting", "warning", "Prova di ripristino da eseguire", "Il prossimo backup notturno proverà anche la ricostruzione completa dei dati.");
  } else if (restoreDrill.valid !== true) {
    add("restore_drill_invalid", "error", "Ripristino non verificato", "L’ultima prova di recupero del backup non è valida.");
  } else if (nowMs - restoreCheckedAtMs > RESTORE_DRILL_STALE_MS) {
    add("restore_drill_stale", "error", "Prova di ripristino non aggiornata", "Il recupero dei backup non viene verificato da oltre 48 ore.");
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

  const appCheckMode = appCheck.mode === "enforce" ? "enforce" : "observe";
  if (appCheckMode !== "enforce") {
    add("app_check_observe", "warning", "App Check ancora in osservazione", "Dopo aver verificato computer e telefoni, passa a enforce per bloccare le chiamate non certificate.");
  }

  const samples = Math.max(0, finite(performance.samples24h));
  const p75LoadMs = Math.max(0, finite(performance.p75LoadMs));
  const p75LcpMs = Math.max(0, finite(performance.p75LcpMs));
  const p75Cls = Math.max(0, finite(performance.p75Cls));
  if (!samples) {
    add("performance_waiting", "warning", "Velocità reale da misurare", "Apri il gestionale da computer e telefono per completare il primo controllo prestazioni.");
  } else if (p75LcpMs > 4000 || p75Cls > 0.25 || p75LoadMs > 8000) {
    add("performance_slow", "error", "Gestionale lento sui dispositivi reali", `Valori P75: apertura ${Math.round(p75LoadMs)} ms, contenuto ${Math.round(p75LcpMs)} ms, stabilità ${p75Cls.toFixed(3)}.`);
  } else if (p75LcpMs > 2500 || p75Cls > 0.1 || p75LoadMs > 5000) {
    add("performance_warning", "warning", "Prestazioni da ottimizzare", `Valori P75: apertura ${Math.round(p75LoadMs)} ms, contenuto ${Math.round(p75LcpMs)} ms, stabilità ${p75Cls.toFixed(3)}.`);
  }

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
    appCheck: { mode: appCheckMode, enforced: appCheckMode === "enforce" },
    restoreDrill: {
      valid: restoreDrill.valid === true,
      checkedAtMs: restoreCheckedAtMs,
      recordCount: Math.max(0, finite(restoreDrill.recordCount))
    },
    performance: {
      samples24h: samples,
      p75LoadMs,
      p75LcpMs,
      p75Cls,
      mobileSamples24h: Math.max(0, finite(performance.mobileSamples24h)),
      offlineSamples24h: Math.max(0, finite(performance.offlineSamples24h))
    },
    issues
  };
}

module.exports = { BACKUP_STALE_MS, DANEA_STALE_MS, RESTORE_DRILL_STALE_MS, evaluateSystemHealth };
