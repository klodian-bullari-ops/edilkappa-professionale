const DEFAULT_DOWNLOAD_HOSTS = [
  '.oaiusercontent.com',
  '.blob.core.windows.net',
  '.amazonaws.com',
  'chatgpt.com'
];

export type AppConfig = {
  port: number;
  publicBaseUrl: string;
  resourceUrl: string;
  resourceMetadataUrl: string;
  oauthIssuer: string;
  oauthJwksUrl: string;
  oauthAudience: string;
  allowedSubjects: Set<string>;
  firebaseProjectId: string;
  firebaseStorageBucket: string;
  siteUrl: string;
  downloadHostSuffixes: string[];
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Variabile obbligatoria mancante: ${name}`);
  return value;
}

function absoluteUrl(value: string, name: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error(`${name} deve usare HTTPS.`);
  }
  return parsed.toString().replace(/\/$/, '');
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const publicBaseUrl = absoluteUrl(required(env, 'PUBLIC_BASE_URL'), 'PUBLIC_BASE_URL');
  const resourceUrl = `${publicBaseUrl}/mcp`;
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT non valida.');

  const allowedSubjects = new Set(
    required(env, 'OAUTH_ALLOWED_SUBJECTS')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  if (!allowedSubjects.size) throw new Error('OAUTH_ALLOWED_SUBJECTS deve contenere almeno un utente.');

  const downloadHostSuffixes = (env.FILE_DOWNLOAD_HOST_SUFFIXES || DEFAULT_DOWNLOAD_HOSTS.join(','))
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!downloadHostSuffixes.length) throw new Error('FILE_DOWNLOAD_HOST_SUFFIXES non può essere vuoto.');

  return {
    port,
    publicBaseUrl,
    resourceUrl,
    resourceMetadataUrl: `${publicBaseUrl}/.well-known/oauth-protected-resource`,
    oauthIssuer: required(env, 'OAUTH_ISSUER'),
    oauthJwksUrl: absoluteUrl(required(env, 'OAUTH_JWKS_URL'), 'OAUTH_JWKS_URL'),
    oauthAudience: env.OAUTH_AUDIENCE?.trim() || resourceUrl,
    allowedSubjects,
    firebaseProjectId: env.FIREBASE_PROJECT_ID?.trim() || 'edilkappa-professionale',
    firebaseStorageBucket: env.FIREBASE_STORAGE_BUCKET?.trim() || 'edilkappa-professionale.firebasestorage.app',
    siteUrl: absoluteUrl(env.EDILKAPPA_SITE_URL?.trim() || 'https://example.com/edilkappa/', 'EDILKAPPA_SITE_URL'),
    downloadHostSuffixes
  };
}
