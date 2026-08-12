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
  const stability = source("stability-pack.js");
  const sharing = `${source("sharing-integration.js")}\n${source("bulk-sharing.js")}`;
  const storage = source("storage.rules");
  assert.match(backend, /exports\.edilkappaBackup/);
  assert.match(backend, /exports\.edilkappaBackup = onCall\(\{[^}]*invoker: "public"/);
  assert.match(backend, /exports\.backupEdilkappaNightly/);
  assert.match(backend, /schedule: "15 2 \* \* \*"/);
  assert.match(backend, /verifyEdilKappaBackup/);
  assert.match(backend, /gunzipSync/);
  assert.match(backend, /checksum/);
  assert.match(stability, /verifyLatestEdilKappaBackup/);
  assert.match(stability, /Da verificare/);
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
  assert.match(build, /collectRuntimeFiles/);
  assert.match(build, /version\.json/);
  assert.match(build, /rootFiles\.filter/);
  assert.match(deploy, /inputs\.conferma == 'PUBBLICA'/);
  assert.match(deploy, /google-github-actions\/setup-gcloud@v2/);
  assert.match(deploy, /firestore:rules,storage,functions:backupEdilkappaNightly/);
  assert.match(deploy, /for function_name in edilkappaBackup edilkappaDaneaBridge edilkappaNotifications/);
  assert.match(deploy, /--only "functions:\$\{function_name\}"/);
  assert.match(deploy, /functions:processDaneaInbox/);
  assert.match(deploy, /Unable to set the invoker\|Failed to set the IAM Policy/);
  assert.match(deploy, /deploy_status/);
  assert.match(deploy, /--no-invoker-iam-check/);
  assert.match(quality, /pull_request/);
  assert.match(quality, /npm audit --omit=dev --audit-level=moderate/);
  assert.match(quality, /npm run build/);
});

test("hosting disables stale root caching and adds safe browser headers", () => {
  const config = JSON.parse(source("firebase.json"));
  const headers = config.hosting.headers;
  assert.ok(headers.some((entry) => entry.source === "/" && entry.headers.some((header) => /no-cache/.test(header.value))));
  const global = headers.find((entry) => entry.source === "**");
  assert.ok(global.headers.some((header) => header.key === "X-Content-Type-Options" && header.value === "nosniff"));
  assert.ok(global.headers.some((header) => header.key === "X-Frame-Options" && header.value === "DENY"));
});

test("notifications have a protected status and delivery test", () => {
  const backend = source("functions/index.js");
  const cloud = source("firebase-cloud.js");
  const control = source("system-control.js");
  assert.match(backend, /exports\.edilkappaNotifications = onCall/);
  assert.match(backend, /Notifica di prova EdilKappa/);
  assert.match(backend, /currentDeviceRegistered/);
  assert.match(backend, /deviceId: requestedDeviceId/);
  assert.match(cloud, /notificationRequest/);
  assert.match(cloud, /requestPayload\.deviceId = await tokenDocumentId/);
  assert.match(control, /Invia notifica di prova/);
});

test("dashboard has one priority area and one scheduled-work area", () => {
  const html = source("index.html");
  const extensions = source("professional-extensions.js");
  assert.match(html, /Priorità di oggi/);
  assert.match(html, /Programma di oggi/);
  assert.doesNotMatch(extensions, /Cosa devo fare oggi|Cantiere da controllare/);
});
