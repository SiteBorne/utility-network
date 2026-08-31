# webctx-safe-egress

SUN-1221E5Q6G — dedicated off-Cloudflare safe-egress executor for
`web_context_verified.v2`'s `retrieval_mode: 'direct'` HTTP retrieval.

## Why this exists

`packages/provider-adapters/src/http/socket-http-client.ts` (`SafeSocketHttpClient`)
cannot reach any target whose resolved address falls inside Cloudflare's own IP
ranges — Cloudflare Workers documents that outbound `cloudflare:sockets`
connections to Cloudflare IP ranges are blocked (SUN-1221E5Q6E, proven live
against current Cloudflare docs). Since `web_context_verified.v2`'s contract is
"Public HTTP/HTTPS only" with no Cloudflare-hosted-site carve-out, this is a
genuine architecture gap, not a target-selection problem (SUN-1221E5Q6F).

This service is the approved fix (SUN-1221E5Q6F Approach C, human-approved for
SUN-1221E5Q6G): move ALL direct-public-http retrieval to a dedicated,
non-Cloudflare execution environment (Modal) that independently — never
trusting a Worker-supplied "this is safe" claim — performs the exact same
SSRF/DNS-rebinding/TLS-identity safety algorithm SafeSocket already implements,
then returns a bounded, structured result. The Worker keeps 100% of payment
gating, TermsGuard, and PCC generation; only the transport hop moves.

## Structural isolation

- Never imports or is imported by `services/modal-worker` (the unrelated
  document/OCR app) — separate `pyproject.toml`, separate Modal App identity,
  separate credentials. `REUSE_EXISTING_OCR_MODAL_APP=NO` /
  `REUSE_EXISTING_MODAL_OCR_CREDENTIALS=NO` (SUN-1221E5Q6G directive).
- Receives zero payment material: no EIP-3009 authorization, no facilitator
  credentials, no receipt-signing key, no CDP credentials, no seller-wallet
  secret ever reaches this codebase (`EXECUTOR_RECEIVES_PAYMENT_MATERIAL=NO`).
  It cannot settle, sign, or charge (`EXECUTOR_ECONOMIC_CAPABILITY=0`).
- The Web Function endpoint (`src/webctx_safe_egress/app.py`) is declared
  `requires_proxy_auth=True` — Modal's platform itself rejects any request
  missing/mismatching the `Modal-Key`/`Modal-Secret` header pair *before* this
  service's code ever runs. That enforcement is platform-level, not
  reimplemented here; app code additionally validates the request body against
  a versioned pydantic schema as defense-in-depth.

## Layout

```
src/webctx_safe_egress/
  security/
    ip_classify.py    — pure IP-address classification (ports network-policy.ts)
    url_validate.py    — scheme/port/hostname validation (ports network-policy.ts)
    dns_resolve.py      — safe DNS resolution, fail-closed on mixed/prohibited answers
  transport.py           — IP-pinned TLS HTTP/1.1 client (dial-by-IP, SNI/cert by hostname)
  executor.py             — per-hop orchestration: validate → resolve → connect → redirect loop
  schemas.py                — versioned request/response contracts
  app.py                      — Modal App + proxy-authenticated Web Function entrypoint
tests/                         — TDD suite (RED/GREEN), see docs/reports/SUN-1221E5Q6G-*.md
```

## Local development

```
cd services/webctx-safe-egress
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
```

No `modal` import anywhere except `app.py` (mirrors ADR 0029's separation
discipline for `services/modal-worker`), enforced by
`tests/test_no_modal_leakage.py`.
