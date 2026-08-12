/**
 * Ponte Gmail -> EdilKappa per le richieste Danea.
 * Usa l'identità Google dell'account che esegue lo script per scrivere nella
 * coda privata Firestore. Non richiede endpoint pubblici né chiavi condivise.
 */
const DANEA_QUERY = 'from:no-reply@miocondominio.eu subject:"Richiesta intervento" newer_than:30d -label:EdilKappa-Danea-importata';
const DANEA_LABEL = 'EdilKappa-Danea-importata';
const DANEA_FIRESTORE_QUEUE = 'https://firestore.googleapis.com/v1/projects/edilkappa-professionale/databases/edilkappa/documents/daneaInbox';
const DANEA_FIRESTORE_STATUS = 'https://firestore.googleapis.com/v1/projects/edilkappa-professionale/databases/edilkappa/documents/integrations/daneaGmailBridge';

function daneaStringField(value) {
  return { stringValue: String(value || '') };
}

function daneaIntegerField(value) {
  return { integerValue: String(Math.max(0, Number(value || 0))) };
}

function reportDaneaHeartbeat(details) {
  const now = new Date();
  const fields = {
    mailbox: daneaStringField(Session.getActiveUser().getEmail() || 'info@edilkappa.com'),
    polling: { booleanValue: !details.error },
    lastPollAtMs: daneaIntegerField(now.getTime()),
    lastPollAt: { timestampValue: now.toISOString() },
    lastPollError: daneaStringField(details.error || ''),
    lastPollMatched: daneaIntegerField(details.matched),
    lastPollQueued: daneaIntegerField(details.queued)
  };
  const masks = Object.keys(fields).map(function (name) {
    return 'updateMask.fieldPaths=' + encodeURIComponent(name);
  }).join('&');
  const response = UrlFetchApp.fetch(DANEA_FIRESTORE_STATUS + '?' + masks, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: fields }),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    console.error('Heartbeat Danea non salvato: ' + status + ' ' + response.getContentText().slice(0, 500));
  }
}

function enqueueDaneaMessage(message) {
  const messageId = message.getId();
  const response = UrlFetchApp.fetch(DANEA_FIRESTORE_QUEUE + '?documentId=' + encodeURIComponent(messageId), {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: {
      id: daneaStringField(messageId),
      internetMessageId: daneaStringField(message.getHeader('Message-ID') || messageId),
      from: daneaStringField('no-reply@miocondominio.eu'),
      subject: daneaStringField(message.getSubject()),
      receivedDateTime: daneaStringField(message.getDate().toISOString()),
      htmlBody: daneaStringField(message.getBody().slice(0, 100000)),
      bodyPreview: daneaStringField(message.getPlainBody().slice(0, 4000))
    } }),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  if ((status < 200 || status >= 300) && status !== 409) {
    throw new Error('Firestore ha risposto ' + status + ': ' + response.getContentText().slice(0, 500));
  }
  return status !== 409;
}

function syncDaneaToEdilKappa() {
  let matched = 0;
  let queued = 0;
  let failure = '';
  try {
    const label = GmailApp.getUserLabelByName(DANEA_LABEL) || GmailApp.createLabel(DANEA_LABEL);
    const threads = GmailApp.search(DANEA_QUERY, 0, 50);
    threads.forEach(function (thread) {
      let completed = true;
      thread.getMessages().forEach(function (message) {
        if (!/no-reply@miocondominio\.eu/i.test(message.getFrom()) || !/richiesta\s+(di\s+)?intervento/i.test(message.getSubject())) return;
        matched += 1;
        try {
          if (enqueueDaneaMessage(message)) queued += 1;
        } catch (error) {
          completed = false;
          failure = String(error);
          console.error(failure);
        }
      });
      if (completed) thread.addLabel(label);
    });
  } catch (error) {
    failure = String(error);
    console.error(failure);
  }
  reportDaneaHeartbeat({ matched: matched, queued: queued, error: failure });
  if (failure) throw new Error(failure);
}

function installDaneaTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) { return trigger.getHandlerFunction() === 'syncDaneaToEdilKappa'; })
    .forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger('syncDaneaToEdilKappa').timeBased().everyMinutes(5).create();
  syncDaneaToEdilKappa();
}
