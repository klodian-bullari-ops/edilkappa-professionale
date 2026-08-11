"use strict";

const { createHash, randomUUID } = require("node:crypto");
const convertHeic = require("heic-convert");

const HEIC_TYPES = new Set(["image/heic", "image/heif"]);
const BROWSER_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_HEIC_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 2500000;
const MAX_INLINE_PREVIEW_BYTES = 12 * 1024 * 1024;
const MAX_PDF_PREVIEW_BYTES = 50 * 1024 * 1024;
const PHOTO_PREVIEW_CHUNK_BYTES = 3 * 1024 * 1024;
const PREVIEW_QUALITIES = [0.82, 0.68, 0.54, 0.42];

function normalizedMimeType(value) {
  return String(value || "").trim().toLowerCase();
}

function isHeicMimeType(value) {
  return HEIC_TYPES.has(normalizedMimeType(value));
}

function isSupportedImageType(value) {
  const mimeType = normalizedMimeType(value);
  return HEIC_TYPES.has(mimeType) || BROWSER_IMAGE_TYPES.has(mimeType);
}

function previewStoragePath(storagePath) {
  const normalized = String(storagePath || "").replace(/^\/+|\/+$/g, "");
  const separator = normalized.lastIndexOf("/");
  if (separator < 1) throw new Error("Percorso della fotografia non valido.");
  const folder = normalized.slice(0, separator);
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `${folder}/edilkappa-preview-${digest}.jpg`;
}

function previewFileName(fileName) {
  const base = String(fileName || "foto")
    .replace(/\.(heic|heif)$/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120) || "foto";
  return `${base}.jpg`;
}

async function convertHeicBuffer(buffer, options = {}) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!input.length) throw new Error("La fotografia HEIC è vuota.");
  if (input.length > Number(options.maxSourceBytes || MAX_HEIC_SOURCE_BYTES)) {
    throw new Error("La fotografia HEIC supera 25 MB. Riducila oppure inviala separatamente.");
  }
  const converter = options.converter || convertHeic;
  const maxBytes = Number(options.maxBytes || MAX_PREVIEW_BYTES);
  let smallest = null;
  for (const quality of PREVIEW_QUALITIES) {
    const converted = Buffer.from(await converter({ buffer: input, format: "JPEG", quality }));
    if (!converted.length) continue;
    if (!smallest || converted.length < smallest.length) smallest = converted;
    if (converted.length <= maxBytes) return converted;
  }
  if (smallest?.length && smallest.length <= 6 * 1024 * 1024) return smallest;
  throw new Error("La fotografia HEIC convertita è ancora troppo grande. Riducila e riprova.");
}

function isMissingObjectError(error) {
  return Number(error?.code) === 404 || /not[ -]?found|no such object/i.test(String(error?.message || ""));
}

async function existingPreviewBuffer(storageBucket, storagePath) {
  const file = storageBucket.file(storagePath);
  try {
    const [metadata] = await file.getMetadata();
    const contentType = normalizedMimeType(metadata?.contentType);
    const size = Number(metadata?.size || 0);
    if (contentType !== "image/jpeg" || !size || size > 6 * 1024 * 1024) return null;
    const [buffer] = await file.download();
    return buffer?.length ? Buffer.from(buffer) : null;
  } catch (error) {
    if (isMissingObjectError(error)) return null;
    throw error;
  }
}

async function ensurePhotoPreview({ storageBucket, reference, uid, orgId = "edilkappa", converter }) {
  const storagePath = String(reference?.storagePath || "");
  const prefix = `organisations/${orgId}/documents/${uid}/`;
  const fileType = normalizedMimeType(reference?.fileType);
  if (!storagePath.startsWith(prefix) || reference?.kind !== "image" || !isSupportedImageType(fileType)) {
    throw new Error("Riferimento della fotografia non valido.");
  }

  if (!isHeicMimeType(fileType)) {
    return {
      reference: {
        ...reference,
        previewStoragePath: storagePath,
        previewFileName: String(reference.fileName || "foto"),
        previewFileType: fileType
      },
      buffer: null
    };
  }

  const targetPath = previewStoragePath(storagePath);
  let jpeg = await existingPreviewBuffer(storageBucket, targetPath);
  if (!jpeg) {
    const source = storageBucket.file(storagePath);
    const [metadata] = await source.getMetadata();
    const sourceType = normalizedMimeType(metadata?.contentType || fileType);
    const sourceSize = Number(metadata?.size || reference?.fileSize || 0);
    if (!isHeicMimeType(sourceType)) throw new Error("Il file archiviato non è una fotografia HEIC valida.");
    if (!sourceSize || sourceSize > MAX_HEIC_SOURCE_BYTES) {
      throw new Error("La fotografia HEIC supera 25 MB. Riducila oppure inviala separatamente.");
    }
    const [sourceBuffer] = await source.download();
    jpeg = await convertHeicBuffer(sourceBuffer, { converter });
    await storageBucket.file(targetPath).save(jpeg, {
      resumable: false,
      metadata: {
        contentType: "image/jpeg",
        cacheControl: "private,max-age=86400",
        metadata: {
          orgId,
          ownerUid: uid,
          sourceStoragePath: storagePath,
          firebaseStorageDownloadTokens: randomUUID()
        }
      }
    });
  }

  return {
    reference: {
      ...reference,
      previewStoragePath: targetPath,
      previewFileName: previewFileName(reference.fileName),
      previewFileType: "image/jpeg"
    },
    buffer: jpeg
  };
}

async function preparedPreviewSource({ storageBucket, prepared, maxBytes = MAX_PDF_PREVIEW_BYTES }) {
  const reference = prepared?.reference || {};
  const storagePath = String(reference.previewStoragePath || reference.storagePath || "");
  if (!storagePath) throw new Error("Percorso dell’anteprima fotografica mancante.");
  const file = storageBucket.file(storagePath);
  const preparedBuffer = prepared?.buffer?.length ? Buffer.from(prepared.buffer) : null;
  let metadata = {};
  if (!preparedBuffer) [metadata] = await file.getMetadata();
  const mimeType = normalizedMimeType(
    metadata?.contentType
      || reference.previewFileType
      || (preparedBuffer ? "image/jpeg" : reference.fileType)
  );
  const byteLength = Number(preparedBuffer?.length || metadata?.size || 0);
  if (!BROWSER_IMAGE_TYPES.has(mimeType)) throw new Error("Il formato dell’anteprima fotografica non è supportato.");
  if (!byteLength) throw new Error("L’anteprima fotografica è vuota.");
  if (byteLength > Number(maxBytes || MAX_PDF_PREVIEW_BYTES)) {
    throw new Error("La fotografia supera 50 MB. Riducila e riprova.");
  }
  return { storagePath, file, buffer: preparedBuffer, mimeType, byteLength };
}

async function describePreparedPhotoPreview({
  storageBucket,
  prepared,
  maxInlineBytes = MAX_INLINE_PREVIEW_BYTES,
  maxBytes = MAX_PDF_PREVIEW_BYTES,
  chunkBytes = PHOTO_PREVIEW_CHUNK_BYTES
}) {
  const source = await preparedPreviewSource({ storageBucket, prepared, maxBytes });
  let buffer = source.buffer;
  if (!buffer && source.byteLength <= Number(maxInlineBytes || 0)) {
    [buffer] = await source.file.download();
  }
  return {
    mimeType: source.mimeType,
    byteLength: source.byteLength,
    chunkBytes: Math.max(1, Math.min(Number(chunkBytes || PHOTO_PREVIEW_CHUNK_BYTES), PHOTO_PREVIEW_CHUNK_BYTES)),
    dataUrl: buffer?.length ? `data:${source.mimeType};base64,${Buffer.from(buffer).toString("base64")}` : ""
  };
}

async function readPreparedPhotoPreviewChunk({
  storageBucket,
  prepared,
  offset = 0,
  maxBytes = MAX_PDF_PREVIEW_BYTES,
  chunkBytes = PHOTO_PREVIEW_CHUNK_BYTES
}) {
  const source = await preparedPreviewSource({ storageBucket, prepared, maxBytes });
  const start = Number(offset);
  const size = Math.max(1, Math.min(Number(chunkBytes || PHOTO_PREVIEW_CHUNK_BYTES), PHOTO_PREVIEW_CHUNK_BYTES));
  if (!Number.isSafeInteger(start) || start < 0 || start >= source.byteLength) {
    throw new Error("Posizione del frammento fotografico non valida.");
  }
  const nextOffset = Math.min(source.byteLength, start + size);
  let buffer;
  if (source.buffer) buffer = source.buffer.subarray(start, nextOffset);
  else [buffer] = await source.file.download({ start, end: nextOffset - 1 });
  if (!buffer?.length || buffer.length !== nextOffset - start) {
    throw new Error("Il frammento fotografico ricevuto è incompleto.");
  }
  return {
    mimeType: source.mimeType,
    byteLength: source.byteLength,
    offset: start,
    nextOffset,
    done: nextOffset >= source.byteLength,
    chunkBase64: Buffer.from(buffer).toString("base64")
  };
}

async function prepareArchivedHeicPhotos({ storageBucket, mediaReferences, uid, orgId = "edilkappa", converter }) {
  const references = [];
  const attachments = [];
  for (const reference of Array.isArray(mediaReferences) ? mediaReferences : []) {
    if (reference?.kind !== "image") {
      references.push(reference);
      continue;
    }
    const prepared = await ensurePhotoPreview({ storageBucket, reference, uid, orgId, converter });
    references.push(prepared.reference);
    if (!isHeicMimeType(reference.fileType)) continue;
    const jpeg = prepared.buffer || (await storageBucket.file(prepared.reference.previewStoragePath).download())[0];
    attachments.push({
      name: prepared.reference.previewFileName,
      sourceName: String(reference.fileName || prepared.reference.previewFileName),
      capturedAtSeconds: 0,
      kind: "image",
      mimeType: "image/jpeg",
      dataUrl: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`,
      isImage: true
    });
  }
  return { mediaReferences: references, attachments };
}

module.exports = {
  BROWSER_IMAGE_TYPES,
  HEIC_TYPES,
  MAX_INLINE_PREVIEW_BYTES,
  MAX_PDF_PREVIEW_BYTES,
  MAX_HEIC_SOURCE_BYTES,
  MAX_PREVIEW_BYTES,
  PHOTO_PREVIEW_CHUNK_BYTES,
  convertHeicBuffer,
  describePreparedPhotoPreview,
  ensurePhotoPreview,
  isHeicMimeType,
  isSupportedImageType,
  prepareArchivedHeicPhotos,
  previewFileName,
  previewStoragePath,
  readPreparedPhotoPreviewChunk
};
