# SUN-0800B Checkpoint 1 — Local Release-Candidate Readiness

HEAD parent `3f6335e`. **Zero deployments, zero DNS mutations, zero npm
publications, zero Nevermined provider calls, zero CDP transactions.**

## §1: SUN-1000 formal closure

Confirmed clean tree, `HEAD=3f6335e`. Per explicit user acceptance:

```
PASS                12 / 12
FAIL_INTERNAL         0 / 12
BLOCKED_EXTERNAL      0 / 12
```

`TASKS.yaml`'s `SUN-1000` entry updated: `state: 'accepted'`,
`commit_ref: '3f6335e...'`. Nevermined Phase-2 provider status
(`BLOCKED_EXTERNAL_PROVIDER`) preserved as a separate, non-reopening concern.

## §2: SUN-0800B literal acceptance criteria (read before any mutation)

From `TASKS.yaml` directly, not memory:

1. npm shim is published publicly and installs successfully from the public npm
   registry
2. Public remote MCP endpoint is reachable and passes protocol verification
3. Signed Agent Card is publicly reachable at
   `https://utility.siteborne.net/.well-known/agent-card.json`
4. Production/public Agent Card signing identity and verification surface are
   available where required
5. Required external namespace, domain, deployment, DNS, and TLS verification
   completes without overstating production capability

All 5 require real external state (npm registry, public deployment, DNS) that
cannot be satisfied purely locally.

## §14: external preflight — presence-only credential checks

No secret values read or printed at any point.

| Check                          | Result                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm whoami`                   | `ENEEDAUTH` — no npm registry authentication                                                                                                                                             |
| `wrangler whoami`              | Failed before reaching an auth check — `wrangler.toml` has real pre-existing config defects (`kv_namespaces[0].id` is an empty string; `queues` is an array where an object is expected) |
| `CLOUDFLARE_*`/`CF_*` env vars | Absent                                                                                                                                                                                   |
| `~/.wrangler/config`           | Does not exist                                                                                                                                                                           |
| `~/.npmrc` auth token          | Absent                                                                                                                                                                                   |

**Conclusion: the task's frozen `blocked_external` reason is genuinely,
currently true** — not stale inherited state. No deployment, DNS, or npm publish
mutation is possible in this environment.

## §9: Agent Card

`apps/edge-api/src/index.ts` already serves both `/.well-known/agent-card.json`
and `/.well-known/jwks.json` locally, via `a2aRoute` (`packages/protocol-a2a`,
`signing.ts`/`card.ts`). Its own doc comment is explicit: the app "owns only its
immutable local signing identity" — generated in-process, not a real provisioned
production signing key. **Acceptance criterion 4 (production Agent Card signing
identity) is genuinely unmet, independent of and prior to deployment** — this is
a real gap, not merely "not yet deployed."

## §11-12: npm package audit

`@siteborne/mcp-server` (`npm pack --dry-run` then extracted and scanned):

```
package: @siteborne/mcp-server@0.1.0
Tarball Contents:
  689B    README.md
  2.4MB   dist/stdio.js   (bundled)
  1.6kB   package.json
  447B    server.json
total files: 4
```

- **No** `.env`, credential files, private reports, D1 data, sandbox secrets, or
  stray source maps.
- `gitleaks dir` against the extracted tarball: **zero leaks**.
- Grep of the bundled `dist/stdio.js` for `nevermined`/`traceloop`/
  `opentelemetry`: exactly 4 matches, all a single unrelated JSON-schema enum
  field name (a protocol-availability status field) — **never SDK code**.
  Confirms the production artifact excludes the dev-only
  `@nevermined-io/payments` chain entirely (checkpoint 1P's own reclassification
  holds through to the packed artifact).
- `publishConfig.access: "public"` already set; package is not `private`.
- **Two real, minor gaps found, not silently resolved:** no `repository` field
  in `package.json`; `license: "UNLICENSED"` — a genuine user-decision-required
  blocker for public npm publication (cannot publish something publicly with no
  license without deciding what license to grant).

## §13: local release-candidate validation

| Gate                                                                                                                                                                                                                                  | Result                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm check` (full: format/lint/typecheck/tests/PCC/services/OpenAPI/Python/governance/state/tasks/contracts/migrations/D1/control-plane/adapters/document-worker/verification/services-runtime/x402/mcp/a2a/nevermined/secrets-scan) | **PASS**                                                     |
| `pnpm security:trivy`                                                                                                                                                                                                                 | **PASS** (0 CRITICAL, 0 HIGH — unchanged from checkpoint 1P) |

One real defect caught and fixed during this checkpoint's own `TASKS.yaml` edit:
an unescaped apostrophe in a single-quoted YAML string broke `tasks:validate`
parsing — corrected (doubled quote), reverified.

## §22: external mutation accounting

```
Deployments:              0
DNS mutations:            0
npm publications:         0
Nevermined registrations: 0
Nevermined verifies:      0
Nevermined settlements:   0
CDP transactions:         0
Production transactions:  0
```

## §23: SUN-0800B classification

**BLOCKED_EXTERNAL.** The local release candidate is ready (`pnpm check` green,
Trivy 0/0, package tarball clean) but none of the 5 literal acceptance criteria
can be satisfied without real external credentials this environment does not
have. `TASKS.yaml` records the exact remaining prerequisites, all requiring the
user directly:

1. npm registry authentication for the `@siteborne` scope
2. Cloudflare account access with deployment permissions, **plus** a
   `wrangler.toml` config fix (empty `kv_namespaces[0].id`, wrong `queues`
   shape) — both needed before any real `wrangler deploy` attempt
3. DNS provider access for `utility.siteborne.net`, if the zone isn't already
   pointed at the deployed Worker
4. A real, provisioned production Agent Card signing identity (not the current
   in-process/immutable-local one), plus a decision on where that key is stored
   and rotated
5. An explicit license decision for `@siteborne/mcp-server` before public npm
   publication (currently `UNLICENSED`)

## §26: stop report

1. Initial HEAD/tree: `3f6335e`, clean
2. SUN-1000 formally accepted: **yes**
3. SUN-1000 final tally: 12/12 PASS, 0 FAIL_INTERNAL, 0 BLOCKED_EXTERNAL
4. SUN-0800B literal acceptance criteria: listed in §2 above, verbatim from
   `TASKS.yaml`
5. SUN-0800B initial classification: `blocked_external` (unchanged going in)
   6-7. MCP/A2A spec reconciliation: existing implementation already matches
   current protocol shapes (no new spec drift found this checkpoint; deep-dive
   deferred to when deployment is actually possible, since no external mutation
   was reachable to validate against)
6. Agent Card validation: served locally, structurally correct, **but signing
   identity is not production-provisioned** (real gap, §9)
7. OpenAPI validation: `pnpm openapi:generate:check` — PASS (part of
   `pnpm check`)
8. Schemathesis: not re-run this checkpoint (unchanged since checkpoint 1P's own
   clean run; no code changed that would affect it) 11-12. MCP/A2A tests: PASS
   (part of `pnpm check`'s `mcp:check`/`a2a:check`)
9. Packages audited: `@siteborne/mcp-server`
10. Pack artifact clean: **yes** (zero secrets, zero unintended files)
11. Production artifact excludes Nevermined SDK chain: **yes**, confirmed
12. Trivy production result: **0 CRITICAL, 0 HIGH**
13. External account identities reconciled: **no accounts exist to reconcile** —
    npm/Cloudflare both entirely unauthenticated
14. Package-name/version collision status: not checked (no npm auth to query the
    registry meaningfully beyond public unauthenticated lookup, and publication
    isn't reachable this checkpoint regardless)
15. Deployment collision status: not applicable, no deployment attempted
16. DNS current-state status: not read (no external mutation was reachable;
    deferred) 21-24. Public endpoint/Agent Card/MCP/A2A reachable: **no**,
    nothing is deployed publicly
17. OpenAPI reachable: no (local only)
18. v2 discovery services found (local): all four — `company_evidence_graph.v2`,
    `web_context_verified.v2`, `document_evidence_json.v2`,
    `verify_agent_output.v2` 27-28. npm publication performed/reconciled: **no**
    (blocked) 29-30. DNS mutations/deployments: **0/0** 31-34. Nevermined
    provider calls/settlements, CDP transactions, production transactions:
    **0/0/0/0**
19. Model-D public result: not separately re-proven this checkpoint (no public
    endpoint exists to test against; local Model-D isolation already
    re-confirmed in checkpoint 1O-B2B/1P)
20. Nevermined blocker status: `BLOCKED_EXTERNAL_PROVIDER`, unchanged 37-38.
    Customer/revenue evidence increment: **0/0**
21. Full `pnpm check`: **PASS**
22. Security gates: **PASS** (Trivy 0/0, full suite green)
23. **SUN-0800B final classification: BLOCKED_EXTERNAL**
24. `production_ready`: **false**
25. `production_enabled`: **false**
26. Report path: this file
27. Commit: pending this checkpoint's own commit (parent `3f6335e`)
28. Clean tree: yes, confirmed via `pnpm check`/`secrets:scan`
29. Exact next task: **SUN-0800B remains active/blocked_external** — not
    SUN-1100 (its literal 5 acceptance criteria are not met). The user must
    supply the credentials/decisions listed in §23 before this task can progress
    further.

STOP.
