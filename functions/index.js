"use strict";

const { randomUUID } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const {
  AI_RESPONSE_SCHEMA,
  ALLOWED_VIDEO_TYPES,
  buildInput,
  buildInstructions,
  cleanText,
  extractAnswer,
  parseAttachments,
  parseMediaReferences
} = require("./ai-core");

const adminApp = initializeApp();
const firestore = getFirestore(adminApp, "edilkappa");
const storageBucket = getStorage(adminApp).bucket("edilkappa-professionale.firebasestorage.app");
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const OWNER_EMAIL = "info@edilkappa.com";
const ORG_ID = "edilkappa";
const DAILY_REQUEST_LIMIT = 120;
const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;

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

function conversationRef(uid, mode) {
  return firestore.collection("aiConversations").doc(`${uid}--${mode}`);
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

async function callOpenAI({ instructions, input, useWeb, taskType }) {
  const body = {
    model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
    instructions,
    input,
    reasoning: { effort: ["quote", "report"].includes(taskType) ? "medium" : "low" },
    text: {
      format: {
        type: "json_schema",
        name: "edilkappa_ai_response",
        strict: true,
        schema: AI_RESPONSE_SCHEMA
      }
    },
    max_output_tokens: 5000,
    store: false
  };
  if (useWeb) {
    body.tools = [{
      type: "web_search",
      user_location: { type: "approximate", country: "IT", city: "Milano", region: "Lombardia" }
    }];
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY.value()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(105000)
  });
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id") || "sconosciuto";
    console.error("OpenAI request failed", { status: response.status, requestId });
    if (response.status === 429) throw new HttpsError("resource-exhausted", "Il credito o il limite OpenAI è terminato. Controlla la fatturazione API.");
    if (response.status === 401 || response.status === 403) throw new HttpsError("failed-precondition", "La chiave OpenAI del server non è valida o non è autorizzata.");
    throw new HttpsError("unavailable", "Il servizio AI non è disponibile in questo momento. Riprova tra poco.");
  }
  return response.json();
}

exports.edilkappaAi = onCall({
  region: "europe-west8",
  secrets: [OPENAI_API_KEY],
  timeoutSeconds: 300,
  memory: "1GiB",
  maxInstances: 2,
  cors: true
}, async (request) => {
  const mode = request.data?.mode === "personal" ? "personal" : "work";
  const taskType = mode === "work" && ["quote", "report", "inspection"].includes(request.data?.taskType)
    ? request.data.taskType
    : "auto";
  const account = await authorizedUser(request, mode);
  const ref = conversationRef(account.uid, mode);
  const action = String(request.data?.action || "ask");

  if (action === "history") {
    const snapshot = await ref.get();
    return { mode, messages: (snapshot.data()?.messages || []).slice(-30) };
  }
  if (action === "reset") {
    await ref.delete();
    return { mode, messages: [] };
  }
  if (action !== "ask") throw new HttpsError("invalid-argument", "Operazione AI non valida.");

  const message = cleanText(request.data?.message, 8000);
  let attachments;
  let mediaReferences;
  try {
    attachments = parseAttachments(request.data?.attachments);
    mediaReferences = parseMediaReferences(request.data?.mediaReferences, account.uid, mode);
  } catch (error) {
    throw new HttpsError("invalid-argument", error.message);
  }
  if (!message && !attachments.length && !mediaReferences.length) throw new HttpsError("invalid-argument", "Scrivi una richiesta o allega un file.");
  await useDailyAllowance(account.uid);
  const videoTranscripts = await transcribeVideos(mediaReferences);

  const snapshot = await ref.get();
  const history = Array.isArray(snapshot.data()?.messages) ? snapshot.data().messages : [];
  const instructions = buildInstructions({
    mode,
    displayName: account.displayName,
    businessContext: mode === "work" ? request.data?.businessContext : null,
    taskType
  });
  const response = await callOpenAI({
    instructions,
    input: buildInput(history, message, attachments, videoTranscripts),
    useWeb: request.data?.useWeb === true,
    taskType
  });
  const result = extractAnswer(response);
  if (!result.answer) throw new HttpsError("unavailable", "L’AI non ha prodotto una risposta. Riprova con una richiesta più precisa.");
  if (result.artifact) result.artifact.id = `ai-${randomUUID()}`;

  const originalNames = mediaReferences.length
    ? mediaReferences.map((item) => item.fileName)
    : Array.from(new Set(attachments.map((item) => item.sourceName || item.name)));
  const attachmentNote = originalNames.length ? `\n[Allegati: ${originalNames.join(", ")}]` : "";
  const messages = history.concat([
    { role: "user", text: cleanText((message || "Analizza gli allegati.") + attachmentNote, 6000), media: mediaReferences, at: Date.now() },
    { role: "assistant", text: result.answer, sources: result.sources, artifact: result.artifact, media: mediaReferences, at: Date.now() }
  ]).slice(-30);
  await ref.set({
    uid: account.uid,
    orgId: ORG_ID,
    mode,
    messages,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    mode,
    answer: result.answer,
    sources: result.sources,
    artifact: result.artifact,
    media: mediaReferences,
    usage: response.usage || null
  };
});
