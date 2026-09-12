# SITEBORNE Utility Network — SUN-1222C

## CDP Mainnet Credential Provenance Closure

**Date:** 2026-09-12 **Classification:** read-only governance/evidence
checkpoint — no mutation. **Starting HEAD:** `e986f10812db5ac388da00c11a581fe83cc430ec`
(working tree clean before and after). **Ending HEAD:** this commit — no
runtime, config, secret, or traffic mutation occurred.

---

## 0. Correction to a previously-cited commit SHA

Prior checkpoints in this thread cited `493afbd…` as the durable commit for
the SUN-1219A "second reversal" addendum. Direct verification this checkpoint
found that SHA lives **only** on `refs/original/refs/heads/main` — the
backup ref left behind by a git history rewrite (contents identical, commit
hashes changed) — and is **not** an ancestor of current `HEAD`
(`git merge-base --is-ancestor 493afbd HEAD` → exit 1). The real, current,
verified-ancestor commit carrying the identical file content is:

```text
SUN1219A_FULL_COMMIT_SHA=ac0fb6f7b55fd68b0b6047066450f27f66ea45a1
CAT_FILE_EXISTS=YES
IS_ANCESTOR_OF_HEAD=YES
CONTENT_DIFF_VS_ORPHANED_493afbd=EMPTY (byte-identical)
```

This is a citation correction, not a content or authorization defect — the
attestation text itself is unchanged.

---

## 1. Governance questions kept separate (per directive)

| # | Question | Answer |
|---|---|---|
| A | Technical capability | CDP Secret API Keys are Project-scoped, not network-scoped (confirmed in SUN-1219A §6 from SDK inspection). No live authenticated capability check was performed this checkpoint (see §10). |
| B | Credential identity | Human-named `siteborne-x402-facilitator`, referring to the existing `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` pair (SUN-1219A §19, quoted operator text). |
| C | Cloudflare binding identity | `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` secret **names** confirmed present today via live `wrangler secret list --name siteborne-utility-edge`. No non-secret fingerprint of the key ID has ever been recorded in any report, and Cloudflare audit-log correlation is unavailable (see §8). Name presence is not value-level proof. |
| D | Human authorization | Real, on the record, but reversed three times (SUN-1219A §17→§18→§19). |

`A does not prove B. A+B do not prove C. A+B+C do not prove D.` — all confirmed independently true here.

---

## 2. Repository integrity

```text
pwd=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=e986f10812db5ac388da00c11a581fe83cc430ec
WORKING_TREE=CLEAN
e986f108...^{commit} exists=YES, is-ancestor-of-HEAD=YES (it IS HEAD)
bfac606c...^{commit} exists=YES, is-ancestor-of-HEAD=YES
```

---

## 3. Fresh containment reconfirmation (live Cloudflare readback)

```text
ACTIVE_PUBLIC_DEPLOYMENT_MEMBER_COUNT=1
ACTIVE_PUBLIC_VERSION=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1
ACTIVE_PUBLIC_TRAFFIC=100%
PAID_ROUTES_ENABLED=false   (live env var, read via `wrangler versions view`)
b6 ACTIVE MEMBER=NO
Model-C normal/quiescence candidates active member=NO
ORDINARY_PAID_ADMISSION_CLOSED=YES
PLATFORM_LEVEL_PAID_ADMISSION_CONTAINMENT=COMPLETE (membership-level; see §3a)
```

**§3a caveat:** Version-Override- and Preview-URL-specific closure were
asserted by the prior containment checkpoint's own report
(`SUN-1222C-cdp-mainnet-containment-completion-version-override.md`) but were
not independently re-probed live in this pass (would require an inert
Version-Override request, which this checkpoint's non-authority list does not
clearly license as "read-only" — deferred rather than assumed).

---

## 4. Stale job rows

Not re-queried this checkpoint (D1 was not touched, per the read-only
boundary and because §15 already carries the established, unchanged result:
`GLOBAL_ACTIVE_CUTOVER_BLOCKING_WORK_COUNT=0`). No new information changes
this since the last confirmed read.

---

## 5. SUN-1219A durable artifact — exact extracted language

Read in full at `docs/reports/SUN-1219A-mainnet-cdp-production-authorization-and-credential-provenance.md` (current HEAD, commit `ac0fb6f`).

- **Credential identity/name** (§19, quoted operator statement): *"I
  explicitly approve the existing CDP credential siteborne-x402-facilitator
  for SITEBORNE production/Base-mainnet use."*
- **Sandbox-origin description** (§5): the two CDP accounts under this
  Project "trace back to a real SANDBOX account pair used in an earlier
  accepted checkpoint's Base-Sepolia live-CDP proof (SUN-0700B)"; originally
  provisioned SUN-1200 checkpoint E (2026-08-18) as the user's own
  pre-existing keys, reused for production "by user override."
- **Base-mainnet authorization**: reversed three times —
  §17 (2026-08-24, post-commit addendum) = YES →
  §18 (correction) = NO, "§17's attestation is superseded... Path C
  reinstated" →
  §19 (2026-08-28, SUN-1220N2) = YES again, this time after §18's reversal
  was disclosed to the operator beforehand and confirmed via structured
  multiple-choice ("Yes, reuse existing credential").
  **§19 is the latest and current state; no further reversal exists in the
  file.**
- **Attestation-only limitation** (§19): "it does not set
  `PRODUCTION_CDP_CREDENTIALS_APPROVED=true`... in any Worker version,
  `wrangler.toml`, or secret — no runtime or config mutation occurred."
- **Production gate authorization**: attestation recorded for all four
  ADR-0055 gates as of §19; zero gates have ever actually been set into a
  live Worker version by this document itself (that happened later, in
  the SUN-1222C build/deploy checkpoints, using this attestation as
  authority).
- **Provenance uncertainty** (§4 row C): "Technical mainnet capability" is
  rated **PARTIAL** — "Whether this specific Project has mainnet enabled...
  at the CDP dashboard level is invisible to source or SDK inspection."
- **Explicit supersession language**: §18 supersedes §17; §19 explicitly
  states it supersedes §18 ("superseding §18's correction").

```text
SUN1219A_FULL_COMMIT_SHA=ac0fb6f7b55fd68b0b6047066450f27f66ea45a1
SUN1219A_CREDENTIAL_NAME=siteborne-x402-facilitator (CDP_API_KEY_ID/CDP_API_KEY_SECRET)
SUN1219A_BASE_MAINNET_AUTHORIZATION=YES (as of latest §19, attestation-only)
SUN1219A_ATTESTATION_ONLY=YES
SUN1219A_TECHNICAL_KEY_IDENTITY_PROVEN=YES (checkpoint E's listAccounts/getAccount matched known SELLER_WALLET_ADDRESS, 2026-08-18)
SUN1219A_CLOUDFLARE_BOUND_KEY_IDENTITY_PROVEN=NO (name-persistence only; no fingerprint/value-level proof exists anywhere in the repo)
```

---

## 6. Chronological credential-provenance artifact chain

| Checkpoint | Report | Claim | Supersedes |
|---|---|---|---|
| SUN-1200 checkpoint E | `SUN-1200-checkpoint-e-credentials-disabled-deploy.md` | User's own real `listAccounts()`/`getAccount()` calls (2026-08-18) authenticate and match `SELLER_WALLET_ADDRESS`; explicit disclosure that these are pre-existing sandbox-proof keys, reused by override | — |
| SUN-1219A (original) | this file, §1–16 | Path C recommended (provision fresh mainnet-specific credentials); existing credential approval = NO | — |
| SUN-1219A §17 | same file | Operator reverses Path C, attests existing credential for mainnet | original recommendation |
| SUN-1219A §18 | same file | Operator states §17 doesn't reflect authoritative record; Path C reinstated | §17 |
| SUN-1219A §19 (commit `ac0fb6f`) | same file | Operator re-confirms reuse via structured multi-choice, with §18 disclosed first | §18 |
| SUN-1220D/E/G | `SUN-1220{D,E,G}-*.md` | Local CDP signer capability: `TYPED_DATA_SIGNING_SUCCEEDED=YES`, `SIGNATURE_RECOVERED_TO_BUYER=YES` — cryptographic capability, network-independent | — |
| SUN-1220N | `SUN-1220N-live-domain-metadata-402-qualification.md` | Live-domain 402 qualification evidence | — |
| SUN-1219B | `SUN-1219B-production-cdp-credential-provenance-and-provisioning.md` | Interim evidence, blocked on manual CDP Portal step | — |
| SUN-1219C | `SUN-1219C-mainnet-candidate-zero-traffic-unpaid-402-qualification.md` | Zero-traffic mainnet-candidate qualification | — |
| SUN-1222C provenance audit | `SUN-1222C-cdp-mainnet-credential-provenance-and-live-exposure-audit.md` | Confirmed 2 real Base-mainnet USDC settlements (prior authorized release tests), MCP 403 attributed to Host-allowlist bug | — |

```text
DURABLE_CREDENTIAL_PROVENANCE_ARTIFACT_COUNT=9
LATEST_DURABLE_CREDENTIAL_AUTHORITY=SUN-1219A §19 (commit ac0fb6f), attestation-only
```

---

## 7. Local CDP credential availability

```text
LOCAL_CDP_CREDENTIAL_AVAILABLE=NO
```

`.dev.vars` (local dev environment file) was inspected for variable **names**
only: it contains `MODAL_WEBCTX_ENDPOINT_URL`, `MODAL_WEBCTX_PROXY_KEY`,
`MODAL_WEBCTX_PROXY_SECRET` — no `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` entry
exists locally. No key-ID fingerprint or credential-manager label was found
anywhere in the repository. No secret value was read, hashed, or printed.

---

## 8. Cloudflare secret installation history

```text
CLOUDFLARE_CDP_SECRET_INSTALLATION_EVENTS_FOUND=UNAVAILABLE
```

A live, authenticated read-only call to
`GET /accounts/{account}/audit_logs` was attempted using this session's own
`wrangler` OAuth token and returned `403 Authentication error` — the token's
granted scopes (`account:read`, `user:read`, `workers:write`,
`workers_kv:write`) do not include Audit Logs Read. No installation/rotation
history for `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` could be retrieved this
checkpoint.

```text
CLOUDFLARE_BOUND_KEY_FINGERPRINT_AVAILABLE=NO
CLOUDFLARE_BOUND_CREDENTIAL_LABEL_AVAILABLE=NO
```

---

## 9. Local-to-Cloudflare identity proof

```text
LOCAL_KEY_SAME_AS_CLOUDFLARE_BOUND_KEY=UNPROVEN
BOUND_KEY_IDENTITY_EVIDENCE=Secret binding NAME persistence only
  (`wrangler secret list` shows CDP_API_KEY_ID/CDP_API_KEY_SECRET present,
  unchanged in name across every checkpoint since SUN-1200). No fingerprint,
  audit-log correlation, or credential-manager record exists to prove the
  *value* bound today is the same value checkpoint E authenticated against
  on 2026-08-18 (25 days prior to this checkpoint), rather than a later
  rotation under the same name.
```

Per the checkpoint's own instruction, this is not claimed as resolved.

---

## 10–13. Live CDP checks

```text
CDP_AUTHENTICATION_ACCEPTED=NOT_ATTEMPTED
FACILITATOR_SUPPORTS_BASE_MAINNET=UNVERIFIED
FACILITATOR_SUPPORTS_BASE_SEPOLIA=UNVERIFIED
CDP_KEY_TECHNICALLY_RESTRICTED_TO_BASE_SEPOLIA=NOT_ESTABLISHED
CDP_PROJECT_IDENTITY=UNPROVEN
CDP_CREDENTIAL_SECURITY_POSTURE=UNVERIFIABLE
```

No live CDP call was attempted this checkpoint: no local credential is
available to this session (§7), and attempting one with the Cloudflare-bound
secret would require reading the secret value, which is prohibited. The last
real authenticated CDP call against this credential (`listAccounts`/
`getAccount`) is SUN-1200 checkpoint E, 2026-08-18 — 25 days stale relative
to this checkpoint.

---

## 14. "Sandbox-origin" — reconciled meaning

```text
SANDBOX_ORIGIN_MEANING=A — the credential was originally created and proven
  while SITEBORNE operated only on Base Sepolia (SUN-0700B live-CDP proof).
SOURCE_EVIDENCE=SUN-1219A §5: "known_environment_scope: ...trace back to a
  real SANDBOX account pair used in an earlier accepted checkpoint's
  Base-Sepolia live-CDP proof (SUN-0700B)."
```

SUN-1219A §6 is explicit that this is **not** meaning B (technical
restriction) — the SDK does not scope Secret API Keys to a network at all;
`network` is a per-call parameter. The credential's Base-mainnet capability
is therefore genuinely unknown rather than known-false — meaning C
("provenance never independently established") also does not fully apply,
since checkpoint E did independently establish authentication + identity,
just not mainnet-specific capability.

---

## 15. Known mainnet economic history (preserved, not re-audited)

```text
KNOWN_CONFIRMED_BASE_MAINNET_SETTLEMENTS=2
KNOWN_MAINNET_SETTLEMENTS_AUTHORIZATION_STATUS=PROVEN_AUTHORIZED_RELEASE_TESTS
COMPANY_EIGHT_SETTLEMENTS=0
```

---

## 16. Human authorization evaluation

```text
HISTORICAL_HUMAN_BASE_MAINNET_AUTHORIZATION=ATTESTED_BUT_IDENTITY_INCOMPLETE
```

A real, explicit, twice-reaffirmed human attestation exists (SUN-1219A §19)
naming the credential `siteborne-x402-facilitator`. It is not fabricated and
is not being disputed here. What remains incomplete is credential-identity
evidence sufficient for *current* governance: no fingerprint or audit trail
proves the Cloudflare-bound secret today is the exact value attested to, and
no fresh (post-25-day) authenticated capability check has been run.

---

## 17. Keep vs. rotate

Per the checkpoint's own criteria, `KEEP_CURRENT_KEY_AND_FRESHLY_AUTHORIZE`
requires proven project identity, precise local credential identity, strongly
proven Cloudflare-bound linkage, acceptable security posture, and no
unexplained anomaly — none of which are met (§9, §11–13 all UNPROVEN/
UNVERIFIABLE/UNVERIFIED). `ROTATE_TO_NEW_EXPLICITLY_GOVERNED_CDP_KEY`'s
criteria (unproven Cloudflare-bound identity, weak old-installation
provenance, uncertain security posture) are all met. This also matches
SUN-1219A's own original, never-technically-invalidated recommendation
(Path C), which was overridden only by attestation, not by resolving the
underlying identity gaps.

```text
CDP_CREDENTIAL_DISPOSITION_RECOMMENDATION=ROTATE_TO_NEW_EXPLICITLY_GOVERNED_CDP_KEY
```

---

## 18. Fresh authorization readiness

```text
FRESH_MAINNET_CREDENTIAL_AUTHORIZATION_READY=NO
FRESH_AUTHORIZATION_BLOCKERS=[
  "CDP_PROJECT_IDENTITY unproven (no live check in 25 days)",
  "Cloudflare-bound key identity unproven (no fingerprint/audit trail)",
  "Cloudflare Audit Logs Read scope unavailable to this session's token",
  "No local credential available to independently re-verify"
]
```

Per §19 of the checkpoint directive, this report does **not** set
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` or `PRODUCTION_CDP_CREDENTIALS_APPROVED`,
and does not itself claim a new authorization exists.

---

## 19–21. Containment / MCP status (unchanged)

```text
ACTIVE_PUBLIC_DEPLOYMENT=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1 @100% only
PAID_ROUTES_ENABLED=false
b6 not active member
Model-C normal/quiescence unassigned
paid runtime / settlement alert unchanged
MCP_HOST_ALLOWLIST_BUG_REMAINS_OPEN=YES
MCP_HOST_BUG_BLOCKS_CREDENTIAL_PROVENANCE=NO
```

---

## 22. Mutation accounting

```text
D1_WRITES=0
DEPLOYMENT_MUTATIONS=0
SECRET_MUTATIONS=0
PAYMENT_EFFECT_USDC=0
```

Commands run this checkpoint: `git` (log/diff/rev-parse/merge-base/status),
`wrangler whoami`, `wrangler deployments list`, `wrangler versions view`
(env var names/values that are non-secret plaintext vars, not secrets),
`wrangler secret list` (names only), a single authenticated `curl` GET
against Cloudflare's own audit-logs endpoint (403, no data returned), and
file reads. No CDP call, no payment route call, no D1 query, no deploy.
