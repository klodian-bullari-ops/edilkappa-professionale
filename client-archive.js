(function () {
  'use strict';

  db.interventions = db.interventions || [];

  let selectedClientId = '';
  let archiveContext = null;

  const style = document.createElement('style');
  style.textContent = `
    .clientArchiveHero{background:linear-gradient(135deg,#111,#262b2f);color:#fff;border-radius:24px;padding:24px;margin-bottom:18px;border-bottom:6px solid var(--lime)}
    .clientArchiveHero h2{margin:10px 0 5px;font-size:30px}.clientArchiveHero p{margin:3px 0;color:#d8dcdf}.clientArchiveHero .pill{margin-right:7px}
    .archiveIntervention{border-left:6px solid var(--green)}.archiveIntervention.unassigned{border-left-color:#d69b18}
    .archiveGroup{margin-top:16px}.archiveGroup h4{margin:0 0 9px;font-size:14px;color:#475048}.archiveFiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:9px}
    .archiveFile{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:14px;padding:12px;background:#fafaf7}
    .archiveFileIcon{width:39px;height:39px;display:grid;place-items:center;border-radius:11px;background:#fff;font-size:19px;flex:none}
    .archiveFileBody{min-width:0;flex:1}.archiveFileBody b,.archiveFileBody small{display:block}.archiveFileBody b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.archiveFileBody small{color:var(--muted);margin-top:3px}
    .archiveOperations{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:10px}.archiveOperation{border:1px solid var(--line);border-radius:14px;padding:13px;background:#f7faf7}.archiveOperation b,.archiveOperation small{display:block}.archiveOperation small{color:var(--muted);margin-top:4px;line-height:1.45}
    .archiveWorkers{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:9px}.archiveWorker{display:flex;justify-content:space-between;gap:10px;border:1px solid var(--line);border-radius:12px;padding:11px;background:#fff}.archiveWorker strong{color:var(--green)}
    .archiveTimeline{position:relative;margin-left:8px;padding-left:21px;border-left:3px solid #dce6dc}.archiveTimelineItem{position:relative;padding:0 0 15px}.archiveTimelineItem:last-child{padding-bottom:0}.archiveTimelineItem:before{content:'';position:absolute;width:11px;height:11px;border-radius:50%;background:var(--green);left:-28px;top:4px;border:3px solid #fff;box-shadow:0 0 0 1px #cbd7cb}.archiveTimelineItem b,.archiveTimelineItem small{display:block}.archiveTimelineItem small{color:var(--muted);margin-top:3px;line-height:1.4}
    .clientNameButton{border:0;background:transparent;padding:0;color:var(--green);font-weight:850;text-align:left}
    .archiveFocus{outline:4px solid rgba(244,196,0,.55);box-shadow:0 0 0 8px rgba(244,196,0,.16),var(--shadow);transition:outline-color .25s,box-shadow .25s}
    @media(max-width:620px){.clientArchiveHero h2{font-size:25px}.archiveFiles{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  function clientById(clientId) {
    return (db.condomini || []).find((item) => item.id === clientId);
  }

  function clientByName(name) {
    return (db.condomini || []).find((item) => item.name === name);
  }

  function interventionsForClient(clientOrName) {
    const client = typeof clientOrName === 'string'
      ? clientById(clientOrName) || clientByName(clientOrName)
      : clientOrName;
    if (!client) return [];
    return (db.interventions || [])
      .filter((item) => item.clientId === client.id || (!item.clientId && item.client === client.name))
      .sort((left, right) => String(right.date || right.createdAt || '').localeCompare(String(left.date || left.createdAt || '')));
  }

  function interventionSelectOptions(clientName, selected = '') {
    const rows = interventionsForClient(clientName);
    return `<option value="">Archivio precedente / da assegnare</option>${rows.map((item) =>
      `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.title)} · ${esc(item.date || 'data da definire')}</option>`
    ).join('')}`;
  }

  function applyContext(item, id) {
    if (id || !archiveContext) return item;
    item.client = archiveContext.client || item.client || '';
    item.interventionId = archiveContext.interventionId || item.interventionId || '';
    return item;
  }

  function clearContextSoon() {
    setTimeout(() => { archiveContext = null; }, 0);
  }

  window.getArchiveContext = function () {
    return archiveContext ? { ...archiveContext } : {};
  };

  window.clearArchiveContext = function () {
    archiveContext = null;
  };

  window.interventionOptions = function (clientName, selected = '') {
    return interventionSelectOptions(clientName, selected);
  };

  window.refreshInterventionSelect = function (form) {
    const clientName = form?.querySelector('[name="client"]')?.value || '';
    const select = form?.querySelector('[name="interventionId"]');
    if (select) select.innerHTML = interventionSelectOptions(clientName, '');
  };

  window.prepareArchiveItem = function (item, id) {
    const prepared = applyContext(item, id);
    clearContextSoon();
    return prepared;
  };

  function revealArchiveFocus(focus) {
    if (!focus) return;
    const target = document.getElementById(focus.itemId ? `archive-item-${focus.itemId}` : `intervention-${focus.interventionId}`);
    if (!target) return;
    target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    target.classList?.add?.('archiveFocus');
    setTimeout(() => target.classList?.remove?.('archiveFocus'), 2600);
  }

  window.openClientArchive = function (clientId, focus = null) {
    selectedClientId = clientId;
    view = 'clientArchive';
    render();
    if (focus?.interventionId || focus?.itemId) setTimeout(() => revealArchiveFocus(focus), 60);
  };

  window.openIntervention = function (id, clientId = selectedClientId) {
    const client = clientById(clientId);
    if (!client) return alert('Cliente o condominio non trovato.');
    const item = (db.interventions || []).find((entry) => entry.id === id) || {
      id: uid('int'),
      clientId: client.id,
      client: client.name,
      title: '',
      category: 'Manutenzione',
      date: localToday(),
      status: 'Pianificato',
      notes: ''
    };
    modal(id ? 'Modifica intervento' : 'Nuovo intervento', `<div class="notice"><b>${esc(client.name)}</b><br>${esc(client.address || '')}</div><div style="height:14px"></div><div class="formGrid">
      ${field('Titolo intervento', 'title', 'text', item.title, true)}
      <div class="field"><label>Tipologia</label><select name="category">${selectOptions(['Sopralluogo', 'Manutenzione', 'Copertura e tetto', 'Infiltrazione', 'Facciata', 'Interni', 'Linea vita', 'Altro'], item.category)}</select></div>
      ${field('Data apertura', 'date', 'date', item.date)}
      <div class="field"><label>Stato</label><select name="status">${selectOptions(['Pianificato', 'In corso', 'In attesa', 'Completato', 'Sospeso'], item.status)}</select></div>
      <div class="field full"><label>Descrizione / note</label><textarea name="notes" placeholder="Problema segnalato, lavorazioni previste, riferimenti...">${esc(item.notes || '')}</textarea></div>
    </div>`, (formData) => {
      const data = {
        clientId: client.id,
        client: client.name,
        title: formData.get('title'),
        category: formData.get('category'),
        date: formData.get('date'),
        status: formData.get('status'),
        notes: formData.get('notes'),
        updatedAt: new Date().toISOString()
      };
      if (id) Object.assign(item, data);
      else db.interventions.push({ ...item, ...data, createdAt: new Date().toISOString() });
    });
  };

  function openWithContext(clientId, interventionId, opener) {
    const client = clientById(clientId);
    if (!client) return alert('Cliente o condominio non trovato.');
    archiveContext = { clientId: client.id, client: client.name, interventionId };
    opener();
  }

  window.openQuoteForIntervention = function (clientId, interventionId) {
    openWithContext(clientId, interventionId, () => openPdfUpload());
  };

  window.openDocumentForIntervention = function (clientId, interventionId) {
    openWithContext(clientId, interventionId, () => openCompanyDocument());
  };

  window.assignArchiveItem = function (collectionName, itemId) {
    const item = (db[collectionName] || []).find((entry) => entry.id === itemId);
    if (!item) return;
    const client = clientByName(item.client) || clientById(item.clientId);
    if (!client) return alert('Prima collega il documento a un cliente o condominio valido.');
    modal('Assegna a un intervento', `<div class="notice"><b>${esc(item.subject || item.title || item.area || item.fileName || 'Elemento')}</b><br>${esc(client.name)}</div><div style="height:14px"></div>
      <div class="field"><label>Intervento</label><select name="interventionId" required><option value="">Seleziona…</option>${interventionSelectOptions(client.name, item.interventionId).replace('<option value="">Archivio precedente / da assegnare</option>', '')}</select></div>`,
    (formData) => {
      item.interventionId = formData.get('interventionId');
      item.clientId = client.id;
      item.updatedAt = new Date().toISOString();
    });
  };

  function rowsFor(client, interventionId) {
    const belongs = (item) => item.clientId === client.id || item.client === client.name;
    const linked = (item) => (item.interventionId || '') === (interventionId || '');
    const sites = (db.sites || []).filter((item) => belongs(item) && linked(item));
    const siteIds = new Set(sites.map((item) => String(item.id)));
    const matchesSiteJob = (entry) => sites.some((site) => {
      const job = String(entry.job || '').trim().toLocaleLowerCase('it');
      return job === String(site.title || '').trim().toLocaleLowerCase('it') ||
        job === `${String(site.title || '').trim()} · ${String(site.client || '').trim()}`.toLocaleLowerCase('it');
    });
    return {
      quotes: (db.quotes || []).filter((item) => belongs(item) && linked(item)),
      documents: (db.documents || []).filter((item) => belongs(item) && linked(item)),
      drone: (db.drone || []).filter((item) => belongs(item) && linked(item)),
      sites,
      inspections: (db.inspections || []).filter((item) => belongs(item) && linked(item)),
      reports: (db.reports || []).filter((item) => linked(item) || siteIds.has(String(item.siteId || item.site || ''))),
      timesheets: (db.timesheets || []).filter((item) => linked(item) || siteIds.has(String(item.siteId || '')) || matchesSiteJob(item))
    };
  }

  function teamName(teamId) {
    return (db.teams || []).find((item) => item.id === teamId)?.name ||
      (typeof WORKERS !== 'undefined' ? WORKERS.find((item) => item.id === teamId)?.name : '') || '';
  }

  function photoCount(rows) {
    return rows.reports.reduce((total, item) => total + Math.max(Number(item.photoCount || 0), Array.isArray(item.photos) ? item.photos.length : 0), 0);
  }

  function hourEntries(rows) {
    const entries = [];
    rows.timesheets.forEach((item) => {
      if (item.worker || item.workerName) {
        entries.push({ name: item.workerName || item.worker || 'Operaio', team: item.teamName || teamName(item.team), hours: Number(item.hours || 0), date: item.date || item.createdAt || '' });
        return;
      }
      if (item.member1) entries.push({ name: item.member1, team: item.teamName || teamName(item.team), hours: Number(item.hours1 || 0), date: item.date || item.createdAt || '' });
      if (item.member2) entries.push({ name: item.member2, team: item.teamName || teamName(item.team), hours: Number(item.hours2 || 0), date: item.date || item.createdAt || '' });
    });
    if (!entries.length) rows.reports.forEach((item) => {
      if (item.workerName || item.worker) entries.push({ name: item.workerName || item.worker, team: teamName(item.worker), hours: Number(item.hours || 0), date: item.workDate || item.date || '' });
    });
    return entries;
  }

  function workersSummary(rows) {
    const grouped = new Map();
    hourEntries(rows).forEach((entry) => {
      const key = `${entry.name}|${entry.team}`;
      const current = grouped.get(key) || { ...entry, hours: 0 };
      current.hours += entry.hours;
      grouped.set(key, current);
    });
    return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name, 'it'));
  }

  function timelineFor(item, rows) {
    const events = [];
    const seen = new Set();
    const add = (event) => {
      const date = String(event.date || '');
      if (!date) return;
      const key = event.id || `${date}|${event.label}|${event.detail || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      events.push({ ...event, date });
    };
    (item.timeline || []).forEach(add);
    add({ id: `opened-${item.id}`, date: item.requestReceivedAt || item.createdAt || item.date, label: item.requestId ? 'Richiesta ricevuta' : 'Intervento aperto', detail: item.source || item.category || '' });
    rows.inspections.forEach((inspection) => add({ id: `inspection-${inspection.id}`, date: `${inspection.date || ''}${inspection.time ? `T${inspection.time}` : ''}`, label: 'Sopralluogo', detail: `${inspection.status || 'Da programmare'}${inspection.problem ? ` · ${inspection.problem}` : ''}` }));
    rows.quotes.forEach((quote) => add({ id: `quote-${quote.id}`, date: quote.date || quote.createdAt, label: `Preventivo ${quote.code || ''}`.trim(), detail: `${quote.status || 'Bozza'}${quote.subject ? ` · ${quote.subject}` : ''}` }));
    rows.sites.forEach((site) => {
      add({ id: `site-start-${site.id}`, date: site.start || site.createdAt, label: 'Inizio cantiere', detail: `${site.title || 'Cantiere'}${teamName(site.worker) ? ` · ${teamName(site.worker)}` : ''}` });
      if (site.end || site.status === 'Completato') add({ id: `site-end-${site.id}`, date: site.end || site.updatedAt, label: 'Fine cantiere', detail: site.title || 'Cantiere completato' });
    });
    rows.reports.forEach((report) => {
      const photos = Math.max(Number(report.photoCount || 0), Array.isArray(report.photos) ? report.photos.length : 0);
      add({ id: `report-${report.id}`, date: report.workDate || report.date || report.createdAt, label: report.photoOnly ? 'Foto cantiere caricate' : 'Rapportino di lavoro', detail: [report.workerName, Number(report.hours || 0) ? `${Number(report.hours).toFixed(1)} ore` : '', photos ? `${photos} foto` : ''].filter(Boolean).join(' · ') });
    });
    hourEntries(rows).forEach((entry, index) => add({ id: `hours-${entry.date}-${entry.name}-${index}`, date: entry.date, label: 'Ore lavorate', detail: `${entry.name} · ${entry.hours.toFixed(1)} ore${entry.team ? ` · ${entry.team}` : ''}` }));
    if (item.completedAt) add({ id: `completed-${item.id}`, date: item.completedAt, label: 'Intervento concluso', detail: item.title || '' });
    return events.sort((left, right) => left.date.localeCompare(right.date));
  }

  function operationalGroups(item, rows) {
    const sites = rows.sites.map((site) => {
      const count = rows.reports.filter((report) => String(report.siteId || report.site || '') === String(site.id)).reduce((total, report) => total + Math.max(Number(report.photoCount || 0), Array.isArray(report.photos) ? report.photos.length : 0), 0);
      return `<div class="archiveOperation"><b>🏗️ ${esc(site.title || 'Cantiere')}</b><small>${esc(site.address || '')}<br>${esc(site.status || 'Pianificato')} · avanzamento ${Number(site.progress || 0)}%${teamName(site.worker) ? ` · ${esc(teamName(site.worker))}` : ''}</small><div class="actions" style="margin-top:9px"><button class="btn sm green" onclick="openSite('${site.id}')">Modifica cantiere</button><button class="btn sm light" onclick="openQuickPhotoAlbums('${site.id}')">📷 Foto (${count})</button></div></div>`;
    }).join('');
    const inspections = rows.inspections.map((inspection) => `<div class="archiveOperation"><b>📅 Sopralluogo</b><small>${esc(inspection.date || 'Da programmare')}${inspection.time ? ` · ${esc(inspection.time)}` : ''}<br>${esc(inspection.status || '')}${inspection.problem ? ` · ${esc(inspection.problem)}` : ''}</small></div>`).join('');
    const workers = workersSummary(rows);
    const timeline = timelineFor(item, rows);
    return `${sites || inspections ? `<div class="archiveGroup"><h4>Cantiere e sopralluoghi</h4><div class="archiveOperations">${sites}${inspections}</div></div>` : ''}
      <div class="archiveGroup"><h4>Operai e ore</h4>${workers.length ? `<div class="archiveWorkers">${workers.map((worker) => `<div class="archiveWorker"><span><b>${esc(worker.name)}</b><small>${esc(worker.team || 'Squadra da definire')}</small></span><strong>${worker.hours.toFixed(1)} ore</strong></div>`).join('')}</div>` : '<div class="empty">Nessuna ora ancora registrata per questo intervento.</div>'}</div>
      <div class="archiveGroup"><h4>Foto cantiere</h4><div class="notice"><b>${photoCount(rows)} fotografie collegate</b><br>Le foto dei rapportini e della galleria restano archiviate in questo intervento.</div></div>
      <div class="archiveGroup"><h4>Cronologia intervento</h4>${timeline.length ? `<div class="archiveTimeline">${timeline.map((event) => `<div class="archiveTimelineItem"><b>${esc(event.label)}</b><small>${esc(event.date.slice(0, 16).replace('T', ' '))}${event.actor ? ` · ${esc(event.actor)}` : ''}${event.detail ? `<br>${esc(event.detail)}` : ''}</small></div>`).join('')}</div>` : '<div class="empty">La cronologia inizierà con la prima attività.</div>'}</div>`;
  }

  function archiveItem(kind, item, unassigned) {
    if (kind === 'quote') {
      const mediaCount = Array.isArray(item.media) ? item.media.length : 0;
      return `<div class="archiveFile" id="archive-item-${esc(item.id)}"><div class="archiveFileIcon">📄</div><div class="archiveFileBody"><b>${esc(item.code || 'Preventivo')}</b><small>${esc(item.subject || item.fileName || '')}<br>${esc(item.date || '')} · ${esc(item.status || 'Bozza')}${mediaCount ? ` · ${mediaCount} foto/video` : ''}</small><div class="actions" style="margin-top:9px">${item.storagePath || item.pdfKey ? `<button class="btn sm green" onclick="openQuotePdf('${item.id}')">Apri</button>` : ''}<button class="btn sm light" onclick="manageQuoteMedia('${item.id}')">Foto/Video</button>${unassigned ? `<button class="btn sm light" onclick="assignArchiveItem('quotes','${item.id}')">Assegna</button>` : ''}</div></div></div>`;
    }
    if (kind === 'document') {
      const type = String(item.fileType || '');
      const icon = type.startsWith('video/') ? '🎬' : type.startsWith('image/') ? '🖼️' : '📁';
      return `<div class="archiveFile" id="archive-item-${esc(item.id)}"><div class="archiveFileIcon">${icon}</div><div class="archiveFileBody"><b>${esc(item.title || item.fileName || 'Documento')}</b><small>${esc(item.category || 'Documento')}<br>${esc(item.fileName || '')}</small><div class="actions" style="margin-top:9px"><button class="btn sm green" onclick="openBusinessDocument('${item.id}')">Apri</button>${unassigned ? `<button class="btn sm light" onclick="assignArchiveItem('documents','${item.id}')">Assegna</button>` : ''}</div></div></div>`;
    }
    const mediaCount = Array.isArray(item.media) ? item.media.length : 0;
    return `<div class="archiveFile" id="archive-item-${esc(item.id)}"><div class="archiveFileIcon">🚁</div><div class="archiveFileBody"><b>${esc(item.area || 'Videoispezione drone')}</b><small>${esc(item.date || '')} · ${esc(item.status || '')}<br>${mediaCount} foto/video</small><div class="actions" style="margin-top:9px"><button class="btn sm green" onclick="manageDroneMedia('${item.id}')">Apri media</button>${unassigned ? `<button class="btn sm light" onclick="assignArchiveItem('drone','${item.id}')">Assegna</button>` : ''}</div></div></div>`;
  }

  function groupedFiles(rows, unassigned = false) {
    const quoteRows = rows.quotes.map((item) => archiveItem('quote', item, unassigned)).join('');
    const documentRows = rows.documents.map((item) => archiveItem('document', item, unassigned)).join('');
    const droneRows = rows.drone.map((item) => archiveItem('drone', item, unassigned)).join('');
    return `${quoteRows ? `<div class="archiveGroup"><h4>Preventivi</h4><div class="archiveFiles">${quoteRows}</div></div>` : ''}
      ${documentRows ? `<div class="archiveGroup"><h4>Documenti, relazioni, foto e video</h4><div class="archiveFiles">${documentRows}</div></div>` : ''}
      ${droneRows ? `<div class="archiveGroup"><h4>Videoispezioni drone</h4><div class="archiveFiles">${droneRows}</div></div>` : ''}
      ${!quoteRows && !documentRows && !droneRows ? '<div class="empty">Nessun file in questo intervento.</div>' : ''}`;
  }

  function interventionCard(client, item) {
    const rows = rowsFor(client, item.id);
    const total = rows.quotes.length + rows.documents.length + rows.drone.length + rows.sites.length + rows.inspections.length + rows.reports.length + rows.timesheets.length;
    return `<section class="card archiveIntervention" id="intervention-${esc(item.id)}"><div class="cardHead"><div><span class="pill blue">${esc(item.category || 'Intervento')}</span><h3 style="margin:9px 0 3px">${esc(item.title)}</h3><small>${esc(item.date || 'Data da definire')} · ${total} element${total === 1 ? 'o' : 'i'}</small></div>${badge(item.status || 'Pianificato')}</div>
      ${item.notes ? `<p class="company">${esc(item.notes)}</p>` : ''}
      <div class="actions"><button class="btn sm lime" onclick="openSiteForIntervention('${client.id}','${item.id}')">＋ Cantiere</button><button class="btn sm lime" onclick="openQuoteForIntervention('${client.id}','${item.id}')">＋ Preventivo PDF</button><button class="btn sm green" onclick="openDocumentForIntervention('${client.id}','${item.id}')">＋ Documento / Foto / Video</button><button class="btn sm light" onclick="openIntervention('${item.id}','${client.id}')">Modifica intervento</button></div>
      ${operationalGroups(item, rows)}
      ${groupedFiles(rows)}
    </section>`;
  }

  window.clientArchive = function () {
    const client = clientById(selectedClientId);
    if (!client) return '<div class="empty">Seleziona un cliente o condominio.</div>';
    const interventions = interventionsForClient(client);
    const unassigned = rowsFor(client, '');
    const unassignedCount = unassigned.quotes.length + unassigned.documents.length + unassigned.drone.length;
    const allRows = [...(db.quotes || []), ...(db.documents || []), ...(db.drone || [])].filter((item) => item.clientId === client.id || item.client === client.name);
    const clientSites = (db.sites || []).filter((item) => item.clientId === client.id || item.client === client.name);
    const clientSiteIds = new Set(clientSites.map((item) => String(item.id)));
    const clientReports = (db.reports || []).filter((item) => item.clientId === client.id || item.client === client.name || clientSiteIds.has(String(item.siteId || item.site || '')));
    const mediaCount = allRows.reduce((sum, item) => sum + (Array.isArray(item.media) ? item.media.length : 0) + ((String(item.fileType || '').startsWith('image/') || String(item.fileType || '').startsWith('video/')) ? 1 : 0), 0);
    return `<div class="clientArchiveHero"><button class="btn light sm" onclick="go('condomini')">← Tutti i clienti</button><h2>${esc(client.name)}</h2><p>${esc(client.address || 'Indirizzo da definire')}</p><p>${client.manager ? `Amministratore: ${esc(client.manager)}` : 'Amministratore da definire'}${client.phone ? ` · ${esc(client.phone)}` : ''}</p></div>
      <div class="headline"><div><h2>Scheda interventi</h2><p>Ogni lavoro riunisce cantiere, preventivi, foto, cronologia, operai e ore.</p></div><div class="actions"><button class="btn light" onclick="openCondo('${client.id}')">Modifica cliente</button><button class="btn lime" onclick="openIntervention('', '${client.id}')">＋ Nuovo intervento</button></div></div>
      <div class="grid stats">${stat('Interventi', interventions.length, '▤')}${stat('Cantieri', clientSites.length, '🏗️')}${stat('Preventivi', (db.quotes || []).filter((item) => item.clientId === client.id || item.client === client.name).length, '📄')}${stat('Foto e video', mediaCount + clientReports.reduce((sum, item) => sum + Math.max(Number(item.photoCount || 0), Array.isArray(item.photos) ? item.photos.length : 0), 0), '🎬')}</div>
      <div class="list">${interventions.map((item) => interventionCard(client, item)).join('') || '<div class="empty">Nessun intervento ancora creato. Premi “Nuovo intervento” per iniziare la schedatura.</div>'}
      ${unassignedCount ? `<section class="card archiveIntervention unassigned"><div class="cardHead"><div><span class="pill orange">Archivio precedente</span><h3 style="margin:9px 0 3px">Elementi da assegnare</h3><small>${unassignedCount} file già presenti nel gestionale</small></div></div><div class="notice">Questi file restano al sicuro e visibili nella scheda del cliente. Usa “Assegna” per inserirli nel relativo intervento.</div>${groupedFiles(unassigned, true)}</section>` : ''}</div>`;
  };

  const baseCondomini = condomini;
  condomini = function () {
    if (!isOffice()) return baseCondomini();
    return pageHead('Condomìni e clienti', 'Apri una scheda per vedere interventi, preventivi, documenti, foto e video', '<button class="btn lime" onclick="openCondo()">＋ Nuovo</button>') +
      `<div class="card"><div class="tableWrap"><table class="table"><thead><tr><th>Cliente</th><th>Indirizzo</th><th>Amministratore</th><th>Telefono</th><th>Interventi</th><th></th></tr></thead><tbody>${(db.condomini || []).map((client) => {
        const linked = interventionsForClient(client).length;
        return `<tr><td><button class="clientNameButton" onclick="openClientArchive('${client.id}')">${esc(client.name)}</button></td><td>${esc(client.address || '')}</td><td>${esc(client.manager || '')}</td><td>${esc(client.phone || '')}</td><td>${linked}</td><td><div class="actions"><button class="btn sm green" onclick="openClientArchive('${client.id}')">Apri scheda</button><button class="btn sm light" onclick="openCondo('${client.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('condomini','${client.id}','questo cliente')">Elimina</button></div></td></tr>`;
      }).join('') || '<tr><td colspan="6">Nessun cliente registrato.</td></tr>'}</tbody></table></div></div>`;
  };

  const baseRenameClient = renameClient;
  renameClient = function (oldName, newName) {
    baseRenameClient(oldName, newName);
    ['interventions', 'documents'].forEach((collectionName) => (db[collectionName] || []).forEach((item) => {
      if (item.client === oldName) item.client = newName;
    }));
  };

  const baseRender = render;
  render = function () {
    if (view === 'clientArchive') {
      if (!isOffice()) view = 'worker';
      else {
        renderNav();
        document.getElementById('avatar').textContent = roleName().charAt(0);
        document.getElementById('pageTitle').textContent = 'Scheda cliente';
        document.getElementById('app').innerHTML = window.clientArchive();
        return;
      }
    }
    baseRender();
  };

  save();
  render();
})();
