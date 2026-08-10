# SITEBORNE Utility Network — ADR 0050: Signed Offers & Receipts — Evaluation and Decision (SUN-0700A checkpoint 4)

## Context

Directive §22-32 required SITEBORNE to evaluate the official x402 Signed Offers
& Receipts extension (`@x402/extensions/offer-receipt`) before implementing
anything, score it against a rubric, and record the result — explicitly stating
any of the three allowed outcomes (A: implement now, B: define linkage types but
defer signing, C: defer entirely) is acceptable provided it is justified.

## What the extension actually is (inspected directly from the compiled package)

`@x402/extensions/offer-receipt` implements a **payment-interaction** proof,
distinct from both x402's own settlement response and SITEBORNE's PCC
verification receipt (see "Three receipt classes" below):

- A **signed offer**: the resource server signs the payment terms it presented
  in a 402 response (`OfferPayload`: version, resourceUrl, scheme, network,
  asset, payTo, amount, validUntil).
- A **signed receipt**: the resource server signs proof that service was
  delivered after payment (`ReceiptPayload`: version, network, resourceUrl,
  payer, issuedAt, optional transaction hash).
- Two signature formats: **EIP-712** (`secp256k1`, on-chain-style typed data,
  chain-ID-scoped domain) and **JWS** (`jose`, multiple asymmetric key
  algorithms including Ed25519, `did:key`/`did:jwk`/`did:web` key resolution).
- The official documentation explicitly recommends a signing identity **distinct
  from the payment-receiving address** for both formats.

Inspecting the compiled subpath directly
(`node_modules/@x402/extensions/dist/cjs/offer-receipt/index.js`) shows its
runtime imports: `jose`, `viem`, `@noble/curves/nist`,
`@noble/curves/secp256k1`, `@scure/base`, `@x402/core/http` — a materially
heavier dependency surface than the `bazaar` or `payment-identifier` subpaths
this checkpoint actually uses (ADR 0041, ADR 0048).

## Three receipt classes (directive §23) — kept explicitly distinct

| Class                                     | What it proves                                               | Where it lives                                            |
| ----------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| **A. x402 settlement/payment response**   | The payment itself settled                                   | `SettleResponse` (`@x402/core/types`), `codec/headers.ts` |
| **B. x402 Signed Offer & Receipt**        | The server committed to terms and later asserts delivery     | `@x402/extensions/offer-receipt` — **not implemented**    |
| **C. SITEBORNE verification/PCC receipt** | The service output is verified against the evidence gathered | `@siteborne/verification`'s `VerificationReceipt`         |

These are never merged into one name/type anywhere in this codebase (directive
§33) — `PaymentServiceLink` (checkpoint 3, ADR 0047) references class C by
ID/hash only, and is explicitly designed to cross-link to a future class-B
artifact without ever becoming it.

## Decision rubric

| Criterion                                  | EIP-712                                                                                                                                                                                                             | JWS/did:web                                                                                                                                                      | Defer                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Interoperability                           | High (established Ethereum tooling)                                                                                                                                                                                 | High (broad JOSE ecosystem, multi-key-type)                                                                                                                      | N/A                    |
| Implementation complexity                  | Medium — new secp256k1 signer, typed-data domain                                                                                                                                                                    | Medium-high — DID document hosting/resolution, key rotation semantics                                                                                            | None                   |
| Runtime compatibility (Cloudflare Workers) | `viem`/`@noble/curves` — workable but heavy                                                                                                                                                                         | `jose` — workable, lighter than viem, still non-trivial                                                                                                          | No new runtime surface |
| Key-isolation quality                      | Requires a **new** secp256k1 identity, explicitly separate from `payTo` — directive-mandated separation is easy to satisfy structurally, but is a second key type alongside SITEBORNE's existing Ed25519 (SUN-0500) | Ed25519 is directly supported — **aligns with SITEBORNE's existing verification-signer infrastructure** (`@siteborne/verification`'s `Signer`/`KeyRegistry`)     | N/A                    |
| Key-rotation story                         | On-chain-style, no revocation primitive in the extension itself                                                                                                                                                     | `did:web` document rotation is a hosting/ops concern SITEBORNE has not built                                                                                     | N/A                    |
| External verification                      | Requires a recovered-signer check only (self-contained)                                                                                                                                                             | Requires resolving a hosted `did:web` document over the network — **directly conflicts with this checkpoint's no-network constraint** if ever exercised for real | N/A                    |
| Domain/service identity binding            | Address-based, no domain binding                                                                                                                                                                                    | `did:web:utility.siteborne.net` — strong domain binding, but requires publishing `/.well-known/did.json` (not deployed)                                          | N/A                    |
| Secret-management burden                   | New private key, new custody path                                                                                                                                                                                   | New private key, new custody path (lighter than EIP-712 if Ed25519 is reused for the _format_, but a distinct key from SUN-0500's per directive)                 | None                   |
| Dependency weight                          | `viem`/`@noble/curves` (heavy, wallet-adjacent)                                                                                                                                                                     | `jose` (lighter, still non-trivial)                                                                                                                              | None                   |
| Production deployment dependencies         | None beyond a signer                                                                                                                                                                                                | `/.well-known/did.json` hosting on `utility.siteborne.net` — **not deployed** (production is not deployed at all yet)                                            | None                   |
| Overlap with PCC receipt                   | None structurally, but easy to conflate operationally without careful naming (directive §33 — addressed by naming discipline, not by the extension itself)                                                          | Same                                                                                                                                                             | N/A                    |
| Actual value to autonomous buyers _today_  | Low — no live facilitator, no real payment, no wallet exists to make an offer/receipt meaningful yet                                                                                                                | Low, same reason                                                                                                                                                 | N/A                    |

## Decision: **C — defer entirely**

Neither format has a real problem to solve yet: SUN-0700A has no live route, no
wallet, no facilitator, and no deployed `did:web` document — every offer/receipt
this checkpoint could produce would be signed with a throwaway test key over
synthetic data, proving only that the extension's own crypto works (which its
own upstream test suite already proves). That is not evidence about SITEBORNE's
integration; it would be theater. Directive §29 explicitly allows deferring
entirely when the rubric supports it, and directive §28 explicitly warns against
implementing "merely because it is novel."

**JWS/Ed25519/`did:web` is the leading candidate when this is revisited**
(SUN-0700B or a dedicated later increment) — it aligns with SITEBORNE's existing
Ed25519 verification-signer infrastructure and gives a domain-bound identity
distinct from a payment wallet, exactly matching the official recommendation the
user's directive cited. EIP-712 is not ruled out, but its `viem`/`secp256k1`
dependency weight and lack of a domain-identity story make it the weaker
default. This preference is recorded here as guidance for that future decision,
not as a commitment made now.

## Consequences

- No `@x402/extensions/offer-receipt` import exists anywhere in this package —
  proven by both a static source-grep and an explicit `no-network.test.ts`
  assertion.
- No test-only signing key, DID fixture, or signature verification code exists
  in this checkpoint — there is nothing to test that would not be testing the
  upstream package's own crypto.
- `PaymentServiceLink` (checkpoint 3) is already shaped to cross-link to a
  future signed-receipt artifact without modification, so this deferral costs
  nothing structurally when a real implementation eventually happens.
- Revisiting this decision requires: a deployed production route (SUN-0700B),
  and — if JWS is chosen — a hosted `/.well-known/did.json` on
  `utility.siteborne.net`. Until both exist, any implementation would be
  synthetic-only, which this ADR judges not worth the dependency and key-custody
  cost yet.
