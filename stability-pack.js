(function () {
  'use strict';

  const PAGE_SIZE = 20;
  const ERROR_KEY = 'edilkappa_client_errors_v1';
  const LOCAL_ONLY_COLLECTIONS = new Set(['portalUsers']);
  const listState = {
    clients: { query: '', filter: 'all', page: 1 },
    inspections: { query: '', filter: 'all', page: 1 },
    quotes: { query: '', filter: 'open', page: 1 },
    sites: { query: '', filter: 'active', page: 1 }
  };
  const selectedQuotes = new Set();
  let backupRows = [];
  let backupLoading = false;
  let backupLoaded = false;
  let productionErrors = [];
  let productionErrorsLoading = false;
  let productionErrorsLoaded = false;

  db.trash = Array.isArray(db.trash) ? db.trash : [];
  db.audit = Array.isArray(db.audit) ? db.audit : [];

  function safe(value) { return typeof esc === 'function' ? esc(value) : String(value ?? ''); }
  function normalized(value) { return String(value || '').trim().toLocaleLowerCase('it'); }
  function matchesQuery(row, query, fields) {
    if (!query) return true;
    return normalized(fields.map((field) => row?.[field]).join(' ')).includes(normalized(query));
  }
  function pageRows(rows, page) {
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const current = Math.min(Math.max(1, Number(page || 1)), pages);
    return { rows: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pages, total: rows.length };
  }
  function toolbar(viewName, filters, placeholder) {
    const state = listState[viewName];
    return `<div class="stableToolbar"><input id="stableSearch-${viewName}" class="search" type="search" placeholder="${safe(placeholder)}" value="${safe(state.query)}" oninput="setStableList('${viewName}','query',this.value)"><div class="stableFilters">${filters.map(([value, label]) => `<button class="completionFilter ${state.filter === value ? 'active' : ''}" onclick="setStableList('${viewName}','filter','${value}')">${safe(label)}</button>`).join('')}</div></div>`;
  }
  function pagination(viewName, page) {
    if (page.pages <= 1) return `<div class="stableCount">${page.total} risultati</div>`;
    return `<div class="stablePagination"><span>${page.total} risultati · pagina ${page.page} di ${page.pages}</span><div class="actions"><button class="btn sm light" ${page.page <= 1 ? 'disabled' : ''} onclick="setStableList('${viewName}','page',${page.page - 1})">‹ Precedente</button><button class="btn sm light" ${page.page >= page.pages ? 'disabled' : ''} onclick="setStableList('${viewName}','page',${page.page + 1})">Successiva ›</button></div></div>`;
  }

  window.setStableList = function (viewName, key, value) {
    const state = listState[viewName];
    if (!state || !['query', 'filter', 'page'].includes(key)) return;
    state[key] = key === 'page' ? Math.max(1, Number(value || 1)) : String(value || '');
    if (key !== 'page') state.page = 1;
    render();
    if (key === 'query') {
      requestAnimationFrame(() => {
        const input = document.getElementById(`stableSearch-${viewName}`);
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    }
  };

  condomini = function () {
    const state = listState.clients;
    const rows = (db.condomini || [])
      .filter((item) => matchesQuery(item, state.query, ['name', 'address', 'manager', 'phone', 'email']))
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'it'));
    const current = pageRows(rows, state.page); state.page = current.page;
    return pageHead('Condomìni e clienti', 'Anagrafica ordinata: cerca prima di scorrere', '<button class="btn lime" onclick="openCondo()">＋ Nuovo</button>') +
      toolbar('clients', [['all', 'Tutti']], 'Cerca condominio, indirizzo o amministratore…') +
      `<div class="card"><div class="tableWrap"><table class="table stableTable"><thead><tr><th>Cliente</th><th>Indirizzo</th><th>Amministratore</th><th>Telefono</th><th>Interventi</th><th></th></tr></thead><tbody>${current.rows.map((client) => `<tr><td data-label="Cliente"><b>${safe(client.name)}</b></td><td data-label="Indirizzo">${safe(client.address)}</td><td data-label="Amministratore">${safe(client.manager)}</td><td data-label="Telefono">${safe(client.phone)}</td><td data-label="Interventi">${(db.sites || []).filter((site) => site.client === client.name).length}</td><td><div class="actions"><button class="btn sm green" onclick="openClientArchive('${client.id}')">Apri</button><button class="btn sm light" onclick="openCondo('${client.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('condomini','${client.id}','${safe(client.name)}')">Cestino</button></div></td></tr>`).join('') || '<tr><td colspan="6">Nessun cliente trovato.</td></tr>'}</tbody></table></div></div>${pagination('clients', current)}`;
  };

  inspections = function () {
    const state = listState.inspections;
    const rows = (db.inspections || []).filter((item) => {
      if (state.filter === 'planned' && item.completedAt) return false;
      if (state.filter === 'completed' && !item.completedAt) return false;
      return matchesQuery(item, state.query, ['client', 'address', 'type', 'problem', 'result', 'status']);
    }).sort((left, right) => `${right.date || ''} ${right.time || ''}`.localeCompare(`${left.date || ''} ${left.time || ''}`));
    const current = pageRows(rows, state.page); state.page = current.page;
    return pageHead('Sopralluoghi', 'Rilievi programmati e sopralluoghi già eseguiti', '<button class="btn lime" onclick="openInspection()">＋ Nuovo sopralluogo</button>') +
      toolbar('inspections', [['all', 'Tutti'], ['planned', 'Programmati'], ['completed', 'Eseguiti']], 'Cerca cliente, indirizzo o problema…') +
      `<div class="card"><div class="tableWrap"><table class="table stableTable"><thead><tr><th>Data</th><th>Tipo</th><th>Cliente</th><th>Esito / richiesta</th><th>Stato</th><th></th></tr></thead><tbody>${current.rows.map((item) => `<tr><td data-label="Data">${safe(item.date)}<br><small>${safe(item.time)}</small></td><td data-label="Tipo">${safe(item.type)}</td><td data-label="Cliente"><b>${safe(item.client)}</b><br><small>${safe(item.address)}</small></td><td data-label="Esito">${inspectionResultSummary(item)}</td><td data-label="Stato">${badge(item.completedAt ? 'Eseguito · da preventivare' : item.status)}</td><td><div class="actions">${item.completedAt ? `<button class="btn sm lime" onclick="prepareInspectionQuoteAI('${item.id}')">✦ Preventivo AI</button><button class="btn sm green" onclick="completeInspection('${item.id}')">Modifica esito</button>` : `<button class="btn sm green" onclick="completeInspection('${item.id}')">✓ Segna eseguito</button>`}${window.inspectionDaneaSeparationButton?.(item) || ''}<button class="btn sm light" onclick="openInspection('${item.id}')">Appuntamento</button><button class="btn sm red" onclick="deleteItem('inspections','${item.id}','questo sopralluogo')">Cestino</button></div></td></tr>`).join('') || '<tr><td colspan="6">Nessun sopralluogo trovato.</td></tr>'}</tbody></table></div></div>${pagination('inspections', current)}`;
  };

  function quoteClosed(item) { return /accett|rifiut|scadut|archiv/i.test(String(item.status || '')); }
  window.toggleStableQuote = function (id, checked) {
    if (checked) selectedQuotes.add(String(id)); else selectedQuotes.delete(String(id));
    const count = document.getElementById('selectedQuoteCount');
    if (count) count.textContent = String(selectedQuotes.size);
  };
  window.toggleStableQuotePage = function (checked) {
    document.querySelectorAll('[data-stable-quote]').forEach((input) => { input.checked = checked; window.toggleStableQuote(input.value, checked); });
  };
  window.archiveSelectedQuotes = function () {
    const rows = (db.quotes || []).filter((item) => selectedQuotes.has(String(item.id)));
    if (!rows.length) return alert('Seleziona almeno un preventivo.');
    if (!confirm(`Archiviare ${rows.length} preventivi selezionati? Restano recuperabili con il filtro Archiviati.`)) return;
    const now = new Date().toISOString();
    rows.forEach((item) => { item.archivedAt = now; item.archivedBy = roleName(); item.updatedAt = now; });
    selectedQuotes.clear(); save(); render();
  };
  window.archiveOldClosedQuotes = function () {
    const threshold = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const rows = (db.quotes || []).filter((item) => !item.archivedAt && quoteClosed(item) && Date.parse(item.date || item.updatedAt || 0) < threshold);
    if (!rows.length) return alert('Non risultano preventivi chiusi da oltre 90 giorni.');
    if (!confirm(`Archiviare ${rows.length} preventivi chiusi da oltre 90 giorni?`)) return;
    const now = new Date().toISOString();
    rows.forEach((item) => { item.archivedAt = now; item.archivedBy = roleName(); item.updatedAt = now; });
    save(); render();
  };

  quotes = function () {
    const state = listState.quotes;
    const rows = (db.quotes || []).filter((item) => {
      if (state.filter === 'open' && (item.archivedAt || quoteClosed(item))) return false;
      if (state.filter === 'closed' && (item.archivedAt || !quoteClosed(item))) return false;
      if (state.filter === 'archived' && !item.archivedAt) return false;
      if (state.filter === 'all' && item.archivedAt) return false;
      return matchesQuery(item, state.query, ['code', 'client', 'subject', 'status', 'date']);
    }).sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
    const current = pageRows(rows, state.page); state.page = current.page;
    return pageHead('Preventivi', 'Mostra prima quelli realmente da lavorare', '<button class="btn light" onclick="openPdfUpload()">↑ Carica PDF</button><button class="btn lime" onclick="openQuote()">＋ Nuovo preventivo</button>') +
      toolbar('quotes', [['open', 'Aperti'], ['closed', 'Chiusi'], ['all', 'Tutti'], ['archived', 'Archiviati']], 'Cerca numero, cliente o oggetto…') +
      `<div class="stableBulk"><label><input type="checkbox" onchange="toggleStableQuotePage(this.checked)"> Seleziona pagina</label><span><b id="selectedQuoteCount">${selectedQuotes.size}</b> selezionati</span><button class="btn sm light" onclick="archiveSelectedQuotes()">Archivia selezionati</button><button class="btn sm light" onclick="archiveOldClosedQuotes()">Archivia vecchi chiusi</button></div>
      <div class="card"><div class="tableWrap"><table class="table stableTable"><thead><tr><th></th><th>Numero</th><th>Data</th><th>Cliente</th><th>Oggetto</th><th>Netto</th><th>Stato</th><th></th></tr></thead><tbody>${current.rows.map((quote) => `<tr><td><input type="checkbox" data-stable-quote value="${quote.id}" ${selectedQuotes.has(String(quote.id)) ? 'checked' : ''} onchange="toggleStableQuote(this.value,this.checked)"></td><td data-label="Numero"><b>${safe(quote.code)}</b></td><td data-label="Data">${safe(quote.date)}</td><td data-label="Cliente">${safe(quote.client)}</td><td data-label="Oggetto">${safe(quote.subject)}</td><td data-label="Netto" class="money">${quote.net ? euro(quote.net) : '—'}</td><td data-label="Stato">${badge(quote.archivedAt ? 'Archiviato' : quote.status)}</td><td><div class="actions">${quote.pdfKey || quote.storagePath ? `<button class="btn sm green" onclick="openQuotePdf('${quote.id}')">PDF</button>` : `<button class="btn sm light" onclick="printQuote('${quote.id}')">Genera PDF</button>`}${!quote.acceptedAt ? `<button class="btn sm green" onclick="openQuoteSignature('${quote.id}')">Firma</button>` : ''}<button class="btn sm light" onclick="openQuote('${quote.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('quotes','${quote.id}','questo preventivo')">Cestino</button></div></td></tr>`).join('') || '<tr><td colspan="8">Nessun preventivo per questo filtro.</td></tr>'}</tbody></table></div></div>${pagination('quotes', current)}`;
  };

  sites = function () {
    const state = listState.sites;
    const all = db.sites || [];
    const completed = all.filter((item) => /complet|conclus|chius|eseguit|fatturat/i.test(String(item.status || '')));
    const active = all.filter((item) => !completed.includes(item));
    const rows = all.filter((item) => {
      if (state.filter === 'active' && completed.includes(item)) return false;
      if (state.filter === 'progress' && item.status !== 'In corso') return false;
      if (state.filter === 'planned' && (completed.includes(item) || item.status === 'In corso')) return false;
      return matchesQuery(item, state.query, ['title', 'client', 'address', 'status', 'worker']);
    });
    const current = pageRows(rows, state.page); state.page = current.page;
    return pageHead('Cantieri', 'Filtra i lavori invece di scorrere tutto l’archivio', `<button class="btn light" onclick="go('completedView')">✓ Completati (${completed.length})</button><button class="btn lime" onclick="openSite()">＋ Nuovo cantiere</button>`) +
      `<div class="grid stats">${stat('Attivi', active.length, '🏗️')}${stat('In corso', active.filter((item) => item.status === 'In corso').length, '↗')}${stat('Pianificati', active.filter((item) => item.status !== 'In corso').length, '📅')}${stat('Completati', completed.length, '✓')}</div>` +
      toolbar('sites', [['active', 'Attivi'], ['progress', 'In corso'], ['planned', 'Pianificati'], ['all', 'Tutti']], 'Cerca cantiere, cliente o indirizzo…') +
      `<div class="grid cols sitesLayout"><section class="card siteListCard"><div class="list">${current.rows.map(siteRow).join('') || '<div class="empty">Nessun cantiere trovato.</div>'}</div>${pagination('sites', current)}</section><section class="card teamLoadCard"><div class="cardHead"><h3>Carico squadre</h3></div>${WORKERS.map((worker) => `<div class="row"><div class="avatar">${safe(worker.name || '').charAt(0)}</div><div class="rowBody"><b>${safe(worker.name || 'Squadra')}</b><small>${staffForTeam(worker.id).length} operai · ${active.filter((site) => typeof siteHasTeam === 'function' ? siteHasTeam(site, worker.id) : site.worker === worker.id).length} cantieri attivi</small></div></div>`).join('') || '<div class="empty">Nessuna squadra configurata.</div>'}</section></div>`;
  };

  function trashLabel(item) {
    return item.title || item.subject || item.name || item.code || item.client || item.type || 'Elemento senza titolo';
  }
  function collectionLabel(item) {
    return ({ clients: 'Cliente', inspections: 'Sopralluogo', sites: 'Cantiere', quotes: 'Preventivo', documents: 'Documento', reports: 'Rapportino', interventions: 'Intervento', portalUsers: 'Accesso amministratore' })[item.deletedCollection] || item.deletedLocalName || item.deletedCollection || 'Archivio';
  }
  function localTombstone(collectionName, item) {
    return {
      ...JSON.parse(JSON.stringify(item)),
      deletedAt: new Date().toISOString(),
      deletedBy: roleName(),
      deletedCollection: collectionName,
      deletedLocalName: collectionName,
      localOnly: true
    };
  }

  deleteItem = async function (collectionName, id, label) {
    const item = (db[collectionName] || []).find((entry) => String(entry.id) === String(id));
    if (!item) return alert('L’elemento non è più presente.');
    if (!confirm(`Spostare ${label || trashLabel(item)} nel cestino? Potrai ripristinarlo per 30 giorni.`)) return;
    try {
      const tombstone = LOCAL_ONLY_COLLECTIONS.has(collectionName)
        ? localTombstone(collectionName, item)
        : await window.EdilKappaCloud?.softDeleteRecord?.(collectionName, item);
      if (!tombstone) throw new Error('Il collegamento cloud non è ancora pronto. Riprova tra qualche secondo.');
      db[collectionName] = (db[collectionName] || []).filter((entry) => String(entry.id) !== String(id));
      db.trash = [...(db.trash || []).filter((entry) => !(entry.deletedCollection === tombstone.deletedCollection && String(entry.id) === String(id))), tombstone];
      db.audit.push({ id: `log-${Date.now()}`, date: new Date().toISOString(), actor: roleName(), action: 'Spostato nel cestino', entity: collectionName, summary: label || trashLabel(item) });
      save(); render();
    } catch (error) { alert(error.message || 'Non è stato possibile spostare l’elemento nel cestino.'); }
  };

  window.restoreTrashItem = async function (collectionName, id) {
    const item = (db.trash || []).find((entry) => entry.deletedCollection === collectionName && String(entry.id) === String(id));
    if (!item) return alert('L’elemento non è più presente nel cestino.');
    try {
      let restored;
      if (item.localOnly) {
        const record = JSON.parse(JSON.stringify(item));
        ['deletedAt', 'deletedBy', 'deletedCollection', 'deletedLocalName', 'localOnly'].forEach((key) => delete record[key]);
        restored = { localName: item.deletedLocalName, record };
      } else restored = await window.EdilKappaCloud?.restoreDeletedRecord?.(item);
      if (!restored) throw new Error('Il cloud non è ancora pronto.');
      db.trash = db.trash.filter((entry) => entry !== item);
      db[restored.localName] = [...(db[restored.localName] || []).filter((entry) => String(entry.id) !== String(id)), restored.record];
      db.audit.push({ id: `log-${Date.now()}`, date: new Date().toISOString(), actor: roleName(), action: 'Ripristino', entity: restored.localName, summary: trashLabel(item) });
      save(); render();
    } catch (error) { alert(error.message || 'Ripristino non riuscito.'); }
  };

  window.permanentlyDeleteTrashItem = async function (collectionName, id) {
    const item = (db.trash || []).find((entry) => entry.deletedCollection === collectionName && String(entry.id) === String(id));
    if (!item) return;
    if (prompt(`Eliminazione definitiva di “${trashLabel(item)}”. Scrivi ELIMINA per confermare:`) !== 'ELIMINA') return;
    try {
      if (!item.localOnly) await window.EdilKappaCloud?.permanentlyDeleteRecord?.(item);
      db.trash = db.trash.filter((entry) => entry !== item);
      save(); render();
    } catch (error) { alert(error.message || 'Eliminazione definitiva non riuscita.'); }
  };

  window.trashView = function () {
    const rows = (db.trash || []).slice().sort((left, right) => String(right.deletedAt || '').localeCompare(String(left.deletedAt || '')));
    return pageHead('Cestino', 'Gli elementi eliminati restano ripristinabili per 30 giorni') +
      `<div class="grid stats">${stat('Nel cestino', rows.length, '♻')}${stat('Ripristinabili', rows.length, '↺')}${stat('Conservazione', '30 giorni', '◷')}${stat('Backup', 'Notturno', '☁')}</div><div class="list">${rows.map((item) => `<section class="card trashCard"><div class="row" style="border:0;padding:0"><div class="rowIcon">♻</div><div class="rowBody"><b>${safe(trashLabel(item))}</b><small>${safe(collectionLabel(item))} · eliminato ${safe(String(item.deletedAt || '').slice(0, 16).replace('T', ' '))} da ${safe(item.deletedBy || '')}</small></div></div><div class="actions"><button class="btn sm green" onclick="restoreTrashItem('${safe(item.deletedCollection)}','${safe(item.id)}')">↺ Ripristina</button>${window.EdilKappaCloud?.currentProfile?.role === 'owner' ? `<button class="btn sm red" onclick="permanentlyDeleteTrashItem('${safe(item.deletedCollection)}','${safe(item.id)}')">Elimina definitivamente</button>` : ''}</div></section>`).join('') || '<div class="okbox">Il cestino è vuoto.</div>'}</div>`;
  };

  function formatBytes(value) {
    const bytes = Number(value || 0); if (!bytes) return '0 KB';
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  window.loadEdilKappaBackups = async function (force = false) {
    if (backupLoading || (backupLoaded && !force)) return;
    backupLoading = true; render();
    try {
      const result = await window.EdilKappaCloud?.backupRequest?.({ action: 'list' });
      backupRows = result?.backups || []; backupLoaded = true;
    } catch (error) { alert(error.message || 'Non riesco a leggere i backup.'); }
    finally { backupLoading = false; render(); }
  };
  window.loadProductionErrors = async function () {
    if (productionErrorsLoading) return;
    productionErrorsLoading = true; render();
    try { productionErrors = await window.EdilKappaCloud?.listClientErrors?.(30) || []; }
    catch (_) { productionErrors = storedErrors(); }
    finally { productionErrorsLoading = false; productionErrorsLoaded = true; render(); }
  };
  window.createEdilKappaBackup = async function () {
    if (!confirm('Creare adesso un nuovo backup completo?')) return;
    backupLoading = true; render();
    try {
      await window.EdilKappaCloud?.backupRequest?.({ action: 'create' });
      backupLoaded = false;
      backupLoading = false;
      await window.loadEdilKappaBackups(true);
      alert('Backup completo creato.');
    } catch (error) { backupLoading = false; render(); alert(error.message || 'Backup non riuscito.'); }
  };
  window.backupView = function () {
    const health = window.EdilKappaCloud?.syncHealth || [];
    const errors = health.filter((item) => item.status === 'error');
    const pending = health.filter((item) => item.status === 'pending');
    const offline = !navigator.onLine;
    if (!backupLoaded && !backupLoading) setTimeout(() => window.loadEdilKappaBackups(), 0);
    if (!productionErrorsLoaded && !productionErrorsLoading) setTimeout(() => window.loadProductionErrors(), 0);
    return pageHead('Sicurezza e backup', 'Controllo cloud, copie notturne e segnalazioni tecniche', '<button class="btn lime" onclick="createEdilKappaBackup()">＋ Backup adesso</button>') +
      `<div class="grid stats">${stat('Stato cloud', offline ? 'Offline' : errors.length ? `${errors.length} errori` : pending.length ? 'Verifica in corso' : 'Regolare', offline || errors.length ? '!' : pending.length ? '◷' : '✓')}${stat('Errori rilevati', productionErrors.length, '!')}${stat('Backup disponibili', backupRows.length, '☁')}${stat('Cestino', (db.trash || []).length, '♻')}</div>
      ${offline ? '<div class="notice"><b>Dispositivo offline</b><br>Le modifiche restano sul dispositivo e verranno inviate al ritorno della connessione.</div>' : errors.length ? `<div class="notice error"><b>Sincronizzazione incompleta</b><br>${errors.map((item) => `${safe(item.collectionName)}: ${safe(item.error)}`).join('<br>')}</div>` : pending.length ? `<div class="notice"><b>Controllo cloud in corso</b><br>${pending.length} raccolte devono ancora rispondere.</div>` : '<div class="okbox">✓ Tutte le raccolte cloud controllate risultano sincronizzate.</div>'}
      <div style="height:14px"></div><section class="card"><div class="cardHead"><div><h3>Backup automatici</h3><small>Ogni notte alle 02:15 · conservazione 60 giorni</small></div><button class="btn sm light" onclick="loadEdilKappaBackups(true)">Aggiorna</button></div>${backupLoading ? '<div class="empty">Controllo backup in corso…</div>' : `<div class="list">${backupRows.map((item) => `<div class="row"><div class="rowIcon">☁</div><div class="rowBody"><b>${safe(new Date(item.generatedAt).toLocaleString('it-IT'))}</b><small>${Number(item.recordCount || 0)} record · ${formatBytes(item.bytes)} · ${item.trigger === 'manual' ? 'manuale' : 'automatico'}</small></div><span class="pill">Protetto</span></div>`).join('') || '<div class="empty">Il primo backup verrà creato dopo la pubblicazione delle funzioni.</div>'}</div>`}</section>
      <div style="height:14px"></div><section class="card"><div class="cardHead"><div><h3>Errori di produzione</h3><small>Ultime segnalazioni tecniche, raccolte automaticamente</small></div><button class="btn sm light" onclick="loadProductionErrors()">Aggiorna</button></div>${productionErrorsLoading ? '<div class="empty">Controllo errori in corso…</div>' : `<div class="list">${productionErrors.slice(0, 10).map((item) => `<div class="row"><div class="rowIcon">!</div><div class="rowBody"><b>${safe(item.message)}</b><small>${safe(item.source || 'Gestionale')} · ${safe(item.createdAtText || item.createdAt || '')}</small></div></div>`).join('') || '<div class="okbox">Nessun errore recente rilevato.</div>'}</div>`}</section>`;
  };

  function storedErrors() {
    try { const rows = JSON.parse(localStorage.getItem(ERROR_KEY) || '[]'); return Array.isArray(rows) ? rows : []; } catch (_) { return []; }
  }
  function monitorError(event) {
    const message = String(event?.message || event?.reason?.message || event?.reason || 'Errore JavaScript');
    const source = String(event?.filename || event?.source || location.pathname);
    if (/chrome-extension:|moz-extension:|ResizeObserver loop/i.test(`${source} ${message}`)) return;
    const entry = { message: message.slice(0, 1000), source: source.slice(0, 500), stack: String(event?.error?.stack || event?.reason?.stack || '').slice(0, 4000), createdAt: new Date().toISOString() };
    const rows = storedErrors();
    if (rows[0]?.message === entry.message && Date.now() - Date.parse(rows[0].createdAt || 0) < 60000) return;
    localStorage.setItem(ERROR_KEY, JSON.stringify([entry, ...rows].slice(0, 30)));
    window.EdilKappaCloud?.reportClientError?.(entry).catch(() => {});
  }
  window.addEventListener('error', monitorError);
  window.addEventListener('unhandledrejection', monitorError);

  const style = document.createElement('style');
  style.textContent = `
    .stableToolbar,.stableBulk,.stablePagination{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px}.stableFilters{display:flex;gap:7px;flex-wrap:wrap}.stableBulk{padding:11px 13px;border:1px solid var(--line);border-radius:14px;background:#fff}.stableBulk label{display:flex;align-items:center;gap:7px;font-weight:800}.stablePagination{margin:13px 0 0;padding:10px 2px;color:var(--muted);font-size:13px}.stableCount{padding:11px 2px;color:var(--muted);font-size:13px}.trashCard{display:flex;align-items:center;justify-content:space-between;gap:12px}.trashCard>.row{flex:1}.notice.error{background:#feeceb;color:#8b2420;border-color:#f2b7b3}
    @media(max-width:720px){.stableToolbar .search{width:100%}.stableFilters{width:100%;overflow:auto;flex-wrap:nowrap;padding-bottom:3px}.stableBulk{align-items:flex-start}.stablePagination{align-items:stretch}.stablePagination .actions{width:100%}.stablePagination .btn{flex:1}.stableTable{min-width:0}.stableTable thead{display:none}.stableTable,.stableTable tbody,.stableTable tr,.stableTable td{display:block;width:100%}.stableTable tr{padding:13px;border-bottom:1px solid var(--line)}.stableTable td{border:0;padding:5px 0}.stableTable td[data-label]:before{content:attr(data-label);display:block;color:var(--muted);font-size:10px;text-transform:uppercase;font-weight:800;margin-bottom:2px}.trashCard{align-items:stretch;flex-direction:column}.trashCard>.actions .btn{flex:1}}
  `;
  document.head.appendChild(style);

  if (!ownerNav.some((item) => item[0] === 'trashView')) ownerNav.push(['trashView', '♻', 'Cestino']);
  if (!ownerNav.some((item) => item[0] === 'backupView')) ownerNav.push(['backupView', '☁', 'Sicurezza e backup']);
  const baseMore = more;
  more = function () {
    return baseMore() + pageHead('Sicurezza dati', 'Recupero e controllo del gestionale') + `<div class="grid quick"><button onclick="go('trashView')"><span>♻</span>Cestino${(db.trash || []).length ? ` (${db.trash.length})` : ''}</button><button onclick="go('backupView')"><span>☁</span>Sicurezza e backup</button></div>`;
  };

  const baseRender = render;
  render = function () {
    if (['trashView', 'backupView'].includes(view)) {
      if (!isOffice()) view = 'worker';
      else {
        renderNav();
        document.getElementById('avatar').textContent = roleName().charAt(0);
        document.getElementById('pageTitle').textContent = view === 'trashView' ? 'Cestino' : 'Sicurezza e backup';
        document.getElementById('app').innerHTML = view === 'trashView' ? window.trashView() : window.backupView();
        return;
      }
    }
    return baseRender();
  };

  window.EdilKappaStability = { pageRows, matchesQuery, storedErrors, listState };
})();
