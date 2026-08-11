import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sharingUi = readFileSync(new URL('../../sharing-integration.js', import.meta.url), 'utf8');
const quickPhotosUi = readFileSync(new URL('../../quick-site-photos.js', import.meta.url), 'utf8');
const cloudUi = readFileSync(new URL('../../firebase-cloud.js', import.meta.url), 'utf8');
const documentsUi = readFileSync(new URL('../../professional-extensions.js', import.meta.url), 'utf8');
const storageRules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const bulkSharingUi = readFileSync(new URL('../../bulk-sharing.js', import.meta.url), 'utf8');

test('il modulo di condivisione è sintatticamente valido', () => {
  assert.doesNotThrow(() => new vm.Script(sharingUi));
});

test('ogni file archiviato offre la scelta del canale senza precaricare i file cloud', () => {
  assert.ok(sharingUi.includes('App del dispositivo'));
  assert.ok(sharingUi.includes('WhatsApp'));
  assert.ok(sharingUi.includes('E-mail'));
  assert.ok(sharingUi.includes('Scarica'));
  assert.ok(sharingUi.includes('Copia collegamento'));
  assert.ok(sharingUi.includes('navigator.share'));
  assert.ok(sharingUi.includes('getDocumentUrl'));
  assert.ok(!sharingUi.includes('await fetch(sourceUrl)'));
});

test('la finestra reale mostra i canali per documenti e tutte le foto del cantiere', () => {
  const data = {
    documents: [{ id: 'doc-1', title: 'Relazione', fileName: 'relazione.xlsx', fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: 1200, storagePath: 'documenti/relazione.xlsx' }],
    sites: [{ id: 'site-1', title: 'Cantiere Prova' }],
    reports: [{ id: 'album-1', site: 'site-1', photos: [
      { fileName: 'tubo-nuovo-1.jpeg', fileType: 'image/jpeg', storagePath: 'foto/1.jpeg' },
      { fileName: 'tubo-nuovo-2.jpeg', fileType: 'image/jpeg', storagePath: 'foto/2.jpeg' }
    ] }],
    interventions: [], leads: []
  };
  const modalContent = {
    innerHTML: '',
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const dialog = { open: false, showModal() { this.open = true; } };
  const windowObject: Record<string, any> = {
    EdilKappaLocal: { getDB: () => data, getRole: () => 'owner' },
    EdilKappaCloud: { currentProfile: { role: 'owner' } },
    addEventListener: () => undefined,
    open: () => null,
    location: { href: '' }
  };
  const source = sharingUi.slice(0, sharingUi.lastIndexOf("import('./quick-site-photos.js"));
  vm.runInNewContext(source, {
    window: windowObject,
    document: {
      body: {}, head: { appendChild: () => undefined },
      createElement: () => ({ textContent: '', dataset: {}, addEventListener: () => undefined }),
      getElementById: (id: string) => id === 'modal' ? dialog : id === 'modalContent' ? modalContent : null,
      querySelectorAll: () => []
    },
    navigator: {}, HTMLElement: class {}, MutationObserver: class { observe() {} },
    requestAnimationFrame: (callback: () => void) => callback(),
    setTimeout: () => 1, URL, alert: () => undefined, prompt: () => undefined,
    confirm: () => false, modal: () => undefined, console
  });

  windowObject.openArchiveShare('documents', 'doc-1');
  assert.match(modalContent.innerHTML, /relazione\.xlsx/);
  assert.match(modalContent.innerHTML, /App del dispositivo/);
  assert.match(modalContent.innerHTML, /WhatsApp/);

  windowObject.openSitePhotoShare('site-1');
  assert.match(modalContent.innerHTML, /Cantiere Prova/);
  assert.match(modalContent.innerHTML, /tubo-nuovo-1\.jpeg/);
  assert.match(modalContent.innerHTML, /tubo-nuovo-2\.jpeg/);
  assert.match(modalContent.innerHTML, /2 file selezionati/);
});

test('Danea usa il collegamento diretto e TransferNow resta facoltativo', () => {
  const daneaFunction = sharingUi.slice(
    sharingUi.indexOf('window.shareArchiveToDanea'),
    sharingUi.indexOf('function sharingRoleAllowed')
  );
  assert.ok(daneaFunction.includes('shareDirectToDanea'));
  assert.ok(!daneaFunction.includes('createTransfer(context)'));
  assert.ok(sharingUi.includes('Facoltativo per file grandi'));
});

test('le foto di un cantiere si possono selezionare e condividere insieme', () => {
  assert.ok(sharingUi.includes('window.openSitePhotoShare'));
  assert.ok(sharingUi.includes('Seleziona tutto'));
  assert.ok(quickPhotosUi.includes('↗ Condividi foto'));
});

test('Excel e CSV sono ammessi nell’archivio cloud', () => {
  for (const type of [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]) {
    assert.ok(cloudUi.includes(type));
  }
  assert.ok(storageRules.includes('ms-excel'));
  assert.ok(storageRules.includes('spreadsheetml'));
  assert.ok(storageRules.includes('text/csv'));
  assert.ok(documentsUi.includes('.xlsx'));
  assert.ok(documentsUi.includes('.xls'));
  assert.ok(documentsUi.includes('.csv'));
});

test('la cache viene aggiornata per consegnare la nuova condivisione ai telefoni', () => {
  assert.match(serviceWorker, /const CACHE = `\$\{CACHE_PREFIX\}v\d+-[a-z0-9-]+`/);
});

test('Condividi non viene aggiunto alle priorità compatte della Home', () => {
  assert.match(bulkSharingUi, /button\.closest\('\[data-home-priority\]'\)/);
});
