"use strict";

const BACKUP_FORMAT_V1 = "edilkappa-backup-v1";
const BACKUP_FORMAT_V2 = "edilkappa-backup-v2";
const TYPE_KEY = "__edilkappaBackupType";
const MAX_BACKUP_RECORDS = 100000;

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function encodeBackupValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (value instanceof Date) return { [TYPE_KEY]: "date", value: value.toISOString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { [TYPE_KEY]: "bytes", value: Buffer.from(value).toString("base64") };
  }
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    if (date instanceof Date && Number.isFinite(date.getTime())) {
      const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
      return { [TYPE_KEY]: "timestamp", value: date.toISOString(), nanoseconds: Number.isFinite(nanos) ? nanos : 0 };
    }
  }
  if (!plainObject(value) && value.constructor?.name === "GeoPoint" && typeof value.latitude === "number" && typeof value.longitude === "number") {
    return { [TYPE_KEY]: "geopoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (typeof value.path === "string" && value.firestore) {
    return { [TYPE_KEY]: "reference", path: value.path };
  }
  if (Array.isArray(value)) return value.map(encodeBackupValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeBackupValue(item)]));
  }
  throw new TypeError(`Tipo non supportato nel backup: ${typeof value}`);
}

function legacyTimestamp(value, adapters) {
  if (!plainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "_nanoseconds,_seconds") return null;
  const seconds = Number(value._seconds);
  const nanoseconds = Number(value._nanoseconds);
  if (!Number.isInteger(seconds) || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1e9) return null;
  if (typeof adapters.timestampFromParts === "function") return adapters.timestampFromParts(seconds, nanoseconds);
  return new Date((seconds * 1000) + Math.floor(nanoseconds / 1e6));
}

function decodeBackupValue(value, adapters = {}) {
  if (value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map((item) => decodeBackupValue(item, adapters));
  if (!plainObject(value)) return value;
  const legacy = legacyTimestamp(value, adapters);
  if (legacy) return legacy;
  if (value.type === "Buffer" && Array.isArray(value.data)) return Buffer.from(value.data);
  const type = value[TYPE_KEY];
  if (type === "timestamp") {
    if (typeof adapters.timestamp === "function") return adapters.timestamp(value.value, value.nanoseconds || 0);
    return new Date(value.value);
  }
  if (type === "date") {
    const date = new Date(value.value);
    if (!Number.isFinite(date.getTime())) throw new Error("Data del backup non valida.");
    return date;
  }
  if (type === "bytes") return Buffer.from(String(value.value || ""), "base64");
  if (type === "geopoint") {
    if (typeof adapters.geoPoint === "function") return adapters.geoPoint(value.latitude, value.longitude);
    return { latitude: Number(value.latitude), longitude: Number(value.longitude) };
  }
  if (type === "reference") {
    if (typeof adapters.reference === "function") return adapters.reference(value.path);
    return String(value.path || "");
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeBackupValue(item, adapters)]));
}

function validDocumentId(value) {
  const id = String(value || "");
  return Boolean(id) && id.length <= 1500 && !id.includes("/") && id !== "." && id !== "..";
}

function inspectBackupPayload(payload, options = {}) {
  const allowedCollections = new Set(options.allowedCollections || []);
  const expectedOrgId = String(options.orgId || "");
  const issues = [];
  if (![BACKUP_FORMAT_V1, BACKUP_FORMAT_V2].includes(payload?.format)) issues.push("Formato backup non riconosciuto.");
  if (!expectedOrgId || payload?.orgId !== expectedOrgId) issues.push("Organizzazione del backup non valida.");
  if (!plainObject(payload?.collections)) issues.push("Raccolte del backup mancanti o non valide.");
  const collections = plainObject(payload?.collections) ? payload.collections : {};
  const counts = {};
  let recordCount = 0;
  for (const [collectionName, rows] of Object.entries(collections)) {
    if (allowedCollections.size && !allowedCollections.has(collectionName)) {
      issues.push(`Raccolta non autorizzata: ${collectionName}.`);
      continue;
    }
    if (!Array.isArray(rows)) {
      issues.push(`Raccolta ${collectionName} non valida.`);
      continue;
    }
    const ids = new Set();
    counts[collectionName] = rows.length;
    recordCount += rows.length;
    for (const row of rows) {
      if (!validDocumentId(row?.id)) issues.push(`Documento non valido in ${collectionName}.`);
      else if (ids.has(row.id)) issues.push(`Documento duplicato in ${collectionName}: ${row.id}.`);
      else ids.add(row.id);
      if (!plainObject(row?.data)) issues.push(`Dati non validi in ${collectionName}/${row?.id || "?"}.`);
    }
  }
  if (recordCount > MAX_BACKUP_RECORDS) issues.push(`Il backup supera ${MAX_BACKUP_RECORDS} record.`);
  if (Number(payload?.recordCount || 0) !== recordCount) issues.push("Conteggio record non coerente.");
  return {
    valid: issues.length === 0,
    issues,
    format: String(payload?.format || ""),
    generatedAt: String(payload?.generatedAt || ""),
    recordCount,
    counts
  };
}

function buildRestorePlan(payload, options = {}) {
  const inspection = inspectBackupPayload(payload, options);
  if (!inspection.valid) {
    const error = new Error(inspection.issues.join(" "));
    error.code = "invalid-backup";
    throw error;
  }
  const adapters = options.adapters || {};
  const allowedCollections = options.allowedCollections || Object.keys(payload.collections);
  const operations = [];
  const collections = [];
  for (const collectionName of allowedCollections) {
    const rows = payload.collections[collectionName] || [];
    if (!rows.length) continue;
    collections.push({ collection: collectionName, records: rows.length });
    for (const row of rows) {
      operations.push({
        collection: collectionName,
        id: String(row.id),
        data: decodeBackupValue(row.data, adapters)
      });
    }
  }
  return { inspection, collections, operations, recordCount: operations.length };
}

function buildRestorePreview(payload, currentCounts = {}, options = {}) {
  const plan = buildRestorePlan(payload, { ...options, adapters: {} });
  return {
    format: plan.inspection.format,
    generatedAt: plan.inspection.generatedAt,
    recordCount: plan.recordCount,
    collections: plan.collections.map((item) => ({
      ...item,
      currentRecords: Number(currentCounts[item.collection] || 0),
      difference: item.records - Number(currentCounts[item.collection] || 0)
    }))
  };
}

module.exports = {
  BACKUP_FORMAT_V1,
  BACKUP_FORMAT_V2,
  MAX_BACKUP_RECORDS,
  TYPE_KEY,
  buildRestorePlan,
  buildRestorePreview,
  decodeBackupValue,
  encodeBackupValue,
  inspectBackupPayload,
  validDocumentId
};
