(function () {
  "use strict";

  const BLACK = [18, 18, 18];
  const DARK = [34, 40, 45];
  const YELLOW = [244, 196, 0];
  const LIGHT = [241, 243, 244];
  const BORDER = [165, 171, 176];
  const RED = [175, 42, 42];
  const PAGE_BOTTOM = 274;
  const PDF_FONT = "DejaVuSans";

  let logoDataPromise;
  let fontDataPromise;

  function value(input, fallback = "-") {
    if (input === null || input === undefined || input === "") return fallback;
    return String(input);
  }

  function formatDate(input) {
    if (!input) return "-";
    const parts = String(input).split("-");
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return String(input);
  }

  function formatDateTime(input) {
    if (!input) return "-";
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return String(input);
    return date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
  }

  function yesNo(input) {
    if (input === "yes" || input === "si" || input === true) return "Sì";
    if (input === "no" || input === false) return "No";
    return value(input);
  }

  function outcomeLabel(code) {
    const labels = {
      A: "A - POSITIVO: SISTEMA UTILIZZABILE",
      B: "B - UTILIZZABILE CON PRESCRIZIONI",
      C: "C - NEGATIVO: SISTEMA FUORI SERVIZIO",
      D: "D - ISPEZIONE SOSPESA / INCOMPLETA",
    };
    return labels[code] || "Non indicato";
  }

  function statusLabel(status) {
    const labels = {
      OK: "OK",
      NO: "NO",
      NA: "NA",
      P: "P",
      A: "A",
      C: "C",
      NC: "NC",
      V: "V",
      F: "F",
      S: "S",
      NE: "NE",
    };
    return labels[status] || "-";
  }

  function loadLogoData() {
    if (!logoDataPromise) {
      logoDataPromise = fetch("assets/logo-edilkappa-pdf.jpg")
        .then((response) => {
          if (!response.ok) throw new Error("Logo non disponibile");
          return response.arrayBuffer();
        })
        .then((buffer) => `data:image/jpeg;base64,${bufferToBase64(buffer)}`)
        .catch(() => "");
    }
    return logoDataPromise;
  }

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function loadFonts(doc) {
    if (!fontDataPromise) {
      fontDataPromise = Promise.all([
        fetch("assets/fonts/DejaVuSans-EdilKappa.ttf").then((response) => response.arrayBuffer()),
        fetch("assets/fonts/DejaVuSans-Bold-EdilKappa.ttf").then((response) => response.arrayBuffer()),
      ]).then(([regular, bold]) => ({ regular: bufferToBase64(regular), bold: bufferToBase64(bold) }));
    }
    const fonts = await fontDataPromise;
    doc.addFileToVFS("DejaVuSans-EdilKappa.ttf", fonts.regular);
    doc.addFont("DejaVuSans-EdilKappa.ttf", PDF_FONT, "normal");
    doc.addFileToVFS("DejaVuSans-Bold-EdilKappa.ttf", fonts.bold);
    doc.addFont("DejaVuSans-Bold-EdilKappa.ttf", PDF_FONT, "bold");
  }

  function addHeader(doc, settings, logo) {
    const pageWidth = doc.internal.pageSize.getWidth();
    if (logo) doc.addImage(logo, "JPEG", 14, 6, 41, 8.5, "edilkappa-header-logo", "FAST");

    doc.setTextColor(...BLACK);
    doc.setFont(PDF_FONT, "bold");
    doc.setFontSize(9);
    doc.text(value(settings.companyName, "EDILKAPPA"), pageWidth - 14, 8.5, { align: "right" });
    doc.setFont(PDF_FONT, "normal");
    doc.setFontSize(7.2);
    doc.text(value(settings.companySubtitle, ""), pageWidth - 14, 12.3, { align: "right" });
    doc.text(`${value(settings.email, "")} | ${value(settings.phone, "")}`, pageWidth - 14, 16, {
      align: "right",
    });

    doc.setFillColor(...YELLOW);
    doc.rect(14, 20, pageWidth - 28, 2.4, "F");
    doc.setFillColor(...BLACK);
    doc.rect(14, 22.4, pageWidth - 28, 2.4, "F");
  }

  function addFooter(doc, settings, page, total) {
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFillColor(...BLACK);
    doc.rect(14, 282, pageWidth - 28, 7, "F");
    doc.setFont(PDF_FONT, "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    doc.text(
      `${value(settings.address, "")} - P. IVA ${value(settings.vat, "")}`,
      17,
      286.5
    );
    doc.setTextColor(...YELLOW);
    doc.text(`Linea vita | ${page}/${total}`, pageWidth - 17, 286.5, { align: "right" });
  }

  function sectionBar(doc, y, title) {
    if (y + 10 > PAGE_BOTTOM) {
      doc.addPage();
      y = 32;
    }
    doc.setFillColor(...DARK);
    doc.rect(14, y, 182, 7, "F");
    doc.setFont(PDF_FONT, "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(title, 105, y + 4.7, { align: "center" });
    doc.setTextColor(...BLACK);
    return y + 8;
  }

  function addTable(doc, head, body, y, options = {}) {
    doc.autoTable({
      startY: y,
      head,
      body,
      theme: "grid",
      styles: {
        font: PDF_FONT,
        fontSize: options.fontSize || 6.8,
        cellPadding: options.cellPadding || 1.6,
        lineColor: BORDER,
        lineWidth: 0.15,
        textColor: BLACK,
        valign: "middle",
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: options.headColor || YELLOW,
        textColor: options.headTextColor || BLACK,
        fontStyle: "bold",
        halign: options.headAlign || "left",
      },
      alternateRowStyles: options.alternate === false ? undefined : { fillColor: [249, 249, 248] },
      columnStyles: options.columnStyles || {},
      margin: { top: 31, right: 14, bottom: 20, left: 14 },
      rowPageBreak: "avoid",
      pageBreak: "auto",
      didParseCell: options.didParseCell,
    });
    return doc.lastAutoTable.finalY + 4;
  }

  function addTextBox(doc, y, label, text, minHeight = 18) {
    if (y + minHeight + 8 > PAGE_BOTTOM) {
      doc.addPage();
      y = 32;
    }
    doc.setFont(PDF_FONT, "bold");
    doc.setFontSize(7);
    doc.setTextColor(...BLACK);
    doc.text(label, 15, y + 4);
    const lines = doc.splitTextToSize(value(text, ""), 176);
    const height = Math.max(minHeight, 8 + lines.length * 3.2);
    doc.setDrawColor(...BORDER);
    doc.setFillColor(250, 250, 249);
    doc.rect(14, y, 182, height, "FD");
    doc.setFont(PDF_FONT, "normal");
    doc.setFontSize(7.2);
    doc.text(lines.length ? lines : ["-"], 15, y + 8);
    return y + height + 4;
  }

  function drawImageContain(doc, dataUrl, x, y, width, height) {
    if (!dataUrl) return;
    try {
      const properties = doc.getImageProperties(dataUrl);
      const ratio = Math.min(width / properties.width, height / properties.height);
      const drawWidth = properties.width * ratio;
      const drawHeight = properties.height * ratio;
      const type = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addImage(
        dataUrl,
        type,
        x + (width - drawWidth) / 2,
        y + (height - drawHeight) / 2,
        drawWidth,
        drawHeight,
        undefined,
        "FAST"
      );
    } catch (error) {
      // Una foto danneggiata non deve impedire la creazione del rapporto.
    }
  }

  async function generate(inspection, settings) {
    if (!inspection) throw new Error("Nessuna ispezione selezionata.");
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("Modulo PDF non disponibile.");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    await loadFonts(doc);
    const logo = await loadLogoData();
    addHeader(doc, settings, logo);
    const nativeAddPage = doc.addPage.bind(doc);
    doc.addPage = (...args) => {
      const result = nativeAddPage(...args);
      addHeader(doc, settings, logo);
      return result;
    };
    let y = 32;

    doc.setFont(PDF_FONT, "bold");
    doc.setFontSize(14);
    doc.setTextColor(...BLACK);
    doc.text("ISPEZIONE E MANUTENZIONE LINEA VITA", 105, y + 2, { align: "center" });
    doc.setFontSize(7.5);
    doc.setFont(PDF_FONT, "normal");
    doc.text(`Mod. LV-01 | Rev. 0 | Scheda ${value(inspection.sheetNumber)}`, 105, y + 7, { align: "center" });
    y += 12;

    y = sectionBar(doc, y, "1. IDENTIFICAZIONE DELLA SCHEDA E DEL SITO");
    y = addTable(
      doc,
      [["N. scheda", "Data", "Ora inizio / fine", "Stato"]],
      [[
        value(inspection.sheetNumber),
        formatDate(inspection.identification.inspectionDate),
        `${value(inspection.identification.startTime)} / ${value(inspection.identification.endTime)}`,
        inspection.status === "completata" ? "Completata" : "Bozza",
      ]],
      y,
      { columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 36 }, 2: { cellWidth: 50 } } }
    );
    y = addTable(
      doc,
      [["Committente", "Referente", "Telefono", "E-mail"]],
      [[
        value(inspection.identification.client),
        value(inspection.identification.contactPerson),
        value(inspection.identification.phone),
        value(inspection.identification.email),
      ]],
      y,
      { columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 44 }, 2: { cellWidth: 36 } } }
    );
    y = addTable(
      doc,
      [["Indirizzo / sito", "Edificio / scala / zona", "Comune", "CAP / Prov.", "GPS"]],
      [[
        value(inspection.identification.address),
        value(inspection.identification.buildingZone),
        value(inspection.identification.city),
        `${value(inspection.identification.postalCode)} / ${value(inspection.identification.province)}`,
        value(inspection.identification.gps),
      ]],
      y,
      { fontSize: 6.2, columnStyles: { 0: { cellWidth: 47 }, 1: { cellWidth: 42 }, 2: { cellWidth: 32 }, 3: { cellWidth: 25 } } }
    );

    y = sectionBar(doc, y, "2. IDENTIFICAZIONE DEL SISTEMA");
    y = addTable(
      doc,
      [["ID impianto / zona", "Fabbricante", "Modello / tipo", "Configurazione", "N. max utenti"]],
      [[
        value(inspection.system.plantId),
        value(inspection.system.manufacturer),
        value(inspection.system.model),
        value(inspection.system.configuration),
        value(inspection.system.maxUsers),
      ]],
      y,
      { fontSize: 6.4 }
    );
    y = addTable(
      doc,
      [["Installazione", "Installatore", "Ultima ispezione", "Scadenza programmata", "Caduta / sovraccarico", "Modifiche"]],
      [[
        formatDate(inspection.system.installationDate),
        value(inspection.system.installer),
        formatDate(inspection.system.lastInspection),
        formatDate(inspection.system.scheduledExpiry),
        `${yesNo(inspection.system.fallOrOverload)} ${inspection.system.fallDate ? "- " + formatDate(inspection.system.fallDate) : ""}`,
        yesNo(inspection.system.modifiedAfterInspection),
      ]],
      y,
      { fontSize: 6.1 }
    );
    y = addTextBox(doc, y, "Note identificative", inspection.system.identificationNotes, 13);

    y = sectionBar(doc, y, "3. TIPO DI ISPEZIONE E FIGURA PROFESSIONALE");
    y = addTable(
      doc,
      [["Tipo", "Motivo / evento", "Ispettore", "Impresa / ente"]],
      [[
        value(inspection.inspection.type),
        value(inspection.inspection.reason),
        value(inspection.inspection.inspectorName),
        value(inspection.inspection.inspectorCompany),
      ]],
      y,
      { columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 70 }, 2: { cellWidth: 45 } } }
    );
    y = addTable(
      doc,
      [["Qualifica dichiarata", "Ente / produttore", "N. attestato", "Data", "Scadenza"]],
      [[
        value((inspection.inspection.qualifications || []).join(", ")),
        value(inspection.inspection.certificateProvider),
        value(inspection.inspection.certificateNumber),
        formatDate(inspection.inspection.certificateDate),
        formatDate(inspection.inspection.certificateExpiry),
      ]],
      y,
      { fontSize: 6.2, columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 46 }, 2: { cellWidth: 31 } } }
    );

    y = sectionBar(doc, y, "4. VERIFICA PRELIMINARE PRIMA DELL'ACCESSO");
    y = addTable(
      doc,
      [["N.", "Controllo", "Esito", "Note"]],
      inspection.preliminary.map((item) => [item.id, item.label, statusLabel(item.status), value(item.notes, "")]),
      y,
      { fontSize: 6.4, columnStyles: { 0: { cellWidth: 9, halign: "center" }, 2: { cellWidth: 16, halign: "center" }, 3: { cellWidth: 48 } } }
    );
    if (inspection.preliminary.some((item) => item.status === "NO")) {
      doc.setTextColor(...RED);
      doc.setFont(PDF_FONT, "bold");
      doc.setFontSize(7.2);
      const stop = doc.splitTextToSize(
        "STOP OPERATIVO: è presente almeno un controllo preliminare con esito NO. Verificare le condizioni di sicurezza prima di proseguire.",
        178
      );
      if (y + stop.length * 3.5 + 5 > PAGE_BOTTOM) {
        doc.addPage();
        y = 32;
      }
      doc.text(stop, 16, y);
      doc.setTextColor(...BLACK);
      y += stop.length * 3.5 + 4;
    }

    y = sectionBar(doc, y, "5. CONTROLLO DELLA DOCUMENTAZIONE");
    y = addTable(
      doc,
      [["N.", "Documento / evidenza", "P/A/NA", "Ver.", "Note / riferimento"]],
      inspection.documentation.map((item) => [
        item.id,
        item.label,
        statusLabel(item.status),
        item.verified ? "Sì" : "No",
        value(item.notes, ""),
      ]),
      y,
      { fontSize: 6.1, cellPadding: 1.25, columnStyles: { 0: { cellWidth: 8, halign: "center" }, 2: { cellWidth: 17, halign: "center" }, 3: { cellWidth: 13, halign: "center" }, 4: { cellWidth: 42 } } }
    );
    y = addTable(
      doc,
      [["Esito documentale", "Documenti da richiedere", "Note / differenze"]],
      [[value(inspection.documentaryOutcome), value(inspection.documentsToRequest), value(inspection.documentaryNotes)]],
      y,
      { fontSize: 6.5 }
    );

    y = sectionBar(doc, y, "6. REGISTRO SINTETICO DEI COMPONENTI");
    y = addTable(
      doc,
      [["ID", "Componente / tipo", "Fabbricante - modello", "Lotto / matricola", "Q.tà", "Posizione / zona", "Esito"]],
      inspection.components.map((item) => [
        value(item.ref),
        value(item.type),
        value(item.manufacturerModel),
        value(item.lotSerial),
        value(item.quantity),
        value(item.position),
        statusLabel(item.outcome),
      ]),
      y,
      { fontSize: 5.9, cellPadding: 1.2, columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 42 }, 4: { cellWidth: 12 }, 6: { cellWidth: 15, halign: "center" } } }
    );

    y = sectionBar(doc, y, "7. CONTROLLI SUL SISTEMA DI ANCORAGGIO");
    y = addTable(
      doc,
      [["N.", "Controllo", "Tipo", "Esito", "Note / foto"]],
      inspection.systemChecks.map((item) => [item.id, item.label, statusLabel(item.method), statusLabel(item.outcome), value(item.notes, "")]),
      y,
      { fontSize: 6.1, cellPadding: 1.25, columnStyles: { 0: { cellWidth: 8, halign: "center" }, 2: { cellWidth: 14, halign: "center" }, 3: { cellWidth: 15, halign: "center" }, 4: { cellWidth: 43 } } }
    );
    y = addTextBox(doc, y, "Note generali sul sistema", inspection.systemNotes, 15);

    y = sectionBar(doc, y, "8. CONTROLLI SU SUPPORTO, ANCORANTI E COPERTURA");
    y = addTable(
      doc,
      [["N.", "Controllo", "Tipo", "Esito", "Note / foto"]],
      inspection.supportChecks.map((item) => [item.id, item.label, statusLabel(item.method), statusLabel(item.outcome), value(item.notes, "")]),
      y,
      { fontSize: 6.1, cellPadding: 1.25, columnStyles: { 0: { cellWidth: 8, halign: "center" }, 2: { cellWidth: 14, halign: "center" }, 3: { cellWidth: 15, halign: "center" }, 4: { cellWidth: 43 } } }
    );

    y = sectionBar(doc, y, "9. ACCESSO, PERCORSO E CONDIZIONI OPERATIVE");
    y = addTable(
      doc,
      [["N.", "Controllo", "Esito", "Note / foto"]],
      inspection.accessChecks.map((item) => [item.id, item.label, statusLabel(item.outcome), value(item.notes, "")]),
      y,
      { fontSize: 6.2, columnStyles: { 0: { cellWidth: 8, halign: "center" }, 2: { cellWidth: 17, halign: "center" }, 3: { cellWidth: 50 } } }
    );

    y = sectionBar(doc, y, "10. MISURE E CONTROLLI STRUMENTALI PREVISTI");
    const measurements = inspection.measurements.length
      ? inspection.measurements
      : [{ point: "", control: "", instrument: "", serialCalibration: "", requiredValue: "", measuredValue: "", outcome: "" }];
    y = addTable(
      doc,
      [["Punto / ID", "Controllo / strumento", "Matricola / taratura", "Valore richiesto", "Valore rilevato", "Esito"]],
      measurements.map((item) => [
        value(item.point),
        value([item.control, item.instrument].filter(Boolean).join(" - ")),
        value(item.serialCalibration),
        value(item.requiredValue),
        value(item.measuredValue),
        statusLabel(item.outcome),
      ]),
      y,
      { fontSize: 5.9, columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 45 }, 5: { cellWidth: 15, halign: "center" } } }
    );
    y = addTextBox(doc, y, "Note sul supporto / accesso / misure", inspection.supportAccessNotes, 15);

    y = sectionBar(doc, y, "11. NON CONFORMITÀ E INTERVENTI RICHIESTI");
    const nonConformities = inspection.nonConformities.length
      ? inspection.nonConformities
      : [{ zone: "", description: "Nessuna non conformità registrata", classification: "", action: "", responsible: "", dueDate: "" }];
    y = addTable(
      doc,
      [["NC", "ID / zona / foto", "Descrizione del difetto", "Classe", "Intervento / responsabile", "Entro il"]],
      nonConformities.map((item, index) => [
        index + 1,
        value(item.zone),
        value(item.description),
        value(item.classification),
        value([item.action, item.responsible].filter(Boolean).join(" - ")),
        formatDate(item.dueDate),
      ]),
      y,
      { fontSize: 5.9, columnStyles: { 0: { cellWidth: 9, halign: "center" }, 1: { cellWidth: 29 }, 2: { cellWidth: 55 }, 3: { cellWidth: 18 }, 5: { cellWidth: 20 } } }
    );

    y = sectionBar(doc, y, "12. ESITO COMPLESSIVO DELL'ISPEZIONE");
    y = addTable(
      doc,
      [["Esito", "Azioni immediate", "Comunicazione"]],
      [[
        outcomeLabel(inspection.overall.outcome),
        value((inspection.overall.immediateActions || []).join(", ")),
        value(
          [
            inspection.overall.communicationTo,
            inspection.overall.communicationMode,
            formatDateTime(inspection.overall.communicationDateTime),
          ]
            .filter((item) => item && item !== "-")
            .join(" - ")
        ),
      ]],
      y,
      {
        fontSize: 6.3,
        headColor: inspection.overall.outcome === "C" ? RED : YELLOW,
        headTextColor: inspection.overall.outcome === "C" ? [255, 255, 255] : BLACK,
      }
    );
    y = addTextBox(doc, y, "Interventi / prescrizioni", inspection.overall.prescriptions, 19);
    y = addTable(
      doc,
      [["Prossima ispezione entro il", "Oppure dopo", "Criterio"]],
      [[
        formatDate(inspection.overall.nextInspectionDate),
        value(inspection.overall.nextInspectionAfter),
        value(inspection.overall.nextInspectionCriterion),
      ]],
      y
    );

    y = sectionBar(doc, y, "13. DICHIARAZIONI E FIRME");
    const declarationText =
      "L'ispettore dichiara di aver riportato le condizioni osservabili e le verifiche effettivamente eseguite, indicando i controlli non effettuati e le limitazioni incontrate. Il committente / responsabile prende atto dell'esito, delle prescrizioni e dell'eventuale messa fuori servizio.";
    y = addTextBox(doc, y, "Dichiarazione", declarationText, 17);
    if (y + 48 > PAGE_BOTTOM) {
      doc.addPage();
      y = 32;
    }
    doc.setDrawColor(...BORDER);
    doc.rect(14, y, 58, 42);
    doc.rect(76, y, 58, 42);
    doc.rect(138, y, 58, 42);
    doc.setFont(PDF_FONT, "bold");
    doc.setFontSize(6.5);
    doc.text("LUOGO E DATA", 16, y + 5);
    doc.text("ISPETTORE", 78, y + 5);
    doc.text("COMMITTENTE / RESPONSABILE", 140, y + 5);
    doc.setFont(PDF_FONT, "normal");
    doc.text(`${value(inspection.declarations.place)}\n${formatDate(inspection.declarations.date)}`, 16, y + 11);
    doc.text(`${value(inspection.declarations.inspectorName)}\n${value(inspection.declarations.inspectorQualification)}`, 78, y + 11);
    doc.text(value(inspection.declarations.clientName), 140, y + 11);
    drawImageContain(doc, inspection.declarations.inspectorSignature, 78, y + 19, 52, 18);
    drawImageContain(doc, inspection.declarations.clientSignature, 140, y + 19, 52, 18);
    y += 46;

    y = addTable(
      doc,
      [["Allegati", "N. pagine / note"]],
      [[
        value(
          [
            inspection.attachments.photos && "Fotografie",
            inspection.attachments.annotatedPlan && "Planimetria annotata",
            inspection.attachments.measurements && "Misure",
            inspection.attachments.acquiredDocuments && "Documenti acquisiti",
            inspection.attachments.estimate && "Preventivo / ordine interventi",
          ]
            .filter(Boolean)
            .join(", ")
        ),
        value(inspection.attachments.pageCount),
      ]],
      y,
      { columnStyles: { 0: { cellWidth: 135 } } }
    );

    y = sectionBar(doc, y, "14. ALLEGATO FOTOGRAFICO");
    const technicalNote =
      "Riferimenti tecnici generali da verificare caso per caso: UNI 11560:2022 (sistemi di ancoraggio permanenti in copertura), manuali del fabbricante, progetto dell'impianto, D.Lgs. 81/2008 e disposizioni regionali/locali applicabili. La periodicità non va presunta: riportare quella prevista dalla documentazione del sistema e gli eventi che richiedono ispezione straordinaria.";
    if (y + 16 > PAGE_BOTTOM) {
      doc.addPage();
      y = 32;
    }
    doc.setFont(PDF_FONT, "normal");
    doc.setFontSize(6.2);
    doc.setTextColor(80, 85, 90);
    const technicalLines = doc.splitTextToSize(technicalNote, 180);
    doc.text(technicalLines, 15, y + 3);
    doc.setTextColor(...BLACK);
    y += technicalLines.length * 2.8 + 5;
    if (String(inspection.attachments.otherPhotoIndex || "").trim()) {
      y = addTextBox(doc, y, "Indice file / altre foto allegate", inspection.attachments.otherPhotoIndex, 15);
    }
    if (!inspection.photos.length) {
      y = addTextBox(doc, y, "Fotografie", "Nessuna fotografia allegata.", 20);
    } else {
      for (let index = 0; index < inspection.photos.length; index += 1) {
        const photo = inspection.photos[index];
        if (y + 74 > PAGE_BOTTOM) {
          doc.addPage();
          y = 32;
        }
        doc.setDrawColor(...BORDER);
        doc.setFillColor(250, 250, 249);
        doc.rect(14, y, 182, 69, "FD");
        drawImageContain(doc, photo.dataUrl, 16, y + 3, 88, 52);
        doc.setFont(PDF_FONT, "bold");
        doc.setFontSize(8);
        doc.text(`Foto ${index + 1} - ${value(photo.title, "Senza titolo")}`, 108, y + 7);
        doc.setFont(PDF_FONT, "normal");
        doc.setFontSize(7);
        const caption = doc.splitTextToSize(
          `Posizione / ID: ${value(photo.position)}\n\nDescrizione / esito: ${value(photo.description)}`,
          83
        );
        doc.text(caption, 108, y + 13);
        doc.setFontSize(6.2);
        doc.setTextColor(95, 100, 104);
        doc.text(value(photo.fileName, ""), 16, y + 62);
        doc.setTextColor(...BLACK);
        y += 73;
      }
    }
    const totalPages = doc.getNumberOfPages();
    for (let page = 1; page <= totalPages; page += 1) {
      doc.setPage(page);
      addFooter(doc, settings, page, totalPages);
    }

    doc.setProperties({
      title: `Ispezione linea vita ${value(inspection.sheetNumber, "")}`,
      subject: "Rapporto di ispezione e manutenzione linea vita",
      author: value(settings.companyName, "EdilKappa"),
      creator: "EdilKappa Linea Vita",
    });

    return doc;
  }

  function filenameFor(inspection) {
    const client = value(inspection.identification.client, "Senza_committente")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 42);
    const sheet = value(inspection.sheetNumber, "LV").replace(/[^a-zA-Z0-9_-]+/g, "_");
    return `${sheet}_${client}.pdf`;
  }

  async function download(inspection, settings) {
    const doc = await generate(inspection, settings);
    doc.save(filenameFor(inspection));
  }

  async function blob(inspection, settings) {
    const doc = await generate(inspection, settings);
    return doc.output("blob");
  }

  window.EKPdf = { generate, download, blob, filenameFor };
})();
