import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js';
import {
  getAuth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {
  getFunctions,
  httpsCallable
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import {
  getMessaging,
  getToken,
  isSupported as isMessagingSupported,
  onMessage
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging.js';
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes,
  uploadBytesResumable
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';

const FIREBASE_CONFIG = {
  projectId: 'edilkappa-professionale',
  appId: '1:583702130706:web:598e050830cef19ea2a8cb',
  storageBucket: 'edilkappa-professionale.firebasestorage.app',
  apiKey: 'AIzaSyAWP8Frwm6gIQnIfaEwe639F5cSOs8wdiE',
  authDomain: 'edilkappa-professionale.firebaseapp.com',
  messagingSenderId: '583702130706'
};

const ORG_ID = 'edilkappa';
const OWNER_EMAIL = 'info@edilkappa.com';
const ACCOUNT_STORAGE_KEY = 'edilkappa_cloud_uid_v1';
const local = window.EdilKappaLocal;
const app = initializeApp(FIREBASE_CONFIG);
const appCheckSiteKey = String(window.EdilKappaRuntimeConfig?.appCheckSiteKey || '').trim();
const appCheckMode = window.EdilKappaRuntimeConfig?.appCheckMode === 'enforce' ? 'enforce' : 'observe';
const appCheckConfigured = /^[a-zA-Z0-9_-]{20,200}$/.test(appCheckSiteKey) && !appCheckSiteKey.includes('EDILKAPPA_APP_CHECK');
let appCheckReady = false;
let appCheckError = '';
if (appCheckConfigured) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    });
    appCheckReady = true;
  } catch (error) { appCheckError = String(error?.message || 'App Check non inizializzato').slice(0, 300); }
}
const auth = getAuth(app);
const firestore = getFirestore(app, 'edilkappa');
const storage = getStorage(app);
const functions = getFunctions(app, 'europe-west8');
const callEdilKappaAi = httpsCallable(functions, 'edilkappaAi', { timeout: 610000 });
const callEdilKappaOperations = httpsCallable(functions, 'edilkappaOperations', { timeout: 550000 });
const callEdilKappaDaneaBridge = httpsCallable(functions, 'edilkappaDaneaBridge', { timeout: 40000 });
const callEdilKappaBackup = httpsCallable(functions, 'edilkappaBackup', { timeout: 550000 });
const callEdilKappaHealth = httpsCallable(functions, 'edilkappaHealth', { timeout: 45000 });
const callEdilKappaNotifications = httpsCallable(functions, 'edilkappaNotifications', { timeout: 40000 });
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
const MEDIA_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);
const MEDIA_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v'
]);

const mappings = [
  ['condomini', 'clients'],
  ['inspections', 'inspections'],
  ['sites', 'sites'],
  ['quotes', 'quotes'],
  ['reports', 'reports'],
  ['timesheets', 'timesheets'],
  ['absences', 'absences'],
  ['edilconnect', 'edilconnect'],
  ['drone', 'drone'],
  ['lifelines', 'lifelines'],
  ['roofs', 'roofs'],
  ['drains', 'drains'],
  ['expenses', 'expenses'],
  ['teams', 'teams'],
  ['deadlines', 'deadlines'],
  ['payments', 'payments'],
  ['documents', 'documents'],
  ['leads', 'leads'],
  ['priceList', 'priceList'],
  ['certificates', 'certificates'],
  ['inventory', 'inventory'],
  ['equipment', 'equipment'],
  ['companySettings', 'settings']
];

const mappingByRemote = new Map(mappings.map(([localName, remoteName]) => [remoteName, localName]));
const clientCollections = new Set(['clients', 'inspections', 'sites', 'quotes', 'reports', 'drone', 'lifelines', 'roofs', 'drains', 'deadlines', 'payments', 'documents', 'certificates']);
const workerCollections = new Set(['sites', 'reports', 'timesheets', 'absences', 'roofs', 'drains', 'teams']);
const remoteMaps = new Map();
const listenerMaps = new Map();
const remoteIds = new Map();
const loadedCollections = new Set();
const pendingCollectionEvents = new Map();
const initialHydrationSources = new Set();
const collectionSyncState = new Map();
const CLOUD_RENDER_DEBOUNCE_MS = 120;
const CLOUD_RENDER_MAX_WAIT_MS = 500;
const INITIAL_HYDRATION_TIMEOUT_MS = 1800;
let user = null;
let profile = null;
let cloudUsers = [];
let unsubscribeProfile = null;
let unsubscribers = [];
let activationKey = '';
let syncTimer = null;
let syncPromise = Promise.resolve();
let syncing = false;
let ready = false;
let lastSyncAt = '';
let lastSyncError = '';
let cloudRenderTimer = null;
let cloudRenderMaxTimer = null;
let localPersistScheduled = false;
let initialHydrationTimer = null;
let initialHydrationActive = false;
let initialHydrationRegistrationComplete = false;

const api = {
  scheduleSync,
  syncNow,
  async syncCollection(localName) {
    const mapping = mappings.find(([name]) => name === localName);
    if (!mapping) throw new Error('Archivio cloud non riconosciuto.');
    if (!ready || !profile || profile.role === 'administrator') throw new Error('Il collegamento cloud non è pronto.');
    await pushCollection(mapping[0], mapping[1]);
  },
  async syncRecord(localName, record) {
    const mapping = mappings.find(([name]) => name === localName);
    if (!mapping) throw new Error('Archivio cloud non riconosciuto.');
    if (!record?.id) throw new Error('Record cloud non valido.');
    if (!ready || !profile || profile.role === 'administrator') throw new Error('Il collegamento cloud non è pronto.');
    const remoteName = mapping[1];
    if (!canPush(remoteName)) throw new Error('Non hai i permessi per salvare questo record.');
    const known = remoteIds.get(remoteName) || new Set();
    const frozenRecord = JSON.parse(safePayload(record));
    await setDoc(
      doc(firestore, remoteName, String(frozenRecord.id)),
      envelope(frozenRecord, remoteName, !known.has(String(frozenRecord.id))),
      { merge: true }
    );
  },
  async aiRequest(payload) {
    const response = await callEdilKappaAi(payload);
    return response.data;
  },
  async operationsRequest(payload) {
    const response = await callEdilKappaOperations(payload);
    return response.data;
  },
  async daneaBridgeRequest(payload) {
    const response = await callEdilKappaDaneaBridge(payload);
    return response.data;
  },
  async backupRequest(payload = { action: 'list' }) {
    const response = await callEdilKappaBackup(payload);
    return response.data;
  },
  async healthRequest(payload = { action: 'status' }) {
    const response = await callEdilKappaHealth(payload);
    return response.data;
  },
  async notificationRequest(payload = { action: 'status' }) {
    const requestPayload = { ...payload };
    if ('Notification' in window && Notification.permission === 'granted' && await isMessagingSupported()) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          const token = await getToken(getMessaging(app), { serviceWorkerRegistration: registration });
          if (token) requestPayload.deviceId = await tokenDocumentId(token);
        }
      } catch (_) {}
    }
    const response = await callEdilKappaNotifications(requestPayload);
    return response.data;
  },
  restrictView(next) {
    return profile?.role === 'administrator' ? 'portalPreview' : next;
  },
  uploadAttachment,
  openAttachment,
  getAttachmentFile,
  uploadMedia,
  uploadDocument,
  uploadSharePackage,
  getDocumentUrl,
  openDocument,
  deleteDocument,
  softDeleteRecord,
  restoreDeletedRecord,
  permanentlyDeleteRecord,
  reportClientError,
  reportPerformanceMetric,
  listClientErrors,
  enablePushNotifications,
  get ready() { return ready; },
  get syncing() { return syncing; },
  get lastSyncAt() { return lastSyncAt; },
  get lastSyncError() { return lastSyncError; },
  get syncHealth() {
    return Array.from(collectionSyncState, ([collectionName, state]) => ({ collectionName, ...state }));
  },
  get currentUid() { return user?.uid || ''; },
  get currentProfile() { return profile; },
  get appCheckConfigured() { return appCheckConfigured; },
  get appCheckReady() { return appCheckReady; },
  get appCheckMode() { return appCheckMode; },
  get appCheckError() { return appCheckError; },
  get workerProfiles() {
    if (!['owner', 'office'].includes(profile?.role)) return [];
    return cloudUsers
      .filter((item) => item.role === 'worker' && item.active && item.teamId)
      .map((item) => ({ id: item.uid, uid: item.uid, name: item.displayName || item.email, team: item.teamId }));
  }
};
window.EdilKappaCloud = api;

async function tokenDocumentId(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

async function enablePushNotifications() {
  if (!user || !profile) throw new Error('Accedi prima di attivare le notifiche.');
  if (!('Notification' in window) || !await isMessagingSupported()) throw new Error('Le notifiche push non sono supportate su questo dispositivo.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Le notifiche non sono state autorizzate.');
  const registration = await navigator.serviceWorker.ready;
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { serviceWorkerRegistration: registration });
  if (!token) throw new Error('Firebase non ha restituito il token del dispositivo.');
  const id = await tokenDocumentId(token);
  const deviceRef = doc(firestore, 'pushDevices', `${user.uid}_${id}`);
  const existing = await getDoc(deviceRef);
  await setDoc(deviceRef, {
    uid: user.uid, orgId: ORG_ID, role: profile.role, token,
    userAgent: navigator.userAgent.slice(0, 300),
    ...(existing.exists() ? {} : { createdAt: serverTimestamp() }), updatedAt: serverTimestamp()
  }, { merge: true });
  return true;
}

isMessagingSupported().then((supported) => {
  if (!supported) return;
  onMessage(getMessaging(app), (payload) => {
    const data = payload.data || {};
    window.EdilKappaCompletion?.addActivity?.({
      id: data.eventId || `push-${Date.now()}`, type: data.type || 'push',
      title: payload.notification?.title || data.title || 'Nuovo avviso EdilKappa',
      text: payload.notification?.body || data.body || '', targetType: data.targetType || '', targetId: data.targetId || ''
    });
  });
}).catch(() => {});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function errorText(error) {
  const code = String(error?.code || '');
  if (code.includes('invalid-credential')) return 'Email o password non corretti.';
  if (code.includes('email-already-in-use')) return 'Questa email ha già un account. Usa Accedi.';
  if (code.includes('weak-password')) return 'Scegli una password di almeno 6 caratteri.';
  if (code.includes('popup-closed')) return 'Accesso Google annullato.';
  if (code.includes('unauthorized-domain')) return 'Questo indirizzo deve essere autorizzato in Firebase Authentication.';
  if (code.includes('network-request-failed')) return 'Connessione assente. I dati locali restano sul dispositivo.';
  if (code.includes('permission-denied')) return 'Operazione non autorizzata per questo account.';
  if (code.includes('storage/unauthorized')) return 'Non hai il permesso di accedere a questo documento.';
  if (code.includes('storage/object-not-found')) return 'Il documento non è più presente nell’archivio cloud.';
  return error?.message || 'Operazione non riuscita.';
}

function safeFileName(value) {
  const cleaned = String(value || 'documento')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 140);
  return cleaned || 'documento';
}

function inferredMimeType(file) {
  const normalizedType = window.EdilKappaMedia?.inferredMimeType?.(file);
  if (normalizedType) return normalizedType;
  const explicitType = String(file?.type || '').toLowerCase();
  if (explicitType && explicitType !== 'application/octet-stream') return explicitType;
  const extension = String(file?.name || '').split('.').pop()?.toLowerCase();
  return ({
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    csv: 'text/csv',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    webm: 'video/webm'
  })[extension] || '';
}

function uploadIdentifier(value) {
  const normalized = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
  if (normalized) return normalized;
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `documento-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function uploadDocument(file, options = {}) {
  if (!ready || !user || !profile?.active) throw new Error('Accedi al gestionale prima di caricare il documento.');
  if (!navigator.onLine) throw new Error('Serve una connessione internet per archiviare il documento nel cloud.');
  if (!file?.size) throw new Error('Il file selezionato è vuoto.');
  if (file.size > DOCUMENT_MAX_BYTES) throw new Error('Il file supera il limite di 25 MB.');
  const contentType = inferredMimeType(file);
  if (!DOCUMENT_MIME_TYPES.has(contentType)) throw new Error('Sono ammessi PDF, Word, PowerPoint, Excel, CSV e immagini JPG, PNG, WEBP o HEIC.');

  const documentId = uploadIdentifier(options.documentId);
  const path = `organisations/${ORG_ID}/documents/${user.uid}/${documentId}/${safeFileName(file.name)}`;
  const reference = storageRef(storage, path);
  await uploadBytes(reference, file, {
    contentType,
    customMetadata: {
      orgId: ORG_ID,
      ownerUid: user.uid,
      category: String(options.category || 'Documento').slice(0, 80),
      client: String(options.client || '').slice(0, 160),
      interventionId: String(options.interventionId || '').slice(0, 128)
    }
  });
  return {
    storagePath: path,
    fileName: String(file.name || 'documento').slice(0, 180),
    fileType: contentType,
    fileSize: file.size,
    uploadedAt: new Date().toISOString()
  };
}

async function uploadMedia(file, options = {}) {
  if (!ready || !user || !profile?.active) throw new Error('Accedi al gestionale prima di caricare foto o video.');
  if (!navigator.onLine) throw new Error('Serve una connessione internet per archiviare foto o video.');
  if (!file?.size) throw new Error('Il file selezionato è vuoto.');
  if (file.size > MEDIA_MAX_BYTES) throw new Error('Il file supera il limite di 2 GB.');
  const contentType = inferredMimeType(file);
  if (!MEDIA_MIME_TYPES.has(contentType)) throw new Error('Sono ammessi foto JPG, PNG, WEBP o HEIC e video MP4, MOV, M4V o WEBM.');

  const mediaId = uploadIdentifier(options.mediaId);
  const path = `organisations/${ORG_ID}/documents/${user.uid}/${mediaId}/${safeFileName(file.name)}`;
  const reference = storageRef(storage, path);
  const task = uploadBytesResumable(reference, file, {
    contentType,
    customMetadata: {
      orgId: ORG_ID,
      ownerUid: user.uid,
      category: String(options.category || 'Foto e video').slice(0, 80),
      client: String(options.client || '').slice(0, 160),
      interventionId: String(options.interventionId || '').slice(0, 128)
    }
  });
  await new Promise((resolve, reject) => {
    task.on('state_changed', (snapshot) => {
      const progress = Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100);
      setSyncState(`Caricamento ${progress}%`, '#d69b18', file.name);
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          progress,
          bytesTransferred: snapshot.bytesTransferred,
          totalBytes: snapshot.totalBytes,
          fileName: file.name
        });
      }
    }, reject, resolve);
  });
  recomputeSyncState();
  return {
    storagePath: path,
    fileName: String(file.name || 'allegato').slice(0, 180),
    fileType: contentType,
    fileSize: file.size,
    uploadedAt: new Date().toISOString()
  };
}

async function uploadSharePackage(file, options = {}) {
  if (!ready || !user || !['owner', 'office'].includes(profile?.role)) {
    throw new Error('La condivisione dei pacchetti è disponibile al titolare e all’ufficio.');
  }
  if (!navigator.onLine) throw new Error('Serve una connessione internet per creare il collegamento.');
  if (!file?.size) throw new Error('Il pacchetto selezionato è vuoto.');
  if (file.size > MEDIA_MAX_BYTES) throw new Error('Il pacchetto supera il limite di 2 GB.');
  const packageId = uploadIdentifier(options.packageId);
  const path = `organisations/${ORG_ID}/shares/${user.uid}/${packageId}/${safeFileName(file.name || 'allegati-edilkappa.zip')}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const reference = storageRef(storage, path);
  const task = uploadBytesResumable(reference, file, {
    contentType: 'application/zip',
    customMetadata: {
      orgId: ORG_ID,
      ownerUid: user.uid,
      expiresAt,
      client: String(options.client || '').slice(0, 160),
      interventionId: String(options.interventionId || '').slice(0, 128)
    }
  });
  await new Promise((resolve, reject) => {
    task.on('state_changed', (snapshot) => {
      const progress = Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100);
      setSyncState(`Condivisione ${progress}%`, '#d69b18', file.name);
      options.onProgress?.({ progress, bytesTransferred: snapshot.bytesTransferred, totalBytes: snapshot.totalBytes });
    }, reject, resolve);
  });
  const url = await getDownloadURL(reference);
  recomputeSyncState();
  return { url, storagePath: path, expiresAt, fileName: file.name, fileSize: file.size };
}

async function getDocumentUrl(path) {
  if (!path) throw new Error('Percorso del documento mancante.');
  try {
    return await getDownloadURL(storageRef(storage, path));
  } catch (error) {
    throw new Error(errorText(error));
  }
}

async function openDocument(path) {
  if (!path) throw new Error('Percorso del documento mancante.');
  const popup = window.open('', '_blank');
  try {
    const url = await getDocumentUrl(path);
    if (popup) popup.location.replace(url);
    else window.open(url, '_blank', 'noopener');
  } catch (error) {
    popup?.close();
    throw new Error(errorText(error));
  }
}

async function deleteDocument(path) {
  if (!path) return;
  try {
    await deleteObject(storageRef(storage, path));
  } catch (error) {
    if (!String(error?.code || '').includes('storage/object-not-found')) throw error;
  }
}

function remoteTarget(localName, record = {}) {
  if (localName === 'interventions') return { localName, remoteName: 'documents', recordType: 'Intervention' };
  const mapping = mappings.find(([name]) => name === localName);
  if (!mapping) throw new Error('Archivio cloud non riconosciuto.');
  return { localName, remoteName: mapping[1], recordType: record.recordType || '' };
}

async function softDeleteRecord(localName, record) {
  if (!record?.id) throw new Error('Elemento da eliminare non valido.');
  if (!['owner', 'office'].includes(profile?.role)) throw new Error('Non hai i permessi per usare il cestino.');
  const target = remoteTarget(localName, record);
  const tombstone = JSON.parse(safePayload({
    ...record,
    ...(target.recordType ? { recordType: target.recordType } : {}),
    deletedAt: new Date().toISOString(),
    deletedBy: profile?.displayName || profile?.email || user?.email || 'Utente EdilKappa',
    deletedCollection: target.remoteName,
    deletedLocalName: target.localName
  }));
  if (ready) {
    const known = remoteIds.get(target.remoteName) || new Set();
    await setDoc(doc(firestore, target.remoteName, String(tombstone.id)), envelope(tombstone, target.remoteName, !known.has(String(tombstone.id))), { merge: true });
  }
  return tombstone;
}

async function restoreDeletedRecord(record) {
  if (!record?.id || !record.deletedCollection || !record.deletedLocalName) throw new Error('Elemento del cestino non valido.');
  if (!['owner', 'office'].includes(profile?.role)) throw new Error('Non hai i permessi per ripristinare questo elemento.');
  const restored = JSON.parse(safePayload(record));
  delete restored.deletedAt;
  delete restored.deletedBy;
  delete restored.deletedCollection;
  delete restored.deletedLocalName;
  const remoteName = String(record.deletedCollection);
  const localName = String(record.deletedLocalName);
  if (localName === 'interventions') restored.recordType = 'Intervention';
  else delete restored.recordType;
  const known = remoteIds.get(remoteName) || new Set();
  await setDoc(doc(firestore, remoteName, String(restored.id)), envelope(restored, remoteName, !known.has(String(restored.id))), { merge: true });
  return { localName, record: restored };
}

async function permanentlyDeleteRecord(record) {
  if (profile?.role !== 'owner') throw new Error('Solo il titolare può eliminare definitivamente.');
  if (!record?.id || !record.deletedCollection) throw new Error('Elemento del cestino non valido.');
  await deleteDoc(doc(firestore, String(record.deletedCollection), String(record.id)));
  if (record.storagePath) await deleteDocument(record.storagePath);
  return true;
}

async function reportClientError(event = {}) {
  if (!ready || !user || !profile?.active || !navigator.onLine) return false;
  const id = `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await setDoc(doc(firestore, 'clientErrors', id), {
    id,
    orgId: ORG_ID,
    uid: user.uid,
    role: String(profile.role || ''),
    message: String(event.message || 'Errore sconosciuto').slice(0, 1000),
    source: String(event.source || location.pathname).slice(0, 500),
    stack: String(event.stack || '').slice(0, 4000),
    createdAt: serverTimestamp()
  });
  return true;
}

async function reportPerformanceMetric(metric = {}) {
  if (!ready || !user || !profile?.active || !navigator.onLine) return false;
  const sessionId = String(metric.sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || Math.random().toString(36).slice(2, 12);
  const id = `metric-${user.uid.slice(0, 48)}-${Date.now()}-${sessionId}`.slice(0, 128);
  const bounded = (value, maximum) => Math.min(maximum, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));
  await setDoc(doc(firestore, 'clientMetrics', id), {
    id,
    orgId: ORG_ID,
    uid: user.uid,
    role: String(profile.role || ''),
    path: String(metric.path || location.pathname).slice(0, 200),
    device: metric.device === 'mobile' ? 'mobile' : 'desktop',
    navigationType: String(metric.navigationType || 'navigate').slice(0, 40),
    loadMs: bounded(metric.loadMs, 120000),
    lcpMs: bounded(metric.lcpMs, 120000),
    cls: bounded(metric.cls, 10),
    criticalReadyMs: bounded(metric.criticalReadyMs, 120000),
    online: metric.online !== false,
    createdAt: serverTimestamp()
  });
  return true;
}

async function listClientErrors(maximum = 30) {
  if (!ready || !['owner', 'office'].includes(profile?.role)) return [];
  const snapshot = await getDocs(query(collection(firestore, 'clientErrors'), where('orgId', '==', ORG_ID)));
  return snapshot.docs.map((item) => {
    const data = item.data();
    const createdAt = data.createdAt?.toDate?.() || null;
    return {
      id: item.id,
      message: String(data.message || 'Errore sconosciuto'),
      source: String(data.source || ''),
      role: String(data.role || ''),
      createdAt: createdAt?.toISOString?.() || '',
      createdAtText: createdAt?.toLocaleString?.('it-IT') || ''
    };
  }).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))).slice(0, Math.min(100, Math.max(1, Number(maximum || 30))));
}

function setSyncState(label, color = '#d69b18', title = '') {
  const state = document.querySelector('.syncState');
  if (!state) return;
  const dot = state.querySelector('.syncDot');
  const text = state.querySelector('span');
  if (dot) dot.style.background = color;
  if (text) text.textContent = label;
  state.title = title || label;
}

function setCollectionSyncState(sourceKey, status, error = '') {
  collectionSyncState.set(sourceKey, {
    status,
    error: String(error || ''),
    updatedAt: new Date().toISOString()
  });
  recomputeSyncState();
}

function recomputeSyncState() {
  if (!navigator.onLine) {
    setSyncState('Offline', '#d69b18', 'Connessione assente: i dati restano disponibili sul dispositivo.');
    return;
  }
  const errors = Array.from(collectionSyncState.entries()).filter(([, state]) => state.status === 'error');
  if (errors.length) {
    const names = errors.map(([sourceKey]) => sourceKey.split(':')[0]).filter((value, index, values) => values.indexOf(value) === index);
    lastSyncError = errors.map(([sourceKey, state]) => `${sourceKey.split(':')[0]}: ${state.error}`).join(' · ');
    setSyncState(`Errore ${names.length}`, '#ad2a2a', `Archivi non sincronizzati: ${names.join(', ')}. ${lastSyncError}`);
    return;
  }
  lastSyncError = '';
  if (syncing) {
    setSyncState('Sincronizzazione…', '#d69b18');
    return;
  }
  const states = Array.from(collectionSyncState.values());
  if (states.some((state) => state.status === 'pending')) {
    setSyncState('Da sincronizzare', '#d69b18');
    return;
  }
  if (states.length && states.every((state) => state.status === 'ok')) lastSyncAt = new Date().toISOString();
  setSyncState(lastSyncAt ? 'Sincronizzato' : 'Collegamento…', lastSyncAt ? '#167448' : '#d69b18');
}

function installCloudStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .cloudGate{position:fixed;inset:0;z-index:1000;background:linear-gradient(145deg,#101213,#25292d);display:grid;place-items:center;padding:18px;overflow:auto}
    .cloudGate[hidden]{display:none!important}
    .cloudGateCard{width:min(490px,100%);background:#fff;border-radius:24px;padding:26px;box-shadow:0 28px 80px rgba(0,0,0,.38);border-top:7px solid var(--lime)}
    .cloudGateBrand{display:flex;align-items:center;gap:13px;margin-bottom:20px}.cloudGateBrand img{width:55px;height:55px;background:var(--lime);border-radius:15px;padding:8px}.cloudGateBrand h2{margin:0}.cloudGateBrand small{color:var(--muted)}
    .cloudGateForm{display:grid;gap:11px}.cloudGateForm input{width:100%;border:1px solid var(--line);border-radius:12px;padding:12px}.cloudGateButtons{display:grid;grid-template-columns:1fr 1fr;gap:9px}.cloudGateMessage{min-height:20px;color:var(--red);font-size:13px}.cloudDivider{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px;margin:4px 0}.cloudDivider:before,.cloudDivider:after{content:'';height:1px;background:var(--line);flex:1}
    .cloudAccount{display:flex;gap:8px;align-items:center}.cloudAccount button{white-space:nowrap}.cloudUserGrid{display:grid;gap:12px}.cloudUserCard{border:1px solid var(--line);border-radius:16px;padding:15px}.cloudUserFields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.cloudClientChecks{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}.cloudClientChecks label{border:1px solid var(--line);border-radius:999px;padding:7px 10px;font-size:12px}.cloudClientChecks input{width:auto}.cloudUserFields select{width:100%;border:1px solid var(--line);border-radius:11px;padding:9px;background:#fff}.cloudPending{padding:12px;border-radius:12px;background:#fff7cc;color:#725a00;margin:10px 0}
    body.cloud-administrator .sidebar,body.cloud-administrator .mobileNav,body.cloud-administrator .topSearch,body.cloud-administrator .role{display:none!important}body.cloud-administrator .main{margin-left:0}body.cloud-administrator .portalHero .btn{display:none!important}
    @media(max-width:620px){.cloudGateCard{padding:21px}.cloudGateButtons,.cloudUserFields{grid-template-columns:1fr}.cloudClientChecks{grid-column:auto}.cloudAccount span{display:none}}
  `;
  document.head.appendChild(style);
}

function gate() {
  let overlay = document.getElementById('cloudGate');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'cloudGate';
  overlay.className = 'cloudGate';
  document.body.appendChild(overlay);
  return overlay;
}

function loginGate(message = '') {
  const overlay = gate();
  overlay.hidden = false;
  overlay.innerHTML = `<section class="cloudGateCard">
    <div class="cloudGateBrand"><img src="./assets/icona-edilkappa.svg" alt="EDILKAPPA"><div><h2>EDILKAPPA Professionale</h2><small>Accesso sicuro e dati sincronizzati</small></div></div>
    <form id="cloudLoginForm" class="cloudGateForm">
      <input name="email" type="email" inputmode="email" autocomplete="email" placeholder="Email di lavoro" aria-label="Email di lavoro" required>
      <input name="password" type="password" autocomplete="current-password" minlength="6" placeholder="Password" aria-label="Password" required>
      <div class="cloudGateButtons"><button class="btn green" name="login" type="submit">Accedi</button><button class="btn light" id="cloudRegister" type="button">Crea accesso</button></div>
      <div class="cloudDivider">oppure</div>
      <button class="btn lime" id="cloudGoogle" type="button">Continua con Google</button>
      <div class="cloudGateMessage" id="cloudGateMessage" role="status" aria-live="polite">${escapeHtml(message)}</div>
      <small>Gli account nuovi devono essere approvati dal titolare. Continuando accetti l’uso dei dati per il servizio. <a href="./privacy.html">Privacy</a>.</small>
    </form>
  </section>`;
  const form = overlay.querySelector('#cloudLoginForm');
  const messageBox = overlay.querySelector('#cloudGateMessage');
  const busy = (value) => overlay.querySelectorAll('button').forEach((button) => { button.disabled = value; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); busy(true); messageBox.textContent = 'Accesso in corso…';
    const values = new FormData(form);
    try { await signInWithEmailAndPassword(auth, values.get('email').trim(), values.get('password')); }
    catch (error) { messageBox.textContent = errorText(error); busy(false); }
  });
  overlay.querySelector('#cloudRegister').addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    busy(true); messageBox.textContent = 'Creazione accesso…';
    const values = new FormData(form);
    try {
      const credential = await createUserWithEmailAndPassword(auth, values.get('email').trim(), values.get('password'));
      await sendEmailVerification(credential.user);
      messageBox.textContent = 'Account creato. Controlla l’email e verifica l’indirizzo.';
    } catch (error) { messageBox.textContent = errorText(error); busy(false); }
  });
  overlay.querySelector('#cloudGoogle').addEventListener('click', async () => {
    busy(true); messageBox.textContent = 'Apertura Google…';
    try { await signInWithPopup(auth, googleProvider); }
    catch (error) { messageBox.textContent = errorText(error); busy(false); }
  });
}

function waitingGate(kind, message) {
  const overlay = gate();
  overlay.hidden = false;
  overlay.innerHTML = `<section class="cloudGateCard"><div class="cloudGateBrand"><img src="./assets/icona-edilkappa.svg" alt="EDILKAPPA"><div><h2>${escapeHtml(kind)}</h2><small>${escapeHtml(user?.email || '')}</small></div></div><div class="cloudPending">${escapeHtml(message)}</div><div class="actions"><button class="btn green" id="cloudRefresh">Controlla di nuovo</button><button class="btn light" id="cloudLogoutGate">Esci</button></div></section>`;
  overlay.querySelector('#cloudRefresh').onclick = async () => {
    try { await reload(auth.currentUser); location.reload(); } catch (error) { alert(errorText(error)); }
  };
  overlay.querySelector('#cloudLogoutGate').onclick = () => secureSignOut();
}

function hideGate() {
  const overlay = gate();
  overlay.hidden = true;
  overlay.innerHTML = '';
}

async function ensureProfile(currentUser) {
  const ref = doc(firestore, 'users', currentUser.uid);
  let snapshot = await getDoc(ref);
  const verifiedOwner = currentUser.emailVerified && currentUser.email?.toLowerCase() === OWNER_EMAIL;
  if (!snapshot.exists()) {
    await setDoc(ref, {
      orgId: ORG_ID,
      displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Utente',
      email: currentUser.email || '',
      role: verifiedOwner ? 'owner' : 'pending',
      active: verifiedOwner,
      teamId: '',
      clientIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    snapshot = await getDoc(ref);
  } else if (verifiedOwner && (snapshot.data().role !== 'owner' || snapshot.data().active !== true)) {
    await setDoc(ref, { role: 'owner', active: true, updatedAt: serverTimestamp() }, { merge: true });
    snapshot = await getDoc(ref);
  }
  return snapshot.data();
}

function stopDataListeners() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
  remoteMaps.clear();
  listenerMaps.clear();
  remoteIds.clear();
  loadedCollections.clear();
  collectionSyncState.clear();
  pendingCollectionEvents.clear();
  initialHydrationSources.clear();
  clearTimeout(cloudRenderTimer);
  clearTimeout(cloudRenderMaxTimer);
  clearTimeout(initialHydrationTimer);
  cloudRenderTimer = null;
  cloudRenderMaxTimer = null;
  initialHydrationTimer = null;
  initialHydrationActive = false;
  initialHydrationRegistrationComplete = false;
  ready = false;
  lastSyncAt = '';
  lastSyncError = '';
}

function installAccountButton() {
  if (document.getElementById('cloudAccount')) return;
  const wrapper = document.createElement('div');
  wrapper.id = 'cloudAccount';
  wrapper.className = 'cloudAccount';
  wrapper.innerHTML = `<span>${escapeHtml(user?.email || '')}</span><button class="btn sm light" type="button">Esci</button>`;
  wrapper.querySelector('button').onclick = async () => {
    if (!navigator.onLine && !confirm('Sei offline. Uscendo, i dati e le modifiche non sincronizzate saranno cancellati da questo dispositivo. Continuare?')) return;
    try { if (navigator.onLine) await syncNow(); } catch (_) {}
    await secureSignOut();
  };
  document.querySelector('.topActions')?.appendChild(wrapper);
}

async function secureSignOut() {
  stopDataListeners();
  try { await local.clearDeviceData(); }
  catch (error) { alert(error?.message || 'Chiudi le altre schede EdilKappa e riprova.'); return; }
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
  await signOut(auth);
  location.reload();
}

function applyRole() {
  document.body.classList.toggle('cloud-administrator', profile.role === 'administrator');
  if (profile.role === 'owner') local.setRole('owner');
  if (profile.role === 'office') local.setRole('secretary');
  if (profile.role === 'worker') local.setWorkerRole(profile, user.uid);
  if (profile.role === 'administrator') {
    local.setRole('owner');
    updateAdministratorPortal();
    local.go('portalPreview');
  } else {
    const preferred = profile.role === 'worker' ? 'worker' : 'dashboard';
    local.go(preferred);
  }
  const select = document.getElementById('roleSelect');
  if (select) select.disabled = true;
}

async function activate(nextProfile) {
  profile = nextProfile;
  const key = `${user.uid}:${profile.role}:${profile.teamId}:${(profile.clientIds || []).join(',')}`;
  if (activationKey === key && ready) return;
  activationKey = key;
  stopDataListeners();
  setSyncState('Collegamento…', '#d69b18');
  if (profile.role === 'worker' || profile.role === 'administrator') local.clearRestrictedData();
  applyRole();
  installAccountButton();
  hideGate();
  if (profile.role === 'owner') await importInitialDataIfNeeded();
  startDataListeners();
  if (profile.role === 'owner') startUsersListener();
  ready = true;
  recomputeSyncState();
}

async function handleProfile(nextProfile) {
  profile = nextProfile;
  if (!user.emailVerified) {
    stopDataListeners();
    waitingGate('Verifica email', 'Apri il messaggio ricevuto da Firebase, verifica l’indirizzo e poi premi “Controlla di nuovo”.');
    return;
  }
  if (!profile?.active || profile.role === 'pending') {
    stopDataListeners();
    waitingGate('Accesso in attesa', 'L’account è corretto. Il titolare deve ancora assegnare il ruolo e, se necessario, i condomìni autorizzati.');
    return;
  }
  await activate(profile);
}

onAuthStateChanged(auth, async (currentUser) => {
  stopDataListeners();
  unsubscribeProfile?.();
  unsubscribeProfile = null;
  user = currentUser;
  profile = null;
  activationKey = '';
  if (!currentUser) {
    if (localStorage.getItem(ACCOUNT_STORAGE_KEY)) {
      try { await local.clearDeviceData(); } catch (_) {}
      localStorage.removeItem(ACCOUNT_STORAGE_KEY);
    }
    document.getElementById('cloudAccount')?.remove();
    setSyncState('Non connesso', '#ad2a2a');
    loginGate();
    return;
  }
  try {
    const previousUid = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (previousUid && previousUid !== currentUser.uid) await local.clearDeviceData();
    localStorage.setItem(ACCOUNT_STORAGE_KEY, currentUser.uid);
    await ensureProfile(currentUser);
    unsubscribeProfile = onSnapshot(doc(firestore, 'users', currentUser.uid), (snapshot) => {
      if (snapshot.exists()) handleProfile(snapshot.data()).catch((error) => loginGate(errorText(error)));
    }, (error) => loginGate(errorText(error)));
  } catch (error) {
    loginGate(errorText(error));
  }
});

function clientIdFor(item, remoteName) {
  if (remoteName === 'clients') return String(item.id || '');
  if (item.clientId) return String(item.clientId);
  const clients = local.getDB().condomini || [];
  return String(clients.find((client) => client.name === item.client)?.id || '');
}

function safePayload(item) {
  return JSON.stringify(item, (key, value) => key.startsWith('__cloud') ? undefined : value);
}

function teamIdsFor(item, fallback = '') {
  const values = [
    ...(Array.isArray(item?.teamIds) ? item.teamIds : []),
    ...(Array.isArray(item?.assignedTeamIds) ? item.assignedTeamIds : []),
    item?.assignedTeamId,
    item?.worker,
    fallback
  ];
  return Array.from(new Set(values.map((value) => String(value || '')).filter(Boolean))).slice(0, 10);
}

function boundedNumber(value, minimum, maximum) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : minimum;
}

function envelope(item, remoteName, isNew) {
  const database = local.getDB();
  const site = remoteName === 'reports' ? (database.sites || []).find((entry) => entry.id === item.site) : null;
  const isWorkerItem = profile?.role === 'worker' && ['reports', 'timesheets', 'absences'].includes(remoteName);
  const taskCollection = ['sites', 'roofs', 'drains'].includes(remoteName);
  const assignedTeamIds = taskCollection
    ? teamIdsFor(item)
    : remoteName === 'reports'
      ? teamIdsFor(site || { worker: item.team || (isWorkerItem ? profile.teamId : '') })
      : ['timesheets', 'absences'].includes(remoteName)
        ? teamIdsFor({ worker: item.team || (isWorkerItem ? profile.teamId : '') })
        : teamIdsFor({ teamIds: item.assignedTeamIds, assignedTeamId: item.assignedTeamId });
  const assignedTeamId = String(item.assignedTeamId || (taskCollection ? item.worker : '') || (isWorkerItem ? profile.teamId : '') || assignedTeamIds[0] || '');
  if (assignedTeamId && !assignedTeamIds.includes(assignedTeamId)) assignedTeamIds.unshift(assignedTeamId);
  const workerUid = String(item.workerUid || (isWorkerItem ? user.uid : '') || '');
  const ownerUid = String(item.ownerUid || user?.uid || '');
  const data = {
    id: String(item.id),
    orgId: ORG_ID,
    clientId: clientIdFor(item, remoteName),
    assignedTeamId,
    assignedTeamIds: assignedTeamIds.slice(0, 10),
    workerUid,
    ownerUid,
    status: String(item.status || ''),
    workHours: boundedNumber(item.hours, 0, 24),
    materialAmount: boundedNumber(item.material, 0, 100000),
    progress: boundedNumber(item.progress, 0, 100),
    contractValue: boundedNumber(profile?.role === 'worker' && remoteName === 'sites' ? item.__cloudContractValue : item.value, 0, 100000000),
    recordedCost: boundedNumber(profile?.role === 'worker' && remoteName === 'sites' ? item.__cloudRecordedCost : item.cost, 0, 100000000),
    payload: safePayload(item),
    updatedAt: serverTimestamp()
  };
  if (isNew) data.createdAt = serverTimestamp();
  return data;
}

function parseEnvelope(snapshot) {
  const data = snapshot.data();
  let item = {};
  try { item = JSON.parse(data.payload || '{}'); } catch (_) {}
  item.id = snapshot.id;
  item.clientId = data.clientId;
  item.assignedTeamId = data.assignedTeamId;
  item.assignedTeamIds = teamIdsFor({ assignedTeamIds: data.assignedTeamIds, assignedTeamId: data.assignedTeamId });
  item.workerUid = data.workerUid;
  item.ownerUid = data.ownerUid;
  item.__cloudUpdatedAt = data.updatedAt?.toDate?.().toISOString?.() || '';
  if (snapshot.ref.parent.id === 'reports' || snapshot.ref.parent.id === 'timesheets') item.hours = data.workHours;
  if (snapshot.ref.parent.id === 'reports') item.material = data.materialAmount;
  if ('progress' in item) item.progress = data.progress;
  if (snapshot.ref.parent.id === 'sites') {
    item.value = data.contractValue;
    item.cost = data.recordedCost;
    item.__cloudContractValue = data.contractValue;
    item.__cloudRecordedCost = data.recordedCost;
  }
  if (snapshot.ref.parent.id === 'sites') {
    item.teamIds = item.assignedTeamIds.slice();
    item.worker = data.assignedTeamId || item.teamIds[0] || '';
  } else if (['roofs', 'drains'].includes(snapshot.ref.parent.id)) item.worker = data.assignedTeamId;
  return item;
}

const CLOUD_VIEW_DEPENDENCIES = new Map(Object.entries({
  dashboard: ['clients', 'inspections', 'sites', 'quotes', 'reports', 'timesheets', 'absences', 'teams', 'documents', 'leads', 'roofs', 'drains', 'payments', 'edilconnect', 'companySettings'],
  worker: ['sites', 'reports', 'timesheets', 'absences', 'teams', 'roofs', 'drains'],
  workerProfile: ['teams'],
  agenda: ['inspections', 'clients'],
  inspections: ['inspections', 'clients'],
  condomini: ['clients', 'documents', 'sites', 'quotes', 'reports', 'inspections'],
  clientArchive: ['clients', 'documents', 'sites', 'quotes', 'reports', 'inspections', 'timesheets'],
  sites: ['sites', 'teams', 'reports', 'documents', 'timesheets'],
  completedView: ['sites', 'reports', 'documents', 'quotes', 'roofs', 'drains'],
  activityView: ['sites', 'reports', 'documents', 'quotes', 'absences', 'roofs', 'drains'],
  quotes: ['quotes', 'clients', 'documents', 'priceList'],
  workMap: ['sites', 'roofs', 'drains', 'inspections', 'lifelines'],
  hours: ['timesheets', 'sites', 'teams', 'absences', 'roofs', 'drains'],
  attendance: ['absences', 'teams'],
  report: ['sites', 'teams'],
  finance: ['expenses', 'sites', 'quotes', 'payments'],
  daneaRequestsView: ['leads', 'documents', 'clients', 'sites'],
  reportsView: ['reports', 'sites', 'clients'],
  deadlinesView: ['deadlines', 'payments', 'documents'],
  priceListView: ['priceList'],
  certificatesView: ['certificates', 'clients'],
  warehouseView: ['inventory', 'equipment'],
  edilconnectView: ['edilconnect', 'sites', 'timesheets', 'teams'],
  learningCenter: ['quotes'],
  search: ['clients', 'inspections', 'sites', 'quotes', 'documents', 'teams', 'drone', 'lifelines', 'roofs', 'drains'],
  ai: [],
  more: [],
  portalView: [],
  portalPreview: ['clients', 'sites', 'quotes', 'reports', 'documents', 'certificates', 'lifelines', 'deadlines'],
  operationsCenter: []
}).map(([viewName, collections]) => [viewName, new Set(collections)]));

function cloudEventsAffectCurrentView(events) {
  const dependencies = CLOUD_VIEW_DEPENDENCIES.get(local.getView());
  if (!dependencies) return true;
  return events.some((event) => dependencies.has(String(event.localName || '')));
}

function scheduleLocalPersist() {
  if (localPersistScheduled) return;
  localPersistScheduled = true;
  const persist = () => {
    localPersistScheduled = false;
    local.persist();
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(persist, { timeout: 800 });
  else setTimeout(persist, 80);
}

function flushCloudUi() {
  clearTimeout(cloudRenderTimer);
  clearTimeout(cloudRenderMaxTimer);
  cloudRenderTimer = null;
  cloudRenderMaxTimer = null;
  if (!pendingCollectionEvents.size) return;
  const events = Array.from(pendingCollectionEvents.values());
  pendingCollectionEvents.clear();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  scheduleLocalPersist();
  updateAdministratorPortal();
  local.refreshChrome?.();
  const rendered = cloudEventsAffectCurrentView(events)
    ? (typeof local.renderFromCloud === 'function' ? local.renderFromCloud() : (local.render(), true))
    : false;
  if (rendered && (window.scrollX !== scrollX || window.scrollY !== scrollY)) {
    requestAnimationFrame(() => window.scrollTo({ left: scrollX, top: scrollY, behavior: 'auto' }));
  }
  events.forEach((detail) => window.dispatchEvent(new CustomEvent('edilkappa:cloud-collection-synced', { detail })));
}

function scheduleCloudUi(detail) {
  if (detail) pendingCollectionEvents.set(detail.remoteName, detail);
  if (initialHydrationActive || !pendingCollectionEvents.size) return;
  clearTimeout(cloudRenderTimer);
  cloudRenderTimer = setTimeout(flushCloudUi, CLOUD_RENDER_DEBOUNCE_MS);
  if (!cloudRenderMaxTimer) cloudRenderMaxTimer = setTimeout(flushCloudUi, CLOUD_RENDER_MAX_WAIT_MS);
}

function completeInitialHydration() {
  if (!initialHydrationActive) return;
  initialHydrationActive = false;
  initialHydrationSources.clear();
  clearTimeout(initialHydrationTimer);
  initialHydrationTimer = null;
  scheduleCloudUi();
}

function beginInitialHydration() {
  clearTimeout(initialHydrationTimer);
  initialHydrationSources.clear();
  initialHydrationActive = true;
  initialHydrationRegistrationComplete = false;
  initialHydrationTimer = null;
}

function registerInitialHydrationSource(sourceKey) {
  if (initialHydrationActive) initialHydrationSources.add(sourceKey);
}

function settleInitialHydrationSource(sourceKey) {
  if (!initialHydrationActive) return;
  initialHydrationSources.delete(sourceKey);
  if (initialHydrationRegistrationComplete && !initialHydrationSources.size) completeInitialHydration();
}

function finishInitialHydrationRegistration() {
  initialHydrationRegistrationComplete = true;
  if (!initialHydrationSources.size) return completeInitialHydration();
  initialHydrationTimer = setTimeout(completeInitialHydration, INITIAL_HYDRATION_TIMEOUT_MS);
}

function mergeSnapshot(remoteName, snapshot, sourceKey = `${remoteName}:default`) {
  const localName = mappingByRemote.get(remoteName);
  if (!localName) return;
  let sourceMap = listenerMaps.get(sourceKey);
  if (!sourceMap) { sourceMap = new Map(); listenerMaps.set(sourceKey, sourceMap); }
  snapshot.docChanges().forEach((change) => {
    if (change.type === 'removed') sourceMap.delete(change.doc.id);
    else sourceMap.set(change.doc.id, parseEnvelope(change.doc));
  });
  const map = new Map();
  for (const [key, rows] of listenerMaps) {
    if (!key.startsWith(`${remoteName}:`)) continue;
    for (const [id, item] of rows) map.set(id, item);
  }
  remoteMaps.set(remoteName, map);
  remoteIds.set(remoteName, new Set(map.keys()));
  loadedCollections.add(remoteName);
  const values = Array.from(map.values());
  const activeValues = values.filter((item) => !item.deletedAt);
  const deletedValues = values
    .filter((item) => item.deletedAt)
    .map((item) => ({
      ...item,
      deletedCollection: item.deletedCollection || remoteName,
      deletedLocalName: item.deletedLocalName || (remoteName === 'documents' && item.recordType === 'Intervention' ? 'interventions' : localName)
    }));
  const database = local.getDB();
  database.trash = [
    ...(database.trash || []).filter((item) => item.deletedCollection !== remoteName),
    ...deletedValues
  ].sort((left, right) => String(right.deletedAt || '').localeCompare(String(left.deletedAt || '')));
  if (remoteName === 'documents') {
    database.interventions = activeValues
      .filter((item) => item.recordType === 'Intervention')
      .map(({ recordType, ...item }) => item);
    database.documents = activeValues.filter((item) => item.recordType !== 'Intervention');
  } else {
    database[localName] = activeValues;
  }
  if (localName === 'teams' && profile?.role === 'worker') local.setWorkerRole(profile, user.uid);
  scheduleCloudUi({ remoteName, localName, count: activeValues.length });
  setCollectionSyncState(sourceKey, 'ok');
}

function listenTo(remoteName, constraints = [], listenerId = 'default') {
  const target = query(collection(firestore, remoteName), ...constraints);
  const sourceKey = `${remoteName}:${listenerId}`;
  let initialSnapshotPending = true;
  const settleInitialSnapshot = () => {
    if (!initialSnapshotPending) return;
    initialSnapshotPending = false;
    settleInitialHydrationSource(sourceKey);
  };
  registerInitialHydrationSource(sourceKey);
  setCollectionSyncState(sourceKey, 'pending');
  unsubscribers.push(onSnapshot(target, (snapshot) => {
    try { mergeSnapshot(remoteName, snapshot, sourceKey); }
    finally { settleInitialSnapshot(); }
  }, (error) => {
    settleInitialSnapshot();
    console.error(`Sincronizzazione ${remoteName}:`, error);
    setCollectionSyncState(sourceKey, 'error', errorText(error));
    reportClientError({ message: `Sincronizzazione ${remoteName}: ${errorText(error)}`, source: 'firebase-cloud/listener', stack: error?.stack }).catch(() => {});
  }));
}

function startDataListeners() {
  beginInitialHydration();
  if (profile.role === 'owner' || profile.role === 'office') {
    mappings.forEach(([, remoteName]) => listenTo(remoteName, [where('orgId', '==', ORG_ID)]));
    finishInitialHydrationRegistration();
    return;
  }
  listenTo('settings', [where('orgId', '==', ORG_ID)]);
  if (profile.role === 'worker') {
    listenTo('sites', [where('orgId', '==', ORG_ID), where('assignedTeamIds', 'array-contains', profile.teamId)], 'multiple-teams');
    listenTo('sites', [where('orgId', '==', ORG_ID), where('assignedTeamId', '==', profile.teamId)], 'legacy-team');
    ['roofs', 'drains'].forEach((remoteName) => listenTo(remoteName, [where('orgId', '==', ORG_ID), where('assignedTeamId', '==', profile.teamId)]));
    ['reports', 'timesheets'].forEach((remoteName) => listenTo(remoteName, [where('orgId', '==', ORG_ID), where('workerUid', '==', user.uid), where('ownerUid', '==', user.uid)]));
    listenTo('absences', [where('orgId', '==', ORG_ID), where('workerUid', '==', user.uid)]);
    const teamRef = doc(firestore, 'teams', profile.teamId);
    const teamSourceKey = 'teams:profile-team';
    let initialTeamSnapshotPending = true;
    const settleInitialTeamSnapshot = () => {
      if (!initialTeamSnapshotPending) return;
      initialTeamSnapshotPending = false;
      settleInitialHydrationSource(teamSourceKey);
    };
    registerInitialHydrationSource(teamSourceKey);
    setCollectionSyncState(teamSourceKey, 'pending');
    unsubscribers.push(onSnapshot(teamRef, (snapshot) => {
      try {
        const database = local.getDB();
        database.teams = snapshot.exists() ? [parseEnvelope(snapshot)] : [];
        local.setWorkerRole(profile, user.uid);
        scheduleCloudUi({ remoteName: 'teams', localName: 'teams', count: database.teams.length });
        setCollectionSyncState(teamSourceKey, 'ok');
      } finally { settleInitialTeamSnapshot(); }
    }, (error) => {
      settleInitialTeamSnapshot();
      console.error('Sincronizzazione squadra:', error);
      setCollectionSyncState(teamSourceKey, 'error', errorText(error));
      reportClientError({ message: `Sincronizzazione squadra: ${errorText(error)}`, source: 'firebase-cloud/listener', stack: error?.stack }).catch(() => {});
    }));
    finishInitialHydrationRegistration();
    return;
  }
  const clientIds = Array.from(new Set(profile.clientIds || [])).slice(0, 10);
  if (!clientIds.length) {
    finishInitialHydrationRegistration();
    return;
  }
  const chunks = [];
  for (let index = 0; index < clientIds.length; index += 10) chunks.push(clientIds.slice(index, index + 10));
  clientCollections.forEach((remoteName) => chunks.forEach((ids) => listenTo(remoteName, [where('orgId', '==', ORG_ID), where('clientId', 'in', ids)])));
  finishInitialHydrationRegistration();
}

function canPush(remoteName) {
  if (profile?.role === 'owner' || profile?.role === 'office') return true;
  return profile?.role === 'worker' && workerCollections.has(remoteName) && remoteName !== 'teams';
}

function workerItems(remoteName, items) {
  if (profile?.role !== 'worker') return items;
  if (remoteName === 'sites') return items.filter((item) => teamIdsFor(item).includes(profile.teamId));
  if (['roofs', 'drains'].includes(remoteName)) return items.filter((item) => String(item.worker || item.assignedTeamId) === profile.teamId);
  if (remoteName === 'absences') return items.filter((item) => item.requestedBy === 'worker' && String(item.ownerUid || user.uid) === user.uid);
  return items.filter((item) => String(item.workerUid || user.uid) === user.uid);
}

async function pushCollection(localName, remoteName) {
  if (!canPush(remoteName)) return;
  const database = local.getDB();
  const localItems = remoteName === 'documents'
    ? [
        ...(database.documents || []),
        ...(database.interventions || []).map((item) => ({ ...item, recordType: 'Intervention' }))
      ]
    : database[localName] || [];
  const tombstones = (database.trash || []).filter((item) => item.deletedCollection === remoteName);
  const items = workerItems(remoteName, [...localItems, ...tombstones]).filter((item) => item?.id);
  const known = remoteIds.get(remoteName) || new Set();
  await Promise.all(items.map((item) => setDoc(doc(firestore, remoteName, String(item.id)), envelope(item, remoteName, !known.has(String(item.id))), { merge: true })));
}

async function uploadPendingReportPhotos() {
  const database = local.getDB();
  let changed = false;
  for (const report of database.reports || []) {
    if (profile.role === 'worker' && report.workerUid && report.workerUid !== user.uid) continue;
    const site = (database.sites || []).find((item) => item.id === report.site) || {};
    for (const photo of report.photos || []) {
      if (photo.attachmentId || !photo.key) continue;
      try {
        const file = await local.readFile(photo.key);
        if (!file) continue;
        const uploaded = await uploadAttachment({ file, reportId: report.id, phase: photo.phase, site });
        if (uploaded?.attachmentId) { Object.assign(photo, uploaded); changed = true; }
      } catch (_) {}
    }
  }
  if (changed) local.persist();
}

function scheduleSync() {
  if (!ready || !profile || profile.role === 'administrator') return;
  clearTimeout(syncTimer);
  setCollectionSyncState('manual:pending', navigator.onLine ? 'pending' : 'error', navigator.onLine ? '' : 'Connessione assente');
  syncTimer = setTimeout(() => { syncNow().catch(() => {}); }, 900);
}

async function syncNow() {
  if (!ready || syncing || !navigator.onLine || !profile || profile.role === 'administrator') return syncPromise;
  syncing = true;
  syncPromise = (async () => {
    recomputeSyncState();
    await uploadPendingReportPhotos();
    for (const [localName, remoteName] of mappings) await pushCollection(localName, remoteName);
    lastSyncAt = new Date().toISOString();
    collectionSyncState.delete('manual:sync');
    collectionSyncState.delete('manual:pending');
    recomputeSyncState();
  })().catch((error) => {
    setCollectionSyncState('manual:sync', 'error', errorText(error));
    throw error;
  }).finally(() => { syncing = false; recomputeSyncState(); });
  return syncPromise;
}

async function importInitialDataIfNeeded() {
  const existing = await getDocs(query(collection(firestore, 'clients'), where('orgId', '==', ORG_ID)));
  const collectionsToImport = existing.empty
    ? mappings
    : mappings.filter(([, remoteName]) => ['leads', 'priceList', 'certificates', 'inventory', 'equipment', 'settings'].includes(remoteName));
  if (!collectionsToImport.length) return;
  setSyncState(existing.empty ? 'Primo caricamento…' : 'Aggiornamento archivi…', '#d69b18');
  for (const [localName, remoteName] of collectionsToImport) {
    if (!existing.empty) {
      const remote = await getDocs(query(collection(firestore, remoteName), where('orgId', '==', ORG_ID)));
      if (!remote.empty) continue;
    }
    const items = (local.getDB()[localName] || []).filter((item) => item?.id);
    await Promise.all(items.map((item) => setDoc(doc(firestore, remoteName, String(item.id)), envelope(item, remoteName, true))));
  }
}

function blobFromCanvas(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function dataUrlFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Immagine non leggibile.'));
    reader.readAsDataURL(blob);
  });
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  let blob = null;
  for (let pass = 0; pass < 4; pass += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.72, 0.62, 0.52]) {
      blob = await blobFromCanvas(canvas, quality);
      if (blob && blob.size <= 500000) break;
    }
    if (blob && blob.size <= 500000) break;
    scale *= 0.72;
  }
  bitmap.close?.();
  if (!blob || blob.size > 520000) throw new Error('La fotografia non può essere compressa abbastanza.');
  return blob;
}

async function uploadAttachment({ file, reportId, phase = 'Documento', site = {} }) {
  if (!user || !profile?.active || !navigator.onLine || !file?.type?.startsWith('image/')) return null;
  try {
    const blob = await compressImage(file);
    const data = await dataUrlFromBlob(blob);
    const attachmentId = `${reportId}-${String(phase).toLowerCase()}-${Math.random().toString(36).slice(2, 10)}`;
    const isWorker = profile.role === 'worker';
    await setDoc(doc(firestore, 'attachments', attachmentId), {
      id: attachmentId,
      orgId: ORG_ID,
      clientId: clientIdFor(site, 'sites'),
      reportId: String(reportId),
      assignedTeamId: String((isWorker ? profile.teamId : '') || site.worker || site.assignedTeamId || teamIdsFor(site)[0] || ''),
      workerUid: isWorker ? user.uid : '',
      ownerUid: user.uid,
      name: String(file.name || 'foto.jpg').slice(0, 180),
      phase: ['Prima', 'Dopo'].includes(phase) ? phase : 'Documento',
      mimeType: 'image/jpeg',
      data,
      size: blob.size,
      createdAt: serverTimestamp()
    });
    return { attachmentId, phase, name: file.name, type: 'image/jpeg', size: blob.size };
  } catch (error) {
    console.warn('Foto conservata localmente, sincronizzazione rinviata:', error);
    return null;
  }
}

async function getAttachmentFile(attachmentId) {
  const snapshot = await getDoc(doc(firestore, 'attachments', attachmentId));
  if (!snapshot.exists()) throw new Error('Fotografia cloud non trovata.');
  const data = snapshot.data();
  const response = await fetch(data.data);
  const blob = await response.blob();
  return new File([blob], String(data.name || 'fotografia.jpg'), { type: String(data.mimeType || blob.type || 'image/jpeg') });
}

async function openAttachment(attachmentId) {
  const snapshot = await getDoc(doc(firestore, 'attachments', attachmentId));
  if (!snapshot.exists()) throw new Error('Fotografia cloud non trovata.');
  const popup = window.open('', '_blank');
  if (popup) popup.location.href = snapshot.data().data;
  else window.open(snapshot.data().data, '_blank');
}

function updateAdministratorPortal() {
  if (profile?.role !== 'administrator') return;
  const allowed = new Set(profile.clientIds || []);
  const clients = (local.getDB().condomini || []).filter((item) => allowed.has(item.id));
  window.__portalPreview = {
    id: `firebase-${user.uid}`,
    name: profile.displayName || profile.email,
    email: profile.email,
    clients: clients.map((item) => item.name),
    status: 'Attivo'
  };
}

function roleOptions(selected, canAssignOwner) {
  const values = [['pending', 'In attesa'], ['office', 'Ufficio'], ['worker', 'Operaio'], ['administrator', 'Cliente / amministratore']];
  if (canAssignOwner || selected === 'owner') values.unshift(['owner', 'Titolare']);
  return values.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function cloudUsersPanel() {
  if (profile?.role !== 'owner') {
    return `<div class="headline"><div><h2>Portale clienti e amministratori</h2><p>La gestione degli accessi è riservata al titolare.</p></div></div><div class="notice">Accedi con l’account titolare per invitare utenti, assegnare squadre e autorizzare i clienti o condomìni visibili.</div>`;
  }
  const database = local.getDB();
  const teams = database.teams || [];
  const clients = database.condomini || [];
  const canAssignOwner = profile?.role === 'owner';
  return `<div class="headline"><div><h2>Portale clienti e accessi</h2><p>Assegna a ogni persona soltanto il ruolo e i clienti o condomìni necessari.</p></div><button class="btn lime" onclick="cloudCopyAccessLink()">Copia link di accesso</button></div>
    <div class="notice"><b>Come invitare:</b> copia il link, invialo alla persona e chiedile di creare l’accesso. Comparirà qui “In attesa”; poi assegna il ruolo.</div><div style="height:14px"></div>
    <div class="grid stats"><div class="stat"><div class="statTop"><span>Utenti</span></div><strong>${cloudUsers.length}</strong></div><div class="stat"><div class="statTop"><span>Attivi</span></div><strong>${cloudUsers.filter((item) => item.active).length}</strong></div><div class="stat"><div class="statTop"><span>In attesa</span></div><strong>${cloudUsers.filter((item) => item.role === 'pending').length}</strong></div><div class="stat"><div class="statTop"><span>Condomìni</span></div><strong>${clients.length}</strong></div></div>
    <div class="cloudUserGrid">${cloudUsers.map((item) => {
      const selfOwner = item.email === OWNER_EMAIL && item.role === 'owner';
      const uid = escapeHtml(item.uid);
      return `<section class="cloudUserCard"><div class="row" style="border:0;padding:0"><div class="rowIcon">${item.role === 'worker' ? '👷' : item.role === 'administrator' ? '🏢' : '👤'}</div><div class="rowBody"><b>${escapeHtml(item.displayName || item.email)}</b><small>${escapeHtml(item.email)} · ${item.active ? 'Attivo' : 'Non attivo'}</small></div><span class="pill ${item.active ? '' : 'orange'}">${escapeHtml(item.role)}</span></div>${selfOwner ? '<div class="sectionNote">Account titolare principale protetto.</div>' : `<div class="cloudUserFields"><label>Ruolo<select id="cloud-role-${uid}">${roleOptions(item.role, canAssignOwner)}</select></label><label>Squadra<select id="cloud-team-${uid}"><option value="">Nessuna</option>${teams.map((team) => `<option value="${escapeHtml(team.id)}" ${item.teamId === team.id ? 'selected' : ''}>${escapeHtml(team.name)}</option>`).join('')}</select></label><div class="cloudClientChecks">${clients.map((client) => `<label><input type="checkbox" data-cloud-client="${uid}" value="${escapeHtml(client.id)}" ${(item.clientIds || []).includes(client.id) ? 'checked' : ''}> ${escapeHtml(client.name)}</label>`).join('') || '<small>Crea prima un cliente per assegnarlo.</small>'}</div><label style="display:flex;align-items:center;gap:8px"><input id="cloud-active-${uid}" type="checkbox" style="width:auto" ${item.active ? 'checked' : ''}> Accesso attivo</label><div class="actions"><button class="btn sm green" onclick="cloudSaveUser('${uid}')">Salva accesso</button></div></div>`}</section>`;
    }).join('') || '<div class="empty">Nessun utente registrato.</div>'}</div>`;
}

window.cloudCopyAccessLink = async function () {
  const link = new URL('./', window.location.href).href;
  try { await navigator.clipboard.writeText(link); alert('Link di accesso copiato.'); }
  catch (_) { prompt('Copia questo link:', link); }
};

window.cloudSaveUser = async function (uid) {
  const selectedRole = document.getElementById(`cloud-role-${uid}`)?.value;
  const teamId = document.getElementById(`cloud-team-${uid}`)?.value || '';
  const active = Boolean(document.getElementById(`cloud-active-${uid}`)?.checked) && selectedRole !== 'pending';
  const clientIds = Array.from(document.querySelectorAll(`[data-cloud-client="${CSS.escape(uid)}"]:checked`)).map((input) => input.value);
  if (clientIds.length > 10) return alert('Puoi assegnare al massimo 10 condomìni per account.');
  if (selectedRole === 'worker' && !teamId) return alert('Seleziona una squadra per l’operaio.');
  if (selectedRole === 'administrator' && !clientIds.length) return alert('Seleziona almeno un cliente o condominio per questo accesso.');
  try {
    await setDoc(doc(firestore, 'users', uid), { role: selectedRole, active, teamId: selectedRole === 'worker' ? teamId : '', clientIds: selectedRole === 'administrator' ? clientIds : [], updatedAt: serverTimestamp() }, { merge: true });
    alert('Accesso aggiornato.');
  } catch (error) { alert(errorText(error)); }
};

function startUsersListener() {
  unsubscribers.push(onSnapshot(query(collection(firestore, 'users'), where('orgId', '==', ORG_ID)), (snapshot) => {
    cloudUsers = snapshot.docs.map((entry) => ({ uid: entry.id, ...entry.data() })).sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'it'));
    window.dispatchEvent(new CustomEvent('edilkappa:cloud-users-synced'));
    if (local.getView() === 'portalView') local.render();
  }, (error) => setSyncState('Errore utenti', '#ad2a2a', errorText(error))));
}

window.portalView = cloudUsersPanel;

window.addEventListener('online', () => { setSyncState('Da sincronizzare', '#d69b18'); syncNow().catch(() => {}); });
window.addEventListener('offline', () => setSyncState('Offline', '#d69b18', 'Le modifiche restano sul dispositivo e saranno sincronizzate al ritorno della rete.'));

installCloudStyles();
loginGate('Controllo accesso…');
