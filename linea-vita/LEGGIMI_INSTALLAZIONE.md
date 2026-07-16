# EdilKappa Linea Vita

Applicazione web installabile (PWA) per la compilazione delle schede di ispezione e manutenzione dei sistemi di ancoraggio in copertura.

## Funzioni incluse

- Scheda guidata basata sul modello EdilKappa LV-01 Rev. 0.
- Archivio locale delle ispezioni.
- Funzionamento senza connessione dopo la prima apertura.
- Acquisizione e compressione delle fotografie.
- Firma dell'ispettore e del committente direttamente sullo schermo.
- Rilevamento facoltativo delle coordinate GPS.
- Creazione del rapporto PDF EdilKappa anche offline.
- Backup completo in formato JSON e successivo ripristino.
- Utilizzo su iPhone, iPad, Android e computer.

## Pubblicazione gratuita con GitHub Pages

Il collegamento tra ChatGPT e GitHub non è necessario.

1. Accedere a GitHub e creare un nuovo repository pubblico chiamato `edilkappa-linea-vita`.
2. Estrarre questo pacchetto ZIP.
3. Nel repository scegliere **Add file > Upload files** e caricare tutto il contenuto della cartella `app` nella cartella principale del repository.
4. Aprire **Settings > Pages**.
5. In **Build and deployment**, scegliere **Deploy from a branch**, quindi `main` e `/ (root)`.
6. Salvare e attendere la comparsa dell'indirizzo pubblico dell'app.

Il repository contiene soltanto il programma. Le ispezioni, le foto e le firme restano nell'archivio locale del telefono e non vengono caricate su GitHub.

## Installazione su iPhone

1. Aprire l'indirizzo dell'app con Safari.
2. Toccare **Condividi**.
3. Selezionare **Aggiungi alla schermata Home**.
4. Confermare con **Aggiungi**.
5. Aprire una volta l'app con internet e attendere alcuni secondi; successivamente potrà funzionare offline.

## Installazione su Android

1. Aprire l'indirizzo con Chrome.
2. Toccare il menu del browser.
3. Scegliere **Installa app** oppure **Aggiungi alla schermata Home**.

## Backup obbligatorio consigliato

L'archivio è conservato sul dispositivo. Da **Impostazioni > Backup e sicurezza** usare periodicamente **Scarica copia di sicurezza**. Conservare il file JSON in iCloud Drive, Google Drive o su un computer.

Se il browser viene cancellato, il telefono viene sostituito o l'app viene rimossa, i dati locali possono andare persi. Il file di backup permette di ripristinarli.

## Avvio di prova su computer

Non aprire direttamente `index.html` con un doppio clic. Dalla cartella dell'app eseguire:

```bash
python3 -m http.server 8080
```

Poi aprire `http://localhost:8080` nel browser.

## Nota operativa

L'app e la scheda LV-01 sono strumenti operativi interni. Devono essere compilati secondo il manuale del fabbricante, il progetto, il programma di manutenzione e le norme applicabili. Non sostituiscono la relazione di calcolo o la verifica strutturale del tecnico competente.

## Componenti software inclusi

La generazione PDF utilizza jsPDF e jsPDF-AutoTable, distribuiti con licenza MIT. Le relative licenze sono presenti nella cartella `vendor`.

Versione applicazione: 1.0.0

