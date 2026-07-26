import assert from 'node:assert/strict';
import test from 'node:test';
import { mapDaneaStatus, normalizeDaneaLink, sameDaneaRequest, stableRecordId, type DaneaStatus } from './repository.js';

test('mappa gli stati Danea negli stati operativi EdilKappa', () => {
  const expected: Record<DaneaStatus, string> = {
    Nuovo: 'Nuova',
    'Preso in carico': 'In attesa',
    'In corso': 'In corso',
    Posticipato: 'Sospeso',
    Completato: 'Completato',
    Inoltrato: 'Assegnato',
    Rifiutato: 'Rifiutato'
  };

  for (const [status, mapped] of Object.entries(expected)) {
    assert.equal(mapDaneaStatus(status as DaneaStatus), mapped);
  }
});

test('accetta soltanto collegamenti HTTPS ufficiali Danea o MioCondominio', () => {
  assert.equal(
    normalizeDaneaLink('https://fornitori.miocondominio.eu/interventi/123'),
    'https://fornitori.miocondominio.eu/interventi/123'
  );
  assert.equal(
    normalizeDaneaLink('https://app.danea.it/intervento/123'),
    'https://app.danea.it/intervento/123'
  );
  assert.throws(
    () => normalizeDaneaLink('http://app.danea.it/intervento/123'),
    /deve appartenere a Danea o MioCondominio/
  );
  assert.throws(
    () => normalizeDaneaLink('https://danea.it.evil.example/intervento/123'),
    /deve appartenere a Danea o MioCondominio/
  );
});

test('genera lo stesso ID per lo stesso messaggio Danea', () => {
  const first = stableRecordId('danea', ['email', '<message-123@example.test>']);
  const retry = stableRecordId('danea', ['email', '<message-123@example.test>']);
  assert.equal(first, retry);
  assert.match(first, /^danea-[a-f0-9]{24}$/);
});

test('riconosce la stessa richiesta creata dall’app tramite studio e codice', () => {
  const existing = {
    source: 'Danea Interventi',
    daneaId: '45538',
    studio: 'STUDIODCR',
    title: 'Infiltrazione locale ascensore',
    client: 'Condominio Padova 213/A',
    receivedAt: '2026-06-16T15:24:00.000Z'
  };

  assert.equal(sameDaneaRequest(existing, {
    sourceMessageId: '<nuovo-messaggio@example.test>',
    interventionId: '45538',
    studio: 'Studio DCR',
    title: 'Aggiornamento infiltrazione',
    receivedAt: '2026-06-17T08:00:00.000Z'
  }, 'Condominio Padova 213/A'), true);
});

test('non unisce codici Danea uguali appartenenti a studi diversi', () => {
  const existing = {
    source: 'Danea Interventi',
    daneaId: '45538',
    studio: 'Studio Alfa',
    title: 'Infiltrazione',
    client: 'Condominio Padova'
  };

  assert.equal(sameDaneaRequest(existing, {
    interventionId: '45538',
    studio: 'Studio Beta',
    title: 'Infiltrazione',
    receivedAt: '2026-06-17T08:00:00.000Z'
  }, 'Condominio Padova'), false);
});
