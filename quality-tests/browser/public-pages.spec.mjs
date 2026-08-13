import { expect, test } from "@playwright/test";

test("la schermata di accesso è leggibile e non espone dati aziendali", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page).toHaveTitle(/EDILKAPPA/);
  await expect(page.getByRole("heading", { name: "EDILKAPPA Professionale" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accedi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continua con Google" })).toBeVisible();
  await expect(page.getByLabel("Email di lavoro")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.locator("#app")).not.toContainText("Condominio");
  const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(width).toBeLessThanOrEqual(1);
});

test("il modulo sopralluogo è completo, accessibile e adatto al telefono", async ({ page }) => {
  await page.goto("/richiesta.html");
  await expect(page.getByRole("heading", { name: "Richiedi un sopralluogo" })).toBeVisible();
  await expect(page.getByLabel("Nome e cognome / condominio")).toBeVisible();
  await expect(page.getByLabel("Telefono")).toBeVisible();
  await expect(page.getByLabel("Indirizzo del lavoro")).toBeVisible();
  await expect(page.getByLabel("Descrivi il lavoro o il problema")).toBeVisible();
  await expect(page.getByRole("button", { name: "Invia richiesta a EDILKAPPA" })).toBeVisible();
  await expect(page.getByRole("link", { name: "informativa sulla privacy" })).toHaveAttribute("href", "./privacy.html");
  const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(width).toBeLessThanOrEqual(1);
});

test("privacy, manifest e service worker sono pubblicati correttamente", async ({ page, request }) => {
  await page.goto("/privacy.html");
  await expect(page.getByRole("heading", { name: "Informativa sulla privacy" })).toBeVisible();
  const manifest = await request.get("/manifest.json");
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe("standalone");
  const serviceWorker = await request.get("/sw.js");
  expect(serviceWorker.ok()).toBeTruthy();
  expect(await serviceWorker.text()).toContain("CACHE_PREFIX");
});
