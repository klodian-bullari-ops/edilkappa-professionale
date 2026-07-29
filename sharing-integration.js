const EDILKAPPA_SHARING_URL = 'https://edilkappa-condivisioni.edilkappasas.chatgpt.site';
const VALID_TRANSFER_AGE = 6 * 24 * 60 * 60 * 1000;
const FIREBASE_AUTH_MODULE = 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
const FIREBASE_STORAGE_MODULE = 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';

function sharingDatabase() {
  return window.EdilKappaLocal?.getDB?.() || {};
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

function exactDaneaContext(collectionName, itemId, mediaIndex = null) {
  const database = sharingDatabase();
  const item = (database[collectionName] || []).find((entry) => String(entry.id) === String(itemId));
  if (!item) throw new Error('Il file non è più presente nell’archivio EdilKappa.');

  const attachment = Number.isInteger(mediaIndex)
    ? (Array.isArray(item.media) ? item.media[mediaIndex] : null)
    : item;
  if (!attachment?.storagePath || !attachment.fileName || !Number(attachment.fileSize)) {
    throw new Error('Questo file non è ancora disponibile nel cloud. Aprilo o ricaricalo prima di inviarlo.');
  }

  const interventionId = String(item.interventionId || '').trim();
  if (!interventionId) {
    throw new Error('Assegna prima il file all’intervento preciso nella scheda del cliente.');
  }
  const intervention = (database.interventions || []).find((entry) => String(entry.id) === interventionId);
  if (!intervention) throw new Error('L’intervento collegato non è stato trovato.');

  const daneaRequestId = String(intervention.daneaRequestId || '').trim();
  if (!daneaRequestId) {
    throw new Error('Questo intervento non proviene ancora da una richiesta Danea.');
  }
  const request = (database.leads || []).find((entry) => String(entry.id) === daneaRequestId);
  const daneaUrl = safeDaneaLink(request?.sourceUrl);
  if (!request || !daneaUrl) {
    throw new Error('Nella richiesta Danea collegata manca il collegamento alla pratica precisa.');
  }

  return { item, attachment, intervention, request, interventionId, daneaRequestId, daneaUrl };
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

function setButtonBusy(button, busy, label = 'Invio…') {
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

async function createTransfer(context) {
  if (recentTransfer(context.attachment)) {
    return {
      transferId: context.attachment.transferNowId || '',
      link: context.attachment.transferNowLink
    };
  }
  const { getStorage, getDownloadURL, ref } = await import(FIREBASE_STORAGE_MODULE);
  const sourceUrl = await getDownloadURL(ref(getStorage(), context.attachment.storagePath));
  const daneaCode = context.request.daneaId || context.daneaRequestId;
  const result = await sharingRequest('/api/transfernow', {
    method: 'POST',
    body: JSON.stringify({
      fileName: context.attachment.fileName,
      fileSize: Number(context.attachment.fileSize),
      sourceUrl,
      interventionId: context.interventionId,
      daneaRequestId: context.daneaRequestId,
      subject: `EdilKappa · ${context.attachment.fileName}`,
      message: `Allegato EdilKappa per l’intervento Danea ${daneaCode}: ${context.intervention.title || context.item.title || context.item.subject || context.attachment.fileName}`
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

window.openTransferNowSettings = function () {
  const role = window.EdilKappaCloud?.currentProfile?.role;
  if (role !== 'owner') return alert('La configurazione TransferNow è riservata al titolare.');
  modal('Configura TransferNow', `<div class="notice"><b>Chiave protetta</b><br>La chiave viene verificata e cifrata nel servizio EdilKappa. Non resta memorizzata nel browser.</div><div style="height:14px"></div>
    <div class="field"><label>Chiave API TransferNow</label><input name="apiKey" type="password" autocomplete="new-password" minlength="16" required placeholder="Inserisci la chiave dal tuo account TransferNow"><small>Non condividere questa chiave in chat, e-mail o messaggi.</small></div>`,
  async (formData) => {
    const apiKey = String(formData.get('apiKey') || '').trim();
    if (apiKey.length < 16 || /\s/.test(apiKey)) throw new Error('Inserisci una chiave API TransferNow valida.');
    await sharingRequest('/api/settings/transfernow', {
      method: 'POST',
      body: JSON.stringify({ apiKey })
    });
    setTimeout(() => alert('TransferNow è configurato e pronto per gli invii.'), 80);
  });
};

window.shareWithTransferNow = async function (collectionName, itemId, mediaIndex = null, button = null) {
  setButtonBusy(button, true, 'Preparazione…');
  try {
    const context = exactDaneaContext(collectionName, itemId, mediaIndex);
    const result = await createTransfer(context);
    const copied = await copyText(result.link);
    if (!copied) {
      prompt('Copia il collegamento TransferNow:', result.link);
      return;
    }
    if (confirm('Collegamento TransferNow creato e copiato. Vuoi aprirlo ora?')) {
      window.open(result.link, '_blank', 'noopener');
    }
  } catch (error) {
    alert(error.message || 'Impossibile creare il collegamento TransferNow.');
  } finally {
    setButtonBusy(button, false);
  }
};

window.shareArchiveToDanea = async function (collectionName, itemId, mediaIndex = null, button = null) {
  let daneaWindow = null;
  setButtonBusy(button, true, 'Preparazione…');
  try {
    const context = exactDaneaContext(collectionName, itemId, mediaIndex);
    daneaWindow = window.open('', '_blank');
    if (daneaWindow) {
      daneaWindow.document.write('<p style="font:16px Arial;padding:24px">Preparazione del collegamento sicuro…</p>');
      daneaWindow.document.close();
    }
    const result = await createTransfer(context);
    const daneaCode = context.request.daneaId || context.daneaRequestId;
    const message = `Intervento Danea ${daneaCode} – ${context.attachment.fileName}\n${result.link}`;
    const copied = await copyText(message);
    if (daneaWindow) daneaWindow.location.replace(context.daneaUrl);
    else window.open(context.daneaUrl, '_blank', 'noopener');
    if (copied) {
      alert(`È stata aperta la pratica Danea ${daneaCode}. Il messaggio con il collegamento è già copiato: incollalo nell’intervento e premi Invia.`);
    } else {
      prompt(`È stata aperta la pratica Danea ${daneaCode}. Copia questo messaggio nell’intervento:`, message);
    }
  } catch (error) {
    daneaWindow?.close();
    alert(error.message || 'Impossibile aprire l’intervento Danea collegato.');
  } finally {
    setButtonBusy(button, false);
  }
};

function sharingRoleAllowed() {
  return ['owner', 'office'].includes(window.EdilKappaCloud?.currentProfile?.role);
}

function canShareExactly(collectionName, itemId, mediaIndex = null) {
  if (!sharingRoleAllowed()) return false;
  try {
    exactDaneaContext(collectionName, itemId, mediaIndex);
    return true;
  } catch (_) {
    return false;
  }
}

function sharingButton(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.dataset.edilkappaSharing = 'true';
  button.addEventListener('click', handler);
  return button;
}

function enhanceMainFileButtons() {
  document.querySelectorAll('button[onclick*="openQuotePdf("], button[onclick*="openBusinessDocument("]').forEach((openButton) => {
    if (openButton.dataset.daneaSharingChecked) return;
    openButton.dataset.daneaSharingChecked = 'true';
    const onclick = openButton.getAttribute('onclick') || '';
    const quoteMatch = onclick.match(/openQuotePdf\('([^']+)'\)/);
    const documentMatch = onclick.match(/openBusinessDocument\('([^']+)'\)/);
    const collectionName = quoteMatch ? 'quotes' : documentMatch ? 'documents' : '';
    const itemId = quoteMatch?.[1] || documentMatch?.[1] || '';
    if (!collectionName || !canShareExactly(collectionName, itemId)) return;
    const item = (sharingDatabase()[collectionName] || []).find((entry) => String(entry.id) === itemId);
    const actions = openButton.closest('.actions') || openButton.parentElement;
    if (!actions || actions.querySelector(`[data-danea-file="${CSS.escape(collectionName)}-${CSS.escape(itemId)}"]`)) return;

    const danea = sharingButton('Danea', 'btn sm green', () => window.shareArchiveToDanea(collectionName, itemId, null, danea));
    danea.dataset.daneaFile = `${collectionName}-${itemId}`;
    openButton.insertAdjacentElement('afterend', danea);
    if (String(item?.fileType || '').startsWith('video/')) {
      const transferNow = sharingButton('TransferNow', 'btn sm light', () => window.shareWithTransferNow(collectionName, itemId, null, transferNow));
      danea.insertAdjacentElement('afterend', transferNow);
    }
  });
}

function enhanceMediaButtons() {
  document.querySelectorAll('button[onclick*="openStoredMedia("]').forEach((openButton) => {
    if (openButton.dataset.daneaSharingChecked) return;
    openButton.dataset.daneaSharingChecked = 'true';
    const match = (openButton.getAttribute('onclick') || '').match(/openStoredMedia\('([^']+)','([^']+)',(\d+)\)/);
    if (!match) return;
    const collectionName = match[1];
    const itemId = match[2];
    const mediaIndex = Number(match[3]);
    if (!canShareExactly(collectionName, itemId, mediaIndex)) return;
    const item = (sharingDatabase()[collectionName] || []).find((entry) => String(entry.id) === itemId);
    const attachment = Array.isArray(item?.media) ? item.media[mediaIndex] : null;

    const danea = sharingButton('Danea', 'btn sm green', () => window.shareArchiveToDanea(collectionName, itemId, mediaIndex, danea));
    openButton.insertAdjacentElement('afterend', danea);
    if (String(attachment?.fileType || '').startsWith('video/')) {
      const transferNow = sharingButton('TransferNow', 'btn sm light', () => window.shareWithTransferNow(collectionName, itemId, mediaIndex, transferNow));
      danea.insertAdjacentElement('afterend', transferNow);
    }
  });
}

function enhanceSharingButtons() {
  if (!sharingRoleAllowed()) return;
  enhanceMainFileButtons();
  enhanceMediaButtons();
}

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
