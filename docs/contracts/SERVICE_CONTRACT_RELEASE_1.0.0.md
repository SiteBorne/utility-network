# SERVICE CONTRACT RELEASE 1.0.0

**Release Identity:** SITEBORNE Initial Service Contracts **Version:** 1.0.0
**Status:** Normative (Frozen) **Frozen At:** 2026-08-05T22:45:00Z **Source
Commit:** pending

---

## 1. Release Overview

This release freezes the SITEBORNE service-contract surface at version 1.0.0 and
implements deterministic compatibility enforcement. The release covers:

- 9 common schemas
- 8 service input/output schemas
- 18 generated TypeScript models
- 18 generated Python models
- 3 OpenAPI artifacts
- 4 service metadata records
- Semantic validator contract behavior
- Compatibility policy and fixtures

**Production Status:** Disabled (`production_enabled: false` for all services)

---

## 2. PCC Dependency

| Property             | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| PCC Schema Release   | 1.0.1                                                              |
| PCC Document Version | 1.0.0                                                              |
| PCC Schema SHA-256   | `f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5` |

The PCC schema release 1.0.1 is a patch release correcting `extension_container`
behavior. The PCC document version (`pcc_version` field in every PCC result)
remains 1.0.0.

---

## 3. Service Contracts

| Service ID                  | Contract Version | Input Schema                           | Output Schema                           |
| --------------------------- | ---------------- | -------------------------------------- | --------------------------------------- |
| `company_evidence_graph.v1` | 1.0.0            | `company-evidence-input.schema.json`   | `company-evidence-output.schema.json`   |
| `web_context_verified.v1`   | 1.0.0            | `web-context-input.schema.json`        | `web-context-output.schema.json`        |
| `document_evidence_json.v1` | 1.0.0            | `document-evidence-input.schema.json`  | `document-evidence-output.schema.json`  |
| `verify_agent_output.v1`    | 1.0.0            | `agent-verification-input.schema.json` | `agent-verification-output.schema.json` |

### Schema Hashes

| Schema                                  | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `proof-carrying-context.schema.json`    | `f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5` |
| `company-evidence-input.schema.json`    | `8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7` |
| `company-evidence-output.schema.json`   | `a82474212615119aa510db7c3bb04e0d9fbf1a32eb740bc8821e10443818d112` |
| `web-context-input.schema.json`         | `d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea` |
| `web-context-output.schema.json`        | `138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de` |
| `document-evidence-input.schema.json`   | `19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba` |
| `document-evidence-output.schema.json`  | `dfe39d56227803c9e743e7b67da4853a16f76a1a4f3de66b2eb43213b92377ed` |
| `agent-verification-input.schema.json`  | `66d459905cd1a18b57ccb3fc40043a4e4c1a77bc7dba40676fcaf674cacb0f34` |
| `agent-verification-output.schema.json` | `f78bb719bc6ee9adb57d76c0181dfb9f466ec9220e9c98766204dbba97f99475` |

### Common Schema Hashes

| Schema                                      | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `money.schema.json`                         | `4567307ae24362cb33c1078072cd4d409eb14c0a2783e9941c1d0ec0e7d4b90f` |
| `request-envelope.schema.json`              | `c3c50ca6e7bea34236e2ed92004f61d69acf52b208ba6d38e072a46900d817a9` |
| `quote-request.schema.json`                 | `6db5dcb73b5a40ff31bed8c0ce2acd045a785dd64a3bacaec05ede9d26a426bc` |
| `quote-response.schema.json`                | `0fcc1ef9a79fa4548a47af3ba677c3cc260d68dffe4a6c2e53f9cc60d3601b11` |
| `structured-error.schema.json`              | `aa968374d206ff5e8264dad3eca25be6b27e8bd849065843fa8488732c593d98` |
| `service-metadata.schema.json`              | `97f514fab559fd067673dad2b3aa546d47beb393160b40d4d1a34956158b03bb` |
| `async-job.schema.json`                     | `2979350890d8b2376cf72fabbddbdbfe35182e693eb043d9ca20aa6fe86af994` |
| `pagination.schema.json`                    | `a966b1d885ecb10d03d35f843bce625e60ca2ab6798040e178baa45ab5db3e31` |
| `authorized-artifact-reference.schema.json` | `772db35bb1d19bcee3cfbbfde41da88f77bb10b9afeabe505a15e6a0b25655ac` |

---

## 4. OpenAPI Artifacts

| Artifact                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `common-components.json`         | `3b1c3279aa2b23d04e111beb62a0f9c30c417543cf8a210a2b42e922e49da67a` |
| `service-components.json`        | `24a3846c5cae6b1db82670dfb7ef3b979e31f64a095b369666b5ac37fb685c29` |
| `service-contracts.openapi.json` | `61f3ace1dd8b786cda5821a48f812345a55253e31c20538834c185752a889d86` |

---

## 5. Service Metadata Records

| Service                          | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `company_evidence_graph.v1.json` | `26386bb468a54934cd3edf272efd7f9ae06b669f696f730728ed8ed8b8b5d691` |
| `web_context_verified.v1.json`   | `45ae8403ba92fec6d2427a9fd0dd223896702e4dc3cf8a1cc15100df4c1a26fd` |
| `document_evidence_json.v1.json` | `362addbe666e60b3dc4ec8cc6e7e87bf6c7639c5e0a7b21d280b9d3003755d85` |
| `verify_agent_output.v1.json`    | `3710306684814db15827a45b68a6fd3c51a6ca49b98d318d807704930d20b801` |

All metadata records declare:

- `production_enabled: false`
- `promotion_state: executable_candidate`
- All protocols: `planned`

---

## 6. Generated Artifacts

### TypeScript Models (18 files)

- `packages/contracts/generated/typescript/pcc.ts`
- 9 common models in `packages/contracts/generated/typescript/common/`
- 8 service models in `packages/contracts/generated/typescript/services/`

### Python Models (18 files)

- `packages/contracts/generated/python/pcc.py`
- 9 common models in `packages/contracts/generated/python/common/`
- 8 service models in `packages/contracts/generated/python/services/`

---

## 7. Compatibility Policy

**Policy Version:** `contract-compatibility-v1` **Baseline Path:**
`contracts/releases/1.0.0/` **Strict Mode:** `true`

See: `docs/contracts/COMPATIBILITY_POLICY.md` and
`governance/CONTRACT_COMPATIBILITY.yaml`

### Patch/Minor/Major Rule Summary

| Classification | Version Bump        | Example Changes                                                                |
| -------------- | ------------------- | ------------------------------------------------------------------------------ |
| Patch          | 1.0.0 → 1.0.1       | Documentation, examples, generator fixes, metadata corrections                 |
| Minor          | 1.0.0 → 1.1.0       | New optional fields (strict-consumer evaluated), new extension namespaces      |
| Major          | 1.0.0 → 2.0.0 / .v2 | Required fields, enum changes, type changes, PCC dependency, pricing semantics |

---

## 8. Known Limitations

- Runtime service implementations: **Not implemented**
- Control plane (Hono Worker, D1, R2, Queues): **Not implemented**
- Provider adapters (SEC, web, GitHub): **Not implemented**
- Modal worker (Docling, OCR): **Not implemented**
- Verification mesh (9 verifiers + receipt signer): **Not implemented**
- x402 payments: **Not implemented**
- MCP/A2A/Nevermined/Agentverse: **Not implemented**
- Deployment configuration: **Not implemented**

---

## 9. Future Change Process

1. All changes must be classified using the change taxonomy
2. Compatibility tooling (`pnpm contracts:compat:check`) must pass
3. Human review required for minor and major changes
4. Major changes require new `.v{N+1}` service identity
5. New release creates new version directory under `contracts/releases/`
6. Baseline snapshot is immutable after acceptance

---

## 10. Verification

All verification commands pass:

- `pnpm contracts:baseline:verify` ✓
- `pnpm contracts:compat:check` ✓
- `pnpm contracts:release:verify` ✓
- `pnpm check` (full suite) ✓
- TypeScript tests: 217 passed ✓
- Python PCC/contracts tests: 91 passed ✓
- Python modal-worker tests: 7 passed ✓
- Format/lint/typecheck: passing ✓
- Secret scan: passing ✓
