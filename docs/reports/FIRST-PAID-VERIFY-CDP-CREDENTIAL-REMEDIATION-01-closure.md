# FIRST-PAID-VERIFY-CDP-CREDENTIAL-REMEDIATION-01 — closure (awaiting human validation)

Status: **AWAITING_HUMAN_VALIDATION**. The offline validator is built and
tested; the operator has not yet run it. No secret was read, printed or
persisted. No real payment, no real signature, no web-direct, no push, no
Cloudflare secret/deployment/traffic mutation, no credential rotation, no
facilitator config change.

## 1. Starting state

HEAD `5e20de44d4819a788b44b4a2994277f4776b0743`, tree clean, branch
`metadata-vcm-qualification` (27 ahead / 0 behind upstream). Production
`369b4bf5-c2f7-4e05-8454-7f5514a3bd45` @100%; subclassification canary
`8cddb16e-7f73-4875-8d50-4adc0ade5eb4` @0%. Neither was touched.
`STARTING_PROVENANCE=PASS`.

## 2. Installed SDK credential requirements (`@coinbase/cdp-sdk` 1.55.0, source read)

Source: `_esm/auth/utils/jwt.js` (`generateJwt`) and `_esm/x402/facilitator.js`.

| Aspect             | Exact behaviour                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required inputs    | `apiKeyId` and `apiKeySecret`, both truthy. Empty id → `Error("Key name is required")`; empty secret → `Error("Private key is required")`.                                                           |
| Key-type detection | By content, not by a flag: first `importPKCS8(secret, "ES256")` succeeds → EC; else `Buffer.from(secret,"base64").length === 64` → Ed25519; else `UserInputValidationError("Invalid key format …")`. |
| EC (ES256)         | PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`), P-256. Header `alg=ES256`, `kid`=key id, random 16-byte hex `nonce`.                                                                                     |
| Ed25519 (EdDSA)    | Base64 of exactly 64 bytes = 32-byte seed ‖ 32-byte public key, built into an OKP JWK. Header `alg=EdDSA`.                                                                                           |
| Newlines           | A PEM needs real newlines. A PEM with literal `\n` sequences, wrapping quotes, or truncation fails the EC probe and is reported as "Invalid key format".                                             |
| Claims             | `sub`=key id, `iss`="cdp", `uris`=[`METHOD host+path`], 120 s expiry. The facilitator client mints three per call: POST `/verify`, POST `/settle`, GET `/supported`.                                 |
| ID/secret pairing  | **Not checked locally.** Only the CDP server can tell whether the id belongs to the secret.                                                                                                          |
| Swallowed error    | `isValidECKey` catches and discards the real `importPKCS8` error. A bad PEM and a runtime that cannot import a good PEM both surface as "Invalid key format".                                        |

## 3. Binding metadata (names and types only; no values requested or returned)

```
CDP_API_KEY_ID_BINDING_PRESENT=YES      (secret_text)
CDP_API_KEY_SECRET_BINDING_PRESENT=YES  (secret_text)
```

Confirmed on the Worker (`wrangler secret list`) and on the exact versions
`8cddb16e…` and `369b4bf5…` (`versions view`; 41 bindings each; no value field
in either response). `CDP_WALLET_SECRET` is not a Worker binding and is not
required by the facilitator client (documented in `production-payment.ts`).

## 4. New evidence that reframes the hypothesis (read-only)

The mission's cases assume the credential copy is the suspect. Cloudflare's
version history says otherwise:

- **Last CDP secret change: 2026-08-18T14:36–14:41Z** (id updated, secret
  deleted, id updated, secret updated). No CDP secret change since. Every later
  "Updated secret" event is a Modal or storage-alert secret.
- **The Worker verified and settled successfully on 2026-08-28 and 2026-09-01**,
  after that last change.
- No change since the 08-28 source to `compatibility_date`,
  `compatibility_flags` (`nodejs_compat`), or to `jose`, `uncrypto`,
  `@coinbase/cdp-sdk`, `@x402/*` in the lockfile (the only lockfile line touched
  in that set is an `@x402/core` entry).
- Under real **workerd**, the installed SDK mints a JWT with both an EC PEM key
  and an Ed25519 key (new test, §7).
- `createAuthHeaders` in `@x402/core` can only throw from JWT minting or from a
  flat-header shape check that cannot occur here, so the earlier
  `facilitator_jwt_generation_failed` classification is sound.

Consequence: the same secret bytes that minted successfully on 08-28 are being
rejected by the same code on 09-20. Either those bytes are not what the Worker
now holds (which Cloudflare's history does not show), or the failure is not in
the bytes. **Do not assume a credential fault.** This is a hypothesis ranking,
not a finding: Cloudflare's secret history cannot see dashboard-side or API-side
changes that don't create a version, and the local workerd (compat date falls
back to `2026-01-03`) is not identical to production's.

## 5. New safe subclassification (Worker-side)

`apps/edge-api/src/control-plane/evidence/cdp-jwt-failure.ts` (new, pure). When
the existing subreason is `facilitator_jwt_generation_failed`, a second finite
field `jwt_subreason` records _which stage_:

`cdp_key_id_missing` · `cdp_key_secret_missing` · `cdp_key_format_invalid` ·
`cdp_key_parse_failed` · `cdp_jwt_signing_failed` · `cdp_jwt_unknown_failure`

Matched against the installed SDK's exact message shapes and discarded; never
returns message, cause, stack or input. Wired through
`cdp-facilitator-failure.ts` → `ExternalVerificationEvidence.jwt_subreason`
(optional, failure-only) → `cdp-provider.ts` → audit
`verification_jwt_subreason` (through the existing `safeAuditCode` filter).
Public 402 body unchanged (`PUBLIC_PAYMENT_ERROR_SEMANTICS_CHANGED=NO`);
`raw_evidence_hash` inputs unchanged.

Limit, stated plainly: because of the swallowed error in §2,
`cdp_key_format_invalid` cannot separate "bad key" from "runtime can't import a
good key". The Worker-side code cannot resolve that; only the local validator
plus the workerd test can. **This subclassifier is committed but not deployed**
(no upload authorised in this checkpoint), so production audit rows will not
carry `verification_jwt_subreason` until a later authorised canary.

## 6. Offline validator

`apps/edge-api/scripts/validate-cdp-credentials.mts` — outside `src/` and the
tsconfig include, so never in the Worker bundle. Calls the installed SDK's
`generateJwt` for the same three facilitator paths the Worker mints, holds each
JWT only to read its `alg`, then drops it. No network primitive, no file write,
no `console.*`. Every output line must match `^[A-Z0-9_]+=[A-Z0-9_]+$` or is
dropped. Failures are reduced to the §5 enum. Input shape is reported as enums
only (id: `UUID|ORG_PATH|OTHER|EMPTY`; secret: `PEM_MULTILINE`,
`PEM_ESCAPED_NEWLINES`, `PEM_SINGLE_LINE`, `BASE64_64_BYTES`,
`BASE64_OTHER_LENGTH`, `OTHER`, `EMPTY`; plus quoted / surrounding-whitespace /
CRLF flags), which is what tells the operator _why_ a format fails (e.g. escaped
newlines) without echoing it.

Exit code: 0 mint PASS, 1 mint FAIL, 2 internal error (fixed enum block).

## 7. Tests and secret-safety proof

| Suite                                                       | Result                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `tests/cdp-credential-validator.test.ts`                    | 26 passed                                                      |
| `tests/facilitator-verify-subclassification.test.ts`        | 26 passed (+2 new: A2, no-jwt)                                 |
| `tests/workerd/cdp-jwt-mint.workerd-test.ts` (real workerd) | 2 passed (EC and Ed25519)                                      |
| Full `apps/edge-api` + `packages/protocol-x402`             | 182 files / 2292 tests passed, 22 files / 73 skipped, 0 failed |
| `tsc` (edge-api project) / validator + test `tsc --strict`  | clean                                                          |
| `eslint` (evidence, x402-service)                           | clean                                                          |
| `prettier --check` on every changed file                    | clean                                                          |
| Working-tree secret scan                                    | no leaks found                                                 |

Cases A–G: missing id; missing secret; invalid format; malformed PEM (truncated
and escaped-newline); wrong encoding (32-byte base64; 64-byte non-key); valid EC
and Ed25519 test keys; injected signing failure whose message contains the
sentinel secret. Leak proofs use sentinel secrets and run the real CLI in a
child process with an isolated `HOME`/`TMPDIR`: secret and id absent from stdout
and stderr; no JWT-shaped token; no stack frames; stderr empty; every stdout
line enum-shaped; no file the run created (tsx cache included) contains a
credential or JWT; `fetch` spied and never called; the three minted paths
asserted exactly. **Mutation check:** deliberately leaking the error message
into the failure class and removing the line filter made 7 tests fail; the
original was then restored byte-identical (verified by `diff`).

Scanner note: two first-draft literals (a high-entropy sentinel and a
`BEGIN PRIVATE KEY` template) tripped the repo's secret scan; both were
rewritten (no allow-list change) and the rescan is clean.

The validator was run once with `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` explicitly
**unset** to prove the command works; it correctly reported
`CDP_KEY_ID_MISSING`. It has not been run against any real credential.

## 7a. Human validation boundary

Run in the shell where your CDP credentials already live (not pasted anywhere):

```bash
pnpm cdp:validate-credentials
```

Return **only** the printed lines. Do not paste the id, secret, a JWT, or
anything else. Expected on success:

```
CDP_API_KEY_ID_PRESENT=YES
CDP_API_KEY_SECRET_PRESENT=YES
CDP_API_KEY_ID_SHAPE=UUID
CDP_API_KEY_ID_QUOTED=NO
CDP_API_KEY_ID_SURROUNDING_WHITESPACE=NO
CDP_API_KEY_SECRET_SHAPE=PEM_MULTILINE            (or BASE64_64_BYTES)
CDP_API_KEY_SECRET_QUOTED=NO
CDP_API_KEY_SECRET_SURROUNDING_WHITESPACE=NO
CDP_API_KEY_SECRET_CRLF=NO
CDP_KEY_TYPE=EC_PEM                               (or ED25519)
CDP_CREDENTIAL_FORMAT=VALID
CDP_JWT_MINT=PASS
CDP_JWT_FAILURE_CLASS=NONE
CDP_VALIDATOR_NETWORK_ACCESS=NONE
```

Failure looks the same with `CDP_JWT_MINT=FAIL` and a `CDP_JWT_FAILURE_CLASS`
from §5. The shape and flag lines say why.

## 8. Decision tree (not executed; awaiting the sanitized output)

**Case A — validator FAILS.** The operator's copy is unusable. Report the class:
`CDP_KEY_FORMAT_INVALID` with `PEM_ESCAPED_NEWLINES`/`QUOTED`/whitespace flags
is a formatting/parser fault; `CDP_KEY_PARSE_FAILED` is a key-material fault;
`CDP_JWT_SIGNING_FAILED` is a signing fault.
`CREDENTIAL_REMEDIATION_REQUIRED=YES`. Note this would sit awkwardly with §4
(this copy is presumably not the byte-identical value the Worker used on 08-28),
so first ask whether the operator copy is the same credential the Worker was
provisioned from. Nothing is rotated or replaced.

**Case B — validator PASSES.** The operator's copy can mint in Node. Given §4,
`WORKER_SECRET_REMEDIATION_REQUIRED=LIKELY` is **not** a safe conclusion by
itself: Cloudflare shows no secret change since the last success. The remaining
candidates are, in order: (1) the Worker's stored bytes differ from the
operator's copy by something outside Cloudflare's version history; (2) a
production-runtime difference from the local workerd; (3) a difference between
what the Worker receives and what `wrangler secret` stored. The minimum next
step is a **Worker-side, shape-only self-check** on a 0% canary (enums only, no
bytes), not a `secret put`.

## 9. CDP portal checklist (no secret values, no screenshots of secrets)

- API key is **Active** and not revoked/deleted.
- It belongs to the expected project/organisation.
- The key **id** shown corresponds to the secret you intend to use (a
  regenerated key gives a new id _and_ a new secret; a mismatched pair cannot be
  detected offline).
- Key type (ECDSA vs Ed25519) matches `CDP_KEY_TYPE` from the validator.
- x402 / facilitator access is enabled for this key or project, if the portal
  exposes an entitlement.
- No key rotation, project restriction or IP allow-list introduced since
  2026-09-01 (last settlement); record the date of any change.
- Whether the key was regenerated on or after 2026-08-18.

## 10. Proposed remediation (for separate authorization only)

None yet. If Case A: operator regenerates or re-copies the credential locally,
re-runs the validator to PASS, then a separate checkpoint proposes exactly
`wrangler secret put CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` for the Worker,
fed from stdin by the operator, with a 0%-canary zero-economic diagnostic to
confirm `facilitator_verify_invalid` (facilitator reached). If Case B: the
Worker-side shape self-check described above. Neither is authorised here.

## 11. Non-effects

`CLOUD_SECRET_MUTATIONS=0` · `WORKER_UPLOADS=0` ·
`WORKER_DEPLOYMENT_MUTATIONS=0` · `WORKER_TRAFFIC_MUTATIONS=0` ·
`REAL_PAYMENT_RETRY_COUNT=0` · `WEB_DIRECT_CANARY_ATTEMPTS=0` ·
`ONCHAIN_TRANSACTION=NO` · `USDC_TRANSFER=NO` · `PROVIDER_INVOCATIONS=0` ·
`SETTLEMENT_COMPLETED=NO` · `SAFE_TO_RETRY_REAL_VERIFY_PAYMENT=NO` ·
`WEB_DIRECT_CANARY_AUTHORIZED=NO`. Not pushed.
