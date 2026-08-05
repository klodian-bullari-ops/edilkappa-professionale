import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const lifecycleUi = readFileSync(new URL('../../intervention-lifecycle.js', import.meta.url), 'utf8');
const cloudUi = readFileSync(new URL('../../firebase-cloud.js', import.meta.url), 'utf8');
const firestoreRules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

function helperSource(name: string): string {
  const line = indexHtml.split('\n').find((entry) => entry.startsWith(`function ${name}(`));
  assert.ok(line, `Funzione ${name} non trovata`);
  return line;
}

test('un cantiere mantiene la vecchia squadra e accetta più squadre', () => {
  const context: Record<string, unknown> = { Array, Set, String };
  vm.createContext(context);
  vm.runInContext([
    helperSource('siteTeamIds'),
    helperSource('siteHasTeam'),
    helperSource('applySiteTeams')
  ].join('\n'), context);

  const siteTeamIds = context.siteTeamIds as (site: Record<string, unknown>) => string[];
  const siteHasTeam = context.siteHasTeam as (site: Record<string, unknown>, teamId: string) => boolean;
  const applySiteTeams = context.applySiteTeams as (site: Record<string, unknown>, teamIds: string[]) => Record<string, unknown>;
  const legacySite: Record<string, unknown> = { worker: 'team-1' };

  assert.deepEqual(Array.from(siteTeamIds(legacySite)), ['team-1']);
  applySiteTeams(legacySite, ['team-1', 'team-2', 'team-2']);
  assert.deepEqual(Array.from(legacySite.teamIds as string[]), ['team-1', 'team-2']);
  assert.equal(legacySite.worker, 'team-1');
  assert.equal(siteHasTeam(legacySite, 'team-2'), true);
});

test('l’editor del cantiere mostra una selezione multipla chiara', () => {
  assert.match(indexHtml, /name="teamIds"/);
  assert.match(indexHtml, /Puoi selezionare più squadre per lo stesso cantiere/);
  assert.match(lifecycleUi, /formTeamIds\(formData\)/);
  assert.match(lifecycleUi, /assignedTeamIds: selectedTeamIds/);
});

test('ogni squadra assegnata riceve il cantiere dal cloud', () => {
  assert.match(cloudUi, /where\('assignedTeamIds', 'array-contains', profile\.teamId\)/);
  assert.match(cloudUi, /teamIdsFor\(item\)\.includes\(profile\.teamId\)/);
  assert.match(firestoreRules, /me\(\)\.teamId in d\.assignedTeamIds/);
  assert.match(firestoreRules, /validClientIds\(d\.assignedTeamIds\)/);
});
