# METADATA-VCM-IMPL-05 vcm_primary_compare Implementation and Local Qualification

## 1. Checkpoint result

`METADATA_VCM_IMPL_05=PASS`

The repository now contains a reversible `vcm_primary_compare` implementation
for A2A and MCP. VCM content is eligible for selection only after an
independently constructed legacy reference exists, the VCM result is valid, and
the existing normalized comparator reports semantic equality. Mismatch, VCM
projection failure, VCM validation failure, or comparator failure selects the
complete legacy result. Loss of the independent legacy reference fails closed.

This is local source qualification only. No Worker was uploaded or deployed, no
Cloudflare setting or traffic split was changed, and no commit was pushed. The
deployed modes remain `shadow_compare`; this checkpoint does not make VCM the
production authority.

## 2. Authoritative provenance

- Branch: `metadata-vcm-qualification`
- Starting local HEAD: `30718cb68ca1ac12df1f321070f1079ff0a60adf`
- Starting remote HEAD: `30718cb68ca1ac12df1f321070f1079ff0a60adf`
- Starting provenance: PASS
- Approved architecture commit: `620ab84dcce95f0d126ad3f02b08ca590c4e810d`
- Approved architecture:
  `docs/reports/METADATA-VCM-08-vcm-primary-compare-architecture-and-implementation-design.md`
- Approved plan commit: `30718cb68ca1ac12df1f321070f1079ff0a60adf`
- Approved plan:
  `docs/plans/METADATA-VCM-IMPL-05-vcm-primary-compare-implementation-plan.md`
- Plan result: `METADATA_VCM_IMPL_05P=PASS`
- Source contradiction found before implementation: NO
- Planned tasks: 7
- Completed tasks: 7

The pre-edit checkout was clean. The design and plan were read completely and
their seven tasks were checked against the source before the first test edit.

## 3. Implementation commit sequence

The seven approved slices were committed independently after focused GREEN and
nearby regression evidence:

1. `8cc6952e3d2d29c99437cace93919598aeec66d4` — authorize primary compare mode
2. `72e6f375c01d4ad002e4348b226b119d5014e743` — add fail-safe primary selector
3. `3085012a76e7ecd851e5fa81d666ca57d447bd96` — accept selected unsigned A2A
   content
4. `77d507ddf5bcc5292b0c07f7bd697d8d369a8eb9` — select A2A primary content
   before signing
5. `b495e31d455218dc894f20ddc2aef1adc748e263` — separate MCP definitions from
   handlers
6. `0e3b10e769751fa683adad204c8d4655014940ae` — derive MCP primary context from
   typed authority
7. `892003601f829b1b7d439cfdac369250e252ed76` — select MCP definitions before
   registration

Full qualification then exposed two TypeScript-only defects and one formatting
miss. They were repaired without changing runtime semantics in:

- `14b56bd84cc5e4b2d510219862ea1e1d501d1fda` — repair primary compare type
  safety

The repair gives the whole-object selector test an explicit common object type,
routes the readonly VCM Agent Card through the SDK's mutable type boundary via
`unknown`, and formats the Task 1 mode test. Focused tests, edge typecheck, full
workspace typecheck, lint, and changed-file formatting passed afterward.

## 4. Changed runtime paths

The base-to-implementation diff contains only the primary-compare model,
selection, protocol-definition, and route-integration boundaries:

- `apps/edge-api/src/control-plane/config/metadata-projection-mode.ts`
- `apps/edge-api/src/control-plane/metadata/primary-comparison-selector.ts`
- `apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.ts`
- `apps/edge-api/src/routes/a2a.ts`
- `apps/edge-api/src/routes/mcp.ts`
- `packages/protocol-a2a/src/transport.ts`
- `packages/protocol-a2a/src/types.ts`
- `packages/protocol-mcp/src/server.ts`
- `packages/protocol-mcp/src/types.ts`
- `packages/vcm/src/index.ts`
- `packages/vcm/src/projections/mcp-real-context.ts`

No deployment configuration, production variable, secret, route name, Cron
definition, queue configuration, D1 schema, R2/KV behavior, workflow behavior,
service binding, pricing source, governance source, registry artifact, schema,
or contract file changed.

`RUNTIME_SOURCE_CHANGE=BOUNDED_TO_VCM_PRIMARY_COMPARE`

## 5. Changed test paths

- `apps/edge-api/src/control-plane/config/metadata-projection-mode.test.ts`
- `apps/edge-api/src/control-plane/metadata/primary-comparison-selector.test.ts`
- `apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.test.ts`
- `apps/edge-api/tests/a2a-metadata-shadow-adversarial.test.ts`
- `apps/edge-api/tests/a2a-metadata-shadow-compare.test.ts`
- `apps/edge-api/tests/mcp-metadata-shadow-adversarial.test.ts`
- `apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts`
- `packages/protocol-a2a/src/transport.test.ts`
- `packages/protocol-mcp/src/transport.test.ts`
- `packages/vcm/src/projections/mcp-shadow.test.ts`

## 6. Strict TDD evidence

### Task 1 — mode authorization

RED: 2 failed and 17 passed. Both A2A and MCP resolved `vcm_primary_compare` to
`legacy`.

GREEN: all 19 mode tests passed. `legacy`, `shadow_compare`, and
`vcm_primary_compare` are servable; `vcm_only` still resolves to `legacy` with
explicit refusal telemetry. Missing and invalid inputs retain the existing safe
parser behavior. The nearby A2A/MCP shadow regressions passed 14/14.

### Task 2 — whole-object selector and lifecycle telemetry

RED: the selector module did not exist, and the new closed lifecycle telemetry
test failed. The run recorded 2 failed files and the expected missing-symbol
cause.

GREEN: selector and telemetry tests passed 13/13. Tests cover complete VCM
selection on match, complete legacy selection on mismatch, projector failure,
validation failure, comparator failure, independent-legacy loss, both producer
closures failing, whole-object non-mixing, and telemetry exceptions. Nearby
regressions passed 19/19.

### Task 3 — selected unsigned A2A content seam

RED: 3 failed and 25 passed. The transport rebuilt legacy content, did not
reject a pre-signed supplied card, and did not preserve an immutable snapshot of
caller-supplied unsigned content.

GREEN: protocol A2A transport tests passed 28/28. The seam accepts only an
unsigned Agent Card, snapshots it, signs exactly once through the existing
identity, verifies through the existing verifier, and exposes no unsigned
fallback. Nearby card/signing/transport tests passed 59/59.

### Task 4 — A2A primary selection, signing, and cache

RED: 6 failed and 12 passed. Primary selection telemetry was absent, mismatch
and projector paths did not select legacy through the approved selector, legacy
loss did not fail closed, signing-failure telemetry was absent, and the cache
never entered the VCM projector.

GREEN: A2A metadata-mode tests passed 19/19 and the nearby edge regression
passed 50/50. The final full A2A gate passed 60 unit tests, 6 property tests,
the fixture and spec checks, and 6 edge-route tests.

### Task 5 — MCP definition and executable-handler separation

RED: 12 failed and 46 passed because the pure definition builder, exact-set
validator, definition-only option, and typed definition authority did not exist.

GREEN: protocol MCP transport tests passed 58/58. The nearest five-file
regression passed 90/90. The definition input type has no handler field; the
existing service, quote, and health closures remain private to the protocol
package and are paired with selected metadata only at the unchanged
`registerTool` boundary.

### Task 6 — typed current MCP authority context

RED: 7 failed and 13 passed because no typed current-authority context builder
existed.

GREEN: all 20 focused projection tests passed and the nearby VCM regression
passed 31/31. The adapter derives four v2 service tools plus quote and health
utility tools. Canonical v1 service identities do not create v1 MCP tools. The
adapter accepts no served response and no executable handler.

### Task 7 — MCP primary definition selection before registration

RED: 9 failed and 15 passed. The route authorized primary mode but still
constructed the MCP app without selected definitions or primary lifecycle
telemetry; mismatch/failure injections never entered primary selection.

GREEN: both focused MCP metadata suites passed 24/24. The five-file edge
regression passed 54/54. The complete MCP check passed afterward.

## 7. Mode authorization and authority barrier

The closed vocabulary remains:

- `legacy`
- `shadow_compare`
- `vcm_primary_compare`
- `vcm_only`

Authorization is:

| Mode                  | Servable | Result                                                                                             |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `legacy`              | YES      | Legacy produces served metadata.                                                                   |
| `shadow_compare`      | YES      | Legacy serves; VCM remains observational.                                                          |
| `vcm_primary_compare` | YES      | VCM serves only after validation and exact semantic match against an independent legacy reference. |
| `vcm_only`            | NO       | Explicitly refused and resolved to `legacy`.                                                       |

Invalid values, empty values, case variations, and boolean-shaped values keep
the existing safe parser contract. The two surfaces remain independently
controlled.

`VCM_ONLY_SERVABLE=NO`

## 8. Primary selection behavior

The shared selector always builds the legacy reference first. This is the
fail-closed reference-availability boundary: if legacy construction fails, the
primary producer is not called and the request fails closed.

After a usable legacy object exists:

| Condition                                       | Selected result                       |
| ----------------------------------------------- | ------------------------------------- |
| VCM builds, validates, and semantically matches | Complete VCM object                   |
| Semantic mismatch                               | Complete legacy object                |
| VCM projector throws/rejects                    | Complete legacy object                |
| VCM validation fails                            | Complete legacy object                |
| Comparator fails                                | Complete legacy object                |
| Legacy reference unavailable                    | Fail closed                           |
| Telemetry fails                                 | Otherwise-safe selection is unchanged |

The selector never merges fields from the two objects. Comparison uses the
existing VCM comparator and difference classification law.

## 9. A2A implementation

The A2A cache-rebuild promise performs the approved flow:

1. resolve the unchanged signing identity;
2. build an independent unsigned legacy card;
3. build the effective VCM view and project an independent unsigned VCM card;
4. validate the VCM card as unsigned and structurally usable;
5. apply normalized semantic comparison;
6. select one complete unsigned card;
7. pass only that selected unsigned card to the existing transport;
8. sign with the existing identity;
9. verify through the existing verifier;
10. cache and publish one final signed representation.

The SDK round trip validates the projected Agent Card. The decoder materializes
an absent optional `iconUrl` as an empty string, so the adapter restores
authored absence when VCM did not own that field. This keeps the strict
comparator from accepting an SDK-decoder artifact as a semantic difference.

Selection happens before signing. There is no fallback after signing, no second
signature, no unsigned serving path, and no post-sign substitution. Signing or
verification failure fails closed and emits best-effort bounded telemetry. The
existing single-isolate pending promise remains the only cache lifecycle, so
concurrent callers receive one final signed representation.

`A2A_SELECTION_BEFORE_SIGNING=YES`

`A2A_EXISTING_SIGNER_PRESERVED=YES`

`A2A_CACHE_INVARIANT=ONE_FINAL_SIGNED_REPRESENTATION`

## 10. MCP implementation

The protocol package now exposes a pure six-definition builder, typed current
definition authority, and an exact-set/schema validator. The executable service,
quote, and health closures remain in `buildSiteborneMcpHandlers` inside
`packages/protocol-mcp/src/server.ts`.

For each request in primary mode, the edge route:

1. builds and validates an independent legacy definition array;
2. derives fresh typed definition authority from the same protocol options;
3. adapts that authority into the VCM current MCP projection context;
4. projects and validates the VCM definition array;
5. compares both complete arrays;
6. passes only the selected definition array in `toolDefinitions`;
7. constructs one MCP app and performs one fetch.

The protocol server pairs the selected metadata with the existing private
handler record in canonical `MCP_TOOL_NAMES` order. A VCM definition cannot
carry or replace executable behavior. The six names remain:

1. `siteborne_company_evidence_graph`
2. `siteborne_web_context_verified`
3. `siteborne_document_evidence_json`
4. `siteborne_verify_agent_output`
5. `siteborne_get_quote`
6. `siteborne_get_service_health`

The four service-backed interactions retain their v2 bindings. Quote and health
remain utility/control interactions. JSON and SSE `tools/list`, modern protocol
negotiation, compatibility behavior, malformed requests, unknown methods,
request bounds, host/origin checks, paid-route refusal, authentication behavior,
and zero-provider-invocation guarantees remain on their existing transport and
handler paths.

`MCP_HANDLER_IDENTITY_PRESERVED=YES`

`MCP_VCM_HANDLER_FREE=YES`

`MCP_TOOL_COUNT=6`

`MCP_PROTOCOL_VERSION=2026-07-28`

## 11. Telemetry

The implementation extends the existing structured-log telemetry only. Records
use bounded values for `surface`, `mode`, event name, failure reason, difference
domain, and difference count. No document, request body, signature, secret,
private auth data, client IP, or TLS fingerprint is logged.

Primary-mode telemetry distinguishes:

- primary attempt and success;
- primary/projector failure;
- legacy reference attempt/loss;
- validation failure;
- comparison, match, mismatch, and comparator failure;
- fallback reason;
- A2A signing failure;
- MCP handler/server construction failure.

All telemetry calls are guarded. Telemetry exceptions cannot alter safe
selection, fallback, signing, registration, or serving behavior.

## 12. Economic, security, protocol, and side-effect proof

### Economics

The implementation does not modify `buildCanonicalQuote`, governed pricing,
seller-wallet resolution, payment provider configuration, x402 execution,
settlement, paid-route gates, or production enablement. VCM supplies metadata
definitions only and cannot replace the governed economic source. Frozen
release-declared registry prices remain release evidence and cannot override
current governed values.

Registry price drift verification passed for all 8 entries. VCM registry import,
projection, parity, and validation tests passed 39/39, including explicit 8/8
structural round-trip parity and the governed current-price invariants.

`ECONOMIC_AUTHORITY_CHANGED=NO`

`ECONOMIC_SIDE_EFFECT_DELTA=NONE`

### Security

The `IMPLEMENTED -> CONFIGURED -> ACTIVE -> VERIFIED` law remains unchanged. No
authentication implementation, key material, OAuth/mTLS behavior, signing
credential resolution, x402 verification, or authorization path changed. VCM
receives unsigned A2A content inputs and definition-only MCP authority; it does
not receive signing keys or executable handlers.

`SECURITY_AUTHORITY_CHANGED=NO`

### Protocol

The A2A signer and verifier are unchanged. MCP remains pinned to `2026-07-28`.
No route, response framing, protocol version, handler, or compatibility policy
changed. JSON and SSE transport regressions passed.

`PROTOCOL_AUTHORITY_CHANGED=NO`

### Stateful behavior

No queue, D1, R2, KV, workflow, scheduled path, service binding, provider,
payment, quote, or settlement implementation changed. The new work constructs,
validates, compares, selects, signs existing A2A content, or pairs MCP metadata
with existing handlers.

`STATEFUL_SIDE_EFFECT_DELTA=NONE`

## 13. Authority-inversion barriers

- `buildUnsignedSiteborneAgentCard` remains present and is executed as the A2A
  independent legacy reference.
- `buildLegacySiteborneMcpToolDefinitions` remains present and is executed as
  the MCP independent legacy reference.
- Mismatch/failure tests exercise both legacy builders.
- The existing A2A signer and verifier remain the only signing authority.
- MCP handler closures remain private to the protocol package.
- `vcm_only` remains structurally unservable for both surfaces.
- No deployed mode was changed from `shadow_compare`.
- No accepted registry release was rewritten.

`LEGACY_A2A_BUILDER_REMAINS=YES`

`LEGACY_MCP_BUILDER_REMAINS=YES`

`LEGACY_COMPARATORS_EXECUTABLE=YES`

`AUTHORITY_INVERSION=NO`

## 14. Full local qualification

| Gate                                        | Result                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Focused primary-compare suites              | 75/75 PASS across 7 files                                                                          |
| VCM suite                                   | 143/143 PASS across 16 files                                                                       |
| Explicit registry/economic parity subset    | 39/39 PASS; structural parity 8/8                                                                  |
| A2A check                                   | 60/60 unit, 6/6 property, fixture/spec PASS, 6/6 edge PASS                                         |
| MCP check                                   | 90/90 protocol unit, 90/90 property invocation, spec PASS, 7/7 edge, 1/1 stdio, metadata/pack PASS |
| x402/Bazaar check                           | 512/512 unit plus 20/20 property = 532/532 PASS; fixtures PASS                                     |
| Edge API suite, single worker               | 1598/1598 PASS; 72 explicitly skipped live/recovery tests                                          |
| Workspace typecheck                         | 25/25 tasks PASS                                                                                   |
| Workspace lint                              | 17/17 tasks PASS                                                                                   |
| Changed-file Prettier                       | PASS across all 21 implementation paths                                                            |
| `git diff --check` from implementation base | PASS                                                                                               |
| Secret scan                                 | PASS; 851 commits, tracked scope, and working tree; no leaks                                       |
| PCC generation drift                        | PASS                                                                                               |
| Service-model generation drift              | PASS, all 18 models                                                                                |
| OpenAPI generation drift                    | PASS, all 3 files                                                                                  |
| Schema checks                               | PASS                                                                                               |
| Embedded pricing drift                      | PASS, 15 governed keys                                                                             |
| Registry pricing drift                      | PASS, all 8 entries                                                                                |
| Governance validation                       | PASS, 0 failures                                                                                   |
| State validation                            | PASS, 0 failures                                                                                   |
| Task validation                             | PASS, 252 checks and 0 failures                                                                    |
| Contract baseline verification              | PASS                                                                                               |
| Contract compatibility                      | PASS                                                                                               |
| Contract release verification               | PASS                                                                                               |

The first workspace typecheck found two compile-only defects described in the
commit sequence. They were repaired, the focused tests passed 28/28, the edge
typecheck passed, and the final workspace typecheck passed 25/25. Changed-file
Prettier initially found one Task 1 test style miss; it was formatted, its 19
focused tests passed, and the final changed-file formatting check passed.

Repository-wide Prettier was not used as a success gate because the accepted
baseline contains unrelated pre-existing formatting failures. Every file in this
checkpoint's base-to-HEAD diff passes Prettier.

## 15. Diff and production non-mutation audit

The complete diff from `30718cb68ca1ac12df1f321070f1079ff0a60adf` contains 21
implementation/test paths and no configuration, secret, governance, registry,
schema, pricing, contract, migration, queue, workflow, or binding path.

No Cloudflare read-write command, Worker upload, Worker deployment, traffic
change, production variable/secret mutation, route mutation, trigger mutation,
or Cron mutation was executed. No paid service was invoked. No commit was
pushed.

The authoritative deployed posture remains outside this local source change:

- stable `38cbf4dd-52fd-4afc-ad34-626a2e6454d3` at 100%;
- qualified shadow candidate `1a3ea07b-5885-49d2-9cd0-d176c4313bd0` at 0%;
- A2A deployed mode `shadow_compare`;
- MCP deployed mode `shadow_compare`;
- `PAID_ROUTES_ENABLED=false` for qualification.

`PRODUCTION_A2A_MODE_CHANGED=NO`

`PRODUCTION_MCP_MODE_CHANGED=NO`

`PRODUCTION_CONFIG_CHANGED=NO`

`CLOUDFLARE_MUTATIONS=0`

`WORKER_UPLOADS=0`

`DEPLOYMENTS=0`

`TRAFFIC_MUTATIONS=0`

## 16. Readiness decision

All approved semantics and local qualification gates passed. The implementation
is ready for a separate checkpoint that builds an immutable, zero-percent
candidate carrying explicit `vcm_primary_compare` modes for live qualification.
That future checkpoint still requires its own human authorization before any
Cloudflare mutation.

`SAFE_TO_BUILD_IMMUTABLE_ZERO_PERCENT_CANDIDATE=YES`

`NEXT_CHECKPOINT_RECOMMENDATION=METADATA-VCM-IMPL-06`
