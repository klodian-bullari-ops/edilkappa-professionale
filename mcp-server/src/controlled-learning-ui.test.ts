import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const learning = readFileSync(new URL('../../controlled-learning.js', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../../edilkappa-ai.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');

function loadLearning(database: Record<string, unknown>, activeRole = 'owner') {
  let renderNavCount = 0;
  const document = {
    createElement: () => ({ textContent: '' }),
    head: { appendChild() {} },
    getElementById: () => null
  };
  const window: Record<string, unknown> = {};
  const context = vm.createContext({
    window, document, db: database, role: activeRole, ownerNav: [],
    render() {}, openQuote() {}, save() {}, renderNav() { renderNavCount += 1; }, initRoles() {},
    isOffice: () => true, roleName: () => activeRole === 'owner' ? 'Titolare' : 'Ufficio',
    esc: (value: unknown) => String(value ?? ''), euro: (value: unknown) => `€${Number(value || 0).toFixed(2)}`,
    stat: () => '', modal() {}, alert() {}, confirm: () => true,
    Option: function Option() {}, console, Date, Set, Map, String, Number, JSON, Math
  });
  window.openQuote = context.openQuote;
  vm.runInContext(learning, context, { filename: 'controlled-learning.js' });
  return { context, renderNavCount, api: window.EdilKappaLearning as { isVerified(item: Record<string, unknown>): boolean; recordQuoteChange(item: Record<string, unknown>, before: Record<string, unknown>): boolean } };
}

test('il modulo di apprendimento controllato è caricato e disponibile offline', () => {
  assert.ok(indexHtml.includes('./controlled-learning.js?v=2'));
  assert.ok(indexHtml.includes("['learningCenter','🧠','Memoria AI']"));
  assert.ok(serviceWorker.includes('v68-ai-job-recovery'));
  assert.ok(serviceWorker.includes('"./controlled-learning.js"'));
});

test('Memoria AI compare nel menu già alla prima apertura', () => {
  const loaded = loadLearning({ quotes: [], sites: [], timesheets: [], reports: [], priceList: [] });
  assert.equal(loaded.renderNavCount, 1);
  assert.ok((loaded.context.ownerNav as Array<string[]>).some((entry) => entry[0] === 'learningCenter'));
});

test('Memoria AI resta entro lo schermo e consente di segnare tutto come letto', () => {
  assert.ok(learning.includes('learningCenterLayout'));
  assert.ok(learning.includes('learningQuoteRow'));
  assert.ok(learning.includes('window.learningMarkAllRead'));
  assert.ok(learning.includes('Segna tutti come letti'));
  assert.ok(learning.includes('Non verranno approvati per l’AI'));
});

test('le correzioni ai preventivi vengono registrate senza modificare il listino DEI', () => {
  assert.ok(learning.includes('recordQuoteChange'));
  assert.ok(learning.includes("type: created ? 'creation' : 'correction'"));
  assert.ok(learning.includes('non modifica autonomamente il listino DEI'));
  assert.ok(learning.includes('Da riconfermare'));
});

test('solo il titolare può verificare esempi e consuntivi reali', () => {
  assert.ok(learning.includes("role !== 'owner'"));
  assert.ok(learning.includes('learningVerifyQuote'));
  assert.ok(learning.includes('openLearningActuals'));
  assert.ok(learning.includes('Verificato con consuntivo'));
});

test('la memoria prezzi usa soltanto preventivi verificati', () => {
  assert.ok(learning.includes('(db.quotes || []).filter(isVerified)'));
  assert.ok(learning.includes('median'));
  assert.ok(learning.includes('Solo da esempi verificati'));
  assert.ok(ai.includes('["Da controllare", "Da riconfermare"].includes(learningState)'));
});

test('una correzione dell’ufficio sospende davvero un esempio fino alla riconferma del titolare', () => {
  const quote = { id: 'q1', status: 'Approvato', learningStatus: 'Verificato dal titolare', subject: 'Intonaco', net: 1000, lines: [{ description: 'Intonaco', quantity: 10, unit: 'm²', unitPrice: 100 }] };
  const before = { subject: quote.subject, net: quote.net, status: quote.status, lines: quote.lines.map((line) => ({ ...line, unitCost: 0 })) };
  quote.net = 1200;
  const { api } = loadLearning({ quotes: [quote], sites: [], timesheets: [], reports: [], priceList: [] }, 'secretary');
  assert.equal(api.recordQuoteChange(quote, before), true);
  assert.equal(quote.learningStatus, 'Da riconfermare');
  assert.equal(api.isVerified(quote), false);
});

test('una correzione eseguita dal titolare resta un insegnamento verificato e tracciato', () => {
  const quote = { id: 'q2', status: 'Approvato', learningStatus: 'Verificato dal titolare', subject: 'Ripristino', net: 2000, lines: [{ description: 'Ripristino', quantity: 20, unit: 'm²', unitPrice: 100 }], revisions: [] as Array<{ verified: boolean }> };
  const before = { subject: quote.subject, net: quote.net, status: quote.status, lines: quote.lines.map((line) => ({ ...line, unitCost: 0 })) };
  quote.lines[0].unitPrice = 110;
  const { api } = loadLearning({ quotes: [quote], sites: [], timesheets: [], reports: [], priceList: [] }, 'owner');
  assert.equal(api.recordQuoteChange(quote, before), true);
  assert.equal(quote.learningStatus, 'Verificato dal titolare');
  assert.equal(api.isVerified(quote), true);
  assert.equal((quote.revisions as Array<{ verified: boolean }>).at(-1)?.verified, true);
});
