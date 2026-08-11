# SITEBORNE A2A Agent Card

## Local discovery surface

- Agent Card: `GET /.well-known/agent-card.json`
- Public-key set: `GET /.well-known/jwks.json`
- Canonical future Agent Card URL:
  `https://utility.siteborne.net/.well-known/agent-card.json`
- Canonical future JWKS URL:
  `https://utility.siteborne.net/.well-known/jwks.json`
- Content types: `application/a2a+json` and `application/jwk-set+json`

The routes are mounted locally in the existing Hono edge application. The
canonical URLs describe intended identity and do not claim DNS, TLS, public
reachability, registry publication, or production availability. Those remain
SUN-0800B.

## Card truthfulness

The card declares:

- identity: `SITEBORNE Utility Network`
- provider: `SITEBORNE`
- agent version: `1.0.0`
- one preferred `JSONRPC` interface at `https://utility.siteborne.net/a2a`,
  protocol version `1.0`
- exactly four immutable SITEBORNE service skills
- JSON input/output modes
- no separate A2A authentication requirement
- streaming, push notifications, and extended Agent Card disabled
- one optional SITEBORNE x402 v1 AgentExtension
- payment required for useful execution
- production disabled for the card and every service declaration
- accepted registry descriptions, schemas, tags, and limitations
- executable exact/upto mappings from the accepted x402 policy

## Signing and verification

SUN-0800A uses a dedicated local A2A signer:

- Algorithm: ES256
- Curve: P-256
- `kid`: `siteborne-a2a-local-es256-v1`
- `jku`: canonical future SITEBORNE JWKS URL
- private key: runtime-generated, non-exportable, closure-scoped, never written
  to disk or returned by the API
- JWKS: public EC key only; no private `d` member

The official SDK performs v1 normalization, removes `signatures`, canonicalizes
with RFC 8785/JCS, and creates/verifies the JWS. Tests resolve the canonical
`jku` through an injected trusted local resolver; they never fetch a public URL.

Acceptance rejects unsigned cards, content/skill/endpoint/payment/production
mutations, unknown `kid`, wrong public keys, malicious `jku`, malformed JWS, and
signature mutation. Reordering object properties while preserving semantics
continues to verify because signing uses canonical form.

This local key is not a production custody plan. SUN-0800B must provision a
production-specific A2A identity, define secure custody and rotation, deploy the
JWKS/Card over verified TLS/DNS, and prove public verification before external
publication.

## Separate proof domains

The Agent Card JWS covers advertised agent metadata only. It is separate from:

- SITEBORNE PCC receipts, which carry service-result verification proof; and
- x402 `PAYMENT-RESPONSE`/settlement evidence, which carries payment proof.

No one artifact is accepted as a substitute for another.
