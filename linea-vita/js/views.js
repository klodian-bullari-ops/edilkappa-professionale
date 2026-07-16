(function () {
  "use strict";

  function esc(input) {
    return String(input ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function get(object, path) {
    return path.split(".").reduce((value, key) => (value == null ? "" : value[key]), object);
  }

  function field(label, path, current, type = "text", attrs = "") {
    const fieldValue = get(current, path);
    return `
      <label class="field">
        <span class="field-label">${esc(label)}</span>
        <input type="${esc(type)}" data-field="${esc(path)}" value="${esc(fieldValue)}" ${attrs}>
      </label>`;
  }

  function textarea(label, path, current, placeholder = "", rows = 3) {
    return `
      <label class="field field-wide">
        <span class="field-label">${esc(label)}</span>
        <textarea data-field="${esc(path)}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(get(current, path))}</textarea>
      </label>`;
  }

  function select(label, path, current, options, attrs = "") {
    const selected = String(get(current, path) ?? "");
    return `
      <label class="field">
        <span class="field-label">${esc(label)}</span>
        <select data-field="${esc(path)}" ${attrs}>
          ${options
            .map((option) => {
              const item = typeof option === "string" ? { value: option, label: option } : option;
              return `<option value="${esc(item.value)}" ${String(item.value) === selected ? "selected" : ""}>${esc(item.label)}</option>`;
            })
            .join("")}
        </select>
      </label>`;
  }

  function listField(label, list, index, prop, value, type = "text", attrs = "") {
    return `
      <label class="field">
        <span class="field-label">${esc(label)}</span>
        <input type="${esc(type)}" data-list="${esc(list)}" data-index="${index}" data-prop="${esc(prop)}" value="${esc(value)}" ${attrs}>
      </label>`;
  }

  function listTextarea(label, list, index, prop, value, placeholder = "") {
    return `
      <label class="field field-wide">
        <span class="field-label">${esc(label)}</span>
        <textarea data-list="${esc(list)}" data-index="${index}" data-prop="${esc(prop)}" rows="2" placeholder="${esc(placeholder)}">${esc(value)}</textarea>
      </label>`;
  }

  function segmented(list, index, prop, selected, options) {
    const name = `${list}-${index}-${prop}`;
    return `<div class="segmented" role="radiogroup">
      ${options
        .map(
          (option) => `<label class="segment ${String(selected) === String(option.value) ? "is-selected" : ""}">
            <input type="radio" name="${esc(name)}" data-list="${esc(list)}" data-index="${index}" data-prop="${esc(prop)}" value="${esc(option.value)}" ${String(selected) === String(option.value) ? "checked" : ""}>
            <span>${esc(option.label)}</span>
          </label>`
        )
        .join("")}
    </div>`;
  }

  function outcomePill(code) {
    const labels = {
      A: "Positivo",
      B: "Con prescrizioni",
      C: "Fuori servizio",
      D: "Sospesa",
    };
    if (!code) return '<span class="badge badge-draft">Senza esito</span>';
    return `<span class="badge outcome-${esc(code.toLowerCase())}">${esc(labels[code] || code)}</span>`;
  }

  function formatDate(input) {
    if (!input) return "Data non indicata";
    const parts = String(input).split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(input);
  }

  function inspectionCard(item) {
    const client = item.identification?.client || "Committente non indicato";
    const address = item.identification?.address || item.identification?.city || "Sito non indicato";
    const search = `${item.sheetNumber} ${client} ${address} ${item.identification?.inspectionDate || ""}`.toLowerCase();
    return `
      <article class="inspection-card" data-search-text="${esc(search)}">
        <button class="card-main" data-action="open-inspection" data-id="${esc(item.id)}">
          <span class="card-topline">
            <strong>${esc(item.sheetNumber)}</strong>
            ${outcomePill(item.overall?.outcome)}
          </span>
          <span class="card-client">${esc(client)}</span>
          <span class="card-meta">${esc(formatDate(item.identification?.inspectionDate))} · ${esc(address)}</span>
        </button>
        <div class="card-actions">
          <button class="icon-button" data-action="pdf-inspection" data-id="${esc(item.id)}" aria-label="Crea PDF">PDF</button>
          <button class="icon-button" data-action="duplicate-inspection" data-id="${esc(item.id)}" aria-label="Duplica">Duplica</button>
          <button class="icon-button danger-quiet" data-action="delete-inspection" data-id="${esc(item.id)}" aria-label="Elimina">Elimina</button>
        </div>
      </article>`;
  }

  function renderHome(state) {
    const recent = state.inspections.slice(0, 3);
    const completed = state.inspections.filter((item) => item.status === "completata").length;
    const drafts = state.inspections.length - completed;
    const critical = state.inspections.filter((item) => item.overall?.outcome === "C").length;
    return `
      <section class="hero">
        <div>
          <p class="eyebrow">Strumento operativo EdilKappa</p>
          <h1>Ispezione linea vita</h1>
          <p>Compila sul posto, allega fotografie e firme, poi genera il rapporto PDF.</p>
        </div>
        <button class="button button-primary button-large" data-action="new-inspection">+ Nuova ispezione</button>
      </section>

      <section class="stats-grid" aria-label="Riepilogo archivio">
        <div class="stat-card"><strong>${state.inspections.length}</strong><span>Totali</span></div>
        <div class="stat-card"><strong>${drafts}</strong><span>Bozze</span></div>
        <div class="stat-card"><strong>${completed}</strong><span>Completate</span></div>
        <div class="stat-card ${critical ? "stat-alert" : ""}"><strong>${critical}</strong><span>Fuori servizio</span></div>
      </section>

      <section class="content-section">
        <div class="section-heading">
          <div><p class="eyebrow">Ultime attività</p><h2>Ispezioni recenti</h2></div>
          ${state.inspections.length ? '<button class="text-button" data-nav="archive">Vedi archivio</button>' : ""}
        </div>
        <div class="card-list">
          ${recent.length ? recent.map(inspectionCard).join("") : `
            <div class="empty-state">
              <div class="empty-icon">LV</div>
              <h3>Nessuna ispezione salvata</h3>
              <p>La prima scheda verrà archiviata automaticamente sul telefono.</p>
            </div>`}
        </div>
      </section>

      <section class="notice notice-info">
        <strong>Archivio locale e offline</strong>
        <p>I dati restano su questo dispositivo. Crea periodicamente una copia di sicurezza dalle Impostazioni.</p>
      </section>`;
  }

  function renderArchive(state) {
    return `
      <section class="page-heading">
        <div><p class="eyebrow">Archivio locale</p><h1>Le tue ispezioni</h1></div>
        <button class="button button-primary" data-action="new-inspection">+ Nuova</button>
      </section>
      <div class="search-box">
        <input type="search" data-archive-search placeholder="Cerca numero, cliente, sito o data" aria-label="Cerca nell'archivio">
      </div>
      <div class="card-list" id="archive-list">
        ${state.inspections.length ? state.inspections.map(inspectionCard).join("") : `
          <div class="empty-state"><div class="empty-icon">LV</div><h3>Archivio vuoto</h3><p>Crea la prima ispezione per iniziare.</p></div>`}
      </div>
      <div class="empty-state compact" id="archive-no-results" hidden>
        <h3>Nessun risultato</h3><p>Prova con un altro nome o indirizzo.</p>
      </div>`;
  }

  function formHeader(current, step) {
    const percent = Math.round((step / window.EKData.wizardSteps.length) * 100);
    return `
      <section class="inspection-heading">
        <div>
          <p class="eyebrow">${esc(current.sheetNumber)}</p>
          <h1>${esc(current.identification.client || "Nuova ispezione")}</h1>
          <p>${esc(current.identification.address || "Compilazione in corso")}</p>
        </div>
        <div class="save-state" id="save-state"><span class="save-dot"></span> Salvato</div>
      </section>
      <div class="progress-wrap">
        <div class="progress-meta"><span>Passaggio ${step} di ${window.EKData.wizardSteps.length}</span><strong>${percent}%</strong></div>
        <div class="progress-track"><span style="width:${percent}%"></span></div>
      </div>
      <nav class="step-nav" aria-label="Passaggi ispezione">
        ${window.EKData.wizardSteps
          .map(
            (item) => `<button class="step-tab ${item.id === step ? "active" : ""} ${item.id < step ? "done" : ""}" data-action="go-step" data-step="${item.id}">
              <span>${item.id}</span><small>${esc(item.short)}</small>
            </button>`
          )
          .join("")}
      </nav>`;
  }

  function formSection(number, title, content, description = "") {
    return `
      <section class="form-section">
        <div class="form-section-heading">
          <span class="section-number">${esc(number)}</span>
          <div><h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ""}</div>
        </div>
        ${content}
      </section>`;
  }

  function renderStep1(current) {
    const identification = `
      <div class="form-grid">
        ${field("N. scheda", "sheetNumber", current, "text", "required")}
        ${field("Data ispezione", "identification.inspectionDate", current, "date", "required")}
        ${field("Ora inizio", "identification.startTime", current, "time")}
        ${field("Ora fine", "identification.endTime", current, "time")}
        ${field("Committente", "identification.client", current, "text", "required placeholder=\"Nome o condominio\"")}
        ${field("Referente", "identification.contactPerson", current)}
        ${field("Telefono", "identification.phone", current, "tel")}
        ${field("E-mail", "identification.email", current, "email")}
        ${field("Indirizzo del sito", "identification.address", current, "text", "required")}
        ${field("Edificio / scala / zona", "identification.buildingZone", current)}
        ${field("Comune", "identification.city", current)}
        ${field("CAP", "identification.postalCode", current, "text", "inputmode=\"numeric\"")}
        ${field("Provincia", "identification.province", current, "text", "maxlength=\"2\"")}
        <div class="field field-wide gps-field">
          <span class="field-label">Coordinate GPS</span>
          <div class="inline-control"><input type="text" data-field="identification.gps" value="${esc(current.identification.gps)}"><button class="button button-secondary" data-action="get-location" type="button">Rileva posizione</button></div>
        </div>
      </div>`;

    const system = `
      <div class="form-grid">
        ${field("ID impianto / zona", "system.plantId", current)}
        ${field("Fabbricante", "system.manufacturer", current)}
        ${field("Modello / tipo", "system.model", current)}
        ${select("Configurazione", "system.configuration", current, [
          { value: "", label: "Seleziona" },
          "Puntuale",
          "Linea flessibile",
          "Linea rigida",
          "Combinato",
        ])}
        ${field("Numero massimo utenti", "system.maxUsers", current, "number", "min=\"1\" inputmode=\"numeric\"")}
        ${field("Data installazione", "system.installationDate", current, "date")}
        ${field("Installatore", "system.installer", current)}
        ${field("Ultima ispezione", "system.lastInspection", current, "date")}
        ${field("Scadenza programmata", "system.scheduledExpiry", current, "date")}
        ${select("Caduta / sovraccarico", "system.fallOrOverload", current, [
          { value: "no", label: "No" },
          { value: "yes", label: "Sì" },
        ])}
        ${field("Data dell'evento", "system.fallDate", current, "date")}
        ${select("Modifiche dopo l'ultima ispezione", "system.modifiedAfterInspection", current, [
          { value: "no", label: "No" },
          { value: "yes", label: "Sì" },
        ])}
        ${textarea("Note identificative", "system.identificationNotes", current, "Targhetta, matricola, lotto, zona di copertura, riferimento planimetria")}
      </div>`;

    const qualificationOptions = [
      "Utilizzatore",
      "Installatore base",
      "Installatore intermedio",
      "Installatore avanzato",
      "Tecnico abilitato",
      "Altra persona competente",
    ];
    const professional = `
      <div class="form-grid">
        ${select("Tipo di ispezione", "inspection.type", current, [
          { value: "IM", label: "IM - al montaggio" },
          { value: "IU", label: "IU - prima dell'uso" },
          { value: "IP", label: "IP - periodica" },
          { value: "IS", label: "IS - straordinaria" },
        ])}
        ${field("Motivo / evento", "inspection.reason", current)}
        ${field("Nome e cognome ispettore", "inspection.inspectorName", current, "text", "required")}
        ${field("Impresa / ente", "inspection.inspectorCompany", current)}
        <fieldset class="field field-wide checkbox-fieldset">
          <legend>Qualifica dichiarata</legend>
          <div class="checkbox-grid">
            ${qualificationOptions
              .map(
                (option) => `<label class="check-option"><input type="checkbox" data-array-field="inspection.qualifications" value="${esc(option)}" ${(current.inspection.qualifications || []).includes(option) ? "checked" : ""}><span>${esc(option)}</span></label>`
              )
              .join("")}
          </div>
        </fieldset>
        ${field("Ente / produttore attestato", "inspection.certificateProvider", current)}
        ${field("N. attestato / abilitazione", "inspection.certificateNumber", current)}
        ${field("Data attestato", "inspection.certificateDate", current, "date")}
        ${field("Scadenza (se prevista)", "inspection.certificateExpiry", current, "date")}
      </div>`;

    return (
      formSection(1, "Identificazione della scheda e del sito", identification) +
      formSection(2, "Identificazione del sistema", system) +
      formSection(3, "Tipo di ispezione e figura professionale", professional)
    );
  }

  function renderStep2(current) {
    const controls = current.preliminary
      .map(
        (item, index) => `<article class="check-card ${item.status === "NO" ? "has-error" : ""}">
          <div class="check-card-title"><span>${item.id}</span><strong>${esc(item.label)}</strong></div>
          ${segmented("preliminary", index, "status", item.status, [
            { value: "OK", label: "OK" },
            { value: "NO", label: "NO" },
            { value: "NA", label: "N/A" },
          ])}
          ${listTextarea("Note", "preliminary", index, "notes", item.notes, "Osservazioni o limitazioni")}
        </article>`
      )
      .join("");
    return formSection(
      4,
      "Verifica preliminare prima dell'accesso",
      `<div class="notice notice-danger"><strong>STOP OPERATIVO</strong><p>Se non puoi accedere o controllare in sicurezza, interrompi l'ispezione, impedisci l'uso e informa subito il committente.</p></div><div class="check-list">${controls}</div>`,
      "Segna sempre OK, NO oppure non applicabile."
    );
  }

  function renderStep3(current) {
    const docs = current.documentation
      .map(
        (item, index) => `<article class="check-card compact-card ${item.status === "A" ? "has-warning" : ""}">
          <div class="check-card-title"><span>${item.id}</span><strong>${esc(item.label)}</strong></div>
          ${segmented("documentation", index, "status", item.status, [
            { value: "P", label: "Presente" },
            { value: "A", label: "Assente" },
            { value: "NA", label: "N/A" },
          ])}
          <label class="check-option standalone"><input type="checkbox" data-list="documentation" data-index="${index}" data-prop="verified" ${item.verified ? "checked" : ""}><span>Contenuto verificato con lo stato reale</span></label>
          ${listTextarea("Note / riferimento file", "documentation", index, "notes", item.notes)}
        </article>`
      )
      .join("");
    const result = `
      <div class="check-list">${docs}</div>
      <div class="form-grid top-gap">
        ${select("Esito documentale", "documentaryOutcome", current, [
          { value: "", label: "Seleziona" },
          { value: "Completo utilizzabile", label: "Completo utilizzabile" },
          { value: "Incompleto ma controllo proseguibile", label: "Incompleto ma controllo proseguibile" },
          { value: "Criticità: ispezione sospesa / sistema non utilizzabile", label: "Criticità: ispezione sospesa / sistema non utilizzabile" },
        ])}
        ${textarea("Documenti da richiedere", "documentsToRequest", current)}
        ${textarea("Note / differenze riscontrate", "documentaryNotes", current)}
      </div>`;
    return formSection(5, "Controllo della documentazione", result, "P = presente, A = assente, NA = non applicabile.");
  }

  function componentCard(item, index) {
    return `<article class="repeat-card">
      <div class="repeat-card-heading"><strong>Componente ${index + 1}</strong><button class="text-button danger-quiet" data-action="remove-component" data-index="${index}">Rimuovi</button></div>
      <div class="form-grid">
        ${listField("ID / riferimento", "components", index, "ref", item.ref)}
        ${listField("Componente / tipo", "components", index, "type", item.type)}
        ${listField("Fabbricante - modello", "components", index, "manufacturerModel", item.manufacturerModel)}
        ${listField("Lotto / matricola", "components", index, "lotSerial", item.lotSerial)}
        ${listField("Quantità", "components", index, "quantity", item.quantity, "number", "min=\"0\"")}
        ${listField("Posizione / zona", "components", index, "position", item.position)}
        <div class="field field-wide"><span class="field-label">Esito</span>${segmented("components", index, "outcome", item.outcome, [
          { value: "C", label: "Conforme" },
          { value: "NC", label: "Non conforme" },
          { value: "NA", label: "N/A" },
        ])}</div>
      </div>
    </article>`;
  }

  function technicalCheckCard(item, index, list) {
    return `<article class="check-card ${item.outcome === "NC" ? "has-error" : ""}">
      <div class="check-card-title"><span>${item.id}</span><strong>${esc(item.label)}</strong></div>
      <div class="dual-segments">
        <div><small>Tipo controllo</small>${segmented(list, index, "method", item.method, [
          { value: "V", label: "V" },
          { value: "F", label: "F" },
          { value: "S", label: "S" },
          { value: "NE", label: "NE" },
        ])}</div>
        <div><small>Esito</small>${segmented(list, index, "outcome", item.outcome, [
          { value: "C", label: "C" },
          { value: "NC", label: "NC" },
          { value: "NA", label: "NA" },
        ])}</div>
      </div>
      ${listTextarea("Note / foto", list, index, "notes", item.notes)}
    </article>`;
  }

  function renderStep4(current) {
    const components = `
      <div class="repeat-list">${current.components.map(componentCard).join("")}</div>
      <button class="button button-secondary button-block" data-action="add-component">+ Aggiungi componente</button>`;
    const checks = `
      <div class="legend-box"><span><b>V</b> visivo</span><span><b>F</b> funzionale</span><span><b>S</b> strumentale</span><span><b>NE</b> non effettuato</span></div>
      <div class="check-list">${current.systemChecks.map((item, index) => technicalCheckCard(item, index, "systemChecks")).join("")}</div>
      <div class="form-grid top-gap">${textarea("Note generali sul sistema", "systemNotes", current)}</div>`;
    return formSection(6, "Registro sintetico dei componenti", components) + formSection(7, "Controlli sul sistema di ancoraggio", checks);
  }

  function accessCheckCard(item, index) {
    return `<article class="check-card ${item.outcome === "NC" ? "has-error" : ""}">
      <div class="check-card-title"><span>${item.id}</span><strong>${esc(item.label)}</strong></div>
      ${segmented("accessChecks", index, "outcome", item.outcome, [
        { value: "C", label: "Conforme" },
        { value: "NC", label: "Non conforme" },
        { value: "NA", label: "N/A" },
      ])}
      ${listTextarea("Note / foto", "accessChecks", index, "notes", item.notes)}
    </article>`;
  }

  function measurementCard(item, index) {
    return `<article class="repeat-card">
      <div class="repeat-card-heading"><strong>Misura ${index + 1}</strong><button class="text-button danger-quiet" data-action="remove-measurement" data-index="${index}">Rimuovi</button></div>
      <div class="form-grid">
        ${listField("Punto / ID", "measurements", index, "point", item.point)}
        ${listField("Controllo", "measurements", index, "control", item.control)}
        ${listField("Strumento", "measurements", index, "instrument", item.instrument)}
        ${listField("Matricola / taratura", "measurements", index, "serialCalibration", item.serialCalibration)}
        ${listField("Valore richiesto", "measurements", index, "requiredValue", item.requiredValue)}
        ${listField("Valore rilevato", "measurements", index, "measuredValue", item.measuredValue)}
        <div class="field field-wide"><span class="field-label">Esito</span>${segmented("measurements", index, "outcome", item.outcome, [
          { value: "C", label: "Conforme" },
          { value: "NC", label: "Non conforme" },
          { value: "NA", label: "N/A" },
        ])}</div>
      </div>
    </article>`;
  }

  function renderStep5(current) {
    const support = `<div class="check-list">${current.supportChecks.map((item, index) => technicalCheckCard(item, index, "supportChecks")).join("")}</div>`;
    const access = `<div class="check-list">${current.accessChecks.map(accessCheckCard).join("")}</div>`;
    const measurements = `
      <div class="repeat-list">${current.measurements.length ? current.measurements.map(measurementCard).join("") : '<div class="empty-state compact"><p>Nessuna misura inserita.</p></div>'}</div>
      <button class="button button-secondary button-block" data-action="add-measurement">+ Aggiungi misura</button>
      <div class="form-grid top-gap">${textarea("Note sul supporto / accesso / misure", "supportAccessNotes", current)}</div>`;
    return (
      formSection(8, "Controlli su supporto, ancoranti e copertura", support, "Non eseguire prove o smontaggi non previsti dalla procedura e dalla propria qualifica.") +
      formSection(9, "Accesso, percorso e condizioni operative", access) +
      formSection(10, "Misure e controlli strumentali previsti", measurements)
    );
  }

  function nonConformityCard(item, index) {
    return `<article class="repeat-card nc-card">
      <div class="repeat-card-heading"><strong>Non conformità ${index + 1}</strong><button class="text-button danger-quiet" data-action="remove-nc" data-index="${index}">Rimuovi</button></div>
      <div class="form-grid">
        ${listField("ID / zona / foto", "nonConformities", index, "zone", item.zone)}
        <label class="field"><span class="field-label">Classe</span><select data-list="nonConformities" data-index="${index}" data-prop="classification">
          <option value="">Seleziona</option>
          <option value="Critica" ${item.classification === "Critica" ? "selected" : ""}>Critica</option>
          <option value="Maggiore" ${item.classification === "Maggiore" ? "selected" : ""}>Maggiore</option>
          <option value="Minore" ${item.classification === "Minore" ? "selected" : ""}>Minore</option>
        </select></label>
        ${listTextarea("Descrizione del difetto", "nonConformities", index, "description", item.description)}
        ${listTextarea("Intervento richiesto", "nonConformities", index, "action", item.action)}
        ${listField("Responsabile", "nonConformities", index, "responsible", item.responsible)}
        ${listField("Entro il", "nonConformities", index, "dueDate", item.dueDate, "date")}
      </div>
    </article>`;
  }

  function renderStep6(current) {
    const nonConformities = `
      <div class="classification-legend"><span><b>Critica</b> possibile perdita della funzione di sicurezza</span><span><b>Maggiore</b> richiede ripristino e valutazione</span><span><b>Minore</b> da correggere e monitorare</span></div>
      <div class="repeat-list">${current.nonConformities.length ? current.nonConformities.map(nonConformityCard).join("") : '<div class="empty-state compact"><p>Nessuna non conformità inserita.</p></div>'}</div>
      <button class="button button-secondary button-block" data-action="add-nc">+ Aggiungi non conformità</button>`;

    const outcomes = [
      { value: "A", title: "Positivo", text: "Sistema utilizzabile" },
      { value: "B", title: "Con prescrizioni", text: "Utilizzabile con limitazioni definite" },
      { value: "C", title: "Negativo", text: "Sistema fuori servizio" },
      { value: "D", title: "Sospesa", text: "Ispezione incompleta" },
    ];
    const actions = ["Nessuna", "Uso vietato", "Cartello fuori servizio applicato", "Accesso impedito", "Committente avvisato"];
    const overall = `
      <fieldset class="outcome-grid">
        <legend>Seleziona l'esito complessivo</legend>
        ${outcomes
          .map(
            (item) => `<label class="outcome-card outcome-card-${item.value.toLowerCase()} ${current.overall.outcome === item.value ? "selected" : ""}">
              <input type="radio" name="overall-outcome" data-field="overall.outcome" value="${item.value}" ${current.overall.outcome === item.value ? "checked" : ""}>
              <strong>${esc(item.value)} · ${esc(item.title)}</strong><span>${esc(item.text)}</span>
            </label>`
          )
          .join("")}
      </fieldset>
      <fieldset class="field field-wide checkbox-fieldset top-gap"><legend>Azioni immediate</legend><div class="checkbox-grid">
        ${actions
          .map(
            (action) => `<label class="check-option"><input type="checkbox" data-array-field="overall.immediateActions" value="${esc(action)}" ${(current.overall.immediateActions || []).includes(action) ? "checked" : ""}><span>${esc(action)}</span></label>`
          )
          .join("")}
      </div></fieldset>
      <div class="form-grid top-gap">
        ${field("Comunicazione a", "overall.communicationTo", current)}
        ${field("Modalità", "overall.communicationMode", current, "text", "placeholder=\"Telefono, e-mail, PEC...\"")}
        ${field("Data e ora comunicazione", "overall.communicationDateTime", current, "datetime-local")}
        ${textarea("Interventi / prescrizioni", "overall.prescriptions", current)}
        ${field("Prossima ispezione entro il", "overall.nextInspectionDate", current, "date")}
        ${field("Oppure dopo", "overall.nextInspectionAfter", current, "text", "placeholder=\"Evento o intervento\"")}
        ${select("Criterio", "overall.nextInspectionCriterion", current, ["manuale", "programma", "evento", "altro"])}
      </div>`;
    return formSection(11, "Non conformità e interventi richiesti", nonConformities) + formSection(12, "Esito complessivo dell'ispezione", overall);
  }

  function signatureBox(kind, title, name, dataUrl) {
    return `<div class="signature-box">
      <div class="signature-heading"><strong>${esc(title)}</strong><span>${esc(name || "Nome non indicato")}</span></div>
      <div class="signature-preview ${dataUrl ? "has-signature" : ""}">
        ${dataUrl ? `<img src="${esc(dataUrl)}" alt="Firma ${esc(title)}">` : "<span>Firma non inserita</span>"}
      </div>
      <div class="signature-actions">
        <button class="button button-secondary" data-action="open-signature" data-kind="${esc(kind)}">${dataUrl ? "Rifirma" : "Firma sullo schermo"}</button>
        ${dataUrl ? `<button class="text-button danger-quiet" data-action="clear-signature" data-kind="${esc(kind)}">Cancella</button>` : ""}
      </div>
    </div>`;
  }

  function photoCard(photo, index) {
    return `<article class="photo-card">
      <img src="${esc(photo.dataUrl)}" alt="Foto ${index + 1}">
      <div class="photo-fields">
        ${listField("Titolo", "photos", index, "title", photo.title)}
        ${listField("ID / posizione", "photos", index, "position", photo.position)}
        ${listTextarea("Descrizione / esito", "photos", index, "description", photo.description)}
      </div>
      <button class="text-button danger-quiet" data-action="remove-photo" data-index="${index}">Elimina fotografia</button>
    </article>`;
  }

  function renderStep7(current) {
    const declarations = `
      <div class="notice notice-info"><strong>Dichiarazione</strong><p>L'ispettore riporta le condizioni osservabili e le verifiche effettivamente eseguite. Il committente prende atto dell'esito, delle prescrizioni e dell'eventuale messa fuori servizio.</p></div>
      <div class="form-grid">
        ${field("Luogo", "declarations.place", current)}
        ${field("Data", "declarations.date", current, "date")}
        ${field("Ispettore", "declarations.inspectorName", current, "text", "required")}
        ${field("Qualifica", "declarations.inspectorQualification", current)}
        ${field("Committente / responsabile", "declarations.clientName", current)}
      </div>
      <div class="signature-grid">
        ${signatureBox("inspector", "Firma ispettore", current.declarations.inspectorName, current.declarations.inspectorSignature)}
        ${signatureBox("client", "Firma committente / responsabile", current.declarations.clientName, current.declarations.clientSignature)}
      </div>
      <fieldset class="field field-wide checkbox-fieldset top-gap"><legend>Allegati</legend><div class="checkbox-grid">
        ${[
          ["photos", "Fotografie"],
          ["annotatedPlan", "Planimetria annotata"],
          ["measurements", "Misure"],
          ["acquiredDocuments", "Documenti acquisiti"],
          ["estimate", "Preventivo / ordine interventi"],
        ]
          .map(([key, label]) => `<label class="check-option"><input type="checkbox" data-field="attachments.${key}" ${current.attachments[key] ? "checked" : ""}><span>${esc(label)}</span></label>`)
          .join("")}
      </div></fieldset>
      <div class="form-grid">${field("N. pagine / note allegati", "attachments.pageCount", current)}</div>`;

    const photos = `
      <div class="photo-toolbar">
        <label class="button button-primary" for="photo-input">+ Scatta o aggiungi foto</label>
        <input id="photo-input" class="visually-hidden" type="file" accept="image/*" capture="environment" multiple data-photo-input>
        <span>${current.photos.length} fotografie</span>
      </div>
      <div class="photo-grid">${current.photos.length ? current.photos.map(photoCard).join("") : '<div class="empty-state compact"><p>Aggiungi accesso, cartello, vista generale, targhetta, componenti, fissaggi e difetti.</p></div>'}</div>
      <div class="form-grid top-gap">${textarea("Indice file / altre foto allegate", "attachments.otherPhotoIndex", current)}</div>`;
    return formSection(13, "Dichiarazioni e firme", declarations) + formSection(14, "Allegato fotografico", photos);
  }

  function renderInspection(state) {
    const current = state.current;
    const step = state.step;
    const renderers = { 1: renderStep1, 2: renderStep2, 3: renderStep3, 4: renderStep4, 5: renderStep5, 6: renderStep6, 7: renderStep7 };
    return `
      ${formHeader(current, step)}
      <form id="inspection-form" novalidate>
        ${renderers[step](current)}
      </form>
      <div class="wizard-actions">
        <button class="button button-secondary" data-action="previous-step" ${step === 1 ? "disabled" : ""}>Indietro</button>
        <button class="button button-secondary" data-action="save-inspection">Salva</button>
        ${step < 7 ? '<button class="button button-primary" data-action="next-step">Avanti</button>' : '<button class="button button-primary" data-action="complete-inspection">Concludi ispezione</button>'}
      </div>
      <div class="final-actions">
        <button class="button button-dark button-block" data-action="pdf-current">Genera PDF</button>
      </div>`;
  }

  function settingsField(label, key, state, type = "text") {
    return `<label class="field"><span class="field-label">${esc(label)}</span><input type="${esc(type)}" data-settings-field="${esc(key)}" value="${esc(state.settings[key] || "")}"></label>`;
  }

  function renderSettings(state) {
    const storage = state.storage || { usage: 0, quota: 0 };
    const usage = storage.usage ? (storage.usage / 1024 / 1024).toFixed(1) : "0";
    const quota = storage.quota ? (storage.quota / 1024 / 1024).toFixed(0) : "-";
    return `
      <section class="page-heading"><div><p class="eyebrow">Configurazione</p><h1>Impostazioni</h1></div></section>
      ${formSection("A", "Dati EdilKappa per i rapporti PDF", `<div class="form-grid">
        ${settingsField("Ragione sociale", "companyName", state)}
        ${settingsField("Descrizione attività", "companySubtitle", state)}
        ${settingsField("E-mail", "email", state, "email")}
        ${settingsField("Telefono", "phone", state, "tel")}
        ${settingsField("Sede", "address", state)}
        ${settingsField("Partita IVA", "vat", state)}
      </div><button class="button button-primary" data-action="save-settings">Salva dati aziendali</button>`)}
      ${formSection("B", "Dati predefiniti dell'ispettore", `<div class="form-grid">
        ${settingsField("Nome e cognome", "inspectorName", state)}
        ${settingsField("Impresa / ente", "inspectorCompany", state)}
        ${settingsField("Qualifica", "inspectorQualification", state)}
        ${settingsField("Ente / produttore attestato", "certificateProvider", state)}
        ${settingsField("Numero attestato", "certificateNumber", state)}
      </div><button class="button button-primary" data-action="save-settings">Salva dati ispettore</button>`)}
      ${formSection("C", "Backup e sicurezza dell'archivio", `<div class="backup-card">
        <div><strong>Spazio utilizzato</strong><span>${usage} MB su circa ${quota} MB disponibili</span></div>
        <div class="backup-actions">
          <button class="button button-primary" data-action="export-backup">Scarica copia di sicurezza</button>
          <button class="button button-secondary" data-action="import-backup">Ripristina da backup</button>
          <input class="visually-hidden" type="file" accept="application/json,.json" id="backup-input" data-backup-input>
          <button class="text-button" data-action="persist-storage">Proteggi archivio locale</button>
          <button class="text-button danger-quiet" data-action="clear-all-data">Cancella tutti i dati</button>
        </div>
      </div><div class="notice notice-warning"><strong>Importante</strong><p>Le ispezioni sono conservate soltanto su questo dispositivo. Scarica un backup dopo ogni giornata di lavoro.</p></div>`)}
      ${formSection("D", "Installazione sul telefono", `<div class="install-card"><div class="app-icon-preview"><img src="icons/icon-192.png" alt="Icona EdilKappa"></div><div><strong>EdilKappa Linea Vita</strong><p>Installa l'app sulla schermata Home per aprirla a tutto schermo e usarla offline.</p><button class="button button-dark" data-action="install-app">Mostra come installare</button></div></div>`)}
      <section class="technical-note"><strong>Nota tecnica</strong><p>La scheda è un modello operativo interno e non sostituisce la relazione di calcolo o la verifica strutturale del tecnico competente.</p><small>Versione app 1.0.0 · Mod. LV-01 Rev. 0</small></section>`;
  }

  function render(state) {
    if (state.view === "archive") return renderArchive(state);
    if (state.view === "inspection" && state.current) return renderInspection(state);
    if (state.view === "settings") return renderSettings(state);
    return renderHome(state);
  }

  window.EKViews = { render, esc, formatDate, inspectionCard };
})();
