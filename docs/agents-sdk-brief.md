# EdilKappa AI — prima integrazione Agents SDK

## Stato confermato

- EdilKappa AI gira su Firebase Cloud Functions Node.js 22.
- La chiave OpenAI è già custodita nel secret Firebase `OPENAI_API_KEY` e deve essere riutilizzata senza copiarla nel repository.
- Il flusso esistente gestisce chat separate, allegati, job recuperabili, GPT-5.6 Sol/Terra, controllo qualità e salvataggio manuale.
- Il salvataggio di un preventivo richiede già la scelta esplicita di cliente e intervento.

## Obiettivo della prima versione

Usare l'OpenAI Agents SDK per un solo agente specializzato, `EdilKappa Preventivi`, quando l'utente seleziona la modalità **Preventivo**. Chat libera, relazioni, sopralluoghi, immagini illustrative e trascrizioni restano sul flusso esistente.

## Contratto dell'agente

- **Input:** cronologia pertinente, richiesta, dati operativi e allegati già convalidati dal backend.
- **Output:** lo schema strutturato EdilKappa già usato da interfaccia, PDF e Word.
- **Modelli:** scelta Sol/Terra già presente nel gestionale.
- **Strumenti:** ricerca web OpenAI soltanto quando l'utente attiva esplicitamente l'opzione.
- **Azioni:** nessuna scrittura autonoma nel gestionale.
- **Approvazione:** il titolare deve premere `Salva e modifica preventivo`, scegliere cliente/intervento e superare i controlli esistenti.
- **Stato:** job Firestore recuperabile dalla chat anche se il browser viene chiuso.
- **Privacy:** tracing SDK attivo senza contenuti sensibili di input/output.

## Assunzioni e limiti iniziali

- Un solo agente, senza handoff e senza sandbox.
- Massimo tre turni SDK per consentire l'eventuale ricerca web; nessuno strumento può modificare dati.
- Se l'esecuzione fallisce, il job resta visibile come fallito e può essere riprovato; il flusso preesistente non viene rimosso.
- L'agente non pubblica, invia o salva un preventivo senza conferma umana.

## Prova locale

```bash
cd functions
npm test
npm run check
```

I test locali verificano configurazione e contratti senza effettuare una chiamata OpenAI a pagamento.
