import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const directSearch = readFileSync(new URL('../../direct-search.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');

function testContext() {
  const opened: Array<{ clientId: string; focus: { interventionId: string; itemId: string } }> = [];
  const windowObject: Record<string, unknown> = {
    openClientArchive: (clientId: string, focus: { interventionId: string; itemId: string }) => opened.push({ clientId, focus })
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
      sites: [], drone: [], lifelines: [], roofs: [], drains: [], leads: []
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
    alert: () => undefined
  };
  vm.runInNewContext(directSearch, context);
  return { context, windowObject, opened };
}

test('tutta la riga del risultato apre direttamente i dettagli senza il pulsante Apri scheda', () => {
  const { context } = testContext();
  const html = context.searchResults();
  assert.match(html, /searchResultRow/);
  assert.match(html, /Tocca un risultato per aprire tutti i dettagli/);
  assert.doesNotMatch(html, />Apri scheda</);
  assert.match(html, /Relazione tetto/);
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
  assert.ok(indexHtml.includes('./direct-search.js?v=1'));
  assert.ok(indexHtml.includes('./client-archive.js?v=18'));
  assert.ok(indexHtml.includes('./sw.js?v=26'));
  assert.ok(serviceWorker.includes('v26-ricerca-apertura-completa'));
  assert.ok(serviceWorker.includes('"./direct-search.js"'));
});
