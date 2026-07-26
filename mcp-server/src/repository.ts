import { createHash } from 'node:crypto';
import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';
import type { AppConfig } from './config.js';
import type { DownloadedFile } from './files.js';

const ORG_ID = 'edilkappa';

type ClientRecord = {
  id: string;
  name: string;
  address: string;
};

type ClientResolution = ClientRecord & {
  warning?: string;
};

export type StoredRecord = {
  id: string;
  archive: 'Preventivi' | 'Documenti';
  title: string;
  client: string;
  storagePath: string;
  alreadyExisted: boolean;
  warning?: string;
};

export type QuoteInput = {
  file: DownloadedFile;
  sourceFileId: string;
  subject: string;
  clientName: string;
  clientId?: string;
  quoteNumber?: string;
  netAmount?: number;
  date: string;
  status: 'Bozza' | 'Inviato';
  authSubject: string;
};

export type ReportInput = {
  file: DownloadedFile;
  sourceFileId: string;
  title: string;
  clientName: string;
  clientId?: string;
  documentDate: string;
  notes?: string;
  expiry?: string;
  authSubject: string;
};

export type DaneaStatus = 'Nuovo' | 'Preso in carico' | 'In corso' | 'Posticipato' | 'Completato' | 'Inoltrato' | 'Rifiutato';

export type DaneaRequestInput = {
  sourceMessageId?: string;
  interventionId?: string;
  studio: string;
  title: string;
  clientName: string;
  clientId?: string;
  address?: string;
  description: string;
  priority: 'Normale' | 'Urgente' | 'Emergenza';
  daneaStatus: DaneaStatus;
  receivedAt: string;
  scheduledDate?: string;
  reference?: string;
  phone?: string;
  notes?: string;
  sourceUrl?: string;
  authSubject: string;
};

export type DaneaRequestRecord = {
  id: string;
  interventionId: string;
  studio: string;
  title: string;
  client: string;
  address: string;
  daneaStatus: DaneaStatus;
  status: string;
  receivedAt: string;
  scheduledDate: string;
  alreadyExisted: boolean;
  warning?: string;
};

export function stableRecordId(prefix: string, values: string[]): string {
  const digest = createHash('sha256').update(values.join('\u001f')).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('it');
}

function identityText(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

export function mapDaneaStatus(status: DaneaStatus): string {
  if (status === 'Preso in carico') return 'In attesa';
  if (status === 'In corso') return 'In corso';
  if (status === 'Posticipato') return 'Sospeso';
  if (status === 'Completato') return 'Completato';
  if (status === 'Inoltrato') return 'Assegnato';
  if (status === 'Rifiutato') return 'Rifiutato';
  return 'Nuova';
}

export function normalizeDaneaLink(value?: string): string {
  const raw = value?.trim() || '';
  if (!raw) return '';
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new Error('Il collegamento Danea non è valido.'); }
  const host = parsed.hostname.toLocaleLowerCase('it');
  const allowed = parsed.protocol === 'https:' && (
    host === 'miocondominio.eu'
    || host.endsWith('.miocondominio.eu')
    || host === 'danea.it'
    || host.endsWith('.danea.it')
  );
  if (!allowed) throw new Error('Il collegamento deve appartenere a Danea o MioCondominio.');
  return parsed.href;
}

export function sameDaneaRequest(
  payload: Record<string, unknown>,
  input: Pick<DaneaRequestInput, 'sourceMessageId' | 'interventionId' | 'studio' | 'title' | 'receivedAt'>,
  clientName: string
): boolean {
  if (payload.source !== 'Danea Interventi' && payload.source !== 'Danea') return false;

  const incomingMessageId = normalizeText(input.sourceMessageId || '');
  const storedMessageId = normalizeText(String(payload.sourceMessageId || ''));
  if (incomingMessageId && storedMessageId && incomingMessageId === storedMessageId) return true;

  const incomingInterventionId = normalizeText(input.interventionId || '');
  const storedInterventionId = normalizeText(String(payload.daneaId || payload.interventionId || ''));
  if (incomingInterventionId || storedInterventionId) {
    return Boolean(
      incomingInterventionId
      && storedInterventionId
      && incomingInterventionId === storedInterventionId
      && identityText(input.studio) === identityText(String(payload.studio || ''))
    );
  }

  return identityText(input.studio) === identityText(String(payload.studio || ''))
    && normalizeText(input.title) === normalizeText(String(payload.title || ''))
    && normalizeText(clientName) === normalizeText(String(payload.client || payload.name || ''))
    && input.receivedAt.slice(0, 10) === String(payload.receivedAt || '').slice(0, 10);
}

function parseClient(snapshot: QueryDocumentSnapshot): ClientRecord | null {
  const data = snapshot.data();
  if (data.orgId !== ORG_ID) return null;
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(typeof data.payload === 'string' ? data.payload : '{}') as Record<string, unknown>; }
  catch { return null; }
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) return null;
  return {
    id: snapshot.id,
    name,
    address: typeof payload.address === 'string' ? payload.address : ''
  };
}

function parseDaneaRequest(snapshot: QueryDocumentSnapshot): DaneaRequestRecord | null {
  const data = snapshot.data();
  if (data.orgId !== ORG_ID) return null;
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(typeof data.payload === 'string' ? data.payload : '{}') as Record<string, unknown>; }
  catch { return null; }
  if (payload.source !== 'Danea Interventi' && payload.source !== 'Danea') return null;
  const daneaStatus = String(payload.daneaStatus || 'Nuovo') as DaneaStatus;
  return {
    id: snapshot.id,
    interventionId: String(payload.daneaId || ''),
    studio: String(payload.studio || ''),
    title: String(payload.title || 'Richiesta di intervento'),
    client: String(payload.client || payload.name || ''),
    address: String(payload.address || ''),
    daneaStatus,
    status: String(payload.status || data.status || mapDaneaStatus(daneaStatus)),
    receivedAt: String(payload.receivedAt || ''),
    scheduledDate: String(payload.scheduledDate || ''),
    alreadyExisted: true
  };
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export class EdilKappaRepository {
  private readonly app: App;
  private readonly db: Firestore;
  private readonly storage: Storage;

  constructor(private readonly config: AppConfig) {
    const appName = 'edilkappa-mcp';
    this.app = getApps().find((candidate) => candidate.name === appName) || initializeApp({
      credential: applicationDefault(),
      projectId: config.firebaseProjectId,
      storageBucket: config.firebaseStorageBucket
    }, appName);
    this.db = getFirestore(this.app, 'edilkappa');
    this.storage = getStorage(this.app);
  }

  async searchClients(search: string): Promise<ClientRecord[]> {
    const snapshot = await this.db.collection('clients').where('orgId', '==', ORG_ID).limit(500).get();
    const query = normalizeText(search);
    return snapshot.docs
      .map(parseClient)
      .filter((client): client is ClientRecord => Boolean(client))
      .filter((client) => !query || normalizeText(`${client.name} ${client.address}`).includes(query))
      .sort((left, right) => left.name.localeCompare(right.name, 'it'))
      .slice(0, 20);
  }

  async searchDaneaRequests(search: string): Promise<DaneaRequestRecord[]> {
    const snapshot = await this.db.collection('leads').where('orgId', '==', ORG_ID).limit(500).get();
    const query = normalizeText(search);
    return snapshot.docs
      .map(parseDaneaRequest)
      .filter((item): item is DaneaRequestRecord => Boolean(item))
      .filter((item) => !query || normalizeText([
        item.interventionId,
        item.studio,
        item.title,
        item.client,
        item.address,
        item.daneaStatus,
        item.status
      ].join(' ')).includes(query))
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
      .slice(0, 50);
  }

  private async resolveClient(clientName: string, clientId?: string): Promise<ClientResolution> {
    if (clientId) {
      const snapshot = await this.db.collection('clients').doc(clientId).get();
      if (snapshot.exists) {
        const parsed = parseClient(snapshot as QueryDocumentSnapshot);
        if (parsed) return parsed;
      }
      throw new Error('Il cliente indicato non esiste più nel gestionale.');
    }
    const requestedName = clientName.trim();
    if (!requestedName) return { id: '', name: '', address: '' };
    const candidates = await this.searchClients(requestedName);
    const exact = candidates.filter((client) => normalizeText(client.name) === normalizeText(requestedName));
    if (exact.length === 1 && exact[0]) return exact[0];
    return {
      id: '',
      name: requestedName,
      address: '',
      warning: 'Cliente non collegato automaticamente: verifica il nome nel gestionale.'
    };
  }

  private async upload(path: string, file: DownloadedFile, authSubject: string, sourceFileId: string): Promise<void> {
    await this.storage.bucket(this.config.firebaseStorageBucket).file(path).save(file.buffer, {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: file.contentType,
        cacheControl: 'private, max-age=0, no-store',
        contentDisposition: `inline; filename="${file.fileName}"`,
        metadata: {
          orgId: ORG_ID,
          source: 'chatgpt',
          authSubject: authSubject.slice(0, 180),
          sourceFileId: sourceFileId.slice(0, 180)
        }
      }
    });
  }

  private envelope(id: string, clientId: string, ownerUid: string, status: string, payload: Record<string, unknown>) {
    return {
      id,
      orgId: ORG_ID,
      clientId,
      assignedTeamId: '',
      workerUid: '',
      ownerUid,
      status,
      workHours: 0,
      materialAmount: 0,
      progress: 0,
      contractValue: 0,
      recordedCost: 0,
      payload: JSON.stringify(compact(payload)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
  }

  private existingResult(snapshotData: FirebaseFirestore.DocumentData, fallback: StoredRecord): StoredRecord {
    try {
      const payload = JSON.parse(String(snapshotData.payload || '{}')) as Record<string, unknown>;
      return {
        ...fallback,
        title: String(payload.subject || payload.title || fallback.title),
        client: String(payload.client || fallback.client),
        storagePath: String(payload.storagePath || fallback.storagePath),
        alreadyExisted: true
      };
    } catch {
      return { ...fallback, alreadyExisted: true };
    }
  }

  async saveQuote(input: QuoteInput): Promise<StoredRecord> {
    const client = await this.resolveClient(input.clientName, input.clientId);
    const id = stableRecordId('chatgpt-prev', [input.sourceFileId, input.quoteNumber || '', input.subject, client.id || client.name]);
    const documentRef = this.db.collection('quotes').doc(id);
    const existing = await documentRef.get();
    const storagePath = `organisations/${ORG_ID}/documents/chatgpt/${id}/${input.file.fileName}`;
    const fallback: StoredRecord = { id, archive: 'Preventivi', title: input.subject, client: client.name, storagePath, alreadyExisted: false, warning: client.warning };
    if (existing.exists) return this.existingResult(existing.data() || {}, fallback);

    const quoteNumber = input.quoteNumber?.trim() || `PREV-${input.date.slice(0, 4)}-${id.slice(-6).toUpperCase()}`;
    const item = compact({
      id,
      code: quoteNumber,
      client: client.name,
      clientId: client.id,
      subject: input.subject,
      net: input.netAmount || 0,
      date: input.date,
      status: input.status,
      storagePath,
      fileName: input.file.fileName,
      fileType: input.file.contentType,
      fileSize: input.file.buffer.byteLength,
      uploadedAt: new Date().toISOString(),
      source: 'ChatGPT'
    });
    const ownerUid = stableRecordId('chatgpt', [input.authSubject]).slice(0, 128);
    await this.upload(storagePath, input.file, input.authSubject, input.sourceFileId);
    try {
      await documentRef.set(this.envelope(id, client.id, ownerUid, input.status, item));
    } catch (error) {
      await this.storage.bucket(this.config.firebaseStorageBucket).file(storagePath).delete().catch(() => {});
      throw error;
    }
    return fallback;
  }

  async saveReport(input: ReportInput): Promise<StoredRecord> {
    const client = await this.resolveClient(input.clientName, input.clientId);
    const id = stableRecordId('chatgpt-rel', [input.sourceFileId, input.title, client.id || client.name]);
    const documentRef = this.db.collection('documents').doc(id);
    const existing = await documentRef.get();
    const storagePath = `organisations/${ORG_ID}/documents/chatgpt/${id}/${input.file.fileName}`;
    const fallback: StoredRecord = { id, archive: 'Documenti', title: input.title, client: client.name, storagePath, alreadyExisted: false, warning: client.warning };
    if (existing.exists) return this.existingResult(existing.data() || {}, fallback);

    const item = compact({
      id,
      client: client.name,
      clientId: client.id,
      category: 'Relazione tecnica',
      title: input.title,
      documentDate: input.documentDate,
      expiry: input.expiry || '',
      notes: input.notes || '',
      storagePath,
      fileName: input.file.fileName,
      fileType: input.file.contentType,
      fileSize: input.file.buffer.byteLength,
      uploadedAt: new Date().toISOString(),
      source: 'ChatGPT'
    });
    const ownerUid = stableRecordId('chatgpt', [input.authSubject]).slice(0, 128);
    await this.upload(storagePath, input.file, input.authSubject, input.sourceFileId);
    try {
      await documentRef.set(this.envelope(id, client.id, ownerUid, '', item));
    } catch (error) {
      await this.storage.bucket(this.config.firebaseStorageBucket).file(storagePath).delete().catch(() => {});
      throw error;
    }
    return fallback;
  }

  async saveDaneaRequest(input: DaneaRequestInput): Promise<DaneaRequestRecord> {
    const client = await this.resolveClient(input.clientName, input.clientId);
    const identity = input.sourceMessageId?.trim()
      ? ['email', input.sourceMessageId.trim()]
      : input.interventionId?.trim()
        ? ['intervento', identityText(input.studio), identityText(input.interventionId)]
        : ['fallback', identityText(input.studio), normalizeText(input.title), normalizeText(client.id || client.name), input.receivedAt.slice(0, 10)];
    const generatedId = stableRecordId('danea', identity);
    const generatedRef = this.db.collection('leads').doc(generatedId);
    let existing = await generatedRef.get();
    let documentRef = generatedRef;

    if (!existing.exists) {
      const daneaSnapshot = await this.db.collection('leads').where('orgId', '==', ORG_ID).limit(500).get();
      const matchingDocument = daneaSnapshot.docs.find((snapshot) => {
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(String(snapshot.data().payload || '{}')) as Record<string, unknown>; }
        catch { return false; }
        return sameDaneaRequest(payload, input, client.name || input.clientName);
      });
      if (matchingDocument) {
        existing = matchingDocument;
        documentRef = matchingDocument.ref;
      }
    }

    const id = documentRef.id;
    const existingData = existing.data() || {};
    let existingPayload: Record<string, unknown> = {};
    try { existingPayload = JSON.parse(String(existingData.payload || '{}')) as Record<string, unknown>; }
    catch { existingPayload = {}; }

    const incomingStatus = mapDaneaStatus(input.daneaStatus);
    const currentStatus = String(existingPayload.status || existingData.status || '');
    const status = input.daneaStatus === 'Nuovo' && currentStatus && currentStatus !== 'Nuova'
      ? currentStatus
      : incomingStatus;
    const sourceUrl = normalizeDaneaLink(input.sourceUrl) || String(existingPayload.sourceUrl || '');
    const resolvedClientName = client.name || String(existingPayload.client || existingPayload.name || input.clientName);
    const resolvedClientId = client.id || String(existingData.clientId || existingPayload.clientId || '');
    const now = new Date().toISOString();
    const item = compact({
      ...existingPayload,
      id,
      source: 'Danea Interventi',
      daneaKey: id,
      sourceMessageId: input.sourceMessageId?.trim() || String(existingPayload.sourceMessageId || ''),
      daneaId: input.interventionId?.trim() || String(existingPayload.daneaId || ''),
      studio: input.studio,
      title: input.title,
      name: resolvedClientName,
      client: resolvedClientName,
      clientId: resolvedClientId,
      address: input.address || String(existingPayload.address || client.address || ''),
      request: input.description,
      priority: input.priority,
      daneaStatus: input.daneaStatus,
      status,
      receivedAt: input.receivedAt,
      scheduledDate: input.scheduledDate || String(existingPayload.scheduledDate || ''),
      reference: input.reference || String(existingPayload.reference || ''),
      phone: input.phone || String(existingPayload.phone || ''),
      notes: input.notes || String(existingPayload.notes || ''),
      sourceUrl,
      createdAt: String(existingPayload.createdAt || now),
      updatedAt: now
    });
    const ownerUid = String(existingData.ownerUid || stableRecordId('chatgpt', [input.authSubject]).slice(0, 128));
    const envelope = this.envelope(id, resolvedClientId, ownerUid, status, item) as Record<string, unknown>;
    if (existing.exists) {
      delete envelope.createdAt;
      envelope.assignedTeamId = String(existingData.assignedTeamId || '');
      envelope.workerUid = String(existingData.workerUid || '');
      envelope.ownerUid = ownerUid;
    }
    await documentRef.set(envelope, { merge: true });

    return {
      id,
      interventionId: String(item.daneaId || ''),
      studio: String(item.studio || ''),
      title: String(item.title || 'Richiesta di intervento'),
      client: resolvedClientName,
      address: String(item.address || ''),
      daneaStatus: input.daneaStatus,
      status,
      receivedAt: input.receivedAt,
      scheduledDate: String(item.scheduledDate || ''),
      alreadyExisted: existing.exists,
      warning: client.warning
    };
  }
}
