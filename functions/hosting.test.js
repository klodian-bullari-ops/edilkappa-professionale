const assert = require("node:assert/strict");
const { access, readFile } = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "hosting-dist");

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

test("il pacchetto Hosting contiene solo il gestionale pubblico", async () => {
  execFileSync(process.execPath, [path.join(repoRoot, "scripts", "build-hosting.mjs")], {
    cwd: repoRoot,
    stdio: "pipe"
  });

  const html = await readFile(path.join(outputDir, "index.html"), "utf8");
  assert.match(html, /edilkappa-loader\.js\?v=1/);
  assert.match(html, /firebase-cloud\.js\?v=32/);
  assert.equal(await exists(path.join(outputDir, "functions")), false);
  assert.equal(await exists(path.join(outputDir, "mcp-server")), false);
  assert.equal(await exists(path.join(outputDir, "firebase.json")), false);
  assert.equal(await exists(path.join(outputDir, "firestore.rules")), false);
  assert.equal(await exists(path.join(outputDir, "assets", "icona-edilkappa.svg")), true);
  assert.equal(await exists(path.join(outputDir, "linea-vita", "vendor", "jspdf.umd.min.js")), true);
});

test("firebase.json distribuisce la cartella generata con cache PWA aggiornata", async () => {
  const config = JSON.parse(await readFile(path.join(repoRoot, "firebase.json"), "utf8"));
  assert.equal(config.hosting.site, "edilkappa-professionale");
  assert.equal(config.hosting.public, "hosting-dist");
  assert.deepEqual(config.hosting.predeploy, ["node scripts/build-hosting.mjs"]);
  assert.ok(config.hosting.headers.some((rule) => rule.source === "/sw.js"));
});
