(function () {
  'use strict';

  db.leads = db.leads || [];
  db.condomini = db.condomini || [];
  db.interventions = db.interventions || [];
  db.inspections = db.inspections || [];
  db.sites = db.sites || [];
  db.reports = db.reports || [];
  db.timesheets = db.timesheets || [];

  let reconciling = false;
  let reconcileTimer = null;
  let pendingSiteContext = null;
  const originalSave = save;

  function normalized(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('it');
  }

  function identity(value) {
    return normalized(value).replace(/[^a-z0-9]+/g, '');
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function requestSource(item) {
    if (/danea/i.test(String(item.source || ''))) return 'Danea';
    return item.source || 'Richiesta cliente';
  }

  function requestTitle(item) {
    const firstLine = String(item.request || item.description || item.notes || '').split('\n').find(Boolean) || '';
    return String(item.title || firstLine || 'Richiesta di lavoro').trim().slice(0, 180);
  }

  function requestDate(item) {
    return String(item.receivedAt || item.createdAt || new Date().toISOString()).slice(0, 10);
  }

  function requestStatus(item) {
    const status = `${item.daneaStatus || ''} ${item.status || ''}`.toLocaleLowerCase('it');
    if (/complet|conclus|chius/.test(status)) return 'Completato';
    if (/posticip|sospes|archiv|rifiut/.test(status)) return 'Sospeso';
    if (/preso in carico|in corso|lavorazione|assegnat/.test(status)) return 'In corso';
    return 'In attesa';
  }

  function setValue(item, key, value) {
    if (value === undefined || value === null) return false;
    if (String(item[key] ?? '') === String(value ?? '')) return false;
    item[key] = value;
    return true;
  }

  function ensureClientForRequest(item) {
    const name = String(item.client || item.name || 'Cliente da definire').trim();
    const address = String(item.address || '').trim();
    let client = db.condomini.find((entry) =>
      identity(entry.name) === identity(name) ||
      (address && identity(entry.address) === identity(address))
    );
    let changed = false;
    if (!client) {
      client = {
        id: `c-rq-${stableHash(`${name}|${address}`)}`,
        name,
        address,
        manager: item.studio || item.manager || '',
        phone: item.phone || '',
        email: item.email || '',
        source: requestSource(item),
        createdAt: item.receivedAt || item.createdAt || new Date().toISOString()
      };
      db.condomini.push(client);
      changed = true;
    } else {
      changed = setValue(client, 'address', client.address || address) || changed;
      changed = setValue(client, 'manager', client.manager || item.studio || item.manager || '') || changed;
      changed = setValue(client, 'phone', client.phone || item.phone || '') || changed;
      changed = setValue(client, 'email', client.email || item.email || '') || changed;
    }
    return { client, changed };
  }

  function timelineEvent(intervention, event) {
    intervention.timeline = Array.isArray(intervention.timeline) ? intervention.timeline : [];
    const id = event.id || `${event.type}-${stableHash(`${event.date}|${event.label}|${event.sourceId || ''}`)}`;
    if (intervention.timeline.some((entry) => entry.id === id)) return false;
    intervention.timeline.push({ id, ...event });
    return true;
  }

  function interventionForRequest(item) {
    return db.interventions.find((entry) =>
      String(entry.id) === String(item.interventionId || '') ||
      String(entry.requestId || '') === String(item.id || '') ||
      String(entry.leadId || '') === String(item.id || '') ||
      String(entry.daneaRequestId || '') === String(item.id || '')
    );
  }

  function ensureInspection(item, client, intervention) {
    let inspection = db.inspections.find((entry) =>
      String(entry.requestId || '') === String(item.id || '') ||
      String(entry.leadId || '') === String(item.id || '') ||
      String(entry.daneaRequestId || '') === String(item.id || '')
    );
    let changed = false;
    if (!inspection) {
      inspection = {
        id: `s-rq-${stableHash(item.id || `${client.id}|${requestTitle(item)}`)}`,
        requestId: item.id || '',
        leadId: /danea/i.test(String(item.source || '')) ? '' : item.id || '',
        daneaRequestId: /danea/i.test(String(item.source || '')) ? item.id || '' : '',
        interventionId: intervention.id,
        date: item.scheduledDate || requestDate(item),
        time: item.scheduledTime || '09:00',
        type: /danea/i.test(String(item.source || '')) ? 'Richiesta Danea' : 'Richiesta cliente',
        client: client.name,
        clientId: client.id,
        address: item.address || client.address || '',
        problem: item.request || item.description || requestTitle(item),
        status: item.scheduledDate ? 'Pianificato' : 'Da programmare',
        photos: item.photos || [],
        createdAt: item.receivedAt || item.createdAt || new Date().toISOString()
      };
      db.inspections.push(inspection);
      changed = true;
    } else {
      changed = setValue(inspection, 'requestId', inspection.requestId || item.id || '') || changed;
      changed = setValue(inspection, 'interventionId', intervention.id) || changed;
      changed = setValue(inspection, 'clientId', client.id) || changed;
      changed = setValue(inspection, 'client', client.name) || changed;
    }
    return changed;
  }

  function ensureRequestIntervention(item) {
    const clientResult = ensureClientForRequest(item);
    const client = clientResult.client;
    const now = new Date().toISOString();
    const status = requestStatus(item);
    let intervention = interventionForRequest(item);
    let changed = clientResult.changed;
    if (!intervention) {
      intervention = {
        id: `int-rq-${stableHash(item.id || `${client.id}|${requestTitle(item)}|${requestDate(item)}`)}`,
        requestId: item.id || '',
        leadId: /danea/i.test(String(item.source || '')) ? '' : item.id || '',
        daneaRequestId: /danea/i.test(String(item.source || '')) ? item.id || '' : '',
        source: requestSource(item),
        client: client.name,
        clientId: client.id,
        title: requestTitle(item),
        category: 'Richiesta di lavoro',
        date: requestDate(item),
        status,
        notes: item.request || item.description || item.notes || '',
        requestReceivedAt: item.receivedAt || item.createdAt || now,
        startedAt: status === 'In corso' ? now : '',
        completedAt: status === 'Completato' ? (item.updatedAt || now) : '',
        timeline: [],
        createdAt: item.receivedAt || item.createdAt || now,
        updatedAt: now
      };
      db.interventions.push(intervention);
      changed = true;
    } else {
      changed = setValue(intervention, 'requestId', intervention.requestId || item.id || '') || changed;
      changed = setValue(intervention, 'leadId', intervention.leadId || (/danea/i.test(String(item.source || '')) ? '' : item.id || '')) || changed;
      changed = setValue(intervention, 'daneaRequestId', intervention.daneaRequestId || (/danea/i.test(String(item.source || '')) ? item.id || '' : '')) || changed;
      changed = setValue(intervention, 'clientId', client.id) || changed;
      changed = setValue(intervention, 'client', client.name) || changed;
      changed = setValue(intervention, 'source', intervention.source || requestSource(item)) || changed;
      if (!intervention.title) changed = setValue(intervention, 'title', requestTitle(item)) || changed;
      if (!intervention.notes) changed = setValue(intervention, 'notes', item.request || item.description || item.notes || '') || changed;
      if (status === 'Completato' || (status === 'In corso' && !['Completato', 'Sospeso'].includes(intervention.status))) {
        changed = setValue(intervention, 'status', status) || changed;
      }
      if (status === 'In corso' && !intervention.startedAt) changed = setValue(intervention, 'startedAt', item.updatedAt || now) || changed;
      if (status === 'Completato' && !intervention.completedAt) changed = setValue(intervention, 'completedAt', item.updatedAt || now) || changed;
    }
    changed = setValue(item, 'clientId', client.id) || changed;
    changed = setValue(item, 'interventionId', intervention.id) || changed;
    changed = timelineEvent(intervention, {
      id: `request-${item.id || stableHash(requestTitle(item))}`,
      type: 'request',
      date: item.receivedAt || item.createdAt || intervention.createdAt,
      label: 'Richiesta ricevuta',
      actor: requestSource(item),
      detail: item.request || item.description || requestTitle(item),
      sourceId: item.id || ''
    }) || changed;
    changed = ensureInspection(item, client, intervention) || changed;
    if (changed) intervention.updatedAt = now;
    return { client, intervention, changed };
  }

  function clientForItem(item) {
    return db.condomini.find((client) => String(client.id) === String(item.clientId || ''))
      || db.condomini.find((client) => identity(client.name) === identity(item.client || item.name))
      || null;
  }

  function soleInterventionForItem(item) {
    const client = clientForItem(item);
    if (!client) return null;
    const rows = db.interventions.filter((intervention) =>
      String(intervention.clientId || '') === String(client.id) ||
      identity(intervention.client) === identity(client.name)
    );
    const active = rows.filter((intervention) => !['Completato', 'Sospeso'].includes(intervention.status));
    if (active.length === 1) return active[0];
    return rows.length === 1 ? rows[0] : null;
  }

  function linkOperationalData() {
    let changed = false;
    const requestById = new Map(db.leads.map((item) => [String(item.id || ''), item]));
    for (const site of db.sites) {
      let intervention = db.interventions.find((entry) => String(entry.id) === String(site.interventionId || ''));
      const requestId = site.daneaRequestId || site.requestId || site.leadId || '';
      if (!intervention && requestId) intervention = interventionForRequest(requestById.get(String(requestId)) || { id: requestId });
      if (!intervention) intervention = soleInterventionForItem(site);
      if (!intervention) continue;
      changed = setValue(site, 'interventionId', intervention.id) || changed;
      changed = setValue(site, 'clientId', intervention.clientId) || changed;
      changed = setValue(site, 'client', intervention.client) || changed;
    }

    for (const collectionName of ['inspections', 'quotes', 'documents', 'drone', 'roofs', 'drains']) {
      for (const item of db[collectionName] || []) {
        if (item.interventionId) continue;
        const requestId = item.daneaRequestId || item.requestId || item.leadId || '';
        const intervention = requestId
          ? interventionForRequest(requestById.get(String(requestId)) || { id: requestId })
          : soleInterventionForItem(item);
        if (!intervention) continue;
        changed = setValue(item, 'interventionId', intervention.id) || changed;
        changed = setValue(item, 'clientId', intervention.clientId) || changed;
      }
    }

    for (const report of db.reports) {
      const site = db.sites.find((entry) => String(entry.id) === String(report.site || report.siteId || ''));
      if (!site?.interventionId) continue;
      changed = setValue(report, 'siteId', site.id) || changed;
      changed = setValue(report, 'interventionId', site.interventionId) || changed;
      changed = setValue(report, 'clientId', site.clientId || report.clientId || '') || changed;
      changed = setValue(report, 'client', site.client || report.client || '') || changed;
    }

    for (const entry of db.timesheets) {
      let site = db.sites.find((candidate) => String(candidate.id) === String(entry.siteId || ''));
      if (!site && entry.job) {
        const job = normalized(entry.job);
        site = db.sites.find((candidate) =>
          job === normalized(`${candidate.title} · ${candidate.client}`) ||
          job === normalized(candidate.title)
        );
      }
      if (!site?.interventionId) continue;
      changed = setValue(entry, 'siteId', site.id) || changed;
      changed = setValue(entry, 'interventionId', site.interventionId) || changed;
      changed = setValue(entry, 'clientId', site.clientId || '') || changed;
    }
    return changed;
  }

  function syncInterventionStates() {
    let changed = false;
    for (const intervention of db.interventions) {
      const sites = db.sites.filter((site) => String(site.interventionId || '') === String(intervention.id));
      if (!sites.length) continue;
      const inProgress = sites.some((site) => site.status === 'In corso');
      const completed = sites.every((site) => site.status === 'Completato');
      if (inProgress && intervention.status !== 'Completato') {
        changed = setValue(intervention, 'status', 'In corso') || changed;
        if (!intervention.startedAt) changed = setValue(intervention, 'startedAt', sites.find((site) => site.status === 'In corso')?.start || new Date().toISOString()) || changed;
      }
      if (completed) {
        changed = setValue(intervention, 'status', 'Completato') || changed;
        if (!intervention.completedAt) {
          const date = sites.map((site) => site.end || site.updatedAt || '').filter(Boolean).sort().at(-1) || new Date().toISOString();
          changed = setValue(intervention, 'completedAt', date) || changed;
        }
      }
    }
    return changed;
  }

  function reconcileRequestData() {
    if (reconciling || (typeof isOffice === 'function' && !isOffice())) return false;
    reconciling = true;
    let changed = false;
    try {
      for (const item of db.leads) {
        if (!item?.id) continue;
        if (['Archiviata', 'Rifiutato'].includes(item.status) && !item.interventionId) continue;
        changed = ensureRequestIntervention(item).changed || changed;
      }
      changed = linkOperationalData() || changed;
      changed = syncInterventionStates() || changed;
    } finally {
      reconciling = false;
    }
    return changed;
  }

  function ensureManualIntervention(client, title, notes, date) {
    const existing = db.interventions.filter((item) => String(item.clientId || '') === String(client.id) && !['Completato', 'Sospeso'].includes(item.status));
    if (existing.length === 1) return existing[0];
    const now = new Date().toISOString();
    const intervention = {
      id: uid('int'), clientId: client.id, client: client.name,
      title: title || 'Nuovo intervento', category: 'Manutenzione', date: date || localToday(),
      status: 'Pianificato', notes: notes || '', timeline: [], createdAt: now, updatedAt: now
    };
    timelineEvent(intervention, { id: `manual-${intervention.id}`, type: 'created', date: now, label: 'Intervento creato', actor: roleName(), detail: notes || '' });
    db.interventions.push(intervention);
    return intervention;
  }

  function lifecycleSiteEditor(id) {
    const context = pendingSiteContext;
    pendingSiteContext = null;
    const existing = db.sites.find((entry) => entry.id === id);
    const contextClient = context ? db.condomini.find((client) => client.id === context.clientId) : null;
    const item = existing || {
      title: context?.title || '', client: contextClient?.name || '', clientId: contextClient?.id || '',
      interventionId: context?.interventionId || '', address: contextClient?.address || '',
      teamIds: WORKERS[0]?.id ? [WORKERS[0].id] : [], worker: WORKERS[0]?.id || '', start: localToday(), end: '', value: 0, cost: 0,
      status: 'Pianificato', progress: 0
    };
    modal(id ? 'Modifica cantiere' : 'Nuovo cantiere collegato', `<div class="formGrid">
      ${field('Titolo intervento', 'title', 'text', item.title, true)}
      <div class="field"><label>Cliente</label><select name="client" onchange="refreshInterventionSelect(this.form)">${clientOptions(item.client)}</select></div>
      <div class="field"><label>Intervento collegato</label><select name="interventionId">${window.interventionOptions ? window.interventionOptions(item.client, item.interventionId) : '<option value="">Crea automaticamente</option>'}</select></div>
      ${field('Indirizzo', 'address', 'text', item.address, true)}
      ${typeof teamChecklist === 'function' ? teamChecklist(item) : `<div class="field"><label>Squadra assegnata</label><select name="worker">${teamOptions(item.worker)}</select></div>`}
      ${field('Data inizio', 'start', 'date', item.start)}${field('Data fine', 'end', 'date', item.end || '')}
      ${field('Valore lavoro €', 'value', 'number', item.value)}${field('Costi previsti €', 'cost', 'number', item.cost)}
      <div class="field"><label>Stato</label><select name="status">${selectOptions(['Pianificato', 'In corso', 'Completato'], item.status)}</select></div>
    </div>`, (formData) => {
      const client = db.condomini.find((entry) => entry.name === formData.get('client'));
      if (!client) throw new Error('Seleziona un cliente o condominio valido.');
      let intervention = db.interventions.find((entry) => entry.id === formData.get('interventionId'));
      if (!intervention) intervention = ensureManualIntervention(client, formData.get('title'), '', formData.get('start'));
      const status = String(formData.get('status') || 'Pianificato');
      const end = status === 'Completato' ? String(formData.get('end') || localToday()) : String(formData.get('end') || '');
      const selectedTeamIds = typeof formTeamIds === 'function' ? formTeamIds(formData) : [String(formData.get('worker') || '')].filter(Boolean);
      const data = {
        title: formData.get('title'), client: client.name, clientId: client.id, interventionId: intervention.id,
        address: formData.get('address'), worker: selectedTeamIds[0] || '', teamIds: selectedTeamIds, assignedTeamIds: selectedTeamIds, start: formData.get('start'), end,
        value: Number(formData.get('value') || 0), cost: Number(formData.get('cost') || 0), status,
        updatedAt: new Date().toISOString()
      };
      if (existing) {
        Object.assign(existing, data);
        if (typeof applySiteTeams === 'function') applySiteTeams(existing, selectedTeamIds);
      } else {
        const created = { id: uid('l'), code: uid('EK'), ...data, progress: 0, createdAt: data.updatedAt };
        if (typeof applySiteTeams === 'function') applySiteTeams(created, selectedTeamIds);
        db.sites.push(created);
      }
    });
  }

  window.openSiteForIntervention = function (clientId, interventionId) {
    const intervention = db.interventions.find((item) => item.id === interventionId);
    pendingSiteContext = { clientId, interventionId, title: intervention?.title || '' };
    lifecycleSiteEditor('');
  };

  openSite = lifecycleSiteEditor;
  window.openSite = lifecycleSiteEditor;

  window.reconcileRequestInterventions = function () {
    const changed = reconcileRequestData();
    if (changed) originalSave();
    return changed;
  };

  window.openRequestIntervention = function (requestId) {
    const request = db.leads.find((item) => String(item.id) === String(requestId));
    if (!request) return alert('Richiesta non trovata.');
    const result = ensureRequestIntervention(request);
    linkOperationalData();
    originalSave();
    if (typeof window.openClientArchive === 'function') {
      return window.openClientArchive(result.client.id, { interventionId: result.intervention.id, itemId: '' });
    }
  };

  window.convertLead = window.openRequestIntervention;
  window.convertDaneaRequest = window.openRequestIntervention;

  if (typeof window.leadsView === 'function') {
    const baseLeadsView = window.leadsView;
    window.leadsView = function () {
      return baseLeadsView().replaceAll('Crea cliente e sopralluogo', 'Apri intervento');
    };
  }
  if (typeof window.daneaRequestsView === 'function') {
    const baseDaneaRequestsView = window.daneaRequestsView;
    window.daneaRequestsView = function () {
      return baseDaneaRequestsView().replaceAll('Sopralluogo creato', 'Apri intervento').replaceAll('Crea sopralluogo', 'Apri intervento');
    };
  }

  save = function () {
    reconcileRequestData();
    return originalSave();
  };

  window.addEventListener('edilkappa:cloud-collection-synced', (event) => {
    if (!['leads', 'documents', 'sites', 'reports', 'timesheets', 'quotes', 'inspections'].includes(String(event.detail?.remoteName || ''))) return;
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
      if (!reconcileRequestData()) return;
      originalSave();
      render();
    }, 120);
  });

  if (reconcileRequestData()) originalSave();
})();
