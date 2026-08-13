(function () {
  'use strict';

  const ERROR_KEY = 'edilkappa_client_errors_v1';
  const REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const state = {
    cls: 0,
    fcpMs: 0,
    lcpMs: 0,
    loadMs: 0,
    reportedAt: '',
    reportError: ''
  };

  function storedErrors() {
    try {
      const rows = JSON.parse(localStorage.getItem(ERROR_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (_) { return []; }
  }

  function rememberError(event) {
    const message = String(event?.message || event?.reason?.message || event?.reason || 'Errore JavaScript');
    const source = String(event?.filename || event?.source || location.pathname);
    if (/chrome-extension:|moz-extension:|ResizeObserver loop/i.test(`${source} ${message}`)) return;
    const entry = {
      message: message.slice(0, 1000),
      source: source.slice(0, 500),
      stack: String(event?.error?.stack || event?.reason?.stack || '').slice(0, 4000),
      createdAt: new Date().toISOString()
    };
    const rows = storedErrors();
    if (rows[0]?.message === entry.message && Date.now() - Date.parse(rows[0].createdAt || 0) < 60000) return;
    localStorage.setItem(ERROR_KEY, JSON.stringify([entry, ...rows].slice(0, 30)));
    window.EdilKappaCloud?.reportClientError?.(entry).catch(() => {});
  }

  function observePerformance() {
    if (!('PerformanceObserver' in window)) return;
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) state.lcpMs = Math.round(entries.at(-1).startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_) {}
    try {
      new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => { if (!entry.hadRecentInput) state.cls += Number(entry.value || 0); });
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (_) {}
    try {
      new PerformanceObserver((list) => {
        const entry = list.getEntries().find((item) => item.name === 'first-contentful-paint');
        if (entry) state.fcpMs = Math.round(entry.startTime);
      }).observe({ type: 'paint', buffered: true });
    } catch (_) {}
  }

  function navigationSnapshot() {
    const navigation = performance.getEntriesByType?.('navigation')?.[0];
    const loader = window.EdilKappaPerformance?.snapshot?.() || {};
    const loadMs = Math.round(navigation?.loadEventEnd || performance.now());
    state.loadMs = Math.max(0, loadMs);
    return {
      sessionId: sessionStorage.getItem('edilkappa_quality_session') || '',
      path: location.pathname,
      device: matchMedia('(max-width: 720px)').matches ? 'mobile' : 'desktop',
      navigationType: String(navigation?.type || 'navigate'),
      loadMs: state.loadMs,
      lcpMs: Math.max(0, Math.round(state.lcpMs || state.fcpMs || 0)),
      cls: Math.max(0, Math.round(state.cls * 1000) / 1000),
      criticalReadyMs: Math.max(0, Number(loader.criticalReadyMs || 0)),
      online: navigator.onLine
    };
  }

  function ensureSessionId() {
    if (sessionStorage.getItem('edilkappa_quality_session')) return;
    const value = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('edilkappa_quality_session', value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48));
  }

  async function waitForCloud(maximumMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maximumMs) {
      if (window.EdilKappaCloud?.ready && window.EdilKappaCloud?.reportPerformanceMetric) return true;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return false;
  }

  async function reportPerformance(force = false) {
    const metric = navigationSnapshot();
    const lastKey = `edilkappa_quality_metric_${metric.device}`;
    const lastAt = Number(localStorage.getItem(lastKey) || 0);
    if (!force && Date.now() - lastAt < REPORT_INTERVAL_MS) return false;
    if (!navigator.onLine || !await waitForCloud()) return false;
    try {
      const sent = await window.EdilKappaCloud.reportPerformanceMetric(metric);
      if (!sent) return false;
      localStorage.setItem(lastKey, String(Date.now()));
      state.reportedAt = new Date().toISOString();
      state.reportError = '';
      return true;
    } catch (error) {
      state.reportError = String(error?.message || 'Misurazione non inviata').slice(0, 300);
      return false;
    }
  }

  ensureSessionId();
  observePerformance();
  window.addEventListener('error', rememberError);
  window.addEventListener('unhandledrejection', rememberError);
  window.addEventListener('online', () => reportPerformance().catch(() => {}));
  const schedulePerformanceReport = () => {
    const run = () => reportPerformance().catch(() => {});
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 5000 });
    else setTimeout(run, 2500);
  };
  if (document.readyState === 'complete') schedulePerformanceReport();
  else window.addEventListener('load', schedulePerformanceReport, { once: true });

  window.EdilKappaQuality = {
    reportPerformance,
    storedErrors,
    snapshot: () => ({ ...state, ...navigationSnapshot() })
  };
})();
