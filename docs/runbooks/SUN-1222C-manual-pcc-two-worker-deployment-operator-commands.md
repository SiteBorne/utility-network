# SUN-1222C-MANUAL-PCC-TWO-WORKER-DEPLOYMENT — operator commands

Generated against Wrangler 4.119.0 (this repo's pinned version, confirmed live
via `npx wrangler --version` this session). Every command below was checked
against that exact version's own `--help` output before being written here —
none are guessed syntax.

`START_HEAD=d1176dd679cde58422b7818c5ee4da7e054119e5`. §1–§3 and §6 already
confirmed this session (repository integrity clean, settlement invariant
0/0/1/1 exact, mTLS gate source-traced to FALSE, full local gate rerun clean
after two full-suite passes — see chat for the itemized results). This file
covers §4 onward: everything that touches live Cloudflare state, which only
you run.

Worker/config mapping (confirmed from the repo, not assumed):

| Worker | Config file | Static routing (from `wrangler.toml`, confirmed) |
|---|---|---|
| `siteborne-utility-edge` (public API) | `wrangler.toml` (default, no `--config` flag) | `workers_dev = true`; only static `routes` entry is `siteborne.net/.well-known/mcp-registry-auth` — **`utility.siteborne.net` is NOT in this file**, so it must be a dashboard-managed Custom Domain. §6.1 below confirms this live. |
| `siteborne-paid-continuation-runtime` (paid runtime) | `wrangler.paid-continuation-runtime.toml` | `workers_dev = false`, no `routes`, no custom domains — zero public surface, statically confirmed. |
| `siteborne-settlement-alert` (**do not touch**) | `wrangler.settlement-alert-worker.toml` | not part of this deployment; §20 requires `ALERT_WORKER_DEPLOYMENTS=0`. |

---

## §4. Predeploy live readback (read-only, no mutation)

Run each block, paste the output back. No secret **values** are printed by
any of these — `secret list` returns names only.

**4.1 — Public API (`siteborne-utility-edge`)**
```bash
wrangler deployments list --name siteborne-utility-edge
wrangler deployments status --name siteborne-utility-edge
wrangler secret list --config wrangler.toml
```
From the `deployments list` output, note the current top (most recent, 100%
or highest-traffic) Version ID — call it `PUBLIC_API_PRE_VERSION`. Then:
```bash
wrangler versions view <PUBLIC_API_PRE_VERSION> --name siteborne-utility-edge
```
This prints that live version's actual bindings (compare against the dry-run
binding table already captured this session — they should match exactly,
since the working tree is clean and unchanged since `ac642cb`'s deploy, if
that deploy already happened; if they *don't* match, that's the live signal
for whether this deploy is even still required — see §6.2 below).

**4.2 — Paid runtime (`siteborne-paid-continuation-runtime`)**
```bash
wrangler deployments list --name siteborne-paid-continuation-runtime --config wrangler.paid-continuation-runtime.toml
wrangler deployments status --name siteborne-paid-continuation-runtime --config wrangler.paid-continuation-runtime.toml
wrangler secret list --config wrangler.paid-continuation-runtime.toml
```
Same pattern: note `PAID_RUNTIME_PRE_VERSION` from the top of `deployments
list`, then:
```bash
wrangler versions view <PAID_RUNTIME_PRE_VERSION> --name siteborne-paid-continuation-runtime
```

**4.3 — Live routing/custom-domain state for `utility.siteborne.net`
(Cloudflare dashboard, not wrangler CLI — no read subcommand for this in
4.119.0)**

Dashboard → Workers & Pages → `siteborne-utility-edge` → Settings →
Domains & Routes. Record whether `utility.siteborne.net` is bound as a
Custom Domain to this Worker (expected: yes, since the site is live), and
confirm `siteborne-paid-continuation-runtime` has **zero** entries there
(expected, matches static config).

**4.4 — Fill in from the above:**
```
PUBLIC_API_PRE_VERSION=
PUBLIC_API_PRE_TRAFFIC=
PUBLIC_API_BINDINGS_PRE=
PUBLIC_API_SECRET_NAMES_PRE=
PUBLIC_API_LIVE_CUSTOM_DOMAIN=<utility.siteborne.net bound? YES/NO>

PAID_RUNTIME_PRE_VERSION=
PAID_RUNTIME_PRE_TRAFFIC=
PAID_RUNTIME_BINDINGS_PRE=
PAID_RUNTIME_SECRET_NAMES_PRE=
PAID_RUNTIME_LIVE_ROUTES=<expected 0>
```

---

## §5. In-flight job gate (read-only D1 SELECT against production)

This is the exact query and policy already proven in the prior checkpoint's
evidence report (`docs/reports/SUN-1222C-deployment-dependency-and-mtls-truthfulness-remediation.md`
§20–21) — not re-derived here, carried forward as-is:

```
PCC_DEPLOYMENT_INFLIGHT_POLICY=B (require zero in-flight jobs before deploying the paid runtime)
```

Run this **immediately before §12** (Stage 2), not now — the count can
change between now and then:
```bash
wrangler d1 execute siteborne-utility --remote --command \
  "SELECT lifecycle_stage, COUNT(*) AS n FROM payment_attempts WHERE lifecycle_stage IN ('acquired','executed','settlement_pending') GROUP BY lifecycle_stage"
```
```
INFLIGHT_PAID_JOBS_TOTAL=
INFLIGHT_BY_STATE=
```
If the total is non-zero: **STOP before §12**. Do not deploy the paid
runtime. Do not cancel jobs to force the count to zero — wait.

---

## §7. Stage 1 — public API deploy (`siteborne-utility-edge`)

> **⚠️ UNSAFE / DO NOT EXECUTE AS WRITTEN.**
> `SUN-1222C-CROSS-TRACK-PRODUCTION-STATE-RECONCILIATION`
> (`docs/reports/SUN-1222C-cross-track-production-state-reconciliation.md`)
> found that live production traffic on `siteborne-utility-edge` is **split**
> (`db7054c9` @ 100%, `d3472f58` @ 0%, the latter an already-qualified,
> human-authorized R6 candidate carrying 10 activation vars absent from this
> repo's `wrangler.toml`). The plain `wrangler deploy` command below would
> delete those 10 live-authorized vars and silently turn off already-approved
> production payment routes — the opposite failure mode this runbook was
> built to prevent. **Do not run this command.** The reconciliation report's
> §12/§16 recommended mechanism (`wrangler versions upload` with the exact
> frozen 10-var set, at 0% traffic, qualified before any cutover decision) is
> the safe replacement, and is a new checkpoint (`SUN-1222C-RECONCILED-R6-PCC-
> DEPLOYMENT-PLAN`) in its own right — it is not written here yet.

```
PUBLIC_API_PRE_VERSION=<from §4.4>
```
```
COMMAND=
```
```bash
wrangler deploy
```
**⚠️ DO NOT RUN — see warning above.** (default config — no `--config` flag
needed, `wrangler.toml` is the default)

```
EXPECTED=
```
A successful upload prints a new Version ID, the same binding table already
verified via this session's `--dry-run` (§6), and (since `wrangler.toml` has
no `[env]` gradual-rollout `versions upload`/`versions deploy` split
configured — this is a plain `wrangler deploy`) 100% traffic on the new
version immediately.

```
STOP_IF=
```
Any binding not matching the dry-run table exactly; any unexpected route
added; any secret prompt (there should be none — all secrets already exist
per §4.1's `secret list`); any non-zero exit code.

```
ROLLBACK=
```
```bash
wrangler rollback <PUBLIC_API_PRE_VERSION> --name siteborne-utility-edge -m "SUN-1222C rollback: restore pre-PCC-deploy public API version"
```

---

## §8. Immediate public API readback (after §7 executes)

```bash
wrangler deployments list --name siteborne-utility-edge
wrangler deployments status --name siteborne-utility-edge
wrangler secret list --config wrangler.toml
```
Plus §4.3's dashboard Domains & Routes check again (confirm unchanged).

```
PUBLIC_API_POST_VERSION=
PUBLIC_API_TRAFFIC=
PUBLIC_API_UNEXPECTED_BINDING_DRIFT=<0 required>
PUBLIC_API_UNEXPECTED_ROUTE_DRIFT=<0 required>
PUBLIC_API_UNEXPECTED_SECRET_DRIFT=<0 required>
```

---

## §9. Critical mTLS truthfulness after Stage 1 (read-only HTTPS GET)

```bash
curl -s https://utility.siteborne.net/.well-known/agent-card.json | python3 -m json.tool
```
Check specifically:
```bash
curl -s https://utility.siteborne.net/.well-known/agent-card.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('securitySchemes:', d.get('securitySchemes')); print('securityRequirements:', d.get('securityRequirements'))"
```
Required:
```
MTLS_PRODUCTION_ACTIVE=FALSE
LIVE_AGENT_CARD_MTLS_ADVERTISED=NO   (securitySchemes must be {} or absent — MTLS_PRODUCTION_ACTIVE resolves to false with no wrangler.toml/secret override, confirmed §3)
```
If `mutualTLS`/`mtlsSecurityScheme` appears anyway: **STOP. Execute the §7
rollback immediately. Do not proceed to §12.** (This would mean something
outside this checkpoint's diff — e.g. a stray secret — flipped the gate;
investigate before any further deployment action.)

Also fetch and eyeball-verify:
```bash
curl -s https://utility.siteborne.net/.well-known/agent-card.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('name:', d.get('name'))
print('protocolVersion:', d.get('protocolVersion'))
print('skills count:', len(d.get('skills', [])))
print('signatures count:', len(d.get('signatures', [])))
"
```
```
LIVE_AGENT_CARD_A2A_VALID=<YES if name/protocolVersion/skills present and well-formed>
LIVE_JWS_VALID=<YES if signatures[0] present and non-empty>
```
For JWKS:
```bash
curl -s https://utility.siteborne.net/.well-known/jwks.json | python3 -m json.tool
```
```
LIVE_JWKS_VALID=<YES if a `keys` array with at least one entry matching the Agent Card's signing key ID is returned>
```

---

## §10. Public surface regression after Stage 1 (no client cert, read-only)

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://utility.siteborne.net/health
curl -s -o /dev/null -w "%{http_code}\n" https://utility.siteborne.net/ready
curl -s -o /dev/null -w "%{http_code}\n" https://utility.siteborne.net/.well-known/agent-card.json
curl -s -o /dev/null -w "%{http_code}\n" https://utility.siteborne.net/catalog
curl -s -X POST https://utility.siteborne.net/a2a -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"ping"}],"messageId":"sun1222c-liveness-probe","kind":"message"}}}' -o /dev/null -w "%{http_code}\n" -s
```
Expected: `200` for health/ready/agent-card, `200` for catalog, and a
non-5xx (200 or a structured 4xx per the A2A liveness contract — not a
crash) for the `/a2a` probe. No payment attempted by any of these.

```
PUBLIC_API_STAGE1_REGRESSION=<NO if all above match expectations>
```

---

## §11. Intermediate PCC compatibility (NEW public API + OLD paid runtime)

This is a structural re-affirmation, not a new live payment test (§17
forbids spending to prove it further). The prior checkpoint's compatibility
matrix (`docs/reports/SUN-1222C-deployment-dependency-and-mtls-truthfulness-remediation.md`,
matrix in §14–16) already proved this exact pair — NEW public API reading
from an OLD paid-runtime-shaped result — is self-consistent (worst case:
stale-but-valid old envelope fields, never `undefined`). Nothing in this
session's diff touched that matrix's inputs.

```
INTERMEDIATE_PAIR=NEW_PUBLIC_OLD_PAID
INTERMEDIATE_PAIR_COMPATIBLE=YES
```
If §9 or §10 contradicted this (they shouldn't, given the above): roll back
public API, do not proceed to §12.

---

## §12. Stage 2 — paid runtime deploy (`siteborne-paid-continuation-runtime`)

Only after §8–§11 all pass, and only after re-running §5's in-flight query
with `INFLIGHT_PAID_JOBS_TOTAL=0`.

```
PAID_RUNTIME_PRE_VERSION=<from §4.4>
```
```
COMMAND=
```
```bash
wrangler deploy --config wrangler.paid-continuation-runtime.toml
```
```
EXPECTED=
```
Successful upload, new Version ID, binding table matching this session's
`--dry-run` output exactly (D1, R2, Workflow, the four Environment
Variables — no KV/Queue/AI/Browser bindings, since those belong only to
the public API).

```
STOP_IF=
```
Same criteria as §7: binding mismatch, unexpected route/custom-domain
appearing (should be zero), secret prompt, non-zero exit.

```
ROLLBACK=
```
```bash
wrangler rollback <PAID_RUNTIME_PRE_VERSION> --name siteborne-paid-continuation-runtime --config wrangler.paid-continuation-runtime.toml -m "SUN-1222C rollback: restore pre-PCC-deploy paid runtime version"
```

---

## §13. Paid runtime readback (after §12 executes)

```bash
wrangler deployments list --name siteborne-paid-continuation-runtime --config wrangler.paid-continuation-runtime.toml
wrangler deployments status --name siteborne-paid-continuation-runtime --config wrangler.paid-continuation-runtime.toml
wrangler secret list --config wrangler.paid-continuation-runtime.toml
```
Plus the §4.3-style dashboard Domains & Routes check for this worker
(expected still zero entries).

```
PAID_RUNTIME_POST_VERSION=
PAID_RUNTIME_POST_TRAFFIC=
PAID_RUNTIME_BINDING_DRIFT=<0 required>
PAID_RUNTIME_SECRET_DRIFT=<0 required>
PAID_RUNTIME_PUBLIC_ROUTES=<0 required>
```

---

## §14. Final pair state

```
FINAL_PCC_WORKER_PAIR=NEW/NEW
PCC_PUBLIC_HALF_LIVE=<YES — confirm via §9's agent-card fetch and §10's /a2a, /catalog checks post both deploys>
PCC_PAID_RUNTIME_HALF_LIVE=<YES — confirmed structurally via §13's binding table matching source; no live payment run to prove the settlement path itself, per §17>
```

---

## §15. Post-deploy mTLS truthfulness (repeat §9 verbatim, both Workers live)

```bash
curl -s https://utility.siteborne.net/.well-known/agent-card.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('securitySchemes:', d.get('securitySchemes'))"
```
```
MTLS_PRODUCTION_ACTIVE=FALSE
LIVE_AGENT_CARD_MTLS_ADVERTISED=NO
```
If `mutualTLS` appears: roll back the public API (§7's rollback command) or
correct the capability configuration before continuing. Do not provision
mTLS here regardless.

---

## §16. Settlement ownership after both deploys

```bash
npx vitest run apps/edge-api/tests/settle-sole-ownership.test.ts
```
```
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```
This is a static/source-level test, unaffected by which Worker versions are
currently live — it re-confirms the repo state you just deployed still
matches what was gated in §2.

---

## §17. Zero-economic qualification

No command in this runbook performs a real payment, signs a payment
authorization, calls `.settle()`, or invokes a real provider. Every probe
above is `GET`/read-only or a structurally-inert `/a2a` liveness `ping`.

```
LIVE_PAID_PCC_RESULT_VERIFIED=NO
```
This is expected and acceptable per this checkpoint's own §17 — deferred to
a separate, later, explicitly-bounded live-paid-acceptance checkpoint.

---

## §18. Final contract/protocol check (structural, post-deploy)

```bash
curl -s https://utility.siteborne.net/.well-known/agent-card.json -o /tmp/live-agent-card.json
python3 -c "
import json
d = json.load(open('/tmp/live-agent-card.json'))
ext = d.get('capabilities', {}).get('extensions', [{}])[0]
print('x402Version:', ext.get('params', {}).get('x402Version'))
"
```
Cross-check the printed `x402Version` and the Agent Card's own declared
`protocolVersion` against this repo's `contracts/releases/2.0.0` directory
(already the governing version per the disposition checkpoint — no live
value should contradict it).

```
PCC_DEPLOYMENT_STRUCTURALLY_QUALIFIED=<YES if §9, §10, §15, §16, and this check all passed>
```

---

## §19. Rollback matrix (exact commands, no generic syntax)

**Case A — public API deployed, paid runtime not deployed yet, and Stage 1
qualification (§8–§11) fails:**
```bash
wrangler rollback <PUBLIC_API_PRE_VERSION> --name siteborne-utility-edge -m "SUN-1222C rollback: Stage 1 qualification failed"
```

**Case B — both deployed, paid runtime fails qualification (§13–§18):**
Per the corrected deployment-order compatibility matrix (prior checkpoint's
evidence report §14–16): rolling back **only** the paid runtime returns the
live pair to `NEW public API / OLD paid runtime` — the exact pair already
proven safe in §11. Rolling back the public API too is unnecessary and
would re-introduce no benefit. So:
```bash
wrangler rollback <PAID_RUNTIME_PRE_VERSION> --name siteborne-paid-continuation-runtime --config wrangler.paid-continuation-runtime.toml -m "SUN-1222C rollback: Stage 2 qualification failed, paid runtime only"
```
Do **not** also roll back the public API unless §9/§10 independently failed
on the public API itself.

**Case C — public API deploy produces unexpected mTLS advertisement (§9):**
```bash
wrangler rollback <PUBLIC_API_PRE_VERSION> --name siteborne-utility-edge -m "SUN-1222C rollback: unexpected live mTLS advertisement"
```

**Case D — paid runtime deploy changes bindings/secrets/routes unexpectedly
(§13):**
```bash
wrangler rollback <PAID_RUNTIME_PRE_VERSION> --name siteborne-paid-continuation-runtime --config wrangler.paid-continuation-runtime.toml -m "SUN-1222C rollback: unexpected binding/secret/route drift"
```

---

## §20–23. Invariants carried through unchanged

```
ALERT_WORKER_DEPLOYMENTS=0        (no command in this runbook touches wrangler.settlement-alert-worker.toml)
CLIENT_CERTIFICATES_ISSUED=0
MTLS_HOST_ASSOCIATION_MUTATIONS=0
WAF_MUTATIONS=0
DNS_MUTATIONS=0
MTLS_ROUTE_MUTATIONS=0
LIVE_PAID_REQUESTS=0
REAL_PAYMENT_SIGNING_ACTIONS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
REAL_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```
No command anywhere in this runbook touches `mtls.utility.siteborne.net`,
`mtls-canary.utility.siteborne.net`, any client-certificate API, any WAF
rule, or any DNS record.

---

Paste the filled-in §24 packet (from the prior chat message) back after
executing. I will validate it, perform the read-only public re-verification
myself if useful, and write the sanitized evidence report — I will not
invent any value you don't provide.
