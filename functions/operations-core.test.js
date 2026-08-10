"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOperationsSnapshot } = require("./operations-core");

test("builds deterministic priorities without inventing operational data", () => {
  const snapshot = buildOperationsSnapshot({
    leads: [{ id: "lead-1", status: "Nuova", source: "Danea", name: "Condominio", request: "Perdita" }],
    sites: [{ id: "site-1", title: "Ripristino", client: "Condominio", status: "In corso", start: "2026-08-01", value: 10000, cost: 7000 }],
    reports: [], quotes: [{ id: "q-1", code: "PREV-1", client: "Condominio", status: "Inviato", date: "2026-07-30" }],
    timesheets: [], absences: [], payments: [{ id: "p-1", client: "Condominio", amount: 5000, paid: 1000, dueDate: "2026-08-01" }],
    deadlines: [{ id: "d-1", title: "Documento", date: "2026-08-11", done: false }],
    users: [{ uid: "worker-1", role: "worker", active: true, displayName: "Ajet" }]
  }, { today: "2026-08-10" });
  assert.equal(snapshot.metrics.newRequests, 1);
  assert.equal(snapshot.metrics.activeSites, 1);
  assert.equal(snapshot.metrics.missingHours, 1);
  assert.equal(snapshot.metrics.overduePayments, 1);
  assert.ok(snapshot.priorities.some((item) => item.title === "Richiesta Danea da controllare"));
  assert.ok(snapshot.priorities.some((item) => item.title === "Cantiere senza aggiornamenti"));
  assert.ok(snapshot.priorities.some((item) => item.title === "Mancano fotografie del cantiere"));
  assert.ok(snapshot.priorities.some((item) => item.title === "Preventivo senza risposta"));
  assert.equal(snapshot.profitability[0].profit, 3000);
  assert.equal(snapshot.profitability[0].marginPercent, 30);
});

test("approved absence prevents a false missing-hours warning", () => {
  const snapshot = buildOperationsSnapshot({
    users: [{ uid: "worker-1", role: "worker", active: true }], timesheets: [],
    absences: [{ workerUid: "worker-1", status: "Approvata", startDate: "2026-08-10", endDate: "2026-08-12", partialDay: false }]
  }, { today: "2026-08-10" });
  assert.equal(snapshot.metrics.missingHours, 0);
  assert.equal(snapshot.priorities.some((item) => item.category === "hours"), false);
});
