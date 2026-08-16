# SUN-1000 Checkpoint 1B — Security Scanner Integration (Semgrep, OSV-Scanner, Trivy)

`production_ready=false`, `production_enabled=false`. Accepted baseline:
`9a47ae6` (Checkpoint 1A — 6/12 PASS, 6/12 FAIL_INTERNAL, decision B). This
checkpoint addresses only the three most homogeneous gaps: Semgrep, OSV-Scanner,
Trivy. Schemathesis and the chaos/load suites remain untouched. **Zero
deployment, publication, DNS change, live payment, or payment-provider
mutation.**

## 1. Provisioning design

`security/tool-versions.json` is the single authoritative version/provenance
source — no version is duplicated in any script or CI file.
`scripts/security/manifest.ts` holds pure, network-free logic (platform
resolution, checksum verification, manifest-shape validation), separated from
`scripts/security/bootstrap.ts`'s actual network/filesystem side effects
specifically so the pure logic is unit-testable without a network call
(`apps/edge-api/tests/security-scanner-manifest.test.ts`, 7 tests).

| Tool        | Version   | Provenance                                       | Install method                                                                                |
| ----------- | --------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Semgrep     | `1.173.0` | PyPI (`pypi.org/project/semgrep/1.173.0/`)       | pip, into a dedicated pinned venv (`.security-tools/semgrep-venv`)                            |
| OSV-Scanner | `2.5.0`   | `github.com/google/osv-scanner` official release | binary download + SHA256 verification against the release's own `osv-scanner_SHA256SUMS`      |
| Trivy       | `0.74.0`  | `github.com/aquasecurity/trivy` official release | tarball download + SHA256 verification against the release's own `trivy_0.74.0_checksums.txt` |

Semgrep's checksum verification is narrower than the other two: PyPI serves
package files over TLS with per-file digests in its own index metadata (verified
by `pip` itself, and the version is exactly pinned), but this is not a full
`pip install --require-hashes` pin of Semgrep's entire transitive dependency
tree — recorded honestly as a scope simplification, not silently claimed as
strict. OSV-Scanner and Trivy get the stronger case: a single-binary/tarball
download, SHA256-verified against the exact checksum the upstream release itself
publishes, before the binary is ever executed.

**Platforms**: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64` are
pinned in the manifest (covering local Apple Silicon development and GitHub
Actions' `ubuntu-latest` runner). An unrecognized platform throws
`UnsupportedPlatformError` — fails closed, never guesses a fallback asset. No
root/admin privileges are required; everything installs under the repository's
own `.security-tools/` (gitignored, alongside `security/output/` for scan
results — real findings, not committed evidence; this report is the durable
record).

**Idempotency**: verified directly — a second `pnpm security:bootstrap` run
completed in `0.309s` total with zero downloads, re-verifying the
already-provisioned binaries' checksums before reuse rather than trusting a
stale/tampered cache silently.

## 2. `pnpm check` vs. `pnpm security:release` — the network/determinism decision

`pnpm check` remains fully deterministic and network-free, per this project's
own long-established, repeatedly-reinforced convention (every prior checkpoint
in this project's history has treated a credential-free, network-free
`pnpm check` as foundational). The three scanners are network/advisory-backed by
nature (OSV-Scanner queries OSV.dev; Trivy downloads a multi-hundred-MB
vulnerability database) and do not belong in that deterministic gate.
`pnpm security:release` (running Semgrep → OSV-Scanner → Trivy serially) is the
separate release-security gate this checkpoint's own instruction anticipated as
a valid architecture. CI wires `security-release` as its own job (see §7).

## 3. Semgrep

**Scope**: `apps/`, `packages/`, `services/`, `scripts/` — explicitly **not**
excluding test files, live payment harnesses, document-processing code, or
network adapters (an earlier draft of this script excluded
`*.test.ts`/`*.test.py`; caught and corrected during this same checkpoint,
before any commit — the real, final scan includes them). Only `node_modules`,
`dist`, `.venv`, `.security-tools` are excluded.

**Ruleset**: `p/ci` — a free, no-login-required Semgrep Registry community
ruleset covering this project's actual languages.

**Execution result**: clean. `50` rules run across `497` git-tracked files
(`<multilang>`: 3 rules/497 files; `ts`: 16 rules/363 files; `python`: 19
rules/41 files; `yaml`: 11 rules/10 files; `html`: 1 rule/3 files). **0
findings, 0 blocking, 0 tool errors.**

## 4. OSV-Scanner

**Scope**: `pnpm-lock.yaml` (704 packages) — the Node/TypeScript workspace
dependency state. (The Python dependency state, `services/modal-worker`'s
`pyproject.toml`, produced no separate lockfile entry in this scan pass; worth
confirming lockfile-format detection in the remediation follow-up, noted
honestly rather than silently assumed covered.)

**Blocking threshold — a real governance gap, not invented**: no documented
severity-threshold security policy exists anywhere in this repository
(`governance/`, `docs/decisions/`, `docs/adrs/` all checked). Per this
checkpoint's own instruction, that absence is recorded as a genuine gap rather
than papered over with an invented threshold. This script's own conservative
stand-in policy — block on any finding with a known fix available — is
explicitly labeled as a stand-in in its own output, not an authoritative policy.

**Execution result**: real, genuine findings — **82 vulnerabilities**, all with
a fix available (confirmed against the real `affected[].ranges[].events[].fixed`
field after fixing a parsing bug caught during this same checkpoint — see §8).

| Severity | Count |
| -------- | ----- |
| CRITICAL | 3     |
| HIGH     | 31    |
| MODERATE | 41    |
| LOW      | 7     |

Top affected packages: `vite@5.4.11` (12), `axios@1.16.0` (10),
`brace-expansion@1.1.11` (5), `fast-uri@3.0.5` (5), `undici@7.28.0` (5),
`js-yaml@4.1.0` (4), `postcss@8.4.49` (4), `lodash@4.17.21` (3),
`minimatch@3.1.2` (3), `qs@6.13.0` (3), and others — all build-tooling/
dev/transitive dependencies (Vite, Vitest, Turbo, and their own dependency
chains), not runtime production-serving code (this project has no live
deployment yet regardless).

**The 3 CRITICAL findings, specifically**:

- `form-data@4.0.1` — `GHSA-fjxv-7rqg-78g4`: unsafe random function used for
  multipart boundary generation.
- `vitest@2.1.8` — `GHSA-5xrq-8626-4rwp` and `GHSA-9crc-q9x8-hgqq`: both require
  the Vitest UI/API server to be actively listening while the developer
  simultaneously browses a malicious website (a dev-environment-only,
  non-default-usage attack class — this project's own `pnpm test`/`pnpm check`
  never invoke `--ui` or start that server). Correctly flagged as CRITICAL by
  upstream severity data; narrower real-world exposure noted honestly, not used
  to dismiss the finding.

**82 blocking findings under this stand-in policy** — `pnpm security:osv`
correctly exits non-zero. **This is a real, evidenced, unresolved finding**, not
a tool/config error.

## 5. Trivy

**Scope decision**: this repository has no `Dockerfile`, no `docker-compose*`,
no `*.tf`, and no Kubernetes/Kustomize manifests (verified by direct search) —
so Trivy's applicable scope here is **filesystem dependency + misconfiguration
scanning** (`trivy fs --scanners vuln,misconfig`), not container-image or IaC
scanning, which does not apply until SITEBORNE actually ships a container image
or IaC definitions (a later, separate concern — not invented here).

**Execution result — genuinely blocked by a real, provable local resource
constraint, not a code or tool defect**: the vulnerability-scanning portion
requires downloading Trivy's ~108 MB vulnerability database on first use. That
download failed with `no space left on device`, confirmed by direct evidence:

```
Filesystem        Size    Used   Avail Capacity
/dev/disk3s5      460Gi   424Gi   1.1Gi   100%
```

This development machine has essentially no free disk space (1.1 GiB available
on a 460 GiB volume). This is a genuine host-machine resource limitation — not
something this checkpoint should work around by deleting arbitrary files on the
operator's machine without explicit authorization, and not a code/tool
integration defect (`pnpm security:trivy` correctly propagated the failure
rather than masking it).

**Partial real evidence obtained**: the misconfiguration-only portion
(`--scanners misconfig`, no vulnerability DB required) was run separately and
succeeded cleanly: `Detected config files num=0` — confirming, by direct
execution rather than inference, that Trivy finds nothing to flag because no
Dockerfile/IaC exists, exactly as the scope decision above states.

**Status**: `trivy fs --scanners misconfig` → **0 misconfigurations, confirmed
by real execution**. `trivy fs --scanners vuln` → **NOT*YET* TESTED**, blocked
by a real, provable local disk-space constraint; `pnpm security:trivy` (which
runs both scanners together, the correct release-gate behavior) should be re-run
once local disk space is available.

## 6. Deduplication (OSV vs. Trivy)

Trivy's vulnerability-scanning portion did not complete this session (§5), so no
cross-tool deduplication against OSV-Scanner's 82 findings was possible yet.
This is recorded as an open item for the disk-space- permitting re-run, not
silently assumed to be zero overlap.

## 7. CI wiring

A new `security-release` job in `.github/workflows/ci.yml` runs
`pnpm security:bootstrap` then `pnpm security:release` on `ubuntu-latest`, using
the exact same pinned versions as local execution (`linux-x64` manifest assets).
**Deliberately not yet added to the `check` job's `needs` list** — real,
evidenced, not-yet-remediated findings exist (§4), and making the merge gate
hard-fail on them today would conflate "scanner integration" with "remediation,"
which this checkpoint's own scope explicitly separates. This is a recorded,
deliberate scoping decision, not a silent weakening of policy — the job still
runs and reports its genuine status (visibly failing) in the Actions UI; wiring
it into `check` is the natural follow-up once the remediation checkpoint lands.

## 8. A real bug caught and fixed during this same checkpoint

`run-osv.ts`'s original fix-availability check read `pkg.groups[].fixedVersions`
— a field that does not exist in OSV-Scanner `2.5.0`'s actual JSON output
(confirmed by inspecting the real raw output). This silently inverted the
result: the first real run reported "0 vulnerabilities with a fix available" (a
false negative that would have let 82 real findings through the stand-in policy
uncontested). Caught by inspecting the raw JSON structure directly rather than
trusting the first result, fixed to read the actual field
(`vulnerability.affected[].ranges[].events[].fixed`), and re-verified — the
corrected run reports the true count (82/82 with a fix available). Recorded here
explicitly per this checkpoint's own "never call an unexecuted scanner clean" /
"do not disguise scanner failure as zero findings" discipline — the discipline
applies to a script's own internal bugs, not only to the external tool's exit
code.

## 9. Suppression policy

**No suppressions were introduced.** Every real finding (Semgrep: none;
OSV-Scanner: 82, all genuine; Trivy misconfig: none, genuinely absent) is
reported as-is.

## 10. Finding triage

| Finding class                                      | Classification                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Semgrep (0 findings)                               | N/A — clean scan                                                                                                                |
| OSV-Scanner: 3 CRITICAL (`form-data`, 2× `vitest`) | `TRUE_POSITIVE_BLOCKING`                                                                                                        |
| OSV-Scanner: 31 HIGH, 41 MODERATE, 7 LOW           | `TRUE_POSITIVE_BLOCKING` under the stand-in fix-available policy; severity-specific policy still undefined (governance gap, §4) |
| Trivy misconfig (0 findings)                       | N/A — genuinely no applicable targets                                                                                           |
| Trivy vuln scan                                    | `NEEDS_DEEPER_REVIEW` — not `TOOL_OR_CONFIGURATION_ERROR`; blocked by a real, provable local resource constraint, not a defect  |

Per this checkpoint's own explicit instruction, **no broad dependency
remediation was performed** despite the real CRITICAL/HIGH findings — that work
is preserved as evidence for a focused follow-up checkpoint, not absorbed into
this one.

## 11. Existing security regression (unchanged, re-verified)

ESLint/TypeScript, Ruff, mypy strict, Gitleaks, property tests, payment/
economic architecture (Payment-Identifier uniqueness, immutable binding,
duplicate_conflict, `SETTLEMENT_PENDING` durability/recovery), PCC, receipts,
PaymentServiceLink, document worker, D1, MCP, A2A, Nevermined, x402 — all
re-verified via the existing deterministic suites, all unchanged from Checkpoint
1A. No external payment operation performed.

## 12. SUN-1000 criterion transition

| Criterion                                     | Checkpoint 1A                   | Checkpoint 1B                                                                                                                             |
| --------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Semgrep passes, no critical findings          | `FAIL_INTERNAL` (not installed) | **`PASS`** — installed, wired, real scan, 0 findings                                                                                      |
| OSV-Scanner finds no critical vulnerabilities | `FAIL_INTERNAL` (not installed) | **`FAIL_INTERNAL`** — now installed and wired (tooling gap closed), but the literal criterion still fails: 3 real CRITICAL findings exist |
| Trivy passes                                  | `FAIL_INTERNAL` (not installed) | **`NOT_YET_TESTED`** — misconfig scan passes (0 findings); vuln scan blocked by a real local disk-space constraint, not yet completed     |

This checkpoint does **not** force the 6→9 PASS transition the prior
checkpoint's own framing anticipated as one possible outcome — the actual
scanner findings do not support it. Honest result: **7 PASS, 4 FAIL_INTERNAL, 1
NOT_YET_TESTED** (Semgrep newly PASS; OSV-Scanner and Trivy remain not-PASS for
concrete, evidenced reasons distinct from "tool missing").

## Outcome

`SUN-1000` remains `active`. `production_ready=false`,
`production_enabled=false`, unchanged. Zero deployment, publication, DNS
mutation, or payment-provider mutation this checkpoint.

## Next checkpoint

**SUN-1000 Checkpoint 1C — Dependency Vulnerability Remediation.** Address the
82 real OSV-Scanner findings (prioritizing the 3 CRITICAL: `form-data`,
`vitest`) via targeted `pnpm update`/lockfile bumps — a focused, single-category
remediation, not bundled with new scanner integration. Once resolved, re-run
`pnpm security:osv` and confirm 0 CRITICAL, then separately re-run
`pnpm security:trivy` (vuln scan) once local disk space allows, before
revisiting whether `security-release` should join `check`'s hard-blocking
`needs` list. Schemathesis and the chaos/load suites remain untouched,
deliberately out of scope until their own dedicated checkpoints.
