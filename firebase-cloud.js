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
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const mappings = [
  ['condomini', 'clients'],
  ['inspections', 'inspections'],
  ['sites', 'sites'],
  ['quotes', 'quotes'],
  ['reports', 'reports'],
  ['timesheets', 'timesheets'],
  ['drone', 'drone'],
  ['lifelines', 'lifelines'],
  ['roofs', 'roofs'],
  ['drains', 'drains'],
  ['expenses', 'expenses'],
  ['teams', 'teams'],
  ['deadlines', 'deadlines'],
  ['payments', 'payments'],
  ['documents', 'documents']
];

const mappingByRemote = new Map(mappings.map(([localName, remoteName]) => [remoteName, localName]));
const clientCollections = new Set(['clients', 'inspections', 'sites', 'quotes', 'reports', 'drone', 'lifelines', 'roofs', 'drains', 'deadlines', 'payments', 'documents']);
const workerCollections = new Set(['sites', 'reports', 'timesheets', 'roofs', 'drains', 'teams']);
const remoteMaps = new Map();
const remoteIds = new Map();
const loadedCollections = new Set();
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

const api = {
  scheduleSync,
  syncNow,
  restrictView(next) {
    return profile?.role === 'administrator' ? 'portalPreview' : next;
  },
  uploadAttachment,
  openAttachment,
  get currentUid() { return user?.uid || ''; },
  get currentProfile() { return profile; }
};
window.EdilKappaCloud = api;

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
  return error?.message || 'Operazione non riuscita.';
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
  remoteIds.clear();
  loadedCollections.clear();
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
  setSyncState('Collegamento…', '#d69b18');
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

function boundedNumber(value, minimum, maximum) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : minimum;
}

function envelope(item, remoteName, isNew) {
  const database = local.getDB();
  const site = remoteName === 'reports' ? (database.sites || []).find((entry) => entry.id === item.site) : null;
  const isWorkerItem = profile?.role === 'worker' && ['reports', 'timesheets'].includes(remoteName);
  const assignedTeamId = String(item.assignedTeamId || (['sites', 'roofs', 'drains'].includes(remoteName) ? item.worker : '') || site?.worker || (isWorkerItem ? profile.teamId : '') || '');
  const workerUid = String(item.workerUid || (isWorkerItem ? user.uid : '') || '');
  const ownerUid = String(item.ownerUid || user?.uid || '');
  const data = {
    id: String(item.id),
    orgId: ORG_ID,
    clientId: clientIdFor(item, remoteName),
    assignedTeamId,
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
  item.workerUid = data.workerUid;
  item.ownerUid = data.ownerUid;
  if (snapshot.ref.parent.id === 'reports' || snapshot.ref.parent.id === 'timesheets') item.hours = data.workHours;
  if (snapshot.ref.parent.id === 'reports') item.material = data.materialAmount;
  if ('progress' in item) item.progress = data.progress;
  if (snapshot.ref.parent.id === 'sites') {
    item.value = data.contractValue;
    item.cost = data.recordedCost;
    item.__cloudContractValue = data.contractValue;
    item.__cloudRecordedCost = data.recordedCost;
  }
  if (['sites', 'roofs', 'drains'].includes(snapshot.ref.parent.id)) item.worker = data.assignedTeamId;
  return item;
}

function mergeSnapshot(remoteName, snapshot) {
  const localName = mappingByRemote.get(remoteName);
  if (!localName) return;
  let map = remoteMaps.get(remoteName);
  if (!map) { map = new Map(); remoteMaps.set(remoteName, map); }
  snapshot.docChanges().forEach((change) => {
    if (change.type === 'removed') map.delete(change.doc.id);
    else map.set(change.doc.id, parseEnvelope(change.doc));
  });
  remoteIds.set(remoteName, new Set(map.keys()));
  loadedCollections.add(remoteName);
  local.getDB()[localName] = Array.from(map.values());
  if (localName === 'teams' && profile?.role === 'worker') local.setWorkerRole(profile, user.uid);
  local.persist();
  updateAdministratorPortal();
  local.render();
  setSyncState(snapshot.metadata.fromCache && !navigator.onLine ? 'Offline' : 'Sincronizzato', snapshot.metadata.fromCache && !navigator.onLine ? '#d69b18' : '#167448');
}

function listenTo(remoteName, constraints = []) {
  const target = query(collection(firestore, remoteName), ...constraints);
  unsubscribers.push(onSnapshot(target, (snapshot) => mergeSnapshot(remoteName, snapshot), (error) => {
    console.error(`Sincronizzazione ${remoteName}:`, error);
    setSyncState('Errore sync', '#ad2a2a', errorText(error));
  }));
}

function startDataListeners() {
  if (profile.role === 'owner' || profile.role === 'office') {
    mappings.forEach(([, remoteName]) => listenTo(remoteName, [where('orgId', '==', ORG_ID)]));
    return;
  }
  if (profile.role === 'worker') {
    ['sites', 'roofs', 'drains'].forEach((remoteName) => listenTo(remoteName, [where('orgId', '==', ORG_ID), where('assignedTeamId', '==', profile.teamId)]));
    ['reports', 'timesheets'].forEach((remoteName) => listenTo(remoteName, [where('orgId', '==', ORG_ID), where('workerUid', '==', user.uid), where('ownerUid', '==', user.uid)]));
    const teamRef = doc(firestore, 'teams', profile.teamId);
    unsubscribers.push(onSnapshot(teamRef, (snapshot) => {
      const database = local.getDB();
      database.teams = snapshot.exists() ? [parseEnvelope(snapshot)] : [];
      local.setWorkerRole(profile, user.uid); local.persist(); local.render();
    }));
    return;
  }
  const clientIds = Array.from(new Set(profile.clientIds || [])).slice(0, 10);
  if (!clientIds.length) return;
  const chunks = [];
  for (let index = 0; index < clientIds.length; index += 10) chunks.push(clientIds.slice(index, index + 10));
  clientCollections.forEach((remoteName) => chunks.forEach((ids) => listenTo(remoteName, [where('orgId', '==', ORG_ID), where('clientId', 'in', ids)])));
}

function canPush(remoteName) {
  if (profile?.role === 'owner' || profile?.role === 'office') return true;
  return profile?.role === 'worker' && workerCollections.has(remoteName) && remoteName !== 'teams';
}

function workerItems(remoteName, items) {
  if (profile?.role !== 'worker') return items;
  if (['sites', 'roofs', 'drains'].includes(remoteName)) return items.filter((item) => String(item.worker || item.assignedTeamId) === profile.teamId);
  return items.filter((item) => String(item.workerUid || user.uid) === user.uid);
}

async function pushCollection(localName, remoteName) {
  if (!canPush(remoteName)) return;
  const items = workerItems(remoteName, local.getDB()[localName] || []).filter((item) => item?.id);
  const known = remoteIds.get(remoteName) || new Set();
  await Promise.all(items.map((item) => setDoc(doc(firestore, remoteName, String(item.id)), envelope(item, remoteName, !known.has(String(item.id))), { merge: true })));
  if ((profile.role === 'owner' || profile.role === 'office') && loadedCollections.has(remoteName)) {
    const localIds = new Set(items.map((item) => String(item.id)));
    await Promise.all(Array.from(known).filter((id) => !localIds.has(id)).map((id) => deleteDoc(doc(firestore, remoteName, id))));
  }
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
  setSyncState(navigator.onLine ? 'Da sincronizzare' : 'Offline', '#d69b18');
  syncTimer = setTimeout(() => { syncNow().catch(() => {}); }, 900);
}

async function syncNow() {
  if (!ready || syncing || !navigator.onLine || !profile || profile.role === 'administrator') return syncPromise;
  syncing = true;
  syncPromise = (async () => {
    setSyncState('Sincronizzazione…', '#d69b18');
    await uploadPendingReportPhotos();
    for (const [localName, remoteName] of mappings) await pushCollection(localName, remoteName);
    setSyncState('Sincronizzato', '#167448');
  })().catch((error) => {
    setSyncState('Errore sync', '#ad2a2a', errorText(error));
    throw error;
  }).finally(() => { syncing = false; });
  return syncPromise;
}

async function importInitialDataIfNeeded() {
  const existing = await getDocs(query(collection(firestore, 'clients'), where('orgId', '==', ORG_ID)));
  if (!existing.empty) return;
  setSyncState('Primo caricamento…', '#d69b18');
  for (const [localName, remoteName] of mappings) {
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
      assignedTeamId: String(site.worker || site.assignedTeamId || (isWorker ? profile.teamId : '') || ''),
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
  const values = [['pending', 'In attesa'], ['office', 'Ufficio'], ['worker', 'Operaio'], ['administrator', 'Amministratore']];
  if (canAssignOwner || selected === 'owner') values.unshift(['owner', 'Titolare']);
  return values.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function cloudUsersPanel() {
  if (profile?.role !== 'owner') {
    return `<div class="headline"><div><h2>Portale amministratori</h2><p>La gestione degli accessi è riservata al titolare.</p></div></div><div class="notice">Accedi con l’account titolare per invitare utenti, assegnare squadre e autorizzare i condomìni visibili.</div>`;
  }
  const database = local.getDB();
  const teams = database.teams || [];
  const clients = database.condomini || [];
  const canAssignOwner = profile?.role === 'owner';
  return `<div class="headline"><div><h2>Portale e accessi</h2><p>Assegna a ogni persona soltanto il ruolo e i condomìni necessari.</p></div><button class="btn lime" onclick="cloudCopyAccessLink()">Copia link di accesso</button></div>
    <div class="notice"><b>Come invitare:</b> copia il link, invialo alla persona e chiedile di creare l’accesso. Comparirà qui “In attesa”; poi assegna il ruolo.</div><div style="height:14px"></div>
    <div class="grid stats"><div class="stat"><div class="statTop"><span>Utenti</span></div><strong>${cloudUsers.length}</strong></div><div class="stat"><div class="statTop"><span>Attivi</span></div><strong>${cloudUsers.filter((item) => item.active).length}</strong></div><div class="stat"><div class="statTop"><span>In attesa</span></div><strong>${cloudUsers.filter((item) => item.role === 'pending').length}</strong></div><div class="stat"><div class="statTop"><span>Condomìni</span></div><strong>${clients.length}</strong></div></div>
    <div class="cloudUserGrid">${cloudUsers.map((item) => {
      const selfOwner = item.email === OWNER_EMAIL && item.role === 'owner';
      const uid = escapeHtml(item.uid);
      return `<section class="cloudUserCard"><div class="row" style="border:0;padding:0"><div class="rowIcon">${item.role === 'worker' ? '👷' : item.role === 'administrator' ? '🏢' : '👤'}</div><div class="rowBody"><b>${escapeHtml(item.displayName || item.email)}</b><small>${escapeHtml(item.email)} · ${item.active ? 'Attivo' : 'Non attivo'}</small></div><span class="pill ${item.active ? '' : 'orange'}">${escapeHtml(item.role)}</span></div>${selfOwner ? '<div class="sectionNote">Account titolare principale protetto.</div>' : `<div class="cloudUserFields"><label>Ruolo<select id="cloud-role-${uid}">${roleOptions(item.role, canAssignOwner)}</select></label><label>Squadra<select id="cloud-team-${uid}"><option value="">Nessuna</option>${teams.map((team) => `<option value="${escapeHtml(team.id)}" ${item.teamId === team.id ? 'selected' : ''}>${escapeHtml(team.name)}</option>`).join('')}</select></label><div class="cloudClientChecks">${clients.map((client) => `<label><input type="checkbox" data-cloud-client="${uid}" value="${escapeHtml(client.id)}" ${(item.clientIds || []).includes(client.id) ? 'checked' : ''}> ${escapeHtml(client.name)}</label>`).join('') || '<small>Crea prima un cliente per assegnarlo.</small>'}</div><label style="display:flex;align-items:center;gap:8px"><input id="cloud-active-${uid}" type="checkbox" style="width:auto" ${item.active ? 'checked' : ''}> Accesso attivo</label><div class="actions"><button class="btn sm green" onclick="cloudSaveUser('${uid}')">Salva accesso</button></div></div>`}</section>`;
    }).join('') || '<div class="empty">Nessun utente registrato.</div>'}</div>`;
}

window.cloudCopyAccessLink = async function () {
  const link = 'https://klodian-bullari-ops.github.io/edilkappa-professionale/';
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
  if (selectedRole === 'administrator' && !clientIds.length) return alert('Seleziona almeno un condominio per l’amministratore.');
  try {
    await setDoc(doc(firestore, 'users', uid), { role: selectedRole, active, teamId: selectedRole === 'worker' ? teamId : '', clientIds: selectedRole === 'administrator' ? clientIds : [], updatedAt: serverTimestamp() }, { merge: true });
    alert('Accesso aggiornato.');
  } catch (error) { alert(errorText(error)); }
};

function startUsersListener() {
  unsubscribers.push(onSnapshot(query(collection(firestore, 'users'), where('orgId', '==', ORG_ID)), (snapshot) => {
    cloudUsers = snapshot.docs.map((entry) => ({ uid: entry.id, ...entry.data() })).sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'it'));
    if (local.getView() === 'portalView') local.render();
  }, (error) => setSyncState('Errore utenti', '#ad2a2a', errorText(error))));
}

window.portalView = cloudUsersPanel;

window.addEventListener('online', () => { setSyncState('Da sincronizzare', '#d69b18'); syncNow().catch(() => {}); });
window.addEventListener('offline', () => setSyncState('Offline', '#d69b18', 'Le modifiche restano sul dispositivo e saranno sincronizzate al ritorno della rete.'));

installCloudStyles();
loginGate('Controllo accesso…');
