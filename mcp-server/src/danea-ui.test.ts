import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type DaneaTestContext = {
  db: {
    leads: Array<Record<string, unknown>>;
    condomini: Array<Record<string, unknown>>;
    inspections: Array<Record<string, unknown>>;
  };
  modalHandler?: (form: { get(name: string): unknown }) => unknown;
  openDaneaImport: () => void;
  convertDaneaRequest: (id: string) => void;
};

function loadDaneaModule(): DaneaTestContext {
  let sequence = 0;
  const context: Record<string, unknown> = {
    URL,
    Date,
    Math,
    String,
    console,
    setTimeout: (callback: () => void) => { callback(); return 0; },
    document: {
      createElement: () => ({ textContent: '' }),
      head: { appendChild: () => {} },
      getElementById: () => ({ textContent: '', innerHTML: '' })
    },
    db: { leads: [], condomini: [], inspections: [] },
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
    'BALAUSTRA BALCONE\nCondominio CAPPELLETTA 28\nVia Cappelletta 28\nRichiesta di intervento (45538)\n23/07/2026 12:26',
    'Studio DCR'
  ));
  assert.equal(app.db.leads.length, 1);
  assert.equal(app.db.leads[0]?.daneaId, '45538');
  assert.equal(app.db.leads[0]?.client, 'CAPPELLETTA 28');

  app.modalHandler(importForm(
    'BALAUSTRA BALCONE\nCondominio CAPPELLETTA 28\nVia Cappelletta 28\nIntervento n. 45538\n23/07/2026 12:26\nIn corso',
    'STUDIODCR'
  ));
  assert.equal(app.db.leads.length, 1);
  assert.equal(app.db.leads[0]?.status, 'In corso');
});

test('crea una sola volta cliente e sopralluogo collegati alla richiesta Danea', () => {
  const app = loadDaneaModule();
  app.openDaneaImport();
  app.modalHandler?.(importForm(
    'INFILTRAZIONE LOCALE ASCENSORE\nCondominio PADOVA 213/A\nVia Padova 213/A\nRichiesta di intervento (45539)\n16/06/2026 15:24',
    'Studio DCR'
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
    'LAVORI STUDIO DENTISTICO\nCondominio PORPORA 32\nRichiesta di intervento (45540)',
    'Studio DCR',
    'https://danea.it.evil.example/intervento/45540'
  )), /deve appartenere a Danea o MioCondominio/);
});
