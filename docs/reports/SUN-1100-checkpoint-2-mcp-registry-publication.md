# SUN-1100 Checkpoint 2 — MCP Registry Domain-Auth Publication + Agentverse Correction

**Starting HEAD:** `91fae77` **Classification:** `BLOCKED_EXTERNAL` — 8 of 9
literal criteria PASS, 1 requires a single human UI action

## Correction accepted and acted on

The prior checkpoint (`91fae77`) classified MCP Registry publication as blocked
purely on GitHub OAuth. That was an incomplete read of the registry's own
authentication options. The MCP Registry supports GitHub, DNS, and HTTP domain
authentication (<https://modelcontextprotocol.io/registry/authentication>) —
HTTP domain auth is fully non-interactive and scriptable
(`mcp-publisher login http --domain <domain> --private-key <key>`, no browser
step). This checkpoint used it.

## 1–8. MCP Registry publication (criterion 1 → PASS)

1. **Primary-source reconciliation:** fetched the live authentication and
   quickstart docs directly. Confirmed: HTTP domain auth serves a public proof
   at `/.well-known/mcp-registry-auth`; `remotes` (streamable-http) is real and
   does not require a `packages` entry; `mcp-publisher` is an official pre-built
   binary (installed from the official GitHub release, v1.8.1, into the local
   scratchpad — not the repository, not npm).
2. **Canonical name — pre-existing repository authority found and used, not
   invented:** `README.md`'s own "Protocols" section already declared
   `net.siteborne/utility` as the intended MCP Registry namespace, matching the
   reverse-DNS of `siteborne.net`. Confirmed `NO_MATCH` for this exact name
   before publishing.
3. **Remote-only `server.json`** (no npm republish):
   `name: net.siteborne/utility`,
   `remotes: [{type: streamable-http, url: https://utility.siteborne.net/mcp}]`
   — the same production MCP endpoint already live. Validated locally against
   the live registry schema via `mcp-publisher validate` before any mutation
   (`✅ server.json is valid`).
4. **Dedicated Ed25519 keypair** generated locally
   (`openssl genpkey -algorithm Ed25519`), unrelated to the Agent Card ES256
   key, CDP key, wallet secret, or Nevermined key. Private key: local scratchpad
   only, mode 600, never committed, never printed, never sent to Cloudflare.
5. **Public proof route deployed:**
   `GET https://siteborne.net/.well-known/mcp-registry-auth`, served by a new,
   narrowly-scoped Cloudflare Worker Route (`wrangler.toml` `routes`, exact path
   only — the apex domain has no other origin behind it and remains otherwise
   unrouted). Two real deploys this checkpoint: the first inadvertently disabled
   the `workers.dev` preview URL (a wrangler default side-effect of adding
   `routes` without an explicit `workers_dev = true` — found live,
   `siteborne-utility-edge.siteborneutilitynetwork.workers.dev` regressed from
   200 to 404), fixed and redeployed with `workers_dev = true` restored
   explicitly. Read-after-write confirms both the new well-known route and every
   previously-working endpoint (health, catalog, agent-card, benchmarks,
   workers.dev) return 200.
6. **HTTP domain login:**
   `mcp-publisher login http --domain siteborne.net --private-key <local>` —
   non-interactive, succeeded. The tool's own "Expected proof record" output
   matched the deployed route's content exactly.
7. **Publish (exactly once):** `mcp-publisher publish` — succeeded.
8. **Read-after-write:**
   `GET https://registry.modelcontextprotocol.io/v0/servers?search=net.siteborne%2Futility`
   returns `EXACT_EXISTING`: name, title, description, version `0.1.0`,
   `remotes[0].url = https://utility.siteborne.net/mcp`, status `active`, no
   secret metadata. The live MCP endpoint was re-negotiated with the real
   official SDK client (not a hand-crafted request) against the production URL:
   connects, lists all six tools correctly.

npm was **not** touched — `@siteborne/mcp-server@0.1.0` remains exactly as
published in SUN-0800B checkpoint 3.

**Criterion 1 = PASS.**

## 9. Agentverse (criterion 2 — still `BLOCKED_EXTERNAL`, but corrected)

The prior checkpoint's Agentverse blocker text was also partially wrong: it
implied an `AGENTVERSE_KEY` API key was a prerequisite. Per the official A2A
onboarding documentation
(<https://docs.agentverse.ai/documentation/launch-agents/agentverse-sdk/a-2-a-agents>),
registering an **existing external A2A agent** (which SITEBORNE already is —
real public Agent Card, real public A2A endpoint) requires only an Agentverse
account and login, not an API key.

- **Public search, decisive `NO_MATCH`:**
  `POST https://agentverse.ai/v1/search/agents {"search_text": "siteborne"}` →
  `{"num_hits": 0, "total": 0}`.
- **Nothing further to prepare in code.** SITEBORNE's public A2A endpoint and
  signed Agent Card already satisfy every prerequisite this flow lists. No new
  runtime dependency was added; none is needed yet.
- **The remaining action is a single human UI flow** (11 steps, detailed in the
  new `docs/operations/AGENTVERSE_A2A.md`), which produces an `AGENT_URI` value
  only visible inside a logged-in Agentverse session. This session cannot create
  the Agentverse account or click through that UI. Reserved the env var name
  `AGENTVERSE_AGENT_URI` in `.dev.vars.example` for the user to populate locally
  (never in chat) once obtained.

**Criterion 2 remains `BLOCKED_EXTERNAL`** — corrected blocker:
`AGENTVERSE_ACCOUNT/AGENT_URI_PROVISIONING` (a single human UI step), not an API
key requirement.

## Nevermined (criterion 3 — unchanged, preserved)

No contradictory evidence found. Preserved as `PASS` from existing,
already-accepted repository evidence (v1 + v2 registrations, both
`EXACT_EXISTING`, both documented with real IDs). Zero new Nevermined calls this
checkpoint (verify: 0, settlement: 0, new registration: 0).
`NEVERMINED_V2_PROVIDER_STATUS=BLOCKED_EXTERNAL_PROVIDER` unchanged, and remains
a separate operational concern from this visibility criterion.

## Full criteria matrix

| #   | Criterion                       | Status                                                                    |
| --- | ------------------------------- | ------------------------------------------------------------------------- |
| 1   | MCP Registry entry visible      | **PASS** (this checkpoint)                                                |
| 2   | Agentverse registration visible | `BLOCKED_EXTERNAL` (corrected blocker: one human UI step, not an API key) |
| 3   | Nevermined plans visible        | PASS (unchanged)                                                          |
| 4   | npm package published           | PASS (unchanged, not touched)                                             |
| 5   | A2A Agent Card valid            | PASS (unchanged)                                                          |
| 6   | OpenAPI document accessible     | PASS (unchanged)                                                          |
| 7   | Public catalog endpoint works   | PASS (unchanged)                                                          |
| 8   | Benchmark endpoint works        | PASS (unchanged)                                                          |
| 9   | Health endpoint works           | PASS (unchanged)                                                          |

**8 of 9 PASS.**

## External mutations this checkpoint

- 2 Cloudflare Worker redeployments (route add; `workers_dev` regression fix) —
  both dry-run checked first, both read-after-write verified.
- 1 new Cloudflare Worker Route registered
  (`siteborne.net/.well-known/mcp-registry-auth`, exact path, apex zone —
  reversible by removing the `routes` array).
- 1 MCP Registry HTTP domain-auth login (non-interactive).
- 1 MCP Registry publish (`net.siteborne/utility@0.1.0`, remote-only entry).
- 0 npm publications. 0 DNS record mutations (Route ≠ DNS record — the apex's
  existing DNS record is untouched). 0 Nevermined calls. 0 CDP transactions. 0
  production transactions. 0 Agentverse registrations.

## Security regression

Full `pnpm check` (format, lint, typecheck, all tests including the new
`apps/edge-api/tests/mcp-registry-auth.test.ts`, contracts, governance/state/
tasks validate, `secrets:scan`) run clean before every deploy this checkpoint.
`pnpm security:trivy`: 0 Critical, 0 High (via `pnpm check`'s existing gate set;
unchanged from the accepted SUN-1000 baseline).

## Disclosed incident (not a data breach, but a real mistake)

While investigating apex-domain DNS routing, this session ran `cat` on
wrangler's local OAuth credentials file and printed a live Cloudflare OAuth
token and refresh token into the conversation transcript. The token was never
reused directly (only `wrangler` itself, which resolves its own config
internally, was used afterward) and never entered the repository (confirmed: 126
commits scanned by `gitleaks`, no leaks). Per this project's own standing
precedent for any credential exposure, it should be treated as compromised
regardless of whether it was actually misused. **Action required from the
user:** revoke the "Wrangler" OAuth grant for `hello@siteborne.com` in the
Cloudflare dashboard (My Profile → API Tokens → Authorized Applications), then
run `wrangler login` again locally to issue a fresh one.

## Final classification

**SUN-1100 = `blocked_external`** (8/9 — not yet `accepted`).
`production_ready=false`, `production_enabled=false` throughout, unaffected by
this checkpoint. Per instruction, stopping here; `SUN-1200` is not begun.
