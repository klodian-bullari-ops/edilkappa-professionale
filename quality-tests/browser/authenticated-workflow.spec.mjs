import { expect, test } from "@playwright/test";

const today = new Date().toISOString().slice(0, 10);

async function openAuthenticatedWorkspace(page) {
  await page.route("**/firebase-cloud.js*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/javascript", body: "// Firebase sostituito dal cloud controllato del test qualità.\n" });
  });
  await page.addInitScript(({ currentDay }) => {
    const seed = {
      condomini: [],
      interventions: [],
      inspections: [],
      sites: [],
      quotes: [],
      reports: [],
      timesheets: [],
      absences: [],
      edilconnect: [],
      drone: [],
      lifelines: [],
      roofs: [],
      drains: [],
      expenses: [],
      teams: [{ id: "team-quality", name: "Squadra Qualità", member1: "Mario Test", member2: "", phone: "", reminderTime: "18:00" }],
      staff: [{ id: "worker-quality", name: "Mario Test", phone: "", team: "team-quality", reminderTime: "18:00" }],
      companySettings: [],
      staffInitialized: true,
      leads: [{
        id: "danea-quality-1",
        source: "Danea",
        status: "Nuova",
        client: "Condominio Il Giardino",
        address: "Via Monte Sabotino 33, Milano",
        request: "Infiltrazione dal soffitto del locale comune",
        title: "Verifica infiltrazione soffitto",
        receivedAt: `${currentDay}T07:30:00.000Z`,
        scheduledDate: currentDay,
        scheduledTime: "09:00"
      }]
    };
    localStorage.setItem("edilkappa_professionale_v1", JSON.stringify(seed));
    localStorage.setItem("ek_role", "owner");
    window.__qualityAlerts = [];
    window.alert = (message) => window.__qualityAlerts.push(String(message));
    window.confirm = () => true;
    window.prompt = () => "";
    window.EdilKappaCloud = {
      ready: true,
      syncing: false,
      lastSyncAt: new Date().toISOString(),
      lastSyncError: "",
      syncHealth: [],
      currentUid: "owner-quality",
      currentProfile: { role: "owner", active: true, displayName: "Klodian Qualità", email: "info@edilkappa.com" },
      workerProfiles: [{ id: "worker-quality", uid: "worker-quality", name: "Mario Test", team: "team-quality" }],
      appCheckConfigured: true,
      appCheckReady: true,
      restrictView: (view) => view,
      scheduleSync: () => {},
      syncNow: async () => true,
      syncRecord: async (collection, record) => {
        window.__qualitySync = window.__qualitySync || [];
        window.__qualitySync.push({ collection, id: record?.id || "" });
      },
      reportClientError: async () => true,
      reportPerformanceMetric: async () => true,
      listClientErrors: async () => [],
      uploadMedia: async () => { throw new Error("Il test non deve caricare file reali."); },
      backupRequest: async () => ({ backups: [] })
    };
  }, { currentDay: today });
  await page.goto("/index.html");
  await page.waitForFunction(() => typeof window.reconcileRequestInterventions === "function");
  await page.waitForFunction(() => {
    const database = window.EdilKappaLocal?.getDB?.();
    return database?.interventions?.length === 1 && database?.inspections?.length === 1;
  });
}

test("il percorso autenticato completo mantiene tutti i collegamenti operativi", async ({ page }) => {
  await openAuthenticatedWorkspace(page);
  await expect(page.getByRole("heading", { name: "Centro operativo" })).toBeVisible();
  await expect(page.locator("#cloudGate")).toHaveCount(0);

  const initial = await page.evaluate(() => {
    const database = window.EdilKappaLocal.getDB();
    return {
      client: database.condomini[0],
      intervention: database.interventions[0],
      inspection: database.inspections[0]
    };
  });
  expect(initial.client.name).toBe("Condominio Il Giardino");
  expect(initial.intervention.daneaRequestId).toBe("danea-quality-1");
  expect(initial.inspection.interventionId).toBe(initial.intervention.id);

  await page.evaluate(() => window.EdilKappaLocal.go("inspections"));
  await page.getByRole("button", { name: "Segna eseguito" }).click();
  await page.getByLabel("Esito del sopralluogo").fill("Umidità e distacco dell'intonaco causati da infiltrazione superiore.");
  await page.getByLabel("Misure rilevate").fill("Soffitto interessato circa 8 m².");
  await page.getByLabel("Lavorazioni consigliate").fill("Ricerca della causa, asciugatura, trattamento antimuffa e ripristino pittorico.");
  await page.getByLabel("Note tecniche").fill("Proteggere arredi e verificare l'impianto sovrastante.");
  await page.locator("#modalForm").getByRole("button", { name: "Salva" }).click();
  await expect(page.locator("#modal")).not.toHaveAttribute("open", "");

  await page.evaluate(() => {
    window.EdilKappaLoader.ensureView = () => Promise.resolve();
    window.edilkappaAiPrepareInspection = async (inspectionId) => {
      const database = window.EdilKappaLocal.getDB();
      const inspection = database.inspections.find((item) => item.id === inspectionId);
      database.quotes.push({
        id: "quote-quality-1",
        code: "PREV-QUALITY-1",
        client: inspection.client,
        clientId: inspection.clientId,
        interventionId: inspection.interventionId,
        inspectionId,
        subject: "Ripristino infiltrazione soffitto",
        status: "Bozza",
        aiArtifact: { readyToSave: true },
        date: new Date().toISOString().slice(0, 10)
      });
      window.EdilKappaLocal.persist();
    };
  });
  await page.evaluate(() => window.EdilKappaLocal.go("inspections"));
  await page.getByRole("button", { name: "Preventivo AI" }).click();
  await page.waitForFunction(() => window.EdilKappaLocal.getDB().quotes.length === 1);

  await page.evaluate(() => {
    const database = window.EdilKappaLocal.getDB();
    const intervention = database.interventions[0];
    window.openSiteForIntervention(intervention.clientId, intervention.id);
  });
  await page.getByLabel("Titolo intervento").fill("Ripristino infiltrazione soffitto");
  await page.getByLabel("Indirizzo").fill("Via Monte Sabotino 33, Milano");
  await page.getByLabel("Valore lavoro €").fill("2500");
  await page.getByLabel("Costi previsti €").fill("1300");
  await page.getByLabel("Stato").selectOption({ label: "In corso" });
  await page.locator("#modalForm").getByRole("button", { name: "Salva" }).click();
  await page.waitForFunction(() => window.EdilKappaLocal.getDB().sites.length === 1);

  await page.evaluate(({ currentDay }) => {
    const database = window.EdilKappaLocal.getDB();
    const site = database.sites[0];
    database.reports.push({
      id: "report-quality-1",
      code: "RAP-QUALITY-1",
      site: site.id,
      siteId: site.id,
      interventionId: site.interventionId,
      clientId: site.clientId,
      client: site.client,
      worker: "worker-quality",
      workerName: "Mario Test",
      team: "team-quality",
      workDate: currentDay,
      date: `${currentDay}T16:00:00.000Z`,
      hours: 8,
      notes: "Ripristino completato e zona pulita.",
      status: "Completato",
      photoCount: 1,
      photos: [{ name: "foto-finale.jpg", fileName: "foto-finale.jpg", phase: "Dopo", data: "data:image/jpeg;base64,AA==" }]
    });
    database.timesheets.push({
      id: "hours-quality-1",
      worker: "worker-quality",
      workerUid: "worker-quality",
      workerName: "Mario Test",
      team: "team-quality",
      teamName: "Squadra Qualità",
      siteId: site.id,
      interventionId: site.interventionId,
      date: currentDay,
      job: `site:${site.id}`,
      hours: 8,
      ordinaryHours: 8,
      overtimeHours: 0
    });
    window.EdilKappaLocal.persist();
    window.EdilKappaLocal.go("sites");
    window.openSite(site.id);
  }, { currentDay: today });
  await page.getByLabel("Stato").selectOption({ label: "Completato" });
  await page.getByLabel("Data fine").fill(today);
  await page.locator("#modalForm").getByRole("button", { name: "Salva" }).click();

  const completed = await page.evaluate(() => {
    const database = window.EdilKappaLocal.getDB();
    const site = database.sites[0];
    const intervention = database.interventions[0];
    return {
      site,
      intervention,
      missingHours: window.EdilKappaHours.missingPeopleForSite(site).length,
      quote: database.quotes[0],
      report: database.reports[0]
    };
  });
  expect(completed.site.status).toBe("Completato");
  expect(completed.site.interventionId).toBe(initial.intervention.id);
  expect(completed.site.completedAt).toBeTruthy();
  expect(completed.intervention.status).toBe("Completato");
  expect(completed.quote.interventionId).toBe(initial.intervention.id);
  expect(completed.report.siteId).toBe(completed.site.id);
  expect(completed.missingHours).toBe(0);

  await page.evaluate(() => window.EdilKappaLocal.go("completedView"));
  await expect(page.getByRole("heading", { name: "Lavori completati" })).toBeVisible();
  await expect(page.getByText("Ripristino infiltrazione soffitto", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("✓ Foto finali", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("✓ Rapportino", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("✓ Ore", { exact: true }).first()).toBeVisible();
});
