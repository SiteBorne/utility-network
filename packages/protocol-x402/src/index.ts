/**
 * @siteborne/protocol-x402 — SUN-0700A checkpoint 1: x402 V2
 * credential-independent payment protocol foundation. Message
 * construction, requirement/quote/resource binding, and structural
 * payload validation only. No facilitator client, no wallet, no
 * settlement, no CDP credentials — see
 * docs/decisions/0041-x402-v2-protocol-boundary.md.
 */
export * from './version';
export * from './types';
export * from './errors';
export * from './canonical';
export * from './ids';
export * from './network/schemes';
export * from './pricing/mapping';
export * from './quote/quote';
export * from './requirements/exact';
export * from './challenge/payment-required';
export * from './codec/headers';
export * from './payload/parser';
