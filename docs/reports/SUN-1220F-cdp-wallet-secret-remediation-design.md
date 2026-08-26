# SUN-1220F — CDP Wallet-Secret remediation design (read-only / design only)

Date: 2026-08-25 Classification: design-only. Zero source changes, zero secret
provisioning, zero Worker versions, zero deployments, zero live CDP calls, zero
signing, zero funding, zero payment.

## 0. Starting state (carried forward, re-verified this checkpoint)

```
SUN1220E_ROOT_CAUSE_EVIDENCE_COMMIT_SHA = a866f5837f856f308cc4fbd7517159f6ece5c92d
SUN1220D_DIAGNOSTIC_TEARDOWN_COMMIT_SHA = d4f759210d722eb2dc2e15dbce0ae8b1b5a0f6ce
SIGN_TYPED_DATA_FAILURE_ROOT_CAUSE     = MISSING_CDP_WALLET_SECRET
FAILED_PIPELINE_STAGE                  = local_validation (getAuthHeaders, pre-network)
ROOT_CAUSE_PROVEN                      = YES
CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER = UNPROVEN
REMOTE_API_KEY_SIGNING_AUTHORIZATION   = UNPROVEN
CURRENT_PRODUCTION_VERSION             = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%
```

## §1 — Phase 1 freeze (completed before this design work)

- `git rev-parse HEAD` before evidence commit:
  `d4f759210d722eb2dc2e15dbce0ae8b1b5a0f6ce` (matched expected).
- Full text of `docs/reports/SUN-1220E-cdp-sign-typed-data-root-cause.md` read;
  confirmed literal preservation of `ROOT_CAUSE_PROVEN=YES`,
  `FAILED_PIPELINE_STAGE=local_validation`,
  `SIGN_TYPED_DATA_FAILURE_ROOT_CAUSE=MISSING_CDP_WALLET_SECRET`,
  `CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER=UNPROVEN`,
  `REMOTE_API_KEY_SIGNING_AUTHORIZATION` left honestly `UNPROVEN` (not asserted
  as denial).
- Report explains exactly the required chain: `signTypedData` → `getAuthHeaders`
  → `requiresWalletAuth` match on
  `POST /v2/evm/accounts/{address}/sign/typed-data` → missing `walletSecret` →
  `UserInputValidationError` thrown **before** any network request.

Secret-safety scan of the report:

```
SECRETS_SCAN = PASS  (gitleaks: "no leaks found", both history and working tree)
CDP_WALLET_SECRET_VALUES_IN_REPORT = 0
CDP_API_KEY_VALUES_IN_REPORT       = 0
X_WALLET_AUTH_VALUES_IN_REPORT     = 0
JWT_VALUES_IN_REPORT               = 0
SIGNATURE_VALUES_IN_REPORT         = 0
```

Fresh production containment (read-only, no Cloudflare mutation):

```
$ wrangler deployments status
Version(s): (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
```

```
GET /health -> 200 {"status":"ok",...}
12/12 paid REST routes -> 404 (with Content-Type: application/json; the
  same routes return 415 without a Content-Type header, from the global
  content-type middleware running before routing -- a request-format
  artifact, not evidence of a route being enabled)
pnpm production:preflight -> PASS (12/12 paid routes structurally
  unavailable; 6 secret names present; no economic/cutover vars bound)
```

```
CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC = 100%
PAID_ROUTES_404             = 12/12
PRODUCTION_PREFLIGHT         = PASS
```

## §3 — Evidence commit

```
$ git add docs/reports/SUN-1220E-cdp-sign-typed-data-root-cause.md
$ git commit -m "SUN-1220E: record missing CDP wallet-secret root cause"
[main a866f58] SUN-1220E: record missing CDP wallet-secret root cause
 1 file changed, 299 insertions(+)

$ git status --short
(empty -- clean)

$ git rev-parse HEAD
a866f5837f856f308cc4fbd7517159f6ece5c92d
```

```
SUN1220E_ROOT_CAUSE_EVIDENCE_COMMIT_SHA = a866f5837f856f308cc4fbd7517159f6ece5c92d
```

---

## Phase 2 — Prove the Wallet-Secret model (installed `@coinbase/cdp-sdk@1.55.0` source only)

### §3(Phase 2) — `walletSecret` trace

Read directly from `node_modules/.../@coinbase/cdp-sdk/src/auth/utils/http.ts`
and `.../src/auth/utils/jwt.ts` (installed, pinned version `1.55.0`, matching
`package.json`):

- `getAuthHeaders(options)`: always requires `apiKeyId`/`apiKeySecret` first
  (throws `UserInputValidationError` for any non-public operation if absent) and
  always sends `Authorization: Bearer <apiKey JWT>`. **Only after** that JWT is
  generated does it call `requiresWalletAuth(requestMethod, requestPath)`; if
  true and `options.walletSecret` is falsy, it throws the exact error observed
  in SUN-1220D:
  `"Wallet Secret not configured. Please set the CDP_WALLET_SECRET environment variable..."`.
- `requiresWalletAuth(method, path)` — literal regex/string match, no network
  call:
  ```
  (/\/(evm|solana)\/accounts/.test(path) ||
   path.includes("/spend-permissions") ||
   path.includes("/user-operations/prepare-and-send") ||
   path.includes("/embedded-wallet-api/") ||
   path.endsWith("/end-users") ||
   path.endsWith("/end-users/import") ||
   /\/end-users\/[^/]+\/evm$/.test(path) ||
   /\/end-users\/[^/]+\/evm-smart-account$/.test(path) ||
   /\/end-users\/[^/]+\/solana$/.test(path))
  && (method === "POST" || method === "DELETE" || method === "PUT")
  ```
- `generateWalletJwt({ walletSecret, requestMethod, requestHost, requestPath, requestData })`
  (in `jwt.ts`): builds one ES256 JWT whose only claims are
  `uris: ["METHOD host+path"]` and, if there's a body, `reqHash` (a hash of the
  sorted request body). It imports `walletSecret` as a base64 DER PKCS8 EC
  private key. **No account address, wallet ID, or network identifier ever
  appears as an input or claim.** The resulting `X-Wallet-Auth` header is
  attached alongside (not instead of) the API-key bearer JWT.

This directly answers the trace:

```
CDP_WALLET_SECRET_MODEL                                  = project
CDP_WALLET_SECRET_NETWORK_SCOPED                          = NO
CDP_WALLET_SECRET_ACCOUNT_SCOPED                          = NO
CDP_WALLET_SECRET_REQUIRED_FOR_READ_ONLY_GETS             = NO
CDP_WALLET_SECRET_REQUIRED_FOR_SIGN_TYPED_DATA            = YES
CDP_WALLET_SECRET_REQUIRED_FOR_OTHER_MUTATING_WALLET_APIS =
  every POST/DELETE/PUT under /evm/accounts/* or /solana/accounts/*
  (covers signTypedData, signMessage, signTransaction, sendTransaction,
  account creation/deletion, etc.), plus POST/DELETE/PUT under
  /spend-permissions, /user-operations/prepare-and-send,
  /embedded-wallet-api/, and the /end-users create/import/derive-EVM/
  derive-EVM-smart-account/derive-Solana endpoint family.
X_WALLET_AUTH_PURPOSE =
  a short-lived ES256 JWT proving possession of the CDP Project's Wallet
  Secret private key, bound to the exact request method+host+path (and a
  hash of the body when present) -- a second, independent
  request-authentication/anti-tampering factor layered on top of the
  API-key bearer JWT for a specific enumerated set of wallet-*mutating*
  endpoints. It is purely an HTTP-auth artifact; it is not, and does not
  produce, the on-chain EIP-712/EIP-3009 signature itself (CDP's
  server-side custody signs the actual payload after this header
  authenticates the request to do so).
```

`CDP_WALLET_SECRET_MODEL=project` (not `wallet`/`account`) is the honest label
here: the SDK's own mechanics use exactly one secret value per `CdpClient`
construction, applied identically to every account and every network the same
API-key identity can reach — there is no per-wallet or per-network variant of
this secret anywhere in the installed SDK's auth code.

### §4 — API key vs. Wallet Secret

```
CDP_API_KEY_AUTH_PURPOSE =
  Authenticates the caller/CDP-Project identity for every request (GET
  and mutating alike), via a Bearer JWT signed with apiKeySecret. Required
  for all non-public operations; evaluated first, unconditionally.

CDP_WALLET_SECRET_AUTH_PURPOSE =
  Supplies an additional X-Wallet-Auth header required only for the
  enumerated wallet-mutation endpoint family above, layered on top of
  (never instead of) the API-key bearer JWT.

API_KEY_AND_WALLET_SECRET_BOTH_REQUIRED_FOR_SIGNING = YES
```

Evidence: in `getAuthHeaders`, the `requiresWalletAuth` check and the
`X-Wallet-Auth` header assignment both live **inside** the `if (hasCredentials)`
block — i.e. only reachable after the API-key JWT was already generated. A
`walletSecret` supplied without `apiKeyId`/ `apiKeySecret` would never even
reach that check (the function throws for missing API-key credentials before it
looks at `walletSecret` at all, for any non-public path). Neither secret is a
substitute for the other; the SDK source proves both are simultaneously
mandatory for `signTypedData`.

### §5 — Does an authoritative Wallet Secret already exist?

```
CDP_WALLET_SECRET_ALREADY_BOUND_TO_WORKER = NO
```

Confirmed by: (a) `wrangler secret list` returning exactly 6 names, none of them
`CDP_WALLET_SECRET` (names-only, no values read — see `production:preflight`
output above); (b) `production-payment.ts`'s own `SUN-1200 checkpoint E` comment
documenting its deliberate removal; (c) `env.ts`'s `CDP_WALLET_SECRET?: string`
field being declared but never read anywhere in production source (`grep` found
only the declaration and two doc-comment mentions — zero live usages).

```
CDP_WALLET_SECRET_EXISTS_IN_CDP_PROJECT = UNPROVEN
```

This cannot be determined without either viewing Coinbase Portal state that this
session has no authenticated access to, or generating/rotating a value (a
mutating, unauthorized action). Per this checkpoint's own rule, that branch
stops here at `UNPROVEN` rather than being inferred from "not bound to the
Worker" (a Worker-binding absence proves nothing about whether a Wallet Secret
was ever generated for the underlying CDP Project — Coinbase does not expose a
"does a Wallet Secret exist" read endpoint distinct from attempting to use or
regenerate one).

### §6 — Acquisition path

Based on Coinbase's publicly documented CDP Wallet Secret product design (shown
once at creation time in the Portal, never re-displayable afterward; only a
regenerate/rotate action is offered for an existing project) — this is
external-product-behavior knowledge, not something the installed SDK's own
source proves, and is flagged as such:

```
CDP_WALLET_SECRET_ACQUISITION_MODEL = B
  (generate/rotate — Coinbase's documented product design does not offer
  "reveal an existing Wallet Secret's plaintext" (option A) for this
  secret type; if a value already exists for this Project but was never
  captured, rotation is the only path forward, and would look identical
  from this codebase's perspective to Project's-never-had-one.)

WALLET_SECRET_CREATION_OR_ROTATION_HAS_SECURITY_IMPACT = YES
  Rotation is Project-scoped (see §3(Phase 2)): it immediately invalidates
  the prior value for every future wallet-mutating request across the
  whole Project, for every account, not only the controlled buyer.

EXISTING_ACCOUNTS_AFFECTED_BY_ROTATION = NO
  Rotating the Wallet Secret does not touch account existence, addresses,
  keys, or custody (those are managed server-side by CDP independently of
  this authentication artifact). The impact is scoped entirely to future
  API-request *authorization*, not to any existing account's identity or
  funds. (Nuance: any *other* system still presenting the old Wallet
  Secret value for wallet-mutating calls in this same Project would start
  failing immediately upon rotation — worth checking before rotating, but
  this repository is not currently such a system, since it holds none
  today.)
```

### §7 — Least-privilege client design

Current production CDP call sites (exhaustive; confirmed by
`grep -rn "new CdpClient\|createCdpFacilitatorClient"` across
`apps/edge-api/src`, non-test files only):

1. `createCdpFacilitatorClient` (from `@coinbase/cdp-sdk/x402`), used once in
   `verify-agent-output-v2-cdp-composition.ts` for `.verify()`/ `.settle()`. Its
   own upstream type (`CdpFacilitatorClientArgs`) has **no `walletSecret`
   parameter at all** — structurally cannot receive one, with or without this
   checkpoint's changes.
2. `buildProductionCdpAccountLookupClientFactory` (in `production-payment.ts`) →
   `new CdpClient({apiKeyId, apiKeySecret})`, used for the read-only seller
   `evm.getAccount(...)` lookup. Its parameter type is
   `Pick<Env, 'CDP_API_KEY_ID' | 'CDP_API_KEY_SECRET'>` — structurally cannot
   forward a `walletSecret` today even though the underlying `CdpClient`
   constructor would accept one.

```
APPROACH_A (widen buildProductionCdpAccountLookupClientFactory's Pick<>
  to include CDP_WALLET_SECRET):
  - Blast radius: HIGH. The only existing call site for this factory is
    the unrelated read-only seller lookup; widening it hands that call
    site a signing-capable client it has no reason to hold, purely as a
    side effect of a future, unrelated diagnostic need.
  - Accidental signer reachability: a future edit to the read-only lookup
    path could invoke a mutating method without any new gate, since the
    capability would already be sitting on the client object it already
    holds.
  - Fail-closed: weaker — the only backstop would be the SDK's own
    UserInputValidationError, with no repository-level guard in front of
    it, and it would apply to a client also used for unrelated purposes.

APPROACH_B (new, separate factory -- e.g.
  `buildProductionCdpSigningClientFactory`, matching the existing
  `buildProductionCdp*ClientFactory` naming convention -- requiring
  CDP_API_KEY_ID + CDP_API_KEY_SECRET + CDP_WALLET_SECRET):
  - Blast radius: LOW. `walletSecret` is read/forwarded in exactly one
    new, purpose-built function; the two existing call sites
    (facilitator, lookup) remain byte-for-byte unchanged and structurally
    incapable of receiving it (compile-time enforced via their existing
    narrower Pick<>/type signatures).
  - Accidental signer reachability: only new, explicitly-authorized
    signing code can ever import/construct the new factory.
  - Fail-closed: the new factory can itself guard
    (`if (!bindings.CDP_WALLET_SECRET) throw ...`) *before* constructing
    any client, independent of and in addition to the SDK's own check --
    matching this repository's existing `checkProductionBindingsPresent`
    guard pattern.
  - Testability: zero changes needed to existing lookup/facilitator test
    suites (unchanged signatures); new unit tests target only the new
    factory in isolation.
  - Production bundle reachability: can be wired behind the same
    env-flag-gated-route pattern already proven end-to-end in SUN-1220D
    (`CDP_BUYER_SIGNER_CAPABILITY_DIAGNOSTIC_ENABLED`-style gate + route +
    factory usage, all removed together in one teardown commit, already
    demonstrated clean in this same checkpoint chain).

RECOMMENDED_CLIENT_ARCHITECTURE = B
```

### §8 — Env / secret contract design

```
PROPOSED_ENV_BINDING = CDP_WALLET_SECRET
```

**This field already exists** — `env.ts` line 26 already declares
`CDP_WALLET_SECRET?: string`, added at SUN-1200 checkpoint E specifically "so a
genuinely future wallet-write use case can still supply it without a further
`Env` change" (its own doc comment). It is declared but has zero live usages
anywhere in production source today (confirmed by grep). No `Env`-type change is
needed for this remediation — only a new factory function that actually reads
it, gated as in §7 Approach B.

```
PROPOSED_ENV_TYPE = CDP_WALLET_SECRET?: string   (already present, unchanged)

MISSING_WALLET_SECRET_SIGNING_BEHAVIOR =
  The new signing-capable factory (Approach B) should fail closed
  synchronously -- before constructing any client -- if
  bindings.CDP_WALLET_SECRET is absent/empty, as a repository-level
  guard independent of (and prior to) the SDK's own eventual
  UserInputValidationError. Existing read-only paths must remain
  completely unaffected by this field's presence or absence.

READ_ONLY_PATHS_REQUIRE_WALLET_SECRET = NO
```

(Directly proven in §3(Phase 2): `requiresWalletAuth` only ever matches
`POST`/`DELETE`/`PUT`; `GET` is categorically excluded by the SDK's own method
check, with no exception.)

### §9 — Production reachability design

```
RECOMMENDED_SIGNING_EXECUTION_LOCATION = C, with B as the precedented fallback

  Primary recommendation (C): a separate local/admin execution tool (a
  local script, run directly by the operator, e.g. via `pnpm tsx
  scripts/...`) that constructs a CDP signing client with
  operator-supplied credentials (env var / local mode-0600 file / secure
  prompt) and performs the one qualification signTypedData call entirely
  outside Cloudflare. This means CDP_WALLET_SECRET need never touch a
  Worker bundle, a Worker secret binding, a temporary candidate version,
  or a traffic split at all for what is fundamentally a one-time,
  operator-controlled *buyer*-side qualification action -- not a
  SITEBORNE production-service (seller-side) concern. Zero production
  bundle reachability risk, trivially provable by the field never
  appearing in any deployed Worker's secret list.

  Precedented fallback (B): repeat the exact pattern SUN-1220D already
  validated end-to-end -- a temporary, env-flag-gated diagnostic route
  inside a 0%-traffic candidate *version* of the same production Worker,
  fully torn down afterward. This has the advantage of reusing an
  already-proven attribution/containment/teardown methodology, at the
  cost of requiring CDP_WALLET_SECRET to be bound to the Worker (even if
  only transiently, on a 0%-traffic version) and one more full
  deploy/attribute/restore cycle.

  This is a genuine architecture choice, not a foregone conclusion --
  flagged here for explicit operator decision rather than silently
  picked, since it changes the shape of §15's future remediation
  sequence (a local-tool approach would not need STEP 4's "new temporary
  signer-diagnostic candidate" at all).

PERMANENT_BUYER_SIGNER_IN_PRODUCTION_WORKER_REQUIRED = NO
```

(True regardless of which of C/B is chosen for the one-time qualification step
-- SITEBORNE's permanent production Worker is the seller/service side and has no
legitimate reason to ever hold a standing buyer-signing capability.)

### §10 — Critical product-boundary check

```
CDP_WALLET_SECRET_PERMANENT_PRODUCTION_REQUIREMENT = NO
```

The production service's two real CDP call sites (facilitator
`.verify()`/`.settle()`, and the read-only seller `evm.getAccount(...)` lookup)
are both proven in §3(Phase 2)/§7 to never require `walletSecret` — one
structurally cannot accept it, the other is a `GET`. The controlled buyer
(`0x516F...cB99`) exists solely to qualify the first paid E2E as a test
counterparty; SITEBORNE-the-service never signs payments as a buyer in its
permanent product role. `CDP_WALLET_SECRET` should be designed and provisioned
as **temporary qualification infrastructure only** (matching the §9
recommendation above), not as a standing production requirement or a seventh
permanently-bound Worker secret.

---

## §11 — Secure provisioning design (not executed)

Re-evaluating the already-proven SITEBORNE workflow (documented and quoted
directly from `wrangler versions upload --help` in
`docs/reports/SUN-1219B-...md`, §3–4): `--secrets-file` "applies additively with
secrets from previous deployments — omitted secrets will not be deleted,"
accepting a local, operator-authored JSON/.env file this session never needs to
read or echo.

```
SAFE_WALLET_SECRET_PROVISIONING_PATH =
  If Approach B / execution location B is chosen: operator creates a
  local secrets file (mode 0600, outside the repo / gitignored, deleted
  immediately after use, e.g. under a scratch dir or a FIFO) containing
  only `CDP_WALLET_SECRET=<value>`, then a single
  `wrangler versions upload --secrets-file <file> --var ...` call
  (Claude never opens or prints the file's contents) creates one new,
  non-deploying version carrying the new secret additively alongside the
  six already-bound secrets.
  If execution location C is chosen: the value is supplied directly to
  the local script's own process environment or a local operator-held
  file, and never touches this repository, wrangler, or Cloudflare at
  all.

PLAINTEXT_SECRET_REQUIRED_IN_CHAT          = NO
PLAINTEXT_SECRET_REQUIRED_IN_REPO          = NO
PLAINTEXT_SECRET_REQUIRED_IN_WRANGLER_TOML = NO
PLAINTEXT_SECRET_REQUIRED_IN_SHELL_HISTORY = NO

NEW_IMMUTABLE_WORKER_VERSION_REQUIRED = YES if B is chosen; NO if C is chosen
```

## §12 — Secret preservation semantics

Already authoritatively proven (quoted directly from the pinned CLI's own
`--help` text in SUN-1219B, re-affirmed here without needing to re-derive it):

```
EXISTING_SECRET_VALUES_NEED_TO_BE_READ   = NO
ATOMIC_SEVENTH_SECRET_ADDITION_SUPPORTED = YES
```

A secrets-file containing only `CDP_WALLET_SECRET` would leave the six existing
secrets (`AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET`, `NVM_API_KEY`, `PAID_RECEIPT_SIGNING_PRIVATE_KEY`,
`PAID_RECEIPT_SIGNING_KEY_ID`) untouched and preserved on the new version, per
`versions upload --secrets-file`'s own documented additive semantics. Nothing
was mutated to re-confirm this — it is the same CLI behavior already quoted
verbatim from official `--help` output in SUN-1219B.

## §13 — Remediation implementation design (not implemented)

Smallest change set, assuming Approach B / execution location B:

1. No `Env` change (`CDP_WALLET_SECRET?: string` already exists).
2. New function in `production-payment.ts`, naming to match the existing
   convention:
   `buildProductionCdpSigningClientFactory(bindings: Pick<Env, 'CDP_API_KEY_ID' | 'CDP_API_KEY_SECRET' | 'CDP_WALLET_SECRET'>)`,
   guarding `if (!bindings.CDP_WALLET_SECRET) throw ...` before constructing
   `new CdpClient({ apiKeyId, apiKeySecret, walletSecret })`.
3. `buildProductionCdpAccountLookupClientFactory` and
   `createCdpFacilitatorClient` usage: unchanged, zero diff.
4. A future temporary, env-flag-gated diagnostic route (same shape as
   SUN-1220D's, same `CDP_BUYER_SIGNER_CAPABILITY_DIAGNOSTIC_ENABLED`-style gate
   or a freshly named successor) would import and call the new signing factory
   instead of constructing `CdpClient` inline.
5. No permanent production route ever calls the new factory; teardown removes
   the diagnostic route, its gate, and (if desired) the factory itself together,
   exactly as SUN-1220D's teardown already proved clean.

If execution location C is chosen instead, none of items 2–5 touch this
repository at all — the signing factory would live in a local script under (for
example) `scripts/`, not in `apps/edge-api/src`.

**Not implemented this checkpoint**, per explicit instruction.

## §14 — Test design (not implemented)

Enumerated coverage a future implementation checkpoint should add, one test per
bullet in the request's §14 list (A–P): ordinary read-only client construction
unaffected by `walletSecret`'s absence; new signing client fails closed (throws
before any CDP SDK call) when `CDP_WALLET_SECRET` is absent; new signing client
forwards `walletSecret` to the real SDK constructor only; the lookup and
facilitator factories' own type signatures/tests continue to prove they cannot
receive `walletSecret`; no log line, thrown-error message, or HTTP response body
anywhere ever contains the raw secret value; no report/test snapshot contains
it; no default or fallback value exists for the binding; no test double for it
is reachable from a production import path; the twelve-paid routes truth table
stays unaffected by the new factory's mere existence; and (mirroring SUN-1220D's
own mutation-proof pattern) a mutation proof that would catch either (i) the new
factory value leaking into logs/ errors, or (ii) a future diagnostic route +
gate surviving teardown into a later commit. No code for any of this was written
this checkpoint.

## §15 / §16 / §17 — Sequencing, honesty guardrails, funding gate

Carried forward verbatim, not re-authored:

```
WALLET_SECRET_REMEDIATION_EXPECTED_TO_CLEAR_LOCAL_VALIDATION = YES
WALLET_SECRET_REMEDIATION_GUARANTEES_REMOTE_SIGNING_SUCCESS  = NO
```

Even once `CDP_WALLET_SECRET` is correctly wired and bound,
`REMOTE_API_KEY_SIGNING_AUTHORIZATION` stays `UNPROVEN` until exactly one future
bounded, non-economic `signTypedData` call actually succeeds (or returns an
explicit, unambiguous remote-authorization error) — this checkpoint changes
nothing about that bar.

```
CURRENT_BUYER_USDC   = 0.01326
SERVICE_PRICE_USD    = 0.019
SHORTFALL_USDC       = 0.00574
BUYER_FUNDING_ACTIONS = 0
```

No funding action was taken, proposed for execution, or brought any closer to
authorization by this design checkpoint.

## §18 — Mutation accounting

```
SOURCE_FILES_CHANGED (production code) = 0
WORKER_VERSIONS_CREATED = 0
DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0
CDP_SECRET_MUTATIONS = 0
CDP_WALLET_SECRET_VALUES_READ = 0
CDP_WALLET_SECRET_VALUES_PRINTED = 0
LIVE_CDP_CALLS = 0
LIVE_SIGN_TYPED_DATA_CALLS = 0
PAYMENT_SIGNATURES_CREATED = 0
BUYER_FUNDING_ACTIONS = 0
LIVE_PAID_REQUESTS = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_ECONOMIC_EFFECTS = 0
```

(One documentation file, `docs/reports/SUN-1220E-...md`, was committed — that
mutation was explicitly authorized by §3 of this same checkpoint and is
accounted for above it, not counted against "source files changed.")
