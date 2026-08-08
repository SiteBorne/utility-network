# SITEBORNE Utility Network — ADR 0035: Canonical Hash-List, Not a Merkle Tree, for Verifier-Result Binding (SUN-0500)

## Context

A receipt (ADR 0032) must tamper-evidently bind the full set of per-verifier
results into `verifier_set_hash`, and the full set of evidence content hashes
into `evidence_hash`. Two designs were considered: a canonical sorted-hash list
(`hashCanonical(sort(hashCanonical(item) for item in set))`), or a Merkle tree
over the same items.

## Decision

SUN-0500 uses the canonical sorted-hash-list, not a Merkle tree
(`packages/verification/src/receipt/identity.ts::verifierSetHash`,
`evidenceSetHash`).

A Merkle tree's distinguishing benefit over a flat hash list is partial
disclosure: proving one leaf (e.g., "provenance_verifier passed") is part of a
committed set without revealing every other leaf, via an O(log n)-sized
inclusion proof. At the mesh's current size — 8 verifiers in standard mode, 9 in
`independent_reproduction` mode, single-digit evidence items in the fixture
corpus — no consumer in this repository needs partial-disclosure proofs; every
current reader of a receipt (the receipt verifier itself, a future composition
layer, an auditor re-running `verify_agent_output.v1`) has access to the full
result set already. A Merkle implementation would add real, ongoing complexity —
tree construction with a defined leaf order and duplicate/odd-node handling,
proof serialization, a second verification code path for proofs vs. full-set —
for a capability nothing in SUN-0500 (or its known near-term successors)
actually exercises.

The chosen design still gives everything the receipt currently needs:
deterministic, order-independent binding (sorting before the outer hash means
verifier/evidence registration order never changes the resulting hash — see ADR
0031 on wave-based, non-registration-order execution) and full tamper-evidence
(changing, adding, or removing any single verifier result or evidence hash
changes `verifier_set_hash`/`evidence_hash`, which changes `receipt_id`, which
invalidates the receipt against any legitimate signature).

If a future increment needs partial disclosure — e.g., proving one verifier's
result to a party who should not see the full evidence set — this decision
should be revisited and the hash list replaced with a Merkle tree at that point,
not preemptively now.

## Status

Accepted (SUN-0500).
