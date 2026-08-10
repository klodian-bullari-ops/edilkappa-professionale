"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getStorage } = require("firebase-admin/storage");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  AI_RESPONSE_SCHEMA,
  ALLOWED_VIDEO_TYPES,
  auditArtifact,
  buildInput,
  buildInstructions,
  chooseModel,
  cleanText,
  extractGeneratedImage,
  extractAnswer,
  isRevisionRequest,
  normalizeArtifact,
  parseAttachments,
  parseMediaReferences
} = require("./ai-core");
const {
  QUOTE_AGENT_NAME,
  runQuoteAgent
} = require("./quote-agent");
const {
  agentJobTimeout,
  canRetryAgentJob
} = require("./ai-job-state");
const { buildOperationsSnapshot } = require("./operations-core");
const {
  OPERATIONS_AGENT_NAME,
  runOperationsAgent
} = require("./operations-agent");
const {
  parseDaneaMessage,
  stableId
} = require("./danea-outlook");
const {
  convertHeicBuffer,
  ensurePhotoPreview,
  prepareArchivedHeicPhotos
} = require("./photo-utils");

const adminApp = initializeApp();
const firestore = getFirestore(adminApp, "edilkappa");
const messaging = getMessaging(adminApp);
const storageBucket = getStorage(adminApp).bucket("edilkappa-professionale.firebasestorage.app");
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const OWNER_EMAIL = "info@edilkappa.com";
const ORG_ID = "edilkappa";
const DAILY_REQUEST_LIMIT = 120;
const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;
const MAX_VISUALS_PER_ARTIFACT = 3;
const OPENAI_REQUEST_TIMEOUT_MS = 540000;
const OPENAI_BACKGROUND_TIMEOUT_MS = 45000;
const AI_JOB_TTL_MS = 24 * 60 * 60 * 1000;
const AGENT_RUN_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_AGENT_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_PREPARED_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const VISUAL_REFERENCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function sendPush({ uid = "", staff = false, title, body, type = "activity", targetType = "", targetId = "", url = "./" }) {
  let query = firestore.collection("pushDevices").where("orgId", "==", ORG_ID);
  if (uid) query = query.where("uid", "==", uid);
  const snapshot = await query.get();
  const devices = snapshot.docs.filter((docSnapshot) => {
    const data = docSnapshot.data();
    return data.token && (!staff || ["owner", "office"].includes(data.role));
  }).slice(0, 500);
  if (!devices.length) return;
  const eventId = `${type}-${targetId || Date.now()}`.slice(0, 120);
  const response = await messaging.sendEachForMulticast({
    tokens: devices.map((item) => item.data().token),
    data: { title: cleanText(title, 120), body: cleanText(body, 300), type, targetType, targetId: cleanText(targetId, 120), eventId, url }
  });
  const invalidCodes = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);
  await Promise.all(response.responses.map((result, index) => result.success || !invalidCodes.has(result.error?.code) ? null : devices[index].ref.delete()));
}

async function pushSafely(payload) {
  try { await sendPush(payload); }
  catch (error) { console.warn("Push EdilKappa non inviato", { message: cleanText(error?.message, 300) }); }
}

async function convertHeicAttachments(items) {
  return Promise.all((items || []).map(async (item) => {
    if (!/^image\/(heic|heif)$/i.test(item.mimeType)) return item;
    try {
      const encoded = String(item.dataUrl || "").split(",")[1] || "";
      const output = await convertHeicBuffer(Buffer.from(encoded, "base64"));
      return {
        ...item,
        name: String(item.name || "foto.heic").replace(/\.(heic|heif)$/i, ".jpg"),
        mimeType: "image/jpeg",
        dataUrl: `data:image/jpeg;base64,${output.toString("base64")}`,
        isImage: true
      };
    } catch (_) {
      throw new Error(`Non riesco a convertire la fotografia HEIC ${item.sourceName || item.name}.`);
    }
  }));
}

function preparedAttachmentBytes(item) {
  const encoded = String(item?.dataUrl || "").split(",")[1] || "";
  return Math.floor(encoded.length * 3 / 4);
}

function mergePreparedAttachments(inlineAttachments, archivedAttachments) {
  const output = [];
  const seen = new Set();
  for (const item of [...(archivedAttachments || []), ...(inlineAttachments || [])]) {
    const key = String(item?.sourceName || item?.name || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  const totalBytes = output.reduce((sum, item) => sum + preparedAttachmentBytes(item), 0);
  if (totalBytes > MAX_PREPARED_ATTACHMENT_BYTES) {
    throw new Error("Le fotografie e i documenti elaborati insieme superano 15 MB. Rimuovi un allegato e riprova.");
  }
  return output;
}

async function authorizedUser(request, mode) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Accedi a EdilKappa prima di usare l’AI.");
  if (request.auth.token.email_verified !== true) throw new HttpsError("permission-denied", "Verifica prima il tuo indirizzo email.");
  const email = String(request.auth.token.email || "").toLowerCase();
  const bootstrapOwner = email === OWNER_EMAIL;
  const snapshot = await firestore.collection("users").doc(request.auth.uid).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  const role = bootstrapOwner ? "owner" : profile?.role;
  const active = bootstrapOwner || (profile?.orgId === ORG_ID && profile?.active === true);
  if (!active || !["owner", "office"].includes(role)) {
    throw new HttpsError("permission-denied", "EdilKappa AI è disponibile soltanto al titolare e all’ufficio.");
  }
  if (mode === "personal" && role !== "owner") {
    throw new HttpsError("permission-denied", "La modalità Personale è riservata al titolare.");
  }
  return {
    uid: request.auth.uid,
    role,
    displayName: profile?.displayName || request.auth.token.name || email.split("@")[0] || "Klodian"
  };
}

function conversationId(value) {
  const id = cleanText(value, 80).replace(/[^a-zA-Z0-9_-]/g, "");
  return id || "legacy";
}

function conversationRef(uid, mode, id = "legacy") {
  const safeId = conversationId(id);
  if (safeId === "legacy") return firestore.collection("aiConversations").doc(`${uid}--${mode}`);
  return firestore.collection("aiConversationUsers").doc(uid).collection(mode).doc(safeId);
}

function conversationTitle(value, fallback = "Nuova conversazione") {
  return cleanText(value, 80) || fallback;
}

function aiJobRef(uid, jobId) {
  return firestore.collection("aiJobs").doc(`${uid}--${cleanText(jobId, 120)}`);
}

function aiAgentJobRef(uid, jobId) {
  return firestore.collection("aiAgentJobs").doc(`${uid}--${cleanText(jobId, 120)}`);
}

function agentInputStoragePath(uid, jobId) {
  const safeUid = cleanText(uid, 160).replace(/[^a-zA-Z0-9_-]/g, "");
  const safeJobId = cleanText(jobId, 120).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeUid || !safeJobId) throw new HttpsError("invalid-argument", "Identificativo del lavoro agente non valido.");
  return `organisations/${ORG_ID}/ai-agent-jobs/${safeUid}/${safeJobId}/input.json`;
}

async function saveAgentInput(uid, jobId, input) {
  const storagePath = agentInputStoragePath(uid, jobId);
  const payload = Buffer.from(JSON.stringify({ version: 1, input }), "utf8");
  if (!payload.length || payload.length > MAX_AGENT_INPUT_BYTES) {
    throw new HttpsError("invalid-argument", "Gli allegati preparati per l’agente superano il limite consentito.");
  }
  await storageBucket.file(storagePath).save(payload, {
    resumable: false,
    metadata: {
      contentType: "application/json",
      cacheControl: "private,no-store",
      metadata: { orgId: ORG_ID, ownerUid: uid, agentJobId: jobId }
    }
  });
  return { storagePath, bytes: payload.length };
}

async function loadAgentInput(uid, jobId, storagePath) {
  const expectedPath = agentInputStoragePath(uid, jobId);
  if (storagePath !== expectedPath) throw new Error("Percorso degli allegati agente non valido.");
  const [buffer] = await storageBucket.file(storagePath).download();
  if (!buffer.length || buffer.length > MAX_AGENT_INPUT_BYTES) throw new Error("Contenuto del lavoro agente non valido.");
  const parsed = JSON.parse(buffer.toString("utf8"));
  if (parsed?.version !== 1 || !Array.isArray(parsed.input)) throw new Error("Formato del lavoro agente non valido.");
  return parsed.input;
}

async function useDailyAllowance(uid) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
  const ref = firestore.collection("aiUsage").doc(`${uid}--${day}`);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const count = Number(snapshot.data()?.requests || 0);
    if (count >= DAILY_REQUEST_LIMIT) {
      throw new HttpsError("resource-exhausted", "Limite giornaliero di sicurezza raggiunto. Riprova domani o modifica il limite amministrativo.");
    }
    transaction.set(ref, {
      uid,
      orgId: ORG_ID,
      day,
      requests: count + 1,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function transcribeVideo(reference) {
  const result = { name: reference.fileName, text: "", note: "" };
  if (reference.kind !== "video") return result;
  if (reference.fileSize > MAX_TRANSCRIPTION_BYTES) {
    result.note = "Il video supera 25 MB: l'audio non è stato trascritto; l'analisi usa i fotogrammi estratti.";
    return result;
  }
  try {
    const file = storageBucket.file(reference.storagePath);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size || reference.fileSize || 0);
    const contentType = String(metadata.contentType || reference.fileType || "").toLowerCase();
    if (!ALLOWED_VIDEO_TYPES.has(contentType)) {
      result.note = "Formato video non compatibile con la trascrizione audio; l'analisi usa i fotogrammi estratti.";
      return result;
    }
    if (!size || size > MAX_TRANSCRIPTION_BYTES) {
      result.note = "Il video supera 25 MB: l'audio non è stato trascritto; l'analisi usa i fotogrammi estratti.";
      return result;
    }
    const [buffer] = await file.download();
    const form = new FormData();
    form.set("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
    form.set("language", "it");
    form.set("response_format", "json");
    form.set("file", new Blob([buffer], { type: contentType }), reference.fileName || "video.mp4");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY.value()}` },
      body: form,
      signal: AbortSignal.timeout(90000)
    });
    if (!response.ok) {
      console.warn("OpenAI transcription failed", {
        status: response.status,
        requestId: response.headers.get("x-request-id") || "sconosciuto"
      });
      result.note = "Non è stato possibile trascrivere l'audio; l'analisi usa i fotogrammi estratti.";
      return result;
    }
    const data = await response.json();
    result.text = cleanText(data?.text, 12000);
    if (!result.text) result.note = "Nel video non è stato rilevato parlato trascrivibile.";
    return result;
  } catch (error) {
    console.warn("Video transcription unavailable", { name: reference.fileName, message: error?.message });
    result.note = "Non è stato possibile trascrivere l'audio; l'analisi usa i fotogrammi estratti.";
    return result;
  }
}

async function transcribeVideos(mediaReferences) {
  const videos = mediaReferences.filter((item) => item.kind === "video").slice(0, 2);
  return Promise.all(videos.map(transcribeVideo));
}

async function storedImageReferences(media, uid, limit = 2) {
  const prefix = `organisations/${ORG_ID}/documents/${uid}/`;
  const output = [];
  for (const item of Array.isArray(media) ? media : []) {
    if (output.length >= limit) break;
    const originalPath = cleanText(item?.storagePath, 600);
    if (item?.generated || item?.kind !== "image" || !originalPath.startsWith(prefix)) continue;
    try {
      const prepared = await ensurePhotoPreview({ storageBucket, reference: item, uid, orgId: ORG_ID });
      const storagePath = cleanText(prepared.reference.previewStoragePath || originalPath, 600);
      const file = storageBucket.file(storagePath);
      const [metadata] = await file.getMetadata();
      const contentType = String(metadata.contentType || prepared.reference.previewFileType || item.fileType || "").toLowerCase();
      const size = Number(metadata.size || (storagePath === originalPath ? item.fileSize : 0) || 0);
      if (!VISUAL_REFERENCE_TYPES.has(contentType) || !size || size > 6 * 1024 * 1024) continue;
      const [buffer] = await file.download();
      output.push({
        name: cleanText(item.fileName || "riferimento", 140),
        sourceName: cleanText(item.fileName || "riferimento", 140),
        dataUrl: `data:${contentType};base64,${buffer.toString("base64")}`
      });
    } catch (error) {
      console.warn("Stored visual reference unavailable", { storagePath: originalPath, message: error?.message });
    }
  }
  return output;
}

function safetyIdentifier(uid) {
  return createHash("sha256").update(`${ORG_ID}:${uid}`).digest("hex");
}

async function openAiFailure(response, operation = "request") {
  const requestId = response.headers.get("x-request-id") || "sconosciuto";
  const payload = await response.clone().json().catch(() => ({}));
  const apiError = payload?.error || {};
  console.error(`OpenAI ${operation} failed`, {
    status: response.status,
    requestId,
    code: cleanText(apiError.code, 120),
    type: cleanText(apiError.type, 120),
    param: cleanText(apiError.param, 120),
    message: cleanText(apiError.message, 500)
  });
  if (response.status === 429) throw new HttpsError("resource-exhausted", "Il credito o il limite OpenAI è terminato. Controlla la fatturazione API.");
  if (response.status === 401 || response.status === 403) {
    const message = operation === "image generation"
      ? "Il progetto OpenAI non è ancora autorizzato a generare immagini. Potrebbe essere necessaria la verifica dell’organizzazione OpenAI."
      : "La chiave OpenAI del server non è valida oppure il progetto non è autorizzato a usare questo modello.";
    throw new HttpsError("failed-precondition", message);
  }
  if (response.status === 400 || response.status === 404) {
    throw new HttpsError("failed-precondition", "OpenAI ha rifiutato la configurazione della richiesta. La diagnostica è stata registrata per la correzione.");
  }
  throw new HttpsError("unavailable", "Il servizio AI non è disponibile in questo momento. Riprova tra poco.");
}

function openAiTransportFailure(error, operation = "request") {
  if (error instanceof HttpsError) return error;
  const name = cleanText(error?.name, 120);
  const code = cleanText(error?.code, 120);
  const message = cleanText(error?.message, 500);
  console.error(`OpenAI ${operation} transport failed`, { name, code, message });
  if (["AbortError", "TimeoutError"].includes(name) || /timed?\s*out|timeout/i.test(message)) {
    return new HttpsError("deadline-exceeded", "L’elaborazione AI sta impiegando più tempo del previsto. Riprova: la richiesta può richiedere alcuni minuti.");
  }
  return new HttpsError("unavailable", "Non riesco a raggiungere OpenAI in questo momento. Riprova tra poco.");
}

async function callOpenAI({ instructions, input, useWeb, modelChoice, safetyId }) {
  const body = {
    model: modelChoice.model,
    instructions,
    input,
    reasoning: { effort: modelChoice.reasoningEffort },
    text: {
      verbosity: modelChoice.verbosity,
      format: {
        type: "json_schema",
        name: "edilkappa_ai_response",
        strict: true,
        schema: AI_RESPONSE_SCHEMA
      }
    },
    max_output_tokens: modelChoice.maxOutputTokens || 12000,
    store: false,
    safety_identifier: safetyId
  };
  if (useWeb) {
    body.tools = [{
      type: "web_search",
      user_location: { type: "approximate", country: "IT", city: "Milano", region: "Lombardia" }
    }];
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY.value()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS)
      });
      if (response.ok) return await response.json();
      if (response.status >= 500 && attempt < 3) {
        console.warn("OpenAI temporary server error; retrying", { status: response.status, attempt });
        await response.arrayBuffer().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
        continue;
      }
      await openAiFailure(response);
    } catch (error) {
      const failure = openAiTransportFailure(error);
      if (String(failure.code || "").includes("unavailable") && attempt < 3) {
        console.warn("OpenAI temporary transport error; retrying", { attempt });
        await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
        continue;
      }
      throw failure;
    }
  }
  throw new HttpsError("unavailable", "Il servizio AI non è disponibile dopo tre tentativi automatici.");
}

function backgroundHeaders() {
  return {
    "Authorization": `Bearer ${OPENAI_API_KEY.value()}`,
    "Content-Type": "application/json"
  };
}

async function createBackgroundResponse(body, operation = "background request") {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: backgroundHeaders(),
      body: JSON.stringify({ ...body, background: true, store: true }),
      signal: AbortSignal.timeout(OPENAI_BACKGROUND_TIMEOUT_MS)
    });
    if (!response.ok) await openAiFailure(response, operation);
    return await response.json();
  } catch (error) {
    throw openAiTransportFailure(error, operation);
  }
}

async function retrieveBackgroundResponse(responseId) {
  try {
    const response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
      headers: backgroundHeaders(),
      signal: AbortSignal.timeout(OPENAI_BACKGROUND_TIMEOUT_MS)
    });
    if (!response.ok) await openAiFailure(response, "background status");
    return await response.json();
  } catch (error) {
    throw openAiTransportFailure(error, "background status");
  }
}

function finalResponseBody({ instructions, previousResponseId, modelChoice, useWeb, safetyId }) {
  const body = {
    model: modelChoice.model,
    previous_response_id: previousResponseId,
    instructions,
    input: [{
      role: "user",
      content: [{
        type: "input_text",
        text: "Ora usa l’analisi preliminare e tutto il materiale precedente per comporre il risultato definitivo. Esegui il controllo tecnico, economico e aritmetico finale e restituisci esclusivamente il formato strutturato richiesto."
      }]
    }],
    reasoning: { effort: modelChoice.reasoningEffort },
    text: {
      verbosity: modelChoice.verbosity,
      format: { type: "json_schema", name: "edilkappa_ai_response", strict: true, schema: AI_RESPONSE_SCHEMA }
    },
    max_output_tokens: modelChoice.maxOutputTokens || 12000,
    safety_identifier: safetyId
  };
  if (useWeb) body.tools = [{ type: "web_search", user_location: { type: "approximate", country: "IT", city: "Milano", region: "Lombardia" } }];
  return body;
}

function repairResponseBody({ instructions, previousResponseId, modelChoice, qualityAudit, safetyId }) {
  return {
    model: modelChoice.model,
    previous_response_id: previousResponseId,
    instructions,
    input: [{
      role: "user",
      content: [{
        type: "input_text",
        text: [
          "CONTROLLO QUALITÀ EDILKAPPA. Correggi il documento appena composto senza cambiare i dati certi e senza inventare informazioni.",
          "Risolvi tutte le anomalie elencate, ricontrolla somme, IVA, costi, margine, dati del cliente, ipotesi, inclusioni ed esclusioni.",
          `ANOMALIE DA CORREGGERE:\n- ${(qualityAudit.issues || []).join("\n- ")}`,
          "Restituisci nuovamente ed esclusivamente il formato strutturato completo richiesto."
        ].join("\n\n")
      }]
    }],
    reasoning: { effort: modelChoice.reasoningEffort },
    text: {
      verbosity: modelChoice.verbosity,
      format: { type: "json_schema", name: "edilkappa_ai_response", strict: true, schema: AI_RESPONSE_SCHEMA }
    },
    max_output_tokens: modelChoice.maxOutputTokens || 12000,
    safety_identifier: safetyId
  };
}

function preliminaryResponseBody({ instructions, input, safetyId }) {
  return {
    model: process.env.OPENAI_TERRA_MODEL || "gpt-5.6-terra",
    instructions: `${instructions}\n\nFASE 1 — ANALISI PRELIMINARE. Non preparare ancora il documento finale. Produci una sintesi operativa concisa con: evidenze, dati certi, incertezze, soluzione raccomandata, alternativa, voci di costo necessarie e controlli da eseguire.`,
    input,
    reasoning: { effort: "medium" },
    text: { verbosity: "medium" },
    max_output_tokens: 3500,
    safety_identifier: safetyId
  };
}

function terraFallbackChoice(modelChoice) {
  return {
    ...modelChoice,
    model: process.env.OPENAI_TERRA_MODEL || "gpt-5.6-terra",
    modelLabel: "GPT‑5.6 Terra · recupero automatico",
    reasoningEffort: "medium",
    verbosity: "high"
  };
}

function visualPrompt(artifact, brief) {
  const kindInstructions = {
    photomontage: "Crea un fotomontaggio realistico dell'intervento proposto, rispettando geometrie, proporzioni e condizioni visibili nelle fotografie di riferimento.",
    materials_board: "Crea una tavola materiali ordinata e realistica con i principali componenti, finiture e collegamenti descritti.",
    technical_diagram: "Crea uno schema tecnico illustrativo chiaro e leggibile, non esecutivo e non quotato se le misure non sono state fornite."
  };
  return [
    kindInstructions[brief.kind] || kindInstructions.photomontage,
    `Titolo: ${brief.title}.`,
    `Indicazioni: ${brief.prompt}`,
    artifact.address ? `Contesto del luogo: ${artifact.address}.` : "",
    artifact.summary ? `Soluzione concordata: ${artifact.summary}.` : "",
    artifact.materials?.length ? `Materiali: ${artifact.materials.join("; ")}.` : "",
    "L'immagine serve a spiegare la proposta al cliente: deve essere professionale, plausibile e senza loghi inventati, prezzi, firme o dichiarazioni di conformità.",
    "Non presentarla come progetto strutturale, rilievo metrico o elaborato esecutivo. Se una misura non è nota, non scriverla nell'immagine."
  ].filter(Boolean).join("\n");
}

async function generateVisual({ artifact, brief, referenceImages, safetyId }) {
  const content = [{ type: "input_text", text: visualPrompt(artifact, brief) }];
  referenceImages.slice(0, 2).forEach((item) => {
    content.push({ type: "input_text", text: `Fotografia di riferimento: ${item.sourceName || item.name}.` });
    content.push({ type: "input_image", image_url: item.dataUrl, detail: "auto" });
  });
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY.value()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TERRA_MODEL || "gpt-5.6-terra",
        input: [{ role: "user", content }],
        tools: [{ type: "image_generation" }],
        store: false,
        safety_identifier: safetyId
      }),
      signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) await openAiFailure(response, "image generation");
    const data = await response.json();
    const image = extractGeneratedImage(data);
    if (!image) throw new HttpsError("unavailable", "L’AI non ha prodotto l’immagine. Riprova oppure scegli un’altra visualizzazione.");
    return image;
  } catch (error) {
    throw openAiTransportFailure(error, "image generation");
  }
}

async function saveGeneratedVisual(uid, artifact, brief, briefIndex, image) {
  const baseName = cleanText(brief.title || "visualizzazione", 80)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "visualizzazione";
  const fileName = `${baseName}-${randomUUID().slice(0, 8)}.png`;
  const storagePath = `organisations/${ORG_ID}/documents/${uid}/ai-generated/${fileName}`;
  const downloadToken = randomUUID();
  await storageBucket.file(storagePath).save(image, {
    resumable: false,
    metadata: {
      contentType: "image/png",
      cacheControl: "private,max-age=3600",
      metadata: {
        orgId: ORG_ID,
        ownerUid: uid,
        aiArtifactId: cleanText(artifact.id, 200),
        illustrative: "true",
        firebaseStorageDownloadTokens: downloadToken
      }
    }
  });
  return {
    storagePath,
    fileName,
    fileType: "image/png",
    fileSize: image.length,
    uploadedAt: new Date().toISOString(),
    kind: "image",
    generated: true,
    illustrative: true,
    briefIndex,
    briefKind: brief.kind,
    title: brief.title,
    disclaimer: "Visualizzazione illustrativa generata con AI: non è un progetto esecutivo né una verifica strutturale."
  };
}

function agentFailureMessage(error) {
  const name = cleanText(error?.name, 120);
  const message = cleanText(error?.message, 500);
  if (["AbortError", "TimeoutError"].includes(name) || /timed?\s*out|timeout/i.test(message)) {
    return "L’agente preventivi ha superato il tempo massimo. La richiesta può essere riprovata senza perdere la chat.";
  }
  if (/429|quota|credit|billing|resource[_ -]?exhausted/i.test(message)) {
    return "Il credito o il limite OpenAI è terminato. Controlla la fatturazione API.";
  }
  if (/401|403|api.?key|authentication|permission/i.test(message)) {
    return "La chiave OpenAI del server non è valida oppure il progetto non è autorizzato a usare il modello scelto.";
  }
  return "L’agente preventivi non ha completato la bozza. Puoi riprovare dalla stessa chat.";
}

function retryInputAvailable(job) {
  return Boolean(cleanText(job?.inputStoragePath, 600) && Number(job?.inputBytes || 0) > 0);
}

async function expireStaleAgentJob(jobReference) {
  let outcome = { expired: false, job: null };
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobReference);
    const job = snapshot.exists ? (snapshot.data() || {}) : null;
    const timeout = agentJobTimeout(job);
    if (!job || !timeout) {
      outcome = { expired: false, job };
      return;
    }
    const failure = {
      status: "failed",
      stage: timeout.stage,
      error: timeout.error,
      timedOutAtMs: Date.now(),
      timedOutAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    transaction.set(jobReference, failure, { merge: true });
    outcome = { expired: true, job: { ...job, ...failure }, error: timeout.error };
  });
  return outcome;
}

function envelopePayload(snapshot) {
  try { return JSON.parse(snapshot?.data()?.payload || "{}"); }
  catch (_) { return {}; }
}

async function loadOperationsData() {
  const names = ["leads", "sites", "quotes", "reports", "timesheets", "absences", "payments", "deadlines"];
  const snapshots = await Promise.all(names.map((name) => firestore.collection(name).where("orgId", "==", ORG_ID).limit(500).get()));
  const data = Object.fromEntries(names.map((name, index) => [name, snapshots[index].docs.map((item) => ({ id: item.id, ...envelopePayload(item) }))]));
  const usersSnapshot = await firestore.collection("users").where("orgId", "==", ORG_ID).limit(200).get();
  data.users = usersSnapshot.docs.map((item) => ({ uid: item.id, ...item.data() }));
  return data;
}

function romeDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function generateOperationsBriefing({ trigger = "manual", requestedBy = "" } = {}) {
  const data = await loadOperationsData();
  const snapshot = buildOperationsSnapshot(data, { today: romeDay() });
  const result = await runOperationsAgent({
    apiKey: OPENAI_API_KEY.value(),
    snapshot,
    model: process.env.EDILKAPPA_OPERATIONS_MODEL || "gpt-5.6-terra",
    groupId: `${snapshot.generatedFor}-${trigger}`,
    signal: AbortSignal.timeout(AGENT_RUN_TIMEOUT_MS)
  });
  const stored = {
    orgId: ORG_ID,
    trigger,
    requestedBy: cleanText(requestedBy, 160),
    agentName: OPERATIONS_AGENT_NAME,
    snapshot,
    briefing: result.briefing,
    responseId: result.responseId,
    generatedAtMs: Date.now(),
    generatedAt: FieldValue.serverTimestamp()
  };
  await firestore.collection("operationsBriefings").doc("latest").set(stored);
  return stored;
}

exports.edilkappaOperations = onCall({
  region: "europe-west8",
  invoker: "public",
  secrets: [OPENAI_API_KEY],
  timeoutSeconds: 540,
  memory: "1GiB",
  maxInstances: 1,
  cors: true
}, async (request) => {
  const account = await authorizedUser(request, "work");
  const action = String(request.data?.action || "latest");
  if (action === "latest") {
    const snapshot = await firestore.collection("operationsBriefings").doc("latest").get();
    if (!snapshot.exists) return { available: false, agentName: OPERATIONS_AGENT_NAME };
    const data = snapshot.data() || {};
    return { available: true, agentName: OPERATIONS_AGENT_NAME, generatedAtMs: Number(data.generatedAtMs || 0), trigger: data.trigger || "", snapshot: data.snapshot || null, briefing: data.briefing || null };
  }
  if (action !== "refresh") throw new HttpsError("invalid-argument", "Operazione del coordinatore non valida.");
  if (account.role !== "owner") throw new HttpsError("permission-denied", "Solo il titolare può avviare il coordinamento completo.");
  await useDailyAllowance(account.uid);
  try {
    const result = await generateOperationsBriefing({ trigger: "manual", requestedBy: account.uid });
    return { available: true, agentName: OPERATIONS_AGENT_NAME, generatedAtMs: result.generatedAtMs, trigger: result.trigger, snapshot: result.snapshot, briefing: result.briefing };
  } catch (error) {
    throw openAiTransportFailure(error, "operations agent");
  }
});

exports.generateMorningOperationsBriefing = onSchedule({
  schedule: "0 7 * * 1-6",
  timeZone: "Europe/Rome",
  region: "europe-west8",
  secrets: [OPENAI_API_KEY],
  timeoutSeconds: 540,
  memory: "1GiB",
  retryCount: 0
}, async () => {
  try {
    const result = await generateOperationsBriefing({ trigger: "schedule" });
    const staffSnapshot = await firestore.collection("users").where("orgId", "==", ORG_ID).limit(200).get();
    const owner = staffSnapshot.docs.find((document) => {
      const data = document.data() || {};
      return data.role === "owner" && data.active === true;
    });
    const urgent = Number(result.snapshot?.metrics?.urgent || 0);
    await pushSafely({ uid: owner?.id || "", staff: !owner, title: urgent ? `EdilKappa: ${urgent} priorità urgenti` : "EdilKappa: riepilogo operativo pronto", body: cleanText(result.briefing?.headline || result.briefing?.summary || "Apri il Centro operativo.", 260), type: "operations", targetType: "operations", targetId: result.snapshot?.generatedFor || romeDay(), url: "./?view=operationsCenter" });
  } catch (error) {
    console.error("Morning operations briefing failed", { name: cleanText(error?.name, 120), message: cleanText(error?.message, 500) });
  }
});

const DANEA_BRIDGE_REF = () => firestore.collection("integrations").doc("daneaGmailBridge");

async function ownerUid() {
  const snapshot = await firestore.collection("users").where("orgId", "==", ORG_ID).limit(200).get();
  return snapshot.docs.find((item) => item.data()?.role === "owner" && item.data()?.active === true)?.id || "";
}

function payloadOf(data) {
  try { return JSON.parse(String(data?.payload || "{}")); }
  catch (_) { return {}; }
}

function serverEnvelope({ id, clientId = "", ownerUid: uid = "", status = "", payload, existing = null, assignedTeamId = "", assignedTeamIds = [], workerUid = "", workHours = 0, materialAmount = 0, progress = 0, contractValue = 0, recordedCost = 0 }) {
  return {
    id, orgId: ORG_ID, clientId, assignedTeamId, assignedTeamIds, workerUid, ownerUid: uid, status,
    workHours, materialAmount, progress, contractValue, recordedCost,
    payload: JSON.stringify(payload),
    createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
}

async function saveDaneaMailRequest(item, uid) {
  const leads = await firestore.collection("leads").where("orgId", "==", ORG_ID).limit(500).get();
  const sameIdentity = leads.docs.find((document) => {
    const payload = payloadOf(document.data());
    if (!/danea/i.test(String(payload.source || ""))) return false;
    if (item.sourceMessageId && String(payload.sourceMessageId || "").toLowerCase() === item.sourceMessageId.toLowerCase()) return true;
    return Boolean(item.daneaId && item.studio && String(payload.daneaId || "").toLowerCase() === item.daneaId.toLowerCase() && String(payload.studio || "").toLowerCase() === item.studio.toLowerCase());
  });
  const id = sameIdentity?.id || stableId("danea-mail", [item.sourceMessageId || item.graphMessageId, item.studio, item.daneaId]);
  const existingData = sameIdentity?.data() || {};
  const existing = payloadOf(existingData);
  const now = new Date().toISOString();
  const clientName = cleanText(item.client || existing.client || "Cliente da definire", 220);
  const clientAddress = cleanText(item.address || existing.address, 300);
  const clients = await firestore.collection("clients").where("orgId", "==", ORG_ID).limit(500).get();
  const matchingClient = clients.docs.find((document) => {
    const payload = payloadOf(document.data());
    const sameName = String(payload.name || "").trim().toLowerCase() === clientName.toLowerCase();
    const sameAddress = clientAddress && String(payload.address || "").trim().toLowerCase() === clientAddress.toLowerCase();
    return sameName || sameAddress;
  });
  const clientId = String(existing.clientId || matchingClient?.id || stableId("c-danea", [clientName, clientAddress]));
  const lead = {
    ...existing,
    ...item,
    id,
    client: clientName,
    name: clientName,
    clientId,
    status: existing.status && existing.status !== "Nuova" ? existing.status : "Nuova",
    daneaStatus: existing.daneaStatus && existing.daneaStatus !== "Nuovo" ? existing.daneaStatus : "Nuovo",
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
  await firestore.collection("leads").doc(id).set(serverEnvelope({ id, clientId, ownerUid: String(existingData.ownerUid || uid), status: lead.status, payload: lead, existing: sameIdentity?.exists ? existingData : null }), { merge: true });

  const clientRef = firestore.collection("clients").doc(clientId);
  const clientSnapshot = await clientRef.get();
  if (!clientSnapshot.exists) {
    const client = { id: clientId, name: clientName, address: clientAddress, manager: item.studio || "", phone: item.phone || "", email: "", source: "Danea Interventi", createdAt: now };
    await clientRef.set(serverEnvelope({ id: clientId, clientId, ownerUid: uid, status: "Attivo", payload: client }));
  }

  const siteId = stableId("site-danea", [id]);
  const siteRef = firestore.collection("sites").doc(siteId);
  const siteSnapshot = await siteRef.get();
  if (!siteSnapshot.exists) {
    const site = { id: siteId, code: item.daneaId ? `DANEA-${item.daneaId}` : `DANEA-${id.slice(-8).toUpperCase()}`, title: `${item.daneaId ? `Danea ${item.daneaId}` : "Danea"} · ${item.title}`, client: clientName, clientId, address: clientAddress, worker: "", teamIds: [], assignedTeamIds: [], start: String(item.receivedAt || now).slice(0, 10), value: 0, cost: 0, status: "Pianificato", progress: 0, source: "Danea Interventi", daneaManaged: true, daneaRequestId: id, daneaId: item.daneaId || "", daneaStudio: item.studio || "", daneaLink: item.sourceUrl || "", description: item.request || "", priority: item.priority || "Normale", createdAt: now, updatedAt: now };
    await siteRef.set(serverEnvelope({ id: siteId, clientId, ownerUid: uid, status: site.status, payload: site }));
  }
  return { id, created: !sameIdentity };
}

exports.processDaneaInbox = onDocumentCreated({ document: "daneaInbox/{messageId}", database: "edilkappa", region: "europe-west8", retry: true }, async (event) => {
  const raw = event.data?.data() || {};
  const message = {
    id: cleanText(raw.id, 500),
    internetMessageId: cleanText(raw.internetMessageId || raw.id, 500),
    subject: cleanText(raw.subject, 500),
    receivedDateTime: cleanText(raw.receivedDateTime, 80),
    from: { emailAddress: { address: cleanText(raw.from, 320).toLowerCase() } },
    body: { contentType: "html", content: String(raw.htmlBody || raw.body || "").slice(0, 100000) },
    bodyPreview: cleanText(raw.bodyPreview, 4000)
  };
  const parsed = parseDaneaMessage(message);
  if (!parsed) {
    await event.data?.ref.delete();
    return;
  }
  const uid = await ownerUid();
  const result = await saveDaneaMailRequest(parsed, uid);
  await DANEA_BRIDGE_REF().set({ connected: true, mailbox: "info@edilkappa.com", lastReceivedAtMs: Date.now(), lastReceivedAt: FieldValue.serverTimestamp(), lastImported: result.created ? 1 : 0, lastMessageId: parsed.sourceMessageId, lastError: "" }, { merge: true });
  if (result.created) await pushSafely({ uid, staff: !uid, title: "Nuova richiesta Danea", body: `${parsed.client} · ${parsed.title}`, type: "danea", targetType: "lead", targetId: result.id, url: "./?view=daneaRequestsView" });
  await event.data?.ref.delete();
});

exports.edilkappaDaneaBridge = onCall({ region: "europe-west8", invoker: "public", timeoutSeconds: 30, memory: "256MiB", maxInstances: 1, cors: true }, async (request) => {
  const account = await authorizedUser(request, "work");
  if (account.role !== "owner") throw new HttpsError("permission-denied", "Solo il titolare può controllare il collegamento Danea.");
  const action = cleanText(request.data?.action || "status", 40);
  if (action !== "status") throw new HttpsError("invalid-argument", "Operazione ponte Danea non valida.");
  const reference = DANEA_BRIDGE_REF();
  const snapshot = await reference.get();
  const integration = snapshot.data() || {};
  return { connected: Boolean(integration.connected), mailbox: integration.mailbox || "info@edilkappa.com", lastReceivedAtMs: Number(integration.lastReceivedAtMs || 0), lastImported: Number(integration.lastImported || 0), lastError: integration.lastError || "" };
});

exports.notifyNewLead = onDocumentCreated({ document: "leads/{leadId}", database: "edilkappa", region: "europe-west8" }, async (event) => {
  const lead = envelopePayload(event.data);
  await pushSafely({ staff: true, title: "Nuova richiesta cliente", body: lead.subject || lead.notes || lead.name || "È arrivata una nuova richiesta.", type: "lead", targetType: "lead", targetId: event.params.leadId, url: "./?view=dashboard" });
});

exports.notifyAbsenceRequest = onDocumentCreated({ document: "absences/{absenceId}", database: "edilkappa", region: "europe-west8" }, async (event) => {
  const absence = envelopePayload(event.data);
  if ((event.data?.data()?.status || absence.status) !== "In attesa") return;
  await pushSafely({ staff: true, title: "Nuova richiesta di assenza", body: `${absence.workerName || "Un operaio"} · ${absence.type || "assenza"}`, type: "absence", targetType: "absence", targetId: absence.groupId || event.params.absenceId, url: "./?view=attendance" });
});

exports.notifyReportUpdate = onDocumentWritten({ document: "reports/{reportId}", database: "edilkappa", region: "europe-west8" }, async (event) => {
  const before = envelopePayload(event.data?.before);
  const after = envelopePayload(event.data?.after);
  if (!event.data?.after?.exists) return;
  const beforePhotos = Math.max(Number(before.photoCount || 0), Array.isArray(before.photos) ? before.photos.length : 0);
  const afterPhotos = Math.max(Number(after.photoCount || 0), Array.isArray(after.photos) ? after.photos.length : 0);
  if (afterPhotos <= beforePhotos) return;
  await pushSafely({ staff: true, title: "Nuove foto dal cantiere", body: `${after.workerName || after.teamName || "Squadra"} ha caricato ${afterPhotos - beforePhotos} nuove foto.`, type: "photos", targetType: "report", targetId: event.params.reportId, url: "./?view=activityView" });
});

exports.notifySiteCompleted = onDocumentWritten({ document: "sites/{siteId}", database: "edilkappa", region: "europe-west8" }, async (event) => {
  if (!event.data?.after?.exists) return;
  const before = envelopePayload(event.data.before);
  const after = envelopePayload(event.data.after);
  const completed = (value) => /complet|conclus|chius|eseguit/i.test(String(value || ""));
  if (completed(before.status) || !completed(after.status || event.data.after.data()?.status)) return;
  await pushSafely({ staff: true, title: "Cantiere completato", body: after.title || after.client || "Una squadra ha concluso un cantiere.", type: "completed", targetType: "site", targetId: event.params.siteId, url: "./?view=completedView" });
});

exports.notifyMissingHours = onSchedule({ schedule: "30 18 * * 1-6", timeZone: "Europe/Rome", region: "europe-west8" }, async () => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [usersSnapshot, timesheetsSnapshot, absencesSnapshot] = await Promise.all([
    firestore.collection("users").where("orgId", "==", ORG_ID).get(),
    firestore.collection("timesheets").where("orgId", "==", ORG_ID).get(),
    firestore.collection("absences").where("orgId", "==", ORG_ID).get()
  ]);
  const present = new Set(timesheetsSnapshot.docs.map((item) => ({ data: item.data(), payload: envelopePayload(item) })).filter(({ payload }) => String(payload.date || "").slice(0, 10) === day && Number(payload.hours || 0) > 0).map(({ data }) => data.workerUid));
  const absent = new Set(absencesSnapshot.docs.map((item) => ({ data: item.data(), payload: envelopePayload(item) })).filter(({ data, payload }) => data.status === "Approvata" && !payload.partialDay && String(payload.startDate || "") <= day && String(payload.endDate || payload.startDate || "") >= day).map(({ data }) => data.workerUid));
  const workers = usersSnapshot.docs.map((item) => ({ uid: item.id, ...item.data() })).filter((item) => item.active && item.role === "worker");
  await Promise.all(workers.filter((worker) => !present.has(worker.uid) && !absent.has(worker.uid)).map((worker) => pushSafely({ uid: worker.uid, title: "Ore di oggi da comunicare", body: `${worker.displayName || "Ciao"}, inserisci le ore lavorate oppure richiedi un’assenza.`, type: "missing-hours", targetType: "hours", targetId: day, url: "./?hours=1" })));
});

exports.edilkappaQuoteAgentWorker = onDocumentCreated({
  document: "aiAgentJobs/{jobDocumentId}",
  database: "edilkappa",
  region: "europe-west8",
  secrets: [OPENAI_API_KEY],
  timeoutSeconds: 540,
  memory: "1GiB",
  maxInstances: 2,
  concurrency: 1,
  retry: false
}, async (event) => {
  const jobReference = event.data?.ref;
  if (!jobReference) return;
  const claimed = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobReference);
    const data = snapshot.data() || {};
    if (!snapshot.exists || data.status !== "queued" || data.engine !== "agents_sdk" || data.taskType !== "quote") return null;
    transaction.set(jobReference, {
      status: "working",
      stage: "agent",
      startedAtMs: Date.now(),
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return data;
  });
  if (!claimed) return;

  const job = claimed;
  let completed = false;
  try {
    if (job.orgId !== ORG_ID || job.mode !== "work" || !job.uid || !job.jobId) throw new Error("Lavoro agente non autorizzato.");
    const input = await loadAgentInput(job.uid, job.jobId, job.inputStoragePath);
    let result;
    let agentFallbackUsed = false;
    try {
      result = await runQuoteAgent({
        apiKey: OPENAI_API_KEY.value(),
        instructions: job.instructions,
        input,
        modelChoice: job.modelChoice,
        useWeb: job.useWeb === true,
        conversationId: job.conversationId,
        userId: safetyIdentifier(job.uid),
        signal: AbortSignal.timeout(AGENT_RUN_TIMEOUT_MS)
      });
    } catch (agentError) {
      console.warn("Agents SDK quote failed; starting Responses fallback", {
        jobId: cleanText(job.jobId, 120),
        name: cleanText(agentError?.name, 120),
        message: cleanText(agentError?.message, 500)
      });
      const fallbackChoice = terraFallbackChoice(job.modelChoice || {});
      const fallbackResponse = await callOpenAI({
        instructions: job.instructions,
        input,
        useWeb: job.useWeb === true,
        modelChoice: fallbackChoice,
        safetyId: safetyIdentifier(job.uid)
      });
      const fallbackResult = extractAnswer(fallbackResponse);
      if (!fallbackResult.answer || fallbackResult.artifact?.kind !== "quote") throw agentError;
      result = {
        answer: fallbackResult.answer,
        artifact: fallbackResult.artifact,
        sources: fallbackResult.sources,
        responseId: cleanText(fallbackResponse.id, 200),
        usage: fallbackResponse.usage || null
      };
      agentFallbackUsed = true;
    }
    const qualityAudit = auditArtifact(result.artifact, job.message);
    if (!qualityAudit.passed && result.artifact?.quote) result.artifact.quote.readyToSave = false;

    const ref = conversationRef(job.uid, job.mode, job.conversationId);
    const conversationSnapshot = await ref.get();
    const history = Array.isArray(conversationSnapshot.data()?.messages) ? conversationSnapshot.data().messages : [];
    const previousArtifactMessage = [...history].reverse().find((item) => normalizeArtifact(item?.artifact));
    if (previousArtifactMessage && isRevisionRequest(job.message)) {
      result.artifact.revisionOf ||= cleanText(previousArtifactMessage.artifact?.id || previousArtifactMessage.artifact?.title, 300);
      result.artifact.revisionReason ||= cleanText(job.message, 1200);
    }
    result.artifact.id = `ai-${randomUUID()}`;
    const inheritedMedia = isRevisionRequest(job.message) && Array.isArray(previousArtifactMessage?.media)
      ? previousArtifactMessage.media
      : [];
    const resultMedia = [...inheritedMedia, ...(job.mediaReferences || [])].filter((item, index, values) => {
      const key = item?.storagePath || `${item?.fileName || ""}:${item?.fileSize || 0}`;
      return key && values.findIndex((candidate) => (candidate?.storagePath || `${candidate?.fileName || ""}:${candidate?.fileSize || 0}`) === key) === index;
    }).slice(0, 10);
    const userMessage = { role: "user", text: job.userText, media: job.mediaReferences || [], at: Number(job.createdAtMs || Date.now()) };
    const assistantMessage = {
      role: "assistant",
      text: result.answer,
      sources: result.sources,
      artifact: result.artifact,
      media: resultMedia,
      model: job.modelChoice?.model,
      modelLabel: job.modelChoice?.modelLabel,
      reasoningEffort: job.modelChoice?.reasoningEffort,
      engine: "agents_sdk",
      agentName: QUOTE_AGENT_NAME,
      fallbackUsed: agentFallbackUsed,
      approvalRequired: true,
      qualityAudit,
      at: Date.now()
    };
    const messages = history.concat([userMessage, assistantMessage]).slice(-30);
    const existingThread = conversationSnapshot.data() || {};
    const generatedTitle = conversationTitle(result.artifact?.subject || result.artifact?.title || job.message, "Nuova conversazione");
    await ref.set({
      uid: job.uid,
      orgId: ORG_ID,
      mode: job.mode,
      messages,
      title: existingThread.titleLocked ? conversationTitle(existingThread.title) : generatedTitle,
      updatedAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    const completedResult = {
      mode: job.mode,
      answer: result.answer,
      sources: result.sources,
      artifact: result.artifact,
      media: resultMedia,
      model: job.modelChoice?.model,
      modelLabel: job.modelChoice?.modelLabel,
      reasoningEffort: job.modelChoice?.reasoningEffort,
      engine: "agents_sdk",
      agentName: QUOTE_AGENT_NAME,
      fallbackUsed: agentFallbackUsed,
      approvalRequired: true,
      qualityAudit,
      usage: result.usage
    };
    await jobReference.set({
      status: "completed",
      stage: "completed",
      responseId: result.responseId,
      result: completedResult,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    await pushSafely({ uid: job.uid, title: "Preventivo pronto", body: result.artifact?.title || result.artifact?.subject || "Apri l’anteprima, controlla e conferma.", type: "quote", targetType: "ai", targetId: result.artifact?.id || job.jobId, url: "./?view=ai" });
    completed = true;
  } catch (error) {
    console.error("EdilKappa quote agent failed", {
      jobId: cleanText(job.jobId, 120),
      name: cleanText(error?.name, 120),
      message: cleanText(error?.message, 500)
    });
    await jobReference.set({
      status: "failed",
      stage: "failed",
      error: agentFailureMessage(error),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    await pushSafely({ uid: job.uid, title: "Preventivo non completato", body: agentFailureMessage(error), type: "ai-error", targetType: "ai", targetId: job.jobId, url: "./?view=ai" });
  } finally {
    if (completed) {
      try {
        await storageBucket.file(agentInputStoragePath(job.uid, job.jobId)).delete({ ignoreNotFound: true });
      } catch (error) {
        console.warn("Temporary agent input cleanup failed", { jobId: cleanText(job.jobId, 120), message: cleanText(error?.message, 300) });
      }
    }
  }
});

exports.recoverStaleQuoteAgentJobs = onSchedule({
  schedule: "*/5 * * * *",
  timeZone: "Europe/Rome",
  region: "europe-west8",
  timeoutSeconds: 60,
  memory: "256MiB",
  retryCount: 0
}, async () => {
  const snapshot = await firestore.collection("aiAgentJobs")
    .where("status", "in", ["queued", "working"])
    .limit(100)
    .get();
  await Promise.all(snapshot.docs.map(async (document) => {
    const outcome = await expireStaleAgentJob(document.ref);
    if (!outcome.expired) return;
    const job = outcome.job || {};
    await pushSafely({
      uid: cleanText(job.uid, 160),
      title: "Preventivo da riprovare",
      body: outcome.error || "L’elaborazione si è interrotta. Apri EdilKappa AI e premi Riprova.",
      type: "ai-error",
      targetType: "ai",
      targetId: cleanText(job.jobId, 120),
      url: "./?view=ai"
    });
  }));
});

exports.edilkappaAi = onCall({
  region: "europe-west8",
  secrets: [OPENAI_API_KEY],
  timeoutSeconds: 600,
  memory: "1GiB",
  maxInstances: 2,
  cors: true
}, async (request) => {
  const mode = request.data?.mode === "personal" ? "personal" : "work";
  const taskType = mode === "work" && ["quote", "report", "inspection"].includes(request.data?.taskType)
    ? request.data.taskType
    : "auto";
  const account = await authorizedUser(request, mode);
  const action = String(request.data?.action || "ask");
  const threadId = conversationId(request.data?.conversationId);
  const ref = conversationRef(account.uid, mode, threadId);

  if (action === "list_conversations") {
    const snapshots = await firestore.collection("aiConversationUsers").doc(account.uid).collection(mode).limit(40).get();
    const conversations = snapshots.docs.map((doc) => {
      const data = doc.data() || {};
      return { id: doc.id, title: conversationTitle(data.title), updatedAtMs: Number(data.updatedAtMs || 0), messageCount: Array.isArray(data.messages) ? data.messages.length : 0 };
    });
    const legacy = await conversationRef(account.uid, mode, "legacy").get();
    if (legacy.exists && Array.isArray(legacy.data()?.messages) && legacy.data().messages.length) {
      conversations.push({ id: "legacy", title: conversationTitle(legacy.data()?.title, "Conversazione precedente"), updatedAtMs: Number(legacy.data()?.updatedAtMs || 1), messageCount: legacy.data().messages.length });
    }
    conversations.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
    return { mode, conversations: conversations.slice(0, 30) };
  }
  if (action === "new_conversation") {
    const id = randomUUID();
    await conversationRef(account.uid, mode, id).set({ uid: account.uid, orgId: ORG_ID, mode, title: "Nuova conversazione", messages: [], updatedAtMs: Date.now(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return { mode, conversation: { id, title: "Nuova conversazione", updatedAtMs: Date.now(), messageCount: 0 } };
  }
  if (action === "rename_conversation") {
    await ref.set({ uid: account.uid, orgId: ORG_ID, mode, title: conversationTitle(request.data?.title), titleLocked: true, updatedAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { mode, conversationId: threadId, title: conversationTitle(request.data?.title) };
  }
  if (action === "delete_conversation") {
    await ref.delete();
    return { mode, conversationId: threadId, deleted: true };
  }

  if (action === "history") {
    const snapshot = await ref.get();
    return { mode, conversationId: threadId, title: conversationTitle(snapshot.data()?.title), messages: (snapshot.data()?.messages || []).slice(-30) };
  }
  if (action === "reset") {
    await ref.delete();
    return { mode, conversationId: threadId, messages: [] };
  }
  if (action === "prepare_photo_preview") {
    if (mode !== "work") throw new HttpsError("permission-denied", "Le anteprime fotografiche sono disponibili soltanto in modalità Lavoro.");
    let reference;
    try {
      [reference] = parseMediaReferences([request.data?.mediaReference], account.uid, mode);
      if (!reference || reference.kind !== "image") throw new Error("Seleziona una fotografia archiviata valida.");
      const prepared = await ensurePhotoPreview({ storageBucket, reference, uid: account.uid, orgId: ORG_ID });
      return {
        mode,
        preview: prepared.reference,
        previewDataUrl: prepared.buffer?.length
          ? `data:image/jpeg;base64,${Buffer.from(prepared.buffer).toString("base64")}`
          : ""
      };
    } catch (error) {
      throw new HttpsError("invalid-argument", error.message);
    }
  }
  if (action === "generate_visual") {
    if (mode !== "work") throw new HttpsError("permission-denied", "Le immagini operative sono disponibili soltanto in modalità Lavoro.");
    const artifactId = cleanText(request.data?.artifactId, 200);
    const briefIndex = Math.max(0, Math.min(2, Math.floor(Number(request.data?.briefIndex) || 0)));
    const snapshot = await ref.get();
    const history = Array.isArray(snapshot.data()?.messages) ? snapshot.data().messages : [];
    const messageIndex = history.findLastIndex((item) => item?.role === "assistant" && cleanText(item?.artifact?.id, 200) === artifactId);
    if (messageIndex < 0) throw new HttpsError("not-found", "Non trovo più la bozza collegata a questa immagine.");
    const storedArtifact = history[messageIndex].artifact;
    const artifact = normalizeArtifact(storedArtifact);
    if (!artifact) throw new HttpsError("failed-precondition", "La bozza non contiene dati sufficienti per creare una visualizzazione.");
    artifact.id = artifactId;
    const brief = artifact.visualBriefs?.[briefIndex];
    if (!brief) throw new HttpsError("invalid-argument", "Scegli una visualizzazione proposta dall’AI.");
    const existingVisuals = (history[messageIndex].media || []).filter((item) => item?.generated === true);
    if (existingVisuals.length >= MAX_VISUALS_PER_ARTIFACT) {
      throw new HttpsError("resource-exhausted", `Puoi creare al massimo ${MAX_VISUALS_PER_ARTIFACT} immagini per ogni bozza.`);
    }
    if (existingVisuals.some((item) => Number(item?.briefIndex) === briefIndex)) {
      throw new HttpsError("already-exists", "Questa visualizzazione è già stata creata. Puoi aprirla dagli allegati della risposta.");
    }
    let referenceImages;
    try {
      referenceImages = parseAttachments(request.data?.referenceImages).filter((item) => item.isImage).slice(0, 2);
    } catch (error) {
      throw new HttpsError("invalid-argument", error.message);
    }
    if (referenceImages.length < 2) {
      const archivedImages = await storedImageReferences(history[messageIndex].media, account.uid, 2 - referenceImages.length);
      referenceImages = referenceImages.concat(archivedImages);
    }
    await useDailyAllowance(account.uid);
    const image = await generateVisual({ artifact, brief, referenceImages, safetyId: safetyIdentifier(account.uid) });
    const visual = await saveGeneratedVisual(account.uid, artifact, brief, briefIndex, image);
    history[messageIndex] = {
      ...history[messageIndex],
      media: [...(history[messageIndex].media || []), visual],
      at: history[messageIndex].at || Date.now()
    };
    await ref.set({
      uid: account.uid,
      orgId: ORG_ID,
      mode,
      messages: history.slice(-30),
      updatedAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { mode, visual };
  }
  if (action === "retry_agent_job") {
    const previousJobId = cleanText(request.data?.jobId, 120);
    if (!previousJobId.startsWith("agent-")) throw new HttpsError("invalid-argument", "Identificativo del preventivo da riprovare non valido.");
    const previousReference = aiAgentJobRef(account.uid, previousJobId);
    let previousSnapshot = await previousReference.get();
    if (!previousSnapshot.exists) throw new HttpsError("not-found", "Non trovo più questa elaborazione.");
    let previousJob = previousSnapshot.data() || {};
    if (previousJob.mode !== mode || conversationId(previousJob.conversationId) !== threadId) {
      throw new HttpsError("permission-denied", "Questa elaborazione appartiene a un’altra conversazione.");
    }
    const existingRetryId = cleanText(previousJob.retriedBy, 120);
    if (existingRetryId) {
      return { jobId: existingRetryId, status: "working", stage: "agent", engine: "agents_sdk", agentName: QUOTE_AGENT_NAME, reusedAttachments: true };
    }
    if (agentJobTimeout(previousJob)) {
      const expired = await expireStaleAgentJob(previousReference);
      previousJob = expired.job || previousJob;
    }
    if (!canRetryAgentJob(previousJob)) {
      throw new HttpsError("failed-precondition", "L’agente sta ancora lavorando. Attendi il completamento oppure il messaggio di interruzione.");
    }
    if (!retryInputAvailable(previousJob)) {
      throw new HttpsError("failed-precondition", "Gli allegati preparati non sono più disponibili. Riapri le foto e avvia una nuova richiesta.");
    }
    if (Number(previousJob.retryCount || 0) >= 4) {
      throw new HttpsError("resource-exhausted", "Sono già stati eseguiti quattro tentativi automatici. Avvia una nuova richiesta dalla chat.");
    }

    let input;
    try {
      input = await loadAgentInput(account.uid, previousJobId, previousJob.inputStoragePath);
    } catch (_) {
      throw new HttpsError("failed-precondition", "Gli allegati preparati non sono più disponibili. Riapri le foto e avvia una nuova richiesta.");
    }
    await useDailyAllowance(account.uid);
    const nextJobId = `agent-${randomUUID()}`;
    const storedInput = await saveAgentInput(account.uid, nextJobId, input);
    const nextReference = aiAgentJobRef(account.uid, nextJobId);
    let selectedJobId = nextJobId;
    let created = false;
    try {
      await firestore.runTransaction(async (transaction) => {
        previousSnapshot = await transaction.get(previousReference);
        if (!previousSnapshot.exists) throw new HttpsError("not-found", "Non trovo più questa elaborazione.");
        const currentJob = previousSnapshot.data() || {};
        if (currentJob.mode !== mode || conversationId(currentJob.conversationId) !== threadId) {
          throw new HttpsError("permission-denied", "Questa elaborazione appartiene a un’altra conversazione.");
        }
        if (currentJob.retriedBy) {
          selectedJobId = cleanText(currentJob.retriedBy, 120);
          return;
        }
        if (!canRetryAgentJob(currentJob)) {
          throw new HttpsError("failed-precondition", "L’elaborazione non può ancora essere riprovata.");
        }
        transaction.create(nextReference, {
          jobId: nextJobId,
          uid: account.uid,
          orgId: ORG_ID,
          mode,
          conversationId: threadId,
          taskType: "quote",
          engine: "agents_sdk",
          agentName: QUOTE_AGENT_NAME,
          approvalRequired: true,
          status: "queued",
          stage: "agent",
          message: currentJob.message || "",
          userText: currentJob.userText || currentJob.message || "Analizza gli allegati.",
          mediaReferences: currentJob.mediaReferences || [],
          inputStoragePath: storedInput.storagePath,
          inputBytes: storedInput.bytes,
          instructions: currentJob.instructions || "",
          modelChoice: currentJob.modelChoice || {},
          useWeb: currentJob.useWeb === true,
          retryOf: previousJobId,
          retryCount: Number(currentJob.retryCount || 0) + 1,
          createdAtMs: Date.now(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        transaction.set(previousReference, {
          retriedBy: nextJobId,
          retriedAtMs: Date.now(),
          retriedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        created = true;
      });
    } catch (error) {
      await storageBucket.file(storedInput.storagePath).delete({ ignoreNotFound: true }).catch(() => {});
      throw error;
    }
    if (!created) {
      await storageBucket.file(storedInput.storagePath).delete({ ignoreNotFound: true }).catch(() => {});
      return { jobId: selectedJobId, status: "working", stage: "agent", engine: "agents_sdk", agentName: QUOTE_AGENT_NAME, reusedAttachments: true };
    }
    await storageBucket.file(previousJob.inputStoragePath).delete({ ignoreNotFound: true }).catch(() => {});
    return { jobId: nextJobId, status: "working", stage: "agent", engine: "agents_sdk", agentName: QUOTE_AGENT_NAME, reusedAttachments: true };
  }
  if (action === "job_status") {
    const jobId = cleanText(request.data?.jobId, 120);
    if (!jobId) throw new HttpsError("invalid-argument", "Identificativo del lavoro AI mancante.");
    const isAgentJob = jobId.startsWith("agent-");
    const jobReference = isAgentJob ? aiAgentJobRef(account.uid, jobId) : aiJobRef(account.uid, jobId);
    const jobSnapshot = await jobReference.get();
    if (!jobSnapshot.exists) throw new HttpsError("not-found", "Non trovo più questa elaborazione. Puoi avviarne una nuova.");
    let job = jobSnapshot.data() || {};
    if (job.mode !== mode || conversationId(job.conversationId) !== threadId) throw new HttpsError("permission-denied", "Questa elaborazione appartiene a un’altra conversazione.");
    if (isAgentJob && agentJobTimeout(job)) {
      const expired = await expireStaleAgentJob(jobReference);
      job = expired.job || job;
    }
    if (job.status === "completed") return { jobId, status: "completed", stage: "completed", result: job.result };
    if (job.status === "failed") return {
      jobId,
      status: "failed",
      stage: job.stage || "failed",
      error: job.error || "La generazione non è riuscita.",
      canRetry: !isAgentJob || retryInputAvailable(job),
      retryWithoutAttachments: isAgentJob && retryInputAvailable(job)
    };
    if (Date.now() - Number(job.createdAtMs || 0) > AI_JOB_TTL_MS) {
      await jobReference.set({ status: "failed", stage: "expired", error: "La bozza è scaduta. Avvia nuovamente la generazione.", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { jobId, status: "failed", stage: "expired", error: "La bozza è scaduta. Avvia nuovamente la generazione.", canRetry: true };
    }
    if (isAgentJob) {
      return {
        jobId,
        status: "working",
        stage: job.stage || "agent",
        engine: "agents_sdk",
        agentName: QUOTE_AGENT_NAME
      };
    }

    let openAiResponse = await retrieveBackgroundResponse(cleanText(job.responseId, 200));
    if (["queued", "in_progress"].includes(openAiResponse.status)) {
      return { jobId, status: "working", stage: job.stage, openAiStatus: openAiResponse.status, fallbackUsed: job.fallbackUsed === true };
    }

    if (openAiResponse.status !== "completed" && job.stage === "check" && job.draftResponseId) {
      const draftResponse = await retrieveBackgroundResponse(cleanText(job.draftResponseId, 200));
      if (draftResponse.status === "completed") openAiResponse = draftResponse;
    }

    if (openAiResponse.status !== "completed") {
      const attempts = Number(job.attempts || 1);
      if (job.stage === "compose" && attempts < 2) {
        const retry = await createBackgroundResponse(finalResponseBody({
          instructions: job.instructions,
          previousResponseId: job.analysisResponseId,
          modelChoice: job.modelChoice,
          useWeb: job.useWeb === true,
          safetyId: safetyIdentifier(account.uid)
        }), "automatic retry");
        await jobReference.set({ responseId: retry.id, attempts: attempts + 1, stage: "retry", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { jobId, status: "working", stage: "retry", openAiStatus: retry.status || "queued", fallbackUsed: false };
      }
      if (["compose", "retry"].includes(job.stage) && job.fallbackUsed !== true) {
        const fallbackChoice = terraFallbackChoice(job.modelChoice || {});
        const fallback = await createBackgroundResponse(finalResponseBody({
          instructions: job.instructions,
          previousResponseId: job.analysisResponseId,
          modelChoice: fallbackChoice,
          useWeb: job.useWeb === true,
          safetyId: safetyIdentifier(account.uid)
        }), "Terra fallback");
        await jobReference.set({ responseId: fallback.id, modelChoice: fallbackChoice, fallbackUsed: true, stage: "fallback", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { jobId, status: "working", stage: "fallback", openAiStatus: fallback.status || "queued", fallbackUsed: true };
      }
      const failureMessage = cleanText(openAiResponse?.error?.message, 500) || "OpenAI non ha completato l’elaborazione. La bozza resta disponibile per riprovare.";
      await jobReference.set({ status: "failed", stage: "failed", error: failureMessage, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { jobId, status: "failed", stage: "failed", error: failureMessage, canRetry: true };
    }

    if (job.stage === "analysis") {
      const finalResponse = await createBackgroundResponse(finalResponseBody({
        instructions: job.instructions,
        previousResponseId: openAiResponse.id,
        modelChoice: job.modelChoice,
        useWeb: job.useWeb === true,
        safetyId: safetyIdentifier(account.uid)
      }), "final composition");
      await jobReference.set({
        responseId: finalResponse.id,
        analysisResponseId: openAiResponse.id,
        stage: "compose",
        attempts: 1,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return { jobId, status: "working", stage: "compose", openAiStatus: finalResponse.status || "queued", fallbackUsed: false };
    }

    const result = extractAnswer(openAiResponse);
    if (!result.answer) {
      await jobReference.set({ status: "failed", stage: "failed", error: "L’AI non ha prodotto una risposta completa. Puoi riprendere la bozza e riprovare.", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { jobId, status: "failed", stage: "failed", error: "L’AI non ha prodotto una risposta completa. Puoi riprendere la bozza e riprovare.", canRetry: true };
    }
    const qualityAudit = auditArtifact(result.artifact, job.message);
    if (mode === "work" && result.artifact && !qualityAudit.passed && job.repairAttempt !== true) {
      const repair = await createBackgroundResponse(repairResponseBody({
        instructions: job.instructions,
        previousResponseId: openAiResponse.id,
        modelChoice: job.modelChoice,
        qualityAudit,
        safetyId: safetyIdentifier(account.uid)
      }), "quality repair");
      await jobReference.set({
        responseId: repair.id,
        draftResponseId: openAiResponse.id,
        repairAttempt: true,
        stage: "check",
        qualityAudit,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return { jobId, status: "working", stage: "check", openAiStatus: repair.status || "queued", fallbackUsed: job.fallbackUsed === true };
    }
    const conversationSnapshot = await ref.get();
    const history = Array.isArray(conversationSnapshot.data()?.messages) ? conversationSnapshot.data().messages : [];
    const previousArtifactMessage = [...history].reverse().find((item) => normalizeArtifact(item?.artifact));
    if (result.artifact) {
      const previousMessage = previousArtifactMessage;
      if (previousMessage && isRevisionRequest(job.message)) {
        result.artifact.revisionOf ||= cleanText(previousMessage.artifact?.id || previousMessage.artifact?.title, 300);
        result.artifact.revisionReason ||= cleanText(job.message, 1200);
      }
      result.artifact.id = `ai-${randomUUID()}`;
    }
    const inheritedMedia = isRevisionRequest(job.message) && Array.isArray(previousArtifactMessage?.media) ? previousArtifactMessage.media : [];
    const resultMedia = [...inheritedMedia, ...(job.mediaReferences || [])].filter((item, index, values) => {
      const key = item?.storagePath || `${item?.fileName || ""}:${item?.fileSize || 0}`;
      return key && values.findIndex((candidate) => (candidate?.storagePath || `${candidate?.fileName || ""}:${candidate?.fileSize || 0}`) === key) === index;
    }).slice(0, 10);
    const userMessage = { role: "user", text: job.userText, media: job.mediaReferences || [], at: Number(job.createdAtMs || Date.now()) };
    const assistantMessage = {
      role: "assistant", text: result.answer, sources: result.sources, artifact: result.artifact,
      media: resultMedia, model: job.modelChoice?.model, modelLabel: job.modelChoice?.modelLabel,
      reasoningEffort: job.modelChoice?.reasoningEffort, fallbackUsed: job.fallbackUsed === true, qualityAudit, at: Date.now()
    };
    const messages = history.concat([userMessage, assistantMessage]).slice(-30);
    const existingThread = conversationSnapshot.data() || {};
    const generatedTitle = conversationTitle(result.artifact?.subject || result.artifact?.title || job.message, "Nuova conversazione");
    await ref.set({ uid: account.uid, orgId: ORG_ID, mode, messages, title: existingThread.titleLocked ? conversationTitle(existingThread.title) : generatedTitle, updatedAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const completedResult = {
      mode, answer: result.answer, sources: result.sources, artifact: result.artifact,
      media: resultMedia, model: job.modelChoice?.model, modelLabel: job.modelChoice?.modelLabel,
      reasoningEffort: job.modelChoice?.reasoningEffort, fallbackUsed: job.fallbackUsed === true, qualityAudit, usage: openAiResponse.usage || null
    };
    await jobReference.set({ status: "completed", stage: "completed", result: completedResult, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (result.artifact?.kind === "quote") await pushSafely({ uid: account.uid, title: "Preventivo pronto", body: result.artifact?.title || result.artifact?.subject || "Apri l’anteprima, controlla e conferma.", type: "quote", targetType: "ai", targetId: result.artifact?.id || jobId, url: "./?view=ai" });
    return { jobId, status: "completed", stage: "completed", result: completedResult };
  }
  if (action !== "ask") throw new HttpsError("invalid-argument", "Operazione AI non valida.");

  const message = cleanText(request.data?.message, 8000);
  let attachments;
  let mediaReferences;
  try {
    attachments = await convertHeicAttachments(parseAttachments(request.data?.attachments));
    mediaReferences = parseMediaReferences(request.data?.mediaReferences, account.uid, mode);
    const archivedPhotos = await prepareArchivedHeicPhotos({
      storageBucket,
      mediaReferences,
      uid: account.uid,
      orgId: ORG_ID
    });
    mediaReferences = archivedPhotos.mediaReferences;
    attachments = mergePreparedAttachments(attachments, archivedPhotos.attachments);
  } catch (error) {
    throw new HttpsError("invalid-argument", error.message);
  }
  if (!message && !attachments.length && !mediaReferences.length) throw new HttpsError("invalid-argument", "Scrivi una richiesta o allega un file.");
  await useDailyAllowance(account.uid);
  const videoTranscripts = await transcribeVideos(mediaReferences);

  const snapshot = await ref.get();
  const history = Array.isArray(snapshot.data()?.messages) ? snapshot.data().messages : [];
  const modelChoice = chooseModel({
    requestedModelMode: request.data?.modelMode,
    mode,
    taskType,
    message,
    attachmentCount: attachments.length + mediaReferences.length,
    attachmentKinds: [
      ...attachments.map((item) => item.kind),
      ...mediaReferences.map((item) => item.kind)
    ],
    hasHistoryArtifact: history.some((item) => normalizeArtifact(item?.artifact)),
    useWeb: request.data?.useWeb === true
  });
  const instructions = buildInstructions({
    mode,
    displayName: account.displayName,
    businessContext: mode === "work" ? request.data?.businessContext : null,
    taskType
  });
  const originalNames = mediaReferences.length
    ? mediaReferences.map((item) => item.fileName)
    : Array.from(new Set(attachments.map((item) => item.sourceName || item.name)));
  const attachmentNote = originalNames.length ? `\n[Allegati: ${originalNames.join(", ")}]` : "";
  const useQuoteAgent = mode === "work" && taskType === "quote";
  const jobId = useQuoteAgent ? `agent-${randomUUID()}` : randomUUID();
  const input = buildInput(history, message, attachments, videoTranscripts);
  const userText = cleanText((message || "Analizza gli allegati.") + attachmentNote, 6000);
  if (useQuoteAgent) {
    const storedInput = await saveAgentInput(account.uid, jobId, input);
    await aiAgentJobRef(account.uid, jobId).set({
      jobId,
      uid: account.uid,
      orgId: ORG_ID,
      mode,
      conversationId: threadId,
      taskType,
      engine: "agents_sdk",
      agentName: QUOTE_AGENT_NAME,
      approvalRequired: true,
      status: "queued",
      stage: "agent",
      message,
      userText,
      mediaReferences,
      inputStoragePath: storedInput.storagePath,
      inputBytes: storedInput.bytes,
      instructions,
      modelChoice,
      useWeb: request.data?.useWeb === true,
      createdAtMs: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return {
      jobId,
      status: "working",
      stage: "agent",
      engine: "agents_sdk",
      agentName: QUOTE_AGENT_NAME,
      modelLabel: modelChoice.modelLabel
    };
  }
  const preliminary = await createBackgroundResponse(preliminaryResponseBody({
    instructions,
    input,
    safetyId: safetyIdentifier(account.uid)
  }), "preliminary analysis");
  await aiJobRef(account.uid, jobId).set({
    uid: account.uid,
    orgId: ORG_ID,
    mode,
    conversationId: threadId,
    taskType,
    status: "working",
    stage: "analysis",
    responseId: preliminary.id,
    message,
    userText,
    mediaReferences,
    instructions,
    modelChoice,
    useWeb: request.data?.useWeb === true,
    attempts: 0,
    fallbackUsed: false,
    createdAtMs: Date.now(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return { jobId, status: "working", stage: "analysis", openAiStatus: preliminary.status || "queued", modelLabel: modelChoice.modelLabel };
});
