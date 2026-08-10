"use strict";

const { createHash } = require("node:crypto");

const DANEA_SENDER = "no-reply@miocondominio.eu";
const DANEA_SUBJECT = /richiesta\s+(?:di\s+)?intervento/i;

function clean(value, limit = 500) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, limit);
}

function stripHtml(value) {
  return clean(String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n"), 12000);
}

function field(text, names) {
  const pattern = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return clean(text.match(new RegExp(`(?:^|\\n)\\s*(?:${pattern})\\s*[:\\-]\\s*([^\\n]+)`, "i"))?.[1] || "", 500);
}

function officialLink(html, text) {
  const matches = `${html || ""}\n${text || ""}`.match(/https:\/\/[^\s"'<>]+/gi) || [];
  for (const raw of matches) {
    try {
      const url = new URL(raw.replace(/&amp;/g, "&").replace(/[),.;]+$/, ""));
      const host = url.hostname.toLowerCase();
      if (host === "miocondominio.eu" || host.endsWith(".miocondominio.eu") || host === "danea.it" || host.endsWith(".danea.it")) return url.href;
    } catch (_) {}
  }
  return "";
}

function parseDaneaMessage(message = {}) {
  const sender = clean(message.from?.emailAddress?.address || message.sender?.emailAddress?.address, 320).toLowerCase();
  const subject = clean(message.subject, 500);
  if (sender !== DANEA_SENDER || !DANEA_SUBJECT.test(subject)) return null;
  const html = String(message.body?.content || "");
  const body = stripHtml(message.body?.contentType === "html" ? html : `${html}\n${message.bodyPreview || ""}`);
  const codeMatch = body.match(/(?:codice\s+(?:attivit[aà]|intervento)|attivit[aà]|intervento|pratica|richiesta)\s*(?:n[.°º]?|#|:|-)?\s*([A-Z0-9][A-Z0-9./_-]{2,})/i)
    || subject.match(/\(([A-Z0-9][A-Z0-9./_-]{2,})\)|#\s*([A-Z0-9][A-Z0-9./_-]{2,})/i);
  const studio = field(body, ["studio", "amministratore", "studio amministratore"]);
  const client = field(body, ["condominio", "cliente", "stabile"]);
  const address = field(body, ["indirizzo", "ubicazione", "luogo"]);
  const title = field(body, ["oggetto", "titolo", "tipo intervento"]) || subject.replace(DANEA_SUBJECT, "").replace(/^\s*[-:–]\s*/, "") || "Richiesta di intervento";
  const reference = field(body, ["referente", "nominativo", "contatto"]);
  const phone = clean(body.match(/(?:telefono|cellulare|tel\.?)[\s:-]*([+\d][\d\s./-]{6,})/i)?.[1] || "", 80);
  const priority = /emergenza/i.test(`${subject} ${body}`) ? "Emergenza" : /urgent/i.test(`${subject} ${body}`) ? "Urgente" : "Normale";
  const sourceMessageId = clean(message.internetMessageId || message.id, 500);
  return {
    sourceMessageId,
    graphMessageId: clean(message.id, 500),
    daneaId: clean(codeMatch?.[1] || codeMatch?.[2], 120),
    studio,
    title,
    client: client || "Cliente da definire",
    address,
    request: body || clean(message.bodyPreview, 4000),
    priority,
    daneaStatus: "Nuovo",
    status: "Nuova",
    receivedAt: clean(message.receivedDateTime, 80) || new Date().toISOString(),
    reference,
    phone,
    sourceUrl: officialLink(html, body),
    source: "Danea Interventi",
    importedBy: "EdilKappa Gmail Bridge"
  };
}

function stableId(prefix, values) {
  return `${prefix}-${createHash("sha256").update(values.map((value) => clean(value, 1000).toLowerCase()).join("|")).digest("hex").slice(0, 24)}`;
}

module.exports = { DANEA_SENDER, DANEA_SUBJECT, officialLink, parseDaneaMessage, stableId, stripHtml };
