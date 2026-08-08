(function () {
  "use strict";

  const MAX_ORIGINAL_ATTACHMENTS = 8;
  const MAX_REQUEST_ATTACHMENTS = 16;
  const MAX_REQUEST_BYTES = 15 * 1024 * 1024;
  const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
  const DOCUMENT_MAX_BYTES = 6 * 1024 * 1024;
  const TASKS = new Set(["auto", "quote", "report", "inspection"]);
  const MODEL_MODES = new Set(["auto", "sol", "terra"]);

  const state = {
    mode: "work",
    messages: { work: [], personal: [] },
    loaded: { work: false, personal: false },
    loading: false,
    sending: false,
    resetting: false,
    generatingVisual: "",
    attachments: [],
    taskType: "auto",
    modelMode: "auto",
    draft: "",
    progress: "",
    useWeb: false,
    error: "",
    nextHistoryAttempt: 0
  };

  const css = document.createElement("style");
  css.textContent = `
    .ekAiPage{max-width:1180px;margin:0 auto}.ekAiHero{background:linear-gradient(135deg,#102c22,#1e4938);border-radius:22px;padding:22px;color:#fff;display:flex;justify-content:space-between;gap:18px;align-items:center;box-shadow:0 14px 40px rgba(11,43,31,.14)}
    .ekAiHero h2{margin:0 0 6px;font-size:25px}.ekAiHero p{margin:0;color:#d7e9df;max-width:720px}.ekAiHeroMark{width:58px;height:58px;border-radius:18px;background:#f4c400;color:#102c22;display:grid;place-items:center;font-size:30px;font-weight:900;flex:0 0 auto}
    .ekAiToolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:16px 0}.ekAiModes{display:flex;padding:4px;border:1px solid #d9e2dc;background:#fff;border-radius:13px}.ekAiModes button{border:0;background:transparent;border-radius:10px;padding:10px 15px;font-weight:800;color:#557064;cursor:pointer}.ekAiModes button.active{background:#173d2e;color:#fff}.ekAiStatus{display:flex;gap:8px;align-items:center;color:#577064;font-size:13px}.ekAiDot{width:9px;height:9px;border-radius:50%;background:#22a565;box-shadow:0 0 0 4px #dff4e8}
    .ekAiWorkflow{display:flex;gap:8px;flex-wrap:wrap;margin:-3px 0 13px;align-items:center}.ekAiWorkflow button{border:1px solid #d6e2da;background:#fff;color:#244a3a;border-radius:12px;padding:9px 12px;font-weight:800;cursor:pointer}.ekAiWorkflow button.active{background:#fff7cc;border-color:#e1bd20;color:#292300}.ekAiWorkflow small{display:flex;align-items:center;color:#65776f}.ekAiModel{display:flex;gap:7px;align-items:center;margin-left:auto;color:#536a60;font-size:12px;font-weight:800}.ekAiModel select{border:1px solid #d6e2da;background:#fff;border-radius:10px;padding:8px;color:#173d2e;font-weight:800}
    .ekAiChat{min-height:440px;max-height:60vh;overflow:auto;background:#f7faf8;border:1px solid #dce7e0;border-radius:20px;padding:18px;display:flex;flex-direction:column;gap:13px}.ekAiEmpty{margin:auto;text-align:center;max-width:650px;color:#52665d;padding:28px}.ekAiEmpty strong{display:block;color:#173d2e;font-size:20px;margin-bottom:7px}
    .ekAiMessage{max-width:90%;border-radius:17px;padding:13px 15px;line-height:1.5;box-shadow:0 3px 12px rgba(20,53,40,.06)}.ekAiMessage.user{align-self:flex-end;background:#173d2e;color:#fff;border-bottom-right-radius:5px;max-width:84%}.ekAiMessage.assistant{align-self:flex-start;background:#fff;color:#1d3028;border:1px solid #dce7e0;border-bottom-left-radius:5px}.ekAiText{white-space:pre-wrap;overflow-wrap:anywhere}.ekAiMessageMeta{font-size:10px;color:#71827a;margin-top:8px}.ekAiSources{margin-top:11px;padding-top:9px;border-top:1px solid #e3ebe6;display:flex;gap:7px;flex-wrap:wrap}.ekAiSources a{font-size:12px;color:#176542;text-decoration:none;background:#e8f6ed;border-radius:999px;padding:5px 9px}.ekAiMessageMedia{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.ekAiMessageMedia button{border:1px solid #d6e2da;background:#f8faf9;border-radius:9px;padding:6px 9px;color:#284c3d;font-size:12px;font-weight:750}.ekAiMessageMedia button.generated{background:#fff7cc;border-color:#dfc243}.ekAiMessage.user .ekAiMessageMedia button{background:#fff;color:#173d2e}
    .ekAiTyping{display:inline-flex;gap:5px}.ekAiTyping i{width:7px;height:7px;background:#668078;border-radius:50%;animation:ekAiPulse 1.1s infinite}.ekAiTyping i:nth-child(2){animation-delay:.15s}.ekAiTyping i:nth-child(3){animation-delay:.3s}@keyframes ekAiPulse{0%,70%,100%{opacity:.3;transform:translateY(0)}35%{opacity:1;transform:translateY(-3px)}}
    .ekAiArtifact{margin-top:14px;border:1px solid #cbd9d0;border-radius:16px;overflow:hidden;background:#fcfdfc}.ekAiArtifactHead{padding:13px 14px;background:#eef5f0;display:flex;gap:12px;justify-content:space-between;align-items:flex-start}.ekAiArtifactHead strong{display:block;color:#173d2e}.ekAiArtifactHead small{display:block;color:#607168;margin-top:3px}.ekAiArtifactBody{padding:14px}.ekAiArtifactTable{width:100%;border-collapse:collapse;font-size:12px;min-width:660px}.ekAiArtifactTable th,.ekAiArtifactTable td{padding:8px;border-bottom:1px solid #e0e7e2;text-align:left;vertical-align:top}.ekAiArtifactTable th{color:#607168;background:#f8faf8;font-size:10px;text-transform:uppercase}.ekAiArtifactTable .right{text-align:right;white-space:nowrap}.ekAiTableWrap{overflow:auto;border:1px solid #e0e7e2;border-radius:11px}.ekAiPriceSource{display:inline-flex;border-radius:999px;padding:3px 7px;background:#eaf3ee;color:#246143;font-size:10px;font-weight:850;white-space:nowrap}.ekAiPriceSource.estimate{background:#fff2c7;color:#775a00}.ekAiPriceSource.missing{background:#ffe5e3;color:#922e27}.ekAiArtifactTotals{display:grid;grid-template-columns:1fr auto;gap:4px 18px;width:min(330px,100%);margin:12px 0 0 auto;font-size:13px}.ekAiArtifactTotals b{text-align:right}.ekAiArtifactSection{margin-top:13px}.ekAiArtifactSection h4{margin:0 0 6px;color:#284c3d}.ekAiArtifactSection ul{margin:5px 0;padding-left:20px}.ekAiArtifactSection li{margin:4px 0}.ekAiOption{border:1px solid #d8e3dc;border-radius:11px;padding:10px;margin-top:8px}.ekAiOption.recommended{border-color:#d8b600;background:#fffbee}.ekAiOptionHead{display:flex;justify-content:space-between;gap:10px}.ekAiVisualBrief{border-left:4px solid #f4c400;background:#f8faf8;padding:9px 10px;margin-top:7px}.ekAiArtifactNotice{background:#fff7d9;border:1px solid #ecd987;border-radius:11px;padding:10px;margin-top:11px;color:#695300;font-size:12px}.ekAiArtifactActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.ekAiArtifactActions button{border:0;border-radius:10px;padding:9px 12px;font-weight:850;cursor:pointer;background:#173d2e;color:#fff}.ekAiArtifactActions button.secondary{background:#fff;color:#173d2e;border:1px solid #cbd9d0}.ekAiArtifactActions button.visual{background:#f4c400;color:#173d2e}.ekAiArtifactActions button.saved{background:#e7f4eb;color:#176542;border:1px solid #b9ddc5}.ekAiArtifactActions button:disabled{opacity:.55;cursor:wait}
    .ekAiQuick{display:flex;gap:8px;flex-wrap:wrap;margin:13px 0}.ekAiQuick button{border:1px solid #d6e2da;background:#fff;color:#244a3a;border-radius:999px;padding:8px 12px;font-weight:700;cursor:pointer}.ekAiQuick button:hover{border-color:#6da482}
    .ekAiComposer{background:#fff;border:1px solid #d8e3dc;border-radius:18px;padding:12px;box-shadow:0 8px 28px rgba(17,56,41,.08)}.ekAiComposer textarea{border:0!important;box-shadow:none!important;resize:vertical;min-height:82px;width:100%;padding:7px;font:inherit;outline:0;background:transparent}.ekAiComposeBar{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}.ekAiActions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ekAiFileBtn,.ekAiWeb{display:inline-flex;align-items:center;gap:7px;border:1px solid #d7e2db;background:#f8faf9;border-radius:10px;padding:9px 11px;font-weight:700;color:#365749;cursor:pointer;font-size:13px}.ekAiWeb input{width:auto}.ekAiSend{border:0;background:#f4c400;color:#143528;border-radius:11px;padding:11px 18px;font-weight:900;cursor:pointer}.ekAiSend:disabled{opacity:.55;cursor:wait}.ekAiFiles{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 9px}.ekAiFile{display:flex;align-items:center;gap:6px;background:#edf4ef;color:#355246;border-radius:9px;padding:7px 9px;font-size:12px}.ekAiFile button{border:0;background:transparent;color:#9b2f2f;font-weight:900;cursor:pointer}.ekAiProgress{margin:10px 0;background:#edf6f0;border:1px solid #c7ddcf;color:#24543f;border-radius:11px;padding:10px 12px;font-size:13px}.ekAiError{margin:10px 0;background:#fff0f0;border:1px solid #f1c8c8;color:#8f2929;border-radius:11px;padding:10px 12px}.ekAiPrivacy{font-size:12px;color:#64766e;margin:10px 2px 0}.ekAiReset{border:0;background:transparent;color:#7b3c3c;text-decoration:underline;cursor:pointer;font-size:12px}
    @media(max-width:700px){.ekAiHero{padding:18px}.ekAiHeroMark{width:48px;height:48px}.ekAiToolbar{align-items:flex-start}.ekAiStatus{display:none}.ekAiModel{width:100%;margin-left:0}.ekAiModel select{flex:1}.ekAiChat{min-height:360px;max-height:54vh;padding:12px}.ekAiMessage,.ekAiMessage.user{max-width:96%}.ekAiComposer{padding:10px}.ekAiComposeBar,.ekAiActions{align-items:stretch}.ekAiSend{flex:1}.ekAiWeb{justify-content:center}.ekAiArtifactHead{flex-direction:column}.ekAiArtifactActions button{flex:1}}
  `;
  document.head.appendChild(css);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function safeName(value, fallback = "documento") {
    return String(value || fallback)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 120) || fallback;
  }

  function euro(value) {
    return Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
  }

  function localDate() {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
    return formatter.format(new Date());
  }

  function aiUid(prefix) {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`;
  }

  function isOwner() {
    return window.EdilKappaCloud?.currentProfile?.role === "owner";
  }

  function currentMessages() {
    return state.messages[state.mode] || [];
  }

  function sourceHtml(source) {
    const url = String(source?.url || "");
    if (!/^https:\/\//i.test(url)) return "";
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">↗ ${escapeHtml(source.title || "Fonte")}</a>`;
  }

  function mediaHtml(message, messageIndex) {
    const media = Array.isArray(message?.media) ? message.media : [];
    if (!media.length) return "";
    return `<div class="ekAiMessageMedia">${media.map((item, mediaIndex) => `<button type="button" class="${item.generated ? "generated" : ""}" onclick="edilkappaAiOpenMedia(${messageIndex},${mediaIndex})">${item.generated ? "🖼️" : item.kind === "video" ? "🎬" : item.kind === "image" ? "📷" : "📄"} ${escapeHtml(item.generated ? (item.title || "Immagine illustrativa AI") : (item.fileName || "Originale"))}</button>`).join("")}</div>`;
  }

  function artifactSavedItem(artifact) {
    const database = window.EdilKappaLocal?.getDB?.() || {};
    if (!artifact?.id) return null;
    return artifact.kind === "quote"
      ? (database.quotes || []).find((item) => item.aiArtifactId === artifact.id)
      : (database.documents || []).find((item) => item.aiArtifactId === artifact.id);
  }

  function artifactList(title, values) {
    const rows = (Array.isArray(values) ? values : []).filter(Boolean);
    return rows.length ? `<div class="ekAiArtifactSection"><h4>${escapeHtml(title)}</h4><ul>${rows.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul></div>` : "";
  }

  function priceSourceHtml(line) {
    const labels = { tariffario: "Listino EdilKappa", storico: "Storico", stima_ai: "Stima AI", da_definire: "Da definire" };
    const className = line.priceSource === "stima_ai" ? "estimate" : line.priceSource === "da_definire" ? "missing" : "";
    const reference = line.priceReference ? ` · ${line.priceReference}` : "";
    return `<span class="ekAiPriceSource ${className}">${escapeHtml((labels[line.priceSource] || "Da verificare") + reference)}</span>`;
  }

  function verifiedArtifactPrices(artifact) {
    if (artifact?.kind !== "quote") return artifact;
    const database = window.EdilKappaLocal?.getDB?.() || {};
    const priceList = database.priceList || [];
    const warnings = [];
    const lines = (artifact.quote?.lines || []).map((line) => {
      if (line.priceSource !== "tariffario") return { ...line };
      const reference = String(line.priceReference || "");
      const priceItem = priceList.find((item) => String(item.id) === reference || String(item.code) === reference);
      const hasSalePrice = priceItem && priceItem.salePrice !== undefined && priceItem.salePrice !== null && priceItem.salePrice !== "" && Number.isFinite(Number(priceItem.salePrice));
      if (!hasSalePrice) {
        const warning = `Prezzo del listino da confermare per “${line.description || "voce senza descrizione"}”${reference ? ` (riferimento ${reference})` : ""}.`;
        warnings.push(warning);
        return {
          ...line,
          unitPrice: 0,
          priceSource: "da_definire",
          confidence: "bassa",
          notes: [line.notes, warning].filter(Boolean).join(" ")
        };
      }
      return {
        ...line,
        unit: line.unit || priceItem.unit || "a corpo",
        unitPrice: Math.max(0, Number(priceItem.salePrice)),
        priceReference: String(priceItem.code || priceItem.id || reference)
      };
    });
    const mainSubtotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
    const mainNet = mainSubtotal * (1 - Number(artifact.quote?.discountPct || 0) / 100);
    return {
      ...artifact,
      quote: {
        ...(artifact.quote || {}),
        lines,
        options: (artifact.quote?.options || []).map((option) => option.recommended && lines.length ? { ...option, total: mainNet } : { ...option }),
        missingInformation: Array.from(new Set([...(artifact.quote?.missingInformation || []), ...warnings]))
      }
    };
  }

  function quoteArtifactHtml(artifact) {
    const quote = artifact.quote || {};
    const lines = Array.isArray(quote.lines) ? quote.lines : [];
    const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
    const discount = subtotal * Number(quote.discountPct || 0) / 100;
    const net = subtotal - discount;
    const vat = net * Number(quote.vatRate || 0) / 100;
    const options = (quote.options || []).map((option) => `<div class="ekAiOption ${option.recommended ? "recommended" : ""}"><div class="ekAiOptionHead"><b>${escapeHtml(option.label ? `${option.label} · ${option.title}` : option.title)}</b><b>${euro(option.total)} + IVA</b></div>${option.description ? `<div>${escapeHtml(option.description)}</div>` : ""}${option.includedWorks?.length ? `<small>Comprende: ${escapeHtml(option.includedWorks.join(" · "))}</small>` : ""}${option.notes ? `<br><small>${escapeHtml(option.notes)}</small>` : ""}</div>`).join("");
    return `${artifact.revisionReason ? `<div class="ekAiArtifactNotice"><b>Revisione:</b> ${escapeHtml(artifact.revisionReason)}</div>` : ""}${artifactList("Valutazione tecnica", artifact.technicalAssessment)}${artifactList("Fasi operative", artifact.workPhases)}${artifactList("Materiali previsti", artifact.materials)}<div class="ekAiTableWrap"><table class="ekAiArtifactTable"><thead><tr><th>Lavorazione</th><th>Q.tà</th><th>Unità</th><th class="right">Prezzo</th><th class="right">Totale</th><th>Origine</th></tr></thead><tbody>${lines.map((line) => `<tr><td><b>${escapeHtml(line.description)}</b>${line.notes ? `<br><small>${escapeHtml(line.notes)}</small>` : ""}</td><td>${Number(line.quantity || 0).toLocaleString("it-IT")}</td><td>${escapeHtml(line.unit)}</td><td class="right">${euro(line.unitPrice)}</td><td class="right">${euro(Number(line.quantity || 0) * Number(line.unitPrice || 0))}</td><td>${priceSourceHtml(line)}<br><small>Affidabilità ${escapeHtml(line.confidence || "bassa")}</small></td></tr>`).join("") || `<tr><td colspan="6">Le voci devono ancora essere definite.</td></tr>`}</tbody></table></div>
      <div class="ekAiArtifactTotals"><span>Subtotale</span><b>${euro(subtotal)}</b><span>Sconto ${Number(quote.discountPct || 0)}%</span><b>− ${euro(discount)}</b><span>Imponibile</span><b>${euro(net)}</b><span>IVA ${Number(quote.vatRate || 0)}%</span><b>${euro(vat)}</b><span>Totale</span><b>${euro(net + vat)}</b></div>
      ${quote.estimatedDuration ? `<div class="ekAiArtifactSection"><h4>Durata stimata</h4><div>${escapeHtml(quote.estimatedDuration)}</div></div>` : ""}${artifactList("Opere comprese", quote.includedWorks)}${artifactList("Esclusioni", quote.exclusions)}${options ? `<div class="ekAiArtifactSection"><h4>Alternative e scenari</h4>${options}</div>` : ""}${artifactList("Ipotesi usate", quote.assumptions)}${artifactList("Informazioni da confermare", quote.missingInformation)}${quote.notes ? `<div class="ekAiArtifactSection"><h4>Note</h4><div>${escapeHtml(quote.notes)}</div></div>` : ""}`;
  }

  function reportArtifactHtml(artifact) {
    const report = artifact.report || {};
    return `${artifact.revisionReason ? `<div class="ekAiArtifactNotice"><b>Revisione:</b> ${escapeHtml(artifact.revisionReason)}</div>` : ""}${report.executiveSummary ? `<div class="ekAiArtifactSection"><h4>Sintesi</h4><div>${escapeHtml(report.executiveSummary)}</div></div>` : ""}${artifactList("Valutazione tecnica", artifact.technicalAssessment)}${artifactList("Osservazioni", report.observations)}${artifactList("Cause probabili", report.probableCauses)}${artifactList("Fasi operative", artifact.workPhases)}${artifactList("Materiali previsti", artifact.materials)}${artifactList("Interventi consigliati", report.recommendedWorks)}${artifactList("Sicurezza", report.safetyNotes)}${artifactList("Limiti dell’analisi", report.limitations)}${report.conclusions ? `<div class="ekAiArtifactSection"><h4>Conclusioni</h4><div>${escapeHtml(report.conclusions)}</div></div>` : ""}${artifactList("Informazioni da confermare", report.missingInformation)}`;
  }

  function visualBriefsHtml(artifact) {
    const briefs = Array.isArray(artifact?.visualBriefs) ? artifact.visualBriefs : [];
    if (!briefs.length) return "";
    const labels = { photomontage: "Fotomontaggio", materials_board: "Tavola materiali", technical_diagram: "Schema illustrativo" };
    return `<div class="ekAiArtifactSection"><h4>Immagini proposte</h4>${briefs.map((brief) => `<div class="ekAiVisualBrief"><b>${escapeHtml(labels[brief.kind] || "Visualizzazione")} · ${escapeHtml(brief.title)}</b><br><small>${escapeHtml(brief.prompt)}</small></div>`).join("")}</div>`;
  }

  function artifactHtml(artifact, messageIndex) {
    if (!artifact || !["quote", "report"].includes(artifact.kind)) return "";
    const checkedArtifact = verifiedArtifactPrices(artifact);
    const saved = artifactSavedItem(checkedArtifact);
    const detail = checkedArtifact.kind === "quote" ? quoteArtifactHtml(checkedArtifact) : reportArtifactHtml(checkedArtifact);
    const missing = checkedArtifact.kind === "quote" ? checkedArtifact.quote?.missingInformation : checkedArtifact.report?.missingInformation;
    const message = artifactMessage(messageIndex);
    const generatedIndexes = new Set((message?.media || []).filter((item) => item.generated).map((item) => Number(item.briefIndex)));
    const nextBrief = (checkedArtifact.visualBriefs || []).findIndex((_, index) => !generatedIndexes.has(index));
    const visualButton = nextBrief >= 0 ? `<button class="visual" onclick="edilkappaAiGenerateVisual(${messageIndex},${nextBrief})" ${state.generatingVisual ? "disabled" : ""}>${state.generatingVisual === checkedArtifact.id ? "Creo l’immagine…" : `Crea ${nextBrief === 0 ? "fotomontaggio / immagine" : "altra immagine"}`}</button>` : "";
    return `<section class="ekAiArtifact"><div class="ekAiArtifactHead"><div><strong>${checkedArtifact.kind === "quote" ? "📋 Bozza di preventivo" : "📝 Bozza di relazione tecnica"}</strong><small>${escapeHtml(checkedArtifact.title || checkedArtifact.subject || "Documento EdilKappa")}${checkedArtifact.client ? ` · ${escapeHtml(checkedArtifact.client)}` : ""}</small></div><span class="ekAiPriceSource ${saved ? "" : "estimate"}">${saved ? "Salvato" : "Da controllare"}</span></div><div class="ekAiArtifactBody">${checkedArtifact.summary ? `<div>${escapeHtml(checkedArtifact.summary)}</div>` : ""}${detail}${visualBriefsHtml(checkedArtifact)}${Array.isArray(missing) && missing.length ? `<div class="ekAiArtifactNotice"><b>Prima dell’invio al cliente:</b> controlla le informazioni evidenziate e tutti i prezzi stimati.</div>` : `<div class="ekAiArtifactNotice"><b>Controllo umano obbligatorio:</b> verifica comunque misure, lavorazioni, prezzi e condizioni prima dell’invio.</div>`}<div class="ekAiArtifactActions">${saved ? `<button class="saved" onclick="edilkappaAiOpenSaved(${messageIndex})">✓ Apri nel gestionale</button>` : `<button onclick="edilkappaAiSaveArtifact(${messageIndex})">${checkedArtifact.kind === "quote" ? "Salva e modifica preventivo" : "Salva relazione PDF"}</button>`}<button class="secondary" onclick="edilkappaAiDownloadWord(${messageIndex})">Scarica Word</button>${visualButton}</div></div></section>`;
  }

  function messageHtml(message, index) {
    const sources = (message.sources || []).map(sourceHtml).join("");
    const model = message.role === "assistant" && message.modelLabel ? `<div class="ekAiMessageMeta">Motore: ${escapeHtml(message.modelLabel)}${message.reasoningEffort ? ` · ragionamento ${escapeHtml(message.reasoningEffort)}` : ""}</div>` : "";
    return `<div class="ekAiMessage ${message.role === "user" ? "user" : "assistant"}"><div class="ekAiText">${escapeHtml(message.text)}</div>${model}${mediaHtml(message, index)}${sources ? `<div class="ekAiSources">${sources}</div>` : ""}${message.role === "assistant" ? artifactHtml(message.artifact, index) : ""}</div>`;
  }

  function quickPrompts() {
    return state.mode === "personal"
      ? [
          { label: "Organizza la mia giornata", prompt: "Organizza la mia giornata in ordine di priorità.", taskType: "auto" },
          { label: "Scrivi un messaggio", prompt: "Aiutami a scrivere un messaggio chiaro.", taskType: "auto" },
          { label: "Aiutami a decidere", prompt: "Aiutami a valutare questa decisione.", taskType: "auto" },
          { label: "Cerca informazioni aggiornate", prompt: "Cerca informazioni aggiornate su questo argomento:", taskType: "auto" }
        ]
      : [
          { label: "Preventivo da allegati", prompt: "Analizza foto, video e documenti allegati. Prepara un preventivo completo con lavorazioni, quantità, prezzi del listino EdilKappa e totali. Segnala soltanto i dati che devo confermare.", taskType: "quote" },
          { label: "Relazione da sopralluogo", prompt: "Analizza foto, video e documenti del sopralluogo e prepara una relazione tecnica completa, distinguendo osservazioni, cause probabili, interventi consigliati e verifiche necessarie.", taskType: "report" },
          { label: "Analizza foto o video", prompt: "Analizza con attenzione le foto o il video allegato, descrivi cosa è visibile, i problemi probabili, i rischi e i prossimi controlli da fare.", taskType: "inspection" },
          { label: "Controlla i cantieri", prompt: "Controlla i cantieri attivi e indicami priorità, rischi, scadenze e prossime azioni.", taskType: "auto" }
        ];
  }

  function taskLabel(task) {
    return ({ auto: "Chat libera", quote: "Preventivo", report: "Relazione", inspection: "Analisi sopralluogo" })[task] || "Chat libera";
  }

  function modelSelectHtml() {
    return `<label class="ekAiModel">Motore<select onchange="edilkappaAiSetModel(this.value)"><option value="auto" ${state.modelMode === "auto" ? "selected" : ""}>Automatico · Sol sui lavori complessi</option><option value="sol" ${state.modelMode === "sol" ? "selected" : ""}>GPT‑5.6 Sol · massima qualità</option><option value="terra" ${state.modelMode === "terra" ? "selected" : ""}>GPT‑5.6 Terra · più economico</option></select></label>`;
  }

  function renderAttachments() {
    return state.attachments.map((item, index) => {
      const icon = item.kind === "video" ? "🎬" : item.kind === "image" ? "📷" : "📄";
      const detail = item.kind === "video" ? ` · ${item.frames?.length || 0} fotogrammi` : "";
      return `<span class="ekAiFile">${icon} ${escapeHtml(item.name)}${detail} <button onclick="edilkappaAiRemoveFile(${index})" aria-label="Rimuovi">×</button></span>`;
    }).join("");
  }

  function workflowHtml() {
    if (state.mode !== "work") return `<div class="ekAiWorkflow">${modelSelectHtml()}</div>`;
    const buttons = [["auto", "💬 Chat"], ["quote", "📋 Preventivo"], ["report", "📝 Relazione"], ["inspection", "🔎 Analisi"]];
    return `<div class="ekAiWorkflow">${buttons.map(([task, label]) => `<button class="${state.taskType === task ? "active" : ""}" onclick="edilkappaAiSetTask('${task}')">${label}</button>`).join("")}<small>Modalità: ${taskLabel(state.taskType)}</small>${modelSelectHtml()}</div>`;
  }

  function view() {
    if (state.mode === "personal" && !isOwner()) state.mode = "work";
    const messages = currentMessages();
    if (!state.loaded[state.mode] && !state.loading && Date.now() >= state.nextHistoryAttempt) setTimeout(loadHistory, 0);
    const modeLabel = state.mode === "work" ? "Lavoro" : "Personale";
    return `<div class="ekAiPage">
      <section class="ekAiHero"><div><h2>EdilKappa AI</h2><p>GPT‑5.6 Sol analizza foto, video, audio, PDF e documenti; ragiona sulle alternative, revisiona i preventivi e può creare immagini illustrative della soluzione.</p></div><div class="ekAiHeroMark">✦</div></section>
      <div class="ekAiToolbar"><div class="ekAiModes"><button class="${state.mode === "work" ? "active" : ""}" onclick="edilkappaAiSetMode('work')">🏗️ Lavoro</button>${isOwner() ? `<button class="${state.mode === "personal" ? "active" : ""}" onclick="edilkappaAiSetMode('personal')">👤 Personale</button>` : ""}</div><div class="ekAiStatus"><i class="ekAiDot"></i> Protetta dal login EdilKappa · ${modeLabel}</div></div>
      ${workflowHtml()}
      <div class="ekAiChat" id="ekAiChat">${state.loading && !messages.length ? `<div class="ekAiEmpty"><strong>Carico la memoria ${modeLabel.toLowerCase()}…</strong></div>` : messages.length ? messages.map(messageHtml).join("") : `<div class="ekAiEmpty"><strong>${state.mode === "work" ? "Allega il sopralluogo e dimmi il risultato finale" : "Questa è la tua area personale"}</strong>${state.mode === "work" ? "Puoi scrivere normalmente come in ChatGPT. Per un risultato più preciso scegli Preventivo, Relazione o Analisi e allega tutto insieme." : "Le conversazioni personali restano separate da quelle aziendali."}</div>`}${state.sending ? `<div class="ekAiMessage assistant"><span class="ekAiTyping"><i></i><i></i><i></i></span></div>` : ""}</div>
      <div class="ekAiQuick">${quickPrompts().map((item, index) => `<button onclick="edilkappaAiUsePrompt(${index})">${escapeHtml(item.label)}</button>`).join("")}</div>
      ${state.progress ? `<div class="ekAiProgress">⏳ ${escapeHtml(state.progress)}</div>` : ""}
      ${state.error ? `<div class="ekAiError">${escapeHtml(state.error)}</div>` : ""}
      <div class="ekAiComposer"><div class="ekAiFiles">${renderAttachments()}</div><textarea id="ekAiInput" maxlength="8000" placeholder="Descrivi il lavoro, le misure conosciute e il risultato che vuoi…" oninput="edilkappaAiDraft(this.value)" onkeydown="edilkappaAiKeydown(event)">${escapeHtml(state.draft)}</textarea><div class="ekAiComposeBar"><div class="ekAiActions"><label class="ekAiFileBtn">📎 Foto, video e file<input id="ekAiFiles" type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm,application/pdf,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv" onchange="edilkappaAiAddFiles(this.files)"></label><label class="ekAiWeb"><input type="checkbox" ${state.useWeb ? "checked" : ""} onchange="edilkappaAiToggleWeb(this.checked)"> 🌐 Ricerca web</label></div><button class="ekAiSend" onclick="edilkappaAiSend()" ${state.sending ? "disabled" : ""}>${state.sending ? "Sto lavorando…" : "Invia ✦"}</button></div></div>
      <div class="ekAiPrivacy">Gli originali di lavoro vengono archiviati nel cloud protetto. I video sono analizzati tramite fotogrammi e, fino a 25 MB, anche tramite trascrizione dell’audio. Le immagini illustrative vengono create solo quando premi il relativo pulsante, così mantieni il controllo dei costi. Controlla sempre misure, prezzi e conclusioni tecniche. <button class="ekAiReset" onclick="edilkappaAiReset()" ${state.resetting ? "disabled" : ""}>Cancella questa memoria</button></div>
    </div>`;
  }

  function rerender() {
    if (window.EdilKappaLocal?.getView?.() === "ai") window.EdilKappaLocal.render();
    setTimeout(scrollToBottom, 0);
  }

  function scrollToBottom() {
    const chat = document.getElementById("ekAiChat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  async function loadHistory() {
    if (state.loading || state.loaded[state.mode]) return;
    if (!window.EdilKappaCloud?.ready || !window.EdilKappaCloud?.aiRequest) {
      state.error = "Attendi il completamento della sincronizzazione cloud e riprova.";
      state.nextHistoryAttempt = Date.now() + 3000;
      setTimeout(() => {
        if (window.EdilKappaLocal?.getView?.() === "ai") rerender();
      }, 3100);
      rerender();
      return;
    }
    const requestedMode = state.mode;
    state.loading = true;
    state.error = "";
    rerender();
    try {
      const result = await window.EdilKappaCloud.aiRequest({ action: "history", mode: requestedMode });
      state.messages[requestedMode] = Array.isArray(result.messages) ? result.messages : [];
      state.loaded[requestedMode] = true;
      state.nextHistoryAttempt = 0;
    } catch (error) {
      state.error = error?.message || "Non riesco a caricare la memoria AI.";
    } finally {
      state.loading = false;
      rerender();
    }
  }

  function businessContext() {
    const database = window.EdilKappaLocal?.getDB?.() || {};
    const compact = (items, fields, limit = 20) => (items || []).slice(0, limit).map((item) => Object.fromEntries(fields.map((field) => [field, item?.[field]]).filter(([, value]) => value !== undefined && value !== "")));
    const recentQuotes = (database.quotes || []).slice(-10).reverse().map((item) => ({
      code: item.code,
      client: item.client,
      subject: item.subject,
      date: item.date,
      status: item.status,
      net: item.net,
      lines: (item.lines || []).slice(0, 12).map((line) => ({ description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice }))
    }));
    return {
      azienda: (database.companySettings || [])[0] || {},
      riepilogo: {
        clienti: (database.condomini || []).length,
        cantieriAttivi: (database.sites || []).filter((item) => item.status !== "Completato").length,
        sopralluoghiDaGestire: (database.inspections || []).filter((item) => item.status === "Da preventivare").length,
        preventiviAperti: (database.quotes || []).filter((item) => !["Accettato", "Rifiutato"].includes(item.status)).length,
        vociListinoAttive: (database.priceList || []).filter((item) => item.status !== "Disattivo").length
      },
      clienti: compact(database.condomini, ["id", "name", "address", "manager"], 40),
      interventi: compact(database.interventions, ["id", "clientId", "client", "title", "category", "status", "notes"], 40),
      cantieri: compact((database.sites || []).filter((item) => item.status !== "Completato"), ["id", "title", "client", "clientId", "interventionId", "address", "start", "status", "progress", "value", "cost", "worker"], 20),
      sopralluoghi: compact(database.inspections, ["id", "date", "time", "type", "client", "clientId", "interventionId", "address", "problem", "status"], 20),
      listinoEdilKappa: compact((database.priceList || []).filter((item) => item.status !== "Disattivo"), ["id", "code", "category", "description", "unit", "cost", "salePrice", "status"], 100),
      preventiviRecenti: recentQuotes,
      squadre: compact(database.teams, ["id", "name", "member1", "member2"], 12)
    };
  }

  function fileDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Non riesco a leggere il file."));
      reader.readAsDataURL(file);
    });
  }

  function inferredType(file) {
    if (file.type && file.type !== "application/octet-stream") return file.type.toLowerCase();
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    return ({ pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain", csv: "text/csv", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm" })[extension] || "";
  }

  function blobFromCanvas(canvas, type = "image/jpeg", quality = 0.84) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function compressedImage(file) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const picture = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Non riesco ad aprire questa fotografia."));
        image.src = objectUrl;
      });
      const scale = Math.min(1, 2200 / Math.max(picture.naturalWidth, picture.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
      canvas.getContext("2d").drawImage(picture, 0, 0, canvas.width, canvas.height);
      let blob = await blobFromCanvas(canvas, "image/jpeg", 0.86);
      if (blob?.size > 2500000) blob = await blobFromCanvas(canvas, "image/jpeg", 0.72);
      if (!blob) throw new Error("Non riesco a preparare questa fotografia.");
      return { dataUrl: await fileDataUrl(blob), mimeType: "image/jpeg" };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function waitFor(target, eventName, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Tempo esaurito durante la lettura del video."));
      }, timeout);
      const done = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error("Il browser non riesce a leggere questo video.")); };
      const cleanup = () => {
        clearTimeout(timer);
        target.removeEventListener(eventName, done);
        target.removeEventListener("error", failed);
      };
      target.addEventListener(eventName, done, { once: true });
      target.addEventListener("error", failed, { once: true });
    });
  }

  async function seekVideo(video, seconds) {
    if (Math.abs(video.currentTime - seconds) < 0.03 && video.readyState >= 2) return;
    const ready = waitFor(video, "seeked", 6000);
    video.currentTime = seconds;
    await ready;
  }

  async function extractVideoFrames(file, onProgress) {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const metadataReady = waitFor(video, "loadedmetadata", 10000);
    video.src = objectUrl;
    video.load?.();
    try {
      await metadataReady;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (!duration || !video.videoWidth || !video.videoHeight) throw new Error("Il video non contiene immagini leggibili dal browser.");
      const frameCount = duration < 12 ? 5 : duration < 90 ? 8 : 10;
      const scale = Math.min(1, 1440 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      const frames = [];
      for (let index = 0; index < frameCount; index += 1) {
        const seconds = Math.min(Math.max(0, duration - 0.08), duration * (index + 0.5) / frameCount);
        onProgress?.(index + 1, frameCount);
        await seekVideo(video, seconds);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await blobFromCanvas(canvas, "image/jpeg", 0.76);
        if (!blob) continue;
        frames.push({
          name: `${safeName(file.name.replace(/\.[^.]+$/, ""), "video")}-fotogramma-${index + 1}.jpg`,
          sourceName: file.name,
          mimeType: "image/jpeg",
          dataUrl: await fileDataUrl(blob),
          kind: "video_frame",
          capturedAtSeconds: seconds
        });
      }
      return { durationSeconds: duration, frames };
    } finally {
      video.removeAttribute("src");
      video.load?.();
      URL.revokeObjectURL(objectUrl);
    }
  }

  function payloadBytes(dataUrl) {
    const base64 = String(dataUrl || "").split(",")[1] || "";
    return Math.floor(base64.length * 3 / 4);
  }

  function requestAttachmentsFor(items) {
    const fixed = [];
    const videoFrames = [];
    items.forEach((item) => {
      if (item.kind === "video") videoFrames.push(...(item.frames || []));
      else fixed.push({ name: item.name, sourceName: item.name, mimeType: item.mimeType, dataUrl: item.dataUrl, kind: item.kind });
    });
    const frameSlots = Math.max(0, MAX_REQUEST_ATTACHMENTS - fixed.length);
    const selectedFrames = videoFrames.length <= frameSlots
      ? videoFrames
      : Array.from({ length: frameSlots }, (_, index) => videoFrames[Math.min(videoFrames.length - 1, Math.floor(index * videoFrames.length / frameSlots))]);
    const output = fixed.concat(selectedFrames);
    const total = output.reduce((sum, item) => sum + payloadBytes(item.dataUrl), 0);
    if (total > MAX_REQUEST_BYTES) throw new Error("Foto, fotogrammi e documenti elaborati superano 15 MB. Rimuovi un allegato e riprova.");
    return output;
  }

  async function archiveOriginal(item, index, total) {
    if (state.mode !== "work" || !item.file?.size || item.stored) return item.stored || null;
    if (!window.EdilKappaCloud?.ready) return null;
    state.progress = `Archivio l’originale ${index + 1} di ${total}: ${item.name}`;
    rerender();
    const identifier = `ai-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const stored = item.kind === "image" || item.kind === "video"
        ? await window.EdilKappaCloud.uploadMedia(item.file, { mediaId: identifier, category: "EdilKappa AI · allegato da analizzare", client: "" })
        : await window.EdilKappaCloud.uploadDocument(item.file, { documentId: identifier, category: "EdilKappa AI · documento da analizzare", client: "" });
      item.stored = {
        ...stored,
        kind: item.kind,
        durationSeconds: Number(item.durationSeconds || 0)
      };
      return item.stored;
    } catch (error) {
      item.archiveError = error?.message || "Originale non archiviato.";
      return null;
    }
  }

  function clientForArtifact(artifact) {
    const database = window.EdilKappaLocal?.getDB?.() || {};
    return (database.condomini || []).find((item) => item.id === artifact.clientId)
      || (database.condomini || []).find((item) => String(item.name || "").toLocaleLowerCase("it") === String(artifact.client || "").toLocaleLowerCase("it"));
  }

  function interventionsForClient(clientId) {
    const database = window.EdilKappaLocal?.getDB?.() || {};
    const client = (database.condomini || []).find((item) => item.id === clientId);
    return (database.interventions || []).filter((item) => item.clientId === clientId || (client && item.client === client.name));
  }

  function interventionOptions(clientId, selected) {
    return `<option value="">Da assegnare / nessun intervento</option>${interventionsForClient(clientId).map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.title || item.category || "Intervento")}</option>`).join("")}`;
  }

  function artifactMessage(index) {
    return currentMessages()[Number(index)] || null;
  }

  function destinationBody(artifact) {
    const database = window.EdilKappaLocal?.getDB?.() || {};
    const matchedClient = clientForArtifact(artifact);
    const selectedClientId = matchedClient?.id || "";
    const selectedIntervention = interventionsForClient(selectedClientId).some((item) => item.id === artifact.interventionId) ? artifact.interventionId : "";
    return `<div class="notice"><b>Controllo prima del salvataggio</b><br>Scegli il cliente e l’intervento corretti. Il documento resterà una bozza modificabile.</div><div style="height:14px"></div><div class="formGrid"><div class="field"><label>Cliente / condominio</label><select name="clientId" required onchange="edilkappaAiDestinationChanged(this)"><option value="">Seleziona il cliente</option>${(database.condomini || []).map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedClientId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></div><div class="field"><label>Intervento</label><select name="interventionId">${interventionOptions(selectedClientId, selectedIntervention)}</select></div><div class="field full"><label>${artifact.kind === "quote" ? "Oggetto del preventivo" : "Titolo della relazione"}</label><input name="title" value="${escapeHtml(artifact.subject || artifact.title || "")}" required></div></div>`;
  }

  function notesForQuote(artifact) {
    const quote = artifact.quote || {};
    const blocks = [artifact.revisionReason ? `Motivo revisione: ${artifact.revisionReason}` : ""];
    if (artifact.technicalAssessment?.length) blocks.push(`Valutazione tecnica:\n- ${artifact.technicalAssessment.join("\n- ")}`);
    if (artifact.workPhases?.length) blocks.push(`Fasi operative:\n- ${artifact.workPhases.join("\n- ")}`);
    if (artifact.materials?.length) blocks.push(`Materiali previsti:\n- ${artifact.materials.join("\n- ")}`);
    if (quote.estimatedDuration) blocks.push(`Durata stimata: ${quote.estimatedDuration}`);
    if (quote.includedWorks?.length) blocks.push(`Opere comprese:\n- ${quote.includedWorks.join("\n- ")}`);
    if (quote.exclusions?.length) blocks.push(`Esclusioni:\n- ${quote.exclusions.join("\n- ")}`);
    if (quote.options?.length) blocks.push(`Alternative/scenari:\n${quote.options.map((option) => `- ${option.label ? `${option.label} · ` : ""}${option.title}: ${euro(option.total)} + IVA${option.recommended ? " (raccomandata)" : ""}${option.notes ? ` · ${option.notes}` : ""}`).join("\n")}`);
    if (quote.notes) blocks.push(quote.notes);
    if (quote.assumptions?.length) blocks.push(`Ipotesi della bozza AI:\n- ${quote.assumptions.join("\n- ")}`);
    if (quote.missingInformation?.length) blocks.push(`Dati da confermare:\n- ${quote.missingInformation.join("\n- ")}`);
    blocks.push("Bozza generata con EdilKappa AI: misure, lavorazioni, prezzi e condizioni devono essere verificati dal titolare prima dell’invio.");
    return blocks.filter(Boolean).join("\n\n");
  }

  function nextQuoteCode(database) {
    const year = new Date().getFullYear();
    let number = 1;
    while ((database.quotes || []).some((item) => item.code === `PREV-${year}-${String(number).padStart(3, "0")}`)) number += 1;
    return `PREV-${year}-${String(number).padStart(3, "0")}`;
  }

  function mediaForQuote(media) {
    return (media || []).filter((item) => ["image", "video"].includes(item.kind)).map((item) => ({
      storagePath: item.storagePath,
      fileName: item.fileName,
      fileType: item.fileType,
      fileSize: item.fileSize,
      uploadedAt: item.uploadedAt || new Date().toISOString(),
      source: item.generated ? "EdilKappa AI · visualizzazione illustrativa" : "EdilKappa AI",
      generated: item.generated === true,
      illustrative: item.illustrative === true,
      title: item.title || ""
    }));
  }

  function linkSourceDocuments(database, artifact, destination, media, includeVisuals) {
    (media || []).filter((item) => includeVisuals || item.kind === "document").forEach((item) => {
      if ((database.documents || []).some((documentItem) => documentItem.storagePath === item.storagePath)) return;
      database.documents = database.documents || [];
      database.documents.push({
        id: aiUid("doc-ai-src"),
        aiArtifactId: artifact.id,
        client: destination.client.name,
        clientId: destination.client.id,
        interventionId: destination.interventionId,
        category: item.generated ? "Visualizzazione illustrativa AI" : item.kind === "document" ? "Documento sorgente AI" : "Foto e video sopralluogo",
        title: item.generated ? (item.title || item.fileName || "Visualizzazione AI") : (item.fileName || "Allegato analizzato da EdilKappa AI"),
        notes: item.generated ? (item.disclaimer || "Immagine illustrativa generata con AI; non è un progetto esecutivo.") : "Originale analizzato da EdilKappa AI e collegato alla relativa bozza.",
        storagePath: item.storagePath,
        fileName: item.fileName,
        fileType: item.fileType,
        fileSize: item.fileSize,
        uploadedAt: item.uploadedAt || new Date().toISOString(),
        createdAt: new Date().toISOString()
      });
    });
  }

  function saveQuoteArtifact(artifact, destination, media) {
    artifact = verifiedArtifactPrices(artifact);
    const database = window.EdilKappaLocal.getDB();
    const existing = (database.quotes || []).find((item) => item.aiArtifactId === artifact.id);
    if (existing) return existing;
    const priceList = database.priceList || [];
    let lines = (artifact.quote?.lines || []).filter((line) => line.description).map((line) => {
      const priceItem = priceList.find((item) => item.id === line.priceReference || item.code === line.priceReference);
      return {
        priceListId: priceItem?.id || "",
        category: priceItem?.category || "",
        description: line.description,
        quantity: Number(line.quantity || 0),
        unit: line.unit || "a corpo",
        unitCost: Number(priceItem?.cost || 0),
        unitPrice: Number(line.unitPrice || 0),
        priceSource: line.priceSource,
        priceReference: line.priceReference,
        confidence: line.confidence,
        aiNotes: line.notes
      };
    });
    if (!lines.length) lines = [{ description: destination.title, quantity: 1, unit: "a corpo", unitCost: 0, unitPrice: 0, priceSource: "da_definire", confidence: "bassa" }];
    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const discount = Number(artifact.quote?.discountPct || 0);
    const vatRate = Number(artifact.quote?.vatRate ?? 22);
    const net = subtotal * (1 - discount / 100);
    const costTotal = lines.reduce((sum, line) => sum + line.quantity * Number(line.unitCost || 0), 0);
    const item = {
      id: aiUid("p"),
      aiArtifactId: artifact.id,
      aiGenerated: true,
      code: nextQuoteCode(database),
      client: destination.client.name,
      clientId: destination.client.id,
      interventionId: destination.interventionId,
      subject: destination.title,
      date: localDate(),
      status: "Bozza",
      validityDays: Number(artifact.quote?.validityDays || 30),
      paymentTerms: artifact.quote?.paymentTerms || "Da concordare",
      notes: notesForQuote(artifact),
      lines,
      subtotal,
      discount,
      vatRate,
      net,
      vat: net * vatRate / 100,
      gross: net * (1 + vatRate / 100),
      costTotal,
      marginAmount: net - costTotal,
      marginPercent: costTotal ? (net - costTotal) / costTotal * 100 : 0,
      media: mediaForQuote(media),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revisions: [{ date: new Date().toISOString(), action: "Bozza generata con EdilKappa AI", actor: "EdilKappa AI" }]
    };
    database.quotes = database.quotes || [];
    database.quotes.push(item);
    linkSourceDocuments(database, artifact, destination, media, false);
    return item;
  }

  function pdfTextSection(doc, title, text, y) {
    if (!text) return y;
    const lines = doc.splitTextToSize(String(text), 180);
    if (y + 14 > 280) { doc.addPage(); y = 18; }
    doc.setFont(undefined, "bold");
    doc.setFontSize(11);
    doc.text(title, 14, y);
    y += 6;
    doc.setFont(undefined, "normal");
    doc.setFontSize(9.5);
    lines.forEach((line) => {
      if (y + 5 > 280) { doc.addPage(); y = 18; }
      doc.text(line, 14, y);
      y += 4.7;
    });
    return y + 5;
  }

  function pdfListSection(doc, title, values, y) {
    const rows = (Array.isArray(values) ? values : []).filter(Boolean);
    if (!rows.length) return y;
    return pdfTextSection(doc, title, rows.map((value) => `• ${value}`).join("\n"), y);
  }

  async function reportPdfBlob(artifact, destination, previews) {
    if (!window.jspdf?.jsPDF) throw new Error("Il generatore PDF non è disponibile. Ricarica la pagina e riprova.");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const company = (window.EdilKappaLocal.getDB().companySettings || [])[0] || {};
    doc.setTextColor(17, 17, 17);
    doc.setFont(undefined, "bold");
    doc.setFontSize(18);
    doc.text(company.name || "EDILKAPPA", 14, 18);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8.5);
    const companyLine = [company.address, company.vat ? `P.IVA ${company.vat}` : "", company.phone, company.email].filter(Boolean).join(" · ");
    if (companyLine) doc.text(companyLine, 14, 24, { maxWidth: 180 });
    doc.setDrawColor(244, 196, 0);
    doc.setLineWidth(1.4);
    doc.line(14, 29, 196, 29);
    doc.setFont(undefined, "bold");
    doc.setFontSize(15);
    doc.text("RELAZIONE TECNICA", 14, 39);
    doc.setFontSize(11);
    doc.text(destination.title, 14, 46, { maxWidth: 180 });
    doc.setFont(undefined, "normal");
    doc.setFontSize(9);
    doc.text(`Cliente: ${destination.client.name}`, 14, 55);
    if (destination.client.address || artifact.address) doc.text(`Indirizzo: ${destination.client.address || artifact.address}`, 14, 61, { maxWidth: 180 });
    doc.text(`Data: ${new Date().toLocaleDateString("it-IT")}`, 14, 67);
    doc.setFillColor(255, 247, 204);
    doc.roundedRect(14, 72, 182, 14, 2, 2, "F");
    doc.setFont(undefined, "bold");
    doc.setFontSize(8.5);
    doc.text("BOZZA TECNICA DA VERIFICARE PRIMA DELL’INVIO O DELLA FIRMA", 18, 81);
    let y = 94;
    const report = artifact.report || {};
    y = pdfTextSection(doc, "Sintesi", report.executiveSummary || artifact.summary, y);
    y = pdfTextSection(doc, "Motivo della revisione", artifact.revisionReason, y);
    y = pdfListSection(doc, "Valutazione tecnica", artifact.technicalAssessment, y);
    y = pdfListSection(doc, "Osservazioni", report.observations, y);
    y = pdfListSection(doc, "Cause probabili", report.probableCauses, y);
    y = pdfListSection(doc, "Fasi operative", artifact.workPhases, y);
    y = pdfListSection(doc, "Materiali previsti", artifact.materials, y);
    y = pdfListSection(doc, "Interventi consigliati", report.recommendedWorks, y);
    y = pdfListSection(doc, "Indicazioni di sicurezza", report.safetyNotes, y);
    y = pdfListSection(doc, "Limiti dell’analisi", report.limitations, y);
    y = pdfTextSection(doc, "Conclusioni", report.conclusions, y);
    y = pdfListSection(doc, "Informazioni da confermare", report.missingInformation, y);
    const usablePreviews = (previews || []).filter((item) => /^data:image\/(jpeg|png);base64,/i.test(item.dataUrl)).slice(0, 6);
    usablePreviews.forEach((preview, index) => {
      doc.addPage();
      doc.setFont(undefined, "bold");
      doc.setFontSize(12);
      doc.text(`${preview.generated ? "Visualizzazione illustrativa AI" : "Immagine analizzata"} ${index + 1}`, 14, 18);
      doc.setFont(undefined, "normal");
      doc.setFontSize(8.5);
      doc.text(preview.sourceName || preview.name || "Allegato", 14, 24, { maxWidth: 180 });
      try {
        const properties = doc.getImageProperties(preview.dataUrl);
        const scale = Math.min(180 / properties.width, 245 / properties.height);
        const width = properties.width * scale;
        const height = properties.height * scale;
        doc.addImage(preview.dataUrl, properties.fileType || "JPEG", 14 + (180 - width) / 2, 31, width, height, undefined, "FAST");
      } catch (_) {
        doc.text("Anteprima non inseribile nel PDF; l’originale resta nell’archivio EdilKappa.", 14, 36);
      }
    });
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setFont(undefined, "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(95, 105, 99);
      doc.text(`EdilKappa · bozza generata con AI · pagina ${page}/${pages}`, 14, 291);
    }
    return doc.output("blob");
  }

  async function previewsForReport(message) {
    const previews = [...(message?.previews || [])];
    const generated = (message?.media || []).filter((item) => item.generated && item.storagePath).slice(0, 3);
    for (const item of generated) {
      try {
        const url = await window.EdilKappaCloud?.getDocumentUrl?.(item.storagePath);
        if (!url) continue;
        const response = await fetch(url);
        if (!response.ok) continue;
        const blob = await response.blob();
        previews.push({
          dataUrl: await fileDataUrl(blob),
          sourceName: item.title || item.fileName,
          name: item.fileName,
          generated: true
        });
      } catch (_) {
        // Il PDF resta generabile anche se una singola anteprima cloud non è disponibile.
      }
    }
    return previews.slice(0, 9);
  }

  async function saveReportArtifact(artifact, destination, media, previews) {
    const database = window.EdilKappaLocal.getDB();
    const existing = (database.documents || []).find((item) => item.aiArtifactId === artifact.id && item.category === "Relazione tecnica AI");
    if (existing) return existing;
    if (!window.EdilKappaCloud?.ready || !window.EdilKappaCloud?.uploadDocument) throw new Error("La connessione cloud non è pronta per salvare il PDF.");
    state.progress = "Genero e archivio la relazione PDF…";
    rerender();
    const blob = await reportPdfBlob(artifact, destination, previews);
    const fileName = `${safeName(destination.title, "Relazione-tecnica")}.pdf`;
    const file = new File([blob], fileName, { type: "application/pdf" });
    const id = aiUid("rel-ai");
    const stored = await window.EdilKappaCloud.uploadDocument(file, {
      documentId: id,
      category: "Relazione tecnica AI",
      client: destination.client.name,
      interventionId: destination.interventionId
    });
    const item = {
      id,
      aiArtifactId: artifact.id,
      aiGenerated: true,
      client: destination.client.name,
      clientId: destination.client.id,
      interventionId: destination.interventionId,
      category: "Relazione tecnica AI",
      title: destination.title,
      notes: `${artifact.summary || ""}\n\nBozza generata con EdilKappa AI e da verificare prima dell’uso.`.trim(),
      date: localDate(),
      sourceMedia: media || [],
      aiArtifact: artifact,
      ...stored,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    database.documents = database.documents || [];
    database.documents.push(item);
    linkSourceDocuments(database, artifact, destination, media, true);
    return item;
  }

  function wordList(title, values) {
    const rows = (Array.isArray(values) ? values : []).filter(Boolean);
    return rows.length ? `<h2>${escapeHtml(title)}</h2><ul>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  }

  function downloadArtifactWord(artifact) {
    artifact = verifiedArtifactPrices(artifact);
    const report = artifact.report || {};
    const quote = artifact.quote || {};
    const company = (window.EdilKappaLocal?.getDB?.().companySettings || [])[0] || {};
    const quoteSubtotal = (quote.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
    const quoteNet = quoteSubtotal * (1 - Number(quote.discountPct || 0) / 100);
    const quoteRows = (quote.lines || []).map((line) => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.quantity)}</td><td>${escapeHtml(line.unit)}</td><td class="num">${escapeHtml(euro(line.unitPrice))}</td><td class="num">${escapeHtml(euro(Number(line.quantity || 0) * Number(line.unitPrice || 0)))}</td></tr>`).join("");
    const options = (quote.options || []).length ? `<h2>Alternative e scenari</h2>${quote.options.map((option) => `<h3>${escapeHtml(option.label ? `${option.label} · ${option.title}` : option.title)} — ${escapeHtml(euro(option.total))} + IVA${option.recommended ? " (raccomandata)" : ""}</h3><p>${escapeHtml(option.description || "")}</p>${wordList("Opere comprese nello scenario", option.includedWorks)}${option.notes ? `<p>${escapeHtml(option.notes)}</p>` : ""}`).join("")}` : "";
    const common = `${artifact.revisionReason ? `<h2>Motivo della revisione</h2><p>${escapeHtml(artifact.revisionReason)}</p>` : ""}${wordList("Valutazione tecnica", artifact.technicalAssessment)}${wordList("Fasi operative", artifact.workPhases)}${wordList("Materiali previsti", artifact.materials)}`;
    const body = artifact.kind === "quote"
      ? `<h2>Sintesi</h2><p>${escapeHtml(artifact.summary || "")}</p>${common}<h2>Quadro economico</h2><table><thead><tr><th>Lavorazione</th><th>Q.tà</th><th>Unità</th><th>Prezzo</th><th>Totale</th></tr></thead><tbody>${quoteRows}</tbody></table><p class="total"><b>Imponibile:</b> ${escapeHtml(euro(quoteNet))}<br><b>IVA ${escapeHtml(quote.vatRate || 0)}%:</b> ${escapeHtml(euro(quoteNet * Number(quote.vatRate || 0) / 100))}<br><b>Totale IVA inclusa:</b> ${escapeHtml(euro(quoteNet * (1 + Number(quote.vatRate || 0) / 100)))}</p>${quote.estimatedDuration ? `<h2>Durata stimata</h2><p>${escapeHtml(quote.estimatedDuration)}</p>` : ""}${wordList("Opere comprese", quote.includedWorks)}${wordList("Esclusioni", quote.exclusions)}${options}${wordList("Ipotesi", quote.assumptions)}${wordList("Informazioni da confermare", quote.missingInformation)}${quote.notes ? `<h2>Note e condizioni</h2><p>${escapeHtml(quote.notes)}</p>` : ""}`
      : `<h2>Sintesi</h2><p>${escapeHtml(report.executiveSummary || artifact.summary || "")}</p>${common}${wordList("Osservazioni", report.observations)}${wordList("Cause probabili", report.probableCauses)}${wordList("Interventi consigliati", report.recommendedWorks)}${wordList("Sicurezza", report.safetyNotes)}${wordList("Limiti dell’analisi", report.limitations)}<h2>Conclusioni</h2><p>${escapeHtml(report.conclusions || "")}</p>${wordList("Informazioni da confermare", report.missingInformation)}`;
    const documentLabel = artifact.kind === "quote" ? "Preventivo" : "Relazione tecnica";
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;line-height:1.5;margin:40px;color:#111}h1{color:#173d2e;border-bottom:4px solid #f4c400;padding-bottom:8px}h2{color:#284c3d;margin-top:24px}h3{color:#173d2e}.warning{background:#fff7cc;border:1px solid #e2c33b;padding:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d7dfda;padding:7px;text-align:left}.num{text-align:right}.total{text-align:right;font-size:1.08em}</style></head><body><h1>${escapeHtml(company.name || "EDILKAPPA")} · ${documentLabel}</h1><p>${escapeHtml([company.address, company.vat ? `P.IVA ${company.vat}` : "", company.phone, company.email].filter(Boolean).join(" · "))}</p><h2>${escapeHtml(artifact.title || artifact.subject || documentLabel)}</h2><p><b>Cliente:</b> ${escapeHtml(artifact.client || "Da assegnare")}<br><b>Indirizzo:</b> ${escapeHtml(artifact.address || "Da confermare")}<br><b>Data:</b> ${escapeHtml(new Date().toLocaleDateString("it-IT"))}</p><p class="warning"><b>Bozza generata con EdilKappa AI.</b> Verificare misure, lavorazioni, prezzi, conclusioni e sicurezza prima dell’uso o dell’invio.</p>${body}</body></html>`;
    const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName(artifact.title || artifact.subject, documentLabel)}.doc`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  window.edilkappaAiView = view;
  window.edilkappaAiSetMode = (mode) => {
    if (!["work", "personal"].includes(mode) || (mode === "personal" && !isOwner()) || state.sending) return;
    state.mode = mode;
    state.attachments = [];
    state.taskType = "auto";
    state.draft = "";
    state.error = "";
    state.progress = "";
    rerender();
  };
  window.edilkappaAiSetTask = (task) => {
    if (!TASKS.has(task) || state.mode !== "work" || state.sending) return;
    state.taskType = task;
    state.error = "";
    rerender();
  };
  window.edilkappaAiSetModel = (modelMode) => {
    if (!MODEL_MODES.has(modelMode) || state.sending) return;
    state.modelMode = modelMode;
    state.error = "";
    rerender();
  };
  window.edilkappaAiUsePrompt = (index) => {
    const item = quickPrompts()[Number(index)];
    if (!item) return;
    state.taskType = item.taskType;
    state.draft = item.prompt;
    rerender();
    setTimeout(() => document.getElementById("ekAiInput")?.focus(), 0);
  };
  window.edilkappaAiDraft = (value) => { state.draft = String(value || ""); };
  window.edilkappaAiToggleWeb = (checked) => { state.useWeb = checked === true; };
  window.edilkappaAiKeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); window.edilkappaAiSend(); }
  };
  window.edilkappaAiRemoveFile = (index) => {
    if (state.sending) return;
    state.attachments.splice(index, 1);
    rerender();
  };
  window.edilkappaAiAddFiles = async (files) => {
    if (state.sending) return;
    state.error = "";
    try {
      const chosen = Array.from(files || []);
      if (state.attachments.length + chosen.length > MAX_ORIGINAL_ATTACHMENTS) throw new Error(`Puoi allegare al massimo ${MAX_ORIGINAL_ATTACHMENTS} file originali per messaggio.`);
      for (const file of chosen) {
        const mimeType = inferredType(file);
        const isImage = /^image\/(jpeg|png|webp|heic|heif)$/i.test(mimeType);
        const isVideo = /^video\/(mp4|quicktime|webm|x-m4v)$/i.test(mimeType);
        if (isImage) {
          if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} supera 50 MB.`);
          state.progress = `Preparo la fotografia ${file.name}…`;
          rerender();
          const prepared = await compressedImage(file);
          state.attachments.push({ name: file.name, mimeType: prepared.mimeType, dataUrl: prepared.dataUrl, kind: "image", file });
        } else if (isVideo) {
          if (file.size > VIDEO_MAX_BYTES) throw new Error(`${file.name} supera 500 MB. Riduci il video prima di allegarlo.`);
          const item = { name: file.name, mimeType, kind: "video", file, frames: [], durationSeconds: 0, warning: "" };
          state.attachments.push(item);
          try {
            const prepared = await extractVideoFrames(file, (current, total) => {
              state.progress = `Estraggo i fotogrammi da ${file.name}: ${current}/${total}`;
              rerender();
            });
            item.frames = prepared.frames;
            item.durationSeconds = prepared.durationSeconds;
          } catch (error) {
            item.warning = error?.message || "Fotogrammi non disponibili.";
          }
        } else {
          if (!mimeType || file.size > DOCUMENT_MAX_BYTES) throw new Error(`${file.name} è troppo grande o non supportato. I documenti per l’AI devono pesare meno di 6 MB.`);
          state.progress = `Leggo il documento ${file.name}…`;
          rerender();
          state.attachments.push({ name: file.name, mimeType, dataUrl: await fileDataUrl(file), kind: "document", file });
        }
      }
      requestAttachmentsFor(state.attachments);
    } catch (error) {
      state.error = error?.message || "Non riesco ad allegare il file.";
    } finally {
      state.progress = "";
      rerender();
    }
  };
  window.edilkappaAiOpenMedia = async (messageIndex, mediaIndex) => {
    const item = artifactMessage(messageIndex)?.media?.[mediaIndex];
    if (!item?.storagePath) return;
    try { await window.EdilKappaCloud?.openDocument?.(item.storagePath); }
    catch (error) { alert(error?.message || "Allegato originale non disponibile."); }
  };
  window.edilkappaAiGenerateVisual = async (messageIndex, briefIndex) => {
    if (state.sending || state.generatingVisual) return;
    const message = artifactMessage(messageIndex);
    const artifact = message?.artifact;
    if (!artifact?.id || !artifact.visualBriefs?.[briefIndex]) return;
    if (!window.EdilKappaCloud?.ready || !window.EdilKappaCloud?.aiRequest) {
      state.error = "Il collegamento cloud non è ancora pronto.";
      rerender();
      return;
    }
    state.generatingVisual = artifact.id;
    state.error = "";
    state.progress = `Creo “${artifact.visualBriefs[briefIndex].title}” con GPT‑5.6 Sol…`;
    rerender();
    try {
      const referenceImages = (message.previews || []).filter((item) => /^image\//i.test(item.mimeType || "")).slice(0, 2);
      const result = await window.EdilKappaCloud.aiRequest({
        action: "generate_visual",
        mode: "work",
        artifactId: artifact.id,
        briefIndex,
        referenceImages
      });
      if (!result.visual) throw new Error("L’immagine non è stata restituita.");
      message.media = [...(message.media || []), result.visual];
    } catch (error) {
      state.error = error?.message || "Non riesco a creare l’immagine illustrativa.";
    } finally {
      state.generatingVisual = "";
      state.progress = "";
      rerender();
    }
  };
  window.edilkappaAiSend = async () => {
    if (state.sending) return;
    const message = String(document.getElementById("ekAiInput")?.value || state.draft || "").trim();
    if (!message && !state.attachments.length) { state.error = "Scrivi una richiesta o allega un file."; rerender(); return; }
    if (!window.EdilKappaCloud?.ready || !window.EdilKappaCloud?.aiRequest) { state.error = "Il collegamento cloud non è ancora pronto."; rerender(); return; }
    const requestedMode = state.mode;
    const originals = state.attachments.slice();
    const shownText = message || "Analizza gli allegati.";
    const userMessage = { role: "user", text: shownText + (originals.length ? `\n📎 ${originals.map((item) => item.name).join(", ")}` : ""), at: Date.now() };
    state.messages[requestedMode].push(userMessage);
    state.sending = true;
    state.error = "";
    state.progress = originals.length ? "Preparo e archivio gli allegati originali…" : "EdilKappa AI sta ragionando…";
    rerender();
    try {
      const requestAttachments = requestAttachmentsFor(originals);
      if (requestedMode === "personal" && originals.some((item) => item.kind === "video" && !item.frames.length)) {
        throw new Error("Questo video non può essere letto dal browser. Prova a convertirlo in MP4 oppure usalo in modalità Lavoro per tentare la trascrizione audio.");
      }
      const mediaReferences = [];
      const archiveWarnings = [];
      if (requestedMode === "work") {
        for (const [index, item] of originals.entries()) {
          const stored = await archiveOriginal(item, index, originals.length);
          if (stored) mediaReferences.push(stored);
          else if (item.archiveError) archiveWarnings.push(item.name);
        }
      }
      userMessage.media = mediaReferences;
      state.progress = originals.some((item) => item.kind === "video") ? "Trascrivo l’audio, analizzo i fotogrammi e preparo il risultato…" : "Analizzo gli allegati e preparo il risultato…";
      rerender();
      const result = await window.EdilKappaCloud.aiRequest({
        action: "ask",
        mode: requestedMode,
        taskType: requestedMode === "work" ? state.taskType : "auto",
        modelMode: state.modelMode,
        message,
        attachments: requestAttachments,
        mediaReferences,
        useWeb: state.useWeb,
        businessContext: requestedMode === "work" ? businessContext() : null
      });
      state.messages[requestedMode].push({
        role: "assistant",
        text: result.answer,
        sources: result.sources || [],
        artifact: result.artifact || null,
        media: result.media || mediaReferences,
        model: result.model || "",
        modelLabel: result.modelLabel || "",
        reasoningEffort: result.reasoningEffort || "",
        previews: requestAttachments.filter((item) => item.mimeType.startsWith("image/")).slice(0, 6),
        at: Date.now()
      });
      state.loaded[requestedMode] = true;
      state.attachments = [];
      state.draft = "";
      if (archiveWarnings.length) state.error = `Analisi completata, ma questi originali non sono stati archiviati: ${archiveWarnings.join(", ")}. Riprova il caricamento prima di usare il documento definitivo.`;
    } catch (error) {
      state.error = error?.message || "La richiesta non è riuscita. Riprova.";
    } finally {
      state.sending = false;
      state.progress = "";
      rerender();
    }
  };
  window.edilkappaAiDestinationChanged = (select) => {
    const target = select.form?.querySelector('[name="interventionId"]');
    if (target) target.innerHTML = interventionOptions(select.value, "");
  };
  window.edilkappaAiSaveArtifact = (messageIndex) => {
    const message = artifactMessage(messageIndex);
    const artifact = message?.artifact;
    if (!artifact || !["quote", "report"].includes(artifact.kind)) return;
    const existing = artifactSavedItem(artifact);
    if (existing) return window.edilkappaAiOpenSaved(messageIndex);
    const database = window.EdilKappaLocal?.getDB?.() || {};
    if (!(database.condomini || []).length) return alert("Crea prima il cliente o condominio, poi torna qui per salvare il documento nella scheda corretta.");
    if (typeof window.modal !== "function") return alert("Il modulo di salvataggio non è disponibile. Ricarica la pagina.");
    window.modal(artifact.kind === "quote" ? "Salva preventivo AI" : "Salva relazione AI", destinationBody(artifact), async (form) => {
      const client = (database.condomini || []).find((item) => item.id === form.get("clientId"));
      if (!client) throw new Error("Seleziona il cliente corretto.");
      const interventionId = String(form.get("interventionId") || "");
      if (interventionId && !interventionsForClient(client.id).some((item) => item.id === interventionId)) throw new Error("L’intervento selezionato non appartiene a questo cliente.");
      const destination = { client, interventionId, title: String(form.get("title") || "").trim() };
      const saved = artifact.kind === "quote"
        ? saveQuoteArtifact(artifact, destination, message.media || [])
        : await saveReportArtifact(artifact, destination, message.media || [], await previewsForReport(message));
      state.progress = "";
      setTimeout(() => {
        if (artifact.kind === "quote") {
          window.EdilKappaLocal?.go?.("quotes");
          setTimeout(() => window.openQuote?.(saved.id), 80);
        } else {
          window.EdilKappaLocal?.go?.("documentsView");
        }
      }, 80);
    });
  };
  window.edilkappaAiOpenSaved = (messageIndex) => {
    const artifact = artifactMessage(messageIndex)?.artifact;
    const saved = artifactSavedItem(artifact);
    if (!saved) return;
    if (artifact.kind === "quote") {
      window.EdilKappaLocal?.go?.("quotes");
      setTimeout(() => window.openQuote?.(saved.id), 80);
    } else {
      window.EdilKappaLocal?.go?.("documentsView");
      setTimeout(() => window.openBusinessDocument?.(saved.id), 100);
    }
  };
  window.edilkappaAiDownloadWord = (messageIndex) => {
    const artifact = artifactMessage(messageIndex)?.artifact;
    if (["quote", "report"].includes(artifact?.kind)) downloadArtifactWord(artifact);
  };
  window.edilkappaAiReset = async () => {
    if (state.resetting || !confirm(`Cancellare tutta la memoria ${state.mode === "work" ? "di lavoro" : "personale"} di EdilKappa AI?`)) return;
    state.resetting = true;
    state.error = "";
    try {
      await window.EdilKappaCloud.aiRequest({ action: "reset", mode: state.mode });
      state.messages[state.mode] = [];
      state.loaded[state.mode] = true;
    } catch (error) {
      state.error = error?.message || "Non riesco a cancellare la memoria.";
    } finally {
      state.resetting = false;
      rerender();
    }
  };
})();
