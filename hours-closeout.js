(function () {
  'use strict';

  const REGULAR_DAY_HOURS = 8;
  const CLOSEOUT_FEATURE_START = '2026-08-06';
  const REMINDER_REPEAT_MS = 60 * 60 * 1000;
  const siteStatusSnapshot = new Map((db.sites || []).map((site) => [String(site.id), String(site.status || '')]));

  function database() {
    return window.EdilKappaLocal?.getDB?.() || db;
  }

  function numberValue(value) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalized(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('it');
  }

  function dateOnly(value) {
    const raw = String(value || '');
    const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct) return direct[1];
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    const pad = (part) => String(part).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }

  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day, 12);
  }

  function isItalianHoliday(value) {
    const day = dateOnly(value);
    if (!day) return false;
    const [year, month, date] = day.split('-').map(Number);
    const fixed = new Set(['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26']);
    if (fixed.has(`${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`)) return true;
    const easterMonday = easterSunday(year);
    easterMonday.setDate(easterMonday.getDate() + 1);
    return dateOnly(easterMonday) === day;
  }

  function isOvertimeOnlyDay(value) {
    const day = dateOnly(value);
    if (!day) return false;
    const [year, month, date] = day.split('-').map(Number);
    const weekday = new Date(year, month - 1, date, 12).getDay();
    return weekday === 0 || weekday === 6 || isItalianHoliday(day);
  }

  function hourBreakdown(totalValue, date) {
    const total = Math.max(0, numberValue(totalValue));
    if (isOvertimeOnlyDay(date)) return { total, ordinary: 0, overtime: total };
    const ordinary = Math.min(REGULAR_DAY_HOURS, total);
    return { total, ordinary, overtime: Math.max(0, total - ordinary) };
  }

  function hourWorkerKey(entry) {
    return String(entry.worker || `legacy:${normalized(entry.workerName)}:${entry.team || ''}`);
  }

  function annotateHourRows(rows) {
    const indexed = (rows || []).map((entry, index) => ({ ...entry, __hourIndex: index }));
    const groups = new Map();
    indexed.forEach((entry) => {
      const key = `${hourWorkerKey(entry)}|${dateOnly(entry.date)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    const allocations = new Map();
    groups.forEach((entries) => {
      const sorted = entries.slice().sort((left, right) => String(left.createdAt || left.updatedAt || left.id || '').localeCompare(String(right.createdAt || right.updatedAt || right.id || '')));
      let ordinaryAvailable = isOvertimeOnlyDay(sorted[0]?.date) ? 0 : REGULAR_DAY_HOURS;
      sorted.forEach((entry) => {
        const total = Math.max(0, numberValue(entry.hours));
        const ordinary = Math.min(ordinaryAvailable, total);
        const overtime = Math.max(0, total - ordinary);
        ordinaryAvailable = Math.max(0, ordinaryAvailable - ordinary);
        allocations.set(entry.__hourIndex, { ordinary, overtime, total });
      });
    });
    return indexed.map((entry) => {
      const allocation = allocations.get(entry.__hourIndex) || { ordinary: 0, overtime: 0, total: 0 };
      const { __hourIndex, ...clean } = entry;
      return {
        ...clean,
        ordinaryHours: allocation.ordinary,
        overtimeHours: allocation.overtime,
        hourType: allocation.overtime > 0 ? 'Straordinario' : 'Ordinario'
      };
    });
  }

  function currentPerson() {
    return typeof currentStaff === 'function' ? currentStaff() : null;
  }

  function isCompleted(site) {
    return normalized(site?.status) === 'completato';
  }

  function siteLabel(site) {
    return [site?.title, site?.client].filter(Boolean).join(' · ') || 'Cantiere';
  }

  function completionDateSource(site) {
    return site?.hoursCloseoutDate
      || site?.hoursCloseoutRequiredAt
      || site?.completedAt
      || site?.end
      || site?.updatedAt
      || site?.__cloudUpdatedAt
      || '';
  }

  function siteCompletionDay(site) {
    return dateOnly(completionDateSource(site));
  }

  function siteNeedsHourCloseout(site) {
    if (!isCompleted(site)) return false;
    const day = siteCompletionDay(site);
    if (!day) return false;
    return Boolean(site.hoursCloseoutDate || site.hoursCloseoutRequiredAt) || day >= CLOSEOUT_FEATURE_START;
  }

  function personMatches(left, right) {
    if (!left || !right) return false;
    if (left.id && right.id && String(left.id) === String(right.id)) return true;
    return normalized(left.name) === normalized(right.name)
      && (!left.team || !right.team || String(left.team) === String(right.team));
  }

  function closeoutPeople(site) {
    const captured = Array.isArray(site?.hoursCloseoutWorkers) ? site.hoursCloseoutWorkers : [];
    const teamIds = typeof siteTeamIds === 'function' ? siteTeamIds(site) : [site?.worker].filter(Boolean);
    const fallback = teamIds
      .flatMap((teamId) => typeof staffForTeam === 'function' ? staffForTeam(teamId) : []);
    const cloudWorkers = (window.EdilKappaCloud?.workerProfiles || []).filter((person) => teamIds.includes(String(person.team || '')));
    // Ogni operaio vede solo il proprio profilo nel cloud: uniamo quindi lo
    // snapshot di chiusura ai componenti della squadra visibili localmente.
    const source = captured.concat(cloudWorkers.length ? cloudWorkers : fallback);
    const unique = [];
    source.forEach((person) => {
      const normalizedPerson = {
        id: String(person.id || ''),
        name: String(person.name || person.workerName || 'Operaio'),
        team: String(person.team || person.teamId || '')
      };
      if (!unique.some((item) => personMatches(item, normalizedPerson))) unique.push(normalizedPerson);
    });
    return unique;
  }

  function managedPeople() {
    const cloudWorkers = window.EdilKappaCloud?.workerProfiles || [];
    const source = cloudWorkers.length ? cloudWorkers : STAFF;
    const unique = [];
    source.forEach((person) => {
      const normalizedPerson = { id: String(person.id || ''), name: String(person.name || 'Operaio'), team: String(person.team || '') };
      if (!unique.some((item) => personMatches(item, normalizedPerson))) unique.push(normalizedPerson);
    });
    return unique;
  }

  function personExpectedForSite(person, site) {
    const people = closeoutPeople(site);
    if (people.length) return people.some((candidate) => personMatches(candidate, person));
    const teams = typeof siteTeamIds === 'function' ? siteTeamIds(site) : [site?.worker].filter(Boolean);
    return teams.includes(String(person?.team || ''));
  }

  function entryBelongsToPerson(entry, person) {
    if (!entry || !person) return false;
    if (entry.worker && String(entry.worker) === String(person.id)) return true;
    return normalized(entry.workerName) === normalized(person.name)
      && (!entry.team || !person.team || String(entry.team) === String(person.team));
  }

  function entryLinksSite(entry, site) {
    if (String(entry?.siteId || '') === String(site?.id || '')) return true;
    const job = normalized(entry?.job);
    if (!job) return false;
    return job === normalized(`site:${site?.id}`)
      || job === normalized(site?.title)
      || job === normalized(siteLabel(site));
  }

  function personHasCompletionHours(person, site) {
    const day = siteCompletionDay(site);
    if (!day) return false;
    return (database().timesheets || []).some((entry) => entryBelongsToPerson(entry, person)
      && dateOnly(entry.date) === day
      && entryLinksSite(entry, site)
      && numberValue(entry.hours) > 0);
  }

  function workerCanSeeSite(site, person = currentPerson()) {
    if (!isCompleted(site)) return true;
    if (!person || !siteNeedsHourCloseout(site) || !personExpectedForSite(person, site)) return false;
    return !personHasCompletionHours(person, site);
  }

  function missingCompletedSites(person = currentPerson()) {
    if (!person) return [];
    return (database().sites || []).filter((site) => {
      if (window.EdilKappaAttendance?.isAbsent?.(person, siteCompletionDay(site), { fullDayOnly: true })) return false;
      const assigned = typeof siteHasTeam === 'function' ? siteHasTeam(site, person.team) : String(site.worker || '') === String(person.team || '');
      return assigned && isCompleted(site) && siteNeedsHourCloseout(site) && personExpectedForSite(person, site) && !personHasCompletionHours(person, site);
    });
  }

  function missingPeopleForSite(site) {
    if (!siteNeedsHourCloseout(site)) return [];
    const day = siteCompletionDay(site);
    return closeoutPeople(site).filter((person) => !window.EdilKappaAttendance?.isAbsent?.(person, day, { fullDayOnly: true }) && !personHasCompletionHours(person, site));
  }

  function allCloseoutPending() {
    return (database().sites || []).filter(siteNeedsHourCloseout).map((site) => ({ site, people: missingPeopleForSite(site) })).filter((row) => row.people.length);
  }

  function hasHoursOnDay(person, day) {
    return (database().timesheets || []).some((entry) => entryBelongsToPerson(entry, person) && dateOnly(entry.date) === day && numberValue(entry.hours) > 0);
  }

  function isAfterReminder(person) {
    const now = new Date();
    const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return clock >= String(person?.reminderTime || '18:00');
  }

  function stampCompletionTransitions() {
    const now = new Date().toISOString();
    const today = typeof localToday === 'function' ? localToday() : dateOnly(now);
    const seen = new Set();
    (database().sites || []).forEach((site) => {
      const id = String(site.id || '');
      const status = String(site.status || '');
      const previous = siteStatusSnapshot.get(id);
      seen.add(id);
      if (isCompleted(site) && previous !== 'Completato') {
        const closeoutDay = dateOnly(site.hoursCloseoutDate) || today;
        site.completedAt = now;
        site.hoursCloseoutDate = closeoutDay;
        site.hoursCloseoutRequiredAt = now;
        site.hoursCloseoutWorkers = closeoutPeople(site);
        site.updatedAt = now;
      } else if (!isCompleted(site) && previous === 'Completato') {
        site.previousCompletedAt = site.completedAt || site.updatedAt || '';
        site.completedAt = '';
        site.hoursCloseoutDate = '';
        site.hoursCloseoutRequiredAt = '';
        site.hoursCloseoutWorkers = [];
        site.updatedAt = now;
      }
      siteStatusSnapshot.set(id, status);
    });
    Array.from(siteStatusSnapshot.keys()).filter((id) => !seen.has(id)).forEach((id) => siteStatusSnapshot.delete(id));
  }

  function refreshSiteStatusSnapshot() {
    siteStatusSnapshot.clear();
    (database().sites || []).forEach((site) => siteStatusSnapshot.set(String(site.id || ''), String(site.status || '')));
  }

  function storeHourBreakdowns() {
    const entries = (database().timesheets || []).filter((entry) => entry.worker);
    const annotated = annotateHourRows(entries);
    const byId = new Map(annotated.map((entry) => [String(entry.id), entry]));
    entries.forEach((entry) => {
      const calculated = byId.get(String(entry.id));
      if (!calculated) return;
      entry.ordinaryHours = calculated.ordinaryHours;
      entry.overtimeHours = calculated.overtimeHours;
      entry.hourType = calculated.hourType;
    });
  }

  function reminderKey(person, day) {
    return `ek_hours_reminder_${person?.id || 'worker'}_${day}`;
  }

  function reminderNotificationTag(person) {
    return `ek_hours_reminder_${person?.id || 'worker'}`;
  }

  async function closeReminderNotification(person, day) {
    localStorage.removeItem(reminderKey(person, day));
    try {
      const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      const notifications = registration?.getNotifications ? await registration.getNotifications({ tag: reminderNotificationTag(person) }) : [];
      notifications.forEach((notification) => notification.close());
    } catch (_) {}
  }

  const baseSave = save;
  save = function () {
    stampCompletionTransitions();
    storeHourBreakdowns();
    const result = baseSave();
    const person = currentPerson();
    const today = typeof localToday === 'function' ? localToday() : dateOnly(new Date());
    if (person && hasHoursOnDay(person, today) && !missingCompletedSites(person).length) closeReminderNotification(person, today);
    return result;
  };

  function breakdownLabel(entry) {
    const ordinary = numberValue(entry.ordinaryHours);
    const overtime = numberValue(entry.overtimeHours);
    if (!overtime) return `${ordinary.toFixed(1)} ordinarie`;
    if (!ordinary) return `${overtime.toFixed(1)} straordinarie`;
    return `${ordinary.toFixed(1)} ordinarie · ${overtime.toFixed(1)} straordinarie`;
  }

  function workerAlertHtml(person = currentPerson()) {
    if (!person) return '';
    const today = typeof localToday === 'function' ? localToday() : dateOnly(new Date());
    const missingSites = missingCompletedSites(person);
    const dailyMissing = isAfterReminder(person) && !window.EdilKappaAttendance?.isAbsent?.(person, today, { fullDayOnly: true }) && !hasHoursOnDay(person, today);
    if (!missingSites.length && !dailyMissing) return '';
    const rows = missingSites.map((site) => `<div class="hoursAlertRow"><span><b>${esc(site.title || 'Cantiere concluso')}</b><small>${esc(site.client || '')} · concluso il ${esc(siteCompletionDay(site))}</small></span><button class="btn sm red" type="button" onclick="openCloseoutHours('${esc(site.id)}')">Inserisci ore</button></div>`).join('');
    return `<section class="hoursPersistentAlert" role="alert" aria-live="assertive"><div class="hoursAlertTitle"><span>!</span><div><h3>Ore da completare</h3><p>L’avviso rimane finché non inserisci le tue ore.</p></div></div>${rows}${dailyMissing && !missingSites.length ? '<div class="hoursAlertRow"><span><b>Ore di oggi non inserite</b><small>Comunica il totale delle ore lavorate.</small></span><button class="btn sm red" type="button" onclick="go(\'hours\')">Inserisci ore</button></div>' : ''}</section>`;
  }

  window.openCloseoutHours = function (siteId) {
    const site = (database().sites || []).find((item) => String(item.id) === String(siteId));
    const person = currentPerson();
    if (!site || !person) return alert('Cantiere o profilo operaio non disponibile.');
    if (!workerCanSeeSite(site, person)) return alert('Le ore di chiusura risultano già comunicate.');
    const day = siteCompletionDay(site) || (typeof localToday === 'function' ? localToday() : dateOnly(new Date()));
    modal('Ore del cantiere concluso', `<div class="hoursCloseoutSummary"><b>${esc(siteLabel(site))}</b><small>Data conclusione: ${esc(day)}</small></div><div class="formGrid"><div class="field"><label>Data</label><input name="date" type="date" value="${esc(day)}" readonly></div><div class="field"><label>Totale ore lavorate</label><input name="hours" type="number" min="0.5" max="24" step="0.5" inputmode="decimal" required autofocus></div><div class="field full"><label>Note facoltative</label><textarea name="notes" placeholder="Informazioni utili sul lavoro concluso"></textarea></div></div>`, (formData) => {
      const hours = numberValue(formData.get('hours'));
      if (hours <= 0 || hours > 24) throw new Error('Inserisci un totale maggiore di zero e non superiore a 24 ore.');
      const team = WORKERS.find((item) => String(item.id) === String(person.team));
      const split = hourBreakdown(hours, day);
      database().timesheets.push({
        id: uid('ore'),
        date: day,
        worker: person.id,
        workerName: person.name,
        team: person.team,
        teamName: team?.name || 'Senza squadra',
        workType: 'site',
        job: siteLabel(site),
        siteId: site.id,
        interventionId: site.interventionId || '',
        clientId: site.clientId || '',
        hours,
        ordinaryHours: split.ordinary,
        overtimeHours: split.overtime,
        hourType: split.overtime > 0 ? 'Straordinario' : 'Ordinario',
        notes: String(formData.get('notes') || ''),
        closeoutHours: true,
        createdAt: new Date().toISOString()
      });
    });
  };

  window.openOfficeHoursEntry = function () {
    if (!isOffice()) return alert('Questa funzione è riservata al titolare e all’ufficio.');
    const people = managedPeople().sort((left, right) => String(left.name).localeCompare(String(right.name), 'it'));
    const sites = (database().sites || []).slice().sort((left, right) => String(left.title || '').localeCompare(String(right.title || ''), 'it'));
    if (!people.length) return alert('Non risultano operai configurati. Inserisci prima gli operai nelle squadre.');
    if (!sites.length) return alert('Non risultano cantieri. Crea prima il lavoro o il cantiere.');
    const today = typeof localToday === 'function' ? localToday() : dateOnly(new Date());
    const peopleOptions = people.map((person) => `<option value="${esc(person.id)}">${esc(person.name)} · ${esc(WORKERS.find((team) => String(team.id) === String(person.team))?.name || 'Senza squadra')}</option>`).join('');
    const siteOptions = sites.map((site) => `<option value="${esc(site.id)}">${esc(siteLabel(site))}${site.address ? ` · ${esc(site.address)}` : ''}</option>`).join('');
    modal('Registra ore operaio', `<div class="notice"><b>Inserimento del titolare</b><br>Scegli il singolo operaio e il cantiere dove ha lavorato. Oltre 8 ore, sabato, domenica e festivi vengono calcolati automaticamente come straordinari.</div><div class="formGrid"><div class="field"><label>Operaio</label><select name="worker" required>${peopleOptions}</select></div><div class="field"><label>Data</label><input name="date" type="date" value="${esc(today)}" required></div><div class="field full"><label>Dove ha lavorato</label><select name="siteId" required>${siteOptions}</select></div><div class="field"><label>Totale ore lavorate</label><input name="hours" type="number" min="0.5" max="24" step="0.5" inputmode="decimal" required autofocus></div><div class="field full"><label>Note facoltative</label><textarea name="notes" placeholder="Lavorazione svolta, trasferta o informazioni utili"></textarea></div></div>`, (formData) => {
      const person = people.find((item) => String(item.id) === String(formData.get('worker')));
      const site = sites.find((item) => String(item.id) === String(formData.get('siteId')));
      const day = dateOnly(formData.get('date'));
      const hours = numberValue(formData.get('hours'));
      if (!person || !site) throw new Error('Seleziona operaio e cantiere.');
      if (!day) throw new Error('Seleziona una data valida.');
      if (hours <= 0 || hours > 24) throw new Error('Inserisci un totale maggiore di zero e non superiore a 24 ore.');
      const team = WORKERS.find((item) => String(item.id) === String(person.team));
      const split = hourBreakdown(hours, day);
      database().timesheets ||= [];
      database().timesheets.push({ id: uid('ore'), date: day, worker: person.id, workerName: person.name, team: person.team || '', teamName: team?.name || 'Senza squadra', workType: 'site', job: siteLabel(site), siteId: site.id, interventionId: site.interventionId || '', clientId: site.clientId || '', hours, ordinaryHours: split.ordinary, overtimeHours: split.overtime, hourType: split.overtime > 0 ? 'Straordinario' : 'Ordinario', notes: String(formData.get('notes') || ''), enteredByOffice: true, createdAt: new Date().toISOString() });
    });
  };

  worker = function () {
    const person = currentPerson();
    const teamId = typeof currentTeamId === 'function' ? currentTeamId() : person?.team || '';
    const team = WORKERS.find((item) => String(item.id) === String(teamId));
    const tasks = [];
    (database().sites || []).filter((site) => (typeof siteHasTeam === 'function' ? siteHasTeam(site, teamId) : String(site.worker || '') === String(teamId)) && workerCanSeeSite(site, person)).forEach((site) => {
      const closeout = isCompleted(site);
      tasks.push({
        icon: closeout ? '⏱️' : '🏗️',
        title: site.title,
        client: site.client,
        address: site.address,
        status: closeout ? 'Ore da completare' : site.status,
        action: closeout ? `openCloseoutHours('${site.id}')` : `openReport('${site.id}')`,
        label: closeout ? 'Inserisci le mie ore' : 'Inserisci aggiornamento',
        photoAction: `window.openQuickPhotoUpload?openQuickPhotoUpload('${site.id}'):openReport('${site.id}')`,
        closeout,
        kind: 'site'
      });
    });
    (database().roofs || []).filter((item) => item.worker === teamId && item.status !== 'Completato').forEach((item) => tasks.push({ icon: '🧹', title: item.type, client: item.client, address: item.address, status: item.status, action: `updateRoofTask('${item.id}')`, photoAction: `updateRoofTask('${item.id}')`, label: 'Aggiorna lavoro', kind: 'roof' }));
    (database().drains || []).filter((item) => item.worker === teamId && item.status !== 'Completato').forEach((item) => tasks.push({ icon: '🕳️', title: item.type, client: item.client, address: item.address, status: item.status, action: `updateDrainTask('${item.id}')`, photoAction: `updateDrainTask('${item.id}')`, label: 'Aggiorna lavoro', kind: 'drain' }));
    const missingCount = missingCompletedSites(person).length;
    const today = typeof localToday === 'function' ? localToday() : dateOnly(new Date());
    const todayRows = annotateHourRows(individualHourRows().filter((entry) => entry.worker === role && dateOnly(entry.date) === today));
    const todayHours = todayRows.reduce((sum, entry) => sum + numberValue(entry.hours), 0);
    const absent = Boolean(window.EdilKappaAttendance?.isAbsent?.(person, today, { fullDayOnly: true }));
    const photoCount = (database().reports || []).filter((report) => String(report.worker || '') === String(person?.id || '') || String(report.workerName || '') === String(person?.name || '')).reduce((sum, report) => sum + Math.max(numberValue(report.photoCount), Array.isArray(report.photos) ? report.photos.length : 0), 0);
    const mainTask = tasks[0], otherTasks = tasks.slice(1);
    const taskCard = (item, main = false) => `<section class="card workerTaskCard ${item.closeout ? 'hoursCloseoutCard' : ''}"><div class="workerTaskTop"><div class="rowIcon">${item.icon}</div><div class="rowBody"><b>${esc(item.title)}</b><small>${esc(item.client)} · ${esc(item.address)}</small></div>${item.closeout ? '<span class="pill red">Ore mancanti</span>' : badge(item.status)}</div><div class="workerTaskActions"><button class="btn ${item.closeout ? 'red' : 'green'}" onclick="${item.action}">${esc(item.label)}</button>${!item.closeout ? `<button class="btn light" onclick="${item.photoAction}">📷 Foto / completa</button>` : ''}<a class="btn light" href="https://maps.apple.com/?q=${encodeURIComponent(item.address || '')}">Indicazioni</a></div></section>`;
    const hourPrompt = absent
      ? `<section class="workerHoursPrompt ok"><div class="workerHoursPromptIcon">✓</div><div class="workerHoursPromptBody"><b>Assenza registrata per oggi</b><small>Non riceverai il promemoria delle ore.</small></div><button class="btn light" onclick="go('attendance')">Apri assenze</button></section>`
      : todayRows.length
        ? `<section class="workerHoursPrompt ok"><div class="workerHoursPromptIcon">✓</div><div class="workerHoursPromptBody"><b>Ore di oggi comunicate</b><small>${todayHours.toFixed(1)} ore totali. Puoi modificarle dalla sezione Ore.</small></div><button class="btn light" onclick="go('hours')">Controlla ore</button></section>`
        : `<section class="workerHoursPrompt"><div class="workerHoursPromptIcon">!</div><div class="workerHoursPromptBody"><b>Ore di oggi non inserite</b><small>Oltre 8 ore, lo straordinario viene separato automaticamente.</small></div><button class="btn" onclick="go('hours')">Inserisci ore</button></section>`;
    return `<div class="workerDashboard"><div class="workerPageHeader"><div><span class="eyebrow">Buongiorno, ${esc(roleName())}</span><h2>I miei lavori</h2><p>${esc(team?.name || 'Senza squadra')} · attività assegnate alla tua squadra.</p></div><div class="actions"><button class="btn lime" onclick="captureInfo()">📷 Carica foto</button></div></div>
      ${workerAlertHtml(person)}
      <div class="grid stats workerStats">${stat('Lavori assegnati',tasks.length,'▣','da eseguire')}${stat('Ore inserite oggi',todayHours.toFixed(1),'◷',todayRows.length?'comunicate':'da inserire')}${stat('Foto caricate',photoCount,'📷','nei tuoi rapportini')}${stat('Avvisi',missingCount,'!','chiusure con ore mancanti')}</div>
      ${hourPrompt}
      <div class="workerMainGrid"><div><div class="cardHead"><h3>Cantiere di oggi</h3></div>${mainTask?taskCard(mainTask,true):'<div class="empty">Nessun lavoro assegnato per oggi.</div>'}${otherTasks.length?`<div style="height:18px"></div><div class="cardHead"><h3>Altri lavori assegnati</h3></div><div class="workerOtherList">${otherTasks.map(item=>taskCard(item)).join('')}</div>`:''}</div><aside class="card"><div class="cardHead"><h3>Azioni rapide</h3></div><div class="workerQuickPanel"><button class="workerQuickAction" onclick="go('hours')"><span>⏱️</span>Comunica le mie ore</button><button class="workerQuickAction" onclick="go('report')"><span>📝</span>Nuovo rapportino</button><button class="workerQuickAction" onclick="captureInfo()"><span>📷</span>Carica fotografie</button><button class="workerQuickAction" onclick="go('attendance')"><span>📅</span>Segnala assenza</button><button class="workerQuickAction" onclick="callOwner()"><span>☎️</span>Chiama il titolare</button></div></aside></div>
    </div>`;
  };

  workerIndividualHours = function () {
    const person = currentPerson();
    const team = WORKERS.find((item) => item.id === person?.team);
    const today = typeof localToday === 'function' ? localToday() : dateOnly(new Date());
    const todayEntries = annotateHourRows(individualHourRows().filter((entry) => entry.worker === role && dateOnly(entry.date) === today));
    const monthEntries = annotateHourRows(individualHourRows().filter((entry) => entry.worker === role && String(entry.date || '').startsWith(timesheetMonth)));
    const total = monthEntries.reduce((sum, entry) => sum + numberValue(entry.hours), 0);
    const ordinary = monthEntries.reduce((sum, entry) => sum + numberValue(entry.ordinaryHours), 0);
    const overtime = monthEntries.reduce((sum, entry) => sum + numberValue(entry.overtimeHours), 0);
    return pageHead('Comunica le mie ore', 'Inserisci soltanto il totale delle tue ore') + workerAlertHtml(person) + `<div class="notice"><b>${esc(person?.name || 'Operaio')} · ${esc(team?.name || 'Senza squadra')}</b><br>Fino a 8 ore sono ordinarie; quelle successive vengono segnate automaticamente come straordinarie. Sabato, domenica e festivi sono straordinari.</div><div class="actions" style="margin:14px 0"><button class="btn light" onclick="requestHourNotifications()">🔔 Attiva notifica</button><button class="btn light" onclick="downloadHoursReminder()">📅 Promemoria giornaliero</button></div><div class="grid cols"><section class="card"><h3>Le mie ore di oggi</h3><form class="formGrid" onsubmit="saveIndividualHours(event)">${field('Data', 'date', 'date', today)}<div class="field"><label>Lavoro / cantiere</label><select name="job" required>${teamJobOptions(person?.team || '')}</select></div><div class="field"><label>Totale ore lavorate</label><input name="hours" type="number" min="0.5" max="24" step="0.5" inputmode="decimal" required></div><div class="field full"><label>Note</label><textarea name="notes" placeholder="Trasferta o altre informazioni utili"></textarea></div><div class="field full"><button class="btn lime" type="submit">Comunica le mie ore</button></div></form></section><section class="card"><div class="cardHead"><h3>Oggi</h3>${badge(todayEntries.length ? 'Comunicate' : 'Da comunicare')}</div><div class="list">${todayEntries.map((entry) => `<div class="row"><div class="rowIcon">⏱️</div><div class="rowBody"><b>${esc(entry.job)}</b><small>${numberValue(entry.hours).toFixed(1)} ore · ${esc(breakdownLabel(entry))}</small></div><button class="btn sm light" onclick="openIndividualHoursEntry('${entry.id}')">Modifica</button></div>`).join('') || '<div class="empty">Non hai ancora comunicato le ore di oggi.</div>'}</div><div class="hoursTotals"><span>Totale mese <b>${total.toFixed(1)}</b></span><span>Ordinarie <b>${ordinary.toFixed(1)}</b></span><span class="overtime">Straordinarie <b>${overtime.toFixed(1)}</b></span></div></section></div>`;
  };

  officeIndividualHours = function () {
    const entries = annotateHourRows(filteredIndividualHours());
    const today = typeof localToday === 'function' ? localToday() : dateOnly(new Date());
    const missingToday = managedPeople().filter((person) => !window.EdilKappaAttendance?.isAbsent?.(person, today, { fullDayOnly: true }) && !hasHoursOnDay(person, today));
    const totals = {};
    entries.forEach((entry) => {
      const key = entry.worker || `${entry.workerName}|${entry.team}`;
      if (!totals[key]) totals[key] = { name: entry.workerName, team: entry.teamName, total: 0, ordinary: 0, overtime: 0, days: new Set() };
      totals[key].total += numberValue(entry.hours);
      totals[key].ordinary += numberValue(entry.ordinaryHours);
      totals[key].overtime += numberValue(entry.overtimeHours);
      if (numberValue(entry.hours) > 0) totals[key].days.add(entry.date);
    });
    const people = Object.values(totals).sort((left, right) => String(left.team).localeCompare(String(right.team), 'it') || String(left.name).localeCompare(String(right.name), 'it'));
    const totalHours = people.reduce((sum, person) => sum + person.total, 0);
    const ordinaryHours = people.reduce((sum, person) => sum + person.ordinary, 0);
    const overtimeHours = people.reduce((sum, person) => sum + person.overtime, 0);
    const closeout = allCloseoutPending();
    return pageHead('Ore operai', 'Totali individuali con straordinari automatici', '<button class="btn lime" onclick="printHoursPdf()">Stampa / salva PDF</button>') + `<div class="grid stats">${stat('Ore complessive', totalHours.toFixed(1), '⏱️')}${stat('Ore ordinarie', ordinaryHours.toFixed(1), '◷')}${stat('Ore straordinarie', overtimeHours.toFixed(1), '↗')}${stat('Chiusure da completare', closeout.reduce((sum, row) => sum + row.people.length, 0), '!')}</div>${closeout.length ? `<section class="hoursOwnerAlert"><h3>Ore mancanti sui cantieri conclusi</h3><p>Il cantiere resta visibile soltanto agli operai indicati finché non comunicano le ore.</p>${closeout.map((row) => `<div class="hoursAlertRow"><span><b>${esc(row.site.title || 'Cantiere')}</b><small>${esc(row.people.map((person) => person.name).join(', '))}</small></span><button class="btn sm light" onclick="openSite('${esc(row.site.id)}')">Apri cantiere</button></div>`).join('')}</section><div style="height:14px"></div>` : ''}${missingToday.length ? `<div class="notice"><b>Non hanno comunicato le ore oggi:</b> ${missingToday.map((person) => esc(person.name)).join(', ')}</div><div style="height:14px"></div>` : ''}<div class="card"><div class="actions" style="margin-bottom:14px"><input class="input" style="max-width:180px" type="month" value="${timesheetMonth}" onchange="setHoursMonth(this.value)"><select class="input" style="max-width:220px" onchange="setHoursTeam(this.value)"><option value="">Tutte le squadre</option>${WORKERS.map((team) => `<option value="${team.id}" ${team.id === timesheetTeam ? 'selected' : ''}>${esc(team.name)}</option>`).join('')}</select></div><div class="cardHead"><h3>Totale per ogni operaio</h3></div><div class="tableWrap"><table class="table"><thead><tr><th>Operaio</th><th>Squadra</th><th>Giorni</th><th>Totale</th><th>Ordinarie</th><th>Straordinarie</th></tr></thead><tbody>${people.map((person) => `<tr><td><b>${esc(person.name)}</b></td><td>${esc(person.team)}</td><td>${person.days.size}</td><td class="money">${person.total.toFixed(1)}</td><td class="money">${person.ordinary.toFixed(1)}</td><td class="money overtimeText">${person.overtime.toFixed(1)}</td></tr>`).join('') || '<tr><td colspan="6">Nessuna ora registrata.</td></tr>'}</tbody></table></div></div><div style="height:16px"></div><div class="card"><div class="cardHead"><h3>Dettaglio giornaliero</h3></div><div class="tableWrap"><table class="table"><thead><tr><th>Data</th><th>Operaio</th><th>Squadra</th><th>Lavoro</th><th>Totale</th><th>Ordinarie</th><th>Straordinarie</th><th>Note</th><th></th></tr></thead><tbody>${entries.map((entry) => `<tr><td>${esc(entry.date)}</td><td><b>${esc(entry.workerName)}</b></td><td>${esc(entry.teamName)}</td><td>${esc(entry.job)}</td><td class="money">${numberValue(entry.hours).toFixed(1)}</td><td>${numberValue(entry.ordinaryHours).toFixed(1)}</td><td class="overtimeText">${numberValue(entry.overtimeHours).toFixed(1)}</td><td>${esc(entry.notes || '')}</td><td>${entry.legacy ? 'Dato precedente' : `<div class="actions"><button class="btn sm light" onclick="openIndividualHoursEntry('${entry.id}')">Modifica</button><button class="btn sm red" onclick="deleteItem('timesheets','${entry.id}','questa registrazione ore')">Elimina</button></div>`}</td></tr>`).join('') || '<tr><td colspan="9">Nessuna ora registrata nel periodo.</td></tr>'}</tbody></table></div></div>`;
  };

  const officeHoursWithEntryButton = officeIndividualHours;
  officeIndividualHours = function () {
    return officeHoursWithEntryButton().replace('<button class="btn lime" onclick="printHoursPdf()">', '<button class="btn green" onclick="openOfficeHoursEntry()">＋ Registra ore</button><button class="btn lime" onclick="printHoursPdf()">');
  };

  printHoursPdf = function () {
    const entries = annotateHourRows(filteredIndividualHours());
    const totals = {};
    entries.forEach((entry) => {
      const key = entry.worker || `${entry.workerName}|${entry.team}`;
      if (!totals[key]) totals[key] = { name: entry.workerName, team: entry.teamName, total: 0, ordinary: 0, overtime: 0 };
      totals[key].total += numberValue(entry.hours);
      totals[key].ordinary += numberValue(entry.ordinaryHours);
      totals[key].overtime += numberValue(entry.overtimeHours);
    });
    const popup = window.open('', '_blank');
    if (!popup) return alert('Consenti l’apertura della finestra per generare il PDF.');
    const summary = Object.values(totals).map((person) => `<tr><td>${esc(person.name)}</td><td>${esc(person.team)}</td><td>${person.total.toFixed(1)}</td><td>${person.ordinary.toFixed(1)}</td><td>${person.overtime.toFixed(1)}</td></tr>`).join('');
    const detail = entries.map((entry) => `<tr><td>${esc(entry.date)}</td><td>${esc(entry.workerName)}</td><td>${esc(entry.teamName)}</td><td>${esc(entry.job)}</td><td>${numberValue(entry.hours).toFixed(1)}</td><td>${numberValue(entry.ordinaryHours).toFixed(1)}</td><td>${numberValue(entry.overtimeHours).toFixed(1)}</td><td>${esc(entry.notes || '')}</td></tr>`).join('');
    popup.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Ore operai ${esc(timesheetMonth)}</title><style>body{font-family:Arial;padding:28px;color:#172419}table{width:100%;border-collapse:collapse;margin:15px 0 28px}th,td{border:1px solid #bbb;padding:7px;font-size:10px;text-align:left}th{background:#eee}.overtime{color:#a63129;font-weight:bold}</style></head><body><h1>${esc(COMPANY.name)}</h1><p>${esc(COMPANY.address)}<br>P.IVA ${esc(COMPANY.vat)} · ${esc(COMPANY.phone)} · ${esc(COMPANY.email)}</p><hr><h2>Ore operai · ${esc(timesheetMonth)}</h2><h3>Totale individuale</h3><table><tr><th>Operaio</th><th>Squadra</th><th>Totale</th><th>Ordinarie</th><th>Straordinarie</th></tr>${summary}</table><h3>Dettaglio giornaliero</h3><table><tr><th>Data</th><th>Operaio</th><th>Squadra</th><th>Lavoro</th><th>Totale</th><th>Ordinarie</th><th class="overtime">Straordinarie</th><th>Note</th></tr>${detail}</table></body></html>`);
    popup.document.close();
    setTimeout(() => popup.print(), 400);
  };

  checkHourReminders = async function () {
    if (isOffice()) return;
    const person = currentPerson();
    if (!person) return;
    decoratePersistentAlert();
    const today = typeof localToday === 'function' ? localToday() : dateOnly(new Date());
    const pendingSites = missingCompletedSites(person);
    const dailyMissing = isAfterReminder(person) && !window.EdilKappaAttendance?.isAbsent?.(person, today, { fullDayOnly: true }) && !hasHoursOnDay(person, today);
    if (!pendingSites.length && !dailyMissing) return closeReminderNotification(person, today);
    if (!isAfterReminder(person) && !pendingSites.length) return;
    const key = reminderKey(person, today);
    const lastSent = Number(localStorage.getItem(key) || 0);
    if (Date.now() - lastSent < REMINDER_REPEAT_MS) return;
    if ('Notification' in window && Notification.permission === 'granted') {
      const body = pendingSites.length
        ? `Ore mancanti: ${pendingSites.map((site) => site.title || 'cantiere concluso').join(', ')}.`
        : `${person.name}, inserisci il totale delle ore lavorate oggi.`;
      try {
        const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
        const options = { body, tag: reminderNotificationTag(person), renotify: true, requireInteraction: true, data: { url: './?hours=1' } };
        if (registration) await registration.showNotification('Ore da completare · EDILKAPPA', options);
        else new Notification('Ore da completare · EDILKAPPA', options);
        localStorage.setItem(key, String(Date.now()));
      } catch (_) {}
    }
  };

  function decorateHourNavigation() {
    if (isOffice()) return;
    const person = currentPerson();
    if (!person) return;
    const today = typeof localToday === 'function' ? localToday() : dateOnly(new Date());
    const pendingSites = missingCompletedSites(person);
    const count = pendingSites.length || (isAfterReminder(person) && !window.EdilKappaAttendance?.isAbsent?.(person, today, { fullDayOnly: true }) && !hasHoursOnDay(person, today) ? 1 : 0);
    document.querySelectorAll('#desktopNav button, #mobileNav button').forEach((button) => {
      if (button.getAttribute('onclick') !== "go('hours')") return;
      button.querySelector('.hourNavBadge')?.remove();
      if (count) button.insertAdjacentHTML('beforeend', `<b class="hourNavBadge">${count}</b>`);
    });
  }

  function decoratePersistentAlert() {
    if (isOffice()) return;
    const app = document.getElementById?.('app');
    if (!app) return;
    const existing = app.querySelector('.hoursPersistentAlert');
    const html = workerAlertHtml(currentPerson());
    if (!html) return existing?.remove();
    if (!existing) app.insertAdjacentHTML('afterbegin', html);
  }

  const baseRenderNav = renderNav;
  renderNav = function () {
    baseRenderNav();
    decorateHourNavigation();
  };

  const baseDashboard = dashboard;
  dashboard = function () {
    const pending = allCloseoutPending();
    if (!pending.length) return baseDashboard();
    return baseDashboard() + pageHead('Ore mancanti sui cantieri conclusi', `${pending.reduce((sum, row) => sum + row.people.length, 0)} operai devono completare le ore`) + `<section class="hoursOwnerAlert">${pending.map((row) => `<div class="hoursAlertRow"><span><b>${esc(row.site.title || 'Cantiere')}</b><small>${esc(row.people.map((person) => person.name).join(', '))}</small></span><button class="btn sm light" onclick="go('hours')">Controlla ore</button></div>`).join('')}</section>`;
  };

  const baseRender = render;
  render = function () {
    baseRender();
    decorateHourNavigation();
    decoratePersistentAlert();
  };

  const style = document.createElement('style');
  style.textContent = `
    .hoursPersistentAlert,.hoursOwnerAlert{border:2px solid #d64b43;background:#fff0ef;color:#7e211c;border-radius:18px;padding:16px;margin:0 0 18px}.hoursAlertTitle{display:flex;gap:12px;align-items:center;margin-bottom:10px}.hoursAlertTitle>span{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#b52f28;color:#fff;font-size:22px;font-weight:900}.hoursAlertTitle h3,.hoursOwnerAlert h3{margin:0 0 3px}.hoursAlertTitle p,.hoursOwnerAlert p{margin:0;color:#7e211c;font-size:13px}.hoursAlertRow{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #efc1be}.hoursAlertRow>span{min-width:0;flex:1}.hoursAlertRow b,.hoursAlertRow small{display:block}.hoursAlertRow small{margin-top:3px;color:#86534f}.hoursCloseoutCard{border:2px solid #d64b43;background:#fffafa}.hoursCloseoutSummary{display:grid;gap:4px;padding:13px 14px;margin-bottom:14px;border-radius:14px;background:#fff0ef;color:#7e211c}.hoursTotals{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.hoursTotals span{background:#f1f3f1;border-radius:12px;padding:10px;font-size:12px}.hoursTotals b{display:block;margin-top:4px;font-size:19px}.hoursTotals .overtime,.overtimeText{color:#a63129;font-weight:800}.hourNavBadge{display:inline-grid;place-items:center;min-width:20px;height:20px;margin-left:7px;padding:0 5px;border-radius:999px;background:#d43f37;color:#fff;font-size:10px}.mobileNav .hourNavBadge{position:absolute;right:8px;top:6px;margin:0}.mobileNav button{position:relative}
    @media(max-width:620px){.hoursAlertRow{align-items:flex-start;flex-wrap:wrap}.hoursAlertRow .btn{width:100%}.hoursTotals{grid-template-columns:1fr}.hoursPersistentAlert,.hoursOwnerAlert{padding:13px}}
  `;
  document.head.appendChild(style);

  window.workerCanSeeSite = workerCanSeeSite;
  window.EdilKappaHours = {
    hourBreakdown,
    annotateHourRows,
    isItalianHoliday,
    isOvertimeOnlyDay,
    siteCompletionDay,
    siteNeedsHourCloseout,
    personHasCompletionHours,
    workerCanSeeSite,
    missingCompletedSites,
    missingPeopleForSite,
    allCloseoutPending
  };

  window.addEventListener('edilkappa:cloud-collection-synced', (event) => {
    const collectionName = String(event.detail?.localName || '');
    if (collectionName === 'sites') refreshSiteStatusSnapshot();
    if (['sites', 'timesheets'].includes(collectionName)) checkHourReminders();
  });

  window.addEventListener('edilkappa:cloud-users-synced', () => {
    if (isOffice() && window.EdilKappaLocal?.getView?.() !== 'portalView') render();
  });

  setTimeout(() => {
    if (new URL(window.location.href).searchParams.get('hours') === '1' && !isOffice()) {
      go('hours');
      history.replaceState({}, '', new URL('./', window.location.href));
    }
    checkHourReminders();
  }, 800);

  render();
})();
