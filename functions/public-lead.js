"use strict";

const { createHash, randomUUID } = require("node:crypto");

const CONTACT_PREFERENCES = new Set(["Telefono", "WhatsApp", "Email"]);
const MAX_PHOTO_BYTES = 120000;
const MAX_PHOTOS = 2;
const MIN_FORM_AGE_MS = 2500;
const MAX_FORM_AGE_MS = 2 * 60 * 60 * 1000;
const MIN_SUBMISSION_INTERVAL_MS = 20 * 1000;
const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
const DAILY_SUBMISSION_LIMIT = 20;
const RATE_RECORD_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

class PublicLeadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicLeadError";
    this.code = code;
  }
}

function text(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function requiredText(value, label, minLength, maxLength) {
  const output = text(value, maxLength);
  if (output.length < minLength) throw new PublicLeadError("invalid-argument", `${label}: controlla il dato inserito.`);
  return output;
}

function photoDataUrl(value) {
  const source = String(value || "");
  const match = source.match(/^data:image\/jpeg;base64,([a-zA-Z0-9+/]+={0,2})$/);
  if (!match) throw new PublicLeadError("invalid-argument", "Una fotografia non è in un formato valido.");
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) {
    throw new PublicLeadError("invalid-argument", "Una fotografia supera il limite consentito.");
  }
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

function validatePublicLeadInput(input, nowMs = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PublicLeadError("invalid-argument", "Richiesta non valida.");
  }
  if (text(input.website, 200)) throw new PublicLeadError("permission-denied", "Invio non accettato.");
  if (input.privacy !== true) throw new PublicLeadError("failed-precondition", "Conferma prima l’informativa sulla privacy.");

  const openedAtMs = Number(input.openedAtMs || 0);
  const formAgeMs = nowMs - openedAtMs;
  if (!Number.isFinite(openedAtMs) || formAgeMs < MIN_FORM_AGE_MS || formAgeMs > MAX_FORM_AGE_MS) {
    throw new PublicLeadError("failed-precondition", "Riapri il modulo e riprova.");
  }

  const requestId = text(input.requestId, 100).toLowerCase();
  if (!/^[a-z0-9-]{20,100}$/.test(requestId)) {
    throw new PublicLeadError("invalid-argument", "Identificativo della richiesta non valido.");
  }

  const name = requiredText(input.name, "Nome", 2, 100);
  const phone = requiredText(input.phone, "Telefono", 6, 30);
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 6 || phoneDigits.length > 20) {
    throw new PublicLeadError("invalid-argument", "Controlla il numero di telefono.");
  }
  const email = text(input.email, 150).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new PublicLeadError("invalid-argument", "Controlla l’indirizzo email.");
  }
  const contactPreference = text(input.contactPreference, 20);
  if (!CONTACT_PREFERENCES.has(contactPreference)) {
    throw new PublicLeadError("invalid-argument", "Modalità di contatto non valida.");
  }
  const address = requiredText(input.address, "Indirizzo", 5, 220);
  const request = requiredText(input.request, "Descrizione", 10, 2500);
  const rawPhotos = Array.isArray(input.photos) ? input.photos : [];
  if (rawPhotos.length > MAX_PHOTOS) {
    throw new PublicLeadError("invalid-argument", "Puoi allegare al massimo due fotografie.");
  }

  return {
    requestId,
    name,
    phone,
    email,
    contactPreference,
    address,
    request,
    photos: rawPhotos.map(photoDataUrl)
  };
}

function forwardedIp(rawRequest = {}) {
  const forwarded = String(rawRequest.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(rawRequest.ip || rawRequest.socket?.remoteAddress || "unknown").trim() || "unknown";
}

function dayStamp(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function publicLeadRateKey(rawRequest, nowMs = Date.now()) {
  const identity = `${dayStamp(nowMs)}|${forwardedIp(rawRequest)}`;
  return createHash("sha256").update(`edilkappa-public-lead|${identity}`).digest("hex");
}

function publicLeadFingerprint(lead) {
  const stable = JSON.stringify({
    name: lead.name.toLowerCase(),
    phone: lead.phone.replace(/\D/g, ""),
    email: lead.email,
    address: lead.address.toLowerCase(),
    request: lead.request.toLowerCase(),
    photos: lead.photos.map((photo) => createHash("sha256").update(photo).digest("hex"))
  });
  return createHash("sha256").update(stable).digest("hex");
}

function newPublicLeadId(nowMs = Date.now()) {
  return `lead-${nowMs.toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function publicLeadPayload(lead, id, nowMs = Date.now()) {
  const createdAt = new Date(nowMs).toISOString();
  return {
    id,
    requestId: lead.requestId,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    contactPreference: lead.contactPreference,
    address: lead.address,
    request: lead.request,
    photos: lead.photos,
    status: "Nuova",
    source: "Modulo pubblico protetto",
    createdAt
  };
}

function evaluateRateRecord(record = {}, fingerprint, nowMs = Date.now()) {
  const count = Number(record.count || 0);
  const lastAtMs = Number(record.lastAtMs || 0);
  if (record.lastFingerprint === fingerprint && record.lastLeadId && nowMs - lastAtMs <= DUPLICATE_WINDOW_MS) {
    return { duplicateLeadId: String(record.lastLeadId), count };
  }
  if (lastAtMs && nowMs - lastAtMs < MIN_SUBMISSION_INTERVAL_MS) {
    throw new PublicLeadError("resource-exhausted", "Attendi qualche secondo prima di inviare un’altra richiesta.");
  }
  if (count >= DAILY_SUBMISSION_LIMIT) {
    throw new PublicLeadError("resource-exhausted", "Limite giornaliero raggiunto. Contatta direttamente EDILKAPPA.");
  }
  return { duplicateLeadId: "", count };
}

function nextRateRecord({ current = {}, fingerprint, leadId, nowMs = Date.now() }) {
  return {
    count: Number(current.count || 0) + 1,
    firstAtMs: Number(current.firstAtMs || 0) || nowMs,
    lastAtMs: nowMs,
    lastFingerprint: fingerprint,
    lastLeadId: leadId,
    expiresAtMs: nowMs + RATE_RECORD_RETENTION_MS
  };
}

module.exports = {
  DAILY_SUBMISSION_LIMIT,
  DUPLICATE_WINDOW_MS,
  MAX_PHOTO_BYTES,
  MIN_SUBMISSION_INTERVAL_MS,
  PublicLeadError,
  evaluateRateRecord,
  newPublicLeadId,
  nextRateRecord,
  publicLeadFingerprint,
  publicLeadPayload,
  publicLeadRateKey,
  validatePublicLeadInput
};
