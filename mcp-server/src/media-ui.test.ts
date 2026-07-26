import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const businessSuite = readFileSync(new URL('../../business-suite.js', import.meta.url), 'utf8');
const firebaseCloud = readFileSync(new URL('../../firebase-cloud.js', import.meta.url), 'utf8');
const storageRules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');

test('i preventivi permettono di aggiungere e aprire foto e video', () => {
  assert.ok(businessSuite.includes("window.manageQuoteMedia"));
  assert.ok(businessSuite.includes("category: 'Preventivo - foto e video'"));
  assert.ok(businessSuite.includes('📷 Foto/Video'));
});

test('le videoispezioni drone conservano i filmati collegati', () => {
  assert.ok(businessSuite.includes("window.manageDroneMedia"));
  assert.ok(businessSuite.includes("category: 'Videoispezione drone'"));
  assert.ok(businessSuite.includes('🎬 Video/Foto'));
});

test('il cloud usa caricamenti riprendibili per file multimediali grandi', () => {
  assert.ok(firebaseCloud.includes('uploadBytesResumable'));
  assert.ok(firebaseCloud.includes('MEDIA_MAX_BYTES = 2 * 1024 * 1024 * 1024'));
  assert.ok(firebaseCloud.includes("'video/quicktime'"));
});

test('le regole Storage autorizzano foto e video fino a 2 GB', () => {
  assert.ok(storageRules.includes('request.resource.size <= 2 * 1024 * 1024 * 1024'));
  assert.ok(storageRules.includes('video/(mp4|quicktime|webm|x-m4v)'));
});
