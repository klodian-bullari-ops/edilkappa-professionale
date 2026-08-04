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
    return {
      quotes: (db.quotes || []).filter((item) => belongs(item) && linked(item)),
      documents: (db.documents || []).filter((item) => belongs(item) && linked(item)),
      drone: (db.drone || []).filter((item) => belongs(item) && linked(item))
    };
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
    const total = rows.quotes.length + rows.documents.length + rows.drone.length;
    return `<section class="card archiveIntervention" id="intervention-${esc(item.id)}"><div class="cardHead"><div><span class="pill blue">${esc(item.category || 'Intervento')}</span><h3 style="margin:9px 0 3px">${esc(item.title)}</h3><small>${esc(item.date || 'Data da definire')} · ${total} element${total === 1 ? 'o' : 'i'}</small></div>${badge(item.status || 'Pianificato')}</div>
      ${item.notes ? `<p class="company">${esc(item.notes)}</p>` : ''}
      <div class="actions"><button class="btn sm lime" onclick="openQuoteForIntervention('${client.id}','${item.id}')">＋ Preventivo PDF</button><button class="btn sm green" onclick="openDocumentForIntervention('${client.id}','${item.id}')">＋ Documento / Foto / Video</button><button class="btn sm light" onclick="openIntervention('${item.id}','${client.id}')">Modifica intervento</button></div>
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
    const mediaCount = allRows.reduce((sum, item) => sum + (Array.isArray(item.media) ? item.media.length : 0) + ((String(item.fileType || '').startsWith('image/') || String(item.fileType || '').startsWith('video/')) ? 1 : 0), 0);
    return `<div class="clientArchiveHero"><button class="btn light sm" onclick="go('condomini')">← Tutti i clienti</button><h2>${esc(client.name)}</h2><p>${esc(client.address || 'Indirizzo da definire')}</p><p>${client.manager ? `Amministratore: ${esc(client.manager)}` : 'Amministratore da definire'}${client.phone ? ` · ${esc(client.phone)}` : ''}</p></div>
      <div class="headline"><div><h2>Scheda interventi</h2><p>Ogni lavoro mantiene separati preventivi, documenti, fotografie e video.</p></div><div class="actions"><button class="btn light" onclick="openCondo('${client.id}')">Modifica cliente</button><button class="btn lime" onclick="openIntervention('', '${client.id}')">＋ Nuovo intervento</button></div></div>
      <div class="grid stats">${stat('Interventi', interventions.length, '▤')}${stat('Preventivi', (db.quotes || []).filter((item) => item.clientId === client.id || item.client === client.name).length, '📄')}${stat('Documenti', (db.documents || []).filter((item) => item.clientId === client.id || item.client === client.name).length, '📁')}${stat('Foto e video', mediaCount, '🎬')}</div>
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
