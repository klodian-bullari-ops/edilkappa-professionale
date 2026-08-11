import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(repoRoot, "hosting-dist");
const runtimeDirectories = ["assets", "icons", "linea-vita"];
const runtimeRootFile = /\.(?:css|html|js)$/i;
const runtimeRootNames = new Set(["manifest.json"]);

function isSafeOutputPath(target) {
  return target === path.join(repoRoot, "hosting-dist") && target.startsWith(`${repoRoot}${path.sep}`);
}

async function copyRuntimeDirectory(directory) {
  const source = path.join(repoRoot, directory);
  const destination = path.join(outputDir, directory);
  await cp(source, destination, {
    recursive: true,
    filter: (entry) => !/\.(?:md|txt)$/i.test(entry)
  });
}

async function buildHostingPackage() {
  if (!isSafeOutputPath(outputDir)) throw new Error("Cartella Hosting non valida.");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const entries = await readdir(repoRoot, { withFileTypes: true });
  const rootFiles = entries
    .filter((entry) => entry.isFile() && (runtimeRootFile.test(entry.name) || runtimeRootNames.has(entry.name)))
    .map((entry) => entry.name)
    .sort();

  await Promise.all(rootFiles.map((file) => cp(path.join(repoRoot, file), path.join(outputDir, file))));
  await Promise.all(runtimeDirectories.map(copyRuntimeDirectory));

  console.log(`Firebase Hosting pronto: ${rootFiles.length} file principali e ${runtimeDirectories.length} cartelle.`);
}

await buildHostingPackage();
