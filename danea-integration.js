(function () {
  'use strict';

  const SOURCE = 'Danea Interventi';
  const DANEA_STATUSES = ['Nuovo', 'Preso in carico', 'In corso', 'Posticipato', 'Completato', 'Inoltrato', 'Rifiutato'];
  const INTERNAL_STATUSES = ['Nuova', 'In attesa', 'In corso', 'Sospeso', 'Completato', 'Assegnato', 'Rifiutato', 'Archiviata'];
  const AUTO_SITE_DANEA_STATUSES = new Set(['Nuovo', 'Preso in carico', 'In corso']);
  const INTERNAL_LABELS = {
    Nuova: 'Da valutare',
    'In attesa': 'Programmato',
    'In corso': 'In lavorazione',
    Sospeso: 'Sospeso',
    Completato: 'Chiuso',
    Assegnato: 'Inoltrato / assegnato',
    Rifiutato: 'Rifiutato',
    Archiviata: 'Archiviato'
  };
  let daneaFilter = 'Aperti';
  let daneaSiteSyncTimer = null;
  const cloudCollectionsReady = new Set();

  const style = document.createElement('style');
  style.textContent = `
    .daneaCard{border-left:5px solid #e5473a}
    .daneaCard.completed{border-left-color:#315c3b;opacity:.75}
    .daneaMeta{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
    .daneaMeta span{background:#f2f3ef;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:750}
    .daneaDescription{white-space:pre-wrap;line-height:1.5}
    .daneaSecurity{display:flex;gap:10px;align-items:flex-start}
    .daneaSecurity strong{color:#315c3b}
    @media(max-width:720px){.daneaCard .actions .btn{flex:1}.daneaCard .actions{width:100%}}
  `;
  document.head.appendChild(style);

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('it');
  }

  function identityText(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '');
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function safeDaneaUrl(value, throwOnInvalid = false) {
    if (!String(value || '').trim()) return '';
    try {
      const parsed = new URL(String(value).trim());
      const host = parsed.hostname.toLocaleLowerCase('it');
      const allowed = parsed.protocol === 'https:' && (
        host === 'miocondominio.eu' ||
        host.endsWith('.miocondominio.eu') ||
        host === 'danea.it' ||
        host.endsWith('.danea.it')
      );
      if (!allowed) throw new Error('Il collegamento deve appartenere a Danea o MioCondominio.');
      return parsed.href;
    } catch (error) {
      if (throwOnInvalid) throw new Error(error.message || 'Collegamento Danea non valido.');
      return '';
    }
  }

  function daneaKey(item) {
    const messageId = normalizeText(item.sourceMessageId);
    if (messageId) return `mail-${hashText(messageId)}`;
    const interventionId = normalizeText(item.daneaId);
    if (interventionId) return `id-${hashText(`${identityText(item.studio)}|${identityText(interventionId)}`)}`;
    const sourceUrl = safeDaneaUrl(item.sourceUrl);
    if (sourceUrl) return `url-${hashText(sourceUrl)}`;
    return `fallback-${hashText([
      normalizeText(item.studio),
      normalizeText(item.client || item.name),
      normalizeText(item.title),
      String(item.receivedAt || '').slice(0, 10)
    ].join('|'))}`;
  }

  function mappedStatus(daneaStatus) {
    if (daneaStatus === 'Preso in carico') return 'In corso';
    if (daneaStatus === 'In corso') return 'In corso';
    if (daneaStatus === 'Posticipato') return 'Sospeso';
    if (daneaStatus === 'Completato') return 'Completato';
    if (daneaStatus === 'Inoltrato') return 'Assegnato';
    if (daneaStatus === 'Rifiutato') return 'Rifiutato';
    return 'Nuova';
  }

  function daneaStatusFromText(value) {
    const text = normalizeText(value);
    if (/(incarico\s+concluso|completat|conclus[oa]|chius[oa])/.test(text)) return 'Completato';
    if (/posticipat/.test(text)) return 'Posticipato';
    if (/(pres[oa]\s+in\s+carico|incarico\s+accettat|concludi\s+incarico)/.test(text)) return 'Preso in carico';
    if (/(in\s+corso|in\s+ritardo|esecuzione\s+prevista)/.test(text)) return 'In corso';
    return 'Nuovo';
  }

  function daneaRows() {
    return (db.leads || []).filter((item) => item.source === SOURCE || item.source === 'Danea');
  }

  function canManageDaneaSites() {
    return typeof isOffice === 'function' && isOffice();
  }

  function daneaSiteFor(item) {
    return (db.sites || []).find((site) =>
      String(site.daneaRequestId || '') === String(item.id || '') ||
      (
        item.daneaId &&
        identityText(site.daneaId) === identityText(item.daneaId) &&
        identityText(site.daneaStudio || site.studio) === identityText(item.studio)
      )
    );
  }

  function daneaSiteStatus(item, currentStatus = '') {
    const daneaStatus = String(item.daneaStatus || 'Nuovo');
    if (daneaStatus === 'Completato') return 'Completato';
    if (daneaStatus === 'Posticipato' && currentStatus !== 'Completato') return 'Pianificato';
    if (['Preso in carico', 'In corso'].includes(daneaStatus) && currentStatus !== 'Completato') return 'In corso';
    if (currentStatus) return currentStatus;
    return 'Pianificato';
  }

  function daneaSiteProgress(item, currentProgress = 0) {
    if (String(item.daneaStatus || '') === 'Completato') return 100;
    return Math.min(99, Math.max(0, Number(currentProgress || 0)));
  }

  function ensureDaneaClient(item) {
    db.condomini = db.condomini || [];
    const requestedName = String(item.client || item.name || 'Cliente da definire').trim();
    const requestedAddress = String(item.address || '').trim();
    let client = db.condomini.find((entry) =>
      identityText(entry.name) === identityText(requestedName) ||
      (requestedAddress && identityText(entry.address) === identityText(requestedAddress))
    );
    let created = false;
    let changed = false;
    if (!client) {
      client = {
        id: `c-danea-${hashText(`${requestedName}|${requestedAddress}`)}`,
        name: requestedName,
        address: requestedAddress,
        manager: item.studio || '',
        phone: item.phone || '',
        email: '',
        source: SOURCE,
        createdAt: new Date().toISOString()
      };
      db.condomini.push(client);
      created = true;
      changed = true;
    } else {
      const additions = {
        address: client.address || requestedAddress,
        manager: client.manager || item.studio || '',
        phone: client.phone || item.phone || ''
      };
      Object.entries(additions).forEach(([key, value]) => {
        if (String(client[key] || '') !== String(value || '')) {
          client[key] = value;
          changed = true;
        }
      });
    }
    return { client, created, changed };
  }

  function updateDaneaSiteFields(site, fields) {
    let changed = false;
    Object.entries(fields).forEach(([key, value]) => {
      if (String(site[key] ?? '') !== String(value ?? '')) {
        site[key] = value;
        changed = true;
      }
    });
    if (changed) site.updatedAt = new Date().toISOString();
    return changed;
  }

  function ensureDaneaSite(item) {
    db.sites = db.sites || [];
    let site = daneaSiteFor(item);
    const shouldCreate = AUTO_SITE_DANEA_STATUSES.has(String(item.daneaStatus || 'Nuovo'));
    if (!site && !shouldCreate) return { site: null, created: false, changed: false, clientCreated: false };

    const clientResult = ensureDaneaClient(item);
    const client = clientResult.client;
    const codeLabel = item.daneaId ? `Danea ${item.daneaId}` : 'Danea';
    const title = `${codeLabel} · ${item.title || 'Richiesta di intervento'}`;
    const now = new Date().toISOString();

    if (!site) {
      site = {
        id: `site-danea-${hashText(item.id || daneaKey(item))}`,
        code: item.daneaId ? `DANEA-${item.daneaId}` : `DANEA-${hashText(item.id).toUpperCase()}`,
        title,
        client: client.name,
        clientId: client.id,
        address: item.address || client.address || '',
        worker: '',
        start: item.scheduledDate || String(item.receivedAt || now).slice(0, 10),
        value: 0,
        cost: 0,
        status: daneaSiteStatus(item),
        progress: daneaSiteProgress(item),
        source: SOURCE,
        daneaManaged: true,
        daneaRequestId: item.id,
        daneaId: item.daneaId || '',
        daneaStudio: item.studio || '',
        daneaLink: safeDaneaUrl(item.sourceUrl),
        description: item.request || item.description || '',
        priority: item.priority || 'Normale',
        createdAt: now,
        updatedAt: now
      };
      db.sites.push(site);
      return { site, created: true, changed: true, clientCreated: clientResult.created };
    }

    const changed = updateDaneaSiteFields(site, {
      title: site.daneaManaged === false ? site.title : title,
      client: client.name,
      clientId: client.id,
      address: item.address || client.address || site.address || '',
      status: daneaSiteStatus(item, site.status),
      progress: daneaSiteProgress(item, site.progress),
      source: SOURCE,
      daneaManaged: site.daneaManaged !== false,
      daneaRequestId: item.id,
      daneaId: item.daneaId || '',
      daneaStudio: item.studio || '',
      daneaLink: safeDaneaUrl(item.sourceUrl),
      description: item.request || item.description || site.description || '',
      priority: item.priority || site.priority || 'Normale'
    });
    return {
      site,
      created: false,
      changed: changed || clientResult.changed,
      clientCreated: clientResult.created
    };
  }

  function reconcileDaneaSites() {
    const result = { created: 0, updated: 0, clientsCreated: 0, total: 0, changed: false };
    if (!canManageDaneaSites()) return result;
    daneaRows().forEach((item) => {
      const existing = daneaSiteFor(item);
      if (!existing && !AUTO_SITE_DANEA_STATUSES.has(String(item.daneaStatus || 'Nuovo'))) return;
      const outcome = ensureDaneaSite(item);
      if (!outcome.site) return;
      result.total += 1;
      if (outcome.created) result.created += 1;
      else if (outcome.changed) result.updated += 1;
      if (outcome.clientCreated) result.clientsCreated += 1;
      result.changed = result.changed || outcome.changed;
    });
    if (result.changed) save();
    return result;
  }

  function scheduleDaneaSiteSync() {
    clearTimeout(daneaSiteSyncTimer);
    daneaSiteSyncTimer = setTimeout(() => {
      if (!cloudCollectionsReady.has('leads') || !cloudCollectionsReady.has('sites')) return;
      const result = reconcileDaneaSites();
      if (result.changed) render();
    }, 140);
  }

  window.addEventListener('edilkappa:cloud-collection-synced', (event) => {
    const remoteName = String(event.detail?.remoteName || '');
    if (!['leads', 'sites'].includes(remoteName)) return;
    cloudCollectionsReady.add(remoteName);
    scheduleDaneaSiteSync();
  });

  function dateTimeText(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : parsed.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  }

  function dateText(value) {
    if (!value) return 'Da programmare';
    const parsed = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString('it-IT');
  }

  function dateTimeLocal(value) {
    const parsed = value ? new Date(value) : new Date();
    if (Number.isNaN(parsed.getTime())) return '';
    const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function select(values, current, labels = {}) {
    return values.map((value) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(labels[value] || value)}</option>`).join('');
  }

  function clientList() {
    return `<datalist id="daneaClients">${(db.condomini || []).map((item) => `<option value="${esc(item.name)}">${esc(item.address || '')}</option>`).join('')}</datalist>`;
  }

  function mergeImportedRequest(data) {
    data.daneaKey = daneaKey(data);
    const existing = daneaRows().find((item) => item.id === data.id || item.daneaKey === data.daneaKey || daneaKey(item) === data.daneaKey);
    const now = new Date().toISOString();
    if (existing) {
      const keepAdvancedStatus = data.daneaStatus === 'Nuovo' && existing.status && existing.status !== 'Nuova';
      Object.assign(existing, {
        ...data,
        id: existing.id,
        status: keepAdvancedStatus ? existing.status : mappedStatus(data.daneaStatus),
        createdAt: existing.createdAt || data.createdAt || now,
        updatedAt: now
      });
      ensureDaneaSite(existing);
      return { item: existing, updated: true };
    }
    const item = {
      id: data.id || `danea-${data.daneaKey.replace(/[^a-z0-9-]/gi, '').slice(0, 80)}`,
      source: SOURCE,
      status: mappedStatus(data.daneaStatus),
      createdAt: data.createdAt || now,
      updatedAt: now,
      ...data
    };
    db.leads.push(item);
    ensureDaneaSite(item);
    return { item, updated: false };
  }

  function requestFromForm(form, item) {
    const receivedValue = form.get('receivedAt');
    const receivedDate = receivedValue ? new Date(receivedValue) : new Date();
    const sourceUrl = safeDaneaUrl(form.get('sourceUrl'), true);
    const client = String(form.get('client') || '').trim();
    const daneaId = String(form.get('daneaId') || '').trim();
    const studio = String(form.get('studio') || '').trim();
    const daneaStatus = String(form.get('daneaStatus') || 'Nuovo');
    const status = daneaStatus !== String(item.daneaStatus || 'Nuovo')
      ? mappedStatus(daneaStatus)
      : String(form.get('status') || mappedStatus(daneaStatus));
    if (!daneaId && !String(item.sourceMessageId || '').trim()) {
      const duplicate = daneaRows().find((candidate) =>
        identityText(candidate.studio) === identityText(studio) &&
        normalizeText(candidate.title) === normalizeText(form.get('title')) &&
        normalizeText(candidate.client) === normalizeText(client) &&
        String(candidate.receivedAt || '').slice(0, 10) === (Number.isNaN(receivedDate.getTime()) ? '' : receivedDate.toISOString().slice(0, 10))
      );
      if (duplicate && duplicate.id !== item.id) throw new Error('Questa richiesta sembra già presente. Apri la scheda esistente.');
    }
    return {
      ...item,
      source: SOURCE,
      daneaId,
      studio,
      title: String(form.get('title') || '').trim(),
      name: client,
      client,
      address: String(form.get('address') || '').trim(),
      request: String(form.get('request') || '').trim(),
      priority: String(form.get('priority') || 'Normale'),
      daneaStatus,
      status,
      receivedAt: Number.isNaN(receivedDate.getTime()) ? new Date().toISOString() : receivedDate.toISOString(),
      scheduledDate: String(form.get('scheduledDate') || ''),
      reference: String(form.get('reference') || '').trim(),
      phone: String(form.get('phone') || '').trim(),
      notes: String(form.get('notes') || '').trim(),
      sourceUrl
    };
  }

  window.openDaneaRequest = function (id) {
    const existing = daneaRows().find((entry) => entry.id === id);
    const item = existing || {
      source: SOURCE,
      daneaId: '',
      studio: '',
      title: '',
      client: '',
      address: '',
      request: '',
      priority: 'Normale',
      daneaStatus: 'Nuovo',
      status: 'Nuova',
      receivedAt: new Date().toISOString(),
      scheduledDate: '',
      reference: '',
      phone: '',
      notes: '',
      sourceUrl: ''
    };
    modal(id ? 'Modifica richiesta Danea' : 'Nuova richiesta Danea', `<div class="formGrid">
      <div class="field"><label>Codice intervento Danea</label><input name="daneaId" type="text" value="${esc(item.daneaId || '')}"></div>
      ${field('Studio amministratore', 'studio', 'text', item.studio || '', true)}
      ${field('Titolo intervento', 'title', 'text', item.title || '', true)}
      <div class="field"><label>Condominio / cliente</label><input name="client" list="daneaClients" value="${esc(item.client || item.name || '')}" required>${clientList()}</div>
      ${field('Indirizzo', 'address', 'text', item.address || '', true)}
      <div class="field"><label>Priorità</label><select name="priority">${select(['Normale', 'Urgente', 'Emergenza'], item.priority || 'Normale')}</select></div>
      <div class="field"><label>Stato in Danea</label><select name="daneaStatus">${select(DANEA_STATUSES, item.daneaStatus || 'Nuovo')}</select></div>
      <div class="field"><label>Stato interno EdilKappa</label><select name="status">${select(INTERNAL_STATUSES, item.status || 'Nuova', INTERNAL_LABELS)}</select></div>
      <div class="field"><label>Ricevuta il</label><input name="receivedAt" type="datetime-local" value="${esc(dateTimeLocal(item.receivedAt))}"></div>
      <div class="field"><label>Data prevista</label><input name="scheduledDate" type="date" value="${esc(item.scheduledDate || '')}"></div>
      <div class="field"><label>Referente</label><input name="reference" type="text" value="${esc(item.reference || '')}"></div>
      <div class="field"><label>Telefono referente</label><input name="phone" type="tel" value="${esc(item.phone || '')}"></div>
      <div class="field full"><label>Descrizione dell’intervento</label><textarea name="request" required>${esc(item.request || item.description || '')}</textarea></div>
      <div class="field full"><label>Collegamento protetto a Danea</label><input name="sourceUrl" type="url" value="${esc(safeDaneaUrl(item.sourceUrl))}" placeholder="https://fornitori.miocondominio.eu/..."><small>Visibile soltanto a Titolare e Ufficio.</small></div>
      <div class="field full"><label>Note interne</label><textarea name="notes">${esc(item.notes || '')}</textarea></div>
    </div>`, (form) => {
      const data = requestFromForm(form, item);
      data.daneaKey = daneaKey(data);
      const duplicate = daneaRows().find((entry) => entry.id !== item.id && (entry.daneaKey === data.daneaKey || daneaKey(entry) === data.daneaKey));
      if (duplicate) throw new Error('Questa richiesta Danea è già presente nel gestionale.');
      data.updatedAt = new Date().toISOString();
      let savedItem = existing;
      if (savedItem) Object.assign(savedItem, data);
      else {
        savedItem = { id: `danea-${data.daneaKey.replace(/[^a-z0-9-]/gi, '').slice(0, 80)}`, createdAt: data.updatedAt, ...data };
        db.leads.push(savedItem);
      }
      ensureDaneaSite(savedItem);
    });
  };

  function parseDaneaText(raw, studioFallback, sourceUrl) {
    const text = String(raw || '').replace(/\r/g, '').trim();
    if (!text) throw new Error('Incolla il testo ricevuto da Danea.');
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const interventionMatch = text.match(/\((\d{3,})\)|(?:intervento|pratica|richiesta)\s*(?:n[.°º]?|#)?\s*(\d{3,})/i);
    const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})(?:\s+(?:alle\s+)?(\d{1,2}:\d{2}))?/i);
    const clientLine = lines.find((line) => /^condominio\b/i.test(line));
    const addressLine = lines.find((line) => /^(via|viale|piazza|corso|largo|vicolo)\b/i.test(line));
    const studioLine = lines.find((line) => /^studio\b/i.test(line));
    const title = lines.find((line) =>
      !/^condominio\b/i.test(line) &&
      !/^studio\b/i.test(line) &&
      !/^(via|viale|piazza|corso|largo|vicolo)\b/i.test(line) &&
      !/^\d{2}\/\d{2}\/\d{4}/.test(line) &&
      !/^richiesta di intervento$/i.test(line)
    ) || 'Richiesta di intervento';
    let receivedAt = new Date().toISOString();
    if (dateMatch) {
      const [day, month, year] = dateMatch[1].split('/');
      const candidate = new Date(`${year}-${month}-${day}T${dateMatch[2] || '09:00'}:00`);
      if (!Number.isNaN(candidate.getTime())) receivedAt = candidate.toISOString();
    }
    const client = clientLine ? clientLine.replace(/^condominio\s*/i, '').trim() : '';
    const data = {
      source: SOURCE,
      daneaId: interventionMatch?.[1] || interventionMatch?.[2] || '',
      studio: studioLine || String(studioFallback || '').trim(),
      title,
      name: client,
      client,
      address: addressLine || '',
      request: text,
      priority: /urgent|emergenz/i.test(text) ? 'Urgente' : 'Normale',
      daneaStatus: daneaStatusFromText(text),
      receivedAt,
      scheduledDate: '',
      reference: '',
      phone: '',
      notes: '',
      sourceUrl: safeDaneaUrl(sourceUrl, true)
    };
    return data;
  }

  window.openDaneaImport = function () {
    modal('Importa testo o e-mail Danea', `<div class="formGrid">
      <div class="field full"><label>Studio amministratore (se non compare nel testo)</label><input name="studio" type="text"></div>
      <div class="field full"><label>Testo della richiesta o dell’e-mail</label><textarea name="raw" required placeholder="Incolla qui il contenuto ricevuto da Danea"></textarea></div>
      <div class="field full"><label>Collegamento Danea facoltativo</label><input name="sourceUrl" type="url" placeholder="https://fornitori.miocondominio.eu/..."></div>
      <div class="field full"><div class="notice">Il gestionale riconosce codice intervento, condominio, studio, data e stato. Se la richiesta esiste già, viene aggiornata senza duplicarla.</div></div>
    </div>`, (form) => {
      const result = mergeImportedRequest(parseDaneaText(form.get('raw'), form.get('studio'), form.get('sourceUrl')));
      setTimeout(() => alert(result.updated ? 'Richiesta Danea aggiornata senza creare doppioni.' : 'Richiesta Danea importata.'), 80);
    });
  };

  window.setDaneaFilter = function (value) {
    daneaFilter = value;
    render();
  };

  window.openDaneaLink = function (id) {
    const item = daneaRows().find((entry) => entry.id === id);
    const url = safeDaneaUrl(item?.sourceUrl);
    if (!url) return alert('Questa richiesta non contiene ancora un collegamento Danea valido.');
    window.open(url, '_blank', 'noopener');
  };

  window.convertDaneaRequest = function (id) {
    const item = daneaRows().find((entry) => entry.id === id);
    if (!item) return;
    if ((db.inspections || []).some((entry) => entry.daneaRequestId === item.id)) {
      return alert('Il sopralluogo collegato a questa richiesta esiste già.');
    }
    const clientName = item.client || item.name || 'Cliente da definire';
    let client = (db.condomini || []).find((entry) =>
      normalizeText(entry.name) === normalizeText(clientName) ||
      (item.address && normalizeText(entry.address) === normalizeText(item.address))
    );
    if (!client) {
      client = {
        id: uid('c'),
        name: clientName,
        address: item.address || '',
        manager: item.studio || '',
        phone: item.phone || '',
        email: ''
      };
      db.condomini.push(client);
    }
    db.interventions = db.interventions || [];
    let intervention = db.interventions.find((entry) => entry.daneaRequestId === item.id);
    if (!intervention) {
      intervention = {
        id: uid('int'),
        daneaRequestId: item.id,
        client: client.name,
        clientId: client.id,
        title: item.title || 'Richiesta di intervento Danea',
        category: 'Sopralluogo',
        date: item.receivedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        status: item.status === 'Completato' ? 'Completato' : 'In attesa',
        notes: item.request || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.interventions.push(intervention);
    }
    db.inspections.push({
      id: uid('s'),
      daneaRequestId: item.id,
      interventionId: intervention.id,
      date: item.scheduledDate || new Date().toISOString().slice(0, 10),
      time: '09:00',
      type: 'Richiesta Danea',
      client: client.name,
      clientId: client.id,
      address: item.address || client.address,
      problem: item.request || item.title,
      status: item.scheduledDate ? 'Pianificato' : 'Da programmare',
      photos: []
    });
    if (item.status === 'Nuova') item.status = 'In attesa';
    item.updatedAt = new Date().toISOString();
    save();
    render();
    alert('Cliente, intervento e sopralluogo collegati alla richiesta Danea.');
  };

  window.daneaRequestsView = function () {
    const all = daneaRows().slice().sort((left, right) => String(right.receivedAt || right.createdAt || '').localeCompare(String(left.receivedAt || left.createdAt || '')));
    const rows = all.filter((item) => {
      if (daneaFilter === 'Nuove') return item.status === 'Nuova';
      if (daneaFilter === 'Completate') return item.status === 'Completato';
      if (daneaFilter === 'Archiviate') return item.status === 'Archiviata';
      if (daneaFilter === 'Aperti') return !['Completato', 'Archiviata', 'Rifiutato'].includes(item.status);
      return true;
    });
    const active = all.filter((item) => ['In attesa', 'In corso', 'Sospeso', 'Assegnato'].includes(item.status)).length;
    const transferNowSettings = window.EdilKappaCloud?.currentProfile?.role === 'owner'
      ? '<button class="btn light" onclick="openTransferNowSettings()">⚙ TransferNow</button>'
      : '';
    return pageHead('Richieste Danea', 'Incarichi ricevuti dagli amministratori e gestione interna EdilKappa', `${transferNowSettings}<button class="btn light" onclick="openDaneaImport()">↓ Importa testo/e-mail</button><button class="btn lime" onclick="openDaneaRequest()">＋ Nuova manuale</button>`) +
      `<div class="notice daneaSecurity"><span>🔒</span><div><strong>Archivio riservato.</strong> I collegamenti alle pratiche Danea sono disponibili soltanto a Titolare e Ufficio.</div></div>
      <div style="height:14px"></div>
      <div class="grid stats">${stat('Da valutare', all.filter((item) => item.status === 'Nuova').length, '📥')}${stat('In gestione', active, '🔧')}${stat('Completate', all.filter((item) => item.status === 'Completato').length, '✓')}${stat('Totali', all.length, '▦')}</div>
      <div class="actions" style="margin:16px 0"><label class="field" style="min-width:220px"><span>Mostra</span><select class="input" onchange="setDaneaFilter(this.value)">${select(['Aperti', 'Nuove', 'Completate', 'Archiviate', 'Tutte'], daneaFilter)}</select></label></div>
      <div class="list">${rows.map((item) => {
        const linkedInspection = (db.inspections || []).find((entry) => entry.daneaRequestId === item.id);
        const completed = item.status === 'Completato' ? ' completed' : '';
        return `<section class="card daneaCard${completed}">
          <div class="cardHead"><div><span class="pill red">${esc(item.priority || 'Normale')}</span><h3 style="margin:8px 0 2px">${esc(item.title || 'Richiesta di intervento')}</h3><small>${esc(item.client || item.name || 'Condominio da definire')} · ${esc(item.studio || 'Studio da definire')}</small></div>${badge(INTERNAL_LABELS[item.status] || item.status || 'Da valutare')}</div>
          <div class="daneaMeta"><span>Codice ${esc(item.daneaId || 'da definire')}</span><span>Ricevuta ${esc(dateTimeText(item.receivedAt || item.createdAt))}</span><span>Prevista ${esc(dateText(item.scheduledDate))}</span><span>Danea: ${esc(item.daneaStatus || 'Nuovo')}</span></div>
          <p class="daneaDescription">${esc(item.request || item.description || '')}</p>
          <small>${esc(item.address || '')}${item.reference ? ` · Referente ${esc(item.reference)}` : ''}</small>
          ${linkedInspection ? `<div class="okbox" style="margin-top:12px">Sopralluogo collegato: ${esc(linkedInspection.date)} · ${esc(linkedInspection.status)}</div>` : ''}
          <div class="actions" style="margin-top:14px">
            ${safeDaneaUrl(item.sourceUrl) ? `<button class="btn sm green" onclick="openDaneaLink('${item.id}')">Apri in Danea</button>` : ''}
            <button class="btn sm light" onclick="convertDaneaRequest('${item.id}')">${linkedInspection ? 'Sopralluogo creato' : 'Crea sopralluogo'}</button>
            <button class="btn sm light" onclick="openDaneaRequest('${item.id}')">Modifica</button>
            <button class="btn sm red" onclick="deleteItem('leads','${item.id}','questa richiesta Danea')">Elimina</button>
          </div>
        </section>`;
      }).join('') || '<div class="empty">Nessuna richiesta per il filtro selezionato.</div>'}</div>`;
  };

  if (!ownerNav.some((item) => item[0] === 'daneaRequestsView')) {
    const inspectionIndex = ownerNav.findIndex((item) => item[0] === 'inspections');
    ownerNav.splice(inspectionIndex >= 0 ? inspectionIndex + 1 : 3, 0, ['daneaRequestsView', '🔧', 'Richieste Danea']);
  }

  const baseMore = more;
  more = function () {
    return baseMore() + pageHead('Danea Interventi', 'Richieste ricevute dagli amministratori') +
      '<div class="grid quick"><button onclick="go(\'daneaRequestsView\')"><span>🔧</span>Richieste Danea</button></div>';
  };

  const baseDashboard = dashboard;
  dashboard = function () {
    const open = daneaRows().filter((item) => !['Completato', 'Archiviata', 'Rifiutato'].includes(item.status));
    if (!open.length) return baseDashboard();
    return baseDashboard() + `<div class="sectionHead"><h2>Richieste Danea da gestire</h2></div><div class="card"><div class="list">${open.slice(0, 5).map((item) =>
      `<div class="row"><div class="rowIcon">🔧</div><div class="rowBody"><b>${esc(item.title || 'Richiesta di intervento')}</b><small>${esc(item.client || item.name || '')} · ${esc(INTERNAL_LABELS[item.status] || item.status)}</small></div><button class="btn sm green" onclick="go('daneaRequestsView')">Apri</button></div>`
    ).join('')}</div></div>`;
  };

  const baseRender = render;
  render = function () {
    if (view === 'daneaRequestsView') {
      if (!isOffice()) view = 'worker';
      else {
        renderNav();
        document.getElementById('avatar').textContent = roleName().charAt(0);
        document.getElementById('pageTitle').textContent = 'Richieste Danea';
        document.getElementById('app').innerHTML = window.daneaRequestsView();
        return;
      }
    }
    baseRender();
  };

  save();
  initRoles();
  render();
})();

if (!document.querySelector('script[data-edilkappa-sharing]')) {
  const sharingScript = document.createElement('script');
  sharingScript.type = 'module';
  sharingScript.src = './sharing-integration.js';
  sharingScript.dataset.edilkappaSharing = 'true';
  document.head.appendChild(sharingScript);
}
