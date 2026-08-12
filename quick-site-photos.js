(function () {
  'use strict';

  function database() {
    return window.EdilKappaLocal?.getDB?.() || {};
  }

  function profileRole() {
    return window.EdilKappaCloud?.currentProfile?.role || '';
  }

  function ownerAccess() {
    return profileRole() === 'owner' || window.role === 'owner';
  }

  function officeAccess() {
    return ['owner', 'office'].includes(profileRole()) || (typeof isOffice === 'function' && isOffice());
  }

  function currentTeam() {
    return typeof currentTeamId === 'function' ? currentTeamId() : '';
  }

  function currentWorkerName() {
    return typeof roleName === 'function' ? roleName() : 'Operaio';
  }

  function currentWorkerId() {
    return typeof currentStaff === 'function' ? currentStaff()?.id || '' : '';
  }

  function visibleSites() {
    const rows = database().sites || [];
    const allowed = officeAccess() ? rows : rows.filter((site) => typeof siteHasTeam === 'function'
      ? siteHasTeam(site, currentTeam())
      : String(site.worker || '') === String(currentTeam()));
    return allowed.slice().sort((left, right) => {
      const leftDone = left.status === 'Completato' ? 1 : 0;
      const rightDone = right.status === 'Completato' ? 1 : 0;
      return leftDone - rightDone || String(left.title || '').localeCompare(String(right.title || ''), 'it');
    });
  }

  function quoteRows() {
    return (database().quotes || []).slice().sort((left, right) =>
      String(right.date || '').localeCompare(String(left.date || ''))
    );
  }

  function albumPhotoCount(item) {
    return Math.max(Number(item?.photoCount || 0), Array.isArray(item?.photos) ? item.photos.length : 0);
  }

  function photoAlbums(siteId = '') {
    return (database().reports || [])
      .filter((item) => {
        const linkedSiteId = item.site || item.siteId || '';
        const belongsToSite = !siteId || String(linkedSiteId) === String(siteId);
        return belongsToSite && (item.photoOnly === true || albumPhotoCount(item) > 0);
      })
      .sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
  }

  function siteOptions(selected = '') {
    return visibleSites().map((site) =>
      `<option value="${esc(site.id)}" ${String(site.id) === String(selected) ? 'selected' : ''}>${esc(site.title)} · ${esc(site.client || '')} · ${esc(site.address || '')}</option>`
    ).join('');
  }

  function quoteOptions() {
    return quoteRows().map((quote) =>
      `<option value="${esc(quote.id)}">${esc(quote.code || 'Preventivo')} · ${esc(quote.client || '')} · ${esc(quote.subject || '')}</option>`
    ).join('');
  }

  window.quickPhotoTargetChanged = function (form) {
    const isQuote = form?.elements?.targetType?.value === 'quote';
    const siteField = form?.querySelector('[data-quick-site]');
    const quoteField = form?.querySelector('[data-quick-quote]');
    const statusField = form?.querySelector('[data-quick-status]');
    if (siteField) siteField.hidden = isQuote;
    if (quoteField) quoteField.hidden = !isQuote;
    if (statusField) statusField.hidden = isQuote;
    if (form?.elements?.site) form.elements.site.required = !isQuote;
    if (form?.elements?.quote) form.elements.quote.required = isQuote;
  };

  async function uploadPhotos(files, options) {
    if (!window.EdilKappaCloud?.ready || !window.EdilKappaCloud?.uploadMedia) {
      throw new Error('Accedi al gestionale e controlla la connessione prima di caricare le fotografie.');
    }
    const selected = Array.from(files || []).filter((file) => file?.size);
    if (!selected.length) throw new Error('Seleziona almeno una fotografia.');
    const uploaded = [];
    for (const [index, file] of selected.entries()) {
      const isImage = String(file.type || '').startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
      if (!isImage) throw new Error(`${file.name} non è una fotografia supportata.`);
      const stored = await window.EdilKappaCloud.uploadMedia(file, {
        mediaId: `${options.batchId}-${index}`,
        category: options.category,
        client: options.client,
        interventionId: options.interventionId || ''
      });
      uploaded.push({
        ...stored,
        phase: options.status || 'Fotografia',
        name: stored.fileName,
        type: stored.fileType,
        quickPhoto: true,
        batchId: options.batchId,
        uploadedBy: window.EdilKappaCloud?.currentUid || '',
        uploadedByName: currentWorkerName()
      });
    }
    return uploaded;
  }

  window.openQuickPhotoUpload = function (siteId = '') {
    const sites = visibleSites();
    const quotes = ownerAccess() ? quoteRows() : [];
    if (!sites.length && !quotes.length) {
      return alert(ownerAccess()
        ? 'Crea prima un cantiere o un preventivo.'
        : 'Non hai cantieri assegnati alla tua squadra.');
    }
    const ownerFields = ownerAccess()
      ? `<div class="field"><label>Dove vuoi salvare le foto?</label><select name="targetType" onchange="quickPhotoTargetChanged(this.form)"><option value="site">Cantiere</option><option value="quote">Preventivo</option></select></div>`
      : '';
    modal('Carica fotografie', `<div class="notice"><b>Nessuna descrizione necessaria.</b><br>Scegli il cantiere, indica soltanto lo stato e seleziona le fotografie.</div><div style="height:14px"></div>
      <div class="formGrid">
        ${ownerFields}
        <div class="field ${ownerFields ? '' : 'full'}" data-quick-site><label>Cantiere</label><select name="site" required>${siteOptions(siteId)}</select></div>
        ${ownerAccess() ? `<div class="field" data-quick-quote hidden><label>Preventivo</label><select name="quote">${quoteOptions()}</select></div>` : ''}
        <div class="field" data-quick-status><label>Stato</label><select name="status"><option>In corso</option><option>Completato</option></select></div>
        <div class="field full"><label>Fotografie</label><input name="photos" type="file" accept="image/*,.heic,.heif" multiple required><small>Puoi scattare le foto adesso oppure selezionarle dalla galleria.</small></div>
      </div>`,
    async (formData) => {
      const targetType = ownerAccess() ? String(formData.get('targetType') || 'site') : 'site';
      const batchId = uid('foto');
      if (targetType === 'quote') {
        const quote = quoteRows().find((item) => String(item.id) === String(formData.get('quote')));
        if (!quote) throw new Error('Seleziona un preventivo valido.');
        const uploaded = await uploadPhotos(formData.getAll('photos'), {
          batchId,
          category: 'Preventivo - fotografie',
          client: quote.client,
          interventionId: quote.interventionId
        });
        quote.media = (Array.isArray(quote.media) ? quote.media : []).concat(uploaded);
        quote.updatedAt = new Date().toISOString();
        setTimeout(() => alert(`${uploaded.length} fotografie salvate nel preventivo ${quote.code || ''}.`), 80);
        return;
      }

      const site = sites.find((item) => String(item.id) === String(formData.get('site')));
      if (!site) throw new Error('Seleziona un cantiere valido.');
      const status = formData.get('status') === 'Completato' ? 'Completato' : 'In corso';
      const uploaded = await uploadPhotos(formData.getAll('photos'), {
        batchId,
        category: 'Foto cantiere',
        client: site.client,
        interventionId: site.interventionId,
        status
      });
      const now = new Date().toISOString();
      database().reports = database().reports || [];
      database().reports.push({
        id: batchId,
        photoOnly: true,
        albumType: 'Cantiere',
        site: site.id,
        siteId: site.id,
        client: site.client,
        clientId: site.clientId || '',
        address: site.address,
        worker: currentWorkerId(),
        workerUid: window.EdilKappaCloud?.currentUid || '',
        workerName: currentWorkerName(),
        workDate: now.slice(0, 10),
        date: now,
        status,
        photos: uploaded,
        photoCount: uploaded.length,
        createdAt: now,
        updatedAt: now
      });
      site.status = status;
      site.updatedAt = now;
      setTimeout(() => alert(`${uploaded.length} fotografie salvate separatamente nel cantiere ${site.title}.`), 80);
    });
    setTimeout(() => {
      const form = document.getElementById('modalForm');
      if (form) window.quickPhotoTargetChanged(form);
    }, 0);
  };

  window.openQuickSitePhoto = async function (albumId, photoIndex) {
    const album = photoAlbums().find((item) => String(item.id) === String(albumId));
    const photo = album?.photos?.[photoIndex];
    if (!photo) return alert('Fotografia non disponibile.');
    try {
      if (photo.storagePath) return await window.EdilKappaCloud?.openDocument?.(photo.storagePath);
      if ((photo.key || photo.attachmentId) && typeof window.openReportPhoto === 'function') {
        return await window.openReportPhoto(album.id, photoIndex);
      }
      if (photo.attachmentId) return await window.EdilKappaCloud?.openAttachment?.(photo.attachmentId);
      const directUrl = photo.url || photo.dataUrl || '';
      if (directUrl) return window.open(directUrl, '_blank', 'noopener');
      alert('Fotografia non disponibile su questo dispositivo.');
    } catch (error) {
      alert(error.message || 'Impossibile aprire la fotografia.');
    }
  };

  function albumHtml(album) {
    const linkedSiteId = album.site || album.siteId || '';
    const site = (database().sites || []).find((item) => String(item.id) === String(linkedSiteId)) || {};
    const sourceLabel = album.photoOnly === true ? 'Album fotografico' : (album.code ? `Rapportino ${album.code}` : 'Rapportino con foto');
    const photos = (album.photos || []).map((photo, index) =>
      `<button class="photoTile" type="button" onclick="openQuickSitePhoto('${esc(album.id)}',${index})"><strong>📷 Foto ${index + 1}</strong><small>${esc(photo.fileName || photo.name || '')}</small></button>`
    ).join('');
    const unavailable = !photos && albumPhotoCount(album)
      ? `<div class="notice">${albumPhotoCount(album)} foto registrate nel vecchio rapportino, ma i file non sono disponibili su questo dispositivo.</div>`
      : '';
    const remove = ownerAccess()
      && album.photoOnly === true
      ? `<button class="btn sm red" type="button" onclick="deleteQuickPhotoAlbum('${esc(album.id)}')">Elimina album</button>`
      : '';
    return `<section class="card quickPhotoAlbum"><div class="cardHead"><div><h3>${esc(sourceLabel)}</h3><small>${esc(site.title || 'Cantiere')} · ${esc(album.workDate || String(album.date || '').slice(0, 10))} · ${esc(album.workerName || 'Operaio')} · ${albumPhotoCount(album)} foto</small></div>${badge(album.status || 'In corso')}</div><div class="photoGrid">${photos}</div>${unavailable}${remove ? `<div class="actions" style="margin-top:12px">${remove}</div>` : ''}</section>`;
  }

  window.openQuickPhotoAlbums = function (siteId = '') {
    const site = (database().sites || []).find((item) => String(item.id) === String(siteId));
    const albums = photoAlbums(siteId);
    const totalPhotos = albums.reduce((total, album) => total + albumPhotoCount(album), 0);
    const dialog = document.getElementById('modal');
    const content = document.getElementById('modalContent');
    if (!dialog || !content) return;
    content.innerHTML = `<div class="modalHead"><div><h3>Foto ${esc(site?.title || 'cantieri')}</h3><small>${totalPhotos} fotografie · ${albums.length} album e rapportini</small></div><button class="close" type="button" onclick="closeModal()">×</button></div>
      <div class="modalBody"><div class="actions" style="margin-bottom:14px"><button class="btn lime" type="button" onclick="closeModal();openQuickPhotoUpload('${esc(siteId)}')">＋ Carica foto</button>${totalPhotos && typeof window.openSitePhotoShare === 'function' ? `<button class="btn green" type="button" onclick="openSitePhotoShare('${esc(siteId)}')">↗ Condividi foto</button>` : ''}</div>
      <div class="list">${albums.map(albumHtml).join('') || '<div class="empty">Nessuna fotografia caricata per questo cantiere.</div>'}</div></div>
      <div class="modalFoot"><button class="btn light" type="button" onclick="closeModal()">Chiudi</button></div>`;
    dialog.showModal();
  };

  window.deleteQuickPhotoAlbum = async function (albumId) {
    if (!ownerAccess()) return alert('Solo il titolare può eliminare un album.');
    const albums = database().reports || [];
    const album = albums.find((item) => String(item.id) === String(albumId) && item.photoOnly === true);
    if (!album) return;
    closeModal();
    await deleteItem('reports', album.id, `questo album di ${album.photoCount || 0} fotografie`);
  };

  window.captureInfo = window.openQuickPhotoUpload;

  function countForSite(siteId) {
    return photoAlbums(siteId).reduce((total, album) => total + albumPhotoCount(album), 0);
  }

  function makeButton(label, handler, className = 'btn sm green') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.dataset.quickPhotoButton = 'true';
    button.addEventListener('click', handler);
    return button;
  }

  function enhanceSiteButtons() {
    document.querySelectorAll('button[onclick*="openSite("], button[onclick*="openReport("]').forEach((source) => {
      if (source.dataset.quickPhotoChecked) return;
      source.dataset.quickPhotoChecked = 'true';
      if (source.closest('[data-home-priority]')) return;
      const action = source.getAttribute('onclick') || '';
      const match = action.match(/(?:openSite|openReport)\('([^']+)'\)/);
      if (!match) return;
      const siteId = match[1];
      if (!visibleSites().some((site) => String(site.id) === String(siteId))) return;
      const actions = source.closest('.actions') || source.parentElement;
      if (!actions || actions.querySelector(`[data-quick-site="${CSS.escape(siteId)}"]`)) return;
      const count = countForSite(siteId);
      const button = makeButton(`📷 Foto${count ? ` (${count})` : ''}`, () => window.openQuickPhotoAlbums(siteId), 'btn sm light');
      button.dataset.quickSite = siteId;
      source.insertAdjacentElement('afterend', button);
    });
  }

  function installGlobalButton() {
    if (!window.EdilKappaCloud?.ready || document.getElementById('quickPhotoGlobal')) return;
    if (!officeAccess() && !currentTeam()) return;
    const actions = document.querySelector('.topActions');
    if (!actions) return;
    const button = makeButton('📷 Foto', () => window.openQuickPhotoUpload(), 'btn sm lime quickPhotoGlobal');
    button.id = 'quickPhotoGlobal';
    button.innerHTML = '<span aria-hidden="true">📷</span><span class="quickPhotoLabel"> Foto</span>';
    actions.prepend(button);
  }

  function installWorkerButton() {
    const quick = document.querySelector('.workerHero + .grid.quick');
    if (!quick || quick.querySelector('[data-quick-photo-worker]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.quickPhotoWorker = 'true';
    button.innerHTML = '<span>📷</span>Carica foto';
    button.addEventListener('click', () => window.openQuickPhotoUpload());
    quick.prepend(button);
  }

  function enhance() {
    installGlobalButton();
    if (!officeAccess()) installWorkerButton();
    enhanceSiteButtons();
  }

  const style = document.createElement('style');
  style.textContent = `
    .quickPhotoGlobal{white-space:nowrap}
    .quickPhotoAlbum .photoGrid{margin-top:12px}
    @media(max-width:620px){.quickPhotoGlobal{padding:9px}.quickPhotoLabel{display:none}}
  `;
  document.head.appendChild(style);

  let queued = false;
  function queueEnhance() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhance();
    });
  }

  new MutationObserver(queueEnhance).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('load', queueEnhance);
  queueEnhance();
})();
