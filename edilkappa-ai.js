(function () {
  "use strict";

  const state = {
    mode: "work",
    messages: { work: [], personal: [] },
    loaded: { work: false, personal: false },
    loading: false,
    sending: false,
    resetting: false,
    attachments: [],
    useWeb: false,
    error: "",
    nextHistoryAttempt: 0
  };

  const css = document.createElement("style");
  css.textContent = `
    .ekAiPage{max-width:1120px;margin:0 auto}.ekAiHero{background:linear-gradient(135deg,#102c22,#1e4938);border-radius:22px;padding:22px;color:#fff;display:flex;justify-content:space-between;gap:18px;align-items:center;box-shadow:0 14px 40px rgba(11,43,31,.14)}
    .ekAiHero h2{margin:0 0 6px;font-size:25px}.ekAiHero p{margin:0;color:#d7e9df}.ekAiHeroMark{width:58px;height:58px;border-radius:18px;background:#c9f31d;color:#102c22;display:grid;place-items:center;font-size:30px;font-weight:900;flex:0 0 auto}
    .ekAiToolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:16px 0}.ekAiModes{display:flex;padding:4px;border:1px solid #d9e2dc;background:#fff;border-radius:13px}.ekAiModes button{border:0;background:transparent;border-radius:10px;padding:10px 15px;font-weight:800;color:#557064;cursor:pointer}.ekAiModes button.active{background:#173d2e;color:#fff}.ekAiStatus{display:flex;gap:8px;align-items:center;color:#577064;font-size:13px}.ekAiDot{width:9px;height:9px;border-radius:50%;background:#22a565;box-shadow:0 0 0 4px #dff4e8}
    .ekAiChat{min-height:430px;max-height:58vh;overflow:auto;background:#f7faf8;border:1px solid #dce7e0;border-radius:20px;padding:18px;display:flex;flex-direction:column;gap:13px}.ekAiEmpty{margin:auto;text-align:center;max-width:620px;color:#52665d;padding:28px}.ekAiEmpty strong{display:block;color:#173d2e;font-size:20px;margin-bottom:7px}
    .ekAiMessage{max-width:84%;border-radius:17px;padding:13px 15px;line-height:1.5;box-shadow:0 3px 12px rgba(20,53,40,.06)}.ekAiMessage.user{align-self:flex-end;background:#173d2e;color:#fff;border-bottom-right-radius:5px}.ekAiMessage.assistant{align-self:flex-start;background:#fff;color:#1d3028;border:1px solid #dce7e0;border-bottom-left-radius:5px}.ekAiText{white-space:pre-wrap;overflow-wrap:anywhere}.ekAiSources{margin-top:11px;padding-top:9px;border-top:1px solid #e3ebe6;display:flex;gap:7px;flex-wrap:wrap}.ekAiSources a{font-size:12px;color:#176542;text-decoration:none;background:#e8f6ed;border-radius:999px;padding:5px 9px}.ekAiTyping{display:inline-flex;gap:5px}.ekAiTyping i{width:7px;height:7px;background:#668078;border-radius:50%;animation:ekAiPulse 1.1s infinite}.ekAiTyping i:nth-child(2){animation-delay:.15s}.ekAiTyping i:nth-child(3){animation-delay:.3s}@keyframes ekAiPulse{0%,70%,100%{opacity:.3;transform:translateY(0)}35%{opacity:1;transform:translateY(-3px)}}
    .ekAiQuick{display:flex;gap:8px;flex-wrap:wrap;margin:13px 0}.ekAiQuick button{border:1px solid #d6e2da;background:#fff;color:#244a3a;border-radius:999px;padding:8px 12px;font-weight:700;cursor:pointer}.ekAiQuick button:hover{border-color:#6da482}
    .ekAiComposer{background:#fff;border:1px solid #d8e3dc;border-radius:18px;padding:12px;box-shadow:0 8px 28px rgba(17,56,41,.08)}.ekAiComposer textarea{border:0!important;box-shadow:none!important;resize:vertical;min-height:76px;width:100%;padding:7px;font:inherit;outline:0;background:transparent}.ekAiComposeBar{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}.ekAiActions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ekAiFileBtn,.ekAiWeb{display:inline-flex;align-items:center;gap:7px;border:1px solid #d7e2db;background:#f8faf9;border-radius:10px;padding:9px 11px;font-weight:700;color:#365749;cursor:pointer;font-size:13px}.ekAiWeb input{width:auto}.ekAiSend{border:0;background:#c9f31d;color:#143528;border-radius:11px;padding:11px 18px;font-weight:900;cursor:pointer}.ekAiSend:disabled{opacity:.55;cursor:wait}.ekAiFiles{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 9px}.ekAiFile{display:flex;align-items:center;gap:6px;background:#edf4ef;color:#355246;border-radius:9px;padding:7px 9px;font-size:12px}.ekAiFile button{border:0;background:transparent;color:#9b2f2f;font-weight:900;cursor:pointer}.ekAiError{margin:10px 0;background:#fff0f0;border:1px solid #f1c8c8;color:#8f2929;border-radius:11px;padding:10px 12px}.ekAiPrivacy{font-size:12px;color:#64766e;margin:10px 2px 0}.ekAiReset{border:0;background:transparent;color:#7b3c3c;text-decoration:underline;cursor:pointer;font-size:12px}
    @media(max-width:700px){.ekAiHero{padding:18px}.ekAiHeroMark{width:48px;height:48px}.ekAiToolbar{align-items:flex-start}.ekAiStatus{display:none}.ekAiChat{min-height:350px;max-height:52vh;padding:12px}.ekAiMessage{max-width:92%}.ekAiComposer{padding:10px}.ekAiComposeBar,.ekAiActions{align-items:stretch}.ekAiSend{flex:1}.ekAiWeb{justify-content:center}}
  `;
  document.head.appendChild(css);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
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

  function messageHtml(message) {
    const sources = (message.sources || []).map(sourceHtml).join("");
    return `<div class="ekAiMessage ${message.role === "user" ? "user" : "assistant"}"><div class="ekAiText">${escapeHtml(message.text)}</div>${sources ? `<div class="ekAiSources">${sources}</div>` : ""}</div>`;
  }

  function quickPrompts() {
    return state.mode === "personal"
      ? ["Organizza la mia giornata", "Scrivi un messaggio", "Aiutami a decidere", "Cerca informazioni aggiornate"]
      : ["Controlla i cantieri attivi", "Prepara una bozza di preventivo", "Scrivi una relazione tecnica", "Analizza una foto del sopralluogo"];
  }

  function renderAttachments() {
    return state.attachments.map((file, index) => `<span class="ekAiFile">${file.mimeType.startsWith("image/") ? "📷" : "📄"} ${escapeHtml(file.name)} <button onclick="edilkappaAiRemoveFile(${index})" aria-label="Rimuovi">×</button></span>`).join("");
  }

  function view() {
    if (state.mode === "personal" && !isOwner()) state.mode = "work";
    const messages = currentMessages();
    if (!state.loaded[state.mode] && !state.loading && Date.now() >= state.nextHistoryAttempt) setTimeout(loadHistory, 0);
    const modeLabel = state.mode === "work" ? "Lavoro" : "Personale";
    return `<div class="ekAiPage">
      <section class="ekAiHero"><div><h2>EdilKappa AI</h2><p>Il tuo assistente per lavoro, documenti, foto e organizzazione.</p></div><div class="ekAiHeroMark">✦</div></section>
      <div class="ekAiToolbar"><div class="ekAiModes"><button class="${state.mode === "work" ? "active" : ""}" onclick="edilkappaAiSetMode('work')">🏗️ Lavoro</button>${isOwner() ? `<button class="${state.mode === "personal" ? "active" : ""}" onclick="edilkappaAiSetMode('personal')">👤 Personale</button>` : ""}</div><div class="ekAiStatus"><i class="ekAiDot"></i> Protetta dal login EdilKappa · ${modeLabel}</div></div>
      <div class="ekAiChat" id="ekAiChat">${state.loading && !messages.length ? `<div class="ekAiEmpty"><strong>Carico la memoria ${modeLabel.toLowerCase()}…</strong></div>` : messages.length ? messages.map(messageHtml).join("") : `<div class="ekAiEmpty"><strong>${state.mode === "work" ? "Come posso aiutare EdilKappa oggi?" : "Questa è la tua area personale"}</strong>${state.mode === "work" ? "Posso usare il riepilogo del gestionale, analizzare foto e documenti o fare ricerche aggiornate." : "Le conversazioni personali restano separate da quelle aziendali."}</div>`}${state.sending ? `<div class="ekAiMessage assistant"><span class="ekAiTyping"><i></i><i></i><i></i></span></div>` : ""}</div>
      <div class="ekAiQuick">${quickPrompts().map((prompt) => `<button onclick="edilkappaAiUsePrompt('${escapeHtml(prompt)}')">${escapeHtml(prompt)}</button>`).join("")}</div>
      ${state.error ? `<div class="ekAiError">${escapeHtml(state.error)}</div>` : ""}
      <div class="ekAiComposer"><div class="ekAiFiles">${renderAttachments()}</div><textarea id="ekAiInput" maxlength="8000" placeholder="Scrivi qui…" onkeydown="edilkappaAiKeydown(event)"></textarea><div class="ekAiComposeBar"><div class="ekAiActions"><label class="ekAiFileBtn">📎 Allega<input id="ekAiFiles" type="file" hidden multiple accept="image/jpeg,image/png,image/webp,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" onchange="edilkappaAiAddFiles(this.files)"></label><label class="ekAiWeb"><input type="checkbox" ${state.useWeb ? "checked" : ""} onchange="edilkappaAiToggleWeb(this.checked)"> 🌐 Ricerca web</label></div><button class="ekAiSend" onclick="edilkappaAiSend()" ${state.sending ? "disabled" : ""}>${state.sending ? "Attendi…" : "Invia ✦"}</button></div></div>
      <div class="ekAiPrivacy">La chiave API resta sul server. Memoria ${modeLabel.toLowerCase()} separata. <button class="ekAiReset" onclick="edilkappaAiReset()" ${state.resetting ? "disabled" : ""}>Cancella questa memoria</button></div>
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
    const compact = (items, fields, limit = 15) => (items || []).slice(0, limit).map((item) => Object.fromEntries(fields.map((field) => [field, item?.[field]]).filter(([, value]) => value !== undefined && value !== "")));
    return {
      azienda: (database.companySettings || [])[0] || {},
      riepilogo: {
        clienti: (database.condomini || []).length,
        cantieriAttivi: (database.sites || []).filter((item) => item.status !== "Completato").length,
        sopralluoghiDaGestire: (database.inspections || []).filter((item) => item.status === "Da preventivare").length,
        preventiviAperti: (database.quotes || []).filter((item) => !["Accettato", "Rifiutato"].includes(item.status)).length
      },
      cantieri: compact((database.sites || []).filter((item) => item.status !== "Completato"), ["title", "client", "address", "start", "status", "progress", "value", "cost", "worker"]),
      sopralluoghi: compact(database.inspections, ["date", "time", "type", "client", "address", "problem", "status"], 12),
      preventivi: compact(database.quotes, ["code", "client", "subject", "net", "date", "status"], 12),
      squadre: compact(database.teams, ["id", "name", "member1", "member2"], 10)
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
    if (file.type) return file.type.toLowerCase();
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    return ({ pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain", csv: "text/csv", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" })[extension] || "";
  }

  async function compressedImage(file, mimeType) {
    if (file.size <= 1800000) return fileDataUrl(file);
    const objectUrl = URL.createObjectURL(file);
    const picture = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Non riesco ad aprire questa fotografia."));
      };
      image.src = objectUrl;
    });
    const scale = Math.min(1, 1800 / Math.max(picture.naturalWidth, picture.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    canvas.getContext("2d").drawImage(picture, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(objectUrl);
    const outputType = mimeType === "image/webp" ? "image/webp" : "image/jpeg";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, 0.82));
    if (!blob) throw new Error("Non riesco a preparare questa fotografia.");
    return { dataUrl: await fileDataUrl(blob), mimeType: outputType };
  }

  window.edilkappaAiView = view;
  window.edilkappaAiSetMode = (mode) => {
    if (!['work', 'personal'].includes(mode) || (mode === 'personal' && !isOwner()) || state.sending) return;
    state.mode = mode;
    state.attachments = [];
    state.error = "";
    rerender();
  };
  window.edilkappaAiUsePrompt = (prompt) => {
    const input = document.getElementById("ekAiInput");
    if (input) { input.value = prompt; input.focus(); }
  };
  window.edilkappaAiToggleWeb = (checked) => { state.useWeb = checked === true; };
  window.edilkappaAiKeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); window.edilkappaAiSend(); }
  };
  window.edilkappaAiRemoveFile = (index) => { state.attachments.splice(index, 1); rerender(); };
  window.edilkappaAiAddFiles = async (files) => {
    state.error = "";
    try {
      const chosen = Array.from(files || []);
      if (state.attachments.length + chosen.length > 3) throw new Error("Puoi allegare al massimo 3 file per messaggio.");
      for (const file of chosen) {
        let mimeType = inferredType(file);
        let dataUrl;
        if (mimeType.startsWith("image/")) {
          const prepared = await compressedImage(file, mimeType);
          if (typeof prepared === "string") dataUrl = prepared;
          else { dataUrl = prepared.dataUrl; mimeType = prepared.mimeType; }
        } else {
          if (file.size > 6 * 1024 * 1024) throw new Error(`${file.name} supera 6 MB.`);
          dataUrl = await fileDataUrl(file);
        }
        if (!mimeType || dataUrl.length * 0.75 > 6 * 1024 * 1024) throw new Error(`${file.name} è troppo grande o non supportato.`);
        state.attachments.push({ name: file.name, mimeType, dataUrl });
      }
      const total = state.attachments.reduce((sum, item) => sum + item.dataUrl.length * 0.75, 0);
      if (total > 8 * 1024 * 1024) { state.attachments = []; throw new Error("Gli allegati insieme superano 8 MB."); }
    } catch (error) {
      state.error = error.message || "Non riesco ad allegare il file.";
    }
    rerender();
  };
  window.edilkappaAiSend = async () => {
    if (state.sending) return;
    const input = document.getElementById("ekAiInput");
    const message = String(input?.value || "").trim();
    if (!message && !state.attachments.length) { state.error = "Scrivi una richiesta o allega un file."; rerender(); return; }
    if (!window.EdilKappaCloud?.ready || !window.EdilKappaCloud?.aiRequest) { state.error = "Il collegamento cloud non è ancora pronto."; rerender(); return; }
    const requestedMode = state.mode;
    const attachments = state.attachments.slice();
    const shownText = message || "Analizza gli allegati.";
    state.messages[requestedMode].push({ role: "user", text: shownText + (attachments.length ? `\n📎 ${attachments.map((item) => item.name).join(", ")}` : ""), at: Date.now() });
    state.attachments = [];
    state.sending = true;
    state.error = "";
    rerender();
    try {
      const result = await window.EdilKappaCloud.aiRequest({
        action: "ask",
        mode: requestedMode,
        message,
        attachments,
        useWeb: state.useWeb,
        businessContext: requestedMode === "work" ? businessContext() : null
      });
      state.messages[requestedMode].push({ role: "assistant", text: result.answer, sources: result.sources || [], at: Date.now() });
      state.loaded[requestedMode] = true;
    } catch (error) {
      state.error = error?.message || "La richiesta non è riuscita. Riprova.";
    } finally {
      state.sending = false;
      rerender();
    }
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
