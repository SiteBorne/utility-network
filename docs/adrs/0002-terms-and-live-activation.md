# SITEBORNE Utility Network - ADR 0002: Source Terms Review and Live Activation

## Context

Every provider adapter (SEC EDGAR, OpenAlex, Crossref, GitHub public, Federal
Register, direct public HTTP) is credential-independent, but that does not make
automated live access to the underlying source automatically permitted. Each
source's terms of use must be reviewed before the adapter is allowed to make a
live network call on the source's behalf.

## Decision

A `TermsGuard` gates every adapter's live execution path:

- `execution_mode: 'test'` bypasses the guard entirely — fixture-mode tests
  never depend on, and never activate, live review status.
- `execution_mode: 'live'` requires a recorded `TermsReview` for the provider.
  No record, a `pending_review` status, or a `blocked` status all return
  `policy_blocked` before any network call is attempted.
- A recorded review whose `termsHash` no longer matches the manifest's
  `terms_hash` is treated as stale and re-blocks access until re-reviewed.
- `raw_access_resale_allowed` is `false` on every shipped manifest; there is no
  path that resells raw source responses.

The shipped `globalTermsGuard` singleton starts with zero recorded reviews.
Every manifest's `terms_review_status` is `pending_review`. No provider is
`production_verified`.

## Status

Accepted

## Consequences

- Live activation of any adapter requires an explicit, out-of-band terms review
  recorded against that provider before `execution_mode: 'live'` can succeed —
  this is a deliberate gate, not an oversight.
- Fixture-mode tests can exercise the full adapter pipeline (normalization,
  provenance, caching, rate limiting) without ever depending on terms review
  state, keeping test correctness independent of legal/business review
  timelines.
- See `docs/guides/source-terms-review-guide.md` for the review workflow and
  `docs/guides/optional-live-test-guide.md` for how the `RUN_LIVE_*` smoke gates
  interact with this guard (they remain `policy_blocked` by design until a
  review is recorded).
