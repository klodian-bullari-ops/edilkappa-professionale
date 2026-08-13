import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repositoryRoot = path.resolve(packageRoot, "..");
const fakeHome = path.join(os.tmpdir(), "edilkappa-firebase-quality-home");
const configDir = path.join(fakeHome, ".config", "configstore");
const motdPath = path.join(configDir, "firebase-tools.json");
const emulatorProject = path.join(fakeHome, "project");
const emulatorConfig = path.join(emulatorProject, "firebase.json");
const cacheDir = process.env.FIREBASE_EMULATORS_PATH
  || (process.env.CI ? path.join(os.homedir(), ".cache", "firebase", "emulators") : path.join(fakeHome, ".cache", "firebase", "emulators"));

await mkdir(configDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });
await rm(emulatorProject, { recursive: true, force: true });
await mkdir(emulatorProject, { recursive: true });
await writeFile(motdPath, JSON.stringify({
  motd: { minVersion: "0.0.0", message: "" },
  "motd.fetched": Date.now()
}));
await Promise.all([
  copyFile(path.join(repositoryRoot, "firestore.rules"), path.join(emulatorProject, "firestore.rules")),
  copyFile(path.join(repositoryRoot, "storage.rules"), path.join(emulatorProject, "storage.rules"))
]);
await writeFile(emulatorConfig, JSON.stringify({
  firestore: { rules: "firestore.rules" },
  storage: { rules: "storage.rules" },
  emulators: {
    firestore: { host: "127.0.0.1", port: 8080 },
    storage: { host: "127.0.0.1", port: 9199 },
    ui: { enabled: false }
  }
}, null, 2));

const firebase = path.join(packageRoot, "node_modules", ".bin", process.platform === "win32" ? "firebase.cmd" : "firebase");
const testCommand = [
  process.execPath,
  "--test",
  path.join(packageRoot, "rules", "firestore.rules.test.mjs"),
  path.join(packageRoot, "rules", "storage.rules.test.mjs")
].map((value) => JSON.stringify(value)).join(" ");
const jars = ["cloud-firestore-emulator-v1.22.0.jar", "cloud-storage-rules-runtime-v1.1.3.jar"];
if (jars.some((jar) => !existsSync(path.join(cacheDir, jar)))) {
  console.log("Scarico una sola volta gli emulatori Firebase nella cache locale dei test…");
}

const child = spawn(firebase, [
  "emulators:exec",
  "--config", emulatorConfig,
  "--project", "demo-edilkappa-quality",
  "--only", "firestore,storage",
  testCommand
], {
  cwd: packageRoot,
  env: { ...process.env, HOME: fakeHome, FIREBASE_EMULATORS_PATH: cacheDir, CI: process.env.CI || "1" },
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
