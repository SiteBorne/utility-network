# SUN-1222C-SMTP-TRANSPORT-CLEANUP-FIX — Operator Deployment Runbook

**Status:** Not executed. Written by Claude as a literal, operator-run procedure.
Claude performed zero Cloudflare reads or writes to produce this file and made zero
network connections to `smtp.ionos.com` — every command below is a template, is
unexecuted, and must be run by you, in your own authenticated `wrangler` session,
with your own judgment at each checkpoint. Command blocks are templates: they do not
assume current live state and contain no secret values or fabricated version IDs —
every `<...>` placeholder must be filled in from what you actually observe when you
run the read-only step immediately before it, not copied from this file or from any
prior session's report.

**Source this runbook deploys:** `be20b75` (`SUN-1222C-SMTP-ROOT-CAUSE: bounded
cleanup in the real SMTP transport`), branch `smtp-diagnostic-starttls-observability`,
built on `512102a` (zero-network Service Binding controls) and `bf88e11` (real
Miniflare Service Binding timeout isolation — see those commits' own messages for the
evidence trail). This commit changes only:
`apps/edge-api/src/smtp/ionos-smtp-transport.ts`,
`apps/edge-api/src/smtp/ionos-smtp-diagnostic.ts` (moved `CLEANUP_TIMEOUT_MS`, no
behavior change),
`apps/edge-api/src/smtp/smtp-stage-timeout.ts`, and its own tests. It does not touch
`smtp.ionos.com`/port 587/`STARTTLS`/`AUTH PLAIN`/the recipient/sender, any Wrangler
config, or any production variable.

**What this fixes:** `sendStorageAlertViaIonosSmtp`'s `finally` block used to await
`reader.cancel()` and `currentSocket.close()` with no bound of their own. A
black-holed or half-upgraded TLS connection could hang that `finally` forever,
silently preventing an already-classified `SmtpTransportError` (or a successful
send) from ever being thrown/returned — the send would then only ever be cut off by
the *caller's* unrelated Service Binding timeout, with no application-level error
ever surfacing. Both cleanup steps are now raced against `CLEANUP_TIMEOUT_MS`
(1000ms) via the same `withTimeout` primitive already proven (locally, via a real
Miniflare Service Binding) for the diagnostic module.

**What this does NOT do:** it does not fix, change, or re-attempt the actual second
production qualification hang you were investigating (12.06s, HTTP 502, receiver
Service Binding). This is the real-transport analogue of that fix, not a repeat of
that specific incident. §9 below is the only step that would produce comparable live
evidence, and it is explicitly a non-delivery diagnostic, not a qualification
attempt.

---

## §0 — Preconditions

- [ ] You are running every command below yourself, in a shell authenticated to the
      real `siteborne` Cloudflare account (`wrangler whoami` shows the expected
      account).
- [ ] You have read `be20b75`'s diff yourself (`git show be20b75`) and the four
      targeted test files it touches, and are satisfied the change matches this
      runbook's description.
- [ ] You understand this repo's own documented incident (see
      `wrangler.toml`'s and `wrangler.storage-alert-receiver.toml`'s comments): prior
      `wrangler deploy`/version commands on this account have caused undocumented
      public-exposure side effects despite `--dry-run` and `workers_dev = false`
      both being set. Use only `wrangler versions upload` / `wrangler versions
      deploy` / `wrangler versions secret put` below — never `wrangler deploy` or
      `wrangler triggers deploy` — and re-verify exposure state after every mutating
      command, not just once at the end.
- [ ] Nothing in this runbook should be run unattended or scripted end-to-end. Stop
      at any checkpoint whose actual output doesn't match what that step says to
      require.

---

## §1 — Verify current Cloudflare deployment state (read-only)

```
wrangler deployments list --name siteborne-storage-alert-receiver
wrangler deployments list --name siteborne-utility-edge
```

Record the actual active version IDs and percentages for both Workers — call them
`<RECEIVER_ACTIVE_VERSION>` and `<UTILITY_EDGE_ACTIVE_VERSION>` for the rest of this
runbook. Do not assume they match any version ID mentioned in a prior report; if
either Worker is not at 100% on a single version, stop and resolve that first —
this runbook assumes a clean single-version baseline.

---

## §2 — Build/upload the receiver candidate from the exact commit

```
git -C <repo> rev-parse HEAD   # must print be20b75<...> (or its descendant)
cd <repo>/apps/edge-api
wrangler versions upload --config ../../wrangler.storage-alert-receiver.toml \
  --message "be20b75 bounded SMTP transport cleanup"
```

**HUMAN-EXECUTED LIVE MUTATION.** Capture the printed version ID as
`<RECEIVER_CANDIDATE_VERSION>`. This uploads a new, undeployed version — it does not
shift any traffic.

---

## §3 — Verify the receiver candidate's bindings/secrets/config

```
wrangler versions view <RECEIVER_CANDIDATE_VERSION> --name siteborne-storage-alert-receiver
```

Require, from the actual output (not from this runbook or any prior report):
- Exactly two secrets present, by name only: `ALERT_PATH_TOKEN`, `IONOS_SMTP_PASSWORD`.
- No other bindings (no D1/R2/KV/queues/workflows/AI/Browser/Service Bindings) unless
  you independently confirm the current source genuinely declares one — this
  receiver has historically had none.
- `workers_dev` / preview state for this script: both `false` (check via the
  Cloudflare API `GET /accounts/<account_id>/workers/scripts/siteborne-storage-alert-receiver/subdomain`
  or equivalent dashboard view — `versions view` alone does not show this).
- No Custom Domain, no zone route, for this script.

If any of these differ from expectation: **STOP. Do not deploy.**

---

## §4 — Deploy the receiver candidate

```
wrangler versions deploy <RECEIVER_CANDIDATE_VERSION>@100 --name siteborne-storage-alert-receiver
```

**HUMAN-EXECUTED LIVE MUTATION.**

---

## §5 — Verify receiver privacy immediately after deploy

Re-run the exposure checks from §3 (subdomain/preview/domain/route) against the
now-active version. Require all four to read exactly as before this runbook started.
Also re-run:

```
wrangler deployments list --name siteborne-storage-alert-receiver
```

and require `<RECEIVER_CANDIDATE_VERSION>` at 100%.

---

## §6 — Build/upload the utility-edge candidate while preserving live vars

`wrangler versions upload --keep-vars` preserves only dashboard-injected vars, not
any value that was previously supplied via a one-off `--var` flag on a prior upload
— if `<UTILITY_EDGE_ACTIVE_VERSION>` carries any var not declared in
`wrangler.toml`'s own `[vars]` block, `--keep-vars` alone will not reproduce it and
you must supply it explicitly (see the prior session's `PAID_ROUTES_ENABLED` /
`PAYMENT_ENVIRONMENT` / `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` finding). Read the
live var set first:

```
wrangler versions view <UTILITY_EDGE_ACTIVE_VERSION> --name siteborne-utility-edge
```

and compare it, var by var, against `wrangler.toml`'s `[vars]` block yourself before
deciding whether `--keep-vars` alone is sufficient for this deploy. Then:

```
wrangler versions upload --keep-vars \
  --message "be20b75 bounded SMTP transport cleanup"
```

**HUMAN-EXECUTED LIVE MUTATION.** Capture the printed version ID as
`<UTILITY_EDGE_CANDIDATE_VERSION>`.

---

## §7 — Verify zero drift before deploying

```
wrangler versions view <UTILITY_EDGE_CANDIDATE_VERSION> --name siteborne-utility-edge
```

Diff this against the `<UTILITY_EDGE_ACTIVE_VERSION>` output from §6, field by
field — every var, every binding (D1/R2/KV/queues/workflows/Service Binding/AI/
Browser), every secret name. Require zero differences. Separately confirm
`PAID_ROUTES_ENABLED=false` in the candidate's actual var set (not assumed). If
anything differs: **STOP. Do not deploy.**

---

## §8 — Deploy the utility-edge candidate

```
wrangler versions deploy <UTILITY_EDGE_CANDIDATE_VERSION>@100 --name siteborne-utility-edge
```

**HUMAN-EXECUTED LIVE MUTATION.**

Immediately verify:

```
curl -s -o /dev/null -w '%{http_code}\n' https://utility.siteborne.net/health
curl -s -o /dev/null -w '%{http_code}\n' https://utility.siteborne.net/ready
```

Require `200` for both, plus a spot-check of one or two representative existing
protocol surfaces you already know the expected response shape for (e.g. the
agent-card well-known endpoint) before proceeding.

---

## §9 — Run one non-delivery SMTP handshake diagnostic

Only after §5 and §8 both hold. This is the diagnostic route
(`storage-alert-smtp-diagnostic-route.ts`), not the qualification path — it is
structurally incapable of `AUTH`/`MAIL FROM`/`RCPT TO`/`DATA`/email delivery. If a
diagnostic bearer token does not already exist, create exactly one fresh one (never
printed, never committed) and set it on the utility-edge Worker only:

```
wrangler versions secret put STORAGE_ALERT_SMTP_DIAGNOSTIC_TOKEN --name siteborne-utility-edge
```

**HUMAN-EXECUTED LIVE MUTATION.** Then run the negative controls first (GET, POST
with no auth header, POST with a wrong bearer value) and require all three to
fail closed (404) with zero receiver invocations before the authenticated request:

```
curl -s -o /dev/null -w '%{http_code}\n' https://utility.siteborne.net/internal/storage-alert-smtp-diagnostic
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://utility.siteborne.net/internal/storage-alert-smtp-diagnostic
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Authorization: Bearer wrong' https://utility.siteborne.net/internal/storage-alert-smtp-diagnostic
```

Then run exactly one authenticated request:

```
curl -s -X POST -H "Authorization: Bearer <token>" https://utility.siteborne.net/internal/storage-alert-smtp-diagnostic
```

Record the exact SMTP stage reached (or the caller-side timeout, if the receiver
still doesn't respond in time). Do not retry automatically.

---

## §10 — Only if the handshake succeeds, separately authorize qualification attempt #3

This runbook does not authorize that step. It is a distinct decision requiring its
own explicit authorization at the time, informed by §9's actual result — not a
default next action.

---

## §11 — Cleanup temporary diagnostic/qualification credentials

```
wrangler versions secret delete STORAGE_ALERT_SMTP_DIAGNOSTIC_TOKEN --name siteborne-utility-edge
```

**HUMAN-EXECUTED LIVE MUTATION.** Then redeploy the current utility-edge version (or
upload+deploy a cleanup version if the token's removal requires a new version to take
effect — check `wrangler`'s actual behavior for secret deletion on a versioned
Worker before assuming either way) and verify the diagnostic route now returns 404
even with the just-deleted token. Confirm `STORAGE_ALERT_PATH_TOKEN` (the receiver's
own separate auth token) is untouched throughout.

---

## §12 — Final permanent release cleanup

Only after every step above is independently verified: decide, as the operator,
whether `smtp-diagnostic-starttls-observability` should be merged to `main` (or
rebased/squashed first), whether the now-superseded receiver/edge candidate versions
from earlier sessions should be pruned, and whether this runbook file itself should
be archived or left in place for the next incident. None of that is executed here.
