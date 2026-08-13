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
  const versionData = JSON.parse(await readFile(path.join(outputDir, "version.json"), "utf8"));
  const version = versionData.version;
  assert.match(version, /^[a-f0-9]{12}$/);
  assert.equal(versionData.appCheckConfigured, false);
  assert.equal(versionData.appCheckMode, "observe");
  assert.ok(html.includes(`edilkappa-loader.js?v=${version}`));
  assert.ok(html.includes(`sw.js?v=${version}`));
  assert.ok(html.includes(`media-contract.js?v=${version}`));
  assert.ok(html.includes(`firebase-cloud.js?v=${version}`));
  assert.ok(html.includes(`app-config.js?v=${version}`));
  assert.equal(await exists(path.join(outputDir, "media-contract.js")), true);
  assert.equal(await exists(path.join(outputDir, "app-config.js")), true);
  assert.equal(await exists(path.join(outputDir, "functions")), false);
  assert.equal(await exists(path.join(outputDir, "mcp-server")), false);
  assert.equal(await exists(path.join(outputDir, "firebase.json")), false);
  assert.equal(await exists(path.join(outputDir, "firestore.rules")), false);
  assert.equal(await exists(path.join(outputDir, "assets", "icona-edilkappa.svg")), true);
  assert.equal(await exists(path.join(outputDir, "linea-vita", "vendor", "jspdf.umd.min.js")), true);
  assert.equal(await exists(path.join(outputDir, "stability-pack.js")), true);
});

test("firebase.json distribuisce la cartella generata con cache PWA aggiornata", async () => {
  const config = JSON.parse(await readFile(path.join(repoRoot, "firebase.json"), "utf8"));
  assert.equal(config.hosting.site, "edilkappa-professionale");
  assert.equal(config.hosting.public, "hosting-dist");
  assert.deepEqual(config.hosting.predeploy, ["node scripts/build-hosting.mjs"]);
  assert.ok(config.hosting.headers.some((rule) => rule.source === "/sw.js"));
});

test("la build inserisce App Check senza lasciare segreti o segnaposto", async () => {
  const siteKey = "quality_test_recaptcha_enterprise_key_123456";
  execFileSync(process.execPath, [path.join(repoRoot, "scripts", "build-hosting.mjs")], {
    cwd: repoRoot,
    env: { ...process.env, EDILKAPPA_APP_CHECK_SITE_KEY: siteKey, EDILKAPPA_APP_CHECK_MODE: "enforce" },
    stdio: "pipe"
  });
  const runtime = await readFile(path.join(outputDir, "app-config.js"), "utf8");
  const version = JSON.parse(await readFile(path.join(outputDir, "version.json"), "utf8"));
  assert.match(runtime, new RegExp(siteKey));
  assert.match(runtime, /appCheckMode: 'enforce'/);
  assert.doesNotMatch(runtime, /__EDILKAPPA_APP_CHECK_/);
  assert.equal(version.appCheckConfigured, true);
  assert.equal(version.appCheckMode, "enforce");
});
