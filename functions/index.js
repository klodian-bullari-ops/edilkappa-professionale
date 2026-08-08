"use strict";

const { createHash, randomUUID } = require("node:crypto");
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
  chooseModel,
  cleanText,
  extractGeneratedImage,
  extractAnswer,
  isRevisionRequest,
  normalizeArtifact,
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
const MAX_VISUALS_PER_ARTIFACT = 3;
const VISUAL_REFERENCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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

async function storedImageReferences(media, uid, limit = 2) {
  const prefix = `organisations/${ORG_ID}/documents/${uid}/`;
  const output = [];
  for (const item of Array.isArray(media) ? media : []) {
    if (output.length >= limit) break;
    const storagePath = cleanText(item?.storagePath, 600);
    if (item?.generated || item?.kind !== "image" || !storagePath.startsWith(prefix)) continue;
    try {
      const file = storageBucket.file(storagePath);
      const [metadata] = await file.getMetadata();
      const contentType = String(metadata.contentType || item.fileType || "").toLowerCase();
      const size = Number(metadata.size || item.fileSize || 0);
      if (!VISUAL_REFERENCE_TYPES.has(contentType) || !size || size > 6 * 1024 * 1024) continue;
      const [buffer] = await file.download();
      output.push({
        name: cleanText(item.fileName || "riferimento", 140),
        sourceName: cleanText(item.fileName || "riferimento", 140),
        dataUrl: `data:${contentType};base64,${buffer.toString("base64")}`
      });
    } catch (error) {
      console.warn("Stored visual reference unavailable", { storagePath, message: error?.message });
    }
  }
  return output;
}

function safetyIdentifier(uid) {
  return createHash("sha256").update(`${ORG_ID}:${uid}`).digest("hex");
}

async function openAiFailure(response, operation = "request") {
  const requestId = response.headers.get("x-request-id") || "sconosciuto";
  console.error(`OpenAI ${operation} failed`, { status: response.status, requestId });
  if (response.status === 429) throw new HttpsError("resource-exhausted", "Il credito o il limite OpenAI è terminato. Controlla la fatturazione API.");
  if (response.status === 401 || response.status === 403) {
    const message = operation === "image generation"
      ? "Il progetto OpenAI non è ancora autorizzato a generare immagini. Potrebbe essere necessaria la verifica dell’organizzazione OpenAI."
      : "La chiave OpenAI del server non è valida oppure il progetto non è autorizzato a usare questo modello.";
    throw new HttpsError("failed-precondition", message);
  }
  throw new HttpsError("unavailable", "Il servizio AI non è disponibile in questo momento. Riprova tra poco.");
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
    max_output_tokens: 12000,
    store: false,
    safety_identifier: safetyId
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
    signal: AbortSignal.timeout(240000)
  });
  if (!response.ok) await openAiFailure(response);
  return response.json();
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
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY.value()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_SOL_MODEL || "gpt-5.6-sol",
      input: [{ role: "user", content }],
      tools: [{ type: "image_generation" }],
      store: false,
      safety_identifier: safetyId
    }),
    signal: AbortSignal.timeout(240000)
  });
  if (!response.ok) await openAiFailure(response, "image generation");
  const data = await response.json();
  const image = extractGeneratedImage(data);
  if (!image) throw new HttpsError("unavailable", "L’AI non ha prodotto l’immagine. Riprova oppure scegli un’altra visualizzazione.");
  return image;
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
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { mode, visual };
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
  const modelChoice = chooseModel({
    requestedModelMode: request.data?.modelMode,
    mode,
    taskType,
    message,
    attachmentCount: attachments.length + mediaReferences.length,
    hasHistoryArtifact: history.some((item) => normalizeArtifact(item?.artifact))
  });
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
    modelChoice,
    safetyId: safetyIdentifier(account.uid)
  });
  const result = extractAnswer(response);
  if (!result.answer) throw new HttpsError("unavailable", "L’AI non ha prodotto una risposta. Riprova con una richiesta più precisa.");
  if (result.artifact) {
    const previousMessage = [...history].reverse().find((item) => normalizeArtifact(item?.artifact));
    if (previousMessage && isRevisionRequest(message)) {
      result.artifact.revisionOf ||= cleanText(previousMessage.artifact?.id || previousMessage.artifact?.title, 300);
      result.artifact.revisionReason ||= cleanText(message, 1200);
    }
    result.artifact.id = `ai-${randomUUID()}`;
  }

  const originalNames = mediaReferences.length
    ? mediaReferences.map((item) => item.fileName)
    : Array.from(new Set(attachments.map((item) => item.sourceName || item.name)));
  const attachmentNote = originalNames.length ? `\n[Allegati: ${originalNames.join(", ")}]` : "";
  const messages = history.concat([
    { role: "user", text: cleanText((message || "Analizza gli allegati.") + attachmentNote, 6000), media: mediaReferences, at: Date.now() },
    { role: "assistant", text: result.answer, sources: result.sources, artifact: result.artifact, media: mediaReferences, model: modelChoice.model, modelLabel: modelChoice.modelLabel, reasoningEffort: modelChoice.reasoningEffort, at: Date.now() }
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
    model: modelChoice.model,
    modelLabel: modelChoice.modelLabel,
    reasoningEffort: modelChoice.reasoningEffort,
    usage: response.usage || null
  };
});
