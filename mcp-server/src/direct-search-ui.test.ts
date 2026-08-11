import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const directSearch = readFileSync(new URL('../../direct-search.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');

function testContext() {
  const opened: Array<{ clientId: string; focus: { interventionId: string; itemId: string } }> = [];
  const photoAlbums: string[] = [];
  const photoUploads: string[] = [];
  const windowObject: Record<string, unknown> = {
    openClientArchive: (clientId: string, focus: { interventionId: string; itemId: string }) => opened.push({ clientId, focus }),
    openQuickPhotoAlbums: (siteId: string) => { photoAlbums.push(siteId); },
    openQuickPhotoUpload: (siteId: string) => { photoUploads.push(siteId); }
  };
  const context = {
    window: windowObject,
    document: {
      head: { appendChild: () => undefined },
      createElement: () => ({ textContent: '' }),
      getElementById: () => ({ value: '' })
    },
    db: {
      condomini: [{ id: 'cliente-1', name: 'Condominio Prova', address: 'Via Prova 1', manager: 'Studio Prova' }],
      interventions: [{ id: 'intervento-1', clientId: 'cliente-1', client: 'Condominio Prova', title: 'Ripristino tetto', date: '2026-08-04', status: 'In corso' }],
      inspections: [],
      quotes: [{ id: 'preventivo-1', clientId: 'cliente-1', interventionId: 'intervento-1', client: 'Condominio Prova', code: 'PREV-1', subject: 'Preventivo tetto', status: 'Bozza' }],
      documents: [{ id: 'documento-1', clientId: 'cliente-1', interventionId: 'intervento-1', client: 'Condominio Prova', title: 'Relazione tetto', category: 'Relazione tecnica', fileName: 'tetto.pdf' }],
      sites: [{ id: 'cantiere-1', title: 'Sostituzione tubo tetto', client: 'Condominio Prova', address: 'Via Prova 1' }],
      reports: [
        { id: 'foto-1', photoOnly: true, site: 'cantiere-1', photoCount: 3 },
        { id: 'rapportino-1', siteId: 'cantiere-1', photoCount: 2, photos: [{ key: 'foto-prima' }, { attachmentId: 'foto-dopo' }] }
      ],
      drone: [], lifelines: [], roofs: [], drains: [], leads: []
    },
    WORKERS: [],
    searchQuery: 'tetto',
    view: 'search',
    isOffice: () => true,
    currentTeamId: () => 'squadra-1',
    esc: (value: unknown) => String(value ?? '').replace(/"/g, '&quot;'),
    pageHead: (title: string, subtitle: string) => `<h2>${title}</h2><p>${subtitle}</p>`,
    render: () => undefined,
    go: () => undefined,
    openSearchResult: () => undefined,
    searchResults: () => '',
    alert: () => undefined,
    downloadInspectionCalendar: () => undefined,
    openQuotePdf: () => undefined,
    printQuote: () => undefined,
    deleteItem: () => undefined,
    deleteTeam: () => undefined
  };
  vm.runInNewContext(directSearch, context);
  return { context, windowObject, opened, photoAlbums, photoUploads };
}

test('ogni risultato mostra direttamente i comandi disponibili', () => {
  const { context } = testContext();
  const html = context.searchResults();
  assert.match(html, /searchResultRow/);
  assert.match(html, /Foto, modifica, elimina e gli altri comandi sono disponibili qui/);
  assert.doesNotMatch(html, />Apri scheda</);
  assert.match(html, /📷 Foto \(5\)/);
  assert.match(html, />Modifica</);
  assert.match(html, />Elimina</);
  assert.match(html, /Relazione tetto/);
});

test('il comando Foto del cantiere apre la galleria senza sostituirla con il caricamento', () => {
  const { windowObject, photoAlbums, photoUploads } = testContext();
  const runAction = windowObject.runSearchResultAction as (element: { closest: () => { dataset: Record<string, string> } }, command: string) => void;
  runAction({ closest: () => ({ dataset: { action: 'site', id: 'cantiere-1' } }) }, 'photo');
  assert.deepEqual(photoAlbums, ['cantiere-1']);
  assert.deepEqual(photoUploads, []);
});

test('un intervento trovato apre l’archivio completo del cliente sul punto esatto', () => {
  const { windowObject, opened } = testContext();
  const openFromElement = windowObject.openSearchResultFromElement as (element: { dataset: Record<string, string> }) => void;
  openFromElement({ dataset: { action: 'intervention', id: 'intervento-1', clientId: 'cliente-1', interventionId: 'intervento-1' } });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].clientId, 'cliente-1');
  assert.equal(opened[0].focus.interventionId, 'intervento-1');
  assert.equal(opened[0].focus.itemId, '');
});

test('un documento trovato apre la scheda completa e mette in evidenza il file', () => {
  const { windowObject, opened } = testContext();
  const openFromElement = windowObject.openSearchResultFromElement as (element: { dataset: Record<string, string> }) => void;
  openFromElement({ dataset: { action: 'document', id: 'documento-1', clientId: 'cliente-1', interventionId: 'intervento-1' } });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].clientId, 'cliente-1');
  assert.equal(opened[0].focus.interventionId, 'intervento-1');
  assert.equal(opened[0].focus.itemId, 'documento-1');
});

test('il nuovo modulo di ricerca è caricato e disponibile offline', () => {
  assert.ok(indexHtml.includes('./direct-search.js?v=6'));
  assert.ok(indexHtml.includes('./client-archive.js?v=20'));
  assert.match(indexHtml, /\.\/sw\.js\?v=\d+/);
  assert.match(serviceWorker, /const CACHE = `\$\{CACHE_PREFIX\}v\d+-[a-z0-9-]+`/);
  assert.ok(serviceWorker.includes('"./direct-search.js"'));
});
