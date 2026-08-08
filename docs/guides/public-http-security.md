# Public HTTP Security Guide

Scope: `packages/provider-adapters/src/http/public-http-adapter.ts` and
`packages/provider-adapters/src/policy/network-policy.ts` — the one adapter in
this package that accepts a caller-supplied arbitrary URL rather than calling a
fixed provider base URI. See also
[ADR 0004](../adrs/0004-public-http-security-boundary.md).

## Status, per guarantee

| Guarantee                                            | Status                           | Evidence                                             |
| ---------------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| URL scheme / IP-literal validation                   | implemented, tested              | `src/tests/http-ssrf.test.ts`                        |
| Redirect target revalidation                         | implemented, tested              | `src/tests/http-ssrf.test.ts` (redirect chain tests) |
| Redirect loop / max-redirect bound                   | implemented, tested              | `src/tests/http-ssrf.test.ts`                        |
| Injected-DNS-answer validation                       | **not implemented**              | no resolver is injected anywhere in this package     |
| Connection pinning / TOCTOU DNS-rebinding protection | **not implemented**              | `fetch()` is the runtime's own implementation        |
| Production live execution of arbitrary caller URLs   | **disabled** (fixture-mode only) | terms review is `pending_review`; see ADR 0002       |

## What is validated, and where

1. **Scheme**: only `http`/`https` pass
   (`DEFAULT_NETWORK_POLICY.allowedSchemes`).
2. **Port**: blocked ports (22, 23, 25, 110, 143, 993, 995, 3306, 5432,
   6379, 27017) are rejected outright; only 80/443 are allow-listed by default.
3. **Hostname literal**: `localhost` and `localhost.localdomain` are rejected by
   name (not IP), independent of any address check.
4. **IPv4 literal**: private (`10/8`, `172.16/12`, `192.168/16`), loopback
   (`127/8`), link-local (`169.254/16` — this is also the AWS/GCP/Azure/DO
   instance-metadata address), multicast (`224-239/8`), and reserved (`0/8`,
   `240-255/8`) ranges are all rejected.
5. **IPv6 literal**: loopback (`::1`), link-local (`fe80::/10`), and
   unique-local (`fc00::/7`, both the `fc00::` and `fd00::` halves) are
   rejected. `URL.hostname` retains brackets for IPv6 literals (`"[::1]"`),
   which `validateUrl()` strips before matching.
6. **IPv4-mapped IPv6**: `::ffff:a.b.c.d` is recognized in both its literal
   dotted-quad form and the form the WHATWG URL parser normalizes it to
   (`::ffff:xxxx:xxxx` hex groups), and the embedded IPv4 address is
   re-validated against the same IPv4 rules.
7. **Redirects**: every `Location` target is re-validated with the same
   `validateUrl()` before being followed (`SecureHttpClient.fetch()`); redirect
   chains are checked for loops and bounded by `NetworkPolicy.maxRedirects`.

A rejected destination returns `resultClass: 'invalid_request'` before
`InjectedHttpClient.fetch()` is ever called — every test in
`src/tests/http-ssrf.test.ts` that exercises the adapter (not just the policy
function directly) asserts the injected HTTP client's call count is `0`.

## What is explicitly not covered

`validateUrl()` operates on the URL's literal hostname/IP. Two real-world attack
classes it cannot address on its own:

- **DNS rebinding**: an attacker-controlled domain that resolves to a safe IP at
  validation time and a prohibited IP at connection time. Defending against this
  requires resolving DNS once, validating the resolved address, and then binding
  the actual TCP connection to that specific validated address (connection
  pinning) — none of which this package's `fetch()`-based `InjectedHttpClient`
  currently does.
- **Split-horizon / attacker-controlled DNS answers in general**: without an
  injected resolver, there's nothing in this codebase to test a "DNS answer
  contains a prohibited address" scenario against; it is a genuine, tracked gap,
  not a tested-and-passing guarantee.

## Production activation

`direct-public-http`'s manifest has `terms_review_status: 'pending_review'` and
no recorded `TermsGuard` review, so `execution_mode: 'live'` returns
`policy_blocked` regardless of destination validation. Production activation of
arbitrary caller-supplied URLs requires, at minimum:

1. A recorded terms review (ADR 0002) — `direct-public-http`'s "terms" are
   effectively RFC 9110 plus this project's own acceptable-use policy, since
   there is no single external terms document for arbitrary HTTP fetches.
2. DNS-rebinding protection (connection pinning to a validated address) —
   tracked as a future dependency-safe task; do not activate arbitrary direct
   HTTP execution in production before this lands.
