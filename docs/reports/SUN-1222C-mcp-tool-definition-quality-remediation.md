# SUN-1222C MCP tool-definition quality remediation

Date: 2026-09-11 (America/Chicago)

## Decision

The metadata remediation is implemented at source commit
`896d75a343d5a4ac2690cf60e1259828482a8a63`. The actual generated `tools/list`
definitions pass the deterministic TDQS v1.2 hard gates and the complete MCP
regression suite. The official model-graded TDQS score is **blocked, not
failed**: no `TDQS_BASE_URL`, `TDQS_API_KEY`, `TDQS_MODEL`, `OPENAI_API_KEY`, or
`OPENROUTER_API_KEY` is available, and the official hosted playground requires
GitHub sign-in. No score, dimension grade, smell count, or tier is fabricated.

Therefore this commit is the exact MCP metadata source authority for the next
immutable Model-C public candidates, but **no new public Worker version may be
uploaded until a credentialed TDQS v1.2 `score --fail-under A` run proves every
required score/tier gate, including the requested overall score of at least
4.0**.

Official references: [TDQS v1.2](https://tdqs.dev/spec),
[TDQS CLI](https://tdqs.dev/cli), and the
[reference implementation](https://github.com/glama-ai/tool-definition-quality-score).

## Scope and name preservation

The six generated tools remain exactly:

```text
siteborne_company_evidence_graph
siteborne_web_context_verified
siteborne_document_evidence_json
siteborne_verify_agent_output
siteborne_get_quote
siteborne_get_service_health
```

The request used `siteborne_health` as a short label, but the established live
name is `siteborne_get_service_health`; it was not renamed.

```text
TDQS_SPEC_VERSION=1.2
TDQS_TOOL_COUNT=6
MCP_TOOL_NAMES_CHANGED=NO
MCP_TOOL_COUNT_UNCHANGED=6
MCP_TOOL_NAMES_UNCHANGED=YES
```

## Definition design

Every tool description now front-loads an exact verb, resource, and scope;
states concrete use and non-use cases with named siblings; describes whether the
call is read-only, quote-only, or may enter governed paid flow; exposes
feature-gated production-disabled behavior; and explains the semantic result.
The four evidence tools are explicitly disjoint:

- `siteborne_company_evidence_graph` synthesizes entity-level company evidence
  across sources; it is not a one-URL fetch, document extraction, or evaluation
  of an already-produced output.
- `siteborne_web_context_verified` retrieves and verifies one public URL; it is
  not company-wide synthesis, document extraction, or output-contract
  evaluation.
- `siteborne_document_evidence_json` extracts evidence from one authorized
  document reference; it is not a general webpage or company graph and does not
  upload bytes.
- `siteborne_verify_agent_output` evaluates an already-produced output against
  claims, deterministic requirements, schema, and supplied evidence; it does not
  gather new company, web, or document evidence.

`siteborne_get_quote` explicitly says it is quote-only and does not execute the
underlying paid service. `siteborne_get_service_health` explicitly says it does
not perform paid evidence work. Production status is generated from the same
effective service-health configuration used by discovery: currently disabled
services say that they reject execution rather than claiming availability.

All semantically meaningful input properties now have concept/constraint/unit or
format/behavior descriptions. A regression removes only `description` members
and proves the four service input schemas remain structurally identical to their
frozen originals.

## TDQS TDD and deterministic result

The pre-fix red test found three failing contract groups: missing use/non-use,
behavior, and return sections; 32 undocumented input properties; and absent
explicit quote/health boundaries. The original six-name test passed. After the
metadata-only implementation, the TDQS contract is 5/5 green.

The reproducible exporter invokes the same HTTP handler/server factory used by
the Worker, with the qualified feature scope (verify and web enabled; company
and document disabled), then serializes its literal `tools/list` result. The
pinned scorer invocation is `mcp-tdqs@0.1.0`, whose report identifies
specification 1.2. Version 0.2.0 was not used because it follows specification
1.3.

```text
TDQS_DETERMINISTIC_LINT=PASS
TDQS_SPEC_VERSION=1.2
TDQS_TOOL_COUNT=6
PARAMETER_DESCRIPTION_COVERAGE=100_PERCENT_ALL_SIX_TOOLS
TOOLS_WITH_ANNOTATIONS=6
TOOLS_WITH_OUTPUT_SCHEMA=6
DEGENERATE_DESCRIPTION_FLAGS=0
TAUTOLOGICAL_DESCRIPTION_FLAGS=0
UNDOCUMENTED_PARAMETER_FINDINGS=0
TDQS_LINT_ERRORS=0
TDQS_LINT_WARNINGS=3_COST_ONLY_SHADOW_CANDIDATES
TDQS_LINT_NOTES=0
```

TDQS v1.2 deterministically emits one cost-only shadow candidate for every tool
whose required-input cost is at least twice a sibling and differs by at least
four. It does not inspect descriptions when generating these candidates and
states that only model-graded coherence can determine whether purposes overlap.
The three candidates and their truthful resolution are:

1. company graph versus web context: entity-wide synthesis versus exactly one
   URL;
2. document evidence versus service health: document extraction versus status
   only; and
3. verify output versus company graph: evaluation of supplied material versus
   gathering company evidence.

The warnings remain visible and unpatched; `tdqs:lint` fails on deterministic
errors, not on this deliberately conservative prefilter.

## Required model-graded report

The following values are intentionally not guessed:

| Tool                               | Purpose clarity | Usage guidelines | Behavioral transparency | Parameter semantics | Conciseness/structure | Contextual completeness | TDQS score | Tier       | Smells     |
| ---------------------------------- | --------------- | ---------------- | ----------------------- | ------------------- | --------------------- | ----------------------- | ---------- | ---------- | ---------- |
| `siteborne_company_evidence_graph` | NOT_SCORED      | NOT_SCORED       | NOT_SCORED              | NOT_SCORED          | NOT_SCORED            | NOT_SCORED              | NOT_SCORED | NOT_SCORED | NOT_SCORED |
| `siteborne_web_context_verified`   | NOT_SCORED      | NOT_SCORED       | NOT_SCORED              | NOT_SCORED          | NOT_SCORED            | NOT_SCORED              | NOT_SCORED | NOT_SCORED | NOT_SCORED |
| `siteborne_document_evidence_json` | NOT_SCORED      | NOT_SCORED       | NOT_SCORED              | NOT_SCORED          | NOT_SCORED            | NOT_SCORED              | NOT_SCORED | NOT_SCORED | NOT_SCORED |
| `siteborne_verify_agent_output`    | NOT_SCORED      | NOT_SCORED       | NOT_SCORED              | NOT_SCORED          | NOT_SCORED            | NOT_SCORED              | NOT_SCORED | NOT_SCORED | NOT_SCORED |
| `siteborne_get_quote`              | NOT_SCORED      | NOT_SCORED       | NOT_SCORED              | NOT_SCORED          | NOT_SCORED            | NOT_SCORED              | NOT_SCORED | NOT_SCORED | NOT_SCORED |
| `siteborne_get_service_health`     | NOT_SCORED      | NOT_SCORED       | NOT_SCORED              | NOT_SCORED          | NOT_SCORED            | NOT_SCORED              | NOT_SCORED | NOT_SCORED | NOT_SCORED |

```text
DISAMBIGUATION=NOT_SCORED_MISSING_TDQS_LLM_ENDPOINT
NAMING_CONSISTENCY=NOT_SCORED_MISSING_TDQS_LLM_ENDPOINT
TOOL_COUNT_APPROPRIATENESS=NOT_SCORED_MISSING_TDQS_LLM_ENDPOINT
COMPLETENESS=NOT_SCORED_MISSING_TDQS_LLM_ENDPOINT
EVERY_TOOL_TIER_A=NOT_PROVEN
SERVER_DESCRIPTION_QUALITY_TIER_A=NOT_PROVEN
SERVER_COHERENCE_TIER_AT_LEAST_B=NOT_PROVEN
OVERALL_TIER_A=NOT_PROVEN
OVERALL_SCORE_AT_LEAST_4_0=NOT_PROVEN
USAGE_GUIDELINE_SMELLS=NOT_SCORED
TDQS_FULL_SCORE_COMMAND_EXIT=2_MISSING_ENDPOINT_CREDENTIALS
TDQS_HOSTED_PLAYGROUND=BLOCKED_REQUIRES_GITHUB_SIGN_IN
```

The next scorer run must use the generated file and an authorized credential:

```bash
cd packages/protocol-mcp
pnpm run build
node scripts/export-tdqs-tools.mjs /tmp/siteborne-tdqs-v1.2-tools-list.json
npx -y mcp-tdqs@0.1.0 score \
  --file /tmp/siteborne-tdqs-v1.2-tools-list.json \
  --fail-under A
```

No API key should be committed or printed. If one tool is below A, inspect its
exact justification, make one truthful metadata refinement, regenerate the
actual definitions, and rerun without altering provider/runtime logic.

## MCP regression and behavior invariants

`pnpm mcp:check` passed:

- protocol package: 78/78 tests in the normal configuration and 78/78 in the
  property configuration;
- edge MCP route: 7/7;
- stdio package: 1/1 plus metadata and packed-install checks;
- frozen spec fixture: protocol `2026-07-28`, three SDK pins, six tools; and
- TDQS metadata contract: 5/5.

```text
MCP_INITIALIZE_UNCHANGED=YES
MCP_TOOL_COUNT_UNCHANGED=6
MCP_TOOL_NAMES_UNCHANGED=YES
MCP_INPUT_SCHEMA_SEMANTICS_UNCHANGED=YES
MCP_OUTPUT_SCHEMA_SEMANTICS_UNCHANGED=YES
MCP_EXECUTION_BEHAVIOR_UNCHANGED=YES
MCP_PAYMENT_BEHAVIOR_UNCHANGED=YES
PRICE_CONFIGURATION_CHANGED=NO
PROVIDER_RUNTIME_LOGIC_CHANGED=NO
```

No Worker version was uploaded or deployed. No public or paid-runtime traffic,
variables, secrets, routes, preview policy, payment, provider, Workflow,
settlement, chain, or mTLS state changed.

## Final verification snapshot

The literal generated definitions were regenerated on 2026-09-12. Deterministic
TDQS v1.2 lint again returned 0 errors, 3 visible cost-only shadow warnings, and
0 notes. The required full command was also reattempted without credentials and
truthfully returned exit 2 with the message that `--base-url`, `--api-key`, and
`--model` (or their TDQS environment equivalents), or an authorized hosted
configuration, are required. Only `SET`/`MISSING` state was inspected; no secret
value was printed.

The same final worktree also passed repository typecheck (23/23 tasks), lint
(16/16 tasks), the full MCP check described above, the 13-file changed-scope
Prettier check, `git diff --check`, and the repository secret scan over 790
commits plus the working tree.
