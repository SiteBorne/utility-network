# SUN-1200 Checkpoint E — Production Credential Provisioning + Disabled Deployment

**Starting HEAD:** `5eeda09` **Classification:** capability complete, production
not activated — `SUN-1200` remains `BLOCKED_EXTERNAL — MARKET_DEMAND`

## Credential minimization result

Reconciled the production CDP credential surface directly against the installed
`@coinbase/cdp-sdk`'s own type definitions and doc comments (not assumed).
`createCdpFacilitatorClient`'s `CdpFacilitatorClientArgs` accepts only
`apiKeyId`/`apiKeySecret` — there is no `walletSecret` parameter on the
facilitator client at all. `CdpClient`'s own constructor doc comment states the
Wallet Secret "is used specifically to authenticate requests to POST, and DELETE
endpoints in the EVM and Solana Account APIs" — SITEBORNE's seller-identity
operation, `evm.getAccount(...)`, is a read (GET). Neither of this repository's
two real CDP SDK call sites needs it.

**`PRODUCTION_WALLET_SECRET_REQUIRED=false`** — `CDP_WALLET_SECRET` removed from
`checkProductionBindingsPresent`/`ProductionCdpProviderBindings`/
`buildProductionCdpAccountLookupClientFactory`'s required set;
`Env.CDP_WALLET_SECRET` made optional rather than deleted (a genuinely future
wallet-write use case can still supply it without a further `Env` change).
Committed separately (`9fd9702`) before credential provisioning began.

## Fresh CDP credential status — disclosed deviation

The checkpoint directive required fresh, never-previously-exposed production CDP
credentials. **The user explicitly overrode this**, stating intent to reuse
existing keys rather than create a separate fresh production credential set ("im
using same keys push im overriding this"). This is recorded truthfully as a
disclosed deviation from the directive, not silently accepted as compliant:
`FRESH_PRODUCTION_CDP_CREDENTIALS_PRESENT: false` — the provisioned
`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` are the user's own existing credentials,
not a newly-created, separately-scoped production key. This is the user's own
account and credential-management decision; it is disclosed here rather than
misrepresented.

## CDP read-only authentication + seller account reconciliation

Performed entirely by the user in their own shell (this agent has no access to
Cloudflare secret values — `wrangler secret list`/`versions secret list` return
names only, confirmed directly — and cannot construct a real `CdpClient`). Two
real, read-only calls were run:

- `cdp.evm.listAccounts()` — returned exactly two real accounts under the
  project: `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99` and
  `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`. (Both addresses happen to match
  this repository's own long-standing test fixture constants — `PAYER`/`SELLER`
  respectively — because those fixtures trace back to a real sandbox account
  pair used in an earlier accepted checkpoint's live-CDP proof; this is
  disclosed, not glossed over, since it was flagged and investigated live during
  this checkpoint before being resolved.)
- `cdp.evm.getAccount({ address: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1' })`,
  run twice — once incidentally, once with the address explicitly and
  deliberately set in the shell for a clean audit-trail record — both times
  returning `address === '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1'`.

The user explicitly confirmed `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1` as
the canonical `SELLER_WALLET_ADDRESS`/production `payTo`, and explicitly
confirmed `0x516F57e1...` is a historical controlled buyer/test payer that must
never be substituted as the seller. No account was created; `payTo` was not
otherwise changed. **`PRODUCTION_SELLER_ACCOUNT_RECONCILED=true`.**

No CDP facilitator `verify`, no `settle`, no signing, no transaction, no account
creation — confirmed both by the exact scripts run (`getAccount`/ `listAccounts`
only) and by this checkpoint's own economic-mutation accounting below.

## Cloudflare authentication

Fresh `wrangler login` OAuth grant (the user's own choice among the two
acceptable mechanisms this checkpoint allowed; the wider OAuth token scope is
what a standard `wrangler login` grants, not a narrowed API token — recorded
truthfully rather than claimed as least-privilege). `wrangler whoami` confirms:
account `Hello@siteborne.com's Account` (`29a264a25ccfd13882defe49ed3e17b1`),
email `hello@siteborne.com`.

## Required secret manifest / provisioning

`wrangler secret list` (post-deploy, name-only, values never read):

```
AGENT_CARD_SIGNING_PRIVATE_KEY
CDP_API_KEY_ID
CDP_API_KEY_SECRET
```

Two secrets provisioned this checkpoint (`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`,
via `wrangler versions secret put`, interactive/stdin — never left in shell
history). No `CDP_WALLET_SECRET` (eliminated). No secret values appeared
anywhere in this session's terminal output, git diff, `TASKS.yaml`, this report,
or the Worker's public output — confirmed by `pnpm secrets:scan`/gitleaks,
clean, both before and after.

## Staging / non-secret variables

`SELLER_WALLET_ADDRESS = "0x7f44a2dd237938F18632d4CcA40f4c690295E6E1"` added to
`wrangler.toml`'s `[vars]` (public receiving address, not credential material —
moved out of the secrets-documentation comment block, which was updated to
match). No other production gate var
(`PAYMENT_ENVIRONMENT`/`PRODUCTION_ENABLED`/
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`/`PRODUCTION_CDP_CREDENTIALS_APPROVED`)
was added anywhere — confirmed by `git status`/`grep` on `wrangler.toml` both
before and after deploy.

## RPC configuration

`BASE_RPC_URL`/`BASE_SEPOLIA_RPC_URL` left unprovisioned — falls back to viem's
own default public Base RPC (checkpoint D's existing, documented fallback). This
is a reliability decision, not an economic gate: an RPC outage degrades
ambiguous-settlement reconciliation to `STILL_UNKNOWN` / bounded
identical-settle recovery (checkpoint C's frozen policy), never a
double-settlement risk. No paid RPC provider required for this checkpoint.

## Deployment evidence

Two real deployments this checkpoint: an initial one provisioning the two CDP
secrets (version `a4ada936`'s predecessor), and a second
(`a4ada936-a434-4522-a8af-41c57170f4e4`, created `2026-08-18T17:33:50.398Z`)
after `SELLER_WALLET_ADDRESS` was added. `wrangler deploy --dry-run` was run
repeatedly beforehand (local bundling only, no Cloudflare call) — 5535.14 KiB /
gzip 957.15 KiB, `SELLER_WALLET_ADDRESS` correctly appearing as a plain
Environment Variable binding, no secret values ever displayed.

## Public non-economic regression (post-deploy)

All 200/verified: `/health`, `/.well-known/jwks.json`,
`/.well-known/agent-card.json`, `/catalog`, `/schemas`, `/benchmarks`,
`/openapi.json`, `/`. `/ready` correctly reports
`production_services_enabled: false`, `status: "not_ready"`.

## Payment challenge safety proof (§21)

The strongest available result, a strict superset of the directive's own minimum
bar: every paid route returns a structural **404**, not merely a safe error —

```
POST /v2/web/context           -> 404
POST /v1/company/evidence-graph -> 404
GET  /v1/nevermined/*          -> 404
GET  /v2/nevermined/*          -> 404
```

`PAID_ROUTES_ENABLED`/`NEVERMINED_ROUTES_ENABLED` remain unset in the deployed
`wrangler.toml` (confirmed unmodified by `git status`/`grep`, both before and
after this checkpoint) — the routes are not even mounted. **No actionable
mainnet challenge is exposed**, unambiguously, by construction, independent of
`SELLER_WALLET_ADDRESS` or the CDP secrets now being present. No
`PAYMENT-SIGNATURE` request was ever submitted.

## Seller lookup live read proof (§22)

Not triggered live through the deployed Worker — doing so would require
`PAID_ROUTES_ENABLED=true`, which was never set this checkpoint, matching the
directive's own instruction not to cross the economic gate for this proof. The
local/CLI read-only proof (above) is the evidence for this checkpoint, exactly
as the directive anticipated.

## Model D

`/v1/nevermined/*` and `/v2/nevermined/*` both `404` on the live deployment
(above) — Nevermined remains fully isolated/unreachable, no fallback, no
stacking. Nevermined calls this checkpoint: 0.

## Economic mutation accounting

CDP facilitator verify: 0. CDP facilitator settle: 0. CDP production
transactions: 0. Nevermined calls: 0. Account creation: 0. Signing: 0. `payTo`
changes beyond the one explicit, user-confirmed `SELLER_WALLET_ADDRESS`
addition: 0.

## Post-deploy security

`pnpm governance:validate` (77/77), `pnpm state:validate` (30/30),
`pnpm tasks:validate` (252/252), `pnpm secrets:scan`/gitleaks (clean) all re-ran
green after the `wrangler.toml` change. Code-level `pnpm check`/
`pnpm security:release` (Trivy 0C/0H, Semgrep 0, OSV critical=0) were last
confirmed green immediately before credential handling began (this checkpoint
made no further source-code change beyond the earlier Wallet-Secret-elimination
commit) — no source code changed after that point, only `wrangler.toml`'s
non-secret `[vars]` and the live Cloudflare deployment state, neither of which
`pnpm check`'s test/lint/typecheck suite evaluates.

## Final state

```
PRODUCTION_CDP_CODE_PATH                 true
PRODUCTION_CDP_PROVIDER_WIRING           true
PRODUCTION_SETTLEMENT_RECOVERY_READY     true
PRODUCTION_SELLER_IDENTITY_READY         true
PRODUCTION_RUNTIME_HOOKS_WIRED           true
PRODUCTION_WALLET_SECRET_REQUIRED        false
PRODUCTION_SELLER_ACCOUNT_RECONCILED     true
PRODUCTION_CDP_CREDENTIALS_PROVISIONED   true
FRESH_PRODUCTION_CDP_CREDENTIALS_PRESENT false (disclosed deviation -- user
                                          explicitly reused existing credentials)
PRODUCTION_CDP_CREDENTIALS_APPROVED      false
production_ready                         false
production_enabled                       false
EXECUTABLE_VERIFIED                      false
SUN-1200                                 BLOCKED_EXTERNAL — MARKET_DEMAND
```

## Remaining Checkpoint F prerequisites

1. Explicit `PRODUCTION_CDP_CREDENTIALS_APPROVED=true` decision (a separate,
   deliberate approval — not implied by provisioning).
2. A specific, bounded, human-authorized bootstrap action (ADR 0055) setting
   `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true` for that one action only.
3. `PAID_ROUTES_ENABLED=true` (currently unset — the paid route family is not
   even mounted).
4. A single bounded, human-authorized mainnet payment proof — verify receipt/
   PSL/replay — before any public paid surface is enabled generally.
5. SUN-1200 itself remains blocked on genuine, un-forceable market demand
   regardless of every technical prerequisite above being satisfied.
