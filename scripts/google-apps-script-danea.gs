/**
 * Ponte Gmail -> EdilKappa per le richieste Danea.
 * Usa l'identità Google dell'account che esegue lo script per scrivere nella
 * coda privata Firestore. Non richiede endpoint pubblici né chiavi condivise.
 */
const DANEA_QUERY = 'from:no-reply@miocondominio.eu subject:"Richiesta intervento" newer_than:30d -label:EdilKappa-Danea-importata';
const DANEA_LABEL = 'EdilKappa-Danea-importata';
const DANEA_FIRESTORE_QUEUE = 'https://firestore.googleapis.com/v1/projects/edilkappa-professionale/databases/edilkappa/documents/daneaInbox';

function daneaStringField(value) {
  return { stringValue: String(value || '') };
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
}

function syncDaneaToEdilKappa() {
  const label = GmailApp.getUserLabelByName(DANEA_LABEL) || GmailApp.createLabel(DANEA_LABEL);
  const threads = GmailApp.search(DANEA_QUERY, 0, 50);
  threads.forEach(function (thread) {
    let completed = true;
    thread.getMessages().forEach(function (message) {
      if (!/no-reply@miocondominio\.eu/i.test(message.getFrom()) || !/richiesta\s+(di\s+)?intervento/i.test(message.getSubject())) return;
      try {
        enqueueDaneaMessage(message);
      } catch (error) {
        completed = false;
        console.error(String(error));
      }
    });
    if (completed) thread.addLabel(label);
  });
}

function installDaneaTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) { return trigger.getHandlerFunction() === 'syncDaneaToEdilKappa'; })
    .forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger('syncDaneaToEdilKappa').timeBased().everyMinutes(5).create();
}
