#!/usr/bin/env bash
set -euo pipefail

# Configurazione senza chiavi permanenti per il solo deploy di produzione EdilKappa.
PROJECT_ID="edilkappa-professionale"
PROJECT_NUMBER="583702130706"
GITHUB_REPOSITORY="klodian-bullari-ops/edilkappa-professionale"
GITHUB_REPOSITORY_ID="1302762653"
GITHUB_ACTOR_ID="305622593"
GITHUB_WORKFLOW_REF="${GITHUB_REPOSITORY}/.github/workflows/deploy-production.yml@refs/heads/main"
POOL_ID="github-actions"
PROVIDER_ID="edilkappa-main"
DEPLOY_SERVICE_ACCOUNT_ID="github-deploy"
DEPLOY_SERVICE_ACCOUNT="${DEPLOY_SERVICE_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

export CLOUDSDK_CORE_DISABLE_PROMPTS=1

active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)"
if [[ -z "$active_account" ]]; then
  echo "ERRORE: accedi prima a Google Cloud con il tuo account amministratore." >&2
  exit 1
fi

actual_project_number="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
if [[ "$actual_project_number" != "$PROJECT_NUMBER" ]]; then
  echo "ERRORE: il numero del progetto non corrisponde a EdilKappa." >&2
  exit 1
fi

echo "Account Google attivo: $active_account"
echo "Progetto verificato: $PROJECT_ID ($PROJECT_NUMBER)"
gcloud config set project "$PROJECT_ID" --quiet >/dev/null

echo "Abilito i servizi necessari per token temporanei OIDC..."
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project="$PROJECT_ID" \
  --quiet

if ! gcloud iam service-accounts describe "$DEPLOY_SERVICE_ACCOUNT" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creo l'identità di deploy dedicata..."
  gcloud iam service-accounts create "$DEPLOY_SERVICE_ACCOUNT_ID" \
    --project="$PROJECT_ID" \
    --display-name="GitHub deploy EdilKappa" \
    --description="Deploy Firebase da GitHub Actions tramite token OIDC temporanei"
fi

# Permessi limitati alle operazioni realmente eseguite dal workflow di produzione.
DEPLOY_ROLES=(
  roles/artifactregistry.writer
  roles/cloudbuild.builds.editor
  roles/cloudfunctions.admin
  roles/cloudscheduler.admin
  roles/datastore.owner
  roles/eventarc.admin
  # Firebase CLI risolve il bucket predefinito tramite l'API Firebase Storage.
  # storage.admin da solo non include firebasestorage.defaultBucket.get.
  roles/firebase.viewer
  roles/firebasehosting.admin
  roles/firebaserules.admin
  roles/iam.serviceAccountViewer
  roles/pubsub.admin
  roles/run.admin
  # Firebase CLI deve leggere i metadati dei secret dichiarati dalle funzioni.
  # Il ruolo viewer non consente di leggere il valore di OPENAI_API_KEY.
  roles/secretmanager.viewer
  roles/serviceusage.serviceUsageConsumer
  roles/storage.admin
)

echo "Assegno i permessi di deploy all'identità dedicata..."
for role in "${DEPLOY_ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_SERVICE_ACCOUNT}" \
    --role="$role" \
    --condition=None \
    --quiet >/dev/null
done

# Cloud Functions di seconda generazione deve poter usare le identità runtime/build esistenti.
RUNTIME_SERVICE_ACCOUNTS=(
  "${PROJECT_ID}@appspot.gserviceaccount.com"
  "${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  "${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
)

echo "Autorizzo l'uso delle sole identità runtime presenti nel progetto..."
for runtime_account in "${RUNTIME_SERVICE_ACCOUNTS[@]}"; do
  if gcloud iam service-accounts describe "$runtime_account" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts add-iam-policy-binding "$runtime_account" \
      --project="$PROJECT_ID" \
      --member="serviceAccount:${DEPLOY_SERVICE_ACCOUNT}" \
      --role="roles/iam.serviceAccountUser" \
      --condition=None \
      --quiet >/dev/null
  fi
done

if ! gcloud iam workload-identity-pools describe "$POOL_ID" \
  --project="$PROJECT_ID" \
  --location=global >/dev/null 2>&1; then
  echo "Creo il pool di identità GitHub..."
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --project="$PROJECT_ID" \
    --location=global \
    --display-name="GitHub Actions EdilKappa"
fi

ATTRIBUTE_MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.actor_id=assertion.actor_id,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name,attribute.environment=assertion.environment,attribute.workflow_ref=assertion.workflow_ref"
ATTRIBUTE_CONDITION="assertion.repository_id == '${GITHUB_REPOSITORY_ID}' && assertion.actor_id == '${GITHUB_ACTOR_ID}' && assertion.ref == 'refs/heads/main' && assertion.event_name == 'workflow_dispatch' && assertion.environment == 'production' && assertion.workflow_ref == '${GITHUB_WORKFLOW_REF}'"

if gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --workload-identity-pool="$POOL_ID" >/dev/null 2>&1; then
  echo "Aggiorno le restrizioni del provider OIDC..."
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER_ID" \
    --project="$PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$POOL_ID" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$ATTRIBUTE_MAPPING" \
    --attribute-condition="$ATTRIBUTE_CONDITION"
else
  echo "Creo il provider OIDC ristretto a EdilKappa..."
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --project="$PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$POOL_ID" \
    --display-name="EdilKappa main production" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$ATTRIBUTE_MAPPING" \
    --attribute-condition="$ATTRIBUTE_CONDITION"
fi

pool_resource="$(gcloud iam workload-identity-pools describe "$POOL_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --format='value(name)')"
wif_member="principalSet://iam.googleapis.com/${pool_resource}/attribute.repository_id/${GITHUB_REPOSITORY_ID}"

echo "Collego esclusivamente il repository verificato all'identità di deploy..."
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SERVICE_ACCOUNT" \
  --project="$PROJECT_ID" \
  --member="$wif_member" \
  --role="roles/iam.workloadIdentityUser" \
  --condition=None \
  --quiet >/dev/null

provider_resource="$(gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --workload-identity-pool="$POOL_ID" \
  --format='value(name)')"

echo
echo "CONFIGURAZIONE COMPLETATA"
echo "Provider: $provider_resource"
echo "Identità: $DEPLOY_SERVICE_ACCOUNT"
echo "Nessuna chiave JSON è stata creata o salvata."
