const EDILKAPPA_SHARING_URL = 'https://edilkappa-condivisioni.edilkappasas.chatgpt.site';
const VALID_TRANSFER_AGE = 6 * 24 * 60 * 60 * 1000;
const FIREBASE_AUTH_MODULE = 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
const FIREBASE_STORAGE_MODULE = 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';
const SHARE_FIELDS = new Set(['media', 'photos']);
const MAX_DEVICE_ATTACHMENTS = 4;

function sharingDatabase() {
  return window.EdilKappaLocal?.getDB?.() || {};
}

function escapeShareHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function safeDaneaLink(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLocaleLowerCase('it');
    const allowed = url.protocol === 'https:' && (
      host === 'miocondominio.eu' ||
      host.endsWith('.miocondominio.eu') ||
      host === 'danea.it' ||
      host.endsWith('.danea.it')
    );
    return allowed ? url.href : '';
  } catch (_) {
    return '';
  }
}

function archiveFileContext(collectionName, itemId, attachmentIndex = null, attachmentField = 'media') {
  const database = sharingDatabase();
  const item = (database[collectionName] || []).find((entry) => String(entry.id) === String(itemId));
  if (!item) throw new Error('Il file non è più presente nell’archivio EdilKappa.');

  const field = SHARE_FIELDS.has(attachmentField) ? attachmentField : 'media';
  const hasIndex = Number.isInteger(attachmentIndex);
  const attachment = hasIndex && Array.isArray(item[field]) ? item[field][attachmentIndex] : item;
  if (!attachment) throw new Error('Il file selezionato non è più disponibile.');

  const storagePath = String(attachment.storagePath || '').trim();
  const directUrl = String(attachment.url || attachment.downloadUrl || '').trim();
  const dataUrl = String(attachment.dataUrl || '').trim();
  const fileKey = String(attachment.fileKey || attachment.pdfKey || attachment.key || '').trim();
  const attachmentId = String(attachment.attachmentId || '').trim();
  if (!storagePath && !directUrl && !dataUrl && !fileKey && !attachmentId) {
    throw new Error('Questo file non è ancora disponibile. Aprilo o ricaricalo prima di condividerlo.');
  }

  const fallbackTitle = item.code || item.title || item.subject || 'Allegato EdilKappa';
  return {
    collectionName,
    itemId: String(itemId),
    attachmentIndex: hasIndex ? attachmentIndex : null,
    attachmentField: field,
    item,
    attachment,
    storagePath,
    directUrl,
    dataUrl,
    fileKey,
    attachmentId,
    fileName: String(attachment.fileName || attachment.name || fallbackTitle).trim() || 'Allegato EdilKappa',
    fileType: String(attachment.fileType || attachment.type || 'application/octet-stream').trim(),
    fileSize: Number(attachment.fileSize || attachment.size || 0),
    title: String(item.title || item.subject || item.code || attachment.fileName || 'Allegato EdilKappa').trim()
  };
}

async function downloadUrlFor(context) {
  if (context.resolvedUrl) return context.resolvedUrl;
  if (context.storagePath) {
    if (window.EdilKappaCloud?.getDocumentUrl) {
      context.resolvedUrl = await window.EdilKappaCloud.getDocumentUrl(context.storagePath);
      return context.resolvedUrl;
    }
    const { getStorage, getDownloadURL, ref } = await import(FIREBASE_STORAGE_MODULE);
    context.resolvedUrl = await getDownloadURL(ref(getStorage(), context.storagePath));
    return context.resolvedUrl;
  }
  if (/^https?:\/\//i.test(context.directUrl)) {
    context.resolvedUrl = context.directUrl;
    return context.resolvedUrl;
  }
  if (context.dataUrl) {
    context.resolvedUrl = context.dataUrl;
    return context.resolvedUrl;
  }
  throw new Error(`${context.fileName} è disponibile solo su questo dispositivo. Usa “App del dispositivo” o “Scarica”.`);
}

async function localFileFor(context) {
  if (context.attachmentId && window.EdilKappaCloud?.getAttachmentFile) {
    return await window.EdilKappaCloud.getAttachmentFile(context.attachmentId);
  }
  if (!context.fileKey || !window.EdilKappaLocal?.readFile) return null;
  const blob = await window.EdilKappaLocal.readFile(context.fileKey);
  if (!blob) throw new Error(`${context.fileName} non è più presente su questo dispositivo.`);
  if (typeof File === 'function') {
    return new File([blob], context.fileName, { type: context.fileType || blob.type || 'application/octet-stream' });
  }
  blob.name = context.fileName;
  return blob;
}

function exactDaneaContext(collectionName, itemId, attachmentIndex = null, attachmentField = 'media') {
  const context = archiveFileContext(collectionName, itemId, attachmentIndex, attachmentField);
  const database = sharingDatabase();
  const interventionId = String(context.item.interventionId || '').trim();
  if (!interventionId) throw new Error('Assegna prima il file all’intervento preciso nella scheda del cliente.');
  const intervention = (database.interventions || []).find((entry) => String(entry.id) === interventionId);
  if (!intervention) throw new Error('L’intervento collegato non è stato trovato.');

  const daneaRequestId = String(intervention.daneaRequestId || '').trim();
  if (!daneaRequestId) throw new Error('Questo intervento non proviene ancora da una richiesta Danea.');
  const request = (database.leads || []).find((entry) => String(entry.id) === daneaRequestId);
  const daneaUrl = safeDaneaLink(request?.sourceUrl);
  if (!request || !daneaUrl) throw new Error('Nella richiesta Danea collegata manca il collegamento alla pratica precisa.');
  return { ...context, intervention, request, interventionId, daneaRequestId, daneaUrl };
}

function recentTransfer(attachment) {
  const createdAt = Date.parse(attachment?.transferNowCreatedAt || '');
  return String(attachment?.transferNowLink || '').startsWith('https://www.transfernow.net/') &&
    Number.isFinite(createdAt) &&
    Date.now() - createdAt < VALID_TRANSFER_AGE;
}

async function sharingRequest(path, options = {}) {
  const { getAuth } = await import(FIREBASE_AUTH_MODULE);
  const user = getAuth().currentUser;
  if (!user || !window.EdilKappaCloud?.ready) throw new Error('Accedi al gestionale prima di condividere il file.');
  const token = await user.getIdToken();
  const response = await fetch(`${EDILKAPPA_SHARING_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let body = {};
  try { body = await response.json(); } catch (_) {}
  if (!response.ok || !body.ok) throw new Error(body.error || 'Il servizio di condivisione non ha risposto correttamente.');
  return body;
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_) {
    return false;
  }
}

function setButtonBusy(button, busy, label = 'Preparazione…') {
  if (!(button instanceof HTMLElement)) return;
  if (busy) {
    button.dataset.sharingLabel = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.sharingLabel || button.textContent;
    delete button.dataset.sharingLabel;
  }
}

function setSharingStatus(message, error = false, html = '') {
  const target = document.getElementById('edilkappaSharingStatus');
  if (!target) return;
  target.className = `sharingStatus${error ? ' error' : ''}`;
  if (html) target.innerHTML = html;
  else target.textContent = message;
}

async function createTransfer(context) {
  if (!context.storagePath || !context.fileSize) {
    throw new Error('TransferNow richiede un file già salvato nel cloud con dimensione disponibile.');
  }
  if (recentTransfer(context.attachment)) {
    return { transferId: context.attachment.transferNowId || '', link: context.attachment.transferNowLink };
  }
  const sourceUrl = await downloadUrlFor(context);
  const daneaCode = context.request.daneaId || context.daneaRequestId;
  const result = await sharingRequest('/api/transfernow', {
    method: 'POST',
    body: JSON.stringify({
      fileName: context.fileName,
      fileSize: context.fileSize,
      sourceUrl,
      interventionId: context.interventionId,
      daneaRequestId: context.daneaRequestId,
      subject: `EdilKappa · ${context.fileName}`,
      message: `Allegato EdilKappa per l’intervento Danea ${daneaCode}: ${context.intervention.title || context.item.title || context.item.subject || context.fileName}`
    })
  });
  context.attachment.transferNowId = result.transferId;
  context.attachment.transferNowLink = result.link;
  context.attachment.transferNowCreatedAt = new Date().toISOString();
  context.item.updatedAt = new Date().toISOString();
  window.EdilKappaLocal?.persist?.();
  window.EdilKappaCloud?.scheduleSync?.();
  return result;
}

async function linkMessage(contexts) {
  const links = await Promise.all(contexts.map(async (context) => ({
    name: context.fileName,
    url: await downloadUrlFor(context)
  })));
  if (links.length === 1) return `${links[0].name}\n${links[0].url}`;
  return `Allegati EdilKappa (${links.length})\n\n${links.map((entry, index) => `${index + 1}. ${entry.name}\n${entry.url}`).join('\n\n')}`;
}

function openPreparedWindow() {
  const popup = window.open('', '_blank');
  if (popup) {
    popup.document.write('<p style="font:16px Arial;padding:24px">Preparazione della condivisione…</p>');
    popup.document.close();
  }
  return popup;
}

async function shareViaDevice(contexts) {
  const binaryContexts = contexts.filter((context) => context.fileKey || context.attachmentId);
  if (binaryContexts.length) {
    if (binaryContexts.length !== contexts.length) {
      throw new Error('Condividi separatamente i file locali e quelli disponibili tramite collegamento.');
    }
    if (binaryContexts.length > MAX_DEVICE_ATTACHMENTS) {
      throw new Error(`Per evitare “Load failed” seleziona al massimo ${MAX_DEVICE_ATTACHMENTS} file locali alla volta.`);
    }
  }
  const localFiles = [];
  for (const context of contexts) {
    if (context.fileKey || context.attachmentId) localFiles.push(await localFileFor(context));
  }
  const usableFiles = localFiles.filter(Boolean);
  if (usableFiles.length === contexts.length && navigator.share && navigator.canShare?.({ files: usableFiles })) {
    await navigator.share({ title: contexts.length === 1 ? contexts[0].fileName : 'Allegati EdilKappa', files: usableFiles });
    return;
  }

  const message = await linkMessage(contexts);
  if (navigator.share) {
    if (contexts.length === 1) {
      const url = await downloadUrlFor(contexts[0]);
      await navigator.share({ title: contexts[0].fileName, text: 'Allegato EdilKappa', url });
    } else {
      await navigator.share({ title: 'Allegati EdilKappa', text: message });
    }
    return;
  }
  if (await copyText(message)) {
    setSharingStatus('Collegamento copiato. Incollalo nell’app che vuoi usare.');
    return;
  }
  prompt('Copia questo collegamento:', message);
}

async function shareViaWhatsApp(contexts, popup) {
  const message = await linkMessage(contexts);
  const target = `https://wa.me/?text=${encodeURIComponent(message)}`;
  if (popup) popup.location.replace(target);
  else window.location.href = target;
}

async function shareViaEmail(contexts) {
  const message = await linkMessage(contexts);
  const subject = contexts.length === 1 ? `Allegato EdilKappa · ${contexts[0].fileName}` : `Allegati EdilKappa · ${contexts.length} file`;
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}

async function showDownloadLinks(contexts) {
  const targets = [];
  for (const context of contexts) {
    if (context.fileKey || context.attachmentId) {
      const file = await localFileFor(context);
      targets.push({ name: context.fileName, url: URL.createObjectURL(file), local: true });
    } else {
      targets.push({ name: context.fileName, url: await downloadUrlFor(context), local: false });
    }
  }
  const links = targets.map((target) => `<a class="btn sm green" href="${escapeShareHtml(target.url)}" ${target.local ? `download="${escapeShareHtml(target.name)}"` : 'target="_blank" rel="noopener"'}>${escapeShareHtml(target.name)}</a>`).join('');
  setSharingStatus('', false, `<b>${targets.length === 1 ? 'File pronto' : 'File pronti'}</b><small>Tocca ogni nome per scaricarlo.</small><div class="sharingDownloadLinks">${links}</div>`);
  setTimeout(() => targets.filter((target) => target.local).forEach((target) => URL.revokeObjectURL(target.url)), 10 * 60 * 1000);
}

async function shareDirectToDanea(context, popup) {
  const daneaContext = exactDaneaContext(context.collectionName, context.itemId, context.attachmentIndex, context.attachmentField);
  const sourceUrl = await downloadUrlFor(daneaContext);
  const daneaCode = daneaContext.request.daneaId || daneaContext.daneaRequestId;
  const message = `Intervento Danea ${daneaCode} – ${daneaContext.fileName}\n${sourceUrl}`;
  const copied = await copyText(message);
  if (popup) popup.location.replace(daneaContext.daneaUrl);
  else window.open(daneaContext.daneaUrl, '_blank', 'noopener');
  if (copied) {
    alert(`È stata aperta la pratica Danea ${daneaCode}. Il messaggio con il collegamento diretto è già copiato: incollalo nell’intervento e premi Invia.`);
  } else {
    prompt(`È stata aperta la pratica Danea ${daneaCode}. Copia questo messaggio nell’intervento:`, message);
  }
}

window.openTransferNowSettings = function () {
  const role = window.EdilKappaCloud?.currentProfile?.role;
  if (role !== 'owner') return alert('La configurazione TransferNow è riservata al titolare.');
  modal('Configura TransferNow', `<div class="notice"><b>Chiave protetta</b><br>La chiave viene verificata e cifrata nel servizio EdilKappa. Non resta memorizzata nel browser.</div><div style="height:14px"></div>
    <div class="field"><label>Chiave API TransferNow</label><input name="apiKey" type="password" autocomplete="new-password" minlength="16" required placeholder="Inserisci la chiave dal tuo account TransferNow"><small>Non condividere questa chiave in chat, e-mail o messaggi.</small></div>`,
  async (formData) => {
    const apiKey = String(formData.get('apiKey') || '').trim();
    if (apiKey.length < 16 || /\s/.test(apiKey)) throw new Error('Inserisci una chiave API TransferNow valida.');
    await sharingRequest('/api/settings/transfernow', { method: 'POST', body: JSON.stringify({ apiKey }) });
    setTimeout(() => alert('TransferNow è configurato e pronto per gli invii.'), 80);
  });
};

window.shareWithTransferNow = async function (collectionName, itemId, attachmentIndex = null, attachmentField = 'media', button = null) {
  setButtonBusy(button, true);
  try {
    const context = exactDaneaContext(collectionName, itemId, attachmentIndex, attachmentField);
    const result = await createTransfer(context);
    const copied = await copyText(result.link);
    if (!copied) return prompt('Copia il collegamento TransferNow:', result.link);
    if (confirm('Collegamento TransferNow creato e copiato. Vuoi aprirlo ora?')) window.open(result.link, '_blank', 'noopener');
  } catch (error) {
    alert(error.message || 'Impossibile creare il collegamento TransferNow.');
  } finally {
    setButtonBusy(button, false);
  }
};

window.shareArchiveToDanea = async function (collectionName, itemId, attachmentIndex = null, attachmentField = 'media', button = null) {
  const daneaWindow = openPreparedWindow();
  setButtonBusy(button, true);
  try {
    const context = archiveFileContext(collectionName, itemId, attachmentIndex, attachmentField);
    await shareDirectToDanea(context, daneaWindow);
  } catch (error) {
    daneaWindow?.close();
    alert(error.message || 'Impossibile aprire l’intervento Danea collegato.');
  } finally {
    setButtonBusy(button, false);
  }
};

function sharingRoleAllowed() {
  const role = window.EdilKappaCloud?.currentProfile?.role || window.role || window.EdilKappaLocal?.getRole?.();
  return ['owner', 'office', 'secretary', 'worker', 'administrator'].includes(String(role || ''));
}

function daneaRoleAllowed() {
  const role = window.EdilKappaCloud?.currentProfile?.role || window.role || window.EdilKappaLocal?.getRole?.();
  return ['owner', 'office', 'secretary'].includes(String(role || ''));
}

function canShareArchive(collectionName, itemId, attachmentIndex = null, attachmentField = 'media') {
  if (!sharingRoleAllowed()) return false;
  try {
    archiveFileContext(collectionName, itemId, attachmentIndex, attachmentField);
    return true;
  } catch (_) {
    return false;
  }
}

function canShareDanea(context) {
  if (!daneaRoleAllowed()) return false;
  try {
    exactDaneaContext(context.collectionName, context.itemId, context.attachmentIndex, context.attachmentField);
    return true;
  } catch (_) {
    return false;
  }
}

function selectedShareContexts(allContexts) {
  const allChecks = Array.from(document.querySelectorAll('[data-sharing-file-index]'));
  if (!allChecks.length) return allContexts.length === 1 ? allContexts : [];
  return allChecks.filter((check) => check.checked).map((check) => allContexts[Number(check.dataset.sharingFileIndex)]).filter(Boolean);
}

function updateSelectionSummary(allContexts) {
  const selected = selectedShareContexts(allContexts);
  const summary = document.getElementById('edilkappaSharingSelection');
  if (summary) summary.textContent = `${selected.length} ${selected.length === 1 ? 'file selezionato' : 'file selezionati'}`;
  document.querySelectorAll('[data-sharing-action]').forEach((button) => { button.disabled = selected.length === 0; });
}

async function runSharingAction(action, allContexts, button) {
  const contexts = selectedShareContexts(allContexts);
  if (!contexts.length) return setSharingStatus('Seleziona almeno un file.', true);
  const popup = ['whatsapp', 'danea'].includes(action) ? openPreparedWindow() : null;
  setButtonBusy(button, true);
  setSharingStatus('Preparazione del collegamento sicuro…');
  try {
    if (action === 'device') await shareViaDevice(contexts);
    else if (action === 'whatsapp') await shareViaWhatsApp(contexts, popup);
    else if (action === 'email') await shareViaEmail(contexts);
    else if (action === 'download') await showDownloadLinks(contexts);
    else if (action === 'copy') {
      const message = await linkMessage(contexts);
      if (await copyText(message)) setSharingStatus('Collegamento copiato.');
      else prompt('Copia il collegamento:', message);
    } else if (action === 'danea') {
      if (contexts.length !== 1) throw new Error('Per Danea seleziona un file alla volta.');
      await shareDirectToDanea(contexts[0], popup);
    } else if (action === 'transfernow') {
      if (contexts.length !== 1) throw new Error('Per TransferNow seleziona un file alla volta.');
      const context = exactDaneaContext(contexts[0].collectionName, contexts[0].itemId, contexts[0].attachmentIndex, contexts[0].attachmentField);
      const result = await createTransfer(context);
      if (await copyText(result.link)) setSharingStatus('Collegamento TransferNow copiato.');
      else prompt('Copia il collegamento TransferNow:', result.link);
    }
  } catch (error) {
    popup?.close();
    if (error?.name !== 'AbortError') setSharingStatus(error.message || 'Condivisione non riuscita.', true);
  } finally {
    setButtonBusy(button, false);
  }
}

function shareChoice(action, icon, title, detail, extraClass = '') {
  return `<button class="sharingChoice ${extraClass}" type="button" data-sharing-action="${action}"><span>${icon}</span><b>${escapeShareHtml(title)}</b><small>${escapeShareHtml(detail)}</small></button>`;
}

function renderSharingDialog(title, contexts, selectable = false) {
  const dialog = document.getElementById('modal');
  const content = document.getElementById('modalContent');
  if (!dialog || !content) throw new Error('La finestra di condivisione non è disponibile.');
  const singleDanea = contexts.length === 1 && canShareDanea(contexts[0]);
  const singleTransfer = singleDanea && contexts[0].storagePath && contexts[0].fileSize > 0;
  const rows = contexts.map((context, index) => `<label class="sharingFileRow">
    ${selectable ? `<input type="checkbox" data-sharing-file-index="${index}" checked>` : '<span class="sharingFileCheck">✓</span>'}
    <span class="sharingFileIcon">${String(context.fileType).startsWith('video/') ? '🎬' : String(context.fileType).startsWith('image/') ? '🖼️' : '📄'}</span>
    <span><b>${escapeShareHtml(context.fileName)}</b><small>${context.fileSize ? `${Math.max(1, Math.round(context.fileSize / 1024))} KB` : 'File archiviato'}</small></span>
  </label>`).join('');
  content.innerHTML = `<div class="modalHead"><div><h3>Condividi</h3><small>${escapeShareHtml(title)}</small></div><button class="close" type="button" onclick="closeModal()">×</button></div>
    <div class="modalBody sharingBody">
      ${selectable ? `<label class="sharingSelectAll"><input id="edilkappaSharingAll" type="checkbox" checked><b>Seleziona tutto</b></label><div id="edilkappaSharingSelection" class="sharingSelection">${contexts.length} file selezionati</div>` : ''}
      <div class="sharingFiles">${rows}</div>
      <div id="edilkappaSharingStatus" class="sharingStatus">Scegli come condividere. I file cloud non vengono caricati nella memoria dell’iPhone.</div>
      <div class="sharingChoices">
        ${shareChoice('device', '↗', 'App del dispositivo', 'WhatsApp, AirDrop e altre app', 'primary')}
        ${shareChoice('whatsapp', '💬', 'WhatsApp', 'Invia il collegamento al file')}
        ${shareChoice('email', '✉️', 'E-mail', 'Prepara oggetto e collegamento')}
        ${shareChoice('download', '⬇️', 'Scarica', 'Salva uno o più file')}
        ${shareChoice('copy', '📋', 'Copia collegamento', 'Incollalo dove preferisci')}
        ${singleDanea ? shareChoice('danea', 'D', 'Danea', 'Apre la pratica collegata') : ''}
        ${singleTransfer ? shareChoice('transfernow', 'T', 'TransferNow', 'Facoltativo per file grandi') : ''}
      </div>
    </div>
    <div class="modalFoot"><button class="btn light" type="button" onclick="closeModal()">Chiudi</button></div>`;

  content.querySelectorAll('[data-sharing-action]').forEach((button) => {
    button.addEventListener('click', () => runSharingAction(button.dataset.sharingAction, contexts, button));
  });
  content.querySelectorAll('[data-sharing-file-index]').forEach((check) => {
    check.addEventListener('change', () => {
      const all = document.getElementById('edilkappaSharingAll');
      const fileChecks = Array.from(content.querySelectorAll('[data-sharing-file-index]'));
      if (all) all.checked = fileChecks.every((input) => input.checked);
      updateSelectionSummary(contexts);
    });
  });
  const selectAll = document.getElementById('edilkappaSharingAll');
  selectAll?.addEventListener('change', () => {
    content.querySelectorAll('[data-sharing-file-index]').forEach((check) => { check.checked = selectAll.checked; });
    updateSelectionSummary(contexts);
  });
  if (!dialog.open) dialog.showModal();
}

window.openArchiveShare = function (collectionName, itemId, attachmentIndex = null, attachmentField = 'media') {
  try {
    const context = archiveFileContext(collectionName, itemId, attachmentIndex, attachmentField);
    renderSharingDialog(context.title, [context], false);
  } catch (error) {
    alert(error.message || 'File non disponibile per la condivisione.');
  }
};

window.openSitePhotoShare = function (siteId) {
  try {
    const database = sharingDatabase();
    const site = (database.sites || []).find((entry) => String(entry.id) === String(siteId));
    const contexts = [];
    (database.reports || []).filter((report) => String(report.site || report.siteId || '') === String(siteId)).forEach((report) => {
      (report.photos || []).forEach((_, index) => {
        try { contexts.push(archiveFileContext('reports', report.id, index, 'photos')); } catch (_) {}
      });
    });
    if (!contexts.length) throw new Error('Non ci sono fotografie disponibili da condividere.');
    renderSharingDialog(site?.title || 'Foto del cantiere', contexts, true);
  } catch (error) {
    alert(error.message || 'Fotografie non disponibili per la condivisione.');
  }
};

function sharingButton(handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn sm light';
  button.textContent = 'Condividi';
  button.dataset.edilkappaShareButton = 'true';
  button.addEventListener('click', handler);
  return button;
}

function enhanceMainFileButtons() {
  document.querySelectorAll('button[onclick*="openQuotePdf("], button[onclick*="openBusinessDocument("]').forEach((openButton) => {
    if (openButton.dataset.sharingChecked) return;
    openButton.dataset.sharingChecked = 'true';
    const onclick = openButton.getAttribute('onclick') || '';
    const quoteMatch = onclick.match(/openQuotePdf\('([^']+)'\)/);
    const documentMatch = onclick.match(/openBusinessDocument\('([^']+)'\)/);
    const collectionName = quoteMatch ? 'quotes' : documentMatch ? 'documents' : '';
    const itemId = quoteMatch?.[1] || documentMatch?.[1] || '';
    if (!collectionName || !canShareArchive(collectionName, itemId)) return;
    const actions = openButton.closest('.actions') || openButton.parentElement;
    if (!actions || actions.querySelector('[data-edilkappa-share-button]')) return;
    openButton.insertAdjacentElement('afterend', sharingButton(() => window.openArchiveShare(collectionName, itemId)));
  });
}

function enhanceMediaButtons() {
  document.querySelectorAll('button[onclick*="openStoredMedia("]').forEach((openButton) => {
    if (openButton.dataset.sharingChecked) return;
    openButton.dataset.sharingChecked = 'true';
    const match = (openButton.getAttribute('onclick') || '').match(/openStoredMedia\('([^']+)','([^']+)',(\d+)\)/);
    if (!match) return;
    const collectionName = match[1];
    const itemId = match[2];
    const attachmentIndex = Number(match[3]);
    if (!canShareArchive(collectionName, itemId, attachmentIndex, 'media')) return;
    openButton.insertAdjacentElement('afterend', sharingButton(() => window.openArchiveShare(collectionName, itemId, attachmentIndex, 'media')));
  });
}

function enhanceSharingButtons() {
  if (!sharingRoleAllowed()) return;
  enhanceMainFileButtons();
  enhanceMediaButtons();
}

const sharingStyle = document.createElement('style');
sharingStyle.textContent = `
  .sharingBody{display:grid;gap:15px}.sharingFiles{display:grid;gap:8px;max-height:270px;overflow:auto}.sharingFileRow{display:grid;grid-template-columns:auto auto minmax(0,1fr);align-items:center;gap:11px;padding:11px;border:1px solid var(--line);border-radius:14px;background:#fff}.sharingFileRow input,.sharingSelectAll input{width:22px;height:22px;accent-color:var(--green)}.sharingFileCheck{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;background:var(--green);color:#fff;font-weight:900}.sharingFileIcon{width:38px;height:38px;border-radius:11px;background:#f1f3f4;display:grid;place-items:center}.sharingFileRow b,.sharingFileRow small{display:block;overflow:hidden;text-overflow:ellipsis}.sharingFileRow b{white-space:nowrap}.sharingFileRow small{color:var(--muted);margin-top:3px}.sharingSelectAll{display:flex;align-items:center;gap:10px;font-size:18px}.sharingSelection{color:var(--muted);font-weight:700}.sharingStatus{padding:12px 14px;border-radius:13px;background:#eef7f1;color:#245a37;font-size:13px}.sharingStatus.error{background:#feeceb;color:var(--red)}.sharingStatus small{display:block;margin-top:3px}.sharingChoices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.sharingChoice{min-height:112px;border:1px solid #cfe1d5;border-radius:17px;background:#fff;color:var(--ink);padding:14px;text-align:left}.sharingChoice.primary{background:#19201b;color:#fff;border-color:#19201b}.sharingChoice>span{display:block;font-size:25px;margin-bottom:9px}.sharingChoice>b,.sharingChoice>small{display:block}.sharingChoice>small{margin-top:4px;color:var(--muted);font-size:12px}.sharingChoice.primary>small{color:#d5ddd6}.sharingChoice:disabled{opacity:.45}.sharingDownloadLinks{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.sharingDownloadLinks .btn{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(max-width:520px){.sharingChoices{grid-template-columns:1fr 1fr}.sharingChoice{min-height:104px;padding:12px}.sharingFiles{max-height:235px}}
`;
document.head.appendChild(sharingStyle);

let enhancementQueued = false;
function queueEnhancement() {
  if (enhancementQueued) return;
  enhancementQueued = true;
  requestAnimationFrame(() => {
    enhancementQueued = false;
    enhanceSharingButtons();
  });
}

new MutationObserver(queueEnhancement).observe(document.body, { childList: true, subtree: true });
window.addEventListener('load', queueEnhancement);
queueEnhancement();

import('./quick-site-photos.js?v=2').catch((error) => {
  console.error('Caricamento foto rapido non disponibile:', error);
});
