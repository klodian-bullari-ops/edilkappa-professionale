(function () {
  'use strict';

  const TYPES = ['Ferie', 'Malattia', 'Permesso', 'Riposo', 'Infortunio', 'Formazione', 'Assenza giustificata', 'Assenza non giustificata'];
  const APPROVED = 'Approvata';
  const PENDING = 'In attesa';

  function database() {
    const value = window.EdilKappaLocal?.getDB?.() || window.db || {};
    if (!Array.isArray(value.absences)) value.absences = [];
    return value;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function today() {
    return typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
  }

  function officeUser() {
    const role = window.EdilKappaCloud?.currentProfile?.role;
    return ['owner', 'office'].includes(role) || (typeof isOffice === 'function' && isOffice());
  }

  function teams() {
    return Array.isArray(window.WORKERS) ? window.WORKERS : (typeof WORKERS !== 'undefined' ? WORKERS : []);
  }

  function people() {
    const rows = [];
    const seen = new Set();
    const seenNames = new Set();
    const add = (person) => {
      const id = String(person?.id || '');
      const normalizedName = String(person?.name || person?.displayName || '').trim().toLowerCase();
      if (!id || seen.has(id) || (normalizedName && seenNames.has(normalizedName))) return;
      seen.add(id);
      if (normalizedName) seenNames.add(normalizedName);
      rows.push({ id, name: person.name || person.displayName || id, team: String(person.team || person.teamId || ''), uid: person.uid || '' });
    };
    (window.EdilKappaCloud?.workerProfiles || []).forEach(add);
    (typeof STAFF !== 'undefined' && Array.isArray(STAFF) ? STAFF : []).forEach(add);
    teams().forEach((team) => {
      if (team.member1) add({ id: `${team.id}-1`, name: team.member1, team: team.id });
      if (team.member2) add({ id: `${team.id}-2`, name: team.member2, team: team.id });
    });
    return rows.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }

  function personIds(person) {
    return new Set([person?.id, person?.uid, person?.name].map((value) => String(value || '').toLowerCase()).filter(Boolean));
  }

  function belongs(row, person) {
    const ids = personIds(person);
    return ids.has(String(row.workerId || '').toLowerCase()) || ids.has(String(row.workerUid || '').toLowerCase()) || ids.has(String(row.workerName || '').toLowerCase());
  }

  function onDay(row, day) {
    return row.status === APPROVED && String(row.startDate || '') <= day && String(row.endDate || row.startDate || '') >= day;
  }

  function absenceFor(person, day = today()) {
    return database().absences.find((row) => belongs(row, person) && onDay(row, day)) || null;
  }

  function isAbsent(person, day = today(), options = {}) {
    const row = absenceFor(person, day);
    return Boolean(row && (!options.fullDayOnly || !row.partialDay));
  }

  function persist() {
    if (typeof save === 'function') save();
    else window.EdilKappaLocal?.persist?.();
    window.EdilKappaCloud?.scheduleSync?.();
    if (typeof render === 'function') render();
  }

  function selectedWorkerIds(form) {
    const scope = String(form.get('scope') || 'single');
    if (scope === 'all') return people().map((person) => person.id);
    if (scope === 'team') return people().filter((person) => person.team === String(form.get('teamId') || '')).map((person) => person.id);
    return form.getAll('workerIds').map(String).filter(Boolean);
  }

  function formBody(workerOnly = false) {
    const available = people();
    const self = currentWorker();
    const scope = workerOnly ? `<input type="hidden" name="scope" value="single"><input type="hidden" name="workerIds" value="${esc(self?.id || '')}">`
      : `<div class="field full"><label>Chi è assente</label><select name="scope" onchange="edilkappaAbsenceScope(this.value)"><option value="single">Uno o più operai</option><option value="team">Una squadra</option><option value="all">Tutta la squadra aziendale</option></select></div><div class="field full" id="absenceWorkers"><label>Operai</label><div style="display:grid;gap:8px">${available.map((person) => `<label><input type="checkbox" name="workerIds" value="${esc(person.id)}"> ${esc(person.name)}${person.team ? ` · ${esc(teams().find((team) => team.id === person.team)?.name || person.team)}` : ''}</label>`).join('')}</div></div><div class="field full" id="absenceTeam" hidden><label>Squadra</label><select name="teamId">${teams().map((team) => `<option value="${esc(team.id)}">${esc(team.name)}</option>`).join('')}</select></div>`;
    return `<div class="formGrid">${scope}<div class="field"><label>Tipo</label><select name="type">${TYPES.map((type) => `<option>${esc(type)}</option>`).join('')}</select></div><div class="field"><label>Durata</label><select name="partialDay"><option value="">Giornata intera</option><option value="1">Mezza giornata / alcune ore</option></select></div><div class="field"><label>Dal</label><input type="date" name="startDate" value="${today()}" required></div><div class="field"><label>Al</label><input type="date" name="endDate" value="${today()}" required></div><div class="field full"><label>Note interne (facoltative)</label><textarea name="notes" placeholder="Dettagli utili solo all’ufficio"></textarea></div></div>`;
  }

  function currentWorker() {
    const profile = window.EdilKappaCloud?.currentProfile;
    const uid = window.EdilKappaCloud?.currentUid;
    if (profile?.role === 'worker') return { id: uid || profile.uid, uid, name: profile.displayName || profile.email || 'Operaio', team: profile.teamId || '' };
    const roleId = typeof role !== 'undefined' ? String(role || '') : '';
    return people().find((person) => person.team === roleId) || null;
  }

  function addRows(form, workerOnly) {
    const startDate = String(form.get('startDate') || '');
    const endDate = String(form.get('endDate') || startDate);
    if (!startDate || endDate < startDate) throw new Error('Controlla le date dell’assenza.');
    const ids = workerOnly ? [currentWorker()?.id].filter(Boolean) : selectedWorkerIds(form);
    if (!ids.length) throw new Error('Seleziona almeno un operaio o una squadra.');
    const groupId = `absence-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const status = workerOnly ? PENDING : APPROVED;
    ids.forEach((id, index) => {
      const person = people().find((item) => item.id === id) || (workerOnly ? currentWorker() : null);
      if (!person) return;
      database().absences.push({
        id: `${groupId}-${index + 1}`, groupId, workerId: person.id, workerUid: person.uid || '', workerName: person.name,
        teamId: person.team || '', type: String(form.get('type') || 'Ferie'), startDate, endDate,
        partialDay: form.get('partialDay') === '1', notes: String(form.get('notes') || '').trim(), status,
        requestedBy: workerOnly ? 'worker' : 'office', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
    });
    persist();
    window.EdilKappaCompletion?.addActivity?.({ id: groupId, type: 'absence', title: workerOnly ? 'Nuova richiesta di assenza' : 'Assenza registrata', text: `${ids.length} ${ids.length === 1 ? 'operaio' : 'operai'} · ${startDate}${endDate !== startDate ? ` – ${endDate}` : ''}`, targetType: 'absence', targetId: groupId });
  }

  window.openAbsenceModal = () => {
    if (typeof modal !== 'function') return;
    modal(officeUser() ? 'Registra ferie o assenza' : 'Richiedi ferie o assenza', formBody(!officeUser()), (form) => addRows(form, !officeUser()));
  };

  window.edilkappaAbsenceScope = (scope) => {
    const workers = document.getElementById('absenceWorkers');
    const team = document.getElementById('absenceTeam');
    if (workers) workers.hidden = scope !== 'single';
    if (team) team.hidden = scope !== 'team';
  };

  window.setAbsenceStatus = (id, status) => {
    const row = database().absences.find((item) => item.id === id);
    if (!row || !officeUser()) return;
    row.status = status;
    row.updatedAt = new Date().toISOString();
    persist();
  };

  window.deleteAbsenceGroup = async (groupId) => {
    if (!officeUser() || !confirm('Eliminare questa assenza?')) return;
    const rows = database().absences.filter((row) => row.groupId === groupId || row.id === groupId);
    try {
      const tombstones = await Promise.all(rows.map((row) => window.EdilKappaCloud?.softDeleteRecord?.('absences', row)));
      if (tombstones.some((row) => !row)) throw new Error('Il collegamento cloud non è ancora pronto.');
      database().absences = database().absences.filter((row) => row.groupId !== groupId && row.id !== groupId);
      database().trash = [...(database().trash || []), ...tombstones];
      persist();
    } catch (error) { alert(error.message || 'Non è stato possibile spostare l’assenza nel cestino.'); }
  };

  function statusBadge(status) {
    const color = status === APPROVED ? '#167448' : status === 'Rifiutata' ? '#ad2a2a' : '#9a6a00';
    return `<span style="color:${color};font-weight:800">${esc(status)}</span>`;
  }

  function attendanceView() {
    const all = database().absences.slice().sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
    const rows = officeUser() ? all : all.filter((row) => belongs(row, currentWorker()));
    const pending = rows.filter((row) => row.status === PENDING).length;
    const todayCount = rows.filter((row) => onDay(row, today()) && !row.partialDay).length;
    const actions = `<button class="btn lime" onclick="openAbsenceModal()">${officeUser() ? '+ Registra assenza' : '+ Richiedi assenza'}</button>`;
    const head = typeof pageHead === 'function' ? pageHead('Ferie e assenze', officeUser() ? 'Singoli operai, selezioni multiple e intere squadre' : 'Le tue richieste e assenze registrate', actions) : `<h2>Ferie e assenze</h2>${actions}`;
    return `${head}<div class="grid stats">${typeof stat === 'function' ? stat('Assenti oggi', todayCount, '🏖️') + stat('Richieste in attesa', pending, '◷') + stat('Registrazioni', rows.length, '▤') : ''}</div><div style="height:16px"></div><div class="card"><div class="cardHead"><h3>Calendario e richieste</h3></div><div class="tableWrap"><table class="table"><thead><tr><th>Operaio</th><th>Tipo</th><th>Periodo</th><th>Durata</th><th>Stato</th>${officeUser() ? '<th></th>' : ''}</tr></thead><tbody>${rows.map((row) => `<tr><td><b>${esc(row.workerName)}</b></td><td>${esc(row.type)}</td><td>${esc(row.startDate)}${row.endDate !== row.startDate ? ` → ${esc(row.endDate)}` : ''}</td><td>${row.partialDay ? 'Parziale' : 'Giornata intera'}</td><td>${statusBadge(row.status)}</td>${officeUser() ? `<td><div class="actions">${row.status === PENDING ? `<button class="btn sm lime" onclick="setAbsenceStatus('${esc(row.id)}','${APPROVED}')">Approva</button><button class="btn sm red" onclick="setAbsenceStatus('${esc(row.id)}','Rifiutata')">Rifiuta</button>` : ''}<button class="btn sm light" onclick="deleteAbsenceGroup('${esc(row.groupId || row.id)}')">Elimina</button></div></td>` : ''}</tr>`).join('') || `<tr><td colspan="${officeUser() ? 6 : 5}" class="center muted">Nessuna assenza registrata.</td></tr>`}</tbody></table></div></div>`;
  }

  const baseRender = window.render;
  if (typeof baseRender === 'function') {
    window.render = function () {
      if (window.EdilKappaLocal?.getView?.() === 'attendance' || (typeof view !== 'undefined' && view === 'attendance')) {
        if (!officeUser() && !currentWorker()) return baseRender();
        if (typeof renderNav === 'function') renderNav();
        const app = document.getElementById('app');
        if (app) app.innerHTML = attendanceView();
        const title = document.getElementById('pageTitle');
        if (title) title.textContent = 'Ferie e assenze';
        return;
      }
      return baseRender();
    };
  }

  window.EdilKappaAttendance = { absenceFor, isAbsent, attendanceView, APPROVED, PENDING };
  if (typeof more === 'function') {
    const baseMore = more;
    more = function () {
      return baseMore() + (officeUser() ? `<div class="grid quick"><button onclick="go('attendance')"><span>🏖️</span>Ferie e assenze</button></div>` : '');
    };
  }
})();
