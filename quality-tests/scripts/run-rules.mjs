import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const fakeHome = path.join(os.tmpdir(), "edilkappa-firebase-quality-home");
const configDir = path.join(fakeHome, ".config", "configstore");
const motdPath = path.join(configDir, "firebase-tools.json");
const cacheDir = process.env.FIREBASE_EMULATORS_PATH
  || (process.env.CI ? path.join(os.homedir(), ".cache", "firebase", "emulators") : path.join(fakeHome, ".cache", "firebase", "emulators"));

await mkdir(configDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });
await writeFile(motdPath, JSON.stringify({
  motd: { minVersion: "0.0.0", message: "" },
  "motd.fetched": Date.now()
}));

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
  "--config", path.join(packageRoot, "firebase.json"),
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
