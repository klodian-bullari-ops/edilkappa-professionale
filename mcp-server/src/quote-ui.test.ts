import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const businessSuite = readFileSync(new URL('../../business-suite.js', import.meta.url), 'utf8');
const smartOperations = readFileSync(new URL('../../smart-operations.js', import.meta.url), 'utf8');

test('i preventivi archiviati aprono il documento originale', () => {
  assert.ok(businessSuite.includes('item?.storagePath || item?.pdfKey'));
  assert.ok(businessSuite.includes("item.storagePath ? 'Apri originale' : 'Apri PDF'"));
});

test('non rigenera un PDF vuoto quando mancano voci e importo', () => {
  assert.ok(smartOperations.includes('if (item.storagePath || item.pdfKey) return openQuotePdf(id)'));
  assert.ok(smartOperations.includes('if (!item.lines?.length && !Number(item.net || 0)) return alert'));
});

test('un importo non estratto rimanda al PDF originale', () => {
  assert.ok(businessSuite.includes("return item.storagePath ? 'Nel PDF originale' : euro(numeric)"));
});
