# MCP-CANONICAL-TOOL-NAMING-01 — closure

```text
MCP_CANONICAL_TOOL_NAMING_01=PASS_WITH_SCORER_LIMITATION
MCP_RENAME_GOVERNANCE_DECISION=KEEP_VERB_FIRST_RENAME
NAMING_SEMANTIC_QUALIFICATION=PASS
TDQS_TARGET_5_CONFIRMED=NO
```

This report keeps two questions apart and does not let one stand in for the
other:

- **NAMING_SEMANTIC_QUALIFICATION** — is the public name set clear, verb-first,
  dispatch-exact, and free of any identity, schema, price or security change?
  Answer: **PASS** (sections 3–7).
- **TDQS_SCORE_RESULT** — what did the hosted scorer return? Answer: overall
  **4.6**, naming consistency **4**. The 5.0 target was **not** reached and is
  **not** claimed (section 8).

The first is why the rename is kept. The second is recorded exactly as observed
and is no longer a gate (governance decision, this checkpoint).

## 1. Provenance

```text
STARTING_HEAD=85b32eb3a10e4fd6209db9fb63350b5355653f30   (branch metadata-vcm-qualification)
FINAL_LOCAL_HEAD=see `git log -1` (this report is part of that commit)
WORKING_TREE_AT_START=DIRTY (21 modified files = the rename; nothing untracked)
WORKING_TREE_AT_END=CLEAN after commit
```

Base of the security publication work: `35ed3d6` (local, unpublished). `85b32eb`
had reverted an earlier `get_*` rename experiment (section 9) and left source
identical to `35ed3d6`.

## 2. Exact public names

Read from the real generated `tools/list` (real MCP Hono app and official client
via `packages/protocol-mcp/scripts/export-tdqs-tools.mjs`) after rebuilding
`packages/protocol-mcp` (`dist/index.js` had been stale).

```text
MCP_NAMES_BEFORE=
  siteborne_company_evidence_graph
  siteborne_web_context_verified
  siteborne_document_evidence_json
  siteborne_verify_agent_output
  siteborne_get_quote
  siteborne_get_service_health

MCP_NAMES_AFTER=
  siteborne_build_company_evidence_graph
  siteborne_retrieve_verified_web_context
  siteborne_extract_document_evidence_json
  siteborne_verify_agent_output
  siteborne_get_quote
  siteborne_get_service_health

MCP_TOOL_COUNT=6
ALL_NAMES_VERB_FIRST=YES
LEGACY_NAMES_ADVERTISED=0
EXPORT_SHA256=8b3c23f984b51537e29d31719858df8999f3a03e4bf84fe8e2bee21ded7037bd
```

Grammar `siteborne_<verb>_<object>`: build → produce a company evidence graph;
retrieve → retrieve verified web context; extract → produce structured document
evidence JSON; verify → verify supplied agent output; get → obtain a quote /
service health. Verbs differ because the operations differ; they were chosen for
truthfulness, not uniformity.

## 3. What changed, and only that

Non-test source changed in exactly two files, both in
`packages/protocol-mcp/src`:

- `constants.ts` — three keys of `MCP_SERVICE_TOOLS` (values, the `*.v2` service
  IDs, untouched).
- `server.ts` — cross-reference prose in tool descriptions, and one display
  title (`Verify web context` → `Retrieve verified web context`, for the
  `web_context_verified` service, v1 and v2 entries).

Also changed: the MCP spec baseline fixture (3 names), tests, two scripts and
`docs/operations/MCP_TOOLS.md`. VCM, edge composition and the security
declaration have **no** name literals for the renamed tools; they derive them
from `MCP_SERVICE_TOOLS`.

Field-by-field comparison of the pre-rename export (built from `HEAD` via
`git archive` in the scratchpad) against the post-rename export, per tool:

```text
inputSchema   identical (6/6)
outputSchema  identical (6/6)
annotations   identical (6/6)
_meta         identical (6/6)
description   differs only by the three substituted names (6/6)
title         1 changed (web context: display string only)
```

```text
CAPABILITY_IDENTITY_CHANGED=NO
SERVICE_IDS_CHANGED=NO
HTTP_ROUTES_CHANGED=NO
PRICING_CHANGED=NO
REQUEST_SCHEMAS_CHANGED=NO
RESPONSE_SCHEMAS_CHANGED=NO
PCC_SEMANTICS_CHANGED=NO
SECURITY_PROFILES_CHANGED=NO
PAID_ADMISSION_CHANGED=NO
```

Evidence: the two-file source scope above; the identical schema/annotation/
`_meta` comparison; identical `*.v2` service IDs in dispatch (section 4); quote
amounts unchanged (8000 exact for `web_context_verified.v2`, 190000 upto maximum
for `document_evidence_json.v2`); and the bundle comparison (section 6).

## 4. Dispatch parity

```text
NEW_NAME_DISPATCH_PARITY=PASS
```

Standalone check against the real Hono app with an injected boundary (temporary
test, deleted afterwards):

```text
siteborne_build_company_evidence_graph   -> company_evidence_graph.v2   OK
siteborne_retrieve_verified_web_context  -> web_context_verified.v2     OK
siteborne_extract_document_evidence_json -> document_evidence_json.v2   OK
siteborne_verify_agent_output            -> verify_agent_output.v2      OK
siteborne_get_quote          (exact web_context 8000; upto document 190000)  OK
siteborne_get_service_health                                             OK
legacy siteborne_company_evidence_graph    REJECTED, 0 boundary calls
legacy siteborne_web_context_verified      REJECTED, 0 boundary calls
legacy siteborne_document_evidence_json    REJECTED, 0 boundary calls
```

The committed `transport.test.ts` matrix asserts the same four dispatches.

**Compatibility decision.** No call alias is provided for the old names: every
tool is enumerated by `tools/list`, and a hidden alias would need a bespoke
dispatch path outside registration. Old names now fail with a normal
unknown-tool error. This is a deliberate public break. It is acceptable here
because release-1 names are being frozen before final paid-production
activation, **but this checkpoint did not verify how many external clients
already call the old names** (production has had at least one settled paid
web-direct payment and a canary, so "no existing callers" is not assumed). If
external callers of the old names exist, this is the one criterion that should
be revisited before publication.

## 5. Security Declaration requalification

```text
SECURITY_DECLARATION_TOOL_BINDINGS_UPDATED=NO
SECURITY_DECLARATION_REQUALIFICATION=PASS
```

Bindings needed no edit: the two utility bindings name only
`siteborne_get_quote` and `siteborne_get_service_health` (unchanged), and
paid-tool bindings are keyed by service ID and mapped to tool names at runtime
through `MCP_SERVICE_TOOLS`. Edge composition (`getMcpSecurityMetaByToolName`)
now yields six entries keyed by the six new names; no entry value contains a
tool name, so values are unchanged apart from their key. `declaration.ts`,
`publication.ts` and `security-publication.ts` are untouched.

Focused suites (31 files, 375 tests) all pass: `protocol-mcp`, `vcm`,
`mcp-server`, `mcp-route`, `mcp-metadata-shadow-compare`,
`security-publication-local-surfaces`, `security-declaration-economic-parity`.
Pinned verifiers all rc=0: `mcp:spec:verify`, `mcp:metadata:verify`,
`a2a:fixtures:verify`, `a2a:spec:verify`, `x402:fixtures:verify`,
`contracts:baseline:verify`, `contracts:release:verify`,
`contracts:compat:check`, `openapi:generate:check`, `schemas:check`.

Digests: no committed digest covers the served tools/list or security material
(unchanged finding from the publication checkpoint); the pinned
`mcp-spec-baseline.json` carries the three new names and re-verifies
(`mcp:spec:verify` rc=0). Runtime VCM projection digests are computed, not
stored.

The network-site A2A page mentions only `siteborne_get_quote`, which is
unchanged; no site change was needed. The earlier impact-map "network-site prose
reference to a renamed tool" does not exist.

## 6. Artifact scope

```text
MCP_RENAME_ARTIFACT_SCOPE=PASS
CONTINUATION_HOST_AFFECTED=NO
```

`wrangler deploy --dry-run --outdir` (local build, no upload) of pre-rename
`HEAD` (extracted with `git archive` into the scratchpad) versus the working
tree, compared per esbuild module after normalising path prefixes and bundler
rename suffixes:

```text
public Worker (wrangler.toml):  697 modules both sides; added 0; removed 0; changed 2
    packages/protocol-mcp/src/constants.ts  (521 -> 544 chars)
    packages/protocol-mcp/src/server.ts     (44097 -> 44211 chars)
continuation host (wrangler.paid-continuation-runtime.toml): 763 modules both sides;
    added 0; removed 0; changed 0
```

The continuation host is unaffected and must not be redeployed for this change.

## 7. Source qualification

```text
SOURCE_QUALIFICATION=PASS_WITH_KNOWN_PREEXISTING_LOAD_FLAKE
ISOLATED_RECONCILE_TEST=PASS
```

- `scripts/reconcile-payment-attempts.contract.test.ts` run truly alone (no
  other vitest process): **1 file, 38/38 passed**, 41.3 s.
- Broad suite (previous checkpoint run on this same tree): 4031 passed, 1
  failed. The failure is that same test's known load-sensitive 5000 ms timeout
  under broad-suite load; it passes in isolation and touches no file changed
  here. **Not re-run this checkpoint; the full suite is not reported green.**
- MCP-focused tests: 373 passed after the rename (375 with the two security edge
  suites in section 5). A JWS signature-verification error printed during tests
  comes from an intentional tamper-negative test.
- Deterministic TDQS lint: 0 errors, 3 shadow-candidate warnings, the same three
  as before the rename.
- ESLint: 19 errors, 8 warnings. These reproduce on the pre-rename baseline and
  are pre-existing and unrelated. **ESLint is not globally green.**

```text
KNOWN_BROAD_SUITE_FAILURE=reconcile-payment-attempts.contract.test.ts, 5000 ms timeout under broad-suite load (PRE_EXISTING; passes 38/38 in isolation)
```

## 8. TDQS result (scorer evidence, distinct from section 3–7)

Scorer: `mcp-tdqs@0.1.0`, hosted mode (`https://tdqs.dev`), spec 1.2, no local
model. The API key came from the operator shell environment and was not printed
or persisted; only public tool metadata was sent. The hosted score is
model-graded and can vary run to run.

```text
TDQS_PRE_RENAME_OVERALL=4.6 (tier A)        report: https://tdqs.dev/reports/y2uyepqn0t
TDQS_PRE_RENAME_NAMING=4

TDQS_POST_RENAME_OVERALL=4.6 (tier A)       report: https://tdqs.dev/reports/yf94v6tqp5
TDQS_POST_RENAME_NAMING=4
  final run on the exact final export (SHA-256 8b3c23f9...037bd, byte-identical to the
  earlier verb-first export) - the only hosted run this checkpoint, for recordkeeping
  description quality=4.6  coherence=4.5  disambiguation=5  completeness=4
  tool_count_appropriateness=5  mean tool=4.7  min tool=4.5
  per-tool: build_company_evidence_graph 4.6, retrieve_verified_web_context 4.5,
            extract_document_evidence_json 4.8, verify_agent_output 4.8,
            get_quote 4.6, get_service_health 4.7

TDQS_UNIFORM_GET_SCRATCH_RESULT=4.6 overall, naming 4   report: https://tdqs.dev/reports/z0zt6n5y71
TDQS_TARGET_5_CONFIRMED=NO
```

Reading: the grader's naming rationale for the final names now calls the set a
consistent `verb_noun` pattern and cites only `get_*` as a minor deviation, yet
still scores naming 4. The uniform `get_*` scratch experiment (section 9) also
scored naming 4. Naming consistency therefore did not respond to either rename
variant; the overall score is 4.6 before, after, and under the uniform variant.
Description quality reads 4.6 here against 4.7 in the pre-rename run; the
descriptions differ only by the substituted names, and the scorer is
model-graded, so this 0.1 difference is treated as scorer variation, not as an
effect of the rename (not separately tested).

An earlier hosted run on this same export was made in the previous working
session; the operator reported its naming score as 4. Its full numbers are not
recorded in the repository and were not recovered, so they are not quoted here;
the run above supersedes it for recordkeeping.

The operator's earlier observation of 4.9 did not reproduce under
`mcp-tdqs@0.1.0` / spec 1.2 (pre-rename baseline 4.6).

## 9. Prior experiment retained for the record: uniform `get_*`

Recorded at `85b32eb`, rejected under the then-gate
`TDQS_POST_RENAME_OVERALL=5.0` and reverted, source left identical to `35ed3d6`.

```text
siteborne_company_evidence_graph -> siteborne_get_company_evidence_graph
siteborne_web_context_verified   -> siteborne_get_verified_web_context
siteborne_document_evidence_json -> siteborne_get_document_evidence_json
overall 4.6, naming 4; export SHA-256 60537d88...a52d5 (post), 063611b1...b50162 (pre)
```

It changed nothing about identity or schemas either (same map-key-only scope).
It is not pursued: it forces `get_*` onto operations that build, retrieve and
extract, which is less truthful, and it did not move the score.

## 10. Governance decision

Criteria for KEEP, each checked:

| Criterion                                          | Result                                     |
| -------------------------------------------------- | ------------------------------------------ |
| Six tools semantically clear                       | yes                                        |
| All names verb-first                               | yes                                        |
| Dispatch parity exact                              | yes                                        |
| No durable/canonical identity changed              | yes                                        |
| Schemas unchanged                                  | yes                                        |
| Economic semantics unchanged                       | yes                                        |
| Security Declaration bindings requalify            | yes                                        |
| Public artifact scope narrow                       | yes (2 modules)                            |
| No compatibility regression beyond the name change | one deliberate break (section 4), accepted |

Revert triggers examined and not hit: no ambiguity introduced, no dispatch or
capability identity change, no contract change beyond display/projection names.

```text
MCP_RENAME_GOVERNANCE_DECISION=KEEP_VERB_FIRST_RENAME
MCP_RELEASE1_NAMES_FROZEN=YES
SAFE_TO_RESUME_SECURITY_DECLARATION_PUBLICATION=YES
SAFE_FOR_FINAL_PAID_PRODUCTION_ACTIVATION=NO
```

`SAFE_FOR_FINAL_PAID_PRODUCTION_ACTIVATION=NO` is unchanged: the security
declaration is not yet published, and nothing here authorises any economic step.

Follow-ups, not done here:

- `docs/source/SITEBORNE_UTILITY_NETWORK_MASTER_DIRECTIVE.md` (lines 428-430)
  still lists the three old names. It is a source directive and was left
  unmodified; it needs an explicit governance edit.
- Historical reports under `docs/reports/` intentionally retain old names as
  point-in-time records.
- Confirm whether any external client already calls the old names; if so,
  revisit the no-alias decision before publication (section 4).
- After publication, the post-publication checks from the publication checkpoint
  still apply, plus a live `tools/list` name check.

## 11. Cloud mutation accounting

```text
REAL_PAYMENT_ATTEMPTS=0
WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
PUBLIC_TRAFFIC_MUTATIONS=0
CLOUD_SECRET_MUTATIONS=0
```

Only `wrangler deploy --dry-run` (local build) was used. External calls: one
hosted TDQS scoring request (public tool definitions only). Scratch builds live
in the session scratchpad, not the repository. Nothing was pushed.
