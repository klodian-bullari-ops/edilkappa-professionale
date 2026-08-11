(function () {
  "use strict";

  const MAX_ORIGINAL_ATTACHMENTS = 8;
  const MAX_REQUEST_ATTACHMENTS = 16;
  const MAX_REQUEST_BYTES = 15 * 1024 * 1024;
  const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
  const DOCUMENT_MAX_BYTES = 6 * 1024 * 1024;
  const HEIC_MAX_BYTES = 25 * 1024 * 1024;
  const PDF_PHOTO_MAX_BYTES = 50 * 1024 * 1024;
  const PDF_PHOTO_CHUNK_MAX_BYTES = 3 * 1024 * 1024;
  const PDF_PHOTO_RETRY_DELAYS = [0, 450, 1200];
  const TASKS = new Set(["auto", "quote", "report", "inspection"]);
  const MODEL_MODES = new Set(["auto", "sol", "terra"]);
  const PHOTO_ORIGINS = new Set(["sopralluogo_edilkappa", "cliente", "da_confermare"]);
  const DEFAULT_PHOTO_ORIGIN = "sopralluogo_edilkappa";
  const PENDING_JOB_KEY = "edilkappa-ai-pending-job-v1";
  const PENDING_JOB_UI_TIMEOUT_MS = 11 * 60 * 1000;
  const EDILKAPPA_DOCUMENT = Object.freeze({
    legalName: "EDILKAPPA S.A.S. DI BULLARI KLODIAN & C.",
    activity: "Lavori di completamento e finitura degli edifici",
    email: "info@edilkappa.com",
    phone: "+39 351 9332154",
    address: "Via Sant’Ambrogio 38, 20055 Vimodrone (MI)",
    vat: "14041000960",
    yellow: [255, 216, 0],
    dark: [35, 35, 35],
    light: [242, 243, 245]
  });
  const EDILKAPPA_PDF_FONT = "DejaVuSans";
  const pdfPhotoCache = new Map();

  const state = {
    mode: "work",
    messages: { work: [], personal: [] },
    loaded: { work: false, personal: false },
    conversations: { work: [], personal: [] },
    conversationsLoaded: { work: false, personal: false },
    activeConversation: { work: "legacy", personal: "legacy" },
    loading: false,
    sending: false,
    resetting: false,
    focusMode: false,
    sidebarBeforeFocus: false,
    generatingVisual: "",
    auditingPdf: "",
    attachments: [],
    taskType: "auto",
    modelMode: "auto",
    draft: "",
    progress: "",
    useWeb: false,
    photoOrigin: DEFAULT_PHOTO_ORIGIN,
    error: "",
    pendingJob: null,
    retryAvailable: false,
    nextHistoryAttempt: 0
  };

  const css = document.createElement("style");
  css.textContent = `
    .ekAiPage{max-width:1180px;margin:0 auto}.ekAiPage.focusMode{max-width:none}.ekAiHero{background:linear-gradient(135deg,#102c22,#1e4938);border-radius:22px;padding:22px;color:#fff;display:flex;justify-content:space-between;gap:18px;align-items:center;box-shadow:0 14px 40px rgba(11,43,31,.14)}
    .ekAiHero h2{margin:0 0 6px;font-size:25px}.ekAiHero p{margin:0;color:#d7e9df;max-width:720px}.ekAiHeroMark{width:58px;height:58px;border-radius:18px;background:#f4c400;color:#102c22;display:grid;place-items:center;font-size:30px;font-weight:900;flex:0 0 auto}
    .ekAiToolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:16px 0}.ekAiModes{display:flex;padding:4px;border:1px solid #d9e2dc;background:#fff;border-radius:13px}.ekAiModes button{border:0;background:transparent;border-radius:10px;padding:10px 15px;font-weight:800;color:#557064;cursor:pointer}.ekAiModes button.active{background:#173d2e;color:#fff}.ekAiToolbarRight{display:flex;align-items:center;justify-content:flex-end;gap:10px}.ekAiFocusButton{border:1px solid #d6e2da;background:#fff;color:#173d2e;border-radius:11px;padding:9px 12px;font-weight:850;cursor:pointer;white-space:nowrap}.ekAiFocusButton.active{background:#173d2e;color:#fff}.ekAiStatus{display:flex;gap:8px;align-items:center;color:#577064;font-size:13px}.ekAiDot{width:9px;height:9px;border-radius:50%;background:#22a565;box-shadow:0 0 0 4px #dff4e8}
    .ekAiWorkflow{display:flex;gap:8px;flex-wrap:wrap;margin:-3px 0 13px;align-items:center}.ekAiWorkflow button{border:1px solid #d6e2da;background:#fff;color:#244a3a;border-radius:12px;padding:9px 12px;font-weight:800;cursor:pointer}.ekAiWorkflow button.active{background:#fff7cc;border-color:#e1bd20;color:#292300}.ekAiWorkflow small{display:flex;align-items:center;color:#65776f}.ekAiModel{display:flex;gap:7px;align-items:center;margin-left:auto;color:#536a60;font-size:12px;font-weight:800}.ekAiModel select{border:1px solid #d6e2da;background:#fff;border-radius:10px;padding:8px;color:#173d2e;font-weight:800}
    .ekAiChat{min-height:440px;max-height:60vh;overflow:auto;background:#f7faf8;border:1px solid #dce7e0;border-radius:20px;padding:18px;display:flex;flex-direction:column;gap:13px}.ekAiEmpty{margin:auto;text-align:center;max-width:650px;color:#52665d;padding:28px}.ekAiEmpty strong{display:block;color:#173d2e;font-size:20px;margin-bottom:7px}
    .ekAiMessage{max-width:90%;border-radius:17px;padding:13px 15px;line-height:1.5;box-shadow:0 3px 12px rgba(20,53,40,.06)}.ekAiMessage.user{align-self:flex-end;background:#173d2e;color:#fff;border-bottom-right-radius:5px;max-width:84%}.ekAiMessage.assistant{align-self:flex-start;background:#fff;color:#1d3028;border:1px solid #dce7e0;border-bottom-left-radius:5px}.ekAiText{white-space:pre-wrap;overflow-wrap:anywhere}.ekAiMessageMeta{font-size:10px;color:#71827a;margin-top:8px}.ekAiSources{margin-top:11px;padding-top:9px;border-top:1px solid #e3ebe6;display:flex;gap:7px;flex-wrap:wrap}.ekAiSources a{font-size:12px;color:#176542;text-decoration:none;background:#e8f6ed;border-radius:999px;padding:5px 9px}.ekAiMessageMedia{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.ekAiMessageMedia button{border:1px solid #d6e2da;background:#f8faf9;border-radius:9px;padding:6px 9px;color:#284c3d;font-size:12px;font-weight:750}.ekAiMessageMedia button.generated{background:#fff7cc;border-color:#dfc243}.ekAiMessage.user .ekAiMessageMedia button{background:#fff;color:#173d2e}
    .ekAiTyping{display:inline-flex;gap:5px}.ekAiTyping i{width:7px;height:7px;background:#668078;border-radius:50%;animation:ekAiPulse 1.1s infinite}.ekAiTyping i:nth-child(2){animation-delay:.15s}.ekAiTyping i:nth-child(3){animation-delay:.3s}@keyframes ekAiPulse{0%,70%,100%{opacity:.3;transform:translateY(0)}35%{opacity:1;transform:translateY(-3px)}}
    .ekAiArtifact{margin-top:14px;border:1px solid #cbd9d0;border-radius:16px;overflow:hidden;background:#fcfdfc}.ekAiArtifactHead{padding:13px 14px;background:#eef5f0;display:flex;gap:12px;justify-content:space-between;align-items:flex-start}.ekAiArtifactHead strong{display:block;color:#173d2e}.ekAiArtifactHead small{display:block;color:#607168;margin-top:3px}.ekAiArtifactBody{padding:14px}.ekAiArtifactTable{width:100%;border-collapse:collapse;font-size:12px;min-width:660px}.ekAiArtifactTable th,.ekAiArtifactTable td{padding:8px;border-bottom:1px solid #e0e7e2;text-align:left;vertical-align:top}.ekAiArtifactTable th{color:#607168;background:#f8faf8;font-size:10px;text-transform:uppercase}.ekAiArtifactTable .right{text-align:right;white-space:nowrap}.ekAiTableWrap{overflow:auto;border:1px solid #e0e7e2;border-radius:11px}.ekAiPriceSource{display:inline-flex;border-radius:999px;padding:3px 7px;background:#eaf3ee;color:#246143;font-size:10px;font-weight:850;white-space:nowrap}.ekAiPriceSource.estimate{background:#fff2c7;color:#775a00}.ekAiPriceSource.missing{background:#ffe5e3;color:#922e27}.ekAiArtifactTotals{display:grid;grid-template-columns:1fr auto;gap:4px 18px;width:min(330px,100%);margin:12px 0 0 auto;font-size:13px}.ekAiArtifactTotals b{text-align:right}.ekAiArtifactSection{margin-top:13px}.ekAiArtifactSection h4{margin:0 0 6px;color:#284c3d}.ekAiArtifactSection ul{margin:5px 0;padding-left:20px}.ekAiArtifactSection li{margin:4px 0}.ekAiMethod{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:9px;margin-top:13px}.ekAiMethod>div{border:1px solid #dce4df;border-radius:11px;padding:10px;background:#fff}.ekAiMethod b{display:block;color:#284c3d;margin-bottom:5px}.ekAiPricingCheck{margin-top:13px;border:1px solid #d8b600;background:#fffbee;border-radius:12px;padding:11px}.ekAiPricingGrid{display:grid;grid-template-columns:1fr auto;gap:4px 14px;margin-top:8px;font-size:12px}.ekAiPricingGrid b{text-align:right}.ekAiEvidenceTable{min-width:720px}.ekAiPriority{display:inline-flex;padding:4px 8px;border-radius:999px;background:#fff2c7;color:#775a00;font-size:11px;font-weight:850}.ekAiOption{border:1px solid #d8e3dc;border-radius:11px;padding:10px;margin-top:8px}.ekAiOption.recommended{border-color:#d8b600;background:#fffbee}.ekAiOptionHead{display:flex;justify-content:space-between;gap:10px}.ekAiVisualBrief{border-left:4px solid #f4c400;background:#f8faf8;padding:9px 10px;margin-top:7px}.ekAiArtifactNotice{background:#fff7d9;border:1px solid #ecd987;border-radius:11px;padding:10px;margin-top:11px;color:#695300;font-size:12px}.ekAiArtifactActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.ekAiArtifactActions button{border:0;border-radius:10px;padding:9px 12px;font-weight:850;cursor:pointer;background:#173d2e;color:#fff}.ekAiArtifactActions button.secondary{background:#fff;color:#173d2e;border:1px solid #cbd9d0}.ekAiArtifactActions button.visual{background:#f4c400;color:#173d2e}.ekAiArtifactActions button.saved{background:#e7f4eb;color:#176542;border:1px solid #b9ddc5}.ekAiArtifactActions button:disabled{opacity:.55;cursor:wait}
    .ekAiQuotePreview{background:#fff;border:1px solid #d8d8d2;border-radius:4px;padding:clamp(18px,4vw,38px);box-shadow:0 10px 30px rgba(31,42,36,.10);max-width:820px;margin:0 auto}.ekAiQuoteBrand{display:flex;justify-content:space-between;gap:14px;border-bottom:5px solid #f4c400;padding-bottom:14px;margin-bottom:20px}.ekAiQuoteBrand h3{margin:0;color:#173d2e}.ekAiQuoteBrand small{display:block;color:#64766e}.ekAiQuoteBrand b{font-size:18px}.ekAiQuoteIntro{font-size:14px;margin-bottom:18px}.ekAiQuotePreview .ekAiArtifactTable{min-width:560px}.ekAiQuoteDetails{max-width:820px;margin:14px auto 0;border:1px solid #dce4df;border-radius:11px;background:#f8faf8;padding:10px 12px}.ekAiQuoteDetails summary{cursor:pointer;font-weight:850;color:#284c3d}.ekAiQuoteDetails[open] summary{margin-bottom:10px}.ekAiQuoteApproval{max-width:820px;margin:12px auto 0;background:#eef8f1;border:1px solid #bcdcc7;border-radius:11px;padding:11px;color:#185d38;font-size:12px}.ekAiMissingQuestions{max-width:820px;margin:12px auto 0;background:#fff8dc;border:1px solid #e6cf6a;border-radius:11px;padding:12px;color:#5e4b00}.ekAiMissingQuestions h4{margin:0 0 7px;color:#493b00}.ekAiMissingQuestions ol{margin:0;padding-left:21px}.ekAiMissingQuestions li{margin:6px 0}.ekAiMissingQuestions small{display:block;margin-top:8px;color:#6d5d1f}
    .ekAiQuick{display:flex;gap:8px;flex-wrap:wrap;margin:13px 0}.ekAiQuick button{border:1px solid #d6e2da;background:#fff;color:#244a3a;border-radius:999px;padding:8px 12px;font-weight:700;cursor:pointer}.ekAiQuick button:hover{border-color:#6da482}
    .ekAiWorkspace{display:grid;grid-template-columns:255px minmax(0,1fr);gap:13px}.ekAiPage.focusMode .ekAiWorkspace{grid-template-columns:minmax(0,1fr)}.ekAiPage.focusMode .ekAiThreads{display:none}.ekAiThreads{border:1px solid #dce7e0;border-radius:18px;background:#fff;padding:10px;min-height:440px;max-height:60vh;overflow:auto}.ekAiNewThread{width:100%;border:0;border-radius:11px;background:#f4c400;color:#173d2e;padding:11px;font-weight:900;cursor:pointer;margin-bottom:9px}.ekAiThread{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px;align-items:center;border-radius:11px;padding:7px;color:#315345}.ekAiThread.active{background:#eaf3ee;color:#173d2e}.ekAiThreadMain{border:0;background:transparent;text-align:left;min-width:0;cursor:pointer;color:inherit}.ekAiThreadMain b,.ekAiThreadMain small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ekAiThreadMain small{font-size:10px;color:#75867e;margin-top:3px}.ekAiThreadActions{display:flex;gap:2px}.ekAiThreadAction{width:30px;height:30px;border:0;border-radius:8px;background:transparent;cursor:pointer;color:#526b60;font-size:14px}.ekAiThreadAction:hover{background:#dcebe2}.ekAiThreadAction.delete{color:#9b2f2f}.ekAiThreadAction.delete:hover{background:#ffe8e6}.ekAiMain{min-width:0}.ekAiHoursButton{border:1px solid #d6e2da;background:#fff;border-radius:11px;padding:9px 12px;color:#173d2e;font-weight:850;cursor:pointer}
    .ekAiComposer{background:#fff;border:1px solid #d8e3dc;border-radius:18px;padding:12px;box-shadow:0 8px 28px rgba(17,56,41,.08)}.ekAiComposer textarea{border:0!important;box-shadow:none!important;resize:vertical;min-height:82px;width:100%;padding:7px;font:inherit;outline:0;background:transparent}.ekAiComposeBar{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}.ekAiActions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ekAiFileBtn,.ekAiWeb,.ekAiPhotoOrigin{display:inline-flex;align-items:center;gap:7px;border:1px solid #d7e2db;background:#f8faf9;border-radius:10px;padding:9px 11px;font-weight:700;color:#365749;cursor:pointer;font-size:13px}.ekAiWeb input{width:auto}.ekAiPhotoOrigin select{border:0;background:transparent;color:#365749;font:inherit;font-weight:800;max-width:210px;outline:0}.ekAiSend{border:0;background:#f4c400;color:#143528;border-radius:11px;padding:11px 18px;font-weight:900;cursor:pointer}.ekAiSend:disabled{opacity:.55;cursor:wait}.ekAiFiles{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 9px}.ekAiFile{display:flex;align-items:center;gap:8px;background:#edf4ef;color:#355246;border-radius:11px;padding:6px 8px;font-size:12px;max-width:min(100%,300px)}.ekAiFileThumb{width:42px;height:42px;object-fit:cover;border-radius:8px;background:#dce8e0;flex:0 0 auto}.ekAiFileIcon{width:42px;height:42px;border-radius:8px;background:#dce8e0;display:grid;place-items:center;font-size:20px;flex:0 0 auto}.ekAiFileBody{min-width:0;flex:1}.ekAiFileBody b,.ekAiFileBody small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ekAiFileBody small{color:#62766c;margin-top:2px}.ekAiFile button{border:0;background:transparent;color:#9b2f2f;font-weight:900;cursor:pointer;font-size:18px}.ekAiUploadHelp{width:100%;font-size:11px;color:#667970;margin-top:7px}.ekAiProgress{margin:10px 0;background:#edf6f0;border:1px solid #c7ddcf;color:#24543f;border-radius:11px;padding:12px;font-size:13px}.ekAiSteps{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:9px}.ekAiStep{padding:7px 5px;border-radius:8px;background:#dce9e1;color:#61736a;text-align:center;font-size:10px;font-weight:800}.ekAiStep.done{background:#bfe3ca;color:#175c35}.ekAiStep.active{background:#f4c400;color:#292300}.ekAiError{margin:10px 0;background:#fff0f0;border:1px solid #f1c8c8;color:#8f2929;border-radius:11px;padding:10px 12px}.ekAiRetry{margin-left:9px;border:1px solid #c65d57;background:#fff;color:#8f2929;border-radius:8px;padding:6px 9px;font-weight:800}.ekAiPrivacy{font-size:12px;color:#64766e;margin:10px 2px 0}.ekAiReset{border:0;background:transparent;color:#7b3c3c;text-decoration:underline;cursor:pointer;font-size:12px}
    @media(max-width:700px){.ekAiHero{padding:18px}.ekAiHeroMark{width:48px;height:48px}.ekAiToolbar{align-items:flex-start}.ekAiStatus,.ekAiFocusButton{display:none}.ekAiWorkspace{grid-template-columns:1fr}.ekAiThreads{min-height:0;max-height:170px}.ekAiModel{width:100%;margin-left:0}.ekAiModel select{flex:1}.ekAiChat{min-height:360px;max-height:54vh;padding:12px}.ekAiMessage,.ekAiMessage.user{max-width:96%}.ekAiComposer{padding:10px}.ekAiComposeBar,.ekAiActions{align-items:stretch}.ekAiSend{flex:1}.ekAiWeb{justify-content:center}.ekAiArtifactHead{flex-direction:column}.ekAiArtifactActions button{flex:1}}
  `;
  document.head.appendChild(css);

  function loadPendingJob() {
    try {
      const value = JSON.parse(globalThis.localStorage?.getItem(PENDING_JOB_KEY) || "null");
      return value?.jobId ? value : null;
    } catch (_) {
      return null;
    }
  }

  function rememberPendingJob(value) {
    state.pendingJob = value || null;
    try {
      if (value?.jobId) globalThis.localStorage?.setItem(PENDING_JOB_KEY, JSON.stringify(value));
      else globalThis.localStorage?.removeItem(PENDING_JOB_KEY);
    } catch (_) {}
  }

  function pendingJobCanResume(job) {
    return Boolean(job?.jobId && job.failed !== true && !["failed", "timeout", "expired"].includes(job.stage));
  }

  function stageLabel(stage) {
    return ({
      archive: "Archivio gli allegati originali…",
      agent: "Agente EdilKappa Preventivi · analisi, prezzi e controllo della bozza…",
      review: "Secondo revisore indipendente · coerenza tecnica, somme, IVA e dati mancanti…",
      analysis: "1/2 · Analisi tecnica, evidenze e incertezze…",
      compose: "2/2 · Compongo prezzi e documento EdilKappa…",
      retry: "La risposta si è interrotta: nuovo tentativo automatico con Sol…",
      fallback: "Sol non ha completato: continuo automaticamente con Terra…",
      check: "Controllo somme, margine, IVA e dati mancanti…",
      completed: "Controllo finale completato."
    })[stage] || "EdilKappa AI sta elaborando…";
  }

  function progressStepsHtml(stage) {
    const stages = ["archive", "analysis", "compose", "check", "completed"];
    const labels = ["Allegati", "Analisi", "Documento", "Controllo", "Pronto"];
    const normalized = stage === "retry" || stage === "fallback" || stage === "agent" ? "compose" : stage === "review" ? "check" : stage;
    const active = Math.max(0, stages.indexOf(normalized));
    return `<div class="ekAiSteps">${labels.map((label, index) => `<span class="ekAiStep ${index < active ? "done" : index === active ? "active" : ""}">${label}</span>`).join("")}</div>`;
  }

  state.pendingJob = loadPendingJob();

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

  function normalizePhotoOrigin(value, fallback = "da_confermare") {
    const normalized = String(value || "").trim().toLowerCase();
    const safeFallback = PHOTO_ORIGINS.has(fallback) ? fallback : "da_confermare";
    return PHOTO_ORIGINS.has(normalized) ? normalized : safeFallback;
  }

  function photoOriginDescription(value) {
    return ({
      sopralluogo_edilkappa: "acquisita da EdilKappa durante il sopralluogo",
      cliente: "ricevuta dal committente",
      da_confermare: "con origine da confermare"
    })[normalizePhotoOrigin(value)];
  }

  function customerFacingText(value) {
    return String(value ?? "")
      .replace(/\bbozza\s+parametrica\b/gi, "bozza preliminare")
      .replace(/\b(?:bozza(?:\s+preliminare)?|documento|relazione|preventivo)\s+(?:generat[oa]|creat[oa]|prodott[oa]|elaborat[oa])\s+(?:con|tramite|da(?:ll[’']?)?)\s*(?:EdilKappa\s*)?(?:AI|intelligenza\s+artificiale|OpenAI)\b/gi, (match) => {
        const phrase = /^bozza/i.test(match)
          ? "bozza preliminare predisposta da EdilKappa"
          : /^relazione/i.test(match)
            ? "relazione predisposta da EdilKappa"
            : /^preventivo/i.test(match)
              ? "preventivo predisposto da EdilKappa"
              : "documento predisposto da EdilKappa";
        return /^[A-ZÀ-Ý]/.test(match) ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
      })
      .replace(/\b(?:immagine|visualizzazione)\s+illustrativa\s+(?:generat[ao]|creat[ao])\s+(?:con|tramite|da(?:ll[’']?)?)\s*(?:EdilKappa\s*)?(?:AI|intelligenza\s+artificiale|OpenAI)\b/gi, "visualizzazione illustrativa della soluzione proposta")
      .replace(/\bEdilKappa\s+AI\b/gi, "EdilKappa")
      .replace(/\b(?:OpenAI|ChatGPT|GPT(?:-[\w.]+)?)\b/gi, "EdilKappa")
      .replace(/\bintelligenza\s+artificiale\b/gi, "procedura tecnica EdilKappa")
      .replace(/\bstima\s+AI\b/gi, "stima tecnica")
      .replace(/\brevisione\s+AI\s+indipendente\b/gi, "verifica documentale indipendente")
      .replace(/\bAI\b/gi, "EdilKappa")
      .replace(/\bEdilKappa(?:\s+EdilKappa)+\b/gi, "EdilKappa")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim();
  }

  function customerFacingDocumentValue(value) {
    if (Array.isArray(value)) return value.map(customerFacingDocumentValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, customerFacingDocumentValue(entry)]));
    }
    return typeof value === "string" ? customerFacingText(value) : value;
  }

  function euro(value) {
    const number = Number(value || 0);
    const safe = Number.isFinite(number) ? number : 0;
    const sign = safe < 0 ? "-" : "";
    const [integer, decimals] = Math.abs(safe).toFixed(2).split(".");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${sign}${grouped},${decimals} €`;
  }

  function formatEstimatedDuration(value) {
    const duration = String(value || "")
      .replace(/[\u2012\u2013\u2014\u2212]/g, "-")
      .replace(/(\d)\s*-\s*(\d)/g, "$1-$2")
      .replace(/\s+/g, " ")
      .trim();
    if (!duration) return "Da confermare: indica un numero o un intervallo, per esempio 8-12 giorni lavorativi.";
    const limits = [
      { pattern: /\b(\d{1,5})\s*(?:giorn\w*|gg)\b/gi, maximum: 365 },
      { pattern: /\b(\d{1,4})\s*settiman\w*\b/gi, maximum: 104 },
      { pattern: /\b(\d{1,4})\s*mes\w*\b/gi, maximum: 60 }
    ];
    const implausible = limits.some(({ pattern, maximum }) =>
      [...duration.matchAll(pattern)].some((match) => Number(match[1]) > maximum)
    );
    return implausible
      ? "Da confermare: il valore generato non è plausibile; indica un numero o un intervallo, per esempio 8-12 giorni lavorativi."
      : duration;
  }

  function estimatedDurationNeedsConfirmation(value) {
    const duration = formatEstimatedDuration(value);
    return /da\s+(?:confermare|definire|verificare)|non\s+[èe]\s+plausibile/i.test(duration);
  }

  function humanFileSize(value) {
    const bytes = Number(value || 0);
    if (!bytes) return "dimensione non disponibile";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB`;
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
    const rows = customerFacingValues(values);
    return rows.length ? `<div class="ekAiArtifactSection"><h4>${escapeHtml(title)}</h4><ul>${rows.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul></div>` : "";
  }

  function artifactMethodHtml(artifact) {
    const blocks = [];
    if (artifact.recommendedSolution) blocks.push(`<div><b>Soluzione raccomandata</b>${escapeHtml(artifact.recommendedSolution)}</div>`);
    if (artifact.decisionRationale) blocks.push(`<div><b>Motivazione tecnica</b>${escapeHtml(artifact.decisionRationale)}</div>`);
    const overview = blocks.length ? `<div class="ekAiMethod">${blocks.join("")}</div>` : "";
    return `${overview}${artifactList("Evidenze utilizzate", artifact.evidence)}${artifactList("Incertezze e verifiche", artifact.uncertainties)}`;
  }

  function pricingAnalysisHtml(artifact) {
    if (!isOwner() || artifact?.kind !== "quote") return "";
    const pricing = artifact.quote?.pricingAnalysis || {};
    const values = [pricing.laborCost, pricing.materialCost, pricing.equipmentCost, pricing.transportAndDisposalCost, pricing.subcontractCost, pricing.overheadAndRiskCost, pricing.contingencyCost, pricing.estimatedDirectCost, pricing.proposedNetPrice];
    if (!values.some((value) => Number(value) > 0) && !(pricing.rationale || []).length && !(pricing.verificationChecks || []).length) return "";
    const rows = [
      ["Manodopera", pricing.laborCost], ["Materiali e sfridi", pricing.materialCost], ["Mezzi e noleggi", pricing.equipmentCost],
      ["Trasporto e smaltimento", pricing.transportAndDisposalCost], ["Subappalti", pricing.subcontractCost], ["Generali e rischio", pricing.overheadAndRiskCost],
      ["Imprevisti", pricing.contingencyCost], ["Costo diretto stimato", pricing.estimatedDirectCost], [`Prezzo netto proposto · margine obiettivo ${Number(pricing.targetMarginPct || 0).toLocaleString("it-IT")}%`, pricing.proposedNetPrice]
    ];
    return `<div class="ekAiPricingCheck"><b>Controllo economico interno · non esportato al cliente</b><div class="ekAiPricingGrid">${rows.map(([label, value]) => `<span>${escapeHtml(label)}</span><b>${euro(value)}</b>`).join("")}</div>${artifactList("Criteri di prezzo", pricing.rationale)}${artifactList("Controlli da eseguire", pricing.verificationChecks)}</div>`;
  }

  function evidenceFindingsHtml(report) {
    const rows = Array.isArray(report?.evidenceFindings) ? report.evidenceFindings : [];
    if (!rows.length) return "";
    return `<div class="ekAiArtifactSection"><h4>Riscontro tra prove e valutazione</h4><div class="ekAiTableWrap"><table class="ekAiArtifactTable ekAiEvidenceTable"><thead><tr><th>Riferimento</th><th>Osservazione</th><th>Valutazione prudente</th><th>Da verificare</th></tr></thead><tbody>${rows.map((item) => `<tr><td><b>${escapeHtml(item.reference)}</b></td><td>${escapeHtml(item.observation)}</td><td>${escapeHtml(item.assessment)}</td><td>${escapeHtml(item.verificationNeeded)}</td></tr>`).join("")}</tbody></table></div></div>`;
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
      const normalizedReference = reference.toLocaleLowerCase("it");
      const priceItem = priceList.find((item) => {
        const id = String(item.id || "");
        const code = String(item.code || "");
        return id === reference || code === reference || (code && normalizedReference.includes(code.toLocaleLowerCase("it")));
      });
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
    const pricingAnalysis = artifact.quote?.pricingAnalysis || {};
    const proposedNetPrice = Number(pricingAnalysis.proposedNetPrice || 0);
    const priceAlignmentWarning = proposedNetPrice && Math.abs(proposedNetPrice - mainNet) > 0.02
      ? `Il controllo economico interno è stato riallineato all’imponibile ricalcolato dal gestionale (${euro(mainNet)}).`
      : "";
    return {
      ...artifact,
      quote: {
        ...(artifact.quote || {}),
        lines,
        options: (artifact.quote?.options || []).map((option) => option.recommended && lines.length ? { ...option, total: mainNet } : { ...option }),
        pricingAnalysis: {
          ...pricingAnalysis,
          proposedNetPrice: mainNet,
          verificationChecks: Array.from(new Set([...(pricingAnalysis.verificationChecks || []), priceAlignmentWarning].filter(Boolean)))
        },
        missingInformation: Array.from(new Set([...(artifact.quote?.missingInformation || []), ...warnings]))
      }
    };
  }

  function quoteReleaseCheck(rawArtifact, destination = null) {
    const artifact = verifiedArtifactPrices(rawArtifact);
    if (artifact?.kind !== "quote") return { passed: true, issues: [], artifact };
    const quote = artifact.quote || {};
    const lines = Array.isArray(quote.lines) ? quote.lines : [];
    const issues = [];
    if (quote.readyToSave !== true) issues.push("Il revisore non ha ancora dichiarato la bozza pronta al rilascio.");
    if (!lines.length) issues.push("Il preventivo non contiene lavorazioni.");
    lines.forEach((line, index) => {
      const label = `Riga ${index + 1} · ${line.description || "lavorazione"}`;
      if (!(Number(line.quantity) > 0)) issues.push(`${label}: quantità mancante o pari a zero.`);
      if (!(Number(line.unitPrice) > 0)) issues.push(`${label}: prezzo unitario mancante o pari a zero.`);
      if (line.priceSource === "da_definire") issues.push(`${label}: prezzo ancora da definire.`);
    });
    const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
    const net = subtotal * (1 - Number(quote.discountPct || 0) / 100);
    if (!(subtotal > 0)) issues.push("Il totale delle lavorazioni è pari a zero.");
    const pricing = quote.pricingAnalysis || {};
    const fullCost = [
      pricing.estimatedDirectCost,
      pricing.overheadAndRiskCost,
      pricing.contingencyCost
    ].reduce((sum, value) => sum + Number(value || 0), 0);
    if (fullCost > 0 && net + 0.02 < fullCost) issues.push(`Il prezzo di vendita (${euro(net)}) è inferiore al costo complessivo stimato (${euro(fullCost)}).`);
    const recommendedOptions = (quote.options || []).filter((option) => option.recommended);
    const recommended = recommendedOptions[0];
    const economical = (quote.options || []).find((option) => /economic|risparm/i.test(`${option.label || ""} ${option.title || ""}`));
    if ((quote.options || []).length && recommendedOptions.length !== 1) issues.push("Deve esserci una sola alternativa raccomandata.");
    if (recommended && Math.abs(Number(recommended.total || 0) - net) > 0.02) issues.push("L’alternativa raccomandata non coincide con l’imponibile principale.");
    if (recommended && economical && Number(economical.total || 0) >= Number(recommended.total || 0)) issues.push("L’alternativa economica non costa meno della soluzione raccomandata.");
    const address = String(destination?.client?.address || artifact.address || "").trim();
    if (!address || /da confermare|da definire/i.test(address)) issues.push("Manca l’indirizzo completo del cantiere.");
    const paymentTerms = String(quote.paymentTerms || "").trim();
    if (!paymentTerms || /da concordare|da confermare|da definire/i.test(paymentTerms)) issues.push("Mancano condizioni di pagamento definitive.");
    if (/50\s*%[^.\n]{0,40}(?:dell['’]?\s*)?imponibile/i.test(paymentTerms) && !/iva|totale\s+complessivo/i.test(paymentTerms)) issues.push("L’acconto del 50% non specifica quando viene corrisposta l’IVA.");
    if (estimatedDurationNeedsConfirmation(quote.estimatedDuration)) issues.push("La durata stimata è mancante, provvisoria o non plausibile: indicare un valore come 8-12 giorni lavorativi.");
    const completeText = [artifact.title, artifact.subject, artifact.recommendedSolution, ...(quote.lines || []).flatMap((line) => [line.description, line.notes]), ...(quote.includedWorks || []), ...(quote.exclusions || [])].filter(Boolean).join("\n");
    const principalOptionText = [artifact.title, artifact.subject, artifact.recommendedSolution, recommended?.label, recommended?.title, recommended?.description].filter(Boolean).join("\n");
    const existingKitchenTransfer = /(?:trasfer|spost|rimont|recuper)[^.\n]{0,120}cucina\s+esistente|cucina\s+esistente[^.\n]{0,120}(?:trasfer|spost|rimont|recuper)/i.test(completeText);
    const newKitchenExcluded = (quote.exclusions || []).some((item) => /fornitura[^.\n]{0,100}nuova\s+cucina|nuova\s+cucina[^.\n]{0,100}(?:non\s+compres|esclus)/i.test(item));
    if (/\bnuova\s+cucina\b/i.test(principalOptionText) && existingKitchenTransfer && newKitchenExcluded) {
      issues.push("La soluzione è descritta come nuova cucina, ma le lavorazioni prevedono soltanto il trasferimento della cucina esistente.");
    }
    const scopeText = [...(quote.lines || []).map((line) => `${line.description || ""} ${line.notes || ""}`), ...(quote.includedWorks || [])].join("\n");
    const genericUtilityClosure = /(?:dismission|scolleg|chiusur)[^.\n]{0,120}(?:utenze|punti?\s+tecnic)/i.test(scopeText);
    const gasMentioned = /\bgas\b/i.test(completeText);
    const explicitGasIncluded = /(?:dismission|scolleg|chiusur|messa\s+in\s+sicurezza)[^.\n]{0,100}\bgas\b|\bgas\b[^.\n]{0,100}(?:dismission|scolleg|chiusur|messa\s+in\s+sicurezza)/i.test(scopeText);
    const explicitGasExcluded = (quote.exclusions || []).some((item) => /(?:dismission|scolleg|chiusur|messa\s+in\s+sicurezza)[^.\n]{0,100}\bgas\b|\bgas\b[^.\n]{0,100}(?:dismission|scolleg|chiusur|messa\s+in\s+sicurezza)/i.test(item));
    if (gasMentioned && genericUtilityClosure && !explicitGasIncluded && !explicitGasExcluded) {
      issues.push("Specificare se la chiusura o messa in sicurezza del punto gas è compresa da impresa abilitata oppure esclusa.");
    }
    if (Number(quote.vatRate || 0) === 0 && (quote.missingInformation || []).some((item) => /\biva\b|aliquota/i.test(item))) issues.push("L’aliquota IVA è ancora da confermare.");
    return { passed: issues.length === 0, issues: Array.from(new Set(issues)), artifact, subtotal, net, fullCost };
  }

  function requireQuoteRelease(rawArtifact, destination = null) {
    const check = quoteReleaseCheck(rawArtifact, destination);
    if (!check.passed) throw new Error(`Preventivo bloccato: ${check.issues.join(" ")}`);
    return check.artifact;
  }

  function quoteMessageReleaseCheck(message, destination = null) {
    const content = quoteReleaseCheck(message?.artifact, destination);
    const issues = [...content.issues];
    const quality = message?.qualityAudit;
    if (quality?.passed !== true || quality?.blocking === true) {
      issues.push("La revisione indipendente del contenuto non è stata superata.");
    }
    const pdfAudit = message?.pdfAudit;
    if (pdfAudit?.status !== "passed" || pdfAudit?.passed !== true) {
      issues.push(pdfAudit?.status === "failed"
        ? "Il controllo visivo del PDF ha rilevato problemi di impaginazione o coerenza."
        : "Il controllo visivo del PDF non è ancora completato.");
    }
    return { ...content, passed: issues.length === 0, issues: Array.from(new Set(issues)) };
  }

  function requireMessageQuoteRelease(message, destination = null) {
    const check = quoteMessageReleaseCheck(message, destination);
    if (!check.passed) throw new Error(`Preventivo bloccato: ${check.issues.join(" ")}`);
    return check.artifact;
  }

  function quoteArtifactHtml(artifact) {
    const quote = artifact.quote || {};
    const lines = Array.isArray(quote.lines) ? quote.lines : [];
    const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
    const discount = subtotal * Number(quote.discountPct || 0) / 100;
    const net = subtotal - discount;
    const vat = net * Number(quote.vatRate || 0) / 100;
    const options = (quote.options || []).map((option) => `<div class="ekAiOption ${option.recommended ? "recommended" : ""}"><div class="ekAiOptionHead"><b>${escapeHtml(option.label ? `${option.label} · ${option.title}` : option.title)}</b><b>${euro(option.total)} + IVA</b></div>${option.description ? `<div>${escapeHtml(option.description)}</div>` : ""}${scenarioIncludedWorks(option.includedWorks) ? `<small>Comprende: ${escapeHtml(scenarioIncludedWorks(option.includedWorks))}.</small>` : ""}${option.notes ? `<br><small>${escapeHtml(option.notes)}</small>` : ""}</div>`).join("");
    return `${artifact.revisionReason ? `<div class="ekAiArtifactNotice"><b>Revisione:</b> ${escapeHtml(artifact.revisionReason)}</div>` : ""}${artifactMethodHtml(artifact)}${artifactList("Valutazione tecnica", artifact.technicalAssessment)}${artifactList("Fasi operative", artifact.workPhases)}${artifactList("Materiali previsti", artifact.materials)}<div class="ekAiTableWrap"><table class="ekAiArtifactTable"><thead><tr><th>Lavorazione</th><th>Q.tà</th><th>Unità</th><th class="right">Prezzo</th><th class="right">Totale</th><th>Origine</th></tr></thead><tbody>${lines.map((line) => `<tr><td><b>${escapeHtml(line.description)}</b>${line.notes ? `<br><small>${escapeHtml(line.notes)}</small>` : ""}</td><td>${Number(line.quantity || 0).toLocaleString("it-IT")}</td><td>${escapeHtml(line.unit)}</td><td class="right">${euro(line.unitPrice)}</td><td class="right">${euro(Number(line.quantity || 0) * Number(line.unitPrice || 0))}</td><td>${priceSourceHtml(line)}<br><small>Affidabilità ${escapeHtml(line.confidence || "bassa")}</small></td></tr>`).join("") || `<tr><td colspan="6">Le voci devono ancora essere definite.</td></tr>`}</tbody></table></div>
      <div class="ekAiArtifactTotals"><span>Subtotale</span><b>${euro(subtotal)}</b>${discount > 0.005 ? `<span>Sconto ${Number(quote.discountPct || 0)}%</span><b>− ${euro(discount)}</b>` : ""}<span>Imponibile</span><b>${euro(net)}</b><span>IVA ${Number(quote.vatRate || 0)}%</span><b>${euro(vat)}</b><span>Totale</span><b>${euro(net + vat)}</b></div>
      ${quote.estimatedDuration ? `<div class="ekAiArtifactSection"><h4>Durata stimata</h4><div>${escapeHtml(formatEstimatedDuration(quote.estimatedDuration))}</div></div>` : ""}${artifactList("Opere comprese", quote.includedWorks)}${artifactList("Esclusioni", quote.exclusions)}${options ? `<div class="ekAiArtifactSection"><h4>Alternative e scenari</h4>${options}</div>` : ""}${pricingAnalysisHtml(artifact)}${artifactList("Ipotesi usate", quote.assumptions)}${artifactList("Informazioni da confermare", quote.missingInformation)}${quote.notes ? `<div class="ekAiArtifactSection"><h4>Note</h4><div>${escapeHtml(quote.notes)}</div></div>` : ""}`;
  }

  function reportArtifactHtml(artifact) {
    const report = artifact.report || {};
    return `${artifact.revisionReason ? `<div class="ekAiArtifactNotice"><b>Revisione:</b> ${escapeHtml(artifact.revisionReason)}</div>` : ""}${report.executiveSummary ? `<div class="ekAiArtifactSection"><h4>Sintesi</h4><div>${escapeHtml(report.executiveSummary)}</div></div>` : ""}${artifactMethodHtml(artifact)}${report.interventionPriority ? `<div class="ekAiArtifactSection"><h4>Priorità d’intervento</h4><span class="ekAiPriority">${escapeHtml(report.interventionPriority)}</span></div>` : ""}${artifactList("Valutazione tecnica", artifact.technicalAssessment)}${artifactList("Osservazioni", report.observations)}${artifactList("Cause probabili", report.probableCauses)}${evidenceFindingsHtml(report)}${artifactList("Verifiche consigliate", report.recommendedVerifications)}${artifactList("Fasi operative", artifact.workPhases)}${artifactList("Materiali previsti", artifact.materials)}${artifactList("Interventi consigliati", report.recommendedWorks)}${artifactList("Sicurezza", report.safetyNotes)}${artifactList("Limiti dell’analisi", report.limitations)}${report.conclusions ? `<div class="ekAiArtifactSection"><h4>Conclusioni</h4><div>${escapeHtml(report.conclusions)}</div></div>` : ""}${artifactList("Informazioni da confermare", report.missingInformation)}`;
  }

  function quotePreviewHtml(artifact) {
    const quote = artifact.quote || {};
    const lines = Array.isArray(quote.lines) ? quote.lines : [];
    const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
    const discount = subtotal * Number(quote.discountPct || 0) / 100;
    const net = subtotal - discount;
    const vat = net * Number(quote.vatRate || 0) / 100;
    return `<div class="ekAiQuotePreview"><div class="ekAiQuoteBrand"><div><h3>EDILKAPPA</h3><small>Anteprima preventivo</small></div><div style="text-align:right"><b>BOZZA</b><small>Da controllare e confermare</small></div></div><h3>${escapeHtml(artifact.subject || artifact.title || "Preventivo")}</h3>${artifact.client ? `<p><b>Cliente:</b> ${escapeHtml(artifact.client)}</p>` : ""}${artifact.summary ? `<div class="ekAiQuoteIntro">${escapeHtml(artifact.summary)}</div>` : ""}<div class="ekAiTableWrap"><table class="ekAiArtifactTable"><thead><tr><th>Lavorazione</th><th>Q.tà</th><th>Unità</th><th class="right">Prezzo</th><th class="right">Totale</th></tr></thead><tbody>${lines.map((line) => `<tr><td><b>${escapeHtml(line.description)}</b>${line.notes ? `<br><small>${escapeHtml(line.notes)}</small>` : ""}</td><td>${Number(line.quantity || 0).toLocaleString("it-IT")}</td><td>${escapeHtml(line.unit || "a corpo")}</td><td class="right">${euro(line.unitPrice)}</td><td class="right">${euro(Number(line.quantity || 0) * Number(line.unitPrice || 0))}</td></tr>`).join("") || '<tr><td colspan="5">Le voci devono ancora essere definite.</td></tr>'}</tbody></table></div><div class="ekAiArtifactTotals"><span>Subtotale</span><b>${euro(subtotal)}</b>${discount > 0.005 ? `<span>Sconto ${Number(quote.discountPct || 0)}%</span><b>− ${euro(discount)}</b>` : ""}<span>Imponibile</span><b>${euro(net)}</b><span>IVA ${Number(quote.vatRate || 0)}%</span><b>${euro(vat)}</b><span>Totale</span><b>${euro(net + vat)}</b></div>${quote.estimatedDuration ? `<div class="ekAiArtifactSection"><h4>Durata prevista</h4>${escapeHtml(formatEstimatedDuration(quote.estimatedDuration))}</div>` : ""}${quote.paymentTerms ? `<div class="ekAiArtifactSection"><h4>Condizioni di pagamento</h4>${escapeHtml(quote.paymentTerms)}</div>` : ""}${quote.notes ? `<div class="ekAiArtifactSection"><h4>Note</h4>${escapeHtml(quote.notes)}</div>` : ""}</div>`;
  }

  function quoteTechnicalDetailsHtml(artifact) {
    const quote = artifact.quote || {};
    return `${artifactMethodHtml(artifact)}${artifactList("Valutazione tecnica", artifact.technicalAssessment)}${artifactList("Fasi operative", artifact.workPhases)}${artifactList("Materiali previsti", artifact.materials)}${artifactList("Opere comprese", quote.includedWorks)}${artifactList("Esclusioni", quote.exclusions)}${pricingAnalysisHtml(artifact)}${artifactList("Ipotesi usate", quote.assumptions)}${artifactList("Informazioni da confermare", quote.missingInformation)}`;
  }

  function quoteMissingQuestion(value) {
    const text = String(value || "").replace(/\s+/g, " ").replace(/[\s.;:]+$/g, "").trim();
    if (!text) return "";
    const normalized = text.toLocaleLowerCase("it");
    if (/\biva\b|aliquota/.test(normalized)) return "Quale aliquota IVA definitiva devo applicare: 10%, 22%, reverse charge oppure un'altra aliquota?";
    if (/indirizz|ubicazione/.test(normalized)) return "Qual è l’indirizzo completo del cantiere o dell’intervento?";
    if (/pagament|acconto|saldo/.test(normalized)) return "Quali condizioni di pagamento devo indicare, compreso il momento in cui viene corrisposta l’IVA?";
    if (/apparecchio\s+murale|caldaia|scaldabagno|boiler/.test(normalized)) return "Che apparecchio è quello installato a parete? Puoi inviare una foto ravvicinata dell’etichetta e indicare se deve restare, essere protetto, spostato oppure rimosso?";
    if (/potenza\s+elettric|quadro\s+elettric/.test(normalized)) return "Qual è la potenza elettrica disponibile in kW e puoi inviare una fotografia leggibile del quadro elettrico?";
    if (/scaric|adduzion|idr|percorso|pendenza|colonna/.test(normalized)) return "Qual è la distanza tra il punto acqua/scarico esistente e la nuova parete cucina, quale percorso è possibile e a quale quota si trova lo scarico? Se non puoi rilevarlo, autorizzi la verifica in sopralluogo e una stima a corpo provvisoria?";
    if (/gas|induzion/.test(normalized)) return "La nuova posizione della cucina userà il gas oppure un piano a induzione? Se il gas esistente va chiuso, la chiusura deve essere compresa oppure esclusa?";
    if ((/sala/.test(normalized) && /paret|misur|riliev|dimension/.test(normalized)) || /parete\s+destinata/.test(normalized)) return "Quali sono lunghezza, larghezza e altezza della sala e quanto misura, da spigolo a spigolo, la parete destinata alla cucina? Indica anche posizione e larghezza di porte, finestre e termosifoni; se non hai le misure, autorizzi una stima a corpo da verificare in sopralluogo?";
    if (/cucina\s+esistente|mobili|moduli|top|cappa|elettrodomestic/.test(normalized) && /misur|dimension|recuper|stato|compatibil/.test(normalized)) return "Quali sono la lunghezza totale, l’altezza e la profondità della cucina esistente e le misure dei singoli moduli, del top, della cappa e degli elettrodomestici da recuperare?";
    if (/cappa|condotto\s+di\s+espulsione|ricircolo/.test(normalized)) return "La cappa sarà filtrante a ricircolo oppure collegata a un condotto di espulsione esistente? Se il condotto esiste, invia una fotografia e indica posizione e diametro; altrimenti autorizzi la soluzione filtrante da verificare?";
    if (/piano\s+(?:dell[’']?)?appartament|ascensor|trasporto|macer|accesso\s+al\s+cantiere/.test(normalized)) return "A quale piano si trova l’appartamento? L’ascensore è utilizzabile per materiali e attrezzature e quali sono larghezza e altezza del percorso di accesso? Puoi indicare inoltre dove possono sostare il mezzo e i contenitori per i materiali di risulta?";
    if (/altezza\s+(?:dei\s+)?local|superfic\w*\s+(?:rivestit|da\s+tinteggi)|pareti\s+e\s+soffitt/.test(normalized)) return "Qual è l’altezza netta dei due locali? Misura inoltre lunghezza e altezza delle pareti rivestite e indica quali pareti e soffitti devono essere tinteggiati; se non riesci a rilevarle, autorizzi una stima a corpo da verificare in sopralluogo?";
    if (/finitur|tinteggiatur|pittur|rasatur|rivestiment|paviment|soffitto/.test(normalized)) return "Nell’ex cucina vuoi ripristinare soltanto le zone interessate dai lavori oppure tinteggiare completamente pareti e soffitto? Quali eventuali pavimenti o rivestimenti devono essere rimossi o mantenuti?";
    if (/misur|dimension|planimetr|lunghezz|superfic|quantit/.test(normalized)) return `Quale misura o quantità esatta manca per questo punto: “${text}”? Se non è disponibile, autorizzi una stima a corpo da verificare in sopralluogo?`;
    if (/configuraz|paret|sala/.test(normalized)) return `Quale configurazione definitiva devo considerare per questo punto: “${text}”?`;
    if (/durata|tempistica|giorn|valore\s+generato\s+non\s+[èe]\s+plausibile/.test(normalized)) return "Quale durata indicativa devo riportare, espressa come numero o intervallo di giorni lavorativi, per esempio 8-12 giorni?";
    if (text.endsWith("?")) return text;
    return `Puoi confermare questo dato: “${text}”?`;
  }

  function quoteMissingQuestions(artifact) {
    const values = [...customerFacingValues(artifact?.quote?.missingInformation)];
    if (estimatedDurationNeedsConfirmation(artifact?.quote?.estimatedDuration)) {
      values.push("Durata stimata da confermare");
    }
    return Array.from(new Set(values.map(quoteMissingQuestion).filter(Boolean)));
  }

  function quoteMissingQuestionsHtml(artifact) {
    const questions = quoteMissingQuestions(artifact);
    if (!questions.length) return "";
    return `<div class="ekAiMissingQuestions"><h4>Per rendere definitivo il preventivo, EdilKappa ti chiede:</h4><ol>${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ol><small>Se una misura non è disponibile, puoi rispondere: “non disponibile; usa una stima a corpo da verificare in sopralluogo”.</small></div>`;
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
    const detail = checkedArtifact.kind === "quote" ? quotePreviewHtml(checkedArtifact) : reportArtifactHtml(checkedArtifact);
    const missing = checkedArtifact.kind === "quote" ? checkedArtifact.quote?.missingInformation : checkedArtifact.report?.missingInformation;
    const message = artifactMessage(messageIndex);
    const quality = message?.qualityAudit;
    const isQuote = checkedArtifact.kind === "quote";
    const contentPassed = !isQuote || (quality?.passed === true && quality?.blocking !== true);
    const pdfAudit = message?.pdfAudit;
    const pdfPassed = !isQuote || (pdfAudit?.status === "passed" && pdfAudit?.passed === true);
    const releaseReady = contentPassed && pdfPassed;
    const releaseDisabled = isQuote && !releaseReady ? "disabled title=\"Completa prima i controlli automatici\"" : "";
    const missingQuestions = isQuote ? quoteMissingQuestions(checkedArtifact) : [];
    const qualityBadge = quality
      ? `<span class="ekAiPriceSource ${contentPassed ? "" : "missing"}">${contentPassed ? "Contenuto revisionato" : "Contenuto bloccato"} · ${Number(quality.score || 0)}/100</span>`
      : `<span class="ekAiPriceSource estimate">Da controllare</span>`;
    const pdfBadge = isQuote
      ? `<span class="ekAiPriceSource ${pdfPassed ? "" : pdfAudit?.status === "failed" || pdfAudit?.status === "error" ? "missing" : "estimate"}">${pdfPassed ? `PDF controllato · ${Number(pdfAudit.pagesReviewed || 0)} pag.` : pdfAudit?.status === "checking" ? "Controllo PDF in corso" : "PDF non approvato"}</span>`
      : "";
    const qualityWarnings = quality && !quality.passed && quality.issues?.length
      ? `<div class="ekAiArtifactNotice"><b>Controlli bloccanti:</b><br>${quality.issues.slice(0, 10).map(escapeHtml).join("<br>")}</div>`
      : "";
    const reviewerCorrections = quality?.reviewer?.corrections?.length
      ? `<div class="ekAiArtifactNotice"><b>Correzioni applicate dal secondo revisore:</b><br>${quality.reviewer.corrections.slice(0, 10).map(escapeHtml).join("<br>")}</div>`
      : "";
    const reviewerWarnings = quality?.reviewer?.warnings?.length
      ? `<div class="ekAiArtifactNotice"><b>Avvertenze non bloccanti:</b><br>${quality.reviewer.warnings.slice(0, 8).map(escapeHtml).join("<br>")}</div>`
      : "";
    const pdfAuditNotice = !isQuote ? "" : pdfPassed
      ? `<div class="ekAiArtifactNotice"><b>Controllo visivo PDF superato:</b> ${escapeHtml(pdfAudit.summary || "tutte le pagine sono leggibili e correttamente impaginate.")}${pdfAudit.warnings?.length ? `<br>${pdfAudit.warnings.slice(0, 6).map(escapeHtml).join("<br>")}` : ""}</div>`
      : pdfAudit?.status === "failed"
        ? `<div class="ekAiArtifactNotice"><b>PDF bloccato:</b><br>${(pdfAudit.issues || []).slice(0, 10).map(escapeHtml).join("<br>") || escapeHtml(pdfAudit.summary || "Correggere l’impaginazione.")}</div>`
        : pdfAudit?.status === "checking"
          ? `<div class="ekAiArtifactNotice"><b>Controllo visivo in corso:</b> EdilKappa AI sta esaminando tutte le pagine del PDF già impaginato.</div>`
          : `<div class="ekAiArtifactNotice"><b>Controllo PDF non completato:</b> ${escapeHtml(pdfAudit?.summary || (contentPassed ? "avvia o riprova il controllo visivo." : "prima va superata la revisione del contenuto."))}</div>`;
    const generatedIndexes = new Set((message?.media || []).filter((item) => item.generated).map((item) => Number(item.briefIndex)));
    const nextBrief = (checkedArtifact.visualBriefs || []).findIndex((_, index) => !generatedIndexes.has(index));
    const visualButton = nextBrief >= 0 ? `<button class="visual" onclick="edilkappaAiGenerateVisual(${messageIndex},${nextBrief})" ${state.generatingVisual ? "disabled" : ""}>${state.generatingVisual === checkedArtifact.id ? "Creo l’immagine…" : `Crea ${nextBrief === 0 ? "fotomontaggio / immagine" : "altra immagine"}`}</button>` : "";
    const pdfAuditButton = isQuote && contentPassed && !pdfPassed
      ? `<button class="secondary" onclick="edilkappaAiAuditPdf(${messageIndex})" ${state.auditingPdf === checkedArtifact.id || pdfAudit?.status === "checking" ? "disabled" : ""}>${state.auditingPdf === checkedArtifact.id || pdfAudit?.status === "checking" ? "Controllo PDF…" : "Riprova controllo PDF"}</button>`
      : "";
    const quoteDetails = isQuote
      ? `<details class="ekAiQuoteDetails"><summary>Mostra analisi tecnica e controlli</summary>${quoteTechnicalDetailsHtml(checkedArtifact)}${visualBriefsHtml(checkedArtifact)}${reviewerCorrections}${qualityWarnings}${reviewerWarnings}${pdfAuditNotice}</details>${quoteMissingQuestionsHtml(checkedArtifact)}<div class="ekAiQuoteApproval"><b>${releaseReady ? "I controlli automatici sono superati; resta obbligatoria la tua approvazione." : "Puoi scaricare subito il PDF in bozza. Salvataggio e condivisione definitivi restano bloccati finché i controlli non sono superati."}</b> Puoi sempre chiedere una modifica.</div>`
      : `${visualBriefsHtml(checkedArtifact)}${qualityWarnings}`;
    return `<section class="ekAiArtifact"><div class="ekAiArtifactHead"><div><strong>${isQuote ? "📋 Anteprima del preventivo" : "📝 Bozza di relazione tecnica"}</strong><small>${escapeHtml(checkedArtifact.title || checkedArtifact.subject || "Documento EdilKappa")}${checkedArtifact.client ? ` · ${escapeHtml(checkedArtifact.client)}` : ""}</small></div><div>${saved ? `<span class="ekAiPriceSource">Salvato</span>` : qualityBadge}${pdfBadge}</div></div><div class="ekAiArtifactBody">${detail}${quoteDetails}${Array.isArray(missing) && missing.length ? `<div class="ekAiArtifactNotice"><b>Prima dell’invio al cliente:</b> controlla le informazioni evidenziate e tutti i prezzi stimati.</div>` : `<div class="ekAiArtifactNotice"><b>Controllo umano obbligatorio:</b> verifica comunque misure, lavorazioni, prezzi e condizioni prima dell’invio.</div>`}<div class="ekAiArtifactActions">${saved ? `<button class="saved" onclick="edilkappaAiOpenSaved(${messageIndex})">✓ Apri nel gestionale</button>` : `<button onclick="edilkappaAiSaveArtifact(${messageIndex})" ${isQuote ? releaseDisabled : ""}>${isQuote ? "✓ Conferma e salva" : "Salva relazione PDF"}</button>`}${isQuote && !saved ? `<button class="secondary" onclick="edilkappaAiRequestChange(${messageIndex})">✎ Chiedi una modifica</button>` : ""}${isQuote && !saved && missingQuestions.length ? `<button class="secondary" onclick="edilkappaAiAnswerMissing(${messageIndex})">? Completa i dati mancanti</button>` : ""}<button class="secondary" onclick="edilkappaAiDownloadPdf(${messageIndex})">${isQuote && !releaseReady ? "Scarica PDF bozza" : "Scarica PDF"}</button>${isQuote ? `<button class="secondary" onclick="edilkappaAiSharePdf(${messageIndex})" ${releaseDisabled}>Condividi</button>` : `<button class="secondary" onclick="edilkappaAiDownloadWord(${messageIndex})">Scarica Word</button>`}${pdfAuditButton}${visualButton}</div></div></section>`;
  }

  function messageHtml(message, index) {
    const sources = (message.sources || []).map(sourceHtml).join("");
    const model = message.role === "assistant" && message.modelLabel ? `<div class="ekAiMessageMeta">${message.engine === "agents_sdk" ? `Agente: ${escapeHtml(message.agentName || "EdilKappa Preventivi")} · ` : "Motore: "}${escapeHtml(message.modelLabel)}${message.reviewerName ? ` · revisore: ${escapeHtml(message.reviewerName)}` : ""}${message.reviewFallbackUsed ? " · revisione recuperata automaticamente" : ""}${message.reasoningEffort ? ` · ragionamento ${escapeHtml(message.reasoningEffort)}` : ""}${message.approvalRequired ? " · approvazione richiesta" : ""}</div>` : "";
    const mainText = message.role === "assistant" && message.artifact?.kind === "quote" ? "" : `<div class="ekAiText">${escapeHtml(message.text)}</div>`;
    return `<div class="ekAiMessage ${message.role === "user" ? "user" : "assistant"}">${mainText}${model}${mediaHtml(message, index)}${sources ? `<div class="ekAiSources">${sources}</div>` : ""}${message.role === "assistant" ? artifactHtml(message.artifact, index) : ""}</div>`;
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
          { label: "Preventivo da allegati", prompt: "Applica il Metodo EdilKappa alle foto, ai video e ai documenti allegati. Ricostruisci evidenze e incertezze, confronta le soluzioni, raccomanda quella migliore e prepara un preventivo completo con fasi, quantità, composizione dei costi, prezzi di vendita, esclusioni, tempi e controlli finali. Usa prima listino e storico validato. Segnala soltanto i dati che devo confermare.", taskType: "quote" },
          { label: "Relazione da sopralluogo", prompt: "Applica il Metodo EdilKappa al sopralluogo allegato e prepara una relazione professionale. Collega ogni osservazione alla foto, al fotogramma o al documento pertinente; separa fatti, cause probabili e verifiche; indica priorità, interventi consigliati, limiti e conclusioni.", taskType: "report" },
          { label: "Analizza foto o video", prompt: "Analizza con attenzione le foto o il video allegato, descrivi cosa è visibile, i problemi probabili, i rischi e i prossimi controlli da fare.", taskType: "inspection" },
          { label: "Controlla i cantieri", prompt: "Controlla i cantieri attivi e indicami priorità, rischi, scadenze e prossime azioni.", taskType: "auto" }
        ];
  }

  function taskLabel(task) {
    return ({ auto: "Chat libera", quote: "Preventivo · Agente SDK", report: "Relazione", inspection: "Analisi sopralluogo" })[task] || "Chat libera";
  }

  function modelSelectHtml() {
    return `<label class="ekAiModel">Motore<select onchange="edilkappaAiSetModel(this.value)"><option value="auto" ${state.modelMode === "auto" ? "selected" : ""}>Automatico · Sol solo se necessario</option><option value="sol" ${state.modelMode === "sol" ? "selected" : ""}>GPT‑5.6 Sol · massima qualità</option><option value="terra" ${state.modelMode === "terra" ? "selected" : ""}>GPT‑5.6 Terra · più economico</option></select></label>`;
  }

  function renderAttachments() {
    return state.attachments.map((item, index) => {
      const icon = item.kind === "video" ? "🎬" : item.kind === "image" ? "📷" : "📄";
      const detail = item.kind === "video"
        ? `${item.frames?.length || 0} fotogrammi · ${humanFileSize(item.file?.size)}`
        : item.kind === "image" && /^image\/(heic|heif)$/i.test(item.mimeType)
          ? `HEIC · conversione automatica · ${humanFileSize(item.file?.size)}`
          : `${item.kind === "image" ? "Foto pronta" : "File pronto"} · ${humanFileSize(item.file?.size)}`;
      const visual = item.thumbnailDataUrl
        ? `<img class="ekAiFileThumb" src="${item.thumbnailDataUrl}" alt="">`
        : `<span class="ekAiFileIcon">${icon}</span>`;
      return `<div class="ekAiFile">${visual}<span class="ekAiFileBody"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(detail)}</small></span><button type="button" onclick="edilkappaAiRemoveFile(${index})" aria-label="Rimuovi">×</button></div>`;
    }).join("");
  }

  function workflowHtml() {
    if (state.mode !== "work") return `<div class="ekAiWorkflow">${modelSelectHtml()}</div>`;
    const buttons = [["auto", "💬 Chat"], ["quote", "📋 Preventivo"], ["report", "📝 Relazione"], ["inspection", "🔎 Analisi"]];
    return `<div class="ekAiWorkflow">${buttons.map(([task, label]) => `<button class="${state.taskType === task ? "active" : ""}" onclick="edilkappaAiSetTask('${task}')">${label}</button>`).join("")}<small>Modalità: ${taskLabel(state.taskType)}</small>${modelSelectHtml()}</div>`;
  }

  function threadsHtml() {
    const rows = state.conversations[state.mode] || [];
    const active = state.activeConversation[state.mode];
    return `<aside class="ekAiThreads"><button class="ekAiNewThread" onclick="edilkappaAiNewConversation()">＋ Nuova chat</button>${rows.map((item) => `<div class="ekAiThread ${item.id === active ? "active" : ""}"><button class="ekAiThreadMain" onclick="edilkappaAiSelectConversation('${escapeHtml(item.id)}')"><b>${escapeHtml(item.title || "Nuova conversazione")}</b><small>${Number(item.messageCount || 0)} messaggi</small></button><div class="ekAiThreadActions"><button class="ekAiThreadAction" onclick="edilkappaAiRenameConversation('${escapeHtml(item.id)}')" title="Rinomina chat" aria-label="Rinomina chat">✎</button><button class="ekAiThreadAction delete" onclick="edilkappaAiDeleteConversation('${escapeHtml(item.id)}')" title="Elimina chat" aria-label="Elimina chat">🗑</button></div></div>`).join("") || `<div class="ekAiEmpty" style="padding:18px 5px">Nessuna chat salvata.</div>`}</aside>`;
  }

  function view() {
    if (state.mode === "personal" && !isOwner()) state.mode = "work";
    const messages = currentMessages();
    if (!state.conversationsLoaded[state.mode] && !state.loading && Date.now() >= state.nextHistoryAttempt) setTimeout(loadConversations, 0);
    else if (!state.loaded[state.mode] && !state.loading && Date.now() >= state.nextHistoryAttempt) setTimeout(loadHistory, 0);
    if (pendingJobCanResume(state.pendingJob) && state.pendingJob.mode === state.mode && state.pendingJob.conversationId === state.activeConversation[state.mode] && !state.sending) setTimeout(() => window.edilkappaAiResumePending?.(), 0);
    const modeLabel = state.mode === "work" ? "Lavoro" : "Personale";
    return `<div class="ekAiPage ${state.focusMode ? "focusMode" : ""}">
      <section class="ekAiHero"><div><h2>EdilKappa AI</h2><p>L’Agente EdilKappa Preventivi applica il Metodo EdilKappa, compone prezzi e controlla la bozza. Relazioni, analisi e chat restano disponibili nello stesso spazio.</p></div><div class="ekAiHeroMark">✦</div></section>
      <div class="ekAiToolbar"><div class="ekAiModes"><button class="${state.mode === "work" ? "active" : ""}" onclick="edilkappaAiSetMode('work')">🏗️ Lavoro</button>${isOwner() ? `<button class="${state.mode === "personal" ? "active" : ""}" onclick="edilkappaAiSetMode('personal')">👤 Personale</button>` : ""}</div><div class="ekAiToolbarRight"><button class="ekAiFocusButton ${state.focusMode ? "active" : ""}" onclick="edilkappaAiToggleFocus()">${state.focusMode ? "↙ Esci da Focus" : "⛶ Modalità Focus"}</button><div class="ekAiStatus"><i class="ekAiDot"></i> Protetta dal login EdilKappa · ${modeLabel}</div></div></div>
      ${workflowHtml()}
      <div class="ekAiWorkspace">${threadsHtml()}<div class="ekAiMain"><div class="ekAiChat" id="ekAiChat">${state.loading && !messages.length ? `<div class="ekAiEmpty"><strong>Carico la chat ${modeLabel.toLowerCase()}…</strong></div>` : messages.length ? messages.map(messageHtml).join("") : `<div class="ekAiEmpty"><strong>${state.mode === "work" ? "Allega il sopralluogo e dimmi il risultato finale" : "Questa è la tua area personale"}</strong>${state.mode === "work" ? "Puoi scrivere normalmente come in ChatGPT. Per un risultato più preciso scegli Preventivo, Relazione o Analisi e allega tutto insieme." : "Le conversazioni personali restano separate da quelle aziendali."}</div>`}${state.sending ? `<div class="ekAiMessage assistant"><span class="ekAiTyping"><i></i><i></i><i></i></span></div>` : ""}</div>
      <div class="ekAiQuick">${quickPrompts().map((item, index) => `<button onclick="edilkappaAiUsePrompt(${index})">${escapeHtml(item.label)}</button>`).join("")}${state.mode === "work" ? `<button class="ekAiHoursButton" onclick="openOfficeHoursEntry()">⏱️ Registra ore operaio</button>` : ""}</div>
      ${state.progress ? `<div class="ekAiProgress">⏳ ${escapeHtml(state.progress)}${progressStepsHtml(state.pendingJob?.stage || "archive")}</div>` : ""}
      ${state.error ? `<div class="ekAiError">${escapeHtml(state.error)}${state.retryAvailable ? `<button class="ekAiRetry" onclick="edilkappaAiRetry()">${state.pendingJob?.retryWithoutAttachments === true ? "Riprova senza ricaricare le foto" : "Riprova"}</button>` : ""}</div>` : ""}
      <div class="ekAiComposer"><div class="ekAiFiles">${renderAttachments()}</div><textarea id="ekAiInput" maxlength="8000" placeholder="Descrivi il lavoro, le misure conosciute e il risultato che vuoi…" oninput="edilkappaAiDraft(this.value)" onkeydown="edilkappaAiKeydown(event)">${escapeHtml(state.draft)}</textarea><div class="ekAiComposeBar"><div class="ekAiActions"><label class="ekAiFileBtn">📎 Foto, video e file<input id="ekAiFiles" type="file" hidden multiple accept="image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm,application/pdf,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv" onchange="edilkappaAiAddFiles(this.files,this)"></label><label class="ekAiPhotoOrigin">📍 Origine foto<select onchange="edilkappaAiSetPhotoOrigin(this.value)"><option value="sopralluogo_edilkappa" ${state.photoOrigin === "sopralluogo_edilkappa" ? "selected" : ""}>Sopralluogo EdilKappa</option><option value="cliente" ${state.photoOrigin === "cliente" ? "selected" : ""}>Ricevute dal cliente</option><option value="da_confermare" ${state.photoOrigin === "da_confermare" ? "selected" : ""}>Da confermare</option></select></label><label class="ekAiWeb"><input type="checkbox" ${state.useWeb ? "checked" : ""} onchange="edilkappaAiToggleWeb(this.checked)"> 🌐 Ricerca web</label></div><button class="ekAiSend" onclick="edilkappaAiSend()" ${state.sending ? "disabled" : ""}>${state.sending ? "Sto lavorando…" : "Invia ✦"}</button><div class="ekAiUploadHelp">Fino a 8 file: puoi aggiungerli uno alla volta oppure, su Windows, selezionarne più di uno tenendo premuto Ctrl. Prima dell’invio controlla l’origine delle foto: verrà riportata correttamente nell’allegato fotografico. Le foto iPhone HEIC vengono convertite automaticamente e inserite anche nel PDF.</div></div></div>
      <div class="ekAiPrivacy">Gli originali di lavoro vengono archiviati nel cloud protetto. I video sono analizzati tramite fotogrammi e, fino a 25 MB, anche tramite trascrizione dell’audio. Le immagini illustrative vengono create solo quando premi il relativo pulsante, così mantieni il controllo dei costi. Controlla sempre misure, prezzi e conclusioni tecniche. <button class="ekAiReset" onclick="edilkappaAiReset()" ${state.resetting ? "disabled" : ""}>Svuota questa chat</button></div></div></div>
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

  async function loadConversations() {
    if (state.loading || state.conversationsLoaded[state.mode]) return;
    if (!window.EdilKappaCloud?.ready || !window.EdilKappaCloud?.aiRequest) return loadHistory();
    const requestedMode = state.mode;
    state.loading = true;
    try {
      const result = await window.EdilKappaCloud.aiRequest({ action: "list_conversations", mode: requestedMode });
      state.conversations[requestedMode] = Array.isArray(result.conversations) ? result.conversations : [];
      state.conversationsLoaded[requestedMode] = true;
      if (!state.conversations[requestedMode].some((item) => item.id === state.activeConversation[requestedMode])) {
        state.activeConversation[requestedMode] = state.conversations[requestedMode][0]?.id || "legacy";
      }
    } catch (error) {
      state.error = error?.message || "Non riesco a caricare l’elenco delle chat.";
    } finally {
      state.loading = false;
      rerender();
    }
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
      const result = await window.EdilKappaCloud.aiRequest({ action: "history", mode: requestedMode, conversationId: state.activeConversation[requestedMode] });
      state.messages[requestedMode] = Array.isArray(result.messages) ? result.messages : [];
      state.loaded[requestedMode] = true;
      state.nextHistoryAttempt = 0;
      const pendingPdfAudit = [...state.messages[requestedMode]].reverse().find((message) => message?.artifact?.kind === "quote"
        && message?.qualityAudit?.passed === true
        && message?.qualityAudit?.blocking !== true
        && message?.qualityAudit?.reviewer
        && message?.pdfAudit?.passed !== true);
      if (pendingPdfAudit) setTimeout(() => auditQuotePdfMessage(pendingPdfAudit, requestedMode), 0);
    } catch (error) {
      state.error = error?.message || "Non riesco a caricare la memoria AI.";
    } finally {
      state.loading = false;
      rerender();
    }
  }

  function relevanceTokens(value) {
    const ignored = new Set(["della", "delle", "degli", "nella", "nelle", "questo", "questa", "prepara", "preventivo", "relazione", "lavoro", "intervento", "completo", "edilkappa"]);
    return new Set(String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{4,}/g)?.filter((token) => !ignored.has(token)) || []);
  }

  function quoteRelevance(item, requestTokens) {
    const searchable = [item.subject, item.client, ...(item.lines || []).map((line) => line.description), item.aiRecommendedSolution].filter(Boolean).join(" ");
    const quoteTokens = relevanceTokens(searchable);
    let score = 0;
    requestTokens.forEach((token) => { if (quoteTokens.has(token)) score += 1; });
    return score;
  }

  function businessContext(message = "") {
    const database = window.EdilKappaLocal?.getDB?.() || {};
    const compact = (items, fields, limit = 20) => (items || []).slice(0, limit).map((item) => Object.fromEntries(fields.map((field) => [field, item?.[field]]).filter(([, value]) => value !== undefined && value !== "")));
    const requestTokens = relevanceTokens(message);
    const recentQuotes = (database.quotes || [])
      .map((item, index) => ({ item, index, score: quoteRelevance(item, requestTokens) }))
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, 6)
      .map(({ item }) => ({
        code: item.code,
        client: item.client,
        subject: item.subject,
        date: item.date,
        status: item.status,
        net: item.net,
        lines: (item.lines || []).slice(0, 12).map((line) => ({ description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice }))
      }));
    const validatedStatuses = new Set(["Accettato", "Approvato", "Completato", "Fatturato"]);
    const validatedQuotes = (database.quotes || [])
      .filter((item) => {
        const learningState = String(item.learningStatus || "");
        if (["Da controllare", "Da riconfermare"].includes(learningState)) return false;
        return learningState.startsWith("Verificato") || validatedStatuses.has(item.status);
      })
      .map((item, index) => ({ item, index, score: quoteRelevance(item, requestTokens) }))
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, 6)
      .map((entry) => entry.item);
    const validatedMargins = validatedQuotes.map((item) => Number(item.marginPercent)).filter(Number.isFinite);
    const correctionMemory = (database.quotes || []).slice(-20).reverse().flatMap((item) => (item.revisions || []).slice(-4).map((revision) => ({
      quote: item.code,
      subject: item.subject,
      date: revision.date,
      change: revision.action,
      actor: revision.actor
    }))).slice(0, 30);
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
      memoriaPrezziValidati: validatedQuotes.map((item) => ({
        code: item.code,
        subject: item.subject,
        date: item.date,
        status: item.status,
        net: item.net,
        costTotal: item.costTotal,
        marginPercent: item.marginPercent,
        pricingAnalysis: item.aiPricingAnalysis,
        lines: (item.lines || []).slice(0, 20).map((line) => ({ description: line.description, category: line.category, quantity: line.quantity, unit: line.unit, unitCost: line.unitCost, unitPrice: line.unitPrice }))
      })),
      memoriaCorrezioniPreventivi: correctionMemory,
      controlloEconomico: {
        margineMedioPreventiviValidatiPct: validatedMargins.length ? Math.round(validatedMargins.reduce((sum, value) => sum + value, 0) / validatedMargins.length * 10) / 10 : null,
        usaSoloStoricoConStato: Array.from(validatedStatuses)
      },
      standardDocumentaleApprovato: {
        intestazione: "Logo e dati EDILKAPPA in alto, riferimento documento a destra, linea divisoria, titolo centrato, tabelle pulite, piè di pagina con nome documento e numero pagina.",
        regole: [
          "Non cambiare intestazione o stile tra una revisione e la successiva.",
          "Il controllo economico interno e il margine non devono essere esportati nel documento destinato al cliente.",
          "IVA, sconti, commissioni, tempi e pagamento seguono la richiesta specifica; non applicare valori abituali se il titolare li ha lasciati da definire.",
          "Non inventare misure, caratteristiche della copertura, certificazioni o cause definitive non dimostrate.",
          "Quando il prezzo può risultare elevato, proporre una vera alternativa economica indicando chiaramente differenze e limiti.",
          "Le correzioni del titolare prevalgono sugli esempi storici e devono essere conservate nelle revisioni successive."
        ]
      },
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
    const mimeType = inferredType(file);
    if (/^image\/(heic|heif)$/i.test(mimeType)) {
      if (file.size > HEIC_MAX_BYTES) throw new Error(`${file.name} supera 25 MB. Riduci la fotografia HEIC oppure inviala separatamente.`);
      return {
        dataUrl: file.size <= 6 * 1024 * 1024 ? await fileDataUrl(file) : "",
        mimeType,
        thumbnailDataUrl: "",
        serverConversion: true
      };
    }
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
      const thumbnail = document.createElement("canvas");
      const thumbnailScale = Math.min(1, 160 / Math.max(canvas.width, canvas.height));
      thumbnail.width = Math.max(1, Math.round(canvas.width * thumbnailScale));
      thumbnail.height = Math.max(1, Math.round(canvas.height * thumbnailScale));
      thumbnail.getContext("2d").drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
      return {
        dataUrl: await fileDataUrl(blob),
        mimeType: "image/jpeg",
        thumbnailDataUrl: thumbnail.toDataURL("image/jpeg", 0.7)
      };
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

  function requestAttachmentsFor(items, options = {}) {
    const fixed = [];
    const videoFrames = [];
    items.forEach((item) => {
      if (item.kind === "video") videoFrames.push(...(item.frames || []));
      else {
        const isHeic = /^image\/(heic|heif)$/i.test(item.mimeType || "");
        if (isHeic && options.omitArchivedHeic === true && (options.selectionOnly === true || item.stored)) return;
        if (!item.dataUrl) {
          throw new Error(isHeic
            ? `${item.name} deve essere archiviata nel cloud prima della conversione. Riprova con una connessione stabile.`
            : `Non riesco a preparare ${item.name}.`);
        }
        fixed.push({
          name: item.name,
          sourceName: item.name,
          mimeType: item.mimeType,
          dataUrl: item.dataUrl,
          kind: item.kind,
          photoOrigin: item.kind === "image" ? normalizePhotoOrigin(item.photoOrigin || options.photoOrigin || state.photoOrigin) : undefined
        });
      }
    });
    const frameSlots = Math.max(0, MAX_REQUEST_ATTACHMENTS - fixed.length);
    const selectedFrames = videoFrames.length <= frameSlots
      ? videoFrames
      : Array.from({ length: frameSlots }, (_, index) => videoFrames[Math.min(videoFrames.length - 1, Math.floor(index * videoFrames.length / frameSlots))]);
    const output = fixed.concat(selectedFrames.map((item) => ({
      ...item,
      photoOrigin: normalizePhotoOrigin(item.photoOrigin || options.photoOrigin || state.photoOrigin)
    })));
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
        durationSeconds: Number(item.durationSeconds || 0),
        photoOrigin: ["image", "video"].includes(item.kind) ? normalizePhotoOrigin(item.photoOrigin || state.photoOrigin) : undefined
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
    if (artifact.evidence?.length) blocks.push(`Evidenze utilizzate:\n- ${artifact.evidence.join("\n- ")}`);
    if (artifact.uncertainties?.length) blocks.push(`Incertezze e verifiche:\n- ${artifact.uncertainties.join("\n- ")}`);
    if (artifact.recommendedSolution) blocks.push(`Soluzione raccomandata: ${artifact.recommendedSolution}`);
    if (artifact.decisionRationale) blocks.push(`Motivazione tecnica: ${artifact.decisionRationale}`);
    if (artifact.technicalAssessment?.length) blocks.push(`Valutazione tecnica:\n- ${artifact.technicalAssessment.join("\n- ")}`);
    if (artifact.workPhases?.length) blocks.push(`Fasi operative:\n- ${artifact.workPhases.join("\n- ")}`);
    if (artifact.materials?.length) blocks.push(`Materiali previsti:\n- ${artifact.materials.join("\n- ")}`);
    if (quote.estimatedDuration) blocks.push(`Durata stimata: ${formatEstimatedDuration(quote.estimatedDuration)}`);
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
      previewStoragePath: item.previewStoragePath || "",
      previewFileName: item.previewFileName || "",
      previewFileType: item.previewFileType || "",
      uploadedAt: item.uploadedAt || new Date().toISOString(),
      source: item.generated ? "EdilKappa AI · visualizzazione illustrativa" : "EdilKappa AI",
      generated: item.generated === true,
      illustrative: item.illustrative === true,
      photoOrigin: item.generated ? "da_confermare" : normalizePhotoOrigin(item.photoOrigin),
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
    artifact = requireQuoteRelease(artifact, destination);
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
      aiPricingAnalysis: artifact.quote?.pricingAnalysis || {},
      aiEvidence: artifact.evidence || [],
      aiUncertainties: artifact.uncertainties || [],
      aiRecommendedSolution: artifact.recommendedSolution || "",
      aiArtifact: artifact,
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

  function documentCompany() {
    const saved = (window.EdilKappaLocal?.getDB?.().companySettings || [])[0] || {};
    const savedName = String(saved.name || "").trim();
    return {
      legalName: savedName && savedName.toUpperCase() !== "EDILKAPPA" ? savedName.toUpperCase() : EDILKAPPA_DOCUMENT.legalName,
      activity: EDILKAPPA_DOCUMENT.activity,
      address: saved.address || EDILKAPPA_DOCUMENT.address,
      vat: saved.vat || EDILKAPPA_DOCUMENT.vat,
      phone: saved.phone || EDILKAPPA_DOCUMENT.phone,
      email: saved.email || EDILKAPPA_DOCUMENT.email
    };
  }

  function documentTypeLabel(artifact) {
    const labels = {
      preventivo: "PREVENTIVO",
      variante: "PREVENTIVO DI VARIANTE",
      relazione_tecnica: "RELAZIONE TECNICA",
      relazione_fotografica: "RELAZIONE TECNICA E FOTOGRAFICA",
      relazione_assicurativa: "RELAZIONE TECNICA PER PRATICA ASSICURATIVA",
      verbale_sopralluogo: "VERBALE DI SOPRALLUOGO"
    };
    return labels[artifact?.documentType] || (artifact?.kind === "quote" ? "PREVENTIVO" : "RELAZIONE TECNICA");
  }

  let documentLogoDataUrl = "";
  let documentFontDataPromise;

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function loadDocumentFonts(doc) {
    if (!documentFontDataPromise) {
      documentFontDataPromise = Promise.all([
        fetch("./linea-vita/assets/fonts/DejaVuSans-EdilKappa.ttf").then((response) => {
          if (!response.ok) throw new Error("Font PDF regolare non disponibile.");
          return response.arrayBuffer();
        }),
        fetch("./linea-vita/assets/fonts/DejaVuSans-Bold-EdilKappa.ttf").then((response) => {
          if (!response.ok) throw new Error("Font PDF grassetto non disponibile.");
          return response.arrayBuffer();
        })
      ]).then(([regular, bold]) => ({ regular: arrayBufferToBase64(regular), bold: arrayBufferToBase64(bold) }));
    }
    const fonts = await documentFontDataPromise;
    doc.addFileToVFS("DejaVuSans-EdilKappa.ttf", fonts.regular);
    doc.addFont("DejaVuSans-EdilKappa.ttf", EDILKAPPA_PDF_FONT, "normal");
    doc.addFileToVFS("DejaVuSans-Bold-EdilKappa.ttf", fonts.bold);
    doc.addFont("DejaVuSans-Bold-EdilKappa.ttf", EDILKAPPA_PDF_FONT, "bold");
  }
  async function loadDocumentLogo() {
    if (documentLogoDataUrl) return documentLogoDataUrl;
    documentLogoDataUrl = await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || 900;
        canvas.height = image.naturalHeight || 185;
        canvas.getContext("2d").drawImage(image, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.94));
      };
      image.onerror = () => resolve("");
      image.src = "./linea-vita/assets/logo-edilkappa-pdf.jpg";
    });
    return documentLogoDataUrl;
  }

  function drawDocumentHeader(doc, context) {
    const company = context.company;
    doc.setTextColor(...EDILKAPPA_DOCUMENT.dark);
    if (context.logo) doc.addImage(context.logo, "JPEG", 14, 9, 50, 10.3, undefined, "FAST");
    doc.setFont(EDILKAPPA_PDF_FONT, "bold");
    doc.setFontSize(8.4);
    doc.text(company.legalName, 196, 11, { align: "right" });
    doc.setFont(EDILKAPPA_PDF_FONT, "normal");
    doc.setFontSize(7.5);
    doc.text(company.activity, 196, 16, { align: "right" });
    doc.text(`${company.email} | ${company.phone}`, 196, 21, { align: "right" });
    doc.setFillColor(...EDILKAPPA_DOCUMENT.yellow);
    doc.rect(14, 27, 182, 5, "F");
    doc.setFillColor(...EDILKAPPA_DOCUMENT.dark);
    doc.rect(14, 32, 182, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont(EDILKAPPA_PDF_FONT, "bold");
    doc.setFontSize(8.4);
    doc.text(context.label, 18, 37.4);
    doc.setTextColor(...EDILKAPPA_DOCUMENT.dark);
  }

  function newDocumentPage(doc, context) {
    doc.addPage();
    drawDocumentHeader(doc, context);
    return 47;
  }

  function ensureDocumentSpace(doc, context, y, needed = 18) {
    return y + needed > 274 ? newDocumentPage(doc, context) : y;
  }

  function pdfTextSection(doc, context, title, text, y) {
    if (!text) return y;
    const paragraphs = customerFacingText(text).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!paragraphs.length) return y;
    doc.setFont(EDILKAPPA_PDF_FONT, "normal");
    doc.setFontSize(8.3);
    const firstLines = doc.splitTextToSize(paragraphs[0], 180);
    y = ensureDocumentSpace(doc, context, y, 10 + Math.min(40, firstLines.length * 3.9));
    doc.setFont(EDILKAPPA_PDF_FONT, "bold");
    doc.setFontSize(9.4);
    doc.setTextColor(...EDILKAPPA_DOCUMENT.dark);
    doc.text(String(title).toUpperCase(), 14, y);
    y += 5;
    paragraphs.forEach((paragraph, paragraphIndex) => {
      doc.setFont(EDILKAPPA_PDF_FONT, "normal");
      doc.setFontSize(8.3);
      doc.setTextColor(...EDILKAPPA_DOCUMENT.dark);
      const lines = doc.splitTextToSize(paragraph, 180);
      const paragraphHeight = lines.length * 3.9 + (paragraphIndex ? 1.4 : 0);
      if (paragraphHeight < 220 && y + paragraphHeight > 274) y = newDocumentPage(doc, context);
      if (paragraphIndex) y += 1.4;
      lines.forEach((line) => {
        y = ensureDocumentSpace(doc, context, y, 5);
        // drawDocumentHeader lascia il font in grassetto: il corpo va sempre
        // reimpostato dopo un eventuale salto pagina per conservare le misure.
        doc.setFont(EDILKAPPA_PDF_FONT, "normal");
        doc.setFontSize(8.3);
        doc.setTextColor(...EDILKAPPA_DOCUMENT.dark);
        doc.text(line, 14, y);
        y += 3.9;
      });
    });
    return y + 2.5;
  }

  function customerFacingValues(values) {
    return (Array.isArray(values) ? values : [])
      .map((value) => customerFacingText(value))
      .filter((value) => value && !/\bgestionale\b|\bclientid\b|\binterventionid\b|selezionare\s+o\s+creare.{0,100}\bintervento\b/i.test(value));
  }

  function scenarioIncludedWorks(values) {
    return customerFacingValues(values)
      .map((value) => value.replace(/[\s.;:,]+$/g, ""))
      .filter(Boolean)
      .join("; ");
  }

  function pdfListSection(doc, context, title, values, y) {
    const rows = customerFacingValues(values);
    return rows.length ? pdfTextSection(doc, context, title, rows.map((value) => `- ${value}`).join("\n"), y) : y;
  }

  function pdfNumberedListSection(doc, context, title, values, y) {
    const rows = customerFacingValues(values);
    return rows.length ? pdfTextSection(doc, context, title, rows.map((value, index) => `${index + 1}. ${value}`).join("\n"), y) : y;
  }

  function runDocumentTable(doc, context, options) {
    if (typeof doc.autoTable !== "function") throw new Error("Il modulo tabelle PDF non è disponibile. Ricarica la pagina e riprova.");
    doc.autoTable({
      margin: { top: 45, right: 14, bottom: 21, left: 14 },
      didDrawPage: () => drawDocumentHeader(doc, context),
      styles: { font: EDILKAPPA_PDF_FONT, fontSize: 7.7, cellPadding: 2.1, lineColor: [212, 214, 216], lineWidth: 0.18, textColor: EDILKAPPA_DOCUMENT.dark, overflow: "linebreak" },
      headStyles: { fillColor: EDILKAPPA_DOCUMENT.dark, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [249, 249, 249] },
      rowPageBreak: "avoid",
      showHead: "everyPage",
      theme: "grid",
      ...options
    });
    return doc.lastAutoTable.finalY;
  }

  function pdfSignatureBlock(doc, context, y) {
    y = ensureDocumentSpace(doc, context, y, 26);
    doc.setFont(EDILKAPPA_PDF_FONT, "bold");
    doc.setFontSize(9.2);
    doc.text("ACCETTAZIONE E FIRME", 14, y);
    y += 7;
    doc.setFont(EDILKAPPA_PDF_FONT, "normal");
    doc.setFontSize(8.5);
    doc.text("Per il Committente", 14, y);
    doc.text("Per EdilKappa", 112, y);
    y += 11;
    doc.setDrawColor(90, 90, 90);
    doc.line(14, y, 94, y);
    doc.line(112, y, 196, y);
    doc.setFontSize(7.5);
    doc.text("Data, timbro e firma", 14, y + 4);
    doc.text("Timbro e firma", 112, y + 4);
    return y + 7;
  }

  function defaultPhotoCaption(preview) {
    const origin = normalizePhotoOrigin(preview?.photoOrigin);
    if (origin === "sopralluogo_edilkappa") return "Stato dei luoghi rilevato durante il sopralluogo EdilKappa.";
    if (origin === "cliente") return "Stato dei luoghi rappresentato nella fotografia ricevuta dal committente.";
    return "Stato dei luoghi documentato nella fotografia; origine da confermare.";
  }

  function photoAppendixSourceLine(entries) {
    const originals = (entries || []).filter((item) => !item?.generated);
    const origins = new Set(originals.map((item) => normalizePhotoOrigin(item?.photoOrigin)));
    if (!originals.length) return "Visualizzazioni illustrative della soluzione proposta.";
    if (origins.size === 1 && origins.has("sopralluogo_edilkappa")) return "Documentazione fotografica acquisita da EdilKappa durante il sopralluogo.";
    if (origins.size === 1 && origins.has("cliente")) return "Documentazione fotografica ricevuta dal committente e utilizzata come supporto preliminare.";
    if (origins.size === 1 && origins.has("da_confermare")) return "Documentazione fotografica disponibile; origine da confermare prima dell’emissione definitiva.";
    return "Documentazione fotografica proveniente da fonti diverse, indicate nelle singole didascalie.";
  }

  function photoCaptionForPreview(artifact, preview, index) {
    if (preview?.generated) {
      return {
        caption: customerFacingText(preview.title || "Soluzione proposta"),
        assessment: "Rappresentazione indicativa: non costituisce progetto esecutivo né verifica strutturale."
      };
    }
    const sourceValues = [preview?.sourceName, preview?.fileName, preview?.name]
      .map((value) => String(value || "").split("/").pop().replace(/\.(heic|heif|jpe?g|png|webp|gif)$/i, "").toLocaleLowerCase("it"))
      .filter((value) => value.length >= 5);
    const numberedReference = new RegExp(`\\b(?:foto|fotografia|immagine)\\s*${index + 1}(?!\\d)`, "i");
    const findings = Array.isArray(artifact?.report?.evidenceFindings) ? artifact.report.evidenceFindings : [];
    const finding = findings.find((item) => {
      const reference = String(item?.reference || "").toLocaleLowerCase("it");
      const observation = String(item?.observation || "").trim();
      const assessment = String(item?.assessment || "").trim();
      const matchesReference = numberedReference.test(reference) || sourceValues.some((token) => reference.includes(token));
      const nonVisual = /dichiarazione\s+del\s+cliente|pagament|acconto|saldo|\biva\b|aliquota|condizioni\s+commerciali|cliente\s+(?:chiede|dichiara|riferisce)|misur\w*\s+dichiar|durata|tempistic|prezz|importo|totale\s+complessivo/i.test(`${observation}\n${assessment}`);
      return matchesReference && observation && !nonVisual;
    });
    return finding
      ? { caption: customerFacingText(finding.observation).slice(0, 260), assessment: customerFacingText(finding.assessment || "").slice(0, 220) }
      : { caption: defaultPhotoCaption(preview), assessment: "" };
  }

  function addPhotoAppendix(doc, context, previews, artifact) {
    const entries = (previews || []).filter((item) => (item?.unavailable === true || /^data:image\/(jpeg|png);base64,/i.test(item.dataUrl)) && !/screenshot|schermata|preventiv|tabella/i.test(`${item.sourceName || ""} ${item.name || ""}`)).slice(0, 10);
    for (let offset = 0; offset < entries.length; offset += 2) {
      const pageEntries = entries.slice(offset, offset + 2);
      newDocumentPage(doc, context);
      doc.setFont(EDILKAPPA_PDF_FONT, "bold");
      doc.setFontSize(12);
      doc.text("ALLEGATO FOTOGRAFICO", 14, 49);
      doc.setFont(EDILKAPPA_PDF_FONT, "normal");
      doc.setFontSize(7.8);
      doc.setTextColor(85, 85, 85);
      doc.text(doc.splitTextToSize(photoAppendixSourceLine(pageEntries), 180).slice(0, 2), 14, 54);
      pageEntries.forEach((preview, localIndex) => {
        const index = offset + localIndex;
        const top = localIndex === 0 ? 61 : 166;
        const maxHeight = 78;
        if (preview.unavailable) {
          doc.setFillColor(247, 247, 247);
          doc.setDrawColor(185, 185, 185);
          doc.rect(14, top, 180, maxHeight, "FD");
          doc.setTextColor(95, 95, 95);
          doc.setFont(EDILKAPPA_PDF_FONT, "bold");
          doc.setFontSize(9.2);
          doc.text("FOTOGRAFIA NON DISPONIBILE NELLA BOZZA", 104, top + 34, { align: "center" });
          doc.setFont(EDILKAPPA_PDF_FONT, "normal");
          doc.setFontSize(8);
          const missingName = doc.splitTextToSize(String(preview.sourceName || preview.name || "Fotografia archiviata"), 150).slice(0, 2);
          doc.text(missingName, 104, top + 42, { align: "center" });
        } else {
          try {
            const properties = doc.getImageProperties(preview.dataUrl);
            const scale = Math.min(180 / properties.width, maxHeight / properties.height);
            const width = properties.width * scale;
            const height = properties.height * scale;
            doc.addImage(preview.dataUrl, properties.fileType || "JPEG", 14 + (180 - width) / 2, top, width, height, undefined, "FAST");
          } catch (_) {
            doc.setFont(EDILKAPPA_PDF_FONT, "normal");
            doc.setFontSize(8.5);
            doc.text("Anteprima non inseribile; l’originale resta nell’archivio EdilKappa.", 14, top + 8);
          }
        }
        const photoCaption = preview.unavailable
          ? { caption: `${preview.sourceName || preview.name || "Fotografia"} · da recuperare prima del documento definitivo.`, assessment: String(preview.failureReason || "Riprova con una connessione stabile.").slice(0, 220) }
          : photoCaptionForPreview(artifact, preview, index);
        doc.setTextColor(...EDILKAPPA_DOCUMENT.dark);
        doc.setFont(EDILKAPPA_PDF_FONT, "bold");
        doc.setFontSize(8.2);
        const originSuffix = !preview.generated
          && normalizePhotoOrigin(preview.photoOrigin) !== "sopralluogo_edilkappa"
          && !/committente|origine\s+da\s+confermare/i.test(photoCaption.caption)
          ? ` · ${photoOriginDescription(preview.photoOrigin)}`
          : "";
        const captionLines = doc.splitTextToSize(customerFacingText(`${preview.generated ? "VISUALIZZAZIONE ILLUSTRATIVA" : `FOTO ${index + 1}`} · ${photoCaption.caption}${originSuffix}`), 180).slice(0, 2);
        doc.text(captionLines, 14, top + 88);
        if (photoCaption.assessment) {
          doc.setFont(EDILKAPPA_PDF_FONT, "normal");
          doc.setFontSize(7.6);
          const assessmentLines = doc.splitTextToSize(photoCaption.assessment, 180).slice(0, 2);
          doc.text(assessmentLines, 14, top + 89.5 + captionLines.length * 3.5);
        }
      });
    }
    return {
      count: entries.length,
      signatureY: entries.length % 2 === 1 ? 170 : 0
    };
  }

  async function artifactPdfBlob(rawArtifact, destination, previews, options = {}) {
    if (!window.jspdf?.jsPDF) await window.EdilKappaLoader?.ensurePdf?.();
    if (!window.jspdf?.jsPDF) throw new Error("Il generatore PDF non è disponibile. Ricarica la pagina e riprova.");
    const draft = rawArtifact?.kind === "quote" && options?.draft === true;
    const verifiedArtifact = rawArtifact?.kind === "quote"
      ? (draft ? verifiedArtifactPrices(rawArtifact) : requireQuoteRelease(rawArtifact, destination))
      : rawArtifact;
    const artifact = customerFacingDocumentValue(verifiedArtifact);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
    await loadDocumentFonts(doc);
    doc.setFont(EDILKAPPA_PDF_FONT, "normal");
    const documentLabel = documentTypeLabel(artifact);
    const context = { company: documentCompany(), logo: await loadDocumentLogo(), label: draft ? `${documentLabel} · BOZZA` : documentLabel, draft };
    drawDocumentHeader(doc, context);
    doc.setFont(EDILKAPPA_PDF_FONT, "bold");
    doc.setFontSize(15.5);
    doc.text(context.label, 105, 50, { align: "center" });
    const subtitle = customerFacingText(artifact.documentSubtitle || artifact.title || artifact.subject || destination.title);
    doc.setFont(EDILKAPPA_PDF_FONT, "normal");
    doc.setFontSize(9.3);
    doc.setTextColor(95, 95, 95);
    doc.text(subtitle, 105, 56, { align: "center", maxWidth: 176 });
    doc.setTextColor(...EDILKAPPA_DOCUMENT.dark);
    const vatRate = Number(artifact.quote?.vatRate || 0);
    let y = runDocumentTable(doc, context, {
      startY: 63,
      body: [
        ...(destination.code ? [["Numero", destination.code]] : []),
        ["Destinatario", customerFacingText(destination.client.name || artifact.client || "Da assegnare")],
        ["Ubicazione intervento", customerFacingText(destination.client.address || artifact.address || "Da confermare")],
        ["Oggetto", customerFacingText(destination.title || artifact.subject || artifact.title || context.label)],
        ["Data emissione", new Date().toLocaleDateString("it-IT")],
        ...(artifact.kind === "quote" ? [["IVA applicata", `${vatRate}%`], ["Validità", `${Number(artifact.quote?.validityDays || 30)} giorni`]] : [["Priorità", artifact.report?.interventionPriority || "Da definire"]])
      ],
      columnStyles: { 0: { cellWidth: 48, fillColor: EDILKAPPA_DOCUMENT.light, fontStyle: "bold" } }
    }) + 6;
    y = ensureDocumentSpace(doc, context, y, 18);
    const callout = artifact.kind === "quote"
      ? (draft ? "BOZZA PRELIMINARE · NON INVIARE AL CLIENTE PRIMA DELLA CONFERMA" : "PREVENTIVO PROFESSIONALE EDILKAPPA")
      : "DOCUMENTO TECNICO EDILKAPPA";
    doc.setFillColor(...EDILKAPPA_DOCUMENT.yellow);
    const calloutLines = doc.splitTextToSize(callout, 172);
    const calloutHeight = Math.max(13, 7 + calloutLines.length * 4);
    doc.rect(14, y, 182, calloutHeight, "F");
    doc.setFont(undefined, "bold");
    doc.setFontSize(8.4);
    doc.text(calloutLines, 19, y + 6);
    y += calloutHeight + 7;
    const report = artifact.report || {};
    const quote = artifact.quote || {};
    y = pdfTextSection(doc, context, "Sintesi", artifact.kind === "report" ? (report.executiveSummary || artifact.summary) : artifact.summary, y);
    y = pdfTextSection(doc, context, "Soluzione raccomandata", artifact.recommendedSolution, y);

    if (artifact.kind === "quote") {
      const lines = quote.lines || [];
      y = ensureDocumentSpace(doc, context, y, 28);
      y = runDocumentTable(doc, context, {
        startY: y,
        head: [["N.", "LAVORAZIONE", "Q.TÀ", "U.M.", "PREZZO UNIT.", "IMPORTO"]],
        body: lines.map((line, index) => [String(index + 1), line.description, Number(line.quantity || 0).toLocaleString("it-IT"), line.unit || "a corpo", euro(line.unitPrice), euro(Number(line.quantity || 0) * Number(line.unitPrice || 0))]),
        columnStyles: { 0: { cellWidth: 9, halign: "center" }, 1: { cellWidth: 87 }, 2: { cellWidth: 15, halign: "right" }, 3: { cellWidth: 19 }, 4: { cellWidth: 25, halign: "right" }, 5: { cellWidth: 27, halign: "right", fontStyle: "bold" } }
      }) + 5;
      const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
      const discountPct = Number(quote.discountPct || 0);
      const discount = subtotal * discountPct / 100;
      const net = subtotal - discount;
      const vat = net * vatRate / 100;
      const totalsRows = [
        ["Subtotale lavorazioni", euro(subtotal)],
        ...(discount > 0.005 ? [[`Sconto ${discountPct}%`, `- ${euro(discount)}`]] : []),
        ["TOTALE IMPONIBILE", euro(net)],
        [`IVA ${vatRate}%`, euro(vat)],
        ["TOTALE COMPLESSIVO", euro(net + vat)]
      ];
      y = runDocumentTable(doc, context, {
        startY: y,
        body: totalsRows,
        tableWidth: 88,
        margin: { top: 45, right: 14, bottom: 21, left: 108 },
        columnStyles: { 0: { cellWidth: 53, fontStyle: "bold" }, 1: { cellWidth: 35, halign: "right", fontStyle: "bold" } },
        didParseCell: (data) => {
          if (data.section === "body" && data.row.index === totalsRows.length - 1) {
            data.cell.styles.fillColor = EDILKAPPA_DOCUMENT.yellow;
            data.cell.styles.textColor = EDILKAPPA_DOCUMENT.dark;
          }
        }
      }) + 7;
      y = pdfTextSection(doc, context, "Durata stimata", formatEstimatedDuration(quote.estimatedDuration), y);
      y = pdfListSection(doc, context, draft ? "Valutazione tecnica essenziale" : "Valutazione tecnica", draft ? (artifact.technicalAssessment || []).slice(0, 4) : artifact.technicalAssessment, y);
      y = pdfListSection(doc, context, "Fasi operative", draft ? (artifact.workPhases || []).slice(0, 6) : artifact.workPhases, y);
      if (!draft) y = pdfListSection(doc, context, "Materiali previsti", artifact.materials, y);
      y = pdfListSection(doc, context, draft ? "Opere comprese principali" : "Opere comprese", draft ? (quote.includedWorks || []).slice(0, 8) : quote.includedWorks, y);
      y = pdfListSection(doc, context, draft ? "Esclusioni principali" : "Esclusioni", draft ? (quote.exclusions || []).slice(0, 10) : quote.exclusions, y);
      if ((quote.options || []).length > 1) {
        y = ensureDocumentSpace(doc, context, y, 30);
        y = runDocumentTable(doc, context, {
          startY: y,
          head: [["ALTERNATIVA", "DESCRIZIONE", "IMPONIBILE"]],
          body: quote.options.map((option) => [
            [option.label, option.title, option.recommended ? "RACCOMANDATA" : ""].filter(Boolean).join(" · "),
            [option.description, scenarioIncludedWorks(option.includedWorks) ? `Comprende: ${scenarioIncludedWorks(option.includedWorks)}.` : "", option.notes].filter(Boolean).join("\n"),
            euro(option.total)
          ]),
          columnStyles: { 0: { cellWidth: 52, fontStyle: "bold" }, 1: { cellWidth: 98 }, 2: { cellWidth: 32, halign: "right", fontStyle: "bold" } }
        }) + 6;
      }
      y = pdfListSection(doc, context, draft ? "Ipotesi provvisorie" : "Ipotesi di calcolo", draft ? (quote.assumptions || []).slice(0, 6) : quote.assumptions, y);
      y = pdfTextSection(doc, context, "Condizioni e note", [quote.paymentTerms ? `Pagamento: ${quote.paymentTerms}` : "", quote.notes].filter(Boolean).join("\n"), y);
      y = pdfNumberedListSection(doc, context, "Dati da confermare", quoteMissingQuestions(artifact), y);
    } else {
      y = pdfTextSection(doc, context, "Motivazione tecnica", artifact.decisionRationale, y);
      y = pdfListSection(doc, context, "Valutazione tecnica", artifact.technicalAssessment, y);
      y = pdfListSection(doc, context, "Osservazioni", report.observations, y);
      y = pdfListSection(doc, context, "Cause probabili", report.probableCauses, y);
      if ((report.evidenceFindings || []).length) {
        y = ensureDocumentSpace(doc, context, y, 30);
        y = runDocumentTable(doc, context, {
          startY: y,
          head: [["RIFERIMENTO", "OSSERVAZIONE", "VALUTAZIONE", "VERIFICA"]],
          body: report.evidenceFindings.map((item) => [item.reference, item.observation, item.assessment, item.verificationNeeded]),
          columnStyles: { 0: { cellWidth: 31, fontStyle: "bold" }, 1: { cellWidth: 50 }, 2: { cellWidth: 55 }, 3: { cellWidth: 46 } }
        }) + 6;
      }
      y = pdfListSection(doc, context, "Verifiche consigliate", report.recommendedVerifications, y);
      y = pdfListSection(doc, context, "Fasi operative", artifact.workPhases, y);
      y = pdfListSection(doc, context, "Materiali previsti", artifact.materials, y);
      y = pdfListSection(doc, context, "Interventi consigliati", report.recommendedWorks, y);
      y = pdfListSection(doc, context, "Indicazioni di sicurezza", report.safetyNotes, y);
      y = pdfListSection(doc, context, "Limiti dell’analisi", report.limitations, y);
      y = pdfTextSection(doc, context, "Conclusioni", report.conclusions, y);
      y = pdfListSection(doc, context, "Informazioni da confermare", report.missingInformation, y);
    }
    const signatureY = y + 3;
    const deferredSignature = !draft && signatureY + 26 > 274;
    if (!draft && !deferredSignature) pdfSignatureBlock(doc, context, signatureY);
    const appendix = addPhotoAppendix(doc, context, previews, artifact);
    if (!draft && deferredSignature) {
      pdfSignatureBlock(doc, context, appendix.signatureY || signatureY);
    }
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(190, 190, 190);
      doc.setLineWidth(0.2);
      doc.line(14, 281.5, 196, 281.5);
      doc.setFont(EDILKAPPA_PDF_FONT, "normal");
      doc.setFontSize(7.1);
      doc.setTextColor(85, 85, 85);
      doc.text(`EdilKappa S.A.S. - ${context.company.address} - P. IVA ${context.company.vat}`, 14, 287);
      doc.text(`${context.label} | Pag. ${page}/${pages}`, 196, 287, { align: "right" });
    }
    return doc.output("blob");
  }

  async function reportPdfBlob(artifact, destination, previews) {
    return artifactPdfBlob(artifact, destination, previews);
  }

  function photoPreviewKey(item) {
    const value = String(item?.sourceName || item?.fileName || item?.name || item?.storagePath || "").toLowerCase();
    const fileName = value.split("/").pop() || value;
    return fileName.replace(/\.(heic|heif|jpe?g|png|webp|gif)$/i, "");
  }

  function photoCacheKey(item) {
    return String(item?.previewStoragePath || item?.storagePath || "");
  }

  function retryablePhotoError(error) {
    return /load failed|network|fetch|connection|connessione|unavailable|internal|deadline|timeout|temporar|retry/i.test(`${error?.code || ""} ${error?.message || ""}`);
  }

  async function retryPhotoOperation(operation) {
    let lastError;
    for (let attempt = 0; attempt < PDF_PHOTO_RETRY_DELAYS.length; attempt += 1) {
      const delay = PDF_PHOTO_RETRY_DELAYS[attempt];
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        if (!retryablePhotoError(error) || attempt === PDF_PHOTO_RETRY_DELAYS.length - 1) throw error;
      }
    }
    throw lastError || new Error("Recupero della fotografia non riuscito.");
  }

  function bytesFromBase64(value) {
    const binary = atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function imageBlobFromDataUrl(dataUrl) {
    const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ""));
    if (!match) throw new Error("La conversione fotografica restituita non è valida.");
    return new Blob([bytesFromBase64(match[2])], { type: match[1].toLowerCase() });
  }

  async function chunkedPhotoBlob(item, download) {
    const mimeType = String(download?.mimeType || "").toLowerCase();
    const byteLength = Number(download?.byteLength || 0);
    const chunkBytes = Math.max(1, Math.min(Number(download?.chunkBytes || PDF_PHOTO_CHUNK_MAX_BYTES), PDF_PHOTO_CHUNK_MAX_BYTES));
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(mimeType) || !Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > PDF_PHOTO_MAX_BYTES) {
      throw new Error("Dati dell’anteprima fotografica non validi.");
    }
    const chunks = [];
    let offset = 0;
    while (offset < byteLength) {
      const result = await retryPhotoOperation(() => window.EdilKappaCloud.aiRequest({
        action: "read_photo_preview_chunk",
        mode: "work",
        conversationId: state.activeConversation.work,
        mediaReference: item,
        offset
      }));
      const returnedOffset = Number(result?.offset);
      const nextOffset = Number(result?.nextOffset);
      if (returnedOffset !== offset || !Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > byteLength) {
        throw new Error("Sequenza dei frammenti fotografici non valida.");
      }
      const bytes = bytesFromBase64(result?.chunkBase64);
      if (bytes.length !== nextOffset - offset || bytes.length > chunkBytes) {
        throw new Error("Il frammento fotografico ricevuto è incompleto.");
      }
      chunks.push(bytes);
      offset = nextOffset;
    }
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size !== byteLength) throw new Error("La fotografia recuperata è incompleta.");
    return blob;
  }

  async function cloudPhotoReference(item) {
    const fileType = String(item?.fileType || "").toLowerCase();
    const isHeic = /^image\/(heic|heif)$/i.test(fileType);
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(fileType)) return { reference: item, dataUrl: "", download: null };
    if (!window.EdilKappaCloud?.aiRequest) {
      if (isHeic) throw new Error("Il convertitore fotografico cloud non è disponibile.");
      return { reference: item, dataUrl: "", download: null };
    }
    try {
      const result = await retryPhotoOperation(() => window.EdilKappaCloud.aiRequest({
        action: "prepare_photo_preview",
        mode: "work",
        conversationId: state.activeConversation.work,
        mediaReference: item
      }));
      if (!result?.preview?.previewStoragePath) throw new Error("L’anteprima fotografica cloud non è disponibile.");
      Object.assign(item, result.preview);
      return {
        reference: item,
        dataUrl: String(result.previewDataUrl || ""),
        download: result.previewDownload || null
      };
    } catch (error) {
      if (isHeic) throw error;
      console.warn("Recupero protetto della fotografia non disponibile; provo il collegamento diretto.", { fileName: item?.fileName, message: error?.message });
      return { reference: item, dataUrl: "", download: null };
    }
  }

  async function pdfPreviewFromCloud(item) {
    const cached = pdfPhotoCache.get(photoCacheKey(item));
    if (cached) return cached;
    const cloudPreview = await cloudPhotoReference(item);
    const reference = cloudPreview.reference;
    let blob;
    if (cloudPreview.dataUrl) {
      blob = imageBlobFromDataUrl(cloudPreview.dataUrl);
    } else if (cloudPreview.download?.byteLength) {
      blob = await chunkedPhotoBlob(item, cloudPreview.download);
    } else {
      const storagePath = reference.previewStoragePath || reference.storagePath;
      const url = await window.EdilKappaCloud?.getDocumentUrl?.(storagePath);
      if (!url) throw new Error("Collegamento della fotografia non disponibile.");
      blob = await retryPhotoOperation(async () => {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("Fotografia non scaricabile dall’archivio.");
        return response.blob();
      });
    }
    const fileType = String(blob.type || reference.previewFileType || reference.fileType || "").toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(fileType)) throw new Error("Formato dell’anteprima fotografica non valido.");
    const prepared = await compressedImage(new File([blob], reference.previewFileName || reference.fileName || "foto.jpg", { type: fileType }));
    const preview = {
      dataUrl: prepared.dataUrl,
      mimeType: prepared.mimeType,
      sourceName: reference.title || reference.fileName,
      name: reference.previewFileName || reference.fileName,
      generated: reference.generated === true,
      photoOrigin: reference.generated === true ? "da_confermare" : normalizePhotoOrigin(reference.photoOrigin)
    };
    const cacheKey = photoCacheKey(reference);
    if (cacheKey) {
      if (pdfPhotoCache.size >= 12) pdfPhotoCache.delete(pdfPhotoCache.keys().next().value);
      pdfPhotoCache.set(cacheKey, preview);
    }
    return preview;
  }

  async function previewsForReport(message, options = {}) {
    const previews = [];
    const seen = new Set();
    const localHeic = [];
    for (const item of message?.previews || []) {
      if (/^data:image\/(heic|heif);base64,/i.test(item?.dataUrl || "")) {
        localHeic.push(item);
        continue;
      }
      if (!/^data:image\/(jpeg|png);base64,/i.test(item?.dataUrl || "")) continue;
      const key = photoPreviewKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      previews.push(item);
    }
    const cloudImages = (message?.media || []).filter((item) => item.kind === "image" && item.storagePath && !/screenshot|schermata|preventiv|tabella/i.test(item.fileName || "")).slice(0, 10);
    const failedOriginals = [];
    for (const item of cloudImages) {
      const key = photoPreviewKey(item);
      if (key && seen.has(key)) continue;
      try {
        const preview = await pdfPreviewFromCloud(item);
        previews.push(preview);
        if (key) seen.add(key);
      } catch (error) {
        if (!item.generated) failedOriginals.push({ name: item.fileName || "fotografia", reason: error?.message || "Conversione non disponibile.", photoOrigin: normalizePhotoOrigin(item.photoOrigin) });
        console.warn("Anteprima fotografica non disponibile", { fileName: item.fileName, message: error?.message });
      }
    }
    localHeic.forEach((item) => {
      if (!seen.has(photoPreviewKey(item))) failedOriginals.push({ name: item.sourceName || item.name || "fotografia HEIC", reason: "L’originale non risulta archiviato nel cloud.", photoOrigin: normalizePhotoOrigin(item.photoOrigin) });
    });
    if (failedOriginals.length) {
      const names = Array.from(new Set(failedOriginals.map((item) => item.name)));
      const shownNames = names.slice(0, 3).join(", ") + (names.length > 3 ? ` e altre ${names.length - 3}` : "");
      const reason = Array.from(new Set(failedOriginals.map((item) => item.reason))).slice(0, 2).join(" ");
      if (options.allowMissing !== true) {
        throw new Error(`Non riesco a inserire nel PDF ${failedOriginals.length === 1 ? "la fotografia" : `${failedOriginals.length} fotografie`}: ${shownNames}. ${reason}`);
      }
      failedOriginals.forEach((item) => previews.push({
        unavailable: true,
        sourceName: item.name,
        name: item.name,
        failureReason: item.reason,
        photoOrigin: item.photoOrigin
      }));
    }
    return previews.filter((item) => !/screenshot|schermata|preventiv|tabella/i.test(`${item.sourceName || ""} ${item.name || ""}`)).slice(0, 10);
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
    const rows = customerFacingValues(values);
    return rows.length ? `<h2>${escapeHtml(title)}</h2><ul>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  }

  async function downloadArtifactWord(artifact) {
    artifact = customerFacingDocumentValue(verifiedArtifactPrices(artifact));
    const report = artifact.report || {};
    const quote = artifact.quote || {};
    const company = documentCompany();
    let logo = new URL("./linea-vita/assets/logo-edilkappa-pdf.jpg", location.href).href;
    try {
      const response = await fetch("./linea-vita/assets/logo-edilkappa-pdf.jpg");
      if (response.ok) logo = await fileDataUrl(await response.blob());
    } catch (_) {
      // Word può comunque caricare il logo dall'indirizzo pubblico dell'app.
    }
    const quoteSubtotal = (quote.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
    const quoteNet = quoteSubtotal * (1 - Number(quote.discountPct || 0) / 100);
    const quoteVat = quoteNet * Number(quote.vatRate || 0) / 100;
    const quoteRows = (quote.lines || []).map((line, index) => `<tr><td class="center">${index + 1}</td><td><b>${escapeHtml(line.description)}</b></td><td class="num">${escapeHtml(line.quantity)}</td><td>${escapeHtml(line.unit)}</td><td class="num">${escapeHtml(euro(line.unitPrice))}</td><td class="num"><b>${escapeHtml(euro(Number(line.quantity || 0) * Number(line.unitPrice || 0)))}</b></td></tr>`).join("");
    const options = (quote.options || []).length ? `<h2>Alternative e scenari</h2>${quote.options.map((option) => `<h3>${escapeHtml(option.label ? `${option.label} · ${option.title}` : option.title)} — ${escapeHtml(euro(option.total))} + IVA${option.recommended ? " (raccomandata)" : ""}</h3><p>${escapeHtml(option.description || "")}</p>${wordList("Opere comprese nello scenario", option.includedWorks)}${option.notes ? `<p>${escapeHtml(option.notes)}</p>` : ""}`).join("")}` : "";
    const evidenceRows = (report.evidenceFindings || []).map((item) => `<tr><td><b>${escapeHtml(item.reference)}</b></td><td>${escapeHtml(item.observation)}</td><td>${escapeHtml(item.assessment)}</td><td>${escapeHtml(item.verificationNeeded)}</td></tr>`).join("");
    const common = `${artifact.recommendedSolution ? `<h2>Soluzione raccomandata</h2><p>${escapeHtml(artifact.recommendedSolution)}</p>` : ""}${artifact.decisionRationale ? `<h2>Motivazione tecnica</h2><p>${escapeHtml(artifact.decisionRationale)}</p>` : ""}${wordList("Valutazione tecnica", artifact.technicalAssessment)}${wordList("Fasi operative", artifact.workPhases)}${wordList("Materiali previsti", artifact.materials)}`;
    const body = artifact.kind === "quote"
      ? `<h2>Sintesi</h2><p>${escapeHtml(artifact.summary || "")}</p>${common}<h2>Quadro economico</h2><table><thead><tr><th>N.</th><th>Lavorazione</th><th>Q.tà</th><th>U.M.</th><th>Prezzo unit.</th><th>Importo</th></tr></thead><tbody>${quoteRows}</tbody></table><table class="totals"><tbody><tr><td>Subtotale</td><td>${escapeHtml(euro(quoteSubtotal))}</td></tr><tr><td>Imponibile</td><td>${escapeHtml(euro(quoteNet))}</td></tr><tr><td>IVA ${escapeHtml(quote.vatRate || 0)}%</td><td>${escapeHtml(euro(quoteVat))}</td></tr><tr class="grand"><td>TOTALE COMPLESSIVO</td><td>${escapeHtml(euro(quoteNet + quoteVat))}</td></tr></tbody></table>${quote.estimatedDuration ? `<h2>Durata stimata</h2><p>${escapeHtml(formatEstimatedDuration(quote.estimatedDuration))}</p>` : ""}${wordList("Opere comprese", quote.includedWorks)}${wordList("Esclusioni", quote.exclusions)}${options}${wordList("Ipotesi di calcolo", quote.assumptions)}${quote.notes || quote.paymentTerms ? `<h2>Note e condizioni</h2><p>${quote.paymentTerms ? `<b>Pagamento:</b> ${escapeHtml(quote.paymentTerms)}<br>` : ""}${escapeHtml(quote.notes || "")}</p>` : ""}`
      : `<h2>Sintesi</h2><p>${escapeHtml(report.executiveSummary || artifact.summary || "")}</p>${common}${wordList("Osservazioni", report.observations)}${wordList("Cause probabili", report.probableCauses)}${evidenceRows ? `<h2>Riscontro tra prove e valutazione</h2><table><thead><tr><th>Riferimento</th><th>Osservazione</th><th>Valutazione</th><th>Verifica</th></tr></thead><tbody>${evidenceRows}</tbody></table>` : ""}${wordList("Verifiche consigliate", report.recommendedVerifications)}${wordList("Interventi consigliati", report.recommendedWorks)}${wordList("Sicurezza", report.safetyNotes)}${wordList("Limiti dell’analisi", report.limitations)}<h2>Conclusioni</h2><p>${escapeHtml(report.conclusions || "")}</p>${wordList("Informazioni da confermare", report.missingInformation)}`;
    const documentLabel = documentTypeLabel(artifact);
    const metaRows = [["Destinatario", artifact.client || "Da assegnare"], ["Ubicazione intervento", artifact.address || "Da confermare"], ["Oggetto", artifact.subject || artifact.title || documentLabel], ["Data emissione", new Date().toLocaleDateString("it-IT")], ...(artifact.kind === "quote" ? [["IVA applicata", `${Number(quote.vatRate || 0)}%`], ["Validità", `${Number(quote.validityDays || 30)} giorni`]] : [["Priorità", report.interventionPriority || "Da definire"]])];
    const meta = `<table class="meta"><tbody>${metaRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</tbody></table>`;
    const callout = artifact.kind === "quote" ? "PREVENTIVO PROFESSIONALE EDILKAPPA" : "DOCUMENTO TECNICO EDILKAPPA";
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:16mm 14mm 19mm}body{font-family:Arial,sans-serif;line-height:1.42;color:#232323;font-size:10pt;margin:0}.header{width:100%;border:0;margin:0}.header td{border:0;padding:0}.header .logo{width:205px}.company{text-align:right;font-size:8.5pt;line-height:1.35}.company b{font-size:9pt}.yellowbar{height:13px;background:#ffd800;margin-top:10px}.blackbar{height:20px;background:#232323;color:#fff;font-weight:bold;padding:4px 10px;box-sizing:border-box}.docTitle{text-align:center;font-size:18pt;margin:15px 0 3px}.subtitle{text-align:center;color:#6c6c6c;margin:0 0 14px}.meta{margin-bottom:12px}.meta th{width:28%;background:#f2f3f5;color:#232323}.callout{background:#ffd800;padding:11px 13px;font-weight:bold;margin:13px 0 16px}h2{font-size:11.5pt;text-transform:uppercase;color:#232323;margin:17px 0 6px;page-break-after:avoid}h3{font-size:10.5pt;margin:12px 0 4px}p{margin:5px 0 9px}ul{margin:5px 0 9px;padding-left:20px}li{margin-bottom:3px}table{width:100%;border-collapse:collapse;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #d4d6d8;padding:6px;text-align:left;vertical-align:top}thead th{background:#232323;color:#fff;font-size:8.5pt}.num{text-align:right;white-space:nowrap}.center{text-align:center}.totals{width:48%;margin:10px 0 14px auto}.totals td:first-child{font-weight:bold}.totals td:last-child{text-align:right;font-weight:bold}.totals .grand td{background:#ffd800;color:#232323;font-size:11pt}.signatures{width:100%;margin-top:28px;border:0;page-break-inside:avoid}.signatures td{border:0;width:50%;padding:8px 18px 28px 0}.signatureLine{border-bottom:1px solid #555;height:28px}.footer{margin-top:24px;border-top:1px solid #bbb;padding-top:7px;font-size:7.5pt;color:#555;display:flex;justify-content:space-between}small{color:#666}</style></head><body><table class="header"><tr><td><img class="logo" src="${escapeHtml(logo)}" alt="EDILKAPPA"></td><td class="company"><b>${escapeHtml(company.legalName)}</b><br>${escapeHtml(company.activity)}<br>${escapeHtml(company.email)} | ${escapeHtml(company.phone)}</td></tr></table><div class="yellowbar"></div><div class="blackbar">${escapeHtml(documentLabel)}</div><h1 class="docTitle">${escapeHtml(documentLabel)}</h1><p class="subtitle">${escapeHtml(artifact.documentSubtitle || artifact.title || artifact.subject || "Documento EdilKappa")}</p>${meta}<div class="callout">${escapeHtml(callout)}</div>${body}<table class="signatures"><tr><td><b>Per il Committente</b><div class="signatureLine"></div>Data, timbro e firma</td><td><b>Per EdilKappa</b><div class="signatureLine"></div>Timbro e firma</td></tr></table><div class="footer"><span>EdilKappa S.A.S. - ${escapeHtml(company.address)} - P. IVA ${escapeHtml(company.vat)}</span><span>${escapeHtml(documentLabel)}</span></div></body></html>`;
    const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName(artifact.title || artifact.subject, documentLabel)}.doc`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  window.edilkappaAiView = view;
  window.edilkappaAiToggleFocus = () => {
    if (!state.focusMode) {
      state.sidebarBeforeFocus = document.body.classList.contains("sidebarCollapsed");
      state.focusMode = true;
      window.setDesktopSidebarCollapsed?.(true, { persist: false });
    } else {
      state.focusMode = false;
      window.setDesktopSidebarCollapsed?.(state.sidebarBeforeFocus, { persist: false });
    }
    rerender();
  };
  window.edilkappaAiExitFocus = () => {
    if (!state.focusMode) return;
    state.focusMode = false;
    window.setDesktopSidebarCollapsed?.(state.sidebarBeforeFocus, { persist: false });
  };
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
  window.edilkappaAiSetPhotoOrigin = (value) => {
    if (state.sending) return;
    state.photoOrigin = normalizePhotoOrigin(value, DEFAULT_PHOTO_ORIGIN);
    state.attachments.forEach((item) => {
      if (["image", "video"].includes(item.kind)) item.photoOrigin = state.photoOrigin;
    });
    rerender();
  };
  window.edilkappaAiKeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); window.edilkappaAiSend(); }
  };
  window.edilkappaAiRemoveFile = (index) => {
    if (state.sending) return;
    state.attachments.splice(index, 1);
    rerender();
  };
  window.edilkappaAiAddFiles = async (files, inputElement) => {
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
          state.attachments.push({
            name: file.name,
            mimeType: prepared.mimeType,
            dataUrl: prepared.dataUrl,
            thumbnailDataUrl: prepared.thumbnailDataUrl || "",
            serverConversion: prepared.serverConversion === true,
            kind: "image",
            photoOrigin: state.photoOrigin,
            file
          });
        } else if (isVideo) {
          if (file.size > VIDEO_MAX_BYTES) throw new Error(`${file.name} supera 500 MB. Riduci il video prima di allegarlo.`);
          const item = { name: file.name, mimeType, kind: "video", photoOrigin: state.photoOrigin, file, frames: [], durationSeconds: 0, warning: "" };
          state.attachments.push(item);
          try {
            const prepared = await extractVideoFrames(file, (current, total) => {
              state.progress = `Estraggo i fotogrammi da ${file.name}: ${current}/${total}`;
              rerender();
            });
            item.frames = prepared.frames.map((frame) => ({ ...frame, photoOrigin: item.photoOrigin }));
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
      requestAttachmentsFor(state.attachments, { omitArchivedHeic: state.mode === "work", selectionOnly: true });
    } catch (error) {
      state.error = error?.message || "Non riesco ad allegare il file.";
    } finally {
      if (inputElement) inputElement.value = "";
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
    state.progress = `Creo “${artifact.visualBriefs[briefIndex].title}” con il motore immagini OpenAI…`;
    rerender();
    try {
      const referenceImages = (message.previews || []).filter((item) => /^image\//i.test(item.mimeType || "")).slice(0, 2);
      const result = await window.EdilKappaCloud.aiRequest({
        action: "generate_visual",
        mode: "work",
        conversationId: state.activeConversation.work,
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

  async function auditQuotePdfMessage(message, requestedMode = "work") {
    const artifact = message?.artifact;
    if (artifact?.kind !== "quote" || !artifact.id || message?.qualityAudit?.passed !== true || message?.qualityAudit?.blocking === true) return;
    if (!window.EdilKappaCloud?.ready || !window.EdilKappaCloud?.aiRequest || state.auditingPdf === artifact.id) return;
    state.auditingPdf = artifact.id;
    message.pdfAudit = { status: "checking", passed: false, pagesReviewed: 0, summary: "Controllo visivo del PDF in corso…", issues: [], warnings: [] };
    rerender();
    try {
      const database = window.EdilKappaLocal?.getDB?.() || {};
      const client = (database.condomini || []).find((item) => item.id === artifact.clientId || item.name === artifact.client)
        || { name: artifact.client || "Da assegnare", address: artifact.address || "" };
      const destination = { client, interventionId: artifact.interventionId || "", title: artifact.subject || artifact.title || "Preventivo" };
      const blob = await artifactPdfBlob(artifact, destination, await previewsForReport(message));
      const result = await window.EdilKappaCloud.aiRequest({
        action: "audit_quote_pdf",
        mode: requestedMode,
        conversationId: state.activeConversation[requestedMode],
        artifactId: artifact.id,
        pdfDataUrl: await fileDataUrl(blob)
      });
      if (!result?.pdfAudit) throw new Error("Il revisore PDF non ha restituito il controllo.");
      message.pdfAudit = result.pdfAudit;
    } catch (error) {
      message.pdfAudit = {
        status: "error",
        passed: false,
        pagesReviewed: 0,
        summary: error?.message || "Il controllo visivo del PDF non è riuscito.",
        issues: [],
        warnings: []
      };
    } finally {
      if (state.auditingPdf === artifact.id) state.auditingPdf = "";
      rerender();
    }
  }

  function addCompletedAiResult(result, requestedMode, mediaReferences, requestAttachments) {
    const artifactId = result.artifact?.id;
    if (artifactId && state.messages[requestedMode].some((item) => item.artifact?.id === artifactId)) return;
    const completedMessage = {
      role: "assistant",
      text: result.answer,
      sources: result.sources || [],
      artifact: result.artifact || null,
      media: result.media || mediaReferences || [],
      model: result.model || "",
      modelLabel: result.modelLabel || "",
      reasoningEffort: result.reasoningEffort || "",
      fallbackUsed: result.fallbackUsed === true,
      engine: result.engine || "",
      agentName: result.agentName || "",
      reviewerName: result.reviewerName || "",
      reviewFallbackUsed: result.reviewFallbackUsed === true,
      approvalRequired: result.approvalRequired === true,
      qualityAudit: result.qualityAudit || null,
      pdfAudit: result.pdfAudit || null,
      previews: (requestAttachments || []).filter((item) => item.mimeType?.startsWith("image/")).slice(0, 6),
      at: Date.now()
    };
    state.messages[requestedMode].push(completedMessage);
    if (result.artifact?.kind === "quote") {
      window.EdilKappaCompletion?.addActivity?.({
        id: `quote-ready-${result.artifact.id || Date.now()}`,
        type: "quote",
        title: "Preventivo pronto da controllare",
        text: result.artifact.title || result.artifact.subject || "Apri l’anteprima, controlla e conferma il preventivo.",
        targetType: "ai",
        targetId: result.artifact.id || ""
      });
      if (completedMessage.qualityAudit?.passed === true && completedMessage.qualityAudit?.blocking !== true && completedMessage.pdfAudit?.passed !== true) {
        setTimeout(() => auditQuotePdfMessage(completedMessage, requestedMode), 0);
      }
    }
    state.loaded[requestedMode] = true;
  }

  async function pollPendingJob(requestAttachments = [], mediaReferences = []) {
    const pending = state.pendingJob;
    if (!pending?.jobId || !window.EdilKappaCloud?.aiRequest) return;
    state.sending = true;
    state.retryAvailable = false;
    while (state.pendingJob?.jobId === pending.jobId) {
      const status = await window.EdilKappaCloud.aiRequest({ action: "job_status", mode: pending.mode, conversationId: pending.conversationId, jobId: pending.jobId });
      if (status.status === "completed") {
        state.pendingJob.stage = "completed";
        state.progress = stageLabel("completed");
        rerender();
        addCompletedAiResult(status.result, pending.mode, mediaReferences, requestAttachments);
        state.conversationsLoaded[pending.mode] = false;
        rememberPendingJob(null);
        state.attachments = [];
        state.draft = "";
        state.sending = false;
        state.progress = "";
        rerender();
        return;
      }
      if (status.status === "failed") {
        state.pendingJob.stage = status.stage || "failed";
        state.pendingJob.failed = true;
        state.pendingJob.retryWithoutAttachments = status.retryWithoutAttachments === true;
        rememberPendingJob(state.pendingJob);
        state.error = status.error || "La generazione non è riuscita. La richiesta resta pronta per essere riprovata.";
        state.retryAvailable = status.canRetry === true;
        state.draft ||= pending.message || "";
        state.sending = false;
        state.progress = "";
        rerender();
        return;
      }
      state.pendingJob.stage = status.stage || state.pendingJob.stage || "analysis";
      rememberPendingJob(state.pendingJob);
      state.progress = stageLabel(state.pendingJob.stage);
      rerender();
      if (Number(pending.startedAt || 0) > 0 && Date.now() - Number(pending.startedAt) >= PENDING_JOB_UI_TIMEOUT_MS) {
        state.pendingJob.stage = "timeout";
        state.pendingJob.failed = true;
        state.pendingJob.retryWithoutAttachments = pending.jobId.startsWith("agent-");
        rememberPendingJob(state.pendingJob);
        state.error = "L’elaborazione ha superato il tempo massimo. Premi Riprova: le foto sono già archiviate.";
        state.retryAvailable = true;
        state.draft ||= pending.message || "";
        state.sending = false;
        state.progress = "";
        rerender();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3500));
    }
  }

  window.edilkappaAiResumePending = async () => {
    if (state.sending || !pendingJobCanResume(state.pendingJob) || !window.EdilKappaCloud?.ready) return;
    state.progress = stageLabel(state.pendingJob.stage || "analysis");
    state.error = "";
    rerender();
    try {
      await pollPendingJob();
    } catch (error) {
      state.sending = false;
      state.error = error?.message || "Non riesco a controllare la generazione. Premi Riprova tra poco.";
      state.retryAvailable = true;
      state.progress = "";
      rerender();
    }
  };

  window.edilkappaAiRetry = async () => {
    const pending = state.pendingJob;
    if (pending?.jobId?.startsWith("agent-") && window.EdilKappaCloud?.aiRequest) {
      state.sending = true;
      state.error = "";
      state.retryAvailable = false;
      state.progress = "Riprendo il preventivo usando le foto già archiviate…";
      rerender();
      try {
        const result = await window.EdilKappaCloud.aiRequest({
          action: "retry_agent_job",
          mode: pending.mode,
          conversationId: pending.conversationId,
          jobId: pending.jobId
        });
        rememberPendingJob({
          jobId: result.jobId,
          mode: pending.mode,
          conversationId: pending.conversationId,
          stage: result.stage || "agent",
          message: pending.message || state.draft,
          startedAt: Date.now(),
          retryWithoutAttachments: true
        });
        state.progress = stageLabel(state.pendingJob.stage);
        rerender();
        await pollPendingJob();
      } catch (error) {
        state.sending = false;
        state.error = error?.message || "Non riesco a riavviare il preventivo. Riprova tra poco.";
        state.retryAvailable = true;
        state.progress = "";
        rerender();
      }
      return;
    }
    const message = state.pendingJob?.message || state.draft;
    rememberPendingJob(null);
    state.sending = false;
    state.error = "";
    state.retryAvailable = false;
    state.draft = message || state.draft;
    rerender();
    setTimeout(() => window.edilkappaAiSend(), 0);
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
      const requestAttachments = requestAttachmentsFor(originals, { omitArchivedHeic: requestedMode === "work" });
      userMessage.media = mediaReferences;
      state.progress = originals.some((item) => item.kind === "video") ? "Trascrivo l’audio, analizzo i fotogrammi e preparo il risultato…" : "Analizzo gli allegati e preparo il risultato…";
      rerender();
      const result = await window.EdilKappaCloud.aiRequest({
        action: "ask",
        mode: requestedMode,
        conversationId: state.activeConversation[requestedMode],
        taskType: requestedMode === "work" ? state.taskType : "auto",
        modelMode: state.modelMode,
        message,
        attachments: requestAttachments,
        mediaReferences,
        useWeb: state.useWeb,
        businessContext: requestedMode === "work" ? businessContext(message) : null
      });
      if (!result.jobId) throw new Error("EdilKappa AI non ha restituito l’identificativo della generazione.");
      rememberPendingJob({ jobId: result.jobId, mode: requestedMode, conversationId: state.activeConversation[requestedMode], stage: result.stage || "analysis", message, startedAt: Date.now() });
      state.progress = stageLabel(state.pendingJob.stage);
      rerender();
      await pollPendingJob(requestAttachments, mediaReferences);
      if (archiveWarnings.length) state.error = `Analisi completata, ma questi originali non sono stati archiviati: ${archiveWarnings.join(", ")}. Riprova il caricamento prima di usare il documento definitivo.`;
    } catch (error) {
      state.error = error?.message || "La richiesta non è riuscita. Riprova.";
      state.retryAvailable = true;
    } finally {
      if (!state.pendingJob?.jobId || state.error) state.sending = false;
      if (!state.sending) state.progress = "";
      rerender();
    }
  };
  window.edilkappaAiDestinationChanged = (select) => {
    const target = select.form?.querySelector('[name="interventionId"]');
    if (target) target.innerHTML = interventionOptions(select.value, "");
  };
  window.edilkappaAiAuditPdf = (messageIndex) => {
    const message = artifactMessage(messageIndex);
    if (message?.artifact?.kind !== "quote") return;
    auditQuotePdfMessage(message, state.mode);
  };
  window.edilkappaAiSaveArtifact = (messageIndex) => {
    const message = artifactMessage(messageIndex);
    const artifact = message?.artifact;
    if (!artifact || !["quote", "report"].includes(artifact.kind)) return;
    if (artifact.kind === "quote") {
      try {
        requireMessageQuoteRelease(message);
      } catch (error) {
        return alert(error?.message || "Il preventivo non ha superato tutti i controlli.");
      }
    }
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
  window.edilkappaAiRequestChange = (messageIndex) => {
    const artifact = artifactMessage(messageIndex)?.artifact;
    if (artifact?.kind !== "quote") return;
    state.draft = `Modifica il preventivo “${artifact.title || artifact.subject || "corrente"}”: `;
    rerender();
    setTimeout(() => {
      const input = document.getElementById("ekAiInput");
      input?.focus();
      input?.setSelectionRange?.(input.value.length, input.value.length);
    }, 40);
  };
  window.edilkappaAiAnswerMissing = (messageIndex) => {
    const artifact = artifactMessage(messageIndex)?.artifact;
    if (artifact?.kind !== "quote") return;
    const questions = quoteMissingQuestions(artifact);
    if (!questions.length) return;
    state.draft = [
      `Completa il preventivo “${artifact.title || artifact.subject || "corrente"}” usando queste risposte:`,
      ...questions.flatMap((question, index) => [`${index + 1}. ${question}`, "Risposta: "]),
      "Se una misura non è disponibile, mantieni il preventivo preliminare con una stima a corpo e indica che dovrà essere verificata in sopralluogo."
    ].join("\n");
    rerender();
    setTimeout(() => {
      const input = document.getElementById("ekAiInput");
      input?.focus();
      input?.setSelectionRange?.(input.value.length, input.value.length);
    }, 40);
  };
  window.edilkappaAiDownloadPdf = async (messageIndex) => {
    const message = artifactMessage(messageIndex);
    const artifact = message?.artifact;
    if (!["quote", "report"].includes(artifact?.kind)) return;
    state.progress = "Genero il PDF con il modello ufficiale EdilKappa…";
    state.error = "";
    rerender();
    try {
      const database = window.EdilKappaLocal?.getDB?.() || {};
      const client = (database.condomini || []).find((item) => item.id === artifact.clientId || item.name === artifact.client) || { name: artifact.client || "Da assegnare", address: artifact.address || "" };
      const destination = { client, interventionId: artifact.interventionId || "", title: artifact.subject || artifact.title || documentTypeLabel(artifact) };
      const release = artifact.kind === "quote" ? quoteMessageReleaseCheck(message, destination) : { passed: true };
      const draft = artifact.kind === "quote" && !release.passed;
      const photoPreviews = await previewsForReport(message, { allowMissing: draft });
      const blob = await artifactPdfBlob(artifact, destination, photoPreviews, { draft });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${draft ? "BOZZA-" : ""}${safeName(customerFacingText(artifact.title || artifact.subject), artifact.kind === "quote" ? "Preventivo" : "Relazione-tecnica")}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      state.error = error?.message || "Non riesco a generare il PDF.";
    } finally {
      state.progress = "";
      rerender();
    }
  };
  window.edilkappaAiSharePdf = async (messageIndex) => {
    const message = artifactMessage(messageIndex);
    const artifact = message?.artifact;
    if (artifact?.kind !== "quote") return;
    state.progress = "Preparo il preventivo da condividere…";
    state.error = "";
    rerender();
    try {
      const database = window.EdilKappaLocal?.getDB?.() || {};
      const client = (database.condomini || []).find((item) => item.id === artifact.clientId || item.name === artifact.client) || { name: artifact.client || "Da assegnare", address: artifact.address || "" };
      const destination = { client, interventionId: artifact.interventionId || "", title: artifact.subject || artifact.title || "Preventivo" };
      requireMessageQuoteRelease(message, destination);
      const blob = await artifactPdfBlob(artifact, destination, await previewsForReport(message));
      const fileName = `${safeName(customerFacingText(artifact.title || artifact.subject), "Preventivo")}.pdf`;
      const file = new File([blob], fileName, { type: "application/pdf" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ title: fileName, text: "Preventivo EdilKappa", files: [file] });
      else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        alert("Il dispositivo non supporta la condivisione diretta: il PDF è stato scaricato.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") state.error = error?.message || "Non riesco a condividere il PDF.";
    } finally {
      state.progress = "";
      rerender();
    }
  };
  window.edilkappaAiDownloadSavedQuote = async (quote) => {
    if (!quote?.aiArtifact) return alert("Questo preventivo non contiene il documento completo EdilKappa AI.");
    try {
      const database = window.EdilKappaLocal?.getDB?.() || {};
      const client = (database.condomini || []).find((item) => item.id === quote.clientId)
        || (database.condomini || []).find((item) => item.name === quote.client)
        || { id: quote.clientId || "", name: quote.client || "Da assegnare", address: quote.aiArtifact.address || "" };
      const destination = { client, interventionId: quote.interventionId || "", title: quote.subject || quote.aiArtifact.subject || quote.aiArtifact.title, code: quote.code || "" };
      const message = { artifact: quote.aiArtifact, media: quote.media || [], previews: [] };
      const blob = await artifactPdfBlob(quote.aiArtifact, destination, await previewsForReport(message));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeName(customerFacingText(quote.code ? `${quote.code}-${quote.subject || "Preventivo"}` : quote.subject), "Preventivo")}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      alert(error?.message || "Non riesco a generare il PDF completo del preventivo.");
    }
  };
  window.edilkappaAiDownloadWord = async (messageIndex) => {
    const message = artifactMessage(messageIndex);
    const artifact = message?.artifact;
    if (!["quote", "report"].includes(artifact?.kind)) return;
    try {
      await downloadArtifactWord(artifact.kind === "quote" ? requireMessageQuoteRelease(message) : artifact);
    } catch (error) {
      state.error = error?.message || "Non riesco a generare il documento Word.";
      rerender();
    }
  };
  window.edilkappaAiNewConversation = async () => {
    if (state.sending || !window.EdilKappaCloud?.aiRequest) return;
    try {
      const result = await window.EdilKappaCloud.aiRequest({ action: "new_conversation", mode: state.mode });
      if (!result.conversation?.id) throw new Error("Non riesco a creare la nuova chat.");
      state.conversations[state.mode].unshift(result.conversation);
      state.activeConversation[state.mode] = result.conversation.id;
      state.messages[state.mode] = [];
      state.loaded[state.mode] = true;
      state.draft = "";
      state.attachments = [];
      rerender();
    } catch (error) { state.error = error?.message || "Non riesco a creare la nuova chat."; rerender(); }
  };
  window.edilkappaAiSelectConversation = (id) => {
    if (state.sending || !id || id === state.activeConversation[state.mode]) return;
    state.activeConversation[state.mode] = id;
    state.messages[state.mode] = [];
    state.loaded[state.mode] = false;
    state.draft = "";
    state.attachments = [];
    rerender();
  };
  window.edilkappaAiRenameConversation = async (id) => {
    if (state.sending) return;
    const item = state.conversations[state.mode].find((row) => row.id === id);
    if (!item) return;
    const title = prompt("Nuovo nome della chat:", item.title || "Nuova conversazione");
    if (title === null || !title.trim()) return;
    try {
      await window.EdilKappaCloud.aiRequest({ action: "rename_conversation", mode: state.mode, conversationId: id, title: title.trim() });
      item.title = title.trim();
      rerender();
    } catch (error) { state.error = error?.message || "Non riesco a rinominare la chat."; rerender(); }
  };
  window.edilkappaAiDeleteConversation = async (id) => {
    if (state.sending) return;
    const item = state.conversations[state.mode].find((row) => row.id === id);
    if (!item || !confirm(`Eliminare definitivamente la chat “${item.title || "Nuova conversazione"}”?`)) return;
    try {
      await window.EdilKappaCloud.aiRequest({ action: "delete_conversation", mode: state.mode, conversationId: id });
      state.conversations[state.mode] = state.conversations[state.mode].filter((row) => row.id !== id);
      if (state.activeConversation[state.mode] === id) {
        state.activeConversation[state.mode] = state.conversations[state.mode][0]?.id || "legacy";
        state.messages[state.mode] = [];
        state.loaded[state.mode] = false;
      }
      rerender();
    } catch (error) { state.error = error?.message || "Non riesco a eliminare la chat."; rerender(); }
  };
  window.edilkappaAiReset = async () => {
    if (state.resetting || !confirm("Svuotare tutti i messaggi di questa chat?")) return;
    state.resetting = true;
    state.error = "";
    try {
      await window.EdilKappaCloud.aiRequest({ action: "reset", mode: state.mode, conversationId: state.activeConversation[state.mode] });
      state.messages[state.mode] = [];
      state.loaded[state.mode] = true;
    } catch (error) {
      state.error = error?.message || "Non riesco a cancellare la memoria.";
    } finally {
      state.resetting = false;
      rerender();
    }
  };
  if (window.__EDILKAPPA_AI_TEST__) {
    window.EdilKappaAiTest = {
      artifactPdfBlob,
      chunkedPhotoBlob,
      customerFacingDocumentValue,
      customerFacingText,
      customerFacingValues,
      euro,
      formatEstimatedDuration,
      imageBlobFromDataUrl,
      pdfTextSection,
      pdfPreviewFromCloud,
      previewsForReport,
      photoCaptionForPreview,
      photoAppendixSourceLine,
      normalizePhotoOrigin,
      quoteMissingQuestions,
      quoteMessageReleaseCheck,
      runDocumentTable,
      scenarioIncludedWorks,
      setDocumentLogoDataUrl(value) { documentLogoDataUrl = String(value || ""); }
    };
  }
})();
