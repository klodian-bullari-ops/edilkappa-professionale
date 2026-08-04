(function () {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    .searchResultRow{width:100%;appearance:none;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:transform .15s,border-color .15s,box-shadow .15s}
    .searchResultRow:hover{transform:translateY(-1px);border-color:var(--green);box-shadow:0 8px 22px rgba(17,17,17,.08)}
    .searchResultRow:focus-visible{outline:3px solid rgba(244,196,0,.65);outline-offset:2px}
    .searchResultOpen{width:35px;height:35px;border-radius:11px;background:var(--green);color:#fff;display:grid;place-items:center;font-size:24px;font-weight:850;flex:none}
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
    const data = element?.dataset || {};
    return openSearchResult(data.action || '', data.id || '', data.clientId || '', data.interventionId || '');
  };

  function resultRow(row) {
    const label = `Apri tutti i dettagli di ${row.title}`;
    return `<button type="button" class="row searchResultRow" data-action="${esc(row.action)}" data-id="${esc(row.id)}" data-client-id="${esc(row.clientId || '')}" data-intervention-id="${esc(row.interventionId || '')}" onclick="openSearchResultFromElement(this)" aria-label="${esc(label)}"><span class="rowIcon">${row.icon}</span><span class="rowBody"><span class="pill blue">${esc(row.type)}</span><b style="margin-top:5px">${esc(row.title)}</b><small>${esc(row.meta)}</small></span><span class="searchResultOpen" aria-hidden="true">›</span></button>`;
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
          meta: config.meta(item)
        });
      });

    if (isOffice()) {
      add(db.condomini, { type: 'Cliente', icon: '🏢', action: 'client', client: (item) => item, title: (item) => item.name, meta: (item) => `${item.address || ''} · ${item.manager || ''}` });
      add(db.interventions, { type: 'Intervento', icon: '🛠️', action: 'intervention', interventionId: (item) => item.id, title: (item) => `${item.title} · ${item.client}`, meta: (item) => `${item.date || ''} · ${item.status || ''}` });
      add(db.inspections, { type: 'Sopralluogo', icon: '📅', action: 'inspection', title: (item) => item.client, meta: (item) => `${item.date || ''} · ${item.type || ''} · ${item.address || ''}` });
      add(db.quotes, { type: 'Preventivo', icon: '📄', action: 'quote', title: (item) => `${item.code || 'Preventivo'} · ${item.client || ''}`, meta: (item) => `${item.subject || ''} · ${item.status || ''}` });
      add(db.documents, { type: 'Documento', icon: '📁', action: 'document', title: (item) => item.title || item.fileName || 'Documento', meta: (item) => `${item.client || ''} · ${item.category || ''} · ${item.fileName || ''}` });
      add(db.sites, { type: 'Cantiere', icon: '🏗️', action: 'site', title: (item) => item.title, meta: (item) => `${item.client || ''} · ${item.address || ''}` });
      add(WORKERS, { type: 'Squadra', icon: '👥', action: 'team', client: () => null, title: (item) => item.name, meta: (item) => `${item.member1 || ''} · ${item.member2 || ''}` });
      add(db.drone, { type: 'Drone', icon: '🚁', action: 'drone', title: (item) => item.client, meta: (item) => `${item.date || ''} · ${item.area || ''}` });
      add(db.lifelines, { type: 'Linea vita', icon: '⚓', action: 'lifeline', title: (item) => `${item.name || 'Linea vita'} · ${item.client || ''}`, meta: (item) => item.address || '' });
      add(db.roofs, { type: 'Tetti e gronde', icon: '🏠', action: 'roof', title: (item) => `${item.type || ''} · ${item.client || ''}`, meta: (item) => `${item.date || ''} · ${item.address || ''}` });
      add(db.drains, { type: 'Pozzetti e tombini', icon: '🕳️', action: 'drain', title: (item) => `${item.type || ''} · ${item.client || ''}`, meta: (item) => `${item.area || ''} · ${item.address || ''}` });
      add((db.leads || []).filter((item) => item.source === 'Danea Interventi'), { type: 'Richiesta Danea', icon: '🔧', action: 'danea', title: (item) => item.title || 'Richiesta di intervento', meta: (item) => `${item.client || item.name || ''} · ${item.studio || ''} · ${item.status || ''}` });
    } else {
      const teamId = currentTeamId();
      add((db.sites || []).filter((item) => item.worker === teamId), { type: 'Cantiere', icon: '🏗️', action: 'site', title: (item) => item.title, meta: (item) => `${item.client || ''} · ${item.address || ''}` });
      add((db.roofs || []).filter((item) => item.worker === teamId), { type: 'Tetti e gronde', icon: '🏠', action: 'roof', title: (item) => item.type, meta: (item) => `${item.client || ''} · ${item.address || ''}` });
      add((db.drains || []).filter((item) => item.worker === teamId), { type: 'Pozzetti e tombini', icon: '🕳️', action: 'drain', title: (item) => item.type, meta: (item) => `${item.client || ''} · ${item.address || ''}` });
    }

    return rows;
  }

  searchResults = function () {
    const rows = buildSearchResults();
    const subtitle = `${rows.length} risultati per “${esc(searchQuery)}” · Tocca un risultato per aprire tutti i dettagli`;
    const empty = isOffice()
      ? 'Nessun risultato. Prova con cliente, indirizzo, intervento, preventivo o documento.'
      : 'Nessun incarico trovato nella tua squadra.';
    return pageHead('Risultati della ricerca', subtitle) + `<div class="card"><div class="list">${rows.map(resultRow).join('') || `<div class="empty">${empty}</div>`}</div></div>`;
  };
})();
