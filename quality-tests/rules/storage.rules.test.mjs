import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, uploadBytes } from "firebase/storage";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-edilkappa-quality",
    storage: {
      host: "127.0.0.1",
      port: 9199,
      rules: await readFile(path.join(repoRoot, "storage.rules"), "utf8")
    }
  });
});

test.after(async () => env?.cleanup());
test.beforeEach(async () => env.clearStorage());

function storageFor(uid, emailVerified = true) {
  return env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: emailVerified }).storage("gs://demo-edilkappa-quality.appspot.com");
}

test("accetta un PDF del proprietario nella cartella corretta", async () => {
  const storage = storageFor("owner-1");
  const target = ref(storage, "organisations/edilkappa/documents/owner-1/doc-1/preventivo.pdf");
  await assertSucceeds(uploadBytes(target, new Uint8Array([37, 80, 68, 70]), {
    contentType: "application/pdf",
    customMetadata: { orgId: "edilkappa", ownerUid: "owner-1" }
  }));
});

test("nega upload anonimo, non verificato o nella cartella di un altro utente", async () => {
  const anonymous = env.unauthenticatedContext().storage("gs://demo-edilkappa-quality.appspot.com");
  const unverified = storageFor("worker-1", false);
  const worker = storageFor("worker-1");
  const metadata = { contentType: "application/pdf", customMetadata: { orgId: "edilkappa", ownerUid: "owner-1" } };
  await assertFails(uploadBytes(ref(anonymous, "organisations/edilkappa/documents/public/doc/file.pdf"), new Uint8Array([1]), metadata));
  await assertFails(uploadBytes(ref(unverified, "organisations/edilkappa/documents/worker-1/doc/file.pdf"), new Uint8Array([1]), { ...metadata, customMetadata: { orgId: "edilkappa", ownerUid: "worker-1" } }));
  await assertFails(uploadBytes(ref(worker, "organisations/edilkappa/documents/owner-1/doc/file.pdf"), new Uint8Array([1]), metadata));
});

test("nega tipi di file non supportati", async () => {
  const storage = storageFor("owner-1");
  const target = ref(storage, "organisations/edilkappa/documents/owner-1/doc-1/script.exe");
  await assertFails(uploadBytes(target, new Uint8Array([1, 2, 3]), {
    contentType: "application/octet-stream",
    customMetadata: { orgId: "edilkappa", ownerUid: "owner-1" }
  }));
});
