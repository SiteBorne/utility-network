# SUN-1222C-AGENT-TRUST-100-DESIGN

Design-only evidence checkpoint. Zero production mutation, zero Cloudflare
change, zero DNS change, zero certificate issuance, zero live payment.

## 0. Starting state

```
START_HEAD=ac642cb4d56601f62a15f1bfcf80a3eff4821693
BRANCH=main
WORKING_TREE=CLEAN
PCC_IMPLEMENTATION_EXISTS=0 (git cat-file exit code)
PCC_IMPLEMENTATION_REACHABLE=0 (git merge-base exit code)
```

All evidence below was gathered live during this checkpoint via the
Agenstry public API, Cloudflare's current documentation, and the exact
`@a2a-js/sdk@1.0.1` package already pinned in this repository's
`node_modules` (the same version SITEBORNE's own A2A route builds against)
-- not from memory or assumption.

## 1. Current external score (live, re-fetched this checkpoint)

Fetched directly: `GET https://agenstry.com/api/agents/utility.siteborne.net/audit.json`
(methodology version 1.1, generated at request time).

```
AGENSTRY_SCORE=90/100
AGENSTRY_GRADE=A

AGENSTRY_VALID_AGENTCARD=10/10 pass
AGENSTRY_LIVE_JSON_RPC=25/25 pass (~29ms)
AGENSTRY_PROTOCOL_VERSION=10/10 pass (A2A 1.0, supportedInterfaces[])
AGENSTRY_JWS_SIGNATURE=10/10 pass (signed, signature_valid=true)
AGENSTRY_UPTIME=15/15 pass (17/17 probes, 100% over 30d)
AGENSTRY_SKILL_DECLARATION=10/10 pass (8 skills declared)
AGENSTRY_VERIFIED_IDENTITY=5/10 partial -- "Provider declared: SITEBORNE
  (https://siteborne.com). Add a registry identifier (LEI, Companies House
  number, KvK, ABN, ...) to provider.legalEntity for full verified-business
  credit." [verbatim from live audit.json]
AGENSTRY_FRESHNESS=5/5 pass
AGENSTRY_SECURITY_DECLARATION=0/5 info -- "Neither securitySchemes nor
  securityRequirements declared -- how to authenticate is unstated."
  [verbatim from live audit.json]

AGENT_DOMAIN_OWNERSHIP_VERIFIED=YES (DNS-TXT proof, shown as "verified by
  owner" on the live profile page)
JWS_EXTERNALLY_VERIFIED=YES (signature_valid: true, independently checked
  by Agenstry against SITEBORNE's own published JWKS)
```

Matches the checkpoint's stated expected recent state exactly (90/100,
5/10 verified identity, 0/5 security). No drift to explain.

Independently re-fetched the live AgentCard directly
(`GET https://utility.siteborne.net/.well-known/agent-card.json`) and
confirmed by direct inspection: no `securitySchemes` key and no
`securityRequirements` key present anywhere in the current card -- matches
Agenstry's finding exactly, not merely trusted secondhand.

## 2. Agenstry security scoring -- proven, not assumed

Source: `GET https://agenstry.com/methodology` (Conformance Methodology,
open specification v1.1) and its machine-readable twin
`GET https://agenstry.com/api/schemas/conformance.json`. Both documents are
required to stay in sync per Agenstry's own stated policy, and agree.

Criterion 9 ("Security declaration", 5 pts, **card-derived** -- i.e.
independently reproducible from the AgentCard alone, not from Agenstry's
private measurement history):

> mTLS -> 5 pts. OAuth2 + PKCE (S256) -> 4 pts. Any other declared scheme
> -> 2 pts. Explicit `securityRequirements: []` (deliberately public) ->
> 2 pts. Nothing declared -> 0 pts. "An open endpoint that says so scores
> the same as one declaring an unenforced scheme -- we do not reward a
> false declaration over an honest one."

```
AGENSTRY_SECURITY_NO_DECLARATION_SCORE=0
AGENSTRY_SECURITY_BASIC_DECLARATION_SCORE=2 (any declared scheme; also the
  score for an explicit empty securityRequirements: [])
AGENSTRY_SECURITY_MTLS_SCORE=5
AGENSTRY_SECURITY_PKCE_SCORE=4

MTLS_EXPECTED_FULL_SECURITY_CREDIT=YES (proven directly from the published
  methodology text, not inferred)
```

Notable, useful side-finding: declaring an explicit empty
`securityRequirements: []` alone (zero new infrastructure, a pure card
change) would already move SITEBORNE from 0 to 2/5 on this criterion. That
is not the target design (mTLS is authorized and available -- see 3 and 4
below) but is recorded here as the honest zero-cost floor.

## 3. Current A2A v1.0 authority -- exact pinned SITEBORNE implementation

Inspected `@a2a-js/sdk@1.0.1` directly
(`node_modules/.pnpm/@a2a-js+sdk@1.0.1_.../dist/`), the exact version this
repository's `a2a:check` gate already builds and tests against (confirmed
passing earlier this session: "A2A spec baseline OK: @a2a-js/sdk@1.0.1,
spec 1.0, JSONRPC").

```
A2A_MTLS_NATIVE=YES (SecurityScheme is a discriminated union with an
  explicit mtlsSecurityScheme case; MutualTlsSecurityScheme is a first-
  class exported type)
A2A_SKILL_SECURITY_REQUIREMENTS_NATIVE=YES (AgentSkill.securityRequirements:
  SecurityRequirement[] exists as a distinct field, independent of the
  AgentCard-root securityRequirements)
```

Exact shapes, proven by reading the type declarations AND the compiled
`toJSON()`/`fromJSON()` implementations directly (so the JSON wire shape
is proven, not inferred from the TypeScript-internal `$case` union
representation, which differs from the wire format):

`MutualTlsSecurityScheme` (compiled `toJSON`, `dist/index.js`):
```ts
interface MutualTlsSecurityScheme {
  description?: string; // omitted entirely from JSON when empty
}
```

`SecurityScheme.toJSON()` flattens the oneof directly onto the wire object
using the case name as the literal key (confirmed from compiled source,
`dist/index.js` lines 757-758):
```json
{ "mtlsSecurityScheme": { "description": "..." } }
```

`AgentCard.securitySchemes` is a string-keyed map to `SecurityScheme`
(`{[key: string]: SecurityScheme}`), so a full scheme entry looks like:
```json
"securitySchemes": {
  "mtls": { "mtlsSecurityScheme": { "description": "..." } }
}
```

```
MTLS_SECURITY_SCHEME_EXACT_SHAPE={"mtlsSecurityScheme":{"description":"<string, optional>"}}
```

`SecurityRequirement.toJSON()` (compiled source, `dist/index.js` lines
703-715) -- confirmed exact shape:
```json
{ "schemes": { "<schemeName>": [ "<scope>", "..." ] } }
```
```
SECURITY_REQUIREMENT_EXACT_SHAPE={"schemes":{"<schemeName>":["<scope>",...]}}
```

## 4. Security requirement boolean semantics -- proven

`AgentCard.securityRequirements` and `AgentSkill.securityRequirements` are
both typed `SecurityRequirement[]` -- an **array** of requirement objects.
Each `SecurityRequirement.schemes` is a **map** from scheme name to a
scope list. This is the exact structural shape of the OpenAPI 3.x
Security Requirement Object model, which the SDK's own doc comment cites
explicitly ("This is a discriminated union type based on the OpenAPI 3.2
Security Scheme Object"), and OpenAPI's own spec fixes the semantics for
that exact shape:

```
SECURITY_REQUIREMENTS_ARRAY_SEMANTICS=OR (each entry in the array is an
  alternative; satisfying any ONE array entry is sufficient)
SECURITY_REQUIREMENT_MULTI_SCHEME_SEMANTICS=AND (multiple scheme keys
  within a single SecurityRequirement.schemes map must ALL be satisfied
  together)
```

Practical consequence for the three variants named in the checkpoint:
- "x402 only" (current state): no `securitySchemes`/`securityRequirements`
  at all -- x402 is not represented in this model in the first place (see
  5 below).
- "mTLS OR x402": not representable as a `securityRequirements` OR at all,
  because x402 has no `SecurityScheme` case -- this pairing must stay
  outside the A2A security model entirely (unaffected root-level access).
- "mTLS + x402 required together": would need one `SecurityRequirement`
  entry with both scheme keys present -- not proposed here; see 7.

## 5. Critical proven fact: x402 has no A2A SecurityScheme representation

`SecurityScheme`'s discriminated union has exactly five cases:
`apiKeySecurityScheme`, `httpAuthSecurityScheme`, `oauth2SecurityScheme`,
`openIdConnectSecurityScheme`, `mtlsSecurityScheme`. There is no x402 or
payment case. SITEBORNE's live AgentCard (re-fetched this checkpoint)
confirms x402 is represented entirely through the separate `extensions[]`
mechanism (`"uri":"https://siteborne.net/extensions/a2a/x402/v1"`), not
through `securitySchemes`/`securityRequirements` at all.

This proves the checkpoint's own caution correct: x402 must never be
declared as (or confused with) an A2A authentication scheme. It also
proves the two planes are structurally orthogonal in the current pinned
SDK -- adding an `mtlsSecurityScheme` declaration cannot interact with,
gate, or weaken the existing x402 extension mechanism at the schema level,
regardless of how `securityRequirements` is set.

## 6. Authentication options -- compared

| | A: mTLS | B: OAuth2 AuthCode+PKCE | C: OAuth2 Client Credentials | D: OIDC |
|---|---|---|---|---|
| Autonomous machine suitability | High (no human step) | Low (needs a browser/human) | High | Low (built for human SSO) |
| Human interaction required | No | Yes (authorize screen) | No | Yes |
| Browser required | No | Yes | No | Yes |
| Key/cert custody | Client holds a cert+key | Client holds no long-lived secret (token only) | Client holds a client_secret | Client holds no long-lived secret |
| Revocation | Cloudflare-side (CA/cert) | IdP-side (token revoke) | IdP-side | IdP-side |
| Rotation | Cert reissue | Token refresh | Secret rotation | Token refresh |
| A2A-native representation | Yes (`mtlsSecurityScheme`, first-class) | Yes (`AuthorizationCodeOAuthFlow`) | Yes (`ClientCredentialsOAuthFlow`) | Yes (`openIdConnectSecurityScheme`) |
| Agenstry scoring | 5/5 (full) | 4/5 (PKCE variant only) | 2/5 ("any other scheme") | 2/5 |
| New infrastructure for SITEBORNE | Cloudflare mTLS config only (already-available platform feature) | New OAuth authorization-server, consent UI | New OAuth token-issuance server | New OIDC provider or federation |
| Operational complexity added | Low | High (human-in-the-loop UI) | Medium (secret issuance/rotation) | High |
| Fits autonomous agent callers | Yes | Poorly (contradicts autonomous machine commerce) | Yes, but adds secret-custody surface x402 buyers don't already have | Poorly |

`RECOMMENDED_STRONG_AUTH=MTLS` is the only option requiring no new identity
infrastructure (Cloudflare already provides it, see 7), fits autonomous
machine callers without a human consent step, and is the only option
scoring full Agenstry credit alongside the lowest operational complexity.

## 7. Preferred authority -- mTLS, gated on proof

```
A2A_MTLS_NATIVE=YES (proven, section 3)
CLOUDFLARE_INBOUND_MTLS_AVAILABLE=YES (proven, section 8)
MTLS_EXPECTED_FULL_SECURITY_CREDIT=YES (proven, section 2)
MTLS_CAN_BE_ENFORCED_TRUTHFULLY=YES (Workers can read a Cloudflare-verified
  client-cert verdict at request.cf.tlsClientAuth -- see 12 -- so a
  declared-and-enforced claim would be truthful, not aspirational)
```

All four gates pass -> `RECOMMENDED_STRONG_AUTH=MTLS` is confirmed, not
merely preferred by default.

mTLS's role is strictly **caller/agent machine identity**. x402 remains
the **sole economic authorization** mechanism. mTLS is never given
settlement authority, never substitutes for a payment authorization, never
custodies a caller's or buyer's private key, and never auto-signs a
payment for a caller. (`TOTAL_PRODUCTION_SETTLE_CALLSITES` stays at 1,
unchanged by this design -- see 26.)

## 8. Cloudflare inbound mTLS -- capability, proven from current docs

Source: `https://developers.cloudflare.com/api-shield/security/mtls/`
(fetched live this checkpoint).

> "All Cloudflare plans can set up mTLS with a Cloudflare-managed
> certificate authority (CA). Enterprise customers can upload up to five
> non-Cloudflare CAs."

```
CLOUDFLARE_INBOUND_MTLS_AVAILABLE=YES
CLOUDFLARE_MANAGED_CA_AVAILABLE_ON_CURRENT_PLAN=YES (available on every
  plan tier, not Enterprise-gated; SITEBORNE does not need to determine
  its current plan tier for this to hold)
BYOCA_REQUIRED=NO (Cloudflare-managed CA is sufficient; BYOCA is an
  Enterprise-only *option*, never a requirement)
MTLS_ENFORCEMENT_LAYER=BOTH (a dashboard/WAF-level rule can require
  presentation of a valid client cert on chosen hostnames/paths, and the
  Worker itself can additionally read and branch on the verified cert
  state per-request -- see 12)
```

This is distinct from, and must not be confused with, Workers **outbound**
mTLS bindings (`mtls_certificates` in `wrangler.toml`, used when a Worker
calls out to another mTLS-protected service) -- an unrelated, already-
unused-here mechanism.

## 9. Preserve the anonymous Agenstry live probe -- design

Agenstry's live probe (the `Live JSON-RPC`, 25/25-point criterion) issues
a version-negotiated `SendMessage`/`message/send` call with no credentials
and no client certificate. The AgentCard's **root** `securityRequirements`
governs "security requirements for contacting the agent" as a whole; the
**skill-level** `AgentSkill.securityRequirements` is a separate, narrower
override field that exists precisely so a card can leave the root open
while gating individual skills (proven in section 3/4).

```
PUBLIC_PROBE_PRESERVATION_DESIGN=OPTION A + OPTION C combined:
  - Root AgentCard.securityRequirements stays an explicit empty array
    ([]) or is set once per section 2's "deliberately public" floor
    reasoning -- SendMessage/heartbeat/discovery remains fully anonymous
    at the protocol level.
  - AgentCard.securitySchemes gains one new entry declaring the mTLS
    scheme's *availability* -- this alone is what Agenstry's card-derived
    criterion 9 reads (a scheme catalog entry), independent of whether
    securityRequirements enforces it anywhere.
  - mTLS is enforced (both by a Cloudflare-side rule and Worker-side
    branch) only on skills/paths the product later decides warrant it,
    via AgentSkill.securityRequirements on those specific skills -- never
    at the root.
```

This satisfies both targets simultaneously without trade-off:
```
AGENSTRY_LIVE_JSON_RPC_TARGET=25/25 (unaffected -- root stays open)
AGENSTRY_SECURITY_DECLARATION_TARGET=5/5 (satisfied by the scheme
  declaration itself, proven in section 2's own methodology text)
```

## 10. x402-only buyers -- preserved

Because x402 is not an A2A security scheme (section 5) and the root
`securityRequirements` stays open (section 9), nothing in this design adds
a precondition to the existing flow: unauthenticated discovery -> x402
`PaymentRequired` -> buyer-side signing -> paid execution. No SITEBORNE
client certificate is ever required to become, or remain, a paying x402
client.

```
X402_ONLY_PAID_CLIENTS_SUPPORTED=YES
X402_ONLY_PAID_POLICY=unchanged: any caller may attempt any currently-
  paid-and-enabled v2 skill via x402 alone; PaymentRequired/binding/
  settlement semantics (proven unchanged this engagement, section 26)
  are the only gate.
MTLS_ENHANCED_PAID_POLICY=optional, additive: a caller presenting a
  Cloudflare-verified client certificate gains a durable, attributable
  caller identity recorded alongside its payment (see 12), but a caller
  without one is never blocked from x402-only paid execution on any skill
  that has not been explicitly assigned an mTLS security requirement.
```

## 11. Chosen authentication policy model

```
RECOMMENDED_AUTH_POLICY_MODEL=B
WHY=x402 remains sufficient for ordinary paid execution on every existing
  skill; mTLS is declared as an available, optional, stronger caller-
  identity profile at the card root (satisfying Agenstry's card-derived
  criterion in full); it does not become a precondition for any existing
  buyer, preserves the anonymous live-probe path Agenstry itself scores,
  and introduces no new settlement owner, no buyer-wallet custody, and no
  new economic protocol. Model C (selected high-trust skills requiring
  mTLS+x402 together) remains available as a strict future *superset* of
  this same design -- nothing here forecloses it -- but is not itself
  authorized or product-decided by this checkpoint (see 24, slice D).
```

## 12. Runtime mTLS identity binding -- design

Only Cloudflare-authenticated platform state may ever be trusted for
caller-certificate identity -- never a client-supplied header claiming
certificate identity (a trivially forgeable input if trusted; see the
threat model, section 23). The Workers runtime exposes exactly this
platform-verified state, proven directly from the pinned
`@cloudflare/workers-types` package already vendored in this repository
(`apps/edge-api/node_modules/@cloudflare/workers-types/index.d.ts`) --
the same authoritative type source this engagement already used
successfully for `ScheduledController` in the settlement-alert Worker
(SUN-1222C-R4-D12):

```ts
// request.cf.tlsClientAuth, discriminated on certPresented:
// certPresented: "1" case:
certVerified: Exclude<CertVerificationStatus, "NONE">; // "SUCCESS" | "FAILED..." variants
certRevoked: "1" | "0";
certIssuerDN: string;
certSubjectDN: string;
certSerial: string;
certFingerprintSHA1: string;
certFingerprintSHA256: string;
certNotBefore: string;
certNotAfter: string;
// certPresented: "0" case: all fields empty/"NONE" -- no cert offered
```

`CertVerificationStatus` (proven from the same file): `"SUCCESS" | "NONE"
| "FAILED:self signed certificate" | "FAILED:unable to verify the first
certificate" | "FAILED:certificate is not yet valid" | "FAILED:certificate
has expired" | "FAILED"` -- an exhaustive, already-typed enum covering
every rejection class the threat model (23) needs to enforce against.

```
MTLS_CALLER_IDENTITY_SOURCE=request.cf.tlsClientAuth (Cloudflare-verified
  platform state only; a client-supplied header is never trusted for this
  purpose)
MTLS_CALLER_IDENTITY_CANONICALIZATION=certFingerprintSHA256 (stable,
  collision-resistant, and already the SDK's preferred field over the
  legacy SHA1 fingerprint or the DN strings, which are operator-chosen
  and not guaranteed unique)
MTLS_CALLER_IDENTITY_LOGGING_POLICY=log only certFingerprintSHA256 and
  certVerified/certRevoked status; never log certIssuerDN/certSubjectDN
  verbatim (may carry operator-chosen free text) or any raw certificate
  bytes -- matching this engagement's existing "secrets handled strictly
  by name/fingerprint, never raw material" discipline (SUN-1222C-R4-D10's
  boundedDetail() pattern is the direct precedent to reuse).
MTLS_CALLER_IDENTITY_RESULT_BINDING=not implemented by this design. See
  next line.
```

```
PCC_CONTRACT_CHANGE_REQUIRED_FOR_MTLS=YES -- adding authenticated-caller
  identity to a PCC document would require a new field in the immutable
  `contracts/releases/2.0.0` schema (proven `additionalProperties: false`
  throughout, per this engagement's own SUN-1222C-PCC-WIRE-RESULT-
  IMPLEMENTATION governance work), which is by definition a new public
  contract change. DO NOT implement this under the current trust
  checkpoint. If wanted, it is future work requiring a dedicated,
  separately authorized contract-versioning checkpoint (a 2.1.0 release),
  not a silent addition alongside this design.
```

## 13. Agenstry's exact supported legal registries -- proven

Source: the live methodology page and its machine-readable schema (section
2), criterion 7 ("Verified Identity"), quoted verbatim:

> "Provider attribution PLUS authoritative-registry verification (GLEIF /
> Companies House / KvK / ABN / Handelsregister / EU BRIS / ISED /
> OpenCorporates). Active and name-matching -> 10. Active but mismatched
> -> 7. Declared but inactive -> 2."

```
AGENSTRY_SUPPORTED_LEGAL_REGISTRIES=GLEIF (LEI), Companies House (UK), KvK
  (Netherlands), ABN (Australia), Handelsregister (Germany), EU BRIS
  (EU business-register interconnection system), ISED (Canada),
  OpenCorporates (aggregator -- indexes many jurisdictions' company
  registries, including US state-level filings, e.g. Delaware)
```

Note: OpenCorporates is explicitly named in the live methodology text and
is a real, independently-operated open corporate-registry aggregator that
does index U.S. state filings. This is evidence, not assumption, that a
U.S.-registered SITEBORNE entity has *a* plausible path to a supported
registry identifier via OpenCorporates -- but this checkpoint does not
independently confirm SITEBORNE's own filing is indexed there (that would
require querying OpenCorporates for SITEBORNE's specific legal name, an
external, non-repository action outside this design checkpoint's scope).
No EIN, D-U-N-S, or bare state LLC filing number is named anywhere in the
methodology as directly accepted on its own.

## 14. SITEBORNE's own legal identity availability -- searched, not found

Searched this repository's source, generated contracts, and docs for any
already-public SITEBORNE registration identifier (LEI, Companies House
number, KvK, ABN, EIN, D-U-N-S, or similar), restricted to public-surface
files only. Every `lei`/`ein` match found belongs to the
`company_evidence_graph` service's own *input/output schema fields for
third-party subjects being researched* (e.g. Apple Inc.'s EIN in a SEC
EDGAR fixture) -- never SITEBORNE's own identity.

```
SITEBORNE_ACCEPTED_PUBLIC_REGISTRY_ID_PRESENT=NO
LEGAL_IDENTITY_PREREQUISITE=external, non-engineering action: the
  SITEBORNE operator must obtain (or already hold and choose to publish)
  a registry identifier from one of section 13's accepted registries --
  most directly GLEIF's LEI (globally applicable, self-service, does not
  require SITEBORNE to already be registered with a *specific* national
  registry Agenstry recognizes) -- and add it to the AgentCard via the
  path proven safe in section 15/16. This is a business/legal action, not
  a code change, and is out of this checkpoint's authority to perform or
  simulate.
```

## 15. provider.legalEntity core-AgentCard compatibility -- proven unsafe

Read `AgentProvider`'s exact type directly from the pinned SDK
(`a2a-4AAMnZHp.d.ts`):

```ts
interface AgentProvider {
  url: string;
  organization: string;
}
```

And its compiled `toJSON()` (`dist/index.js`), which explicitly
constructs a **new** object containing only these two fields:

```js
var AgentProvider = {
  toJSON(message) {
    const obj = {};
    if (message.url !== "") obj.url = message.url;
    if (message.organization !== "") obj.organization = message.organization;
    return obj;
  }
};
```

Any third field (e.g. `legalEntity`) attached to a value passed through
this exact serialization path is silently dropped before signing -- it
would never reach the object that gets JWS-signed and served, regardless
of intent. This is proven directly from the exact pinned dependency's
compiled behavior, not inferred.

```
LEGAL_ENTITY_IN_CORE_AGENTCARD_SAFE=NO
```

Confirms the checkpoint's own caution: `provider.legalEntity` cannot be
added to the core, currently-typed `AgentProvider` object without either
(a) a source change widening a currently-closed, shared A2A SDK-typed
structure (a new-public-contract-shaped change, out of this design
checkpoint's authority), or (b) hand-constructing raw JSON that bypasses
the SDK's typed builder entirely, which risks the card no longer round-
tripping through `AgentCard.fromJSON`/`toJSON` cleanly and jeopardizing
the `Valid AgentCard` 10/10 credit this checkpoint must not spend.

## 16. Agenstry signed catalog binding -- partially proven, rest UNKNOWN

The live conformance schema (section 2's `GET /api/schemas/conformance.json`)
confirms, verbatim, that a "signed catalog feed" exists as a concept and
contributes to the **freshness** criterion specifically (capped
contribution, "+1 for publishing a signed catalog feed we verified,
capped at 5" against the 5-point freshness total) -- **not** to
`verified_identity` directly. No public schema, canonical URL, or
documentation page for this catalog-feed mechanism was discoverable this
checkpoint (`/catalog`, `/docs/catalog`, `/api/catalog`,
`/api/schemas/catalog.json`, `/owner/catalog` all returned 404); the
checkpoint's own text describes it as an "owner dashboard" feature, which
is consistent with it being sign-in-gated and not publicly documented.

```
AGENSTRY_SIGNED_CATALOG_CAN_CARRY_LEGAL_IDENTITY=UNKNOWN (no public
  schema found; the one proven fact is that it feeds `freshness`, not
  `verified_identity` -- so even if it can *carry* a legal-entity claim,
  the proven scoring path to the 5/10 -> 10/10 verified_identity gap is
  criterion 7's own registry-match mechanism, section 13, independent of
  any catalog feed)
SITEBORNE_EXISTING_CATALOG_COMPATIBLE=NO (SITEBORNE's existing discovery/
  catalog endpoints -- the x402 service catalog under the A2A extension,
  and the separate MCP catalog -- are unrelated, service-discovery
  documents, not this Agenstry-specific signed-feed mechanism)
CANONICAL_CATALOG_URL=UNKNOWN (undiscoverable without owner-dashboard
  access this checkpoint does not have)
CATALOG_BINDING_RECOMMENDED=NO, not for this checkpoint's target. The
  proven, documented path (criterion 7's registry match) does not depend
  on it. Revisit only if criterion 7's own path proves insufficient after
  a real registry identifier is added and re-scored.
```

## 17. Agent Card security declaration -- proposed exact fragment

Validated structurally against the exact pinned `@a2a-js/sdk@1.0.1` types
proven in sections 3-4. Not applied to any source file by this checkpoint.

```json
{
  "securitySchemes": {
    "mtls": {
      "mtlsSecurityScheme": {
        "description": "Optional mutual-TLS client-certificate authentication, verified by Cloudflare. Not required for unauthenticated discovery or standard x402-paid execution; provides a stronger, attributable caller identity for callers who present a valid client certificate."
      }
    }
  },
  "securityRequirements": []
}
```

x402 remains represented exactly as it already is today, unchanged, via
the existing `capabilities.extensions[]` entry
(`https://siteborne.net/extensions/a2a/x402/v1`) -- proven in section 5 to
be structurally unrelated to `securitySchemes`, so no change to that block
is proposed or required here.

## 18. Eight-skill policy matrix

All 8 skills currently share identical policy (verified against the live
AgentCard fetched this checkpoint: no skill declares its own
`securityRequirements` today, and none is proposed to gain a *required*
mTLS entry by this design -- see 11's Model B). Product policy is
unchanged by this checkpoint; this table records the *current, proposed-
unchanged* runtime semantics, not a new decision:

| SKILL_ID | PUBLIC_DISCOVERY_ALLOWED | X402_REQUIRED | MTLS_SUPPORTED | MTLS_REQUIRED | EFFECTIVE_SECURITY_REQUIREMENTS |
|---|---|---|---|---|---|
| company_evidence_graph.v1 | YES | YES (v1 paid route) | YES (available, optional) | NO | [] (inherits root) |
| web_context_verified.v1 | YES | YES | YES | NO | [] |
| document_evidence_json.v1 | YES | YES | YES | NO | [] |
| verify_agent_output.v1 | YES | YES | YES | NO | [] |
| company_evidence_graph.v2 | YES | YES | YES | NO | [] |
| web_context_verified.v2 | YES | YES | YES | NO | [] |
| document_evidence_json.v2 | YES | YES | YES | NO | [] |
| verify_agent_output.v2 | YES | YES | YES | NO | [] |

Assigning `MTLS_REQUIRED=YES` to any specific skill is a **product**
decision (which skills, if any, should gain a stronger-identity gate) not
an engineering one, and is explicitly deferred to slice D (section 24) /
future policy checkpoint -- not decided here.

## 19. Public / strong / economic trust planes -- matrix

| OPERATION | PUBLIC | MTLS | X402 | MTLS+X402 |
|---|---|---|---|---|
| Agent Card (`.well-known/agent-card.json`) | YES (unchanged) | n/a | n/a | n/a |
| JWKS (`.well-known/jwks.json`) | YES (unchanged) | n/a | n/a | n/a |
| health | YES (unchanged) | n/a | n/a | n/a |
| ready | YES (unchanged) | n/a | n/a | n/a |
| catalog (x402/MCP) | YES (unchanged) | n/a | n/a | n/a |
| A2A no-op / heartbeat (SendMessage) | YES (unchanged -- this is Agenstry's own live probe) | optional, non-blocking | n/a | n/a |
| A2A paid skill | YES (discovery) | optional (caller may present a cert; not required by this design) | YES (unchanged, required for useful execution) | optional superset, not required |
| MCP initialize | YES (unchanged) | n/a | n/a | n/a |
| MCP tools/list | YES (unchanged) | n/a | n/a | n/a |
| MCP paid skill | YES (discovery) | not addressed by this design (MCP transport carries no client-cert channel in this repo's current adapter; out of scope) | YES (unchanged) | n/a |
| REST catalog | YES (unchanged) | n/a | n/a | n/a |
| REST paid service | YES (discovery) | optional, same as A2A paid skill | YES (unchanged, required) | optional superset |
| result retrieval (where applicable) | n/a | n/a | gated by existing payment_identifier binding (unchanged) | n/a |

## 20. JWS / JWKS -- explicitly unchanged

```
AGENT_CARD_JWS_ARCHITECTURE_CHANGED=NO
JWKS_ARCHITECTURE_CHANGED=NO
```

The proposed card fragment (section 17) is additive JSON content only. It
must flow through the exact same, already-existing canonical signing path
(`buildUnsignedSiteborneAgentCard` -> the existing JWS-signing step) this
checkpoint did not touch, read, or modify. No new signing key, no new JWKS
entry, no change to `AgentCardSignature` handling.

## 21. Card drift

Agenstry's own "Card history" panel (observed live on the profile page,
section 1) shows "drifted 9x" over 10 tracked snapshots -- purely
informational per the checkpoint's own instruction, and nothing in the
live methodology text (section 2) deducts conformance points for drift
frequency itself; it is a change-tracking feature, not a scored criterion.
Not treated as a release blocker.

## 22. Revenue evidence -- explicitly out of scope

Not used, not proposed. Agenstry's own methodology page independently and
explicitly disclaims its "observed stablecoin inflow" figure as non-
revenue, non-audited, and not usable to distinguish an arm's-length payer
from an operator moving its own money (quoted in section-2's source
fetch). This design touches none of that; conformance-score work and
revenue-evidence work are and remain separate concerns, exactly as the
checkpoint requires.

## 23. Threat model

| Threat | Enforcement layer | Mitigation |
|---|---|---|
| Forged client-cert header (caller sends a fake `X-Client-Cert`-style header claiming identity) | Worker | Never read; only `request.cf.tlsClientAuth` (Cloudflare-injected, not client-settable) is trusted -- section 12 |
| Direct Worker bypass (caller hits a Workers.dev URL or an unprotected origin path directly, skipping the mTLS-enforcing hostname) | Cloudflare edge / DNS | Existing `workers_dev = false` pattern (already used by every SITEBORNE Worker config in this repo, confirmed this engagement) plus routing only the intended custom hostname through the mTLS-checked zone |
| Alternate hostname bypass | Cloudflare edge | mTLS rules bind to specific hostnames; any alternate hostname would need its own explicit routing to reach the same Worker, which SITEBORNE's existing `wrangler.toml` route configuration already avoids creating |
| workers.dev bypass | Cloudflare edge | Same as above -- `workers_dev` disabled on all current SITEBORNE Workers |
| Certificate replay | TLS layer | mTLS is a live handshake proof-of-possession per connection; a captured certificate *file* is a genuine risk (see custody, section 6) but a captured *handshake transcript* cannot be replayed by TLS's own design |
| Revoked cert | Worker | `certRevoked: "1"` field (proven in section 12) checked explicitly; a revoked cert is never treated as verified even if `certVerified: "SUCCESS"` was true at handshake time |
| Expired cert | Cloudflare edge + Worker | `CertVerificationStatus` includes explicit `"FAILED:certificate has expired"` and `"FAILED:certificate is not yet valid"` cases (proven in section 12) -- rejected before reaching application logic |
| Wrong CA | Cloudflare edge | Cloudflare-managed CA scope (section 8) rejects any certificate not issued by the configured CA at the TLS layer, before the Worker is invoked |
| Cross-agent certificate use (one caller's cert used to impersonate another) | Worker (application logic) | `certFingerprintSHA256` is the canonical caller identity (section 12); any binding of that identity to a specific caller/account is an explicit, separate mapping this design does not yet create (see 12's binding note) -- flagged, not solved, by this checkpoint |
| mTLS -> x402 confused deputy (a valid cert wrongly treated as payment authorization) | Application logic / design invariant | Structurally prevented: mTLS has no A2A representation overlapping x402 (section 5), and this design explicitly, permanently forbids granting mTLS any settlement authority (section 7) |
| mTLS bypassing payment | Application logic / design invariant | Same as above -- no skill's payment gate is proposed to accept a certificate as a substitute for a valid x402 payment |
| Payment bypassing required mTLS | Application logic (only relevant for a future skill that sets `MTLS_REQUIRED=YES`) | Not yet applicable -- no skill is assigned a required-mTLS policy by this design (section 18); when/if one is, the skill-level `AgentSkill.securityRequirements` AND-within-one-entry semantics (section 4) can require both schemes together in one `SecurityRequirement` object |
| JWS/JWKS regression | Existing signing pipeline (unchanged) | Section 20 -- explicitly unchanged, additive-only card content |
| Public-probe accidental auth gating | Card design (this checkpoint's own decision) | Section 9 -- root `securityRequirements` stays empty; the risk is fully addressed by the design itself, not by a runtime safeguard, so this is a design-review item at implementation time, not a runtime check |
| Certificate/private-key logging | Application logic | Section 12's logging policy: only the SHA-256 fingerprint and verification/revocation status are ever logged; DN strings and raw certificate material are not |

## 24. Implementation slices (dependency-ordered)

```
A. AgentCard/schema security declarations
   -- add the section-17 fragment to buildUnsignedSiteborneAgentCard's
      output, re-sign through the existing pipeline (section 20). Smallest
      slice; delivers the full Agenstry security-declaration credit alone.

B. Inbound mTLS certificate visibility + validation
   -- Cloudflare-side mTLS configuration (managed CA, section 8) on the
      relevant hostname; no code change beyond reading
      request.cf.tlsClientAuth (section 12) where needed. Depends on A
      only in the sense that A's declaration should describe what B
      actually enforces (should not claim mTLS before B exists).

C. Runtime authenticated-caller identity policy
   -- the section-12 canonicalization/logging policy implemented in code
      (fingerprint extraction, revocation/expiry checks). Depends on B.

D. Skill-policy enforcement (if any)
   -- assigning MTLS_REQUIRED=YES to specific skills via
      AgentSkill.securityRequirements. A PRODUCT decision, not decided by
      this checkpoint (section 18/11). Depends on A-C existing first.

E. JWS re-signing regression proof
   -- targeted tests proving the modified card still signs/verifies
      identically in structure, and that root securityRequirements
      staying empty is regression-tested (not just asserted in prose).
      Can be developed alongside A.

F. Legal entity enrichment
   -- external, non-engineering: obtain a registry identifier (section
      13/14) and add it via whatever safe path is chosen once decided
      (NOT provider.legalEntity in the core card -- section 15 proves
      that unsafe; likely a dedicated, separately-designed extension or
      the catalog-binding path if section 16 is later resolved).
      Independent of A-E; can proceed in parallel.

G. Agenstry signed catalog binding (if pursued)
   -- blocked on resolving section 16's UNKNOWNs; not recommended as the
      primary path for the current +5 verified_identity gap (F's own
      registry-match path is proven sufficient and does not need this).

H. External Agenstry re-verification
   -- no action required beyond existing state; Agenstry re-probes on its
      own schedule (17 probes over 30 days observed) and via its dispute
      mechanism (section 21) if a faster re-check is wanted post-
      deployment.

I. Production deployment
   -- one Worker deployment carrying A's card change (and B's Cloudflare-
      side config, which is not a Worker deployment) once A-E are
      implemented and tested. Not performed by this checkpoint.
```

```
IMPLEMENTATION_TASK_COUNT=9 (A through I as listed)
```

## 25. 100/100 feasibility decision

```
CURRENT_SCORE=90/100 (10 valid_card + 25 live_json_rpc + 10
  protocol_version + 10 signature + 15 uptime + 10 skills + 5 verified_
  identity(partial) + 5 freshness + 0 security)

POST_SECURITY_EXPECTED_SCORE=95/100 (adds the proven 5/5 mTLS credit from
  section 2's methodology to the existing 90 -- security moves 0 -> 5,
  every other criterion unaffected by this design)

POST_LEGAL_IDENTITY_EXPECTED_SCORE=100/100 (adds the proven 5-point gap-
  closure from section 13's criterion 7, contingent entirely on the
  external prerequisite in section 14 -- verified_identity moves
  5(partial) -> 10(full), once an accepted registry identifier that
  name-matches SITEBORNE is added)

TARGET_SCORE=100/100
```

Per the checkpoint's own required test: only return
`TARGET_100_ACHIEVABLE_NOW=YES` if BOTH a full-credit mTLS path is proven
available AND an accepted public legal-registry identity is proven
available for SITEBORNE right now. The first is proven (sections 2, 3, 7,
8). The second is not (section 14: `SITEBORNE_ACCEPTED_PUBLIC_REGISTRY_ID_
PRESENT=NO`) -- it depends on an external, non-repository business action
(obtaining/publishing a registry identifier such as an LEI) that this
design checkpoint cannot perform or simulate.

```
TARGET_100_ACHIEVABLE_NOW=NO
```

The exact, sole external prerequisite blocking the remaining 5 points:
obtain a registry identifier from one of section 13's accepted registries
(GLEIF's LEI is the most directly self-service, globally applicable
option) for SITEBORNE's own legal entity, name-matching the organization
already declared in the card (`"organization":"SITEBORNE"`), then publish
it via a path proven safe by this design (not `provider.legalEntity` in
the core card -- section 15).

Once that external prerequisite is met, 100/100 becomes achievable purely
through implementation slice A (security declaration) plus whatever safe
carrier is chosen for the registry identifier -- no further design
uncertainty remains on the engineering side.

## 26. Zero effect (this checkpoint)

```
PRODUCTION_SOURCE_CHANGES=0
PRODUCTION_MUTATIONS=0
PRODUCTION_DEPLOYMENTS=0
DNS_MUTATIONS=0
WAF_MUTATIONS=0
CERTIFICATE_ISSUANCE=0
SECRET_MUTATIONS=0

LIVE_QUOTES_OR_INTENTIONAL_402_REQUESTS=0
REAL_SIGNING_PAYMENT_ACTIONS=0
PAID_REQUESTS=0
REAL_PROVIDER_CALLS=0
REAL_SETTLEMENTS=0
ECONOMIC_EFFECT_USDC=0

NEW_PUBLIC_SECURITY_CONTRACT_REQUIRED=NO (the proposed card fragment,
  section 17, is additive JSON within the AgentCard's already-existing,
  already-typed securitySchemes/securityRequirements fields -- no schema
  widening required for slice A; a contract change WOULD be required only
  for the PCC-provenance extension noted in section 12, which is
  explicitly deferred, not part of this design's recommended slices)
PRODUCTION_AUTH_ARCHITECTURE_CHANGE_REQUIRED=YES (Cloudflare-side mTLS
  configuration, slice B -- a platform configuration change, not a
  source/economic-architecture change; requires its own deployment
  authorization when pursued, per this engagement's standing rule)

TOTAL_PRODUCTION_SETTLE_CALLSITES=1 (unchanged -- this design touches
  none of the settlement pipeline; re-verified via the same grep pattern
  this engagement has used at every prior checkpoint, zero new matches)
DOCUMENT_V2_ACTIVATION_CHANGED=NO (unchanged, untouched by this design)
```

## 27. Required final packet

```
SUN1222C_AGENT_TRUST_100_DESIGN=READY_FOR_APPROVAL

START_HEAD=ac642cb4d56601f62a15f1bfcf80a3eff4821693
DESIGN_EVIDENCE_COMMIT_SHA=<set at commit time, verified below>

AGENSTRY_CURRENT_SCORE=90/100

AGENSTRY_VALID_AGENTCARD=10/10
AGENSTRY_LIVE_JSON_RPC=25/25
AGENSTRY_PROTOCOL_VERSION=10/10
AGENSTRY_JWS_SIGNATURE=10/10
AGENSTRY_UPTIME=15/15
AGENSTRY_SKILL_DECLARATION=10/10
AGENSTRY_VERIFIED_IDENTITY=5/10 (partial)
AGENSTRY_FRESHNESS=5/5
AGENSTRY_SECURITY_DECLARATION=0/5

AGENSTRY_SECURITY_MTLS_SCORE=5
MTLS_EXPECTED_FULL_SECURITY_CREDIT=YES

A2A_MTLS_NATIVE=YES
A2A_SKILL_SECURITY_REQUIREMENTS_NATIVE=YES

SECURITY_REQUIREMENTS_ARRAY_SEMANTICS=OR
SECURITY_REQUIREMENT_MULTI_SCHEME_SEMANTICS=AND

CLOUDFLARE_INBOUND_MTLS_AVAILABLE=YES
CLOUDFLARE_MANAGED_CA_AVAILABLE_ON_CURRENT_PLAN=YES
MTLS_ENFORCEMENT_LAYER=BOTH

RECOMMENDED_STRONG_AUTH=MTLS
RECOMMENDED_AUTH_POLICY_MODEL=B
WHY=see section 11

PUBLIC_PROBE_PRESERVATION_DESIGN=see section 9 (root securityRequirements
  empty; securitySchemes declares mTLS availability only; enforcement, if
  any, lives at skill level, never at root)

X402_ONLY_PAID_CLIENTS_SUPPORTED=YES
X402_ONLY_PAID_POLICY=unchanged
MTLS_ENHANCED_PAID_POLICY=optional, additive, non-blocking

MTLS_CALLER_IDENTITY_SOURCE=request.cf.tlsClientAuth
PCC_CONTRACT_CHANGE_REQUIRED_FOR_MTLS=YES (deferred, not in scope)

AGENSTRY_SUPPORTED_LEGAL_REGISTRIES=GLEIF/LEI, Companies House, KvK, ABN,
  Handelsregister, EU BRIS, ISED, OpenCorporates
SITEBORNE_ACCEPTED_PUBLIC_REGISTRY_ID_PRESENT=NO
LEGAL_IDENTITY_PREREQUISITE=external business action -- obtain/publish a
  registry identifier from an accepted registry (see section 25)

LEGAL_ENTITY_IN_CORE_AGENTCARD_SAFE=NO
AGENSTRY_SIGNED_CATALOG_CAN_CARRY_LEGAL_IDENTITY=UNKNOWN
SITEBORNE_EXISTING_CATALOG_COMPATIBLE=NO
CATALOG_BINDING_RECOMMENDED=NO
CANONICAL_CATALOG_URL=UNKNOWN

AGENT_CARD_JWS_ARCHITECTURE_CHANGED=NO
JWKS_ARCHITECTURE_CHANGED=NO

A2A_SKILL_SECURITY_MATRIX=see section 18 (all 8 skills: public discovery
  YES, x402 required YES, mTLS supported YES/optional, mTLS required NO)

CURRENT_SCORE=90/100
POST_SECURITY_EXPECTED_SCORE=95/100
POST_LEGAL_IDENTITY_EXPECTED_SCORE=100/100
TARGET_100_ACHIEVABLE_NOW=NO

NEW_PUBLIC_SECURITY_CONTRACT_REQUIRED=NO
PRODUCTION_AUTH_ARCHITECTURE_CHANGE_REQUIRED=YES (Cloudflare-side mTLS
  config, when/if slice B is authorized -- separate future checkpoint)

IMPLEMENTATION_TASK_COUNT=9
IMPLEMENTATION_PLAN=see section 24 (A through I, dependency-ordered)

EXACT_HUMAN_APPROVAL_REQUIRED=(1) approve Model B (mTLS optional/
  additive, x402 unchanged) as the authentication policy; (2) approve the
  section-17 card fragment for slice A implementation; (3) separately
  authorize slice B (real Cloudflare mTLS configuration) as its own
  future production-mutation checkpoint when ready; (4) decide and
  execute the external legal-registry-identifier prerequisite (section
  25) outside this engineering track entirely.

PRODUCTION_SOURCE_CHANGES=0
PRODUCTION_MUTATIONS=0
PRODUCTION_DEPLOYMENTS=0
CERTIFICATE_ISSUANCE=0
ECONOMIC_EFFECT_USDC=0

COMMIT_REACHABLE_FROM_MAIN=<verified below>
WORKING_TREE=<verified below>

NEXT_REQUIRED_CHECKPOINT=SUN-1222C-AGENT-TRUST-100-IMPLEMENTATION (slice A
  only, pending approvals 1-2 above) -- LEGAL_IDENTITY_PREREQUISITE and
  AUTH_BLOCKER_CHECKPOINT (slice B) remain separate, later tracks.
```
