# SUN-1222C TDQS v1.2 credentialed score

Date: 2026-09-12 (America/Chicago)

## Decision

```text
SUN1222C_TDQS_V1_2_CREDENTIALED_SCORE=PASS
TDQS_PREUPLOAD_GATE=PASS
```

The exact generated six-tool MCP definition set from source authority
`896d75a343d5a4ac2690cf60e1259828482a8a63` passed the official TDQS hosted
model-grade on the first call. Every tool is Tier A. The server received overall
`4.4/A`, description quality `4.4/A`, and coherence `4.5/A`. SITEBORNE's
independent numeric requirement, overall score at least 4.0, therefore passes.

No metadata refinement was necessary. The three deterministic shadow-candidate
warnings remain visible; the hosted coherence evaluation found each pair
meaningfully disjoint and not genuinely substitutable. Per the governance rule,
no wording was changed merely to suppress heuristic warnings or pursue a higher
score.

## Repository and credential boundary

```text
START_HEAD=d9d2f2be33ca12191596be63156ce12e5e858fbd
BRANCH=main
WORKING_TREE_PRE=CLEAN

MCP_METADATA_SOURCE_AUTHORITY=896d75a343d5a4ac2690cf60e1259828482a8a63
MCP_METADATA_SOURCE_AUTHORITY_EXISTS=YES
MCP_METADATA_SOURCE_AUTHORITY_REACHABLE=YES
MCP_METADATA_SOURCE_DIFF_FROM_AUTHORITY=EMPTY

TDQS_HOSTED_API_KEY_PRESENT=YES
TDQS_SCORING_MODE=OFFICIAL_HOSTED
LOCAL_MODEL_PROVIDER_USED=NO
```

The TDQS account key was read only from the local launch-agent environment and
injected only into the hosted scorer process through `TDQS_API_KEY`. Its value,
prefix, and length were not printed; it was not placed in arguments, source,
configuration, report output, documentation, or Git. `TDQS_BASE_URL` and
`TDQS_MODEL` were unset for the hosted invocation. No OpenAI, OpenRouter, or
other local model-provider credential was used.

## Fresh definition export and deterministic lint

The exact procedure was:

```bash
cd packages/protocol-mcp
pnpm run build
node scripts/export-tdqs-tools.mjs \
  /tmp/siteborne-tdqs-v1.2-tools-list.json
shasum -a 256 /tmp/siteborne-tdqs-v1.2-tools-list.json
```

```text
TDQS_TOOLS_EXPORT_SHA256=587e3c992a18eeb4d99fd726acb3dc8ec378b4f415eedcc8dedb86037d821316
TDQS_GENERATED_TOOL_COUNT=6
TDQS_TOOL_NAME_SET_MATCH=YES
```

The generated names were exactly:

```text
siteborne_company_evidence_graph
siteborne_web_context_verified
siteborne_document_evidence_json
siteborne_verify_agent_output
siteborne_get_quote
siteborne_get_service_health
```

The pinned deterministic invocation completed with zero errors:

```text
TDQS_DETERMINISTIC_LINT=PASS
TDQS_SPEC_VERSION=1.2
TDQS_LINT_ERRORS=0
TDQS_LINT_WARNINGS=3
TDQS_LINT_NOTES=0
```

Warnings, preserved without suppression:

1. `siteborne_company_evidence_graph` may be shadowed by the cheaper
   `siteborne_web_context_verified` if their purposes overlap.
2. `siteborne_document_evidence_json` may be shadowed by the free
   `siteborne_get_service_health` if their purposes overlap.
3. `siteborne_verify_agent_output` may be shadowed by the cheaper
   `siteborne_company_evidence_graph` if their purposes overlap.

All six generated definitions had output schemas and annotations. Every
semantically meaningful input property had a description; deterministic schema
description coverage was 100% for every tool.

## Official hosted call and report binding

The CLI's current `score --help` output confirmed `--hosted`, `--output`,
`--format`, and `--fail-under` support. Hosted call 1 used:

```bash
npx -y mcp-tdqs@0.1.0 score \
  --file /tmp/siteborne-tdqs-v1.2-tools-list.json \
  --hosted https://tdqs.dev \
  --format json \
  --output /tmp/siteborne-tdqs-v1.2-score-1.json \
  --fail-under A
```

`TDQS_API_KEY` was supplied only in the command's process environment.

```text
TDQS_HOSTED_SCORE_CALL_1_EXIT=0
TDQS_HOSTED_SCORE_CALLS=1
TDQS_HOSTED_SCORE_CALLS_MAX=3
TDQS_REFINEMENT_ITERATIONS=0

FINAL_TDQS_REPORT_UID=rl1ev4t9pz
FINAL_TDQS_REPORT_URL=https://tdqs.dev/reports/rl1ev4t9pz
FINAL_TDQS_REPORT_HTTP_STATUS=200
FINAL_TDQS_REPORT_JSON_SHA256=b369d7eec68775281fefed372a81d5ff51c4c0be629c3aeaaf5cfc88d377427d
FINAL_TDQS_TOOLS_EXPORT_SHA256=587e3c992a18eeb4d99fd726acb3dc8ec378b4f415eedcc8dedb86037d821316
FINAL_TDQS_SOURCE_COMMIT=896d75a343d5a4ac2690cf60e1259828482a8a63
TDQS_REPORT_BOUND_TO_PRODUCTION_CANDIDATE_METADATA=YES
```

The CLI returned the report URL, and the unauthenticated URL returned HTTP 200.
The saved JSON identifies specification 1.2, six scored tools, generation time
`2026-09-12T12:49:45.154Z`, and these input hashes in the same name order as the
fresh export:

```text
siteborne_company_evidence_graph=4e507efc8d0b97e9
siteborne_web_context_verified=468177b51ffb45fa
siteborne_document_evidence_json=b90fd2da185ce18f
siteborne_verify_agent_output=e35e6623d716cfd4
siteborne_get_quote=a68cd7b042e125bd
siteborne_get_service_health=c8e6920174628be2
```

The report/export association is preserved by the source commit, generation
procedure, exact export SHA-256, report JSON SHA-256, report UID/URL, tool
order, and per-tool input hashes.

## Exact tool score matrix

| Tool                               | TDQS | Tier | Purpose clarity | Usage guidelines | Behavioral transparency | Parameter semantics | Conciseness / structure | Contextual completeness | Flags          | Smells |
| ---------------------------------- | ---: | :--: | --------------: | ---------------: | ----------------------: | ------------------: | ----------------------: | ----------------------: | -------------- | ------ |
| `siteborne_company_evidence_graph` |  4.3 |  A   |               5 |                5 |                       4 |                   3 |                       4 |                       4 | Shadowing Risk | none   |
| `siteborne_web_context_verified`   |  4.5 |  A   |               5 |                5 |                       4 |                   4 |                       4 |                       4 | none           | none   |
| `siteborne_document_evidence_json` |  4.5 |  A   |               5 |                5 |                       4 |                   4 |                       4 |                       4 | Shadowing Risk | none   |
| `siteborne_verify_agent_output`    |  4.5 |  A   |               5 |                5 |                       4 |                   3 |                       5 |                       5 | Shadowing Risk | none   |
| `siteborne_get_quote`              |  4.7 |  A   |               5 |                5 |                       4 |                   4 |                       5 |                       5 | none           | none   |
| `siteborne_get_service_health`     |  4.6 |  A   |               5 |                5 |                       4 |                   4 |                       4 |                       5 | none           | none   |

```text
EVERY_TOOL_TIER_A=YES
DEGENERATE_DESCRIPTION_FLAGS=0
TAUTOLOGICAL_DESCRIPTION_FLAGS=0
UNDOCUMENTED_PARAMETER_FINDINGS=0
USAGE_GUIDELINE_SMELLS=0
```

The three zero counts above are derived from the official report's empty smell
arrays, its only reported flags being the three named shadowing risks, the
deterministic zero-error result, and 100% parameter-description coverage. The
report does not expose separate scalar fields with those names.

## Per-tool model justifications

### `siteborne_company_evidence_graph` — 4.3 / A

- **Purpose clarity — 5:** Clearly states that the tool builds a proof-carrying
  graph of public company identity, SEC filings, website observations,
  regulatory mentions, and repository signals. It distinguishes single-URL,
  document, and supplied-agent-output work by naming the appropriate siblings.
- **Usage guidelines — 5:** Gives explicit use and do-not-use guidance and names
  three sibling alternatives with their distinct subjects.
- **Behavioral transparency — 4:** Goes beyond annotations by disclosing the
  governed paid flow, unpaid `payment_required`, current production-disabled
  behavior, and governed payment/audit/job/Workflow persistence. The report's
  only reservation was that persistence side effects were not described in more
  detail.
- **Parameter semantics — 3:** All 11 parameters have schema descriptions. The
  description adds entity-level, cross-source context but little parameter-level
  meaning beyond the complete schema.
- **Conciseness/structure — 4:** Clear, front-loaded sections; slightly long,
  with each sentence serving the production-status or selection boundary.
- **Contextual completeness — 4:** Covers purpose, selection, behavior, and
  semantic result for a complex tool. The report noted only that “PCC context”
  is not independently defined.

### `siteborne_web_context_verified` — 4.5 / A

- **Purpose clarity — 5:** Precisely identifies evidence retrieval and
  verification for one public URL, including direct or browser-rendered
  acquisition, and distinguishes all sibling evidence subjects.
- **Usage guidelines — 5:** Explicitly says when the request is about one URL
  and names company, document, and agent-output alternatives.
- **Behavioral transparency — 4:** Discloses the governed paid flow, unpaid
  boundary, bounded network/browser retrieval, state persistence, and current
  production-enabled status beyond the MCP annotations.
- **Parameter semantics — 4:** All 12 parameters are documented; the description
  adds the bounded retrieval and payment context that connects the parameters to
  the tool's purpose.
- **Conciseness/structure — 4:** Well-sectioned and appropriately sized for the
  complexity; the behavior section is slightly verbose but informative.
- **Contextual completeness — 4:** Provides enough purpose, selection, behavior,
  and result context for correct agent use alongside a complete output schema.

### `siteborne_document_evidence_json` — 4.5 / A

- **Purpose clarity — 5:** Precisely describes extracting and verifying
  structured evidence from one authorized artifact, prior upload, or public
  document URL and names the appropriate siblings for other work.
- **Usage guidelines — 5:** Includes explicit use and do-not-use rules with
  concrete sibling alternatives and current production-disabled status.
- **Behavioral transparency — 4:** Discloses the possible governed paid flow,
  `payment_required`, state persistence, and production-disabled rejection. The
  report noted it does not expand every persistence detail.
- **Parameter semantics — 4:** All 12 properties are documented; the description
  adds the three mutually exclusive reference modes and the exactly-one
  selection rule.
- **Conciseness/structure — 4:** Dense but front-loaded and informative for the
  tool's complexity.
- **Contextual completeness — 4:** Covers purpose, selection, behavior, result,
  and disabled status. The report identified only a possible further statement
  of the exact `oneOf` constraint.

### `siteborne_verify_agent_output` — 4.5 / A

- **Purpose clarity — 5:** Precisely states that the tool evaluates supplied
  agent output against explicit claims, deterministic requirements, a required
  JSON Schema, and optional evidence. It distinguishes evidence gathering from
  output verification.
- **Usage guidelines — 5:** Explicit use/do-not-use guidance names the company,
  URL, and document tools for evidence acquisition.
- **Behavioral transparency — 4:** Goes beyond annotations by disclosing the
  governed paid flow, unpaid boundary, and governed payment/audit/job/Workflow
  persistence.
- **Parameter semantics — 3:** All nine parameters are fully described by the
  schema. The prose usefully says candidate output is evidence under test, not
  trusted policy, but adds limited parameter meaning beyond that schema.
- **Conciseness/structure — 5:** Concise, front-loaded, and cleanly divided into
  selection, behavior, and return guidance without redundancy.
- **Contextual completeness — 5:** Complete for a complex nested-input tool with
  an output schema; an agent has the information needed to select and invoke it.

### `siteborne_get_quote` — 4.7 / A

- **Purpose clarity — 5:** Clearly says it builds one canonical x402 payment
  quote for an exact SITEBORNE service request and input.
- **Usage guidelines — 5:** Explains when an agent needs governed price, payee,
  resource, expiry, and payment requirement, while naming the evidence and
  health alternatives.
- **Behavioral transparency — 4:** Explicitly states that it hashes the input,
  selects exact or `upto` pricing, and does not execute the service, verify
  payment, call a provider, create a Workflow, or settle.
- **Parameter semantics — 4:** All three parameters are documented; the prose
  adds the canonical input binding and pricing-mode relationship.
- **Conciseness/structure — 5:** Every sentence has a distinct purpose and no
  schema material is redundantly repeated.
- **Contextual completeness — 5:** Fully covers purpose, selection, quote-only
  behavior, and the semantic result for a moderate-complexity tool.

### `siteborne_get_service_health` — 4.6 / A

- **Purpose clarity — 5:** Precisely reports MCP readiness and production-enable
  status for each SITEBORNE service.
- **Usage guidelines — 5:** Explicitly distinguishes availability inspection
  from quoting and evidence work and names the corresponding tools.
- **Behavioral transparency — 4:** Beyond read-only annotations, it states that
  the call is credential-independent and performs no paid evidence work, quote
  creation, payment verification, provider call, state write, Workflow, or
  settlement.
- **Parameter semantics — 4:** The tool has no parameters; the description adds
  semantic output scope covering all four evidence services.
- **Conciseness/structure — 4:** Slightly verbose for a zero-parameter tool, but
  the explicit use/do-not-use/behavior/returns organization is valuable.
- **Contextual completeness — 5:** Complete for a zero-parameter read-only
  status tool with a defined output schema.

## Server quality and shadow-pair review

```text
TDQS_OVERALL_SCORE=4.4
TDQS_OVERALL_TIER=A
OVERALL_SCORE_AT_LEAST_4_0=YES

TDQS_DESCRIPTION_QUALITY_SCORE=4.4
TDQS_DESCRIPTION_QUALITY_TIER=A
SERVER_DESCRIPTION_QUALITY_TIER_A=YES

TDQS_COHERENCE_SCORE=4.5
TDQS_COHERENCE_TIER=A
SERVER_COHERENCE_TIER_AT_LEAST_B=YES

DISAMBIGUATION=5
NAMING_CONSISTENCY=4
TOOL_COUNT_APPROPRIATENESS=5
COMPLETENESS=4
```

Server justifications:

- **Disambiguation — 5:** The company, single-URL, document, supplied-output,
  quote, and health purposes are distinct; explicit use/do-not-use sections make
  selection errors unlikely.
- **Naming consistency — 4:** Every name uses the `siteborne_` prefix and
  snake_case with predictable verbs/nouns. The report noted the format suffix in
  `document_evidence_json` as a minor inconsistency.
- **Tool-count appropriateness — 5:** Six tools correctly represent four
  evidence services plus quote and health utilities without redundancy.
- **Completeness — 4:** The set covers the evidence lifecycle and supporting
  quote/health work. The report noted no explicit prior-upload management tool,
  while recognizing that the document tool accepts prior-upload references.

The official coherence summary classifies the server as highly coherent with
clear disambiguation, consistent naming, appropriate count, and strong evidence
coverage.

Shadow-pair model results:

```text
SHADOW_CANDIDATE_1_MODEL_RESULT=NO_GENUINE_OVERLAP
SHADOW_CANDIDATE_2_MODEL_RESULT=PURPOSES_ENTIRELY_DISJOINT
SHADOW_CANDIDATE_3_MODEL_RESULT=DIFFERENT_QUESTIONS_NO_SUBSTITUTION
```

1. `company_evidence_graph` versus `web_context_verified`: both can involve web
   evidence, but the former synthesizes a company-level, multi-source graph and
   the latter verifies one URL. One cannot replace the other.
2. `document_evidence_json` versus `get_service_health`: health reports service
   status and cannot extract or verify document evidence. There is no overlap.
3. `verify_agent_output` versus `company_evidence_graph`: one evaluates an
   existing output against claims/schema; the other creates company evidence.
   The cheaper graph cannot produce the verification verdict.

No refinement was justified after all release gates passed. Hosted score calls 2
and 3 were not made.

## MCP regression and semantic invariance

The complete protocol package test suite and frozen fixture verification passed:

```text
MCP_PROTOCOL_REGRESSION=PASS
MCP_TEST_FILES=5_PASSED
MCP_TESTS=78_PASSED
MCP_SPEC_FIXTURE=PASS
MCP_PROTOCOL_VERSION=2026-07-28

MCP_INITIALIZE_UNCHANGED=YES
MCP_TOOL_COUNT_UNCHANGED=6
MCP_TOOL_NAMES_UNCHANGED=YES
MCP_INPUT_SCHEMA_SEMANTICS_UNCHANGED=YES
MCP_OUTPUT_SCHEMA_SEMANTICS_UNCHANGED=YES
MCP_EXECUTION_BEHAVIOR_UNCHANGED=YES
MCP_PAYMENT_BEHAVIOR_UNCHANGED=YES
PRICE_CONFIGURATION_CHANGED=NO
PROVIDER_RUNTIME_LOGIC_CHANGED=NO
SERVICE_ACTIVATION_CHANGED=NO
```

These invariance results follow from the empty source diff between the scored
MCP/pricing definition paths and source authority `896d75a…`, plus the fresh
build, 78-test regression, frozen fixture, and exact fresh export hash.

## Production-state invariance

All production inspection was read-only. Wrangler 4.119.0 reported no pending
migration. D1 readback returned `changes=0`, `changed_db=false`, and
`rows_written=0` for every query.

```text
MIGRATION_0010_APPLIED_PRE=YES
MIGRATION_0010_APPLIED_POST=YES
PRODUCTION_RECONCILIATION_ROWS_PRE=17
PRODUCTION_RECONCILIATION_ROWS_POST=17
RAW_VERIFIED=16
RAW_SETTLED_EXTERNAL=1
RAW_NONTERMINAL_LIFECYCLE_COUNT=17

GLOBAL_ACTIVE_CUTOVER_BLOCKING_WORK_COUNT=0
GLOBAL_OWNER_INTENT_PENDING_COUNT=0
GLOBAL_ACTIVE_WORKFLOW_OWNED_ATTEMPTS=0
GLOBAL_UNRECONCILED_ACTIONABLE_ATTEMPTS=0
GLOBAL_UNRESOLVED_SETTLEMENT_FINALIZATION_COUNT=0

PRODUCTION_PAYMENT_ATTEMPTS_UPDATED=0
PRODUCTION_PAYMENT_ATTEMPTS_DELETED=0
LEGACY_PRODUCTION_APPLY_EXECUTED=NO
```

The deployment readback remained:

```text
PUBLIC_NORMAL=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @100%
PUBLIC_QUIESCENCE=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1 @0%
PAID_RUNTIME=d62011b9-6219-47e1-8cf9-5006776cfb50 @100%

MODEL_C_PUBLIC_RUNTIME_LIVE=NO
MODEL_C_PAID_RUNTIME_LIVE=NO
PUBLIC_VERSION_UPLOADS=0
PAID_VERSION_UPLOADS=0
DEPLOYMENT_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
```

## Mutation and economic accounting

```text
PRODUCTION_D1_MIGRATIONS_APPLIED_THIS_CHECKPOINT=0
PRODUCTION_RECONCILIATION_ROWS_INSERTED_THIS_CHECKPOINT=0
PRODUCTION_PAYMENT_ATTEMPTS_UPDATED=0
PRODUCTION_PAYMENT_ATTEMPTS_DELETED=0

PUBLIC_VERSION_UPLOADS=0
PAID_VERSION_UPLOADS=0
DEPLOYMENT_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0

REAL_TEST_PAYMENTS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
PAYMENT_VERIFY_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
USEFUL_PROVIDER_EXECUTIONS=0
PRODUCTION_WORKFLOW_CREATIONS=0
NEW_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```

## Release handoff

```text
TDQS_PREUPLOAD_GATE=PASS
NEW_PUBLIC_WORKER_UPLOAD_PREUPLOAD_GATE=PASS
NEXT_MODEL_C_PUBLIC_CANDIDATE_SOURCE_AUTHORITY=896d75a343d5a4ac2690cf60e1259828482a8a63
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-MODEL-C-PUBLIC-NORMAL-AND-QUIESCENCE-CANDIDATE-BUILD
```

This evidence clears only the TDQS pre-upload quality blocker. It does not
authorize a Worker upload, deployment, traffic change, paid-runtime deployment,
payment, provider execution, Workflow creation, settlement, chain transaction,
or mTLS action.
