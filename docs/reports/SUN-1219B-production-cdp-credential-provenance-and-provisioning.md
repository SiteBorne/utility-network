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
