# METADATA-VCM-03 — Machine-Mediated Discovery, Routing, and Conversion Optimization

Status: design/research checkpoint. Zero runtime, metadata generator, registry, governance, pricing,
contract, CI, or production mutations made. No fields were added to `packages/vcm` (not yet created).

## 0. Scope discipline

This report was commissioned with an explicit constraint: optimize exclusively for **machine-mediated**
outcomes (discovery, routing, selection, invocation, economic conversion, repeat use) — not human
marketing — and never fabricate a field or inflate a claim merely to satisfy a rubric. Every finding
below is tagged with an evidence tier:

- **VERIFIED** — a primary protocol source was read live in this session *and* the corresponding SITEBORNE
  source file was grepped in this session to confirm the current state.
- **SPEC-DOCUMENTED** — a primary protocol source was read live in this session; the SITEBORNE-side gap
  is taken from an earlier discovery agent's report (METADATA-AUTHORITY-01 inputs), not re-grepped here.
- **REASONED-INFERENCE** — established, widely-documented API/tool-design consensus, not tied to one
  fetched primary source in this session. Flagged explicitly so it is never mistaken for spec fact.
- **NOT INDEPENDENTLY VERIFIED** — attempted to reach a primary source and could not (dead link, JS wall,
  404). Named so a future pass knows exactly what's still open, instead of silently guessing.

Sources actually fetched live in this session:
- `modelcontextprotocol.io` — Build an MCP server; Tools (spec `2025-06-18` and `2026-07-28`)
- `raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol` — `schema/2025-06-18/schema.ts` (`ToolAnnotations`, `Tool` interfaces, verbatim)
- `anthropic.com/engineering/writing-tools-for-agents` (Sep 11, 2025)
- `a2a-protocol.org/latest/specification/` — full AgentCard/AgentSkill/AgentProvider/AgentCapabilities field tables, trust/signing sections
- `github.com/coinbase/x402` — README (protocol flow, scheme/network model, `description` field)
- Attempted, not reachable: `docs.cdp.coinbase.com/x402/core-concepts/discovery` (404) — **Bazaar-specific ranking/listing mechanics are NOT INDEPENDENTLY VERIFIED in this report.**

Repo files grepped live in this session for cross-check: `packages/protocol-a2a/src/card.ts`,
`packages/protocol-mcp/src/server.ts`.

---

## 1. MCP — verified findings

### 1.1 Tool annotations are explicitly untrusted hints, not a scoring input
`schema.ts` (verbatim, both spec versions carry the same doctrine):
> "ToolAnnotations are **hints**. They are not guaranteed to provide a faithful description of tool
> behavior... Clients should never make tool use decisions based on ToolAnnotations received from
> untrusted servers."

**Implication:** annotation completeness does not itself buy trust or ranking. The actual trust lever is
*server identity* (a client deciding SITEBORNE is a "trusted server" at all) — which routes back to signed,
verifiable provenance, not metadata richness. This reinforces rather than adds to the Authority Map's
existing emphasis on the A2A signing chain (§ MetadataRelease / provenance in VCM-02) as the real
trust-bearing artifact. **No new field proposed here** — this is a priority confirmation, not a gap.

### 1.2 `openWorldHint` — VERIFIED gap, zero-risk truthful fix
`schema.ts`: `openWorldHint?: boolean` — *"If true, this tool may interact with an 'open world' of
external entities. If false, the tool's domain of interaction is closed... **Default: true**."*

Grep of `packages/protocol-mcp/src/server.ts:551,611,616,638` confirms `annotations` objects set
`readOnlyHint`, `destructiveHint`, `idempotentHint` but never `openWorldHint`. **By spec default, every
SITEBORNE MCP tool currently self-declares as open-world** (unpredictable domain of interaction) —
that is honest for `web_context_verified` (which fetches arbitrary web content) but **false** for
`company_evidence_graph`, `document_evidence_json`, and `verify_agent_output`, which query closed,
bounded internal sources. This is not an enhancement — it is a present *misstatement by omission*
relative to spec default, and correcting it is a pure truth fix with plausible routing-accuracy upside:
clients choosing between a closed, deterministic tool and an open-world one for a precision task can
only make that distinction if the flag is set correctly.

- **Proposed field:** `CanonicalInteraction.openWorldHint: boolean` (VCM-02 §CanonicalInteraction), value
  set per-service from actual data-source boundedness, not defaulted blindly to `false`.
- **Classification:** REQUIRED_NOW.

### 1.3 Token-efficiency levers (Anthropic engineering post, Sep 2025) — SPEC-DOCUMENTED
Directly measured by Anthropic on their own tool suites:
- A `response_format` enum (`concise` / `detailed`) cut token cost to ~⅓ in their Slack-tool example,
  with no loss of capability — the concise path omits low-signal technical identifiers (UUIDs,
  `mime_type`) an agent doesn't need for the immediate step.
- Natural-language/semantic identifiers outperform opaque UUIDs for retrieval precision; a UUID should
  only appear in a response when it's needed to chain into a later tool call.
- Helpful, actionable error bodies (not opaque codes/tracebacks) measurably improved agent task
  completion in their evaluations.

None of these were re-verified against SITEBORNE's actual tool-response bodies or error payloads in this
session (would require reading `apps/edge-api` route handlers, out of this report's grep pass) — flagged
**REQUIRES_VERIFICATION**, not asserted as a gap. If SITEBORNE's evidence-graph/document tools return raw
UUIDs or opaque error codes today, that is the single highest-leverage, purely mechanical improvement
available, because it lowers real per-call token cost — which directly raises "invocation conversion"
and "repeat invocation rate" for any cost-aware routing agent, with no metadata claim involved at all
(it's an implementation change, not a VCM field).

- **Proposed field (only once implemented):** `CanonicalInteraction.supportedResponseVerbosity:
  ('concise'|'detailed')[]` — REQUIRED_FOR_KNOWN_PROJECTION, but the metadata must not be added ahead of
  the implementation; doing so would itself be exactly the kind of premature claim this report is
  constrained against.

### 1.4 Contrastive Use-when/Do-not-use-when descriptions — already correct, do not dilute
Anthropic's own research names prompt-engineered tool descriptions as one of the highest-leverage,
directly-measured levers for tool-selection accuracy (cites a Claude 3.5 SWE-bench-Verified jump from
description refinement alone). SITEBORNE's MCP tools already carry this pattern
(`SERVICE_INPUT_DESCRIPTION_OVERRIDES`, confirmed in the original MCP discovery pass and reaffirmed in
Authority Map §10 as a "bounded, governed transform"). **No change proposed.** Flagging explicitly so a
future optimization pass doesn't accidentally regress this by over-templating it into something generic.

### 1.5 `title`, `outputSchema` — already correct
`title` is populated per-tool (`server.ts:551,611,633`); `outputSchema` is sourced from
`packages/contracts` (per original MCP discovery). Both match documented MCP best practice. No action.

---

## 2. A2A — verified findings

### 2.1 There is no rating/score/trust field in the AgentCard schema — a negative finding worth stating plainly
The full field table for `AgentCard` (§4.4.1) and `AgentSkill` (§4.4.5) in the live 1.0.0 specification
contains: `name`, `description`, `supportedInterfaces`, `provider`, `version`, `documentationUrl`,
`capabilities`, `securitySchemes`, `securityRequirements`, `defaultInputModes`, `defaultOutputModes`,
`skills`, `signatures`, `iconUrl` (card level); `id`, `name`, `description`, `tags`, `examples`,
`inputModes`, `outputModes`, `securityRequirements` (skill level). **None of these is a reputation, star,
usage-count, or trust-score field.** Trust in A2A is structurally binary and out-of-band:
> "Clients verify at least one signature before trusting an Agent Card." / "Clients maintain a trusted
> key store for known agent providers."

There is no lever inside the AgentCard itself to raise a "score" — only (a) whether the card is validly
signed at all, and (b) whether the *client* already trusts that signing key, which is a relationship
SITEBORNE cannot self-declare into existence. This directly rules out a class of optimization the
original request implied might exist for A2A. The only thing worth doing here is making sure the signing
chain already designed in Authority Map / VCM-02 (`MetadataRelease.provenance`, A2A signing identity) is
real and verifiable — which is an existing tracked item, not a new one.

### 2.2 `AgentSkill.examples` — VERIFIED gap
Spec: `examples` — *"Example prompts or scenarios that this skill can handle"* (optional, array of
string). Grep of `packages/protocol-a2a/src/card.ts:53` shows `examples: []` — present as a field,
populated empty for every skill. This is the single most concrete, zero-ambiguity, zero-fabrication-risk
addition in this whole report: real example prompts already exist as fixtures in the repo's own eval/test
suites (per the METADATA-VCM-02 discussion of eval/verification evidence) and can be surfaced verbatim —
not invented copy, actual prior successful invocations.

- **Proposed field:** `CanonicalInteraction.examplePrompts: string[]`, sourced only from real fixtures/eval
  transcripts, never authored fresh for the purpose of filling the field. Classification: REQUIRED_NOW.

### 2.3 `AgentCard.iconUrl` — SPEC-DOCUMENTED gap, cosmetic only
Optional field, not found via grep in `card.ts`. Low priority — affects human-facing directory listings
more than machine routing. Classification: FUTURE_EXTENSION. Not worth VCM-02 schema churn on its own;
bundle with any future A2A projection-adapter pass.

### 2.4 `AgentSkill.tags` — already correct, and is the one true "search index" lever A2A offers
Confirmed populated (earlier A2A/registry discovery: tags derived from `service.capabilities` +
`service.service_version`). Tags are the only field in the entire A2A schema with keyword-matching/index
semantics. The only real optimization available is **accuracy**, not volume — padding tags with
adjacent-but-untrue capability words would increase discovery hits at the cost of routing precision
(an agent matched on a tag it doesn't actually satisfy fails the task, which is worse for "repeat
invocation rate" than not being discovered at all). No change proposed; flagged as an explicit
anti-pattern in §5.

---

## 3. x402 / Bazaar — partial findings

### 3.1 `description` and scheme/network breadth — SPEC-DOCUMENTED, already correctly modeled
The x402 README frames the resource-level `description` field exactly like an MCP tool description
("what your endpoint does") and frames scheme/network breadth (`accepts: [...]`) as a pure
client-compatibility lever — more supported (scheme, network) pairs means more clients can transact
without a client-side adapter. SITEBORNE's actual support (`exact` on `eip155`+`solana`, `upto` on
`eip155` only, per the original OpenAPI/x402/pricing discovery) is already faithfully modeled in
VCM-02's `SchemeNetworkSupport`. **No schema change** — but an explicit warning belongs in §5: do not
advertise a (scheme, network) pair SITEBORNE cannot actually settle merely to widen a Bazaar listing's
apparent compatibility. A `PaymentRequirements` offer that fails at `/settle` is worse for
quote-to-payment conversion than never having offered it, and actively damages the facilitator-level
trust signal referenced in §1.1's logic (untrustworthy servers get deprioritized by rational clients).

### 3.2 Bazaar-specific ranking/listing mechanics — NOT INDEPENDENTLY VERIFIED
`docs.cdp.coinbase.com/x402/core-concepts/discovery` returned 404 in this session; no other primary
source for Bazaar's actual listing/ranking algorithm was reached. **I am not going to assert what drives
Bazaar ranking** — doing so without a source would be exactly the fabrication this report is constrained
against. Recommend a dedicated follow-up pass against Bazaar's current discovery/listing API
documentation (or its OpenAPI spec, if published) before adding any Bazaar-specific VCM field.

---

## 4. OpenAPI / LLM tool routers / search-indexing / autonomous purchasing agents — reasoned inference only

No primary source for a generalized, vendor-neutral "LLM tool router ranking algorithm" exists to fetch —
these are product-internal (LangChain, OpenAI function-calling, various agent frameworks) and not
publicly specified the way MCP/A2A/x402 are. What's stated here is REASONED-INFERENCE from established
OpenAPI/API-design consensus, not a verified spec passage:

- Stable, unique `operationId`s; a `summary`/`description` split (short label vs. full explanation);
  explicit 4xx/5xx response schemas; example values in schema — these are the standard inputs
  function-calling frameworks use to build their internal tool catalogs from an OpenAPI document.
  SITEBORNE's generator already produces hardcoded `operationId`s and reverse-engineered 400/402 shapes
  (per the original OpenAPI/x402/pricing discovery), so the mechanics are present.
- The one concrete, already-known item here: `/quotes/{service_id}` is marked
  `x-implementation-status: 'not_implemented'` in the generated OpenAPI. That is the *correct* honest
  choice over silently advertising a dead endpoint as live — a router scoring "completeness" will fairly
  score it down, and **the fix is to finish the implementation, not to touch the metadata.** This is
  already implicitly on the roadmap (MCP's `siteborne_get_quote` is live; the REST path lags it) — noted
  here as a genuine machine-conversion gap (a REST-only or OpenAPI-only consuming agent cannot get a
  quote today even though the capability exists), not as something to paper over.

No claims are made here about "search/indexing agents" or "autonomous purchasing agents" specifically —
no authoritative public spec for either was located in this session, and inventing plausible-sounding
criteria for them would violate the no-fabrication constraint. §6 proposes measuring real outcomes
against these instead of guessing at their internals.

---

## 5. Explicit anti-patterns — kept out on purpose

These would plausibly raise a naive score and were deliberately excluded, consistent with the Authority
Map's existing truth invariants:

1. **No padded/adjacent A2A tags or MCP capability keywords.** Anthropic's own research shows ambiguous
   or overlapping tool descriptions *degrade* selection accuracy — the mechanism that would make padding
   "work" for discovery is the same mechanism that makes it fail at routing and execution.
2. **No `SecurityTruthLevel` set to `ACTIVE`/`VERIFIED` without fresh measured evidence.** Already
   structurally prevented by VCM-02's type split (static model literally cannot construct those values) —
   restated here because it is the single most tempting "score-raising" move a naive optimization pass
   could make, and MCP's own doctrine (§1.1) confirms untrusted self-declared claims don't even work as
   intended on sophisticated clients.
3. **No advertised x402/Bazaar scheme-network pair SITEBORNE cannot settle** (§3.1).
4. **No third-party review/star/usage aggregation inside canonical VCM** — already decided in Authority
   Map §(external evidence is independent evidence about SITEBORNE, not a canonical VCM fact); reaffirmed
   here because "market data" research is exactly the kind of input that tempts conflating the two.
5. **No fabricated `examples`/`examplePrompts` content.** §2.2's fix only works if the prompts are drawn
   from real fixtures — invented "realistic-sounding" examples would be a claim about capability the
   service hasn't actually demonstrated, and AgentSkill.examples exists specifically to inform a client's
   routing decision; a misleading example there produces exactly the failure-to-execute outcome the whole
   framework exists to prevent.

---

## 6. Measuring machine outcomes — proposed EVIDENCE-class overlay, not new claims

The request asks for success to be evaluated primarily as machine outcomes: discovery probability,
correct-routing probability, tool-selection accuracy, invocation conversion, quote-to-payment conversion,
execution success rate, repeat-invocation rate, trust/ranking score, latency-adjusted utility,
price-adjusted utility, expected revenue per discovery. None of these can be *declared* — they can only be
*measured*. Per VCM-02's existing sentinel pattern (`MeasuredOrUnmeasured<T>`), the correct home for this
is a new **operational, EVIDENCE-class** telemetry block attached to `RuntimeStateOverlay` — never the
static model, since these are facts *about* usage, not facts *about* capability:

```ts
interface MachineOutcomeTelemetry {
  windowStart: IsoTimestamp;
  windowEnd: IsoTimestamp;
  serviceId: CanonicalServiceIdValue;
  surface: ProtocolSurface;
  discoveryEvents: MeasuredOrUnmeasured<number>;        // card/tool-list fetched
  selectionEvents: MeasuredOrUnmeasured<number>;        // tool actually chosen among alternatives offered
  invocationEvents: MeasuredOrUnmeasured<number>;       // tool actually called
  quoteRequestEvents: MeasuredOrUnmeasured<number>;
  paymentSettledEvents: MeasuredOrUnmeasured<number>;
  executionSuccessEvents: MeasuredOrUnmeasured<number>;
  distinctRepeatCallers: MeasuredOrUnmeasured<number>;
  measurementSource: EvidenceRef;                       // where the counter actually comes from
}
```

Every field defaults to `UNMEASURED` until real instrumentation (edge-api access logs, x402 settlement
logs, MCP `tools/call` audit logging already required by spec §"Log tool usage for audit purposes")
produces a number. This satisfies the request's own framing — machine outcomes as the success
measure — without adding a single self-declared claim to the canonical, capability-bearing part of VCM.
Classification: REQUIRED_FOR_RUNTIME_TRUTH, scoped to the overlay only.

---

## 7. Prioritized, truthful action list

| # | Action | Tier | Effort | VCM field | Risk |
|---|---|---|---|---|---|
| 1 | Set `openWorldHint` correctly per MCP tool (§1.2) | VERIFIED | trivial | `CanonicalInteraction.openWorldHint` | none — pure correction |
| 2 | Populate `AgentSkill.examples` from real fixtures (§2.2) | VERIFIED | small | `CanonicalInteraction.examplePrompts` | none if sourced from real usage |
| 3 | Verify tool responses use natural-language identifiers, not raw UUIDs, where not needed for chaining (§1.3) | REQUIRES_VERIFICATION | unknown until checked | none (implementation only) | none |
| 4 | Verify tool-call error bodies are actionable, not opaque codes (§1.3) | REQUIRES_VERIFICATION | unknown until checked | none (implementation only) | none |
| 5 | Add `iconUrl` to AgentCard (§2.3) | SPEC-DOCUMENTED | trivial | `OrganizationIdentity`/card projection | none |
| 6 | Implement `/quotes/{service_id}` REST parity with MCP's live `get_quote` (§4) | SPEC-DOCUMENTED | medium | none — closes an honesty-correct but conversion-costly gap | none |
| 7 | Implement `response_format` (concise/detailed) once justified by evidence of high token cost (§1.3) | SPEC-DOCUMENTED | medium | `CanonicalInteraction.supportedResponseVerbosity` (only after implementation) | none |
| 8 | Stand up `MachineOutcomeTelemetry` overlay instrumentation (§6) | design proposed here | medium | `RuntimeStateOverlay` extension | none — additive, all-UNMEASURED until real |
| 9 | Dedicated follow-up research pass on Bazaar discovery/ranking mechanics (§3.2) | blocked — source unreachable | small (research only) | none yet | none |

Items 1, 2, 5 require no implementation work beyond filling in already-existing, currently-empty or
currently-absent metadata fields with true values — they are the highest ratio of legitimate score
improvement to effort/risk in this entire report, specifically *because* they're corrections of
incomplete self-description, not new claims.

## 8. Return

```
METADATA_VCM_03 = PASS (research/design checkpoint)
PRIMARY_SOURCES_FETCHED = 6 (MCP x3, Anthropic engineering blog, A2A spec, x402 README)
PRIMARY_SOURCES_UNREACHABLE = 1 (Coinbase x402/Bazaar discovery docs — flagged, not guessed)
VERIFIED_GAPS = 2 (openWorldHint omission, AgentSkill.examples empty)
SPEC_DOCUMENTED_ITEMS = 5
REQUIRES_VERIFICATION_ITEMS = 2 (response identifiers, error body shape — not checked this session)
FABRICATED_CLAIMS_INTRODUCED = 0
ANTI_PATTERNS_EXPLICITLY_REJECTED = 5
NEW_VCM_FIELDS_PROPOSED = 4 (openWorldHint, examplePrompts, iconUrl, MachineOutcomeTelemetry overlay)
MUTATIONS_MADE = 0
SAFE_TO_IMPLEMENT = YES, scoped strictly to items 1–2 and 5 immediately; items 3–4 require a verification
  pass before action; item 6 is an implementation task outside VCM; item 8 is additive/measurement-only;
  item 9 requires a follow-up research session.
```
