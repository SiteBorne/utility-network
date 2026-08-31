# SUN-1221E6R-H1S — Correction: job de147124 is real, not synthetic

**This supersedes the classification in SUN-1221E6R-H1R
(commit c1d9e78).** H1R's "synthetic/artifact" conclusion was wrong. It
rested on two mistaken readings of real evidence, both corrected below by
reading the actual production code and querying every job in the database,
not just the one under suspicion.

## What H1R got wrong

**1. `attempt_hash` "placeholder" pattern.**
H1R treated the zero-padded `attempt_hash` values on this job's
`job_state_events` rows as evidence of fabrication. They are not — they are
the literal, correct output of the real production function
`computeAttemptHash()` /
`hash()` in
[`apps/edge-api/src/control-plane/state-machine/index.ts:82-101`](../../apps/edge-api/src/control-plane/state-machine/index.ts).
That function is mislabeled `sha256:` but is actually a 32-bit
Java-style rolling hash (`hash = (hash<<5) - hash + char; hash &= hash`),
`Math.abs()`'d and hex-padded to 64 characters — which *always* yields
~56 leading zeros. Querying every other job in production
(`ee04c4bf-…`, `11fde704-…`) shows the **identical** zero-padded pattern.
This is a real (separate, pre-existing) defect — the hash is weak and
mislabeled — but it is universal, not a synthetic marker.

**2. "Zero job_attempts/payment_attempts/payment_quotes rows."**
H1R queried `payment_attempts WHERE job_id = '<job>'` and got zero rows,
because **`payment_attempts.job_id` is `NULL` on every row in the table** —
the real code links a job to its payment attempt via
`payment_identifier` / `idempotency_key`, not `job_id`. Re-querying by the
correct key (`jobs.idempotency_key = payment_attempts.payment_identifier`)
finds an exact match:

```
payment_attempts.id = 3a728ffc-5f1b-4b12-8145-c84f25fc9330
payment_identifier  = pay_02703c94503e489890f51c4e98a771c6   (== jobs.idempotency_key)
quote_id            = qte_61fcb444041670ef5a639223
requirement_id      = req_378dcfd77e2bbac1dd1a0091
binding_digest      = sha256:fae6c0aef8d2335138fa1d1ff9a19722950552d2a72a905d6c8896b67de21ed1
service_id          = web_context_verified.v2
amount              = 9000  (0.009 USDC)
payee               = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
network              = eip155:8453
asset               = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
payment_rail        = cdp
payment_provider    = cdp-facilitator@1.55.0
lifecycle_stage     = verified
created_at          = 2026-08-31T04:46:24.078Z
```

`job_attempts` and `payment_quotes` are empty **for the entire production
database** (0 rows total, not just this job) — their absence is universal
and tells us nothing.

## Corrected picture

The production `jobs` table has exactly 6 rows total. De147124 is the only
one that ever reached `LOCKED`/`ROUTED`/`EXECUTING`; the other 5 are
`REJECTED` (×4) or `DELIVERED` (×1). **Three of the other four `REJECTED`
jobs also have a matching `payment_attempts` row at `lifecycle_stage:
"verified"`** with the same CDP-facilitator shape — meaning "payment
verified, then job rejected downstream" is a normal, recurring pattern in
this system, not unique to this incident.

The previously "impossible" 222ms `PAYMENT_CHALLENGED→PAYMENT_VERIFIED`
transition is not impossible: CDP custodial **signing** happens client-side
(the human operator's own script calling the CDP API), before the paid
HTTP request ever reaches the Worker. The Worker only performs facilitator
**verification** of an already-computed signature, which is fast. Nothing
in the timing rules out a genuine client-signed submission.

Given the timing (04:46:24 UTC) matches the human operator's reported
SUN-1221E6R-H1 attempt almost exactly, and H1's client-side Vitest process
timed out at 5000ms while the *server-side* Worker request could have kept
executing past that client abandonment, the most likely explanation is:
**this is H1's own paid submission, server-side, continuing after the
client gave up waiting.**

## What remains true

- Live Base-mainnet balance read (this turn): buyer
  `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99` = **28197 atomic USDC**,
  identical to every prior reading. **No on-chain settlement has occurred
  as of this check.**
- A real payment **authorization was verified** by the CDP facilitator
  (0.009 USDC, correct payee/asset/network) — verification is not
  settlement; settlement is a separate, later step in this system's design
  (charge only on successful delivery).
- The job is stuck in `EXECUTING`, past its `expires_at`
  (2026-08-31T04:51:23.504Z), with no `SETTLED`/`FAILED`/`COMPLETED`
  transition recorded.

## Open risk

A verified-but-unsettled real payment authorization is sitting in an
unresolved state. Whether it can still settle later, is safely abandoned by
expiry, or requires manual intervention depends on internals (queue
consumer / alarm handler) not fully traced in this pass. This needs the
human operator's attention, not a "just an artifact, ignore it"
conclusion.

**Zero mutations performed:** no D1 write, no job mutation, no payment, no
settlement, no deployment change.
