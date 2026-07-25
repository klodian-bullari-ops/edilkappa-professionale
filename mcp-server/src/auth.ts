import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AppConfig } from './config.js';

function tokenScopes(payload: Record<string, unknown>): string[] {
  const fromScope = typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : [];
  const fromPermissions = Array.isArray(payload.permissions)
    ? payload.permissions.filter((value): value is string => typeof value === 'string')
    : [];
  return Array.from(new Set([...fromScope, ...fromPermissions].filter(Boolean)));
}

export class OidcTokenVerifier implements OAuthTokenVerifier {
  private readonly jwks;

  constructor(private readonly config: AppConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.oauthJwksUrl));
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.oauthIssuer,
        audience: this.config.oauthAudience
      });
      const subject = payload.sub;
      if (!subject || !this.config.allowedSubjects.has(subject)) {
        throw new InvalidTokenError('Utente non autorizzato per EdilKappa.');
      }
      if (typeof payload.exp !== 'number') throw new InvalidTokenError('Token privo di scadenza.');
      const clientId = typeof payload.client_id === 'string'
        ? payload.client_id
        : typeof payload.azp === 'string' ? payload.azp : 'chatgpt';
      const extra: Record<string, unknown> = { subject };
      if (typeof payload.email === 'string') extra.email = payload.email;
      return {
        token,
        clientId,
        scopes: tokenScopes(payload),
        expiresAt: payload.exp,
        resource: new URL(this.config.resourceUrl),
        extra
      };
    } catch (error) {
      if (error instanceof InvalidTokenError) throw error;
      if (error instanceof joseErrors.JOSEError) throw new InvalidTokenError('Token OAuth non valido.');
      throw new InvalidTokenError('Impossibile verificare il token OAuth.');
    }
  }
}

export function hasScope(authInfo: AuthInfo | undefined, scope: string): boolean {
  return Boolean(authInfo?.scopes.includes(scope));
}

export function oauthToolError(config: AppConfig, scope: string): CallToolResult {
  const challenge = `Bearer resource_metadata="${config.resourceMetadataUrl}", scope="${scope}", error="insufficient_scope", error_description="Collega l’account EdilKappa per continuare"`;
  return {
    content: [{ type: 'text', text: 'Collega l’account EdilKappa per usare questo comando.' }],
    _meta: { 'mcp/www_authenticate': [challenge] },
    isError: true
  };
}

export function authSubject(authInfo: AuthInfo | undefined): string {
  const subject = authInfo?.extra?.subject;
  if (typeof subject !== 'string' || !subject) throw new Error('Identità OAuth mancante.');
  return subject;
}
