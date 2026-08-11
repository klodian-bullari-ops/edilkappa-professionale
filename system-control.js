(function () {
  'use strict';

  const state = { serviceWorker: false, checking: false, message: '' };
  const style = document.createElement('style');
  style.textContent = `
    .systemHero{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:22px;border-radius:22px;background:linear-gradient(135deg,#111827,#263241);color:#fff}.systemHero h2{margin:0 0 6px}.systemHero p{margin:0;color:#d8e0e8}.systemGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:12px;margin:16px 0}.systemCard{padding:16px;border:1px solid var(--line);border-radius:17px;background:#fff}.systemCardHead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.systemCard h3{margin:0;font-size:16px}.systemCard p{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.45}.systemLight{width:12px;height:12px;border-radius:50%;background:#d29a20;box-shadow:0 0 0 5px #fff3cf}.systemLight.ok{background:#1c985d;box-shadow:0 0 0 5px #dff4e8}.systemLight.error{background:#c93c34;box-shadow:0 0 0 5px #ffe4e1}.systemIssue{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:11px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f2}.systemIssue:last-child{border-bottom:0}.systemIssue span{font-size:21px}.systemIssue b,.systemIssue small{display:block}.systemIssue small{color:var(--muted);margin-top:3px}@media(max-width:620px){.systemHero{align-items:flex-start;flex-direction:column}.systemHero .btn{width:100%}.systemIssue{grid-template-columns:auto minmax(0,1fr)}.systemIssue .btn{grid-column:2}}
  `;
  document.head.appendChild(style);

  function safe(value) { return typeof esc === 'function' ? esc(value) : String(value ?? ''); }
  function dateTime(value) { return value ? new Date(value).toLocaleString('it-IT') : 'Non ancora disponibile'; }
  function light(ok, error = false) { return `<i class="systemLight ${error ? 'error' : ok ? 'ok' : ''}"></i>`; }
  function cloud() { return window.EdilKappaCloud || {}; }

  function integrityIssues() {
    const clients = new Set((db.condomini || []).map((item) => String(item.id)));
    const interventions = new Set((db.interventions || []).map((item) => String(item.id)));
    const issues = [];
    const add = (icon, title, detail, target) => issues.push({ icon, title, detail, target });
    const orphanSites = (db.sites || []).filter((item) => item.status !== 'Completato' && item.interventionId && !interventions.has(String(item.interventionId)));
    if (orphanSites.length) add('🏗️', `${orphanSites.length} cantieri senza intervento valido`, 'Controlla il collegamento nella scheda cliente.', 'sites');
    const unlinkedSites = (db.sites || []).filter((item) => item.status !== 'Completato' && !item.interventionId);
    if (unlinkedSites.length) add('🔗', `${unlinkedSites.length} cantieri da collegare`, 'Assegna ogni lavoro alla relativa scheda intervento.', 'sites');
    const unlinkedDocs = [...(db.quotes || []), ...(db.documents || [])].filter((item) => !item.interventionId).length;
    if (unlinkedDocs) add('📁', `${unlinkedDocs} documenti da assegnare`, 'Restano al sicuro nell’archivio precedente del cliente.', 'condomini');
    const invalidClients = (db.interventions || []).filter((item) => item.clientId && !clients.has(String(item.clientId)));
    if (invalidClients.length) add('🏢', `${invalidClients.length} interventi senza cliente valido`, 'Correggi il cliente prima di programmare il lavoro.', 'condomini');
    return issues;
  }

  function statusCards() {
    const api = cloud();
    const danea = (db.leads || []).filter((item) => /danea/i.test(`${item.source || ''} ${item.sourceType || ''}`));
    const latestDanea = danea.slice().sort((a,b) => String(b.receivedAt || b.createdAt || '').localeCompare(String(a.receivedAt || a.createdAt || '')))[0];
    const notificationSupported = 'Notification' in window;
    const notificationOk = notificationSupported && Notification.permission === 'granted';
    const notificationBlocked = notificationSupported && Notification.permission === 'denied';
    return `<div class="systemGrid">
      <section class="systemCard"><div class="systemCardHead"><h3>Cloud e accesso</h3>${light(Boolean(api.ready), !navigator.onLine)}</div><p>${navigator.onLine ? api.ready ? `Collegato come ${safe(api.currentProfile?.displayName || api.currentProfile?.email || 'utente EdilKappa')}.` : 'Connessione in preparazione.' : 'Dispositivo offline: i dati locali restano utilizzabili.'}</p></section>
      <section class="systemCard"><div class="systemCardHead"><h3>Sincronizzazione</h3>${light(Boolean(api.lastSyncAt) && !api.lastSyncError, Boolean(api.lastSyncError))}</div><p>${api.syncing ? 'Sincronizzazione in corso…' : api.lastSyncError ? `Ultimo errore: ${safe(api.lastSyncError)}` : `Ultimo completamento: ${safe(dateTime(api.lastSyncAt))}`}</p></section>
      <section class="systemCard"><div class="systemCardHead"><h3>Richieste Danea</h3>${light(danea.length > 0)}</div><p>${danea.length} richieste archiviate.${latestDanea ? `<br>Ultima ricevuta: ${safe(dateTime(latestDanea.receivedAt || latestDanea.createdAt))}.` : '<br>Nessuna richiesta ancora registrata.'}</p></section>
      <section class="systemCard"><div class="systemCardHead"><h3>Notifiche</h3>${light(notificationOk, notificationBlocked)}</div><p>${!notificationSupported ? 'Non supportate da questo browser.' : notificationOk ? 'Autorizzate su questo dispositivo.' : notificationBlocked ? 'Bloccate nelle impostazioni del dispositivo.' : 'Non ancora autorizzate su questo dispositivo.'}${state.serviceWorker ? '<br>Servizio notifiche installato.' : ''}</p></section>
      <section class="systemCard"><div class="systemCardHead"><h3>EdilKappa AI</h3>${light(Boolean(api.ready && api.aiRequest))}</div><p>${api.ready && api.aiRequest ? 'Servizio disponibile per preventivi, relazioni e analisi.' : 'In attesa del collegamento cloud.'}</p></section>
      <section class="systemCard"><div class="systemCardHead"><h3>Versione applicazione</h3>${light(true)}</div><p>Cache operativa <b>v81</b> · controllo sistema e percorso interventi attivi.</p></section>
    </div>`;
  }

  function issuesHtml() {
    const issues = integrityIssues();
    return issues.map((item) => `<div class="systemIssue"><span>${item.icon}</span><div><b>${safe(item.title)}</b><small>${safe(item.detail)}</small></div><button class="btn sm light" onclick="go('${item.target}')">Controlla</button></div>`).join('') || '<div class="okbox">✓ I collegamenti principali tra clienti, interventi, cantieri e documenti sono coerenti.</div>';
  }

  function viewHtml() {
    return `<section class="systemHero"><div><h2>Controllo sistema</h2><p>Un solo punto per verificare collegamenti, sincronizzazione, Danea, notifiche, AI e qualità dei dati.</p></div><button class="btn lime" onclick="edilkappaSystemRefresh()" ${state.checking ? 'disabled' : ''}>${state.checking ? 'Controllo…' : 'Aggiorna controllo'}</button></section>${statusCards()}<section class="card"><div class="cardHead"><div><h3>Controlli sui dati</h3><small>${state.message || 'Nessuna informazione viene modificata senza una tua azione.'}</small></div></div>${issuesHtml()}</section>`;
  }

  window.edilkappaSystemRefresh = async function () {
    if (state.checking) return;
    state.checking = true; state.message = ''; render();
    try {
      if (navigator.onLine && cloud().ready) await cloud().syncNow?.();
      state.serviceWorker = Boolean(await navigator.serviceWorker?.getRegistration?.());
      state.message = `Controllo completato ${new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}.`;
    } catch (error) { state.message = error?.message || 'Il controllo cloud non è stato completato.'; }
    finally { state.checking = false; render(); }
  };

  if (!ownerNav.some((entry) => entry[0] === 'systemControl')) ownerNav.push(['systemControl','●','Controllo sistema']);
  const baseMore = more;
  more = function () { return `${baseMore()}<div style="height:14px"></div><div class="grid quick"><button onclick="go('systemControl')"><span>●</span>Controllo sistema</button></div>`; };
  const baseRender = render;
  render = function () {
    if (view === 'systemControl') {
      if (!isOffice()) view = 'worker';
      else { renderNav(); document.getElementById('avatar').textContent = roleName().charAt(0); document.getElementById('pageTitle').textContent = 'Controllo sistema'; document.getElementById('app').innerHTML = viewHtml(); if (!state.serviceWorker) navigator.serviceWorker?.getRegistration?.().then((registration) => { state.serviceWorker = Boolean(registration); }); return; }
    }
    return baseRender();
  };
})();
