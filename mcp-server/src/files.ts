const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

export type OpenAIFileReference = {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
};

export type DownloadedFile = {
  buffer: Buffer;
  contentType: string;
  fileName: string;
};

export function safeFileName(value: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 140);
  return cleaned || 'documento';
}

export function hostAllowed(hostname: string, suffixes: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return suffixes.some((candidate) => {
    const suffix = candidate.toLowerCase().replace(/\.$/, '');
    if (!suffix) return false;
    if (suffix.startsWith('.')) return host === suffix.slice(1) || host.endsWith(suffix);
    return host === suffix;
  });
}

function mimeFromName(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  return ({
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif'
  } as Record<string, string>)[extension || ''] || '';
}

export function resolveMimeType(reference: OpenAIFileReference, responseContentType = ''): string {
  const genericTypes = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
  const responseType = responseContentType.split(';')[0]?.trim().toLowerCase() || '';
  if (!genericTypes.has(responseType)) {
    if (!ALLOWED_MIME_TYPES.has(responseType)) throw new Error('Il server del file ha restituito un formato non supportato.');
    return responseType;
  }
  const declaredType = reference.mime_type?.trim().toLowerCase() || '';
  if (!genericTypes.has(declaredType)) {
    if (!ALLOWED_MIME_TYPES.has(declaredType)) throw new Error('Il formato dichiarato non è supportato.');
    return declaredType;
  }
  const inferredType = mimeFromName(reference.file_name || '');
  if (!ALLOWED_MIME_TYPES.has(inferredType)) throw new Error('Il formato non è supportato. Usa PDF, Word, JPG, PNG, WEBP o HEIC.');
  return inferredType;
}

function defaultName(contentType: string): string {
  const extension = ({
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif'
  } as Record<string, string>)[contentType] || 'bin';
  return `documento.${extension}`;
}

function checkedUrl(value: string, suffixes: string[]): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Il collegamento temporaneo del file deve usare HTTPS.');
  if (url.username || url.password || url.port) throw new Error('Il collegamento temporaneo del file non è valido.');
  if (!hostAllowed(url.hostname, suffixes)) throw new Error('Il dominio del file temporaneo non è autorizzato.');
  return url;
}

async function responseBuffer(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_FILE_BYTES) throw new Error('Il file supera il limite di 25 MB.');
  if (!response.body) throw new Error('Il file temporaneo è vuoto.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_FILE_BYTES) {
      await reader.cancel();
      throw new Error('Il file supera il limite di 25 MB.');
    }
    chunks.push(value);
  }
  if (!total) throw new Error('Il file temporaneo è vuoto.');
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function downloadTemporaryFile(reference: OpenAIFileReference, suffixes: string[]): Promise<DownloadedFile> {
  let url = checkedUrl(reference.download_url, suffixes);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
      headers: { accept: 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*' }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirect === MAX_REDIRECTS) throw new Error('Troppi reindirizzamenti durante il download.');
      url = checkedUrl(new URL(location, url).toString(), suffixes);
      continue;
    }
    if (!response.ok) throw new Error(`Download del file non riuscito (${response.status}).`);
    const contentType = resolveMimeType(reference, response.headers.get('content-type') || '');
    const buffer = await responseBuffer(response);
    return {
      buffer,
      contentType,
      fileName: safeFileName(reference.file_name || defaultName(contentType))
    };
  }
  throw new Error('Download del file non riuscito.');
}

export const fileLimits = { maxBytes: MAX_FILE_BYTES } as const;
