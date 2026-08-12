import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const lifecycleUi = readFileSync(new URL('../../intervention-lifecycle.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const loader = readFileSync(new URL('../../edilkappa-loader.js', import.meta.url), 'utf8');

type LifecycleContext = {
  db: Record<string, Array<Record<string, unknown>>>;
  openRequestIntervention: (requestId: string) => void;
};

function loadLifecycleModule() {
  // Fixture interamente fittizia: etichette volutamente non riconducibili a persone o cantieri reali.
  const archiveOpenings: Array<{ clientId: string; focus: Record<string, string> }> = [];
  let saveCount = 0;
  let sequence = 0;
  const context: Record<string, unknown> = {
    Date,
    Math,
    String,
    Array,
    clearTimeout: () => undefined,
    setTimeout: (callback: () => void) => { callback(); return 1; },
    addEventListener: () => undefined,
    db: {
      leads: [
        { id: 'danea-1', source: 'Danea Test', client: 'CLIENTE_FITTIZIO_A', address: 'INDIRIZZO_FITTIZIO_A', request: 'LAVORO_FITTIZIO_A', status: 'Nuovo', daneaStatus: 'Nuovo', receivedAt: '2026-08-04T08:00:00.000Z' },
        { id: 'lead-1', source: 'Modulo test', name: 'CLIENTE_FITTIZIO_B', address: 'INDIRIZZO_FITTIZIO_B', description: 'LAVORO_FITTIZIO_B', status: 'Nuova', createdAt: '2026-08-04T09:00:00.000Z' }
      ],
      condomini: [],
      interventions: [],
      inspections: [],
      sites: [{ id: 'site-danea', daneaRequestId: 'danea-1', title: 'LAVORO_FITTIZIO_A', client: 'CLIENTE_FITTIZIO_A', address: 'INDIRIZZO_FITTIZIO_A', worker: 'team-1', start: '2026-08-04', status: 'In corso', progress: 10 }],
      reports: [],
      timesheets: [{ id: 'hours-danea', date: '2026-08-04', worker: 'worker-1', workerName: 'Operaio Test', team: 'team-1', teamName: 'Squadra Test', job: 'LAVORO_FITTIZIO_A · CLIENTE_FITTIZIO_A', hours: 7.5 }],
      quotes: [],
      documents: [],
      drone: [],
      roofs: [],
      drains: [],
      teams: [{ id: 'team-1', name: 'Squadra Test' }]
    },
    WORKERS: [{ id: 'team-1', name: 'Squadra Test' }],
    save: () => { saveCount += 1; },
    render: () => undefined,
    isOffice: () => true,
    uid: (prefix: string) => `${prefix}-${++sequence}`,
    localToday: () => '2026-08-04',
    roleName: () => 'Titolare',
    alert: () => undefined,
    openSite: () => undefined,
    modal: () => undefined,
    field: () => '',
    clientOptions: () => '',
    teamOptions: () => '',
    selectOptions: () => ''
  };
  context.openClientArchive = (clientId: string, focus: Record<string, string>) => archiveOpenings.push({ clientId, focus });
  context.window = context;
  vm.createContext(context);
  vm.runInContext(lifecycleUi, context, { filename: 'intervention-lifecycle.js' });
  return { app: context as unknown as LifecycleContext, archiveOpenings, saveCount: () => saveCount };
}

test('ogni richiesta Danea o generica apre automaticamente un intervento completo', () => {
  const { app, saveCount } = loadLifecycleModule();
  assert.equal(app.db.condomini.length, 2);
  assert.equal(app.db.interventions.length, 2);
  assert.equal(app.db.inspections.length, 2);
  assert.ok(app.db.leads.every((item) => item.clientId && item.interventionId));
  assert.ok(app.db.interventions.every((item) => item.requestId && Array.isArray(item.timeline)));
  assert.ok(saveCount() >= 1);
});

test('cantiere e ore vengono collegati allo stesso intervento della richiesta', () => {
  const { app } = loadLifecycleModule();
  const request = app.db.leads.find((item) => item.id === 'danea-1');
  const site = app.db.sites.find((item) => item.id === 'site-danea');
  const hours = app.db.timesheets.find((item) => item.id === 'hours-danea');
  assert.equal(site?.interventionId, request?.interventionId);
  assert.equal(hours?.siteId, 'site-danea');
  assert.equal(hours?.interventionId, request?.interventionId);
});

test('aprire una richiesta porta direttamente alla scheda del relativo intervento', () => {
  const { app, archiveOpenings } = loadLifecycleModule();
  const request = app.db.leads.find((item) => item.id === 'lead-1');
  app.openRequestIntervention('lead-1');
  assert.equal(archiveOpenings.length, 1);
  assert.equal(archiveOpenings[0]?.clientId, request?.clientId);
  assert.equal(archiveOpenings[0]?.focus.interventionId, request?.interventionId);
});

test('il ciclo intervento è caricato e disponibile anche offline', () => {
  assert.ok(loader.includes('./intervention-lifecycle.js?v=4'));
  assert.ok(loader.includes('./client-archive.js?v=24'));
  assert.match(indexHtml, /\.\/sw\.js\?v=\d+/);
  assert.match(serviceWorker, /const CACHE = `\$\{CACHE_PREFIX\}stabilita`/);
  assert.ok(serviceWorker.includes('"./intervention-lifecycle.js"'));
});
