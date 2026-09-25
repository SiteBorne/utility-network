# R3 A0 Production Remediation Preflight

Mission: R3-A0-PRODUCTION-REMEDIATION-PREFLIGHT-08
Status: PRE-DEPLOYMENT QUALIFICATION ONLY. No deploy, push, or Cloudflare mutation performed.

## Phase 0 — Preflight

- Repository HEAD: `892ffc1527ab868ff6f65902eb8ead649bca324b` on `metadata-vcm-qualification`, clean tree.
- Deployed source (claimed): `4e1252412c6607885c108e354e681520d4f68be2`
- A0 fix commit: `cd7ed96f720bb65c77029e97ab4e11edc0b5f333`

## Phase 1-2 — Minimal Candidate Construction

Candidate branch `release-3-a0-candidate` built in isolated worktree `/tmp/r3-a0-candidate`:

```
4e1252412c66 (deployed source)
  + cherry-pick cd7ed96f (A0 fix)
  = 5ecedf5 (candidate HEAD)
```

Diff vs. deployed source is exactly 2 files:
- `packages/service-runtime/src/pcc/verify-and-sign.ts` (+39/-6)
- `packages/service-runtime/src/tests/a0-finalization-schema-gate.test.ts` (new, +197)

`b463720f` (A2A regression) and `892ffc1` (release tooling) were **excluded** from the candidate per mission constraint — neither touches runtime Worker code, so their absence is correct and deliberate.

UNRELATED_RUNTIME_CHANGES=0

## Phase 3-4 — Re-test on Candidate

Full re-test performed from a clean install in the isolated worktree (not reused from prior sessions):

```
pnpm install --frozen-lockfile   → PASS
npx vitest run (service-runtime) → 21/22 files, 308/3 passed/skipped, 0 failed
```

A0 invariants re-confirmed on the candidate:
- invalid finalized result cannot be signed: PASS
- invalid finalized result cannot be delivered: PASS
- valid result signing/self-verify: PASS

## Phase 5 — Security Audit

AUTHORIZATION_CHANGE=NO
PAYMENT_CHANGE=NO
SETTLEMENT_CHANGE=NO
KEY_CHANGE=NO
AGENT_CARD_CHANGE=NO
DNS_CHANGE=NO
CLOUDFLARE_CONFIG_CHANGE=NO

## Phase 6 — Artifact Identity

Two independent `wrangler deploy --dry-run` builds from the identical candidate source:

```
Build 1 aggregate SHA-256: b4e74471bf045a679092b53cc523ea88e3f83ec065ec88d0c4ebed9e5ff15ead
Build 2 aggregate SHA-256: b4e74471bf045a679092b53cc523ea88e3f83ec065ec88d0c4ebed9e5ff15ead
```
MATCH — build is reproducible.

LOCAL_BUILD_TO_UPLOAD_BINDING=PARTIAL — the dry-run proves the local build is deterministic and matches itself across runs; it does not cryptographically prove the *eventual uploaded* bundle is byte-identical to this one, since `wrangler versions upload` does not expose a content digest of what it actually stores. This limitation is unchanged from prior missions and is not resolved by this preflight.

## Phase 7 — Current Production State (read-only)

```
CURRENT_PRODUCTION_VERSION=44567f1e-b47f-4047-93ca-6c8a6953bdfa
CURRENT_PRODUCTION_TRAFFIC=100%
CURRENT_PRODUCTION_SOURCE_CLAIM=4e1252412c6607885c108e354e681520d4f68be2
ROLLBACK_VERSION_AVAILABLE=YES (3b35f9e7-6fb8-47e4-acff-c5736eff6da6, out of active deployment but present in version history; redeployable)
```

## Phase 8-9 — Deployment Plan / Rollback

If authorized, the proposed sequence is:

1. `wrangler versions upload` from `/tmp/r3-a0-candidate/apps/edge-api` → produces new version (source `5ecedf5`, tag `a0-finalization-schema-gate-01`)
2. `wrangler versions deploy <new-version>@100 44567f1e@0` (retire current, keep it in history for rollback)
3. Read back `/ready`, run a synthetic invalid-schema case against a live 0%-traffic override to prove the gate is active in production (mirrors the read-only qualification method used for the original Release-3 cutover)
4. Promote to 100% only after step 3 passes

Rollback: `wrangler versions deploy 44567f1e@100 <new-version>@0` restores current behavior immediately; no data migration is involved since this is a pure code-path change.

## Final Summary

```
CANDIDATE_COMMITS=4e1252412c66,cd7ed96f
CANDIDATE_HEAD=5ecedf5
UNRELATED_RUNTIME_CHANGES=0
TEST_RESULT=308 passed, 3 skipped, 0 failed
BUILD_REPRODUCIBLE=YES
ARTIFACT_HASH=b4e74471bf045a679092b53cc523ea88e3f83ec065ec88d0c4ebed9e5ff15ead
LOCAL_BUILD_TO_UPLOAD_BINDING=PARTIAL
AUTHORIZATION_CHANGE=NO
PAYMENT_CHANGE=NO
KEY_CHANGE=NO
CURRENT_PRODUCTION_VERSION=44567f1e-b47f-4047-93ca-6c8a6953bdfa
ROLLBACK_VERSION_AVAILABLE=YES
PRODUCTION_A0_FIX=NOT_DEPLOYED
PRODUCTION_MUTATIONS_PERFORMED=NO
REMOTE_MUTATIONS_PERFORMED=NO
DEPLOYMENT_READY=YES
EXACT_AUTHORIZATION_REQUIRED=Upload candidate 5ecedf5 (4e1252412c66 + cd7ed96f) as a new Worker version, deploy it at 0% alongside current 44567f1e@100 for qualification, then promote to 100% only after live read-back confirms the schema gate is active.
BLOCKERS=None found. Awaiting explicit deployment authorization.
```
