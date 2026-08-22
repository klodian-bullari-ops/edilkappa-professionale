# EdilKappa — coordinamento operativo a sette componenti

## Architettura

Il coordinatore centrale mantiene il controllo del risultato e consulta sei
specialisti come strumenti:

1. Tecnico AI
2. Agente Cantieri
3. Agente Preventivi
4. Agente Amministrativo
5. Agente Guadagno Reale
6. Agente Notifiche

Il Tecnico AI riceve soltanto i dati già presenti nei sopralluoghi e, quando
disponibili, misure e riferimenti dei pacchetti EdilKappa Scan. Prepara analisi
e bozze da verificare: non certifica misure e non approva lavorazioni.

Non sono usati handoff: gli specialisti restituiscono analisi al coordinatore,
che produce un unico briefing strutturato per il Centro operativo.

## Confine tra dati certi e ragionamento AI

`operations-core.js` calcola in modo deterministico richieste nuove, cantieri
fermi, fotografie mancanti, ore mancanti, solleciti preventivi, pagamenti,
scadenze e redditività. Gli agenti ricevono questa fotografia già calcolata e
possono soltanto ordinarla, spiegarla e preparare bozze.

Gli agenti non possono:

- modificare clienti, cantieri, ore, listini o pagamenti;
- inviare email o messaggi WhatsApp;
- inventare quantità, costi, prezzi DEI o fatti mancanti;
- approvare o pubblicare documenti.

Ogni bozza riporta che serve la conferma del titolare.

## Esecuzione

- Il Centro operativo mostra sempre l'analisi deterministica locale.
- Il titolare può richiedere manualmente un briefing AI.
- Dal lunedì al sabato alle 07:00 Europe/Rome viene preparato un briefing.
- La chiave viene letta dal secret Firebase `OPENAI_API_KEY` e non è inclusa
  nel repository.
- Il tracing non include contenuti sensibili di input e output.

## Verifica locale

```bash
cd functions
npm run check
npm test

cd ../mcp-server
npm test
```

I test locali non effettuano chiamate OpenAI a pagamento.
