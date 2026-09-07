# SUN-1222C-Q1R6 — Safe-Egress Header Propagation Fix & Deployment

## 0. Root cause (inherited from SUN-1222C-Q1R5)

`SecSubmissionsAdapter.fetchAndNormalize` correctly constructs the SEC-EDGAR-compliant
`User-Agent: SITEBORNE hello@siteborne.com` (SUN-1222C2-Q1-R1) and passes it via
`RequestInit.headers`. In production this request flows through `ModalSafeEgressClient`
(not a direct `fetch()`), which:

- never read `init.headers` at all, and
- POSTed a `WebctxFetchRequest` JSON body to the Modal executor that had **no field**
  for outgoing headers (`extra="forbid"` would have rejected one even if added
  one-sided).

The executor (`services/webctx-safe-egress/.../executor.py::_fetch_one_hop`)
additionally **hardcoded** its own `user-agent: SITEBORNE-webctx-safe-egress/1` on
every outbound request, unconditionally — a second, independent loss point even if the
first had been fixed alone.

Net effect: the real SEC EDGAR request in both prior Q1 paid attempts
(`pay_a750ea6da8ea479fa7660c2cf92a4378`, `pay_246c956277394be0aec72656322264d6`) never
carried the declared User-Agent, and SEC's own published Fair Access policy
(https://www.sec.gov/os/accessing-edgar-data) legitimately rejected it.

## 1. Header threat model

Outbound headers cross a security boundary between the Worker and the executor's own
IP-pinned, TLS-SNI-bound outbound connection. Default posture: fail-closed allowlist,
not a pass-through `Record<string,string>`.

**Allowlist** (scoped to proven, currently-exercised callers only):

| Header | Caller | Purpose |
|---|---|---|
| `user-agent` | `SecSubmissionsAdapter` | SEC EDGAR Fair Access declared-identity requirement |
| `if-none-match` | `PublicHttpAdapter` | conditional-GET / 304 pass-through (SUN-1222C-Q1R2) |
| `if-modified-since` | `PublicHttpAdapter` | conditional-GET / 304 pass-through (SUN-1222C-Q1R2) |

**Permanently denied by omission** (never added speculatively): `Authorization`,
`Cookie`, `Proxy-Authorization`, `Host`, `Connection`, `Transfer-Encoding`, `Upgrade`,
`Forwarded`/`X-Forwarded-*`, `Origin`, `Referer`, `Range`, `Sec-*`. None of these are
required by any current caller; each could leak credentials, override the executor's
own transport framing, or let a caller forge its IP-pinned/TLS-SNI connection
semantics.

The allowlist is enforced **independently on both sides** of the Worker↔Modal
boundary — the TypeScript client (`APPROVED_FORWARD_HEADERS`) and the Python schema
(`schemas.APPROVED_FORWARD_HEADERS`) — so a compromised or buggy Worker-side caller
cannot smuggle a denied header past the executor. `executor.py`'s
`_RESERVED_HEADER_KEYS` (`host`, `connection`, `accept-encoding`) is excluded from the
merge unconditionally, as a third, belt-and-suspenders layer.

Bounds (both sides, kept in exact sync): max 8 approved headers, max 64 bytes per
name, max 512 bytes per value, max 2048 bytes total (TS side only, redundant with
per-field bounds). Control characters (including CR/LF) in any key or value are
rejected before the request ever leaves the Worker.

## 2. Fix

- **`packages/provider-adapters/src/http/modal-safe-egress-client.ts`**:
  `extractApprovedHeaders()` normalizes `RequestInit.headers` via the platform's own
  `Headers` constructor (re-wrapping any platform-level rejection, e.g. an embedded
  CRLF, into the same `WEBCTX_URL_VALIDATION_FAILED` error class other validation
  failures use), filters to the allowlist, enforces bounds, and — only when non-empty —
  adds `approved_headers` to the JSON body sent to the executor. Omitted entirely (not
  `{}`) when no approved header is present, preserving the exact pre-fix wire shape for
  every caller that never sets one.
- **`services/webctx-safe-egress/src/webctx_safe_egress/schemas.py`**:
  `WebctxFetchRequest.approved_headers: dict[str, str]`, independently re-validated by
  a `field_validator` against the same allowlist, lowercase-only keys, the same
  bounds, and the same control-character rejection.
- **`services/webctx-safe-egress/src/webctx_safe_egress/executor.py`**:
  `_fetch_one_hop` merges `request.approved_headers` into its own default header set,
  letting an approved header **override** the executor's own default of the same name
  (e.g. `user-agent`), while `_RESERVED_HEADER_KEYS` remains non-overridable
  regardless.

## 3. RED → GREEN → mutation proof

**TypeScript** (`packages/provider-adapters/src/tests/modal-safe-egress-client-header-forwarding-gap.test.ts`,
13 tests): the pre-fix RED proof (SUN-1222C-Q1R5, a passing assertion that the gap
existed, asserting `approved_headers` was absent and no User-Agent string appeared
anywhere in the wire body) is preserved in git history at commit `33a51e1`; this
checkpoint rewrites the file into the permanent GREEN contract — User-Agent forwards,
both conditional-GET headers forward together, a non-allowlisted header is dropped
silently, seven distinct dangerous headers (`Authorization`, `Cookie`,
`Proxy-Authorization`, `Host`, `Connection`, `X-Forwarded-For`, `Origin`) are never
forwarded even when explicitly supplied, the no-header wire shape is byte-identical to
pre-fix, and both a CRLF-injection attempt and an oversized value are rejected before
`fetch` is ever called. Mutation proof: temporarily forcing `approvedHeaders = {}`
unconditionally caused exactly the 5 tests that depend on real forwarding to fail (the
other 8 — silent-drop / dangerous-header / no-header-shape tests — correctly continued
to pass, since they assert the *absence* of forwarding either way); reverted, full
27-test package-adjacent regression (`modal-safe-egress-client.test.ts` +
this file) back to green.

**Python** (`test_schemas.py` — 12 new tests; `test_executor.py` — 4 new tests):
schema-level tests cover acceptance of each allowlisted header, all three together,
rejection of a non-allowlisted key, 15 parametrized dangerous-header-name rejections,
uppercase-key rejection, CRLF-in-value and CRLF-in-key rejection, oversized-value
rejection, and too-many-headers rejection. Executor-level tests prove an approved
User-Agent actually overrides the hardcoded default in the real outbound header dict
passed to `fetch_pinned`, that omitting `approved_headers` preserves the old hardcoded
default exactly, that both conditional-GET headers reach the outbound request
together, and that `_RESERVED_HEADER_KEYS` cannot be overridden even if a reserved key
were somehow smuggled past the schema validator directly into `_fetch_one_hop`.
Mutation proof: temporarily disabling the header-merge line in `executor.py` caused
exactly the 2 tests that depend on override behavior to fail (2 unrelated tests in the
same class correctly continued to pass); reverted, full 116-test package suite back to
green.

Full monorepo regression after both fixes: **148 test files, 1703 tests, 0 failures,
78 skipped** (`pnpm exec vitest run` from repo root). Provider-adapters package
typecheck, lint (`eslint`), and the affected file's Python `ruff`/`mypy` all clean.

## 4. Deployment

Topology determined by call-site trace (not import graph), matching the
SUN-1222C-Q1-HOST-DEPLOY precedent: `SecSubmissionsAdapter`/`ModalSafeEgressClient`
are constructed and invoked exclusively inside `siteborne-paid-continuation-runtime`'s
`PaidContinuationWorkflow` — never from the public API Worker
(`siteborne-utility-edge`) directly, for either `company_evidence_graph.v2` or
`web_context_verified.v2` (both compositions are only referenced from Workflow-side
wiring). Public API Worker deployment was therefore **not required** and was not
performed.

- **Modal** (`siteborne-webctx-safe-egress`, app id `ap-Fpf9jp27SCcWMV533bUCsz`,
  unchanged — in-place code update, not a new app): `modal deploy -m
  webctx_safe_egress.app` from `services/webctx-safe-egress` (module mode, required
  because the package uses relative imports). Deployed cleanly; endpoint
  `https://siteborne--siteborne-webctx-safe-egress-fetch.modal.run` unchanged.
  `siteborne-document-worker` (the unrelated OCR app) untouched.
- **Workflow host** (`siteborne-paid-continuation-runtime`): `wrangler deploy
  --config wrangler.paid-continuation-runtime.toml`. Pre-deploy version
  `917c1c49-16fd-4c4d-b9d6-e54ad6f9ec80` (2026-09-07T17:53:02Z, the SUN-1222C-Q1-HOST-DEPLOY
  candidate) → post-deploy `e11304df-ea78-4082-8668-43f71c0eb8fa`
  (2026-09-07T20:28:37Z), 100%. Bindings/vars readback identical to pre-deploy
  (`PAID_CONTINUATION_WORKFLOW`, `DB`, `ARTIFACTS`, `SELLER_WALLET_ADDRESS`,
  `PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`,
  `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`, `PRODUCTION_CDP_CREDENTIALS_APPROVED`) —
  code-only change.
- **Public API Worker** (`siteborne-utility-edge`): confirmed unchanged before and
  after — `db7054c9-76ee-4830-aabe-8a4542261b6a` @ 100%,
  `a064477f-7b74-46c5-a5b6-799df114b252` @ 0%.

## 5. Non-economic live verification — not available for this gate

`company_evidence_graph.v2`'s SEC-calling code path is reachable **only** through the
paid `PaidContinuationWorkflow`; there is no separate non-economic trigger for it, and
this session holds no Modal `Modal-Key`/`Modal-Secret` proxy-auth credential values
(by design — secrets are read by name only throughout this engagement), so a direct
authenticated HTTP call to the Modal endpoint from this session is not possible
either. `LIVE_HEADER_PROPAGATION_PROVEN=NO` and `LIVE_SEC_REQUEST_OCCURRED=NOT_YET`
for that reason, not because of any doubt about the fix — full end-to-end proof is
necessarily deferred to the reconciliation of the next real paid attempt, exactly as
R1/R2/R3's rate-coordinator admission was only provable that way.

## 6. Current frozen economics (re-read, unchanged)

`packages/pricing/src/service-prices.ts`: `company_evidence_graph_v2: 0.0312` — read
through `resolveServiceMaxPriceUsd('company_evidence_graph_v2')` into
`REGISTRY_SERVICES['company_evidence_graph.v2']` via `withGovernedRegistryPrice`
(`packages/protocol-x402/src/bazaar/registry-source.ts`). No drift from every prior
checkpoint in this engagement.

- `COMPANY_V2_PRICE_USDC=0.0312`
- `COMPANY_V2_AMOUNT_ATOMIC=31200`
- `COMPANY_V2_NETWORK=eip155:8453`
- `COMPANY_V2_ASSET=0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913`
- `COMPANY_V2_PAY_TO=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`

Buyer `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99` balance re-read dual-RPC
(`mainnet.base.org`, `base.publicnode.com`): **79,727 atomic**, unchanged, sufficient.

## 7. Stop point

This checkpoint stops here per its own §32 human-signing boundary. No 402, EIP-3009
authorization, signature, or paid POST was created by the coding agent. The harness
(`pnpm company-evidence-first-paid-e2e`, retargeted in a prior checkpoint to candidate
`a064477f`) fetches its own fresh 402 atomically at run time; the operator performs the
one signing action and one paid POST themselves. Prior payment material
(`pay_a750ea6da8ea479fa7660c2cf92a4378`, `pay_246c956277394be0aec72656322264d6`) is
retired and will not be reused — the harness always requests a fresh nonce and
validity window.

## Final packet

```
SUN1222C_Q1R6_FIX_AND_QUALIFY=PARTIAL (fix+deploy complete; payment held for human action)
Q1R6_FIX_AUTHORIZATION=PRESENT
ROOT_CAUSE_PROVEN=YES
TS_HEADER_PROPAGATION_RED=YES (SUN-1222C-Q1R5, preserved in git history at 33a51e1)
PYTHON_HEADER_PROPAGATION_RED=YES (proven via mutation-revert this checkpoint)
TS_HEADER_PROPAGATION_GREEN=PASS (13/13)
PYTHON_HEADER_PROPAGATION_GREEN=PASS (34+4/38)
HEADER_PROPAGATION_MUTATION_PROOF=PASS (both sides)
SEC_MODAL_INTEGRATION_TEST=PASS (executor-level, real merge logic, mocked transport)
SAFE_EGRESS_SECURITY_REGRESSION=PASS (116/116 Python; 31 http-ssrf + 21 dns-rebinding TS)
COMPANY_GRAPH_LOCAL_E2E=PASS (composition + Workflow orchestration tests, 11/11)
EVIDENCE_MODE_TRUST_CLASS_REGRESSION=PASS (no change to that logic; full suite green)
POST_SETTLEMENT_GUARD_REGRESSION=PASS (no change to that logic; full suite green)
HEADER_FIX_COMMIT_SHA=63c62b4
MODAL_DEPLOY_REQUIRED=YES
WORKFLOW_HOST_DEPLOY_REQUIRED=YES
PUBLIC_API_DEPLOY_REQUIRED=NO
MODAL_DEPLOYMENTS=1
SITEBORNE_RUNTIME_DEPLOYMENTS=1
LIVE_HEADER_PROPAGATION_PROVEN=NO (no non-economic path exists; see §5)
LIVE_SEC_REQUEST_OCCURRED=NOT_YET
COMPANY_V2_PRICE_USDC=0.0312
COMPANY_V2_AMOUNT_ATOMIC=31200
BUYER_BALANCE_BEFORE_ATOMIC=79727
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
HUMAN_SIGNING_ACTIONS=0
REAL_PAID_POSTS=0
COMPANY_EVIDENCE_GRAPH_V2_LIVE_PAID_QUALIFIED=NO (awaiting the human payment action)
PUBLIC_TRAFFIC_MUTATIONS=0
Q1R6_EVIDENCE_COMMIT_SHA=<set by this file's own commit>
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-Q1R6 (resume at the human payment action; no new authorization needed — this one remains active until the checkpoint stops)
```
