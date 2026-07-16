import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { doc, getFirestore, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

const FIREBASE_CONFIG = {
  projectId: 'edilkappa-professionale',
  appId: '1:583702130706:web:598e050830cef19ea2a8cb',
  storageBucket: 'edilkappa-professionale.firebasestorage.app',
  apiKey: 'AIzaSyAWP8Frwm6gIQnIfaEwe639F5cSOs8wdiE',
  authDomain: 'edilkappa-professionale.firebaseapp.com',
  messagingSenderId: '583702130706'
};

const app = initializeApp(FIREBASE_CONFIG);
const firestore = getFirestore(app, 'edilkappa');
const form = document.getElementById('requestForm');
const message = document.getElementById('requestMessage');
const openedAt = Date.now();

function setMessage(text, type) {
  message.textContent = text;
  message.className = `message ${type}`;
}

async function compressImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Allega soltanto fotografie.');
  if (file.size > 15 * 1024 * 1024) throw new Error(`La foto ${file.name} supera 15 MB.`);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  let dataUrl = '';
  for (let pass = 0; pass < 5; pass += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.76, 0.64, 0.52, 0.42]) {
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (Math.ceil(dataUrl.length * 0.75) <= 120000) break;
    }
    if (Math.ceil(dataUrl.length * 0.75) <= 120000) break;
    scale *= 0.7;
  }
  bitmap.close?.();
  if (!dataUrl || Math.ceil(dataUrl.length * 0.75) > 120000) throw new Error(`La foto ${file.name} non può essere ridotta abbastanza.`);
  return dataUrl;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const values = new FormData(form);
  if (values.get('website')) return;
  if (Date.now() - openedAt < 2500) return setMessage('Attendi un momento e riprova.', 'error');
  const files = values.getAll('photos').filter((file) => file?.size);
  if (files.length > 2) return setMessage('Puoi allegare al massimo due fotografie.', 'error');
  button.disabled = true; button.textContent = 'Invio in corso…'; setMessage('Sto preparando fotografie e richiesta.', '');
  try {
    const photos = await Promise.all(files.map(compressImage));
    const id = `lead-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
    const payload = {
      id,
      name: String(values.get('name')).trim(),
      phone: String(values.get('phone')).trim(),
      email: String(values.get('email')).trim(),
      contactPreference: String(values.get('contactPreference')).trim(),
      address: String(values.get('address')).trim(),
      request: String(values.get('request')).trim(),
      photos,
      status: 'Nuova',
      source: 'Modulo pubblico',
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(firestore, 'leads', id), {
      id,
      orgId: 'edilkappa',
      clientId: '',
      assignedTeamId: '',
      workerUid: '',
      ownerUid: 'public',
      status: 'Nuova',
      workHours: 0,
      materialAmount: 0,
      progress: 0,
      contractValue: 0,
      recordedCost: 0,
      payload: JSON.stringify(payload),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    form.reset();
    setMessage('Richiesta inviata. EDILKAPPA ti contatterà per fissare il sopralluogo.', 'success');
    button.textContent = 'Richiesta inviata ✓';
  } catch (error) {
    console.error(error);
    setMessage(error?.code === 'permission-denied' ? 'Il servizio richieste è in aggiornamento. Contattaci al 349 097 7711.' : (error.message || 'Invio non riuscito. Controlla la connessione e riprova.'), 'error');
    button.disabled = false; button.textContent = 'Invia richiesta a EDILKAPPA';
  }
});
