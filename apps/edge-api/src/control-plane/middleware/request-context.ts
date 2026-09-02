import { z } from 'zod';
import type { Context, Next } from 'hono';
import type { Env } from '../config/env';
import type {
  ArtifactsRepository,
  AuditRepository,
  IdempotencyRepository,
  JobAttemptsRepository,
  JobsRepository,
  QueueDispatchRepository,
  QuotaRepository,
  SecurityRepository,
  ServicesRepository,
  ServiceVersionsRepository,
  StateEventsRepository,
} from '../repositories/interfaces';
import type { ArtifactStore } from '../artifacts/store';
import type { AuditLogger } from '../audit/events';
import type { QueueDispatchHandler, QueueProducer } from '../queue/dispatch';

export interface RequestContext {
  requestId: string;
  correlationId: string;
  idempotencyKey: string | null;
  serviceId: string | null;
  serviceVersion: string | null;
  inputHash: string | null;
  inputSchemaHash: string | null;
  startTime: number;
  isTestMode: boolean;
  auditContext: AuditContext;
}

export interface AuditContext {
  requestId: string;
  correlationId: string;
  clientIp?: string;
  userAgent?: string;
  timestamp: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    correlationId: string;
    requestContext: RequestContext;
    auditContext: AuditContext;
    idempotencyKey: string;
    isTestMode: boolean;
    servicesRepo: ServicesRepository;
    serviceVersionsRepo: ServiceVersionsRepository;
    jobsRepo: JobsRepository;
    jobAttemptsRepo: JobAttemptsRepository;
    stateEventsRepo: StateEventsRepository;
    idempotencyRepo: IdempotencyRepository;
    artifactsRepo: ArtifactsRepository;
    queueDispatchRepo: QueueDispatchRepository;
    quotaRepo: QuotaRepository;
    auditRepo: AuditRepository;
    securityRepo: SecurityRepository;
    artifactStore: ArtifactStore;
    queueProducer: QueueProducer;
    dispatchHandler: QueueDispatchHandler;
    auditLogger: AuditLogger;
  }
}

export const RequestContextSchema = z.object({
  requestId: z.string().uuid(),
  correlationId: z.string().uuid(),
  idempotencyKey: z.string().optional(),
  serviceId: z.string().optional(),
  serviceVersion: z.string().optional(),
  inputHash: z.string().optional(),
  inputSchemaHash: z.string().optional(),
  startTime: z.number(),
  isTestMode: z.boolean(),
  auditContext: z.object({
    requestId: z.string().uuid(),
    correlationId: z.string().uuid(),
    clientIp: z.string().optional(),
    userAgent: z.string().optional(),
    timestamp: z.string().datetime({ offset: true }),
  }),
});

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

export function createRequestContext(
  requestId: string,
  correlationId: string,
  idempotencyKey: string | null,
  isTestMode: boolean,
  clientIp?: string,
  userAgent?: string
): RequestContext {
  return {
    requestId,
    correlationId,
    idempotencyKey,
    serviceId: null,
    serviceVersion: null,
    inputHash: null,
    inputSchemaHash: null,
    startTime: Date.now(),
    isTestMode,
    auditContext: {
      requestId,
      correlationId,
      clientIp,
      userAgent,
      timestamp: new Date().toISOString(),
    },
  };
}

export const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

export const AllowedContentTypes = ['application/json', 'application/json; charset=utf-8'] as const;

export function validateContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return AllowedContentTypes.some((ct) => contentType.startsWith(ct));
}

export function createIdempotencyMiddleware() {
  return async (c: Context, next: Next) => {
    const requestId = c.get('requestId') || generateRequestId();
    const correlationId = c.get('correlationId') || generateCorrelationId();
    const idempotencyKey = c.req.header('Idempotency-Key') || null;
    const isTestMode = true; // Default to test mode for local development

    c.set(
      'requestContext',
      createRequestContext(
        requestId,
        correlationId,
        idempotencyKey,
        isTestMode,
        c.req.header('CF-Connecting-IP'),
        c.req.header('User-Agent')
      )
    );

    if (idempotencyKey) {
      c.set('idempotencyKey', idempotencyKey);
    }

    await next();
  };
}

export function createBodySizeMiddleware() {
  return async (c: Context, next: Next) => {
    const contentLength = c.req.header('Content-Length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return c.json(
        {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds maximum size of ${MAX_BODY_SIZE} bytes`,
        },
        413
      );
    }
    await next();
  };
}

/**
 * SUN-1222C-1-REMEDIATION §4 — the exact, narrow list of route+method pairs
 * that intentionally accept a body that is not `application/json`. Every
 * such route is responsible for validating its OWN accepted content/media
 * types itself (`document-artifact-upload-route.ts` -> `document-upload.ts`
 * already does, with its own 38-case test suite) — this list exists only
 * to stop the global JSON-only check from rejecting those requests BEFORE
 * the route ever runs. Adding an entry here does not relax any other
 * route's JSON-only enforcement, and must never be used to broadly accept
 * "any content type" — see this checkpoint's evidence report §4 for why a
 * path-scoped exemption was chosen over restructuring mount order (which
 * would also drop error/security/audit/idempotency/body-size middleware
 * for the exempted route) or weakening `AllowedContentTypes` globally
 * (which would remove JSON-only protection from every other endpoint).
 */
const NON_JSON_BODY_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'POST', path: '/v2/artifacts/documents' },
];

function isNonJsonBodyRoute(method: string, path: string): boolean {
  return NON_JSON_BODY_ROUTES.some((route) => route.method === method && route.path === path);
}

export function createContentTypeMiddleware() {
  return async (c: Context, next: Next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      if (!isNonJsonBodyRoute(c.req.method, c.req.path)) {
        const contentType = c.req.header('Content-Type');
        if (!validateContentType(contentType)) {
          return c.json(
            { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json' },
            415
          );
        }
      }
    }
    await next();
  };
}

export function createStructuredErrorMiddleware() {
  return async (c: Context, next: Next) => {
    try {
      await next();
    } catch (error) {
      const requestContext = c.get('requestContext');
      const requestId = requestContext?.requestId || 'unknown';

      if (error instanceof z.ZodError) {
        return c.json(
          {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: error.errors,
            request_id: requestId,
          },
          400
        );
      }

      if (
        error instanceof Error &&
        (error.name === 'InvalidTransitionError' || error.name === 'TerminalStateError')
      ) {
        return c.json(
          {
            code: 'INVALID_STATE_TRANSITION',
            message: error.message,
            request_id: requestId,
          },
          409
        );
      }

      console.error(`[${requestId}] Unhandled error:`, error);
      return c.json(
        {
          code: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
          request_id: requestId,
        },
        500
      );
    }
  };
}

export function createSecurityHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  };
}

export function createRequestTimingMiddleware() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    c.header('X-Request-Duration-Ms', String(duration));
  };
}

export function createAuditContextMiddleware() {
  return async (c: Context, next: Next) => {
    const requestContext = c.get('requestContext');
    if (requestContext) {
      c.set('auditContext', requestContext.auditContext);
    }
    await next();
  };
}

export function createDevelopmentModeMiddleware(env?: Env) {
  return async (c: Context, next: Next) => {
    const isTestMode = env?.ENVIRONMENT !== 'production';
    c.set('isTestMode', isTestMode);
    await next();
  };
}

export function getRequestContext(c: Context): RequestContext {
  return c.get('requestContext');
}

export function getAuditContext(c: Context): AuditContext {
  return (
    c.get('auditContext') || {
      requestId: 'unknown',
      correlationId: 'unknown',
      timestamp: new Date().toISOString(),
    }
  );
}

export function getIsTestMode(c: Context): boolean {
  return c.get('isTestMode') ?? false;
}

export const REQUEST_CONTEXT_KEY = 'requestContext';
export const AUDIT_CONTEXT_KEY = 'auditContext';
export const IDEMPOTENCY_KEY = 'idempotencyKey';
export const TEST_MODE_KEY = 'isTestMode';
