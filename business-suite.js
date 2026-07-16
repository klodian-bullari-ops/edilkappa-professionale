(function () {
  'use strict';

  db.deadlines = db.deadlines || [];
  db.portalUsers = db.portalUsers || [];
  db.reports = db.reports || [];
  db.quotes = db.quotes || [];

  const style = document.createElement('style');
  style.textContent = `
    .suiteTabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}.suiteTabs button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:9px 13px;font-weight:800;color:var(--ink)}
    .reportCard{border-left:5px solid var(--green)}.reportMeta{display:flex;gap:9px;flex-wrap:wrap;margin:10px 0}.reportMeta span{background:#eef2ed;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:750}
    .photoGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-top:12px}.photoTile{border:1px solid var(--line);border-radius:14px;background:#f6f7f3;padding:10px;text-align:left;cursor:pointer}.photoTile strong{display:block;margin-bottom:4px}.photoTile small{color:var(--muted)}
    .signatureBox{width:100%;height:175px;border:1px solid #aeb8ae;border-radius:14px;background:#fff;touch-action:none}.quoteLines{width:100%;border-collapse:collapse}.quoteLines th,.quoteLines td{padding:7px;border-bottom:1px solid var(--line)}.quoteLines input{width:100%;min-width:75px;border:1px solid #ccd2cb;border-radius:9px;padding:9px}.quoteLines .desc{min-width:190px}.quoteTotals{margin-left:auto;width:min(360px,100%);display:grid;grid-template-columns:1fr auto;gap:7px;padding:14px;background:#f3f5f0;border-radius:14px}.quoteTotals b{text-align:right}
    .deadlineUrgent{border-left:5px solid #c3382b}.deadlineSoon{border-left:5px solid #d69b18}.deadlineDone{opacity:.58}.portalHero{background:linear-gradient(135deg,#172419,#315c3b);color:#fff;border-radius:22px;padding:24px;margin-bottom:18px}.portalHero p{color:#dbe5dc;margin-bottom:0}.syncState{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:800;color:#5d675f}.syncDot{width:9px;height:9px;border-radius:50%;background:#d69b18}.sectionNote{font-size:12px;color:var(--muted);margin-top:6px}
    @media(max-width:720px){.quoteLines{min-width:680px}.quoteLinesWrap{overflow:auto}.photoGrid{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(style);

  function addOwnerNav(item) {
    if (!ownerNav.some((entry) => entry[0] === item[0])) ownerNav.splice(Math.max(0, ownerNav.length - 1), 0, item);
  }
  addOwnerNav(['reportsView', '📝', 'Rapportini']);
  addOwnerNav(['deadlinesView', '🔔', 'Scadenze']);
  addOwnerNav(['portalView', '🏢', 'Portale amministratori']);

  const baseMore = more;
  more = function () {
    return baseMore() + pageHead('Gestione condivisa', 'Rapportini, scadenze e accessi esterni') +
      `<div class="grid quick"><button onclick="go('reportsView')"><span>📝</span>Rapportini completi</button><button onclick="go('deadlinesView')"><span>🔔</span>Scadenze e notifiche</button><button onclick="go('portalView')"><span>🏢</span>Portale amministratori</button></div>`;
  };

  function dateText(value) {
    if (!value) return '—';
    const date = new Date(value.length === 10 ? value + 'T12:00:00' : value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('it-IT');
  }

  function dateTimeText(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  }

  function personName(id) {
    if (id === 'owner') return 'Titolare';
    if (id === 'secretary') return 'Ufficio';
    return STAFF.find((person) => person.id === id)?.name || WORKERS.find((team) => team.id === id)?.name || 'Operaio';
  }

  function siteFor(reportItem) {
    return db.sites.find((site) => site.id === reportItem.site) || {};
  }

  function canvasController(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(280, canvas.clientWidth);
    canvas.width = width * ratio;
    canvas.height = 175 * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    context.strokeStyle = '#172419';
    let drawing = false;
    let changed = false;
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      const source = event.touches?.[0] || event;
      return [source.clientX - rect.left, source.clientY - rect.top];
    };
    const start = (event) => { event.preventDefault(); drawing = true; changed = true; context.beginPath(); context.moveTo(...point(event)); };
    const move = (event) => { if (!drawing) return; event.preventDefault(); context.lineTo(...point(event)); context.stroke(); };
    const end = () => { drawing = false; };
    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointerleave', end);
    return {
      clear() { context.clearRect(0, 0, width, 175); changed = false; },
      changed() { return changed; },
      data() { return canvas.toDataURL('image/png'); }
    };
  }

  let reportSignature = null;
  window.clearReportSignature = function () { reportSignature?.clear(); };

  report = function () {
    const mine = isOffice() ? db.sites : db.sites.filter((site) => site.worker === role || STAFF.find((p) => p.id === role)?.team === site.worker);
    setTimeout(() => { reportSignature = canvasController('reportSignatureCanvas'); }, 20);
    return pageHead('Nuovo rapportino completo', 'Foto prima/dopo, ore, materiali e firma del cliente') +
      `<div class="card"><form onsubmit="saveReport(event)" class="formGrid">
        <div class="field full"><label>Cantiere</label><select name="site" required>${mine.map((site) => `<option value="${site.id}">${esc(site.title)} · ${esc(site.address)}</option>`).join('')}</select></div>
        ${field('Data intervento', 'workDate', 'date', localToday())}
        ${field('Operatori presenti', 'workersPresent', 'text', personName(role))}
        ${field('Ora inizio', 'startTime', 'time', '08:00')}${field('Ora fine', 'endTime', 'time', '17:00')}
        ${field('Ore totali', 'hours', 'number', '')}${field('Materiali acquistati €', 'material', 'number', '0')}
        <div class="field full"><label>Materiali utilizzati</label><textarea name="materialsDescription" placeholder="Prodotti, quantità e riferimenti"></textarea></div>
        <div class="field full"><label>Lavoro eseguito</label><textarea name="notes" required placeholder="Descrivi con precisione attività e zone interessate"></textarea></div>
        <div class="field full"><label>Problemi riscontrati</label><textarea name="issues" placeholder="Danni, impedimenti, lavorazioni aggiuntive..."></textarea></div>
        <div class="field full"><label>Lavorazioni ancora da completare</label><textarea name="nextSteps" placeholder="Prossimi passaggi e materiali mancanti"></textarea></div>
        <div class="field"><label>Avanzamento cantiere %</label><input name="progress" type="number" min="0" max="100"></div>
        <div class="field"><label>Stato al termine</label><select name="status"><option>In corso</option><option>In attesa</option><option>Completato</option></select></div>
        <div class="field"><label>Foto prima</label><input name="photosBefore" type="file" accept="image/*" capture="environment" multiple required><small>Almeno una fotografia.</small></div>
        <div class="field"><label>Foto dopo</label><input name="photosAfter" type="file" accept="image/*" capture="environment" multiple></div>
        <div class="field full"><label>Nome del cliente / referente che firma</label><input name="signedBy" required placeholder="Nome e cognome"></div>
        <div class="field full"><label>Firma per conferma del lavoro svolto</label><canvas id="reportSignatureCanvas" class="signatureBox"></canvas><button type="button" class="btn sm light" onclick="clearReportSignature()">Cancella firma</button></div>
        <div class="field full"><label style="display:flex;gap:9px;align-items:flex-start"><input name="confirmed" type="checkbox" required style="width:auto"> Confermo la presenza in cantiere e la presa visione delle attività descritte nel rapportino.</label></div>
        <div class="field full"><button class="btn lime" type="submit">Salva rapportino completo</button></div>
      </form></div>`;
  };

  async function storeReportPhotos(reportId, files, phase, site) {
    const output = [];
    for (const file of Array.from(files || [])) {
      if (!file.type.startsWith('image/')) throw new Error('Le foto devono essere immagini valide.');
      if (file.size > 12 * 1024 * 1024) throw new Error(`La foto ${file.name} supera 12 MB.`);
      const key = `${reportId}-${phase}-${Math.random().toString(36).slice(2, 9)}`;
      await storePdf(key, file);
      const cloudPhoto = await window.EdilKappaCloud?.uploadAttachment?.({ file, reportId, phase, site });
      output.push({ key, phase, name: file.name, type: file.type, size: file.size, ...(cloudPhoto || {}) });
    }
    return output;
  }

  saveReport = async function (event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    button.textContent = 'Salvataggio foto…';
    try {
      const form = new FormData(event.target);
      const site = db.sites.find((item) => item.id === form.get('site'));
      if (!site) throw new Error('Seleziona un cantiere valido.');
      if (!reportSignature?.changed()) throw new Error('Inserisci la firma del cliente o referente.');
      const reportId = uid('r');
      const before = await storeReportPhotos(reportId, event.target.photosBefore.files, 'Prima', site);
      const after = await storeReportPhotos(reportId, event.target.photosAfter.files, 'Dopo', site);
      if (!before.length) throw new Error('Inserisci almeno una foto prima del lavoro.');
      const material = Number(form.get('material') || 0);
      const progress = form.get('progress') === '' ? Number(site.progress || 0) : Number(form.get('progress'));
      const item = {
        id: reportId,
        code: `RAP-${new Date().getFullYear()}-${String(db.reports.length + 1).padStart(4, '0')}`,
        site: site.id,
        client: site.client,
        address: site.address,
        worker: role,
        workerUid: window.EdilKappaCloud?.currentUid || '',
        workerName: personName(role),
        workDate: form.get('workDate'),
        date: new Date().toISOString(),
        startTime: form.get('startTime'),
        endTime: form.get('endTime'),
        workersPresent: form.get('workersPresent'),
        hours: Number(form.get('hours') || 0),
        material,
        materialsDescription: form.get('materialsDescription'),
        notes: form.get('notes'),
        issues: form.get('issues'),
        nextSteps: form.get('nextSteps'),
        progress,
        status: form.get('status'),
        photos: before.concat(after),
        photoCount: before.length + after.length,
        signedBy: form.get('signedBy'),
        signature: reportSignature.data(),
        signedAt: new Date().toISOString()
      };
      db.reports.push(item);
      site.progress = progress;
      site.cost = Number(site.cost || 0) + material;
      site.status = item.status === 'Completato' ? 'Completato' : item.status === 'In attesa' ? 'Pianificato' : 'In corso';
      db.audit = db.audit || [];
      db.audit.push({ id: uid('log'), date: item.date, actor: item.workerName, action: 'Creazione', entity: 'Rapportino', summary: `${item.code} · ${site.title}` });
      save();
      alert('Rapportino completo salvato con foto e firma.');
      go(isOffice() ? 'reportsView' : 'worker');
    } catch (error) {
      alert(error.message || 'Salvataggio non riuscito.');
      button.disabled = false;
      button.textContent = 'Salva rapportino completo';
    }
  };

  window.openReportPhoto = async function (reportId, photoIndex) {
    const item = db.reports.find((report) => report.id === reportId);
    const photo = item?.photos?.[photoIndex];
    if (!photo) return;
    if (photo.key) {
      try {
        const blob = await readPdf(photo.key);
        if (blob) {
          const url = URL.createObjectURL(blob);
          const popup = window.open('', '_blank');
          if (popup) popup.location.href = url;
          else window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          return;
        }
      } catch (_) {}
    }
    if (photo.attachmentId) {
      try { await window.EdilKappaCloud?.openAttachment?.(photo.attachmentId); }
      catch (error) { alert(error.message || 'Fotografia non disponibile.'); }
    }
  };

  window.printReport = function (id) {
    const item = db.reports.find((reportItem) => reportItem.id === id);
    if (!item) return;
    const site = siteFor(item);
    const popup = window.open('', '_blank');
    if (!popup) return alert('Consenti l’apertura della finestra per generare il PDF.');
    popup.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(item.code)}</title><style>body{font:14px Arial;color:#172419;padding:35px;line-height:1.5}h1{color:#315c3b;margin-bottom:3px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#f1f4ef;padding:15px;margin:18px 0}.box{border:1px solid #cad2c9;padding:14px;margin:12px 0}.sign{margin-top:35px;border-top:1px solid #777;padding-top:12px}.sign img{max-width:290px;max-height:100px}small{color:#5c655e}</style></head><body><h1>${COMPANY.name}</h1><small>${COMPANY.address} · P.IVA ${COMPANY.vat} · ${COMPANY.phone} · ${COMPANY.email}</small><hr><h2>RAPPORTINO ${esc(item.code)}</h2><div class="meta"><b>Cliente</b><span>${esc(item.client || site.client)}</span><b>Cantiere</b><span>${esc(site.title || '')}</span><b>Indirizzo</b><span>${esc(item.address || site.address)}</span><b>Data</b><span>${esc(dateText(item.workDate))}</span><b>Operatori</b><span>${esc(item.workersPresent || item.workerName)}</span><b>Orario / ore</b><span>${esc(item.startTime)}–${esc(item.endTime)} · ${Number(item.hours || 0).toFixed(1)} ore</span></div><div class="box"><b>Lavoro eseguito</b><p>${esc(item.notes)}</p></div>${item.materialsDescription ? `<div class="box"><b>Materiali</b><p>${esc(item.materialsDescription)} · ${euro(item.material)}</p></div>` : ''}${item.issues ? `<div class="box"><b>Problemi riscontrati</b><p>${esc(item.issues)}</p></div>` : ''}${item.nextSteps ? `<div class="box"><b>Da completare</b><p>${esc(item.nextSteps)}</p></div>` : ''}<p><b>Avanzamento:</b> ${Number(item.progress || 0)}% · <b>Stato:</b> ${esc(item.status)}</p><p><b>Fotografie allegate:</b> ${item.photoCount || 0}</p><div class="sign"><b>Confermato e firmato da ${esc(item.signedBy)}</b><br><small>${esc(dateTimeText(item.signedAt))}</small><br><img src="${item.signature}" alt="Firma"></div></body></html>`);
    popup.document.close();
    setTimeout(() => popup.print(), 500);
  };

  window.deleteReport = function (id) {
    if (!confirm('Eliminare questo rapportino?')) return;
    db.reports = db.reports.filter((item) => item.id !== id);
    save(); render();
  };

  window.reportsView = function () {
    const rows = db.reports.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const hours = rows.reduce((sum, item) => sum + Number(item.hours || 0), 0);
    const photos = rows.reduce((sum, item) => sum + Number(item.photoCount || 0), 0);
    return pageHead('Rapportini completi', 'Attività, fotografie, costi e firme dei clienti', '<button class="btn lime" onclick="go(\'report\')">＋ Nuovo rapportino</button>') +
      `<div class="grid stats">${stat('Rapportini', rows.length, '📝')}${stat('Ore registrate', hours.toFixed(1), '⏱️')}${stat('Foto allegate', photos, '📷')}${stat('Firmati', rows.filter((x) => x.signedAt).length, '✓')}</div><div class="list">${rows.map((item) => { const site = siteFor(item); return `<section class="card reportCard"><div class="cardHead"><div><h3>${esc(item.code || 'Rapportino')}</h3><small>${esc(item.client || site.client)} · ${esc(site.title || '')}</small></div>${badge(item.status || 'Registrato')}</div><div class="reportMeta"><span>📅 ${esc(dateText(item.workDate || item.date))}</span><span>👷 ${esc(item.workersPresent || item.workerName)}</span><span>⏱ ${Number(item.hours || 0).toFixed(1)} ore</span><span>📈 ${Number(item.progress || 0)}%</span><span>✍️ ${esc(item.signedBy || 'Non firmato')}</span></div><p>${esc(item.notes || '')}</p>${item.issues ? `<div class="notice"><b>Problemi:</b> ${esc(item.issues)}</div>` : ''}<div class="photoGrid">${(item.photos || []).map((photo, index) => `<button class="photoTile" onclick="openReportPhoto('${item.id}',${index})"><strong>📷 ${esc(photo.phase)}</strong><small>${esc(photo.name)}</small></button>`).join('') || '<small>Nessuna fotografia disponibile per i vecchi rapportini.</small>'}</div><div class="actions" style="margin-top:14px"><button class="btn green" onclick="printReport('${item.id}')">Stampa / PDF</button><button class="btn red" onclick="deleteReport('${item.id}')">Elimina</button></div></section>`; }).join('') || '<div class="empty">Nessun rapportino registrato.</div>'}</div>`;
  };

  function quoteLineRows(item) {
    const lines = item.lines?.length ? item.lines : [{ description: item.subject || '', quantity: 1, unit: 'a corpo', unitPrice: Number(item.net || 0) }];
    return Array.from({ length: Math.max(4, lines.length + 1) }, (_, index) => {
      const line = lines[index] || {};
      return `<tr><td><input class="desc" name="lineDescription" value="${esc(line.description || '')}" placeholder="Lavorazione o materiale"></td><td><input name="lineQuantity" type="number" min="0" step="0.01" value="${line.quantity ?? ''}"></td><td><input name="lineUnit" value="${esc(line.unit || '')}" placeholder="mq / h / cad."></td><td><input name="linePrice" type="number" min="0" step="0.01" value="${line.unitPrice ?? ''}"></td><td class="money lineTotal">€ 0,00</td></tr>`;
    }).join('');
  }

  function updateQuotePreview() {
    const form = document.getElementById('modalForm');
    if (!form) return;
    let subtotal = 0;
    const descriptions = form.querySelectorAll('[name=lineDescription]');
    const quantities = form.querySelectorAll('[name=lineQuantity]');
    const prices = form.querySelectorAll('[name=linePrice]');
    const totals = form.querySelectorAll('.lineTotal');
    descriptions.forEach((input, index) => {
      const total = input.value.trim() ? Number(quantities[index].value || 0) * Number(prices[index].value || 0) : 0;
      subtotal += total;
      totals[index].textContent = euro(total);
    });
    const discount = subtotal * Number(form.querySelector('[name=discount]').value || 0) / 100;
    const net = subtotal - discount;
    const vat = net * Number(form.querySelector('[name=vatRate]').value || 0) / 100;
    document.getElementById('quoteSubtotal').textContent = euro(subtotal);
    document.getElementById('quoteDiscount').textContent = euro(discount);
    document.getElementById('quoteNet').textContent = euro(net);
    document.getElementById('quoteVat').textContent = euro(vat);
    document.getElementById('quoteGross').textContent = euro(net + vat);
  }

  openQuote = function (id) {
    const item = db.quotes.find((quote) => quote.id === id) || { code: `PREV-${new Date().getFullYear()}-${String(db.quotes.length + 1).padStart(3, '0')}`, client: '', subject: '', date: localToday(), status: 'Bozza', discount: 0, vatRate: 22, validityDays: 30, paymentTerms: '30% all’accettazione, saldo a fine lavori', notes: '' };
    modal(id ? 'Modifica preventivo professionale' : 'Nuovo preventivo automatico', `<div class="formGrid">${field('Numero', 'code', 'text', item.code)}<div class="field"><label>Cliente</label><select name="client">${clientOptions(item.client)}</select></div>${field('Oggetto', 'subject', 'text', item.subject, true)}${field('Data', 'date', 'date', item.date)}<div class="field"><label>Stato</label><select name="status">${selectOptions(['Bozza', 'Inviato', 'In attesa', 'Accettato', 'Rifiutato'], item.status)}</select></div>${field('Validità in giorni', 'validityDays', 'number', item.validityDays ?? 30)}<div class="field full quoteLinesWrap"><label>Voci del preventivo</label><table class="quoteLines"><thead><tr><th>Descrizione</th><th>Quantità</th><th>Unità</th><th>Prezzo unitario</th><th>Totale</th></tr></thead><tbody>${quoteLineRows(item)}</tbody></table></div>${field('Sconto %', 'discount', 'number', item.discount ?? 0)}${field('IVA %', 'vatRate', 'number', item.vatRate ?? 22)}${field('Condizioni di pagamento', 'paymentTerms', 'text', item.paymentTerms || '', true)}<div class="field full"><label>Note e condizioni</label><textarea name="notes" placeholder="Esclusioni, tempi di esecuzione, accessi...">${esc(item.notes || '')}</textarea></div><div class="field full"><div class="quoteTotals"><span>Subtotale</span><b id="quoteSubtotal">€ 0,00</b><span>Sconto</span><b id="quoteDiscount">€ 0,00</b><span>Imponibile</span><b id="quoteNet">€ 0,00</b><span>IVA</span><b id="quoteVat">€ 0,00</b><span>Totale</span><b id="quoteGross">€ 0,00</b></div></div></div>`, (formData) => {
      const form = document.getElementById('modalForm');
      const descriptions = formData.getAll('lineDescription');
      const quantities = formData.getAll('lineQuantity');
      const units = formData.getAll('lineUnit');
      const prices = formData.getAll('linePrice');
      const lines = descriptions.map((description, index) => ({ description: description.trim(), quantity: Number(quantities[index] || 0), unit: units[index].trim(), unitPrice: Number(prices[index] || 0) })).filter((line) => line.description && line.quantity > 0);
      if (!lines.length) throw new Error('Inserisci almeno una voce con descrizione e quantità.');
      const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
      const discount = Number(formData.get('discount') || 0);
      const vatRate = Number(formData.get('vatRate') || 0);
      const net = subtotal * (1 - discount / 100);
      const data = { code: formData.get('code'), client: formData.get('client'), subject: formData.get('subject'), date: formData.get('date'), status: formData.get('status'), validityDays: Number(formData.get('validityDays') || 30), paymentTerms: formData.get('paymentTerms'), notes: formData.get('notes'), lines, subtotal, discount, vatRate, net, vat: net * vatRate / 100, gross: net * (1 + vatRate / 100), updatedAt: new Date().toISOString() };
      if (id) Object.assign(item, data); else db.quotes.push({ id: uid('p'), ...data, createdAt: new Date().toISOString(), revisions: [] });
      void form;
    });
    setTimeout(() => {
      const form = document.getElementById('modalForm');
      form?.addEventListener('input', updateQuotePreview);
      updateQuotePreview();
    }, 30);
  };

  quotes = function () {
    return pageHead('Preventivi professionali', 'Calcoli automatici, IVA, condizioni, PDF e firma', '<button class="btn light" onclick="openPdfUpload()">↑ Carica PDF</button><button class="btn lime" onclick="openQuote()">＋ Nuovo preventivo</button>') +
      `<div class="card"><div class="tableWrap"><table class="table"><thead><tr><th>Numero</th><th>Data</th><th>Cliente</th><th>Oggetto</th><th>Imponibile</th><th>Totale</th><th>Stato</th><th>Firma</th><th></th></tr></thead><tbody>${db.quotes.map((item) => `<tr><td><b>${esc(item.code)}</b></td><td>${esc(dateText(item.date))}</td><td>${esc(item.client)}</td><td>${esc(item.subject)}</td><td class="money">${euro(item.net || 0)}</td><td class="money">${euro(item.gross ?? item.net ?? 0)}</td><td>${badge(item.status)}</td><td>${item.acceptedAt ? `✓ ${esc(item.signedBy)}` : '—'}</td><td><div class="actions">${item.pdfKey ? `<button class="btn sm green" onclick="openQuotePdf('${item.id}')">Apri PDF</button>` : `<button class="btn sm light" onclick="printQuote('${item.id}')">Stampa / PDF</button>`}${!item.acceptedAt ? `<button class="btn sm green" onclick="openQuoteSignature('${item.id}')">Firma</button>` : ''}<button class="btn sm light" onclick="openQuote('${item.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('quotes','${item.id}','questo preventivo')">Elimina</button></div></td></tr>`).join('') || '<tr><td colspan="9">Nessun preventivo.</td></tr>'}</tbody></table></div></div>`;
  };

  printQuote = function (id) {
    const item = db.quotes.find((quote) => quote.id === id);
    if (!item) return;
    const lines = item.lines?.length ? item.lines : [{ description: item.subject, quantity: 1, unit: 'a corpo', unitPrice: item.net }];
    const popup = window.open('', '_blank');
    if (!popup) return alert('Consenti l’apertura della finestra per generare il PDF.');
    popup.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(item.code)}</title><style>body{font:14px Arial;color:#172419;padding:35px;line-height:1.5}h1{color:#315c3b;margin-bottom:3px}table{width:100%;border-collapse:collapse;margin:25px 0}th,td{padding:10px;border-bottom:1px solid #ccd4cc;text-align:left}th{background:#eef2ed}.right{text-align:right}.totals{margin-left:auto;width:330px}.sign{margin-top:45px;border-top:1px solid #777;padding-top:12px}.sign img{max-width:290px;max-height:100px}small{color:#5c655e}</style></head><body><h1>${COMPANY.name}</h1><small>${COMPANY.address} · P.IVA ${COMPANY.vat}<br>${COMPANY.phone} · ${COMPANY.email}</small><hr><h2>PREVENTIVO ${esc(item.code)}</h2><p><b>Cliente:</b> ${esc(item.client)}<br><b>Oggetto:</b> ${esc(item.subject)}<br><b>Data:</b> ${esc(dateText(item.date))}</p><table><thead><tr><th>Descrizione</th><th>Quantità</th><th>Unità</th><th class="right">Prezzo</th><th class="right">Totale</th></tr></thead><tbody>${lines.map((line) => `<tr><td>${esc(line.description)}</td><td>${Number(line.quantity || 0)}</td><td>${esc(line.unit || '')}</td><td class="right">${euro(line.unitPrice || 0)}</td><td class="right">${euro(Number(line.quantity || 0) * Number(line.unitPrice || 0))}</td></tr>`).join('')}</tbody></table><table class="totals"><tr><td>Subtotale</td><td class="right">${euro(item.subtotal ?? item.net)}</td></tr><tr><td>Sconto ${Number(item.discount || 0)}%</td><td class="right">-${euro((item.subtotal || 0) - (item.net || 0))}</td></tr><tr><td>Imponibile</td><td class="right">${euro(item.net || 0)}</td></tr><tr><td>IVA ${Number(item.vatRate ?? 22)}%</td><td class="right">${euro(item.vat ?? (item.net || 0) * .22)}</td></tr><tr><th>Totale</th><th class="right">${euro(item.gross ?? (item.net || 0) * 1.22)}</th></tr></table><p><b>Validità:</b> ${Number(item.validityDays || 30)} giorni<br><b>Pagamento:</b> ${esc(item.paymentTerms || 'Da concordare')}</p>${item.notes ? `<p><b>Note:</b><br>${esc(item.notes)}</p>` : ''}${item.acceptedAt ? `<div class="sign"><b>Preventivo accettato da ${esc(item.signedBy)}</b><br><small>${esc(dateTimeText(item.acceptedAt))}</small><br><img src="${item.signature}" alt="Firma"></div>` : '<div class="sign">Data e firma per accettazione</div>'}</body></html>`);
    popup.document.close();
    setTimeout(() => popup.print(), 500);
  };

  function automaticDeadlines() {
    const rows = [];
    db.inspections.forEach((x) => rows.push({ id: `inspection-${x.id}`, source: 'Sopralluogo', title: `${x.type} · ${x.client}`, client: x.client, date: x.date, time: x.time, view: 'agenda', done: false }));
    (db.documents || []).filter((x) => x.expiry).forEach((x) => rows.push({ id: `document-${x.id}`, source: 'Documento', title: x.title, client: x.client, date: x.expiry, view: 'documentsView', done: false }));
    (db.payments || []).filter((x) => Number(x.paid || 0) < Number(x.amount || 0)).forEach((x) => rows.push({ id: `payment-${x.id}`, source: 'Pagamento', title: x.description, client: x.client, date: x.dueDate, view: 'payments', done: false }));
    (db.lifelines || []).filter((x) => x.nextCheck).forEach((x) => rows.push({ id: `lifeline-${x.id}`, source: 'Linea vita', title: `Verifica ${x.name}`, client: x.client, date: x.nextCheck, view: 'lifeline', done: false }));
    (db.roofs || []).filter((x) => x.status !== 'Completato').forEach((x) => rows.push({ id: `roof-${x.id}`, source: 'Tetti e gronde', title: x.type, client: x.client, date: x.date, view: 'roofs', done: false }));
    (db.drains || []).filter((x) => x.status !== 'Completato').forEach((x) => rows.push({ id: `drain-${x.id}`, source: 'Pozzetti', title: x.type, client: x.client, date: x.date, view: 'drains', done: false }));
    return rows.concat(db.deadlines.map((x) => ({ ...x, source: x.category || 'Promemoria', view: 'deadlinesView' })));
  }

  function deadlineClass(item) {
    if (item.done) return 'deadlineDone';
    const days = Math.ceil((new Date(item.date + 'T23:59:59') - new Date()) / 86400000);
    if (days < 0) return 'deadlineUrgent';
    if (days <= 7) return 'deadlineSoon';
    return '';
  }

  function deadlineState(item) {
    if (item.done) return 'Completata';
    const days = Math.ceil((new Date(item.date + 'T23:59:59') - new Date()) / 86400000);
    if (days < 0) return `Scaduta da ${Math.abs(days)} gg`;
    if (days === 0) return 'Oggi';
    if (days === 1) return 'Domani';
    return `Tra ${days} gg`;
  }

  window.openDeadline = function (id) {
    const item = db.deadlines.find((x) => x.id === id) || { title: '', client: '', date: localToday(), category: 'Promemoria', priority: 'Normale', assignedTo: 'owner', notes: '', done: false };
    modal(id ? 'Modifica scadenza' : 'Nuova scadenza', `<div class="formGrid">${field('Titolo', 'title', 'text', item.title, true)}<div class="field"><label>Cliente</label><select name="client"><option value="">Azienda</option>${clientOptions(item.client)}</select></div>${field('Data', 'date', 'date', item.date)}<div class="field"><label>Categoria</label><select name="category">${selectOptions(['Promemoria', 'Cantiere', 'Documento', 'Pagamento', 'Sicurezza', 'Mezzo', 'Personale'], item.category)}</select></div><div class="field"><label>Priorità</label><select name="priority">${selectOptions(['Bassa', 'Normale', 'Alta', 'Urgente'], item.priority)}</select></div><div class="field"><label>Assegnata a</label><select name="assignedTo"><option value="owner" ${item.assignedTo === 'owner' ? 'selected' : ''}>Titolare</option><option value="secretary" ${item.assignedTo === 'secretary' ? 'selected' : ''}>Ufficio</option>${STAFF.map((person) => `<option value="${person.id}" ${item.assignedTo === person.id ? 'selected' : ''}>${esc(person.name)}</option>`).join('')}</select></div><div class="field full"><label>Note</label><textarea name="notes">${esc(item.notes || '')}</textarea></div><div class="field full"><label style="display:flex;gap:9px"><input name="done" type="checkbox" style="width:auto" ${item.done ? 'checked' : ''}> Segna come completata</label></div></div>`, (form) => { const data = Object.fromEntries(form); data.done = form.get('done') === 'on'; if (id) Object.assign(item, data); else db.deadlines.push({ id: uid('scad'), ...data, createdAt: new Date().toISOString() }); });
  };

  window.enableSuiteNotifications = async function () {
    if (!('Notification' in window)) return alert('Le notifiche non sono supportate su questo dispositivo.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return alert('Autorizzazione alle notifiche non concessa.');
    localStorage.setItem('ek_suite_notifications', '1');
    await showDueNotifications(true);
    alert('Notifiche attivate. Riceverai gli avvisi delle scadenze imminenti.');
  };

  async function showDueNotifications(force) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || localStorage.getItem('ek_suite_notifications') !== '1') return;
    const today = localToday();
    const due = automaticDeadlines().filter((item) => !item.done && item.date && item.date <= new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
    for (const item of due.slice(0, 5)) {
      const marker = `ek-notified-${item.id}-${today}`;
      if (!force && localStorage.getItem(marker)) continue;
      const title = `${deadlineState(item)} · ${item.source}`;
      const options = { body: `${item.title}${item.client ? ' · ' + item.client : ''}`, icon: './icons/icon-192.png', tag: item.id };
      try {
        if (navigator.serviceWorker) (await navigator.serviceWorker.ready).showNotification(title, options);
        else new Notification(title, options);
        localStorage.setItem(marker, '1');
      } catch (_) { /* Notification best effort. */ }
    }
  }

  window.deadlinesView = function () {
    const rows = automaticDeadlines().filter((x) => x.date).sort((a, b) => String(a.done).localeCompare(String(b.done)) || String(a.date).localeCompare(String(b.date)));
    const today = localToday();
    const overdue = rows.filter((x) => !x.done && x.date < today).length;
    const next7 = rows.filter((x) => !x.done && x.date >= today && x.date <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).length;
    const notificationState = 'Notification' in window && Notification.permission === 'granted' ? 'Attive' : 'Da attivare';
    return pageHead('Scadenze e notifiche', 'Un’unica agenda per lavori, documenti, incassi e sicurezza', '<button class="btn light" onclick="enableSuiteNotifications()">🔔 Attiva notifiche</button><button class="btn lime" onclick="openDeadline()">＋ Nuova scadenza</button>') +
      `<div class="grid stats">${stat('Scadute', overdue, '!')}${stat('Entro 7 giorni', next7, '🔔')}${stat('Totali', rows.length, '📅')}${stat('Notifiche', notificationState, '✓')}</div><div class="list">${rows.map((item) => `<section class="card ${deadlineClass(item)}"><div class="row" style="border:0;padding:0"><div class="rowIcon">${item.done ? '✓' : '🔔'}</div><div class="rowBody"><b>${esc(item.title)}</b><small>${esc(item.source)} · ${esc(item.client || 'Azienda')}<br>${esc(dateText(item.date))} ${item.time ? 'alle ' + esc(item.time) : ''} · ${esc(deadlineState(item))}${item.assignedTo ? ' · ' + esc(personName(item.assignedTo)) : ''}</small></div><div class="actions">${badge(item.done ? 'Completata' : item.priority || deadlineState(item))}${item.id.startsWith('scad') ? `<button class="btn sm light" onclick="openDeadline('${item.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('deadlines','${item.id}','questa scadenza')">Elimina</button>` : `<button class="btn sm green" onclick="go('${item.view}')">Apri</button>`}</div></div></section>`).join('') || '<div class="empty">Nessuna scadenza.</div>'}</div>`;
  };

  window.openPortalUser = function (id) {
    const item = db.portalUsers.find((x) => x.id === id) || { name: '', email: '', phone: '', clients: [], status: 'Invito da inviare' };
    item.clients = item.clients || [];
    modal(id ? 'Modifica accesso amministratore' : 'Invita amministratore', `<div class="formGrid">${field('Nome e cognome', 'name', 'text', item.name)}${field('Email', 'email', 'email', item.email)}${field('Telefono', 'phone', 'tel', item.phone)}<div class="field full"><label>Condomìni visibili</label>${db.condomini.map((client) => `<label style="display:flex;gap:9px;align-items:center;margin:7px 0"><input name="clients" type="checkbox" value="${esc(client.name)}" style="width:auto" ${item.clients.includes(client.name) ? 'checked' : ''}> ${esc(client.name)} · ${esc(client.address)}</label>`).join('')}</div><div class="field"><label>Stato accesso</label><select name="status">${selectOptions(['Invito da inviare', 'Attivo', 'Sospeso'], item.status)}</select></div></div>`, (form) => { const data = { name: form.get('name'), email: form.get('email'), phone: form.get('phone'), clients: form.getAll('clients'), status: form.get('status'), updatedAt: new Date().toISOString() }; if (!data.clients.length) throw new Error('Seleziona almeno un condominio.'); if (id) Object.assign(item, data); else db.portalUsers.push({ id: uid('admin'), inviteCode: Math.random().toString(36).slice(2, 10).toUpperCase(), ...data, createdAt: new Date().toISOString() }); });
  };

  window.previewPortal = function (id) {
    const item = db.portalUsers.find((x) => x.id === id);
    if (!item) return;
    window.__portalPreview = item;
    go('portalPreview');
  };

  window.copyPortalInvite = async function (id) {
    const item = db.portalUsers.find((x) => x.id === id);
    if (!item) return;
    const text = `Ciao ${item.name}, sei stato invitato al Portale EDILKAPPA. Codice invito: ${item.inviteCode}.`;
    try { await navigator.clipboard.writeText(text); alert('Invito copiato.'); } catch (_) { prompt('Copia questo invito:', text); }
  };

  window.portalView = function () {
    return pageHead('Portale amministratori', 'Accessi separati ai soli condomìni autorizzati', '<button class="btn lime" onclick="openPortalUser()">＋ Invita amministratore</button>') +
      `<div class="notice"><b>Privacy per cliente:</b> ogni amministratore vede soltanto condomìni, preventivi, rapportini, foto, documenti e scadenze assegnati al proprio accesso.</div><div style="height:14px"></div><div class="grid stats">${stat('Amministratori', db.portalUsers.length, '🏢')}${stat('Accessi attivi', db.portalUsers.filter((x) => x.status === 'Attivo').length, '✓')}${stat('Inviti', db.portalUsers.filter((x) => x.status === 'Invito da inviare').length, '✉️')}${stat('Condomìni', db.condomini.length, '▦')}</div><div class="list">${db.portalUsers.map((item) => `<section class="card"><div class="row" style="border:0;padding:0"><div class="rowIcon">🏢</div><div class="rowBody"><b>${esc(item.name)}</b><small>${esc(item.email)} · ${esc(item.phone || '')}<br>${item.clients.map(esc).join(', ')}</small></div>${badge(item.status)}</div><div class="actions" style="margin-top:13px"><button class="btn sm green" onclick="previewPortal('${item.id}')">Anteprima portale</button><button class="btn sm light" onclick="copyPortalInvite('${item.id}')">Copia invito</button><button class="btn sm light" onclick="openPortalUser('${item.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('portalUsers','${item.id}','questo accesso')">Revoca</button></div></section>`).join('') || '<div class="empty">Nessun amministratore invitato.</div>'}</div>`;
  };

  window.portalPreview = function () {
    const user = window.__portalPreview;
    if (!user) return '<div class="empty">Seleziona un amministratore dal portale.</div>';
    const allowed = new Set(user.clients);
    const sites = db.sites.filter((x) => allowed.has(x.client));
    const reports = db.reports.filter((x) => allowed.has(x.client || siteFor(x).client));
    const quotesRows = db.quotes.filter((x) => allowed.has(x.client));
    const documents = (db.documents || []).filter((x) => allowed.has(x.client));
    const deadlines = automaticDeadlines().filter((x) => allowed.has(x.client) && !x.done);
    return `<div class="portalHero"><button class="btn light sm" onclick="go('portalView')">← Torna alla gestione</button><h2>Portale di ${esc(user.name)}</h2><p>Dati visibili: ${user.clients.map(esc).join(', ')}</p></div><div class="grid stats">${stat('Cantieri', sites.length, '🏗️')}${stat('Rapportini', reports.length, '📝')}${stat('Preventivi', quotesRows.length, '📄')}${stat('Scadenze', deadlines.length, '🔔')}</div><div class="grid cols"><section class="card"><div class="cardHead"><h3>Stato lavori</h3></div><div class="list">${sites.map((x) => `<div class="row"><div class="rowIcon">🏗️</div><div class="rowBody"><b>${esc(x.title)}</b><small>${esc(x.client)} · ${Number(x.progress || 0)}% · ${esc(x.status)}</small></div></div>`).join('') || '<div class="empty">Nessun lavoro.</div>'}</div></section><section class="card"><div class="cardHead"><h3>Ultimi rapportini</h3></div><div class="list">${reports.slice(-5).reverse().map((x) => `<div class="row"><div class="rowIcon">📝</div><div class="rowBody"><b>${esc(x.code || 'Rapportino')}</b><small>${esc(dateText(x.workDate || x.date))} · ${esc(x.notes || '')}</small></div><button class="btn sm light" onclick="printReport('${x.id}')">PDF</button></div>`).join('') || '<div class="empty">Nessun rapportino.</div>'}</div></section><section class="card"><div class="cardHead"><h3>Preventivi</h3></div><div class="list">${quotesRows.map((x) => `<div class="row"><div class="rowIcon">📄</div><div class="rowBody"><b>${esc(x.code)}</b><small>${esc(x.subject)} · ${euro(x.gross ?? x.net)}</small></div>${badge(x.status)}</div>`).join('') || '<div class="empty">Nessun preventivo.</div>'}</div></section><section class="card"><div class="cardHead"><h3>Documenti</h3></div><div class="list">${documents.map((x) => `<div class="row"><div class="rowIcon">📁</div><div class="rowBody"><b>${esc(x.title)}</b><small>${esc(x.category)} · ${x.expiry ? 'Scadenza ' + esc(dateText(x.expiry)) : 'Senza scadenza'}</small></div><button class="btn sm light" onclick="openBusinessDocument('${x.id}')">Apri</button></div>`).join('') || '<div class="empty">Nessun documento.</div>'}</div></section></div>`;
  };

  const baseRender = render;
  render = function () {
    if (['reportsView', 'deadlinesView', 'portalView', 'portalPreview'].includes(view)) {
      if (!isOffice()) view = 'worker';
      renderNav();
      document.getElementById('avatar').textContent = roleName().charAt(0);
      const titles = { reportsView: 'Rapportini', deadlinesView: 'Scadenze', portalView: 'Portale amministratori', portalPreview: 'Anteprima portale' };
      document.getElementById('pageTitle').textContent = titles[view];
      const pages = { reportsView, deadlinesView, portalView, portalPreview };
      document.getElementById('app').innerHTML = pages[view]();
      return;
    }
    baseRender();
  };

  const originalSiteRow = siteRow;
  siteRow = function (site) {
    const count = db.reports.filter((item) => item.site === site.id).length;
    return originalSiteRow(site).replace('</small>', `<br><b>${count} rapportin${count === 1 ? 'o' : 'i'}</b></small>`);
  };

  const topActions = document.querySelector('.topActions');
  if (topActions) {
    const state = document.createElement('span');
    state.className = 'syncState';
    state.title = 'La sincronizzazione cloud sarà attiva dopo il collegamento Firebase';
    state.innerHTML = '<i class="syncDot"></i><span>Locale</span>';
    topActions.prepend(state);
  }

  save();
  initRoles();
  render();
  setTimeout(() => showDueNotifications(false), 2500);
  setInterval(() => showDueNotifications(false), 15 * 60 * 1000);
})();
