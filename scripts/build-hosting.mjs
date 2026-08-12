import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

async function buildFingerprint(rootFiles) {
  const hash = createHash("sha256");
  for (const file of rootFiles) {
    hash.update(file);
    hash.update(await readFile(path.join(repoRoot, file)));
  }
  return hash.digest("hex").slice(0, 12);
}

function versionLocalAssets(content, fingerprint) {
  return content.replace(/(["'`])((?:\.\/)?[a-zA-Z0-9][a-zA-Z0-9_./-]*\.(?:js|css))(?:\?v=[^"'`\s]*)?\1/g, (match, quote, assetPath) => {
    if (/^(?:https?:)?\/\//i.test(assetPath)) return match;
    return `${quote}${assetPath}?v=${fingerprint}${quote}`;
  });
}

async function applyBuildVersion(fingerprint) {
  for (const file of ["index.html", "edilkappa-loader.js", "sw.js"]) {
    const target = path.join(outputDir, file);
    let content = await readFile(target, "utf8");
    content = versionLocalAssets(content, fingerprint);
    if (file === "sw.js") {
      content = content.replace(/const CACHE = `\$\{CACHE_PREFIX\}[^`]+`;/, `const CACHE = \`\${CACHE_PREFIX}${fingerprint}\`;`);
    }
    await writeFile(target, content);
  }
  await writeFile(path.join(outputDir, "version.json"), `${JSON.stringify({ version: fingerprint, builtAt: new Date().toISOString() }, null, 2)}\n`);
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
  const fingerprint = await buildFingerprint(rootFiles);
  await applyBuildVersion(fingerprint);

  console.log(`Firebase Hosting pronto: ${rootFiles.length} file principali, ${runtimeDirectories.length} cartelle, versione ${fingerprint}.`);
}

await buildHostingPackage();
