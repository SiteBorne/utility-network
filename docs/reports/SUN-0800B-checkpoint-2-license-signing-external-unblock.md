# SUN-0800B Checkpoint 2 — License, Production Signing Architecture, External-Unblock Package

HEAD parent `be4f2da`. **Zero npm publish, zero Cloudflare deploy, zero DNS
mutation, zero production private key generated in source control, zero economic
payment calls, zero Nevermined live provider calls.**

## §1: baseline

Clean tree, `HEAD=be4f2da` confirmed. `governance:validate`/`state:validate`/
`tasks:validate`/`secrets:scan`/`pnpm check` all green before any change.

## §2-4: `@siteborne/mcp-server` license — Apache-2.0

`package.json`: `"license": "UNLICENSED"` → `"license": "Apache-2.0"` (valid
SPDX identifier). Canonical, verbatim Apache License 2.0 text fetched live from
`apache.org/licenses/LICENSE-2.0.txt` and added at
[`packages/mcp-server/LICENSE`](../../packages/mcp-server/LICENSE) — no custom
terms invented. Appendix boilerplate copyright notice:
`Copyright 2026 SITEBORNE` — reusing the exact copyright-holder string already
established at the repository root `LICENSE` (MIT), not a fabricated legal
entity.

`files` whitelist updated to include `LICENSE` alongside the existing
`dist/stdio.js`/`README.md`/`server.json`. A `repository` field was **considered
but deliberately not added**: no git remote is configured in this repository
(`git remote -v` — empty) and no GitHub/repository URL exists anywhere else in
the codebase to source one from truthfully; adding a guessed URL would have been
a fabrication. This remains an open gap — see §17.

**License consistency search:** `UNLICENSED` still appears in two files —
`TASKS.yaml` and the checkpoint-1 report — both are **HISTORICAL** evidence
records of the gap as it was found, correctly preserved per the directive's own
instruction not to rewrite historical evidence. **No CONFLICTING references
found.**

## §3/§21: package repack — final manifest

```
package: @siteborne/mcp-server@0.1.0
Tarball Contents:
  11.3kB  LICENSE
  689B    README.md
  2.4MB   dist/stdio.js
  1.6kB   package.json
  447B    server.json
total files: 5
```

`gitleaks dir` against the extracted tarball: **zero leaks**. Grep of the
bundled `dist/stdio.js` for `nevermined`/`traceloop`/`opentelemetry`: the same
single unrelated JSON-schema enum match found in checkpoint 1, never SDK code.
`publishConfig.access: "public"`; package is not `private`.
`metadata:verify`/`pack:verify` both pass.

## §5: current A2A signing spec (fetched live, a2a-protocol.org, v1.0.0)

Confirmed via `§8.4 Agent Card Signing` on the live specification page:

- Agent Cards MAY be signed via JWS (RFC 7515).
- **Canonicalization**: RFC 8785 (JCS) after removing default-valued properties
  (per Protocol Buffer field-presence semantics) and excluding the `signatures`
  field itself.
- **Protected header**: MUST include `alg`, `typ` (SHOULD be `"JOSE"`), `kid`;
  MAY include `jku` (public JWKS URL).
- **Discovery**: `/.well-known/agent-card.json`.

**This is DOCUMENTED_STABLE and already fully implemented** — the existing
`@a2a-js/sdk`'s `generateAgentCardSignature`/`verifyAgentCardSignature`
functions (already in use in `packages/protocol-a2a/src/signing.ts` since before
this checkpoint) implement RFC 8785 canonicalization, default-value removal, and
signature-field exclusion internally. No SITEBORNE-specific signing semantics
were invented; no redesign was needed or performed.

## §6-9: production signing architecture

The existing implementation (`createLocalA2aSigningIdentity`) already used
ES256/JWKS/stable-per-instance-`kid`/`jku` — but generates an **ephemeral,
in-memory** key pair per app instance, appropriate only for local/dev use. This
checkpoint adds a genuine production path alongside it, without touching the
existing one:

- **`createConfiguredA2aSigningIdentity`** (new,
  `packages/protocol-a2a/src/signing.ts`) — accepts EXTERNALLY SUPPLIED key
  material (a private ES256 JWK + a caller-chosen stable `kid`), imports it into
  a non-extractable `CryptoKey` immediately, derives the public JWKS
  independently (never from the private `CryptoKey`, which cannot be
  re-exported), and signs/verifies via the same official SDK functions. Fails
  closed (`InvalidAgentCardSigningKeyError`) on wrong `kty`/`crv`, missing
  private `d`, or any key the platform's own `crypto.subtle` rejects. This
  package itself still never reads environment variables, files, or secret
  stores — matching the existing credential-independent boundary
  (`no-network.test.ts`).
- **`resolveAgentCardSigningIdentity`** (new,
  `apps/edge-api/src/control-plane/config/agent-card-signing.ts`) — the one
  place in `edge-api` that reads `AGENT_CARD_SIGNING_PRIVATE_KEY`/
  `AGENT_CARD_SIGNING_KEY_ID` from real deployment config. Returns `undefined`
  (fall back to the ephemeral local identity, today's state everywhere) when
  neither is set; **fails closed** when exactly one is set (never treats a
  partial configuration as "not configured"); fails closed on malformed JSON or
  a structurally invalid JWK.
- `apps/edge-api/src/routes/a2a.ts` wired to use the configured identity when
  present, unchanged ephemeral fallback otherwise.

**A genuine race-condition bug was found and fixed during this work**: the first
implementation awaited `resolveAgentCardSigningIdentity` _before_ assigning the
module-level app cache, creating a window where two concurrent requests could
each build a _different_ signing identity — observed directly as a real test
failure (signature verification failing because the served JWKS didn't match the
key that signed the served card). Fixed by assigning the cache synchronously via
an async IIFE, restoring the original race-free property.

**Two real WebCrypto import bugs were also found and fixed**: the private-key
JWK's own `key_ops`/`alg` fields (as exported from `crypto.subtle.exportKey`)
conflicted with the internal public-key re-derivation and with an intentionally
non-ES256-tagged test input, producing
`"Key operations and usage mismatch"`/`"alg does not match"` errors. Fixed by
importing only the standard EC public components (`kty`/`crv`/`x`/`y`) for the
derived public key, and stripping `alg` before the private-key import (this
function always signs as ES256 regardless of what an input JWK's own `alg`
claims).

## §8/§11: tests (28 new, zero live calls)

- `packages/protocol-a2a/src/signing.test.ts` — 14 new tests for
  `createConfiguredA2aSigningIdentity`: canonical sign→verify round trip, tamper
  negative control, wrong-key negative control, private-material leak check,
  structural-validation failures (wrong `kty`/`crv`, missing `d`, empty
  `keyId`), unsupported-`alg`-is-overridden confirmation,
  unknown-`kid`/untrusted-`jku` rejection. Every key pair is generated
  ephemerally inside the test run — none stored in repository state.
- `apps/edge-api/tests/agent-card-signing.test.ts` — 6 new tests for
  `resolveAgentCardSigningIdentity`: unconfigured → `undefined`, both
  partial-configuration directions fail closed, malformed JSON fails closed,
  structurally invalid key fails closed, valid configuration constructs a real
  identity with no private material in its `jwks`.

## §12: external signing identity status

```
SIGNING_ARCHITECTURE_READY = true
PRODUCTION_SIGNING_KEY_PROVISIONED = false
PUBLIC_JWKS_DEPLOYED = false
SIGNED_AGENT_CARD_PUBLICLY_REACHABLE = false
```

No production credential was generated or invented. This converts the
previously-vague "production Agent Card signing identity" blocker into a precise
provisioning/deployment blocker: the architecture is done and tested; only a
real key and a real deployment remain, both external.

## §13: Cloudflare release manifest — plus a real, significant discovery

While generating this manifest (`wrangler deploy --dry-run`, which runs entirely
locally — no Cloudflare authentication reached at any point below), **five real,
independent defects were found and fixed in `wrangler.toml`, none related to
credentials**:

| #   | Defect                                                                                                                                                                                                                                                                                                                                                                                                   | Fix                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `kv_namespaces[0].id = ""` — invalid (empty string rejected as a string id)                                                                                                                                                                                                                                                                                                                              | Commented out with a provisioning note; `CATALOG` is not in `env.ts`'s required-bindings list, so this doesn't block anything today                                                            |
| 2   | `[[queues]]` array-of-tables — invalid under the current wrangler queues schema (confirmed live against `developers.cloudflare.com/queues/configuration/`)                                                                                                                                                                                                                                               | Corrected to `[queues]` single-table `producers` shape (this Worker exports no `queue()` handler, so producer-only)                                                                            |
| 3   | `[build] command = "pnpm run build --filter=edge-api"` — no package named `edge-api` exists (only `@siteborne/edge-api`)                                                                                                                                                                                                                                                                                 | Corrected the filter                                                                                                                                                                           |
| 4   | `main = "src/index.ts"` (doesn't exist anywhere) pointing at the custom build's expected _output_ — but `apps/edge-api/tsconfig.json` has `"noEmit": true` by design, so the custom build command produced **no output at all**, ever. The `[build]` command was non-functional from the moment it was added — **no successful deploy could ever have used this config**                                 | Removed the `[build]` block entirely; pointed `main` directly at `apps/edge-api/src/index.ts`, letting wrangler's own esbuild bundler compile TypeScript at deploy time (the standard pattern) |
| 5   | `ENVIRONMENT`/`LOG_LEVEL` lived in a bare `[env]` table — not a valid top-level wrangler construct (named environments are `[env.<name>]`) — confirmed live: the dry-run's own binding listing showed only `PCC_VERSION`, never these two. `env.ts` falls back to `'development'`/`'info'` when absent, meaning **a real deployment would have silently run as `ENVIRONMENT=development` in production** | Moved both into `[vars]`                                                                                                                                                                       |

After all five fixes, `wrangler deploy --dry-run` succeeds completely through
bundling and binding resolution, reaching only the (expected, credential-gated)
account authentication step:

```
Total Upload: 2973.48 KiB / gzip: 526.94 KiB
Your Worker has access to the following bindings:
  env.JOBS (siteborne-jobs)              Queue
  env.EVENTS (siteborne-events)          Queue
  env.DB (siteborne-utility)             D1 Database
  env.ARTIFACTS (siteborne-artifacts)    R2 Bucket
  env.BROWSER                            Browser Run
  env.AI                                 AI
  env.PCC_VERSION ("1.0.0")              Environment Variable
  env.ENVIRONMENT ("production")         Environment Variable
  env.LOG_LEVEL ("info")                 Environment Variable
```

**Canonical target public origin**: `utility.siteborne.net` (matches
`SITEBORNE_A2A_ORIGIN`/`NEVERMINED_ROUTES`/`SELLER_WALLET_ADDRESS` usage
throughout the codebase). **Required secret names** (from `wrangler.toml`'s own
documented list, cross-checked against `env.ts`): `SELLER_WALLET_ADDRESS`,
`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`,
`NEVERMINED_API_KEY` (or `NVM_API_KEY`), `NVM_ENVIRONMENT`, `VOYAGE_API_KEY`,
`MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `SENTRY_DSN`, plus the two new
**`AGENT_CARD_SIGNING_PRIVATE_KEY`**/**`AGENT_CARD_SIGNING_KEY_ID`** from this
checkpoint. **Required non-secret bindings**: `DB` (D1), `ARTIFACTS` (R2),
`JOBS`/`EVENTS` (Queues, producer-only), `AI`, `BROWSER`, plus the plaintext
`PCC_VERSION`/`ENVIRONMENT`/`LOG_LEVEL` vars. `CATALOG` (KV) is declared but not
yet provisioned (see defect #1) and is not currently required by `env.ts`.

## §14: fail-closed deployment config

Unchanged by this checkpoint, reconfirmed: `production_enabled` is hardcoded
`false` at route-construction time in `apps/edge-api` (checkpoint 1A evidence),
independent of `ENVIRONMENT`/any Cloudflare deployment state. A successful
Cloudflare deploy does **not** by itself flip `production_ready` or
`production_enabled` — both require separate, explicit future decisions.

## §15: Nevermined blocker — preserved

`NEVERMINED_V2_PROVIDER_STATUS=BLOCKED_EXTERNAL_PROVIDER`, unchanged. Zero
Nevermined provider calls this checkpoint. The Agent Card's x402 extension
(`buildX402ExtensionParams` in `packages/protocol-a2a/src/card.ts`) continues to
omit Nevermined entirely and hardcodes `productionEnabled: false` for every CDP
service — already conservative, unchanged and untouched by this checkpoint. The
four frozen v2 Nevermined registrations are untouched.

## §16: npm publication manifest (frozen intent, not executed)

```
package:  @siteborne/mcp-server
version:  0.1.0
tag:      latest (no distinct release-tag policy exists in this repository)
registry: https://registry.npmjs.org/ (public npm registry)
access:   public
```

No publication performed. The next external checkpoint must, before publishing:
(1) authenticate as an npm identity with real `@siteborne` scope/org ownership,
(2) confirm `@siteborne/mcp-server@0.1.0` is `NO_MATCH` on the public registry,
(3) publish exactly once, (4) read the registry back and require
`EXACT_EXISTING`, (5) never retry on an ambiguous result without first
reconciling via read.

## §17: external credential requirements — unblock checklist

**NPM**

- Mechanism: `npm login`/`npm adduser`, or an `NPM_TOKEN` (automation token)
  with publish rights.
- Expected scope/org: `@siteborne` — must have publish ownership of that scope,
  or the org must be created first if it doesn't exist yet.
- Also needed: a real repository URL (git remote/GitHub URL) for
  `package.json`'s `repository` field — currently absent, not fabricated.

**CLOUDFLARE**

- Account identity: the specific Cloudflare account/account ID this Worker
  should deploy under.
- Auth mechanism: `wrangler login` (OAuth) or a scoped `CLOUDFLARE_API_TOKEN`.
- Permissions needed: Workers Scripts (edit/deploy), D1 (create/read the
  `siteborne-utility` database and obtain its real `database_id` — the current
  empty string was not flagged as invalid by wrangler but should still be
  confirmed/filled once real), KV (create the `CATALOG` namespace and obtain its
  real id — required before uncommenting that binding), Queues (create
  `siteborne-jobs`/`siteborne-events` if they don't already exist), R2
  (confirm/create the `siteborne-artifacts` bucket), Workers AI, Browser
  Rendering.

**DNS**

- Authority over the `siteborne.net` zone (for the `utility.siteborne.net`
  subdomain) in whichever DNS provider currently hosts it (likely Cloudflare
  DNS, given the Workers custom-domain model, but not confirmed by this
  checkpoint — no DNS read was performed since no origin credential exists to
  read with).
- Edit permission on that zone.

**AGENT CARD**

- A real ES256 private key, generated and stored via
  `wrangler secret put AGENT_CARD_SIGNING_PRIVATE_KEY` (as a serialized private
  JWK) — never in source control, never in this repository's `wrangler.toml`.
- A stable `kid` value (e.g. `siteborne-a2a-es256-2026-01`), set via
  `wrangler secret put AGENT_CARD_SIGNING_KEY_ID` or a plain `[vars]` entry (the
  `kid` itself is not secret, only `d` is — though co-locating them as two
  secrets is the simpler operational default).
- Public JWKS deployment is automatic once the Worker with those two secrets is
  deployed — `/.well-known/jwks.json` is already implemented and tested (§9).

No secret **values** are requested here or anywhere in this report.

## §18: DNS plan (proposed only, not executed)

Canonical service origin: `utility.siteborne.net`. The minimum
Cloudflare-supported configuration for a Workers deployment is a **Worker custom
domain** binding (Cloudflare manages the DNS record and TLS certificate
automatically once the domain is added to the Worker in the dashboard or via
`wrangler deploy` with a `routes`/custom-domain configuration) — preferred over
a manually-managed CNAME, since Cloudflare provisions and renews the TLS
certificate automatically for a custom domain, whereas a plain CNAME to
`workers.dev` would need separate TLS handling. No `AAAA`/`A` record is needed
under this model. **No unrelated `siteborne.com`/`siteborne.net` record would be
touched** — this plan is scoped to the single `utility` subdomain only. **Not
executed**: no DNS read or mutation was performed this checkpoint (no credential
exists to read the current state with).

## §19: external mutation runbook (future checkpoint, not this one)

```
A. read-only npm identity (npm whoami once authenticated)
B. npm exact-package/version existence check (@siteborne/mcp-server@0.1.0 -> expect NO_MATCH)
C. read-only Cloudflare identity (wrangler whoami)
D. read current zone/resource state (DNS records, existing D1/KV/Queue/R2 resources)
E. provision production Agent Card signing secret (wrangler secret put AGENT_CARD_SIGNING_PRIVATE_KEY / _KEY_ID)
F. deploy release candidate (wrangler deploy, real, one attempt)
G. authoritative deployment reconciliation (re-read deployed Worker state)
H. DNS/custom-domain mutation if required (per §18's plan)
I. DNS/TLS reconciliation (confirm resolution + certificate)
J. public JWKS verification (GET /.well-known/jwks.json, confirm shape, no private material)
K. signed Agent Card verification (GET /.well-known/agent-card.json, verify signature against J's JWKS)
L. public MCP/A2A/OpenAPI verification (real HTTP requests, not app.request())
M. npm publish once (@siteborne/mcp-server@0.1.0, tag latest, access public)
N. npm read-after-write reconciliation (require EXACT_EXISTING)
O. SUN-0800B acceptance evaluation against its 5 literal criteria
```

Not executed this checkpoint.

## §20: security / regression

| Gate                                                          | Result                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `security:load`                                               | PASS (7/7)                                                          |
| `security:chaos`                                              | PASS (18/18)                                                        |
| `security:schemathesis`                                       | PASS (exit 0)                                                       |
| `security:semgrep`                                            | PASS (0 findings)                                                   |
| `security:osv`                                                | PASS (0 critical)                                                   |
| `security:trivy`                                              | **PASS (0 CRITICAL, 0 HIGH)**                                       |
| `x402:check` / `nevermined:check` / `mcp:check` / `a2a:check` | PASS                                                                |
| `pnpm check` (full)                                           | PASS                                                                |
| `secrets:scan`                                                | PASS (one genuine false positive found and allowlisted — see below) |

**One gitleaks false positive found and fixed**: the `generic-api-key` rule
matched the bare TypeScript type name `PrivateEs256Jwk` (no actual secret value
present) purely because of its adjacency to `privateKeyJwk:` in a parameter type
annotation. Verified directly (`gitleaks dir` without `--redact` on just that
file) that the "secret" it flagged was literally the type name itself. Added a
narrow, exact-value allowlist entry to `.gitleaks.toml`, matching the file's own
established convention (exact literal values only, never path-based exclusions).

## §22: task state

`SUN-1000`: unchanged, `accepted`. `SUN-0800B`: remains `blocked_external` — not
accepted yet, per the directive's own explicit instruction. The **local**
license blocker is now **CLOSED**. The blocker is refined to precisely: npm
authentication/ownership, Cloudflare deployment/zone access (the five
`wrangler.toml` defects that would have blocked deployment even _with_
credentials are now fixed), production Agent Card signing key provisioning, and
public DNS/TLS/reachability. `production_ready=false`,
`production_enabled=false`.

## §25: commit / clean state

All tests green, secrets scan green, clean tracked tree — confirmed via
`pnpm check` immediately before commit.

## §26: stop report

1. Initial HEAD/tree: `be4f2da`, clean
2. License before: `UNLICENSED`
3. License after: `Apache-2.0`
4. LICENSE packaged: **yes**, in the tarball's `files` whitelist
5. Package public/private state: not `private`, `publishConfig.access: "public"`
6. Current A2A spec target: v1.0.0, §8.4 Agent Card Signing (fetched live)
7. Signing algorithm: ES256
8. JWS protected header requirements: `alg`, `typ` (`"JOSE"`), `kid`; optional
   `jku` — all implemented
9. Canonicalization method: RFC 8785 (JCS), via `@a2a-js/sdk`'s own functions
10. JWKS endpoint: `GET /.well-known/jwks.json` — already implemented, tested
    for zero private-material leakage (both identities)
11. Agent Card endpoint: `GET /.well-known/agent-card.json` — already
    implemented
12. Ephemeral sign/verify test: **pass** (canonical payload → sign → JWKS →
    independent verify)
13. Tamper negative control: **pass**
14. Wrong-key negative control: **pass**
15. Private JWK leak test: **pass** (both the local and configured identities)
16. Production key provisioned: **false**
17. Signing architecture ready: **true**
18. Cloudflare release manifest complete: **yes**, and 5 real deploy-blocking
    defects found and fixed along the way
19. Required Cloudflare bindings: `DB`, `ARTIFACTS`, `JOBS`, `EVENTS`, `AI`,
    `BROWSER`, `CATALOG` (not yet provisioned)
20. Required Cloudflare secret names: 10 existing + 2 new (listed in §13/§17)
21. npm package: `@siteborne/mcp-server`
22. npm version: `0.1.0`
23. npm access: `public`
24. npm authenticated: **no** (`ENEEDAUTH`, re-confirmed)
25. DNS authority available: **no**
26. Cloudflare authenticated: **no** (re-confirmed; `wrangler.toml` itself was
    fixed without ever reaching an auth check)
27. Proposed DNS/custom-domain action: Worker custom domain for
    `utility.siteborne.net` (§18) — not executed
28. External mutation runbook ready: **yes** (§19)
29. Nevermined blocker unchanged: **yes**, `BLOCKED_EXTERNAL_PROVIDER`
30. Nevermined calls: **0**
31. CDP transactions: **0**
32. Deployments: **0**
33. DNS mutations: **0**
34. npm publications: **0**
35. Trivy: **PASS (0/0)**
36. OSV: PASS
37. Semgrep: PASS
38. Schemathesis: PASS
39. Load: PASS
40. Chaos: PASS
41. MCP: PASS
42. A2A: PASS
43. `pnpm check`: PASS
44. Pack artifact clean: **yes**
45. SUN-0800B state: `blocked_external` (unchanged, not accepted)
46. `production_ready`: **false**
47. `production_enabled`: **false**
48. Remaining external blockers: npm auth/ownership + `repository` URL;
    Cloudflare account auth + KV/D1/Queue/R2 provisioning confirmation;
    production Agent Card signing key provisioning; DNS zone authority
49. Report path: this file
50. Commit: pending this checkpoint's own commit (parent `be4f2da`)
51. Clean tree: yes, confirmed via `pnpm check`/`secrets:scan`
52. Exact next external action: the user supplies the credentials/decisions in
    §17, then a future checkpoint executes the §19 runbook in order

STOP. SUN-1100 not begun.
