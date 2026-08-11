(function () {
  "use strict";

  const SCRIPT_GROUPS = Object.freeze({
    critical: [
      "./professional-extensions.js?v=19",
      "./business-suite.js?v=19",
      "./client-archive.js?v=20",
      "./direct-search.js?v=6",
      "./danea-integration.js?v=25",
      "./intervention-lifecycle.js?v=3",
      "./completion-center.js?v=3",
      "./bulk-sharing.js?v=5.2",
      "./hours-closeout.js?v=3",
      "./attendance-center.js?v=1"
    ],
    tools: [
      "./smart-operations.js?v=15",
      "./edilconnect.js?v=2",
      "./controlled-learning.js?v=2",
      "./operations-center.js?v=2"
    ],
    ai: [
      "./edilkappa-ai.js?v=22",
      "./edilkappa-ai-route.js?v=1"
    ],
    pdf: [
      "./linea-vita/vendor/jspdf.umd.min.js",
      "./linea-vita/vendor/jspdf.plugin.autotable.min.js"
    ]
  });

  const TOOL_VIEWS = new Set([
    "more",
    "quotes",
    "leadsView",
    "priceListView",
    "certificatesView",
    "warehouseView",
    "edilconnectView",
    "learningCenter",
    "operationsCenter",
    "portalPreview"
  ]);
  const scriptPromises = new Map();
  const groupPromises = new Map();
  const completedGroups = new Set();
  const timings = { startedAt: performance.now() };
  let batchDepth = 0;
  let immediateRenderPermits = 0;
  let pendingRender = false;
  let leafletPromise = null;

  function absoluteUrl(source) {
    return new URL(source, document.baseURI).href;
  }

  function preloadScripts(sources) {
    sources.forEach((source) => {
      const url = absoluteUrl(source);
      const alreadyPreloaded = Array.from(document.querySelectorAll("link[data-edilkappa-preload]"))
        .some((link) => link.href === url);
      if (new URL(url).origin === location.origin && !alreadyPreloaded) {
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "script";
        link.href = source;
        link.dataset.edilkappaPreload = url;
        document.head.appendChild(link);
      }
    });
  }

  function loadScript(source, options = {}) {
    const url = absoluteUrl(source);
    if (scriptPromises.has(url)) return scriptPromises.get(url);
    const promise = new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts).find((script) => script.src === url);
      if (existing?.dataset.edilkappaLoaded === "true") return resolve();
      const script = existing || document.createElement("script");
      script.src = source;
      script.async = false;
      if (options.module) script.type = "module";
      script.addEventListener("load", () => {
        script.dataset.edilkappaLoaded = "true";
        resolve();
      }, { once: true });
      script.addEventListener("error", () => reject(new Error(`Non riesco a caricare ${source}.`)), { once: true });
      if (!existing) document.head.appendChild(script);
    }).catch((error) => {
      scriptPromises.delete(url);
      throw error;
    });
    scriptPromises.set(url, promise);
    return promise;
  }

  function flushDeferredRender() {
    if (batchDepth || !pendingRender) return;
    pendingRender = false;
    requestAnimationFrame(() => {
      if (typeof window.EdilKappaLocal?.renderFromCloud === "function") window.EdilKappaLocal.renderFromCloud();
      else if (typeof window.render === "function") window.render();
    });
  }

  function loadGroup(name) {
    if (completedGroups.has(name)) return null;
    if (groupPromises.has(name)) return groupPromises.get(name);
    const sources = SCRIPT_GROUPS[name];
    if (!sources) return null;
    preloadScripts(sources);
    const coordinatesRender = name !== "pdf";
    if (coordinatesRender) {
      batchDepth += 1;
      pendingRender = true;
    }
    const promise = (async () => {
      for (const source of sources) await loadScript(source);
      completedGroups.add(name);
      timings[`${name}ReadyAt`] = performance.now();
    })().finally(() => {
      if (coordinatesRender) batchDepth = Math.max(0, batchDepth - 1);
      groupPromises.delete(name);
      if (coordinatesRender) flushDeferredRender();
    });
    groupPromises.set(name, promise);
    return promise;
  }

  function ensureView(viewName) {
    if (viewName === "ai") return loadGroup("ai");
    if (TOOL_VIEWS.has(viewName)) return loadGroup("tools");
    return null;
  }

  function ensurePdf() {
    if (window.jspdf?.jsPDF && typeof window.jspdf.jsPDF.API?.autoTable === "function") return Promise.resolve();
    return loadGroup("pdf") || Promise.resolve();
  }

  function ensureMap() {
    if (window.L?.map) return Promise.resolve();
    if (leafletPromise) return leafletPromise;
    leafletPromise = (async () => {
      if (!document.querySelector("link[data-edilkappa-leaflet]")) {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        stylesheet.dataset.edilkappaLeaflet = "true";
        document.head.appendChild(stylesheet);
      }
      await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
      timings.mapReadyAt = performance.now();
    })().catch((error) => {
      leafletPromise = null;
      throw error;
    });
    return leafletPromise;
  }

  function deferRender() {
    if (!batchDepth) return false;
    if (immediateRenderPermits > 0) {
      immediateRenderPermits -= 1;
      return false;
    }
    pendingRender = true;
    return true;
  }

  function allowNextRender() {
    if (batchDepth) immediateRenderPermits += 1;
  }

  function showError(error, viewName = "") {
    console.error("Caricamento EdilKappa:", error);
    const current = window.EdilKappaLocal?.getView?.();
    if (viewName && current !== viewName) return;
    const app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = `<div class="empty"><b>Questo strumento non si è caricato.</b><br>Controlla la connessione e premi Riprova.<div style="height:12px"></div><button class="btn lime" onclick="location.reload()">Riprova</button></div>`;
  }

  function snapshot() {
    const now = performance.now();
    const elapsed = (value) => value ? Math.round(value - timings.startedAt) : null;
    return {
      criticalReadyMs: elapsed(timings.criticalReadyAt),
      toolsReadyMs: elapsed(timings.toolsReadyAt),
      aiReadyMs: elapsed(timings.aiReadyAt),
      pdfReadyMs: elapsed(timings.pdfReadyAt),
      mapReadyMs: elapsed(timings.mapReadyAt),
      loadedGroups: Array.from(completedGroups),
      runningForMs: Math.round(now - timings.startedAt)
    };
  }

  window.EdilKappaLoader = {
    allowNextRender,
    deferRender,
    ensureMap,
    ensurePdf,
    ensureView,
    loadCritical: () => loadGroup("critical") || Promise.resolve(),
    loadTools: () => loadGroup("tools") || Promise.resolve(),
    showError,
    snapshot
  };
  window.EdilKappaPerformance = { snapshot };

  requestAnimationFrame(() => {
    const critical = loadGroup("critical");
    critical?.catch((error) => showError(error));
  });

  const preloadDesktopTools = () => {
    if (!matchMedia("(min-width: 981px)").matches) return;
    const pending = loadGroup("tools");
    pending?.catch((error) => console.warn("Strumenti secondari non precaricati:", error));
  };
  if ("requestIdleCallback" in window) requestIdleCallback(preloadDesktopTools, { timeout: 5000 });
  else setTimeout(preloadDesktopTools, 3500);
})();
