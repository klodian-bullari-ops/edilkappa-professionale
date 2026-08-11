(function () {
  'use strict';

  const NOTIFICATIONS_KEY = 'edilkappa_activity_notifications_v1';
  const SNAPSHOT_KEY = 'edilkappa_activity_snapshot_v1';
  const BROWSER_NOTIFICATIONS_KEY = 'edilkappa_activity_browser_notifications_v1';
  const FEATURE_RELEASE_AT = '2026-08-03T20:15:00.000Z';
  const COMPLETED_PATTERN = /complet|conclus|chius|eseguit|fatturat/i;
  const MAX_NOTIFICATIONS = 120;
  let completedFilter = 'all';
  let completedQuery = '';
  let activityFilter = 'unread';

  function database() {
    return window.EdilKappaLocal?.getDB?.() || db || {};
  }

  function isOfficeUser() {
    const cloudRole = window.EdilKappaCloud?.currentProfile?.role;
    return ['owner', 'office'].includes(cloudRole) || (typeof isOffice === 'function' && isOffice());
  }

  function isCompleted(value) {
    return COMPLETED_PATTERN.test(String(value || ''));
  }

  function parseStored(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function notifications() {
    const rows = parseStored(NOTIFICATIONS_KEY, []);
    return Array.isArray(rows) ? rows : [];
  }

  function storeNotifications(rows) {
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(rows.slice(0, MAX_NOTIFICATIONS)));
    updateActivityBell();
  }

  function activitySnapshot() {
    const value = parseStored(SNAPSHOT_KEY, {});
    return value && typeof value === 'object' ? value : {};
  }

  function storeActivitySnapshot(value) {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(value));
  }

  function dateValue(value) {
    const stamp = new Date(value || 0).getTime();
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function dateText(value, withTime = false) {
    if (!value) return 'Data da definire';
    const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('it-IT', withTime
      ? { dateStyle: 'short', timeStyle: 'short' }
      : { dateStyle: 'short' });
  }

  function latestDate(values) {
    return values.filter(Boolean).sort((left, right) => dateValue(right) - dateValue(left))[0] || '';
  }

  function currentUserId() {
    return window.EdilKappaCloud?.currentUid || '';
  }

  async function showBrowserNotification(item) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (localStorage.getItem(BROWSER_NOTIFICATIONS_KEY) !== '1') return;
    const options = {
      body: item.text,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: item.id,
      data: { url: `./?activity=${encodeURIComponent(item.id)}` }
    };
    try {
      const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready : null;
      if (registration) await registration.showNotification(item.title, options);
      else new Notification(item.title, options);
    } catch (_) { /* Gli avvisi nel gestionale restano sempre disponibili. */ }
  }

  function addActivity(item) {
    const rows = notifications();
    if (rows.some((entry) => entry.id === item.id)) return false;
    const activity = {
      readAt: '',
      createdAt: new Date().toISOString(),
      ...item
    };
    rows.unshift(activity);
    storeNotifications(rows);
    showBrowserNotification(activity);
    return true;
  }

  function reportPhotoCount(report) {
    return Math.max(Number(report.photoCount || 0), Array.isArray(report.photos) ? report.photos.length : 0);
  }

  function reportLatestAt(report) {
    return latestDate([
      report.__cloudUpdatedAt,
      report.updatedAt,
      report.createdAt,
      report.date,
      ...(report.photos || []).map((photo) => photo.uploadedAt)
    ]);
  }

  function reportActorId(report) {
    return String(report.workerUid || report.photos?.find((photo) => photo.uploadedBy)?.uploadedBy || '');
  }

  function reportActorName(report) {
    return report.workerName || report.photos?.find((photo) => photo.uploadedByName)?.uploadedByName || 'Squadra';
  }

  function reportSite(report) {
    return (database().sites || []).find((site) => String(site.id) === String(report.site || report.siteId)) || {};
  }

  function freshEnough(value) {
    return dateValue(value) >= dateValue(FEATURE_RELEASE_AT);
  }

  function detectReportActivities(snapshot) {
    const reports = database().reports || [];
    const previous = snapshot.reports;
    const next = {};
    let changed = false;

    reports.forEach((report) => {
      const count = reportPhotoCount(report);
      const updatedAt = reportLatestAt(report);
      next[report.id] = { count, updatedAt, status: report.status || '' };
      const old = previous?.[report.id];
      const hasNewPhotos = count > 0 && (!old || count > Number(old.count || 0));
      if (!hasNewPhotos || !freshEnough(updatedAt) || reportActorId(report) === currentUserId()) return;
      const site = reportSite(report);
      const completed = isCompleted(report.status) || isCompleted(site.status);
      const title = completed ? `${count} foto caricate · lavoro completato` : `${count} foto caricate`;
      const text = `${site.title || report.client || 'Cantiere'} · ${reportActorName(report)}`;
      changed = addActivity({
        id: `photos:${report.id}:${count}`,
        event: completed ? 'photos-completed' : 'photos',
        title,
        text,
        targetType: 'report',
        targetId: report.id,
        siteId: site.id || report.site || report.siteId || '',
        clientId: site.clientId || report.clientId || '',
        photoCount: count,
        occurredAt: updatedAt
      }) || changed;
    });

    snapshot.reports = next;
    return changed;
  }

  function completionDate(item, kind) {
    const data = database();
    if (kind === 'site') {
      const reportDates = (data.reports || [])
        .filter((report) => String(report.site || report.siteId) === String(item.id))
        .map(reportLatestAt);
      return latestDate([item.completedAt, item.__cloudUpdatedAt, item.updatedAt, ...reportDates, item.start, item.createdAt]);
    }
    return latestDate([item.completedAt, item.__cloudUpdatedAt, item.updatedAt, item.date, item.createdAt]);
  }

  function detectCompletionActivities(snapshot, collectionName, kind, label) {
    const rows = database()[collectionName] || [];
    const previous = snapshot[collectionName];
    const next = {};
    let changed = false;

    rows.forEach((item) => {
      const status = String(item.status || '');
      const occurredAt = completionDate(item, kind);
      next[item.id] = { status, occurredAt };
      const becameCompleted = isCompleted(status) && (!previous?.[item.id] || !isCompleted(previous[item.id].status));
      if (!becameCompleted || !freshEnough(occurredAt)) return;
      const client = item.client || item.name || 'Cliente da definire';
      changed = addActivity({
        id: `completed:${kind}:${item.id}:${dateValue(occurredAt)}`,
        event: 'completed',
        title: `${label} completato`,
        text: `${item.title || item.type || item.category || label} · ${client}`,
        targetType: kind,
        targetId: item.id,
        clientId: item.clientId || '',
        occurredAt
      }) || changed;
    });

    snapshot[collectionName] = next;
    return changed;
  }

  function detectCloudActivities(localName) {
    if (!isOfficeUser()) return;
    const snapshot = activitySnapshot();
    let changed = false;
    if (localName === 'reports') changed = detectReportActivities(snapshot) || changed;
    if (localName === 'sites') changed = detectCompletionActivities(snapshot, 'sites', 'site', 'Cantiere') || changed;
    if (localName === 'documents') changed = detectCompletionActivities(snapshot, 'interventions', 'intervention', 'Intervento') || changed;
    if (localName === 'roofs') changed = detectCompletionActivities(snapshot, 'roofs', 'roof', 'Intervento tetto/gronde') || changed;
    if (localName === 'drains') changed = detectCompletionActivities(snapshot, 'drains', 'drain', 'Intervento pozzetti') || changed;
    storeActivitySnapshot(snapshot);
    if (changed && ['dashboard', 'activityView', 'completedView'].includes(window.EdilKappaLocal?.getView?.())) {
      if (typeof window.EdilKappaLocal?.renderFromCloud === 'function') window.EdilKappaLocal.renderFromCloud();
      else render();
    }
  }

  function reportRowsForSite(siteId) {
    return (database().reports || []).filter((report) => String(report.site || report.siteId) === String(siteId));
  }

  function linkedSites(intervention) {
    return (database().sites || []).filter((site) =>
      String(site.interventionId || '') === String(intervention.id) ||
      (site.daneaRequestId && String(site.daneaRequestId) === String(intervention.daneaRequestId || ''))
    );
  }

  function fileIsImage(file) {
    return String(file?.type || file?.fileType || '').startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file?.name || file?.fileName || '');
  }

  function closeoutData(kind, item) {
    const data = database();
    const sites = kind === 'site' ? [item] : kind === 'intervention' ? linkedSites(item) : [];
    const reports = sites.flatMap((site) => reportRowsForSite(site.id));
    const fullReports = reports.filter((report) => report.photoOnly !== true);
    const reportPhotos = reports.flatMap((report) => report.photos || []);
    const ownFiles = Array.isArray(item.files) ? item.files : [];
    const documents = kind === 'intervention'
      ? (data.documents || []).filter((document) => String(document.interventionId || '') === String(item.id))
      : kind === 'site' && item.interventionId
        ? (data.documents || []).filter((document) => String(document.interventionId || '') === String(item.interventionId))
        : [];
    const documentPhotos = documents.filter((document) => String(document.fileType || '').startsWith('image/'));
    const mediaPhotos = documents.flatMap((document) => document.media || []).filter(fileIsImage);
    const photoCount = reportPhotos.length + ownFiles.filter(fileIsImage).length + documentPhotos.length + mediaPhotos.length;
    const finalPhotoCount = reportPhotos.filter((photo) => /dopo|complet/i.test(photo.phase || '')).length
      + reports.filter((report) => report.photoOnly === true && isCompleted(report.status)).reduce((sum, report) => sum + reportPhotoCount(report), 0)
      + (['roof', 'drain'].includes(kind) && isCompleted(item.status) ? ownFiles.filter(fileIsImage).length : 0);
    const reportReady = fullReports.length > 0 || (['roof', 'drain'].includes(kind) && (item.updates || []).length > 0);
    const documentReady = documents.length > 0 || ownFiles.length > 0 || fullReports.some((report) => report.signature || report.notes);
    return {
      sites,
      reports,
      fullReports,
      documents,
      photoCount,
      finalPhotoCount,
      photoReady: finalPhotoCount > 0,
      reportReady,
      documentReady,
      reviewed: Boolean(item.completionReviewedAt)
    };
  }

  function completedRows() {
    const data = database();
    const rows = [];
    const add = (items, kind, label, title, meta) => items.filter((item) => isCompleted(item.status)).forEach((item) => {
      const closeout = closeoutData(kind, item);
      rows.push({
        id: item.id,
        kind,
        label,
        item,
        title: title(item),
        client: item.client || item.name || 'Cliente da definire',
        address: item.address || '',
        meta: meta(item),
        completedAt: completionDate(item, kind),
        closeout
      });
    });
    add(data.sites || [], 'site', 'Cantiere', (item) => item.title || 'Cantiere', (item) => `${Number(item.progress || 100)}% · ${item.status}`);
    add(data.interventions || [], 'intervention', 'Intervento', (item) => item.title || 'Intervento', (item) => `${item.category || 'Intervento'} · ${item.status}`);
    add(data.roofs || [], 'roof', 'Tetto e gronde', (item) => item.type || 'Intervento tetto', (item) => `${item.frequency || 'Intervento'} · ${item.status}`);
    add(data.drains || [], 'drain', 'Pozzetti e tombini', (item) => item.type || 'Intervento pozzetti', (item) => `${item.area || 'Zona da definire'} · ${item.status}`);
    return rows.sort((left, right) => dateValue(right.completedAt) - dateValue(left.completedAt));
  }

  function completedKindGroup(kind) {
    if (kind === 'site') return 'sites';
    if (kind === 'intervention') return 'interventions';
    return 'maintenance';
  }

  function completedFilterButton(value, label, count) {
    return `<button class="completionFilter ${completedFilter === value ? 'active' : ''}" onclick="setCompletedFilter('${value}')">${esc(label)} <span>${count}</span></button>`;
  }

  function checklistHtml(closeout) {
    const item = (ok, label) => `<span class="closeoutCheck ${ok ? 'ok' : 'missing'}">${ok ? '✓' : '!'} ${esc(label)}</span>`;
    return `<div class="closeoutChecks">${item(closeout.photoReady, 'Foto finali')}${item(closeout.reportReady, 'Rapportino')}${item(closeout.documentReady, 'Documenti')}${item(closeout.reviewed, 'Controllato')}</div>`;
  }

  function completedCard(row) {
    const missing = !row.closeout.photoReady || !row.closeout.reportReady;
    return `<section class="card completedCard ${missing ? 'needsCheck' : ''}">
      <div class="cardHead"><div><span class="pill blue">${esc(row.label)}</span><h3>${esc(row.title)}</h3><small>${esc(row.client)}${row.address ? ` · ${esc(row.address)}` : ''}</small></div>${badge(row.closeout.reviewed ? 'Controllato' : 'Da controllare')}</div>
      <div class="completedMeta"><span>✓ Completato ${esc(dateText(row.completedAt))}</span><span>${esc(row.meta)}</span><span>📷 ${row.closeout.photoCount} foto</span><span>📝 ${row.closeout.fullReports.length} rapportini</span></div>
      ${checklistHtml(row.closeout)}
      ${missing ? '<div class="completionWarning">Prima di archiviare verifica le voci evidenziate.</div>' : ''}
      <div class="actions completedActions"><button class="btn sm green" onclick="openCompletedItem('${row.kind}','${row.id}')">Apri scheda esatta</button><button class="btn sm light" onclick="openCompletedMedia('${row.kind}','${row.id}')">📷 Foto (${row.closeout.photoCount})</button>${!row.closeout.reviewed ? `<button class="btn sm lime" onclick="markCompletionReviewed('${row.kind}','${row.id}')">Segna controllato</button>` : ''}<button class="btn sm light" onclick="reopenCompletedItem('${row.kind}','${row.id}')">Riapri lavoro</button></div>
    </section>`;
  }

  window.setCompletedFilter = function (value) {
    completedFilter = value;
    render();
  };

  window.setCompletedQuery = function (value) {
    completedQuery = String(value || '').trim().toLocaleLowerCase('it');
    render();
    const input = document.getElementById('completedSearch');
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  };

  window.completedView = function () {
    const all = completedRows();
    const needsReview = all.filter((row) => !row.closeout.reviewed || !row.closeout.photoReady || !row.closeout.reportReady);
    const counts = {
      sites: all.filter((row) => row.kind === 'site').length,
      interventions: all.filter((row) => row.kind === 'intervention').length,
      maintenance: all.filter((row) => completedKindGroup(row.kind) === 'maintenance').length
    };
    const rows = all.filter((row) => {
      if (completedFilter === 'review' && !needsReview.includes(row)) return false;
      if (!['all', 'review'].includes(completedFilter) && completedKindGroup(row.kind) !== completedFilter) return false;
      if (!completedQuery) return true;
      return JSON.stringify([row.title, row.client, row.address, row.meta]).toLocaleLowerCase('it').includes(completedQuery);
    });
    return pageHead('Lavori completati', 'Archivio separato di cantieri e interventi conclusi', '<button class="btn light" onclick="go(\'activityView\')">🔔 Avvisi</button>') +
      `<div class="grid stats">${stat('Completati', all.length, '✓')}${stat('Cantieri', counts.sites, '🏗️')}${stat('Interventi', counts.interventions + counts.maintenance, '🛠️')}${stat('Da controllare', needsReview.length, '!')}</div>
      <div class="completedToolbar"><div class="completionFilters">${completedFilterButton('all', 'Tutti', all.length)}${completedFilterButton('sites', 'Cantieri', counts.sites)}${completedFilterButton('interventions', 'Interventi', counts.interventions)}${completedFilterButton('maintenance', 'Manutenzioni', counts.maintenance)}${completedFilterButton('review', 'Da controllare', needsReview.length)}</div><input id="completedSearch" class="search" type="search" placeholder="Cerca cliente, indirizzo o lavoro…" value="${esc(completedQuery)}" oninput="setCompletedQuery(this.value)"></div>
      <div class="list">${rows.map(completedCard).join('') || '<div class="empty">Nessun lavoro completato per questo filtro.</div>'}</div>`;
  };

  function collectionForKind(kind) {
    return kind === 'site' ? 'sites' : kind === 'intervention' ? 'interventions' : kind === 'roof' ? 'roofs' : kind === 'drain' ? 'drains' : '';
  }

  function itemForKind(kind, id) {
    const collectionName = collectionForKind(kind);
    return (database()[collectionName] || []).find((item) => String(item.id) === String(id));
  }

  window.openCompletedItem = function (kind, id) {
    const item = itemForKind(kind, id);
    if (!item) return alert('La scheda del lavoro non è più disponibile.');
    if (kind === 'site') { go('sites'); return setTimeout(() => openSite(id), 0); }
    if (kind === 'intervention') {
      const clientId = item.clientId || (database().condomini || []).find((client) => client.name === item.client)?.id || '';
      if (clientId && typeof window.openClientArchive === 'function') window.openClientArchive(clientId);
      return setTimeout(() => window.openIntervention?.(id, clientId), 0);
    }
    if (kind === 'roof') { go('roofs'); return setTimeout(() => openRoof(id), 0); }
    if (kind === 'drain') { go('drains'); return setTimeout(() => openDrain(id), 0); }
  };

  function mediaRows(kind, item) {
    const closeout = closeoutData(kind, item);
    const rows = [];
    closeout.reports.forEach((report) => (report.photos || []).forEach((photo, index) => rows.push({
      icon: '📷',
      title: photo.fileName || photo.name || `Foto ${index + 1}`,
      meta: `${report.workerName || 'Squadra'} · ${dateText(report.workDate || report.date)}`,
      action: report.photoOnly === true ? `openQuickSitePhoto('${report.id}',${index})` : `openReportPhoto('${report.id}',${index})`
    })));
    (item.files || []).filter(fileIsImage).forEach((file, index) => rows.push({
      icon: '📷', title: file.name || `Foto ${index + 1}`, meta: item.type || 'Intervento', action: `openStoredFile('${file.key}')`
    }));
    closeout.documents.filter((document) => String(document.fileType || '').startsWith('image/')).forEach((document) => rows.push({
      icon: '🖼️', title: document.title || document.fileName || 'Fotografia', meta: document.category || 'Documento', action: `openBusinessDocument('${document.id}')`
    }));
    return rows;
  }

  window.openCompletedMedia = function (kind, id) {
    const item = itemForKind(kind, id);
    if (!item) return alert('Il lavoro non è più disponibile.');
    const rows = mediaRows(kind, item);
    const dialog = document.getElementById('modal');
    const content = document.getElementById('modalContent');
    if (!dialog || !content) return;
    content.innerHTML = `<div class="modalHead"><div><h3>Foto finali</h3><small>${esc(item.title || item.type || item.client || '')}</small></div><button class="close" onclick="closeModal()">×</button></div><div class="modalBody"><div class="list">${rows.map((row) => `<div class="row"><div class="rowIcon">${row.icon}</div><div class="rowBody"><b>${esc(row.title)}</b><small>${esc(row.meta)}</small></div><button class="btn sm green" onclick="${row.action}">Apri</button></div>`).join('') || '<div class="empty">Non risultano ancora fotografie finali.</div>'}</div></div><div class="modalFoot"><button class="btn light" onclick="closeModal()">Chiudi</button></div>`;
    dialog.showModal();
  };

  window.markCompletionReviewed = function (kind, id) {
    const item = itemForKind(kind, id);
    if (!item) return;
    item.completionReviewedAt = new Date().toISOString();
    item.completionReviewedBy = typeof roleName === 'function' ? roleName() : 'Titolare';
    item.updatedAt = item.completionReviewedAt;
    save();
    render();
  };

  window.reopenCompletedItem = function (kind, id) {
    const item = itemForKind(kind, id);
    if (!item || !confirm(`Riaprire “${item.title || item.type || 'questo lavoro'}” e riportarlo In corso?`)) return;
    item.status = 'In corso';
    if (kind === 'site' && Number(item.progress || 0) >= 100) item.progress = 95;
    item.reopenedAt = new Date().toISOString();
    item.updatedAt = item.reopenedAt;
    save();
    render();
  };

  function updateActivityBell() {
    const unread = notifications().filter((item) => !item.readAt).length;
    const button = document.getElementById('activityBell');
    const count = document.getElementById('activityBellCount');
    if (count) { count.textContent = unread > 99 ? '99+' : String(unread); count.hidden = unread === 0; }
    if (button) button.setAttribute('aria-label', unread ? `${unread} nuovi avvisi` : 'Nessun nuovo avviso');
  }

  function installActivityBell() {
    if (!isOfficeUser()) {
      document.getElementById('activityBell')?.remove();
      return;
    }
    if (document.getElementById('activityBell')) return updateActivityBell();
    const actions = document.querySelector('.topActions');
    if (!actions) return;
    const button = document.createElement('button');
    button.id = 'activityBell';
    button.type = 'button';
    button.className = 'activityBell';
    button.onclick = () => go('activityView');
    button.innerHTML = '<span aria-hidden="true">🔔</span><b id="activityBellCount" hidden>0</b>';
    actions.prepend(button);
    updateActivityBell();
  }

  window.setActivityFilter = function (value) {
    activityFilter = value;
    render();
  };

  window.enablePhotoNotifications = async function () {
    if (!('Notification' in window)) return alert('Su questo dispositivo restano disponibili gli avvisi dentro il gestionale.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return alert('Le notifiche del dispositivo non sono state autorizzate. Gli avvisi nel gestionale funzionano comunque.');
    let backgroundEnabled = false;
    try { backgroundEnabled = await window.EdilKappaCloud?.enablePushNotifications?.() === true; }
    catch (error) { console.warn('Notifiche push:', error); }
    localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, '1');
    render();
    alert(backgroundEnabled ? 'Avvisi attivati su questo dispositivo, anche quando l’app è chiusa.' : 'Avvisi attivati mentre usi il gestionale. Per gli avvisi a app chiusa verifica le autorizzazioni del browser.');
  };

  window.markAllActivityRead = function () {
    const now = new Date().toISOString();
    storeNotifications(notifications().map((item) => ({ ...item, readAt: item.readAt || now })));
    render();
  };

  window.clearReadActivity = function () {
    if (!confirm('Eliminare dall’elenco tutti gli avvisi già letti?')) return;
    storeNotifications(notifications().filter((item) => !item.readAt));
    render();
  };

  window.openReportActivity = function (reportId) {
    const report = (database().reports || []).find((item) => String(item.id) === String(reportId));
    if (!report) return alert('Il caricamento fotografico non è più disponibile.');
    const site = reportSite(report);
    const dialog = document.getElementById('modal');
    const content = document.getElementById('modalContent');
    if (!dialog || !content) return;
    const photoOpener = report.photoOnly === true ? 'openQuickSitePhoto' : 'openReportPhoto';
    content.innerHTML = `<div class="modalHead"><div><h3>${esc(report.code || 'Foto del cantiere')}</h3><small>${esc(site.title || report.client || '')} · ${esc(reportActorName(report))}</small></div><button class="close" onclick="closeModal()">×</button></div><div class="modalBody"><div class="notice"><b>${reportPhotoCount(report)} fotografie caricate</b><br>${esc(report.notes || report.status || '')}</div><div class="photoGrid">${(report.photos || []).map((photo, index) => `<button class="photoTile" onclick="${photoOpener}('${report.id}',${index})"><strong>📷 ${esc(photo.phase || `Foto ${index + 1}`)}</strong><small>${esc(photo.name || photo.fileName || '')}</small></button>`).join('') || '<div class="empty">Nessuna fotografia disponibile.</div>'}</div></div><div class="modalFoot"><button class="btn light" onclick="closeModal()">Chiudi</button>${site.id ? `<button class="btn green" onclick="closeModal();go('sites');setTimeout(()=>openSite('${site.id}'),0)">Apri cantiere</button>` : ''}</div>`;
    dialog.showModal();
  };

  window.openActivityNotification = function (id) {
    const rows = notifications();
    const item = rows.find((entry) => entry.id === id);
    if (!item) return;
    item.readAt = item.readAt || new Date().toISOString();
    storeNotifications(rows);
    if (item.targetType === 'report') return window.openReportActivity(item.targetId);
    if (item.targetType === 'ai') return go('ai');
    if (item.targetType === 'absence') return go('attendance');
    if (item.targetType === 'hours') return go('hours');
    if (['site', 'intervention', 'roof', 'drain'].includes(item.targetType)) return window.openCompletedItem(item.targetType, item.targetId);
    go('activityView');
  };

  window.activityView = function () {
    const all = notifications().sort((left, right) => dateValue(right.occurredAt || right.createdAt) - dateValue(left.occurredAt || left.createdAt));
    const unread = all.filter((item) => !item.readAt);
    const rows = activityFilter === 'unread' ? unread : all;
    const browserEnabled = 'Notification' in window && Notification.permission === 'granted' && localStorage.getItem(BROWSER_NOTIFICATIONS_KEY) === '1';
    return pageHead('Avvisi attività', 'Nuove foto, rapportini e lavori completati dalle squadre', `<button class="btn light" onclick="enablePhotoNotifications()">🔔 ${browserEnabled ? 'Avvisi dispositivo attivi' : 'Attiva avvisi dispositivo'}</button>`) +
      `<div class="grid stats">${stat('Nuovi', unread.length, '🔔')}${stat('Foto ricevute', all.filter((item) => item.event?.startsWith('photos')).length, '📷')}${stat('Lavori completati', all.filter((item) => item.event === 'completed').length, '✓')}${stat('Totali', all.length, '▦')}</div>
      <div class="activityToolbar"><div class="completionFilters"><button class="completionFilter ${activityFilter === 'unread' ? 'active' : ''}" onclick="setActivityFilter('unread')">Da leggere <span>${unread.length}</span></button><button class="completionFilter ${activityFilter === 'all' ? 'active' : ''}" onclick="setActivityFilter('all')">Tutti <span>${all.length}</span></button></div><div class="actions"><button class="btn sm light" onclick="markAllActivityRead()">Segna tutti letti</button><button class="btn sm light" onclick="clearReadActivity()">Pulisci letti</button></div></div>
      <div class="list">${rows.map((item) => `<section class="card activityCard ${item.readAt ? 'read' : 'unread'}"><div class="row" style="border:0;padding:0"><div class="rowIcon">${item.event?.startsWith('photos') ? '📷' : '✓'}</div><div class="rowBody"><b>${esc(item.title)}</b><small>${esc(item.text)}<br>${esc(dateText(item.occurredAt || item.createdAt, true))}</small></div>${item.readAt ? '<span class="pill blue">Letto</span>' : '<span class="pill orange">Nuovo</span>'}</div><div class="actions" style="margin-top:12px"><button class="btn sm green" onclick="openActivityNotification('${item.id}')">Apri punto esatto</button></div></section>`).join('') || '<div class="empty">Nessun nuovo avviso. Quando una squadra carica fotografie compariranno qui.</div>'}</div>`;
  };

  function dashboardActivityPanel() {
    const unread = notifications().filter((item) => !item.readAt);
    const review = completedRows().filter((row) => !row.closeout.reviewed || !row.closeout.photoReady || !row.closeout.reportReady);
    if (!unread.length && !review.length) return '';
    return `<div class="sectionHead"><h2>Controlli di chiusura</h2></div><div class="grid cols completionDashboard"><section class="card"><div class="cardHead"><h3>Nuove foto e aggiornamenti</h3><button class="btn sm light" onclick="go('activityView')">Vedi tutti</button></div><div class="list">${unread.slice(0, 4).map((item) => `<div class="row"><div class="rowIcon">${item.event?.startsWith('photos') ? '📷' : '✓'}</div><div class="rowBody"><b>${esc(item.title)}</b><small>${esc(item.text)}</small></div><button class="btn sm green" onclick="openActivityNotification('${item.id}')">Apri</button></div>`).join('') || '<div class="okbox">Nessun nuovo caricamento.</div>'}</div></section><section class="card"><div class="cardHead"><h3>Completati da verificare</h3><button class="btn sm light" onclick="go('completedView')">Apri archivio</button></div><div class="list">${review.slice(0, 4).map((row) => `<div class="row"><div class="rowIcon">✓</div><div class="rowBody"><b>${esc(row.title)}</b><small>${esc(row.client)} · ${row.closeout.photoCount} foto</small></div><button class="btn sm green" onclick="openCompletedItem('${row.kind}','${row.id}')">Apri</button></div>`).join('') || '<div class="okbox">Tutti i lavori completati sono controllati.</div>'}</div></section></div>`;
  }

  const style = document.createElement('style');
  style.textContent = `
    .activityBell{position:relative;width:42px;height:42px;display:grid;place-items:center;border:1px solid var(--line);border-radius:13px;background:#fff;font-size:18px;flex:none}.activityBell b{position:absolute;right:-5px;top:-7px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:var(--red);color:#fff;border:2px solid #fff;display:grid;place-items:center;font-size:10px}.activityBell b[hidden]{display:none}
    .completedToolbar,.activityToolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 16px}.completionFilters{display:flex;gap:8px;flex-wrap:wrap}.completionFilter{border:1px solid var(--line);border-radius:999px;padding:9px 12px;background:#fff;font-weight:800;color:var(--ink)}.completionFilter span{display:inline-grid;place-items:center;min-width:22px;height:22px;margin-left:5px;border-radius:999px;background:#eef1ed;font-size:11px}.completionFilter.active{background:var(--ink);color:#fff;border-color:var(--ink)}.completionFilter.active span{background:var(--lime);color:var(--ink)}
    .completedCard{border-left:6px solid var(--green)}.completedCard.needsCheck{border-left-color:#d69b18}.completedCard h3{margin:8px 0 4px}.completedMeta{display:flex;gap:8px;flex-wrap:wrap;margin:11px 0}.completedMeta span{background:#f1f3f1;border-radius:999px;padding:6px 9px;font-size:12px;color:#4e5850}.closeoutChecks{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.closeoutCheck{border-radius:999px;padding:6px 9px;font-size:12px;font-weight:800}.closeoutCheck.ok{background:#e8f6ed;color:#167448}.closeoutCheck.missing{background:#fff1e5;color:#a95011}.completionWarning{margin:10px 0;padding:10px 12px;border-radius:12px;background:#fff7cc;color:#725a00;font-size:12px}.completedActions{margin-top:13px}
    .activityCard.unread{border-left:6px solid var(--lime)}.activityCard.read{opacity:.72}.completionDashboard{align-items:start}.completionDashboard>.card{min-width:0}.sectionHead{margin:24px 0 12px}.sectionHead h2{margin:0;font-size:21px}
    @media(max-width:720px){.completedToolbar .search{width:100%}.completedActions .btn{flex:1 1 auto}.activityToolbar>.actions{width:100%}.completionDashboard{grid-template-columns:1fr}}
    @media(max-width:620px){.activityBell{width:38px;height:38px;border-radius:11px}.syncState span{display:none}.role select:disabled{display:none}.topActions{gap:5px}}
  `;
  document.head.appendChild(style);

  if (!ownerNav.some((item) => item[0] === 'completedView')) {
    const siteIndex = ownerNav.findIndex((item) => item[0] === 'sites');
    ownerNav.splice(siteIndex >= 0 ? siteIndex + 1 : 6, 0, ['completedView', '✓', 'Completati']);
  }

  const baseMore = more;
  more = function () {
    const unread = notifications().filter((item) => !item.readAt).length;
    return baseMore() + pageHead('Chiusura lavori', 'Archivio completati e avvisi delle squadre') +
      `<div class="grid quick"><button onclick="go('completedView')"><span>✓</span>Lavori completati</button><button onclick="go('activityView')"><span>🔔</span>Avvisi attività${unread ? ` (${unread})` : ''}</button></div>`;
  };

  const baseDashboard = dashboard;
  dashboard = function () {
    return baseDashboard() + dashboardActivityPanel();
  };

  sites = function () {
    const allSites = database().sites || [];
    const active = allSites.filter((site) => !isCompleted(site.status));
    const completed = allSites.filter((site) => isCompleted(site.status));
    const inProgress = active.filter((site) => String(site.status) === 'In corso').length;
    const planned = active.filter((site) => String(site.status) !== 'In corso').length;
    return pageHead('Cantieri attivi', 'Qui restano soltanto i lavori da pianificare o ancora in esecuzione', `<button class="btn light" onclick="go('completedView')">✓ Completati (${completed.length})</button><button class="btn lime" onclick="openSite()">＋ Nuovo cantiere</button>`) +
      `<div class="grid stats">${stat('Attivi', active.length, '🏗️')}${stat('In corso', inProgress, '↗')}${stat('Pianificati', planned, '📅')}${stat('Completati', completed.length, '✓')}</div><div class="grid cols sitesLayout"><section class="card siteListCard"><div class="list">${active.map(siteRow).join('') || '<div class="empty">Nessun cantiere attivo. I lavori conclusi sono nella sezione Completati.</div>'}</div></section><section class="card teamLoadCard"><div class="cardHead"><h3>Carico squadre</h3></div>${WORKERS.map((worker) => `<div class="row"><div class="avatar">${esc(worker.name || '').charAt(0)}</div><div class="rowBody"><b>${esc(worker.name || 'Squadra')}</b><small>${staffForTeam(worker.id).length} operai · ${active.filter((site) => typeof siteHasTeam === 'function' ? siteHasTeam(site, worker.id) : site.worker === worker.id).length} cantieri attivi</small></div></div>`).join('') || '<div class="empty">Nessuna squadra configurata.</div>'}</section></div>`;
  };

  const baseRender = render;
  render = function () {
    if (['completedView', 'activityView'].includes(view)) {
      if (!isOfficeUser()) view = 'worker';
      else {
        renderNav();
        document.getElementById('avatar').textContent = roleName().charAt(0);
        document.getElementById('pageTitle').textContent = view === 'completedView' ? 'Completati' : 'Avvisi attività';
        document.getElementById('app').innerHTML = view === 'completedView' ? window.completedView() : window.activityView();
        installActivityBell();
        return;
      }
    }
    baseRender();
    installActivityBell();
  };

  window.addEventListener('edilkappa:cloud-collection-synced', (event) => detectCloudActivities(event.detail?.localName || ''));

  let enhanceQueued = false;
  new MutationObserver(() => {
    if (enhanceQueued) return;
    enhanceQueued = true;
    requestAnimationFrame(() => { enhanceQueued = false; installActivityBell(); updateActivityBell(); });
  }).observe(document.body, { childList: true, subtree: true });

  function openActivityFromUrl() {
    const requestedView = new URL(window.location.href).searchParams.get('view');
    if (['ai', 'attendance', 'activityView', 'completedView', 'dashboard', 'operationsCenter'].includes(requestedView)) {
      setTimeout(() => go(requestedView), 250);
      history.replaceState({}, '', new URL('./', window.location.href));
    }
    const id = new URL(window.location.href).searchParams.get('activity');
    if (!id) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (notifications().some((item) => item.id === id)) {
        clearInterval(timer);
        window.openActivityNotification(id);
        history.replaceState({}, '', new URL('./', window.location.href));
      } else if (attempts >= 20) clearInterval(timer);
    }, 500);
  }

  window.EdilKappaCompletion = { completedRows, closeoutData, notifications, detectCloudActivities, addActivity };
  save();
  render();
  openActivityFromUrl();
})();
