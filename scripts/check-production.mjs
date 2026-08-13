const baseUrl = new URL(process.argv[2] || "https://edilkappa-professionale.web.app/");
const failures = [];

async function read(pathname) {
  const url = new URL(pathname, baseUrl);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "EdilKappa-Quality-Monitor/1.0" }
    });
    const body = await response.text();
    if (!response.ok) failures.push(`${pathname}: HTTP ${response.status}`);
    return { response, body };
  } catch (error) {
    failures.push(`${pathname}: ${error?.message || "richiesta non riuscita"}`);
    return { response: null, body: "" };
  }
}

const [home, requestPage, privacy, manifest, version] = await Promise.all([
  read("/index.html"),
  read("/richiesta.html"),
  read("/privacy.html"),
  read("/manifest.json"),
  read("/version.json")
]);

if (!home.body.includes("EDILKAPPA Professionale")) failures.push("index.html: schermata di accesso non riconosciuta");
if (!requestPage.body.includes("Richiedi un sopralluogo")) failures.push("richiesta.html: modulo pubblico non riconosciuto");
if (!privacy.body.includes("Informativa sulla privacy")) failures.push("privacy.html: informativa non riconosciuta");

const headers = home.response?.headers;
if (headers) {
  if (!/no-cache|no-store/i.test(headers.get("cache-control") || "")) failures.push("index.html: cache-control di sicurezza assente");
  if ((headers.get("x-content-type-options") || "").toLowerCase() !== "nosniff") failures.push("Hosting: X-Content-Type-Options assente");
  if ((headers.get("x-frame-options") || "").toUpperCase() !== "DENY") failures.push("Hosting: X-Frame-Options assente");
  if (!/max-age=/i.test(headers.get("strict-transport-security") || "")) failures.push("Hosting: HSTS assente");
}

try {
  const parsedManifest = JSON.parse(manifest.body);
  if (parsedManifest.display !== "standalone" || !parsedManifest.name) failures.push("manifest.json: configurazione PWA incompleta");
} catch (_) { failures.push("manifest.json: JSON non valido"); }

try {
  const parsedVersion = JSON.parse(version.body);
  if (!/^[a-f0-9]{12}$/.test(String(parsedVersion.version || ""))) failures.push("version.json: impronta versione non valida");
  if (!Number.isFinite(Date.parse(parsedVersion.builtAt || ""))) failures.push("version.json: data build non valida");
} catch (_) { failures.push("version.json: JSON non valido"); }

if (failures.length) {
  console.error(`Monitor produzione non superato (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Produzione EdilKappa raggiungibile e coerente: ${baseUrl.origin}`);
}
