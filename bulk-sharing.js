(function () {
  'use strict';

  const FEATURE_RELEASE_AT = '2026-08-06T10:00:00.000Z';
  const AUTO_SNAPSHOT_KEY = 'edilkappa_bulk_completion_snapshot_v1';
  const PACKAGE_MAX_BYTES = 1900 * 1024 * 1024;
  const SHARING_URL = 'https://edilkappa-condivisioni.edilkappasas.chatgpt.site';
  const FIREBASE_AUTH_MODULE = 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
  const TRANSFER_MAX_AGE = 6 * 24 * 60 * 60 * 1000;
  const FIREBASE_STORAGE_MODULE = 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';
  const FIREBASE_FIRESTORE_MODULE = 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
  const COMPLETED_PATTERN = /complet|conclus|chius|eseguit|fatturat/i;
  const packageJobs = new Map();
  let activeSession = null;
  let scanTimer = null;

  function database() {
    return window.EdilKappaLocal?.getDB?.() || window.db || {};
  }

  function officeAllowed() {
    const role = window.EdilKappaCloud?.currentProfile?.role;
    return ['owner', 'office'].includes(role) || (!role && typeof window.isOffice === 'function' && window.isOffice());
  }

  function completed(value) {
    return COMPLETED_PATTERN.test(String(value || ''));
  }

  function html(value) {
    if (typeof window.esc === 'function') return window.esc(value);
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function cleanName(value, fallback = 'file') {
    const name = String(value || fallback)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150);
    return name || fallback;
  }

  function folderFor(type, name, category = '') {
    const value = `${type || ''} ${name || ''} ${category || ''}`.toLowerCase();
    if (value.includes('video') || /\.(mp4|mov|m4v|webm)$/i.test(name || '')) return '02-Video';
    if (value.includes('image') || /\.(jpe?g|png|webp|heic|heif)$/i.test(name || '')) return '01-Foto';
    if (/preventiv|offert/.test(value) || /\.(pdf)$/i.test(name || '') && /prev/i.test(name || '')) return '03-Preventivi';
    if (/pdf|word|document|relazione|verbale|certificat/.test(value) || /\.(pdf|docx?)$/i.test(name || '')) return '04-Documenti';
    return '05-Altri-file';
  }

  function referenceKey(source) {
    return String(source?.storagePath || source?.attachmentId || source?.fileKey || source?.pdfKey || source?.key || source?.url || source?.dataUrl || source?.data || '');
  }

  function mimeType(source) {
    const explicit = String(source?.fileType || source?.type || source?.mimeType || '').toLowerCase();
    if (explicit) return explicit;
    const extension = String(source?.fileName || source?.name || '').split('.').pop()?.toLowerCase();
    return ({
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
      mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
      pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      zip: 'application/zip'
    })[extension] || 'application/octet-stream';
  }

  function hasReadableReference(source) {
    return Boolean(referenceKey(source) || source?.inlineText || source?.blob instanceof Blob);
  }

  function uniquePath(path, used) {
    const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!used.has(normalized.toLowerCase())) {
      used.add(normalized.toLowerCase());
      return normalized;
    }
    const dot = normalized.lastIndexOf('.');
    const base = dot > normalized.lastIndexOf('/') ? normalized.slice(0, dot) : normalized;
    const extension = dot > normalized.lastIndexOf('/') ? normalized.slice(dot) : '';
    let index = 2;
    while (used.has(`${base}-${index}${extension}`.toLowerCase())) index += 1;
    const result = `${base}-${index}${extension}`;
    used.add(result.toLowerCase());
    return result;
  }

  function linkedSites(intervention) {
    return (database().sites || []).filter((site) =>
      String(site.interventionId || '') === String(intervention.id) ||
      (site.daneaRequestId && String(site.daneaRequestId) === String(intervention.daneaRequestId || ''))
    );
  }

  function scopeInfo(kind, id) {
    const data = database();
    const collectionName = ({ site: 'sites', intervention: 'interventions', roof: 'roofs', drain: 'drains', quote: 'quotes', document: 'documents', report: 'reports' })[kind] || kind;
    const item = (data[collectionName] || []).find((entry) => String(entry.id) === String(id));
    if (!item) throw new Error('La scheda da condividere non è più disponibile.');
    const normalizedKind = collectionName === 'sites' ? 'site'
      : collectionName === 'interventions' ? 'intervention'
        : collectionName === 'roofs' ? 'roof'
          : collectionName === 'drains' ? 'drain'
            : collectionName === 'quotes' ? 'quote'
              : collectionName === 'documents' ? 'document'
                : collectionName === 'reports' ? 'report' : collectionName;
    const title = item.title || item.subject || item.type || item.code || item.client || 'Intervento EdilKappa';
    return { kind: normalizedKind, collectionName, item, id: item.id, title, client: item.client || item.name || '', address: item.address || '' };
  }

  function filesForScope(kind, id) {
    const info = scopeInfo(kind, id);
    const data = database();
    const rows = [];
    const seen = new Set();
    const usedPaths = new Set();

    const add = (source, label = '', category = '', preferredName = '') => {
      if (!source || !hasReadableReference(source)) return;
      const key = referenceKey(source) || `${label}:${preferredName}:${source?.inlineText || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      const name = cleanName(preferredName || source.fileName || source.name || label || 'file');
      const type = mimeType({ ...source, fileName: name });
      const folder = folderFor(type, name, category);
      rows.push({
        id: `share-${rows.length}-${Math.abs(hashText(key || name))}`,
        path: uniquePath(`${folder}/${name}`, usedPaths),
        name,
        label: label || name,
        category: category || folder,
        type,
        size: Number(source.fileSize || source.size || 0),
        uploadedAt: source.uploadedAt || source.updatedAt || '',
        source
      });
    };

    const addObject = (item, label, category) => {
      if (!item) return;
      if (item.storagePath || item.fileKey || item.pdfKey || item.key || item.url || item.dataUrl) {
        add(item, label, category, item.fileName || item.name || `${label}.pdf`);
      }
      (item.photos || []).forEach((file, index) => add(file, `${label} · foto ${index + 1}`, 'Fotografie', file.fileName || file.name || `foto-${index + 1}.jpg`));
      (item.media || []).forEach((file, index) => add(file, `${label} · allegato ${index + 1}`, category, file.fileName || file.name || `allegato-${index + 1}`));
      (item.files || []).forEach((file, index) => add(file, `${label} · file ${index + 1}`, category, file.fileName || file.name || `file-${index + 1}`));
    };

    const addSite = (site) => {
      addObject(site, site.title || 'Cantiere', 'Cantiere');
      (data.reports || [])
        .filter((report) => String(report.site || report.siteId || '') === String(site.id))
        .forEach((report) => addObject(report, report.code || report.albumType || 'Rapportino', 'Fotografie e rapportini'));
    };

    let interventions = [];
    let sites = [];
    if (info.kind === 'site') {
      sites = [info.item];
      interventions = (data.interventions || []).filter((intervention) =>
        String(intervention.id) === String(info.item.interventionId || '') ||
        (info.item.daneaRequestId && String(intervention.daneaRequestId || '') === String(info.item.daneaRequestId))
      );
    } else if (info.kind === 'intervention') {
      interventions = [info.item];
      sites = linkedSites(info.item);
    } else if (['roof', 'drain'].includes(info.kind)) {
      addObject(info.item, info.title, info.kind === 'roof' ? 'Tetto e gronde' : 'Pozzetti e tombini');
      if (info.item.interventionId) interventions = (data.interventions || []).filter((item) => String(item.id) === String(info.item.interventionId));
    } else {
      addObject(info.item, info.title, info.collectionName);
    }

    sites.forEach(addSite);
    const interventionIds = new Set(interventions.map((item) => String(item.id)));
    if (interventionIds.size) {
      (data.quotes || []).filter((item) => interventionIds.has(String(item.interventionId || ''))).forEach((item) => addObject(item, item.code || 'Preventivo', 'Preventivi'));
      (data.documents || []).filter((item) => interventionIds.has(String(item.interventionId || ''))).forEach((item) => addObject(item, item.title || 'Documento', item.category || 'Documenti'));
      (data.drone || []).filter((item) => interventionIds.has(String(item.interventionId || ''))).forEach((item) => addObject(item, item.area || 'Drone', 'Videoispezione drone'));
    }

    return { info, files: rows };
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash | 0;
  }

  function fingerprint(files) {
    return `v1-${Math.abs(hashText(files.map((file) => [referenceKey(file.source), file.size, file.uploadedAt, file.path].join(':')).sort().join('|'))).toString(36)}`;
  }

  function summaryText(info, files) {
    const lines = [
      'EDILKAPPA - PACCHETTO INTERVENTO',
      '',
      `Cliente / condominio: ${info.client || 'Da definire'}`,
      `Intervento: ${info.title}`,
      `Indirizzo: ${info.address || 'Da definire'}`,
      `Creato il: ${new Date().toLocaleString('it-IT')}`,
      `File inclusi: ${files.length}`,
      '',
      'CONTENUTO'
    ];
    files.forEach((file, index) => lines.push(`${index + 1}. ${file.path}`));
    return `${lines.join('\r\n')}\r\n`;
  }

  async function resolveBlob(file) {
    if (file.source?.inlineText) return new Blob([file.source.inlineText], { type: 'text/plain;charset=utf-8' });
    if (file.source?.blob instanceof Blob) return file.source.blob;
    return readCloudFile(file.source);
  }

  async function readCloudFile(source) {
    if (!source) throw new Error('File non disponibile.');
    if (source.blob instanceof Blob) return source.blob;
    if (source.storagePath) {
      const { getStorage, getDownloadURL, ref } = await import(FIREBASE_STORAGE_MODULE);
      const response = await fetchCloudSource(await getDownloadURL(ref(getStorage(), source.storagePath)));
      if (!response.ok) throw new Error(`Non riesco a scaricare ${source.fileName || source.name || 'un file'}.`);
      return response.blob();
    }
    if (source.attachmentId) {
      const { getFirestore, getDoc, doc } = await import(FIREBASE_FIRESTORE_MODULE);
      const snapshot = await getDoc(doc(getFirestore(undefined, 'edilkappa'), 'attachments', source.attachmentId));
      if (!snapshot.exists() || !snapshot.data().data) throw new Error(`Fotografia cloud non trovata: ${source.fileName || source.name || ''}`);
      return (await fetch(snapshot.data().data)).blob();
    }
    const localKey = source.fileKey || source.pdfKey || source.key || '';
    if (localKey && window.EdilKappaLocal?.readFile) {
      const file = await window.EdilKappaLocal.readFile(localKey);
      if (file) return file;
    }
    const directUrl = source.dataUrl || source.url || source.data || '';
    if (directUrl) {
      const response = /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//i.test(directUrl)
        ? await fetchCloudSource(directUrl)
        : await fetch(directUrl);
      if (response.ok) return response.blob();
    }
    throw new Error(`File non disponibile: ${source.fileName || source.name || 'allegato'}`);
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
      table[index] = value >>> 0;
    }
    return table;
  })();

  async function crc32(blob) {
    let crc = 0xffffffff;
    const reader = blob.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const byte of value) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.min(2107, Math.max(1980, date.getFullYear()));
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function binary(size, writer) {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    writer(view);
    return bytes;
  }

  async function zipFile(info, selected) {
    if (!selected.length) throw new Error('Seleziona almeno un file.');
    const manifest = {
      id: 'share-summary',
      path: '00-RIEPILOGO-INTERVENTO.txt',
      name: 'RIEPILOGO-INTERVENTO.txt',
      type: 'text/plain',
      size: 0,
      source: { inlineText: summaryText(info, selected) }
    };
    const entries = [manifest, ...selected];
    const resolved = [];
    let totalSize = 0;
    for (const entry of entries) {
      const blob = await resolveBlob(entry);
      totalSize += blob.size;
      if (totalSize > PACKAGE_MAX_BYTES) throw new Error('Il pacchetto supera 1,9 GB. Seleziona meno video e crea due pacchetti.');
      resolved.push({ ...entry, blob, crc: await crc32(blob) });
    }

    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    const stamp = dosDateTime();
    let offset = 0;
    for (const entry of resolved) {
      if (entry.blob.size > 0xffffffff || offset > 0xffffffff) throw new Error('Il pacchetto è troppo grande per questo dispositivo.');
      const name = encoder.encode(entry.path);
      const local = binary(30, (view) => {
        view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
        view.setUint16(8, 0, true); view.setUint16(10, stamp.time, true); view.setUint16(12, stamp.date, true);
        view.setUint32(14, entry.crc, true); view.setUint32(18, entry.blob.size, true); view.setUint32(22, entry.blob.size, true);
        view.setUint16(26, name.length, true); view.setUint16(28, 0, true);
      });
      parts.push(local, name, entry.blob);
      const headerOffset = offset;
      offset += local.byteLength + name.byteLength + entry.blob.size;
      const header = binary(46, (view) => {
        view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true);
        view.setUint16(8, 0x0800, true); view.setUint16(10, 0, true); view.setUint16(12, stamp.time, true); view.setUint16(14, stamp.date, true);
        view.setUint32(16, entry.crc, true); view.setUint32(20, entry.blob.size, true); view.setUint32(24, entry.blob.size, true);
        view.setUint16(28, name.length, true); view.setUint16(30, 0, true); view.setUint16(32, 0, true); view.setUint16(34, 0, true);
        view.setUint16(36, 0, true); view.setUint32(38, 0, true); view.setUint32(42, headerOffset, true);
      });
      central.push(header, name);
    }
    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = binary(22, (view) => {
      view.setUint32(0, 0x06054b50, true); view.setUint16(4, 0, true); view.setUint16(6, 0, true);
      view.setUint16(8, resolved.length, true); view.setUint16(10, resolved.length, true);
      view.setUint32(12, centralSize, true); view.setUint32(16, offset, true); view.setUint16(20, 0, true);
    });
    const fileName = `${cleanName(info.client || 'EdilKappa')}-${cleanName(info.title || 'Intervento')}-${new Date().toISOString().slice(0, 10)}.zip`;
    return new File([...parts, ...central, end], fileName, { type: 'application/zip', lastModified: Date.now() });
  }

  function setPackageState(info, value) {
    if (info.kind !== 'site') return;
    const liveItem = (database().sites || []).find((site) => String(site.id) === String(info.id)) || info.item;
    info.item = liveItem;
    liveItem.completionPackage = value;
    liveItem.updatedAt = new Date().toISOString();
    window.EdilKappaLocal?.persist?.();
    window.EdilKappaCloud?.scheduleSync?.();
    if (typeof window.render === 'function') window.render();
  }

  async function localPackage(info, file, selectedFingerprint, itemCount) {
    if (typeof window.storePdf !== 'function') throw new Error('L’archivio locale non è disponibile su questo dispositivo.');
    const fileKey = `completion-package-${info.id}-${selectedFingerprint}`;
    await window.storePdf(fileKey, file);
    const result = {
      fileKey,
      fileName: file.name,
      fileType: 'application/zip',
      fileSize: file.size,
      status: 'ready-local',
      sourceFingerprint: selectedFingerprint,
      itemCount,
      createdAt: new Date().toISOString()
    };
    setPackageState(info, result);
    return result;
  }

  async function storedPackage(info, files, options = {}) {
    const selectedFingerprint = fingerprint(files);
    const current = info.item.completionPackage || {};
    if (!options.force && info.kind === 'site' && current.status === 'ready-local' && current.sourceFingerprint === selectedFingerprint && current.fileKey) return current;
    const jobKey = `${info.kind}:${info.id}:${selectedFingerprint}`;
    if (packageJobs.has(jobKey)) return packageJobs.get(jobKey);
    const job = (async () => {
      if (!window.EdilKappaCloud?.ready) throw new Error('Accedi al gestionale e controlla la connessione prima di preparare il pacchetto.');
      setPackageState(info, { ...current, status: 'preparing', sourceFingerprint: selectedFingerprint, itemCount: files.length, startedAt: new Date().toISOString() });
      try {
        const file = await zipFile(info, files);
        if (info.kind === 'site') return localPackage(info, file, selectedFingerprint, files.length);
        return { blob: file, fileName: file.name, fileType: 'application/zip', fileSize: file.size, status: 'ready-local', sourceFingerprint: selectedFingerprint, itemCount: files.length };
      } catch (error) {
        setPackageState(info, { ...current, status: 'error', sourceFingerprint: selectedFingerprint, itemCount: files.length, error: error.message || 'Preparazione non riuscita', failedAt: new Date().toISOString() });
        throw error;
      }
    })().finally(() => packageJobs.delete(jobKey));
    packageJobs.set(jobKey, job);
    return job;
  }

  function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url; link.download = file.name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function clipboard(value) {
    try { await navigator.clipboard.writeText(value); return true; } catch (_) { return false; }
  }

  async function sharingToken() {
    const { getAuth } = await import(FIREBASE_AUTH_MODULE);
    const user = getAuth().currentUser;
    if (!user) throw new Error('Accedi nuovamente a EdilKappa per condividere.');
    return user.getIdToken();
  }

  async function fetchCloudSource(sourceUrl) {
    const token = await sharingToken();
    return fetch(`${SHARING_URL}/api/source`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sourceUrl }),
    });
  }

  async function sharingRequest(path, token, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('authorization', `Bearer ${token}`);
    const response = await fetch(`${SHARING_URL}${path}`, { ...options, headers });
    let body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(body.error || 'Il servizio di condivisione non risponde.');
    return body;
  }

  function reusableTransfer(session, file) {
    const value = session.transfer;
    return value && value.key === `${session.preparedKey}:${file.size}` && value.link && Date.now() - value.createdAt < TRANSFER_MAX_AGE ? value : null;
  }

  async function transferLink(session, file, button) {
    const reusable = reusableTransfer(session, file);
    if (reusable) return reusable.link;
    const token = await sharingToken();
    const context = daneaContext(session.info);
    let uploadToken = '';
    try {
      setBusy(button, true, 'Avvio caricamento…');
      const started = await sharingRequest('/api/transfernow/direct/start', token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          interventionId: context?.interventionId || `${session.info.kind}-${session.info.id}`,
          daneaRequestId: context?.requestId || 'manuale',
          subject: `EdilKappa · ${session.info.title}`,
          message: `Allegati EdilKappa · ${session.info.client || 'Cliente'} · ${session.info.title}`,
        }),
      });
      uploadToken = started.uploadToken;
      const uploadedParts = [];
      let sent = 0;
      for (const part of started.parts) {
        const blob = file.slice(part.start, part.start + part.size);
        const percent = Math.max(1, Math.round((sent / file.size) * 100));
        if (button) button.textContent = `Caricamento ${percent}%`;
        const uploaded = await sharingRequest('/api/transfernow/direct/part', token, {
          method: 'PUT',
          headers: {
            'content-type': 'application/octet-stream',
            'x-upload-token': uploadToken,
            'x-part-number': String(part.partNumber),
          },
          body: blob,
        });
        uploadedParts.push({ ETag: uploaded.etag, PartNumber: uploaded.partNumber });
        sent += part.size;
      }
      if (button) button.textContent = 'Creo il link…';
      const finished = await sharingRequest('/api/transfernow/direct/finish', token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uploadToken, parts: uploadedParts }),
      });
      session.transfer = { key: `${session.preparedKey}:${file.size}`, link: finished.link, transferId: finished.transferId, createdAt: Date.now() };
      return finished.link;
    } catch (error) {
      if (uploadToken) sharingRequest('/api/transfernow/direct/cancel', token, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploadToken }),
      }).catch(() => {});
      throw error;
    }
  }

  function selectedFiles() {
    if (!activeSession) return [];
    const selectedIds = new Set(Array.from(document.querySelectorAll('[data-share-file]:checked')).map((input) => input.value));
    return activeSession.files.filter((file) => selectedIds.has(file.id));
  }

  function setBusy(button, busy, text = 'Preparazione…') {
    if (!(button instanceof HTMLElement)) return;
    if (busy) {
      button.dataset.oldHtml = button.innerHTML;
      button.disabled = true;
      button.textContent = text;
    } else {
      button.disabled = false;
      if (button.dataset.oldHtml) button.innerHTML = button.dataset.oldHtml;
      delete button.dataset.oldHtml;
    }
  }

  function selectionKey(files) {
    return files.map((file) => file.id).sort().join('|');
  }

  async function originalFilesForSelection(selected) {
    const usedNames = new Set();
    const files = [];
    for (const entry of selected) {
      const blob = await resolveBlob(entry);
      const name = uniquePath(cleanName(entry.name || entry.path?.split('/').pop() || 'allegato'), usedNames);
      const uploadedAt = Date.parse(entry.uploadedAt || '');
      files.push(new File([blob], name, {
        type: entry.type || blob.type || 'application/octet-stream',
        lastModified: Number.isFinite(uploadedAt) ? uploadedAt : Date.now()
      }));
    }
    return files;
  }

  async function packageFileForSelection(session, selected, originalFiles = null) {
    const fullSelection = selected.length === session.files.length;
    const current = session.info.item.completionPackage || {};
    const currentFingerprint = fingerprint(session.files);
    if (fullSelection && session.info.kind === 'site' && current.status === 'ready-local' && current.sourceFingerprint === currentFingerprint && current.fileKey) {
      try {
        const blob = await readCloudFile(current);
        return new File([blob], current.fileName || 'Pacchetto-EdilKappa.zip', { type: 'application/zip' });
      } catch (_) { /* Su un altro dispositivo il pacchetto viene rigenerato dai file cloud. */ }
    }
    const zipEntries = originalFiles?.length === selected.length
      ? selected.map((entry, index) => ({ ...entry, source: { blob: originalFiles[index] } }))
      : selected;
    return zipFile(session.info, zipEntries);
  }

  function nativeShareFiles(session) {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return [];
    const candidates = [session.preparedOriginalFiles || [], session.preparedFile ? [session.preparedFile] : []];
    for (const files of candidates) {
      if (!files.length) continue;
      try { if (navigator.canShare({ files })) return files; } catch (_) {}
    }
    return [];
  }

  function daneaContext(info) {
    const data = database();
    let intervention = info.kind === 'intervention' ? info.item : null;
    if (!intervention && info.item.interventionId) intervention = (data.interventions || []).find((item) => String(item.id) === String(info.item.interventionId));
    if (!intervention && info.item.daneaRequestId) intervention = (data.interventions || []).find((item) => String(item.daneaRequestId || '') === String(info.item.daneaRequestId));
    const requestId = intervention?.daneaRequestId || info.item.daneaRequestId || '';
    const request = (data.leads || []).find((item) => String(item.id) === String(requestId));
    const url = safeDaneaUrl(request?.sourceUrl);
    if (!intervention || !request || !url) return null;
    return { intervention, request, url, requestId, interventionId: intervention.id };
  }

  function safeDaneaUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      const host = url.hostname.toLowerCase();
      return url.protocol === 'https:' && (host === 'miocondominio.eu' || host.endsWith('.miocondominio.eu') || host === 'danea.it' || host.endsWith('.danea.it')) ? url.href : '';
    } catch (_) { return ''; }
  }

  async function daneaTransfer(session, selected, button, preparedFile = null) {
    const context = daneaContext(session.info);
    if (!context) throw new Error('Questo lavoro non è collegato a una pratica Danea precisa.');
    const targetWindow = window.open('', '_blank');
    if (targetWindow) { targetWindow.document.write('<p style="font:16px Arial;padding:24px">Preparazione del pacchetto EdilKappa…</p>'); targetWindow.document.close(); }
    try {
      const file = preparedFile || await packageFileForSelection(session, selected);
      const link = await transferLink(session, file, button);
      const code = context.request.daneaId || context.requestId;
      const message = `Intervento Danea ${code} – pacchetto completo EdilKappa: ${link}`;
      const copied = await clipboard(message);
      if (targetWindow) targetWindow.location.replace(context.url); else window.open(context.url, '_blank', 'noopener');
      alert(`Ho aperto la pratica Danea ${code}. ${copied ? 'Il link è già copiato: incollalo nell’intervento.' : `Incolla questo link: ${link}`}`);
    } catch (error) {
      targetWindow?.close();
      throw error;
    } finally { setBusy(button, false); }
  }

  window.toggleAllShareFiles = function (checked) {
    document.querySelectorAll('[data-share-file]').forEach((input) => { input.checked = Boolean(checked); });
    updateSelectionCount();
  };

  window.updateShareSelection = function () {
    updateSelectionCount();
  };

  function setPreparationStatus(message, state = '') {
    const status = document.getElementById('sharePreparationStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function disableShareActions(disabled) {
    document.querySelectorAll('[data-share-action]').forEach((button) => { button.disabled = Boolean(disabled); });
  }

  function queueSharePreparation(delay = 140) {
    const session = activeSession;
    if (!session) return;
    clearTimeout(session.preparationTimer);
    session.preparationRevision = Number(session.preparationRevision || 0) + 1;
    session.preparedKey = '';
    session.preparedFile = null;
    session.preparedOriginalFiles = [];
    session.transfer = null;
    const selected = selectedFiles();
    if (!selected.length) {
      disableShareActions(true);
      setPreparationStatus('Seleziona almeno un file.', 'empty');
      return;
    }
    disableShareActions(false);
    setPreparationStatus(`${selected.length} file selezionati · premi un metodo di condivisione per creare lo ZIP`, 'ready');
  }

  async function prepareActiveSelection(session, revision) {
    const selected = selectedFiles();
    const key = selectionKey(selected);
    try {
      const originalFiles = await originalFilesForSelection(selected);
      const zip = await packageFileForSelection(session, selected, originalFiles);
      if (activeSession !== session || session.preparationRevision !== revision) return;
      session.preparedKey = key;
      session.preparedFile = zip;
      session.preparedOriginalFiles = originalFiles;
      disableShareActions(false);
      setPreparationStatus(`Allegati pronti · ${selected.length} file · ZIP ${formatBytes(zip.size)}`, 'ready');
    } catch (error) {
      if (activeSession !== session || session.preparationRevision !== revision) return;
      session.preparationError = error;
      disableShareActions(true);
      setPreparationStatus(error.message || 'Non riesco a preparare gli allegati.', 'error');
    }
  }

  function updateSelectionCount() {
    const count = document.querySelectorAll('[data-share-file]:checked').length;
    const label = document.getElementById('shareSelectionCount');
    if (label) label.textContent = `${count} file selezionati`;
    queueSharePreparation();
  }

  window.runShareAction = async function (mode, button) {
    const session = activeSession;
    if (!session) return;
    const selected = selectedFiles();
    if (!selected.length) return alert('Seleziona almeno un file.');
    let file = session.preparedFile;
    try {
      if (!file || session.preparedKey !== selectionKey(selected)) {
        setBusy(button, true, 'Preparo lo ZIP…');
        setPreparationStatus(`Preparazione di ${selected.length} file… non chiudere la finestra`, 'preparing');
        const originalFiles = await originalFilesForSelection(selected);
        file = await packageFileForSelection(session, selected, originalFiles);
        session.preparedKey = selectionKey(selected);
        session.preparedFile = file;
        session.preparedOriginalFiles = originalFiles;
        setPreparationStatus(`ZIP pronto · ${selected.length} file · ${formatBytes(file.size)}`, 'ready');
      }
      const text = `File EdilKappa · ${session.info.client || 'Cliente'} · ${session.info.title}\nPacchetto: ${file.name}`;
      if (mode === 'danea') {
        return await daneaTransfer(session, selected, button, file);
      }
      if (mode === 'download') {
        downloadFile(file);
        return;
      }
      if (mode === 'copy') {
        const link = await transferLink(session, file, button);
        if (await clipboard(link)) alert('Link temporaneo copiato.'); else prompt('Copia questo link:', link);
        return;
      }
      const targetWindow = window.open('', '_blank');
      if (targetWindow) { targetWindow.document.write('<p style="font:16px Arial;padding:24px">Caricamento protetto del pacchetto EdilKappa…</p>'); targetWindow.document.close(); }
      const link = await transferLink(session, file, button);
      const shareText = `${text}\nScarica tutti gli allegati: ${link}`;
      if (mode === 'whatsapp') {
        const target = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
        if (targetWindow) targetWindow.location.replace(target); else window.location.href = target;
      } else if (mode === 'email') {
        const target = `mailto:?subject=${encodeURIComponent(`EdilKappa · ${session.info.title}`)}&body=${encodeURIComponent(shareText)}`;
        if (targetWindow) targetWindow.location.replace(target); else window.location.href = target;
      } else {
        targetWindow?.close();
        if (await clipboard(shareText)) alert('Link temporaneo copiato: incollalo in WhatsApp, e-mail o nell’app che vuoi usare.');
        else prompt('Copia e condividi questo link:', link);
      }
    } catch (error) {
      alert(error.message || 'Condivisione non riuscita.');
    } finally {
      if (mode !== 'danea') setBusy(button, false);
    }
  };

  window.openBulkShare = function (kind, id) {
    if (!officeAllowed()) return alert('La condivisione completa è disponibile al titolare e all’ufficio.');
    let result;
    try { result = filesForScope(kind, id); } catch (error) { return alert(error.message); }
    if (!result.files.length) return alert('Non ci sono ancora foto, video o documenti disponibili per questo lavoro.');
    activeSession = { ...result, preparedFile: null, preparedOriginalFiles: [], preparedKey: '', preparationRevision: 0, preparationTimer: null, transfer: null };
    const danea = daneaContext(result.info);
    const dialog = document.getElementById('modal');
    const content = document.getElementById('modalContent');
    if (!dialog || !content) return;
    const rows = result.files.map((file) => `<label class="shareFileRow"><input type="checkbox" value="${html(file.id)}" data-share-file checked onchange="updateShareSelection()"><span class="shareFileIcon">${file.type.startsWith('image/') ? '🖼️' : file.type.startsWith('video/') ? '🎬' : file.type.includes('pdf') ? '📄' : '📁'}</span><span><b>${html(file.name)}</b><small>${html(file.category)}${file.size ? ` · ${formatBytes(file.size)}` : ''}</small></span></label>`).join('');
    content.innerHTML = `<div class="modalHead"><div><h3>Condividi</h3><small>${html(result.info.client)} · ${html(result.info.title)}</small></div><button class="close" type="button" onclick="closeModal()">×</button></div>
      <div class="modalBody"><div class="shareSelectBar"><label><input type="checkbox" checked onchange="toggleAllShareFiles(this.checked)"> Seleziona tutto</label><b id="shareSelectionCount">${result.files.length} file selezionati</b></div><div class="shareFileList">${rows}</div>
      <div id="sharePreparationStatus" class="sharePreparationStatus" data-state="ready" aria-live="polite">Seleziona i file e scegli come condividerli</div>
      <div class="shareMethods"><button type="button" class="shareMethod primary" data-share-action disabled onclick="runShareAction('native',this)"><span>↗</span><b>Condividi</b><small>Link temporaneo automatico</small></button><button type="button" class="shareMethod whatsapp" data-share-action disabled onclick="runShareAction('whatsapp',this)"><span>💬</span><b>WhatsApp</b><small>Invia link con tutti i file</small></button><button type="button" class="shareMethod" data-share-action disabled onclick="runShareAction('email',this)"><span>✉️</span><b>E-mail</b><small>Invia link con tutti i file</small></button><button type="button" class="shareMethod" data-share-action disabled onclick="runShareAction('copy',this)"><span>📋</span><b>Copia link</b><small>Link temporaneo protetto</small></button><button type="button" class="shareMethod" data-share-action disabled onclick="runShareAction('download',this)"><span>📦</span><b>Scarica ZIP</b><small>Un solo allegato</small></button>${danea ? `<button type="button" class="shareMethod danea" data-share-action disabled onclick="runShareAction('danea',this)"><span>🔧</span><b>Danea</b><small>Apri pratica con link</small></button>` : ''}</div></div><div class="modalFoot"><button class="btn light" type="button" onclick="closeModal()">Chiudi</button></div>`;
    dialog.showModal();
    queueSharePreparation(0);
  };

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} GB`;
  }

  function addShareButton(actions, kind, id, label = '↗ Condividi') {
    if (!actions || actions.querySelector(`[data-bulk-share="${CSS.escape(`${kind}-${id}`)}"]`)) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn sm light'; button.textContent = label;
    button.dataset.bulkShare = `${kind}-${id}`;
    button.addEventListener('click', () => window.openBulkShare(kind, id));
    actions.appendChild(button);
  }

  function siteShareLabel(siteId, fallback) {
    const site = (database().sites || []).find((item) => String(item.id) === String(siteId));
    const status = site?.completionPackage?.status;
    if (status === 'preparing') return '📦 Preparazione ZIP…';
    if (status === 'ready-local') return '✓ ZIP pronto / Condividi';
    return fallback;
  }

  function enhanceShareButtons() {
    if (!officeAllowed()) return;
    document.querySelectorAll('button[onclick*="openCompletedMedia("]').forEach((button) => {
      const match = (button.getAttribute('onclick') || '').match(/openCompletedMedia\('([^']+)','([^']+)'\)/);
      if (match) addShareButton(button.closest('.actions') || button.parentElement, match[1], match[2], match[1] === 'site' ? siteShareLabel(match[2], '📦 Condividi / ZIP') : '📦 Condividi / ZIP');
    });
    document.querySelectorAll('button[data-quick-site]').forEach((button) => {
      addShareButton(button.closest('.actions') || button.parentElement, 'site', button.dataset.quickSite, siteShareLabel(button.dataset.quickSite, '↗ Condividi'));
    });
    document.querySelectorAll('section[id^="intervention-"]').forEach((section) => {
      const id = section.id.replace('intervention-', '');
      const actions = section.querySelector(':scope > .actions');
      addShareButton(actions, 'intervention', id, '📦 Condividi tutto');
    });
    const patterns = [
      ['openQuotePdf', 'quotes'], ['manageQuoteMedia', 'quotes'], ['openBusinessDocument', 'documents'], ['manageDroneMedia', 'drone']
    ];
    patterns.forEach(([functionName, collection]) => document.querySelectorAll(`button[onclick*="${functionName}("]`).forEach((button) => {
      const match = (button.getAttribute('onclick') || '').match(new RegExp(`${functionName}\\('([^']+)'\\)`));
      if (match) addShareButton(button.closest('.actions') || button.parentElement, collection, match[1]);
    }));
  }

  function installStyles() {
    if (document.getElementById('bulkSharingStyles')) return;
    const style = document.createElement('style');
    style.id = 'bulkSharingStyles';
    style.textContent = `
      .shareSelectBar{position:sticky;top:-20px;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;margin:-20px -20px 12px;background:#fff;border-bottom:1px solid var(--line)}.shareSelectBar label{display:flex;gap:8px;align-items:center;font-weight:850}.shareSelectBar input,.shareFileRow input{width:19px;height:19px;accent-color:var(--green)}.shareSelectBar b{font-size:12px;color:var(--muted)}
      .shareFileList{display:grid;gap:7px;max-height:42vh;overflow:auto;padding-right:4px}.shareFileRow{display:grid;grid-template-columns:auto 38px minmax(0,1fr);gap:10px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:13px;background:#fff;cursor:pointer}.shareFileRow:has(input:checked){border-color:#8fb69b;background:#f6fbf7}.shareFileIcon{width:38px;height:38px;border-radius:10px;background:#eef1ed;display:grid;place-items:center}.shareFileRow b,.shareFileRow small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shareFileRow small{margin-top:3px;color:var(--muted);font-size:11px}
      .sharePreparationStatus{margin-top:13px;padding:10px 12px;border-radius:12px;background:#f2f4f0;color:var(--muted);font-size:12px;font-weight:800}.sharePreparationStatus[data-state="ready"]{background:#eaf7ef;color:#245d36}.sharePreparationStatus[data-state="error"]{background:#feeceb;color:#a63129}
      .shareMethods{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}.shareMethod{border:1px solid var(--line);border-radius:15px;background:#fff;padding:13px 9px;color:var(--ink);text-align:left;min-height:92px}.shareMethod span,.shareMethod b,.shareMethod small{display:block}.shareMethod span{font-size:22px}.shareMethod b{margin-top:6px}.shareMethod small{margin-top:3px;color:var(--muted);font-size:10px}.shareMethod.primary{background:var(--ink);color:#fff;border-color:var(--ink)}.shareMethod.primary small{color:#d8dcdf}.shareMethod.whatsapp{border-color:#84c89d}.shareMethod.danea{background:#eaf7ef;border-color:#8fc5a1}.shareMethod:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:620px){.shareMethods{grid-template-columns:repeat(2,minmax(0,1fr))}.shareFileList{max-height:38vh}.shareSelectBar{align-items:flex-start;flex-direction:column;gap:5px}}
    `;
    document.head.appendChild(style);
  }

  function parsedSnapshot() {
    try {
      const value = JSON.parse(localStorage.getItem(AUTO_SNAPSHOT_KEY) || 'null');
      return value && typeof value === 'object' ? value : { initialized: false, statuses: {} };
    } catch (_) { return { initialized: false, statuses: {} }; }
  }

  function queueAutomaticScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAutomaticPackages, 900);
  }

  function scanAutomaticPackages() {
    enhanceShareButtons();
    const sites = database().sites || [];
    const snapshot = parsedSnapshot();
    const next = { initialized: true, statuses: Object.fromEntries(sites.map((site) => [site.id, site.status || ''])) };
    localStorage.setItem(AUTO_SNAPSHOT_KEY, JSON.stringify(next));
    if (!snapshot.initialized || !officeAllowed() || !window.EdilKappaCloud?.ready) return;
    sites.forEach((site) => {
      if (!completed(site.status)) return;
      let result;
      try { result = filesForScope('site', site.id); } catch (_) { return; }
      if (!result.files.length) return;
      const currentFingerprint = fingerprint(result.files);
      const becameCompleted = !completed(snapshot.statuses?.[site.id]);
      const packageOutdated = site.completionPackage?.status === 'ready-local' && site.completionPackage.sourceFingerprint !== currentFingerprint;
      const recentCompletion = Date.parse(site.completedAt || site.updatedAt || '') >= Date.parse(FEATURE_RELEASE_AT);
      const failedLongAgo = site.completionPackage?.status === 'error' && Date.now() - Date.parse(site.completionPackage.failedAt || 0) > 10 * 60 * 1000;
      if (becameCompleted || packageOutdated || (recentCompletion && !site.completionPackage?.status) || failedLongAgo) {
        storedPackage(result.info, result.files).catch((error) => console.warn('Pacchetto automatico non creato:', error));
      }
    });
  }

  installStyles();
  const baseSave = window.save;
  if (typeof baseSave === 'function' && !baseSave.bulkSharingWrapped) {
    const wrapped = function (...args) { const result = baseSave.apply(this, args); queueAutomaticScan(); return result; };
    wrapped.bulkSharingWrapped = true;
    window.save = wrapped;
  }
  window.addEventListener('edilkappa:cloud-collection-synced', (event) => {
    if (['sites', 'reports', 'documents', 'quotes', 'drone'].includes(event.detail?.localName)) queueAutomaticScan();
  });
  window.addEventListener('online', queueAutomaticScan);
  new MutationObserver(() => requestAnimationFrame(enhanceShareButtons)).observe(document.body, { childList: true, subtree: true });
  window.EdilKappaBulkSharing = { filesForScope, zipFile, storedPackage, originalFilesForSelection, nativeShareFiles, open: window.openBulkShare };
  queueAutomaticScan();
})();
