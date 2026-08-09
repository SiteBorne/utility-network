# SITEBORNE Utility Network — ADR 0037: Local Service Runtime Composition Boundary (SUN-0600)

## Context

SUN-0600 implements the four frozen v1 services (`company_evidence_graph.v1`,
`web_context_verified.v1`, `document_evidence_json.v1`,
`verify_agent_output.v1`) as local, credential-independent orchestration that
composes already-accepted lower layers (SUN-0300 provider adapters, SUN-0400A
document worker, SUN-0500 verification mesh) rather than reimplementing any of
them.

## Decision

`packages/service-runtime` is organized as:

- `src/types.ts`, `src/context.ts` — the shared `LocalService<TInput, TOutput>`
  interface, closed `ServiceExecutionResult` union (mirroring the
  closed-result-union pattern from `provider-adapters`/`modal-worker`/
  `verification`), and `ServiceExecutionContext` (deliberately excludes payment
  secrets, signing private keys directly, provider credentials, arbitrary
  network clients, and arbitrary filesystem paths — only injected, bounded,
  already-authorized dependencies).
- `src/pcc/` — the single shared PCC document builder
  (`builder.ts::buildDraftDocument`) and the shared verify-and-sign step
  (`verify-and-sign.ts::verifyAndSign`, composing `@siteborne/verification`'s
  `runMesh`/`issueReceipt` directly — never a second verification engine).
- `src/claims/`, `src/evidence/` — deterministic claim/evidence construction
  utilities shared by every service.
- `src/registry.ts`, `src/dispatcher.ts` — the local service registry (unique
  IDs, `production_enabled: false` enforced at registration) and the pure/local
  execution dispatcher (`executeLocalService`), which never creates a payment
  challenge, settles payment, invokes x402, dispatches a queue job, or exposes a
  public paid route — this is strictly the local application-service boundary a
  future control-plane integration would call into after its own
  payment/state-machine gating.
- `src/services/<name>/` — one directory per service, each composing its
  specific lower-layer dependency:
  - `company-evidence/` calls `SecSubmissionsAdapter`/`PublicHttpAdapter`
    (SUN-0300) through their public `execute()` interface with an injected HTTP
    client, never reimplementing fetch/parse/policy logic.
  - `web-context/` calls `PublicHttpAdapter` (SUN-0300) for direct-mode
    retrieval only; rendered mode is explicitly deferred (ADR 0039).
  - `document-evidence/` calls SUN-0400A through `DocumentWorkerBridge`
    (`worker-bridge.ts`) — either the real `SubprocessDocumentWorkerBridge`
    (spawns `python -m modal_worker.local_runner`, the same Modal-independent
    CLI SUN-0400A ships) or, in fixture tests, a `FixtureDocumentWorkerBridge`
    replaying a `WorkerResult` actually captured from a real run of that CLI —
    never a hand-authored fake `WorkerResult`.
  - `agent-verification/` calls `@siteborne/verification`'s `runMesh`/
    `issueReceipt` directly via the shared `verifyAndSign` step, and
    additionally evaluates the buyer-supplied `verification_contract`
    (claims/deterministic requirements) against `candidate_output` itself — a
    distinct, per-request check from the mesh's own frozen-schema validation of
    this service's own output (see ADR 0039 for the `schema_valid`
    deterministic-check boundary).

Every service's `execute()` returns the closed `ServiceExecutionResult` union
and never throws to its caller — `dispatcher.ts::executeLocalService` converts
any escaping exception or total-budget timeout into a closed
`internal_error`/`execution_timeout` result, mirroring
`packages/verification/src/mesh.ts::runVerifier`'s pattern.

## Status

Accepted (SUN-0600).
