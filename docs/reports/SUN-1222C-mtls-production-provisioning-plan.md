# SUN-1222C-MTLS-PRODUCTION-PROVISIONING-PLAN

Design-only checkpoint. Zero production mutation: no Cloudflare CA/mTLS/WAF/DNS/route mutation, no certificate issuance, no deployment, no secret mutation, no live mTLS test requests, no economic action.

## 0. Carried release finding (not fixed here)

```
CARRIED_PAYMENT_TEST_FAILURES=10
UNIQUE_FAILING_FILES=4
MTLS_IMPLEMENTATION_REGRESSION=NO
FULL_RELEASE_GATE_CLEAN=NO
CARRIED_PAYMENT_TEST_FAILURES_DISPOSITION=PENDING_SEPARATE_CHECKPOINT
```

Diagnosis performed this checkpoint (inspection only, no fix): all four failing files (`x402-service-route.test.ts`, `nevermined-service-route.test.ts`, `production-cdp-full-stack-mock.test.ts`, `production-cdp-provider-wiring.test.ts`) run real Miniflare D1 and real production composition builders with only external network-facing dependencies (facilitator, CDP client, chain RPC) stubbed — none use the in-memory repository, none touch a real network call.

Root cause is now evidenced, not guessed: `SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION` (commit `ac642cb`) changed `DurableCachedResult.body` from a flat envelope (`{service_id, result_class, output, receipt_id, link_id, link_hash}`) to the full governed PCC document, and correctly updated the REST/A2A/MCP paths and their own targeted tests — but `git show --stat ac642cb` confirms it did **not** touch any of these four files. They still assert the pre-PCC-wire-result flat shape directly (`x402-service-route.test.ts:287-1087` asserts `body.result_class` / `body.receipt_id` at the top level six times). This is the same failure signature observed live: `expected undefined to be 'success'`, `expected undefined to be truthy`.

```
CARRIED_PAYMENT_TEST_FAILURE_FILES=
  apps/edge-api/tests/x402-service-route.test.ts
  apps/edge-api/tests/nevermined-service-route.test.ts
  apps/edge-api/tests/production-cdp-full-stack-mock.test.ts
  apps/edge-api/tests/production-cdp-provider-wiring.test.ts
CARRIED_PAYMENT_TEST_FAILURE_CLASS=TEST_INFRASTRUCTURE (stale assertions against a governed, intentional wire-contract change; not a production defect and not a mock/real-interface drift)
CARRIED_PAYMENT_FAILURE_DIAGNOSIS_REQUIRED=NO (root cause is proven above) -- but DISPOSITION (update the four files' assertions to read the governed PCC shape) is unimplemented and requires its own dedicated checkpoint, since fixing production-payment-path tests is out of scope for an mTLS/trust checkpoint's authorization.
```

## 1. Integrity gate

```
pwd            = /Users/meta4ickal/SITEBORNE Utility Network
toplevel       = /Users/meta4ickal/SITEBORNE Utility Network
branch         = main
HEAD           = 106b8285d8d6432a296a11f1cf9788b4b4a91ba0
status --short = (empty -- clean)
MTLS_IMPLEMENTATION_EXISTS=0
MTLS_IMPLEMENTATION_REACHABLE=0
```

## 2. Purpose

Freeze the exact production provisioning procedure for SITEBORNE's already-implemented (not yet live) mTLS support. Design only -- no Cloudflare mutation of any kind in this checkpoint.

## 3. Live Cloudflare baseline -- honest access-limitation disclosure

```
LIVE_ZONE_API_READ_ACCESS=UNAVAILABLE_IN_THIS_SESSION
```

The stored Wrangler OAuth token (`cfoat_...`) grants `zone (read)` per `wrangler whoami`'s own printed scope list, but a direct `Authorization: Bearer <token>` call to `GET /zones?name=siteborne.net` on `api.cloudflare.com/client/v4` returned `403` / error code 9109 "Invalid access token". This is a real, reproduced tooling limitation (the token is not expired -- `expiration_time` is later than the call time), not a guess: Cloudflare's dashboard-OAuth tokens used by Wrangler are not directly bearer-usable against the general Zones API from an external script the way a classic API Token is. Wrangler's own CLI has **no zone-settings, WAF, or API Shield read subcommand at all** (`wrangler cert` / `wrangler mtls-certificate` are for *outbound* Worker-to-origin mTLS, a different Cloudflare product from the *inbound* client-certificate-authentication product this checkpoint is about) -- confirmed by reading Wrangler's full top-level `--help` command inventory.

What I could and did verify live:
```
wrangler cert list  -> empty (0 outbound Worker mTLS certs configured; a different product, but proves that surface is untouched too)
wrangler secret list -> 13 secret names on siteborne-utility-edge (names only; none mTLS-related)
```

What I could not verify live and am not fabricating: the actual current state of `utility.siteborne.net`'s zone-level Client Certificate Authentication / API Shield configuration, existing CAs, or existing WAF rules.

Indirect evidence (repository-based, not live-API-based) that inbound mTLS is almost certainly not yet configured: zero mTLS-related bindings, vars, or secret names exist in any of the three tracked `wrangler*.toml` files or in the 13 live secret names read above; this entire capability is being designed from a blank slate across the D-series/AGENT-TRUST-100 checkpoints in this engagement. This is inference from absence, not a direct observation, and is reported as such.

```
LIVE_MTLS_ALREADY_CONFIGURED=NOT_DIRECTLY_VERIFIABLE_IN_THIS_SESSION (indirect evidence: NO)
LIVE_CLIENT_CA_COUNT=NOT_DIRECTLY_VERIFIABLE_IN_THIS_SESSION
LIVE_CLIENT_CERT_COUNT=NOT_DIRECTLY_VERIFIABLE_IN_THIS_SESSION (outbound-product count verified: 0)
LIVE_MTLS_WAF_RULE_COUNT=NOT_DIRECTLY_VERIFIABLE_IN_THIS_SESSION
LIVE_MTLS_ROUTE_POLICY=NOT_DIRECTLY_VERIFIABLE_IN_THIS_SESSION
```

**Required before any actual provisioning checkpoint**: obtain either a classic Cloudflare API Token (Zone:Read + SSL and Certificates:Edit scopes on the specific zone) supplied out-of-band the same way the settlement-alert webhook secret was (local file, never pasted in chat), or perform the live zone/WAF/CA read directly from the Cloudflare dashboard yourself and paste back the *structural* facts (rule count, CA count) -- never any certificate private key material.

## 4. Cloudflare plan capabilities -- verified live from current first-party documentation

Fetched directly from `developers.cloudflare.com` in this session (not from training-data recall):

- **"Mutual TLS (mTLS)" (API Shield / Security) overview page**: *"All Cloudflare plans can set up mTLS with a Cloudflare-managed certificate authority (CA). Enterprise customers can upload up to five non-Cloudflare CAs."* -- managed-CA mTLS is **not** Enterprise-gated; only BYO-CA is.
- **"Configure mTLS" page**: the enforcement mechanism is a WAF custom rule combining `cf.tls_client_auth.cert_verified` (and optionally `cf.tls_client_auth.cert_issuer_ski` for CA-pinning, and `cf.tls_client_auth.cert_revoked` for revocation) with **`http.request.uri.path in {...}`** -- i.e. path-scoped enforcement is an explicitly documented, first-class capability, not an inference. Revocation checking ("Check for revoked certificates") is explicitly stated to work **only** for Cloudflare-managed-CA certificates, not uploaded/BYO CAs.
- Worker-side `request.cf.tlsClientAuth` availability was already proven directly from source in the prior implementation checkpoint (`@cloudflare/workers-types`'s `IncomingRequestCfPropertiesTLSClientAuth` / `...Placeholder` interfaces, both fully read field-by-field) -- stronger evidence than documentation, not re-fetched here.

```
CLOUDFLARE_MANAGED_CA_AVAILABLE=YES (verified live, all plans)
CLOUDFLARE_CLIENT_CERT_ISSUANCE_AVAILABLE=YES (via managed CA, all plans)
CLOUDFLARE_WAF_PATH_ENFORCEMENT_AVAILABLE=YES (verified live: documented `http.request.uri.path in {...}` expression pattern)
WORKER_TLS_CLIENT_AUTH_CONTEXT_AVAILABLE=YES (proven from pinned @cloudflare/workers-types source, prior checkpoint)
ACCOUNT_PLAN_BLOCKER=NONE (managed-CA mTLS + path-scoped WAF rules are both available on SITEBORNE's current plan tier per the documentation above; BYO-CA would be Enterprise-gated but is not the recommended model -- see §12)
```

One open item the documentation does not fully resolve and that a live provisioning checkpoint must verify directly in the dashboard before acting: whether "enabling mTLS for a host" is a zone/hostname-level TLS-handshake toggle (Cloudflare *requests* -- not requires -- a client cert during the handshake for that hostname) that is separate from, and a prerequisite to, the WAF rule that actually *enforces* presentation on specific paths. If so, the toggle itself is hostname-scoped even though enforcement is path-scoped -- this does not create a blast-radius risk (unprotected paths still work with zero client cert, per the "Block" action being scoped by the WAF rule's own path condition), but it means "enable mTLS" is likely one hostname-level action plus one WAF-rule action, not a single step. Recorded as `RESIDUAL_LIVE_VERIFICATION_ITEM` in §22, not assumed away.

## 5. Path-scoped vs. dedicated hostname -- final decision

```
PRODUCTION_MTLS_SURFACE=PATH_SCOPED
```

Evaluated against the real documented mechanism (§4), not just the prior implementation checkpoint's recommendation:

- **Agenstry anonymous probe / Agent Card / JWKS accessibility**: preserved. A WAF custom rule's `Block` action only fires when its full expression matches, and the documented expression pattern is `not cf.tls_client_auth.cert_verified AND http.request.uri.path in {<protected paths>}`. Any request to a path *not* in that set never matches the rule regardless of certificate presence.
- **TLS handshake rejection risk**: none for path-scoped. Cloudflare's mTLS "enable for host" step makes certificate presentation *optional* at the TLS layer (a client without a cert still completes the handshake); only the WAF rule *enforces* presentation, and only for matched paths.
- **Origin certificate prerequisite**: the docs state "the certificate installed on your origin server must match the hostname of the client certificate... wildcard certificates are not supported." A **dedicated** hostname (e.g. `mtls.utility.siteborne.net`) would require provisioning and validating a *new* origin/edge certificate for that hostname before mTLS could even be tested -- an extra irreversible-feeling DNS + certificate step with its own failure surface. Path-scoped reuses `utility.siteborne.net`'s existing, already-working certificate, eliminating that entire class of provisioning risk.
- **Rollback complexity**: path-scoped rollback is "delete/disable one WAF rule" -- no DNS change to revert, no second hostname to decommission.
- **Blast radius**: path-scoped confines any misconfiguration to the new namespace; a dedicated hostname's TLS/cert misconfiguration risk is isolated to that hostname already, but at the cost of the extra provisioning surface above with no offsetting safety benefit for SITEBORNE's actual threat model (there is no requirement here to physically separate the strongly-authenticated traffic at the network/hostname level -- only at the authorization-decision level, which the application layer already provides).
- **Future enterprise/agent-identity usage**: a path-scoped namespary namespace (`/authenticated/*`) can be extended to arbitrary future skills/routes without any further Cloudflare-side hostname/DNS work -- pure application-layer routing.

Path-scoped satisfies the critical requirement (no client without a certificate may lose access to the existing public agent interface) with high, documentation-backed confidence.

## 6. Exact strong-auth surface

```
MTLS_AUTHENTICATED_SURFACE=/authenticated/*  (new, currently-unrouted namespace on utility.siteborne.net; not layered onto any existing x402 paid-service path, REST catalog path, /a2a, /mcp, /.well-known/*, /health, or /ready)
MTLS_PUBLIC_SURFACE_OVERLAP=NONE
```

No existing route under `apps/edge-api/src/routes/` currently begins with `/authenticated`; the namespace is genuinely new (verified: `grep -rn "'/authenticated" apps/edge-api/src/routes/` -> no matches), so choosing it cannot silently reclassify any existing public path as private.

## 7. Public endpoint preservation matrix

| Endpoint | Current auth | Post-mTLS auth | Expected behavior |
|---|---|---|---|
| Agent Card (`/.well-known/agent-card.json`) | none | none | unchanged, publicly readable, JWS-signed |
| JWKS (`/.well-known/jwks.json`) | none | none | unchanged, publicly readable |
| `/health` | none | none | unchanged |
| `/ready` | none | none | unchanged |
| A2A JSON-RPC probe/no-op (`/a2a`) | none (root `securityRequirements: []`) | none | unchanged -- Agenstry's anonymous live probe unaffected |
| A2A discovery | none | none | unchanged |
| MCP `initialize` | none | none | unchanged |
| MCP `tools/list` | none | none | unchanged |
| MCP PaymentRequired discovery | none (x402, not mTLS) | none | unchanged |
| REST service catalog | none | none | unchanged |
| Schemas | none | none | unchanged |
| Service catalog | none | none | unchanged |

```
AGENT_CARD_PUBLIC=YES
JWKS_PUBLIC=YES
AGENSTRY_LIVE_PROBE_PUBLIC=YES
```

## 8. x402 commerce preservation

```
X402_ONLY_PAID_CLIENTS_SUPPORTED=YES
MTLS_IS_PAYMENT_AUTHORIZATION=NO
MTLS_IS_SETTLEMENT_AUTHORIZATION=NO
```

No existing x402 paid-service path (`/v1/*`, `/v2/*`) is proposed to move under `/authenticated/*`. The unpaid -> `PaymentRequired` -> buyer signs -> retry -> paid execution flow proceeds exactly as today, with zero mTLS provisioning required from an ordinary x402 buyer. `evaluateMtlsAuthorization`'s only production usage remains `{ required: false }` (§9 of the prior implementation checkpoint) unless and until a future, separately authorized checkpoint deliberately opts a specific new skill into `{ required: true }`.

## 9. Authenticated mTLS flow (future, once provisioned)

```
verified client certificate
  -> Cloudflare WAF rule (blocks unverified/absent cert on /authenticated/* only)
  -> request.cf.tlsClientAuth (trusted, edge-populated)
  -> deriveMtlsCallerContext() (already implemented, mtls-caller-context.ts)
  -> evaluateMtlsAuthorization({ required: true }) for the specific new route
  -> existing shared service boundary (x402-mcp-adapter.ts / x402-service.ts -- unchanged)
  -> x402 authorization where the service is paid (unchanged: mTLS never substitutes for it)
  -> existing durable handoff (paid-continuation-workflow.ts -- unchanged)
  -> existing useful execution (unchanged)
  -> existing PCC result (unchanged, ac642cb)
```

```
SECOND_SERVICE_HANDLER=NO
SECOND_PAYMENT_PATH=NO
SECOND_SETTLEMENT_PATH=NO
```

No new handler, payment path, or settlement path is introduced by mTLS. `evaluateMtlsAuthorization` (already implemented, mutation-proven) is a pure identity/policy gate with zero payment awareness by construction -- confirmed in the prior checkpoint by static absence of any settlement/payment import in `mtls-caller-context.ts`.

## 10. Cloudflare enforcement layer

```
MTLS_WAF_ROLE=reject requests to /authenticated/* that lack a valid, non-revoked client certificate (cf.tls_client_auth.cert_verified / cert_revoked, per §4's documented expression pattern) -- this happens before the Worker runs at all for rejected requests
MTLS_WORKER_ROLE=for requests the WAF let through, translate the now-guaranteed-valid request.cf.tlsClientAuth into SITEBORNE's canonical MtlsCallerContext (deriveMtlsCallerContext, already implemented) and enforce any additional application-level policy (evaluateMtlsAuthorization)
```

This two-layer design means the Worker's trust boundary is not "the only thing standing between an attacker and the route" -- the WAF is the primary reject-on-missing/invalid-cert control, and the Worker enforces canonical-identity translation and any finer-grained application policy on top of an already-verified certificate. Neither layer trusts anything caller-supplied outside the TLS handshake itself (§11).

## 11. Header spoofing / trust boundary

```
CALLER_CONTROLLED_CERT_IDENTITY_TRUSTED=NO
```

`deriveMtlsCallerContext` (already implemented, already mutation-proven) accepts exactly one parameter -- the `tlsClientAuth` value -- and has no `Request`/`Headers` parameter on any exported function, so there is no code path through which `X-Client-Cert`, `Client-Cert`, `Cf-Client-Cert-*`, `X-CERT-VERIFY`, or any other caller-supplied header could reach it, proven structurally (function arity) and by a live test in `mtls-caller-context.test.ts` ("S7 -- spoofed-header immunity") that constructs a `Request` with exactly those spoofed headers and confirms only `cf.tlsClientAuth` is ever read. Cloudflare's own `request.cf` object is edge-populated from the actual TLS handshake before the Worker executes and is not influenceable by request headers/body by construction of the platform itself (this half of the trust chain is a platform guarantee, not something SITEBORNE code can or needs to re-verify at runtime).

## 12. CA model

```
RECOMMENDED_CLIENT_CA_MODEL=CLOUDFLARE_MANAGED_CA
WHY=
  1. Available on SITEBORNE's current plan tier (§4, verified live) -- BYO/external CA is Enterprise-gated.
  2. Zero private-key custody burden on SITEBORNE: Cloudflare's managed CA issues and signs client certificates; SITEBORNE never holds or generates a CA private key.
  3. Automatic revocation checking is documented (§4) to work ONLY for Cloudflare-managed-CA certificates, not uploaded CAs -- choosing BYO CA would silently forfeit the cert_revoked WAF signal entirely.
  4. Matches the "smallest truthful capability" design principle already established in the design checkpoint -- an initial qualification identity does not need enterprise-grade external PKI.
```

## 13. Client certificate lifecycle

```
CLIENT_PRIVATE_KEY_CREATION_MODEL=client-generated where Cloudflare's managed-CA issuance flow supports a CSR-based (client keeps its own private key, submits only a Certificate Signing Request); if the dashboard flow only offers server-side key generation for the managed CA, the resulting private key must be transferred to the qualification-client operator over an out-of-band, single-use secure channel and never committed to Git, never pasted into chat, and deleted from any Cloudflare-side transient storage once retrieved -- this exact mechanism must be confirmed live in the dashboard during the actual provisioning checkpoint, not assumed.
CLIENT_CERTIFICATE_ROTATION_PERIOD=90 days for the initial qualification certificate (short enough to bound blast radius from a mishandled key during the experimental phase; may be lengthened for a real onboarded caller once the model is proven)
CLIENT_CERTIFICATE_REVOCATION_PROCESS=revoke via the Cloudflare dashboard's Client Certificates page (managed-CA certs support this per §4); confirm revocation takes effect by re-running the "mTLS route + revoked cert" case in the authorization test matrix (§26) before considering any revocation event closed
```

## 14. Initial qualification certificate

```
INITIAL_MTLS_TEST_IDENTITY=SITEBORNE qualification client (non-human, bounded test identity; does not imply any real customer or business relationship)
INITIAL_CERT_COUNT=1
```

Not issued in this checkpoint.

## 15. Certificate identity canonicalization

```
CANONICAL_MTLS_CALLER_IDENTITY={ fingerprintSha256: <cert's own SHA-256 digest>, issuerDN: <issuing CA's distinguished name> }  (already implemented: MtlsCallerIdentity in mtls-caller-context.ts)
PCC_SCHEMA_CHANGE_REQUIRED=NO
```

This is unchanged from the already-implemented, already-mutation-proven `MtlsCallerIdentity` shape -- the fingerprint is the certificate's own cryptographic digest (collision-resistant, safe as an authorization/audit key, not secret), paired with the issuer DN so a future policy could additionally scope trust to a specific issuing CA. It is not added to the PCC document; doing so would require a new governed schema field, which is explicitly out of scope here and not requested by any current design decision.

## 16. Agent Card live representation

```
LIVE_AGENT_CARD_SECURITY_SCHEME=securitySchemes.mtls = { scheme: { $case: 'mtlsSecurityScheme', value: { description: <already-authored truthful description, constants.ts> } } }  (already implemented, already committed, already tested -- proven to survive AgentCard.toJSON() and JWS signing unmodified via the SDK's own `{ ...agentCard, signatures: [...] }` spread, verified by direct source read of generateAgentCardSignature in the prior checkpoint)
LIVE_AGENT_CARD_ROOT_SECURITY_REQUIREMENTS=[]
```

Strict A2A v1.0 conformance, JWS signing, and JWKS all re-validated as unaffected in the prior implementation checkpoint's full 73/73 targeted-test run (`signing.test.ts` 20/20, `transport.test.ts` 22/22, `protocol.property.test.ts` 6/6, `spec:verify` against the pinned `@a2a-js/sdk@1.0.1` spec baseline) -- not re-run in this design-only checkpoint since no source changed since then.

## 17. Agenstry score expectation

```
PREDEPLOY_AGENSTRY_SCORE=90/100
POSTDEPLOY_EXPECTED_AGENSTRY_SCORE=95/100
POSTDEPLOY_ACTUAL_AGENSTRY_SCORE=NOT_TESTED
```

This is an expectation carried from the design checkpoint, not a new observation made here -- no live Agenstry rescan was performed in this checkpoint (none authorized).

## 18. Legal identity parallel track

```
SITEBORNE_ACCEPTED_PUBLIC_REGISTRY_ID_PRESENT=NO
LEGAL_IDENTITY_RECOMMENDED_PATH=GLEIF_LEI
LEGAL_IDENTITY_ENGINEERING_BLOCKER=NO
LEGAL_IDENTITY_100_SCORE_BLOCKER=YES
```

No identifier fabricated, registered, or published. This may proceed in parallel as an external, non-engineering action; it does not block the mTLS provisioning track.

## 19. JWS / JWKS

```
JWS_KEY_ROTATION_REQUIRED=NO
```

No signing-key change is required by mTLS provisioning -- the Agent Card's `securitySchemes` addition is signed by the existing signing identity exactly as every other field already is (§16); nothing about adding a security-scheme declaration touches key material.

## 20. Card drift

Agenstry's drift-detection warning on the next crawl after mTLS deployment is expected and correct -- the card *will* legitimately change (new `securitySchemes.mtls` entry). This is not suppressed or delayed; a truthful capability declaration is not deferred merely to avoid a drift notification.

## 21. Exact production mutations -- plan only (none executed)

```
PLANNED_PRODUCTION_MUTATIONS=5

1. Cloudflare: select/confirm the Cloudflare-managed CA for the zone (§12) -- no CA creation needed if Cloudflare already provisions one by default per zone; confirm live during provisioning.
2. Cloudflare: issue exactly one client certificate for "SITEBORNE qualification client" (§14) via the managed CA.
3. Cloudflare: create one WAF custom rule scoped to `http.request.uri.path in {"/authenticated/*"}` blocking on `not cf.tls_client_auth.cert_verified OR cf.tls_client_auth.cert_revoked` (§4, §10), and confirm/enable the hostname-level "mTLS for this host" toggle utility.siteborne.net requires as a prerequisite (§4's residual verification item).
4. Repository + deploy: add the (already-designed, not-yet-written) `/authenticated/*` route registration to apps/edge-api's public Worker source, wiring `deriveMtlsCallerContext` + `evaluateMtlsAuthorization({ required: true })` at that route only; deploy `siteborne-utility-edge` (public API) -- the only component whose bindings/routes actually change (§30).
5. Deploy the Agent Card change (already committed, commit 106b8285) by including it in the same public API deployment as step 4 -- these were designed to ship together since the card's mtls securityScheme declaration and the route's actual enforcement should become truthful in the same release, not truthful-then-enforced in two separate windows.
```

## 22. Mutation dependency order

```
MUTATION_DEPENDENCY_ORDER=
  1. Confirm managed CA (step 1 above) -- prerequisite for step 2.
  2. Issue one qualification client certificate (step 2) -- needed before step 6/7 testing, independent of steps 3-5.
  3. Confirm the hostname-level mTLS toggle + create the WAF rule (step 3) -- RESIDUAL_LIVE_VERIFICATION_ITEM from §4 must be resolved here, live, before deploying application code that depends on it.
  4. Deploy the public API with the new /authenticated/* route + card change (steps 4-5 together) -- only after step 3, so the route exists behind working enforcement from the moment it becomes reachable, never a window where it's reachable without the WAF rule active.
  5. Verify public endpoints unchanged (§7 matrix, live).
  6. Test invalid/absent certificate rejection on /authenticated/*.
  7. Test valid qualification certificate authenticated access.
  8. Test x402-only flow on existing paid routes remains unchanged.
  9. External Agenstry rescan (separately authorized, not part of provisioning itself).
  10. Retain or roll back (§24) based on steps 5-9's outcome.
```

## 23. Zero-downtime / zero-blast-radius plan

```
CAN_PROVISION_WITHOUT_PUBLIC_DOWNTIME=YES
```

Basis: §5's path-scoped analysis (WAF rule only matches `/authenticated/*`; the hostname-level "request a cert" toggle does not itself reject unauthenticated connections per the documented mechanism) plus §21's ordering (WAF rule active *before* the new route is deployed, so there is never a window where `/authenticated/*` is reachable without enforcement) together mean no existing public surface (Agent Card, JWKS, health, A2A, MCP, REST catalog, all x402 paid routes) is touched by any of the 5 planned mutations. The one residual uncertainty (§4's hostname-level-toggle question) is a "does step 3 need to happen once at zone level" question, not a "could this break existing traffic" question -- Cloudflare's own documentation is explicit that mTLS enablement is opt-in-to-request, not opt-in-to-require, at the connection level; only the WAF rule enforces rejection, and only for matched paths.

## 24. Rollback plan

```
ROLLBACK_STEPS=
  1. Disable/delete the WAF custom rule from step 3 (immediate, reversible, restores /authenticated/* to unreachable-but-unenforced or fully removes the rule).
  2. Revoke the qualification client certificate from step 2 (§13's revocation process).
  3. Detach/disable the hostname-level mTLS association if it was a separate toggle from the WAF rule (§4 residual item) and no other consumer needs it.
  4. Roll back the public API Worker to the previous version (steps 4-5) via `wrangler versions` / Cloudflare's standard version rollback -- restores the pre-mTLS Agent Card and removes the /authenticated/* route entirely.
  5. No DNS record was created (path-scoped, §5) -- nothing to remove there.
  6. Preserve the paid-continuation-runtime and settlement-alert Workers untouched throughout -- neither is part of any planned mutation (§30).

ROLLBACK_REQUIRES_PAYMENT_MUTATION=NO
```

Every step above is a Cloudflare-dashboard/Wrangler-version-control action; none touches D1, a secret, or any payment/settlement state.

## 25. Certificate revocation test plan (future, not executed)

```
- valid cert on /authenticated/* -> accepted
- revoked cert on /authenticated/* -> rejected (WAF layer, cert_revoked)
- expired cert on /authenticated/* -> rejected where practically testable (may require waiting for a short-lived test cert to actually expire, or a documented Cloudflare test-harness equivalent -- to be resolved live during provisioning)
- missing cert on /authenticated/* -> rejected (WAF layer, cert_verified false)
- no-cert request on any PUBLIC path (§7 matrix) -> still accepted, unaffected
```

## 26. Authorization test matrix (frozen, not executed)

| # | Scenario | Expected outcome |
|---|---|---|
| 1 | PUBLIC path + no cert | 200 / normal response |
| 2 | PUBLIC path + valid cert presented anyway | 200 / normal response, cert ignored (public paths never gate on it) |
| 3 | `/authenticated/*` + no cert | WAF block (403-class), Worker never invoked |
| 4 | `/authenticated/*` + invalid/unverified cert | WAF block, Worker never invoked |
| 5 | `/authenticated/*` + valid cert | Worker invoked, `deriveMtlsCallerContext` returns `state: 'valid'` |
| 6 | `/authenticated/*` + spoofed `X-Client-Cert`-style header, no real cert | WAF block (header is not `cf.tls_client_auth`; §11 proves the Worker layer is also structurally immune even if this somehow reached it) |
| 7 | `/authenticated/*` + valid cert, route requires no x402 payment | mTLS-authorized access proceeds (mTLS is the sole gate for this hypothetical non-paid authenticated route) |
| 8 | `/authenticated/*` + valid cert, route is also x402-paid | Both gates evaluated independently; mTLS identity does not substitute for payment (§8/§9) -- unpaid request still receives `PaymentRequired` |

## 27. Security / rate-limit interaction

```
EXISTING_EDGE_SECURITY_CONFLICTS=NONE_IDENTIFIED_FROM_REPOSITORY_INSPECTION
```

No rate-limiting, bot-management, or IP-policy configuration referencing `/authenticated` or any path pattern that would collide with it was found in the repository's tracked Cloudflare configuration (`wrangler*.toml` files carry no WAF/rate-limit config -- those are zone-level dashboard settings, consistent with §3's access-limitation finding). This item is `NOT_DIRECTLY_VERIFIABLE_IN_THIS_SESSION` for the same reason as §3 and must be confirmed live during actual provisioning, not assumed clear.

## 28. Observability

```
MTLS_OBSERVABILITY_PLAN=
  - valid mTLS request: log { event: 'mtls_authenticated', fingerprint_sha256: <cert fingerprint>, issuer_dn: <issuer>, path } -- no raw certificate bytes, no private key material, ever.
  - invalid mTLS attempt: primarily visible in Cloudflare's own WAF event log (requests never reach the Worker) -- no SITEBORNE-side log entry needed for rejections the WAF already blocks.
  - certificate identity decision: reuse the existing structured-logging convention already established for D10's settlement-alert observability (bounded fields only, no secrets) -- same discipline, new event name.
  - policy rejection (evaluateMtlsAuthorization returning authorized: false for a route that does require mTLS): log { event: 'mtls_policy_denied', reason: <the already-defined stable reason string, e.g. mtls_required_but_state_is_revoked>, path }.
  - public-probe health: unaffected, no new logging needed (§7).
```

## 29. Secrets

```
NEW_WORKER_PRIVATE_KEY_SECRETS=0
NEW_SECRET_NAMES_REQUIRED=NONE
```

The managed-CA model (§12) means Cloudflare holds and operates the CA private key, not SITEBORNE -- there is no CA private key to store as a Worker secret. `request.cf.tlsClientAuth` is edge-populated platform state, not a credential SITEBORNE's Worker needs to hold. The qualification client certificate's own private key (§13) is held by the *client* (the qualification-test operator), never by the Worker.

## 30. Production version impact

```
PUBLIC_API_DEPLOY_REQUIRED=YES  (siteborne-utility-edge -- the only component that would gain a new route + the Agent Card change)
PAID_RUNTIME_DEPLOY_REQUIRED=NO  (paid-continuation-workflow.ts's shared service boundary is reused unmodified per §9's SECOND_SERVICE_HANDLER=NO / SECOND_PAYMENT_PATH=NO / SECOND_SETTLEMENT_PATH=NO)
ALERT_WORKER_DEPLOY_REQUIRED=NO  (siteborne-settlement-alert is unrelated to A2A/mTLS entirely)
```

Verified from the actual diff/binding boundary, not assumed: `mtls-caller-context.ts` lives under `apps/edge-api/src/control-plane/security/`, imported only by the (not-yet-written) new route registration in the public API Worker's own routing table -- it has zero import-graph reach into `paid-continuation-workflow.ts` or the settlement-alert Worker's own entrypoint.

## 31. Settlement ownership (reconfirmed static)

```
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

Unchanged from every prior checkpoint's reconfirmation; nothing in this design plan proposes touching `paid-continuation-workflow.ts`.

## 32. Carried payment test failures -- release impact

Covered in full in §0 above (moved to the top of this report per the checkpoint's own §0 framing). Summary: `TEST_INFRASTRUCTURE` class, root cause proven (stale assertions against the governed `ac642cb` PCC wire-result contract change), disposition (updating the four files' assertions) explicitly deferred to its own dedicated checkpoint rather than folded into this mTLS-scoped one.

## 33. No full-suite claim

```
FULL_RELEASE_GATE_CLEAN=NO
```

Preserved from §0/prior checkpoint; not re-claimed as PASS here. This design-only checkpoint made no source changes, so the full suite was not re-run -- the carried-failure count and file list are unchanged from the prior checkpoint's own measurement.

## 34. Zero mutation accounting

```
CLOUDFLARE_CA_MUTATIONS=0
CLOUDFLARE_MTLS_MUTATIONS=0
WAF_MUTATIONS=0
DNS_MUTATIONS=0
ROUTE_MUTATIONS=0
CERTIFICATES_ISSUED=0
CERTIFICATES_REVOKED=0
SECRET_MUTATIONS=0

PRODUCTION_DEPLOYMENTS=0
TRAFFIC_MUTATIONS=0
PRODUCTION_D1_WRITES=0

LIVE_MTLS_TEST_REQUESTS=0

LIVE_QUOTES_OR_INTENTIONAL_402_REQUESTS=0
REAL_SIGNING_PAYMENT_ACTIONS=0
PAID_REQUESTS=0
REAL_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENTS=0
ECONOMIC_EFFECT_USDC=0
```

## 35. Final decision

```
SUN1222C_MTLS_PRODUCTION_PROVISIONING_PLAN=READY_FOR_PROVISIONING_AFTER_PAYMENT_TEST_DISPOSITION
```

The plan itself can isolate mTLS provisioning without identified public-service risk (§23), using only Cloudflare capabilities verified live as available on SITEBORNE's current plan (§4). It is gated on the carried payment-test disposition (§0/§32) being resolved first -- not because the two are technically coupled, but because provisioning real production infrastructure changes while the release gate is knowingly not clean is the wrong sequencing discipline for this engagement, matching the standing rule that every prior checkpoint in this sequence has followed (fix/understand before extend). It is also gated on the `RESIDUAL_LIVE_VERIFICATION_ITEM` from §4/§22 (confirming the exact hostname-level-toggle-vs-WAF-rule mechanics live in the dashboard) and on obtaining working Cloudflare zone-level read/write API access for the actual provisioning checkpoint (§3), since this session's available credentials could not perform that class of live read.
