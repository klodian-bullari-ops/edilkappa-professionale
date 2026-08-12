# Danea autonomo tramite Outlook e Gmail

## Flusso

1. Una regola Outlook reindirizza esclusivamente i messaggi autentici di Danea
   da `edilkappasas@outlook.it` a `info@edilkappa.com`.
2. Google Apps Script controlla Gmail ogni 5 minuti.
3. Lo script deposita il messaggio nella coda privata Firestore usando
   l'identità Google dell'account autorizzato.
4. Una funzione interna ricontrolla mittente e oggetto, poi elimina i duplicati usando
   Message-ID e, come secondo controllo, studio più codice attività.
5. A ogni controllo lo script aggiorna un heartbeat privato: il gestionale può così
   distinguere un ponte realmente attivo da un archivio che contiene soltanto vecchie richieste.

Per ogni richiesta nuova EdilKappa crea o collega cliente, richiesta e cantiere
pianificato, conserva descrizione/priorità/indirizzo/link ufficiale e invia una
notifica. Accettazione, rifiuto, invio e cancellazione restano sotto conferma.

## Sicurezza

- Nessuna password Outlook o Gmail viene salvata nel gestionale.
- Non esiste alcun endpoint Danea pubblico e non viene usata una chiave condivisa.
- La coda Firestore accetta la scrittura soltanto tramite l'identità Google
  autorizzata del progetto; l'applicazione client non può leggerla o scriverla.
- Messaggi con mittente od oggetto diversi da Danea vengono respinti.
- La raccolta Firestore `integrations` è usata soltanto dall'Admin SDK.

## Configurazione una tantum

1. Creare in Outlook la regola: mittente `no-reply@miocondominio.eu`, oggetto
   contenente `Richiesta intervento`, azione **Reindirizza a**
   `info@edilkappa.com`.
2. Copiare `scripts/google-apps-script-danea.gs` in Apps Script collegato alla
   casella `info@edilkappa.com`.
3. Abilitare la visualizzazione del file manifest e sostituire `appsscript.json`
   con il contenuto di `scripts/appsscript.json`, che richiede soltanto gli
   ambiti Gmail, trigger, chiamate Google e coda Firestore necessari.
4. Eseguire una volta `installDaneaTrigger()` e autorizzare Gmail/UrlFetch e
   l’accesso al progetto Google Cloud. L’installazione avvia subito anche il primo
   controllo, quindi nel gestionale lo stato Danea deve diventare verde senza dover
   attendere una nuova richiesta.

## Funzioni Firebase

- `processDaneaInbox`: elaborazione interna della coda privata Firestore.
- `edilkappaDaneaBridge`: stato visibile soltanto al titolare autenticato.
