import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const moduleSource = readFileSync(new URL('../../edilconnect.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const cloudUi = readFileSync(new URL('../../firebase-cloud.js', import.meta.url), 'utf8');
const firestoreRules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');

type EdilConnectApi = {
  suggestedCongruity: (input: Record<string, unknown>) => boolean;
  validCuc: (value: string) => boolean;
  jobOptions: (teamId: string, selectedSiteId?: string, includeAll?: boolean, selectedJob?: string) => string;
  monthData: (month: string, siteId?: string, workerKey?: string) => {
    rows: Array<Record<string, unknown>>;
    matrix: Array<{ workerName: string; hours: number; days: Set<string> }>;
    totalHours: number;
    linkedHours: number;
    outsideHours: number;
    unlinked: Array<Record<string, unknown>>;
    anomalies: Array<Record<string, unknown>>;
  };
  csvContent: (data: ReturnType<EdilConnectApi['monthData']> & { month: string }) => string;
};

function loadModule() {
  // Fixture completamente sintetica: non contiene clienti, lavoratori o codici CUC reali.
  const context: Record<string, unknown> = {
    Array,
    Blob,
    Date,
    Map,
    Math,
    Number,
    Set,
    String,
    URL,
    console,
    setTimeout: () => 1,
    db: {
      sites: [
        { id: 'site-1', code: 'EK-1', title: 'Rifacimento tetto', client: 'Condominio Alfa', clientId: 'client-1', interventionId: 'int-1', address: 'Via Alfa 1', value: 80000, status: 'In corso', teamIds: ['team-1', 'team-2'] }
      ],
      roofs: [{ id: 'roof-1', type: 'Pulizia gronde', client: 'Condominio Alfa', worker: 'team-1' }],
      drains: [{ id: 'drain-1', type: 'Pulizia pozzetti', client: 'Condominio Alfa', worker: 'team-2' }],
      timesheets: [
        { id: 'h-1', date: '2026-08-04', worker: 'worker-1', workerName: 'Operaio Alfa', team: 'team-1', teamName: 'Squadra A', siteId: 'site-1', job: 'Rifacimento tetto · Condominio Alfa', hours: 8 },
        { id: 'h-2', date: '2026-08-04', worker: 'worker-1', workerName: 'Operaio Alfa', team: 'team-1', teamName: 'Squadra A', siteId: 'site-1', job: 'Rifacimento tetto · Condominio Alfa', hours: 6 },
        { id: 'h-3', date: '2026-08-04', worker: 'worker-2', workerName: 'Operaio Beta', team: 'team-2', teamName: 'Squadra B', job: 'Rifacimento tetto · Condominio Alfa', hours: 7 },
        { id: 'h-4', date: '2026-08-05', worker: 'worker-2', workerName: 'Operaio Beta', team: 'team-2', teamName: 'Squadra B', workType: 'outside', job: 'Magazzino / preparazione', hours: 2 },
        { id: 'h-5', date: '2026-08-05', worker: 'worker-3', workerName: 'Operaio Gamma', team: 'team-2', teamName: 'Squadra B', job: 'Cantiere da chiarire', hours: 3 }
      ],
      edilconnect: [
        { id: 'edilconnect-site-site-1', recordType: 'site', siteId: 'site-1', commissionType: 'Privato', companyRole: 'Affidataria', totalWorkValue: 80000, buildingWorkValue: 70000, subjectMode: 'Automatico', cuc: 'CNCEC0000000000', dnlStatus: 'Comunicata', certificateStatus: 'Da richiedere a fine lavori', status: 'Attivo' }
      ],
      reports: []
    },
    WORKERS: [{ id: 'team-1', name: 'Squadra A' }, { id: 'team-2', name: 'Squadra B' }],
    ownerNav: [['hours', '◷', 'Ore operai']],
    more: () => '',
    renderNav: () => undefined,
    dashboard: () => '',
    siteRow: () => '<button class="btn sm light" onclick="openSite(\'site-1\')">Modifica</button>',
    render: () => undefined,
    saveReport: async () => undefined,
    deleteItem: () => undefined,
    teamJobOptions: () => '',
    saveIndividualHours: () => undefined,
    openIndividualHoursEntry: () => undefined,
    view: 'dashboard',
    timesheetMonth: '2026-08',
    siteHasTeam: (site: { teamIds?: string[] }, teamId: string) => site.teamIds?.includes(teamId),
    isOffice: () => true,
    pageHead: () => '',
    esc: (value: unknown) => String(value ?? ''),
    stat: () => '',
    euro: (value: number) => String(value),
    badge: () => '',
    roleName: () => 'Titolare',
    currentStaff: () => null,
    currentTeamId: () => '',
    field: () => '',
    modal: () => undefined,
    save: () => undefined,
    localToday: () => '2026-08-05',
    uid: (prefix: string) => `${prefix}-1`,
    alert: () => undefined,
    confirm: () => true,
    prompt: () => '',
    COMPANY: { name: 'EDILKAPPA' },
    navigator: { clipboard: { writeText: async () => undefined } },
    document: {
      createElement: () => ({ textContent: '', click: () => undefined }),
      head: { appendChild: () => undefined },
      querySelectorAll: () => [],
      getElementById: () => ({ textContent: '', innerHTML: '' })
    }
  };
  context.window = context;
  context.EdilKappaLocal = { getDB: () => context.db };
  vm.createContext(context);
  vm.runInContext(moduleSource, context, { filename: 'edilconnect.js' });
  return context.EdilKappaEdilConnect as EdilConnectApi;
}

test('la congruità viene suggerita per lavori pubblici e privati da 70.000 euro', () => {
  const api = loadModule();
  assert.equal(api.suggestedCongruity({ commissionType: 'Pubblico', totalWorkValue: 1000 }), true);
  assert.equal(api.suggestedCongruity({ commissionType: 'Privato', totalWorkValue: 70000 }), true);
  assert.equal(api.suggestedCongruity({ commissionType: 'Privato', totalWorkValue: 69999 }), false);
});

test('il CUC segue il formato ufficiale e le attività esistenti restano selezionabili', () => {
  const api = loadModule();
  assert.equal(api.validCuc('CNCEC0000000000'), true);
  assert.equal(api.validCuc('1234567890ABCDE'), false);
  assert.match(api.jobOptions('team-1'), /site:site-1/);
  assert.match(api.jobOptions('team-1'), /activity:roof:roof-1/);
  assert.doesNotMatch(api.jobOptions('team-1'), /activity:drain:drain-1/);
});

test('le ore esistenti vengono collegate al cantiere senza reinserimento', () => {
  const api = loadModule();
  const data = api.monthData('2026-08');
  assert.equal(data.totalHours, 26);
  assert.equal(data.linkedHours, 21);
  assert.equal(data.outsideHours, 2);
  assert.equal(data.unlinked.length, 1);
  assert.equal(data.anomalies.length, 1);
  assert.equal(data.matrix.filter((row) => row.workerName === 'Operaio Alfa')[0]?.hours, 14);
});

test('il CSV usa UTF-8, separatore Excel italiano e include il CUC', () => {
  const api = loadModule();
  const data = api.monthData('2026-08');
  const csv = api.csvContent({ ...data, month: '2026-08' });
  assert.ok(csv.startsWith('\ufeff'));
  assert.match(csv, /"Mese";"Data";"Operaio"/);
  assert.match(csv, /CNCEC0000000000/);
  assert.match(csv, /"8,00"/);
});

test('i dati amministrativi EdilConnect restano separati e riservati', () => {
  assert.match(indexHtml, /edilconnect:\[\]/);
  assert.match(indexHtml, /\.\/edilconnect\.js\?v=2/);
  assert.match(indexHtml, /'timesheets','absences','edilconnect','drone'/);
  assert.match(cloudUi, /\['edilconnect', 'edilconnect'\]/);
  assert.match(firestoreRules, /match \/edilconnect\/\{docId\}[\s\S]*allow read: if isStaff\(\)/);
  assert.doesNotMatch(firestoreRules, /match \/edilconnect\/\{docId\}[\s\S]{0,240}workerOwns/);
});

test('la nuova funzione è disponibile offline', () => {
  assert.match(serviceWorker, /const CACHE = `\$\{CACHE_PREFIX\}v\d+-[a-z0-9-]+`/);
  assert.match(serviceWorker, /"\.\/edilconnect\.js"/);
  assert.match(serviceWorker, /caches\.match\(event\.request, \{ ignoreSearch: true \}\)/);
  assert.match(moduleSource, /https:\/\/www\.congruitanazionale\.it\/Home\/Simulatore/);
  assert.match(moduleSource, /#modalForm>\.modalBody\{[^}]*overflow-y:auto/);
  assert.match(moduleSource, /\.edilconnectWarning \.row\{display:grid/);
  assert.match(indexHtml, /\.\/sw\.js\?v=\d+/);
});
