(function () {
  'use strict';

  db.leads = db.leads || [];
  db.priceList = db.priceList || [];
  db.certificates = db.certificates || [];
  db.inventory = db.inventory || [];
  db.equipment = db.equipment || [];

  if (!db.priceList.length) {
    db.priceList.push(
      { id: uid('lst'), code: 'MAN-01', category: 'Manodopera', description: 'Operaio specializzato', unit: 'ora', cost: 28, salePrice: 42, status: 'Attivo' },
      { id: uid('lst'), code: 'MAN-02', category: 'Manodopera', description: 'Squadra di due operatori', unit: 'ora', cost: 56, salePrice: 84, status: 'Attivo' },
      { id: uid('lst'), code: 'MAT-01', category: 'Materiali', description: 'Materiale edile di consumo', unit: 'a corpo', cost: 100, salePrice: 130, status: 'Attivo' },
      { id: uid('lst'), code: 'SIC-01', category: 'Sicurezza', description: 'Allestimento e messa in sicurezza', unit: 'giorno', cost: 180, salePrice: 250, status: 'Attivo' }
    );
  }

  const style = document.createElement('style');
  style.textContent = `
    .smartBanner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px;border-radius:18px;background:linear-gradient(135deg,#111,#292d30);color:#fff;border-bottom:5px solid var(--lime);margin-bottom:18px}.smartBanner h3{margin:0 0 5px;color:var(--lime)}.smartBanner p{margin:0;color:#e2e5e7}.smartBanner .btn{flex:none}
    .voiceBox{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:13px;border:1px solid #ead16a;background:#fff8d5;border-radius:14px;margin-bottom:10px}.voiceBox p{margin:0;flex:1;min-width:220px;font-size:13px;color:#5d4b00}.voiceListening{animation:voicePulse 1s infinite alternate}@keyframes voicePulse{from{box-shadow:0 0 0 0 rgba(173,42,42,.25)}to{box-shadow:0 0 0 9px rgba(173,42,42,0)}}
    .smartMetric{font-size:12px;color:var(--muted);margin-top:6px}.smartThumbs{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.smartThumbs img{width:76px;height:62px;object-fit:cover;border-radius:10px;border:1px solid var(--line)}
    .stockLow{border-left:5px solid var(--red)}.stockOk{border-left:5px solid var(--green)}.smartTableInput{width:85px;border:1px solid var(--line);border-radius:9px;padding:8px}.pdfHint{padding:12px;border-radius:12px;background:#eef6ff;color:#245b8f;font-size:12px}
    .portalGallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-top:10px}.portalGallery img{width:100%;height:95px;object-fit:cover;border-radius:11px;border:1px solid var(--line)}
    @media(max-width:620px){.smartBanner{align-items:flex-start;flex-direction:column}.smartBanner .btn{width:100%}}
  `;
  document.head.appendChild(style);

  function addOwnerNav(item, before = 'finance') {
    if (ownerNav.some((entry) => entry[0] === item[0])) return;
    const index = ownerNav.findIndex((entry) => entry[0] === before);
    ownerNav.splice(index < 0 ? ownerNav.length : index, 0, item);
  }
  addOwnerNav(['leadsView', '📥', 'Richieste clienti']);
  addOwnerNav(['priceListView', '🧮', 'Listino prezzi']);
  addOwnerNav(['certificatesView', '🛡️', 'Verbali e certificazioni']);
  addOwnerNav(['warehouseView', '📦', 'Magazzino e DPI']);

  function today() { return new Date().toISOString().slice(0, 10); }
  function smartDate(value) {
    if (!value) return '—';
    const date = new Date(String(value).length === 10 ? value + 'T12:00:00' : value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('it-IT');
  }
  function clientByName(name) { return (db.condomini || []).find((item) => item.name === name); }
  function clientOptionsSmart(selected = '') {
    return (db.condomini || []).map((item) => `<option value="${esc(item.name)}" ${item.name === selected ? 'selected' : ''}>${esc(item.name)} · ${esc(item.address)}</option>`).join('');
  }
  function smartSelect(values, selected) {
    return values.map((value) => `<option ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('');
  }
  function fieldSmart(label, name, type, value = '', full = false, extra = '') {
    return `<div class="field ${full ? 'full' : ''}"><label>${label}</label><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
  }
  function photoPreview(photos) {
    return photos?.length ? `<div class="smartThumbs">${photos.map((photo) => `<img src="${photo}" alt="Fotografia allegata">`).join('')}</div>` : '';
  }

  async function compressToDataUrl(file, maxBytes = 140000, maxSide = 1200) {
    if (!file?.type?.startsWith('image/')) throw new Error('Allega soltanto fotografie valide.');
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    let dataUrl = '';
    for (let pass = 0; pass < 5; pass += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.78, 0.66, 0.54, 0.44]) {
        dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (Math.ceil(dataUrl.length * 0.75) <= maxBytes) break;
      }
      if (Math.ceil(dataUrl.length * 0.75) <= maxBytes) break;
      scale *= 0.7;
    }
    bitmap.close?.();
    if (!dataUrl || Math.ceil(dataUrl.length * 0.75) > maxBytes) throw new Error(`La foto ${file.name} è troppo grande.`);
    return dataUrl;
  }

  async function imageData(url) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      image.onerror = () => resolve('');
      image.src = url;
    });
  }

  async function pdfHeader(doc, title, code) {
    const logo = await imageData('./linea-vita/assets/logo-edilkappa-pdf.jpg');
    if (logo) doc.addImage(logo, 'JPEG', 14, 10, 48, 20);
    doc.setTextColor(17, 17, 17); doc.setFontSize(17); doc.setFont(undefined, 'bold');
    doc.text(title, 196, 17, { align: 'right' });
    doc.setFontSize(9); doc.setFont(undefined, 'normal');
    doc.text(code || '', 196, 23, { align: 'right' });
    doc.setDrawColor(244, 196, 0); doc.setLineWidth(1.5); doc.line(14, 34, 196, 34);
    doc.setFontSize(8); doc.setTextColor(90, 95, 99);
    doc.text(`${COMPANY.name} · ${COMPANY.address} · P.IVA ${COMPANY.vat}`, 14, 287);
  }

  const baseMore = more;
  more = function () {
    return baseMore() + pageHead('Ufficio intelligente', 'Clienti, documenti, listino e risorse in un solo posto') +
      `<div class="grid quick"><button onclick="go('leadsView')"><span>📥</span>Richieste clienti</button><button onclick="go('priceListView')"><span>🧮</span>Listino e calcolo</button><button onclick="go('certificatesView')"><span>🛡️</span>Verbali e certificazioni</button><button onclick="go('warehouseView')"><span>📦</span>Magazzino, utensili e DPI</button><button onclick="location.href='./linea-vita/'"><span>⚓</span>Modulo Linea Vita completo</button></div>`;
  };

  const baseLifeline = lifeline;
  lifeline = function () {
    return `<div class="smartBanner"><div><h3>Linea Vita ora è dentro EDILKAPPA Professionale</h3><p>Apri il modulo tecnico completo con sopralluoghi guidati, fotografie, firme e certificazioni PDF.</p></div><button class="btn lime" onclick="location.href='./linea-vita/'">Apri modulo tecnico →</button></div>` + baseLifeline();
  };

  const baseReport = report;
  report = function () {
    const html = baseReport();
    const marker = '<div class="field full"><label>Lavoro eseguito</label>';
    return html.replace(marker, `<div class="field full"><div class="voiceBox"><button id="voiceReportButton" type="button" class="btn green" onclick="startVoiceReport()">🎙️ Detta il lavoro</button><p id="voiceReportState">Parla normalmente: l’app trascrive l’attività e riconosce ore e avanzamento.</p></div></div>${marker}`);
  };

  window.startVoiceReport = function () {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return alert('La dettatura vocale non è supportata da questo browser. Su Android usa Chrome; su iPhone puoi usare il microfono della tastiera.');
    const form = document.querySelector('#app form');
    const notes = form?.querySelector('[name="notes"]');
    if (!form || !notes) return;
    const recognition = new Recognition();
    recognition.lang = 'it-IT'; recognition.interimResults = true; recognition.continuous = false;
    const button = document.getElementById('voiceReportButton');
    const state = document.getElementById('voiceReportState');
    const before = notes.value.trim();
    recognition.onstart = () => { button?.classList.add('voiceListening'); if (button) button.textContent = '🔴 Sto ascoltando…'; if (state) state.textContent = 'Detta ciò che hai fatto, i materiali, le ore e la percentuale di avanzamento.'; };
    recognition.onresult = (event) => {
      const text = Array.from(event.results).map((result) => result[0].transcript).join(' ').trim();
      notes.value = [before, text].filter(Boolean).join(before ? '\n' : '');
      const hours = text.match(/(?:per\s+)?(\d+(?:[,.]\d+)?)\s*or[ae]/i);
      const progress = text.match(/(?:avanzamento|completato|progresso)\s*(?:al|del)?\s*(\d{1,3})\s*(?:%|percento)/i);
      const material = text.match(/(?:materiali|speso|acquistato)\s*(?:per)?\s*(\d+(?:[,.]\d+)?)\s*(?:euro|€)/i);
      if (hours) form.querySelector('[name="hours"]').value = hours[1].replace(',', '.');
      if (progress && form.querySelector('[name="progress"]')) form.querySelector('[name="progress"]').value = Math.min(100, Number(progress[1]));
      if (material && form.querySelector('[name="material"]')) form.querySelector('[name="material"]').value = material[1].replace(',', '.');
    };
    recognition.onerror = (event) => { if (state) state.textContent = event.error === 'not-allowed' ? 'Consenti l’uso del microfono nelle impostazioni del browser.' : 'Non ho capito. Premi e prova di nuovo.'; };
    recognition.onend = () => { button?.classList.remove('voiceListening'); if (button) button.textContent = '🎙️ Detta ancora'; if (state && !state.textContent.startsWith('Consenti')) state.textContent = 'Testo inserito: controllalo, aggiungi foto e firma, poi salva.'; };
    recognition.start();
  };

  window.leadsView = function () {
    const rows = db.leads.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return pageHead('Richieste clienti', 'Sopralluoghi richiesti dal sito con indirizzo e fotografie', `<button class="btn light" onclick="copyRequestLink()">🔗 Copia link modulo</button><button class="btn lime" onclick="openLead()">＋ Inserisci richiesta</button>`) +
      `<div class="grid stats">${stat('Nuove', rows.filter((x) => x.status === 'Nuova').length, '📥')}${stat('Da contattare', rows.filter((x) => ['Nuova', 'Contattato'].includes(x.status)).length, '☎️')}${stat('Sopralluoghi fissati', rows.filter((x) => x.status === 'Sopralluogo fissato').length, '📅')}${stat('Totali', rows.length, '👥')}</div><div class="list">${rows.map((item) => `<section class="card"><div class="row" style="border:0;padding:0"><div class="rowIcon">📥</div><div class="rowBody"><b>${esc(item.name || item.client || 'Nuova richiesta')}</b><small>${esc(item.phone || '')} · ${esc(item.email || '')}<br>${esc(item.address || '')}</small></div>${badge(item.status || 'Nuova')}</div><p>${esc(item.request || item.notes || '')}</p>${photoPreview(item.photos)}<div class="actions" style="margin-top:13px"><button class="btn sm green" onclick="convertLead('${item.id}')">Crea cliente e sopralluogo</button><button class="btn sm light" onclick="openLead('${item.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('leads','${item.id}','questa richiesta')">Elimina</button></div></section>`).join('') || '<div class="empty">Nessuna richiesta. Pubblica il link del modulo sul sito.</div>'}</div>`;
  };

  window.copyRequestLink = async function () {
    const link = new URL('./richiesta.html', location.href).href;
    try { await navigator.clipboard.writeText(link); alert('Link del modulo copiato.'); }
    catch (_) { prompt('Copia il link del modulo:', link); }
  };

  window.openLead = function (id) {
    const item = db.leads.find((entry) => entry.id === id) || { name: '', email: '', phone: '', address: '', request: '', status: 'Nuova', photos: [] };
    modal(id ? 'Modifica richiesta' : 'Nuova richiesta cliente', `<div class="formGrid">${fieldSmart('Nome / condominio', 'name', 'text', item.name, false, 'required')}${fieldSmart('Telefono', 'phone', 'tel', item.phone, false, 'required')}${fieldSmart('Email', 'email', 'email', item.email)}${fieldSmart('Indirizzo del lavoro', 'address', 'text', item.address, true, 'required')}<div class="field full"><label>Richiesta</label><textarea name="request" required>${esc(item.request || '')}</textarea></div><div class="field"><label>Stato</label><select name="status">${smartSelect(['Nuova', 'Contattato', 'Sopralluogo fissato', 'Archiviata'], item.status)}</select></div></div>`, (form) => {
      const data = Object.fromEntries(form); data.updatedAt = new Date().toISOString();
      if (id) Object.assign(item, data); else db.leads.push({ id: uid('lead'), photos: [], createdAt: new Date().toISOString(), ...data });
    });
  };

  window.convertLead = function (id) {
    const item = db.leads.find((entry) => entry.id === id); if (!item) return;
    let client = (db.condomini || []).find((entry) => entry.name.toLowerCase() === String(item.name).toLowerCase());
    if (!client) {
      client = { id: uid('c'), name: item.name, address: item.address, manager: item.name, phone: item.phone, email: item.email, notes: 'Cliente acquisito dal modulo richieste.' };
      db.condomini.push(client);
    }
    if (!(db.inspections || []).some((entry) => entry.leadId === id)) db.inspections.push({ id: uid('s'), leadId: id, date: today(), time: '09:00', type: 'Richiesta sopralluogo', client: client.name, clientId: client.id, address: item.address, problem: item.request, status: 'Da programmare', photos: item.photos || [] });
    item.status = 'Sopralluogo fissato'; item.clientId = client.id; item.updatedAt = new Date().toISOString();
    save(); render(); alert('Cliente e sopralluogo creati. Ora puoi fissare data e ora.');
  };

  window.priceListView = function () {
    const cost = db.priceList.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    const sale = db.priceList.reduce((sum, item) => sum + Number(item.salePrice || 0), 0);
    return pageHead('Listino prezzi', 'Manodopera, materiali, prezzi di vendita e margine', `<button class="btn green" onclick="openAutomaticQuote()">🧮 Crea preventivo dal listino</button><button class="btn lime" onclick="openPriceItem()">＋ Nuova voce</button>`) +
      `<div class="grid stats">${stat('Voci attive', db.priceList.filter((x) => x.status !== 'Disattivo').length, '🧮')}${stat('Manodopera', db.priceList.filter((x) => x.category === 'Manodopera').length, '👷')}${stat('Materiali', db.priceList.filter((x) => x.category === 'Materiali').length, '🧱')}${stat('Ricarico medio', cost ? Math.round((sale - cost) / cost * 100) + '%' : '0%', '↗')}</div><div class="card"><div class="tableWrap"><table class="table"><thead><tr><th>Codice</th><th>Categoria</th><th>Descrizione</th><th>Unità</th><th>Costo</th><th>Vendita</th><th>Margine</th><th></th></tr></thead><tbody>${db.priceList.map((item) => `<tr><td><b>${esc(item.code)}</b></td><td>${esc(item.category)}</td><td>${esc(item.description)}</td><td>${esc(item.unit)}</td><td>${euro(item.cost)}</td><td>${euro(item.salePrice)}</td><td>${Number(item.cost) ? Math.round((Number(item.salePrice) - Number(item.cost)) / Number(item.cost) * 100) : 0}%</td><td><div class="actions"><button class="btn sm light" onclick="openPriceItem('${item.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('priceList','${item.id}','questa voce')">Elimina</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
  };

  window.openPriceItem = function (id) {
    const item = db.priceList.find((entry) => entry.id === id) || { code: '', category: 'Materiali', description: '', unit: 'cad.', cost: 0, salePrice: 0, status: 'Attivo' };
    modal(id ? 'Modifica voce listino' : 'Nuova voce listino', `<div class="formGrid">${fieldSmart('Codice', 'code', 'text', item.code, false, 'required')}<div class="field"><label>Categoria</label><select name="category">${smartSelect(['Manodopera', 'Materiali', 'Noleggi', 'Sicurezza', 'Trasporto', 'Altro'], item.category)}</select></div>${fieldSmart('Descrizione', 'description', 'text', item.description, true, 'required')}${fieldSmart('Unità di misura', 'unit', 'text', item.unit, false, 'required')}${fieldSmart('Costo unitario €', 'cost', 'number', item.cost, false, 'min="0" step="0.01"')}${fieldSmart('Prezzo vendita €', 'salePrice', 'number', item.salePrice, false, 'min="0" step="0.01"')}<div class="field"><label>Stato</label><select name="status">${smartSelect(['Attivo', 'Disattivo'], item.status)}</select></div></div>`, (form) => {
      const data = Object.fromEntries(form); data.cost = Number(data.cost); data.salePrice = Number(data.salePrice); data.updatedAt = new Date().toISOString();
      if (id) Object.assign(item, data); else db.priceList.push({ id: uid('lst'), createdAt: new Date().toISOString(), ...data });
    });
  };

  window.openAutomaticQuote = function () {
    if (!db.condomini.length) return alert('Inserisci prima almeno un cliente.');
    const active = db.priceList.filter((item) => item.status !== 'Disattivo');
    modal('Preventivo automatico dal listino', `<div class="formGrid"><div class="field"><label>Cliente</label><select name="client">${clientOptionsSmart()}</select></div>${fieldSmart('Oggetto', 'subject', 'text', '', false, 'required')}${fieldSmart('Margine minimo %', 'margin', 'number', '25', false, 'min="0" max="300"')}${fieldSmart('IVA %', 'vatRate', 'number', '22', false, 'min="0" max="100"')}<div class="field full"><label>Quantità da inserire</label><div class="tableWrap"><table class="table"><thead><tr><th>Voce</th><th>Tipo</th><th>Costo</th><th>Prezzo listino</th><th>Quantità</th></tr></thead><tbody>${active.map((item) => `<tr><td><b>${esc(item.description)}</b><br><small>${esc(item.code)} · ${esc(item.unit)}</small></td><td>${esc(item.category)}</td><td>${euro(item.cost)}</td><td>${euro(item.salePrice)}</td><td><input class="smartTableInput" name="qty_${item.id}" type="number" min="0" step="0.01" value="0"></td></tr>`).join('')}</tbody></table></div></div><div class="field full pdfHint">Il prezzo applicato usa il maggiore tra prezzo di listino e costo + margine. IVA e totali vengono calcolati automaticamente.</div></div>`, (form) => {
      const margin = Number(form.get('margin') || 0), vatRate = Number(form.get('vatRate') || 0);
      const lines = active.map((item) => {
        const quantity = Number(form.get(`qty_${item.id}`) || 0);
        const unitPrice = Math.max(Number(item.salePrice || 0), Number(item.cost || 0) * (1 + margin / 100));
        return { priceListId: item.id, category: item.category, description: item.description, quantity, unit: item.unit, unitCost: Number(item.cost || 0), unitPrice };
      }).filter((line) => line.quantity > 0);
      if (!lines.length) throw new Error('Inserisci la quantità di almeno una voce.');
      const costTotal = lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
      const net = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
      const client = form.get('client'), clientEntry = clientByName(client);
      db.quotes.push({ id: uid('p'), code: `PREV-${new Date().getFullYear()}-${String(db.quotes.length + 1).padStart(3, '0')}`, client, clientId: clientEntry?.id || '', subject: form.get('subject'), date: today(), status: 'Bozza', validityDays: 30, paymentTerms: '30% all’accettazione, saldo a fine lavori', lines, subtotal: net, discount: 0, vatRate, net, vat: net * vatRate / 100, gross: net * (1 + vatRate / 100), costTotal, marginAmount: net - costTotal, marginPercent: costTotal ? (net - costTotal) / costTotal * 100 : 0, createdAt: new Date().toISOString(), revisions: [] });
      setTimeout(() => go('quotes'), 30);
    });
  };

  printQuote = async function (id) {
    const item = db.quotes.find((entry) => entry.id === id); if (!item) return;
    if (!window.jspdf?.jsPDF) return alert('Il generatore PDF non è disponibile. Ricarica la pagina e riprova.');
    const popup = window.open('', '_blank');
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    await pdfHeader(doc, 'PREVENTIVO', item.code);
    const client = clientByName(item.client) || {};
    doc.setTextColor(17, 17, 17); doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.text('Cliente', 14, 45);
    doc.setFont(undefined, 'normal'); doc.text([item.client || '—', client.address || '', `Data: ${smartDate(item.date)}`].filter(Boolean), 14, 51);
    doc.setFont(undefined, 'bold'); doc.text(item.subject || '', 14, 68); doc.setFont(undefined, 'normal');
    const lines = item.lines?.length ? item.lines : [{ description: item.subject, quantity: 1, unit: 'a corpo', unitPrice: item.net }];
    doc.autoTable({ startY: 74, head: [['Descrizione', 'Q.tà', 'Unità', 'Prezzo', 'Totale']], body: lines.map((line) => [line.description, Number(line.quantity).toLocaleString('it-IT'), line.unit, euro(line.unitPrice), euro(Number(line.quantity) * Number(line.unitPrice))]), theme: 'grid', headStyles: { fillColor: [17, 17, 17], textColor: [244, 196, 0] }, styles: { fontSize: 8 }, columnStyles: { 0: { cellWidth: 86 }, 1: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } } });
    let y = doc.lastAutoTable.finalY + 8; doc.setFontSize(10);
    [['Imponibile', item.net], [`IVA ${Number(item.vatRate || 0)}%`, item.vat], ['Totale', item.gross ?? item.net]].forEach(([label, value], index) => { if (index === 2) doc.setFont(undefined, 'bold'); doc.text(label, 150, y, { align: 'right' }); doc.text(euro(value), 196, y, { align: 'right' }); y += 6; });
    doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.text(`Validità: ${item.validityDays || 30} giorni`, 14, y + 8); doc.text(`Pagamento: ${item.paymentTerms || 'da concordare'}`, 14, y + 14, { maxWidth: 180 });
    if (item.notes) doc.text(item.notes, 14, y + 22, { maxWidth: 180 });
    await pdfHeader(doc, 'PREVENTIVO', item.code);
    const blob = doc.output('blob'); const key = item.pdfKey || `quote-${item.id}`; await storePdf(key, blob); item.pdfKey = key; item.fileName = `${item.code}.pdf`; save(); render();
    const url = URL.createObjectURL(blob);
    if (popup) popup.location.href = url; else { const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  let certificateSignature = null;
  function createSignatureCanvas() {
    const canvas = document.getElementById('certificateSignature'); if (!canvas) return null;
    const ratio = Math.max(1, window.devicePixelRatio || 1), width = Math.max(280, canvas.clientWidth); canvas.width = width * ratio; canvas.height = 175 * ratio;
    const context = canvas.getContext('2d'); context.scale(ratio, ratio); context.lineWidth = 2.3; context.lineCap = 'round'; context.strokeStyle = '#111'; let drawing = false, changed = false;
    const point = (event) => { const rect = canvas.getBoundingClientRect(), source = event.touches?.[0] || event; return [source.clientX - rect.left, source.clientY - rect.top]; };
    canvas.addEventListener('pointerdown', (event) => { event.preventDefault(); drawing = true; changed = true; context.beginPath(); context.moveTo(...point(event)); });
    canvas.addEventListener('pointermove', (event) => { if (!drawing) return; event.preventDefault(); context.lineTo(...point(event)); context.stroke(); });
    ['pointerup', 'pointerleave'].forEach((name) => canvas.addEventListener(name, () => { drawing = false; }));
    return { changed: () => changed, data: () => canvas.toDataURL('image/png'), clear: () => { context.clearRect(0, 0, width, 175); changed = false; } };
  }
  window.clearCertificateSignature = () => certificateSignature?.clear();

  window.certificatesView = function () {
    const rows = db.certificates.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return pageHead('Verbali e certificazioni', 'PDF automatici da sopralluoghi, fotografie e firme', '<button class="btn lime" onclick="openCertificate()">＋ Nuovo documento</button>') +
      `<div class="grid stats">${stat('Documenti', rows.length, '🛡️')}${stat('Con firma', rows.filter((x) => x.signature).length, '✍️')}${stat('Con fotografie', rows.filter((x) => x.photos?.length).length, '📷')}${stat('Verifiche future', rows.filter((x) => x.nextCheck && x.nextCheck >= today()).length, '📅')}</div><div class="list">${rows.map((item) => `<section class="card"><div class="row" style="border:0;padding:0"><div class="rowIcon">🛡️</div><div class="rowBody"><b>${esc(item.code)} · ${esc(item.type)}</b><small>${esc(item.client)} · ${esc(item.address)}<br>${smartDate(item.date)} · esito ${esc(item.outcome)}</small></div>${badge(item.outcome)}</div><p>${esc(item.notes || '')}</p>${photoPreview(item.photos)}<div class="actions" style="margin-top:13px"><button class="btn sm green" onclick="printCertificate('${item.id}')">Genera / apri PDF</button><button class="btn sm light" onclick="openCertificate('${item.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('certificates','${item.id}','questo documento')">Elimina</button></div></section>`).join('') || '<div class="empty">Nessun verbale o certificazione.</div>'}</div>`;
  };

  window.openCertificate = function (id) {
    const item = db.certificates.find((entry) => entry.id === id) || { code: `VERB-${new Date().getFullYear()}-${String(db.certificates.length + 1).padStart(3, '0')}`, type: 'Verbale di sopralluogo', client: db.condomini[0]?.name || '', address: db.condomini[0]?.address || '', date: today(), outcome: 'Positivo', technician: '', notes: '', nextCheck: '', photos: [] };
    modal(id ? 'Modifica verbale / certificazione' : 'Nuovo verbale / certificazione', `<div class="formGrid">${fieldSmart('Numero', 'code', 'text', item.code, false, 'required')}<div class="field"><label>Tipo documento</label><select name="type">${smartSelect(['Verbale di sopralluogo', 'Verbale di fine lavori', 'Certificazione intervento', 'Verifica linea vita', 'Consegna DPI'], item.type)}</select></div><div class="field"><label>Cliente</label><select name="client" onchange="const c=(db.condomini||[]).find(x=>x.name===this.value);if(c)this.form.address.value=c.address">${clientOptionsSmart(item.client)}</select></div>${fieldSmart('Indirizzo', 'address', 'text', item.address, false, 'required')}${fieldSmart('Data', 'date', 'date', item.date, false, 'required')}<div class="field"><label>Esito</label><select name="outcome">${smartSelect(['Positivo', 'Con prescrizioni', 'Negativo', 'Da completare'], item.outcome)}</select></div>${fieldSmart('Tecnico / operatore', 'technician', 'text', item.technician, false, 'required')}${fieldSmart('Prossimo controllo', 'nextCheck', 'date', item.nextCheck)}<div class="field full"><label>Descrizione, verifiche e prescrizioni</label><textarea name="notes" required>${esc(item.notes || '')}</textarea></div><div class="field full"><label>Fotografie (massimo 4)</label><input name="photos" type="file" accept="image/*" capture="environment" multiple>${photoPreview(item.photos)}</div>${fieldSmart('Nome di chi firma', 'signedBy', 'text', item.signedBy || '', true)}<div class="field full"><label>Firma</label><canvas id="certificateSignature" class="signatureBox"></canvas><button type="button" class="btn sm light" onclick="clearCertificateSignature()">Cancella firma</button><small>${item.signature ? 'È già presente una firma. Disegnane una nuova solo per sostituirla.' : 'Facoltativa per le bozze.'}</small></div></div>`, async (form) => {
      const files = Array.from(form.getAll('photos')).filter((file) => file?.size); if (files.length > 4) throw new Error('Puoi allegare al massimo 4 fotografie.');
      const photos = files.length ? await Promise.all(files.map((file) => compressToDataUrl(file, 130000))) : (item.photos || []);
      const data = Object.fromEntries(Array.from(form.entries()).filter(([key]) => key !== 'photos')); data.photos = photos; data.clientId = clientByName(data.client)?.id || ''; data.updatedAt = new Date().toISOString();
      if (certificateSignature?.changed()) { data.signature = certificateSignature.data(); data.signedAt = new Date().toISOString(); } else data.signature = item.signature || '';
      if (id) Object.assign(item, data); else db.certificates.push({ id: uid('cert'), createdAt: new Date().toISOString(), ...data });
    });
    setTimeout(() => { certificateSignature = createSignatureCanvas(); }, 30);
  };

  window.printCertificate = async function (id) {
    const item = db.certificates.find((entry) => entry.id === id); if (!item) return;
    if (!window.jspdf?.jsPDF) return alert('Il generatore PDF non è disponibile. Ricarica la pagina.');
    const popup = window.open('', '_blank');
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' }); await pdfHeader(doc, item.type.toUpperCase(), item.code);
    doc.autoTable({ startY: 42, body: [['Cliente', item.client], ['Indirizzo', item.address], ['Data', smartDate(item.date)], ['Tecnico', item.technician], ['Esito', item.outcome], ['Prossimo controllo', smartDate(item.nextCheck)]], theme: 'grid', styles: { fontSize: 9 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 } } });
    let y = doc.lastAutoTable.finalY + 9; doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.text('Descrizione e verifiche', 14, y); doc.setFont(undefined, 'normal'); const noteLines = doc.splitTextToSize(item.notes || '—', 180); doc.text(noteLines, 14, y + 6); y += 10 + noteLines.length * 4;
    for (const photo of (item.photos || []).slice(0, 4)) { if (y > 225) { doc.addPage(); await pdfHeader(doc, item.type.toUpperCase(), item.code); y = 42; } try { doc.addImage(photo, 'JPEG', 14 + ((item.photos.indexOf(photo) % 2) * 91), y, 86, 58, undefined, 'FAST'); if (item.photos.indexOf(photo) % 2 === 1) y += 64; } catch (_) {} }
    if ((item.photos || []).length % 2 === 1) y += 64;
    if (item.signature) { if (y > 235) { doc.addPage(); await pdfHeader(doc, item.type.toUpperCase(), item.code); y = 48; } doc.setFont(undefined, 'bold'); doc.text(`Firma: ${item.signedBy || ''}`, 14, y); try { doc.addImage(item.signature, 'PNG', 14, y + 4, 75, 28); } catch (_) {} }
    const blob = doc.output('blob'), key = item.pdfKey || `certificate-${item.id}`; await storePdf(key, blob); item.pdfKey = key; item.fileName = `${item.code}.pdf`; save(); render(); const url = URL.createObjectURL(blob);
    if (popup) popup.location.href = url; else { const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  function equipmentState(item) {
    if (!item.expiry) return item.status || 'Disponibile';
    const days = Math.ceil((new Date(item.expiry + 'T23:59:59') - new Date()) / 86400000);
    if (days < 0) return 'Scaduta'; if (days <= 30) return 'In scadenza'; return item.status || 'Disponibile';
  }
  function syncEquipmentDeadline(item) {
    if (!item.expiry) return;
    db.deadlines = db.deadlines || [];
    const id = `equipment-${item.id}`, current = db.deadlines.find((entry) => entry.id === id);
    const data = { id, category: 'Sicurezza', title: `${item.type}: ${item.name}`, client: '', date: item.expiry, done: false, equipmentId: item.id };
    if (current) Object.assign(current, data); else db.deadlines.push(data);
  }

  window.warehouseView = function () {
    const low = db.inventory.filter((item) => Number(item.quantity || 0) <= Number(item.minimum || 0));
    const expiring = db.equipment.filter((item) => ['In scadenza', 'Scaduta'].includes(equipmentState(item)));
    return pageHead('Magazzino e attrezzature', 'Materiali disponibili, utensili assegnati e DPI in scadenza', `<button class="btn light" onclick="openEquipment()">＋ Attrezzatura / DPI</button><button class="btn lime" onclick="openStockItem()">＋ Materiale</button>`) +
      `<div class="grid stats">${stat('Articoli', db.inventory.length, '📦')}${stat('Sotto scorta', low.length, '⚠️')}${stat('Attrezzature e DPI', db.equipment.length, '🧰')}${stat('In scadenza', expiring.length, '🛡️')}</div><div class="grid cols"><section><div class="cardHead"><h3>Materiali in magazzino</h3></div><div class="list">${db.inventory.map((item) => `<div class="card ${Number(item.quantity) <= Number(item.minimum) ? 'stockLow' : 'stockOk'}"><div class="row" style="border:0;padding:0"><div class="rowIcon">📦</div><div class="rowBody"><b>${esc(item.code)} · ${esc(item.name)}</b><small>${esc(item.category)} · ${esc(item.location || 'magazzino')}<br>Disponibili <b>${Number(item.quantity)} ${esc(item.unit)}</b> · minimo ${Number(item.minimum)}</small></div>${badge(Number(item.quantity) <= Number(item.minimum) ? 'Da riordinare' : 'Disponibile')}</div><div class="actions" style="margin-top:12px"><button class="btn sm light" onclick="adjustStock('${item.id}',-1)">− 1</button><button class="btn sm green" onclick="adjustStock('${item.id}',1)">＋ 1</button><button class="btn sm light" onclick="openStockItem('${item.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('inventory','${item.id}','questo materiale')">Elimina</button></div></div>`).join('') || '<div class="empty">Nessun materiale registrato.</div>'}</div></section><section><div class="cardHead"><h3>Utensili e DPI</h3></div><div class="list">${db.equipment.map((item) => `<div class="card ${['In scadenza', 'Scaduta'].includes(equipmentState(item)) ? 'stockLow' : ''}"><div class="row" style="border:0;padding:0"><div class="rowIcon">${item.type === 'DPI' ? '🛡️' : '🧰'}</div><div class="rowBody"><b>${esc(item.name)}</b><small>${esc(item.serial || 'Senza matricola')} · ${esc(item.assignedTo || 'Non assegnato')}<br>${item.expiry ? `Scadenza ${smartDate(item.expiry)}` : 'Nessuna scadenza'}</small></div>${badge(equipmentState(item))}</div><div class="actions" style="margin-top:12px"><button class="btn sm light" onclick="openEquipment('${item.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('equipment','${item.id}','questa attrezzatura')">Elimina</button></div></div>`).join('') || '<div class="empty">Nessuna attrezzatura o DPI.</div>'}</div></section></div>`;
  };

  window.openStockItem = function (id) {
    const item = db.inventory.find((entry) => entry.id === id) || { code: '', name: '', category: 'Materiali', unit: 'pz', quantity: 0, minimum: 0, cost: 0, location: 'Magazzino' };
    modal(id ? 'Modifica materiale' : 'Nuovo materiale', `<div class="formGrid">${fieldSmart('Codice', 'code', 'text', item.code, false, 'required')}${fieldSmart('Nome materiale', 'name', 'text', item.name, false, 'required')}<div class="field"><label>Categoria</label><select name="category">${smartSelect(['Materiali', 'Consumabili', 'Ferramenta', 'Sicurezza', 'Altro'], item.category)}</select></div>${fieldSmart('Unità', 'unit', 'text', item.unit, false, 'required')}${fieldSmart('Quantità disponibile', 'quantity', 'number', item.quantity, false, 'min="0" step="0.01"')}${fieldSmart('Scorta minima', 'minimum', 'number', item.minimum, false, 'min="0" step="0.01"')}${fieldSmart('Costo unitario €', 'cost', 'number', item.cost, false, 'min="0" step="0.01"')}${fieldSmart('Posizione', 'location', 'text', item.location)}</div>`, (form) => { const data = Object.fromEntries(form); ['quantity', 'minimum', 'cost'].forEach((key) => { data[key] = Number(data[key] || 0); }); data.status = data.quantity <= data.minimum ? 'Da riordinare' : 'Disponibile'; data.updatedAt = new Date().toISOString(); if (id) Object.assign(item, data); else db.inventory.push({ id: uid('stock'), createdAt: new Date().toISOString(), ...data }); });
  };
  window.adjustStock = function (id, amount) { const item = db.inventory.find((entry) => entry.id === id); if (!item) return; item.quantity = Math.max(0, Number(item.quantity || 0) + amount); item.status = item.quantity <= Number(item.minimum || 0) ? 'Da riordinare' : 'Disponibile'; item.updatedAt = new Date().toISOString(); save(); render(); };

  window.openEquipment = function (id) {
    const item = db.equipment.find((entry) => entry.id === id) || { type: 'Attrezzatura', name: '', serial: '', assignedTo: '', expiry: '', nextCheck: '', status: 'Disponibile', notes: '' };
    modal(id ? 'Modifica attrezzatura / DPI' : 'Nuova attrezzatura / DPI', `<div class="formGrid"><div class="field"><label>Tipo</label><select name="type">${smartSelect(['Attrezzatura', 'Utensile', 'DPI', 'Veicolo'], item.type)}</select></div>${fieldSmart('Nome', 'name', 'text', item.name, false, 'required')}${fieldSmart('Matricola / seriale', 'serial', 'text', item.serial)}${fieldSmart('Assegnato a', 'assignedTo', 'text', item.assignedTo)}${fieldSmart('Scadenza', 'expiry', 'date', item.expiry)}${fieldSmart('Prossima verifica', 'nextCheck', 'date', item.nextCheck)}<div class="field"><label>Stato</label><select name="status">${smartSelect(['Disponibile', 'Assegnato', 'In manutenzione', 'Da sostituire'], item.status)}</select></div><div class="field full"><label>Note</label><textarea name="notes">${esc(item.notes || '')}</textarea></div></div>`, (form) => { const data = Object.fromEntries(form); data.updatedAt = new Date().toISOString(); if (id) Object.assign(item, data); else { Object.assign(data, { id: uid('eq'), createdAt: new Date().toISOString() }); db.equipment.push(data); } syncEquipmentDeadline(id ? item : data); });
  };

  const previousPortalPreview = window.portalPreview;
  window.portalPreview = function () {
    const user = window.__portalPreview; if (!user) return previousPortalPreview?.() || '<div class="empty">Seleziona un cliente o amministratore.</div>';
    const allowed = new Set(user.clients || []), sites = db.sites.filter((x) => allowed.has(x.client)), reports = db.reports.filter((x) => allowed.has(x.client) || allowed.has(db.sites.find((s) => s.id === x.site)?.client));
    const quotesRows = db.quotes.filter((x) => allowed.has(x.client)), certificates = db.certificates.filter((x) => allowed.has(x.client)), documents = (db.documents || []).filter((x) => allowed.has(x.client)), lifelines = (db.lifelines || []).filter((x) => allowed.has(x.client));
    const photos = reports.flatMap((report) => (report.photos || []).filter((photo) => photo.url || photo.dataUrl).map((photo) => photo.url || photo.dataUrl)).concat(certificates.flatMap((item) => item.photos || [])).slice(0, 12);
    return `<div class="portalHero"><button class="btn light sm" onclick="go('portalView')">← Torna agli accessi</button><h2>Portale di ${esc(user.name)}</h2><p>Preventivi, stato lavori, fotografie e documenti di ${Array.from(allowed).map(esc).join(', ')}</p></div><div class="grid stats">${stat('Cantieri', sites.length, '🏗️')}${stat('Preventivi', quotesRows.length, '📄')}${stat('Documenti', documents.length + certificates.length, '📁')}${stat('Fotografie', photos.length, '📷')}</div><div class="grid cols"><section class="card"><div class="cardHead"><h3>Stato dei lavori</h3></div><div class="list">${sites.map((item) => `<div class="row"><div class="rowIcon">🏗️</div><div class="rowBody"><b>${esc(item.title)}</b><small>${esc(item.status)} · avanzamento ${Number(item.progress || 0)}%</small></div></div>`).join('') || '<div class="empty">Nessun lavoro.</div>'}</div></section><section class="card"><div class="cardHead"><h3>Preventivi</h3></div><div class="list">${quotesRows.map((item) => `<div class="row"><div class="rowIcon">📄</div><div class="rowBody"><b>${esc(item.code)}</b><small>${esc(item.subject)} · ${euro(item.gross ?? item.net)}</small></div>${badge(item.status)}</div>`).join('') || '<div class="empty">Nessun preventivo.</div>'}</div></section><section class="card"><div class="cardHead"><h3>Verbali e certificazioni</h3></div><div class="list">${certificates.map((item) => `<div class="row"><div class="rowIcon">🛡️</div><div class="rowBody"><b>${esc(item.code)} · ${esc(item.type)}</b><small>${smartDate(item.date)} · ${esc(item.outcome)}</small></div><button class="btn sm light" onclick="printCertificate('${item.id}')">PDF</button></div>`).join('') || '<div class="empty">Nessun documento.</div>'}</div></section><section class="card"><div class="cardHead"><h3>Linea Vita e documenti</h3></div><div class="list">${lifelines.map((item) => `<div class="row"><div class="rowIcon">⚓</div><div class="rowBody"><b>${esc(item.name)}</b><small>Prossima verifica ${smartDate(item.nextCheck)}</small></div></div>`).join('')}${documents.map((item) => `<div class="row"><div class="rowIcon">📁</div><div class="rowBody"><b>${esc(item.title)}</b><small>${esc(item.category)}</small></div><button class="btn sm light" onclick="openBusinessDocument('${item.id}')">Apri</button></div>`).join('') || (!lifelines.length ? '<div class="empty">Nessun documento.</div>' : '')}</div></section><section class="card" style="grid-column:1/-1"><div class="cardHead"><h3>Fotografie dei lavori</h3></div>${photos.length ? `<div class="portalGallery">${photos.map((url) => `<img src="${url}" alt="Foto del lavoro">`).join('')}</div>` : '<div class="empty">Nessuna fotografia disponibile.</div>'}</section></div>`;
  };

  const baseRender = render;
  render = function () {
    const pages = { leadsView: window.leadsView, priceListView: window.priceListView, certificatesView: window.certificatesView, warehouseView: window.warehouseView };
    if (pages[view]) {
      if (!isOffice()) view = 'worker'; else {
        renderNav(); document.getElementById('avatar').textContent = roleName().charAt(0);
        const titles = { leadsView: 'Richieste clienti', priceListView: 'Listino prezzi', certificatesView: 'Verbali e certificazioni', warehouseView: 'Magazzino e DPI' };
        document.getElementById('pageTitle').textContent = titles[view]; document.getElementById('app').innerHTML = pages[view](); return;
      }
    }
    baseRender();
  };

  save(); initRoles(); render();
})();
