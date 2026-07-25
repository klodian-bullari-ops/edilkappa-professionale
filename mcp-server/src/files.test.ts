import assert from 'node:assert/strict';
import test from 'node:test';
import { hostAllowed, resolveMimeType, safeFileName } from './files.js';
import { stableRecordId } from './repository.js';

test('normalizza il nome senza consentire segmenti di percorso', () => {
  assert.equal(safeFileName('../../Relazione tècnica.pdf'), 'Relazione-tecnica.pdf');
  assert.equal(safeFileName('...'), 'documento');
});

test('consente soltanto il dominio esatto o un vero sottodominio', () => {
  assert.equal(hostAllowed('sdmntpr.oaiusercontent.com', ['.oaiusercontent.com']), true);
  assert.equal(hostAllowed('oaiusercontent.com.evil.example', ['.oaiusercontent.com']), false);
  assert.equal(hostAllowed('chatgpt.com', ['chatgpt.com']), true);
});

test('riconosce un PDF dal nome quando il server usa un tipo generico', () => {
  assert.equal(resolveMimeType({
    download_url: 'https://example.invalid/file',
    file_id: 'file_1',
    file_name: 'preventivo.pdf'
  }, 'application/octet-stream'), 'application/pdf');
});

test('rifiuta tipi eseguibili o non previsti', () => {
  assert.throws(() => resolveMimeType({
    download_url: 'https://example.invalid/file',
    file_id: 'file_1',
    file_name: 'file.exe',
    mime_type: 'application/x-msdownload'
  }), /formato dichiarato non è supportato/);
});

test('rifiuta una risposta HTML mascherata con estensione PDF', () => {
  assert.throws(() => resolveMimeType({
    download_url: 'https://example.invalid/file',
    file_id: 'file_1',
    file_name: 'preventivo.pdf'
  }, 'text/html'), /server del file ha restituito un formato non supportato/);
});

test('genera ID stabili per rendere i salvataggi idempotenti', () => {
  const first = stableRecordId('chatgpt-prev', ['file_1', 'PREV-1', 'Tetto', 'cliente']);
  const second = stableRecordId('chatgpt-prev', ['file_1', 'PREV-1', 'Tetto', 'cliente']);
  assert.equal(first, second);
  assert.match(first, /^chatgpt-prev-[a-f0-9]{24}$/);
});
