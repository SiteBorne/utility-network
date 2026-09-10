# SUN-1222C-MTLS-PRODUCTION-PROVISIONING — Operator Runbook

**Status:** Not executed. Written by Claude as a literal, operator-run procedure per
`SUN-1222C-MTLS-PRODUCTION-PROVISIONING-AUTHORIZED`, corrected by
`SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION` (see
`docs/reports/SUN-1222C-deployment-dependency-and-mtls-truthfulness-remediation.md`
for the full audit trail behind every correction below). Claude performed zero
Cloudflare reads or writes to produce this — every Cloudflare-side command below is
unexecuted and must be run by you, in your own authenticated session, with your own
judgment at each checkpoint.

**Corrections made by the remediation checkpoint (read before running anything
from the earlier version of this file):**
1. **§11's canary tests were self-contradictory** — the old §9 WAF rule blocks
   *every* path on the dedicated mTLS hostname without a verified cert, but the old
   §11 test #1 expected a no-cert GET on that same hostname to *pass*. Corrected:
   the dedicated host now REJECTS every no-cert request, full stop; the "public
   host still works without a cert" proof lives only on `utility.siteborne.net`
   (§13-15, unaffected by any of this).
2. **The x402/mTLS orthogonality test (old §20) targeted `utility.siteborne.net`**
   — the canonical hostname, which never gets a client-certificate hostname
   association at all, so a cert-bearing request against it proves nothing about
   mTLS+x402 orthogonality. Corrected to target the dedicated mTLS hostname.
3. **The A2A liveness probe (old §19/§13) used the JSON-RPC method name
   `agent/getAuthenticatedExtendedCard`**, never verified against this repo's own
   server. Traced directly against `packages/protocol-a2a/src/transport.ts:75-78`:
   the real accepted method is the literal string `"SendMessage"` — the pinned A2A
   v1.0 (gRPC-transcoded) convention. The old v0.3 JSON-RPC names (`message/send`,
   `tasks/send`) are explicitly, deliberately REJECTED by this server
   (`'legacy A2A v0.3 methods are not supported'`) — using either would have made
   the "liveness" probe always fail regardless of mTLS state, a false-negative
   trap. Corrected below.
4. **The old §17's `SAFE_DEPLOYMENT_ORDER` (paid-continuation-runtime, then public
   API) was reasoned from an unconfirmed Workflow version-pinning assumption the
   file itself flagged as unverified.** The remediation checkpoint traced the
   actual PCC/MCP compatibility matrix instead (four pairs of
   old/new-paid-runtime × old/new-public-API) and found the **opposite** order is
   required: deploying the paid runtime first, while the public API's MCP adapter
   still runs the old `body.output`-unwrapping code, produces `result: undefined`
   for every MCP caller — a silent, already-paid-for regression, not a no-op. See
   the evidence report §17-18 for the full matrix. **PCC deployment itself has
   been moved out of this file** (see point 5) — this file only needs to know the
   order if it ends up deploying `siteborne-utility-edge` for the mTLS truthfulness
   flag (§17 below) at the same time an operator is separately running the PCC
   deployment from the evidence report; if so, public API before paid runtime.
5. **PCC (`ac642cb`) deployment content removed from this file entirely.** It now
   has its own manual two-Worker deployment runbook in
   `docs/reports/SUN-1222C-deployment-dependency-and-mtls-truthfulness-remediation.md`
   §24-29 (predeploy gates, paid-runtime deploy, intermediate qualification,
   public-API deploy, rollback matrix) — this file's scope is Cloudflare mTLS
   config plus, if genuinely needed, a same-Worker deploy of the truthfulness flag
   below.
6. **A repository-side truthfulness gap was found and fixed independently of
   Cloudflare**: `securitySchemes.mtls` was unconditional in `card.ts` — deploying
   `106b8285…`'s source as it stood would have advertised native mTLS capability
   before any real Cloudflare mTLS interface existed. Fixed with a new
   `MTLS_PRODUCTION_ACTIVE` env gate (default `false`, RED→GREEN→mutation-proved,
   25/25 targeted tests green — see the evidence report). **This gate must stay
   `false`/absent through this entire runbook** — flip it only after §16 below
   fully qualifies a real mTLS interface, and only in its own reviewed commit/step,
   never silently bundled into an unrelated deploy.

**What Claude verified directly (repo + live Cloudflare docs, this session):**
- Repo state: `HEAD=cf0a1131b311d48d809f734a21fe6d5213536c4f`, branch `main`, working
  tree clean, `X402_DISPOSITION_COMMIT_SHA`, `MTLS_PROVISIONING_PLAN_COMMIT_SHA`
  (`f450bf0d…`), and `MTLS_IMPLEMENTATION_COMMIT_SHA` (`106b8285…`) all reachable
  from `main`.
- `106b8285…` (`SUN-1222C-AGENT-TRUST-100-IMPLEMENTATION-A`) added
  `deriveMtlsCallerContext()` / `evaluateMtlsAuthorization()` in
  [mtls-caller-context.ts](apps/edge-api/src/control-plane/security/mtls-caller-context.ts)
  and declared `securitySchemes.mtls` on the Agent Card, but **wired the policy
  primitive into zero routes** — confirmed by `grep -rn evaluateMtlsAuthorization
  apps/edge-api/src` returning only the function's own definition and its test file.
  See **§0** below; this is a real gap you need to decide how to handle before §13
  can be proven.
- Route surface actually registered in
  [index.ts](apps/edge-api/src/index.ts): `/health`, `/ready`, `/mcp`, `/a2a`,
  `/.well-known/agent-card.json`, `/.well-known/jwks.json`,
  `/.well-known/mcp-registry-auth`, `/catalog`, `/services`, `/schemas`,
  `/benchmarks`, `/`, four `/v2/*` paid CDP routes, `/v1/*` and unmatched `/v2/*`
  → 404.
- `SITEBORNE_A2A_ORIGIN = "https://utility.siteborne.net"` is declared in
  [constants.ts](packages/protocol-a2a/src/constants.ts), **but `wrangler.toml`'s
  `routes` array contains only** `siteborne.net/.well-known/mcp-registry-auth` — no
  route or Custom Domain for `utility.siteborne.net` exists in this repo's tracked
  config. See **§1**; do not assume that hostname is live-routed to this Worker
  without checking.
- `AgentCard.supportedInterfaces` (pinned `@a2a-js/sdk@1.0.1`) is
  `{ url: string; protocolBinding: string; tenant: string; protocolVersion: string }[]`,
  "Ordered list … first entry is preferred" — confirmed in the installed package's
  own `.d.ts`. Adding a second entry for an mTLS-authenticated origin is
  standards-safe; keep the existing public entry first. See **§16**.
- **Corrected settlement baseline** (an earlier chat summary wrongly said "six real
  call sites" — that was a count of *files whose text merely mentions* `.settle(`,
  including doc-comments, not a call-site count). The real, tested invariant,
  reconfirmed passing on `HEAD=cf0a113…` this session
  (`pnpm vitest run apps/edge-api/tests/settle-sole-ownership.test.ts` → 4/4 green):
  **exactly one production `evidenceProvider.settle()` call site**, in
  [paid-continuation-workflow.ts:682](apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts:682)
  (inside the dedicated Workflow). Two other `.settle(`-shaped, non-competing call
  sites exist and are asserted NOT to count: `cdp-provider.ts:161`
  (`this.facilitator.settle(...)`, the SDK client call *inside* that one production
  port call — not a second decision point) and
  `control-plane/testing/in-process-workflow-binding.ts:180`
  (`options.evidenceProvider.settle(...)`, test-support only, never imported by
  `index.ts`). This is your baseline for the §20 "settlement topology unchanged"
  check — use the test, not a raw grep, to verify it.
- Cloudflare mTLS mechanics, confirmed live against `developers.cloudflare.com`
  just now (not training-data recall):
  - All plans get a Cloudflare-managed client-certificate CA automatically — no
    separate "create a CA" step; **Client Certificates → Add Certificate** on the
    dashboard is the documented path (API automation exists per the docs' own
    text but this session's fetch could not resolve the exact endpoint page —
    treat the paths in §5 as **unverified, probe with a GET first**).
  - CSR command Cloudflare itself documents:
    `openssl req -new -newkey rsa:2048 -nodes -keyout client1.key -out client1.csr -subj '/C=GB/ST=London/L=London/O=Organization/CN=CommonName'`
  - Enforcement is a **WAF custom rule**, not an automatic reject-on-missing-cert:
    default template expression is
    `not cf.tls_client_auth.cert_verified` **and** `http.request.uri.path in {"/your-path"}`,
    action `Block`, with an optional `Hostname` field to scope it further.
  - Full `cf.tls_client_auth.*` field list (for your rule/test design):
    `cert_presented`, `cert_verified`, `cert_revoked`, `cert_fingerprint_sha1`,
    `cert_fingerprint_sha256`, `cert_serial`, `cert_ski`, `cert_subject_dn`,
    `cert_subject_dn_legacy`, `cert_subject_dn_rfc2253`, `cert_issuer_dn`,
    `cert_issuer_dn_legacy`, `cert_issuer_dn_rfc2253`, `cert_issuer_serial`,
    `cert_issuer_ski`, `cert_not_before`, `cert_not_after`, `cert_rfc9440`,
    `cert_rfc9440_too_large`, `cert_chain_rfc9440`, `cert_chain_rfc9440_too_large`
    — matches exactly the field set `mtls-caller-context.ts` already consumes via
    `request.cf.tlsClientAuth`, so the Worker-side type/parsing is already correct
    for whatever Cloudflare hands it.
  - To scope a CA by issuer instead of by "any Cloudflare-managed cert":
    `not (cf.tls_client_auth.cert_verified and cf.tls_client_auth.cert_issuer_ski eq "<SKI>")`,
    extracted via
    `openssl x509 -noout -ext authorityKeyIdentifier -in mtls.crt | tail -n1 | tr -d ': '`.

**What this runbook does NOT claim to have verified:** the exact REST endpoint
paths/payloads for issuing a client certificate or setting hostname associations
programmatically. Cloudflare's docs describe the dashboard flow in detail but this
session's live fetches of the API-reference pages 404'd or didn't resolve to the
schema. Every API-automation command below is marked `# UNVERIFIED PATH — probe
with GET first` and the dashboard path is given as the primary, confirmed route.
Use the dashboard for the actual mutations unless you independently confirm the API
shape from `https://developers.cloudflare.com/api/` in your own session first.

---

## §0. Enforcement model — decided, not assumed

```
EDGE_MTLS_ENFORCEMENT=Cloudflare
APPLICATION_MTLS_ENFORCEMENT=NOT_CURRENTLY_ROUTE-BOUND
ACTUAL_PROPOSED_MTLS_ENFORCEMENT_MODEL=A
EDGE_MTLS_SUFFICIENT_FOR_STRONG_CALLER_AUTH=YES
```

`evaluateMtlsAuthorization()` / `deriveMtlsCallerContext()` exist and are tested
(73/73 in commit `106b8285…`, `MTLS_POLICY_FUNCTION_RUNTIME_CONSUMERS=0` — confirmed
by `grep -rn evaluateMtlsAuthorization apps/edge-api` returning only the function's
own definition and its own test file, re-checked this session) but are not called
from any route. That is **Model A**: Cloudflare's edge (client-cert handshake +
WAF rule, §7-§9) is what actually rejects an unauthenticated request on the
mTLS hostname before the Worker runs; the Worker itself does not (today) gate
anything on `request.cf.tlsClientAuth` — it would only ever *consume* that trusted
identity if a later, separately authorized checkpoint wires a specific skill's
`securityRequirements` to it (already the explicit intent recorded in
[card.ts:146-153](packages/protocol-a2a/src/card.ts:146)'s own comment). This is
model **A**, not B or C — do not describe `evaluateMtlsAuthorization` as
"enforcing" anything in the evidence report; call it a reusable, tested,
not-yet-wired policy primitive.

Edge-only is sufficient for genuine caller-identity strength here because
Cloudflare's TLS terminator — not the Worker, not any client-suppliable header —
is what verifies the certificate chain and populates `request.cf.tlsClientAuth`;
the Worker (or, under Model A, the WAF rule alone) never has to trust anything the
client itself asserts. Paid operations still separately require x402 regardless of
mTLS state (§20 proves this explicitly) — mTLS is caller-identity only, never
payment authorization, so Model A does not weaken the payment boundary.

§11's four canary tests are therefore your **complete** evidence for this
checkpoint. A Worker-side diagnostic route that echoes back
`deriveMtlsCallerContext()`'s parsed output (state/fingerprint/issuer DN) would be
a genuine additional proof that the Worker *can* correctly consume the trusted
context once something is wired to it — but it is a new source change with its own
RED→GREEN→mutation cycle, not part of this runbook, and its absence does not block
Model A. Ask for it separately if you want that additional proof.

---

## §1. Confirm current live state before touching anything (read-only)

```bash
# Confirm which Cloudflare account/zone you're pointed at, read-only.
wrangler whoami

# Zone lookup for siteborne.net — note the returned zone id, you'll need it below.
curl -s "https://api.cloudflare.com/client/v4/zones?name=siteborne.net" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[] | {id, name, status}'

# Is utility.siteborne.net actually live and pointed at this Worker today?
# wrangler.toml has NO route/custom-domain entry for it — confirm empirically.
curl -sS -o /dev/null -w "utility.siteborne.net -> %{http_code}\n" \
  https://utility.siteborne.net/health
curl -sS https://utility.siteborne.net/.well-known/agent-card.json | jq '.name, .supportedInterfaces'

# If that 404s/525s/times out, utility.siteborne.net is not yet wired to this
# Worker at the DNS/route layer — STOP and resolve that first (it's a
# prerequisite this runbook assumes is already true; the plan commit f450bf0
# only confirmed the bare apex 525s, it did not confirm the utility. subdomain).
```

If `utility.siteborne.net` is not live, everything from §7 onward (which assumes a
canary subdomain of it) needs a different anchor hostname — stop and re-scope
before spending a certificate on a hostname that isn't reachable.

**`UTILITY_HOST_ROUTING_MODEL=UNKNOWN_UNTIL_OPERATOR_READBACK`** — `wrangler.toml`
proves nothing either way (its `routes` array has only the unrelated
`mcp-registry-auth` path); the actual mechanism is one of Custom Domain, Workers
Route, or plain DNS/CNAME to a non-Worker origin, and each implies a different
command shape below. Determine which, then use only that branch — do not run a
command that assumes the wrong one:

```bash
export ZONE_ID="<from the zone lookup above>"

# Is it a Workers Route (tracked at the zone level, not per-Worker)?
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '.result[] | select(.pattern | contains("utility.siteborne.net"))'

# Is it a Custom Domain (tracked per-Worker, account-level endpoint)?
export ACCOUNT_ID="<from `wrangler whoami`'s account list>"
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/domains?hostname=utility.siteborne.net" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result'

# Either way, confirm the plain DNS record for it:
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=utility.siteborne.net" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[] | {type, content, proxied}'
```

- If the **Workers Route** query returns a match → `UTILITY_HOST_ROUTING_MODEL=WORKERS_ROUTE`.
  Adding `mtls.utility.siteborne.net` later (§7) needs its own `routes` entry the
  same way, either in `wrangler.toml` (tracked, deploys with the Worker) or via the
  same `/workers/routes` API call (untracked, dashboard/API-only) — decide which
  and be consistent with how the existing `utility.siteborne.net` route itself is
  managed, so you're not mixing a tracked route with an untracked one on the same
  Worker.
- If the **Custom Domain** query returns a match → `UTILITY_HOST_ROUTING_MODEL=CUSTOM_DOMAIN`.
  §7 below (Custom Domain via dashboard) is already the right mechanism — proceed
  as written.
- If **both** are empty but the plain DNS query returns a record → the hostname is
  routed some other way (e.g. a separate, non-`siteborne-utility-edge` Worker, or a
  non-Worker origin) — STOP, this contradicts `SITEBORNE_A2A_ORIGIN`'s assumption
  and needs resolving before any of this runbook proceeds.
- If **all three** are empty → confirmed not live; stop per the paragraph above.

---

## §2. Cloudflare credential + permission check (read-only)

```bash
# Minimum scoped token, per Cloudflare's own permission-group model, for
# everything this runbook needs:
#   Zone > SSL and Certificates > Edit   (client certificates, hostname assoc.)
#   Zone > Firewall Services > Edit      (WAF custom rules)
#   Zone > DNS > Edit                    (canary hostname record, if needed)
#   Zone > Zone > Read                   (zone lookups)
# Scope the token to the siteborne.net zone only — not account-wide.

curl -s "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result.status'
```

Do not proceed past this point without a token whose permissions you have
personally reviewed in the Cloudflare dashboard (My Profile → API Tokens). Do not
use a Global API Key.

---

## §3. Capture pre-state (read-only, before any write)

```bash
export ZONE_ID="<from §1>"

curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/client_certificates" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result | length, .[].id' \
  > /tmp/mtls-pre-state-client-certs.json

curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?per_page=200" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[] | {name, type, content, proxied}' \
  > /tmp/mtls-pre-state-dns.json

curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  > /tmp/mtls-pre-state-waf-ruleset.json

wrangler deployments list --name siteborne-utility-edge > /tmp/mtls-pre-state-deployments.txt
```

Keep these four files — they're your rollback baseline and go into the evidence
report (§22).

---

## §4. Local key generation (never touches the repo, never touches Cloudflare secrets)

```bash
mkdir -p ~/.siteborne-mtls-qualification && cd $_
openssl req -new -newkey rsa:2048 -nodes \
  -keyout siteborne-qualification-client.key \
  -out siteborne-qualification-client.csr \
  -subj '/C=US/O=SITEBORNE/CN=siteborne-qualification-client-2026'
chmod 600 siteborne-qualification-client.key
```

`siteborne-qualification-client.key` never leaves this directory: never `cat` it
into a chat, a commit, a Worker secret, or D1. Only the **public** CSR
(`.csr`) and, after issuance, the **certificate metadata** (id, serial,
fingerprint, issuer DN, not-before/not-after — never the cert's raw PEM if you'd
rather keep even that off-repo) belong in the evidence report.

---

## §5. Issue exactly one qualification client certificate (dashboard — confirmed path)

1. Dashboard → your zone (`siteborne.net`) → **SSL/TLS → Client Certificates**.
2. **Add Certificate** → confirm CA shows as Cloudflare-managed (default, no
   separate CA-creation step exists or is needed) → **Reuse existing CA**, do not
   create a second one.
3. Choose **use your own CSR**, paste the contents of
   `siteborne-qualification-client.csr`.
4. Set validity (recommend short — 90 days — for a qualification cert; rotate
   later for anything longer-lived).
5. **Continue** → Cloudflare returns the signed certificate. Copy it to
   `~/.siteborne-mtls-qualification/siteborne-qualification-client.crt`.
6. Do **not** associate any hostname yet in this dialog — do that narrowly in §7,
   scoped to the canary only, so a mistake here can't affect production traffic.
7. Record from the response/dashboard: certificate `id`, `serial_number`,
   `fingerprint_sha256`, `issuer_dn`, `not_before`, `not_after`. This is what goes
   in the evidence report's `QUALIFICATION_CERT_STATUS` field — never the PEM.

```txt
# NOT PART OF THIS PROCEDURE — reference only, per
# SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION §16's rule
# ("UNVERIFIED_CLOUDFLARE_WRITE_COMMANDS_IN_RUNBOOK=0"): this session could not
# confirm the exact API schema live against developers.cloudflare.com/api/. DO
# NOT run this against a live zone. Use the dashboard path above as the sole
# sanctioned mutation for this step. If you specifically want API automation,
# independently confirm the exact endpoint/schema from Cloudflare's current API
# reference in your own session first, then write and run your own verified
# command — do not run the shape below as-is.
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/client_certificates" \
  -H "Authorization: Bearer $CF_API_TOKEN" -X POST \
  --data-binary @<(jq -n --arg csr "$(cat siteborne-qualification-client.csr)" \
    '{csr: $csr, validity_days: 90}')
```

---

## §6. Choose the canary hostname and confirm it's genuinely isolated

```
CANONICAL_PUBLIC_HOST_MTLS_MUTATION=PROHIBITED
```

`utility.siteborne.net` (the public canonical interface) never gets a
client-certificate hostname association, never gets an mTLS-scoped WAF rule, and
never becomes unreachable without a cert — nothing in this runbook proposes that,
and none of the steps below touch it except §13-15's before/after regression probe
(read-only). The dedicated-hostname architecture is the only one this runbook
implements:

- **Canary (temporary, this qualification only):** `mtls-canary.utility.siteborne.net`
- **Final (if §16 confirms the canary proved out):** `mtls.utility.siteborne.net`

Confirm the canary subdomain does not already resolve to anything (no existing DNS
record, no existing route), so you know it's additive, not a collision:

```bash
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=mtls-canary.utility.siteborne.net" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result | length'
# Expect 0. If non-zero, stop — this hostname is already in use for something else.
```

---

## §7. Point the canary hostname at the Worker

Dashboard → **Workers & Pages → siteborne-utility-edge → Settings → Domains &
Routes → Add → Custom Domain** → `mtls-canary.utility.siteborne.net`. Cloudflare
creates the proxied DNS record and the route together — prefer this over a manual
DNS record + separate `routes` entry, since Custom Domains handle both atomically
and this is a temporary canary you'll tear down in §17/§18 either way.

Do **not** add this hostname to `wrangler.toml`'s tracked `routes` array yet — the
canary is deliberately kept out of the deployed candidate's config until §16-18
decide the final architecture; adding it to source now would make it look like a
permanent decision it isn't yet.

---

## §8. Associate the qualification hostname with the client-certificate CA

**Dashboard path (primary, confirmed):** **Client Certificates** (same zone) → find
the certificate from §5 → **Hosts** section → **Edit** → add
`mtls-canary.utility.siteborne.net` (per Cloudflare's own doc: "the domain is
automatically appended for you" if you enter just the label — confirm the full FQDN
shows correctly before saving) → **Save**.

This step only makes Cloudflare *aware of* and *willing to request/verify* a client
cert on that hostname — it does **not** by itself reject unauthenticated requests.
That's §9, which is not optional (see §9's note).

**If you use the API instead — NOT PART OF THIS PROCEDURE, reference only.**
Cloudflare documents hostname associations as **REPLACE semantics**: a PUT
overwrites the entire associated-hostname list for a CA, not just adds one. This
session could not verify the exact endpoint schema live (the API-reference pages
404'd), so per §16's rule (`UNVERIFIED_CLOUDFLARE_WRITE_COMMANDS_IN_RUNBOOK=0`) the
block below is **not a sanctioned step of this runbook** — use the dashboard path
above instead. It is kept only so that if you independently confirm the real
endpoint shape (e.g. from the dashboard's own network tab while performing the §8
dashboard flow once, or Cloudflare's current API reference) and choose to automate
this yourself, the required *algorithm* — GET → merge → confirm → PUT → readback,
never a literal `<existing hostnames>` placeholder, always the file saved by the
GET — is documented correctly:

```bash
# NOT PART OF THIS PROCEDURE — reference only, endpoint path/schema unconfirmed.
# Do not run against a live zone without independently verifying the real
# endpoint first.
CA_ID="<the CA id shown next to the certificate in the dashboard, from §5>"

# 1. GET and save the exact existing list — never hand-type this.
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/certificate_authorities/hostname_associations?mtls_certificate_id=$CA_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '.result.hostnames' > /tmp/mtls-hostname-assoc-before.json
cat /tmp/mtls-hostname-assoc-before.json

# 2. Merge programmatically — append only if absent, then sort/unique.
jq -n --slurpfile existing /tmp/mtls-hostname-assoc-before.json \
  --arg new "mtls-canary.utility.siteborne.net" \
  '($existing[0] + [$new]) | unique | sort' > /tmp/mtls-hostname-assoc-merged.json

# 3. Display and require your own visual confirmation before the PUT — do not
#    pipe steps 2 and 4 together unattended.
cat /tmp/mtls-hostname-assoc-merged.json
echo "Confirm the above is exactly [existing hostnames] + mtls-canary.utility.siteborne.net, nothing removed, before continuing."

# 4. PUT the complete merged array (consumed from the saved file, never retyped).
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/certificate_authorities/hostname_associations" \
  -H "Authorization: Bearer $CF_API_TOKEN" -X PUT \
  --data-binary @<(jq -n --arg ca "$CA_ID" --slurpfile hosts /tmp/mtls-hostname-assoc-merged.json \
    '{mtls_certificate_id: $ca, hostnames: $hosts[0]}')

# 5. Readback — must equal step 2's merged file exactly.
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/certificate_authorities/hostname_associations?mtls_certificate_id=$CA_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result.hostnames' > /tmp/mtls-hostname-assoc-after.json
diff /tmp/mtls-hostname-assoc-merged.json /tmp/mtls-hostname-assoc-after.json && echo "MATCH"
```

**Rollback:** `PUT` the exact contents of `/tmp/mtls-hostname-assoc-before.json`
(step 1's saved snapshot) back, unmodified — never a hand-reconstructed list.

---

## §9. Create the WAF custom rule that actually enforces mTLS on the canary

```
WAF_RULE_REQUIRED=YES
```

This is **not** removable in favor of §8's hostname association alone. Cloudflare's
own mTLS setup docs, fetched live this session, are explicit that the hostname
association step only makes Cloudflare *request/accept* a client cert on that
host — the actual **rejection** of a request with no (or an invalid) cert is
performed by a separate WAF custom rule the docs walk through building by hand
("Create an mTLS rule" → path/hostname match + `not cf.tls_client_auth.cert_verified`
→ action **Block**). Skipping this step would leave `mtls-canary.utility.siteborne.net`
*accepting* client certs but never *requiring* one — i.e. still fully public,
which would silently fail §11 test #2 (no-cert protected must reject) and make the
whole qualification meaningless. Treat §8 and §9 as one inseparable pair.

Dashboard → **Security → WAF → Custom rules → Create rule**, or via the ruleset
API against the entrypoint captured in §3:

- Name: `SUN-1222C mTLS canary enforcement`
- Expression:
  ```txt
  (http.host eq "mtls-canary.utility.siteborne.net" and not cf.tls_client_auth.cert_verified)
  ```
- Action: **Block**
- Deploy.

This is the literal Cloudflare-documented template
(`not cf.tls_client_auth.cert_verified` + a scoping match, `Hostname` field in the
dashboard builder or `http.host eq` inline) — scoped to the canary hostname only,
so nothing else on the zone is affected. There is no path-scoped alternative here:
§6 already fixed the architecture to dedicated-hostname only, so this rule matches
by `http.host`, never by `http.request.uri.path`.

---

## §10. Revocation check rule (optional but recommended before calling this "qualified")

```txt
((not cf.tls_client_auth.cert_verified or cf.tls_client_auth.cert_revoked) and http.host eq "mtls-canary.utility.siteborne.net")
```

Add as a second rule (or fold into §9's expression) so a revoked-but-otherwise-valid
cert is rejected, not just a missing one — this is what
`deriveMtlsCallerContext`'s `revoked` state (checked independently of and prior to
chain verification, per the commit message) is designed to be tested against.

---

## §11. The three required canary tests (SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION correction)

```
CANARY_NO_CERT_EXPECTATION=REJECTED
CANONICAL_NO_CERT_EXPECTATION=PASS
```

**Correction:** §9's WAF rule is `http.host eq "mtls-canary.utility.siteborne.net"
and not cf.tls_client_auth.cert_verified` → **Block** — a whole-hostname rule with
no path condition. There is therefore no path on the dedicated canary hostname
that passes without a cert; the earlier version of this runbook's test #1 (expecting
a no-cert GET on the canary to succeed) directly contradicted §9's own rule and has
been removed. "The public host still works without a cert" is proven separately, on
`utility.siteborne.net` — never on the canary/dedicated host — by §13-15 below.

```bash
# 1. Dedicated canary host, no cert, ANY path — must be REJECTED (403, Cloudflare
#    block page). This is the primary proof the WAF rule is actually enforcing,
#    not just the hostname association from §8 alone (which only makes Cloudflare
#    willing to accept a cert, not require one).
curl -sS -o /dev/null -w "canary no-cert -> %{http_code}\n" \
  https://mtls-canary.utility.siteborne.net/health

# 2. Dedicated canary host, valid qualification cert — must PASS
curl -sS -o /dev/null -w "canary valid-cert -> %{http_code}\n" \
  --cert ~/.siteborne-mtls-qualification/siteborne-qualification-client.crt \
  --key  ~/.siteborne-mtls-qualification/siteborne-qualification-client.key \
  https://mtls-canary.utility.siteborne.net/health

# 3. Dedicated canary host, spoofed client-cert HTTP headers, no real cert — must
#    be REJECTED. This specifically proves mtls-caller-context.ts's own design
#    goal: a client-supplied header alone (e.g. an old-style X-Client-Cert-style
#    forgery attempt) has no code path to a trusted state, because both the WAF
#    rule and the Worker only ever consult Cloudflare's own edge-verified TLS
#    handshake state (`cf.tls_client_auth.*` / `request.cf.tlsClientAuth`), never
#    a client-suppliable header.
curl -sS -o /dev/null -w "canary spoofed-header -> %{http_code}\n" \
  -H "X-Client-Cert-Verify: SUCCESS" -H "X-Client-Cert-Fingerprint: fake" \
  https://mtls-canary.utility.siteborne.net/health
```

Record all three raw outputs (status code + response body snippet, not just
pass/fail) for the evidence report — that's what makes §35's `MTLS_CANARY_*` fields
defensible rather than asserted. Test 1 failing (returns 200 instead of a block)
means §9's rule did not actually deploy or does not match this hostname — stop and
re-check §9 before proceeding; do not treat a passing test 2 alone as sufficient
(a hostname that accepts-but-doesn't-require a cert would also pass test 2).

---

## §12. Optional — only if you separately request and ship a Worker diagnostic route

Not part of §0's Model A baseline. Only applicable once such a route exists and is
deployed to the canary as its own reviewed source change:

```bash
curl -sS --cert .../siteborne-qualification-client.crt --key .../siteborne-qualification-client.key \
  https://mtls-canary.utility.siteborne.net/authenticated/whoami | jq
# Expect: {"state":"valid","fingerprintSha256":"<matches §5's recorded fingerprint>","issuerDn":"..."}
```

Under §0's Model A baseline, skip this — §11's four tests are your complete evidence.

---

## §13-15. Regression checks on existing public surfaces (must all still pass, unauthenticated)

```bash
for path in /health /ready /.well-known/agent-card.json /.well-known/jwks.json /catalog /schemas /benchmarks; do
  curl -sS -o /dev/null -w "$path -> %{http_code}\n" "https://utility.siteborne.net$path"
done

# A2A JSON-RPC probe, anonymous, no cert — must still succeed exactly as today
curl -sS https://utility.siteborne.net/a2a -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"agent/getAuthenticatedExtendedCard","params":{}}' | jq '.error // .result.name'
```

Run this **before** §9's rule exists and again **after**, on `utility.siteborne.net`
itself (not the canary) — the rule is scoped to the canary hostname only, so these
should be byte-identical before/after. If anything here changes, the WAF rule's
scope leaked and you should revert (§18) before going further.

---

## §16. Architecture decision: promote canary learnings to production

Per §6, only one architecture is in scope — **DEDICATED_HOSTNAME**. If §11's four
tests all passed on the canary, promote to the permanent name
`mtls.utility.siteborne.net` (§18) using the identical §7-§9 pattern, then confirm
§11 again on the permanent name before tearing the canary down. If any of §11's
tests failed or was ambiguous, stop here — do not promote, and do not fall back to
a path-scoped design on `utility.siteborne.net` (§6's `CANONICAL_PUBLIC_HOST_MTLS_MUTATION=PROHIBITED`
rules that out regardless of canary outcome).

```
AGENT_CARD_MTLS_MULTI_INTERFACE_SEMANTICS=AMBIGUOUS
```

**Do not add a second `supportedInterfaces` entry as part of this checkpoint.**
Traced against the exact pinned `@a2a-js/sdk@1.0.1` types (`AgentInterface` in
`a2a-4AAMnZHp.d.ts`): each `supportedInterfaces` entry is
`{ url, protocolBinding, tenant, protocolVersion }` — **no `security` /
`securityRequirements` field exists on `AgentInterface` at all**. Security
requirements bind only at two levels the spec actually defines:
`AgentCard.securityRequirements` (whole-agent, currently `[]`) and
`AgentSkill.securityRequirements` (per-skill) — never per-interface, and there is
no interface-level `description` field to attach explanatory prose either. This
matches `card.ts`'s own existing comment
([card.ts:146-153](packages/protocol-a2a/src/card.ts:146)), which already names the
per-*skill* route as the intended future binding mechanism, not per-interface. So:
if you published `mtls.utility.siteborne.net/a2a` as a second `supportedInterfaces`
entry today, a spec-compliant client parsing the card has **no formal, declared way**
to learn that the second URL requires a client certificate while the first doesn't
— it would only discover this empirically, via a failed TLS handshake. Per your own
§4 instruction, this is a STOP for governance, not something to fold silently into
this Cloudflare-provisioning checkpoint:

```
SUPPORTED_INTERFACES_SOURCE_CHANGE_REQUIRED=YES
```

...but it is now its own, separately-authorized repository checkpoint
(`SUN-1222C-SUPPORTED-INTERFACES-IMPLEMENTATION` or similar), owned by you deciding
*how* to communicate the asymmetry (documentationUrl prose, a per-skill
`securityRequirements` binding instead of a second top-level interface,
`AgentExtension.params` as a deliberate non-standard escape hatch, or simply not
publishing the mTLS URL in the Agent Card at all and treating it as
out-of-band/operator-known) — not something this runbook decides for you. This
runbook's scope ends at a working, tested, Cloudflare-side `mtls.utility.siteborne.net`
with `utility.siteborne.net` and its existing single-entry Agent Card completely
unchanged.

---

## §17. Deploy the public API — only for what §16 actually left in scope

**PCC (`ac642cb`) deployment is no longer part of this file.** It has its own
manual two-Worker deployment runbook — predeploy gates, paid-runtime deploy,
intermediate qualification, public-API deploy, and rollback matrix — in
`docs/reports/SUN-1222C-deployment-dependency-and-mtls-truthfulness-remediation.md`
§24-29. Run that runbook (in either order relative to this file; they touch
different concerns — PCC changes result *construction*, this file changes
Cloudflare edge config plus, optionally, one static metadata flag) before or after
this one, but do not interleave a partial deploy of one with a partial deploy of
the other without re-reading both rollback matrices first.

Given §16, the *only* possible repo-side reason to deploy `siteborne-utility-edge`
for *this* checkpoint is the `MTLS_PRODUCTION_ACTIVE` truthfulness flag
(`SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION` — gates
`securitySchemes.mtls`, default `false`/absent) — flip it to `'true'` here **only
after** §11's three canary tests (or their permanent-hostname re-run in §18) have
all genuinely passed. Confirm current live state first, don't assume either way:

```bash
curl -sS https://utility.siteborne.net/.well-known/agent-card.json | jq '.securitySchemes.mtls // "ABSENT"'
```

```
PUBLIC_API_DEPLOY_REQUIRED=<YES only if you are about to flip MTLS_PRODUCTION_ACTIVE to 'true' and the above is still "ABSENT">
PAID_RUNTIME_DEPLOY_REQUIRED=NO   # this file never deploys the paid runtime — see the PCC runbook referenced above
ALERT_WORKER_DEPLOY_REQUIRED=NO   # settlement-alert-worker-entrypoint.ts has zero DurableCachedResult/.body references — confirmed by grep this session
```

**Setting the flag:** add `MTLS_PRODUCTION_ACTIVE = "true"` to `wrangler.toml`'s
`[vars]` block, in its own small, reviewed commit — never bundled silently into an
unrelated deploy, and never set anywhere except this one `[vars]` entry (it is a
non-secret literal, exactly like `PAID_ROUTES_ENABLED`, not credential material).
Until that commit lands, the flag is absent and defaults to `false` — the
production-compatible state this entire runbook runs under.

```bash
pnpm typecheck && pnpm build && pnpm lint && pnpm test
pnpm x402:check && pnpm mcp:check && pnpm a2a:check
pnpm production:preflight
pnpm secrets:scan

wrangler deploy --config wrangler.toml --dry-run
wrangler deploy --config wrangler.toml   # only if §17's own check above said PUBLIC_API_DEPLOY_REQUIRED=YES
```

If the flag is not being flipped in this pass, **you may not need to deploy
anything at all** for this checkpoint — the whole thing can be Cloudflare config
only (CA, cert, DNS/Custom Domain, WAF rule), with the Worker's code completely
untouched. Don't deploy if nothing needs it.

---

## §18. Promote the canary to the permanent hostname

Only reachable if §11 passed cleanly on the canary. Rename is not an API operation
Cloudflare exposes for Custom Domains — instead, stand up the permanent name
following §7-§9 again verbatim, substituting `mtls.utility.siteborne.net` for
`mtls-canary.utility.siteborne.net` throughout (new Custom Domain, same
certificate re-associated per §8's algorithm — do not reissue a second
certificate, §5's "exactly one qualification certificate" constraint stays true
across both hostnames — new WAF rule scoped to the permanent name), confirm §11
passes again on the permanent name, *then* tear down the temporary canary:

```bash
# Remove the canary Custom Domain (Dashboard → Domains & Routes → remove)
# Remove the canary's WAF rule (§9)
# Remove the canary hostname from the certificate's host association (§8's
# algorithm again: GET, remove mtls-canary.* from the merged list, PUT, readback)
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=mtls-canary.utility.siteborne.net" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[].id'
# then DELETE that record id once the Custom Domain UI removal is confirmed done
```

Never leave both `mtls-canary.*` and `mtls.*` live simultaneously past this step —
that's needless permanent surface area for one qualification.

---

## §19. Live external validation, whichever architecture was chosen

```
CANONICAL_A2A_LIVENESS_METHOD=SendMessage
```

**Correction (SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION):**
the earlier version of this runbook used the JSON-RPC method name
`agent/getAuthenticatedExtendedCard`, never verified against this repo's own
server. Traced directly against
[transport.ts:75-78](packages/protocol-a2a/src/transport.ts:75): the real accepted
method is the literal string `"SendMessage"` (this pinned A2A v1.0/gRPC-transcoded
server explicitly REJECTS the old v0.3 names `message/send` and `tasks/send` with
`'legacy A2A v0.3 methods are not supported'` — using either of those, or the
unrelated `agent/getAuthenticatedExtendedCard`, would always fail regardless of
mTLS state, a false-negative trap). This is the exact same anonymous heartbeat
probe `apps/edge-api/tests/a2a-route.test.ts`'s own passing round-trip test
exercises via the official SDK client — reuse that pattern rather than
hand-constructing the raw wire JSON, since the message envelope has several
required fields (`messageId`, `contextId`, `taskId`, `role`, `parts[]` with exactly
one content member) that are easy to get subtly wrong by hand:

```bash
curl -sS https://utility.siteborne.net/.well-known/agent-card.json | jq '.securitySchemes.mtls, .supportedInterfaces'
curl -sS https://utility.siteborne.net/.well-known/jwks.json | jq '.keys | length'

# Anonymous SendMessage heartbeat probe, via the pinned official SDK client —
# the same call apps/edge-api/tests/a2a-route.test.ts's own passing test makes.
# Requires the workspace built once (pnpm build, already a §17/§23 predeploy step).
pnpm exec tsx -e "
import { ClientFactory, DefaultAgentCardResolver, JsonRpcTransportFactory } from '@a2a-js/sdk/client';
import { Role } from '@a2a-js/sdk';

const factory = new ClientFactory({
  transports: [new JsonRpcTransportFactory({})],
  cardResolver: new DefaultAgentCardResolver({}),
});
const client = await factory.createFromUrl('https://utility.siteborne.net');
const result = await client.sendMessage({
  tenant: '',
  message: {
    messageId: 'mtls-runbook-liveness-probe-1',
    contextId: '',
    taskId: '',
    role: Role.ROLE_USER,
    parts: [{ content: { \$case: 'text', value: 'ping' }, metadata: undefined, filename: '', mediaType: 'text/plain' }],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  },
  configuration: { acceptedOutputModes: ['application/json'], taskPushNotificationConfig: undefined, returnImmediately: false },
  metadata: undefined,
});
console.log(JSON.stringify(result, null, 2));
"
```

Confirm `securitySchemes.mtls` is present, root `securityRequirements` is still
`[]` and so is every skill's (grep `card.ts`/the live JSON — anonymous access must
still work), the SendMessage probe above returns a normal Task response (not a
transport/method error — an `input_required`/`payment_required` outcome is
expected and correct, since this probe carries no real skill invocation or
payment), and `supportedInterfaces` still has **exactly the one existing public
entry** — §16 deferred the second entry to its own checkpoint, so seeing it appear
here would mean that governance-gated change shipped without the separate
authorization it needs.

---

## §20. x402 / mTLS orthogonality and settlement preservation check

```
MTLS_X402_TEST_TARGET=DEDICATED_MTLS_HOST
```

**Correction (SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION):**
the earlier version of this runbook targeted `utility.siteborne.net` for the
cert-bearing request. That proves nothing about mTLS+x402 orthogonality —
`utility.siteborne.net` never gets a client-certificate hostname association at
all (§6's `CANONICAL_PUBLIC_HOST_MTLS_MUTATION=PROHIBITED`), so a cert-bearing
request against it is indistinguishable from a request with an unused, ignored
`--cert` flag. Corrected to target the dedicated mTLS hostname
(`mtls.utility.siteborne.net`, or the active canary during qualification), the
only place a real trust-plane exists to test orthogonality against:

```bash
export MTLS_HOST="mtls-canary.utility.siteborne.net"   # or mtls.utility.siteborne.net post-promotion (§18)

# Generate the smallest schema-valid synthetic input for a real paid service, so
# the request reaches the payment gate rather than 400ing earlier on shape —
# straight from this repo's own frozen-fixture source, never hand-typed.
pnpm exec tsx -e "
import { frozenInputExample } from './packages/protocol-x402/src/index';
console.log(JSON.stringify(frozenInputExample('verify_agent_output.v2')));
" > /tmp/mtls-x402-fixture-body.json
cat /tmp/mtls-x402-fixture-body.json   # sanity-check it's non-empty JSON before using it

# Must still 402, unauthenticated, no client cert, against the DEDICATED mTLS host:
curl -sS -o /dev/null -w "no-cert -> %{http_code}\n" \
  -H 'content-type: application/json' -d @/tmp/mtls-x402-fixture-body.json \
  "https://$MTLS_HOST/v2/verify/agent-output" -X POST

# Must ALSO still 402, WITH a valid qualification client cert (proves mTLS
# verification alone does not bypass the x402 payment gate on the one hostname
# where mTLS verification is actually live — the two must remain orthogonal):
curl -sS -o /dev/null -w "valid-cert -> %{http_code}\n" \
  --cert ~/.siteborne-mtls-qualification/siteborne-qualification-client.crt \
  --key  ~/.siteborne-mtls-qualification/siteborne-qualification-client.key \
  -H 'content-type: application/json' -d @/tmp/mtls-x402-fixture-body.json \
  "https://$MTLS_HOST/v2/verify/agent-output" -X POST

# Settlement topology must be unchanged — run the actual regression test, not a
# raw grep (a raw grep over-counts doc-comments; this is what caught that mistake):
pnpm vitest run apps/edge-api/tests/settle-sole-ownership.test.ts
# Must stay 4/4 green: exactly ONE production evidenceProvider.settle() call site
# (paid-continuation-workflow.ts, the dedicated Workflow), zero in any HTTP route
# file, zero in the public API's request path. This mTLS checkpoint touches no
# file this test scans — it should be, and must remain, unaffected.
```

Both curl calls must return `402` and `MTLS_X402_REQUEST_REACHES_PAYMENT_GATE=YES`
(i.e. not a 400 from malformed input reaching before the payment boundary — confirm
via the response body, not just the status code, that it's a genuine
`PaymentRequired` response) — if the cert-bearing one returns anything else
(especially a 200, or any status implying real provider execution), stop: that's
mTLS accidentally unlocking paid execution, a real regression against your own
constraint. Do not perform a real payment to complete this check.

---

## §21. Agenstry rescan (optional, after §19-20 both pass)

Trigger via whatever "owner/rescan" action Agenstry itself exposes to you (out of
scope for Claude — no Agenstry credential/tool is available in this session).
Record the itemized score exactly as it comes back; do not hand-edit metadata to
influence it.

---

## §22. Evidence report + commit (after everything above is real and passing)

Write `docs/reports/SUN-1222C-mtls-production-provisioning.md` covering: §1-§3
pre-state, §5 cert metadata (no PEM/key), §6-§9 canary config, §11 three raw test
results, §13-15 regression proof, §16 decision + rationale (including the deferred
`supportedInterfaces` governance item, left unshipped), §17 gate results (if the
`MTLS_PRODUCTION_ACTIVE` flag was flipped and `siteborne-utility-edge` deployed),
§18 teardown/promotion evidence, §19-20 live validation output (including the
SendMessage probe result and the x402/mTLS orthogonality status codes), §21
Agenstry score if run. §16 still means `card.ts`'s `supportedInterfaces` array
should NOT change as part of this commit — if you find yourself about to add a
second entry there, stop: that change belongs to its own, separately authorized
checkpoint (the `MTLS_PRODUCTION_ACTIVE` flag flip in §17, if you did it, is a
different, already-authorized change and is fine to include). Never commit keys,
tokens, or the `.csr`/`.crt` files from `~/.siteborne-mtls-qualification/`.

```bash
git add docs/reports/SUN-1222C-mtls-production-provisioning.md
git commit -m "SUN-1222C-MTLS-PRODUCTION-PROVISIONING evidence"
```

Then stop — legal identity binding and cutover are separate, not-yet-authorized
checkpoints.

---

## Rollback, any stage

- WAF rule: disable/delete via dashboard or the ruleset API, immediate effect.
- Client cert / hostname association: remove the host from §8's association list;
  the cert itself can stay issued (harmless while unassociated) or be revoked via
  **Client Certificates → Revoke**.
- Custom Domain / DNS: remove via dashboard; propagates in seconds since it's
  Cloudflare-proxied, not authoritative NS propagation.
- Worker deploy (only if §17 ran): `wrangler rollback --config wrangler.toml` to
  the pre-state deployment id captured in §3's `/tmp/mtls-pre-state-deployments.txt`.

None of these touch payment state, D1, or settlement — confirmed by §20's call-site
baseline staying constant through every step above.
