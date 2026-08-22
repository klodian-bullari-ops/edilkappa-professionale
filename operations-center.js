(function () {
  "use strict";

  const state = { loading: false, refreshing: false, latestAttempted: false, error: "", remote: null };
  const css = document.createElement("style");
  css.textContent = `
    .opsHero{background:linear-gradient(135deg,#102c22,#21503c);color:#fff;border-radius:20px;padding:22px;display:flex;justify-content:space-between;gap:18px;align-items:center}.opsHero h2{margin:0 0 6px}.opsHero p{margin:0;color:#d9eade;max-width:760px}.opsHero .actions{margin:0;flex:0 0 auto}.opsAgents{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:11px}.opsAgent{border:1px solid #dce6df;border-radius:14px;padding:13px;background:#fff}.opsAgent b{display:block;color:#173d2e;margin-bottom:5px}.opsAgent small{color:#63766d}.opsPriority{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:11px;align-items:center;padding:11px 0;border-bottom:1px solid #e1e8e3}.opsPriority:last-child{border-bottom:0}.opsSeverity{width:10px;height:10px;border-radius:50%;background:#e2ad24}.opsSeverity.high{background:#cf3c34}.opsSeverity.low{background:#5f9b73}.opsPriority b,.opsPriority small{display:block}.opsPriority small{color:#66786f;margin-top:3px}.opsBrief{border-left:5px solid #f4c400;background:#fffbea;border-radius:12px;padding:14px}.opsDraft{border:1px dashed #d1b43e;background:#fffdf2;border-radius:11px;padding:11px;margin-top:9px}.opsError{background:#fff0ef;border:1px solid #efc4c0;color:#8e2d27;border-radius:11px;padding:11px}.opsProfit{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,auto);gap:8px 16px;padding:9px 0;border-bottom:1px solid #e3e9e5}.opsProfit span:not(:first-child){text-align:right;white-space:nowrap}@media(max-width:700px){.opsHero{align-items:flex-start;flex-direction:column}.opsPriority{grid-template-columns:auto minmax(0,1fr)}.opsPriority button{grid-column:2}.opsProfit{grid-template-columns:1fr auto}.opsProfit span:nth-child(3),.opsProfit span:nth-child(4){display:none}}
  `;
  document.head.appendChild(css);

  function e(value) { return typeof esc === "function" ? esc(value) : String(value ?? ""); }
  function money(value) { return Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" }); }
  function dateOnly(value) { return String(value || "").slice(0, 10); }
  function days(from, to) { const a = Date.parse(`${dateOnly(from)}T12:00:00`), b = Date.parse(`${dateOnly(to)}T12:00:00`); return Number.isFinite(a) && Number.isFinite(b) ? Math.floor((b - a) / 86400000) : 0; }
  function complete(value) { return /complet|conclus|chius|eseguit/i.test(String(value || "")); }
  function localSnapshot() {
    const today = typeof localToday === "function" ? localToday() : new Date().toISOString().slice(0, 10);
    const priorities = [];
    const add = (severity, category, title, detail, targetView, targetId) => priorities.push({ id: `${category}-${targetId || priorities.length}`, severity, category, title, detail, view: targetView, targetId: targetId || "" });
    const leads = db.leads || [], sites = db.sites || [], inspections = db.inspections || [], quotes = db.quotes || [], reports = db.reports || [], timesheets = db.timesheets || [], absences = db.absences || [], payments = db.payments || [], deadlines = db.deadlines || [];
    const newRequests = leads.filter((item) => /nuov/i.test(String(item.status || "Nuova")));
    newRequests.slice(0, 10).forEach((item) => add(!item.clientId ? "high" : "medium", "requests", /danea/i.test(`${item.source || ""}`) ? "Richiesta Danea da collegare" : "Nuova richiesta", `${item.name || item.client || "Cliente"} · ${item.request || item.subject || item.notes || "Controllare i dati"}`, /danea/i.test(`${item.source || ""}`) ? "daneaRequests" : "leadsView", item.id));
    const active = sites.filter((item) => !complete(item.status));
    active.forEach((site) => {
      const rows = reports.filter((item) => String(item.siteId || item.site) === String(site.id)).sort((a, b) => String(b.workDate || b.date || b.createdAt || "").localeCompare(String(a.workDate || a.date || a.createdAt || "")));
      const lastDate = dateOnly(rows[0]?.workDate || rows[0]?.date || rows[0]?.createdAt || site.start);
      const photos = rows.reduce((sum, item) => sum + Math.max(Number(item.photoCount || 0), Array.isArray(item.photos) ? item.photos.length : 0), 0);
      if (!lastDate || days(lastDate, today) >= 3) add(!lastDate || days(lastDate, today) >= 7 ? "high" : "medium", "sites", "Cantiere senza aggiornamenti", `${site.title || "Cantiere"} · ${site.client || ""}`, "sites", site.id);
      if (!photos) add("medium", "photos", "Mancano fotografie", `${site.title || "Cantiere"} · nessuna foto iniziale o di avanzamento`, "sites", site.id);
    });
    const quoteFollowups = quotes.filter((item) => /inviat|in attesa/i.test(String(item.status || "")) && days(item.sentAt || item.updatedAt || item.date, today) >= 7);
    quoteFollowups.forEach((item) => add("medium", "quotes", "Preventivo senza risposta", `${item.code || "Preventivo"} · ${item.client || ""}`, "quotes", item.id));
    const technicalReviews = inspections.filter((item) => (item.outcome || item.problem) && (item.measurements || item.scanManifest || item.scanPackageId) && !item.technicalAnalysisApprovedAt);
    technicalReviews.forEach((item) => add("medium", "technical", "Sopralluogo pronto per Tecnico AI", `${item.client || item.site || item.problem || "Sopralluogo"} · analisi da preparare e approvare`, "inspections", item.id));
    const workerProfiles = window.EdilKappaCloud?.workerProfiles || [];
    const recorded = new Set(timesheets.filter((item) => dateOnly(item.date) === today && Number(item.hours || 0) > 0).map((item) => String(item.workerUid || item.workerId || item.worker || item.personId || "")));
    const absent = new Set(absences.filter((item) => /approvat/i.test(String(item.status || "")) && !item.partialDay && dateOnly(item.startDate) <= today && dateOnly(item.endDate || item.startDate) >= today).map((item) => String(item.workerUid || item.workerId || item.worker || "")));
    const missingHours = workerProfiles.filter((item) => !recorded.has(String(item.uid || item.id)) && !absent.has(String(item.uid || item.id)));
    missingHours.forEach((item) => add("medium", "hours", "Ore mancanti", `${item.name || "Operaio"} non ha inserito ore né assenza`, "hours", item.uid || item.id));
    const overdue = payments.filter((item) => Number(item.paid || 0) < Number(item.amount || 0) && dateOnly(item.dueDate) && dateOnly(item.dueDate) < today);
    overdue.forEach((item) => add("high", "payments", "Pagamento scaduto", `${item.client || "Cliente"} · residuo ${money(Number(item.amount || 0) - Number(item.paid || 0))}`, "payments", item.id));
    const upcoming = deadlines.filter((item) => !item.done && dateOnly(item.date) && days(today, item.date) >= 0 && days(today, item.date) <= 7);
    upcoming.forEach((item) => add(days(today, item.date) <= 1 ? "high" : "medium", "deadlines", "Scadenza vicina", `${item.title || item.description || "Scadenza"} · ${dateOnly(item.date)}`, "deadlinesView", item.id));
    const profit = sites.map((site) => ({ id: site.id, title: site.title || "Cantiere", client: site.client || "", revenue: Number(site.value || 0), cost: Number(site.cost || 0) })).filter((item) => item.revenue || item.cost).map((item) => ({ ...item, profit: item.revenue - item.cost, marginPercent: item.revenue ? Math.round((item.revenue - item.cost) / item.revenue * 1000) / 10 : 0 })).sort((a, b) => a.marginPercent - b.marginPercent);
    const order = { high: 0, medium: 1, low: 2 }; priorities.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
    return { generatedFor: today, metrics: { urgent: priorities.filter((item) => item.severity === "high").length, newRequests: newRequests.length, activeSites: active.length, stalledSites: priorities.filter((item) => item.category === "sites").length, photosToday: reports.filter((item) => dateOnly(item.workDate || item.date || item.createdAt) === today).reduce((sum, item) => sum + Number(item.photoCount || 0), 0), missingHours: missingHours.length, quoteFollowups: quoteFollowups.length, overduePayments: overdue.length, upcomingDeadlines: upcoming.length, technicalReviews: technicalReviews.length }, priorities, profitability: profit };
  }

  function agentCards() {
    return `<div class="opsAgents">${[
      ["🧭 Coordinatore centrale", "Riunisce i controlli e ordina le priorità."], ["📐 Tecnico AI", "Sopralluoghi, misure, foto e rilievi EdilKappa Scan."], ["🏗️ Agente cantieri", "Avanzamento, foto, rapportini, ore e assenze."], ["📄 Agente preventivi", "Bozze, solleciti, prezzi e consuntivi."], ["💼 Agente amministrativo", "Richieste, pagamenti, documenti e scadenze."], ["📈 Guadagno reale", "Ricavi, costi, utile previsto e utile reale."], ["🔔 Centro notifiche", "Un solo elenco ordinato senza duplicati."]
    ].map(([name, description]) => `<div class="opsAgent"><b>${name}</b><small>${description}</small></div>`).join("")}</div>`;
  }

  function priorityRows(snapshot) {
    const rows = snapshot?.priorities || [];
    return rows.slice(0, 30).map((item) => `<div class="opsPriority"><span class="opsSeverity ${e(item.severity)}"></span><div><b>${e(item.title)}</b><small>${e(item.detail || item.reason || "")}</small></div><button class="btn sm light" onclick="edilkappaOperationsOpen('${e(item.view || "dashboard")}','${e(item.targetId || "")}')">Apri</button></div>`).join("") || '<div class="okbox">Nessuna priorità critica rilevata dai dati presenti.</div>';
  }

  function briefingHtml() {
    const briefing = state.remote?.briefing;
    if (state.loading) return '<div class="notice">Carico l’ultimo briefing operativo…</div>';
    if (state.error) return `<div class="opsError">${e(state.error)}</div>`;
    if (!briefing) return '<div class="notice">Il coordinatore non ha ancora creato un briefing AI. Le priorità certe sono già visibili sotto; premi “Aggiorna analisi AI” per il primo riepilogo.</div>';
    const messages = (briefing.draftMessages || []).map((item) => `<div class="opsDraft"><b>Bozza ${e(item.channel)} · ${e(item.recipient || "destinatario da scegliere")}</b><small style="display:block;margin:4px 0">${e(item.subject || "")}</small><div>${e(item.body || "")}</div><small>Non inviata: serve la tua conferma.</small></div>`).join("");
    return `<div class="opsBrief"><b>${e(briefing.headline)}</b><p>${e(briefing.summary)}</p><small>Analisi Agents SDK · nessuna azione eseguita automaticamente</small></div>${messages}`;
  }

  function viewHtml() {
    const local = localSnapshot(), remoteSnapshot = state.remote?.snapshot;
    const snapshot = remoteSnapshot?.generatedFor === local.generatedFor ? { ...local, priorities: remoteSnapshot.priorities?.length ? remoteSnapshot.priorities : local.priorities, profitability: remoteSnapshot.profitability?.length ? remoteSnapshot.profitability : local.profitability } : local;
    const m = snapshot.metrics || {};
    const profits = (snapshot.profitability || []).slice(0, 12).map((item) => `<div class="opsProfit"><span><b>${e(item.title)}</b><small style="display:block">${e(item.client || "")}</small></span><span>${money(item.revenue)}</span><span>${money(item.cost)}</span><span style="color:${Number(item.profit) < 0 ? '#b7352f' : '#176542'}"><b>${money(item.profit)}</b> · ${Number(item.marginPercent || 0).toLocaleString('it-IT')}%</span></div>`).join("") || '<div class="empty">Inserisci valore e costi dei cantieri per vedere il guadagno reale.</div>';
    return `<div class="opsHero"><div><h2>Centro operativo EdilKappa</h2><p>La squadra di sette componenti controlla sopralluoghi, misure, richieste, cantieri, preventivi, amministrazione, guadagni e notifiche. Ogni azione resta sotto il tuo controllo.</p></div><div class="actions"><button class="btn lime" onclick="edilkappaOperationsRefresh()" ${state.refreshing ? 'disabled' : ''}>${state.refreshing ? 'Analisi in corso…' : 'Aggiorna analisi AI'}</button></div></div><div style="height:15px"></div>
      <div class="grid stats">${stat('Urgente oggi', m.urgent || 0, '⚠')}${stat('Tecnico AI', m.technicalReviews || 0, '📐')}${stat('Richieste nuove', m.newRequests || 0, '📥')}${stat('Cantieri fermi', m.stalledSites || 0, '🏗️')}${stat('Foto oggi', m.photosToday || 0, '📷')}${stat('Ore mancanti', m.missingHours || 0, '⏱️')}${stat('Pagamenti scaduti', m.overduePayments || 0, '€')}</div>
      ${briefingHtml()}<div style="height:15px"></div>${agentCards()}<div style="height:15px"></div>
      <div class="grid cols"><section class="card"><div class="cardHead"><h3>Priorità e notifiche</h3><small>${snapshot.generatedFor}</small></div>${priorityRows(snapshot)}</section><section class="card"><div class="cardHead"><h3>Guadagno reale</h3><button class="btn sm light" onclick="go('finance')">Apri costi e margini</button></div><div class="opsProfit" style="font-size:11px;color:#687a71"><span>Lavoro</span><span>Ricavo</span><span>Costo</span><span>Utile / margine</span></div>${profits}</section></div>`;
  }

  async function loadLatest() {
    if (state.loading || !window.EdilKappaCloud?.ready || !window.EdilKappaCloud?.operationsRequest) return;
    state.latestAttempted = true;
    state.loading = true; state.error = ""; render();
    try { const result = await window.EdilKappaCloud.operationsRequest({ action: "latest" }); state.remote = result?.available ? result : null; }
    catch (error) { state.error = error?.message || "Non riesco a caricare il briefing operativo."; }
    finally { state.loading = false; render(); }
  }

  window.edilkappaOperationsRefresh = async function () {
    if (state.refreshing || !window.EdilKappaCloud?.operationsRequest) return alert("Il collegamento cloud non è ancora pronto.");
    state.refreshing = true; state.error = ""; render();
    try { state.remote = await window.EdilKappaCloud.operationsRequest({ action: "refresh" }); }
    catch (error) { state.error = error?.message || "Il coordinatore operativo non ha completato l’analisi."; }
    finally { state.refreshing = false; render(); }
  };
  window.edilkappaOperationsOpen = function (targetView, targetId) {
    go(targetView || "dashboard");
    if (!targetId) return;
    setTimeout(() => {
      const openers = { sites: window.openSite, quotes: window.openQuote, payments: window.openPayment, leadsView: window.openLead };
      if (typeof openers[targetView] === "function") openers[targetView](targetId);
    }, 40);
  };

  if (!ownerNav.some((entry) => entry[0] === "operationsCenter")) {
    const before = ownerNav.findIndex((entry) => entry[0] === "ai");
    ownerNav.splice(before >= 0 ? before + 1 : 1, 0, ["operationsCenter", "🧭", "Centro operativo"]);
  }
  if (typeof renderNav === "function") renderNav();
  const baseMore = more;
  more = function () { return `${baseMore()}<div style="height:14px"></div><div class="grid quick"><button onclick="go('operationsCenter')"><span>🧭</span>Centro operativo</button></div>`; };
  const baseRender = render;
  render = function () {
    if (view === "operationsCenter") {
      if (!isOffice()) view = "worker";
      else {
        renderNav(); document.getElementById("avatar").textContent = roleName().charAt(0); document.getElementById("pageTitle").textContent = "Centro operativo"; document.getElementById("app").innerHTML = viewHtml();
        if (!state.remote && !state.loading && !state.latestAttempted) setTimeout(loadLatest, 0);
        return;
      }
    }
    return baseRender();
  };
  window.EdilKappaOperations = { localSnapshot, loadLatest };
})();
