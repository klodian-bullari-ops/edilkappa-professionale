# SISTEMA EDILKAPPA — Specifica funzionale consolidata

Versione ricostruita il 5 agosto 2026 dalla versione pubblicata del gestionale e
dalle decisioni operative confermate da Klodian Bullari. La ricostruzione è stata
autorizzata espressamente perché il documento originale non risultava presente in
`main`, negli altri branch o nella cronologia Git.

## 1. Scopo e principio guida

EdilKappa è il gestionale operativo riservato dell'impresa EDILKAPPA. Deve riunire
in un'unica scheda cliente/condominio gli interventi distinti e, per ogni
intervento, mantenere collegati cantiere, sopralluoghi, preventivi, documenti,
foto, video, rapportini, cronologia, squadre, operai, ore, costi e stato finale.

Il principio guida è **inserire ogni informazione una sola volta**. I dati già
presenti in cliente, richiesta Danea, intervento, cantiere, squadra o registro ore
devono essere riutilizzati negli altri moduli senza doppie registrazioni.

## 2. Regole permanenti per ogni modifica

1. Prima di modificare il gestionale, leggere integralmente questo documento.
2. Non lavorare direttamente su `main`: creare sempre un branch `agent/...`.
3. Conservare i dati esistenti e la compatibilità con i record precedenti.
4. Non cancellare, rinominare o cambiare significato ai campi già pubblicati senza
   una migrazione compatibile.
5. Non esporre nel repository dati personali, recapiti, credenziali o dati fiscali
   reali: restano nelle impostazioni private/cloud.
6. Implementare anche i test pertinenti e aggiornare la cache PWA quando cambia
   il codice caricato dall'app.
7. Verificare sempre l'interfaccia desktop e mobile, in particolare che pannelli,
   tabelle e pulsanti Modifica/Elimina non si coprano.
8. Pubblicare online il risultato verificato tramite il connettore GitHub, senza
   utilizzare `gh`, seguendo il flusso branch, commit, pull request e unione.
9. Le regole e gli indici Firebase di produzione si aggiornano soltanto quando la
   modifica dei dati lo richiede e devono restare a privilegi minimi.

## 3. Architettura attuale

- Applicazione web statica/PWA pubblicata con GitHub Pages.
- Interfaccia principale in `index.html`, estesa da moduli JavaScript separati.
- Persistenza locale compatibile tramite `localStorage` e IndexedDB.
- Sincronizzazione privata e autenticata tramite Firebase/Firestore e Storage.
- Connettore MCP separato in `mcp-server/` per operazioni autorizzate da ChatGPT.
- Service worker `sw.js` per cache offline e aggiornamento della PWA.
- Nessun framework UI obbligatorio; il codice deve restare utilizzabile in Safari
  su iPhone e nei browser desktop moderni.

## 4. Ruoli e visibilità

### Titolare

Può vedere e gestire ogni modulo, inclusi importi, costi, margini, documenti,
cantieri, ore, squadre, utenti, congruità e configurazione aziendale.

### Ufficio

Ha gli stessi strumenti operativi del titolare per inserimento, modifica e
controllo dei dati aziendali.

### Operaio

Accede con profilo personale, vede esclusivamente i cantieri assegnati alla sua
squadra, comunica le proprie ore e inserisce rapportini/foto per i lavori
autorizzati. Non vede prezzi, costi, margini, dati amministrativi o congruità.

### Cliente/amministratore

Nel portale dedicato vede soltanto i clienti/condomini espressamente assegnati e
i relativi stati, documenti, preventivi e fotografie consentiti.

## 5. Modello operativo principale

### Clienti e condomini

Ogni cliente/condominio ha un identificativo stabile, anagrafica, indirizzo,
amministratore/referente e storico. La rinomina deve propagarsi ai record legacy,
ma i nuovi collegamenti devono preferire `clientId`.

### Interventi

Ogni richiesta di lavoro genera o collega un intervento separato. Due lavori
diversi nello stesso condominio non devono mescolare foto, ore, preventivi o
cronologia. L'intervento può provenire da Danea oppure essere creato manualmente.

### Cantieri

Ogni cantiere contiene almeno identificativo, codice, titolo, cliente/clientId,
intervento/interventionId, indirizzo, date, stato, avanzamento, valore, costo e
squadre assegnate. Un cantiere può avere più squadre contemporaneamente.

Per compatibilità:

- `teamIds` e `assignedTeamIds` sono le assegnazioni multiple autorevoli;
- `worker` e `assignedTeamId` conservano la prima squadra per i record legacy;
- una squadra assegnata deve vedere cantiere, foto, rapportini e attività;
- eliminare una squadra rimuove l'assegnazione, non il cantiere né lo storico.

### Operai, squadre e ore

Ogni operaio ha profilo individuale e appartiene a una squadra. Le ore sono
registrate per data, operaio, squadra, cantiere/intervento, quantità e note.
Quando disponibili, usare `siteId`, `interventionId` e `clientId`; il testo libero
`job` resta solo per compatibilità e descrizione.

Il titolare e l'ufficio devono poter vedere:

- totali mensili individuali;
- giorni registrati;
- dettaglio giornaliero;
- ripartizione per cantiere;
- ore non collegate o incomplete;
- possibilità di correggere ed eliminare con conferma.

### Rapportini e fotografie

I rapportini appartengono a un cantiere e riportano autore, ore, materiali, note,
avanzamento e allegati. Le fotografie già caricate devono essere sempre visibili
nella galleria; il comando Foto apre la galleria e il caricamento resta un'azione
dedicata. Foto e video devono rimanere collegati all'intervento corretto.

## 6. Danea Interventi

- Importare richieste ufficiali senza duplicati usando identificativi stabili.
- Creare/collegare automaticamente cliente, intervento e cantiere.
- Conservare studio, codice attività, descrizione, priorità, stato, date e link
  HTTPS ufficiale.
- Sincronizzare gli stati autorevoli Danea con intervento e cantiere.
- Non sovrascrivere personalizzazioni manuali non gestite da Danea.
- Le richieste nuove e in corso devono confluire nel flusso operativo ordinario,
  non in un archivio isolato.

## 7. Archivio e completamento

- Ogni cliente mostra interventi, cantieri, sopralluoghi, preventivi, documenti,
  foto/video, rapportini, operai, ore e cronologia collegati.
- I lavori completati vanno in una sezione dedicata senza sparire dallo storico.
- Prima della chiusura controllare dati mancanti, rapportino finale, fotografie e
  documenti richiesti.
- Le nuove fotografie devono generare un avviso apribile nel punto esatto.
- La ricerca globale deve aprire direttamente la scheda completa con le azioni
  pertinenti, evitando passaggi ripetuti e ricerche manuali.

## 8. Modulo Cassa Edile / CNCE EdilConnect

Il modulo non invia direttamente le denunce ufficiali. Prepara dati completi e
coerenti per il consulente del lavoro, che effettua l'invio a Cassa Edile e
CNCE EdilConnect.

### 8.1 Dati di congruità del cantiere

Dentro ogni cantiere devono essere disponibili:

- tipo committente: privato o pubblico;
- ruolo EdilKappa: affidataria o subappaltatrice;
- valore complessivo dell'opera;
- importo dei lavori edili soggetti al calcolo;
- tipologia prevalente di lavorazione;
- data di fine prevista ed effettiva;
- assoggettamento alla congruità, calcolato ma modificabile motivatamente;
- CUC (Codice Univoco di Congruità: 15 caratteri, prefisso `CNCEC`), stato DNL
  e data comunicazione;
- stato attestazione e relativa data;
- eventuali subappaltatori/lavoratori autonomi e note per il consulente.

Per i lavori privati il gestionale suggerisce la congruità quando il valore
complessivo dell'opera è almeno 70.000 euro; per i lavori pubblici la suggerisce
sempre. Il suggerimento non sostituisce la verifica del consulente.

Queste regole operative sono state verificate il 5 agosto 2026 sul
[simulatore ufficiale CNCE](https://www.congruitanazionale.it/Home/Simulatore) e
sulla pagina ufficiale di
[richiesta dell'attestazione](https://www.congruitanazionale.it/Home/CongruitaRequest).
Poiché la disciplina può cambiare, prima di modificare soglie, responsabilità o
formati occorre ricontrollare le fonti ufficiali e mantenere visibile l'avvertenza
che la decisione finale spetta al consulente/Cassa competente.

### 8.2 Registrazione semplificata delle ore

- L'operaio seleziona un cantiere assegnato, non scrive ogni volta il nome libero.
- La registrazione salva automaticamente `siteId`, `interventionId`, `clientId`,
  titolo e squadra. Il CUC viene unito dal riepilogo riservato, senza copiarlo
  nel documento ore leggibile dall'operaio.
- Le ore già registrate devono alimentare automaticamente il riepilogo
  EdilConnect, senza seconda imputazione.
- Un record legacy privo di `siteId` può essere riconciliato per testo ma deve
  essere segnalato se il collegamento non è sicuro.

### 8.3 Riepilogo mensile per il consulente

Una sezione riservata a Titolare/Ufficio deve offrire:

- selezione mese e filtri per cantiere/operaio;
- matrice operaio × cantiere con giorni e ore;
- totali per operaio, cantiere e CUC;
- evidenza di ore senza cantiere, CUC mancanti e dati amministrativi incompleti;
- controllo di sovrapposizioni/ore giornaliere anomale;
- esportazione CSV compatibile con Excel, stampa/PDF e copia di un riepilogo
  testuale pronto da inviare al consulente;
- conferma mensile `Bozza`, `Pronto da inviare`, `Inviato al consulente`, con data
  e note, senza bloccare correzioni successive.

### 8.4 Avvisi operativi

Il gestionale deve avvisare almeno per:

- cantiere soggetto a congruità privo di CUC o DNL;
- ore non comunicate o non collegate a un cantiere;
- cantiere prossimo alla fine con dati incompleti;
- cantiere completato senza attestazione quando prevista;
- riepilogo mensile non ancora inviato al consulente.

Gli avvisi devono aprire direttamente il cantiere o il mese interessato.

## 9. Cloud, sicurezza e compatibilità

- Ogni documento Firestore conserva `orgId`, proprietario, payload e campi indice
  minimi necessari alle query autorizzate.
- Le query degli operai restano limitate a UID e squadra assegnata.
- I nuovi campi amministrativi di congruità non devono essere copiati nei payload
  leggibili dagli operai.
- Le collezioni `sites` e `timesheets` restano la fonte per cantieri e ore. La
  collezione `edilconnect`, leggibile e modificabile soltanto da Titolare/Ufficio,
  conserva dati amministrativi del cantiere e stato mensile con regole dedicate.
- I valori numerici devono avere limiti ragionevoli e gli identificativi devono
  essere normalizzati.
- I dati locali precedenti devono caricarsi senza migrazione distruttiva.

## 10. Interfaccia e accessibilità

- Linguaggio semplice, in italiano, orientato al lavoro quotidiano.
- Pulsanti minimi di 43 px quando principali e comandi utilizzabili da iPhone.
- Tabelle dentro contenitori scorrevoli; nessun pannello deve coprire azioni.
- Stati e problemi devono essere comprensibili anche senza affidarsi solo al
  colore.
- Conferma prima di eliminare; messaggi d'errore concreti e non tecnici.
- Le funzioni amministrative EdilConnect non compaiono nel menu operaio.

## 11. Verifiche obbligatorie prima della pubblicazione

1. Test automatici esistenti e nuovi test del modulo EdilConnect.
2. Compatibilità dei record legacy di cantieri, team e ore.
3. Separazione dei ruoli e assenza di dati economici/amministrativi per operai.
4. Riepilogo mensile corretto con più squadre nello stesso cantiere.
5. CSV apribile in Excel con separatore e codifica adatti all'Italia.
6. Layout mobile dei moduli Cantieri, Ore ed EdilConnect.
7. Cache PWA incrementata e contenente i nuovi file.
8. Diff limitato alla funzione richiesta e nessun dato reale nel repository.
