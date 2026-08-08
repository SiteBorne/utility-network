# SITEBORNE Utility Network - ADR 0004: Public HTTP Security Boundary

## Context

The `direct-public-http` adapter accepts an arbitrary caller-supplied URL.
Unlike the other five adapters (which only ever call a fixed, hardcoded base
URI), this is the one adapter where SSRF is a live design concern: without
validation, a caller could direct the adapter to fetch cloud metadata endpoints,
internal services, or loopback addresses.

## Decision

`validateUrl()` (`packages/provider-adapters/src/policy/network-policy.ts`) runs
before any network call, and again against every redirect target
(`validateRedirectChain()`), rejecting:

- non-`http`/`https` schemes;
- `localhost` and `localhost.localdomain`;
- IPv4 private ranges (`10/8`, `172.16/12`, `192.168/16`), loopback (`127/8`),
  link-local (`169.254/16`, including the AWS/GCP/Azure metadata address),
  multicast, and reserved ranges;
- IPv6 loopback (`::1`), link-local (`fe80::/10`), and unique-local (`fc00::/7`,
  covering both the `fc00::` and `fd00::` halves);
- IPv4-mapped IPv6 literals (`::ffff:a.b.c.d`, in both dotted-quad and the
  WHATWG-URL-normalized hex-group form) wrapping any of the above;
- blocked ports (SSH, SMTP, common database ports) and non-allow-listed ports;
- redirect loops and chains exceeding the configured maximum.

A rejected destination returns `invalid_request` with **zero** network calls —
validation happens before `httpClient.fetch()` is ever invoked.

## What this boundary does not cover

- **DNS-answer validation**: `validateUrl()` inspects the literal hostname in
  the URL. It does not resolve DNS itself and has no injected resolver to
  validate against, so it cannot reject a hostname whose _resolved_ address is
  prohibited (a hostname that resolves to `169.254.169.254`, for instance, is
  not currently caught before the underlying `fetch()` runs).
- **Connection pinning / TOCTOU DNS-rebinding protection**: nothing in this
  package binds the TCP connection to the address that was validated. A DNS
  answer that changes between validation and connection (classic rebinding) is
  not defended against. This is a `fetch()`-runtime-level guarantee this package
  cannot provide on its own.

## Status

Accepted, with the above gaps explicitly recorded (not silently assumed
covered).

## Consequences

- `direct-public-http` may activate in fixture/test mode today; production live
  execution of arbitrary caller-supplied URLs must remain disabled until
  destination-safety binding (DNS-answer validation plus connection pinning) is
  implemented and proven — tracked as a distinct, later, dependency-safe task,
  not bundled into SUN-0300's acceptance.
- See `docs/guides/public-http-security.md` for the full validated/tested vs.
  not-yet-proven breakdown.
