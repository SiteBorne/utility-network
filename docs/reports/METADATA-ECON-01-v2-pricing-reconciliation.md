# METADATA-ECON-01 — V2 Pricing Authority & Semantic Reconciliation

Status: read-only governed root-cause investigation. No production, registry, governance,
protocol, runtime, or VCM implementation source was mutated by this checkpoint. The only
change made is this report (and, if repository convention requires it, one evidence-only
commit recording it).

`METADATA-VCM-IMPL-01` remains exactly as committed and is **not** re-run or re-graded here:

```
VCM_IMPLEMENTATION_COMMIT=f398e5bd39c68b9dd2458ac2cfb32d5055934585
VCM_EVIDENCE_COMMIT=828de13e42a0bbce90ea15e3b555335885f68949
RESULT=BLOCKED (preserved)
```

---

## I. Proven discrepancy (restated, now with runtime-resolution context)

The raw, on-disk `registry/services/*.v2.json` files disagree with
`governance/RISK_LIMITS.yaml`'s `.v2` ceilings exactly as reported:

```
company_evidence_graph.v2   registry base_price=0.039   governed ceiling=0.0312
document_evidence_json.v2   registry base_price=0.012   governed ceiling=0.0098 (native tier)
verify_agent_output.v2      registry base_price=0.019   governed ceiling=0.017
web_context_verified.v2     registry base_price=0.009   governed ceiling=0.008
```

```
V2_SERVICES_CHECKED=4
V2_SERVICES_BASE_PRICE_ABOVE_GOVERNED_MAX=4
SYSTEMIC_PATTERN=YES
```

What this section could not show — and what the rest of this report proves — is *why*, and
whether the on-disk registry number is actually consulted by anything that charges a real
caller money.

---

## II. Competing hypotheses — verdicts

```
H1_REGISTRY_STALE            = PROVEN (narrow sense — see caveat below)
H2_GOVERNANCE_STALE          = REFUTED
H3_SEMANTIC_MAPPING_WRONG    = PROVEN
H4_MIXED_CAUSE                = PROVEN (H1 + H3 jointly, not independently)
H5_OTHER                      = not needed
```

**Caveat on H1.** "Stale" normally implies an oversight — a value someone forgot to update.
The evidence in §III shows the opposite: the repository *explicitly and intentionally* never
writes the governed `.v2` price into the registry JSON, and says so in code. The on-disk
value is frozen **by design**, not by neglect. H1 is proven only in the literal sense that
the file's bytes predate and no longer match the governed decision — not in the sense that
this was a missed update that "should" have happened to the file itself.

The real, actionable defect is H3: `packages/vcm/src/legacy/import-registry.ts` reads that
deliberately-frozen field and treats it as the caller's live sell price, which the
repository's own code comments say it is not.

---

## III. Pricing history — reconstructed from git

### III.1 — Registry `.v2` files: created once, base_price never touched since

```
commit ea4cbb4  2026-08-17  "feat(contracts): introduce service v2 preproduction contract"
```

This is the **only** commit that has ever touched `base_price`/`maximum_price` in any of the
four `registry/services/*.v2.json` files. It created each `.v2.json` as a copy of the
corresponding `.v1.json`, changing only `service_id`, `service_version`, and the output
schema hash (widened `const` → enum for the new schema-contract shape). Quote from that
commit's message:

> "Extended all 7 hand-maintained service-ID enumeration sites with .v2 members... Wired 4
> new /v2/... CDP routes reusing the identical v1 business logic"

Pricing was not part of this checkpoint's scope at all — it was a schema/contract-release
checkpoint (SUN-1000 Checkpoint 1M), not a pricing checkpoint. `base_price`/`maximum_price`
were carried forward unchanged because there was, at that point in time (Aug 17), no v2
pricing decision yet to apply.

### III.2 — Governed `.v2` prices: introduced separately, three weeks later, as a deliberate experiment

```
commit 36e6cae  2026-09-03 00:19  "SUN-1222B-S3: freeze company_evidence_graph.v2 experiment price at $0.0312"
commit c81b737  2026-09-03 01:11  "SUN-1222C-R3: freeze web_context_verified.v2, document_evidence_json.v2,
                                    and verify_agent_output.v2 experiment prices"
```

`WHICH_CAME_FIRST` = registry `.v2` files (Aug 17) came first; governed `.v2` prices (Sep 3)
came second, as an independent later decision.

`WHETHER_THE_SAME_CHANGESET_TOUCHED_BOTH` = No. Neither pricing commit touches any
`registry/services/*.json` file (confirmed: `git log --follow` on all four `.v2.json` files
shows only the three commits listed in §III.1/III.3, none dated September).

`AUTHOR_STATED_INTENT` — quoted directly from commit 36e6cae:

> "Introduced a distinct `company_evidence_graph_v2` governance/pricing key... isolating the
> v2 experiment price ($0.0312 / 31200 atomic) from the frozen v1 price ($0.039 / 39000
> atomic, unchanged). The first attempt mutated the single shared `company_evidence_graph`
> key and was caught by a genuine RED (v1 price silently changed) before landing."

and, critically, describing the chosen architecture:

> "Bazaar discovery (new `packages/protocol-x402/src/bazaar/registry-pricing.ts` projects the
> governed price onto the frozen registry/services/*.json entry **at runtime rather than
> mutating the frozen contract JSON, which would otherwise trigger a major-version
> contract-compat violation**)"

This is a direct, explicit, contemporaneous statement of intent: the team knew the registry
JSON and the new governed price would diverge, and *chose* runtime projection over in-place
mutation specifically to avoid a contract-compatibility version bump. This is not
circumstantial inference from the numbers — it is the stated reason, in the commit that
introduced the divergence.

Commit c81b737 restates the same architecture for the other three services and adds one more
important, explicit distinction:

> "`document_evidence_json_max_job` (0.19 / 190000, the `upto` authorization ceiling) is
> deliberately unchanged — it is a safety cap, not a competitive list price."

This confirms `document_evidence_json` carries two governance concepts under the same
`max_price_usd_per_service` map: three exact-scheme tier prices (`native`/`ocr`/`table`, each
with a `_v2` variant) and one separate `upto`-scheme safety ceiling (`max_job`, shared and
unversioned by design). More on this in §VI.

### III.3 — `COMMIT_BASE_PRICE_INTRODUCED` / `COMMIT_V2_CEILING_INTRODUCED`

```
COMMIT_BASE_PRICE_INTRODUCED (v1, all four families) = 94ad83c (2026-08-05)
COMMIT_V2_REGISTRY_FILE_CREATED (base_price carried forward unchanged) = ea4cbb4 (2026-08-17)
COMMIT_V2_CEILING_INTRODUCED (company_evidence_graph)                  = 36e6cae (2026-09-03 00:19)
COMMIT_V2_CEILING_INTRODUCED (other three families)                    = c81b737 (2026-09-03 01:11)
```

---

## IV. Runtime price path — source-code trace only, no paid call performed

Traced `route → pricing resolver → pricing key → governed/mirrored price → buildQuote() →
x402 payment requirement → settlement amount` for each `.v2` service via static analysis of:
`packages/pricing/src/service-prices.ts`, `packages/protocol-mcp/src/server.ts`,
`apps/edge-api/src/control-plane/routes/{x402-service,paid-services}.ts`, and the four
`apps/edge-api/src/control-plane/production/*-v2-cdp-composition.ts` files.

Every live pricing consumer resolves through exactly one function:
`resolveServiceMaxPriceUsd(pricingKey)` in `packages/pricing/src/service-prices.ts`, which
reads `governance/RISK_LIMITS.yaml`'s `max_price_usd_per_service` map (or its mechanically
validated `EMBEDDED_PRICING` mirror in Worker environments with no filesystem). **None** of
the traced call sites read `registry/services/*.json`'s `base_price` or `maximum_price`
fields to determine what to actually charge.

```
COMPANY_EVIDENCE_GRAPH_V2
  REGISTRY_BASE_PRICE=0.039
  GOVERNED_MAX=0.0312
  RUNTIME_RESOLVED_PRICE=0.0312
  QUOTE_AMOUNT_SOURCE=resolveServiceMaxPriceUsd('company_evidence_graph_v2')
                       — packages/protocol-mcp/src/server.ts:477 (EXACT_PRICING_KEYS),
                         apps/edge-api/.../routes/x402-service.ts:513
  SETTLEMENT_AMOUNT_SOURCE=apps/edge-api/.../production/company-evidence-graph-v2-cdp-composition.ts:187
                            pricingKey: 'company_evidence_graph_v2'

DOCUMENT_EVIDENCE_JSON_V2
  REGISTRY_BASE_PRICE=0.012 (native tier, unchanged since v1)
  REGISTRY_MAXIMUM_PRICE=0.19 (== max_job, unchanged since v1, BY DESIGN — see §III.2)
  GOVERNED_MAX (native tier)=0.0098
  RUNTIME_RESOLVED_PRICE (Bazaar/discovery display)=0.0098
     — via registry-source.ts's withGovernedRegistryPrice(..., resolveServiceMaxPriceUsd('document_evidence_json_native_v2'))
  RUNTIME_RESOLVED_PRICE (actual CDP-composition settlement ceiling)=0.19
     — apps/edge-api/.../production/document-evidence-json-v2-cdp-composition.ts:194
       pricingKey: 'document_evidence_json_max_job' (shared with v1; not a v2-specific value)
  QUOTE_AMOUNT_SOURCE=resolveServiceMaxPriceUsd('document_evidence_json_native_v2') for discovery/quote metadata;
                       resolveServiceMaxPriceUsd('document_evidence_json_max_job') for the composition's upto ceiling
  SETTLEMENT_AMOUNT_SOURCE=document_evidence_json_max_job (0.19) — unaffected by this investigation's core finding,
                            since 0.19 was never touched and is not exceeded by anything

VERIFY_AGENT_OUTPUT_V2
  REGISTRY_BASE_PRICE=0.019
  GOVERNED_MAX=0.017
  RUNTIME_RESOLVED_PRICE=0.017
  QUOTE_AMOUNT_SOURCE=resolveServiceMaxPriceUsd('verify_agent_output_standard_v2')
  SETTLEMENT_AMOUNT_SOURCE=apps/edge-api/.../production/verify-agent-output-v2-cdp-composition.ts:205
                            pricingKey: 'verify_agent_output_standard_v2'

WEB_CONTEXT_VERIFIED_V2
  REGISTRY_BASE_PRICE=0.009
  GOVERNED_MAX=0.008
  RUNTIME_RESOLVED_PRICE=0.008
  QUOTE_AMOUNT_SOURCE=resolveServiceMaxPriceUsd('web_context_verified_direct_v2')
  SETTLEMENT_AMOUNT_SOURCE=apps/edge-api/.../production/web-context-v2-cdp-composition.ts:256
                            pricingKey: 'web_context_verified_direct_v2'
```

```
DOES_REGISTRY_BASE_PRICE_AFFECT_REAL_CHARGE=NO
```

What the on-disk `base_price`/`maximum_price` bytes *do* affect: (a) the frozen
`contracts:baseline:verify` check's `prices_match` invariant (governance/CONTRACT_COMPATIBILITY.yaml:455,
part of the release-baseline integrity check, not a live pricing decision), and (b)
`packages/vcm/src/legacy/import-registry.ts:255`, which is the code this very investigation
was triggered by.

---

## V. Public machine-visible price, per surface

```
catalog (/catalog, /services/{id})
  apps/edge-api/.../routes/catalog.ts:58-83 overlayEffectiveDiscoveryStatus()
  Reads REGISTRY_SERVICES[...].maximum_price.amount — which, for all four .v2 services, is
  already the runtime-projected GOVERNED price (withGovernedRegistryPrice overwrites both
  base_price.amount and maximum_price.amount with the governed amount at module load).
  CLASSIFICATION=GOVERNED_PRICE
  Note: this exact overlay was added by a prior, separate checkpoint
  ("SUN-1222C2-CANDIDATE-DISCOVERY-ECONOMICS-RECONCILIATION", catalog.ts:46) specifically
  because the D1-seeded price.usd had *already* been observed to drift from the governed
  price — i.e. this exact class of bug (advertised price != governed price) was previously
  identified and fixed for the D1/catalog surface. It was never fixed for the VCM importer,
  because the VCM importer did not exist yet.

MCP (siteborne_get_quote)
  packages/protocol-mcp/src/server.ts:386-490 (EXACT_PRICING_KEYS → resolveServiceMaxPriceUsd)
  CLASSIFICATION=GOVERNED_PRICE

x402 discovery / quote (routes/x402-service.ts, routes/paid-services.ts)
  resolveServiceMaxPriceUsd(config.pricingKey)
  CLASSIFICATION=GOVERNED_PRICE

Bazaar (protocol-x402/src/bazaar/registry-source.ts, discovery.ts)
  withGovernedRegistryPrice(entry, resolveServiceMaxPriceUsd(...))
  CLASSIFICATION=GOVERNED_PRICE

A2A (protocol-a2a/src/card.ts)
  grep for "price" in card.ts returns exactly one hit: a code comment
  ("input/output schema and x402 price is keyed by it") — no price field is emitted in the
  AgentCard itself, matching the A2A spec's lack of a native pricing concept
  (confirmed independently in the earlier METADATA-VCM-03 machine-discovery investigation).
  CLASSIFICATION=NO_PRICE_EXPOSED

OpenAPI (routes/catalog.ts openapiRoute, /openapi.json)
  Documents CatalogResponse.price_usd and ServiceMetadataResponse.price_usd as plain
  strings with no fixed enum of values — the live value returned at request time is
  whatever catalogRoute/serviceMetadataRoute compute, i.e. GOVERNED_PRICE per above.
  CLASSIFICATION=GOVERNED_PRICE
  Side observation (out of scope for this investigation, noted for completeness): the
  documented GET /services/{service_id} `service_id` path-parameter enum
  (catalog.ts:378-383) lists only the four .v1 ids, not the four .v2 ids, even though the
  underlying handler will resolve any id the repository has. This is a separate,
  pre-existing OpenAPI-completeness gap unrelated to the pricing question; not corrected
  here.

Nevermined (protocol-nevermined declarations.ts)
  V2_PRICING_KEY_OVERRIDES map (per SUN-1222C-R3 commit message) — same governed-key
  resolution pattern as the others.
  CLASSIFICATION=GOVERNED_PRICE
```

```
PUBLIC_SURFACES_USING_BASE_PRICE=0 (none — every live surface reads the governed/projected value)
PUBLIC_SURFACES_USING_GOVERNED_PRICE=6 of 7 checked (catalog, MCP, x402, Bazaar, OpenAPI, Nevermined)
PUBLIC_SURFACES_WITH_NO_PRICE=1 (A2A — no native pricing field)
```

This is the single most important finding for the "is this real drift or cosmetic drift"
question: **no live, currently-reachable public surface exposes the stale registry
`base_price` value.** The drift is confined entirely to the on-disk JSON bytes and to
anything (today: only the new VCM importer) that reads those bytes directly instead of going
through `resolveServiceMaxPriceUsd()`.

---

## VI. Semantics of `base_price`, `maximum_price`, `max_price_usd_per_service`

```
FIELD                        base_price (registry/services/*.json)
CURRENT_OWNER                Registry file author, frozen per contract release
ACTUAL_CONSUMERS             contracts:baseline:verify (prices_match check);
                              packages/vcm/src/legacy/import-registry.ts (importer — the bug)
EFFECT_ON_REAL_PAYMENT        None (confirmed §IV)
PUBLICLY_VISIBLE              Only indirectly, after being overwritten by the governed price
                               at runtime for every live surface (§V) — the raw byte value
                               itself is never served
INTENDED_MEANING               A frozen, release-scoped "launch price" reference tied to the
                               contract-release baseline (governance/CONTRACT_COMPATIBILITY.yaml's
                               'launch_price_metadata' concept, lines 341/387), not a live,
                               continuously-current sell price
EVIDENCE                       registry-source.ts:9-11 code comment: "Runtime economic amounts
                               are projected from the governed pricing resolver below; the
                               frozen registry JSON is not an economic authority." (verbatim,
                               present in the file today)

FIELD                        maximum_price (registry/services/*.json)
CURRENT_OWNER                 Same as base_price
ACTUAL_CONSUMERS               catalog.ts (post-projection, so effectively governed for v2);
                                packages/vcm's importer (currently unused for listPrice
                                validation target — see §VII)
EFFECT_ON_REAL_PAYMENT          For document_evidence_json specifically: yes, indirectly — its
                                value (0.19) happens to equal the real `document_evidence_json_max_job`
                                settlement ceiling, but only because that governance key was
                                never repriced, not because the registry field is consulted
                                directly by the settlement path (§IV)
PUBLICLY_VISIBLE                 Same as base_price — overwritten to the governed amount at
                                runtime by withGovernedRegistryPrice for all four .v2 services
INTENDED_MEANING                 For company_evidence_graph/web_context_verified/verify_agent_output:
                                a second reference point on the same frozen contract snapshot
                                (not independently defined anywhere; no distinct "ceiling vs
                                floor" semantic was found in code or docs for these three
                                families — maximum_price simply differs numerically from
                                base_price for historical/tier reasons not explained by any
                                comment found).
                                For document_evidence_json specifically: this is the field
                                that corresponds to the real `_max_job` "upto"-scheme safety
                                ceiling.
EVIDENCE                         governance/CONTRACT_COMPATIBILITY.yaml:406
                                'changed_maximum_price_meaning' is itself a named,
                                classification-required compatibility-sensitive change type —
                                confirming maximum_price's "meaning" is explicitly recognized
                                by the repository's own governance as something distinct per
                                service, not a single universal concept.

FIELD                        max_price_usd_per_service (governance/RISK_LIMITS.yaml)
CURRENT_OWNER                  governance/ (normative, per METADATA-AUTHORITY-01)
ACTUAL_CONSUMERS                Every live pricing/quote/settlement path (§IV), via
                                resolveServiceMaxPriceUsd()
EFFECT_ON_REAL_PAYMENT           Direct and exclusive — this is what a caller is actually
                                charged for "exact"-scheme services (ceiling == charge; no
                                observed headroom between the two for any key checked)
PUBLICLY_VISIBLE                  Yes, via every live surface in §V
INTENDED_MEANING                   For company_evidence_graph / web_context_verified_direct /
                                document_evidence_json_{native,ocr,table} /
                                verify_agent_output_standard: the fixed, exact-scheme sell
                                price (ceiling and charge are the same number).
                                For document_evidence_json_max_job specifically: a distinct
                                "upto"-scheme safety cap, explicitly stated by commit c81b737
                                to be "a safety cap, not a competitive list price" — i.e. true
                                ceiling-with-headroom semantics, not a fixed charge.
EVIDENCE                          commit 36e6cae/c81b737 messages (quoted §III.2);
                                packages/pricing/src/index.ts's validateAtomicPriceChange
                                (20%-cap enforcement, evidence that this field is actively,
                                carefully governed as the true economic control point)
```

`max_price_usd_per_service` is therefore **not one homogeneous concept**: for five of its
nine keys it is a fixed exact-scheme price; for the sixth (`document_evidence_json_max_job`)
it is a true ceiling for a variable-cost `upto`-scheme job. VCM's `governedMaxPrice` field, as
currently designed (a single per-service ceiling value), correctly captures the first case but
does not yet have a place to represent the second case's distinct "ceiling with real headroom
below it" semantics for `document_evidence_json`. This is a secondary, smaller finding beyond
the main v2-generation issue — noted here, not corrected.

---

## VII. Frozen VCM mapping — evaluated against this evidence

```
BASE_PRICE_TO_LIST_PRICE_MAPPING=INCORRECT
```
`registry base_price` is, by the registry's own in-repo documentation, "not an economic
authority." Mapping it directly to VCM's `listPrice` (defined in `packages/vcm/src/types.ts:79`
as "the price a caller is normally charged") is factually wrong for any service/generation
where a governed runtime projection exists and has diverged from the frozen JSON — which today
means all four `.v2` services. It happens to be numerically correct for all four `.v1`
services only because v1 has never been repriced since its governed key and its registry
value were set together at initial creation (§VIII).

```
RISK_LIMIT_TO_GOVERNED_MAX_MAPPING=CORRECT, with one known incompleteness
```
Using `governance/RISK_LIMITS.yaml`'s `max_price_usd_per_service` as the source for VCM's
`governedMaxPrice` is the right call — it is the one field every real runtime payment path
actually consults (§IV). The incompleteness is `document_evidence_json_max_job`'s distinct
ceiling-vs-charge semantics (§VI), not yet represented as a separate concept in the frozen
VCM-02 schema.

```
LIST_LEQ_MAX_INVARIANT=CONDITIONAL
```
The invariant itself — a caller should never be charged more than the governed ceiling — is
correct and is, in fact, satisfied everywhere in the live system today (charge == ceiling,
confirmed for all four `.v2` services in §IV). It only appears violated in VCM's current
model because the model's `listPrice` input is sourced from the wrong field. Once `listPrice`
is sourced from the same governed value the runtime actually uses, the invariant holds
trivially (a value is never greater than itself).

---

## VIII. V1 control group

```
V1_BASE_PRICE_EQUALS_MAX=4  (company_evidence_graph, web_context_verified [vs _direct],
                              document_evidence_json [vs _native], verify_agent_output [vs _standard])
V1_BASE_PRICE_BELOW_MAX=0
V1_BASE_PRICE_ABOVE_MAX=0
```

`all v1 valid + all v2 invalid` is exactly the pattern observed. This is consistent with —
but, as instructed, not proof by itself of — a generation-transition event: v1's governed key
and registry value were authored together in the same commit (94ad83c, 2026-08-05) and have
never diverged since (v1 has never been repriced). v2's registry value was copied from v1 on
2026-08-17 and its *own* governed key was not created until 2026-09-03, three weeks later, by
a separate, explicitly-scoped pricing-experiment checkpoint that deliberately chose not to
touch the registry file (§III.2). The mechanism (a later, separate governance-only repricing
event, deliberately not mirrored into the frozen JSON) fully explains why v1 is clean and v2
is not, without requiring four independent data-entry mistakes.

---

## IX. Generation-specific pricing intent

Commit messages for both v2 pricing checkpoints describe this explicitly as a **deliberate,
bounded pricing experiment**, not a permanent architectural repricing or a promotional
discount:

> "39000->31200 is exactly 20% (ALLOW)... that remains a documented future-experiment
> hypothesis, not applied here." (36e6cae, referring to a considered-but-rejected 41% cut)

> "-11.1%... within the 20% price_change_per_experiment_pct governance cap; Google Document
> AI / commodity-OCR research grounded the broader document pricing decision" (c81b737)

The stated grounding is cost/market research (commodity OCR pricing comparison) bounded by a
governed 20%-per-experiment risk-limit cap (`governance/RISK_LIMITS.yaml`'s
`price_change_per_experiment_pct: 20`), enforced in code by
`packages/pricing/src/index.ts`'s `validateAtomicPriceChange`. This is risk-governed
competitive/cost-driven pricing strategy, not a temporary qualification ceiling and not
unrelated to cost — the evidence supports a genuine, intentional lower price for `.v2`,
enacted through the governance layer exactly as the governance layer is designed to be used.

---

## X. Embedded pricing mirror consistency (reconfirmed at current HEAD)

`packages/pricing/src/service-prices.ts`'s `EMBEDDED_PRICING` constant was read directly
(§ tool trace above) and compared key-by-key against `governance/RISK_LIMITS.yaml`'s
`max_price_usd_per_service` block, including all four `_v2` keys:

```
GOVERNANCE_RUNTIME_MIRROR_PARITY=PASS
```

Every key and value matches exactly, including the four `.v2` entries introduced by
36e6cae/c81b737. This is materially stronger evidence for H2's refutation than a bare
two-way agreement would be: the mirror is a second, independently-maintained artifact
(explicitly required to be kept in sync, validated by `scripts/validate-governance.ts` per
its own doc comment) that agrees with governance, while only the third, structurally
different artifact (the frozen registry JSON, by design never touched) disagrees.

---

## XI. Contract/release evidence

```
PRICE_IS_CONTRACT_FROZEN=YES
```

Evidence:
- `governance/CONTRACT_COMPATIBILITY.yaml:455` — `prices_match` is listed as one of the
  fields a frozen release baseline (`contracts:baseline:verify`) checks for byte-identity
  against its snapshot, i.e. once a contract release is frozen, its recorded prices are part
  of what "frozen" means.
- `governance/CONTRACT_COMPATIBILITY.yaml:341,387` — `launch_price_metadata` appears twice as
  a named, `compatibility_sensitive` field group under two different service families,
  confirming "launch price" (matching the registry's `base_price`) is a recognized,
  governed, release-scoped concept distinct from a continuously-updated live price.
- `governance/CONTRACT_COMPATIBILITY.yaml:406` — `changed_maximum_price_meaning` is
  separately classification-required, reinforcing that a change to what `maximum_price`
  *means* (not just its number) is treated as a compatibility-relevant event.
- The commit message for 36e6cae states the runtime-projection architecture was chosen
  specifically "rather than mutating the frozen contract JSON, which would otherwise trigger
  a major-version contract-compat violation" — a direct, contemporaneous confirmation that
  the team understood editing `base_price` in place would have been a contract-compatibility
  event, not a routine data update.

This distinguishes schema/contract compatibility (the registry JSON's `base_price` field, as
a byte-frozen release artifact) from mutable economic policy (`governance/RISK_LIMITS.yaml`,
which is designed to be revised, and was revised, under its own 20%-per-experiment governance
control) — they are two different authorities serving two different purposes, and the
repository already treats them that way in its runtime code even though `packages/vcm`'s
importer does not yet.

---

## XII. Live read-only corroboration

Not performed. Repository evidence (§III–§XI) fully resolves the question with primary
sources; no ambiguity remained that would have justified a public read-only network call.

```
SKIPPED=YES
REASON=Repository evidence sufficient; no ambiguity about current machine-visible state remained.
```

---

## XIII. Decision matrix

```
EVIDENCE                            H1_REGISTRY_STALE   H2_GOVERNANCE_STALE   H3_SEMANTIC_MAPPING_WRONG   H4/H5
------------------------------------------------------------------------------------------------------------
Git introduction chronology          supports (weak)      refutes               supports (weak)             —
Commit message stated intent          contradicts*         refutes               strongly supports           —
  (*explicitly says frozen-by-design, not an oversight)
Runtime pricing resolver              n/a                  refutes               strongly supports           —
Quote/settlement amount source        n/a                  refutes               strongly supports           —
Embedded mirror parity                n/a                  strongly refutes      n/a                         —
Registry-file code comment            n/a                  n/a                   strongly supports
  ("not an economic authority")
                                                                                  (direct/primary)
Public discovery price (§V)           n/a                  refutes               strongly supports           —
v1 control group                      supports (pattern)   n/a                   n/a                         supports H4
Contract-release evidence (§XI)       explains WHY frozen  refutes               supports (explains mechanism) —
Tests/fixtures                        n/a                  refutes (all v2      n/a                          —
                                                             tests assert the
                                                             governed value)
```

Weighting primary semantic evidence (the code's own explicit "not an economic authority"
comment, the runtime resolver's exclusive use of governed keys, and the commit message's
stated architectural intent) over incidental naming or raw chronology: **H3 is the dominant,
directly-evidenced cause. H1 is real but is the intended, correct consequence of the same
architectural decision that causes H3 — not an independent defect.**

---

## XIV. Root-cause classification

```
PRICING_ROOT_CAUSE=MIXED
```

Specifically: **H1 (registry value factually outdated relative to the later governance
decision) is PROVEN but is intentional, correct, by-design behavior — not a bug.** **H3 (VCM's
importer maps a field the repository explicitly documents as "not an economic authority" onto
its canonical `listPrice`) is PROVEN and is the actionable defect.** H2 is REFUTED. The
correct fix is not to change any price anywhere — it is to change what the VCM importer reads
as `listPrice`.

---

## XV. Recommended next mutation (not performed)

Root cause is `VCM_SEMANTIC_MAPPING_ERROR`-dominant (within a `MIXED` classification), so per
the governing instructions: propose an **additive design checkpoint**, do not edit the frozen
`METADATA-VCM-MASTER-canonical-reference.md` baseline in place.

Proposed scope for a future `METADATA-VCM-04` (or similarly numbered) checkpoint:

1. Introduce a distinct field for the frozen, release-scoped reference value currently
   misread as `listPrice` — e.g. `launchPriceReference: Price` on `ServiceContractRef`
   (EVIDENCE/HISTORICAL-class, sourced verbatim from registry `base_price`/`maximum_price`,
   *not* validated against `governedMaxPrice`, since it is explicitly not an economic
   authority and is allowed to diverge from it by design).
2. Redefine `CanonicalService.economics.listPrice` to be sourced the same way the runtime
   actually resolves a live price: via the per-generation `PricingKey` → governed value
   (the same mapping `packages/pricing/src/service-prices.ts` and every real consumer already
   use), not from the registry JSON file.
3. Extend `ServiceEconomics` (or a new type) to represent `document_evidence_json`'s two
   distinct governed-value roles found in §VI — per-tier exact-scheme prices vs. the
   `_max_job` upto-scheme safety ceiling — rather than a single `governedMaxPrice` scalar.
4. Re-run `legacyRegistryToVCM()` against all 8 registry files with the corrected mapping;
   `validateEconomicConstraints()` should then pass for all 8 services with zero flagged
   violations, since the corrected `listPrice` will equal `governedMaxPrice` exactly
   (ceiling == charge, as established in §IV) for every currently-existing service.
5. `METADATA-VCM-IMPL-01`'s `BLOCKED` result is not itself re-run or reclassified by this
   checkpoint; a future implementation checkpoint that applies the above design correction
   would be the one to attempt PASS.

This mutation is **not performed in this checkpoint.**

---

## XVI. Preservation of the blocked implementation

`validateEconomicConstraints()` was not touched. No `allowLegacyEconomicViolation` escape
hatch was added or proposed. The governing rule — faithfully imported legacy data is not the
same thing as a valid canonical model — was not weakened. The correction identified above
does not weaken the invariant; it corrects which field is checked against it.

---

## XVII. Deliverable

This file. One evidence-only commit is expected to follow, per repository convention
(matching the pattern used for `METADATA-VCM-IMPL-01`'s evidence commit).

---

## XVIII. Required return

```
METADATA_ECON_01=UNRESOLVED

IMPLEMENTATION_BLOCKER=V2_BASE_PRICE_EXCEEDS_GOVERNED_MAX

V2_SERVICES_AFFECTED=4/4

COMPANY_EVIDENCE_GRAPH_V2=
base=0.039
max=0.0312

DOCUMENT_EVIDENCE_JSON_V2=
base=0.012
max=0.0098

VERIFY_AGENT_OUTPUT_V2=
base=0.019
max=0.017

WEB_CONTEXT_VERIFIED_V2=
base=0.009
max=0.008

V1_CONTROL_RESULT=4/4 base_price == governed max exactly; 0 below; 0 above

GOVERNANCE_RUNTIME_MIRROR_PARITY=PASS

BASE_PRICE_AFFECTS_REAL_CHARGE=NO
PUBLIC_SURFACES_USING_BASE_PRICE=0
PUBLIC_SURFACES_USING_GOVERNED_PRICE=6 (catalog, MCP, x402, Bazaar, OpenAPI, Nevermined)

BASE_PRICE_TO_LIST_PRICE_MAPPING=INCORRECT
RISK_LIMIT_TO_GOVERNED_MAX_MAPPING=CORRECT (with one known incompleteness: document_evidence_json's
                                             dual exact/upto governance roles, §VI)
LIST_LEQ_MAX_INVARIANT=CONDITIONAL (correct once listPrice is sourced from the governed value)

H1_REGISTRY_STALE=PROVEN (intentional-by-design, not an oversight — see §II caveat)
H2_GOVERNANCE_STALE=REFUTED
H3_SEMANTIC_MAPPING_WRONG=PROVEN
H4_MIXED_CAUSE=PROVEN

PRICING_ROOT_CAUSE=MIXED (H3-dominant)

PRICE_IS_CONTRACT_FROZEN=YES

RECOMMENDED_NEXT_MUTATION=Additive design checkpoint correcting VCM's listPrice source
  (registry base_price -> per-generation governed PricingKey resolution) plus a distinct
  frozen "launch price reference" field and dual-role economics for document_evidence_json;
  see §XV. Not performed here.
MUTATION_PERFORMED=NO

VCM_IMPLEMENTATION_COMMIT_PRESERVED=f398e5bd39c68b9dd2458ac2cfb32d5055934585
VCM_EVIDENCE_COMMIT_PRESERVED=828de13e42a0bbce90ea15e3b555335885f68949

REGISTRY_MUTATIONS=0
GOVERNANCE_MUTATIONS=0
VCM_IMPLEMENTATION_MUTATIONS=0
PROTOCOL_MUTATIONS=0
RUNTIME_MUTATIONS=0
PRODUCTION_MUTATIONS=0

REPORT=docs/reports/METADATA-ECON-01-v2-pricing-reconciliation.md

SAFE_TO_CORRECT_PRICING=NO
  (nothing about the actual dollar values in registry or governance needs to change —
   they are each functioning as intended for their respective, different purposes.
   What needs correcting is the VCM schema's field mapping, which is a design change,
   not a pricing change; see §XV.)
```

Stop there. Prices are not corrected. `METADATA-VCM-IMPL-01` is not re-run.
