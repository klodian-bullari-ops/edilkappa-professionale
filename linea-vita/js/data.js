(function () {
  "use strict";

  const preliminaryControls = [
    "Autorizzazione e coordinamento con committente",
    "Meteo, vento e superficie compatibili",
    "Accesso alla copertura sicuro e disponibile",
    "Copertura percorribile / zone fragili segnalate",
    "DPC presenti o rischio residuo valutato",
    "DPI anticaduta idonei, controllati e compatibili",
    "Piano di emergenza e recupero attuabile",
    "Attrezzatura, strumenti e comunicazioni disponibili",
    "Area sottostante delimitata / rischio caduta oggetti",
    "Rischi elettrici, amianto, aperture e altri pericoli gestiti",
  ];

  const documentControls = [
    "Elaborato grafico / planimetria rappresentativa del sistema",
    "Relazione tecnica generale e criteri di utilizzo",
    "Relazione di calcolo / verifica del supporto e degli ancoraggi",
    "Elaborato tecnico della copertura o fascicolo equivalente (ove previsto)",
    "Documentazione fotografica dell'installazione e dei fissaggi non più visibili",
    "Dichiarazione di corretta posa del sistema",
    "Manuali di installazione, uso, ispezione e manutenzione dei componenti",
    "Dichiarazioni di conformità / rispondenza previste per i componenti",
    "Elenco componenti con fabbricante, modello, lotto / matricola e quantità",
    "Targhetta identificativa e cartello presso l'accesso alla copertura",
    "Indicazione dei DPI, connettori, numero utenti e modalità di collegamento",
    "Procedura di accesso, transito e lavoro nelle diverse zone della copertura",
    "Piano di emergenza, salvataggio e recupero dell'operatore",
    "Programma di ispezione e manutenzione con periodicità prevista",
    "Registro delle ispezioni, manutenzioni e riparazioni del sistema",
    "Registro degli accessi / utilizzi del sistema",
    "Rapporti delle precedenti ispezioni e chiusura delle non conformità",
    "Autorizzazioni, progetto e aggiornamenti relativi a modifiche intervenute",
  ];

  const componentTypes = [
    "Accesso / cartello / targhetta",
    "Linea flessibile / fune",
    "Ancoraggi terminali e intermedi",
    "Assorbitore / tenditore / indicatore",
    "Ancoraggi puntuali / deviazione",
    "Linea rigida / navetta",
    "Fissaggi e sigillature a vista",
    "Altro componente",
  ];

  const systemControls = [
    "Corrispondenza tra sistema installato, planimetria e percorso previsto",
    "Identificazione, marcature, targhetta e istruzioni leggibili",
    "Completezza e compatibilità apparente dei componenti",
    "Assenza di modifiche, sostituzioni o forature non autorizzate",
    "Impermeabilizzazione e sigillature in corrispondenza dei dispositivi",
    "Usura, abrasioni, tagli o perdita di materiale",
    "Ossidazione, corrosione o contaminazione chimica",
    "Deformazioni, urti o disallineamenti dei componenti",
    "Fune: fili rotti, pieghe, schiacciamenti o deformazioni anomale",
    "Tensionamento / freccia della fune secondo indicazioni del fabbricante",
    "Terminali, morsetti, pressature, grilli, redance e collegamenti",
    "Assorbitore di energia, indicatore di caduta e tenditore",
    "Serraggio di dadi, bulloni e fissaggi a vista secondo procedura",
    "Parti mobili, navette, carrelli, passaggi intermedi e fine corsa",
    "Protezioni, cappucci, elementi antimanomissione e pulizia generale",
  ];

  const supportControls = [
    "Ancoranti / fissaggi visibili: presenza, completezza e posizione",
    "Allentamenti, giochi, rotazioni o movimenti anomali alla base",
    "Fessure, crepe o rotture nel supporto in prossimità dei fissaggi",
    "Corrosione, degrado, sfaldamento o perdita di sezione",
    "Deformazioni, distacchi, schiacciamenti o cedimenti locali",
    "Infiltrazioni, umidità e tenuta dell'interfaccia con impermeabilizzazione",
    "Calcestruzzo / muratura: condizioni superficiali e difetti visibili",
    "Acciaio: corrosione, saldature visibili, piastre e collegamenti",
    "Legno: marcescenza, muffe, insetti, fessure e umidità anomala",
    "Coerenza del supporto con il progetto e assenza di modifiche sospette",
  ];

  const accessControls = [
    "Accesso e sbarco in copertura sicuri, stabili e chiaramente individuati",
    "Cartello all'accesso, schema e limitazioni d'uso disponibili",
    "Percorso verso il sistema e punti di transito / deviazione utilizzabili",
    "Superfici fragili, lucernari, aperture e dislivelli protetti o segnalati",
    "Zone di lavoro raggiungibili senza sgancio e secondo il progetto",
    "Rischio pendolo, bordi, angoli e tirante d'aria coerenti con l'elaborato",
    "Assenza di ostacoli, nuovi impianti o opere che alterano il percorso",
    "Emergenza, recupero e comunicazioni concretamente attuabili",
  ];

  const wizardSteps = [
    { id: 1, short: "Dati", title: "Dati, sito e sistema" },
    { id: 2, short: "Sicurezza", title: "Verifica preliminare" },
    { id: 3, short: "Documenti", title: "Documentazione" },
    { id: 4, short: "Sistema", title: "Componenti e sistema" },
    { id: 5, short: "Supporto", title: "Supporto, accesso e misure" },
    { id: 6, short: "Esito", title: "Non conformità ed esito" },
    { id: 7, short: "Firme", title: "Firme e fotografie" },
  ];

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "ek-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function localDate(date = new Date()) {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function localTime(date = new Date()) {
    return date.toTimeString().slice(0, 5);
  }

  function defaultSettings() {
    return {
      id: "main",
      companyName: "EDILKAPPA S.A.S. DI BULLARI KLODIAN & C.",
      companySubtitle: "Lavori di completamento e finitura degli edifici",
      email: "info@edilkappa.com",
      phone: "+39 351 9332154",
      address: "Via Sant'Ambrogio 38, 20055 Vimodrone (MI)",
      vat: "14041000960",
      inspectorName: "Klodian Bullari",
      inspectorCompany: "EdilKappa S.A.S.",
      inspectorQualification: "",
      certificateProvider: "",
      certificateNumber: "",
      pdfNote:
        "Modello operativo interno. Compilare secondo manuale del fabbricante, progetto, programma di manutenzione e norme applicabili. La scheda non sostituisce la relazione di calcolo o la verifica strutturale del tecnico competente.",
      updatedAt: new Date().toISOString(),
    };
  }

  function newInspection(settings = defaultSettings()) {
    const now = new Date();
    const id = uuid();
    const sequence = String(now.getTime()).slice(-6);

    return {
      id,
      schemaVersion: 1,
      sheetNumber: `LV-${now.getFullYear()}-${sequence}`,
      status: "bozza",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: "",
      currentStep: 1,
      identification: {
        inspectionDate: localDate(now),
        startTime: localTime(now),
        endTime: "",
        client: "",
        contactPerson: "",
        phone: "",
        email: "",
        address: "",
        buildingZone: "",
        city: "",
        postalCode: "",
        province: "MI",
        gps: "",
      },
      system: {
        plantId: "",
        manufacturer: "",
        model: "",
        configuration: "",
        maxUsers: "",
        installationDate: "",
        installer: "",
        lastInspection: "",
        scheduledExpiry: "",
        fallOrOverload: "no",
        fallDate: "",
        modifiedAfterInspection: "no",
        identificationNotes: "",
      },
      inspection: {
        type: "IP",
        reason: "Ispezione periodica programmata",
        inspectorName: settings.inspectorName || "",
        inspectorCompany: settings.inspectorCompany || "",
        qualifications: settings.inspectorQualification ? [settings.inspectorQualification] : [],
        certificateProvider: settings.certificateProvider || "",
        certificateNumber: settings.certificateNumber || "",
        certificateDate: "",
        certificateExpiry: "",
      },
      preliminary: preliminaryControls.map((label, index) => ({
        id: index + 1,
        label,
        status: "",
        notes: "",
      })),
      documentation: documentControls.map((label, index) => ({
        id: index + 1,
        label,
        status: "",
        verified: false,
        notes: "",
      })),
      documentaryOutcome: "",
      documentsToRequest: "",
      documentaryNotes: "",
      components: componentTypes.map((type, index) => ({
        id: uuid(),
        ref: String(index + 1),
        type,
        manufacturerModel: "",
        lotSerial: "",
        quantity: "",
        position: "",
        outcome: "",
      })),
      systemChecks: systemControls.map((label, index) => ({
        id: index + 1,
        label,
        method: "V",
        outcome: "",
        notes: "",
      })),
      systemNotes: "",
      supportChecks: supportControls.map((label, index) => ({
        id: index + 1,
        label,
        method: "V",
        outcome: "",
        notes: "",
      })),
      accessChecks: accessControls.map((label, index) => ({
        id: index + 1,
        label,
        outcome: "",
        notes: "",
      })),
      measurements: [],
      supportAccessNotes: "",
      nonConformities: [],
      overall: {
        outcome: "",
        immediateActions: [],
        communicationTo: "",
        communicationMode: "",
        communicationDateTime: "",
        prescriptions: "",
        nextInspectionDate: "",
        nextInspectionAfter: "",
        nextInspectionCriterion: "programma",
      },
      declarations: {
        place: "",
        date: localDate(now),
        inspectorName: settings.inspectorName || "",
        inspectorQualification: settings.inspectorQualification || "",
        clientName: "",
        inspectorSignature: "",
        clientSignature: "",
      },
      attachments: {
        photos: true,
        annotatedPlan: false,
        measurements: false,
        acquiredDocuments: false,
        estimate: false,
        pageCount: "",
        otherPhotoIndex: "",
      },
      photos: [],
    };
  }

  window.EKData = {
    wizardSteps,
    defaultSettings,
    newInspection,
    uuid,
    localDate,
    localTime,
  };
})();
