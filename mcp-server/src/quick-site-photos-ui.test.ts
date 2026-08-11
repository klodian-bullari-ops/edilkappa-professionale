import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const quickSitePhotos = readFileSync(new URL('../../quick-site-photos.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const modernUi = readFileSync(new URL('../../modern-ui.css', import.meta.url), 'utf8');

function testContext(siteButtons: Array<Record<string, any>> = []) {
  const openedReports: Array<[string, number]> = [];
  const modalContent = { innerHTML: '' };
  const dialog = { opened: false, showModal() { this.opened = true; } };
  const data = {
    sites: [{ id: 'site-1', title: 'Sostituzione tubo fogna', client: 'Condominio Prova', address: 'Via Prova 1' }],
    quotes: [],
    reports: [
      { id: 'quick-1', photoOnly: true, siteId: 'site-1', date: '2026-08-04T12:00:00.000Z', status: 'In corso', photoCount: 1, photos: [{ storagePath: 'foto/nuova.jpg', fileName: 'nuova.jpg' }] },
      { id: 'report-1', code: 'RAP-2026-0001', site: 'site-1', date: '2026-08-03T12:00:00.000Z', status: 'Completato', photoCount: 2, photos: [{ key: 'prima' }, { attachmentId: 'dopo' }] }
    ]
  };
  const windowObject: Record<string, unknown> = {
    role: 'owner',
    EdilKappaLocal: { getDB: () => data },
    EdilKappaCloud: { ready: false, currentProfile: { role: 'owner' } },
    openReportPhoto: (reportId: string, photoIndex: number) => openedReports.push([reportId, photoIndex]),
    addEventListener: () => undefined,
    open: () => undefined
  };
  const context = {
    window: windowObject,
    document: {
      head: { appendChild: () => undefined }, body: {},
      createElement: () => ({ textContent: '', dataset: {}, addEventListener: () => undefined }),
      getElementById: (id: string) => id === 'modal' ? dialog : id === 'modalContent' ? modalContent : null,
      querySelector: () => null,
      querySelectorAll: (selector: string) => selector.startsWith('button[onclick*="openSite("]') ? siteButtons : []
    },
    MutationObserver: class { observe() {} },
    requestAnimationFrame: (callback: () => void) => callback(),
    setTimeout: (callback: () => void) => { callback(); return 1; },
    isOffice: () => true,
    currentTeamId: () => 'team-1', roleName: () => 'Titolare',
    esc: (value: unknown) => String(value ?? ''), badge: (value: unknown) => `<span>${value}</span>`,
    alert: () => undefined, confirm: () => true, closeModal: () => undefined, render: () => undefined,
    uid: () => 'id-1', modal: () => undefined,
    CSS: { escape: (value: string) => value }, Date, Array, Number, String, Math
  };
  vm.runInNewContext(quickSitePhotos, context);
  return { windowObject, openedReports, modalContent, dialog };
}

test('la finestra Foto mostra sia gli album rapidi sia le foto dei rapportini già caricati', () => {
  const { windowObject, modalContent, dialog } = testContext();
  const openAlbums = windowObject.openQuickPhotoAlbums as (siteId: string) => void;
  openAlbums('site-1');
  assert.equal(dialog.opened, true);
  assert.match(modalContent.innerHTML, /3 fotografie · 2 album e rapportini/);
  assert.match(modalContent.innerHTML, /Album fotografico/);
  assert.match(modalContent.innerHTML, /Rapportino RAP-2026-0001/);
  assert.match(modalContent.innerHTML, /Foto 1/);
  assert.match(modalContent.innerHTML, /Foto 2/);
});

test('una foto di un vecchio rapportino usa l’apertura fotografica già esistente', async () => {
  const { windowObject, openedReports } = testContext();
  const openPhoto = windowObject.openQuickSitePhoto as (albumId: string, photoIndex: number) => Promise<void>;
  await openPhoto('report-1', 1);
  assert.deepEqual(openedReports, [['report-1', 1]]);
});

test('la Home mobile mantiene le priorità compatte senza aggiungere i comandi Foto', () => {
  let inserted = 0;
  const source = {
    dataset: {},
    getAttribute: () => "openSite('site-1')",
    closest: (selector: string) => selector === '[data-home-priority]' ? {} : null,
    parentElement: { querySelector: () => null },
    insertAdjacentElement: () => { inserted += 1; }
  };
  testContext([source]);
  assert.equal(inserted, 0);

  let detailInserted = 0;
  const detailSource = {
    dataset: {},
    getAttribute: () => "openSite('site-1')",
    closest: () => null,
    parentElement: { querySelector: () => null },
    insertAdjacentElement: () => { detailInserted += 1; }
  };
  testContext([detailSource]);
  assert.equal(detailInserted, 1);
  assert.match(indexHtml, /data-home-priority/);
  assert.match(indexHtml, /class="btn sm light priorityOpen"/);
  assert.match(quickSitePhotos, /source\.closest\('\[data-home-priority\]'\)/);
  assert.match(modernUi, /dashboardPriority \[data-quick-site\]/);
});
