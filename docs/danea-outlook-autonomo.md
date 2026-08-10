# Danea autonomo tramite Outlook e Gmail

## Flusso

1. Una regola Outlook reindirizza esclusivamente i messaggi autentici di Danea
   da `edilkappasas@outlook.it` a `info@edilkappa.com`.
2. Google Apps Script controlla Gmail ogni 5 minuti.
3. Lo script invia il messaggio alla funzione Firebase tramite HTTPS e un
   segreto conservato nelle proprietà dello script.
4. Il backend ricontrolla mittente e oggetto, poi elimina i duplicati usando
   Message-ID e, come secondo controllo, studio più codice attività.

Per ogni richiesta nuova EdilKappa crea o collega cliente, richiesta e cantiere
pianificato, conserva descrizione/priorità/indirizzo/link ufficiale e invia una
notifica. Accettazione, rifiuto, invio e cancellazione restano sotto conferma.

## Sicurezza

- Nessuna password Outlook o Gmail viene salvata nel gestionale.
- La funzione `edilkappaDaneaIngest` accetta solo POST con Bearer token uguale
  al secret Firebase `DANEA_INGEST_KEY`, confrontato in tempo costante.
- Lo stesso valore è salvato soltanto nelle proprietà private di Apps Script.
- Messaggi con mittente od oggetto diversi da Danea vengono respinti.
- La raccolta Firestore `integrations` è usata soltanto dall'Admin SDK.

## Configurazione una tantum

1. Creare in Outlook la regola: mittente `no-reply@miocondominio.eu`, oggetto
   contenente `Richiesta intervento`, azione **Reindirizza a**
   `info@edilkappa.com`.
2. Creare il secret Firebase `DANEA_INGEST_KEY` con un valore casuale forte.
3. Copiare `scripts/google-apps-script-danea.gs` in Apps Script collegato alla
   casella `info@edilkappa.com`.
4. Impostare le proprietà `DANEA_ENDPOINT` e `DANEA_INGEST_KEY`.
5. Eseguire una volta `installDaneaTrigger()` e autorizzare Gmail/UrlFetch.

## Funzioni Firebase

- `edilkappaDaneaIngest`: ricezione server-to-server protetta.
- `edilkappaDaneaBridge`: stato visibile soltanto al titolare autenticato.
