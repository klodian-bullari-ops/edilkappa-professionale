(function () {
  'use strict';

  const pendingInspectionMedia = new Map();

  const style = document.createElement('style');
  style.textContent = `
    .inspectionMediaFile .inspectionMediaActions{display:flex;gap:6px;flex:0 0 auto}
    @media(max-width:520px){.inspectionMediaFile{align-items:flex-start;flex-wrap:wrap}.inspectionMediaFile .inspectionMediaActions{width:100%;justify-content:flex-end}}
  `;
  document.head.appendChild(style);

  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('it');
  }

  function inspectionMediaStatus(message, tone = 'muted') {
    const status = document.getElementById('inspectionMediaStatus');
    if (!status) return;
    status.textContent = message;
    status.style.color = tone === 'error' ? '#b42318' : tone === 'success' ? '#18794e' : '#667085';
  }

  function mediaSelection(id, formData) {
    const submitted = formData?.getAll?.('media') || [];
    const remembered = pendingInspectionMedia.get(id)?.files || [];
    if (window.EdilKappaMedia?.selectedFiles) return window.EdilKappaMedia.selectedFiles(submitted, remembered);
    const usable = (files) => Array.from(files || []).filter((file) => file?.size);
    const formFiles = usable(submitted);
    return formFiles.length ? formFiles : usable(remembered);
  }

  window.rememberInspectionMedia = function (id, input) {
    const files = window.EdilKappaMedia?.usableFiles
      ? window.EdilKappaMedia.usableFiles(input?.files)
      : Array.from(input?.files || []).filter((file) => file?.size);
    pendingInspectionMedia.set(id, { files, touched: true });
    if (!files.length) {
      inspectionMediaStatus('Il telefono non ha consegnato le foto. Riapri “Scegli foto e video” e selezionale di nuovo.', 'error');
      return;
    }
    const names = files.slice(0, 3).map((file) => file.name).join(', ');
    const remaining = files.length > 3 ? ` e altri ${files.length - 3}` : '';
    inspectionMediaStatus(`${files.length} file selezionati: ${names}${remaining}`, 'success');
  };

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
      inspectionMediaStatus(`Caricamento ${index + 1} di ${selected.length}: ${file.name} · 0%`);
      const stored = await window.EdilKappaCloud.uploadMedia(file, {
        mediaId: `inspection-${item.id}-${Date.now()}-${index}`,
        category: 'Sopralluogo eseguito', client: item.client, interventionId: item.interventionId,
        onProgress: ({ progress }) => inspectionMediaStatus(`Caricamento ${index + 1} di ${selected.length}: ${file.name} · ${progress}%`)
      });
      result.push({ ...stored, kind: String(stored.fileType || '').startsWith('video/') ? 'video' : 'image', photoOrigin: 'sopralluogo_edilkappa' });
    }
    inspectionMediaStatus(`${result.length} file caricati. Salvataggio del sopralluogo…`, 'success');
    return result;
  }

  function inspectionMediaFiles(item) {
    return Array.isArray(item?.media) ? item.media : [];
  }

  function inspectionMediaType(file) {
    const type = String(file?.fileType || '').toLowerCase();
    if (type.startsWith('video/')) return 'Video';
    if (type.includes('heic') || type.includes('heif') || /\.(heic|heif)$/i.test(file?.fileName || '')) return 'Foto HEIC';
    return 'Fotografia';
  }

  function inspectionMediaSize(file) {
    const bytes = Number(file?.fileSize || 0);
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function inspectionMediaListHtml(item) {
    const files = inspectionMediaFiles(item);
    if (!files.length) return '<div class="empty">Nessuna foto o video ancora salvato.</div>';
    return `<div class="mediaFileList">${files.map((file, index) => {
      const kind = inspectionMediaType(file);
      const size = inspectionMediaSize(file);
      const icon = kind === 'Video' ? '🎬' : '📷';
      return `<div class="mediaFile inspectionMediaFile"><span>${icon}</span><div><b>${esc(file.fileName || `Allegato ${index + 1}`)}</b><small>${kind}${size ? ` · ${size}` : ''}</small></div><span class="inspectionMediaActions"><button class="btn sm light" type="button" onclick="openInspectionMedia('${esc(item.id)}',${index})">Apri</button><button class="btn sm red" type="button" onclick="deleteInspectionMedia('${esc(item.id)}',${index},this)">Elimina</button></span></div>`;
    }).join('')}</div>`;
  }

  function refreshInspectionMediaList(id) {
    const item = (db.inspections || []).find((entry) => entry.id === id);
    const container = document.getElementById('inspectionSavedMedia');
    if (item && container) container.innerHTML = inspectionMediaListHtml(item);
  }

  window.openInspectionMedia = async function (id, index) {
    const item = (db.inspections || []).find((entry) => entry.id === id);
    const file = inspectionMediaFiles(item)[index];
    if (!file?.storagePath) return alert('File multimediale non disponibile.');
    try {
      await window.EdilKappaCloud?.openDocument?.(file.storagePath);
    } catch (error) {
      alert(error?.message || 'Impossibile aprire il file.');
    }
  };

  window.deleteInspectionMedia = async function (id, index, button) {
    const item = (db.inspections || []).find((entry) => entry.id === id);
    const files = inspectionMediaFiles(item);
    const file = files[index];
    if (!item || !file) return alert('Allegato non trovato. Riapri il sopralluogo e riprova.');
    const fileName = file.fileName || `allegato ${index + 1}`;
    if (!confirm(`Eliminare definitivamente “${fileName}”? Le altre foto e i video resteranno salvati.`)) return;
    const cloud = window.EdilKappaCloud;
    if (!cloud?.ready || !cloud?.syncRecord || (file.storagePath && !cloud?.deleteDocument)) {
      return alert('Serve la connessione al cloud per eliminare una foto in sicurezza. Riprova quando compare “Sincronizzato”.');
    }

    const previousLabel = button?.textContent || 'Elimina';
    if (button) {
      button.disabled = true;
      button.textContent = 'Elimino…';
    }

    let storageDeleted = false;
    const remainingMedia = files.filter((_, position) => position !== index);
    const updatedAt = new Date().toISOString();
    try {
      if (file.storagePath) {
        await cloud.deleteDocument(file.storagePath);
        storageDeleted = true;
      }
      const inspectionToSave = structuredClone({ ...item, media: remainingMedia, updatedAt });
      await cloud.syncRecord('inspections', inspectionToSave);
      item.media = remainingMedia;
      item.updatedAt = updatedAt;
      save();
      refreshInspectionMediaList(id);
      inspectionMediaStatus(`${fileName} eliminato. Restano ${remainingMedia.length} file salvati.`, 'success');
    } catch (error) {
      if (storageDeleted) {
        item.media = remainingMedia;
        item.updatedAt = updatedAt;
        save();
        refreshInspectionMediaList(id);
        inspectionMediaStatus(`${fileName} eliminato. Sincronizzazione della scheda in corso…`);
        alert('Il file è stato eliminato. La scheda del sopralluogo verrà riallineata automaticamente appena la connessione torna stabile.');
        return;
      }
      if (button) {
        button.disabled = false;
        button.textContent = previousLabel;
      }
      alert(error?.message || 'Non è stato possibile eliminare il file. Nessun allegato è stato modificato.');
    }
  };

  window.completeInspection = function (id) {
    const item = (db.inspections || []).find((entry) => entry.id === id);
    if (!item) return alert('Sopralluogo non trovato.');
    const intervention = window.ensureInspectionIntervention(item);
    const mediaCount = Array.isArray(item.media) ? item.media.length : 0;
    pendingInspectionMedia.delete(id);
    modal('Sopralluogo eseguito', `<div class="notice"><b>${esc(item.client)}</b><br>${esc(item.address || '')}<br>Intervento: ${esc(intervention.title)}</div><div style="height:14px"></div><div class="formGrid">
      <div class="field full"><label>Esito del sopralluogo</label><textarea name="outcome" required placeholder="Che cosa hai verificato e qual è la causa del problema?">${esc(item.outcome || '')}</textarea></div>
      <div class="field full"><label>Misure rilevate</label><textarea name="measurements" placeholder="Metri, superfici, spessori, quantità e altre misure">${esc(item.measurements || '')}</textarea></div>
      <div class="field full"><label>Lavorazioni consigliate</label><textarea name="recommendations" required placeholder="Come consigli di risolvere il problema?">${esc(item.recommendations || '')}</textarea></div>
      <div class="field full"><label>Note tecniche</label><textarea name="technicalNotes" placeholder="Accesso, sicurezza, materiali, difficoltà o richieste del cliente">${esc(item.technicalNotes || '')}</textarea></div>
      <div class="field full"><label>Foto e video già salvati</label><div id="inspectionSavedMedia">${inspectionMediaListHtml(item)}</div></div>
      <div class="field full"><label>Scegli foto e video</label><input name="media" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" multiple onchange="rememberInspectionMedia('${esc(item.id)}',this)"><small id="inspectionMediaStatus">${mediaCount ? `${mediaCount} file già salvati. ` : ''}HEIC e HEIF vengono riconosciuti automaticamente. Dal telefono puoi usare Fotocamera, Libreria foto o Sfoglia.</small></div>
    </div>`, async (formData) => {
      const selectedMedia = mediaSelection(id, formData);
      const pending = pendingInspectionMedia.get(id);
      if (pending?.touched && !selectedMedia.length) throw new Error('Le foto selezionate non sono state acquisite dal telefono. Riapri la libreria e selezionale di nuovo.');
      const addedMedia = await uploadInspectionMedia(item, selectedMedia);
      if (selectedMedia.length && addedMedia.length !== selectedMedia.length) throw new Error('Non tutte le foto sono state caricate. Riprova senza chiudere questa finestra.');

      const currentItem = (db.inspections || []).find((entry) => entry.id === id) || item;
      const currentIntervention = (db.interventions || []).find((entry) => String(entry.id) === String(currentItem.interventionId || intervention.id)) || intervention;
      currentItem.outcome = String(formData.get('outcome') || '').trim();
      currentItem.measurements = String(formData.get('measurements') || '').trim();
      currentItem.recommendations = String(formData.get('recommendations') || '').trim();
      currentItem.technicalNotes = String(formData.get('technicalNotes') || '').trim();
      currentItem.media = (currentItem.media || []).concat(addedMedia);
      currentItem.status = 'Da preventivare';
      currentItem.completedAt = new Date().toISOString();
      currentIntervention.status = 'Da preventivare';
      timeline(currentIntervention, { id: `inspection-completed-${currentItem.id}`, type: 'inspection', date: currentItem.completedAt, label: 'Sopralluogo eseguito', actor: roleName(), detail: currentItem.outcome });
      const inspectionToSave = structuredClone(currentItem);
      const interventionToSave = structuredClone({ ...currentIntervention, recordType: 'Intervention' });
      save();
      if (window.EdilKappaCloud?.ready) {
        await window.EdilKappaCloud.syncRecord('inspections', inspectionToSave);
        await window.EdilKappaCloud.syncRecord('documents', interventionToSave);
      }
      pendingInspectionMedia.delete(id);
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
