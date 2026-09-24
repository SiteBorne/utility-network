# Release-3 Source-of-Truth Recovery Report
2026-09-24

## 1. Orphan Preservation

`4e1252412c6607885c108e354e681520d4f68be2` was a loose commit object reachable
only through a transient `/tmp` worktree (not part of any tracked branch's
history). Preserved via a durable local ref:

- ORPHAN_PRESERVATION = PASS
- PRESERVED_REF = `refs/heads/recovery/release-3-4e1252412c66`
- PRESERVED_COMMIT = `4e1252412c6607885c108e354e681520d4f68be2`
- Verified resolvable independent of the `/tmp` worktree (still present, but no
  longer the only path to this commit)
- `metadata-vcm-qualification` (the checked-out branch) was not touched
- No push performed

## 2. Repository Topology (corrected)

The original audit conflated two different identifier spaces:

- **Cloudflare Worker Version IDs** (UUIDs, e.g. `3b35f9e7-6fb8-47e4-acff-c5736eff6da6`,
  `44567f1e-b47f-4047-93ca-6c8a6953bdfa`) — Cloudflare-generated, not git objects.
- **Git commit SHAs** embedded as free text inside each version's `--message`
  (e.g. `182bfb5f4473c904ddaefb113f69a15979f68144`) — the operator's claim of
  what source produced that version.

`git cat-file -t 3b35f9e7` correctly fails — it was never a git SHA. The actual
question is whether the *claimed source commits* are real and reachable.

| Cloudflare version | Claimed source commit | Exists as git object | Reachable from a branch |
|---|---|---|---|
| `44567f1e` (current 100%, "Release-3") | `4e1252412c66` | Yes | **No** — only via new recovery ref |
| `3b35f9e7` (former 100%, predecessor) | `182bfb5f4473c904ddaefb113f69a15979f68144` | Yes | Yes — `metadata-vcm-qualification` + 5 other branches |
| `369b4bf5` (older rollback version) | `eccc68447b72113241674cfdd78b661ee3547a29` | Yes | Yes — same branches |

So the predecessor's source was never actually missing — it's durable. Only the
Release-3 candidate's source was orphaned, because it was committed inside a
detached `git worktree add <path> <commit-ish>` directory whose new commits
were never merged back to a tracked branch.

## 3. Deployment Provenance Chain

| Edge | Classification | Evidence |
|---|---|---|
| SOURCE_TO_BUILD (`4e1252412c66` → dist bundle) | PARTIAL | Built in-session from this exact commit; two independent dry-run builds produced an identical bundle hash within the session. Not independently re-derivable now — Cloudflare exposes no bundle-hash artifact to diff against. |
| BUILD_TO_DEPLOYMENT (dist bundle → version `44567f1e`) | PARTIAL | `wrangler versions list` shows `Source: Unknown (version_upload)` for every version — Cloudflare does **not** cryptographically bind a version to a source commit. The commit hash in the message is operator-entered text only, no attestation. |
| DEPLOYMENT_TO_TRAFFIC (version `44567f1e` → 100% traffic) | **PROVEN** | `wrangler deployments list` independently confirms the current (most recent, 2026-09-24T22:16:25Z) deployment record shows `44567f1e` at 100%, no other version active. |
| TRAFFIC_TO_RUNTIME (100% traffic → observed behavior) | **PROVEN** | Live `/ready`, `robots.txt`, JWKS `kid=siteborne-agent-card-2026-08`, and `security.txt` all match the expected Release-3 characteristics verified earlier this session. |

- SOURCE_TO_BUILD = PARTIAL
- BUILD_TO_DEPLOYMENT = PARTIAL
- DEPLOYMENT_TO_TRAFFIC = PROVEN
- TRAFFIC_TO_RUNTIME = PROVEN
- END_TO_END_SOURCE_PROVENANCE = **PARTIAL** — the weak links are both upstream
  of Cloudflare and rest on operator self-attestation, not cryptographic
  proof. This is a general gap in the deployment pipeline (no build-manifest
  or content-hash is uploaded alongside `wrangler versions upload`), not
  evidence that the wrong code is live.

## 4. Predecessor Investigation

- PREDECESSOR_SOURCE_IDENTITY = **KNOWN** (not unknown — corrected from prior
  audit's category error)
- Predecessor Cloudflare version `3b35f9e7` claims source `182bfb5f4473c904ddaefb113f69a15979f68144`
- That commit exists in the repo and is reachable from `metadata-vcm-qualification`
  and 5 other branches — genuinely preserved history, no recovery action needed.

## 5. Decision

Production is proven (DEPLOYMENT_TO_TRAFFIC + TRAFFIC_TO_RUNTIME) to be
serving version `44567f1e`, whose claimed source is `4e1252412c66` — but that
binding itself is only PARTIAL (operator-asserted). Given:

- the orphan is now durably preserved (`recovery/release-3-4e1252412c66`),
- no counter-evidence exists suggesting a *different* source is deployed,
- the gap is a missing attestation mechanism, not a contradiction,

recommended next Git operation (**not performed — proposal only**):
merge `recovery/release-3-4e1252412c66` into `metadata-vcm-qualification` via
a fast-forward or merge commit once its diff has been reviewed against the
branch tip, so the deployed source becomes ordinary durable history instead
of a side ref.

## 6. A0 Bug (carried over, unchanged this pass)

- Location: `packages/service-runtime/src/pcc/verify-and-sign.ts:127-163`
- Finding: receipt is signed before self-verification; a post-sign
  verification failure can diverge the buyer-visible verdict from the
  already-signed artifact. No test covers this branch.
- A0_FREEZE_BEFORE_SIGN_BUG = CONFIRMED (per prior audit; not re-derived in
  this pass — no code changes made to it this pass, per instruction)

## 7. EvidenceGraph Correction (carried over, unchanged this pass)

- A15_FORMAL_EVIDENCE_GRAPH = ABSENT — the "EvidenceGraph" in the codebase is
  a paid Company Evidence Graph product, not a constitutional evidence ledger.
- DECISION_EVIDENCE_RUNTIME = ABSENT — zero references to `DecisionEvidence`.

## Final Summary

```
ORPHAN_PRESERVATION=PASS
PRESERVED_REF=refs/heads/recovery/release-3-4e1252412c66
PRODUCTION_SOURCE_COMMIT=4e1252412c6607885c108e354e681520d4f68be2
PRODUCTION_SOURCE_CONFIDENCE=PARTIAL
SOURCE_TO_BUILD=PARTIAL
BUILD_TO_DEPLOYMENT=PARTIAL
DEPLOYMENT_TO_TRAFFIC=PROVEN
TRAFFIC_TO_RUNTIME=PROVEN
END_TO_END_SOURCE_PROVENANCE=PARTIAL
PREDECESSOR_SOURCE_IDENTITY=KNOWN (182bfb5f4473c904ddaefb113f69a15979f68144, branch-reachable)
A0_FREEZE_BEFORE_SIGN_BUG=CONFIRMED
A15_FORMAL_EVIDENCE_GRAPH=ABSENT
DECISION_EVIDENCE_RUNTIME=ABSENT
MAIN_BRANCH_MUTATED=NO
PRODUCTION_MUTATED=NO
NEXT_ACTION=Review recovery/release-3-4e1252412c66 diff against metadata-vcm-qualification tip and merge if clean; add build-manifest/content-hash attestation to the deploy pipeline to close the PARTIAL provenance gap; write regression test for verify-and-sign.ts freeze-before-sign ordering.
```
