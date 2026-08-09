import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(process.cwd(), '..');
const source = fs.readFileSync(path.join(root, 'hours-closeout.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const directSearch = fs.readFileSync(path.join(root, 'direct-search.js'), 'utf8');
const edilconnect = fs.readFileSync(path.join(root, 'edilconnect.js'), 'utf8');
const businessSuite = fs.readFileSync(path.join(root, 'business-suite.js'), 'utf8');
const firebaseCloud = fs.readFileSync(path.join(root, 'firebase-cloud.js'), 'utf8');
const repository = fs.readFileSync(path.join(root, 'mcp-server/src/repository.ts'), 'utf8');

type AppContext = Record<string, any> & {
  db: Record<string, any[]>;
  STAFF: Array<Record<string, any>>;
  EdilKappaHours?: Record<string, (...args: any[]) => any>;
};

function appContext(): AppContext {
  const staff = [
    { id: 'worker-1', name: 'Ajet', team: 'team-1', reminderTime: '18:00' },
    { id: 'worker-2', name: 'Ciccio', team: 'team-1', reminderTime: '18:00' }
  ];
  const db = {
    sites: [], timesheets: [], roofs: [], drains: [], teams: [{ id: 'team-1', name: 'Squadra A' }], staff
  };
  const storage = new Map<string, string>();
  const context: AppContext = {
    db,
    STAFF: staff,
    WORKERS: db.teams,
    role: 'worker-1',
    view: 'worker',
    timesheetMonth: '2026-08',
    timesheetTeam: '',
    COMPANY: { name: 'EDILKAPPA', address: '', vat: '', phone: '', email: '' },
    window: null,
    document: {
      head: { appendChild: () => undefined },
      createElement: () => ({ textContent: '' }),
      querySelectorAll: () => []
    },
    navigator: {},
    history: { replaceState: () => undefined },
    location: { href: 'https://example.test/' },
    URL,
    Notification: { permission: 'default' },
    localStorage: {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    },
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    alert: () => undefined,
    save: () => undefined,
    render: () => undefined,
    renderNav: () => undefined,
    dashboard: () => '',
    worker: () => '',
    report: () => '',
    workerIndividualHours: () => '',
    officeIndividualHours: () => '',
    printHoursPdf: () => undefined,
    checkHourReminders: () => undefined,
    currentStaff: () => staff.find((person) => person.id === context.role),
    currentTeamId: () => context.currentStaff()?.team || '',
    localToday: () => '2026-08-06',
    siteTeamIds: (site: any) => site.teamIds || [site.worker].filter(Boolean),
    siteHasTeam: (site: any, teamId: string) => (site.teamIds || [site.worker]).includes(teamId),
    staffForTeam: (teamId: string) => staff.filter((person) => person.team === teamId),
    individualHourRows: () => db.timesheets,
    filteredIndividualHours: () => db.timesheets,
    teamJobOptions: () => '<option>Magazzino</option>',
    isOffice: () => false,
    roleName: () => 'Ajet',
    pageHead: () => '',
    field: () => '',
    badge: () => '',
    stat: () => '',
    esc: (value: unknown) => String(value ?? ''),
    uid: () => 'generated-id',
    modal: () => undefined,
    go: () => undefined,
    openReport: () => undefined,
    updateRoofTask: () => undefined,
    updateDrainTask: () => undefined,
    callOwner: () => undefined,
    requestHourNotifications: () => undefined,
    downloadHoursReminder: () => undefined,
    saveIndividualHours: () => undefined,
    openIndividualHoursEntry: () => undefined,
    deleteItem: () => undefined,
    openSite: () => undefined,
    addEventListener: () => undefined
  };
  context.window = context;
  context.modal = (title: string, body: string, onSave: (data: { get: (name: string) => string }) => void) => {
    context.lastModal = { title, body, onSave };
  };
  context.window.EdilKappaLocal = { getDB: () => db };
  vm.runInNewContext(source, context, { filename: 'hours-closeout.js' });
  return context;
}

test('il modulo ore è caricato dall’app e dalla cache offline', () => {
  assert.match(indexHtml, /hours-closeout\.js\?v=2/);
  assert.match(serviceWorker, /hours-closeout\.js/);
  assert.match(source, /L’avviso rimane finché non inserisci le tue ore/);
  assert.match(source, /Ore mancanti sui cantieri conclusi/);
});

test('separa automaticamente ore ordinarie e straordinarie', () => {
  const app = appContext();
  const weekday = app.EdilKappaHours?.hourBreakdown(9, '2026-08-05');
  assert.deepEqual(JSON.parse(JSON.stringify(weekday)), { total: 9, ordinary: 8, overtime: 1 });

  const saturday = app.EdilKappaHours?.hourBreakdown(9, '2026-08-08');
  assert.deepEqual(JSON.parse(JSON.stringify(saturday)), { total: 9, ordinary: 0, overtime: 9 });

  const split = app.EdilKappaHours?.annotateHourRows([
    { id: 'a', worker: 'worker-1', date: '2026-08-05', hours: 5, createdAt: '2026-08-05T09:00:00Z' },
    { id: 'b', worker: 'worker-1', date: '2026-08-05', hours: 4, createdAt: '2026-08-05T18:00:00Z' }
  ]);
  assert.equal(split?.[0].ordinaryHours, 5);
  assert.equal(split?.[0].overtimeHours, 0);
  assert.equal(split?.[1].ordinaryHours, 3);
  assert.equal(split?.[1].overtimeHours, 1);
});

test('un cantiere concluso resta solo all’operaio con ore mancanti', () => {
  const app = appContext();
  const site = {
    id: 'site-1',
    title: 'Copertura Condominio Alfa',
    client: 'Condominio Alfa',
    status: 'Completato',
    teamIds: ['team-1'],
    hoursCloseoutDate: '2026-08-06',
    hoursCloseoutWorkers: [{ id: 'worker-1', name: 'Ajet', team: 'team-1' }]
  };
  app.db.sites.push(site);

  assert.equal(app.EdilKappaHours?.workerCanSeeSite(site, app.STAFF[0]), true);
  assert.deepEqual(JSON.parse(JSON.stringify(app.EdilKappaHours?.missingPeopleForSite(site).map((person: any) => person.name))), ['Ajet', 'Ciccio']);
  app.openCloseoutHours('site-1');
  app.lastModal.onSave({ get: (name: string) => ({ hours: '9', notes: 'Chiusura completata' })[name] || '' });
  assert.equal(app.db.timesheets[0].ordinaryHours, 8);
  assert.equal(app.db.timesheets[0].overtimeHours, 1);
  assert.equal(app.EdilKappaHours?.workerCanSeeSite(site, app.STAFF[0]), false);
  assert.equal(app.EdilKappaHours?.workerCanSeeSite(site, app.STAFF[1]), true);
  assert.deepEqual(JSON.parse(JSON.stringify(app.EdilKappaHours?.missingPeopleForSite(site).map((person: any) => person.name))), ['Ciccio']);
});

test('alla chiusura fotografa gli operai assegnati e conserva la data del rapportino', () => {
  const app = appContext();
  const site: any = { id: 'site-2', title: 'Facciata', status: 'In corso', teamIds: ['team-1'] };
  app.db.sites.push(site);
  app.save();
  site.status = 'Completato';
  site.hoursCloseoutDate = '2026-08-05';
  app.save();

  assert.equal(site.hoursCloseoutDate, '2026-08-05');
  assert.equal(site.hoursCloseoutWorkers.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(site.hoursCloseoutWorkers.map((person: any) => person.name))), ['Ajet', 'Ciccio']);
});

test('ricerca e selettore cantieri rispettano la visibilità personale', () => {
  assert.match(directSearch, /window\.workerCanSeeSite/);
  assert.match(directSearch, /window\.openCloseoutHours/);
  assert.match(edilconnect, /window\.workerCanSeeSite/);
  assert.match(edilconnect, /!completed/);
  assert.match(edilconnect, /Ore straordinarie/);
  assert.match(firebaseCloud, /get workerProfiles\(\)/);
  assert.match(repository, /hoursCloseoutDate: becameCompleted/);
});

test('il rapportino mantiene foto e firma ma richiede soltanto il totale ore', () => {
  assert.match(businessSuite, /Totale ore lavorate/);
  assert.match(businessSuite, /photosBefore/);
  assert.match(businessSuite, /reportSignatureCanvas/);
  assert.match(businessSuite, /site\.hoursCloseoutDate = String\(item\.workDate/);
  assert.doesNotMatch(businessSuite, /name="startTime"/);
  assert.doesNotMatch(businessSuite, /name="endTime"/);
  assert.match(businessSuite, /toLocaleLowerCase\('it'\) !== 'completato'/);
});
