import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod/v4';
import { authSubject, hasScope, oauthToolError, OidcTokenVerifier } from './auth.js';
import { readConfig, type AppConfig } from './config.js';
import { downloadTemporaryFile } from './files.js';
import { EdilKappaRepository, type DaneaRequestRecord, type StoredRecord } from './repository.js';

const READ_SCOPE = 'edilkappa:read';
const WRITE_SCOPE = 'edilkappa:write';
const READ_SCHEME = [{ type: 'oauth2', scopes: [READ_SCOPE] }] as const;
const WRITE_SCHEME = [{ type: 'oauth2', scopes: [WRITE_SCOPE] }] as const;

const openAIFileSchema = z.object({
  download_url: z.string(),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().optional()
}).strict();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa una data nel formato AAAA-MM-GG.');
const isoDateTime = z.string().datetime({ offset: true });
const daneaStatus = z.enum(['Nuovo', 'Preso in carico', 'In corso', 'Posticipato', 'Completato', 'Inoltrato', 'Rifiutato']);

const storedOutputSchema = {
  id: z.string(),
  archivio: z.enum(['Preventivi', 'Documenti']),
  titolo: z.string(),
  cliente: z.string(),
  gestionale_url: z.string(),
  duplicato: z.boolean(),
  avviso: z.string()
};

function storedOutput(record: StoredRecord, config: AppConfig) {
  return {
    id: record.id,
    archivio: record.archive,
    titolo: record.title,
    cliente: record.client,
    gestionale_url: config.siteUrl,
    duplicato: record.alreadyExisted,
    avviso: record.warning || ''
  };
}

function savedResult(record: StoredRecord, config: AppConfig) {
  const output = storedOutput(record, config);
  const action = record.alreadyExisted ? 'era già presente' : 'è stato salvato';
  const warning = record.warning ? ` ${record.warning}` : '';
  return {
    content: [{ type: 'text' as const, text: `“${record.title}” ${action} nell’archivio ${record.archive} di EdilKappa.${warning}` }],
    structuredContent: output
  };
}

const daneaOutputSchema = {
  id: z.string(),
  intervento_id: z.string(),
  studio: z.string(),
  titolo: z.string(),
  cliente: z.string(),
  indirizzo: z.string(),
  stato_danea: daneaStatus,
  stato_edilkappa: z.string(),
  ricevuta_il: z.string(),
  data_prevista: z.string(),
  gestionale_url: z.string(),
  duplicato: z.boolean(),
  avviso: z.string()
};

function daneaOutput(record: DaneaRequestRecord, config: AppConfig) {
  return {
    id: record.id,
    intervento_id: record.interventionId,
    studio: record.studio,
    titolo: record.title,
    cliente: record.client,
    indirizzo: record.address,
    stato_danea: record.daneaStatus,
    stato_edilkappa: record.status,
    ricevuta_il: record.receivedAt,
    data_prevista: record.scheduledDate,
    gestionale_url: config.siteUrl,
    duplicato: record.alreadyExisted,
    avviso: record.warning || ''
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Operazione non riuscita.';
  console.error('Errore comando EdilKappa:', message);
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true
  };
}

function toolMeta(schemes: readonly { type: 'oauth2'; scopes: readonly string[] }[], invoking: string, invoked: string, acceptsFile = false) {
  return {
    securitySchemes: schemes.map((scheme) => ({ type: scheme.type, scopes: [...scheme.scopes] })),
    ui: { visibility: ['model'] },
    ...(acceptsFile ? { 'openai/fileParams': ['file'] } : {}),
    'openai/toolInvocation/invoking': invoking,
    'openai/toolInvocation/invoked': invoked
  };
}

function createServer(repository: EdilKappaRepository, config: AppConfig): McpServer {
  const server = new McpServer({ name: 'edilkappa-gestionale', version: '1.1.0' });

  registerAppTool(server, 'cerca_clienti', {
    title: 'Cerca clienti EdilKappa',
    description: 'Cerca clienti o condomìni già presenti nel gestionale EdilKappa. Usalo prima di salvare un documento quando il nome del cliente è incerto.',
    inputSchema: {
      query: z.string().max(160).default('').describe('Nome, parte del nome o indirizzo del cliente.')
    },
    outputSchema: {
      clienti: z.array(z.object({ id: z.string(), nome: z.string(), indirizzo: z.string() }))
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    _meta: toolMeta(READ_SCHEME, 'Ricerca clienti…', 'Clienti trovati')
  }, async ({ query }, extra) => {
    if (!hasScope(extra.authInfo, READ_SCOPE)) return oauthToolError(config, READ_SCOPE);
    try {
      const clients = await repository.searchClients(query);
      const output = { clienti: clients.map((client) => ({ id: client.id, nome: client.name, indirizzo: client.address })) };
      return {
        content: [{ type: 'text', text: clients.length ? `Trovati ${clients.length} clienti nel gestionale.` : 'Nessun cliente corrispondente trovato.' }],
        structuredContent: output
      };
    } catch (error) {
      return toolError(error);
    }
  });

  registerAppTool(server, 'cerca_richieste_danea', {
    title: 'Cerca richieste Danea',
    description: 'Usa questo comando quando l’utente vuole trovare o controllare richieste Danea già importate in EdilKappa, anche prima di salvarne o aggiornarne una.',
    inputSchema: {
      query: z.string().max(200).default('').describe('Codice intervento, studio, condominio, indirizzo, titolo o stato.')
    },
    outputSchema: {
      richieste: z.array(z.object(daneaOutputSchema))
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    _meta: toolMeta(READ_SCHEME, 'Ricerca richieste Danea…', 'Richieste Danea trovate')
  }, async ({ query }, extra) => {
    if (!hasScope(extra.authInfo, READ_SCOPE)) return oauthToolError(config, READ_SCOPE);
    try {
      const records = await repository.searchDaneaRequests(query);
      const output = { richieste: records.map((record) => daneaOutput(record, config)) };
      return {
        content: [{ type: 'text', text: records.length ? `Trovate ${records.length} richieste Danea nel gestionale.` : 'Nessuna richiesta Danea corrispondente trovata.' }],
        structuredContent: output
      };
    } catch (error) {
      return toolError(error);
    }
  });

  registerAppTool(server, 'salva_richiesta_danea', {
    title: 'Importa richiesta Danea in EdilKappa',
    description: 'Usa questo comando quando l’utente chiede di importare o aggiornare nel gestionale una richiesta ricevuta da Danea Interventi. Il salvataggio è idempotente per ID e-mail oppure per studio più codice intervento e richiede conferma prima della scrittura.',
    inputSchema: {
      source_message_id: z.string().max(512).optional().describe('ID stabile del messaggio e-mail, quando disponibile.'),
      intervento_id: z.string().max(80).optional().describe('Codice della richiesta o dell’intervento Danea.'),
      studio: z.string().min(1).max(160).describe('Studio o amministratore che ha inviato l’incarico.'),
      titolo: z.string().min(1).max(200),
      cliente: z.string().min(1).max(160).describe('Condominio o cliente associato.'),
      cliente_id: z.string().max(128).optional().describe('ID restituito da cerca_clienti, quando disponibile.'),
      indirizzo: z.string().max(240).optional(),
      descrizione: z.string().min(1).max(8_000),
      priorita: z.enum(['Normale', 'Urgente', 'Emergenza']).default('Normale'),
      stato_danea: daneaStatus.default('Nuovo'),
      ricevuta_il: isoDateTime.default(() => new Date().toISOString()),
      data_prevista: isoDate.optional(),
      referente: z.string().max(160).optional(),
      telefono: z.string().max(80).optional(),
      note: z.string().max(2_000).optional(),
      link_danea: z.string().url().max(2_048).optional().describe('Collegamento HTTPS ufficiale Danea o MioCondominio.')
    },
    outputSchema: daneaOutputSchema,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    _meta: toolMeta(WRITE_SCHEME, 'Importazione richiesta Danea…', 'Richiesta Danea archiviata')
  }, async (input, extra) => {
    if (!hasScope(extra.authInfo, WRITE_SCOPE)) return oauthToolError(config, WRITE_SCOPE);
    try {
      const record = await repository.saveDaneaRequest({
        ...(input.source_message_id ? { sourceMessageId: input.source_message_id } : {}),
        ...(input.intervento_id ? { interventionId: input.intervento_id } : {}),
        studio: input.studio,
        title: input.titolo,
        clientName: input.cliente,
        ...(input.cliente_id ? { clientId: input.cliente_id } : {}),
        ...(input.indirizzo ? { address: input.indirizzo } : {}),
        description: input.descrizione,
        priority: input.priorita,
        daneaStatus: input.stato_danea,
        receivedAt: input.ricevuta_il,
        ...(input.data_prevista ? { scheduledDate: input.data_prevista } : {}),
        ...(input.referente ? { reference: input.referente } : {}),
        ...(input.telefono ? { phone: input.telefono } : {}),
        ...(input.note ? { notes: input.note } : {}),
        ...(input.link_danea ? { sourceUrl: input.link_danea } : {}),
        authSubject: authSubject(extra.authInfo)
      });
      const output = daneaOutput(record, config);
      const action = record.alreadyExisted ? 'è stata aggiornata senza creare doppioni' : 'è stata importata';
      const warning = record.warning ? ` ${record.warning}` : '';
      return {
        content: [{ type: 'text', text: `La richiesta Danea “${record.title}” ${action} in EdilKappa.${warning}` }],
        structuredContent: output
      };
    } catch (error) {
      return toolError(error);
    }
  });

  registerAppTool(server, 'salva_preventivo', {
    title: 'Salva preventivo in EdilKappa',
    description: 'Archivia un preventivo già generato come file nella sezione Preventivi del gestionale EdilKappa. Richiede conferma dell’utente prima della scrittura.',
    inputSchema: {
      file: openAIFileSchema.describe('File PDF o Word del preventivo da archiviare.'),
      oggetto: z.string().min(1).max(200).describe('Oggetto sintetico del preventivo.'),
      cliente: z.string().max(160).default('').describe('Nome del cliente o condominio.'),
      cliente_id: z.string().max(128).optional().describe('ID restituito da cerca_clienti, quando disponibile.'),
      numero: z.string().max(80).optional().describe('Numero del preventivo; se omesso viene generato.'),
      importo_netto: z.number().min(0).max(100_000_000).optional(),
      data: isoDate.default(() => new Date().toISOString().slice(0, 10)),
      stato: z.enum(['Bozza', 'Inviato']).default('Bozza')
    },
    outputSchema: storedOutputSchema,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    _meta: toolMeta(WRITE_SCHEME, 'Salvataggio preventivo…', 'Preventivo archiviato', true)
  }, async (input, extra) => {
    if (!hasScope(extra.authInfo, WRITE_SCOPE)) return oauthToolError(config, WRITE_SCOPE);
    try {
      const file = await downloadTemporaryFile(input.file, config.downloadHostSuffixes);
      const result = await repository.saveQuote({
        file,
        sourceFileId: input.file.file_id,
        subject: input.oggetto,
        clientName: input.cliente,
        ...(input.cliente_id ? { clientId: input.cliente_id } : {}),
        ...(input.numero ? { quoteNumber: input.numero } : {}),
        ...(input.importo_netto !== undefined ? { netAmount: input.importo_netto } : {}),
        date: input.data,
        status: input.stato,
        authSubject: authSubject(extra.authInfo)
      });
      return savedResult(result, config);
    } catch (error) {
      return toolError(error);
    }
  });

  registerAppTool(server, 'salva_relazione', {
    title: 'Salva relazione in EdilKappa',
    description: 'Archivia una relazione tecnica già generata come file nella sezione Documenti del gestionale EdilKappa. Richiede conferma dell’utente prima della scrittura.',
    inputSchema: {
      file: openAIFileSchema.describe('File PDF o Word della relazione da archiviare.'),
      titolo: z.string().min(1).max(200).describe('Titolo della relazione tecnica.'),
      cliente: z.string().max(160).default('').describe('Nome del cliente o condominio.'),
      cliente_id: z.string().max(128).optional().describe('ID restituito da cerca_clienti, quando disponibile.'),
      data_documento: isoDate.default(() => new Date().toISOString().slice(0, 10)),
      note: z.string().max(2_000).optional(),
      scadenza: isoDate.optional()
    },
    outputSchema: storedOutputSchema,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    _meta: toolMeta(WRITE_SCHEME, 'Salvataggio relazione…', 'Relazione archiviata', true)
  }, async (input, extra) => {
    if (!hasScope(extra.authInfo, WRITE_SCOPE)) return oauthToolError(config, WRITE_SCOPE);
    try {
      const file = await downloadTemporaryFile(input.file, config.downloadHostSuffixes);
      const result = await repository.saveReport({
        file,
        sourceFileId: input.file.file_id,
        title: input.titolo,
        clientName: input.cliente,
        ...(input.cliente_id ? { clientId: input.cliente_id } : {}),
        documentDate: input.data_documento,
        ...(input.note ? { notes: input.note } : {}),
        ...(input.scadenza ? { expiry: input.scadenza } : {}),
        authSubject: authSubject(extra.authInfo)
      });
      return savedResult(result, config);
    } catch (error) {
      return toolError(error);
    }
  });

  return server;
}

const config = readConfig();
const repository = new EdilKappaRepository(config);
const verifier = new OidcTokenVerifier(config);
const publicHost = new URL(config.publicBaseUrl).host;
const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: [publicHost, '127.0.0.1', 'localhost'] });
app.disable('x-powered-by');
app.set('trust proxy', 1);

const protectedResourceMetadata = {
  resource: config.resourceUrl,
  authorization_servers: [config.oauthIssuer],
  scopes_supported: [READ_SCOPE, WRITE_SCOPE],
  resource_documentation: config.siteUrl,
  bearer_methods_supported: ['header']
};

app.get('/healthz', (_request, response) => {
  response.json({ ok: true, service: 'edilkappa-gestionale', version: '1.0.0' });
});

app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_request, response) => {
  response.set('Cache-Control', 'public, max-age=300').json(protectedResourceMetadata);
});

const requireOAuth = requireBearerAuth({
  verifier,
  resourceMetadataUrl: config.resourceMetadataUrl
});

app.post('/mcp', requireOAuth, async (request, response) => {
  const server = createServer(repository, config);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  response.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    console.error('Errore trasporto MCP:', error instanceof Error ? error.message : error);
    if (!response.headersSent) {
      response.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Errore interno del server.' }, id: null });
    }
  }
});

app.get('/mcp', requireOAuth, (_request, response) => {
  response.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Metodo non consentito.' }, id: null });
});

app.delete('/mcp', requireOAuth, (_request, response) => {
  response.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Metodo non consentito.' }, id: null });
});

const httpServer = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Connettore EdilKappa in ascolto sulla porta ${config.port}.`);
});

function shutdown(signal: string) {
  console.log(`Ricevuto ${signal}, arresto in corso.`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
