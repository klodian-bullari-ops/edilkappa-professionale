(function () {
  'use strict';

  const VERIFIED_STATUSES = new Set(['Approvato', 'Accettato', 'Completato', 'Fatturato']);
  const MAX_REVISIONS = 80;

  const style = document.createElement('style');
  style.textContent = `
    .learningHero{background:linear-gradient(135deg,#102c22,#245843);color:#fff;border-radius:22px;padding:22px;margin-bottom:18px;border-bottom:6px solid var(--lime)}
    .learningHero h2{margin:0 0 7px}.learningHero p{margin:0;color:#d9ece2;max-width:850px}.learningHero .actions{margin-top:15px}
    .learningStatus{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:850;background:#fff2c7;color:#775a00}.learningStatus.verified{background:#e2f4e8;color:#176542}.learningStatus.review{background:#ffe7e4;color:#8c3129}
    .learningDelta{font-variant-numeric:tabular-nums;font-weight:850}.learningPositive{color:#176542}.learningNegative{color:#a0372e}
    .learningKnowledge{border-left:5px solid var(--lime)}.learningKnowledge small{display:block;color:var(--muted);margin-top:4px}
    .learningTimeline{display:grid;gap:8px}.learningEvent{border:1px solid var(--line);border-radius:12px;padding:10px;background:#fafbf9}.learningEvent b,.learningEvent small{display:block}.learningEvent small{color:var(--muted);margin-top:4px}
    @media(max-width:620px){.learningHero{padding:18px}.learningHero .btn{width:100%}}
  `;
  document.head.appendChild(style);

  function now() { return new Date().toISOString(); }
  function currentActor() { return typeof roleName === 'function' ? roleName() : 'Titolare'; }
  function quoteById(id) { return (db.quotes || []).find((item) => String(item.id) === String(id)); }
  function isVerified(item) {
    const explicit = String(item.learningStatus || '');
    if (['Da controllare', 'Da riconfermare'].includes(explicit)) return false;
    return explicit.startsWith('Verificato') || VERIFIED_STATUSES.has(item.status);
  }
  function learningStatus(item) {
    const explicit = String(item.learningStatus || '');
    if (explicit) return explicit;
    if (VERIFIED_STATUSES.has(item.status)) return 'Verificato dallo stato';
    return 'Da controllare';
  }
  function statusClass(item) {
    const value = learningStatus(item);
    return value.startsWith('Verificato') ? 'verified' : value === 'Da riconfermare' ? 'review' : '';
  }
  function ownerLearningButtons(item) {
    if (role !== 'owner') return '';
    return `<button class="btn sm green" onclick="openLearningActuals('${esc(item.id)}')">Consuntivo</button>${isVerified(item) ? `<button class="btn sm red" onclick="learningRevokeQuote('${esc(item.id)}')">Non usare</button>` : `<button class="btn sm lime" onclick="learningVerifyQuote('${esc(item.id)}')">Verifica e insegna</button>`}`;
  }
  function snapshot(item) {
    return {
      subject: String(item?.subject || ''),
      net: Number(item?.net || 0),
      status: String(item?.status || ''),
      lines: (item?.lines || []).map((line) => ({
        description: String(line.description || ''), quantity: Number(line.quantity || 0),
        unit: String(line.unit || ''), unitCost: Number(line.unitCost || 0), unitPrice: Number(line.unitPrice || 0)
      }))
    };
  }
  function numericChanged(left, right) { return Math.abs(Number(left || 0) - Number(right || 0)) > 0.005; }
  function revisionSummary(before, after, created = false) {
    if (created) return `Preventivo creato: ${after.subject || 'senza oggetto'} · netto ${euro(after.net)} · stato ${after.status || 'Bozza'}.`;
    const changes = [];
    if (before.subject !== after.subject) changes.push(`oggetto modificato da “${before.subject || 'vuoto'}” a “${after.subject || 'vuoto'}”`);
    if (numericChanged(before.net, after.net)) changes.push(`netto corretto da ${euro(before.net)} a ${euro(after.net)}`);
    if (before.status !== after.status) changes.push(`stato cambiato da ${before.status || 'non definito'} a ${after.status || 'non definito'}`);
    const beforeLines = JSON.stringify(before.lines || []), afterLines = JSON.stringify(after.lines || []);
    if (beforeLines !== afterLines) changes.push('voci, quantità o prezzi unitari modificati');
    return changes.length ? `Correzione del titolare: ${changes.join('; ')}.` : '';
  }
  function appendRevision(item, revision) {
    item.revisions = Array.isArray(item.revisions) ? item.revisions : [];
    item.revisions.push({ date: now(), actor: currentActor(), ...revision });
    if (item.revisions.length > MAX_REVISIONS) item.revisions = item.revisions.slice(-MAX_REVISIONS);
    item.updatedAt = now();
  }
  function persistAndRender() {
    save();
    if (typeof initRoles === 'function') initRoles();
    render();
  }
  function recordQuoteChange(item, before, created = false) {
    if (!item) return false;
    const after = snapshot(item);
    const action = revisionSummary(before || { subject: '', net: 0, status: '', lines: [] }, after, created);
    if (!action) return false;
    const materialChange = !created && (numericChanged(before.net, after.net) || JSON.stringify(before.lines) !== JSON.stringify(after.lines));
    const protectedExample = !created && (String(item.learningStatus || '').startsWith('Verificato') || VERIFIED_STATUSES.has(before?.status));
    const trustedOwnerCorrection = materialChange && protectedExample && role === 'owner';
    appendRevision(item, { type: created ? 'creation' : 'correction', action, before, after, verified: trustedOwnerCorrection });
    if (materialChange && protectedExample) {
      if (trustedOwnerCorrection) {
        item.learningStatus = item.actuals?.total > 0 ? 'Verificato con consuntivo' : 'Verificato dal titolare';
        item.learningVerifiedAt = now();
        item.learningVerifiedBy = currentActor();
      } else {
        item.learningStatus = 'Da riconfermare';
        item.learningVerifiedAt = '';
        item.learningVerifiedBy = '';
      }
    } else if (!item.learningStatus) item.learningStatus = 'Da controllare';
    return true;
  }

  function lineKnowledge() {
    const groups = new Map();
    (db.quotes || []).filter(isVerified).forEach((quote) => (quote.lines || []).forEach((line) => {
      const price = Number(line.unitPrice || 0), quantity = Number(line.quantity || 0);
      if (!line.description || price <= 0) return;
      const normalized = String(line.description).toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const key = `${normalized}|${String(line.unit || 'a corpo').toLocaleLowerCase('it')}`;
      const current = groups.get(key) || { description: line.description, unit: line.unit || 'a corpo', prices: [], quantities: [], quotes: new Set() };
      current.prices.push(price); current.quantities.push(quantity); current.quotes.add(quote.code || quote.id); groups.set(key, current);
    }));
    return [...groups.values()].map((item) => {
      const sorted = item.prices.slice().sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      return { ...item, median, min: sorted[0], max: sorted.at(-1), samples: sorted.length };
    }).sort((left, right) => right.samples - left.samples || left.description.localeCompare(right.description, 'it'));
  }

  function linkedSites(quote) {
    const direct = (db.sites || []).filter((site) => quote.interventionId && String(site.interventionId || '') === String(quote.interventionId));
    if (direct.length) return direct;
    return (db.sites || []).filter((site) => site.clientId && quote.clientId && String(site.clientId) === String(quote.clientId));
  }
  function actualDefaults(quote, selectedSiteId = '') {
    const sites = linkedSites(quote);
    const selected = sites.find((site) => String(site.id) === String(selectedSiteId)) || sites[0];
    const rows = (db.timesheets || []).filter((entry) =>
      (selected && String(entry.siteId || '') === String(selected.id)) ||
      (quote.interventionId && String(entry.interventionId || '') === String(quote.interventionId))
    );
    const hours = rows.reduce((sum, entry) => sum + Number(entry.hours || 0) + Number(entry.hours1 || 0) + Number(entry.hours2 || 0), 0);
    const reports = (db.reports || []).filter((report) => selected && [report.siteId, report.site].map(String).includes(String(selected.id)));
    const materials = reports.reduce((sum, report) => sum + Number(report.material || 0), 0);
    const laborCosts = (db.priceList || []).filter((item) => item.category === 'Manodopera' && Number(item.cost || 0) > 0).map((item) => Number(item.cost));
    const hourlyCost = laborCosts.length ? laborCosts.reduce((sum, value) => sum + value, 0) / laborCosts.length : 0;
    return { sites, selected, hours, materials, hourlyCost };
  }

  window.learningVerifyQuote = function (id) {
    if (role !== 'owner') return alert('Solo il titolare può rendere un preventivo un esempio verificato.');
    const item = quoteById(id);
    if (!item || Number(item.net || 0) <= 0) return alert('Inserisci prima un importo valido nel preventivo.');
    if (!confirm(`Confermi che “${item.code || item.subject}” è corretto e può essere usato da EdilKappa AI come esempio aziendale?`)) return;
    const previousStatus = item.status || 'Bozza';
    if (!VERIFIED_STATUSES.has(item.status)) item.status = 'Approvato';
    item.learningPreviousStatus = previousStatus;
    item.learningStatus = item.actuals?.total > 0 ? 'Verificato con consuntivo' : 'Verificato dal titolare';
    item.learningVerifiedAt = now();
    item.learningVerifiedBy = currentActor();
    appendRevision(item, { type: 'validation', verified: true, action: `Preventivo verificato dal titolare per la memoria EdilKappa AI · netto ${euro(item.net)} · stato ${item.status}.` });
    persistAndRender();
  };

  window.learningRevokeQuote = function (id) {
    if (role !== 'owner') return alert('Solo il titolare può modificare la memoria verificata.');
    const item = quoteById(id);
    if (!item || !confirm('Rimuovere questo preventivo dagli esempi verificati? Il documento non verrà eliminato.')) return;
    if (item.status === 'Approvato' && item.learningPreviousStatus) item.status = item.learningPreviousStatus;
    item.learningStatus = 'Da controllare';
    item.learningVerifiedAt = '';
    item.learningVerifiedBy = '';
    appendRevision(item, { type: 'validation_revoked', verified: false, action: 'Preventivo rimosso dagli esempi verificati; documento conservato nel gestionale.' });
    persistAndRender();
  };

  window.openLearningActuals = function (id) {
    if (role !== 'owner') return alert('Solo il titolare può registrare i costi consuntivi.');
    const item = quoteById(id);
    if (!item) return alert('Preventivo non trovato.');
    const defaults = actualDefaults(item, item.actuals?.siteId);
    const actuals = item.actuals || {};
    const siteOptions = defaults.sites.map((site) => `<option value="${esc(site.id)}" ${String(actuals.siteId || defaults.selected?.id || '') === String(site.id) ? 'selected' : ''}>${esc(site.title)} · ${esc(site.client || '')}</option>`).join('');
    modal('Registra consuntivo reale', `<div class="notice"><b>${esc(item.code || 'Preventivo')} · ${esc(item.subject || '')}</b><br>Il consuntivo non modifica il PDF del cliente: serve a calcolare il guadagno reale e migliorare i preventivi futuri.</div><div style="height:14px"></div><div class="formGrid">
      <div class="field full"><label>Cantiere collegato</label><select name="siteId"><option value="">Nessun cantiere collegato</option>${siteOptions}</select></div>
      <div class="field"><label>Ore effettive complessive</label><input name="hours" type="number" min="0" step="0.5" value="${esc(actuals.hours ?? defaults.hours)}"></div>
      <div class="field"><label>Costo interno per ora €</label><input name="hourlyCost" type="number" min="0" step="0.01" value="${esc(actuals.hourlyCost ?? defaults.hourlyCost)}"></div>
      <div class="field"><label>Materiali €</label><input name="materials" type="number" min="0" step="0.01" value="${esc(actuals.materials ?? defaults.materials)}"></div>
      <div class="field"><label>Mezzi, piattaforme e noleggi €</label><input name="equipment" type="number" min="0" step="0.01" value="${esc(actuals.equipment ?? 0)}"></div>
      <div class="field"><label>Smaltimento €</label><input name="disposal" type="number" min="0" step="0.01" value="${esc(actuals.disposal ?? 0)}"></div>
      <div class="field"><label>Altri costi €</label><input name="other" type="number" min="0" step="0.01" value="${esc(actuals.other ?? 0)}"></div>
      <div class="field full"><label>Note consuntive</label><textarea name="notes" placeholder="Imprevisti, lavorazioni aggiuntive, motivi degli scostamenti…">${esc(actuals.notes || '')}</textarea></div>
    </div>`, (form) => {
      const hours = Number(form.get('hours') || 0), hourlyCost = Number(form.get('hourlyCost') || 0);
      const materials = Number(form.get('materials') || 0), equipment = Number(form.get('equipment') || 0);
      const disposal = Number(form.get('disposal') || 0), other = Number(form.get('other') || 0);
      const labor = hours * hourlyCost, total = labor + materials + equipment + disposal + other;
      const net = Number(item.net || 0), margin = net - total;
      item.actuals = { siteId: String(form.get('siteId') || ''), hours, hourlyCost, labor, materials, equipment, disposal, other, total, margin, marginPercent: net ? margin / net * 100 : 0, notes: String(form.get('notes') || ''), updatedAt: now(), updatedBy: currentActor() };
      item.learningStatus = 'Verificato con consuntivo';
      item.learningVerifiedAt = now(); item.learningVerifiedBy = currentActor();
      if (!VERIFIED_STATUSES.has(item.status)) { item.learningPreviousStatus = item.status || 'Bozza'; item.status = 'Approvato'; }
      appendRevision(item, { type: 'actuals', verified: true, action: `Consuntivo verificato: ${hours.toFixed(1)} ore × ${euro(hourlyCost)}, materiali ${euro(materials)}, mezzi ${euro(equipment)}, smaltimento ${euro(disposal)}, altri costi ${euro(other)}; costo reale ${euro(total)}, utile reale ${euro(margin)}.` });
    });
  };

  function eventRows(item) {
    const revisions = (item.revisions || []).filter((revision) => ['correction', 'validation', 'validation_revoked', 'actuals'].includes(revision.type)).slice(-4).reverse();
    return revisions.length ? `<div class="learningTimeline">${revisions.map((revision) => `<div class="learningEvent"><b>${esc(revision.action || 'Aggiornamento')}</b><small>${new Date(revision.date).toLocaleString('it-IT')} · ${esc(revision.actor || '')}</small></div>`).join('')}</div>` : '<div class="empty">Nessuna correzione registrata.</div>';
  }

  window.learningCenterView = function () {
    const quotes = (db.quotes || []).slice().sort((a, b) => String(b.updatedAt || b.date || '').localeCompare(String(a.updatedAt || a.date || '')));
    const verified = quotes.filter(isVerified), withActuals = quotes.filter((item) => Number(item.actuals?.total || 0) > 0);
    const corrections = quotes.reduce((sum, item) => sum + (item.revisions || []).filter((revision) => revision.type === 'correction').length, 0);
    const knowledge = lineKnowledge();
    return `<section class="learningHero"><h2>Memoria aziendale EdilKappa</h2><p>Qui decidi quali preventivi sono affidabili. EdilKappa AI usa soltanto esempi approvati, correzioni registrate e consuntivi reali; non modifica autonomamente il listino DEI.</p><div class="actions"><button class="btn lime" onclick="go('quotes')">Apri preventivi</button><button class="btn light" onclick="go('priceListView')">Apri listino</button></div></section>
      <div class="grid stats">${stat('Esempi verificati', verified.length, '✓')}${stat('Correzioni imparate', corrections, '✎')}${stat('Consuntivi reali', withActuals.length, '€')}${stat('Voci prezzo affidabili', knowledge.length, '🧠')}</div>
      <div class="grid cols"><section class="card"><div class="cardHead"><h3>Preventivi da insegnare</h3><small class="muted">Approva solo quelli controllati</small></div><div class="list">${quotes.map((item) => {
        const actual = item.actuals;
        const delta = actual ? Number(item.net || 0) - Number(actual.total || 0) : null;
        return `<div class="row"><div class="rowIcon">📋</div><div class="rowBody"><b>${esc(item.code || 'Preventivo')} · ${esc(item.subject || '')}</b><small>${esc(item.client || '')} · netto ${euro(item.net)}${actual ? ` · costo reale ${euro(actual.total)}` : ''}</small>${actual ? `<small class="learningDelta ${delta >= 0 ? 'learningPositive' : 'learningNegative'}">Utile reale ${euro(delta)} · ${Number(actual.marginPercent || 0).toFixed(1)}%</small>` : ''}</div><div class="actions"><span class="learningStatus ${statusClass(item)}">${statusClass(item) === 'verified' ? '✓' : '!'} ${esc(learningStatus(item))}</span><button class="btn sm light" onclick="openQuote('${esc(item.id)}')">Modifica</button>${ownerLearningButtons(item)}</div></div>`;
      }).join('') || '<div class="empty">Non ci sono ancora preventivi.</div>'}</div></section>
      <section class="card"><div class="cardHead"><h3>Prezzi appresi</h3><small class="muted">Solo da esempi verificati</small></div><div class="list">${knowledge.slice(0, 30).map((item) => `<div class="row learningKnowledge"><div class="rowBody"><b>${esc(item.description)}</b><small>Valore centrale ${euro(item.median)} / ${esc(item.unit)} · intervallo ${euro(item.min)}–${euro(item.max)}</small></div><span class="learningStatus verified">${item.samples} esempi</span></div>`).join('') || '<div class="empty">Verifica almeno un preventivo con voci dettagliate per costruire la memoria prezzi.</div>'}</div></section></div>
      <div style="height:16px"></div><section class="card"><div class="cardHead"><h3>Ultime correzioni registrate</h3></div>${quotes.map((item) => (item.revisions || []).some((revision) => revision.type === 'correction') ? `<div style="margin-bottom:14px"><b>${esc(item.code || '')} · ${esc(item.subject || '')}</b>${eventRows(item)}</div>` : '').join('') || '<div class="empty">Le prossime modifiche ai preventivi compariranno qui automaticamente.</div>'}</section>`;
  };

  const baseOpenQuote = window.openQuote;
  window.openQuote = function (id) {
    const beforeIds = new Set((db.quotes || []).map((item) => String(item.id)));
    const existing = id ? quoteById(id) : null;
    const before = existing ? snapshot(existing) : null;
    baseOpenQuote(id);
    const form = document.getElementById('modalForm');
    if (!form) return;
    const status = form.querySelector('[name="status"]');
    if (status && ![...status.options].some((option) => option.value === 'Approvato')) status.add(new Option('Approvato per apprendimento', 'Approvato'), Math.max(0, status.options.length - 1));
    if (status && existing?.status) status.value = existing.status;
    const body = form.querySelector('.modalBody');
    body?.insertAdjacentHTML('afterbegin', '<div class="notice"><b>Apprendimento controllato attivo.</b><br>Le modifiche a oggetto, importo e stato vengono registrate. Diventeranno esempi per l’AI solo dopo “Verifica e insegna”.</div><div style="height:14px"></div>');
    const originalSubmit = form.onsubmit;
    form.onsubmit = async function (event) {
      await originalSubmit.call(this, event);
      if (document.getElementById('modal')?.open) return;
      const item = existing || (db.quotes || []).find((entry) => !beforeIds.has(String(entry.id)));
      if (recordQuoteChange(item, before, !existing)) { save(); render(); }
    };
  };

  if (!ownerNav.some((entry) => entry[0] === 'learningCenter')) {
    const before = ownerNav.findIndex((entry) => entry[0] === 'priceListView');
    ownerNav.splice(before >= 0 ? before + 1 : ownerNav.length, 0, ['learningCenter', '🧠', 'Memoria AI']);
  }
  if (typeof renderNav === 'function') renderNav();

  const baseRender = render;
  render = function () {
    if (view === 'learningCenter') {
      if (!isOffice()) view = 'worker';
      else {
        renderNav(); document.getElementById('avatar').textContent = roleName().charAt(0);
        document.getElementById('pageTitle').textContent = 'Memoria AI';
        document.getElementById('app').innerHTML = window.learningCenterView(); return;
      }
    }
    baseRender();
  };

  window.EdilKappaLearning = Object.freeze({
    isVerified,
    knowledge: lineKnowledge,
    recordQuoteChange
  });
})();
