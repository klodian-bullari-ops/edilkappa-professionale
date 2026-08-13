(function () {
  'use strict';

  const STALE_SITE_MS = 14 * 24 * 60 * 60 * 1000;
  const state = {
    serviceWorker: false,
    checking: false,
    servicesLoading: false,
    servicesLoaded: false,
    notificationTesting: false,
    danea: null,
    daneaError: '',
    health: null,
    healthError: '',
    notifications: null,
    notificationError: '',
    version: null,
    message: ''
  };
  const style = document.createElement('style');
  style.textContent = `
    .systemHero{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:22px;border-radius:22px;background:linear-gradient(135deg,#111827,#263241);color:#fff}.systemHero h2{margin:0 0 6px}.systemHero p{margin:0;color:#d8e0e8}.systemGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:12px;margin:16px 0}.systemCard{padding:16px;border:1px solid var(--line);border-radius:17px;background:#fff}.systemCardHead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.systemCard h3{margin:0;font-size:16px}.systemCard p{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.45}.systemCard .btn{margin-top:11px}.systemLight{width:12px;height:12px;border-radius:50%;background:#d29a20;box-shadow:0 0 0 5px #fff3cf}.systemLight.ok{background:#1c985d;box-shadow:0 0 0 5px #dff4e8}.systemLight.error{background:#c93c34;box-shadow:0 0 0 5px #ffe4e1}.systemIssue{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:11px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f2}.systemIssue:last-child{border-bottom:0}.systemIssue span{font-size:21px}.systemIssue b,.systemIssue small{display:block}.systemIssue small{color:var(--muted);margin-top:3px}@media(max-width:620px){.systemHero{align-items:flex-start;flex-direction:column}.systemHero .btn{width:100%}.systemIssue{grid-template-columns:auto minmax(0,1fr)}.systemIssue .btn{grid-column:2}}
  `;
  document.head.appendChild(style);

  function safe(value) { return typeof esc === 'function' ? esc(value) : String(value ?? ''); }
  function dateTime(value) { return value ? new Date(value).toLocaleString('it-IT') : 'Non ancora disponibile'; }
  function light(ok, error = false) { return `<i class="systemLight ${error ? 'error' : ok ? 'ok' : ''}"></i>`; }
  function cloud() { return window.EdilKappaCloud || {}; }
  function normalized(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it')
      .replace(/^\s*condominio\s+/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function isCompleted(value) { return /complet|conclus|chius|eseguit|fatturat/i.test(String(value || '')); }
  function duplicateClientGroups() {
    const groups = new Map();
    (db.condomini || []).forEach((client) => {
      const name = normalized(client.name);
      if (!name) return;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(client);
    });
    return Array.from(groups.values()).filter((rows) => rows.length > 1);
  }
  function siteLastActivity(item) {
    const values = [item.updatedAt, item.__cloudUpdatedAt, item.lastReportAt, item.start, item.createdAt]
      .filter(Boolean).map((value) => Date.parse(value)).filter(Number.isFinite);
    return values.length ? Math.max(...values) : 0;
  }

  function integrityIssues() {
    const clients = new Set((db.condomini || []).map((item) => String(item.id)));
    const interventions = new Set((db.interventions || []).map((item) => String(item.id)));
    const issues = [];
    const add = (icon, title, detail, action, value = '') => issues.push({ icon, title, detail, action, value });
    duplicateClientGroups().forEach((rows) => add('🏢', `${rows.length} anagrafiche duplicate: ${rows[0].name}`, 'Confrontale prima di spostare quella superflua nel cestino.', 'duplicates', rows[0].name));
    const orphanSites = (db.sites || []).filter((item) => !isCompleted(item.status) && item.interventionId && !interventions.has(String(item.interventionId)));
    if (orphanSites.length) add('🏗️', `${orphanSites.length} cantieri senza intervento valido`, 'Controlla il collegamento nella scheda cliente.', 'sites');
    const unlinkedSites = (db.sites || []).filter((item) => !isCompleted(item.status) && !item.interventionId);
    if (unlinkedSites.length) add('🔗', `${unlinkedSites.length} cantieri da collegare`, 'Assegna ogni lavoro alla relativa scheda intervento.', 'sites');
    const staleSites = (db.sites || []).filter((item) => !isCompleted(item.status) && Date.now() - siteLastActivity(item) > STALE_SITE_MS);
    if (staleSites.length) add('◷', `${staleSites.length} cantieri senza aggiornamenti recenti`, 'Controlla assegnazione, stato e prossima attività.', 'sites');
    const unlinkedDocs = [...(db.quotes || []), ...(db.documents || [])].filter((item) => !item.interventionId).length;
    if (unlinkedDocs) add('📁', `${unlinkedDocs} documenti da assegnare`, 'Restano al sicuro nell’archivio precedente del cliente.', 'documents');
    const invalidClients = (db.interventions || []).filter((item) => item.clientId && !clients.has(String(item.clientId)));
    if (invalidClients.length) add('🏢', `${invalidClients.length} interventi senza cliente valido`, 'Correggi il cliente prima di programmare il lavoro.', 'clients');
    const unreviewed = (db.sites || []).filter((item) => isCompleted(item.status) && !item.completionReviewedAt);
    if (unreviewed.length) add('✓', `${unreviewed.length} lavori completati da controllare`, 'Verifica foto finali, rapportino e ore prima di archiviare.', 'completed');
    const oldQuotes = (db.quotes || []).filter((item) => !item.archivedAt && /accett|rifiut|scadut/i.test(String(item.status || '')) && Date.now() - Date.parse(item.date || item.updatedAt || 0) > 90 * 24 * 60 * 60 * 1000);
    if (oldQuotes.length) add('📄', `${oldQuotes.length} preventivi chiusi archiviabili`, 'Puoi archiviarli in massa senza eliminarli.', 'quotes');
    return issues;
  }

  function daneaCard(daneaRows, latestDanea) {
    const status = state.danea;
    const ok = status?.health === 'active';
    const error = ['stale', 'error'].includes(status?.health) || Boolean(state.daneaError);
    let message = state.servicesLoading && !status ? 'Controllo del ponte Gmail in corso…' : 'Stato automatico non ancora controllato.';
    if (state.daneaError) message = `Controllo non riuscito: ${state.daneaError}`;
    else if (status?.health === 'active') message = `Ponte Gmail attivo · ultimo controllo ${dateTime(status.lastPollAtMs)}.`;
    else if (status?.health === 'stale') message = `Ponte Gmail non aggiornato da oltre 20 minuti${status.lastPollAtMs ? ` · ultimo controllo ${dateTime(status.lastPollAtMs)}` : ''}.`;
    else if (status?.health === 'error') message = `Apps Script segnala: ${status.lastPollError || status.lastError || 'errore non specificato'}`;
    else if (status?.health === 'waiting') message = 'Apps Script deve ancora inviare il primo heartbeat.';
    return `<section class="systemCard"><div class="systemCardHead"><h3>Richieste Danea</h3>${light(ok, error)}</div><p>${safe(message)}<br>${daneaRows.length} richieste archiviate${latestDanea ? ` · ultima ${safe(dateTime(latestDanea.receivedAt || latestDanea.createdAt))}` : ''}.</p><button class="btn sm light" onclick="go('daneaRequestsView')">Apri controllo Danea</button></section>`;
  }

  function notificationCard() {
    const supported = 'Notification' in window;
    const permission = supported ? Notification.permission : 'unsupported';
    const currentRegistered = Boolean(state.notifications?.currentDeviceRegistered);
    const registeredDevices = Number(state.notifications?.deviceCount || 0);
    const ok = permission === 'granted' && currentRegistered && state.serviceWorker;
    const error = permission === 'denied' || Boolean(state.notificationError);
    let message = !supported ? 'Non supportate da questo browser.' : permission === 'denied' ? 'Bloccate nelle impostazioni del dispositivo.' : permission !== 'granted' ? 'Non ancora autorizzate su questo dispositivo.' : currentRegistered ? `Questo dispositivo è registrato nel cloud${registeredDevices > 1 ? ` · ${registeredDevices} dispositivi totali` : ''}.` : registeredDevices ? `Risultano ${registeredDevices} altri dispositivi registrati, ma questo non è ancora verificato.` : 'Autorizzate, ma questo dispositivo non è ancora registrato nel cloud.';
    if (state.notificationError) message += ` Controllo cloud: ${state.notificationError}`;
    return `<section class="systemCard"><div class="systemCardHead"><h3>Notifiche</h3>${light(ok, error)}</div><p>${safe(message)}${state.serviceWorker ? '<br>Servizio notifiche installato.' : ''}</p>${supported ? `<button class="btn sm light" onclick="sendEdilKappaTestNotification()" ${state.notificationTesting ? 'disabled' : ''}>${state.notificationTesting ? 'Invio…' : 'Invia notifica di prova'}</button>` : ''}</section>`;
  }

  function healthCard() {
    const health = state.health;
    const ok = health?.status === 'healthy';
    const error = health?.status === 'error' || Boolean(state.healthError);
    let message = state.servicesLoading && !health ? 'Controllo automatico in corso…' : 'Controllo automatico non ancora disponibile.';
    if (state.healthError) message = `Controllo non riuscito: ${state.healthError}`;
    else if (health) {
      const issueNames = (health.issues || []).slice(0, 2).map((item) => item.title).join(' · ');
      message = `Qualità operativa ${Number(health.score || 0)}/100 · ${health.errorCount || 0} errori · ${health.warningCount || 0} avvisi${issueNames ? `. ${issueNames}` : '. Tutti i controlli sono regolari.'}`;
    }
    return `<section class="systemCard"><div class="systemCardHead"><h3>Controllo automatico</h3>${light(ok, error)}</div><p>${safe(message)}${health?.checkedAtMs ? `<br>Ultima verifica ${safe(dateTime(health.checkedAtMs))}.` : ''}</p></section>`;
  }

  function restoreDrillCard() {
    const drill = state.health?.restoreDrill;
    const ok = drill?.valid === true && Number(drill?.checkedAtMs || 0) > 0;
    return `<section class="systemCard"><div class="systemCardHead"><h3>Recupero backup</h3>${light(ok, drill && !ok)}</div><p>${ok ? `Prova reale di ricostruzione superata · ${Number(drill.recordCount || 0)} record.` : 'La prova automatica verrà eseguita con il prossimo backup notturno.'}${drill?.checkedAtMs ? `<br>Ultimo controllo ${safe(dateTime(drill.checkedAtMs))}.` : ''}</p><button class="btn sm light" onclick="go('backupView')">Apri backup</button></section>`;
  }

  function performanceCard() {
    const performance = state.health?.performance;
    const samples = Number(performance?.samples24h || 0);
    const ok = samples > 0 && Number(performance?.p75LcpMs || 0) <= 2500 && Number(performance?.p75Cls || 0) <= 0.1;
    const error = samples > 0 && (Number(performance?.p75LcpMs || 0) > 4000 || Number(performance?.p75Cls || 0) > 0.25);
    const message = samples
      ? `${samples} aperture misurate · contenuto P75 ${Math.round(Number(performance.p75LcpMs || 0))} ms · stabilità ${Number(performance.p75Cls || 0).toFixed(3)}.`
      : 'In attesa delle prime misurazioni da computer e telefono.';
    return `<section class="systemCard"><div class="systemCardHead"><h3>Velocità reale</h3>${light(ok, error)}</div><p>${safe(message)}</p></section>`;
  }

  function appCheckCard(api) {
    const configured = api.appCheckConfigured === true;
    const ready = api.appCheckReady === true;
    const backendMode = state.health?.appCheck?.mode || api.appCheckMode;
    const enforced = ready && backendMode === 'enforce';
    const error = configured && !ready;
    const message = enforced
      ? 'Protezione anti-abuso verificata e imposta sulle funzioni del gestionale.'
      : ready
        ? 'Token di verifica attivo in osservazione; nessun dispositivo viene ancora bloccato.'
        : configured
          ? `Configurata ma non inizializzata${api.appCheckError ? `: ${api.appCheckError}` : '.'}`
          : 'Non configurata: serve la site key prima di avviare la modalità osservazione.';
    return `<section class="systemCard"><div class="systemCardHead"><h3>Firebase App Check</h3>${light(enforced, error)}</div><p>${safe(message)}</p></section>`;
  }

  function statusCards() {
    const api = cloud();
    const daneaRows = (db.leads || []).filter((item) => /danea/i.test(`${item.source || ''} ${item.sourceType || ''}`));
    const latestDanea = daneaRows.slice().sort((a,b) => String(b.receivedAt || b.createdAt || '').localeCompare(String(a.receivedAt || a.createdAt || '')))[0];
    return `<div class="systemGrid">
      <section class="systemCard"><div class="systemCardHead"><h3>Cloud e accesso</h3>${light(Boolean(api.ready), !navigator.onLine)}</div><p>${navigator.onLine ? api.ready ? `Collegato come ${safe(api.currentProfile?.displayName || api.currentProfile?.email || 'utente EdilKappa')}.` : 'Connessione in preparazione.' : 'Dispositivo offline: i dati locali restano utilizzabili.'}</p></section>
      <section class="systemCard"><div class="systemCardHead"><h3>Sincronizzazione</h3>${light(Boolean(api.lastSyncAt) && !api.lastSyncError, Boolean(api.lastSyncError))}</div><p>${api.syncing ? 'Sincronizzazione in corso…' : api.lastSyncError ? `Ultimo errore: ${safe(api.lastSyncError)}` : `Ultimo completamento: ${safe(dateTime(api.lastSyncAt))}`}</p></section>
      ${daneaCard(daneaRows, latestDanea)}
      ${notificationCard()}
      ${healthCard()}
      ${restoreDrillCard()}
      ${performanceCard()}
      ${appCheckCard(api)}
      <section class="systemCard"><div class="systemCardHead"><h3>EdilKappa AI</h3>${light(Boolean(api.ready && api.aiRequest))}</div><p>${api.ready && api.aiRequest ? 'Servizio disponibile per preventivi, relazioni e analisi.' : 'In attesa del collegamento cloud.'}</p></section>
      <section class="systemCard"><div class="systemCardHead"><h3>Versione applicazione</h3>${light(Boolean(state.version?.version), !state.version)}</div><p>${state.version?.version ? `Versione ${safe(state.version.version)} · generata ${safe(dateTime(state.version.builtAt))}.` : 'Versione di produzione non verificata.'}<br>Cache automatica e aggiornamento controllato attivi.</p></section>
    </div>`;
  }

  function issuesHtml() {
    const issues = integrityIssues();
    return issues.map((item) => {
      const encodedValue = encodeURIComponent(item.value).replace(/'/g, '%27');
      return `<div class="systemIssue"><span>${item.icon}</span><div><b>${safe(item.title)}</b><small>${safe(item.detail)}</small></div><button class="btn sm light" onclick="reviewSystemIssue('${item.action}','${encodedValue}')">Controlla</button></div>`;
    }).join('') || '<div class="okbox">✓ I collegamenti principali tra clienti, interventi, cantieri e documenti sono coerenti.</div>';
  }

  function viewHtml() {
    if (!state.servicesLoaded && !state.servicesLoading) setTimeout(() => loadSystemServices(), 0);
    return `<section class="systemHero"><div><h2>Controllo sistema</h2><p>Un solo punto per verificare collegamenti, sincronizzazione, Danea, notifiche, AI e qualità dei dati.</p></div><button class="btn lime" onclick="edilkappaSystemRefresh()" ${state.checking ? 'disabled' : ''}>${state.checking ? 'Controllo…' : 'Aggiorna controllo'}</button></section>${statusCards()}<section class="card"><div class="cardHead"><div><h3>Pulizia dati guidata</h3><small>${state.message || 'Nessuna informazione viene modificata senza una tua conferma.'}</small></div></div>${issuesHtml()}</section>`;
  }

  async function loadSystemServices() {
    if (state.servicesLoading) return;
    state.servicesLoading = true;
    try {
      const registration = await navigator.serviceWorker?.getRegistration?.();
      state.serviceWorker = Boolean(registration);
      const [daneaResult, notificationResult, healthResult, versionResult] = await Promise.allSettled([
        cloud().daneaBridgeRequest?.({ action: 'status' }),
        cloud().notificationRequest?.({ action: 'status' }),
        cloud().healthRequest?.({ action: 'status' }),
        fetch('./version.json', { cache: 'no-store' }).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
      ]);
      if (daneaResult.status === 'fulfilled' && daneaResult.value) { state.danea = daneaResult.value; state.daneaError = ''; }
      else state.daneaError = daneaResult.reason?.message || 'Servizio non disponibile.';
      if (notificationResult.status === 'fulfilled' && notificationResult.value) { state.notifications = notificationResult.value; state.notificationError = ''; }
      else state.notificationError = notificationResult.reason?.message || 'Servizio non disponibile.';
      if (healthResult.status === 'fulfilled' && healthResult.value) { state.health = healthResult.value; state.healthError = ''; }
      else state.healthError = healthResult.reason?.message || 'Servizio non disponibile.';
      state.version = versionResult.status === 'fulfilled' ? versionResult.value : null;
      state.servicesLoaded = true;
    } finally {
      state.servicesLoading = false;
      if (view === 'systemControl') render();
    }
  }

  window.reviewSystemIssue = function (action, encodedValue = '') {
    const value = decodeURIComponent(encodedValue || '');
    if (action === 'duplicates') { go('condomini'); return setTimeout(() => window.setStableList?.('clients', 'query', value), 80); }
    if (action === 'completed') return go('completedView');
    if (action === 'quotes') { go('quotes'); return setTimeout(() => window.setStableList?.('quotes', 'filter', 'closed'), 80); }
    if (action === 'documents') return go('documentsView');
    if (action === 'clients') return go('condomini');
    return go('sites');
  };

  window.sendEdilKappaTestNotification = async function () {
    if (state.notificationTesting) return;
    state.notificationTesting = true; render();
    try {
      if (!('Notification' in window)) throw new Error('Questo browser non supporta le notifiche.');
      if (Notification.permission !== 'granted') await cloud().enablePushNotifications?.();
      else if (!state.notifications?.currentDeviceRegistered) await cloud().enablePushNotifications?.();
      const result = await cloud().notificationRequest?.({ action: 'test' });
      const delivered = Number(result?.delivery?.successCount || 0);
      if (!delivered) throw new Error('Nessun dispositivo ha ricevuto la prova. Riattiva le notifiche e riprova.');
      state.notifications = { ...result, currentDeviceRegistered: true };
      alert(`Notifica di prova inviata a ${delivered} dispositivo/i.`);
    } catch (error) { alert(error?.message || 'Notifica di prova non riuscita.'); }
    finally { state.notificationTesting = false; state.servicesLoaded = false; render(); }
  };

  window.edilkappaSystemRefresh = async function () {
    if (state.checking) return;
    state.checking = true; state.message = ''; render();
    try {
      if (navigator.onLine && cloud().ready) await cloud().syncNow?.();
      state.servicesLoaded = false;
      await loadSystemServices();
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
      else { renderNav(); document.getElementById('avatar').textContent = roleName().charAt(0); document.getElementById('pageTitle').textContent = 'Controllo sistema'; document.getElementById('app').innerHTML = viewHtml(); return; }
    }
    return baseRender();
  };

  window.EdilKappaSystemControl = { integrityIssues, duplicateClientGroups, siteLastActivity };
})();
