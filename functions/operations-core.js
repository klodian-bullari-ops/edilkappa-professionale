"use strict";

function text(value, limit = 240) {
  return String(value ?? "").trim().slice(0, limit);
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value) {
  const match = text(value, 40).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function dayDistance(from, to) {
  const left = Date.parse(`${dateOnly(from)}T12:00:00Z`);
  const right = Date.parse(`${dateOnly(to)}T12:00:00Z`);
  return Number.isFinite(left) && Number.isFinite(right) ? Math.floor((right - left) / 86400000) : 0;
}

function completed(value) {
  return /complet|conclus|chius|eseguit/i.test(text(value, 80));
}

function photoCount(report) {
  return Math.max(number(report?.photoCount), Array.isArray(report?.photos) ? report.photos.length : 0);
}

function priority(severity, category, title, detail, view, targetId = "") {
  return { id: `${category}-${targetId || title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 100), severity, category, title: text(title), detail: text(detail, 500), view, targetId: text(targetId, 120) };
}

function buildOperationsSnapshot(data = {}, options = {}) {
  const today = dateOnly(options.today || new Date().toISOString());
  const leads = Array.isArray(data.leads) ? data.leads : [];
  const sites = Array.isArray(data.sites) ? data.sites : [];
  const inspections = Array.isArray(data.inspections) ? data.inspections : [];
  const quotes = Array.isArray(data.quotes) ? data.quotes : [];
  const reports = Array.isArray(data.reports) ? data.reports : [];
  const timesheets = Array.isArray(data.timesheets) ? data.timesheets : [];
  const absences = Array.isArray(data.absences) ? data.absences : [];
  const payments = Array.isArray(data.payments) ? data.payments : [];
  const deadlines = Array.isArray(data.deadlines) ? data.deadlines : [];
  const users = Array.isArray(data.users) ? data.users : [];
  const priorities = [];

  const newRequests = leads.filter((item) => /nuov/i.test(text(item.status || "Nuova")));
  for (const item of newRequests.slice(0, 12)) {
    const danea = /danea|miocondominio/i.test(`${item.source || ""} ${item.studio || ""}`);
    const missingLink = !text(item.clientId) || !text(item.interventionId || item.daneaId);
    priorities.push(priority(missingLink ? "high" : "medium", "requests", danea ? "Richiesta Danea da controllare" : "Nuova richiesta cliente", `${item.name || item.client || "Cliente"} · ${item.request || item.subject || item.notes || "Aprire e verificare i dati"}${missingLink ? " · collegamento cliente/intervento mancante" : ""}`, danea ? "daneaRequests" : "leadsView", item.id));
  }

  const reportBySite = new Map();
  for (const report of reports) {
    const siteId = text(report.siteId || report.site, 120);
    if (!siteId) continue;
    const current = reportBySite.get(siteId);
    if (!current || String(report.workDate || report.date || report.createdAt || "") > String(current.workDate || current.date || current.createdAt || "")) reportBySite.set(siteId, report);
  }
  const activeSites = sites.filter((item) => !completed(item.status));
  for (const site of activeSites) {
    const last = reportBySite.get(text(site.id, 120));
    const lastDate = dateOnly(last?.workDate || last?.date || last?.createdAt || site.start || site.createdAt);
    const idleDays = lastDate ? dayDistance(lastDate, today) : 99;
    const photos = reports.filter((item) => text(item.siteId || item.site, 120) === text(site.id, 120)).reduce((sum, item) => sum + photoCount(item), 0);
    if (idleDays >= 3) priorities.push(priority(idleDays >= 7 ? "high" : "medium", "sites", "Cantiere senza aggiornamenti", `${site.title || "Cantiere"} · ${site.client || ""} · ultimo aggiornamento ${lastDate || "non presente"}`, "sites", site.id));
    if (!photos) priorities.push(priority("medium", "photos", "Mancano fotografie del cantiere", `${site.title || "Cantiere"} · nessuna foto iniziale o di avanzamento registrata`, "sites", site.id));
  }

  const technicalReviews = inspections.filter((item) => {
    const hasResult = text(item.outcome || item.problem, 500);
    const hasMeasurements = text(item.measurements, 500) || item.scanManifest || item.scanPackageId;
    return hasResult && hasMeasurements && !item.technicalAnalysisApprovedAt;
  });
  for (const item of technicalReviews.slice(0, 12)) {
    const source = item.scanManifest || item.scanPackageId ? "rilievo EdilKappa Scan" : "misure inserite nel sopralluogo";
    priorities.push(priority("medium", "technical", "Sopralluogo pronto per Tecnico AI", `${item.client || item.site || item.problem || "Sopralluogo"} · ${source} · analisi da preparare e approvare`, "inspections", item.id));
  }

  const quoteFollowups = quotes.filter((item) => /inviat|in attesa/i.test(text(item.status)) && dayDistance(item.sentAt || item.updatedAt || item.date, today) >= 7);
  for (const item of quoteFollowups.slice(0, 12)) priorities.push(priority("medium", "quotes", "Preventivo senza risposta", `${item.code || "Preventivo"} · ${item.client || ""} · ${item.subject || ""}`, "quotes", item.id));
  for (const item of quotes.filter((quote) => /bozza/i.test(text(quote.status)) && !quote.aiArtifact && dayDistance(quote.updatedAt || quote.date, today) >= 5).slice(0, 8)) priorities.push(priority("low", "quotes", "Bozza da completare", `${item.code || "Preventivo"} · ${item.client || ""}`, "quotes", item.id));

  const approvedAbsences = new Set(absences.filter((item) => /approvat/i.test(text(item.status)) && !item.partialDay && dateOnly(item.startDate) <= today && dateOnly(item.endDate || item.startDate) >= today).map((item) => text(item.workerUid || item.workerId || item.worker, 120)));
  const recordedWorkers = new Set(timesheets.filter((item) => dateOnly(item.date) === today && number(item.hours) > 0).map((item) => text(item.workerUid || item.workerId || item.worker, 120)));
  const missingHours = users.filter((item) => item.active !== false && item.role === "worker" && !recordedWorkers.has(text(item.uid || item.id, 120)) && !approvedAbsences.has(text(item.uid || item.id, 120)));
  for (const item of missingHours.slice(0, 20)) priorities.push(priority("medium", "hours", "Ore giornaliere mancanti", `${item.displayName || item.name || item.email || "Operaio"} non ha inserito ore né un’assenza`, "hours", item.uid || item.id));

  const overduePayments = payments.filter((item) => number(item.paid) < number(item.amount) && dateOnly(item.dueDate) && dateOnly(item.dueDate) < today);
  for (const item of overduePayments.slice(0, 12)) priorities.push(priority("high", "payments", "Pagamento scaduto", `${item.client || "Cliente"} · residuo € ${(number(item.amount) - number(item.paid)).toFixed(2)} · scadenza ${dateOnly(item.dueDate)}`, "payments", item.id));
  const upcomingDeadlines = deadlines.filter((item) => !item.done && dateOnly(item.date) && dayDistance(today, item.date) >= 0 && dayDistance(today, item.date) <= 7);
  for (const item of upcomingDeadlines.slice(0, 12)) priorities.push(priority(dayDistance(today, item.date) <= 1 ? "high" : "medium", "deadlines", "Scadenza vicina", `${item.title || item.description || "Scadenza"} · ${dateOnly(item.date)}`, "deadlinesView", item.id));

  const profitability = sites.map((site) => {
    const revenue = number(site.value || site.contractValue);
    const recordedCost = number(site.cost || site.recordedCost);
    const quote = quotes.find((item) => text(item.interventionId, 120) && text(item.interventionId, 120) === text(site.interventionId, 120));
    const actual = number(quote?.actuals?.total);
    const cost = actual || recordedCost;
    return { id: text(site.id, 120), title: text(site.title || "Cantiere"), client: text(site.client), revenue, cost, profit: revenue - cost, marginPercent: revenue ? Math.round((revenue - cost) / revenue * 1000) / 10 : 0, actual: actual > 0 };
  }).filter((item) => item.revenue || item.cost).sort((a, b) => a.marginPercent - b.marginPercent).slice(0, 30);

  const severityOrder = { high: 0, medium: 1, low: 2 };
  priorities.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));
  return {
    version: 1,
    generatedFor: today,
    metrics: {
      urgent: priorities.filter((item) => item.severity === "high").length,
      newRequests: newRequests.length,
      activeSites: activeSites.length,
      stalledSites: priorities.filter((item) => item.category === "sites").length,
      photosToday: reports.filter((item) => dateOnly(item.workDate || item.date || item.createdAt) === today).reduce((sum, item) => sum + photoCount(item), 0),
      missingHours: missingHours.length,
      quoteFollowups: quoteFollowups.length,
      overduePayments: overduePayments.length,
      upcomingDeadlines: upcomingDeadlines.length,
      technicalReviews: technicalReviews.length
    },
    priorities: priorities.slice(0, 60),
    profitability
  };
}

module.exports = { buildOperationsSnapshot, completed, dateOnly, dayDistance, photoCount };
