import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
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
const local = window.EdilKappaLocal;
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const firestore = getFirestore(app, 'edilkappa');
const storage = getStorage(app);
const functions = getFunctions(app, 'europe-west8');
const callEdilKappaAi = httpsCallable(functions, 'edilkappaAi', { timeout: 610000 });
const callEdilKappaOperations = httpsCallable(functions, 'edilkappaOperations', { timeout: 550000 });
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
let cloudRenderTimer = null;
let cloudRenderMaxTimer = null;
let initialHydrationTimer = null;
let initialHydrationActive = false;
let initialHydrationRegistrationComplete = false;

const api = {
  scheduleSync,
  syncNow,
  async aiRequest(payload) {
    const response = await callEdilKappaAi(payload);
    return response.data;
  },
  async operationsRequest(payload) {
    const response = await callEdilKappaOperations(payload);
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
  getDocumentUrl,
  openDocument,
  deleteDocument,
  enablePushNotifications,
  get ready() { return ready; },
  get currentUid() { return user?.uid || ''; },
  get currentProfile() { return profile; },
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
  if (code.includes('email-already-in-use')) return 'Questa email ha giÃ  un account. Usa Accedi.';
  if (code.includes('weak-password')) return 'Scegli una password di almeno 6 caratteri.';
  if (code.includes('popup-closed')) return 'Accesso Google annullato.';
  if (code.includes('unauthorized-domain')) return 'Questo indirizzo deve essere autorizzato in Firebase Authentication.';
  if (code.includes('network-request-failed')) return 'Connessione assente. I dati locali restano sul dispositivo.';
  if (code.includes('permission-denied')) return 'Operazione non autorizzata per questo account.';
  if (code.includes('storage/unauthorized')) return 'Non hai il permesso di accedere a questo documento.';
  if (code.includes('storage/object-not-found')) return 'Il documento non Ã¨ piÃ¹ presente nellâ€™archivio cloud.';
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
  if (!file?.size) throw new Error('Il file selezionato Ã¨ vuoto.');
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
  if (!file?.size) throw new Error('Il file selezionato Ã¨ vuoto.');
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
    }, reject, resolve);
  });
  setSyncState('Sincronizzato', '#2f7d32');
  return {
    storagePath: path,
    fileName: String(file.name || 'allegato').slice(0, 180),
    fileType: contentType,
    fileSize: file.size,
    uploadedAt: new Date().toISOString()
  };
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

function setSyncState(label, color = '#d69b18', title = '') {
  const state = document.querySelector('.syncState');
  if (!state) return;
  const dot = state.querySelector('.syncDot');
  const text = state.querySelector('span');
  if (dot) dot.style.background = color;
  if (text) text.textContent = label;
  state.title = title || label;
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
      <input name="email" type="email" autocomplete="email" placeholder="Email di lavoro" required>
      <input name="password" type="password" autocomplete="current-password" minlength="6" placeholder="Password" required>
      <div class="cloudGateButtons"><button class="btn green" name="login" type="submit">Accedi</button><button class="btn light" id="cloudRegister" type="button">Crea accesso</button></div>
      <div class="cloudDivider">oppure</div>
      <button class="btn lime" id="cloudGoogle" type="button">Continua con Google</button>
      <div class="cloudGateMessage" id="cloudGateMessage">${escapeHtml(message)}</div>
      <small>Gli account nuovi devono essere approvati dal titolare. Continuando accetti lâ€™uso dei dati per il servizio. <a href="./privacy.html">Privacy</a>.</small>
    </form>
  </section>`;
  const form = overlay.querySelector('#cloudLoginForm');
  const messageBox = overlay.querySelector('#cloudGateMessage');
  const busy = (value) => overlay.querySelectorAll('button').forEach((button) => { button.disabled = value; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); busy(true); messageBox.textContent = 'Accesso in corsoâ€¦';
    const values = new FormData(form);
    try { await signInWithEmailAndPassword(auth, values.get('email').trim(), values.get('password')); }
    catch (error) { messageBox.textContent = errorText(error); busy(false); }
  });
  overlay.querySelector('#cloudRegister').addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    busy(true); messageBox.textContent = 'Creazione accessoâ€¦';
    const values = new FormData(form);
    try {
      const credential = await createUserWithEmailAndPassword(auth, values.get('email').trim(), values.get('password'));
      await sendEmailVerification(credential.user);
      messageBox.textContent = 'Account creato. Controlla lâ€™email e verifica lâ€™indirizzo.';
    } catch (error) { messageBox.textContent = errorText(error); busy(false); }
  });
  overlay.querySelector('#cloudGoogle').addEventListener('click', async () => {
    busy(true); messageBox.textContent = 'Apertura Googleâ€¦';
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
  overlay.querySelector('#cloudLogoutGate').onclick = () => signOut(auth);
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
}

function installAccountButton() {
  if (document.getElementById('cloudAccount')) return;
  const wrapper = document.createElement('div');
  wrapper.id = 'cloudAccount';
  wrapper.className = 'cloudAccount';
  wrapper.innerHTML = `<span>${escapeHtml(user?.email || '')}</span><button class="btn sm light" type="button">Esci</button>`;
  wrapper.querySelector('button').onclick = async () => {
    if (!navigator.onLine && !confirm('Sei offline. Uscendo, eventuali modifiche non ancora sincronizzate resteranno su questo dispositivo. Continuare?')) return;
    try { if (navigator.onLine) await syncNow(); } catch (_) {}
    local.clearDeviceData();
    await signOut(auth);
    location.reload();
  };
  document.querySelector('.topActions')?.appendChild(wrapper);
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
  setSyncState('Collegamentoâ€¦', '#d69b18');
  if (profile.role === 'worker' || profile.role === 'administrator') local.clearRestrictedData();
  applyRole();
  installAccountButton();
  hideGate();
  if (profile.role === 'owner') await importInitialDataIfNeeded();
  startDataListeners();
  if (profile.role === 'owner') startUsersListener();
  ready = true;
  setSyncState(navigator.onLine ? 'Sincronizzato' : 'Offline', navigator.onLine ? '#167448' : '#d69b18');
}

async function handleProfile(nextProfile) {
  profile = nextProfile;
  if (!user.emailVerified) {
    stopDataListeners();
    waitingGate('Verifica email', 'Apri il messaggio ricevuto da Firebase, verifica lâ€™indirizzo e poi premi â€œControlla di nuovoâ€.');
    return;
  }
  if (!profile?.active || profile.role === 'pending') {
    stopDataListeners();
    waitingGate('Accesso in attesa', 'Lâ€™account Ã¨ corretto. Il titolare deve ancora assegnare il ruolo e, se necessario, i condomÃ¬ni autorizzati.');
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
    document.getElementById('cloudAccount')?.remove();
    setSyncState('Non connesso', '#ad2a2a');
    loginGate();
    return;
  }
  try {
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
  local.persist();
  updateAdministratorPortal();
  local.render();
  if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
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
  if (remoteName === 'documents') {
    local.getDB().interventions = values
      .filter((item) => item.recordType === 'Intervention')
      .map(({ recordType, ...item }) => item);
    local.getDB().documents = values.filter((item) => item.recordType !== 'Intervention');
  } else {
    local.getDB()[localName] = values;
  }
  if (localName === 'teams' && profile?.role === 'worker') local.setWorkerRole(profile, user.uid);
  scheduleCloudUi({ remoteName, localName, count: values.length });
  setSyncState(snapshot.metadata.fromCache && !navigator.onLine ? 'Offline' : 'Sincronizzato', snapshot.metadata.fromCache && !navigator.onLine ? '#d69b18' : '#167448');
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
  unsubscribers.push(onSnapshot(target, (snapshot) => {
    try { mergeSnapshot(remoteName, snapshot, sourceKey); }
    finally { settleInitialSnapshot(); }
  }, (error) => {
    settleInitialSnapshot();
    console.error(`Sincronizzazione ${remoteName}:`, error);
    setSyncState('Errore sync', '#ad2a2a', errorText(error));
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
    unsubscribers.push(onSnapshot(teamRef, (snapshot) => {
      try {
        const database = local.getDB();
        database.teams = snapshot.exists() ? [parseEnvelope(snapshot)] : [];
        local.setWorkerRole(profile, user.uid);
        scheduleCloudUi({ remoteName: 'teams', localName: 'teams', count: database.teams.length });
      } finally { settleInitialTeamSnapshot(); }
    }, (error) => {
      settleInitialTeamSnº×Mm¢G§²ÚîÆ­yÛ	Ôš\İ]\˜^š[Û™IË	Ô[^šXHÜ›Û™HHÛÛ›ÛÈ]ÉË	Ô[^šXHÜšYÛYKŞ™]HHÛXš[šIË	ÕšY[Ú\Ü^š[Û™H›Û™IË	Õ\™Ù[˜I×NÛ[Ù[
YÉÓ[ÙYšXØHÛÜ˜[[ÙÛÉÎ‰Ó[İ›ÈÛÜ˜[[ÙÛÉË]ˆÛ\ÜÏH™›Ü›QÜšY‰ÙšY[
	Ñ]IË	Ù]IË	Ù]IË][K™]J_IÙšY[
	ÓÜ˜IË	İ[YIË	İ[YIË][K[YJ_O]ˆÛ\ÜÏH™šY[X™[•\È[\™[ÏÛX™[Ù[Xİ˜[YOH\H‰ÜÙ[XİÜ[ÛœÊ\\Ë][K\J_OÜÙ[XİÙ]]ˆÛ\ÜÏH™šY[X™[ÛY[OÛX™[Ù[Xİ˜[YOH˜ÛY[‰ØÛY[Ü[ÛœÊ][K˜ÛY[
_OÜÙ[XİÙ]]ˆÛ\ÜÏH™šY[X™[”šXÛÜ™[Y[ÏÛX™[Ù[Xİ˜[YOHœ™[Z[™\ˆÜ[Ûˆ˜[YOHŒMHˆ	Ôİš[™Ê][Kœ™[Z[™\ŠOOOIÌMIÏÉÜÙ[XİY	Î‰ÉßOŒMHZ[]Hš[XOÛÜ[ÛÜ[Ûˆ˜[YOHŒÌˆ	Ôİš[™Ê][Kœ™[Z[™\ŠOOOIÌÌ	ÏÉÜÙ[XİY	Î‰ÉßOŒÌZ[]Hš[XOÛÜ[ÛÜ[Ûˆ˜[YOHŒˆ	Ôİš[™Ê][Kœ™[Z[™\ŸŒ
OOOIÍŒ	ÏÉÜÙ[XİY	Î‰ÉßOŒHÜ˜Hš[XOÛÜ[ÛÜ[Ûˆ˜[YOHŒLŒˆ	Ôİš[™Ê][Kœ™[Z[™\ŠOOOIÌLŒ	ÏÉÜÙ[XİY	Î‰ÉßOŒˆÜ™Hš[XOÛÜ[ÛÜ[Ûˆ˜[YOHŒMˆ	Ôİš[™Ê][Kœ™[Z[™\ŠOOOIÌM	ÏÉÜÙ[XİY	Î‰ÉßOŒHÚ[Ü››Èš[XOÛÜ[ÛÜÙ[XİÙ]‰ÙšY[
	Ò[™\š^›ÉË	ØY™\ÜÉË	İ^	Ë][K˜Y™\ÜËYJ_O]ˆÛ\ÜÏH™šY[[X™[”›Ø›[XHÈšXÚY\İOÛX™[^\™XH˜[YOHœ›Ø›[Hˆ™\]Z\™Y‰Ù\ØÊ][Kœ›Ø›[J_Oİ^\™XOÙ]Ù]˜OØÛÛœİ]OSØš™Xİ™œ›ÛQ[šY\ÊŠNÚYŠY
SØš™Xİ˜\ÜÚYÛŠ][K]JNÙ[ÙH‹š[œÜXİ[ÛœËœ\Ú
ÚYZY
	ÜÉÊK‹‹™]Kİ]\Î‰ÑH™]™[]˜\™IßJ_J_B™[˜İ[ÛˆÜ[”Ú]JY
^ØÛÛœİ][OY‹œÚ]\Ë™š[™
OšYOOZY
_İ]N‰ÉËÛY[‰ÉËY™\ÜÎ‰ÉËX[RYÎ•ÓÔ’ÑT”ÖÌOËšYÖÕÓÔ’ÑT”ÖÌKšYN–×KÛÜšÙ\•ÓÔ’ÑT”ÖÌOËšY	ÉËİ\›™]È]J
KÒTÓÔİš[™Ê
KœÛXÙJL
K˜[YNŒÛÜİŒİ]\Î‰ÔX[šYšXØ]ÉË›ÙÜ™\ÜÎŒNÛ[Ù[
YÉÓ[ÙYšXØHØ[Y\™IÎ‰Ó[İ›ÈØ[Y\™IË]ˆÛ\ÜÏH™›Ü›QÜšY‰ÙšY[
	Õ]ÛÈ[\™[ÉË	İ]IË	İ^	Ë][K]J_O]ˆÛ\ÜÏH™šY[X™[ÛY[OÛX™[Ù[Xİ˜[YOH˜ÛY[‰ØÛY[Ü[ÛœÊ][K˜ÛY[
_OÜÙ[XİÙ]‰ÙšY[
	Ò[™\š^›ÉË	ØY™\ÜÉË	İ^	Ë][K˜Y™\ÜËYJ_IİX[PÚXÚÛ\İ
][J_IÙšY[
	Ñ]H[š^š[ÉË	Üİ\	Ë	Ù]IË][Kœİ\
_IÙšY[
	Õ˜[Ü™H]›Ü›È8 «	Ë	İ˜[YIË	Û[X™\‰Ë][K˜[YJ_IÙšY[
	ĞÛÜİH™]š\İH8 «	Ë	ØÛÜİ	Ë	Û[X™\‰Ë][K˜ÛÜİ
_O]ˆÛ\ÜÏH™šY[X™[”İ]ÏÛX™[Ù[Xİ˜[YOHœİ]\È‰ÜÙ[XİÜ[ÛœÊÉÔX[šYšXØ]ÉË	Ò[ˆÛÜœÛÉË	ĞÛÛ\]]É×K][Kœİ]\Ê_OÜÙ[XİÙ]Ù]˜OØÛÛœİX[RYÏY›Ü›UX[RYÊŠK]OSØš™Xİ™œ›ÛQ[šY\ÊŠNÙ[]H]KX[RYÎÙ]K˜[YOS[X™\Š]K˜[YJNÙ]K˜ÛÜİS[X™\Š]K˜ÛÜİ
NÚYŠY
^ÓØš™Xİ˜\ÜÚYÛŠ][K]JNØ\TÚ]UX[\Ê][KX[RYÊ_Y[Ù^ØÛÛœİÜ™X]Y^ÚYZY
	Û	ÊKÛÙNZY
	ÑRÉÊK‹‹™]K›ÙÜ™\ÜÎŒNØ\TÚ]UX[\ÊÜ™X]YX[RYÊNÙ‹œÚ]\Ëœ\Ú
Ü™X]Y
__J_B™[˜İ[ÛˆÜ[”][İJY
^ØÛÛœİ][OY‹œ][İ\Ë™š[™
OšYOOZY
_ØÛÙN‰Ô‘U‹LŒ‹IÊÔİš[™Ê‹œ][İ\Ë›[™İ
ÌJKœYİ\
Ë	Ì	ÊKÛY[‰ÉËİXš™Xİ‰ÉË™]Œ]N›™]È]J
KÒTÓÔİš[™Ê
KœÛXÙJL
Kİ]\Î‰Ğ›Ş˜IßNÛ[Ù[
YÉÓ[ÙYšXØH™]™[]›ÉÎ‰Ó[İ›È™]™[]›ÉË]ˆÛ\ÜÏH™›Ü›QÜšY‰ÙšY[
	Ó[Y\›ÉË	ØÛÙIË	İ^	Ë][K˜ÛÙJ_O]ˆÛ\ÜÏH™šY[X™[ÛY[OÛX™[Ù[Xİ˜[YOH˜ÛY[‰ØÛY[Ü[ÛœÊ][K˜ÛY[
_OÜÙ[XİÙ]‰ÙšY[
	ÓÙÙÙ]ÉË	ÜİXš™Xİ	Ë	İ^	Ë][KœİXš™XİYJ_IÙšY[
	Ò[\ÜÈ™]È8 «	Ë	Û™]	Ë	Û[X™\‰Ë][K›™]
_IÙšY[
	Ñ]IË	Ù]IË	Ù]IË][K™]J_O]ˆÛ\ÜÏH™šY[X™[”İ]ÏÛX™[Ù[Xİ˜[YOHœİ]\È‰ÜÙ[XİÜ[ÛœÊÉĞ›Ş˜IË	Ò[šX]ÉË	Ò[ˆ]\ØIË	ĞXØÙ]]ÉË	ÔšYš]]]É×K][Kœİ]\Ê_OÜÙ[XİÙ]Ù]˜OØÛÛœİ]OSØš™Xİ™œ›ÛQ[šY\ÊŠNÙ]K›™]S[X™\Š]K›™]
NÚYŠY
SØš™Xİ˜\ÜÚYÛŠ][K]JNÙ[ÙH‹œ][İ\Ëœ\Ú
ÚYZY
	Ü	ÊK‹‹™]_J_J_B™[˜İ[ÛˆÜ[”•\ØY

^Û[Ù[
	ĞØ\šXØH™]™[]›È‰Ë]ˆÛ\ÜÏH™›Ü›QÜšY]ˆÛ\ÜÏH™šY[[X™[‘š[HÛX™[[œ]˜[YOHœˆˆ\OH™š[HˆXØÙ\H˜\XØ][Û‹Ü‹œˆˆ™\]Z\™YÛX[’[Øİ[Y[ÈšY[™HÛÛœÙ\˜]È™[8 &X\˜Ú]š[ÈÛİY›İ]ËÜÛX[Ù]‰ÙšY[
	Ó[Y\›È™]™[]›ÉË	ØÛÙIË	İ^	Ë	Ô‘U‹LŒ‹IÊÔİš[™Ê‹œ][İ\Ë›[™İ
ÌJKœYİ\
Ë	Ì	ÊJ_O]ˆÛ\ÜÏH™šY[X™[ÛY[OÛX™[Ù[Xİ˜[YOH˜ÛY[‰ØÛY[Ü[ÛœÊ
_OÜÙ[XİÙ]‰ÙšY[
	ÓÙÙÙ]ÉË	ÜİXš™Xİ	Ë	İ^	Ë	Ô™]™[]›ÈØ\šXØ]ÉËYJ_IÙšY[
	Ò[\ÜÈ™]È8 «
˜XÛÛ]]›ÊIË	Û™]	Ë	Û[X™\‰Ë	Ì	Ê_IÙšY[
	Ñ]IË	Ù]IË	Ù]IË™]È]J
KÒTÓÔİš[™Ê
KœÛXÙJL
J_O]ˆÛ\ÜÏH™šY[X™[”İ]ÏÛX™[Ù[Xİ˜[YOHœİ]\ÈÜ[Û›Ş˜OÛÜ[ÛÜ[Û’[šX]ÏÛÜ[ÛÜ[Û’[ˆ]\ØOÛÜ[ÛÜ[ÛXØÙ]]ÏÛÜ[ÛÜ[Û”šYš]]]ÏÛÜ[ÛÜÙ[XİÙ]Ù]˜\Ş[˜ÈOØÛÛœİš[OY‹™Ù]
	Ü‰ÊK\OYš[OË\_
×œ‰ÚK\İ
š[OË›˜[Y_	ÉÊOÉØ\XØ][Û‹Ü‰Î‰ÉÊNÚYŠYš[_\HOOIØ\XØ][Û‹Ü‰Ê]›İÈ™]È\œ›ÜŠ	ÔÙ[^š[Û˜H[ˆš[Hˆ˜[YÉÊNØÛÛœİY]ZY
	Ü	ÊKÛY[Y‹™Ù]
	ØÛY[	ÊNÛ]İÜ™Y^Ü’Ù^NšYš[S˜[YN™š[K›˜[YKš[U\N\Kš[TÚ^™N™š[KœÚ^™_NÚYŠÚ[™İË‘Y[Ø\PÛİYËœ™XYI‰Ú[™İË‘Y[Ø\PÛİY\ØYØİ[Y[
^ÜİÜ™YX]ØZ]Ú[™İË‘Y[Ø\PÛİY\ØYØİ[Y[
š[KÙØİ[Y[YšYØ]YÛÜN‰Ô™]™[]›ÉËÛY[J_Y[ÙH]ØZ]İÜ™TŠYš[JNÙ‹œ][İ\Ëœ\Ú
ÚY‹‹œİÜ™YÛÙN™‹™Ù]
	ØÛÙIÊKÛY[İXš™Xİ™‹™Ù]
	ÜİXš™Xİ	ÊK™]“[X™\Š‹™Ù]
	Û™]	Ê_
K]N™‹™Ù]
	Ù]IÊKİ]\Î™‹™Ù]
	Üİ]\ÉÊ_J_J_B˜\Ş[˜È[˜İ[ÛˆÜ[”][İTŠY
^ØÛÛœİOY‹œ][İ\Ë™š[™
OšYOOZY
NÚYŠ\J\™]\›ÚYŠKœİÜ˜YÙT]	‰Ú[™İË‘Y[Ø\PÛİYË›Ü[‘Øİ[Y[
^İ^Ü™]\›ˆ]ØZ]Ú[™İË‘Y[Ø\PÛİY›Ü[‘Øİ[Y[
KœİÜ˜YÙT]
_XØ]Ú
\œŠ^Ü™]\›ˆ[\
\œ‹›Y\ÜØYÙ_	Ò[\ÜÜÚXš[H\š\™H[‰Ê__ZYŠ\Kœ’Ù^J\™]\›ØÛÛœİÜ\]Ú[™İË›Ü[Š	ÉË	×Ø›[šÉÊNİ^ØÛÛœİ›ØX]ØZ]™XYŠKœ’Ù^JNÚYŠX›ØŠ]›İÈ™]È\œ›ÜŠ	Ò[ˆ›Ûˆ0êpîH™\Ù[HİH]Y\İÈ\ÜÜÚ]]›ÉÊNØÛÛœİ\›UT“˜Ü™X]SØš™XİT“
›ØŠNÚYŠÜ\
\Ü\›ØØ][Û‹š™Y]\›Ù[Ù^ØÛÛœİOYØİ[Y[˜Ü™X]Q[[Y[
	ØIÊNØKš™Y]\›ØK\™Ù]I×Ø›[šÉÎØK˜ÛXÚÊ
_\Ù][Y[İ]


OO•T“œ™]›ÚÙSØš™XİT“
\›
KŒ
_XØ]Ú
\œŠ^ÚYŠÜ\
\Ü\˜ÛÜÙJ
NØ[\
\œ‹›Y\ÜØYÙ_	Ò[\ÜÜÚXš[H\š\™H[‰Ê__B™[˜İ[ÛˆÜ[‘›Û™JY
^ØÛÛœİ][OY‹™›Û™K™š[™
OšYOOZY
_ØÛY[‰ÉË]N›™]È]J
KÒTÓÔİš[™Ê
KœÛXÙJL
K\™XN‰ĞÛÜ\\˜HH˜XØÚX]IËš[™[™ÜÎ‰ÉËİ]\Î‰ÑH™[^š[Û˜\™IßNÛ[Ù[
YÉÓ[ÙYšXØHšY[Ú\Ü^š[Û™IÎ‰Ó[İ˜HšY[Ú\Ü^š[Û™IË]ˆÛ\ÜÏH™›Ü›QÜšY]ˆÛ\ÜÏH™šY[X™[ÛY[OÛX™[Ù[Xİ˜[YOH˜ÛY[‰ØÛY[Ü[ÛœÊ][K˜ÛY[
_OÜÙ[XİÙ]‰ÙšY[
	Ñ]IË	Ù]IË	Ù]IË][K™]J_IÙšY[
	Ğ\™XH\Ü^š[Û˜]IË	Ø\™XIË	İ^	Ë][K˜\™XKYJ_O]ˆÛ\ÜÏH™šY[[X™[[›ÛX[YHš[]˜]OÛX™[^\™XH˜[YOH™š[™[™ÜÈˆ™\]Z\™Y‰Ù\ØÊ][K™š[™[™ÜÊ_Oİ^\™XOÙ]]ˆÛ\ÜÏH™šY[X™[”İ]ÏÛX™[Ù[Xİ˜[YOHœİ]\È‰ÜÙ[XİÜ[ÛœÊÉÑH™[^š[Û˜\™IË	Ô™[^š[Û™H›ÛIË	ĞÛÛ\]]É×K][Kœİ]\Ê_OÜÙ[XİÙ]Ù]˜OØÛÛœİ]OSØš™Xİ™œ›ÛQ[šY\ÊŠNÚYŠY
SØš™Xİ˜\ÜÚYÛŠ][K]JNÙ[ÙH‹™›Û™Kœ\Ú
ÚYZY
	Ù	ÊK‹‹™]_J_J_B˜\Ş[˜È[˜İ[ÛˆØ]™SY™[[™Qš[\Êš[\Ê^ØÛÛœİİ]V×NÙ›ÜŠÛÛœİš[HÙˆ\œ˜^K™œ›ÛJš[\ß×JJ^ØÛÛœİ\OYš[K\_
×œ‰ÚK\İ
š[K›˜[YJOÉØ\XØ][Û‹Ü‰Î‰ÉÊNÚYŠJ\OOOIØ\XØ][Û‹Ü‰ß\Kœİ\ÕÚ]
	Ú[XYÙKÉÊJJ]›İÈ™]È\œ›ÜŠ	Ô[ÚHØ\šXØ\™HÛÛ[ÈØİ[Y[HˆH›İÙÜ˜YšYIÊNØÛÛœİÙ^O]ZY
	ÙØÉÊJÉËIÊÓX]œ˜[™ÛJ
KÔİš[™ÊÍŠKœÛXÙJ‹ÊNØ]ØZ]İÜ™TŠÙ^Kš[JNÛİ]œ\Ú
ÚÙ^K˜[YN™š[K›˜[YK\KÚ^™N™š[KœÚ^™_J_\™]\›ˆİ]B™[˜İ[ÛˆÜ[“Y™[[™JY
^ØÛÛœİ][OY‹›Y™[[™\Ë™š[™
OšYOOZY
_ØÛY[‰ÉË˜[YN‰Ó[™XHš]HÛÜ\\˜IËY™\ÜÎ‰ÉË[œİ[\‰ÉË[œİ[]N›™]È]J
KÒTÓÔİš[™Ê
KœÛXÙJL
K™^ÚXÚÎ‰ÉË\N‰Ó[™XHš]H\›X[™[IË›İ\Î‰ÉËš[\Î–×_NÛ[Ù[
YÉÓ[ÙYšXØH[™XHš]IÎ‰Ó[İ˜H[™XHš]IË]ˆÛ\ÜÏH™›Ü›QÜšY]ˆÛ\ÜÏH™šY[X™[ÛÛ™ÛZ[š[ÈÈÛY[OÛX™[Ù[Xİ˜[YOH˜ÛY[‰ØÛY[Ü[ÛœÊ][K˜ÛY[
_OÜÙ[XİÙ]‰ÙšY[
	Ó›ÛYHÈÛÙXÙH[\X[ÉË	Û˜[YIË	İ^	Ë][K›˜[YJ_IÙšY[
	Ò[™\š^›ÉË	ØY™\ÜÉË	İ^	Ë][K˜Y™\ÜËYJ_IÙšY[
	Ò[œİ[]Ü™IË	Ú[œİ[\‰Ë	İ^	Ë][Kš[œİ[\Š_IÙšY[
	Ñ]H[œİ[^š[Û™IË	Ú[œİ[]IË	Ù]IË][Kš[œİ[]J_IÙšY[
	Ô›ÜÜÚ[XH™\šYšXØIË	Û™^ÚXÚÉË	Ù]IË][K›™^ÚXÚÊ_O]ˆÛ\ÜÏH™šY[X™[•\ÛÙÚXOÛX™[Ù[Xİ˜[YOH\H‰ÜÙ[XİÜ[ÛœÊÉÓ[™XHš]H\›X[™[IË	Ô[HH[˜ÛÜ˜YÙÚ[ÉË	Ñ\ÜÜÚ]]›È[\Ü˜[™[É×K][K\J_OÜÙ[XİÙ]]ˆÛ\ÜÏH™šY[[X™[“›İHXÛšXÚOÛX™[^\™XH˜[YOH››İ\ÈˆXÙZÛ\HXØÙ\ÜÛÈ[HÛÜ\\˜KÜÚ^š[Û™K™\ØÜš^š[ÛšK[›ÛX[YK‹‹ˆ‰Ù\ØÊ][K››İ\Ê_Oİ^\™XOÙ]]ˆÛ\ÜÏH™šY[[X™[“[İšHØİ[Y[HH›İÙÜ˜YšYOÛX™[[œ]˜[YOH™š[\Èˆ\OH™š[HˆXØÙ\H˜\XØ][Û‹Ü‹œ‹[XYÙKÊˆˆ][\OÙ]Ù]˜\Ş[˜ÈOØÛÛœİš[\ÏX]ØZ]Ø]™SY™[[™Qš[\Ê‹™Ù][
	Ùš[\ÉÊK™š[\ŠOœÚ^™JJK]O^ØÛY[™‹™Ù]
	ØÛY[	ÊK˜[YN™‹™Ù]
	Û˜[YIÊKY™\ÜÎ™‹™Ù]
	ØY™\ÜÉÊK[œİ[\™‹™Ù]
	Ú[œİ[\‰ÊK[œİ[]N™‹™Ù]
	Ú[œİ[]IÊK™^ÚXÚÎ™‹™Ù]
	Û™^ÚXÚÉÊK\N™‹™Ù]
	İ\IÊK›İ\Î™‹™Ù]
	Û›İ\ÉÊ_NÚYŠY
^ÓØš™Xİ˜\ÜÚYÛŠ][K]JNÚ][K™š[\ÏJ][K™š[\ß×JK˜ÛÛ˜Ø]
š[\Ê_Y[ÙH‹›Y™[[™\Ëœ\Ú
ÚYZY
	Û‰ÊK‹‹™]Kš[\ßJ_J_B™[˜İ[ÛˆYY™[[™Qš[\ÊY
^ØÛÛœİ][OY‹›Y™[[™\Ë™š[™
OšYOOZY
NÚYŠZ][J\™]\›Û[Ù[
	ĞYÙÚ][™ÚHØİ[Y[HÈ›İÙÜ˜YšYIË]ˆÛ\ÜÏH››İXÙH‰Ù\ØÊ][K˜ÛY[
_OØœ‰Ù\ØÊ][K›˜[YJ_OÙ]]ˆİ[OHšZYÚŒMÙ]]ˆÛ\ÜÏH™šY[X™[”Ù[^š[Û˜Hš[OÛX™[[œ]˜[YOH™š[\Èˆ\OH™š[HˆXØÙ\H˜\XØ][Û‹Ü‹œ‹[XYÙKÊˆˆ][\H™\]Z\™YÛX[Ù\YšXØ^š[ÛšK™\˜˜[KX[X[HH›İÈ[8 &Z[\X[ËÜÛX[Ù]˜\Ş[˜ÈOØÛÛœİš[\ÏX]ØZ]Ø]™SY™[[™Qš[\Ê‹™Ù][
	Ùš[\ÉÊJNÚ][K™š[\ÏJ][K™š[\ß×JK˜ÛÛ˜Ø]
š[\Ê_J_B™[˜İ[ÛˆÜ[”›ÛÙŠY
^ØÛÛœİ][OY‹œ›ÛÙœË™š[™
OšYOOZY
_ØÛY[‰ÉË\N‰Ô[^šXHÜ›Û™IËY™\ÜÎ‰ÉË]N›™]È]J
KÒTÓÔİš[™Ê
KœÛXÙJL
KÛÜšÙ\•ÓÔ’ÑT”ÖÌOËšY	ÉËœ™\]Y[˜ŞN‰Ò[\™[ÈÚ[™ÛÛÉËXØÙ\ÜÎ‰ÑH™\šYšXØ\™IË›İ\Î‰ÉËİ]\Î‰ÔX[šYšXØ]ÉËš[\Î–×K\]\Î–×_K\\ÏVÉÔ[^šXHÜ›Û™IË	Ô[^šXH]ÉË	ĞÛÛ›ÛÈÛÜ\\˜IË	ÔÜ\™ÛÈ]šX[IË	Ôš[[Şš[Û™H›ÙÛYHH]š]IË	Ô[^šXHÜ›Û™HHÛÛ›ÛÈ]É×NÛ[Ù[
YÉÓ[ÙYšXØH]ÈHÜ›Û™IÎ‰Ó[İ›È[\™[È]ÈHÜ›Û™IË]ˆÛ\ÜÏH™›Ü›QÜšY]ˆÛ\ÜÏH™šY[X™[ÛÛ™ÛZ[š[ÈÈÛY[OÛX™[Ù[Xİ˜[YOH˜ÛY[‰ØÛY[Ü[ÛœÊ][K˜ÛY[
_OÜÙ[XİÙ]]ˆÛ\ÜÏH™šY[X™[•\È[\™[ÏÛX™[Ù[Xİ˜[YOH\H‰ÜÙ[XİÜ[ÛœÊ\\Ë][K\J_OÜÙ[XİÙ]‰ÙšY[
	Ò[™\š^›ÉË	ØY™\ÜÉË	İ^	Ë][K˜Y™\ÜËYJ_IÙšY[
	Ñ]H›ÙÜ˜[[X]IË	Ù]IË	Ù]IË][K™]J_O]ˆÛ\ÜÏH™šY[X™[”Ü]XY˜H\ÜÙYÛ˜]OÛX™[Ù[Xİ˜[YOHÛÜšÙ\ˆ‰İX[SÜ[ÛœÊ][KÛÜšÙ\Š_OÜÙ[XİÙ]]ˆÛ\ÜÏH™šY[X™[”\š[ÙXÚ]0èÛX™[Ù[Xİ˜[YOH™œ™\]Y[˜ŞH‰ÜÙ[XİÜ[ÛœÊÉÒ[\™[ÈÚ[™ÛÛÉË	ÓÙÛšHˆY\ÚIË	Ğ[›X[IË	ÑYH›ÛH8 &X[››É×K][K™œ™\]Y[˜ŞJ_OÜÙ[XİÙ]]ˆÛ\ÜÏH™šY[X™[“[Ù[]0èHXØÙ\ÜÛÏÛX™[Ù[Xİ˜[YOH˜XØÙ\ÜÈ‰ÜÙ[XİÜ[ÛœÊÉÑHØØ[IË	ÑHÛÜ\\˜IË	ĞÛÛˆX]Y›Ü›XIË	ĞÛÛˆ[™XHš]IË	ÑH™\šYšXØ\™I×K][K˜XØÙ\ÜÊ_OÜÙ[XİÙ]]ˆÛ\ÜÏH™šY[[X™[’[™XØ^š[ÛšHÜ\˜]]™OÛX™[^\™XH˜[YOH››İ\È‰Ù\ØÊ][K››İ\Ê_Oİ^\™XOÙ]]ˆÛ\ÜÏH™šY[[X™[“[İ™H›İÈHØİ[Y[OÛX™[[œ]˜[YOH™š[\Èˆ\OH™š[HˆXØÙ\H˜\XØ][Û‹Ü‹œ‹[XYÙKÊˆˆ][\OÙ]Ù]˜\Ş[˜ÈOØÛÛœİš[\ÏX]ØZ]Ø]™SY™[[™Qš[\Ê‹™Ù][
	Ùš[\ÉÊK™š[\ŠOœÚ^™JJK]O^ØÛY[™‹™Ù]
	ØÛY[	ÊK\N™‹™Ù]
	İ\IÊKY™\ÜÎ™‹™Ù]
	ØY™\ÜÉÊK]N™‹™Ù]
	Ù]IÊKÛÜšÙ\™‹™Ù]
	İÛÜšÙ\‰ÊKœ™\]Y[˜ŞN™‹™Ù]
	Ùœ™\]Y[˜ŞIÊKXØÙ\ÜÎ™‹™Ù]
	ØXØÙ\ÜÉÊK›İ\Î™‹™Ù]
	Û›İ\ÉÊ_NÚYŠY
^ÓØš™Xİ˜\ÜÚYÛŠ][K]JNÚ][K™š[\ÏJ][K™š[\ß×JK˜ÛÛ˜Ø]
š[\Ê_Y[ÙH‹œ›ÛÙœËœ\Ú
ÚYZY
	İÉÊK‹‹™]Kİ]\Î‰ÔX[šYšXØ]ÉËš[\Ë\]\Î–×_J_J_B™[˜İ[ÛˆY›ÛÙ‘š[\ÊY
^ØÛÛœİ][OY‹œ›ÛÙœË™š[™
OšYOOZY
NÚYŠZ][J\™]\›Û[Ù[
	ĞYÙÚ][™ÚH›İÈÈØİ[Y[IË]ˆÛ\ÜÏH››İXÙH‰Ù\ØÊ][K˜ÛY[
_OØœ‰Ù\ØÊ][K\J_H0­È	Ù\ØÊ][K˜Y™\ÜÊ_OÙ]]ˆİ[OHšZYÚŒMÙ]]ˆÛ\ÜÏH™šY[X™[‘›İÈš[XKÙÜÈÈØİ[Y[OÛX™[[œ]˜[YOH™š[\Èˆ\OH™š[HˆXØÙ\H˜\XØ][Û‹Ü‹œ‹[XYÙKÊˆˆØ\\™OH™[š\›Û›Y[ˆ][\H™\]Z\™YÙ]˜\Ş[˜ÈOØÛÛœİš[\ÏX]ØZ]Ø]™SY™[[™Qš[\Ê‹™Ù][
	Ùš[\ÉÊJNÚ][K™š[\ÏJ][K™š[\ß×JK˜ÛÛ˜Ø]
š[\Ê_J_B™[˜İ[Ûˆ\]T›ÛÙ•\ÚÊY
^ØÛÛœİ][OY‹œ›ÛÙœË™š[™
OšYOOZY
NÚYŠZ][J\™]\›Û[Ù[
	ĞYÙÚ[Ü›˜H[\™[È]ÈHÜ›Û™IË]ˆÛ\ÜÏH››İXÙH‰Ù\ØÊ][K˜ÛY[
_OØœ‰Ù\ØÊ][K\J_H0­È	Ù\ØÊ][K˜Y™\ÜÊ_OÙ]]ˆİ[OHšZYÚŒMÙ]]ˆÛ\ÜÏH™›Ü›QÜšY]ˆÛ\ÜÏH™šY[X™[”İ]ÏÛX™[Ù[Xİ˜[YOHœİ]\ÈÜ[Ûˆ	Ú][Kœİ]\ÏOOIÔX[šYšXØ]ÉÏÉÜÙ[XİY	Î‰ÉßO”X[šYšXØ]ÏÛÜ[ÛÜ[Ûˆ	Ú][Kœİ]\ÏOOIÒ[ˆÛÜœÛÉÏÉÜÙ[XİY	Î‰ÉßO’[ˆÛÜœÛÏÛÜ[ÛÜ[Ûˆ	Ú][Kœİ]\ÏOOIĞÛÛ\]]ÉÏÉÜÙ[XİY	Î‰ÉßOÛÛ\]]ÏÛÜ[ÛÜÙ[XİÙ]‰ÙšY[
	Ñ]H[\™[ÉË	Ù]IË	Ù]IË][K™]J_O]ˆÛ\ÜÏH™šY[[X™[”˜\ÜÈ]]š]0èÛX™[^\™XH˜[YOH\]HˆXÙZÛ\H”[^šXH\ÙYİZ]KÛÛ™^š[ÛšH[HÛÜ\\˜K›Ø›[ZHš[]˜]K‹‹ˆİ^\™XOÙ]]ˆÛ\ÜÏH™šY[[X™[‘›İÈš[XKÙÜÏÛX™[[œ]˜[YOH™š[\Èˆ\OH™š[HˆXØÙ\H˜\XØ][Û‹Ü‹œ‹[XYÙKÊˆˆØ\\™OH™[š\›Û›Y[ˆ][\OÙ]Ù]˜\Ş[˜ÈOØÛÛœİš[\ÏX]ØZ]Ø]™SY™[[™Qš[\Ê‹™Ù][
	Ùš[\ÉÊK™š[\ŠOœÚ^™JJNÚ][Kœİ]\ÏY‹™Ù]
	Üİ]\ÉÊNÚ][K™]OY‹™Ù]
	Ù]IÊNÚ][K™š[\ÏJ][K™š[\ß×JK˜ÛÛ˜Ø]
š[\ÊNÚYŠ‹™Ù]
	İ\]IÊJZ][K\]\ÏJ][K\]\ß×JK˜ÛÛ˜Ø]
Ù]N›™]È]J
KÒTÓÔİš[™Ê
KÛÜšÙ\œ›ÛK›İN™‹™Ù]
	İ\]IÊ_J_J_B™[˜İ[ÛˆÜ[‘˜Z[ŠY
^ØÛÛœİ][OY‹™˜Z[œË™š[™
OšYOOZY
_ØÛY[‰ÉË\N‰Ô[^šXHÜšYÛYIËY™\ÜÎ‰ÉË\™XN‰ĞÛÜ[HHÛÜœÙ[È›Ş	Ë]X[]NŒK]N›™]È]J
KÒTÓÔİš[™Ê
KœÛXÙJL
KÛÜšÙ\•ÓÔ’ÑT”ÖÌOËšY	ÉËœ™\]Y[˜ŞN‰Ò[\™[ÈÚ[™ÛÛÉË›İ\Î‰ÉËİ]\Î‰ÔX[šYšXØ]ÉËš[\Î–×K\]\Î–×_K\\ÏVÉÔ[^šXHÜšYÛYIË	Ô[^šXHŞ™]IË	Ô[^šXHÛXš[šIË	Ô[^šXHØY]ÚYIË	Ñ\ÛÜİ^š[Û™HØØ\šXÚIË	ÕšY[Ú\Ü^š[Û™HØØ\šXÚIË	Ô[^šXHÛÛ\]HÜšYÛYKŞ™]HHÛXš[šI×NÛ[Ù[
YÉÓ[ÙYšXØHÜšYÛYHHŞ™]IÎ‰Ó[İ›È[\™[ÈÜšYÛYHHŞ™]IË]ˆÛ\ÜÏH™›Ü›QÜšY]ˆÛ\ÜÏH™šY[X™[ÛÛ™ÛZ[š[ÈÈÛY[OÛX™[Ù[Xİ˜[YOH˜ÛY[‰ØÛY[Ü[ÛœÊ][K˜ÛY[
_OÜÙ[XİÙ]]ˆÛ\ÜÏH™šY[X™[•\È[\™[ÏÛX™[Ù[Xİ˜[YOH\H‰ÜÙ[XİÜ[ÛœÊ\\Ë][K\J_OÜÙ[XİÙ]‰ÙšY[
	Ò[™\š^›ÉË	ØY™\ÜÉË	İ^	Ë][K˜Y™\ÜËYJ_IÙšY[
	Ö›Û˜HÈÜÚ^š[Û™IË	Ø\™XIË	İ^	Ë][K˜\™XJ_IÙšY[
	Ó[Y\›È[IË	Ü]X[]IË	Û[X™\‰Ë][Kœ]X[]J_IÙšY[
	Ñ]H›ÙÜ˜[[X]IË	Ù]IË	Ù]IË][K™]J_O]ˆÛ\ÜÏH™šY[X™[”Ü]XY˜H\ÜÙYÛ˜]OÛX™[Ù[Xİ˜[YOHÛÜšÙ\ˆ‰İX[SÜ[ÛœÊ][KÛÜšÙ\Š_OÜÙ[XİÙ]]ˆÛ\ÜÏH™šY[X™[”\š[ÙXÚ]0èÛX™[Ù[Xİ˜[YOH™œ™\]Y[˜ŞH‰ÜÙ[XİÜ[ÛœÊÉÒ[\™[ÈÚ[™ÛÛÉË	ÓÙÛšHÈY\ÚIË	ÓÙÛšHˆY\ÚIË	Ğ[›X[IË	ÑYH›ÛH8 &X[››É×K][K™œ™\]Y[˜ŞJ_OÜÙ[XİÙ]]ˆÛ\ÜÏH™šY[[X™[’[™XØ^š[ÛšHÜ\˜]]™OÛX™[^\™XH˜[YOH››İ\È‰Ù\ØÊ][K››İ\Ê_Oİ^\™XOÙ]]ˆÛ\ÜÏH™šY[[X™[“[İ™H›İÈHØİ[Y[OÛX™[[œ]˜[YOH™š[\Èˆ\OH™š[HˆXØÙ\H˜\XØ][Û‹Ü‹œ‹[XYÙKÊˆˆ][\OÙ]Ù]˜\Ş[˜ÈOØÛÛœİš[\ÏX]ØZ]Ø]™SY™[[™Qš[\Ê‹™Ù][
	Ùš[\ÉÊK™š[\ŠOœÚ^™JJK]O^ØÛY[™‹™Ù]
	ØÛY[	ÊK\N™‹™Ù]
	İ\IÊKY™\ÜÎ™‹™Ù]
	ØY™\ÜÉÊK\™XN™‹™Ù]
	Ø\™XIÊK]X[]N“[X™\Š‹™Ù]
	Ü]X[]IÊ_
K]N™‹™Ù]
	Ù]IÊKÛÜšÙ\™‹™Ù]
	İÛÜšÙ\‰ÊKœ™\]Y[˜ŞN™‹™Ù]
	Ùœ™\]Y[˜ŞIÊK›İ\Î™‹™Ù]
	Û›İ\ÉÊ_NÚYŠY
^ÓØš™Xİ˜\ÜÚYÛŠ][K]JNÚ][K™š[\ÏJ][K™š[\ß×JK˜ÛÛ˜Ø]
š[\Ê_Y[ÙH‹™˜Z[œËœ\Ú
ÚYZY
	Ü	ÊK‹‹™]Kİ]\Î‰ÔX[šYšXØ]ÉËš[\Ë\]\Î–×_J_J_B™[˜İ[ÛˆY˜Z[‘š[\ÊY
^ØÛÛœİ][OY‹™˜Z[œË™š[™
OšYOOZY
NÚYŠZ][J\™]\›Û[Ù[
	ĞYÙÚ][™ÚH›İÈÈØİ[Y[IË]ˆÛ\ÜÏH››İXÙH‰Ù\ØÊ][K˜ÛY[
_OØœ‰Ù\ØÊ][K\J_H0­È	Ù\ØÊ][K˜\™XJ_OÙ]]ˆİ[OHšZYÚŒMÙ]]ˆÛ\ÜÏH™šY[X™[‘›İÈš[XKÙÜÈÈØİ[Y[OÛX™[[œ]˜[YOH™š[\Èˆ\OH™š[HˆXØÙ\H˜\XØ][Û‹Ü‹œ‹[XYÙKÊˆˆØ\\™OH™[š\›Û›Y[ˆ][\H™\]Z\™YÙ]˜\Ş[˜ÈOØÛÛœİš[\ÏX]ØZ]Ø]™SY™[[™Qš[\Ê‹™Ù][
	Ùš[\ÉÊJNÚ][K™š[\ÏJ][K™š[\ß×JK˜ÛÛ˜Ø]
š[\Ê_J_B™[˜İ[Ûˆ\]Q˜Z[•\ÚÊY
^ØÛÛœİ][OY‹™˜Z[œË™š[™
OšYOOZY
NÚYŠZ][J\™]\›Û[Ù[
	ĞYÙÚ[Ü›˜HÜšYÛYKŞ™]HHÛXš[šIË]ˆÛ\ÜÏH››İXÙH‰Ù\ØÊ][K˜ÛY[
_OØœ‰Ù\ØÊ][K\J_H0­È	Ù\ØÊ][K˜Y™\ÜÊ_OÙ]]ˆİ[OHšZYÚŒMÙ]]ˆÛ\ÜÏH™›Ü›QÜšY]ˆÛ\ÜÏH™šY[X™[”İ]ÏÛX™[Ù[Xİ˜[YOHœİ]\ÈÜ[Ûˆ	Ú][Kœİ]\ÏOOIÔX[šYšXØ]ÉÏÉÜÙ[XİY	Î‰ÉßO”X[šYšXØ]ÏÛÜ[ÛÜ[Ûˆ	Ú][Kœİ]\ÏOOIÒ[ˆÛÜœÛÉÏÉÜÙ[XİY	Î‰ÉßO’[ˆÛÜœÛÏÛÜ[ÛÜ[Ûˆ	Ú][Kœİ]\ÏOOIĞÛÛ\]]ÉÏÉÜÙ[XİY	Î‰ÉßOÛÛ\]]ÏÛÜ[ÛÜÙ[XİÙ]‰ÙšY[
	Ñ]H[\™[ÉË	Ù]IË	Ù]IË][K™]J_O]ˆÛ\ÜÏH™šY[[X™[”˜\ÜÈ]]š]0èÛX™[^\™XH˜[YOH\]HˆXÙZÛ\H”[H[]KX]\šX[Hš[[ÜÜÛËÜİ^š[ÛšHÈ[›šHš[]˜]K‹‹ˆİ^\™XOÙ]]ˆÛ\ÜÏH™šY[[X™[‘›İÈš[XKÙÜÏÛX™[[œ]˜[YOH™š[\Èˆ\OH™š[HˆXØÙ\H˜\XØ][Û‹Ü‹œ‹[XYÙKÊˆˆØ\\™OH™[š\›Û›Y[ˆ][\OÙ]Ù]˜\Ş[˜ÈOØÛÛœİš[\ÏX]ØZ]Ø]™SY™[[™Qš[\Ê‹™Ù][
	Ùš[\ÉÊK™š[\ŠOœÚ^™JJNÚ][Kœİ]\ÏY‹™Ù]
	Üİ]\ÉÊNÚ][K™]OY‹™Ù]
	Ù]IÊNÚ][K™š[\ÏJ][K™š[\ß×JK˜ÛÛ˜Ø]
š[\ÊNÚYŠ‹™Ù]
	İ\]IÊJZ][K\]\ÏJ][K\]\ß×JK˜ÛÛ˜Ø]
Ù]N›™]È]J
KÒTÓÔİš[™Ê
KÛÜšÙ\œ›ÛK›İN™‹™Ù]
	İ\]IÊ_J_J_B˜\Ş[˜È[˜İ[ÛˆÜ[”İÜ™Yš[JÙ^J^ØÛÛœİÜ\]Ú[™İË›Ü[Š	ÉË	×Ø›[šÉÊNİ^ØÛÛœİ›ØX]ØZ]™XYŠÙ^JNÚYŠX›ØŠ]›İÈ™]È\œ›ÜŠ	Ò[š[H›Ûˆ0êpîH™\Ù[HİH]Y\İÈ\ÜÜÚ]]›ÉÊNØÛÛœİ\›UT“˜Ü™X]SØš™XİT“
›ØŠNÚYŠÜ\
\Ü\›ØØ][Û‹š™Y]\›Ù[Ù^ØÛÛœİOYØİ[Y[˜Ü™X]Q[[Y[
	ØIÊNØKš™Y]\›ØK\™Ù]I×Ø›[šÉÎØK˜ÛXÚÊ
_\Ù][Y[İ]


OO•T“œ™]›ÚÙSØš™XİT“
\›
KŒ
_XØ]Ú
\œŠ^ÚYŠÜ\
\Ü\˜ÛÜÙJ
NØ[\
\œ‹›Y\ÜØYÙ_	Ò[\ÜÜÚXš[H\š\™H[Øİ[Y[ÉÊ__B™[˜İ[ÛˆÜ[”™\Ü
Y
^ÙÛÊ	Ü™\Ü	ÊNÜÙ][Y[İ]


OOØÛÛœİÏYØİ[Y[œ]Y\TÙ[XİÜŠ	ÖÛ˜[YO\Ú]WIÊNÚYŠÊ\Ë˜[YOZYK
_B™[˜İ[ÛˆØ]™T™\Ü
J^ÙKœ™]™[Y˜][

NØÛÛœİ[™]È›Ü›Q]JK\™Ù]
KÚ]OY‹œÚ]\Ë™š[™
ÏOœËšYOOY‹™Ù]
	ÜÚ]IÊJNÚYŠ\Ú]J\™]\›ÜÚ]Kœ›ÙÜ™\ÜÏS[X™\Š‹™Ù]
	Ü›ÙÜ™\ÜÉÊ_Ú]Kœ›ÙÜ™\ÜÊNÜÚ]K˜ÛÜİ
ÏS[X™\Š‹™Ù]
	ÛX]\šX[	Ê_
NÙ‹œ™\ÜËœ\Ú
ÚYZY
	Ü‰ÊKÚ]NœÚ]KšYÛÜšÙ\œ›ÛK]N›™]È]J
KÒTÓÔİš[™Ê
Kİ\œÎ“[X™\Š‹™Ù]
	Úİ\œÉÊJKX]\šX[“[X™\Š‹™Ù]
	ÛX]\šX[	ÊJK›İ\Î™‹™Ù]
	Û›İ\ÉÊKİĞÛİ[™K\™Ù]œİÜË™š[\Ë›[™İJNÜØ]™J
NØ[\
	Ô˜\Ü[›ÈØ[˜]Ëˆ[]Û\™HÈ™Y°è™[Ø[Y\™K‰ÊNÙÛÊ	İÛÜšÙ\‰Ê_B™[˜İ[Ûˆš[][İJY
^ØÛÛœİOY‹œ][İ\Ë™š[™
OšYOOZY
NÚYŠ\J\™]\›ÚYŠK˜ZP\Y˜Xİ	‰Ú[™İË™Y[Ø\PZQİÛ›ØYØ]™Y][İJ\™]\›ˆÚ[™İË™Y[Ø\PZQİÛ›ØYØ]™Y][İJJNØÛÛœİÛYØİ[Y[˜›ÙKš[›™\’SÙØİ[Y[˜›ÙKš[›™\’SXXZ[ˆİ[OHœY[™ÎŒÍ\Ù›ÛY˜[Z[N\šX[O‰ĞÓÓTS–K›˜[Y_OÚO‰ĞÓÓTS–K˜Y™\ÜßOœ”’UH	ĞÓÓTS–K˜]Oœ‰ĞÓÓTS–KœÛ™_H0­È	ĞÓÓTS–K™[XZ[OÜ”‘U‘S•U“È	Ù\ØÊK˜ÛÙJ_OÚ‘]Nˆ	Ù\ØÊK™]J_OÜÏ‰Ù\ØÊK˜ÛY[
_OÚÏ‰Ù\ØÊKœİXš™Xİ
_OÜˆİ[OH^X[YÛœšYÚ’[\ÛšXš[Nˆ	Ù]\›ÊK›™]
_OÚİ[OH›X\™Ú[‹]Ü•˜[Y]0èÙ™™\NˆÌÚ[Ü›šOÜÛXZ[˜İÚ[™İËœš[

NÙØİ[Y[˜›ÙKš[›™\’S[ÛÛØØ][Û‹œ™[ØY

_B™[˜İ[ÛˆØ\\™R[™›Ê
^Ø[\
	Ğ\šH[ˆØ[Y\™HH™[ZH8 '[œÙ\š\ØÚHYÙÚ[Ü›˜[Y[ø 'H\ˆ[YØ\™HH›İÈ[˜\Ü[›ÈÛÜœ™]Ë‰Ê_B™[˜İ[ÛˆØ[İÛ™\Š
^ÚYŠPÓÓTS–KœÛ™J\™]\›ˆ[\
	Ò[[Y\›È[]Û\™H›Ûˆ0ê[˜ÛÜ˜HÛÛ™šYİ\˜]È™ZH]H^šY[™[K‰ÊNÛØØ][Û‹š™YX[‰ĞÓÓTS–KœÛ™Kœ™\XÙJÖ×—
×KÙË	ÉÊ_XBš[š]›Û\Ê
NÜ™[™\Š
NÜÙ][Y[İ]


OOØÚXÚÔ™[Z[™\œÊ
NØÚXÚÒİ\”™[Z[™\œÊ
_KML
NÜÙ][\˜[


OOØÚXÚÔ™[Z[™\œÊ
NØÚXÚÒİ\”™[Z[™\œÊ
_KŒ
NÂšYŠ	ÜÙ\šXÙUÛÜšÙ\‰Ú[ˆ˜]šYØ]Ü‰‰›ØØ][Û‹œ›İØÛÛœİ\ÕÚ]
	Ú	ÊJ[˜]šYØ]Ü‹œÙ\šXÙUÛÜšÙ\‹œ™YÚ\İ\Š	Ë‹ÜİËšœÏİM‰ÊK˜Ø]Ú


OOßJNÂÜØÜš\‚ØÜš\Ü˜ÏH‹‹Ü›Ù™\ÜÚ[Û˜[Y^[œÚ[ÛœËšœÏİLNHÜØÜš\‚ØÜš\Ü˜ÏH‹‹Ø\Ú[™\ÜË\İZ]KšœÏİLNHÜØÜš\‚ØÜš\Ü˜ÏH‹‹ØÛY[X\˜Ú]™KšœÏİLŒÜØÜš\‚ØÜš\Ü˜ÏH‹‹Ù\™Xİ\ÙX\˜ÚšœÏİMˆÜØÜš\‚ØÜš\‚Ú[™İË‘Y[Ø\SØØ[^ÂˆÙ]Š
OO™‹ˆÙ]›ÛNŠ
OOœ›ÛKˆÙ]šY]ÎŠ
OOšY]Ëˆ\œÚ\İŠ
OOØ\PÛÛ\[TÙ][™ÜÊ
NÛØØ[İÜ˜YÙKœÙ]][JÑVK”ÓÓ‹œİš[™ÚYJŠJ_Kˆ™[™\Š
OOœ™[™\Š
KˆÛÎŠ™^
OOİšY]Ï[™^Ü™[™\Š
_Kˆ™XYš[NŠÙ^JOOœ™XYŠÙ^JKˆÙ]›ÛNŠ™^
OOÜ›ÛO[™^ÛØØ[İÜ˜YÙKœÙ]][J	ÙZ×Ü›ÛIË›ÛJNÚ[š]›Û\Ê
_KˆÙ]ÛÜšÙ\”›ÛNŠ›Ùš[KZY
OOÂˆÛÛœİX[RY\›Ùš[KX[RY	ØÛİY]X[IÎÂˆYŠY‹X[\ËœÛÛYJ
X[JOOX[KšYOO]X[RY
JY‹X[\Ëœ\Ú
ÚYX[RY˜[YN‰ÔÜ]XY˜H\ÜÙYÛ˜]IËY[X™\ŒNœ›Ùš[K™\Ü^S˜[YKY[X™\Œ‰ÉËÛ™N‰ÉË™[Z[™\•[YN‰ÌNŒ	ßJNÂˆÓÔ’ÑT”ÏY‹X[\ÎÂˆÛÛœİ\œÛÛ’YIØÛİYIÊİZYÂˆ]\œÛÛY‹œİY™‹™š[™

][JOOš][KšYOO\\œÛÛ’Y
NÂˆYŠ\\œÛÛŠ^Ü\œÛÛ^ÚYœ\œÛÛ’Y˜[YNœ›Ùš[K™\Ü^S˜[Y_›Ùš[K™[XZ[Û™N‰ÉËX[NX[RY™[Z[™\•[YN‰ÌNŒ	ßNÙ‹œİY™‹œ\Ú
\œÛÛŠ_Bˆ[Ù^Ü\œÛÛ‹›˜[YO\›Ùš[K™\Ü^S˜[Y_›Ùš[K™[XZ[Ü\œÛÛ‹X[O]X[RYBˆÕQ‘Y‹œİY™Ü›ÛO\\œÛÛ’YÛØØ[İÜ˜YÙKœÙ]][J	ÙZ×Ü›ÛIË›ÛJNÚ[š]›Û\Ê
NÂˆKˆÛX\”™\İšXİY]NŠ
OOÂˆÉØÛÛ™ÛZ[šIË	Ú[\™[[ÛœÉË	Ú[œÜXİ[ÛœÉË	ÜÚ]\ÉË	Ü][İ\ÉË	Ü™\ÜÉË	İ[Y\ÚY]ÉË	ØXœÙ[˜Ù\ÉË	ÙY[ÛÛ›™Xİ	Ë	Ù›Û™IË	ÛY™[[™\ÉË	Ü›ÛÙœÉË	Ù˜Z[œÉË	Ù^[œÙ\ÉË	ÙXY[™\ÉË	Ü^[Y[ÉË	ÙØİ[Y[ÉË	İX[\ÉË	ÜİY™‰Ë	ÜÜ[\Ù\œÉË	ÛXYÉË	ÜšXÙS\İ	Ë	ØÙ\YšXØ]\ÉË	Ú[™[ÜIË	Ù\]Z\Y[	Ë	ØÛÛ\[TÙ][™ÜÉ×K™›Ü‘XXÚ

Ù^JOOÙ–ÚÙ^WOV×_JNÂˆ‹œİY™’[š]X[^™Y]YNÕÓÔ’ÑT”ÏY‹X[\ÎÔÕQ‘Y‹œİY™ÛØØ[İÜ˜YÙKœÙ]][JÑVK”ÓÓ‹œİš[™ÚYJŠJNÂˆKˆÛX\‘]šXÙQ]NŠ
OO›ØØ[İÜ˜YÙKœ™[[İ™R][JÑVJBŸNÂÜØÜš\‚ØÜš\Ü˜ÏH‹‹Û[™XK]š]Kİ™[™Ü‹ÚœÜ‹[Y›Z[‹šœÈÜØÜš\‚ØÜš\Ü˜ÏH‹‹Û[™XK]š]Kİ™[™Ü‹ÚœÜ‹œYÚ[‹˜]]İX›K›Z[‹šœÈÜØÜš\‚ØÜš\Ü˜ÏH‹‹ÜÛX\[Ü\˜][ÛœËšœÏİLMHÜØÜš\‚ØÜš\Ü˜ÏH‹‹Ù[™XKZ[YÜ˜][Û‹šœÏİLŒÈÜØÜš\‚ØÜš\Ü˜ÏH‹‹Ú[\™[[Û‹[Y™XŞXÛKšœÏİLÈÜØÜš\‚ØÜš\Ü˜ÏH‹‹ØÛÛ\][Û‹XÙ[\‹šœÏİLÈÜØÜš\‚ØÜš\Ü˜ÏH‹‹Ø[Ë\Ú\š[™ËšœÏİMKŒHÜØÜš\‚ØÜš\Ü˜ÏH‹‹ÙY[ÛÛ›™XİšœÏİLˆÜØÜš\‚ØÜš\Ü˜ÏH‹‹Úİ\œËXÛÜÙ[İ]šœÏİLÈÜØÜš\‚ØÜš\Ü˜ÏH‹‹Ø][™[˜ÙKXÙ[\‹šœÏİLHÜØÜš\‚ØÜš\Ü˜ÏH‹‹ØÛÛ›ÛY[X\›š[™ËšœÏİLHÜØÜš\‚ØÜš\Ü˜ÏH‹‹ÛÜ\˜][ÛœËXÙ[\‹šœÏİLHÜØÜš\‚ØÜš\Ü˜ÏH‹‹ÙY[Ø\KXZKšœÏİLMˆÜØÜš\‚ØÜš\Ü˜ÏH‹‹ÙY[Ø\KXZK\›İ]KšœÏİLHÜØÜš\‚ØÜš\\OH›[Ù[HˆÜ˜ÏH‹‹Ùš\™X˜\ÙKXÛİYšœÏİLÜØÜš\‚Ø›ÙO‚