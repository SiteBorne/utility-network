# Local Services (SUN-0600)

`packages/service-runtime` implements the four frozen v1 services locally,
composing SUN-0300 (provider adapters), SUN-0400A (document worker), and
SUN-0500 (verification mesh + receipts) — see
[ADR 0037](../decisions/0037-service-runtime-composition-boundary.md) for the
full composition boundary.

## Running a service directly

```ts
import {
  CompanyEvidenceGraphService,
  buildServiceContext,
  createTestClock,
  createTestArtifactStore,
  createTestServiceAuditSink,
} from '@siteborne/service-runtime';
import {
  SecSubmissionsAdapter,
  PublicHttpAdapter,
} from '@siteborne/provider-adapters';

const context = buildServiceContext('company_evidence_graph.v1', {
  clock: createTestClock(),
  artifact_store: createTestArtifactStore(),
  audit: createTestServiceAuditSink(),
  execution_mode: 'fixture', // never a real network/subprocess call in this mode
});

const service = new CompanyEvidenceGraphService({
  httpClient: myInjectedHttpClient,
  secSubmissions: new SecSubmissionsAdapter(
    myInjectedHttpClient,
    context.clock,
    context.artifact_store,
    myAdapterAuditSink
  ),
  publicHttp: new PublicHttpAdapter(
    myInjectedHttpClient,
    context.clock,
    context.artifact_store,
    myAdapterAuditSink
  ),
  signer: mySigner, // e.g. from generateTestKeypair() in @siteborne/verification
});

const result = await service.execute(
  { identifiers: { cik: '0000320193' } },
  context
);
```

## Running through the dispatcher/registry

```ts
import {
  buildFixtureRegistry,
  executeLocalService,
} from '@siteborne/service-runtime';

const registry = buildFixtureRegistry({ httpClient, context, worker, signer });
const result = await executeLocalService(
  registry,
  'company_evidence_graph.v1',
  input,
  context
);
```

`executeLocalService` is the pure/local application-service boundary — it never
creates a payment challenge, settles payment, invokes x402, dispatches a queue
job, or exposes a public paid route. A future control-plane integration calls
into this boundary after its own payment/state-machine gating; that wiring is
out of SUN-0600 scope.

## Per-service scope (this increment)

| Service                     | Implemented                                                                                               | Deferred/unimplemented (truthfully reported, never faked)                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `company_evidence_graph.v1` | `identity`, `sec_submissions`/`recent_filings` (SEC EDGAR), `website_evidence` (direct HTTP) field groups | `xbrl_facts`, `regulatory_mentions`, `public_repository_signals` — reported `unavailable` with a limitation                              |
| `web_context_verified.v1`   | `retrieval_mode: 'direct'`                                                                                | `retrieval_mode: 'rendered'` — `dependency_unavailable` (Browser Rendering is blocked_external), never faked via direct HTTP             |
| `document_evidence_json.v1` | `artifact_reference` input mode, native/OCR/table extraction via SUN-0400A                                | `upload_reference`/`document_url` input modes — `dependency_unavailable`                                                                 |
| `verify_agent_output.v1`    | `standard` and `independent_reproduction` modes; `schema_valid`/`hash_match` deterministic checks         | `signature_valid`/`evidence_resolves`/`no_pii`/`no_secrets` checks — reported as failed + `unverifiable_assertions`, never a silent pass |

## Commands

```bash
pnpm services-runtime:test              # unit + integration tests (incl. one real subprocess test, gated on the document-worker venv)
pnpm services-runtime:test:property     # fast-check property tests
pnpm services-runtime:fixtures:verify   # runs fixtures/SERVICE_FIXTURE_MATRIX.yaml scenarios against the real services
pnpm services-runtime:benchmark         # local timing benchmark, no network
pnpm services-runtime:check             # everything above, plus lint/typecheck/format
```

## See also

- [SERVICE_FIXTURES.md](SERVICE_FIXTURES.md)
- [SERVICE_PARTIAL_RESULTS.md](SERVICE_PARTIAL_RESULTS.md)
- [VERIFIED_ABSENCE.md](VERIFIED_ABSENCE.md)
