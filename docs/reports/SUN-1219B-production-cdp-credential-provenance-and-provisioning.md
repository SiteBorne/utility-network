# SITEBORNE Utility Network — SUN-1219B

## Fresh Production CDP Credential Provenance + Non-Deploying Provisioning

**Date:** 2026-08-24 **Classification:** blocked on manual Portal prerequisite —
mechanism research complete, no mutation. **Starting HEAD:**
`edf5bc03bd1a3b3fce0fed6953b10db77d137351` (working tree clean before and
after). **Ending HEAD:** unchanged — no source or config was modified by this
checkpoint.

Authoritative governance (established this conversation, see prior turn): this
conversation is the sole authoritative channel for SITEBORNE economic/mainnet
authorization from SUN-1219A onward. Cross-session decisions are
non-authoritative unless pasted verbatim, scoped by name, and accompanied by an
explicit supersession statement.

---

## 1. Starting reconciliation

```text
START_HEAD=edf5bc03bd1a3b3fce0fed6953b10db77d137351
WORKING_TREE=CLEAN
CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%
/health=200
/ready=200
12/12 paid REST routes=404
SUN1219B_START_PREFLIGHT=PASS (pnpm production:preflight, read live)
```

No deployment mutation occurred to establish this baseline.
`wrangler deployments status` confirms a single deployment:
`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%`, message "SUN-1219 restore
known-good after zero-traffic candidate qualification."

---

## 2. Manual Portal prerequisite — NOT satisfied

Per §3 of the SUN-1219B directive, the human must create the fresh
SITEBORNE-production-designated CDP credential in the Coinbase CDP Portal before
any provenance work can proceed, and must supply only non-secret facts about it
(project name/ID, key display name, creation timestamp, key type, intended
use/network, visible Portal mainnet-permission state, scope list, and the
provenance Yes/No checklist from §5 of the directive).

No such facts have been supplied in this conversation. No fresh Portal
credential has been reported as created.

```text
SUN1219B_PORTAL_PREREQUISITE=BLOCKED
NEW_PRODUCTION_CDP_CREDENTIAL_CREATED=NO
NEXT_MANUAL_ACTION=Create fresh SITEBORNE-production-designated CDP credential in Coinbase CDP Portal
```

Per the directive's §4, this is a hard stop. No workaround using the existing
sandbox-origin credentials was devised or considered as a substitute — Path C
(established in SUN-1219A, reinstated in its correction) remains governing:
`EXISTING_CDP_CREDENTIALS_PRODUCTION_APPROVED=NO`.

Sections 3–5 below cover the parts of this checkpoint that do **not** depend on
the credential existing — mechanism research and architecture selection —
completed now so that once the Portal step is done, no further investigation is
needed before the atomic candidate-freeze checkpoint.

---

## 3. Wrangler secret/version provisioning semantics — freshly re-proven

```text
$ npx wrangler --version
4.119.0
```

Re-read `--help` output directly from this pinned CLI (not memory) for every
relevant command:

**`wrangler secret put <key>`** (legacy) — top-level `wrangler secret` help
describes it as operating directly on "a Worker" (the live script), with no
version/deployment-scoping flags available. This is the pre-Versions-API
mechanism: it writes the secret to the Worker and takes effect on whatever is
currently deployed — i.e. it mutates the live, 100%-traffic
`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` deployment in place. **Not suitable** —
this is exactly the "silently mutate current production" failure mode §7 of the
directive prohibits.

**`wrangler versions secret put [key]`** — under `wrangler versions secret`,
described identically ("Create or update a secret variable for a Worker") but
scoped under the `versions` command family, accepting
`--name`/`--message`/`--tag` (version metadata flags, not deployment flags).
This creates a new Worker **version** containing the secret, with no
`deploy`/traffic-shift step — matches the established non-mutating pattern used
throughout SUN-1219 (`wrangler versions upload --dry-run`, then a separate
authorized `versions deploy`). Suitable as a mechanism, but see §5 below on
whether it should be used _now_.

**`wrangler versions upload [path] --secrets-file <file>`** —
`versions upload --help` documents `--secrets-file` directly: _"Path to a file
containing secrets to upload with the version (JSON or .env format). **Applies
additively with secrets from previous deployments - omitted secrets will not be
deleted.**"_ This is the single command already used for the SUN-1219 candidate
(code + `--var` route gates), extended to also carry secret values from a local
file. Creates exactly one new version. Does not deploy. Does not shift traffic.

| Mechanism                                        |                         Creates version | Deploys |                              Shifts traffic | New secret without exposing value to Claude |                         Suitable now |
| ------------------------------------------------ | --------------------------------------: | ------: | ------------------------------------------: | ------------------------------------------: | -----------------------------------: |
| `wrangler secret put <key>`                      | implicit (mutates live Worker in place) | **YES** | N/A (mutates current 100% version in place) |                      YES (operator-entered) |          **NO** — mutates production |
| `wrangler versions secret put <key>`             |                                     YES |      NO |                                          NO |  YES (operator-entered, interactive prompt) | Technically safe, but see §5 (YAGNI) |
| `wrangler versions upload --secrets-file <file>` |        YES (one, atomic with code+vars) |      NO |                                          NO |          YES (operator-authored local file) |                **YES — recommended** |

```text
WRANGLER_SECRET_PROVISIONING_SEMANTICS_RESOLVED=YES
```

---

## 4. Existing secret-binding preservation — resolved

The `--secrets-file` documentation quoted above states explicitly that it
"applies additively... omitted secrets will not be deleted." A secrets file
containing only the two fresh CDP entries (`CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET`) would leave the four other existing secrets
(`AGENT_CARD_SIGNING_PRIVATE_KEY`, `NVM_API_KEY`,
`PAID_RECEIPT_SIGNING_PRIVATE_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`) untouched and
preserved on the new version, without their plaintext ever being read,
displayed, or re-entered.

```text
EXISTING_SECRET_BINDINGS_CAN_BE_PRESERVED_WITHOUT_READING_VALUES=YES
```

This is authoritative CLI documentation for the pinned version in use this
session, not an inference from memory or an assumption carried from SUN-1215.

---

## 5. Architecture selection — atomic future candidate vs. standalone staging version

**`APPROACH_SECRET_ONLY_STAGING_VERSION`** (`wrangler versions secret put` run
now, before a real candidate exists): would create a throwaway Worker version
containing only the fresh CDP secret pair, with no route-gate `--var`s and no
ADR-0055 vars. That version would still need to be superseded by the real,
frozen, fully-configured mainnet candidate later — the secret values would
functionally need to be "re-entered" (via `--secrets-file`) into that later
atomic upload anyway, since `versions upload`'s own additive behavior means a
fresh candidate build naturally carries forward whatever secrets already exist
on the Worker, but the _code+vars+secrets_ freeze discipline established across
every prior SUN-1219 checkpoint treats each candidate as one coherent,
hash-frozen unit — splitting secret provisioning from that freeze adds an extra,
audit-noisy Worker version with no functional benefit and no rollback advantage.
This fails the YAGNI check in §7 of the directive.

**`APPROACH_ATOMIC_FUTURE_CANDIDATE`**
(`wrangler versions upload --secrets-file <file> --var ...`, run once, at the
point a real mainnet candidate is frozen and explicitly authorized): one
version, one hash-frozen bundle, code + candidate-only route gates +
explicitly-authorized ADR-0055 vars + fresh CDP secrets + the four preserved
existing secrets, all in a single atomic, non-deploying upload. Matches the
exact pattern already proven safe in SUN-1219 (§20 of that checkpoint).

```text
RECOMMENDED_PROVISIONING_ARCHITECTURE=ATOMIC_FUTURE_MAINNET_CANDIDATE
CLOUDFLARE_CREDENTIAL_MUTATION_NEEDED_NOW=NO
```

Fresh CDP credential values should stay operator-local (never entered in this
chat, never written to a file this session can read) until the future
mainnet-candidate-freeze checkpoint, at which point the operator supplies them
locally via a `--secrets-file` they create, use, and delete themselves — or via
non-echoing interactive stdin to `versions upload`/`versions secret put` if the
pinned CLI's `--secrets-file` flag turns out unsuitable at that time. No such
file exists in this repository or this session's scratchpad; none was created.

```text
WORKER_VERSIONS_CREATED=0 (this checkpoint)
```

---

## 6. Secret handling controls — confirmed, not exercised

No credential value was requested, entered, displayed, or handled at any point
in this checkpoint. Nothing here required exercising a 0600-file or
non-echo-stdin mechanism, since no credential exists yet to provision. The
mechanism is documented in §5 for future use, not executed now.

```text
NEW_CREDENTIAL_SECRET_VALUES_EXPOSED=NO
```

---

## 7. ADR-0055 — still fully unset

```text
PRODUCTION_CDP_CREDENTIALS_APPROVED_GATE_AUTHORIZED=NO
PAYMENT_ENVIRONMENT=<unset>
PRODUCTION_ENABLED=<unset>
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=<unset>
PRODUCTION_CDP_CREDENTIALS_APPROVED=<unset>
ADR0055_GATES_SET=0
```

---

## 8. Live-call accounting

No CDP call, no facilitator call, no Base mainnet call was made or attempted.

```text
LIVE_CDP_CALLS=0
LIVE_BASE_MAINNET_CALLS=0
CREDENTIAL_AUTHENTICATION_PROVEN=NO
LIVE_MAINNET_CAPABILITY_PROVEN=NO
```

---

## 9. Production containment — final

Re-verified live, immediately before writing this report (no mutating action
occurred between the starting check in §1 and this one, so no drift is possible,
but the read was repeated rather than assumed):

```text
/health=200
GET/POST all 12 paid REST routes=404
FINAL_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC=100%
SUN1219B_FINAL_PREFLIGHT=PASS (pnpm production:preflight, read live)
```

---

## 10. Next authorization boundary

The next required action is manual and outside this session: create the fresh
SITEBORNE-production-designated CDP Secret API Key in the Coinbase CDP Portal,
then report back the non-secret provenance facts listed in §3 of the SUN-1219B
directive (project name/ID, key display name, creation timestamp, key type,
intended network, visible Portal mainnet-permission state, scope list, and the
five-item Yes/No provenance checklist) — never the key ID or secret value
themselves.

Once that provenance is accepted, the next checkpoint after this one is the
mainnet-candidate-freeze checkpoint: one atomic
`wrangler versions upload --secrets-file ... --var ...` carrying the frozen
SUN-1218 source, the two route-exposure gates, the four ADR-0055 gates (only if
separately, explicitly authorized in exact-wording form), and the fresh +
preserved secrets — followed by the same freeze → dry-run → hard-stop →
single-upload discipline already established.

```text
MAINNET_CANDIDATE_PREPARATION_ELIGIBLE=NO (blocked on Portal step)
NEXT_ACTION_REQUIRES_EXPLICIT_HUMAN_AUTHORIZATION=YES
```

---

## Amendment 1 — existing key selected; provenance re-evaluation; auth-path research

This amendment supersedes the "blocked on fresh credential creation" framing
above. It does not delete or rewrite that history — the Portal-provenance
requirement stated earlier was the correct requirement _at the time_, given what
the record then showed. The user has since made a new, explicit, in-conversation
decision that changes which credential this checkpoint evaluates. Per the
authorization-authority governance rule adopted earlier this conversation, an
explicit in-conversation decision is authoritative on its own terms; it does not
need external justification to be honored.

### 21. Selected credential

```text
EXISTING_CDP_KEY_SELECTED_FOR_PRODUCTION=YES
SELECTED_PRODUCTION_CDP_KEY=siteborne-x402-facilitator
SELECTED_KEY_DISPLAY_NAME=siteborne-x402-facilitator
SELECTED_KEY_ALGORITHM=Ed25519
SELECTED_KEY_STATUS=Enabled
SELECTED_KEY_PORTFOLIO=Primary
SELECTED_KEY_PERMISSION_DISPLAY="Trade - View"
SELECTED_KEY_CREATED_AT=2026-08-10 17:02
```

The full key ID and secret value are intentionally not recorded here or anywhere
in this repository. `KEY_ID_DISPLAY=f3058d…c384c` is a truncated Portal display
value, not independently verifiable against the live Cloudflare `CDP_API_KEY_ID`
secret without reading that secret's plaintext — which this checkpoint continues
to refuse to do. The identification of this key as "the existing production CDP
key" rests on the user's own Portal access and explicit statement, which is the
correct authority for that fact.

### 22. Re-evaluating "sandbox-origin" — three distinct questions

The earlier SUN-1200 / SUN-1219A analysis used the shorthand "sandbox-origin"
for this credential. That shorthand conflated three separate questions. Kept
apart, with what is and is not actually known:

**(1) Credential creation / provenance.** Portal metadata now available: created
2026-08-10, algorithm Ed25519, portfolio "Primary", permission display "Trade -
View", status Enabled. Nothing in this metadata says the key was created "for
sandbox" or "for mainnet" — Portal API-key metadata does not carry a
network-scope field at all (confirmed by SDK/API surface inspection below). The
only _evidence_ of intent found anywhere in this repository is usage history,
not a Portal-recorded creation intent.

**(2) Network the credential was historically exercised against.** The one
concrete usage record this repository holds is `SUN-0700B checkpoint 2`
(`apps/edge-api/tests/live/x402-live-upto.test.ts`,
`apps/edge-api/tests/live/x402-live-exact.test.ts`,
`apps/edge-api/tests/live/x402-live-exact-v2.test.ts`), a guarded live-CDP proof
suite (`RUN_LIVE_X402=1`-gated, skipped by default) that ran the full
verify/settle path against Base **Sepolia** only — the network is hardcoded in
that suite (`baseSepolia` from `viem/chains`). This establishes that the
credential _was used_ on Sepolia in that checkpoint. It does not establish that
Sepolia is the only network it is capable of or authorized for.

**(3) Actual technical/authorization restriction.** Re-inspected fresh this turn
(not relying on the earlier SUN-1219A summary alone):

- CDP Secret API Keys (`apiKeyId`/`apiKeySecret`) authenticate at the
  **Project** level. Nothing in `@coinbase/cdp-sdk`'s account or facilitator
  APIs takes a "sandbox key" vs "mainnet key" type — there is one key type.
- `CdpClient.evm.getAccount({ address })` takes no network parameter — EVM
  accounts are network-agnostic; network is selected per _operation_ (a
  transfer, a facilitator call, a chain read), not baked into the account or the
  key.
- The x402 facilitator client SITEBORNE uses (`createCdpFacilitatorClient` from
  `@coinbase/cdp-sdk/x402`, see §23) is likewise constructed from
  `{ apiKeyId, apiKeySecret }` alone — no network argument at construction time.
  Network is a parameter of individual facilitator calls
  (`verify`/`settle`/`getSupported` filtering), not a property of the client or
  key.
- No file in this repository, the installed CDP SDK, or its type definitions
  declares or exposes a Portal-side "network restriction" field on a Secret API
  Key. If Coinbase enforces any such restriction, it is enforced
  Portal-side/server-side and is not visible from static inspection — it can
  only be observed by an authenticated call.

**Conclusion:** historical Base-Sepolia use is a fact about how the credential
was exercised in one prior checkpoint, not a fact about what the credential is
restricted to. Representing "used on Sepolia before" as "is Sepolia-only" would
be an unsupported inference this checkpoint declines to make.

```text
HISTORICAL_SEPOLIA_USE_IMPLIES_SEPOLIA_ONLY=NO
CDP_KEY_NETWORK_RESTRICTION=NOT_EXPRESSED_AT_SDK_OR_KEY_LEVEL — Project-scoped
  Secret API Key; network is a per-call parameter, not a key attribute; any
  Portal-side network allowlisting (if it exists) is not visible without an
  authenticated call
```

### 23. Existing JWT / facilitator auth construction path (re-used, not re-invented)

Grepped fresh this turn. SITEBORNE's production code does **not** hand-roll CDP
JWT construction. The full chain:

- `apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts:39`
  — `import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402'`
- same file,
  `createFacilitatorClient: () => createCdpFacilitatorClient({ apiKeyId: env.CDP_API_KEY_ID, apiKeySecret: env.CDP_API_KEY_SECRET })`
  — this is the _only_ place production code constructs a facilitator client,
  and it uses the official Coinbase SDK helper, not a custom implementation.
- `apps/edge-api/src/control-plane/evidence/cdp-provider.ts` consumes that
  client as `HTTPFacilitatorClient` (from `@x402/core/server`) for
  `verify()`/`settle()`, and separately exports
  `checkCdpSupportsNetwork(facilitator, network, requiredSchemes)` (same file,
  ~line 274), whose own doc comment reads: _"The first, and only gating, live
  call this checkpoint makes before any activation decision or payment
  attempt... Never throws for an ordinary 'not supported' outcome — that's
  `ok: false` with a reason."_ This function already exists, is already
  unit-tested (`apps/edge-api/tests/cdp-provider.test.ts`), and was
  purpose-built in an earlier checkpoint for exactly the kind of single,
  bounded, non-payment readiness call this amendment is being asked to scope. It
  calls `facilitator.getSupported()` internally — the SDK-level equivalent of
  `GET /platform/v2/x402/supported` — and nothing else.
- It is **not currently wired into any live route or the production
  composition** — its only callers today are the guarded live tests
  (`tests/live/x402-live-*.test.ts`) and its own unit test. Using it for a real
  validation call would mean invoking it directly (e.g. from a local, human-run
  Node/Vitest process, the same way `SUN-0700B` did), not adding a new
  production code path.

```text
EXISTING_AUTH_IMPLEMENTATION_FOUND=YES — createCdpFacilitatorClient (@coinbase/cdp-sdk/x402), official SDK, not custom
EXISTING_SUPPORTED_CHECK_FOUND=YES — checkCdpSupportsNetwork() in cdp-provider.ts, already unit-tested, not wired into any route
X402_FACILITATOR_AUTH_COMPATIBLE=UNPROVEN — proven end-to-end on Base Sepolia in SUN-0700B; never exercised against Base mainnet; never exercised under the `siteborne-x402-facilitator` Portal identity specifically
READ_ONLY_SUPPORTED_ENDPOINT_VALIDATION_READY=YES — checkCdpSupportsNetwork() is the exact, already-built, already-tested function for this call
```

### 24. Two ways to make the one validation call, and which avoids secret exposure

**Option 1 — local Node/Vitest run, same shape as SUN-0700B.** The user (or a
locally-run script) sets `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` in a local,
untracked env file, and calls `createCdpFacilitatorClient` +
`checkCdpSupportsNetwork` directly, printing only `{ ok, reason, kinds }`
(non-secret). This reuses proven code but requires the credential value to exist
in _some_ local shell/env — never pasted to Claude, but not sourced from the
Cloudflare-bound secret either (a second, parallel copy of the same value would
need to be typed in locally).

**Option 2 — exercise the Cloudflare-bound secret in place, without ever reading
it.** Because `env.CDP_API_KEY_ID` / `env.CDP_API_KEY_SECRET` are already bound
as Cloudflare secrets on the current Worker, a narrowly-scoped, read-only
diagnostic path (invoked only via an explicit version override, 0% traffic, no
route exposure change) could call `checkCdpSupportsNetwork` using those
_existing_ bindings and return only a redacted summary (e.g.
`{ ok: boolean, hasMainnetUpto: boolean }`) — no facilitator response body, no
address, no key material. The secret plaintext would never leave Cloudflare's
execution boundary and would never be read, printed, or seen by Claude at any
point. This is the option that best satisfies "preserves secret confidentiality"
as stated in the directive, because it removes the local-copy problem in Option
1 entirely.

Option 2 requires writing and freezing a small amount of new code (a diagnostic
handler), which is a runtime change and therefore its own scoped,
separately-authorized step — it is not "no runtime redesign," so it is not
something this checkpoint performs unilaterally.

```text
VALIDATION_REQUIRES_SECRET_VALUE_EXPOSURE=NO (if Option 2 is used — the Cloudflare secret is exercised in place, never read/printed)
VALIDATION_REQUIRES_SECRET_VALUE_EXPOSURE=YES-TO-LOCAL-SHELL-ONLY, NO-TO-CLAUDE (if Option 1 is used)
RECOMMENDED_VALIDATION_MECHANISM=OPTION_2 — small read-only diagnostic handler, 0%-traffic version override, redacted boolean result only; requires its own explicit authorization before being written
```

### 25. Amendment status

```text
SUN1219B_PROVENANCE_REEVALUATION=COMPLETE
SELECTED_PRODUCTION_CDP_KEY=siteborne-x402-facilitator
HISTORICAL_SEPOLIA_USE_IMPLIES_SEPOLIA_ONLY=NO
CDP_KEY_NETWORK_RESTRICTION=NOT_EXPRESSED_AT_SDK_OR_KEY_LEVEL (Portal-side restriction, if any, unobservable without an authenticated call)
X402_FACILITATOR_AUTH_COMPATIBLE=UNPROVEN
READ_ONLY_SUPPORTED_ENDPOINT_VALIDATION_READY=YES
VALIDATION_REQUIRES_SECRET_VALUE_EXPOSURE=NO (via recommended Option 2)

ADR0055_GATES_SET=0
LIVE_CDP_CALLS=0
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
REAL_PAYMENT_MATERIAL_SENT=NO
```

---

## Amendment 2 — diagnostic implementation (source + tests only; no upload)

Authorized: a narrowly scoped, temporary, single-gated diagnostic that exercises
the already-bound `siteborne-x402-facilitator` credential's
`/platform/v2/x402/supported` capability without exposing its plaintext value to
the operator or to Claude.

### Design implemented

- **New route module**:
  [`apps/edge-api/src/control-plane/routes/production-cdp-x402-support-diagnostic-route.ts`](../../apps/edge-api/src/control-plane/routes/production-cdp-x402-support-diagnostic-route.ts).
  Reuses, unmodified: `createCdpFacilitatorClient` from `@coinbase/cdp-sdk/x402`
  (the same official-SDK factory the real production route already uses) and
  `checkCdpSupportsNetwork` from `../evidence/cdp-provider` — an existing,
  already-unit-tested function that had no production call site before this
  checkpoint. **No second CDP authentication implementation was created.**
- **New gate**: `CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED` (exact literal `'true'`),
  added to `Env` in
  [`apps/edge-api/src/control-plane/config/env.ts`](../../apps/edge-api/src/control-plane/config/env.ts).
  Single-gated, deliberately independent of `PAID_ROUTES_ENABLED` and
  `VERIFY_V2_CDP_ROUTE_ENABLED` — neither enables nor is required by this route.
  Absent/unset (current state everywhere, including production) →
  `c.notFound()`, zero dependency construction.
- **Mounting**: `GET /diagnostics/cdp-x402-supported`, wired in
  [`apps/edge-api/src/index.ts`](../../apps/edge-api/src/index.ts) on its own
  path, outside `/v1/*` and `/v2/*` — no interaction with either wildcard's
  kill-switch semantics.
- **Response shape** (redacted):
  `{ ok, authentication_succeeded, base_mainnet_supported }` on success; the
  same three fields plus a single fixed string
  `error: "diagnostic provider call failed"` on any provider/authentication
  failure — never the raw error, `kinds` list, `uptoFacilitatorAddress`,
  credential identifiers, headers, or JWTs.
- **Structural containment**: this module imports nothing from
  `x402-service.ts`, `production-paid-services.ts`,
  `verify-agent-output-v2-cdp-composition.ts`, `buildProductionSigner`, or any
  receipt/signer/executor module. Its only external call is
  `facilitator.getSupported()`. It cannot call `verify`, `settle`,
  `CdpClient.evm.getAccount`, execute a service, or invoke the paid-receipt
  signer — those capabilities are not imported, referenced, or reachable from
  this file at all.

### Tests (written first; all reused/extended the existing route-test pattern)

[`production-cdp-x402-support-diagnostic-route.test.ts`](../../apps/edge-api/src/control-plane/routes/production-cdp-x402-support-diagnostic-route.test.ts)
— 9 tests, all passing:

1. gate absent → 404, zero facilitator construction
2. gate present but not the exact literal `'true'` → 404
3. `PAID_ROUTES_ENABLED`+`VERIFY_V2_CDP_ROUTE_ENABLED` alone (diagnostic gate
   absent) → 404 — proves no reuse of either flag as authorization
4. gate true + facilitator advertises Base mainnet `upto` → redacted 200,
   `base_mainnet_supported=true`
5. gate true + facilitator does not advertise Base mainnet → redacted 200,
   `authentication_succeeded=true`, `base_mainnet_supported=false`
6. provider throws (mocked
   `Unauthorized: ... Bearer ... rejected for key cdp-key-id`) → 502, fixed
   sanitized string only; asserted the response body never contains
   `cdp-key-id`, `Bearer`, or `Authorization`
7. missing CDP credentials → 503, zero facilitator construction
8. success-path response contains exactly the three redacted keys — no `kinds`,
   `facilitatorAddress`, or credential fields
9. structural: the mocked facilitator's `verify`/`settle` throw immediately if
   ever called; every reachable branch in this file passes without triggering
   that throw

### Local qualification (fresh, this checkpoint)

```text
pnpm lint          -> PASS (16/16 tasks)
pnpm typecheck     -> PASS (23/23 tasks)
pnpm test          -> PASS (2180 passed, 35 skipped, 0 failed -- +9 vs SUN-1219B baseline, exactly the new file)
pnpm test:worker-runtime -> PASS (88/88 scenarios; Phase 8 States A-D unchanged;
                      new route module confirmed present in the real dry-run
                      bundle without altering any existing route's disposition)
pnpm production:preflight -> PASS
pnpm secrets:scan  -> PASS (no leaks; 0 credential values in any file)
```

### Zero cloud mutation (verified, not asserted)

```text
git status: 5 files touched (env.ts, index.ts, this report, +2 new route/test files) -- all local, none committed
HEAD: aec0e287494244a70b6c681065d7671f794e0df1 (unchanged -- source not yet committed)
wrangler deployments status: unchanged -- f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%,
  Created 2026-08-24T05:37:18.593Z, Message "SUN-1219 restore known-good..."
Live production /health: 200
Live production /diagnostics/cdp-x402-supported (workers.dev, no version override): 404
  -- confirms the new route exists only in local source; the currently
  deployed Worker version has never seen it.
```

### Final status

```text
SUN1219B_DIAGNOSTIC_IMPLEMENTATION_GATE=PASS

DIAGNOSTIC_SOURCE_READY=YES
DIAGNOSTIC_GATE_NAME=CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED
CHECK_CDP_SUPPORTS_NETWORK_REUSED=YES
NEW_CDP_AUTH_IMPLEMENTATION_CREATED=NO
DIAGNOSTIC_RESPONSE_REDACTED=YES

DIAGNOSTIC_CAN_CALL_VERIFY=NO
DIAGNOSTIC_CAN_CALL_SETTLE=NO
DIAGNOSTIC_CAN_CALL_GET_ACCOUNT=NO
DIAGNOSTIC_CAN_EXECUTE_SERVICE=NO
DIAGNOSTIC_CAN_EXECUTE_PAID_SIGNER=NO

CDP_SECRET_VALUES_EXPOSED=NO

ADR0055_GATES_SET=0

LIVE_CDP_CALLS=0
LIVE_BASE_MAINNET_CALLS=0

WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0

REAL_PAYMENT_MATERIAL_SENT=NO
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0

CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%

DIAGNOSTIC_CANDIDATE_UPLOAD_ELIGIBLE=YES
```

Source and tests are complete and locally qualified but **not committed and not
uploaded**. This checkpoint stops here per its own scope ("SOURCE + TEST
implementation only") and awaits explicit authorization to freeze/upload a
temporary diagnostic candidate — a `wrangler versions upload` that would create
one new Worker version (0% traffic, undeployed) carrying this diagnostic route
plus the gate set to `'true'`. That upload has not occurred. The live
`/supported` call itself has not occurred.

---

## Amendment 3 — Live diagnostic qualification: authentication and Base

mainnet support proven for `siteborne-x402-facilitator`

Dated 2026-08-24. This amendment records the single authorized live invocation
of the temporary diagnostic candidate against Coinbase's real CDP x402
supported-networks endpoint, using the production `CDP_API_KEY_ID` /
`CDP_API_KEY_SECRET` Cloudflare secrets bound to `siteborne-x402-facilitator`.
Every step below is command → actual output → authoritative read-back, run in
that order with no pre-written results.

### Diagnostic candidate identity

```text
DIAGNOSTIC_CANDIDATE_VERSION_ID=dd466fc8-8305-4cef-bf04-9a3c8a9658ad
DIAGNOSTIC_CANDIDATE_CREATED_AT=2026-08-24T13:45:55.879Z
AUTHORIZED_SOURCE_HEAD=40b05e01291f1a0d33cd4f8118a308c87ccfecf0
```

(Uploaded and identity-reconciled in the prior turn; unchanged here.)

### Temporary deployment and read-back

```bash
wrangler versions deploy \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 \
  dd466fc8-8305-4cef-bf04-9a3c8a9658ad@0 \
  --name siteborne-utility-edge \
  --message "SUN-1219B: temporary 100/0 diagnostic candidate qualification" -y
```

`wrangler deployments status` read-back confirmed exactly:

```text
(100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
(0%)   dd466fc8-8305-4cef-bf04-9a3c8a9658ad
```

`ZERO_TRAFFIC_DIAGNOSTIC_DEPLOYMENT_VERIFIED=YES`.

### Ordinary routing proof (no override)

`GET /health` (ray `a302d6cc9dd37be1`) and `GET /ready` (ray `a302d6d37db20f57`)
both attributed via `wrangler tail --format json` to
`scriptVersion.id=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`, `outcome=ok`,
`status=200`.

`ORDINARY_ROUTING_DURING_DIAGNOSTIC=KNOWN_GOOD`.

### Candidate attribution proof

`GET /health` with
`Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="dd466fc8-8305-4cef-bf04-9a3c8a9658ad"`
(ray `a302d7506af9b628`) attributed to
`scriptVersion.id=dd466fc8-8305-4cef-bf04-9a3c8a9658ad`, `outcome=ok`,
`status=200`, `exceptions=[]`.

`DIAGNOSTIC_CANDIDATE_OVERRIDE_ATTRIBUTION=PASS`.

### The one authorized live diagnostic invocation

```bash
curl -H 'Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="dd466fc8-8305-4cef-bf04-9a3c8a9658ad"' \
  https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/diagnostics/cdp-x402-supported
```

Ray `a302d7ae49f0b561`. HTTP `200`. Response headers contained only standard
Cloudflare/security headers (`content-type`, `x-content-type-options`,
`x-frame-options`, `referrer-policy`, `permissions-policy`, `nel`, `report-to`,
`cf-ray`, `alt-svc`) — no `Authorization` header, no JWT, no credential material
of any kind.

Redacted response body, verbatim and complete:

```json
{ "ok": true, "authentication_succeeded": true, "base_mainnet_supported": true }
```

`wrangler tail` telemetry for this ray:
`scriptVersion.id=dd466fc8-8305-4cef-bf04-9a3c8a9658ad`, `outcome=ok`,
`status=200`, `exceptions=[]`, `cpuTime=15ms`, `wallTime=128ms`.

**Result classification** (per the authorization's literal rule):
`authentication_succeeded=true` AND `base_mainnet_supported=true` →

```text
CDP_X402_AUTHENTICATION_PROVEN=YES
BASE_MAINNET_X402_SUPPORT_PROVEN=YES
SELECTED_CDP_KEY_VALIDATION=PASS
```

This is the first genuine, live, tool-backed confirmation in the SUN-1219 chain
that the `siteborne-x402-facilitator` CDP credential (1) authenticates
successfully against Coinbase's real CDP platform, and (2) that facilitator
advertises support for Base mainnet (`eip155:8453`) with the `upto` scheme that
`verify_agent_output.v2/CDP` requires. It does **not** prove settlement, verify,
or account-lookup capability — those operations were never invoked and remain
unproven.

### CDP request accounting

```text
DIAGNOSTIC_ROUTE_INVOCATIONS=1
LIVE_CDP_SUPPORTED_CHECKS=1 (as observed at the SITEBORNE diagnostic-route
  boundary — exactly one inbound request reached
  GET /diagnostics/cdp-x402-supported, and exactly one call into
  checkCdpSupportsNetwork(...) followed from it in source).
```

Whether the CDP SDK's internal HTTP client issued exactly one outbound request
to Coinbase, or performed an internal retry, is **not independently observable**
from this vantage point — `wrangler tail` shows the inbound Worker
request/response pair and CPU/wall time, not the Worker's own sub-fetches to
`api.cdp.coinbase.com`. The total wall time (128ms) is consistent with a single
round trip and inconsistent with a multi-second retry-with-backoff sequence, but
this is a plausibility inference, not a proof of exactly-one-outbound-request.
No source change was made to instrument this further, per the authorization's
explicit instruction not to widen scope.

```text
SELLER_ACCOUNT_LOOKUPS=0
VERIFY_CALLS=0
SETTLE_CALLS=0
```

These are proven `0` structurally — the diagnostic route's only import from
CDP-related modules is `createCdpFacilitatorClient` and
`checkCdpSupportsNetwork`, and `checkCdpSupportsNetwork` only calls
`facilitator.getSupported()`. There is no code path in the diagnostic route
capable of invoking `verify`, `settle`, or `CdpClient.evm.getAccount(...)`.

### Secret boundary

```text
CDP_SECRET_VALUES_EXPOSED=NO
CDP_KEY_ID_EXPOSED=NO
JWT_EXPOSED=NO
AUTHORIZATION_HEADER_EXPOSED=NO
```

Confirmed by direct inspection of the captured response headers and body above
(Amendment reproduces the literal, complete body — nothing was elided because
nothing sensitive was present in it).

### Ordinary routing recheck and mandatory restoration

`GET /health` without override (ray `a302d84959db0d70`) — sent before
restoration — attributed to known-good `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`
via response inspection (production `/health` continued answering normally
throughout; full tail correlation for this specific ray was superseded by the
post-restoration correlation below, which independently proves the same
invariant).

Restoration executed:

```bash
wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 \
  --name siteborne-utility-edge \
  --message "SUN-1219B: restore known-good-only after diagnostic qualification" -y
```

`wrangler deployments status` read-back confirmed exactly one deployed version:
`(100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`. The diagnostic candidate is no
longer part of the active deployment.

`SUN1219B_DIAGNOSTIC_RESTORATION=PASS`.

### Post-restoration attribution

Ordinary `GET /health` (ray `a302d906dd3090ea`) and a **stale** candidate
override `GET /health` (ray `a302d9076db7e1d2`, still carrying the
`Cloudflare-Workers-Version-Overrides` header for `dd466fc8...`) both attributed
via tail to `scriptVersion.id=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`, confirming
the override no longer executes the removed candidate.

`POST_DIAGNOSTIC_ATTRIBUTION=PASS`.

### Final production containment

```text
CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%

GET /diagnostics/cdp-x402-supported (ordinary, no override) → 404
12/12 paid REST routes → 404 (GET and POST checked on all 7 grouped
  endpoints covering all 12 documented route/method pairs)

pnpm production:preflight → PASS
```

`SUN1219B_POST_DIAGNOSTIC_PREFLIGHT=PASS`.

### Candidate-attributed telemetry summary

```text
Candidate-attributed events captured: 2
  (1 attribution /health request + 1 diagnostic invocation)
Status distribution: {200: 2}
Outcomes: {ok: 2}
Exceptions: 0
UNHANDLED_EXCEPTIONS=0
REQUEST_RUNTIME_EVAL_FAILURES=0
CPU max: 15ms
Wall max: 128ms
```

### Mutation accounting

```text
WORKER_VERSIONS_CREATED=0   (candidate already existed from prior turn)
DEPLOYMENTS=2                (temporary 100/0 + mandatory restoration)
MAX_DIAGNOSTIC_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0
FINAL_DIAGNOSTIC_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0
SECRET_ROTATIONS=0
NEW_SECRET_VALUES=0
ADR0055_GATES_SET=0
DIAGNOSTIC_ROUTE_INVOCATIONS=1
SELLER_ACCOUNT_LOOKUPS=0
VERIFY_CALLS=0
SETTLE_CALLS=0
REAL_PAYMENT_MATERIAL_SENT=NO
PAYMENT_SIGNATURES=0
SERVICE_EXECUTIONS=0
BOUND_SIGNER_EXECUTIONS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
```

### Result

```text
SUN1219B_LIVE_DIAGNOSTIC=PASS
SELECTED_CDP_KEY_VALIDATION=PASS
SELECTED_CDP_KEY_PRODUCTION_APPROVAL_ELIGIBLE=YES
```

This amendment is evidence only. It does not itself set any ADR-0055 gate, does
not approve `siteborne-x402-facilitator` for production, and does not create a
mainnet paid candidate — those remain separate, explicitly authorized future
actions. This report file is not committed as part of this amendment unless
separately authorized.
