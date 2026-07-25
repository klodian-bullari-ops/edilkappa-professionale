# Connettore ChatGPT → EdilKappa

Server MCP privato che consente a ChatGPT di:

- cercare i clienti già presenti nel gestionale;
- salvare un PDF/Word nella sezione **Preventivi**;
- salvare un PDF/Word nella sezione **Documenti**, categoria **Relazione tecnica**.

I comandi di scrittura sono idempotenti: se ChatGPT ritenta lo stesso salvataggio, non crea un doppione. I file hanno un limite di 25 MB e vengono conservati nel bucket Firebase privato; nel database viene memorizzato soltanto il percorso.

## Sicurezza

Il server richiede OAuth 2.1 e verifica firma, emittente, pubblico, scadenza, scope e identificativo dell’utente. Non inserire chiavi Firebase o segreti OAuth nel repository. In Cloud Run il server usa un service account dedicato tramite Application Default Credentials.

Riferimenti ufficiali:

- [Autenticazione Apps SDK](https://developers.openai.com/apps-sdk/build/auth)
- [Server MCP Apps SDK](https://developers.openai.com/apps-sdk/build/mcp-server)
- [Auth0 per MCP](https://github.com/auth0-samples/auth0-mcp-samples)

## 1. Configurare l’identity provider

Usare un provider OAuth 2.1 compatibile con MCP, preferibilmente Auth0.

1. Creare un’API con identificatore `https://YOUR_CLOUD_RUN_HOST/mcp`.
2. Definire gli scope `edilkappa:read` e `edilkappa:write` e assegnarli soltanto al titolare.
3. Configurare CIMD o DCR e PKCE secondo la guida del provider.
4. Aggiungere l’URL di callback mostrato da ChatGPT alla allowlist del provider.
5. Copiare il `sub` dell’utente titolare in `OAUTH_ALLOWED_SUBJECTS`.

Il doppio controllo scope + `sub` impedisce a un altro utente del tenant di usare il gestionale.

## 2. Preparare Firebase

Dalla cartella principale del progetto, dopo l’accesso alla Firebase CLI:

```bash
firebase deploy --only storage --project edilkappa-professionale
```

Questo pubblica `storage.rules`, che limita tipi e dimensione dei file e consente la lettura al titolare autenticato.

## 3. Distribuire su Cloud Run

Creare un service account dedicato e assegnargli soltanto:

- `roles/datastore.user` sul progetto;
- `roles/storage.objectAdmin` sul bucket EdilKappa.

Poi copiare `env.cloudrun.example.yaml` in un file locale non versionato, sostituire i segnaposto e distribuire:

```bash
gcloud run deploy edilkappa-mcp \
  --source . \
  --region europe-west8 \
  --service-account YOUR_SERVICE_ACCOUNT \
  --allow-unauthenticated \
  --env-vars-file YOUR_ENV_FILE.yaml
```

`--allow-unauthenticated` rende raggiungibile il trasporto HTTPS; i dati restano protetti dall’OAuth applicativo verificato su ogni richiesta.

## 4. Collegare ChatGPT

Nelle impostazioni sviluppatore di ChatGPT creare un’app con URL MCP:

```text
https://YOUR_CLOUD_RUN_HOST/mcp
```

Completare il collegamento OAuth e provare, nell’ordine:

1. “Cerca il cliente Rossi nel gestionale EdilKappa.”
2. “Salva questo PDF come preventivo per Rossi.”
3. “Salva questo PDF come relazione tecnica per Rossi.”

## Sviluppo locale

```bash
npm install
npm test
npm run check
npm run build
```

Per avviare il server, impostare le variabili di `.env.example` nell’ambiente e usare `npm start` dopo la build.
