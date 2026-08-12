# Accesso sicuro GitHub–Firebase

Il deploy di produzione usa Workload Identity Federation: GitHub riceve un token Google temporaneo soltanto durante il workflow e non conserva chiavi JSON permanenti.

## Attivazione una tantum

Da Google Cloud Shell, con il progetto `edilkappa-professionale` selezionato:

```bash
cd ~/edilkappa-professionale
git pull origin main
bash scripts/setup-github-firebase-wif.sh
```

Lo script è ripetibile e:

- verifica progetto e numero progetto;
- crea l'identità `github-deploy` senza chiavi private;
- assegna i permessi necessari al deploy Firebase;
- limita l'accesso al repository EdilKappa, al workflow di produzione, al ramo `main`, all'ambiente `production`, all'avvio manuale e all'account GitHub autorizzato;
- collega GitHub a Google Cloud mediante token OIDC temporanei.

Non copiare in GitHub o in chat password, token o file JSON.

## Pubblicazione

Dopo che lo script mostra `CONFIGURAZIONE COMPLETATA`, avvia un nuovo workflow **Pubblica EdilKappa in produzione** sul ramo `main` e inserisci `PUBBLICA`. Non rieseguire una vecchia esecuzione: deve partire un nuovo workflow contenente la configurazione OIDC.
