(function () {
  "use strict";

  const root = document.getElementById("app");
  const toast = document.getElementById("toast");
  const onlineBadge = document.getElementById("online-badge");
  const bottomNav = document.getElementById("bottom-nav");
  const installHeaderButton = document.getElementById("install-header-button");
  const signatureModal = document.getElementById("signature-modal");
  const signatureCanvas = document.getElementById("signature-canvas");
  const signatureTitle = document.getElementById("signature-title");

  const state = {
    view: "home",
    inspections: [],
    settings: null,
    current: null,
    step: 1,
    storage: null,
    deferredInstallPrompt: null,
    signatureKind: null,
    signatureDirty: false,
  };

  let saveTimer;
  let toastTimer;
  let signatureContext;
  let drawingSignature = false;

  function setPath(object, path, nextValue) {
    const keys = path.split(".");
    const last = keys.pop();
    const target = keys.reduce((value, key) => {
      if (!value[key] || typeof value[key] !== "object") value[key] = {};
      return value[key];
    }, object);
    target[last] = nextValue;
  }

  function getPath(object, path) {
    return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);
  }

  function showToast(message, type = "success", duration = 3200) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `toast show toast-${type}`;
    toastTimer = setTimeout(() => {
      toast.className = "toast";
    }, duration);
  }

  function setSaveState(label, mode = "saved") {
    const element = document.getElementById("save-state");
    if (!element) return;
    element.className = `save-state save-${mode}`;
    element.innerHTML = `<span class="save-dot"></span> ${window.EKViews.esc(label)}`;
  }

  function render() {
    root.innerHTML = window.EKViews.render(state);
    document.body.dataset.view = state.view;
    updateNav();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function updateNav() {
    const active = state.view === "inspection" ? "new" : state.view;
    bottomNav.querySelectorAll("[data-nav]").forEach((button) => {
      button.classList.toggle("active", button.dataset.nav === active);
    });
  }

  async function refreshInspections() {
    state.inspections = await window.EKDB.getAllInspections();
  }

  async function saveCurrent(showConfirmation = false) {
    if (!state.current) return;
    clearTimeout(saveTimer);
    setSaveState("Salvataggio…", "saving");
    state.current.currentStep = state.step;
    state.current = await window.EKDB.saveInspection(state.current);
    await refreshInspections();
    setSaveState("Salvato", "saved");
    if (showConfirmation) showToast("Ispezione salvata sul telefono.");
  }

  function scheduleSave() {
    if (!state.current) return;
    setSaveState("Modifiche da salvare", "pending");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveCurrent().catch((error) => showToast(error.message, "error", 5000));
    }, 650);
  }

  async function navigate(view) {
    if (state.current && state.view === "inspection") await saveCurrent();
    state.view = view;
    if (view !== "inspection") state.current = null;
    if (view === "home" || view === "archive") await refreshInspections();
    if (view === "settings") state.storage = await window.EKDB.storageEstimate();
    render();
  }

  async function newInspection() {
    if (state.current && state.view === "inspection") await saveCurrent();
    state.current = window.EKData.newInspection(state.settings);
    state.step = 1;
    state.view = "inspection";
    await saveCurrent();
    render();
  }

  async function openInspection(id) {
    const inspection = await window.EKDB.getInspection(id);
    if (!inspection) {
      showToast("Ispezione non trovata.", "error");
      return;
    }
    state.current = inspection;
    state.step = Math.min(7, Math.max(1, Number(inspection.currentStep) || 1));
    state.view = "inspection";
    render();
  }

  function deepClone(input) {
    return typeof structuredClone === "function" ? structuredClone(input) : JSON.parse(JSON.stringify(input));
  }

  async function duplicateInspection(id) {
    const source = await window.EKDB.getInspection(id);
    if (!source) return;
    const fresh = window.EKData.newInspection(state.settings);
    const copy = deepClone(source);
    copy.id = fresh.id;
    copy.sheetNumber = fresh.sheetNumber;
    copy.status = "bozza";
    copy.createdAt = fresh.createdAt;
    copy.updatedAt = fresh.updatedAt;
    copy.completedAt = "";
    copy.identification.inspectionDate = fresh.identification.inspectionDate;
    copy.identification.startTime = fresh.identification.startTime;
    copy.identification.endTime = "";
    copy.declarations.date = fresh.declarations.date;
    copy.declarations.inspectorSignature = "";
    copy.declarations.clientSignature = "";
    await window.EKDB.saveInspection(copy);
    await refreshInspections();
    render();
    showToast("Ispezione duplicata come nuova bozza.");
  }

  async function deleteInspection(id) {
    const item = state.inspections.find((inspection) => inspection.id === id) || (state.current?.id === id ? state.current : null);
    if (!item) return;
    if (!window.confirm(`Eliminare definitivamente la scheda ${item.sheetNumber}?`)) return;
    await window.EKDB.deleteInspection(id);
    await refreshInspections();
    if (state.current?.id === id) {
      state.current = null;
      state.view = "archive";
    }
    render();
    showToast("Ispezione eliminata.");
  }

  async function pdfInspection(id) {
    const inspection = id ? await window.EKDB.getInspection(id) : state.current;
    if (!inspection) return;
    showToast("Preparazione PDF in corso…", "info", 6000);
    try {
      await window.EKPdf.download(inspection, state.settings);
      showToast("PDF creato. Controlla i download o il menu Condividi.");
    } catch (error) {
      console.error(error);
      showToast(`Impossibile creare il PDF: ${error.message}`, "error", 6000);
    }
  }

  function validateCompletion() {
    const current = state.current;
    const missing = [];
    if (!current.identification.client.trim()) missing.push({ step: 1, label: "Committente" });
    if (!current.identification.inspectionDate) missing.push({ step: 1, label: "Data ispezione" });
    if (!current.identification.address.trim()) missing.push({ step: 1, label: "Indirizzo del sito" });
    if (!current.inspection.inspectorName.trim()) missing.push({ step: 1, label: "Nome ispettore" });
    if (!current.overall.outcome) missing.push({ step: 6, label: "Esito complessivo" });
    if (!current.declarations.inspectorSignature) missing.push({ step: 7, label: "Firma ispettore" });
    return missing;
  }

  async function completeInspection() {
    const missing = validateCompletion();
    if (missing.length) {
      state.step = missing[0].step;
      render();
      showToast(`Prima di concludere compila: ${missing.map((item) => item.label).join(", ")}.`, "error", 6500);
      return;
    }
    state.current.status = "completata";
    state.current.completedAt = new Date().toISOString();
    if (!state.current.identification.endTime) state.current.identification.endTime = window.EKData.localTime();
    await saveCurrent();
    render();
    showToast("Ispezione conclusa e pronta per il PDF.");
  }

  function updateArrayField(path, itemValue, checked) {
    const array = Array.isArray(getPath(state.current, path)) ? [...getPath(state.current, path)] : [];
    const existing = array.indexOf(itemValue);
    if (checked && existing === -1) array.push(itemValue);
    if (!checked && existing !== -1) array.splice(existing, 1);
    setPath(state.current, path, array);
  }

  function handleInspectionInput(target) {
    if (!state.current) return;

    if (target.dataset.field) {
      let nextValue = target.value;
      if (target.type === "checkbox") nextValue = target.checked;
      setPath(state.current, target.dataset.field, nextValue);
      scheduleSave();
      if (target.type === "radio") updateSegmentSelection(target);
      return;
    }

    if (target.dataset.arrayField) {
      updateArrayField(target.dataset.arrayField, target.value, target.checked);
      scheduleSave();
      return;
    }

    if (target.dataset.list) {
      const index = Number(target.dataset.index);
      const list = state.current[target.dataset.list];
      if (!Array.isArray(list) || !list[index]) return;
      list[index][target.dataset.prop] = target.type === "checkbox" ? target.checked : target.value;
      scheduleSave();
      if (target.type === "radio") updateSegmentSelection(target);
    }
  }

  function updateSegmentSelection(target) {
    const container = target.closest(".segmented");
    if (!container) return;
    container.querySelectorAll(".segment").forEach((label) => {
      label.classList.toggle("is-selected", label.querySelector("input").checked);
    });
  }

  function addComponent() {
    state.current.components.push({
      id: window.EKData.uuid(),
      ref: String(state.current.components.length + 1),
      type: "",
      manufacturerModel: "",
      lotSerial: "",
      quantity: "",
      position: "",
      outcome: "",
    });
    scheduleSave();
    render();
  }

  function addMeasurement() {
    state.current.measurements.push({
      id: window.EKData.uuid(),
      point: "",
      control: "",
      instrument: "",
      serialCalibration: "",
      requiredValue: "",
      measuredValue: "",
      outcome: "",
    });
    scheduleSave();
    render();
  }

  function addNonConformity() {
    state.current.nonConformities.push({
      id: window.EKData.uuid(),
      zone: "",
      description: "",
      classification: "",
      action: "",
      responsible: "",
      dueDate: "",
    });
    scheduleSave();
    render();
  }

  function removeListItem(listName, index, message) {
    const list = state.current[listName];
    if (!Array.isArray(list) || !list[index]) return;
    if (message && !window.confirm(message)) return;
    list.splice(index, 1);
    scheduleSave();
    render();
  }

  function getLocation() {
    if (!navigator.geolocation) {
      showToast("La posizione GPS non è disponibile su questo dispositivo.", "error");
      return;
    }
    showToast("Rilevamento posizione…", "info", 5000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        state.current.identification.gps = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        scheduleSave();
        render();
        showToast("Posizione GPS inserita.");
      },
      (error) => showToast(`Posizione non rilevata: ${error.message}`, "error", 5000),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Lettura fotografia non riuscita."));
      reader.readAsDataURL(file);
    });
  }

  async function compressImage(file) {
    const source = await readFileAsDataUrl(file);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 1600;
        const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * ratio));
        const height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.onerror = () => reject(new Error(`Formato fotografico non leggibile: ${file.name}`));
      image.src = source;
    });
  }

  async function addPhotos(files) {
    const selected = [...files];
    if (!selected.length) return;
    const allowed = Math.max(0, 24 - state.current.photos.length);
    if (!allowed) {
      showToast("Hai raggiunto il limite di 24 fotografie per ispezione.", "error");
      return;
    }
    showToast(`Preparazione di ${Math.min(selected.length, allowed)} fotografie…`, "info", 12000);
    for (const file of selected.slice(0, allowed)) {
      try {
        const dataUrl = await compressImage(file);
        state.current.photos.push({
          id: window.EKData.uuid(),
          dataUrl,
          fileName: file.name || `foto-${state.current.photos.length + 1}.jpg`,
          title: `Foto ${state.current.photos.length + 1}`,
          position: "",
          description: "",
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        showToast(error.message, "error", 5000);
      }
    }
    await saveCurrent();
    render();
    showToast("Fotografie aggiunte e salvate.");
  }

  function openSignature(kind) {
    state.signatureKind = kind;
    state.signatureDirty = false;
    signatureTitle.textContent = kind === "inspector" ? "Firma dell'ispettore" : "Firma del committente / responsabile";
    signatureModal.hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => setupSignatureCanvas(kind));
  }

  function setupSignatureCanvas(kind) {
    const rect = signatureCanvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    signatureCanvas.width = Math.round(rect.width * ratio);
    signatureCanvas.height = Math.round(rect.height * ratio);
    signatureContext = signatureCanvas.getContext("2d");
    signatureContext.scale(ratio, ratio);
    signatureContext.fillStyle = "#ffffff";
    signatureContext.fillRect(0, 0, rect.width, rect.height);
    signatureContext.strokeStyle = "#111111";
    signatureContext.lineWidth = 2.2;
    signatureContext.lineCap = "round";
    signatureContext.lineJoin = "round";

    const existing = kind === "inspector" ? state.current.declarations.inspectorSignature : state.current.declarations.clientSignature;
    if (existing) {
      const image = new Image();
      image.onload = () => signatureContext.drawImage(image, 0, 0, rect.width, rect.height);
      image.src = existing;
    }
  }

  function signaturePoint(event) {
    const rect = signatureCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startSignature(event) {
    if (signatureModal.hidden) return;
    drawingSignature = true;
    state.signatureDirty = true;
    const point = signaturePoint(event);
    signatureContext.beginPath();
    signatureContext.moveTo(point.x, point.y);
    signatureCanvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveSignature(event) {
    if (!drawingSignature || signatureModal.hidden) return;
    const point = signaturePoint(event);
    signatureContext.lineTo(point.x, point.y);
    signatureContext.stroke();
    event.preventDefault();
  }

  function endSignature(event) {
    drawingSignature = false;
    signatureCanvas.releasePointerCapture?.(event.pointerId);
  }

  function clearSignatureCanvas() {
    if (!signatureContext) return;
    const rect = signatureCanvas.getBoundingClientRect();
    signatureContext.clearRect(0, 0, rect.width, rect.height);
    signatureContext.fillStyle = "#ffffff";
    signatureContext.fillRect(0, 0, rect.width, rect.height);
    state.signatureDirty = true;
  }

  function closeSignature() {
    signatureModal.hidden = true;
    document.body.classList.remove("modal-open");
    drawingSignature = false;
  }

  async function saveSignature() {
    if (!state.signatureKind) return;
    const dataUrl = signatureCanvas.toDataURL("image/png");
    if (state.signatureKind === "inspector") state.current.declarations.inspectorSignature = dataUrl;
    else state.current.declarations.clientSignature = dataUrl;
    closeSignature();
    await saveCurrent();
    render();
    showToast("Firma salvata.");
  }

  function clearSavedSignature(kind) {
    if (!window.confirm("Cancellare questa firma?")) return;
    if (kind === "inspector") state.current.declarations.inspectorSignature = "";
    else state.current.declarations.clientSignature = "";
    scheduleSave();
    render();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportBackup() {
    const payload = await window.EKDB.createBackup();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `Backup_EdilKappa_LineaVita_${date}.json`);
    showToast("Copia di sicurezza scaricata.");
  }

  async function importBackup(file) {
    try {
      const payload = JSON.parse(await file.text());
      const count = await window.EKDB.restoreBackup(payload, "merge");
      state.settings = await window.EKDB.getSettings();
      await refreshInspections();
      state.storage = await window.EKDB.storageEstimate();
      render();
      showToast(`Backup ripristinato: ${count} ispezioni importate.`);
    } catch (error) {
      showToast(error.message || "Backup non valido.", "error", 6000);
    }
  }

  async function saveSettings() {
    state.settings = await window.EKDB.saveSettings(state.settings);
    showToast("Impostazioni salvate.");
  }

  async function persistStorage() {
    if (!navigator.storage?.persist) {
      showToast("Questa funzione non è supportata dal browser.", "error");
      return;
    }
    const granted = await navigator.storage.persist();
    showToast(granted ? "Archivio locale protetto dalla cancellazione automatica." : "Il dispositivo non ha concesso la protezione. Mantieni un backup aggiornato.", granted ? "success" : "info", 5500);
  }

  async function clearAllData() {
    const answer = window.prompt("Questa operazione elimina tutte le ispezioni. Scrivi CANCELLA per confermare.");
    if (answer !== "CANCELLA") return;
    await window.EKDB.clearAllData();
    state.settings = await window.EKDB.getSettings();
    await refreshInspections();
    state.storage = await window.EKDB.storageEstimate();
    render();
    showToast("Archivio cancellato.");
  }

  function filterArchive(query) {
    const normalized = query.trim().toLowerCase();
    const cards = [...root.querySelectorAll(".inspection-card")];
    let visible = 0;
    cards.forEach((card) => {
      const match = !normalized || card.dataset.searchText.includes(normalized);
      card.hidden = !match;
      if (match) visible += 1;
    });
    const empty = document.getElementById("archive-no-results");
    if (empty) empty.hidden = visible !== 0;
  }

  function updateConnectionStatus() {
    const online = navigator.onLine;
    onlineBadge.textContent = online ? "Online" : "Offline";
    onlineBadge.className = `connection-badge ${online ? "is-online" : "is-offline"}`;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  async function installApp() {
    if (isStandalone()) {
      showToast("L'app è già installata sul dispositivo.");
      return;
    }
    if (state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      installHeaderButton.hidden = true;
      return;
    }
    const message = isIos()
      ? "Su iPhone: apri questa pagina in Safari, tocca Condividi (quadrato con freccia) e scegli Aggiungi alla schermata Home."
      : "Apri il menu del browser e scegli Installa app oppure Aggiungi alla schermata Home.";
    window.alert(message);
  }

  function handleSettingsInput(target) {
    if (!target.dataset.settingsField) return;
    state.settings[target.dataset.settingsField] = target.value;
  }

  async function handleClick(event) {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      if (nav.dataset.nav === "new") await newInspection();
      else await navigate(nav.dataset.nav);
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) return;
    event.preventDefault();
    const action = button.dataset.action;

    if (action === "new-inspection") await newInspection();
    else if (action === "open-inspection") await openInspection(button.dataset.id);
    else if (action === "duplicate-inspection") await duplicateInspection(button.dataset.id);
    else if (action === "delete-inspection") await deleteInspection(button.dataset.id);
    else if (action === "pdf-inspection") await pdfInspection(button.dataset.id);
    else if (action === "pdf-current") {
      await saveCurrent();
      await pdfInspection();
    } else if (action === "save-inspection") await saveCurrent(true);
    else if (action === "complete-inspection") await completeInspection();
    else if (action === "go-step") {
      await saveCurrent();
      state.step = Number(button.dataset.step);
      render();
    } else if (action === "next-step") {
      await saveCurrent();
      state.step = Math.min(7, state.step + 1);
      render();
    } else if (action === "previous-step") {
      await saveCurrent();
      state.step = Math.max(1, state.step - 1);
      render();
    } else if (action === "get-location") getLocation();
    else if (action === "add-component") addComponent();
    else if (action === "remove-component") removeListItem("components", Number(button.dataset.index), "Rimuovere questo componente?");
    else if (action === "add-measurement") addMeasurement();
    else if (action === "remove-measurement") removeListItem("measurements", Number(button.dataset.index), "Rimuovere questa misura?");
    else if (action === "add-nc") addNonConformity();
    else if (action === "remove-nc") removeListItem("nonConformities", Number(button.dataset.index), "Rimuovere questa non conformità?");
    else if (action === "remove-photo") removeListItem("photos", Number(button.dataset.index), "Eliminare questa fotografia?");
    else if (action === "open-signature") openSignature(button.dataset.kind);
    else if (action === "clear-signature") clearSavedSignature(button.dataset.kind);
    else if (action === "save-settings") await saveSettings();
    else if (action === "export-backup") await exportBackup();
    else if (action === "import-backup") document.getElementById("backup-input")?.click();
    else if (action === "persist-storage") await persistStorage();
    else if (action === "clear-all-data") await clearAllData();
    else if (action === "install-app") await installApp();
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      handleClick(event).catch((error) => {
        console.error(error);
        showToast(error.message || "Operazione non riuscita.", "error", 6000);
      });
    });

    root.addEventListener("input", (event) => {
      handleInspectionInput(event.target);
      handleSettingsInput(event.target);
      if (event.target.matches("[data-archive-search]")) filterArchive(event.target.value);
    });

    root.addEventListener("change", (event) => {
      handleInspectionInput(event.target);
      handleSettingsInput(event.target);
      if (event.target.matches("[data-photo-input]")) addPhotos(event.target.files);
      if (event.target.matches("[data-backup-input]") && event.target.files[0]) importBackup(event.target.files[0]);
    });

    signatureCanvas.addEventListener("pointerdown", startSignature);
    signatureCanvas.addEventListener("pointermove", moveSignature);
    signatureCanvas.addEventListener("pointerup", endSignature);
    signatureCanvas.addEventListener("pointercancel", endSignature);
    document.getElementById("signature-clear").addEventListener("click", clearSignatureCanvas);
    document.getElementById("signature-cancel").addEventListener("click", closeSignature);
    document.getElementById("signature-save").addEventListener("click", () => saveSignature().catch((error) => showToast(error.message, "error")));
    signatureModal.addEventListener("click", (event) => {
      if (event.target === signatureModal) closeSignature();
    });

    window.addEventListener("online", updateConnectionStatus);
    window.addEventListener("offline", updateConnectionStatus);
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.deferredInstallPrompt = event;
      installHeaderButton.hidden = false;
    });
    installHeaderButton.addEventListener("click", installApp);
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("sw.js", { scope: "./" });
    } catch (error) {
      console.warn("Service worker non registrato", error);
    }
  }

  async function init() {
    bindEvents();
    updateConnectionStatus();
    try {
      await window.EKDB.openDb();
      state.settings = await window.EKDB.getSettings();
      await refreshInspections();
      state.storage = await window.EKDB.storageEstimate();
      render();
      registerServiceWorker();
    } catch (error) {
      console.error(error);
      root.innerHTML = `<div class="fatal-error"><h1>Archivio non disponibile</h1><p>${window.EKViews.esc(error.message)}</p><p>Apri l'app da Safari o Chrome e verifica che la navigazione privata sia disattivata.</p></div>`;
    }
  }

  init();
})();
