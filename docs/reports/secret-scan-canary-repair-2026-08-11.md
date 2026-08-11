# Secret-scan canary repair — 2026-08-11

## Incident

The credential-free gate preceding the SUN-0900B authenticated sandbox preflight
stopped because `pnpm secrets:scan` intermittently reported that Gitleaks did
not detect the synthetic probe created for
`apps/edge-api/src/secret-scope-probe.ts` (scanner status `0`). The verifier
cleaned its temporary tree and the repository remained clean. No authenticated
Nevermined operation was attempted.

This mattered because the canary is the executable proof that required
credential-risk paths are inspected. A successful clean scan without reliable
positive-control detection is not sufficient security evidence.

## Local scanner baseline

- Executable: `/opt/homebrew/bin/gitleaks`
- Version: `8.30.1`
- Configuration: `.gitleaks.toml`, extending the Gitleaks default rules
- History phase: `gitleaks git . --config=.gitleaks.toml --redact --verbose`
- Working-tree phase:
  `gitleaks dir . --config=.gitleaks.toml --redact --verbose`
- Canary phase: `gitleaks dir <temporary-file>`, with redaction and a dedicated
  finding exit code of `7`

Repository evidence records Gitleaks 8.30.1 in the accepted SUN-0700B plan, and
the installed executable predates the scope verifier. Tool-resolution or version
drift was therefore ruled out.

## Root cause

Classification: **A — canary fixture defect**.

The verifier assembled a synthetic GitHub-PAT-shaped canary from 27 random bytes
encoded with Base64URL. Detector success therefore depended on a random suffix
whose character positions and effective detector match could vary. A 256-trial
direct run missed four canaries; a second 256-trial run missed three. There were
zero scanner execution errors. For a captured miss, both the `github-pat` and
`generic-api-key` rules returned no finding; replacing only Base64URL
punctuation with alphanumeric characters produced a detection.

The failure was not caused by Git history mode, path exclusion, an allowlist, or
wrapper parsing. The verifier used `gitleaks dir` against a real untracked
temporary file inside its selected scan source. Gitleaks returned status `0`
because that particular synthetic value did not satisfy an active detector.

## Repair

The random Base64URL canary was replaced with a deterministic, high-entropy,
alphanumeric synthetic detector fixture assembled from source fragments. The
scanner source does not contain a complete token-shaped literal, and the fixture
is explicitly synthetic rather than an issued vendor credential.

The wrapper now distinguishes all exit classes:

- status `7`: synthetic finding detected;
- status `0`: successful scan with no finding, which fails the canary proof;
- execution error, null status, or any other status: scanner failure, which
  fails closed distinctly.

No detector, entropy threshold, required class, history scan, directory scan, or
security failure was disabled or weakened.

## Required scope and canary matrix

The scope verifier requires eight tracked-file classes and exercises nine
detector paths because governance uses two separate files:

| Canary class                | Probe path                                             | Expected rule | Direct result | Wrapper result |
| --------------------------- | ------------------------------------------------------ | ------------- | ------------- | -------------- |
| Application source          | `apps/edge-api/src/secret-scope-probe.ts`              | `github-pat`  | detected      | detected       |
| Package/config              | `package.json`                                         | `github-pat`  | detected      | detected       |
| Governance tasks            | `TASKS.yaml`                                           | `github-pat`  | detected      | detected       |
| Governance state            | `PROJECT_STATE.yaml`                                   | `github-pat`  | detected      | detected       |
| Docs/reports                | `docs/reports/secret-scope-probe.md`                   | `github-pat`  | detected      | detected       |
| Migrations                  | `migrations/secret-scope-probe.sql`                    | `github-pat`  | detected      | detected       |
| Shell/scripts               | `scripts/secret-scope-probe.sh`                        | `github-pat`  | detected      | detected       |
| Tracked generated artifacts | `packages/contracts/generated/secret-scope-probe.json` | `github-pat`  | detected      | detected       |
| Live-test source            | `apps/edge-api/tests/live/secret-scope-probe.ts`       | `github-pat`  | detected      | detected       |

The final scope proof covered 797 tracked files totaling 4,672,987 bytes, eight
required classes, and nine detector probes. The committed-state history phase
covered 66 commits, and both the history and working-directory phases reported
no leaks.

## Allowlist audit

`.gitleaks.toml` has no path allowlist. Its four regex allowances remain bounded
to accepted public fixture/checksum patterns: two idempotency fixture formats,
one exact verification-fixture identifier, and one exact frozen public SHA-256
checksum. None excludes `apps/`, `packages/`, `scripts/`, `migrations/`,
`docs/reports/`, governance YAML, or live-test source.

Dependency, virtual-environment, build-output, and local-secret files are
excluded through repository ignore policy rather than a broad Gitleaks source
allowlist. Tracked files are independently enumerated and rejected if normal
ignore rules hide them. `node_modules`, `.venv`, and `venv` are intentionally
not mandatory tracked scan classes.

## Regression and negative control

The regression suite proves:

1. the canary remains detectable when the old random-byte source is forced to
   produce a token-shaped but detector-rejected value;
2. all nine required probe paths are actually sent to Gitleaks;
3. a clean equivalent untracked source file produces status `0`;
4. temporary untracked files are covered by directory mode;
5. ignored dependency and virtual-environment trees are not mandatory scope;
6. scanner execution failure fails closed distinctly;
7. temporary probe trees are removed after success and failure; and
8. scope verification preserves repository status.

The mandatory manual negative control added one temporary synthetic canary to
`apps/edge-api/src`. The production `pnpm secrets:scan` failed with one redacted
`github-pat` finding in that exact file. After the file was removed, the same
command passed: nine canaries detected, Git history clean, working directory
clean, and no leaked probe file.

## Security assertions

- Every repository command in this repair ran with Nevermined and CDP credential
  variables and both live-payment flags removed from the child environment.
- No real credential was used as a detector fixture.
- No credential value or authenticated SDK response was printed or persisted.
- Nevermined and CDP were not contacted.
- No blockchain, payment, delegation, registration, purchase, verification, or
  settlement operation occurred.
- SUN-0900B and production state were not modified.
