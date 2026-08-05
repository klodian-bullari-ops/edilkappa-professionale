(function () {
  'use strict';

  db.edilconnect = Array.isArray(db.edilconnect) ? db.edilconnect : [];

  const OUTSIDE_WORK = new Map([
    ['warehouse', 'Magazzino / preparazione'],
    ['travel', 'Trasferta'],
    ['other', 'Altro']
  ]);
  const DNL_COMPLETE = new Set(['Comunicata', "Gestita dall'affidataria"]);
  const CERTIFICATE_COMPLETE = new Set(['Positiva', 'Non necessaria']);
  const MONTH_STATUSES = ['Bozza', 'Pronto da inviare', 'Inviato al consulente'];
  const WORK_CATEGORIES = [
    'Lavori edili generali',
    'OG1 · Edifici civili e industriali',
    'OG2 · Restauro e manutenzione',
    'OG3 · Strade e pavimentazioni',
    'OG6 · Acquedotti, fognature e scarichi',
    'OG11 · Impianti tecnologici',
    'OS6 · Finiture e serramenti',
    'OS7 · Finiture di opere generali',
    'OS8 · Impermeabilizzazioni',
    'OS21 · Opere strutturali speciali',
    'Altro · Da verificare con il consulente'
  ];

  let reportMonth = typeof timesheetMonth !== 'undefined' && timesheetMonth
    ? timesheetMonth
    : new Date().toISOString().slice(0, 7);
  let reportSite = '';
  let reportWorker = '';

  function database() {
    return window.EdilKappaLocal?.getDB?.() || db;
  }

  function normalized(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('it');
  }

  function dateText(value) {
    if (!value) return '—';
    const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('it-IT');
  }

  function numberValue(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function siteLabel(site) {
    return [site?.title, site?.client].filter(Boolean).join(' · ') || 'Cantiere senza titolo';
  }

  function auxiliaryWorkLabel(item) {
    return [item?.type, item?.client].filter(Boolean).join(' · ') || 'Attività senza titolo';
  }

  function siteComplianceId(siteId) {
    return `edilconnect-site-${String(siteId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96)}`;
  }

  function monthRecordId(month) {
    return `edilconnect-month-${String(month || '').replace(/[^0-9-]/g, '').slice(0, 7)}`;
  }

  function rawSiteRecord(siteId) {
    return database().edilconnect.find((item) => item.recordType === 'site' && String(item.siteId) === String(siteId));
  }

  function siteRecord(site) {
    const stored = rawSiteRecord(site?.id) || {};
    return {
      id: siteComplianceId(site?.id),
      recordType: 'site',
      siteId: site?.id || '',
      clientId: site?.clientId || '',
      interventionId: site?.interventionId || '',
      siteTitle: site?.title || '',
      commissionType: 'Privato',
      companyRole: 'Affidataria',
      totalWorkValue: numberValue(site?.value),
      buildingWorkValue: numberValue(site?.value),
      workCategory: 'Lavori edili generali',
      expectedEnd: '',
      actualEnd: site?.status === 'Completato' ? site?.end || '' : '',
      subjectMode: 'Automatico',
      subjectReason: '',
      subjectToCongruity: false,
      cuc: '',
      dnlStatus: 'Da aprire',
      dnlDate: '',
      certificateStatus: 'Da richiedere a fine lavori',
      certificateDate: '',
      subcontractors: '',
      notes: '',
      status: 'Attivo',
      ...stored
    };
  }

  function suggestedCongruity(input) {
    return String(input?.commissionType || 'Privato') === 'Pubblico'
      || numberValue(input?.totalWorkValue) >= 70000;
  }

  function normalizedCuc(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  function validCuc(value) {
    return /^CNCEC[A-Z0-9]{10}$/.test(normalizedCuc(value));
  }

  function isSubject(record) {
    if (record?.subjectMode === 'Sì') return true;
    if (record?.subjectMode === 'No') return false;
    return suggestedCongruity(record);
  }

  function monthRecord(month) {
    return database().edilconnect.find((item) => item.recordType === 'month' && item.month === month) || {
      id: monthRecordId(month),
      recordType: 'month',
      month,
      status: 'Bozza',
      sentAt: '',
      notes: ''
    };
  }

  function matchSiteFromJob(job) {
    const target = normalized(job);
    if (!target) return null;
    const matches = (database().sites || []).filter((site) => {
      const labels = [siteLabel(site), site?.title, `${site?.title || ''} ${site?.client || ''}`];
      return labels.some((label) => normalized(label) === target);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function workReference(value, fallbackJob = '') {
    const reference = String(value || '');
    if (reference.startsWith('site:')) {
      const site = (database().sites || []).find((item) => String(item.id) === reference.slice(5));
      if (site) return { workType: 'site', site, job: siteLabel(site) };
    }
    if (reference.startsWith('outside:')) {
      const key = reference.slice(8);
      return { workType: 'outside', site: null, job: OUTSIDE_WORK.get(key) || fallbackJob || 'Altro' };
    }
    if (reference.startsWith('activity:')) {
      const [, kind, ...idParts] = reference.split(':');
      const collectionName = kind === 'roof' ? 'roofs' : kind === 'drain' ? 'drains' : '';
      const item = collectionName ? (database()[collectionName] || []).find((row) => String(row.id) === idParts.join(':')) : null;
      if (item) return { workType: 'unlinked', site: null, job: auxiliaryWorkLabel(item) };
    }
    const matched = matchSiteFromJob(reference || fallbackJob);
    if (matched) return { workType: 'site', site: matched, job: siteLabel(matched) };
    const label = fallbackJob || reference || 'Altro';
    const outside = Array.from(OUTSIDE_WORK.values()).some((item) => normalized(item) === normalized(label));
    return { workType: outside ? 'outside' : 'unlinked', site: null, job: label };
  }

  function linkedHourData(reference, fallbackJob = '') {
    const resolved = workReference(reference, fallbackJob);
    if (!resolved.site) {
      return {
        workType: resolved.workType,
        job: resolved.job,
        siteId: '',
        interventionId: '',
        clientId: ''
      };
    }
    return {
      workType: 'site',
      job: resolved.job,
      siteId: resolved.site.id,
      interventionId: resolved.site.interventionId || '',
      clientId: resolved.site.clientId || ''
    };
  }

  function jobOptions(teamId, selectedSiteId = '', includeAll = false, selectedJob = '') {
    const rows = (database().sites || []).filter((site) => includeAll || siteHasTeam(site, teamId) || String(site.id) === String(selectedSiteId));
    const options = rows.map((site) => `<option value="site:${esc(site.id)}" ${String(site.id) === String(selectedSiteId) ? 'selected' : ''}>${esc(siteLabel(site))}</option>`);
    const auxiliary = [
      ...(database().roofs || []).filter((item) => includeAll || String(item.worker) === String(teamId)).map((item) => ({ kind: 'roof', item })),
      ...(database().drains || []).filter((item) => includeAll || String(item.worker) === String(teamId)).map((item) => ({ kind: 'drain', item }))
    ];
    const selectedAuxiliary = auxiliary.find(({ item }) => !selectedSiteId && normalized(auxiliaryWorkLabel(item)) === normalized(selectedJob));
    for (const { kind, item } of auxiliary) {
      options.push(`<option value="activity:${kind}:${esc(item.id)}" ${selectedAuxiliary?.item === item ? 'selected' : ''}>${esc(auxiliaryWorkLabel(item))}</option>`);
    }
    const selectedOutside = Array.from(OUTSIDE_WORK).find(([, label]) => !selectedSiteId && normalized(label) === normalized(selectedJob))?.[0]
      || (!selectedSiteId && selectedJob && !selectedAuxiliary ? 'other' : '');
    for (const [key, label] of OUTSIDE_WORK) options.push(`<option value="outside:${key}" ${selectedOutside === key ? 'selected' : ''}>${esc(label)}</option>`);
    return options.join('');
  }

  teamJobOptions = function (teamId) {
    return jobOptions(teamId);
  };

  function individualRows() {
    const rows = [];
    for (const entry of database().timesheets || []) {
      if (entry.worker) {
        rows.push({ ...entry, sourceId: entry.id });
        continue;
      }
      if (entry.member1) {
        rows.push({ ...entry, id: `${entry.id}-1`, sourceId: entry.id, legacy: true, worker: '', workerName: entry.member1, hours: numberValue(entry.hours1) });
      }
      if (entry.member2) {
        rows.push({ ...entry, id: `${entry.id}-2`, sourceId: entry.id, legacy: true, worker: '', workerName: entry.member2, hours: numberValue(entry.hours2) });
      }
    }
    return rows;
  }

  function resolvedHourRows(month = reportMonth) {
    return individualRows().filter((entry) => String(entry.date || '').startsWith(month)).map((entry) => {
      let site = (database().sites || []).find((item) => String(item.id) === String(entry.siteId || '')) || null;
      if (!site && entry.workType !== 'outside') site = matchSiteFromJob(entry.job);
      const outside = entry.workType === 'outside'
        || Array.from(OUTSIDE_WORK.values()).some((label) => normalized(label) === normalized(entry.job));
      const linkState = site ? 'Collegata' : outside ? 'Fuori cantiere' : 'Da collegare';
      return {
        ...entry,
        workerKey: String(entry.worker || `legacy:${normalized(entry.workerName)}:${entry.team || ''}`),
        workerName: entry.workerName || entry.member1 || 'Operaio non indicato',
        teamName: entry.teamName || WORKERS.find((team) => String(team.id) === String(entry.team))?.name || 'Senza squadra',
        hours: numberValue(entry.hours),
        site,
        siteId: site?.id || '',
        linkState
      };
    });
  }

  function monthData(month = reportMonth, siteId = reportSite, workerKey = reportWorker) {
    const allRows = resolvedHourRows(month);
    const rows = allRows.filter((row) => (!siteId || row.siteId === siteId) && (!workerKey || row.workerKey === workerKey));
    const matrix = new Map();
    const siteTotals = new Map();
    const daily = new Map();

    for (const row of rows) {
      const siteKey = row.siteId || (row.linkState === 'Fuori cantiere' ? 'outside' : 'unlinked');
      const matrixKey = `${row.workerKey}|${siteKey}`;
      if (!matrix.has(matrixKey)) matrix.set(matrixKey, { workerKey: row.workerKey, workerName: row.workerName, teamName: row.teamName, siteKey, site: row.site, linkState: row.linkState, days: new Set(), hours: 0 });
      const matrixRow = matrix.get(matrixKey);
      matrixRow.hours += row.hours;
      if (row.hours > 0 && row.date) matrixRow.days.add(row.date);

      if (!siteTotals.has(siteKey)) siteTotals.set(siteKey, { siteKey, site: row.site, linkState: row.linkState, workers: new Set(), days: new Set(), hours: 0 });
      const siteRow = siteTotals.get(siteKey);
      siteRow.hours += row.hours;
      siteRow.workers.add(row.workerKey);
      if (row.hours > 0 && row.date) siteRow.days.add(row.date);

      const dailyKey = `${row.workerKey}|${row.date}`;
      daily.set(dailyKey, (daily.get(dailyKey) || 0) + row.hours);
    }

    return {
      month,
      rows,
      allRows,
      matrix: Array.from(matrix.values()).sort((left, right) => left.workerName.localeCompare(right.workerName, 'it') || String(left.site?.title || left.linkState).localeCompare(String(right.site?.title || right.linkState), 'it')),
      siteTotals: Array.from(siteTotals.values()).sort((left, right) => String(left.site?.title || left.linkState).localeCompare(String(right.site?.title || right.linkState), 'it')),
      totalHours: rows.reduce((sum, row) => sum + row.hours, 0),
      linkedHours: rows.filter((row) => row.site).reduce((sum, row) => sum + row.hours, 0),
      outsideHours: rows.filter((row) => row.linkState === 'Fuori cantiere').reduce((sum, row) => sum + row.hours, 0),
      unlinked: rows.filter((row) => row.linkState === 'Da collegare'),
      anomalies: Array.from(daily, ([key, hours]) => ({ key, hours })).filter((item) => item.hours > 12)
    };
  }

  function siteIssues(site) {
    const record = siteRecord(site);
    if (!isSubject(record)) return [];
    const issues = [];
    if (!record.cuc) issues.push(record.companyRole === 'Subappaltatrice' ? "CUC da chiedere all'affidataria" : 'CUC mancante');
    if (!DNL_COMPLETE.has(record.dnlStatus)) issues.push(record.companyRole === 'Subappaltatrice' ? "collegamento DNL da verificare" : 'DNL non comunicata');
    if (site.status === 'Completato' && !CERTIFICATE_COMPLETE.has(record.certificateStatus)) issues.push('attestazione finale mancante');
    if (!record.buildingWorkValue) issues.push('importo lavori edili mancante');
    return issues;
  }

  function operationalAlerts(month = reportMonth) {
    const alerts = [];
    for (const site of database().sites || []) {
      const issues = siteIssues(site);
      if (issues.length) alerts.push({ type: 'site', site, title: siteLabel(site), text: issues.join(' · ') });
      const record = siteRecord(site);
      if (record.expectedEnd && site.status !== 'Completato') {
        const days = Math.ceil((new Date(`${record.expectedEnd}T12:00:00`) - new Date()) / 86400000);
        if (days >= 0 && days <= 14 && isSubject(record) && issues.length) alerts.push({ type: 'site', site, title: `Fine prevista ${dateText(record.expectedEnd)}`, text: `${siteLabel(site)} · completa i dati prima della chiusura` });
      }
    }
    const data = monthData(month, '', '');
    if (data.unlinked.length) alerts.push({ type: 'month', title: `${data.unlinked.length} registrazioni ore da collegare`, text: `Mese ${month} · apri il riepilogo prima dell'invio` });
    if (data.anomalies.length) alerts.push({ type: 'month', title: `${data.anomalies.length} giornate sopra 12 ore`, text: 'Controlla eventuali duplicazioni o straordinari' });
    if (data.allRows.length && monthRecord(month).status !== 'Inviato al consulente') alerts.push({ type: 'month', title: `Riepilogo ${month} non ancora inviato`, text: `Stato: ${monthRecord(month).status}` });
    return alerts;
  }

  function complianceBadge(site) {
    const record = siteRecord(site);
    if (!isSubject(record)) return '<span class="pill blue">Non soggetto</span>';
    if (siteIssues(site).length) return '<span class="pill orange">Da completare</span>';
    if (CERTIFICATE_COMPLETE.has(record.certificateStatus)) return '<span class="pill">Congruità chiusa</span>';
    return '<span class="pill">Dati pronti</span>';
  }

  const style = document.createElement('style');
  style.textContent = `
    .edilconnectHero{background:linear-gradient(135deg,#111,#2a302c);border-bottom:5px solid var(--lime);color:#fff;border-radius:24px;padding:22px;margin-bottom:18px}.edilconnectHero h2{color:var(--lime);margin:0 0 6px}.edilconnectHero p{color:#e5e8e5;margin:0;line-height:1.5}.edilconnectFilters{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:14px}.edilconnectFilters .input{max-width:260px}.edilconnectWarning{border-left:6px solid #d69b18}.edilconnectOk{border-left:6px solid var(--green)}.edilconnectSiteMeta{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.edilconnectSiteMeta span{font-size:11px;padding:5px 8px;border-radius:999px;background:#f0f2ef;color:#4f5b51}.edilconnectStatusForm{display:grid;grid-template-columns:minmax(180px,.5fr) minmax(240px,1fr) auto;gap:10px;align-items:end}.edilconnectStatusForm label{font-size:12px;font-weight:850}.edilconnectStatusForm select,.edilconnectStatusForm textarea{width:100%;border:1px solid #ccd2cb;border-radius:12px;padding:10px;background:#fff}.edilconnectStatusForm textarea{min-height:43px;resize:vertical}.edilconnectActions{display:flex;gap:8px;flex-wrap:wrap}.edilconnectActions .btn{flex:0 1 auto}#modal[open]{max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);overflow:hidden}#modalContent{max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);display:flex;flex-direction:column}#modalContent>.modalHead{flex:none}#modalContent>#modalForm{display:flex;flex:1;min-height:0;flex-direction:column}#modalForm>.modalBody{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}#modalForm>.modalFoot{flex:none}
    @media(max-width:760px){.edilconnectStatusForm{grid-template-columns:1fr}.edilconnectFilters .input{width:100%;max-width:none;min-width:0;flex:1 1 100%}.edilconnectActions{width:100%}.edilconnectActions .btn{flex:1 1 145px}.edilconnectWarning .row{display:grid;grid-template-columns:auto minmax(0,1fr);min-width:0}.edilconnectWarning .row>.btn{grid-column:1/-1;width:100%}.edilconnectSiteTable{min-width:960px}.edilconnectMatrix{min-width:820px}}
  `;
  document.head.appendChild(style);

  if (!ownerNav.some((entry) => entry[0] === 'edilconnectView')) {
    const hoursIndex = ownerNav.findIndex((entry) => entry[0] === 'hours');
    ownerNav.splice(hoursIndex >= 0 ? hoursIndex + 1 : 8, 0, ['edilconnectView', 'CE', 'Cassa Edile / EdilConnect']);
  }

  const baseMore = more;
  more = function () {
    return baseMore() + pageHead('Cassa Edile', 'Ore e dati pronti per il consulente') +
      '<div class="grid quick"><button onclick="go(\'edilconnectView\')"><span>CE</span>Cassa Edile / EdilConnect</button></div>';
  };

  const baseRenderNav = renderNav;
  renderNav = function () {
    baseRenderNav();
    if (view !== 'edilconnectView') return;
    const moreButton = Array.from(document.querySelectorAll('#mobileNav button')).find((button) => button.getAttribute('onclick') === "go('more')");
    if (moreButton) moreButton.classList.add('active');
  };

  const baseDashboard = dashboard;
  dashboard = function () {
    const alerts = operationalAlerts(reportMonth);
    return baseDashboard() + pageHead('Cassa Edile / EdilConnect', alerts.length ? `${alerts.length} controlli da completare` : 'Dati amministrativi sotto controllo', '<button class="btn sm light" onclick="go(\'edilconnectView\')">Apri riepilogo</button>') +
      `<section class="card ${alerts.length ? 'edilconnectWarning' : 'edilconnectOk'}"><div class="list">${alerts.slice(0, 4).map((item) => `<div class="row"><div class="rowIcon">${item.type === 'site' ? '🏗️' : '⏱️'}</div><div class="rowBody"><b>${esc(item.title)}</b><small>${esc(item.text)}</small></div><button class="btn sm green" onclick="${item.type === 'site' ? `openEdilConnectSite('${item.site.id}')` : "go('edilconnectView')"}">Apri</button></div>`).join('') || '<div class="empty">Nessun controllo urgente per EdilConnect.</div>'}</div></section>`;
  };

  const baseSiteRow = siteRow;
  siteRow = function (site) {
    const html = baseSiteRow(site);
    const button = `${complianceBadge(site)}<button class="btn sm ${siteIssues(site).length ? 'green' : 'light'}" onclick="openEdilConnectSite('${esc(site.id)}')">EdilConnect</button>`;
    return html.replace('<button class="btn sm light" onclick="openSite', `${button}<button class="btn sm light" onclick="openSite`);
  };

  window.openEdilConnectSite = function (siteId) {
    if (!isOffice()) return alert('Questa funzione è riservata a Titolare e Ufficio.');
    const site = (database().sites || []).find((item) => String(item.id) === String(siteId));
    if (!site) return alert('Cantiere non trovato.');
    const item = siteRecord(site);
    const automatic = suggestedCongruity(item);
    modal('Cassa Edile / EdilConnect', `<div class="notice"><b>${esc(siteLabel(site))}</b><br>${esc(site.address || '')}<br>Suggerimento: <b>${automatic ? 'cantiere soggetto a congruità' : 'congruità non suggerita automaticamente'}</b>. Verifica finale a cura del consulente.</div><div style="height:14px"></div><div class="formGrid">
      <div class="field"><label>Committente</label><select name="commissionType"><option ${item.commissionType === 'Privato' ? 'selected' : ''}>Privato</option><option ${item.commissionType === 'Pubblico' ? 'selected' : ''}>Pubblico</option></select></div>
      <div class="field"><label>Ruolo EdilKappa</label><select name="companyRole"><option ${item.companyRole === 'Affidataria' ? 'selected' : ''}>Affidataria</option><option ${item.companyRole === 'Subappaltatrice' ? 'selected' : ''}>Subappaltatrice</option></select></div>
      <div class="field"><label>Valore complessivo dell'opera €</label><input name="totalWorkValue" type="number" min="0" max="100000000" step="0.01" value="${esc(item.totalWorkValue)}" required></div>
      <div class="field"><label>Importo lavori edili €</label><input name="buildingWorkValue" type="number" min="0" max="100000000" step="0.01" value="${esc(item.buildingWorkValue)}" required></div>
      <div class="field full"><label>Tipologia prevalente</label><select name="workCategory">${WORK_CATEGORIES.map((category) => `<option ${category === item.workCategory ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></div>
      <div class="field"><label>Fine prevista</label><input name="expectedEnd" type="date" value="${esc(item.expectedEnd || '')}"></div>
      <div class="field"><label>Applicazione congruità</label><select name="subjectMode"><option ${item.subjectMode === 'Automatico' ? 'selected' : ''}>Automatico</option><option ${item.subjectMode === 'Sì' ? 'selected' : ''}>Sì</option><option ${item.subjectMode === 'No' ? 'selected' : ''}>No</option></select></div>
      <div class="field full"><label>Motivo dell'eventuale scelta manuale</label><textarea name="subjectReason" placeholder="Compila se imposti Sì o No manualmente">${esc(item.subjectReason || '')}</textarea></div>
      <div class="field"><label>CUC · 15 caratteri, inizia con CNCEC</label><input name="cuc" maxlength="15" pattern="CNCEC[A-Za-z0-9]{10}" autocomplete="off" value="${esc(item.cuc || '')}" placeholder="CNCEC0000000000"></div>
      <div class="field"><label>Stato DNL</label><select name="dnlStatus">${['Da aprire', 'In preparazione', 'Comunicata', "Gestita dall'affidataria", 'Non necessaria'].map((status) => `<option ${status === item.dnlStatus ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select></div>
      <div class="field"><label>Data comunicazione DNL</label><input name="dnlDate" type="date" value="${esc(item.dnlDate || '')}"></div>
      <div class="field"><label>Attestazione congruità</label><select name="certificateStatus">${['Da richiedere a fine lavori', 'Richiesta', 'Positiva', 'Negativa', 'Non necessaria'].map((status) => `<option ${status === item.certificateStatus ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select></div>
      <div class="field"><label>Data attestazione</label><input name="certificateDate" type="date" value="${esc(item.certificateDate || '')}"></div>
      <div class="field full"><label>Subappaltatori / lavoratori autonomi</label><textarea name="subcontractors" placeholder="Impresa, Partita IVA, lavorazione e periodo">${esc(item.subcontractors || '')}</textarea></div>
      <div class="field full"><label>Note per il consulente</label><textarea name="notes" placeholder="Variazioni, costi da documentare o chiarimenti">${esc(item.notes || '')}</textarea></div>
    </div>`, (formData) => {
      const cuc = normalizedCuc(formData.get('cuc'));
      if (cuc && !validCuc(cuc)) throw new Error('Il CUC deve avere 15 caratteri e iniziare con CNCEC.');
      const totalWorkValue = numberValue(formData.get('totalWorkValue'));
      const buildingWorkValue = numberValue(formData.get('buildingWorkValue'));
      if (totalWorkValue > 0 && buildingWorkValue > totalWorkValue) throw new Error("L'importo dei lavori edili non può superare il valore complessivo dell'opera.");
      const subjectMode = String(formData.get('subjectMode'));
      const subjectReason = String(formData.get('subjectReason') || '').trim();
      if (subjectMode !== 'Automatico' && !subjectReason) throw new Error('Indica il motivo della scelta manuale sulla congruità.');
      const now = new Date().toISOString();
      const data = {
        id: item.id,
        recordType: 'site',
        siteId: site.id,
        clientId: site.clientId || '',
        interventionId: site.interventionId || '',
        siteTitle: site.title || '',
        commissionType: String(formData.get('commissionType')),
        companyRole: String(formData.get('companyRole')),
        totalWorkValue,
        buildingWorkValue,
        workCategory: String(formData.get('workCategory')),
        expectedEnd: String(formData.get('expectedEnd') || ''),
        actualEnd: site.status === 'Completato' ? site.end || localToday() : '',
        subjectMode,
        subjectReason,
        cuc,
        dnlStatus: String(formData.get('dnlStatus')),
        dnlDate: String(formData.get('dnlDate') || ''),
        certificateStatus: String(formData.get('certificateStatus')),
        certificateDate: String(formData.get('certificateDate') || ''),
        subcontractors: String(formData.get('subcontractors') || '').trim(),
        notes: String(formData.get('notes') || '').trim(),
        status: 'Attivo',
        createdAt: item.createdAt || now,
        updatedAt: now
      };
      data.subjectToCongruity = isSubject(data);
      const existing = rawSiteRecord(site.id);
      if (existing) Object.assign(existing, data);
      else database().edilconnect.push(data);
    });
  };

  saveIndividualHours = function (event) {
    event.preventDefault();
    const person = currentStaff();
    const team = WORKERS.find((item) => item.id === person?.team);
    if (!person) return alert('Profilo operaio non trovato.');
    const form = new FormData(event.target);
    const hours = numberValue(form.get('hours'));
    if (hours <= 0 || hours > 24) return alert('Inserisci un numero di ore maggiore di zero e non superiore a 24.');
    const linked = linkedHourData(form.get('job'));
    const duplicate = (database().timesheets || []).some((item) => item.worker === person.id && item.date === form.get('date') && String(item.siteId || '') === String(linked.siteId || '') && normalized(item.job) === normalized(linked.job));
    if (duplicate && !confirm('Hai già registrato ore per questa attività nella stessa giornata. Vuoi aggiungerne altre?')) return;
    database().timesheets.push({
      id: uid('ore'),
      date: String(form.get('date')),
      worker: person.id,
      workerName: person.name,
      team: person.team,
      teamName: team?.name || 'Senza squadra',
      ...linked,
      hours,
      notes: String(form.get('notes') || ''),
      createdAt: new Date().toISOString()
    });
    save();
    alert('Ore collegate al cantiere e salvate correttamente.');
    render();
  };

  openIndividualHoursEntry = function (id) {
    const item = (database().timesheets || []).find((entry) => entry.id === id);
    if (!item) return;
    const currentOther = item.siteId ? '' : item.job || '';
    modal('Modifica le mie ore', `<div class="formGrid">
      ${field('Data', 'date', 'date', item.date)}
      <div class="field full"><label>Cantiere / attività</label><select name="workRef" required>${jobOptions(item.team || currentTeamId(), item.siteId || '', isOffice(), item.job || '')}</select></div>
      <div class="field full"><label>Descrizione se non è un cantiere</label><input name="jobOther" value="${esc(currentOther)}" placeholder="Magazzino, trasferta o altro"></div>
      ${field('Ore lavorate', 'hours', 'number', item.hours)}
      <div class="field full"><label>Note</label><textarea name="notes">${esc(item.notes || '')}</textarea></div>
    </div>`, (formData) => {
      const hours = numberValue(formData.get('hours'));
      if (hours <= 0 || hours > 24) throw new Error('Le ore devono essere maggiori di zero e non superiori a 24.');
      const reference = String(formData.get('workRef') || '');
      const other = String(formData.get('jobOther') || '').trim();
      const linked = linkedHourData(reference, other || 'Altro');
      Object.assign(item, { date: String(formData.get('date')), ...linked, hours, notes: String(formData.get('notes') || ''), updatedAt: new Date().toISOString() });
    });
  };

  const baseSaveReport = saveReport;
  saveReport = async function (event) {
    const before = new Set((database().reports || []).map((item) => item.id));
    await baseSaveReport(event);
    if (isOffice()) return;
    const created = (database().reports || []).find((item) => !before.has(item.id));
    const person = currentStaff();
    if (!created || !person || numberValue(created.hours) <= 0) return;
    if (normalized(created.workersPresent) && normalized(created.workersPresent) !== normalized(person.name)) return;
    const site = (database().sites || []).find((item) => String(item.id) === String(created.site || created.siteId));
    if (!site) return;
    const date = String(created.workDate || created.date || '').slice(0, 10);
    let entry = (database().timesheets || []).find((item) => item.worker === person.id && item.date === date && String(item.siteId || '') === String(site.id));
    if (!entry) {
      const team = WORKERS.find((item) => item.id === person.team);
      entry = {
        id: uid('ore'),
        date,
        worker: person.id,
        workerName: person.name,
        team: person.team,
        teamName: team?.name || 'Senza squadra',
        ...linkedHourData(`site:${site.id}`),
        hours: numberValue(created.hours),
        notes: `Da rapportino ${created.code || created.id}`,
        sourceReportId: created.id,
        createdAt: new Date().toISOString()
      };
      database().timesheets.push(entry);
    }
    created.timesheetId = entry.id;
    save();
  };

  const baseDeleteItem = deleteItem;
  deleteItem = async function (collectionName, id, label) {
    const existed = collectionName === 'sites' && (database().sites || []).some((site) => String(site.id) === String(id));
    await baseDeleteItem(collectionName, id, label);
    if (!existed || (database().sites || []).some((site) => String(site.id) === String(id))) return;
    database().edilconnect = (database().edilconnect || []).filter((item) => !(item.recordType === 'site' && String(item.siteId) === String(id)));
    save();
    render();
  };

  window.setEdilConnectMonth = function (value) {
    reportMonth = String(value || new Date().toISOString().slice(0, 7));
    reportSite = '';
    reportWorker = '';
    render();
  };

  window.setEdilConnectSite = function (value) {
    reportSite = String(value || '');
    render();
  };

  window.setEdilConnectWorker = function (value) {
    reportWorker = String(value || '');
    render();
  };

  window.saveEdilConnectMonth = function (event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const status = String(form.get('status') || 'Bozza');
    if (!MONTH_STATUSES.includes(status)) return alert('Stato mensile non valido.');
    const current = monthRecord(reportMonth);
    const now = new Date().toISOString();
    const data = {
      id: monthRecordId(reportMonth),
      recordType: 'month',
      month: reportMonth,
      status,
      notes: String(form.get('notes') || '').trim(),
      sentAt: status === 'Inviato al consulente' ? current.sentAt || now : '',
      createdAt: current.createdAt || now,
      updatedAt: now
    };
    const existing = (database().edilconnect || []).find((item) => item.recordType === 'month' && item.month === reportMonth);
    if (existing) Object.assign(existing, data);
    else database().edilconnect.push(data);
    save();
    render();
    alert('Stato del riepilogo aggiornato.');
  };

  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function decimalText(value) {
    return numberValue(value).toFixed(2).replace('.', ',');
  }

  function csvContent(data) {
    const headers = ['Mese', 'Data', 'Operaio', 'Squadra', 'Cantiere', 'Cliente', 'Codice cantiere', 'CUC', 'Ore', 'Collegamento', 'Note'];
    const rows = data.rows.map((row) => {
      const compliance = row.site ? siteRecord(row.site) : {};
      return [data.month, row.date, row.workerName, row.teamName, row.site?.title || row.job || '', row.site?.client || '', row.site?.code || '', compliance.cuc || '', decimalText(row.hours), row.linkState, row.notes || ''];
    });
    return `\ufeff${[headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
  }

  window.downloadEdilConnectCsv = function () {
    const data = monthData();
    if (!data.rows.length) return alert('Non ci sono ore da esportare con i filtri selezionati.');
    const blob = new Blob([csvContent(data)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `EdilConnect_ore_${data.month}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  function summaryText(data) {
    const status = monthRecord(data.month);
    const lines = [
      `${COMPANY.name || 'EDILKAPPA'} — riepilogo Cassa Edile / EdilConnect`,
      `Mese: ${data.month}`,
      `Stato: ${status.status}`,
      `Ore complessive: ${data.totalHours.toFixed(1)}`,
      `Ore collegate ai cantieri: ${data.linkedHours.toFixed(1)}`,
      `Ore fuori cantiere: ${data.outsideHours.toFixed(1)}`,
      ''
    ];
    for (const row of data.siteTotals) {
      const compliance = row.site ? siteRecord(row.site) : {};
      lines.push(`${row.site ? siteLabel(row.site) : row.linkState}: ${row.hours.toFixed(1)} ore · ${row.workers.size} operai${compliance.cuc ? ` · CUC ${compliance.cuc}` : ''}`);
    }
    if (data.unlinked.length) lines.push('', `ATTENZIONE: ${data.unlinked.length} registrazioni non sono collegate a un cantiere.`);
    if (data.anomalies.length) lines.push(`ATTENZIONE: ${data.anomalies.length} giornate superano 12 ore per operaio.`);
    return lines.join('\n');
  }

  window.copyEdilConnectSummary = async function () {
    const text = summaryText(monthData());
    try {
      await navigator.clipboard.writeText(text);
      alert('Riepilogo copiato. Puoi incollarlo nel messaggio al consulente.');
    } catch (_) {
      prompt('Copia il riepilogo:', text);
    }
  };

  window.printEdilConnectReport = function () {
    const data = monthData();
    const popup = window.open('', '_blank');
    if (!popup) return alert('Consenti l’apertura della finestra per stampare il riepilogo.');
    const matrixRows = data.matrix.map((row) => `<tr><td>${esc(row.workerName)}</td><td>${esc(row.teamName)}</td><td>${esc(row.site ? siteLabel(row.site) : row.linkState)}</td><td>${row.days.size}</td><td>${row.hours.toFixed(1)}</td></tr>`).join('');
    popup.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>EdilConnect ${esc(data.month)}</title><style>body{font-family:Arial;padding:28px;color:#111}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{border:1px solid #bbb;padding:7px;font-size:11px;text-align:left}th{background:#eee}.warning{padding:10px;background:#fff4cf;border:1px solid #e4c75b}</style></head><body><h1>${esc(COMPANY.name || 'EDILKAPPA')}</h1><h2>Cassa Edile / EdilConnect · ${esc(data.month)}</h2><p>Ore complessive: <b>${data.totalHours.toFixed(1)}</b> · collegate: <b>${data.linkedHours.toFixed(1)}</b> · fuori cantiere: <b>${data.outsideHours.toFixed(1)}</b></p>${data.unlinked.length || data.anomalies.length ? `<p class="warning">Da controllare: ${data.unlinked.length} registrazioni non collegate e ${data.anomalies.length} giornate sopra 12 ore.</p>` : ''}<table><thead><tr><th>Operaio</th><th>Squadra</th><th>Cantiere</th><th>Giorni</th><th>Ore</th></tr></thead><tbody>${matrixRows || '<tr><td colspan="5">Nessuna ora registrata.</td></tr>'}</tbody></table><p>Stato invio: <b>${esc(monthRecord(data.month).status)}</b></p></body></html>`);
    popup.document.close();
    setTimeout(() => popup.print(), 400);
  };

  function renderEdilConnect() {
    const data = monthData();
    const allMonthRows = resolvedHourRows(reportMonth);
    const workerOptions = Array.from(new Map(allMonthRows.map((row) => [row.workerKey, row.workerName])).entries()).sort((left, right) => left[1].localeCompare(right[1], 'it'));
    const status = monthRecord(reportMonth);
    const alerts = operationalAlerts(reportMonth);
    const sites = (database().sites || []).slice().sort((left, right) => (left.status === 'Completato') - (right.status === 'Completato') || siteLabel(left).localeCompare(siteLabel(right), 'it'));
    const subjectSites = sites.filter((site) => isSubject(siteRecord(site)));
    const readySites = subjectSites.filter((site) => !siteIssues(site).length);
    return `<div class="edilconnectHero"><h2>Cassa Edile / EdilConnect</h2><p>Inserisci i dati del cantiere una volta sola. Le ore comunicate dagli operai vengono collegate automaticamente e il consulente riceve un riepilogo già pronto.</p><div class="edilconnectActions" style="margin-top:14px"><a class="btn lime" href="https://www.congruitanazionale.it/" target="_blank" rel="noopener">Apri CNCE EdilConnect</a><a class="btn light" href="https://www.congruitanazionale.it/Home/Simulatore" target="_blank" rel="noopener">Simulatore ufficiale</a></div></div>
      <div class="grid stats">${stat('Cantieri soggetti', subjectSites.length, 'CE')}${stat('Dati cantiere pronti', `${readySites.length}/${subjectSites.length}`, '✓')}${stat('Ore del mese', data.totalHours.toFixed(1), '⏱️')}${stat('Controlli aperti', alerts.length, '!')}</div>
      ${alerts.length ? `<section class="card edilconnectWarning"><div class="cardHead"><h3>Da sistemare prima dell'invio</h3></div><div class="list">${alerts.map((item) => `<div class="row"><div class="rowIcon">!</div><div class="rowBody"><b>${esc(item.title)}</b><small>${esc(item.text)}</small></div><button class="btn sm green" onclick="${item.type === 'site' ? `openEdilConnectSite('${item.site.id}')` : ''}">${item.type === 'site' ? 'Sistema' : 'Vedi sotto'}</button></div>`).join('')}</div></section><div style="height:16px"></div>` : ''}
      ${pageHead('Dati dei cantieri', 'CUC, DNL e attestazione restano riservati a Titolare e Ufficio')}
      <section class="card"><div class="tableWrap"><table class="table edilconnectSiteTable"><thead><tr><th>Cantiere</th><th>Ruolo</th><th>Valore opera</th><th>Congruità</th><th>CUC</th><th>DNL</th><th>Attestazione</th><th></th></tr></thead><tbody>${sites.map((site) => { const record = siteRecord(site); return `<tr><td><b>${esc(site.title)}</b><br><small>${esc(site.client)} · ${esc(site.address)}</small></td><td>${esc(record.companyRole)}</td><td class="money">${euro(record.totalWorkValue)}</td><td>${complianceBadge(site)}</td><td>${esc(record.cuc || 'Da inserire')}</td><td>${esc(record.dnlStatus)}</td><td>${esc(record.certificateStatus)}</td><td><button class="btn sm green" onclick="openEdilConnectSite('${site.id}')">Apri</button></td></tr>`; }).join('') || '<tr><td colspan="8">Nessun cantiere presente.</td></tr>'}</tbody></table></div></section>
      <div style="height:22px"></div>${pageHead('Riepilogo mensile per il consulente', 'Ore già registrate dagli operai, senza ricopiarle', '<div class="edilconnectActions"><button class="btn light" onclick="copyEdilConnectSummary()">Copia riepilogo</button><button class="btn light" onclick="printEdilConnectReport()">Stampa / PDF</button><button class="btn lime" onclick="downloadEdilConnectCsv()">Scarica Excel CSV</button></div>')}
      <section class="card"><div class="edilconnectFilters"><input class="input" type="month" value="${esc(reportMonth)}" onchange="setEdilConnectMonth(this.value)"><select class="input" onchange="setEdilConnectSite(this.value)"><option value="">Tutti i cantieri</option>${sites.map((site) => `<option value="${esc(site.id)}" ${reportSite === site.id ? 'selected' : ''}>${esc(siteLabel(site))}</option>`).join('')}</select><select class="input" onchange="setEdilConnectWorker(this.value)"><option value="">Tutti gli operai</option>${workerOptions.map(([key, name]) => `<option value="${esc(key)}" ${reportWorker === key ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></div>
      <form class="edilconnectStatusForm" onsubmit="saveEdilConnectMonth(event)"><label>Stato del mese<select name="status">${MONTH_STATUSES.map((value) => `<option ${status.status === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label><label>Note per il consulente<textarea name="notes" placeholder="Eventuali chiarimenti">${esc(status.notes || '')}</textarea></label><button class="btn green" type="submit">Salva stato</button></form>${status.sentAt ? `<div class="sectionNote">Inviato il ${esc(new Date(status.sentAt).toLocaleString('it-IT'))}</div>` : ''}</section>
      <div style="height:16px"></div><section class="card"><div class="cardHead"><h3>Ore per operaio e cantiere</h3></div><div class="tableWrap"><table class="table edilconnectMatrix"><thead><tr><th>Operaio</th><th>Squadra</th><th>Cantiere</th><th>CUC</th><th>Giorni</th><th>Ore</th><th>Controllo</th></tr></thead><tbody>${data.matrix.map((row) => { const compliance = row.site ? siteRecord(row.site) : {}; return `<tr><td><b>${esc(row.workerName)}</b></td><td>${esc(row.teamName)}</td><td>${esc(row.site ? siteLabel(row.site) : row.linkState)}</td><td>${esc(compliance.cuc || '—')}</td><td>${row.days.size}</td><td class="money">${row.hours.toFixed(1)}</td><td>${row.linkState === 'Da collegare' ? '<span class="pill orange">Da collegare</span>' : '<span class="pill">OK</span>'}</td></tr>`; }).join('') || '<tr><td colspan="7">Nessuna ora registrata nel mese.</td></tr>'}</tbody></table></div></section>
      <div style="height:16px"></div><section class="card"><div class="cardHead"><h3>Totale per cantiere / CUC</h3></div><div class="tableWrap"><table class="table"><thead><tr><th>Cantiere</th><th>CUC</th><th>Operai</th><th>Giorni</th><th>Ore</th></tr></thead><tbody>${data.siteTotals.map((row) => { const compliance = row.site ? siteRecord(row.site) : {}; return `<tr><td><b>${esc(row.site ? siteLabel(row.site) : row.linkState)}</b></td><td>${esc(compliance.cuc || '—')}</td><td>${row.workers.size}</td><td>${row.days.size}</td><td class="money">${row.hours.toFixed(1)}</td></tr>`; }).join('') || '<tr><td colspan="5">Nessun totale disponibile.</td></tr>'}</tbody></table></div></section>`;
  }

  const baseRender = render;
  render = function () {
    if (view === 'edilconnectView') {
      if (!isOffice()) view = 'worker';
      else {
        renderNav();
        document.getElementById('avatar').textContent = roleName().charAt(0);
        document.getElementById('pageTitle').textContent = 'Cassa Edile / EdilConnect';
        document.getElementById('app').innerHTML = renderEdilConnect();
        return;
      }
    }
    baseRender();
  };

  window.EdilKappaEdilConnect = {
    suggestedCongruity,
    validCuc,
    isSubject,
    siteRecord,
    jobOptions,
    resolvedHourRows,
    monthData,
    csvContent,
    operationalAlerts
  };
  render();
})();
