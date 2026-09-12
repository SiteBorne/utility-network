# SUN-1222C — CDP mainnet containment completion (Version Override closure)

## Why prior containment was incomplete

The 2026-09-12T17:47:28Z emergency containment deployment left the active
deployment with two members:

```
d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1 @100%  (PAID_ROUTES_ENABLED=false)
b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @0%    (PAID_ROUTES_ENABLED=true)
```

This closed *ordinary percentage-based* paid admission (100% of untargeted
traffic reaches the paid-disabled version), but it did not close the
*Version Override* surface. Cloudflare Workers Version Overrides
(`cf-workers-preview` / version-override headers or dashboard/API targeting)
can route an individual request to any version that is a **current member of
the active deployment**, regardless of that version's traffic percentage
— including a member sitting at 0%. A version that is not a deployment
member at all cannot be targeted this way.

Live config readback confirmed the risk was real, not theoretical:

| version | PAID_ROUTES_ENABLED | VERIFY_V2_CDP_ROUTE_ENABLED | WEB_CONTEXT_V2_CDP_ROUTE_ENABLED |
|---|---|---|---|
| d28f30c5 (100%) | `false` | `true` | `true` |
| b6b7477f (0%) | `true` | `true` | `true` |

`b6b7477f` was a fully mainnet-payment-capable version reachable at 0%
ordinary traffic but present in deployment membership, i.e. a live Version
Override target while CDP mainnet credential provenance
(SUN-1219/SUN-1219C) remains unresolved.

## Action taken

Exactly one deployment-membership mutation, via `wrangler versions deploy`,
which replaces deployment membership with only the version(s) explicitly
listed:

```
npx wrangler versions deploy d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1@100 \
  --name siteborne-utility-edge --yes
```

Dry-run was executed first and confirmed the resulting deployment would
contain exactly one version (`d28f30c5 @ 100%`), with `b6b7477f` absent from
the spec. The real invocation succeeded (exit 0, "Deployed
siteborne-utility-edge version d28f30c5... at 100%").

`wrangler versions deploy` only mutates deployment/traffic membership and
non-versioned settings (`logpush`, `observability`, tail consumers — synced,
unchanged from prior). It does not upload code, change vars/secrets, modify
routes/DNS/custom domains, or sync triggers.

## Pre-mutation verification (all live, this session)

- `git branch --show-current` = `main`; `git rev-parse HEAD` = `bfac606c2ea1e3ae4d083c153803609cdf215061`; `git status --short` = clean.
- `git cat-file -e bfac606c2ea1e3ae4d083c153803609cdf215061^{commit}` succeeded; `git merge-base --is-ancestor` confirmed it is an ancestor of `HEAD` (i.e. of itself/HEAD — reachable).
- Live Cloudflare topology matched the claimed pre-mutation state exactly: `d28f30c5@100%` / `b6b7477f@0%`, no drift.
- Paid runtime (`d62011b9-6219-47e1-8cf9-5006776cfb50@100%`) and settlement-alert (`8fe32c69-d906-4369-9c0a-49b2cc406e8e@100%`) workers independently confirmed unchanged.
- `preview_urls = false` confirmed in `wrangler.toml` (line 35).
- D1 (`siteborne-utility`, `efe23c42-cbcc-47c2-9b28-922a541bdcdd`) read-only gate: `payment_workflow_owner_intents` table empty (0 rows); zero unreconciled actionable `verified` payment attempts. Four stale nonterminal `jobs` rows found (2 `DELIVERED`, 1 `EXECUTING`, 1 `LOCKED`), all last updated 2026-08-28 through 2026-09-01 (11–15 days stale at the time of this check) — consistent with the previously-established accepted legacy nonterminal baseline, not live in-flight work. No currently-active cutover-blocking work exists.
- Model-C candidates confirmed unassigned to any deployment: `0fd6d9bd-8d29-4b86-a0a6-22634ffeda04` (normal), `afe08ea7-4a64-49a2-a16c-e44fc4a50753` (quiescence).

## Post-mutation verification (all live, this session)

- `wrangler deployments list` shows the new deployment (`2026-09-12T19:34:07.843Z`) with **exactly one** version member: `d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1 @ 100%`. `b6b7477f` is absent from membership.
- `wrangler versions view b6b7477f-...` still succeeds — the version itself remains a retained, immutable, queryable artifact; it is only removed from active deployment membership, not deleted.
- Public discovery probes against the live `workers.dev` origin all returned `200`: `/health`, `/ready`, `/.well-known/agent-card.json`, `/.well-known/jwks.json`, `/catalog`.
- Inert probes (no payment headers) against `/verify` and `/web-context` returned `404`, confirming paid admission remains closed on ordinary traffic.
- No D1 writes, no secret/var/route/DNS/trigger mutations, no payment authorization, no facilitator verify/settle call, no provider execution, no Workflow creation, no chain transaction, no company/document/artifact activation, no mTLS provisioning.

## Result

`b6b7477f` (the only mainnet-payment-capable version reachable via ordinary
config in the current version set) is no longer a member of the active
deployment and can no longer be reached via a Cloudflare Version Override.
Platform-level paid-admission containment (ordinary traffic + Version
Override + Preview URL, the latter globally disabled) is now complete.

**This does not resolve SUN-1219 / SUN-1219C.** CDP mainnet credential
provenance for `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` remains unestablished.
Re-enabling paid admission on any version, by any mechanism, still requires
that separate authorization to close first.
