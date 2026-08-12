"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(file) {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8");
}

test("cloud sync never deletes records merely because they are missing locally", () => {
  const cloud = source("firebase-cloud.js");
  const push = cloud.slice(cloud.indexOf("async function pushCollection"), cloud.indexOf("async function uploadPendingReportPhotos"));
  assert.doesNotMatch(push, /deleteDoc/);
  assert.match(push, /database\.trash/);
  assert.match(cloud, /softDeleteRecord/);
  assert.match(cloud, /restoreDeletedRecord/);
  assert.match(cloud, /permanentlyDeleteRecord/);
});

test("sync status keeps individual collection errors visible", () => {
  const cloud = source("firebase-cloud.js");
  assert.match(cloud, /const collectionSyncState = new Map/);
  assert.match(cloud, /function recomputeSyncState/);
  assert.match(cloud, /setCollectionSyncState\(sourceKey, 'error'/);
  assert.match(cloud, /Archivi non sincronizzati/);
  assert.match(cloud, /setCollectionSyncState\(sourceKey, 'pending'/);
  assert.match(cloud, /listClientErrors/);
});

test("bootstrap owner authentication does not depend on a Firestore profile read", () => {
  const backend = source("functions/index.js");
  const authentication = backend.slice(backend.indexOf("async function authorizedUser"), backend.indexOf("function conversationId"));
  assert.match(authentication, /if \(!bootstrapOwner\) \{/);
  assert.match(authentication, /firestore\.collection\("users"\)/);
});

test("stability interface provides filters pagination trash and backups", () => {
  const stability = source("stability-pack.js");
  const loader = source("edilkappa-loader.js");
  assert.match(loader, /stability-pack\.js\?v=1/);
  assert.match(stability, /const PAGE_SIZE = 20/);
  assert.match(stability, /setStableList/);
  assert.match(stability, /archiveSelectedQuotes/);
  assert.match(stability, /window\.trashView/);
  assert.match(stability, /window\.backupView/);
  assert.match(stability, /unhandledrejection/);
  assert.match(stability, /Errori di produzione/);
});

test("nightly backup and temporary EdilKappa shares replace the legacy transfer service", () => {
  const backend = source("functions/index.js");
  const cloud = source("firebase-cloud.js");
  const sharing = `${source("sharing-integration.js")}\n${source("bulk-sharing.js")}`;
  const storage = source("storage.rules");
  assert.match(backend, /exports\.edilkappaBackup/);
  assert.match(backend, /exports\.edilkappaBackup = onCall\(\{[^}]*invoker: "public"/);
  assert.match(backend, /exports\.backupEdilkappaNightly/);
  assert.match(backend, /schedule: "15 2 \* \* \*"/);
  assert.match(backend, /purgeOldClientErrors/);
  assert.match(cloud, /uploadSharePackage/);
  assert.match(storage, /organisations\/edilkappa\/shares/);
  assert.doesNotMatch(sharing.toLowerCase(), new RegExp(["transfer", "now"].join("")));
});

test("absence deletions use recoverable cloud tombstones", () => {
  const attendance = source("attendance-center.js");
  const cloud = source("firebase-cloud.js");
  assert.match(attendance, /softDeleteRecord\?\.\('absences'/);
  assert.match(attendance, /database\(\)\.trash/);
  assert.match(cloud, /listenTo\('absences'.*workerUid/);
  assert.match(cloud, /remoteName === 'absences'/);
});

test("build and deployment are versioned and guarded", () => {
  const build = source("scripts/build-hosting.mjs");
  const deploy = source(".github/workflows/deploy-production.yml");
  const quality = source(".github/workflows/quality.yml");
  assert.match(build, /buildFingerprint/);
  assert.match(build, /version\.json/);
  assert.match(deploy, /inputs\.conferma == 'PUBBLICA'/);
  assert.match(deploy, /firestore:rules,storage,functions:edilkappaBackup/);
  assert.match(deploy, /functions:edilkappaDaneaBridge/);
  assert.match(quality, /pull_request/);
});

test("dashboard has one priority area and one scheduled-work area", () => {
  const html = source("index.html");
  const extensions = source("professional-extensions.js");
  assert.match(html, /Priorità di oggi/);
  assert.match(html, /Programma di oggi/);
  assert.doesNotMatch(extensions, /Cosa devo fare oggi|Cantiere da controllare/);
});
