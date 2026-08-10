/**
 * Ponte Gmail -> EdilKappa per le richieste Danea.
 * Impostare nelle Proprietà dello script:
 * - DANEA_ENDPOINT
 * - DANEA_INGEST_KEY
 */
const DANEA_QUERY = 'from:no-reply@miocondominio.eu subject:"Richiesta intervento" newer_than:30d -label:EdilKappa-Danea-importata';
const DANEA_LABEL = 'EdilKappa-Danea-importata';

function syncDaneaToEdilKappa() {
  const properties = PropertiesService.getScriptProperties();
  const endpoint = properties.getProperty('DANEA_ENDPOINT');
  const key = properties.getProperty('DANEA_INGEST_KEY');
  if (!endpoint || !key) throw new Error('Configurare DANEA_ENDPOINT e DANEA_INGEST_KEY nelle proprietà dello script.');
  const label = GmailApp.getUserLabelByName(DANEA_LABEL) || GmailApp.createLabel(DANEA_LABEL);
  const threads = GmailApp.search(DANEA_QUERY, 0, 50);
  threads.forEach(function (thread) {
    let completed = true;
    thread.getMessages().forEach(function (message) {
      if (!/no-reply@miocondominio\.eu/i.test(message.getFrom()) || !/richiesta\s+(di\s+)?intervento/i.test(message.getSubject())) return;
      const response = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + key },
        payload: JSON.stringify({
          id: message.getId(),
          internetMessageId: message.getHeader('Message-ID') || message.getId(),
          from: 'no-reply@miocondominio.eu',
          subject: message.getSubject(),
          receivedDateTime: message.getDate().toISOString(),
          htmlBody: message.getBody(),
          bodyPreview: message.getPlainBody().slice(0, 4000)
        }),
        muteHttpExceptions: true
      });
      const status = response.getResponseCode();
      if (status < 200 || status >= 300) {
        completed = false;
        console.error('EdilKappa ha risposto ' + status + ': ' + response.getContentText().slice(0, 500));
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
