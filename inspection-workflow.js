(function () {
  'use strict';

  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('it');
  }

  function clientForInspection(item) {
    return (db.condomini || []).find((client) => String(client.id) === String(item.clientId || ''))
      || (db.condomini || []).find((client) => normalize(client.name) === normalize(item.client));
  }

  function timeline(intervention, event) {
    intervention.timeline = Array.isArray(intervention.timeline) ? intervention.timeline : [];
    if (!intervention.timeline.some((entry) => entry.id === event.id)) intervention.timeline.push(event);
    intervention.updatedAt = new Date().toISOString();
  }

  function isDaneaIntervention(intervention) {
    return Boolean(intervention && (intervention.requestId || intervention.daneaRequestId || /danea/i.test(String(intervention.source || ''))));
  }

  function createInspectionIntervention(item, client) {
    const now = new Date().toISOString();
    const intervention = {
      id: uid('int'), clientId: client.id, client: client.name,
      title: item.problem || item.type || 'Sopralluogo', category: 'Sopralluogo', date: item.date || localToday(),
      status: item.completedAt ? 'Da preventivare' : 'Sopralluogo programmato', notes: item.problem || '', timeline: [], createdAt: now, updatedAt: now
    };
    db.interventions.push(intervention);
    timeline(intervention, { id: `inspection-created-${item.id}`, type: 'inspection', date: now, label: 'Intervento aperto dal sopralluogo', actor: roleName(), detail: item.problem || '' });
    return intervention;
  }

  window.ensureInspectionIntervention = function (item) {
    if (!item) return null;
    const client = clientForInspection(item);
    if (!client) throw new Error('Seleziona un cliente o condominio valido.');
    item.clientId = client.id;
    item.client = client.name;
    let intervention = (db.interventions || []).find((entry) => String(entry.id) === String(item.interventionId || ''));
    if (!intervention) {
      const active = (db.interventions || []).filter((entry) =>
        String(entry.clientId || '') === String(client.id) && !['Completato', 'Sospeso'].includes(entry.status)
      );
      const requestId = item.requestId || item.daneaRequestId || item.leadId || '';
      intervention = requestId
        ? active.find((entry) => [entry.requestId, entry.daneaRequestId, entry.leadId].some((id) => String(id || '') === String(requestId)))
        : null;
    }
    if (!intervention) {
      intervention = createInspectionIntervention(item, client);
    }
    item.interventionId = intervention.id;
    timeline(intervention, { id: `inspection-linked-${item.id}`, type: 'inspection', date: item.createdAt || new Date().toISOString(), label: 'Sopralluogo programmato', actor: roleName(), detail: `${item.date || ''} ${item.time || ''}`.trim() });
    return intervention;
  };

  window.separateInspectionFromDanea = function (id) {
    const item = (db.inspections || []).find((entry) => entry.id === id);
    if (!item) return alert('Sopralluogo non trovato.');
    const previous = (db.interventions || []).find((entry) => String(entry.id) === String(item.interventionId || ''));
    if (!isDaneaIntervention(previous)) return alert('Questo sopralluogo non è collegato a una richiesta Danea.');
    if (!confirm('Separare il sopralluogo dalla richiesta Danea? Descrizioni, misure, foto ed esito resteranno salvati.')) return;
    const client = clientForInspection(item);
    if (!client) return alert('Cliente o condominio non trovato.');
    const intervention = createInspectionIntervention(item, client);
    item.interventionId = intervention.id;
    delete item.requestId;
    delete item.daneaRequestId;
    delete item.leadId;
    timeline(intervention, { id: `inspection-linked-${item.id}`, type: 'inspection', date: item.createdAt || new Date().toISOString(), label: 'Sopralluogo separato da Danea', actor: roleName(), detail: `${item.date || ''} ${item.time || ''}`.trim() });
    save();
    render();
    alert('Sopralluogo separato. Ora il preventivo AI userà soltanto i dati di questo sopralluogo.');
  };

  window.inspectionDaneaSeparationButton = function (item) {
    const intervention = (db.interventions || []).find((entry) => String(entry.id) === String(item?.interventionId || ''));
    return isDaneaIntervention(intervention)
      ? `<button class="btn sm red" onclick="separateInspectionFromDanea('${item.id}')">Separa dalla richiesta Danea</button>`
      : '';
  };

  async function uploadInspectionMedia(item, files) {
    const selected = Array.from(files || []).filter((file) => file?.size);
    if (!selected.length) return [];
    if (!window.EdilKappaCloud?.ready || !window.EdilKappaCloud?.uploadMedia) throw new Error('Serve la connessione al cloud per salvare foto e video.');
    const result = [];
    for (const [index, file] of selected.entries()) {
      const stored = await window.EdilKappaCloud.uploadMedia(file, {
        mediaId: `inspection-${item.id}-${Date.now()}-${index}`,
        category: 'Sopralluogo eseguito', client: item.client, interventionId: item.interventionId
      });
      result.push({ ...stored, kind: String(stored.fileType || '').startsWith('video/') ? 'video' : 'image', photoOrigin: 'sopralluogo_edilkappa' });
    }
    return result;
  }

  window.completeInspection = function (id) {
    const item = (db.inspections || []).find((entry) => entry.id === id);
    if (!item) return alert('Sopralluogo non trovato.');
    const intervention = window.ensureInspectionIntervention(item);
    const mediaCount = Array.isArray(item.media) ? item.media.length : 0;
    modal('Sopralluogo eseguito', `<div class="notice"><b>${esc(item.client)}</b><br>${esc(item.address || '')}<br>Intervento: ${esc(intervention.title)}</div><div style="height:14px"></div><div class="formGrid">
      <div class="field full"><label>Esito del sopralluogo</label><textarea name="outcome" required placeholder="Che cosa hai verificato e qual è la causa del problema?">${esc(item.outcome || '')}</textarea></div>
      <div class="field full"><label>Misure rilevate</label><textarea name="measurements" placeholder="Metri, superfici, spessori, quantità e altre misure">${esc(item.measurements || '')}</textarea></div>
      <div class="field full"><label>Lavorazioni consigliate</label><textarea name="recommendations" required placeholder="Come consigli di risolvere il problema?">${esc(item.recommendations || '')}</textarea></div>
      <div class="field full"><label>Note tecniche</label><textarea name="technicalNotes" placeholder="Accesso, sicurezza, materiali, difficoltà o richieste del cliente">${esc(item.technicalNotes || '')}</textarea></div>
      <div class="field full"><label>Foto e video del sopralluogo</label><input name="media" type="file" accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" capture="environment" multiple><small>${mediaCount ? `${mediaCount} file già salvati. ` : ''}Puoi aggiungere più foto e video.</small></div>
    </div>`, async (formData) => {
      const addedMedia = await uploadInspectionMedia(item, formData.getAll('media'));
      item.outcome = String(formData.get('outcome') || '').trim();
      item.measurements = String(formData.get('measurements') || '').trim();
      item.recommendations = String(formData.get('recommendations') || '').trim();
      item.technicalNotes = String(formData.get('technicalNotes') || '').trim();
      item.media = (item.media || []).concat(addedMedia);
      item.status = 'Da preventivare';
      item.completedAt = new Date().toISOString();
      intervention.status = 'Da preventivare';
      timeline(intervention, { id: `inspection-completed-${item.id}`, type: 'inspection', date: item.completedAt, label: 'Sopralluogo eseguito', actor: roleName(), detail: item.outcome });
      const inspectionToSave = structuredClone(item);
      const interventionToSave = structuredClone({ ...intervention, recordType: 'Intervention' });
      save();
      if (window.EdilKappaCloud?.ready) {
        await window.EdilKappaCloud.syncRecord('inspections', inspectionToSave);
        await window.EdilKappaCloud.syncRecord('documents', interventionToSave);
      }
    });
  };

  window.prepareInspectionQuoteAI = async function (id) {
    const item = (db.inspections || []).find((entry) => entry.id === id);
    if (!item) return alert('Sopralluogo non trovato.');
    if (!item.completedAt || !item.outcome) return window.completeInspection(id);
    window.ensureInspectionIntervention(item);
    const loading = window.EdilKappaLoader?.ensureView?.('ai');
    go('ai');
    try {
      if (loading) await loading;
      if (!window.edilkappaAiPrepareInspection) throw new Error('EdilKappa AI non è ancora disponibile.');
      await window.edilkappaAiPrepareInspection(id);
    } catch (error) { alert(error?.message || 'Non riesco a preparare il preventivo.'); }
  };
})();
