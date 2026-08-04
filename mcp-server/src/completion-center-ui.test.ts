import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const completionUi = readFileSync(new URL('../../completion-center.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');

test('il centro completati è JavaScript valido ed è caricato dal gestionale', () => {
  assert.doesNotThrow(() => new vm.Script(completionUi));
  assert.ok(indexHtml.includes('./completion-center.js?v=1'));
  assert.ok(indexHtml.includes("'completedView','activityView'"));
});

test('cantieri e interventi completati hanno un archivio e un controllo di chiusura', () => {
  assert.ok(completionUi.includes("window.completedView"));
  assert.ok(completionUi.includes("'Lavori completati'"));
  assert.ok(completionUi.includes("'Foto finali'"));
  assert.ok(completionUi.includes("'Rapportino'"));
  assert.ok(completionUi.includes("markCompletionReviewed"));
  assert.ok(completionUi.includes("openCompletedItem"));
});

test('le nuove foto generano un avviso con apertura del punto esatto', () => {
  assert.ok(completionUi.includes('detectReportActivities'));
  assert.ok(completionUi.includes('reportPhotoCount'));
  assert.ok(completionUi.includes("event: completed ? 'photos-completed' : 'photos'"));
  assert.ok(completionUi.includes("window.openActivityNotification"));
  assert.ok(completionUi.includes("window.openReportActivity"));
  assert.ok(completionUi.includes('Apri punto esatto'));
});

test('il service worker conserva il nuovo modulo e apre gli avvisi cliccati', () => {
  assert.ok(serviceWorker.includes('v27-ricerca-con-azioni'));
  assert.ok(serviceWorker.includes('"./completion-center.js"'));
  assert.ok(serviceWorker.includes('notificationclick'));
  assert.ok(serviceWorker.includes('event.notification.data?.url'));
});

test('riconosce foto finali e genera un avviso per un caricamento della squadra', () => {
  const storage = new Map<string, string>();
  const elements = new Map<string, Record<string, unknown>>();
  const data = {
    sites: [{ id: 'site-1', title: 'Ripristino tetto', client: 'Condominio Prova', address: 'Via Prova 1', status: 'Completato', progress: 100, updatedAt: '2026-08-04T09:01:00.000Z' }],
    reports: [{ id: 'report-1', site: 'site-1', client: 'Condominio Prova', status: 'Completato', photoOnly: true, workerUid: 'worker-1', workerName: 'Ajet', date: '2026-08-04T09:00:00.000Z', photoCount: 2, photos: [{ phase: 'Completato', uploadedAt: '2026-08-04T09:00:00.000Z' }, { phase: 'Completato', uploadedAt: '2026-08-04T09:00:00.000Z' }] }],
    interventions: [], roofs: [], drains: [], documents: [], condomini: []
  };
  const topActions = { prepend: (element: Record<string, unknown>) => elements.set(String(element.id), element) };
  const windowObject: Record<string, unknown> = {
    location: { href: 'https://example.test/' },
    addEventListener: () => undefined,
    EdilKappaCloud: { currentUid: 'owner-1', currentProfile: { role: 'owner' } },
    EdilKappaLocal: { getDB: () => data, getView: () => 'dashboard' }
  };
  const context = {
    window: windowObject,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    document: {
      head: { appendChild: () => undefined }, body: {},
      createElement: () => ({ id: '', type: '', className: '', innerHTML: '', onclick: null, setAttribute: () => undefined }),
      getElementById: (id: string) => elements.get(id) ?? null,
      querySelector: (selector: string) => selector === '.topActions' ? topActions : null
    },
    MutationObserver: class { observe() {} },
    requestAnimationFrame: (callback: () => void) => callback(),
    setInterval: () => 1, clearInterval: () => undefined, setTimeout: (callback: () => void) => { callback(); return 1; },
    URL, Date, JSON, Math,
    history: { replaceState: () => undefined }, navigator: {},
    ownerNav: [['sites', '▤', 'Cantieri']],
    more: () => '', dashboard: () => '', render: () => undefined, view: 'dashboard',
    isOffice: () => true, roleName: () => 'Titolare', renderNav: () => undefined,
    pageHead: () => '', stat: () => '', badge: (value: unknown) => String(value), esc: (value: unknown) => String(value ?? ''),
    save: () => undefined, go: () => undefined, alert: () => undefined, confirm: () => true,
    openSite: () => undefined, openRoof: () => undefined, openDrain: () => undefined
  };
  vm.runInNewContext(completionUi, context);
  const api = windowObject.EdilKappaCompletion as {
    completedRows: () => Array<{ closeout: { photoReady: boolean; photoCount: number } }>;
    detectCloudActivities: (name: string) => void;
    notifications: () => Array<{ title: string; targetId: string }>;
  };
  const completed = api.completedRows();
  assert.equal(completed.length, 1);
  assert.equal(completed[0].closeout.photoReady, true);
  assert.equal(completed[0].closeout.photoCount, 2);
  api.detectCloudActivities('reports');
  assert.equal(api.notifications().length, 1);
  assert.equal(api.notifications()[0].targetId, 'report-1');
  assert.match(api.notifications()[0].title, /2 foto caricate/);
});
