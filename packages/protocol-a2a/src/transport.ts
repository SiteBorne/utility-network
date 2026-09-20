import {
  A2A_CONTENT_TYPE,
  A2A_VERSION_HEADER,
  AgentCard,
  Extensions,
  HTTP_EXTENSION_HEADER,
} from '@a2a-js/sdk';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  UnauthenticatedUser,
  defaultServerCallContextBuilder,
  validateVersion,
} from '@a2a-js/sdk/server';
import { Hono } from 'hono';
import { buildUnsignedSiteborneAgentCard } from './card';
import { A2A_PROTOCOL_VERSION, SITEBORNE_A2A_ORIGIN } from './constants';
import { createSiteborneA2aExecutor } from './executor';
import { createLocalA2aSigningIdentity } from './signing';
import type { CreateSiteborneA2aOptions } from './types';

const DEFAULT_ALLOWED_HOSTS = [
  'utility.siteborne.net',
  'localhost',
  '127.0.0.1',
  '[::1]',
  'test.local',
] as const;
const MAX_REQUEST_BYTES = 262_144;
const MAX_STRUCTURED_DATA_BYTES = 65_536;
const MAX_OBJECT_DEPTH = 64;
const MAX_OBJECT_NODES = 10_000;
const HOSTILE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function objectSafetyError(value: unknown): string | undefined {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || current.value === null || typeof current.value !== 'object') continue;
    visited += 1;
    if (visited > MAX_OBJECT_NODES) return 'request object graph exceeds the node bound';
    if (current.depth > MAX_OBJECT_DEPTH) return 'request object graph exceeds the depth bound';
    const entries = Array.isArray(current.value)
      ? current.value.map((nested) => ['', nested] as const)
      : Object.entries(current.value);
    for (const [key, nested] of entries) {
      if (HOSTILE_OBJECT_KEYS.has(key)) return 'request contains a forbidden object key';
      stack.push({ value: nested, depth: current.depth + 1 });
    }
  }
  return undefined;
}

function jsonRpcError(id: unknown, code: number, message: string, status = 400): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: typeof id === 'string' || typeof id === 'number' || id === null ? id : null,
      error: { code, message },
    }),
    {
      status,
      headers: { 'content-type': A2A_CONTENT_TYPE, [A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION },
    }
  );
}

function validateRawV1Request(value: unknown): string | undefined {
  const safetyError = objectSafetyError(value);
  if (safetyError) return safetyError;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const rpc = value as Record<string, unknown>;
  if (rpc.method === 'message/send' || rpc.method === 'tasks/send') {
    return 'legacy A2A v0.3 methods are not supported';
  }
  if (rpc.method !== 'SendMessage') return undefined;
  const params = rpc.params;
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const message = (params as Record<string, unknown>).message;
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return undefined;
  const parts = (message as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return undefined;
  for (const part of parts) {
    if (part === null || typeof part !== 'object' || Array.isArray(part)) continue;
    const record = part as Record<string, unknown>;
    if (Object.hasOwn(record, 'kind')) return 'legacy Part kind discriminators are not supported';
    const alternatives = ['text', 'raw', 'url', 'data'].filter((key) => Object.hasOwn(record, key));
    if (alternatives.length !== 1) return 'each Part must contain exactly one content member';
    if (alternatives[0] === 'data') {
      const size = new TextEncoder().encode(JSON.stringify(record.data)).byteLength;
      if (size > MAX_STRUCTURED_DATA_BYTES) return 'structured DataPart exceeds the request bound';
    }
  }
  return undefined;
}

function headerRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function hostAllowed(request: Request, allowedHosts: readonly string[]): boolean {
  const host = new URL(request.url).host;
  return allowedHosts.includes(host) || allowedHosts.includes(new URL(request.url).hostname);
}

function originAllowed(request: Request, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return allowedOrigins.includes(parsed.host) || allowedOrigins.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Framework-neutral SDK handler wrapped in a minimal Hono adapter. The signed
 * discovery identity is immutable for this app instance; each POST receives a
 * fresh executor, task store, request handler, and transport handler.
 */
export async function createSiteborneA2aHonoApp(options: CreateSiteborneA2aOptions = {}) {
  const identity = options.signingIdentity ?? (await createLocalA2aSigningIdentity());
  const unsignedCard =
    options.unsignedAgentCard ??
    buildUnsignedSiteborneAgentCard(
      options.effectiveProductionStatusByServiceId,
      options.mtlsProductionActive,
      options.paymentDestination ?? null,
      options.securityDeclarationExtension ?? null
    );
  if (unsignedCard.signatures.length > 0) {
    throw new Error('supplied Agent Card must be unsigned');
  }
  const signedCard = await identity.sign(unsignedCard);
  await identity.verify(signedCard);
  const app = new Hono();
  const allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_HOSTS;

  app.use('*', async (context, next) => {
    if (
      !hostAllowed(context.req.raw, allowedHosts) ||
      !originAllowed(context.req.raw, allowedOrigins)
    ) {
      return context.json({ error: 'request_origin_rejected' }, 403);
    }
    await next();
  });

  app.get('/.well-known/agent-card.json', (context) =>
    context.body(JSON.stringify(AgentCard.toJSON(signedCard)), 200, {
      'content-type': A2A_CONTENT_TYPE,
      [A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION,
      'cache-control': 'no-store',
    })
  );

  app.get('/.well-known/jwks.json', (context) =>
    context.body(JSON.stringify(identity.jwks), 200, {
      'content-type': 'application/jwk-set+json',
      'cache-control': 'no-store',
    })
  );

  app.post('/a2a', async (context) => {
    const contentType = context.req.header('content-type')?.split(';', 1)[0]?.trim();
    if (contentType !== 'application/json' && contentType !== A2A_CONTENT_TYPE) {
      return jsonRpcError(null, -32600, 'A2A requests require a JSON content type', 415);
    }
    const bodyText = await context.req.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) {
      return jsonRpcError(null, -32600, 'A2A request exceeds the request bound', 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return jsonRpcError(null, -32700, 'Malformed JSON', 400);
    }
    const rawError = validateRawV1Request(body);
    const requestId =
      body !== null && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).id
        : null;
    if (rawError) return jsonRpcError(requestId, -32602, rawError, 400);

    const requestHandler = new DefaultRequestHandler(
      signedCard,
      new InMemoryTaskStore(),
      createSiteborneA2aExecutor(options.serviceBoundary)
    );
    const handler = new JsonRpcTransportHandler(requestHandler);
    const requestedVersion = context.req.header(A2A_VERSION_HEADER);
    const callContext = defaultServerCallContextBuilder({
      extensions: Extensions.parseServiceParameter(context.req.header(HTTP_EXTENSION_HEADER)),
      user: new UnauthenticatedUser(),
      headers: headerRecord(context.req.raw.headers),
      requestedVersion,
    });
    try {
      validateVersion(callContext.requestedVersion, signedCard, 'JSONRPC');
      const result = await handler.handle(body as Record<string, unknown>, callContext);
      if (typeof result === 'object' && result !== null && Symbol.asyncIterator in result) {
        return jsonRpcError(requestId, -32004, 'streaming is not supported', 400);
      }
      const responseHeaders: Record<string, string> = {
        'content-type': A2A_CONTENT_TYPE,
        [A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION,
      };
      if (callContext.activatedExtensions) {
        responseHeaders[HTTP_EXTENSION_HEADER] = Extensions.toServiceParameter(
          callContext.activatedExtensions
        );
      }
      return context.body(JSON.stringify(result), 200, responseHeaders);
    } catch (error) {
      return context.body(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requestId ?? null,
          error: JsonRpcTransportHandler.mapToJSONRPCError(error),
        }),
        400,
        { 'content-type': A2A_CONTENT_TYPE, [A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION }
      );
    }
  });

  return app;
}

export const SITEBORNE_LOCAL_A2A_ORIGIN = SITEBORNE_A2A_ORIGIN;
