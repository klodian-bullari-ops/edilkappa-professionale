"use strict";

const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { buildInput, buildInstructions, cleanText, extractAnswer, parseAttachments } = require("./ai-core");

const adminApp = initializeApp();
const firestore = getFirestore(adminApp, "edilkappa");
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const OWNER_EMAIL = "info@edilkappa.com";
const ORG_ID = "edilkappa";
const DAILY_REQUEST_LIMIT = 120;

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

async function callOpenAI({ instructions, input, useWeb }) {
  const body = {
    model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
    instructions,
    input,
    reasoning: { effort: "low" },
    max_output_tokens: 2200,
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
  timeoutSeconds: 120,
  memory: "512MiB",
  maxInstances: 2,
  cors: true
}, async (request) => {
  const mode = request.data?.mode === "personal" ? "personal" : "work";
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
  try {
    attachments = parseAttachments(request.data?.attachments);
  } catch (error) {
    throw new HttpsError("invalid-argument", error.message);
  }
  if (!message && !attachments.length) throw new HttpsError("invalid-argument", "Scrivi una richiesta o allega un file.");
  await useDailyAllowance(account.uid);

  const snapshot = await ref.get();
  const history = Array.isArray(snapshot.data()?.messages) ? snapshot.data().messages : [];
  const instructions = buildInstructions({
    mode,
    displayName: account.displayName,
    businessContext: mode === "work" ? request.data?.businessContext : null
  });
  const response = await callOpenAI({
    instructions,
    input: buildInput(history, message, attachments),
    useWeb: request.data?.useWeb === true
  });
  const result = extractAnswer(response);
  if (!result.answer) throw new HttpsError("unavailable", "L’AI non ha prodotto una risposta. Riprova con una richiesta più precisa.");

  const attachmentNote = attachments.length ? `\n[Allegati: ${attachments.map((item) => item.name).join(", ")}]` : "";
  const messages = history.concat([
    { role: "user", text: cleanText((message || "Analizza gli allegati.") + attachmentNote, 6000), at: Date.now() },
    { role: "assistant", text: result.answer, sources: result.sources, at: Date.now() }
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
    usage: response.usage || null
  };
});
