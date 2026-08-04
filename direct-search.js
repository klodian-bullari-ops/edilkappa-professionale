(function () {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    .searchResultRow{width:100%;align-items:center;flex-wrap:wrap;transition:border-color .15s,box-shadow .15s}
    .searchResultRow:hover{border-color:var(--green);box-shadow:0 8px 22px rgba(17,17,17,.08)}
    .searchResultActions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto}
    @media(max-width:760px){.searchResultActions{width:100%;margin-left:54px;justify-content:flex-start}.searchResultActions .btn{flex:1 1 auto}}
  `;
  document.head.appendChild(style);

  function clearSearch() {
    searchQuery = '';
    const input = document.getElementById('globalSearch');
    if (input) input.value = '';
  }

  function clientFor(item) {
    if (!item) return null;
    return (db.condomini || []).find((client) => client.id === item.clientId)
      || (db.condomini || []).find((client) => client.name === item.client)
      || null;
  }

  function openFullClient(clientId, interventionId, itemId) {
    if (!clientId || typeof window.openClientArchive !== 'function') return false;
    window.openClientArchive(clientId, { interventionId: interventionId || '', itemId: itemId || '' });
    return true;
  }

  openSearchResult = function (action, id, clientId = '', interventionId = '') {
    clearSearch();
    const office = isOffice();

    if (action === 'client' && openFullClient(id, '', '')) return;
    if (['intervention', 'quote', 'document', 'drone'].includes(action)) {
      const focusItem = action === 'intervention' ? '' : id;
      const focusIntervention = action === 'intervention' ? id : interventionId;
      if (openFullClient(clientId, focusIntervention, focusItem)) return;
    }

    switch (action) {
      case 'client': view = 'condomini'; render(); return window.openCondo(id);
      case 'intervention': return window.openIntervention?.(id, clientId);
      case 'inspection': view = 'inspections'; render(); return window.openInspection(id);
      case 'quote': view = 'quotes'; render(); return window.openQuote(id);
      case 'document': view = 'documentsView'; render(); return window.openCompanyDocument?.(id);
      case 'site': view = office ? 'sites' : 'worker'; render(); return office ? window.openSite(id) : window.openReport(id);
      case 'team': view = 'teamsView'; render(); return window.openTeam(id);
      case 'drone': view = 'drone'; render(); return window.openDrone(id);
      case 'lifeline': view = 'lifeline'; render(); return window.openLifeline(id);
      case 'roof': view = office ? 'roofs' : 'worker'; render(); return office ? window.openRoof(id) : window.updateRoofTask(id);
      case 'drain': view = office ? 'drains' : 'worker'; render(); return office ? window.openDrain(id) : window.updateDrainTask(id);
      case 'danea': view = 'daneaRequestsView'; render(); return window.openDaneaRequest?.(id);
      default: return go(office ? 'dashboard' : 'worker');
    }
  };

  window.openSearchResultFromElement = function (element) {
    const data = element?.closest?.('.searchResultRow')?.dataset || element?.dataset || {};
    return openSearchResult(data.action || '', data.id || '', data.clientId || '', data.interventionId || '');
  };

  function attachmentItem(action, id) {
    const collections = { lifeline: 'lifelines', roof: 'roofs', drain: 'drains' };
    return (db[collections[action]] || []).find((item) => String(item.id) === String(id));
  }

  window.openSearchAttachments = function (action, id) {
    const item = attachmentItem(action, id);
    if (!item) return alert('Elemento non più disponibile.');
    const adders = { lifeline: 'addLifelineFiles', roof: 'addRoofFiles', drain: 'addDrainFiles' };
    const files = item.files || [];
    const content = document.getElementById('modalContent');
    const dialog = document.getElementById('modal');
    if (!content || !dialog) return;
    content.innerHTML = `<div class="modalHead"><div><h3>Foto e documenti</h3><small>${esc(item.client || '')} · ${esc(item.name || item.type || '')}</small></div><button class="close" type="button" onclick="closeModal()">×</button></div><div class="modalBody"><div class="actions" style="margin-bottom:14px"><button class="btn lime" type="button" onclick="closeModal();${adders[action]}('${esc(id)}')">＋ Aggiungi foto/documenti</button></div><div class="list">${files.map((file) => `<button class="row" type="button" onclick="openStoredFile('${esc(file.key)}')"><span class="rowIcon">${String(file.type || '').startsWith('image/') ? '📷' : '📄'}</span><span class="rowBody"><b>${esc(file.name || 'Allegato')}</b><small>${esc(file.type || '')}</small></span></button>`).join('') || '<div class="empty">Nessuna foto o documento caricato.</div>'}</div></div><div class="modalFoot"><button class="btn light" type="button" onclick="closeModal()">Chiudi</button></div>`;
    dialog.showModal();
  };

  function deleteSearchResult(action, id) {
    const targets = {
      client: ['condomini', 'questo cliente'],
      intervention: ['interventions', 'questo intervento'],
      inspection: ['inspections', 'questo sopralluogo'],
      quote: ['quotes', 'questo preventivo'],
      document: ['documents', 'questo documento'],
      site: ['sites', 'questo cantiere'],
      drone: ['drone', 'questa videoispezione'],
      lifeline: ['lifelines', 'questa linea vita'],
      roof: ['roofs', 'questo intervento'],
      drain: ['drains', 'questo intervento'],
      danea: ['leads', 'questa richiesta Danea']
    };
    if (action === 'team') return deleteTeam(id);
    const target = targets[action];
    if (target) return deleteItem(target[0], id, target[1]);
  }

  window.runSearchResultAction = function (element, command) {
    const data = element?.closest?.('.searchResultRow')?.dataset || {};
    const action = data.action || '', id = data.id || '';
    if (command === 'open') return openSearchResult(action, id, data.clientId || '', data.interventionId || '');
    if (command === 'delete') return deleteSearchResult(action, id);
    if (command === 'calendar') return downloadInspectionCalendar(id);
    if (command === 'pdf') {
      const quote = (db.quotes || []).find((item) => String(item.id) === String(id));
      return quote?.storagePath || quote?.pdfKey ? openQuotePdf(id) : printQuote(id);
    }
    if (command === 'file') return window.openBusinessDocument?.(id);
    if (command === 'photo') {
      if (action === 'site') return window.openQuickPhotoAlbums?.(id) || window.openQuickPhotoUpload?.(id);
      if (action === 'quote') return window.manageQuoteMedia?.(id);
      if (action === 'drone') return window.manageDroneMedia?.(id);
      if (['lifeline', 'roof', 'drain'].includes(action)) return window.openSearchAttachments(action, id);
      return openSearchResult(action, id, data.clientId || '', data.interventionId || '');
    }
    if (command === 'update') return action === 'roof' ? window.updateRoofTask(id) : window.updateDrainTask(id);
    if (command === 'external') return window.openDaneaLink?.(id);
    if (command === 'convert') return window.convertDaneaRequest?.(id);
    if (command === 'edit') {
      const editors = {
        client: 'openCondo', intervention: 'openIntervention', inspection: 'openInspection', quote: 'openQuote',
        document: 'openCompanyDocument', site: 'openSite', team: 'openTeam', drone: 'openDrone',
        lifeline: 'openLifeline', roof: 'openRoof', drain: 'openDrain', danea: 'openDaneaRequest'
      };
      const editor = window[editors[action]];
      return action === 'intervention' ? editor?.(id, data.clientId || '') : editor?.(id);
    }
  };

  function actionButton(command, label, color = 'light') {
    return `<button type="button" class="btn sm ${color}" onclick="runSearchResultAction(this,'${command}')">${label}</button>`;
  }

  function resultActions(row) {
    const edit = actionButton('edit', 'Modifica');
    const remove = isOffice() ? actionButton('delete', 'Elimina', 'red') : '';
    switch (row.action) {
      case 'client': return actionButton('open', 'Apri tutto', 'green') + edit + remove;
      case 'intervention': return actionButton('open', 'Apri tutto', 'green') + actionButton('photo', '📷 Foto/Documenti') + edit + remove;
      case 'inspection': return actionButton('calendar', '📅 Calendario', 'green') + edit + remove;
      case 'quote': return actionButton('pdf', row.item.storagePath || row.item.pdfKey ? 'Apri PDF' : 'Genera PDF', 'green') + actionButton('photo', `📷 Foto/Video${row.mediaCount ? ` (${row.mediaCount})` : ''}`) + edit + remove;
      case 'document': return actionButton('file', 'Apri', 'green') + edit + remove;
      case 'site': return actionButton('photo', `📷 Foto${row.mediaCount ? ` (${row.mediaCount})` : ''}`, 'green') + edit + remove;
      case 'team': return edit + remove;
      case 'drone': return actionButton('photo', `🎬 Video/Foto${row.mediaCount ? ` (${row.mediaCount})` : ''}`, 'green') + edit + remove;
      case 'lifeline': return actionButton('photo', `📷 Foto/Documenti${row.mediaCount ? ` (${row.mediaCount})` : ''}`, 'green') + edit + remove;
      case 'roof': return actionButton('photo', `📷 Foto/Documenti${row.mediaCount ? ` (${row.mediaCount})` : ''}`, 'green') + actionButton('update', 'Aggiorna') + edit + remove;
      case 'drain': return actionButton('photo', `📷 Foto/Documenti${row.mediaCount ? ` (${row.mediaCount})` : ''}`, 'green') + actionButton('update', 'Aggiorna') + edit + remove;
      case 'danea': return (row.item.sourceUrl ? actionButton('external', 'Apri in Danea', 'green') : '') + actionButton('convert', 'Crea sopralluogo') + edit + remove;
      default: return actionButton('open', 'Apri', 'green');
    }
  }

  function resultRow(row) {
    return `<section class="row searchResultRow" data-action="${esc(row.action)}" data-id="${esc(row.id)}" data-client-id="${esc(row.clientId || '')}" data-intervention-id="${esc(row.interventionId || '')}"><span class="rowIcon">${row.icon}</span><span class="rowBody"><span class="pill blue">${esc(row.type)}</span><b style="margin-top:5px">${esc(row.title)}</b><small>${esc(row.meta)}</small></span><span class="searchResultActions">${resultActions(row)}</span></section>`;
  }

  function buildSearchResults() {
    const query = searchQuery.toLocaleLowerCase('it');
    const rows = [];
    const add = (items, config) => (items || [])
      .filter((item) => JSON.stringify(item).toLocaleLowerCase('it').includes(query))
      .forEach((item) => {
        const client = config.client ? config.client(item) : clientFor(item);
        rows.push({
          type: config.type,
          icon: config.icon,
          action: config.action,
          id: item.id,
          clientId: client?.id || '',
          interventionId: config.interventionId ? config.interventionId(item) : (item.interventionId || ''),
          title: config.title(item),
          meta: config.meta(item),
          item,
          mediaCount: config.mediaCount ? config.mediaCount(item) : ((item.media || item.files || []).length || 0)
        });
      });

    if (isOffice()) {
      add(db.condomini, { type: 'Cliente', icon: '🏢', action: 'client', client: (item) => item, title: (item) => item.name, meta: (item) => `${item.address || ''} · ${item.manager || ''}` });
      add(db.interventions, { type: 'Intervento', icon: '🛠️', action: 'intervention', interventionId: (item) => item.id, title: (item) => `${item.title} · ${item.client}`, meta: (item) => `${item.date || ''} · ${item.status || ''}` });
      add(db.inspections, { type: 'Sopralluogo', icon: '📅', action: 'inspection', title: (item) => item.client, meta: (item) => `${item.date || ''} · ${item.type || ''} · ${item.address || ''}` });
      add(db.quotes, { type: 'Preventivo', icon: '📄', action: 'quote', title: (item) => `${item.code || 'Preventivo'} · ${item.client || ''}`, meta: (item) => `${item.subject || ''} · ${item.status || ''}` });
      add(db.documents, { type: 'Documento', icon: '📁', action: 'document', title: (item) => item.title || item.fileName || 'Documento', meta: (item) => `${item.client || ''} · ${item.category || ''} · ${item.fileName || ''}` });
      add(db.sites, { type: 'Cantiere', icon: '🏗️', action: 'site', title: (item) => item.title, meta: (item) => `${item.client || ''} · ${item.address || ''}`, mediaCount: (item) => (db.reports || []).filter((report) => report.photoOnly === true && String(report.site || report.siteId) === String(item.id)).reduce((total, report) => total + Number(report.photoCount || report.photos?.length || 0), 0) });
      add(WORKERS, { type: 'Squadra', icon: '👥', action: 'team', client: () => null, title: (item) => item.name, meta: (item) => `${item.member1 || ''} · ${item.member2 || ''}` });
      add(db.drone, { type: 'Drone', icon: '🚁', action: 'drone', title: (item) => item.client, meta: (item) => `${item.date || ''} · ${item.area || ''}` });
      add(db.lifelines, { type: 'Linea vita', icon: '⚓', action: 'lifeline', title: (item) => `${item.name || 'Linea vita'} · ${item.client || ''}`, meta: (item) => item.address || '' });
      add(db.roofs, { type: 'Tetti e gronde', icon: '🏠', action: 'roof', title: (item) => `${item.type || ''} · ${item.client || ''}`, meta: (item) => `${item.date || ''} · ${item.address || ''}` });
      add(db.drains, { type: 'Pozzetti e tombini', icon: '🕳️', action: 'drain', title: (item) => `${item.type || ''} · ${item.client || ''}`, meta: (item) => `${item.area || ''} · ${item.address || ''}` });
      add((db.leads || []).filter((item) => item.source === 'Danea Interventi'), { type: 'Richiesta Danea', icon: '🔧', action: 'danea', title: (item) => item.title || 'Richiesta di intervento', meta: (item) => `${item.client || item.name || ''} · ${item.studio || ''} · ${item.status || ''}` });
    } else {
      const teamId = currentTeamId();
      add((db.sites || []).filter((item) => item.worker === teamId), { type: 'Cantiere', icon: '🏗️', action: 'site', title: (item) => item.title, meta: (item) => `${item.client || ''} · ${item.address || ''}`, mediaCount: (item) => (db.reports || []).filter((report) => report.photoOnly === true && String(report.site || report.siteId) === String(item.id)).reduce((total, report) => total + Number(report.photoCount || report.photos?.length || 0), 0) });
      add((db.roofs || []).filter((item) => item.worker === teamId), { type: 'Tetti e gronde', icon: '🏠', action: 'roof', title: (item) => item.type, meta: (item) => `${item.client || ''} · ${item.address || ''}` });
      add((db.drains || []).filter((item) => item.worker === teamId), { type: 'Pozzetti e tombini', icon: '🕳️', action: 'drain', title: (item) => item.type, meta: (item) => `${item.client || ''} · ${item.address || ''}` });
    }

    return rows;
  }

  searchResults = function () {
    const rows = buildSearchResults();
    const subtitle = `${rows.length} risultati per “${esc(searchQuery)}” · Foto, modifica, elimina e gli altri comandi sono disponibili qui`;
    const empty = isOffice()
      ? 'Nessun risultato. Prova con cliente, indirizzo, intervento, preventivo o documento.'
      : 'Nessun incarico trovato nella tua squadra.';
    return pageHead('Risultati della ricerca', subtitle) + `<div class="card"><div class="list">${rows.map(resultRow).join('') || `<div class="empty">${empty}</div>`}</div></div>`;
  };
})();
