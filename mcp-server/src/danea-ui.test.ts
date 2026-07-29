import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type DaneaTestContext = {
  db: {
    leads: Array<Record<string, unknown>>;
    condomini: Array<Record<string, unknown>>;
    inspections: Array<Record<string, unknown>>;
    sites: Array<Record<string, unknown>>;
  };
  modalHandler?: (form: { get(name: string): unknown }) => unknown;
  openDaneaImport: () => void;
  convertDaneaRequest: (id: string) => void;
  emitCloudSync: (remoteName: string) => void;
};

function loadDaneaModule(): DaneaTestContext {
  let sequence = 0;
  const listeners = new Map<string, Array<(event: { detail?: Record<string, unknown> }) => void>>();
  const context: Record<string, unknown> = {
    URL,
    Date,
    Math,
    String,
    console,
    setTimeout: (callback: () => void) => { callback(); return 0; },
    clearTimeout: () => {},
    document: {
      createElement: () => ({ textContent: '' }),
      head: { appendChild: () => {} },
      getElementById: () => ({ textContent: '', innerHTML: '' }),
      querySelector: () => ({})
    },
    db: { leads: [], condomini: [], inspections: [], sites: [] },
    ownerNav: [['inspections', '⌖', 'Sopralluoghi']],
    more: () => '',
    dashboard: () => '',
    render: () => {},
    save: () => {},
    initRoles: () => {},
    renderNav: () => {},
    isOffice: () => true,
    roleName: () => 'Titolare',
    view: 'dashboard',
    esc: (value: unknown) => String(value ?? ''),
    field: () => '',
    badge: (value: unknown) => String(value ?? ''),
    stat: () => '',
    pageHead: () => '',
    deleteItem: () => {},
    alert: () => {},
    uid: (prefix: string) => `${prefix}-${++sequence}`,
    modal: (_title: string, _body: string, onSave: DaneaTestContext['modalHandler']) => {
      context.modalHandler = onSave;
    },
    addEventListener: (name: string, listener: (event: { detail?: Record<string, unknown> }) => void) => {
      listeners.set(name, [...(listeners.get(name) || []), listener]);
    },
    emitCloudSync: (remoteName: string) => {
      (listeners.get('edilkappa:cloud-collection-synced') || []).forEach((listener) => listener({ detail: { remoteName } }));
    }
  };
  context.window = context;
  vm.createContext(context);
  const source = readFileSync(new URL('../../danea-integration.js', import.meta.url), 'utf8');
  vm.runInContext(source, context, { filename: 'danea-integration.js' });
  return context as unknown as DaneaTestContext;
}

function importForm(raw: string, studio: string, sourceUrl = '') {
  const values = new Map<string, string>([
    ['raw', raw],
    ['studio', studio],
    ['sourceUrl', sourceUrl]
  ]);
  return { get: (name: string) => values.get(name) || '' };
}

test('importa una richiesta Danea e aggiorna il duplicato senza creare una seconda scheda', () => {
  const app = loadDaneaModule();
  app.openDaneaImport();
  assert.ok(app.modalHandler);

  app.modalHandler(importForm(
    'INTERVENTO DI PROVA\nCondominio DEMO ALFA\nVia Fittizia 1\nRichiesta di intervento (900001)\n01/01/2000 10:00',
    'Studio Demo'
  ));
  assert.equal(app.db.leads.length, 1);
  assert.equal(app.db.leads[0]?.daneaId, '900001');
  assert.equal(app.db.leads[0]?.client, 'DEMO ALFA');

  app.modalHandler(importForm(
    'INTERVENTO DI PROVA\nCondominio DEMO ALFA\nVia Fittizia 1\nIntervento n. 900001\n01/01/2000 10:00\nIn corso',
    'STUDIODEMO'
  ));
  assert.equal(app.db.leads.length, 1);
  assert.equal(app.db.leads[0]?.status, 'In corso');
});

test('crea una sola volta cliente e sopralluogo collegati alla richiesta Danea', () => {
  const app = loadDaneaModule();
  app.openDaneaImport();
  app.modalHandler?.(importForm(
    'SECONDO INTERVENTO DI PROVA\nCondominio DEMO BETA\nVia Fittizia 2\nRichiesta di intervento (900002)\n02/01/2000 11:00',
    'Studio Demo'
  ));

  const requestId = String(app.db.leads[0]?.id || '');
  app.convertDaneaRequest(requestId);
  app.convertDaneaRequest(requestId);

  assert.equal(app.db.condomini.length, 1);
  assert.equal(app.db.inspections.length, 1);
  assert.equal(app.db.inspections[0]?.daneaRequestId, requestId);
});

test('rifiuta nell’importazione un collegamento esterno non ufficiale', () => {
  const app = loadDaneaModule();
  app.openDaneaImport();

  assert.throws(() => app.modalHandler?.(importForm(
    'TERZO INTERVENTO DI PROVA\nCondominio DEMO GAMMA\nRichiesta di intervento (900003)',
    'Studio Demo',
    'https://danea.it.evil.example/intervento/900003'
  )), /deve appartenere a Danea o MioCondominio/);
});

test('apre automaticamente un solo cantiere per ogni richiesta Danea nuova o in corso', () => {
  const app = loadDaneaModule();
  app.db.leads.push(
    {
      id: 'danea-demo-1',
      source: 'Danea Interventi',
      daneaId: '900101',
      studio: 'STUDIODEMO',
      client: 'Condominio DEMO DELTA',
      address: 'Via Fittizia 3 - Città Demo',
      title: 'Intervento automatico di prova',
      request: 'Descrizione sintetica non riferita a un intervento reale',
      daneaStatus: 'Nuovo',
      receivedAt: '2000-01-03T12:00:00Z'
    },
    {
      id: 'danea-demo-2',
      source: 'Danea Interventi',
      daneaId: '900102',
      studio: 'STUDIODEMO',
      client: 'Condominio DEMO EPSILON',
      title: 'Secondo intervento automatico di prova',
      daneaStatus: 'In corso'
    },
    {
      id: 'danea-demo-3',
      source: 'Danea Interventi',
      daneaId: '900103',
      studio: 'STUDIODEMO',
      client: 'Condominio DEMO ZETA',
      title: 'Intervento di prova terminato',
      daneaStatus: 'Completato'
    }
  );

  app.emitCloudSync('leads');
  app.emitCloudSync('sites');
  app.emitCloudSync('sites');

  assert.equal(app.db.sites.length, 2);
  assert.deepEqual(app.db.sites.map((site) => site.status).sort(), ['In corso', 'Pianificato']);
  assert.equal(new Set(app.db.sites.map((site) => site.daneaRequestId)).size, 2);
  assert.equal(app.db.condomini.length, 2);
});
