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

export function stableRecordId(prefix: string, values: string[]): string {
  const digest = createHash('sha256').update(values.join('\u001f')).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('it');
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
}
