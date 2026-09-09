# SUN-1222C-AGENT-TRUST-100-IMPLEMENTATION-A

Implements the security half of the design in
`SUN-1222C-agent-trust-100-design.md`. No production mutation: no Cloudflare
mTLS enablement, no certificate issuance, no DNS change, no deployment, no
payment, no Agenstry rescan.

## 0. Starting state

```
START_HEAD=c8518b81a5b47556ff1c84345267cc0cf929d779
BRANCH=main
WORKING_TREE=CLEAN (before this checkpoint's edits)
TRUST_DESIGN_EXISTS=0 (git cat-file exit code)
TRUST_DESIGN_REACHABLE=0 (git merge-base exit code)
```

## 1. What was built

### 1a. Native A2A `mutualTLS` security-scheme declaration
(`packages/protocol-a2a/src/card.ts`, `constants.ts`)

`buildUnsignedSiteborneAgentCard()` now declares one entry in
`securitySchemes` under the key `mtls`, using the exact discriminated-union
shape the pinned `@a2a-js/sdk@1.0.1` requires
(`{ scheme: { $case: 'mtlsSecurityScheme', value: { description } } }`).
Verified against the SDK's own compiled `SecurityScheme.toJSON()` (read
directly from `node_modules/.pnpm/@a2a-js+sdk@1.0.1_*/…/dist/index.js`) that
this produces the wire shape `{"mtls":{"mtlsSecurityScheme":{"description":
"..."}}}` -- the exact shape Agenstry's conformance scorer and any other
conformant A2A client read.

Root `securityRequirements` is unchanged at `[]`. Every skill's own
`securityRequirements` is unchanged at `[]`. Nothing is required to reach
the agent root or any of the 8 skills.

### 1b. Trusted mTLS caller-context module
(`apps/edge-api/src/control-plane/security/mtls-caller-context.ts`, new)

`deriveMtlsCallerContext(tlsClientAuth)` -- a pure function whose only
parameter is Cloudflare's own `request.cf.tlsClientAuth` (exact type read
from the pinned `@cloudflare/workers-types`). Produces one of five states:
`not_presented`, `valid`, `invalid`, `revoked`, `unknown`. Revocation
(`certRevoked`) is checked independently of, and takes priority over, chain
verification (`certVerified`) -- a chain-trusted-but-revoked certificate is
never `valid`. An unrecognized future `certVerified` value fails closed to
`unknown`, not `valid`.

`evaluateMtlsAuthorization(context, policy)` -- a reusable policy primitive
for a future route/skill that wants to *require* mTLS. Not wired into any
route in this checkpoint (`policy.required` is never set to `true` anywhere
in production source). Has no import of, or knowledge of, payment/x402/
settlement/PCC -- proven by both the module's own import list and a
dedicated test (`S11`) asserting its return shape carries nothing but
`{authorized, reason?}`.

Neither file imports or calls anything under `control-plane/evidence`,
`control-plane/workflows`, `control-plane/continuation`, or any settlement/
facilitator code. `grep -n ".settle(" apps/edge-api/src/control-plane/
security/mtls-caller-context.ts` returns zero matches.

## 2. Why root `securityRequirements` stays empty

Read from the pinned SDK's own `SecurityRequirement.toJSON()`: the field is
a map (`schemes: {name: scopes[]}`), and the parent `securityRequirements`
on `AgentCard`/`AgentSkill` is an array of those maps. Standard OpenAPI 3.x
Security Requirement Object semantics (which the A2A spec explicitly models
this on) make an empty array "no requirement" -- this is also exactly what
Agenstry's own methodology treats as the "explicit `securityRequirements:
[]` -- deliberately public" 2-point floor. Setting it to anything
non-empty at the root would gate Agenstry's own anonymous `SendMessage`
heartbeat probe, which is exactly the regression the design doc (§9) and
this checkpoint (§9/§15) forbid.

## 3. Genuine RED -> GREEN -> mutation-proof

**Agent Card** (`packages/protocol-a2a/src/card.test.ts`): the pre-existing
assertion `expect(card.securitySchemes).toEqual({})` was the RED baseline --
changing it to assert the `mtls` key, plus 4 new tests, produced 3 genuine
failures against the unmodified source (`Expected: "mtlsSecurityScheme",
Received: undefined`; `Expected: [], Received: ['mtls']`). Implementing the
scheme made all 7 tests in the file pass. Reverting the `securitySchemes`
literal to `{}` reproduced the identical 3 failures (mutation-proof),
restoring it returned to 7/7 green.

**mTLS caller context** (`apps/edge-api/tests/mtls-caller-context.test.ts`,
new, 17 tests): mutation-proofed the two safety-critical guards directly.
(1) Removing the `certRevoked` check and short-circuiting straight to
`valid` broke 7 tests (the revoked/invalid/unknown cases all wrongly
resolved to `valid`); restoring fixed them. (2) Collapsing
`evaluateMtlsAuthorization` to unconditionally `return {authorized: true}`
broke the 3 `policy.required=true` denial tests; restoring fixed them.

## 4. Full verification

```
TARGETED_FILES=6
TARGETED_TESTS=73/73 pass
  (mtls-caller-context.test.ts 17, card.test.ts 7, fixtures.test.ts 1,
   signing.test.ts 20, transport.test.ts 22, protocol.property.test.ts 6)
A2A_ROUTE_REGRESSION=2/2 pass (apps/edge-api/tests/a2a-route.test.ts)

TYPECHECK=PASS (23/23 turbo tasks)
BUILD=PASS (12/12 turbo tasks)
LINT=PASS (16/16 turbo tasks)

PROTOCOL_A2A_CHECK=PASS (pnpm a2a:check: format, lint, typecheck, unit 50,
  property 6, fixtures 1, spec:verify "A2A spec baseline OK: @a2a-js/
  sdk@1.0.1, spec 1.0, JSONRPC", edge route 2 -- all pass)
PROTOCOL_MCP_CHECK=PASS (pnpm mcp:check -- untouched by this checkpoint)
PROTOCOL_X402_CHECK=PASS (pnpm x402:check -- all bazaar/spec-baseline
  consistency checks pass; economics untouched)
PRODUCTION_PREFLIGHT=PASS (zero mutating Cloudflare API calls; all
  required bindings/vars/secrets present; economic/cutover vars fail-closed
  in the pre-upload candidate; 12/12 paid routes structurally unavailable
  before economics)

PUBLIC_API_WRANGLER_DRY_RUN=PASS
PAID_RUNTIME_WRANGLER_DRY_RUN=PASS
ALERT_WORKER_WRANGLER_DRY_RUN=PASS
```

### Full-suite finding: 10 pre-existing failures, unrelated to this checkpoint

`vitest run` across the whole repository reported 10 failures across 4
files: `x402-service-route.test.ts` (7), `nevermined-service-route.test.ts`
(1), `production-cdp-full-stack-mock.test.ts` (1),
`production-cdp-provider-wiring.test.ts` (1). Per SUN-1222C-R4-D7/D8/D9
convention, each failing file was re-run independently to classify
deterministic vs. environmental -- **all 10 reproduced identically in
isolation**, so unlike the resource-contention flakes found at those
earlier checkpoints, these are deterministic.

To rule out a regression from this checkpoint's own diff, the same 4 files
were re-run against a clean stash of the *pre-checkpoint* tree (`git
stash`, confirmed working tree clean and `securitySchemes: {}` restored).
**The identical 10 failures reproduced on the unmodified baseline.** None
of the 4 failing files import `packages/protocol-a2a` or
`control-plane/security`; they exercise CDP/Nevermined paid-execution
mocks unrelated to A2A or mTLS. This is a genuine pre-existing defect in
the repository's current `main`, not introduced by this checkpoint, and is
explicitly out of this checkpoint's authorized scope (§0: "native A2A
mutualTLS security-scheme support... trusted Cloudflare tlsClientAuth
parsing... optional/path-scoped authenticated execution policy" -- not
x402/CDP paid-execution repair).

```
DETERMINISTIC_FAILURES=10
DETERMINISTIC_FAILURES_INTRODUCED_BY_THIS_CHECKPOINT=0
DETERMINISTIC_FAILURES_PRE_EXISTING_ON_CLEAN_BASELINE=10
DETERMINISTIC_FAILURES_IN_FILES_TOUCHED_BY_THIS_CHECKPOINT=0
```

Recommended follow-up: a dedicated, separately authorized diagnosis
checkpoint for the 4 affected files (out of scope here).

## 5. Settlement ownership / economics (unchanged)

```
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

Re-confirmed by direct grep across `apps/edge-api/src` and `packages/*/src`
(excluding tests): the sole real call expression is
`paid-continuation-workflow.ts:682`
(`deps.settlement.evidenceProvider.settle(...)`), backed by the underlying
facilitator implementation at `cdp-provider.ts:161`. Every other match is a
comment/doc reference. Neither count changed from before this checkpoint.

```
X402_PAYMENT_REQUIREMENTS_UNCHANGED=YES
PAYMENT_IDENTIFIER_UNCHANGED=YES
DURABLE_HANDOFF_UNCHANGED=YES
STATE_MACHINE_UNCHANGED=YES
ECONOMICS_UNCHANGED=YES (31200 / 8000 / 9800 / 17000 atomic, untouched)
```

## 6. Recommended production mTLS surface

```
RECOMMENDED_PRODUCTION_MTLS_SURFACE=PATH_SCOPED
```

Cloudflare's own mTLS setup associates client-certificate validation with a
*hostname* (all Cloudflare plans support this with a Cloudflare-managed
CA -- verified live from developers.cloudflare.com/api-shield/security/mtls/,
no BYOCA required), but enforcement of *which requests must present one* is
independently configurable per WAF/path rule on that same hostname --
Cloudflare does not require splitting traffic onto a second hostname simply
to make mTLS optional-by-default. Since this design's Option B keeps mTLS
**optional everywhere today** (root `securityRequirements: []`, `policy.
required` never `true` in production), a dedicated hostname
(`mtls.utility.siteborne.net`) would add DNS/cert/routing complexity this
checkpoint's design does not yet need. A future checkpoint that wants to
*require* mTLS on a specific high-trust skill can do so with a path-scoped
WAF rule on the existing `utility.siteborne.net`, gated by a Worker-side
check using `evaluateMtlsAuthorization({required: true})` -- already built
here, unused. If a later product decision instead wants a fully separate,
always-mTLS surface (e.g. for a distinct high-trust client population), the
dedicated-hostname path remains open; nothing in this implementation
forecloses it.

## 7. Legal identity (unchanged, explicitly not implemented)

```
LEGAL_IDENTITY_IMPLEMENTED=NO
```

No `provider.legalEntity` field or equivalent was added. Confirmed unsafe
to add to the core `AgentCard.provider` object: the pinned SDK's
`AgentProvider` interface has exactly two fields (`url`, `organization`),
and its `toJSON()` constructs a new object containing only those two --
any third field would be silently dropped before the card is ever signed
or served. `SITEBORNE_ACCEPTED_PUBLIC_REGISTRY_ID_PRESENT=NO` (repo search
confirmed no existing GLEIF/Companies House/KvK/ABN/etc. identifier
anywhere). This remains an external business action, not engineering.

## 8. Zero-effect accounting

```
CLOUDFLARE_MTLS_HOSTNAME_MUTATIONS=0
WAF_MUTATIONS=0
DNS_MUTATIONS=0
CERTIFICATES_ISSUED=0
CLIENT_PRIVATE_KEYS_CREATED_FOR_PRODUCTION=0
SECRET_MUTATIONS=0
PRODUCTION_DEPLOYMENTS=0
TRAFFIC_MUTATIONS=0
PRODUCTION_D1_WRITES=0
LIVE_QUOTES_OR_INTENTIONAL_402_REQUESTS=0
REAL_SIGNING_PAYMENT_ACTIONS=0
PAID_REQUESTS=0
REAL_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENTS=0
ECONOMIC_EFFECT_USDC=0
```

## 9. Source boundary

```
packages/protocol-a2a/src/constants.ts        -- A2A security declaration (constants)
packages/protocol-a2a/src/card.ts              -- A2A security declaration (wiring)
packages/protocol-a2a/src/card.test.ts         -- tests
apps/edge-api/src/control-plane/security/
  mtls-caller-context.ts                       -- trusted client-cert context + policy (new)
apps/edge-api/tests/mtls-caller-context.test.ts -- tests (new)

UNEXPECTED_FUNCTIONAL_SOURCE_FILES=0
```

No payment, settlement, x402, MCP, route, D1, or deployment-config file was
touched.

## 10. Result

```
SUN1222C_AGENT_TRUST_100_IMPLEMENTATION_A=PASS
STRONG_AUTH_SOURCE_STATUS=LOCALLY_QUALIFIED
A2A_MUTUAL_TLS_SCHEME_IMPLEMENTED=YES
MTLS_CALLER_CONTEXT_IMPLEMENTED=YES
MTLS_CALLER_IDENTITY_SOURCE=request.cf.tlsClientAuth (Cloudflare edge-verified only)
MTLS_CALLER_IDENTITY_FORMAT=SHA-256 certificate fingerprint + issuer DN
ROOT_SECURITY_REQUIREMENTS=[]
PUBLIC_A2A_PROBE_AUTH_REQUIRED=NO
MTLS_REQUIRED_SKILLS=NONE
MTLS_SUPPORTED_SKILLS=NONE (capability declared at agent root only, per design §9/§10)
X402_ONLY_PAID_CLIENTS_SUPPORTED=YES
MTLS_WITHOUT_X402_PAID_EXECUTION=DENIED (proven: evaluateMtlsAuthorization has zero
  payment awareness; no route consumes it for execution authorization)
PUBLIC_PROBE_REGRESSION=NO
X402_ONLY_REGRESSION=NO
MTLS_REQUIRED_POLICY=PASS
SPOOFED_CERT_HEADER_REJECTION=PASS (S7, structural: no Request/Headers param exists)
REVOKED_CERT_REJECTION=PASS (S4)
INVALID_CERT_REJECTION=PASS (S5)
MTLS_SECURITY_MUTATION_PROOF=PASS
A2A_AGENT_CARD_SCHEMA_VALID=YES (a2a:check spec:verify PASS)
AGENT_CARD_JWS_VALID=YES (signing.test.ts 20/20, transport.test.ts 22/22)
JWKS_REGRESSION=NO
PCC_CONTRACT_CHANGE_REQUIRED_FOR_MTLS=NO

EXPECTED_AGENSTRY_SECURITY_SCORE_AFTER_DEPLOYMENT=5/5
EXPECTED_TOTAL_AFTER_SECURITY_DEPLOYMENT=95/100
ACTUAL_AGENSTRY_SCORE=NOT_RESCANNED
TARGET_100_ACHIEVABLE_NOW=NO

NEXT_REQUIRED_CHECKPOINT=SUN-1222C-MTLS-PRODUCTION-PROVISIONING-PLAN
```

Do not enable mTLS in Cloudflare. Do not issue production certificates. Do
not modify DNS. Do not deploy. Do not rescan Agenstry. Do not pay.
