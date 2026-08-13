import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const projectId = "demo-edilkappa-quality";
let env;

function profile({ role, active = true, teamId = "", clientIds = [] }) {
  return {
    orgId: "edilkappa",
    displayName: `Utente ${role}`,
    email: `${role}@example.com`,
    role,
    active,
    teamId,
    clientIds,
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    updatedAt: Timestamp.fromMillis(1_700_000_000_000)
  };
}

function envelope(id, overrides = {}) {
  return {
    id,
    orgId: "edilkappa",
    clientId: "client-1",
    assignedTeamId: "team-1",
    assignedTeamIds: ["team-1"],
    workerUid: "",
    ownerUid: "owner-1",
    status: "Pianificato",
    workHours: 0,
    materialAmount: 0,
    progress: 0,
    contractValue: 0,
    recordedCost: 0,
    payload: JSON.stringify({ id, title: "Lavoro di prova", status: "Pianificato" }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: await readFile(path.join(repoRoot, "firestore.rules"), "utf8")
    }
  });
});

test.after(async () => env?.cleanup());
test.beforeEach(async () => env.clearFirestore());

async function seedProfiles() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users/owner-1"), profile({ role: "owner" })),
      setDoc(doc(db, "users/office-1"), profile({ role: "office" })),
      setDoc(doc(db, "users/worker-1"), profile({ role: "worker", teamId: "team-1" })),
      setDoc(doc(db, "users/admin-1"), profile({ role: "administrator", clientIds: ["client-1"] }))
    ]);
  });
}

function authenticated(uid, email) {
  return env.authenticatedContext(uid, { email, email_verified: true }).firestore();
}

test("nega ogni lettura anonima e la scrittura diretta del modulo pubblico", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "clients/client-1")));
  await assertFails(setDoc(doc(db, "leads/lead-browser-direct"), envelope("lead-browser-direct", {
    clientId: "",
    assignedTeamId: "",
    assignedTeamIds: [],
    ownerUid: "public",
    status: "Nuova"
  })));
});

test("titolare e ufficio gestiscono i dati mentre l'operaio vede solo la squadra assegnata", async () => {
  await seedProfiles();
  const ownerDb = authenticated("owner-1", "owner@example.com");
  const workerDb = authenticated("worker-1", "worker@example.com");
  const ownerSite = doc(ownerDb, "sites/site-1");
  await assertSucceeds(setDoc(ownerSite, envelope("site-1")));
  await assertSucceeds(getDoc(doc(workerDb, "sites/site-1")));
  const forbiddenSite = doc(ownerDb, "sites/site-2");
  await assertSucceeds(setDoc(forbiddenSite, envelope("site-2", { assignedTeamId: "team-2", assignedTeamIds: ["team-2"] })));
  await assertFails(getDoc(doc(workerDb, "sites/site-2")));
});

test("l'operaio aggiorna avanzamento ma non può cambiare proprietà o valore del cantiere", async () => {
  await seedProfiles();
  const ownerDb = authenticated("owner-1", "owner@example.com");
  const workerDb = authenticated("worker-1", "worker@example.com");
  await setDoc(doc(ownerDb, "sites/site-1"), envelope("site-1"));
  await assertSucceeds(updateDoc(doc(workerDb, "sites/site-1"), {
    progress: 30,
    status: "In corso",
    payload: JSON.stringify({ id: "site-1", title: "Lavoro di prova", status: "In corso", progress: 30 }),
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(workerDb, "sites/site-1"), {
    contractValue: 999999,
    updatedAt: serverTimestamp()
  }));
});

test("l'amministratore legge solo i condomini assegnati", async () => {
  await seedProfiles();
  const ownerDb = authenticated("owner-1", "owner@example.com");
  const adminDb = authenticated("admin-1", "administrator@example.com");
  await setDoc(doc(ownerDb, "clients/client-1"), envelope("client-1", { assignedTeamId: "", assignedTeamIds: [], clientId: "client-1", status: "Attivo" }));
  await setDoc(doc(ownerDb, "clients/client-2"), envelope("client-2", { assignedTeamId: "", assignedTeamIds: [], clientId: "client-2", status: "Attivo" }));
  await assertSucceeds(getDoc(doc(adminDb, "clients/client-1")));
  await assertFails(getDoc(doc(adminDb, "clients/client-2")));
  const own = await getDoc(doc(adminDb, "clients/client-1"));
  assert.equal(own.exists(), true);
});
