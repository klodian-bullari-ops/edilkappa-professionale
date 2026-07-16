(function () {
  db.payments = db.payments || [];
  db.documents = db.documents || [];
  db.audit = db.audit || [];

  function addNav(item) {
    if (ownerNav.some((x) => x[0] === item[0])) return;
    ownerNav.splice(Math.max(0, ownerNav.length - 1), 0, item);
  }
  addNav(['payments', '€', 'Pagamenti']);
  addNav(['documentsView', '▣', 'Documenti']);
  addNav(['auditView', '↺', 'Registro modifiche']);

  function logAudit(action, entity, summary) {
    db.audit.push({ id: uid('log'), date: new Date().toISOString(), actor: roleName(), action, entity, summary: summary || '' });
  }

  const baseModal = modal;
  modal = function (title, body, onSave) {
    return baseModal(title, body, async (form) => {
      await onSave(form);
      logAudit('Salvataggio', title, 'Dati creati o modificati');
    });
  };

  deleteItem = function (collectionName, id, label) {
    if (!confirm(`Eliminare definitivamente ${label}?`)) return;
    db[collectionName] = (db[collectionName] || []).filter((x) => x.id !== id);
    logAudit('Eliminazione', collectionName, label);
    save(); render();
  };

  function paymentStatus(item) {
    if (Number(item.paid || 0) >= Number(item.amount || 0)) return 'Pagato';
    if (item.dueDate && item.dueDate < localToday()) return 'Scaduto';
    if (Number(item.paid || 0) > 0) return 'Parziale';
    return item.status || 'Da incassare';
  }

  window.openPayment = function (id) {
    const item = db.payments.find((x) => x.id === id) || {
      client: '', description: '', amount: 0, paid: 0,
      dueDate: localToday(), status: 'Da incassare', notes: ''
    };
    modal(id ? 'Modifica pagamento' : 'Nuovo pagamento', `<div class="formGrid">
      <div class="field"><label>Cliente</label><select name="client">${clientOptions(item.client)}</select></div>
      ${field('Descrizione / riferimento', 'description', 'text', item.description, true)}
      ${field('Importo totale €', 'amount', 'number', item.amount)}
      ${field('Importo incassato €', 'paid', 'number', item.paid)}
      ${field('Scadenza', 'dueDate', 'date', item.dueDate)}
      <div class="field"><label>Stato</label><select name="status">${selectOptions(['Da incassare', 'Parziale', 'Pagato'], item.status)}</select></div>
      <div class="field full"><label>Note</label><textarea name="notes">${esc(item.notes || '')}</textarea></div>
    </div>`, (form) => {
      const data = Object.fromEntries(form); data.amount = Number(data.amount); data.paid = Number(data.paid);
      if (id) Object.assign(item, data); else db.payments.push({ id: uid('pag'), ...data });
    });
  };

  window.payments = function () {
    const total = db.payments.reduce((n, x) => n + Number(x.amount || 0), 0);
    const paid = db.payments.reduce((n, x) => n + Number(x.paid || 0), 0);
    const overdue = db.payments.filter((x) => paymentStatus(x) === 'Scaduto');
    return pageHead('Pagamenti e scadenze', 'Acconti, saldi, insoluti e incassi', '<button class="btn lime" onclick="openPayment()">＋ Nuovo pagamento</button>') +
      `<div class="grid stats">${stat('Da incassare', euro(total - paid), '€')}${stat('Incassato', euro(paid), '✓')}${stat('Scaduti', overdue.length, '!')}${stat('Totale lavori', euro(total), '↗')}</div>
      <div class="card"><div class="tableWrap"><table class="table"><thead><tr><th>Cliente</th><th>Descrizione</th><th>Scadenza</th><th>Importo</th><th>Incassato</th><th>Residuo</th><th>Stato</th><th></th></tr></thead><tbody>
      ${db.payments.map((x) => `<tr><td><b>${esc(x.client)}</b></td><td>${esc(x.description)}</td><td>${esc(x.dueDate)}</td><td class="money">${euro(x.amount)}</td><td class="money">${euro(x.paid)}</td><td class="money">${euro(Number(x.amount || 0) - Number(x.paid || 0))}</td><td>${badge(paymentStatus(x))}</td><td><div class="actions"><button class="btn sm light" onclick="openPayment('${x.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('payments','${x.id}','questo pagamento')">Elimina</button></div></td></tr>`).join('') || '<tr><td colspan="8">Nessun pagamento registrato.</td></tr>'}
      </tbody></table></div></div>`;
  };

  function documentStatus(item) {
    if (!item.expiry) return 'Archiviato';
    const days = (new Date(item.expiry) - new Date()) / 86400000;
    if (days < 0) return 'Scaduto';
    if (days <= 30) return 'In scadenza';
    return 'Valido';
  }

  window.openCompanyDocument = function (id) {
    const item = db.documents.find((x) => x.id === id) || { client: '', category: 'Cantiere', title: '', expiry: '', notes: '', fileName: '' };
    modal(id ? 'Modifica documento' : 'Nuovo documento', `<div class="formGrid">
      <div class="field"><label>Cliente / condominio</label><select name="client">${clientOptions(item.client)}</select></div>
      <div class="field"><label>Categoria</label><select name="category">${selectOptions(['Cantiere', 'Sicurezza', 'Personale', 'Mezzi', 'Fornitore', 'Amministrativo'], item.category)}</select></div>
      ${field('Titolo documento', 'title', 'text', item.title, true)}
      <div class="field"><label>Scadenza facoltativa</label><input name="expiry" type="date" value="${esc(item.expiry || '')}"></div>
      <div class="field full"><label>File PDF o immagine</label><input name="file" type="file" accept="application/pdf,.pdf,image/*" ${id ? '' : 'required'}></div>
      <div class="field full"><label>Note</label><textarea name="notes">${esc(item.notes || '')}</textarea></div>
    </div>`, async (form) => {
      const file = form.get('file');
      const data = { client: form.get('client'), category: form.get('category'), title: form.get('title'), expiry: form.get('expiry'), notes: form.get('notes') };
      if (file && file.size) {
        if (window.EdilKappaCloud?.ready && window.EdilKappaCloud.uploadDocument) data.url = await window.EdilKappaCloud.uploadDocument(file);
        else { data.fileKey = uid('doc') + '-' + Math.random().toString(36).slice(2, 7); await storePdf(data.fileKey, file); }
        data.fileName = file.name; data.fileType = file.type;
      }
      if (id) Object.assign(item, data); else db.documents.push({ id: uid('documento'), ...data });
    });
  };

  window.openBusinessDocument = async function (id) {
    const item = db.documents.find((x) => x.id === id); if (!item) return;
    if (item.url) return window.open(item.url, '_blank');
    if (item.fileKey) return openStoredFile(item.fileKey);
    alert('File non ancora disponibile.');
  };

  window.documentsView = function () {
    const expiring = db.documents.filter((x) => ['Scaduto', 'In scadenza'].includes(documentStatus(x)));
    return pageHead('Documenti', 'Archivio di cantiere, sicurezza, personale, mezzi e fornitori', '<button class="btn lime" onclick="openCompanyDocument()">＋ Carica documento</button>') +
      `<div class="grid stats">${stat('Documenti', db.documents.length, '▣')}${stat('In scadenza', expiring.length, '!')}${stat('Categorie', new Set(db.documents.map((x) => x.category)).size, '▦')}${stat('Archivio', 'Cloud', '☁')}</div>
      <div class="list">${db.documents.map((x) => `<section class="card"><div class="row" style="border:0;padding:0"><div class="rowIcon">📄</div><div class="rowBody"><b>${esc(x.title)}</b><small>${esc(x.client)} · ${esc(x.category)} · ${esc(x.fileName || 'Nessun file')}<br>${x.expiry ? 'Scadenza ' + esc(x.expiry) : 'Nessuna scadenza'}</small></div>${badge(documentStatus(x))}</div><div class="actions" style="margin-top:12px"><button class="btn sm green" onclick="openBusinessDocument('${x.id}')">Apri</button><button class="btn sm light" onclick="openCompanyDocument('${x.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('documents','${x.id}','questo documento')">Elimina</button></div></section>`).join('') || '<div class="empty">Nessun documento archiviato.</div>'}</div>`;
  };

  window.auditView = function () {
    const rows = db.audit.slice().sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')));
    return pageHead('Registro modifiche', 'Chi ha creato, modificato o eliminato ogni dato') +
      `<div class="card"><div class="tableWrap"><table class="table"><thead><tr><th>Data</th><th>Utente</th><th>Azione</th><th>Sezione</th><th>Dettaglio</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(String(x.date || x.createdAt || '').slice(0, 19).replace('T', ' '))}</td><td><b>${esc(x.actor || x.actorId || 'Sistema')}</b></td><td>${esc(x.action)}</td><td>${esc(x.entity || x.entityType)}</td><td>${esc(x.summary)}</td></tr>`).join('') || '<tr><td colspan="5">Nessuna modifica registrata.</td></tr>'}</tbody></table></div></div>`;
  };

  let signatureCanvas = null, signatureContext = null, signatureDrawing = false;
  window.clearSignatureCanvas = function () { if (signatureContext) signatureContext.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height); };
  function setupSignatureCanvas() {
    signatureCanvas = document.getElementById('signatureCanvas'); if (!signatureCanvas) return;
    const ratio = window.devicePixelRatio || 1, width = signatureCanvas.clientWidth;
    signatureCanvas.width = width * ratio; signatureCanvas.height = 170 * ratio;
    signatureContext = signatureCanvas.getContext('2d'); signatureContext.scale(ratio, ratio); signatureContext.lineWidth = 2; signatureContext.lineCap = 'round';
    const point = (event) => { const r = signatureCanvas.getBoundingClientRect(), p = event.touches ? event.touches[0] : event; return [p.clientX - r.left, p.clientY - r.top]; };
    const start = (event) => { event.preventDefault(); signatureDrawing = true; signatureContext.beginPath(); signatureContext.moveTo(...point(event)); };
    const move = (event) => { if (!signatureDrawing) return; event.preventDefault(); signatureContext.lineTo(...point(event)); signatureContext.stroke(); };
    const end = () => { signatureDrawing = false; };
    signatureCanvas.addEventListener('pointerdown', start); signatureCanvas.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true });
    signatureCanvas.addEventListener('touchstart', start, { passive: false }); signatureCanvas.addEventListener('touchmove', move, { passive: false }); signatureCanvas.addEventListener('touchend', end);
  }

  window.openQuoteSignature = function (id) {
    const quote = db.quotes.find((x) => x.id === id); if (!quote) return;
    modal('Firma e accettazione preventivo', `<div class="notice"><b>${esc(quote.code)} · ${esc(quote.client)}</b><br>${esc(quote.subject)}</div><div style="height:14px"></div>
      <div class="field"><label>Nome di chi firma</label><input name="signedBy" required></div>
      <div class="field"><label>Firma</label><canvas id="signatureCanvas" style="width:100%;height:170px;border:1px solid #ccd2cb;border-radius:12px;touch-action:none"></canvas><button type="button" class="btn sm light" onclick="clearSignatureCanvas()">Cancella firma</button></div>
      <label style="display:flex;gap:8px;align-items:flex-start"><input name="accepted" type="checkbox" required> Confermo l’accettazione del preventivo e delle condizioni indicate.</label>`, (form) => {
        const signature = signatureCanvas?.toDataURL('image/png');
        if (!signature || signature.length < 500) throw new Error('Inserisci la firma.');
        quote.signature = signature; quote.signedBy = form.get('signedBy'); quote.acceptedAt = new Date().toISOString(); quote.status = 'Accettato';
        quote.revisions = quote.revisions || []; quote.revisions.push({ date: quote.acceptedAt, action: 'Accettazione firmata', actor: quote.signedBy });
      });
    setTimeout(setupSignatureCanvas, 40);
  };

  quotes = function () {
    return pageHead('Preventivi', 'Offerte, revisioni, firme e accettazioni', '<button class="btn light" onclick="openPdfUpload()">↑ Carica PDF</button><button class="btn lime" onclick="openQuote()">＋ Nuovo preventivo</button>') +
      `<div class="card"><div class="tableWrap"><table class="table"><thead><tr><th>Numero</th><th>Data</th><th>Cliente</th><th>Oggetto</th><th>Netto</th><th>Stato</th><th>Firma</th><th></th></tr></thead><tbody>${db.quotes.map((q) => `<tr><td><b>${esc(q.code)}</b></td><td>${esc(q.date)}</td><td>${esc(q.client)}</td><td>${esc(q.subject)}</td><td class="money">${q.net ? euro(q.net) : '—'}</td><td>${badge(q.status)}</td><td>${q.acceptedAt ? `Firmato da <b>${esc(q.signedBy)}</b><br><small>${esc(q.acceptedAt.slice(0, 10))}</small>` : 'Non firmato'}</td><td><div class="actions">${q.pdfKey ? `<button class="btn sm green" onclick="openQuotePdf('${q.id}')">Apri PDF</button>` : `<button class="btn sm light" onclick="printQuote('${q.id}')">Genera PDF</button>`}${!q.acceptedAt ? `<button class="btn sm green" onclick="openQuoteSignature('${q.id}')">Firma</button>` : ''}<button class="btn sm light" onclick="openQuote('${q.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('quotes','${q.id}','questo preventivo')">Elimina</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
  };

  const basePrintQuote = printQuote;
  printQuote = function (id) {
    const q = db.quotes.find((x) => x.id === id);
    if (!q || !q.acceptedAt) return basePrintQuote(id);
    const popup = window.open('', '_blank'); if (!popup) return;
    popup.document.write(`<!doctype html><html><body style="font-family:Arial;padding:35px"><h1>${COMPANY.name}</h1><p>${COMPANY.address}<br>P.IVA ${COMPANY.vat}<br>${COMPANY.phone} · ${COMPANY.email}</p><hr><h2>PREVENTIVO ${esc(q.code)}</h2><p>${esc(q.client)}<br>${esc(q.subject)}</p><h2 style="text-align:right">Imponibile: ${euro(q.net)}</h2><div style="margin-top:60px;border-top:1px solid #aaa;padding-top:15px"><b>Preventivo accettato e firmato</b><br>Firmatario: ${esc(q.signedBy)}<br>Data: ${esc(q.acceptedAt.slice(0, 10))}<br><img src="${q.signature}" style="max-width:280px;max-height:100px"></div></body></html>`);
    popup.document.close(); setTimeout(() => popup.print(), 400);
  };

  function todayPanel() {
    const today = localToday(), soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), rows = [];
    db.inspections.filter((x) => x.date === today).forEach((x) => rows.push({ icon: '📅', title: 'Sopralluogo', text: `${x.time} · ${x.client} · ${x.address}`, view: 'agenda' }));
    db.sites.filter((x) => x.status === 'In corso').forEach((x) => rows.push({ icon: '🏗️', title: 'Cantiere da controllare', text: `${x.title} · ${x.client}`, view: 'sites' }));
    db.quotes.filter((x) => ['Inviato', 'In attesa'].includes(x.status)).forEach((x) => rows.push({ icon: '📄', title: 'Preventivo da richiamare', text: `${x.code} · ${x.client}`, view: 'quotes' }));
    db.payments.filter((x) => paymentStatus(x) === 'Scaduto').forEach((x) => rows.push({ icon: '€', title: 'Pagamento scaduto', text: `${x.client} · ${euro(Number(x.amount || 0) - Number(x.paid || 0))}`, view: 'payments' }));
    db.documents.filter((x) => x.expiry && x.expiry <= soon && documentStatus(x) !== 'Valido').forEach((x) => rows.push({ icon: '⚠️', title: 'Documento in scadenza', text: `${x.title} · ${x.expiry}`, view: 'documentsView' }));
    const missing = STAFF.filter((p) => !individualHourRows().some((x) => x.worker === p.id && x.date === today));
    if (missing.length) rows.push({ icon: '⏱️', title: 'Ore non comunicate', text: missing.map((x) => x.name).join(', '), view: 'hours' });
    return `<div class="sectionHead"><h2>Cosa devo fare oggi</h2></div><div class="card"><div class="list">${rows.map((x) => `<div class="row"><div class="rowIcon">${x.icon}</div><div class="rowBody"><b>${x.title}</b><small>${esc(x.text)}</small></div><button class="btn sm green" onclick="go('${x.view}')">Apri</button></div>`).join('') || '<div class="okbox">Nessuna attività urgente: giornata sotto controllo.</div>'}</div></div>`;
  }

  const baseDashboard = dashboard;
  dashboard = function () { return baseDashboard() + todayPanel(); };

  more = function () {
    const links = [['agenda','📅','Agenda'],['condomini','🏢','Condomìni'],['quotes','📄','Preventivi'],['workMap','🗺️','Mappa lavori'],['hours','⏱️','Ore operai'],['payments','€','Pagamenti'],['documentsView','📁','Documenti'],['auditView','↺','Registro modifiche'],['teamsView','👥','Squadre'],['drone','🚁','Drone'],['lifeline','⚓','Linea vita'],['roofs','🏠','Tetti e gronde'],['drains','🕳️','Pozzetti e tombini'],['finance','📈','Costi e margini']];
    return pageHead('Tutti gli strumenti', 'Scegli il modulo da aprire') + `<div class="grid quick">${links.map((x) => `<button onclick="go('${x[0]}')"><span>${x[1]}</span>${x[2]}</button>`).join('')}</div>`;
  };

  render = function () {
    if (!isOffice() && !['worker','hours','report','search'].includes(view)) view = 'worker';
    renderNav(); document.getElementById('avatar').textContent = roleName().charAt(0);
    const labels = Object.fromEntries(nav().map((x) => [x[0], x[2]])); labels.more = 'Altro'; labels.search = 'Ricerca';
    document.getElementById('pageTitle').textContent = labels[view] || 'EDILKAPPA';
    const pages = { dashboard, agenda, condomini, inspections, quotes, sites, workMap, hours: hoursView, payments, documentsView, auditView, teamsView, drone, lifeline, roofs, drains, finance, more, worker, report, search: searchResults };
    document.getElementById('app').innerHTML = (pages[view] || dashboard)();
  };

  save(); initRoles(); render();
})();
