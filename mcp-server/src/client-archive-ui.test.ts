import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const archiveUi = readFileSync(new URL('../../client-archive.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const firebaseCloud = readFileSync(new URL('../../firebase-cloud.js', import.meta.url), 'utf8');
const repository = readFileSync(new URL('./repository.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

test('la scheda cliente raggruppa i file per singolo intervento', () => {
  assert.ok(archiveUi.includes('Scheda interventi'));
  assert.ok(archiveUi.includes('openClientArchive'));
  assert.ok(archiveUi.includes('interventionId'));
  assert.ok(archiveUi.includes('Archivio precedente'));
  assert.ok(archiveUi.includes('＋ Nuovo intervento'));
});

test('preventivi, documenti, foto e video si possono aggiungere dalla scheda intervento', () => {
  assert.ok(archiveUi.includes('openQuoteForIntervention'));
  assert.ok(archiveUi.includes('openDocumentForIntervention'));
  assert.ok(archiveUi.includes('openSiteForIntervention'));
  assert.ok(archiveUi.includes('＋ Preventivo PDF'));
  assert.ok(archiveUi.includes('＋ Documento / Foto / Video'));
  assert.ok(archiveUi.includes('＋ Cantiere'));
  assert.ok(archiveUi.includes('Foto cantiere'));
  assert.ok(archiveUi.includes('Operai e ore'));
  assert.ok(archiveUi.includes('Cronologia intervento'));
});

test('un intervento vuoto si può eliminare senza cancellare dati collegati', () => {
  assert.ok(archiveUi.includes('window.deleteIntervention'));
  assert.ok(archiveUi.includes('Sposta nel cestino'));
  assert.ok(archiveUi.includes("deleteItem('interventions'"));
  assert.ok(archiveUi.includes('non può essere eliminato perché contiene'));
});

test('gli interventi vengono sincronizzati come cartelle nell’archivio documenti protetto', () => {
  assert.ok(indexHtml.includes('interventions:[]'));
  assert.ok(firebaseCloud.includes("remoteName === 'documents'"));
  assert.ok(firebaseCloud.includes("recordType: 'Intervention'"));
  assert.ok(firebaseCloud.includes('database.interventions'));
});

test('il connettore ChatGPT cerca o crea la scheda intervento corretta', () => {
  assert.ok(repository.includes('resolveIntervention'));
  assert.ok(repository.includes("collection('documents')"));
  assert.ok(repository.includes("recordType: 'Intervention'"));
  assert.ok(server.includes("'cerca_interventi'"));
  assert.ok(server.includes('intervento_id'));
  assert.ok(server.includes('interventionTitle'));
});

test('la scheda mostra soltanto i file collegati al relativo intervento', () => {
  const elements = new Map<string, Record<string, unknown>>();
  const db = {
    condomini: [{ id: 'cliente-1', name: 'Condominio Prova', address: 'Via Prova 1', manager: 'Studio Prova', phone: '' }],
    interventions: [
      { id: 'intervento-a', clientId: 'cliente-1', client: 'Condominio Prova', title: 'Ripristino copertura', category: 'Copertura e tetto', date: '2026-07-26', status: 'In corso' },
      { id: 'intervento-b', clientId: 'cliente-1', client: 'Condominio Prova', title: 'Ripristino facciata', category: 'Facciata', date: '2026-07-25', status: 'Pianificato' }
    ],
    quotes: [
      { id: 'prev-a', clientId: 'cliente-1', client: 'Condominio Prova', interventionId: 'intervento-a', code: 'PREV-A', subject: 'Preventivo tetto', status: 'Bozza', media: [] },
      { id: 'prev-b', clientId: 'cliente-1', client: 'Condominio Prova', interventionId: 'intervento-b', code: 'PREV-B', subject: 'Preventivo facciata', status: 'Bozza', media: [] }
    ],
    documents: [
      { id: 'doc-a', clientId: 'cliente-1', client: 'Condominio Prova', interventionId: 'intervento-a', title: 'Relazione tetto', category: 'Relazione tecnica', fileName: 'tetto.pdf' }
    ],
    drone: [],
    inspections: [{ id: 'sop-a', clientId: 'cliente-1', client: 'Condominio Prova', interventionId: 'intervento-a', date: '2026-07-26', time: '09:00', status: 'Pianificato', problem: 'Controllo tetto' }],
    sites: [{ id: 'site-a', clientId: 'cliente-1', client: 'Condominio Prova', interventionId: 'intervento-a', title: 'Cantiere tetto', address: 'Via Prova 1', worker: 'team-1', start: '2026-07-27', status: 'In corso', progress: 50 }],
    reports: [{ id: 'report-a', clientId: 'cliente-1', client: 'Condominio Prova', interventionId: 'intervento-a', site: 'site-a', workDate: '2026-07-28', workerName: 'Ajet', hours: 8, photoCount: 3, photos: [{ key: 'uno' }, { key: 'due' }, { key: 'tre' }] }],
    timesheets: [{ id: 'hours-a', clientId: 'cliente-1', interventionId: 'intervento-a', siteId: 'site-a', date: '2026-07-28', worker: 'worker-1', workerName: 'Ajet', team: 'team-1', teamName: 'Squadra A', hours: 8, job: 'Cantiere tetto · Condominio Prova' }],
    teams: [{ id: 'team-1', name: 'Squadra A' }]
  };
  const context = {
    db,
    window: {} as Record<string, unknown>,
    document: {
      createElement: () => ({ textContent: '' }),
      head: { appendChild: () => undefined },
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '' });
        return elements.get(id);
      }
    },
    setTimeout: (callback: () => void) => { callback(); return 1; },
    esc: (value: unknown) => String(value ?? ''),
    uid: (prefix: string) => `${prefix}-nuovo`,
    localToday: () => '2026-07-26',
    field: (label: string) => `<label>${label}</label>`,
    selectOptions: () => '<option></option>',
    modal: () => undefined,
    alert: () => undefined,
    pageHead: (title: string) => `<h2>${title}</h2>`,
    stat: (label: string, value: unknown) => `<span>${label}:${String(value)}</span>`,
    badge: (value: unknown) => `<span>${String(value)}</span>`,
    isOffice: () => true,
    roleName: () => 'Titolare',
    renderNav: () => undefined,
    save: () => undefined,
    condomini: () => '',
    renameClient: () => undefined,
    render: () => undefined,
    view: 'condomini'
  };
  vm.runInNewContext(archiveUi, context);
  const archiveWindow = context.window as {
    openClientArchive: (clientId: string) => void;
    clientArchive: () => string;
  };
  archiveWindow.openClientArchive('cliente-1');
  const html = archiveWindow.clientArchive();
  assert.match(html, /Ripristino copertura/);
  assert.match(html, /PREV-A/);
  assert.match(html, /Relazione tetto/);
  assert.match(html, /Ripristino facciata/);
  assert.match(html, /PREV-B/);
  const coverStart = html.indexOf('Ripristino copertura');
  const facadeStart = html.indexOf('Ripristino facciata');
  const coverSection = html.slice(coverStart, facadeStart);
  const facadeSection = html.slice(facadeStart);
  assert.match(coverSection, /PREV-A/);
  assert.match(coverSection, /Cantiere tetto/);
  assert.match(coverSection, /Ajet/);
  assert.match(coverSection, /8\.0 ore/);
  assert.match(coverSection, /3 fotografie collegate/);
  assert.match(coverSection, /Cronologia intervento/);
  assert.doesNotMatch(coverSection, /PREV-B/);
  assert.match(facadeSection, /PREV-B/);
  assert.doesNotMatch(facadeSection, /Cantiere tetto/);
  assert.doesNotMatch(facadeSection, /Ajet/);
  assert.doesNotMatch(facadeSection, /PREV-A/);
});
