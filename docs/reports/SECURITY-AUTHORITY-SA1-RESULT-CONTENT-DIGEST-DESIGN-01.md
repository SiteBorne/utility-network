# SECURITY-AUTHORITY-SA1-RESULT-CONTENT-DIGEST-DESIGN-01

Status: `PASS_WITH_FINDINGS` (independent review completed, §12; no new P0/P1).
Mode: shadow design and local primitives only. No production behavior, contract,
schema, secret, or cloud change. Nothing is wired: no runtime path imports any
file added or changed here.

Follows `REPLAY-CALLER-BINDING-SHADOW-AUDIT-01` (`d6f31b6`) and
`SECURITY-AUTHORITY-SA1-RESULT-SHADOW-ENVELOPE-DESIGN-01` (`d334923`). All
repository claims below were re-read from source at `d334923`, not carried from
prior narration.

## 0. Result block

```
SECURITY_AUTHORITY_SA1_RESULT_CONTENT_DIGEST_DESIGN_01=PASS_WITH_FINDINGS

STARTING_HEAD=d33492340e6ac5677f7141beac1259c6a3158f77
FINAL_LOCAL_HEAD=<the commit that contains this report; a commit cannot embed its own SHA -- see `git log -1` / the checkpoint summary>
WORKING_TREE=clean before this checkpoint; clean after the local commit

RESULT_CONTENT_DIGEST_REPRESENTATION=stored form of CachedResult.body (JSON.parse(JSON.stringify(body))), i.e. exactly what is written to x402_service_results.result_json and released by replay
RESULT_CONTENT_DIGEST_ALGORITHM=SHA-256 over the governed JCS (RFC 8785, @siteborne/pcc-schema) canonical form of { content, domain }
RESULT_CONTENT_DIGEST_VERSION=result_content_digest.v1 (string form result_content_digest.v1:sha256:<64 hex>)
RESULT_CONTENT_DIGEST_CANONICALIZATION=existing governed canonicalizer, reused (packages/vcm/src/canonical.ts); no second canonicalization system; own __proto__ keys, >64 nested containers, >2,000,000 canonical bytes, non-serializable and unsafe-integer content are refused with a typed error
RESULT_CONTENT_DIGEST_PERSIST_BOUNDARY=DESIGNED_NOT_WIRED (and possibly unnecessary for the Workflow path, section 10): D1ResultReceiptPersistence.persistResult, immediately before results.create, from input.cachedResult.body; additive carrier key outside body inside result_json (section 7)
RESULT_CONTENT_DIGEST_LEGACY_BEHAVIOR=historical rows carry no digest -> envelope value null -> comparator treats null as "not bound" (never a mismatch); classification of Release-1 traffic unchanged

SUBJECT_DIGEST_PRIMITIVE=HMAC-SHA-256 (standard WebCrypto) over the UTF-8 of the JCS canonical form of { domain, key_version, subject_type, value }; 64 lowercase hex
SUBJECT_DIGEST_DOMAIN_SEPARATION=domain tag + subject_type + key_version inside the MAC input; wallet-shaped values refused for caller/signer axes
SUBJECT_DIGEST_KEY_VERSION_MODEL=caller supplies { version, CryptoKey }; version ^[a-z0-9][a-z0-9._-]{0,31}$ bound into the MAC input and carried on the slot; digests comparable only within one version
SUBJECT_DIGEST_KEY_PROVISIONING=NONE_EXISTS (no HMAC or keyed-digest primitive exists anywhere in production code); interface only; real provisioning is an SA-2 prerequisite; no key hard-coded, no secret added
RAW_SUBJECT_PERSISTED=NO (new code persists nothing)
RAW_SUBJECT_TELEMETRY_EXPOSED=NO

REPLAY_BINDING_FIELDS=21
REPLAY_DIGEST_CHANGED=NO

SHADOW_RESULT_USED_FOR_ENFORCEMENT=NO
SHADOW_RESULT_USED_FOR_EXECUTION=NO
SHADOW_RESULT_USED_FOR_SETTLEMENT=NO

PUBLIC_SECURITY_METADATA_CHANGED=NO
PUBLIC_CONTRACT_CHANGES=0
SOURCE_BEHAVIOR_CHANGES=0

RESULT_CONTENT_P2_STATUS=NARROWED, not closed. Local primitive + spec delivered and tested; unwired, no key. The prior finding's wording was wrong and is corrected twice (section 10): the Workflow path already persists a digest of the released body that is never verified at release (P3 for that path); the Nevermined-recovery path has no such digest (P2 remains; reviewer-reported, not independently re-verified)

NEW_P0_FINDINGS=0
NEW_P1_FINDINGS=0
NEW_P2_FINDINGS=1 (canonicalizer collapses own __proto__; pre-existing; section 11)
TOTAL_RELEVANT_P0_FINDINGS=0
TOTAL_RELEVANT_P1_FINDINGS=1 (result release authorized by request-tuple possession; carried, NOT reduced by this checkpoint)
TOTAL_RELEVANT_P2_FINDINGS=4 (2 carried from the replay audit + the narrowed result-content finding + the new canonicalizer finding). P3/INFO items are in section 11 and are not part of this tally

FOCUSED_TESTS=79/79 (shadow 33 + result-content-digest 30 + subject-digest 16)
AFFECTED_WIDER_TESTS=packages/vcm 312/312 (24 files); apps/edge-api tests importing @siteborne/vcm 74/74 (6 files); packages/protocol-x402 546/546 (36 files; replay code unchanged); migrations:verify (scripts/d1-verify.ts) passed. Full repository suite: NOT_RUN
TYPECHECK=vcm tsc rc=0; edge-api tsc rc=0
ESLINT=rc=0 on the 6 changed/new files
PRETTIER=pass on packages/vcm/src/security/*.ts
SECRET_SCAN=repo working-tree scan OK (1711 files); gitleaks on packages/vcm/src/security: no leaks. A raw `gitleaks dir .` reports 5 findings, all in git-ignored, untracked, pre-existing paths (.dev.vars, .superpowers/sdd/** build logs); none in any file of this checkpoint

WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
PUBLIC_TRAFFIC_MUTATIONS=0
CONTINUATION_HOST_DEPLOYMENTS=0
ALERT_WORKER_DEPLOYMENTS=0
CLOUD_SECRET_MUTATIONS=0
PRODUCTION_D1_WRITES=0
REAL_PAYMENT_ATTEMPTS=0

REPORT_PATH=docs/reports/SECURITY-AUTHORITY-SA1-RESULT-CONTENT-DIGEST-DESIGN-01.md
NEXT_RECOMMENDED_CHECKPOINT=SECURITY-AUTHORITY-SA1-RESULT-BODY-INTEGRITY-READONLY-AUDIT-01 (local/read-only: establish from source and in-process tests whether the already-persisted buyer_receipt_hash / verification_receipt_hash can anchor the released body with no new write path, before deciding whether a new persisted digest is needed at all; section 14)
```

## 1. State verification

At start: `HEAD=d33492340e6ac5677f7141beac1259c6a3158f77`, branch
`metadata-vcm-qualification`, `git status` empty. `d6f31b6`, `d334923` and
`02a2102` are all ancestors of HEAD; HEAD is `d334923` itself. No later Security
Authority work exists. The prior assumptions hold, with one correction (§10).

## 2. Result path, traced from source

| Stage                                          | Where                                                                                                          | Finding                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Service output → receipt hash                  | `packages/verification/src/receipt/issue.ts:19`                                                                | `output_hash = contentHash(canonicalize(candidate.output))` = `sha256:<hex>` of the service candidate output only. Signed into the PCC.                                                                                                                                                                                                                                                          |
| PCC / result construction                      | `paid-continuation-workflow.ts:1179-1203`                                                                      | `cachedResult = { status: 200, body: verificationReceipt, settleResponse, durableEvidence }`. **In the Workflow path `body` is the already-signed PCC document.**                                                                                                                                                                                                                                |
| Persistence (production)                       | `production-dependencies.ts` `D1ResultReceiptPersistence.persistResult` → `X402ServiceResultRepository.create` | Create-if-absent; `JSON.stringify(cachedResult)` into `x402_service_results.result_json` (migration 0004, PK `job_id`).                                                                                                                                                                                                                                                                          |
| Row rewrite                                    | `production-dependencies.ts` `persistReceipt` → `finalize`                                                     | **The row is mutated after creation:** `{...existing, receipt_persisted, receipt_id, pcc, durableEvidence}`. `body` and `status` are preserved by the spread; the row as a whole is not stable.                                                                                                                                                                                                  |
| Other body writer                              | `x402-service.ts:1001`                                                                                         | `results.finalize(job.id, {status:200, body, settleResponse})` in Nevermined recovery of a pre-existing pending draft. Overwrites the entire row (an additive carrier key would be dropped). The draft has no `body` and is never released (`reconstructFromJob` returns null for it).                                                                                                           |
| Replay release                                 | `x402-service.ts:814-849`                                                                                      | `c.json(cached.body, cached.status)` plus a `PAYMENT-RESPONSE` header from `cached.settleResponse`. **`body` is the released content.**                                                                                                                                                                                                                                                          |
| Existing released-body digests (Workflow path) | `payment-finalization.ts:92,119`; `paid-continuation-workflow.ts:1155`; migration 0010                         | `buyer_receipt_hash = hashPaymentObject(input.pcc)` and `verification_receipt_hash = hashPaymentObject(verificationReceipt)` are sha256(JCS(released body)), persisted in `payment_service_link_evidence` (the latter is inside `link_hash`, echoed to the buyer as `link_id`). Their only read is an idempotency compare (`payment-finalization.ts:140`); **nothing verifies them at release.** |
| Pre-existing persisted digest                  | migration 0010 `payment_service_link_evidence.service_output_hash` (NOT NULL, keyed by `job_id`)               | Equals PCC `output_hash`. Persisted per paid job, but covers `candidate.output` only, not the released body, and is not linked to any release decision.                                                                                                                                                                                                                                          |

No stop condition triggered: there are two representations (row vs. released
body, and `service_output_hash` vs. body), but only one is the thing replay
releases, so there is a governed winner for the question "is this the same
released content".

## 3. Decision: what is digested, and why

**Digested:** the stored form of `CachedResult.body`.

| Candidate                             | Verdict                        | Evidence                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Raw provider bytes                    | Rejected                       | Not persisted or reachable at the release boundary; not what is released.                                                                                                                                                      |
| `service_output_hash` / `output_hash` | Rejected as the release digest | Hash of `candidate.output`, not of the released body. Kept separate: it stays the payment↔service link and PCC signature input. Folding it in would couple content identity to payment/PCC authority state.                   |
| Full cached row (`result_json`)       | Rejected                       | Mutated by `persistReceipt`/`finalize`; hashing it at persist time cannot equal the row later (asserted by test "not circular with the PCC").                                                                                  |
| PCC document / signature              | Not the input                  | In the Workflow path it happens to be the body, so the digest covers it _as content_, computed **after** signing and never embedded in it. The digest signs nothing and feeds nothing back. PCC remains proof, not permission. |
| **Stored form of `body`**             | **Chosen**                     | It is what replay releases in both writer paths, is immutable in both (no path modifies an existing body), and its stored form is a deterministic function of the in-memory value.                                             |

**Deliberately excluded:** `status` (both writers hard-code 200; no non-200 is
ever cached), `settleResponse` (the payment response, payment authority state),
`durableEvidence`, `receipt_persisted`/`receipt_id`, timestamps added by the
storage wrapper, job/service/payment identifiers not already inside `body`.
Contextual binding (job, result ref, payment binding) belongs to the envelope.

Residual (recorded, not hidden): `status` and the `PAYMENT-RESPONSE` header are
released by the same path but are outside the content digest. The header echoes
`payer`, `transaction`, `link_id` and `payment_identifier` to whoever holds the
replay tuple (part of the already-recorded result-confidentiality finding). It
is also an **integrity** gap: `transaction`, `link_id` and `amount` are bound by
nothing in this design, so a swapped header would still yield a content-digest
match. Recorded as a P3 and an SA-2 prerequisite (section 11).

## 4. ResultContentDigest v1

- **String:** `result_content_digest.v<N>:sha256:<64 lowercase hex>`.
  Self-describing so a later algorithm cannot be mistaken for v1.
- **Preimage:** SHA-256 (via the governed `hashCanonical`) of the JCS canonical
  form of
  `{ "content": <stored form>, "domain": "siteborne.result_content_digest.v1" }`.
  Domain separation follows repo convention (a version tag inside the canonical
  object, cf. `binding_version`), so it cannot equal a `hashPaymentObject`, a
  binding digest, or a PCC `output_hash` over the same JSON (asserted).
- **Stored form:** `JSON.parse(JSON.stringify(x))`. digest(in-memory at persist)
  == digest(row read back at release) by construction. It normalizes exactly
  what the database normalizes: `NaN`/`Infinity` → `null`, `undefined`/function
  values dropped, `Date` → ISO string, `-0` → `0`.
- **Refused (typed error, code only, never the content):**
  `RESULT_CONTENT_NOT_SERIALIZABLE` (root `undefined`, function, symbol, bigint,
  cyclic, throwing `toJSON`), `RESULT_CONTENT_UNSUPPORTED_STRUCTURE` (own
  `__proto__` key; more than 64 nested containers),
  `RESULT_CONTENT_NOT_CANONICALIZABLE` (integer beyond the JCS safe range:
  lossy), `RESULT_CONTENT_TOO_LARGE` (> 2,000,000 canonical bytes; a design
  ceiling chosen to stay within one D1 row, not derived from repo evidence).
- **Absent vs null:** "no digest" is the envelope value `null`; a JSON `null`
  body is content with a real digest.
- **Unicode:** no normalization; NFC and NFD are distinct content; a lone
  surrogate is distinct from U+FFFD.
- **Versioning:** the envelope accepts any well-formed `v<N>`; only v1 is
  computed. Two digests of different versions are _incomparable_, not a mismatch
  (`RESULT_CONTENT_DIGEST_VERSION_INCOMPARABLE`, +1 reason code, 25 → 26).
- **Content-verified signal:** the evaluation carries `content_digest_outcome`
  (`BOUND_MATCH | BOUND_MISMATCH | ABSENT | INCOMPARABLE | NOT_EVALUATED`),
  independent of `classification`. A subject-driven `MATCH` with an absent or
  incomparable digest is still `MATCH`, but its outcome is
  `ABSENT`/`INCOMPARABLE`, so it can never be read as "content verified";
  relabelling a stored digest's version cannot manufacture `BOUND_MATCH`. Added
  after review finding F1; also in the allowlisted telemetry record.
- **Read-side:** `compareResultContentDigest(content, bound)` is total and
  returns
  `MATCH | MISMATCH | MALFORMED_DIGEST | UNSUPPORTED_VERSION | CONTENT_UNDIGESTABLE`.

## 5. What the governed canonicalizer actually does (empirical probe)

Run against `packages/vcm/src/canonical.ts` → `@siteborne/pcc-schema`
`canonicalize` (the reviewer independently re-probed `canonical-json@0.4.0` and
confirmed the `__proto__` and `undefined` rows). It is JCS-style, not strictly
RFC 8785; earlier wording in code comments and this report that called it plain
RFC 8785 was corrected. The probe file was temporary and removed; the table is
reproduced by the tests.

| Input                                | Result                                                                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root `undefined`                     | throws                                                                                                                                                                                                            |
| nested `undefined`, function value   | **silently dropped**                                                                                                                                                                                              |
| `NaN`, `2^60`, `BigInt`, cyclic      | throws                                                                                                                                                                                                            |
| `Date`                               | ISO string                                                                                                                                                                                                        |
| `-0`                                 | `0`                                                                                                                                                                                                               |
| integer-like keys (`{"10":…,"2":…}`) | emitted in **numeric** order (`"2"` before `"10"`): deterministic and injective, but **not RFC 8785 byte order** (UTF-16 code-unit order). A third-party RFC 8785 implementation would compute a different digest |
| own `__proto__` key                  | **silently dropped**: `{"__proto__":{"x":1},"a":1}` and `{"a":1}` canonicalize identically                                                                                                                        |
| NFC vs NFD, lone surrogate, astral   | not normalized; lone surrogate emitted as `\ud800`                                                                                                                                                                |

Two consequences. (1) The new digest refuses own `__proto__` keys rather than
inherit the collision. (2) The comment at
`paid-continuation-workflow.ts:1119-1127` says canonical-json "throws on
`undefined` (root-level or nested)"; the probe shows only root `undefined`
throws. That is a documentation inaccuracy, not a defect in that code, and it
was left untouched.

## 6. SubjectDigest v1

- **Primitive:** HMAC-SHA-256 through standard WebCrypto. No novel cryptography,
  no unkeyed fallback. Message = UTF-8 of the JCS canonical form of
  `{ domain: "siteborne.subject_digest.v1", key_version, subject_type, value }`;
  canonical JSON is injective over these fields, so type and version are bound
  in and one type's digest cannot be relabelled as another's.
- **Output:** `{ subject_digest: 64 lowercase hex, digest_key_version }` and
  nothing else. Raw value and key are never returned, logged, or echoed; errors
  carry a code.
- **Key interface:** caller supplies `{ version, key: CryptoKey }`. The key must
  be a `secret` HMAC/SHA-256 key of at least 256 bits with the `sign` usage;
  anything else is `SUBJECT_KEY_INVALID`. The module never reads env, secrets,
  or bindings and never calls `importKey`/`exportKey`/`generateKey` (asserted by
  the gate). Non-extractable keys work.
- **Per-type canonical value:** `payer_subject` = EVM address, lowercased (case
  is not identity); `authenticated_caller_subject` / `request_signer_subject` =
  opaque identifier exactly as issued. A wallet-shaped value is refused for the
  caller and signer axes (wallet identity is not caller identity). 32-byte-hex
  and JWT-shaped values are refused everywhere. **These shape checks are defense
  in depth only:** an identifier-shaped credential would pass, so whatever
  supplies a subject must supply a principal identifier, never a credential.
- **Rotation:** digests are comparable only within one key version; a candidate
  under a different version is `SUBJECT_KEY_VERSION_INCOMPARABLE` (existing
  comparator behavior, now exercised with real digests). Recomputing under an
  old version needs a key resolver for old keys. That resolver does not exist
  and is not modelled.
- **Comparison:** the comparator uses `===` on digests. Constant-time comparison
  is an enforcement-time concern (SA-2 prerequisite), not added to the shadow
  path.
- **Provisioning:** none exists. Classified as an SA-2 prerequisite. No key is
  hard-coded; tests generate random non-extractable keys, plus one clearly
  patterned test-only vector for an independent known-answer check computed with
  `node:crypto`.

## 7. Envelope integration and persist boundary (design; not implemented)

1. **Owner:** `D1ResultReceiptPersistence.persistResult` (production Workflow
   path). The only other body writer is the Nevermined recovery `finalize`.
2. **Point:** immediately before `results.create(...)`, from
   `input.cachedResult.body`, the same object `JSON.stringify` writes.
3. **Input:** the stored form of `body` (§4).
4. **Atomicity:** an additive key beside `status`/`body`/`settleResponse` inside
   the same `result_json`, written by the same single `INSERT`, is atomic with
   the result and needs no migration. It must live **outside** `body` or the
   digest would include itself. `persistReceipt` spreads `...existing` (keeps
   it); the Nevermined `finalize` overwrites the whole row (drops it), so that
   path needs its own handling or an explicit "no digest" outcome.
5. **Historical rows:** no key → `null` → "not bound". Optionally derivable on
   demand from `body`, but a derived value has no independent anchor and must be
   labelled so.
6. **Construction failure:** a typed error. The call site must isolate it
   (try/catch, emit `ERROR`-class shadow telemetry, continue). An exception
   inside the `persist-result` step would change Release-1 behavior: it maps to
   `persistence_failed_after_settlement`, a retryable-state terminal
   (`paid-continuation-workflow.ts:1217-1226`). A shadow failure must never
   become a production deny or retry path.
7. **Release-1 effect in this checkpoint:** none. Nothing is wired.

Honest limit: a digest stored in the same D1 row detects accidental or
non-atomic divergence (a rewrite, an overwrite, a logic bug) and fixes _which_
content was bound. It does **not** defend against an adversary who can write D1,
who can rewrite both. In the Workflow path the signed PCC is the stronger anchor
for the body's authenticity; this digest does not replace it.

## 8. Threat / failure coverage → tests

| Case                                                                               | Test (file: name)                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| same → same; changed / nested / added / removed / retyped → different              | result-content-digest: "deterministic…", "changes when any value…"                                                                                     |
| semantically irrelevant vs meaningful order                                        | "ignores object key order but respects array order"                                                                                                    |
| null / empty / falsy; absent ≠ null                                                | "gives null, empty, and falsy contents distinct…"                                                                                                      |
| malformed / non-serializable; lossy integer                                        | "rejects content that cannot be serialized…", "rejects an integer outside the JCS safe range…"                                                         |
| oversized (exact boundary, bytes not chars); hostile depth                         | "bounds size…", "bounds nesting depth…"                                                                                                                |
| Unicode; storage round trip                                                        | "applies no Unicode normalization…", "digest(persist-time value) equals digest(value read back from a D1-shaped row)…", "matches an independent hash…" |
| own `__proto__` collision (shows the base collapse, then the refusal)              | "refuses an own **proto** key…"                                                                                                                        |
| same content / different ref; same ref / different content                         | "context binding lives in the envelope…"                                                                                                               |
| content vs payment digest vs PCC hash                                              | "cannot be confused with a payment digest or a PCC output_hash…" (uses the real `hashPaymentObject`)                                                   |
| circularity / row rewrite                                                          | "is not circular with the PCC…" (models the real `persistReceipt` spread)                                                                              |
| subject: determinism, keyed, type/version separation, KAT, rejection, non-leakage  | subject-digest: all 16                                                                                                                                 |
| envelope accepts good, rejects malformed, legacy null, version-incomparable, drift | result-content-digest: "envelope integration (shadow only)" ×7 (incl. `content_digest_outcome`)                                                        |
| Release-1 expected outcomes unchanged                                              | existing `EXPECTED_RELEASE1_SHADOW_OUTCOMES` matrix, still 6/6 passing                                                                                 |

## 9. Non-interference

The gate is generalized to an explicit SA-1 file allowlist (exact repo-relative
paths) scanned over `packages`, `apps`, `services`, `scripts`, and made
non-vacuous: it must visit > 200 files **and** five named live paths
(`x402-service.ts`, `production-dependencies.ts`,
`paid-continuation-workflow.ts`, `x402-quotes.ts`, `replay/binding.ts`).

**Mutation protocol** (run in an `os.tmpdir()` sandbox, so nothing is ever
planted in the repo or git history): baseline scan is clean and sees the sandbox
file → eight different planted reference kinds (plus a JSON wiring file) each
make the gate fail with exactly that file → removing the mutation makes it pass
→ an allowlisted path is the only exemption.

Further gates: the primitives import only `../canonical` and use no clock,
randomness, environment, or network (`crypto.subtle.sign` is the only WebCrypto
call in either); no SA-1 source contains authority vocabulary (case-insensitive:
allow/deny/grant/ permit/authorized, comments stripped); no migration, public
schema, PCC schema, or production env/wrangler file mentions the new terms; the
barrels do not export them; the public-metadata surfaces do not mention them.

Limit of the proof: a static scan proves _no reference_ under the scanned roots,
not runtime behavior, and does not see a file type or root it does not scan.

## 10. Correction to the previous checkpoint (corrected twice)

`SECURITY-AUTHORITY-SA1-RESULT-SHADOW-ENVELOPE-DESIGN-01` §18 stated "Release 1
persists no result content digest". That was overstated, in two steps:

1. **First correction (this checkpoint, from source):** Release 1 persists
   `payment_service_link_evidence.service_output_hash` per paid job (migration
   0010). It digests the PCC `candidate.output`, not the released body.
2. **Second correction (independent review F2, re-verified from source):** in
   the Workflow path Release 1 also persists digests of _exactly the released
   body_: `buyer_receipt_hash = hashPaymentObject(pcc)`
   (`payment-finalization.ts:92`) and
   `verification_receipt_hash = hashPaymentObject(verificationReceipt)`
   (`paid-continuation-workflow.ts:1155`, folded into `link_hash`). Neither is
   compared to the body at release; the only read is an idempotency check
   (`payment-finalization.ts:140`).

Accurate statement of the gap: **in the Workflow path an existing digest of the
released body is never verified at release (P3); in the Nevermined-recovery path
(unsigned body, only `output_hash` stored) no digest of the released body exists
(P2, per the reviewer; not independently re-verified here); and no digest of any
kind is linked to the result-authorization envelope.**

Consequence for the design: a read-side comparator can reuse
`hashPaymentObject(body)` against the stored `buyer_receipt_hash` with **no
migration and no new write path** for Workflow-path rows. The new
`ResultContentDigest` remains useful as a domain-separated, versioned, envelope-
native value, but whether it is needed at all for the Workflow path is now an
open question, and is the recommended next checkpoint (section 14). A correction
note was appended to the previous report.

Also noted: the previous envelope requires bare 64-hex for
`payment_binding_digest` and `payment_identifier_digest`, while the real replay
binding digest is `sha256:<hex>` (`hashPaymentObject`). Wiring must adapt the
format at one boundary or the shadow would report spurious
`ENVELOPE_PAYMENT_BINDING_MISMATCH`. Shadow-only, so noisy rather than unsafe.
Left unchanged.

## 11. Findings

**No new P0. No new P1.** The carried P1 (result release authorized by
possession of the request tuple) is untouched: authenticated caller identity is
still honestly absent and nothing here enforces anything.

| #   | Sev                                | Finding                                                                                                                                                                                                                                                                                                                                                                                 | Disposition                                                                                                                                                 |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | **P2** (new)                       | The governed canonicalizer silently drops an own `__proto__` key, so `{"__proto__":{..},"a":1}` and `{"a":1}` hash identically. Pre-existing; it also governs PCC `output_hash`, `hashPaymentObject` and binding digests. Exploitability is low (needs attacker-influenced JSON in signed content and a consumer that reads that key) but it is a signed-evidence integrity blind spot. | New digest refuses such input (tested). Existing digests **not** changed: doing so alters PCC hashes/wire, out of scope. Needs its own decision checkpoint. |
| N2  | P3                                 | Same canonicalizer orders integer-like keys numerically, not by RFC 8785 code-unit order. Deterministic and injective; an interop and labelling inaccuracy only.                                                                                                                                                                                                                        | Characterization test added; wording corrected.                                                                                                             |
| N3  | P3 (was P2 for future enforcement) | A subject-driven `MATCH` with an absent or incomparable content digest was indistinguishable from a content-verified `MATCH` (review F1).                                                                                                                                                                                                                                               | **Fixed locally:** `content_digest_outcome` added and tested; enforcement must not treat anything but `BOUND_MATCH` as content-verified.                    |
| N4  | P3                                 | `status` and the `PAYMENT-RESPONSE` header (`transaction`, `link_id`, `amount`) are outside the content digest: their integrity is unbound, not only their confidentiality.                                                                                                                                                                                                             | Documented; SA-2 prerequisite.                                                                                                                              |
| N5  | P3                                 | Subject secret-shape refusals are heuristic: a legitimate 64-hex principal id is falsely refused; identifier-shaped credentials (128-hex, API-key style, base64url) pass. Only the HMAC leaves the function, so no raw value escapes.                                                                                                                                                   | Characterized in tests; supplier contract documented.                                                                                                       |
| N6  | P3                                 | The non-interference gate is a tripwire, not a proof: string concatenation and glob imports bypass a text scan.                                                                                                                                                                                                                                                                         | Hardened (case-insensitive; `.json/.jsonc/.toml/.cjs/.cts/.jsx/.py` scanned; mutation-tested). Residual stated.                                             |
| N7  | INFO                               | `paid-continuation-workflow.ts:1119-1127` says canonical-json throws on nested `undefined`; only root `undefined` throws.                                                                                                                                                                                                                                                               | Comment left untouched; noted here.                                                                                                                         |
| N8  | INFO                               | Two review-flagged tests were tautological (self-comparison) and one assertion was a weak regex union.                                                                                                                                                                                                                                                                                  | Rewritten against independent expectations (a D1-shaped row round trip, an independent hash, pinned exact codes, distinct objects).                         |

Tally, stated so it can be checked: `NEW_P0=0`, `NEW_P1=0`, `NEW_P2=1` (N1).
`TOTAL_RELEVANT` `P0=0`, `P1=1`, `P2=4`. The result-content P2 is counted as one
open, narrowed finding (it is P3 for the Workflow path but P2 for the
Nevermined- recovery path, which I have not independently re-verified).

## 12. Independent review record

An independent read-only reviewer was given the change, the ten narrow
questions, and instructions to verify every repository claim from source rather
than trust this report. Verdict: `REVIEW_RECOMMENDS_RUNTIME_CHANGE=NO`; no new
P0/P1.

| Q   | Verdict      | Note                                                                                                                                               |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | FINDING (P3) | Representation confirmed authoritative. Header/`status` integrity unbound (N4).                                                                    |
| 2   | PASS         | No semantic collision beyond the refused `__proto__` case; everything the round trip normalizes is also normalized by the release path (`c.json`). |
| 3   | PASS         | digest(persist) == digest(read); no float issue. Two tests were tautological (N8, fixed).                                                          |
| 4   | PASS         | No circularity. Constraint recorded: the digest must never be embedded in the PCC/body.                                                            |
| 5   | FINDING (P3) | HMAC construction sound; shape heuristics bypassable (N5).                                                                                         |
| 6   | PASS         | Nothing raw persisted/returned/echoed; existing raw `payment_identifier` column preserved, neither worsened nor improved.                          |
| 7   | FINDING (P3) | No runtime change; gate is a tripwire (N6).                                                                                                        |
| 8   | PASS         | No public surface, PCC wire, or schema change; telemetry still allowlisted.                                                                        |
| 9   | FINDING      | Version relabel could not create a false match, but incomparable still read as `MATCH` (N3, fixed).                                                |
| 10  | FINDING      | The P2 is narrowed, not closed, and the first correction was itself incomplete (§10).                                                              |

Also confirmed by the reviewer: the rule that a digest failure must not
propagate into the Workflow `persist-result` step is correct (`persist-result`
retries 3x with backoff, then `terminal('persistence_failed_after_settlement')`
after settlement, `paid-continuation-workflow.ts:388-391, 1206-1226`); the rule
should also cover async rejection and CPU cost (the digest canonicalizes twice
inside a 10 s step).

Applied from the review: F1 (outcome field), F2 (§2/§10 correction), F3 (§3), F4
(characterization test and wording), F5 (tests), F6 (characterization tests), F7
(gate hardening), F9 (this section). F8 and F10 are informational. The
reviewer's own limits: it re-verified the `__proto__`/`undefined` probe and all
source claims but, like me, did not exercise a live D1.

## 13. SA-2 prerequisites: delta

Added or sharpened (the previous list stands):

- Key provisioning and a rotation-capable key resolver for `subject_digest.v1`
  (none exists anywhere in the codebase).
- Decide whether the released-body anchor is the existing `buyer_receipt_hash`
  (Workflow path) or a new digest; if new, a decided carrier with explicit
  handling of the Nevermined `finalize` overwrite, and try/catch isolation
  covering sync throws, async rejection, and CPU cost at the persist call site.
- Any enforcement point must treat only `content_digest_outcome = BOUND_MATCH`
  as content-verified, never `MATCH` alone.
- Integrity binding for `status` and the `PAYMENT-RESPONSE` header (N4).
- A single boundary adapter for `sha256:`-prefixed vs bare-hex digests.
- Constant-time digest comparison at any enforcement point.
- A decision on the pre-existing canonicalizer `__proto__` collapse (N1) and on
  whether the canonicalizer should be labelled or made RFC 8785 (N2).
- Whether a stronger anchor than the same D1 row is required against a D1-write
  adversary (the signed PCC is the stronger anchor for the body).

## 14. Change boundary, accounting, and next step

Files added: `result-content-digest.ts`, `subject-digest.ts`, their two test
files, and this report. Files modified: `result-authorization-shadow.ts`
(versioned content-digest validation,
`RESULT_CONTENT_DIGEST_VERSION_INCOMPARABLE`, `content_digest_outcome` on the
evaluation and telemetry record), `result-authorization-shadow.test.ts`
(generalized and hardened gate, updated fixtures and key pins), and a correction
note appended to the previous SA-1 report. Nothing outside
`packages/vcm/src/security/` and `docs/reports/` changed. No migration, no
`protocol-x402` change (`REPLAY_DIGEST_CHANGED=NO`), no `apps/` change, no
public schema, no secret, no worker upload or deployment, no traffic, host,
alert-worker, D1 or payment action. Nothing was pushed.

**Next (single bounded checkpoint):**
`SECURITY-AUTHORITY-SA1-RESULT-BODY-INTEGRITY-READONLY-AUDIT-01`. Local and
read-only: establish from source and in-process tests whether the
already-persisted `buyer_receipt_hash`/`verification_receipt_hash` equal a
recomputed hash of `result_json.body` for Workflow-path rows, what the
Nevermined-recovery path stores, and therefore whether a new persisted digest is
needed at all. It would touch no write path. Separately, N1 (`__proto__`) needs
its own decision because fixing it changes signed PCC hashes.

## 15. Correction recorded by RESULT-BODY-INTEGRITY-READONLY-AUDIT-01

Added after that audit; earlier sections are left as written.

- This report describes the Workflow body as "the already-signed PCC". Source
  shows it is the **flat signed `VerificationReceipt`**
  (`outcome.result.receipt`), with no service output and no PCC-document fields.
- The `buyer_receipt_hash` / `verification_receipt_hash` anchors reproduce from
  `hashPaymentObject(body)`, so a new persisted result-content digest is
  redundant for the production Workflow path, provided the body stays the
  receipt.
- `ResultContentDigest` hashes `{content, domain}` and therefore does not
  reproduce those anchors.
- See `SECURITY-AUTHORITY-SA1-RESULT-BODY-INTEGRITY-READONLY-AUDIT-01.md`.
