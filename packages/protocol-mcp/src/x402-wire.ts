/**
 * SUN-1222C-MCP-PAYMENT-DESIGN-CORRECTION (Architecture C): the official
 * x402-over-MCP wire carriers, verified against the real, published
 * `@x402/mcp@2.25.0` package (dist/esm/index.mjs, inspected directly via
 * `npm pack`, not inferred from README prose — see
 * docs/reports/SUN-1222C-mcp-payment-interaction-design.md §22):
 *
 *   PaymentRequired  -> CallToolResult{ isError: true, structuredContent,
 *                        content[0].text } (primary carrier this module
 *                        implements; the JSON-RPC -32042 fallback belongs
 *                        to transport-level rejection, not this module)
 *   PaymentPayload    -> _meta["x402/payment"]      (client -> server)
 *   SettleResponse    -> _meta["x402/payment-response"] (server -> client)
 *
 * This module is transport adaptation ONLY — pure parsing/serialization,
 * zero economic authority, zero settlement capability, zero network I/O.
 * It reuses @x402/core's own Zod-backed `parsePaymentPayload` (the exact
 * validator `@siteborne/protocol-x402`'s `decodePaymentSignatureHeaderSafe`
 * already uses for the REST transport) rather than a second hand-rolled
 * schema, so a payload this module accepts is provably the same shape the
 * REST boundary already accepts — no new acceptance criteria invented.
 */
import { parsePaymentPayload } from '@x402/core/schemas';
import type { PaymentPayload, PaymentRequired, SettleResponse } from '@x402/core/types';

/** The official carrier key for the buyer's payment authorization, read
 * from a retried `tools/call` request's own `_meta`. */
export const X402_MCP_PAYMENT_META_KEY = 'x402/payment' as const;

/** The official carrier key for the settlement outcome, written onto a
 * fulfilled tool result's `_meta`. */
export const X402_MCP_PAYMENT_RESPONSE_META_KEY = 'x402/payment-response' as const;

/** Deliberately narrow — only the one field this module reads. Mirrors
 * `ctx.mcpReq._meta`'s real shape (a loose, string-keyed record) without
 * depending on the SDK's own `RequestMeta` type export. */
export type McpRequestMeta = Readonly<Record<string, unknown>> | undefined;

/**
 * Extracts and validates a `PaymentPayload` from a tool call's `_meta`.
 * Returns `undefined` for a genuinely unpaid call (no key present) and for
 * a key present but schema-invalid — both cases the caller must treat as
 * "no valid payment supplied", never distinguished in a way that would let
 * a malformed payload smuggle through as "no payment attempted, retry
 * silently as unpaid" versus "attempted invalid payment, reject with
 * detail". Callers that need to tell these apart should call
 * `parsePaymentPayload` themselves; this function is deliberately fail-
 * closed and undifferentiated for the common case.
 */
export function extractPaymentPayload(meta: McpRequestMeta): PaymentPayload | undefined {
  if (meta === undefined) return undefined;
  const raw = meta[X402_MCP_PAYMENT_META_KEY];
  if (raw === undefined) return undefined;
  const result = parsePaymentPayload(raw);
  if (!result.success) return undefined;
  if (result.data.x402Version !== 2) return undefined;
  return result.data as unknown as PaymentPayload;
}

/** A minimal structural shape covering both the split-v2 SDK's
 * `CallToolResult` and SITEBORNE's own error-result helper's return type
 * — this module never imports `@modelcontextprotocol/server` itself, so
 * it stays usable from contexts (like a future isolated conformance
 * fixture) that don't want that dependency. */
export interface McpToolResultShape {
  // Open index signature: the SDK's own `CallToolResult` type is an open
  // record (`{ [x: string]: unknown; content: ...; ... }`), and a value
  // returned from a registered tool callback is structurally checked
  // against it -- without this, TypeScript instead tries to match this
  // interface against the OTHER member of the callback's real return
  // union (`InputRequiredResult`, which this shape is never meant to
  // satisfy) and fails there instead.
  [key: string]: unknown;
  // Literal `true`, not `boolean`: every real caller either omits this
  // field entirely (a fulfilled result) or sets it to exactly `true` (an
  // error/payment-required result) -- matching the SDK's own CallToolResult
  // discriminated shape closely enough that a value built from this
  // interface structurally satisfies it without a broadening cast.
  isError?: true;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  _meta?: Readonly<Record<string, unknown>>;
}

/**
 * Builds the official PaymentRequired tool-result carrier: `isError: true`
 * with the machine-readable `PaymentRequired` object in `structuredContent`
 * and a human-readable JSON-text fallback in `content[0]`. Per the design
 * correction's §12 requirement, the two must never disagree — this
 * function derives `content[0].text` from the SAME `paymentRequired`
 * object passed in `structuredContent`, so they cannot drift.
 */
export function buildPaymentRequiredResult(paymentRequired: PaymentRequired): McpToolResultShape {
  return {
    isError: true,
    structuredContent: paymentRequired,
    content: [{ type: 'text', text: JSON.stringify(paymentRequired) }],
  };
}

/**
 * Attaches the official SettleResponse carrier onto an already-built
 * fulfilled tool result. Never invents settlement facts — the caller must
 * supply a `SettleResponse` produced by the canonical settlement
 * authority; this function only serializes it onto the wire in the
 * official location.
 */
export function attachPaymentResponseMeta<T extends McpToolResultShape>(
  result: T,
  settleResponse: SettleResponse
): T {
  return {
    ...result,
    _meta: { ...result._meta, [X402_MCP_PAYMENT_RESPONSE_META_KEY]: settleResponse },
  };
}
