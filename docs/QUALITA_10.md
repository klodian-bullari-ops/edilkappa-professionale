# EdilKappa Qualità 10

Ultimo aggiornamento: 13 agosto 2026.

“Qualità 10” non è un voto dichiarato una volta per tutte: è un percorso verificabile. Una versione può andare in produzione solo se supera i controlli automatici, e il sistema deve continuare a controllarsi dopo il deploy.

## Protezioni incluse

- Il modulo pubblico non scrive più direttamente in Firestore: usa `edilkappaPublicLead`, con validazione server, antispam, deduplicazione e limite per origine senza salvare l’indirizzo IP in chiaro.
- Le regole Firestore vietano le scritture pubbliche dirette.
- I dati locali e l’archivio documenti IndexedDB vengono cancellati all’uscita e isolati quando cambia l’account.
- La pagina privacy identifica il titolare e descrive Firebase, cartografia ed EdilKappa AI.
- Hosting aggiunge HSTS, protezione anti-frame, `nosniff`, COOP e una Content Security Policy realmente applicata.
- Firebase App Check può essere attivato in due fasi: `observe` raccoglie token senza bloccare i dispositivi, `enforce` rifiuta le chiamate non verificate.
- Le metriche tecniche salvano soltanto tempi aggregati, tipo di dispositivo, percorso e stato online; non contengono contenuti di clienti o cantieri e vengono eliminate dopo 30 giorni.

## Controlli prima della produzione

La pipeline manuale di produzione esegue, in quest’ordine:

1. test delle regole Firestore e Storage negli emulatori Firebase con Java 21;
2. test browser Chromium su desktop e profilo iPhone, compreso il percorso autenticato richiesta Danea → intervento → sopralluogo → preventivo → cantiere → foto/rapportino/ore → completamento;
3. test, controllo sintattico e audit delle Cloud Functions;
4. test, type-check, build e audit del connettore;
5. autenticazione GitHub-Firebase con OIDC, senza chiavi JSON permanenti;
6. deploy soltanto dopo la conferma esplicita `PUBBLICA`.

Se un controllo fallisce, il deploy si ferma.

## Controlli dopo la produzione

- `edilkappaHealth` misura backup, prova di ripristino, ponte Danea, prestazioni P75 sui dispositivi reali, errori client nelle ultime 24 ore e dispositivi notifiche.
- `monitorEdilkappaHealth` controlla ogni ora e invia un avviso solo per errori reali, evitando duplicati per sei ore.
- GitHub controlla ogni sei ore pagine pubbliche, manifest, versione e intestazioni di sicurezza.
- La schermata **Controllo sistema** mostra punteggio, problemi, data dell’ultima verifica e versione realmente pubblicata.

## Backup e recupero verificabile

- Il formato `edilkappa-backup-v2` conserva Timestamp, Date, byte, GeoPoint e riferimenti Firestore senza trasformarli in semplici stringhe.
- Ogni backup notturno viene decompresso, verificato tramite checksum e ricostruito in memoria come prova di ripristino.
- Il titolare può avviare un ripristino solo dopo anteprima, token monouso con scadenza, frase esatta e doppia conferma.
- Prima di scrivere qualunque dato viene creato e verificato un nuovo backup di sicurezza.
- Il recupero è volutamente non distruttivo: unisce i documenti della copia selezionata senza cancellare record più recenti.

## Costi e limiti

- Il monitor GitHub usa runner standard su repository pubblico; GitHub documenta che questo utilizzo è gratuito: <https://docs.github.com/en/billing/concepts/product-billing/github-actions>.
- Il nuovo controllo orario aggiunge un job Cloud Scheduler. Firebase indica un costo di listino di 0,10 USD/mese per job oltre l’eventuale franchigia di tre job per account: <https://firebase.google.com/docs/functions/schedule-functions>.
- Invocazioni Functions e letture/scritture Firestore restano soggette alle quote e ai prezzi del progetto. Il controllo è intenzionalmente leggero, ma non viene promesso costo zero: <https://firebase.google.com/pricing>.
- Firebase App Check viene predisposto ma non deve passare direttamente a `enforce`: prima si registra la chiave reCAPTCHA Enterprise, si imposta `FIREBASE_APP_CHECK_MODE=observe`, si controllano computer e telefoni reali, quindi si passa a `enforce`: <https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider>.

## Attivazione App Check senza fermare il lavoro

Nel repository GitHub, ambiente `production`, configurare le variabili:

- `FIREBASE_APP_CHECK_SITE_KEY`: chiave pubblica del provider reCAPTCHA Enterprise registrato per il dominio EdilKappa;
- `FIREBASE_APP_CHECK_MODE`: inizialmente `observe`, poi `enforce` solo dopo una giornata di utilizzo senza errori.

La pipeline impedisce un deploy `enforce` se la site key manca. **Controllo sistema** distingue chiaramente non configurato, osservazione ed enforcement.

## Verifica del rilascio

Dopo il merge e il deploy:

1. attendere che la pipeline qualità sia verde;
2. aprire il gestionale da computer e telefono;
3. inviare una richiesta pubblica di prova;
4. aprire **Controllo sistema** e verificare versione, backup, prova di recupero, velocità reale, App Check, Danea e notifiche;
5. controllare che il workflow periodico di produzione completi almeno una corsa.

Il punteggio 100/100 compare solo quando i segnali operativi sono realmente sani; non viene forzato dall’interfaccia.

## Rischio tecnico noto e confinato

Al 13 agosto 2026 l’ultima versione disponibile di `firebase-tools` porta tre segnalazioni moderate transitive in `@opentelemetry/core`, senza correzione compatibile pubblicata. Il pacchetto è usato soltanto nei test e nel deploy, non viene copiato in Hosting né caricato nel browser. Gli audit delle dipendenze di produzione di Functions e connettore risultano invece senza vulnerabilità. La dipendenza va ricontrollata ai prossimi aggiornamenti del Firebase CLI.
