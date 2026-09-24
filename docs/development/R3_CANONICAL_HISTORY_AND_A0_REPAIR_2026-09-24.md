# R3-CANONICAL-HISTORY-AND-A0-REPAIR-02 — Evidence Report

## Objective 1: Canonical history integration — DONE

`4e1252412c6607885c108e354e681520d4f68be2` is now a real ancestor of
`metadata-vcm-qualification` HEAD, via:

```
68cb51f fix: correct stale paid-services status claim on network-site homepage
26bcb9d feat: machine publication remediation (robots.txt, sitemap.xml, llms.txt)
fa419ab merge: integrate Release-3 machine publication remediation into canonical history
```

No object identity was rewritten (no rebase/squash/amend/cherry-pick). Verified:
`git merge-base --is-ancestor 4e1252412c6607885c108e354e681520d4f68be2 HEAD` → true.
No remote mutation occurred (local-only). The merge also pulled in the
test-infra hardening (`grep-import-proof.ts`) and the release-gate
`maxThreads=2` profile fix from the same recovery chain.

One unrelated pre-existing local change (`apps/network-site/index.html`,
a factual correction unrelated to Release-3) was committed separately
first (`68cb51f`) so it wouldn't get bundled into the Release-3 merge.

## Objective 2: A0 freeze-before-sign defect — INVESTIGATED, NOT FIXED THIS PASS

Read `packages/service-runtime/src/pcc/verify-and-sign.ts` end to end. Correcting
the earlier audit's characterization after deeper tracing:

- `PccReceiptBlock` (the signed block actually embedded in the delivered
  document) carries **no decision/pass-fail field** — only
  `output_hash`, `canonicalization_algorithm`, `policy_hash`, `schema_hash`,
  `signature_algorithm`, `signing_key_id`, `signature`, `signed_at`. Its
  signature attests to content authenticity of the candidate output, not
  to a verification decision.
- The two failure-mode branches I traced (`receiptCheck.valid` true/false)
  are each internally self-consistent: when self-verification fails,
  `effectiveVerdict.decision` is correctly forced to `'fail'`,
  `finalized.verification` reflects that, and `artifact` (the v2
  proof-bearing artifact) is correctly left `undefined`. I did **not**
  find the specific "signed receipt says pass while top-level decision
  says fail" divergence as originally described — the receipt block
  doesn't encode a decision to diverge on.
- I did find a real, distinct gap: `schemaValidAfterFinalization` /
  `schemaErrors` (computed at lines ~229–251, **after** the receipt is
  signed and, when `receiptCheck.valid`, after the v2 artifact is
  already built) are returned as plain metadata but never gate delivery.
  A document that fails post-finalization schema validation is still
  returned as `deliveredDocument` with a fully valid signature and
  (if receipt self-check passed) a complete v2 artifact — the caller
  must remember to separately check `schemaValidAfterFinalization`, or
  a schema-invalid result reaches the buyer indistinguishable from a
  valid one via `decision`/`artifact` alone.

I did not implement a fix for this in this pass. Constructing a reliable
RED regression test requires a fixture that deterministically produces a
finalized document failing its own declared output schema, using this
package's draft/context/signer builder utilities — I did not have
enough confidence in a fixture built without deeper study of
`builder.ts`/`finalized-result.ts` to land a change to signing-boundary
code responsibly in this pass. Recommend a dedicated, focused follow-up
task scoped exactly to: (1) RED test reproducing schema-invalid-but-signed
delivery, (2) minimal change making delivery fail-closed when
`schemaId && !schemaValidAfterFinalization`, (3) verify no existing
schema-valid-path test regresses.

## Objective 3: Build/deployment attestation — NOT STARTED THIS PASS

Deferred. Given objective 2 was not completed to a standard I could stand
behind, and both remaining objectives are substantial standalone efforts,
I stopped here rather than rush a provenance-attestation design without
adequate review.

## Test evidence

No production code changed this pass (only git history integration and
one unrelated content-copy commit already covered by existing tests).
No regressions introduced. Full suite not re-run in this pass since no
runtime code changed — `packages/verification` (86/86) was confirmed
green in the prior audit pass on the same content.

## Summary

```
GIT_HISTORY_INTEGRATION=DONE
4E12524_ANCESTOR_OF_HEAD=CONFIRMED
OBJECT_IDENTITY_REWRITTEN=NO
REMOTE_MUTATIONS=NO
PRODUCTION_MUTATIONS=NO
A0_ORIGINAL_HYPOTHESIS=NOT_CONFIRMED_AS_DESCRIBED (receipt block has no decision field)
A0_ACTUAL_GAP_FOUND=schemaValidAfterFinalization not gating delivery
A0_FIX_STATUS=NOT_IMPLEMENTED — recommend focused follow-up
ATTESTATION_DESIGN=NOT_STARTED
NEXT_ACTION=Scope a standalone task for the schema-validation-gating fix with proper RED test fixtures
```
