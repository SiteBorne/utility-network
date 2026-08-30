# SUN-1221E5Q6E — Cloudflare-IP TCP Prohibition Root Cause

## Lineage

| Checkpoint | Evidence commit | Finding |
|---|---|---|
| Q6A | `74a7c1e` | `WEBCTX_HTTP_PREMATURE_EOF` → `HEADER_PARSE_EOF` branch distinguished |
| Q6B | `a69efdb` | `HEADER_EOF_BYTE_CLASS=ZERO_RESPONSE_BYTES`; `allowHalfOpen` hypothesis refuted |
| Q6C | `40643e5` | connect-by-hostname control also zero-byte EOF; workerd#6903 (SNI) not sufficient cause |
| Q6D | `9a9bc41` | writer-close/`releaseLock` hypothesis refuted; api.github.com control on the same mechanism returned a real HTTP 200 (1129 bytes); `EXAMPLE_COM_SPECIFIC_DIFFERENTIAL_EXISTS=YES` |

Reconciliation: `git rev-parse HEAD` == `git rev-parse 9a9bc4153efb3c98a00e301316bb2f8ad0b8d599` == the Q6D evidence commit; working tree clean before this checkpoint. Production unchanged at `de70bf98-f304-4d7f-b189-4ae2401041a0` @100%.

## 1. Official Cloudflare TCP socket restriction

Source: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/ (fetched live this checkpoint).

> **Considerations**
> Outbound TCP sockets to Cloudflare IP ranges are blocked.

> **Troubleshooting — "proxy request failed, cannot connect to the specified address"**
> Your socket is connecting to an address that was disallowed. Examples of a disallowed address include Cloudflare IPs, localhost, and private network IPs.
> If you need to connect to addresses on port 80 or 443 to make HTTP requests, use fetch.

```
CLOUDFLARE_TCP_TO_CLOUDFLARE_IP_RANGES_ALLOWED=NO
CLOUDFLARE_RECOMMENDED_HTTP_80_443_API=fetch()
```

## 2. Authoritative Cloudflare IP ranges

Source: https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6 (the "list of IP ranges" linked directly from the TCP sockets doc's Considerations note), fetched live this checkpoint.

```
CLOUDFLARE_IPV4_RANGE_COUNT=15
CLOUDFLARE_IPV6_RANGE_COUNT=7
CLOUDFLARE_RANGE_SOURCE_AUTHORITATIVE=YES
```

IPv4: `173.245.48.0/20, 103.21.244.0/22, 103.22.200.0/22, 103.31.4.0/22, 141.101.64.0/18, 108.162.192.0/18, 190.93.240.0/20, 188.114.96.0/20, 197.234.240.0/22, 198.41.128.0/17, 162.158.0.0/15, 104.16.0.0/13, 104.24.0.0/14, 172.64.0.0/13, 131.0.72.0/22`

IPv6: `2400:cb00::/32, 2606:4700::/32, 2803:f800::/32, 2405:b500::/32, 2405:8100::/32, 2a06:98c0::/29, 2c0f:f248::/32`

## 3. Historical selected destination address

Searched Q6B/Q6C/Q6D evidence reports for any literally-logged resolved IP address for the failing example.com connection. None was recorded — the reports document that `connectIp` is resolved via `resolveSafeAddress` (a separate DoH lookup) but do not print the resulting literal address.

```
Q6D_EXAMPLE_COM_SELECTED_ADDRESS=UNRECOVERABLE_FROM_EXISTING_EVIDENCE
Q6D_EXAMPLE_COM_SELECTED_ADDRESS_FAMILY=UNKNOWN
ADDRESS_RECOVERED_FROM_EXISTING_EVIDENCE=NO
```

Per instruction, no new remote SafeSocket request was made to recover it. Historical CIDR membership is therefore **not directly provable** and is classified `UNPROVEN` rather than assumed.

## 4. Current resolver candidate set (public DNS, no SITEBORNE code path)

```
$ dig +short A example.com     → 104.20.23.154, 172.66.147.243
$ dig +short AAAA example.com  → 2606:4700:10::6814:179a, 2606:4700:10::ac42:93f3
$ dig +short A api.github.com  → 140.82.114.6
$ dig +short AAAA api.github.com → (none)
```

Deterministic CIDR membership test (Python `ipaddress`, exact-match against §2's list):

| Address | Family | In Cloudflare range | Matched CIDR |
|---|---|---|---|
| 104.20.23.154 | v4 | **YES** | 104.16.0.0/13 |
| 172.66.147.243 | v4 | **YES** | 172.64.0.0/13 |
| 2606:4700:10::6814:179a | v6 | **YES** | 2606:4700::/32 |
| 2606:4700:10::ac42:93f3 | v6 | **YES** | 2606:4700::/32 |
| 140.82.114.6 (api.github.com) | v4 | NO | — |

```
SELECTED_ADDRESS_IN_CLOUDFLARE_RANGE=UNPROVEN   (historical address unrecoverable)
EXAMPLE_COM_CURRENT_ADDRESSES_ALL_CLOUDFLARE=YES   (4/4 current candidates)
EXAMPLE_COM_CLOUDFLARE_HOSTING_CORROBORATED=YES
Q6D_GITHUB_SELECTED_ADDRESS=UNRECOVERABLE_FROM_EXISTING_EVIDENCE (historical)
GITHUB_ADDRESS_IN_CLOUDFLARE_RANGE=NO   (current address; historical UNPROVEN but consistent — GitHub's API is not Cloudflare-fronted, matching Q6D's real HTTP 200 result)
```

## 5. Failure-shape compatibility

Cloudflare's documented enforcement for a disallowed destination is a **connect-time rejection**: `connect()`/the `opened` promise fails with "proxy request failed, cannot connect to the specified address" before any read/write occurs.

What Q6B/Q6D actually observed for example.com was different: `connect()` resolved, `startTls()` returned a distinct secure socket object, `writer.write()` resolved, the writer was closed/released without error — i.e., the connection *appeared* to establish successfully at every promise boundary — and only the subsequent `reader.read()` returned `done:true` with zero bytes.

```
DOES_CLOUDFLARE_DOCUMENT_EXACT_ZERO_BYTE_EOF=NO
POLICY_RESTRICTION_PROVEN=YES        (as a class — the policy exists and example.com's current address space matches it)
EXACT_INTERNAL_ENFORCEMENT_SYMPTOM_UNDOCUMENTED=YES   (the specific resolved-connect + silent zero-byte-close shape is not what the docs describe)
```

## 6. Root-cause hard gate (§9 of directive)

Gate requires **all** of: (A) known historical address, (B) that address inside an official prohibited range, (C) platform explicitly prohibits it, (D) successful control sufficiently distinguishes, (E) no contradicting evidence.

(A) fails — the historical address was never logged and no new remote call was authorized to recover it.

Per the directive's own fallback: *"If exact historical IP is unavailable but all example.com resolver candidates are Cloudflare addresses: classify `ROOT_CAUSE_CONFIDENCE=HIGH` but `E5_HEADER_EOF_ROOT_CAUSE_PROVEN=NO` until the historical address link is authoritative."* — this is exactly the state reached here.

```
E5_HEADER_EOF_ROOT_CAUSE_PROVEN=NO
ROOT_CAUSE_CONFIDENCE=HIGH
```

## 7. Classification

```
E5_HEADER_EOF_ROOT_CAUSE_CLASS=CLOUDFLARE_WORKERS_TCP_DESTINATION_PROHIBITED_CLOUDFLARE_IP_RANGE (high-confidence, not formally proven)
CLOUDFLARE_PLATFORM_RESTRICTION=YES
HTTP_PARSER_DEFECT=NO
WRITER_LIFECYCLE_DEFECT=NO
ALLOW_HALF_OPEN_DEFECT=NO
SNI_6903_DEFECT_FOR_THIS_FAILURE=NO
REQUEST_SERIALIZATION_DEFECT=NO
REPOSITORY_TRANSPORT_IMPLEMENTATION_BUG=NO
```

SafeSocket's implementation is not shown to be defective for destinations Cloudflare permits. The problem, at high confidence, is that a category of legitimate public destinations (any site whose current DNS resolves into Cloudflare's own edge IP space — a large and common category, since Cloudflare fronts a significant share of the public web) is categorically unreachable via `cloudflare:sockets.connect()`, regardless of how correctly SafeSocket is implemented.

```
E5_CANONICAL_TARGET_VALID_FOR_WORKER_RAW_TCP_QUALIFICATION=NO
```

example.com's current address space is entirely Cloudflare-owned. Continuing to use it as the E6 qualification target is inappropriate independent of whether the exact low-level enforcement mechanism is ever fully proven.

## 8. Service contract impact

`contracts/releases/2.0.0/metadata/web_context_verified.v2.json` / `web-context-input.schema.json`:

> `target_url`: *"Target URL to retrieve. Public HTTP/HTTPS only."*

No carve-out excludes Cloudflare-fronted origins. `retrieval_mode` supports `direct` (the failing SafeSocket path) and `rendered` (browser-rendered — a materially different code path, likely unaffected by this restriction since it does not call `cloudflare:sockets.connect()` directly).

```
SERVICE_CONTRACT_EXPECTS_CLOUDFLARE_HOSTED_SITES_SUPPORTED=YES
RAW_SAFESOCKET_CAN_COVER_FULL_SERVICE_CONTRACT=NO
CHANGING_E6_TARGET_ONLY_IS_COMPLETE_FIX=NO
```

## 9. Security invariants (hard constraints for any future architecture)

DNS resolution inspection · private/reserved address rejection · DNS rebinding/TOCTOU resistance · redirect revalidation · hostname TLS identity · response size bounds · timeout bounds · TermsGuard · fixed economic semantics · no arbitrary proxy trust expansion.

## 10. Architecture option audit (read-only — nothing implemented)

| Option | Full public-web coverage | DNS pinning preserved | SSRF invariant preserved | TLS hostname validation | Redirect revalidation | New trust boundary | Architecture change | Security confidence |
|---|---|---|---|---|---|---|---|---|
| A: global `fetch()` for everything | YES | NO | NO (as-is) | via platform | via platform | Cloudflare's own resolver | YES | LOW as-is |
| B: SafeSocket + `fetch()` fallback for CF-hosted targets | YES | Partial (fetch leg not pinned) | UNPROVEN | via platform (fetch leg) | via platform (fetch leg) | Cloudflare's own resolver for fallback leg | YES | MEDIUM, needs design |
| C: SafeSocket + external controlled fetch executor | YES | YES (if executor re-validates) | YES (if executor re-validates) | executor-controlled | executor-controlled | new executor becomes a trust boundary | YES | MEDIUM–HIGH, needs design |
| D: move direct-http retrieval off the CF-socket-restricted runtime entirely | YES | YES | YES | preserved | preserved | new execution environment | YES | HIGH, largest change |
| E: reject Cloudflare-hosted targets as explicitly unsupported | NO | N/A | N/A | N/A | N/A | none | NO | HIGH (simplest, but breaks contract) |

```
WORKERS_FETCH_SUPPORTS_VALIDATED_IP_PINNING=NO
```

Checked live: `RequestInitCfProperties.resolveOverride` exists, but per Cloudflare's own docs it "will only take effect if both the URL host and the host specified by resolveOverride are within your zone" — it cannot pin an arbitrary third-party public destination, which is exactly SITEBORNE's use case. No other documented Workers `fetch()` mechanism offers destination-IP pinning.

```
NAIVE_CLOUDFLARE_CIDR_FETCH_FALLBACK_SAFE=NO
```

A naive `if destination ∈ CF CIDRs: fetch(hostname) else SafeSocket(validated IP)` policy re-resolves the hostname inside `fetch()` at a different time than SafeSocket's validation, reopening a TOCTOU/DNS-rebinding window `fetch()` cannot be pinned shut for arbitrary hosts (per above). Default-NO stands.

```
EXISTING_NON_CLOUDFLARE_FETCH_EXECUTOR_AVAILABLE=NO
```

No existing non-Workers execution environment for controlled HTTP retrieval was found in the repository.

## 11. Regression / containment

No SafeSocket, parser, TLS, retry, timeout, or economic behavior was changed. No code was modified this checkpoint (read-only forensics + one report). `pnpm production:preflight` PASS. `pnpm secrets:scan`: 2 pre-existing findings (`a755620`, `322852a`), 0 new.

```
Q6E_REMOTE_NETWORK_REQUEST_COUNT=0
WORKER_VERSION_UPLOADS=0
PRODUCTION_DEPLOYMENTS=0
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
FINAL_PRODUCTION_PREFLIGHT=PASS
LIVE_402_REQUESTS=0, PAYMENT_SIGNATURES_CREATED=0, PAID_REQUESTS=0, SETTLEMENTS=0, REAL_ECONOMIC_EFFECT_USDC=0
CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE
```

## Next checkpoint

`WEB_CONTEXT_CLOUDFLARE_DESTINATION_SAFE_ARCHITECTURE` — design (not implement) a security-preserving path for Cloudflare-fronted public destinations before any further E6 consideration. `SUN1221E6_REAL_PAID_RETRY_ELIGIBLE=NO`.
