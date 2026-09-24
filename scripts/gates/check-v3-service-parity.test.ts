import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, cpSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECKER_REL = join('scripts', 'gates', 'check-v3-service-parity.ts');
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

const SERVICE_IDS = [
  'company_evidence_graph',
  'web_context_verified',
  'document_evidence_json',
  'verify_agent_output',
];

const FIXTURE_PATHS = [
  CHECKER_REL,
  'apps/edge-api/src/routes/mcp.ts',
  'apps/edge-api/src/control-plane/routes/catalog.ts',
  'contracts/releases/3.0.0/CONTRACT_RELEASE.yaml',
  'contracts/releases/3.0.0/openapi/service-contracts.openapi.json',
  'packages/protocol-a2a/src/constants.ts',
  'packages/vcm/src/projections/types.ts',
  'migrations/0001_control_plane_foundation.sql',
  'apps/edge-api/src/control-plane/repositories/d1/services.ts',
  ...SERVICE_IDS.map((id) => `registry/services/${id}.v3.json`),
  ...SERVICE_IDS.map((id) => `contracts/releases/3.0.0/metadata/${id}.v3.json`),
];

/** Deep-clones and returns the operation object for `serviceId` inside a
 * sandboxed frozen OpenAPI document, for in-place mutation by a caller. */
function openApiOperation(
  doc: { paths: Record<string, Record<string, Record<string, unknown>>> },
  serviceId: string
): Record<string, unknown> {
  for (const methods of Object.values(doc.paths)) {
    for (const op of Object.values(methods)) {
      if (op['x-service-id'] === serviceId) return op;
    }
  }
  throw new Error(`no operation for ${serviceId}`);
}

function runCheckerInSandbox(mutate: (sandbox: string) => void): {
  exitCode: number;
  stdout: string;
} {
  const sandbox = mkdtempSync(join(tmpdir(), 'v3-service-parity-check-'));
  for (const rel of FIXTURE_PATHS) {
    const dest = join(sandbox, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    cpSync(join(REPO_ROOT, rel), dest, { recursive: false, force: true });
  }
  mutate(sandbox);
  try {
    const stdout = execFileSync(TSX_BIN, [join(sandbox, CHECKER_REL)], {
      cwd: sandbox,
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout };
  } catch (e) {
    const err = e as { status: number; stdout: string };
    return { exitCode: err.status, stdout: err.stdout };
  }
}

function readJson(sandbox: string, rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(sandbox, rel), 'utf-8'));
}

function writeJson(sandbox: string, rel: string, value: unknown): void {
  writeFileSync(join(sandbox, rel), JSON.stringify(value, null, 2));
}

describe('check-v3-service-parity', () => {
  it('reflects the real current repo state: parity clean, MCP status matches wiring', () => {
    const { exitCode, stdout } = runCheckerInSandbox(() => {});
    const result = JSON.parse(stdout);
    expect(result.V3_PCC_VERSION_CONSISTENT).toBe('PASS');
    expect(result.V3_CONTRACT_RELEASE_HASH_CONSISTENT).toBe('PASS');
    expect(result.V3_MCP_ALL_FOUR_WIRED).toBe('PASS');
    // registry/services/*.v3.json now declare "tested" (proven by the real
    // MCP transport harness), matching mcp.ts's live wiring of all four.
    expect(result.V3_MCP_DECLARED_STATUS_VS_WIRING).toBe('PASS');
    expect(exitCode).toBe(0);
  });

  it('fails when registry pcc_version diverges from metadata pcc_version', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'registry/services/company_evidence_graph.v3.json';
      const entry = readJson(sandbox, rel);
      entry.pcc_version = '1.0.0';
      writeJson(sandbox, rel, entry);
    });
    const result = JSON.parse(stdout);
    expect(result.V3_PCC_VERSION_CONSISTENT).toBe('FAIL');
    expect(
      result.mismatches.some(
        (m: { field: string; service: string }) =>
          m.field === 'pcc_version' && m.service === 'company_evidence_graph'
      )
    ).toBe(true);
    expect(exitCode).toBe(1);
  });

  it('fails when the registry output_schema_hash diverges from the governed release hash', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'registry/services/web_context_verified.v3.json';
      const entry = readJson(sandbox, rel);
      entry.output_schema_hash =
        'sha256:0000000000000000000000000000000000000000000000000000000000000000';
      writeJson(sandbox, rel, entry);
    });
    const result = JSON.parse(stdout);
    expect(result.V3_CONTRACT_RELEASE_HASH_CONSISTENT).toBe('FAIL');
    expect(
      result.mismatches.some(
        (m: { field: string; service: string }) =>
          m.field === 'output_schema_hash' && m.service === 'web_context_verified'
      )
    ).toBe(true);
    expect(exitCode).toBe(1);
  });

  it('fails V3_MCP_ALL_FOUR_WIRED when a service is removed from the mcp.ts route map', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'apps/edge-api/src/routes/mcp.ts';
      const source = readFileSync(join(sandbox, rel), 'utf-8');
      const mutated = source.replace(
        "'document_evidence_json.v3': documentEvidenceJsonV3CandidateRoute,",
        ''
      );
      expect(mutated).not.toBe(source);
      writeFileSync(join(sandbox, rel), mutated);
    });
    const result = JSON.parse(stdout);
    expect(result.V3_MCP_ALL_FOUR_WIRED).toBe('FAIL');
    expect(result.per_service.document_evidence_json.mcp_wired).toBe(false);
    expect(exitCode).toBe(1);
  });

  it('passes V3_MCP_DECLARED_STATUS_VS_WIRING once the declared status is corrected off "planned"', () => {
    const { stdout } = runCheckerInSandbox((sandbox) => {
      for (const id of SERVICE_IDS) {
        const rel = `registry/services/${id}.v3.json`;
        const entry = readJson(sandbox, rel);
        (entry.protocols as Record<string, string>).mcp = 'live_candidate';
        writeJson(sandbox, rel, entry);
      }
    });
    const result = JSON.parse(stdout);
    expect(result.V3_MCP_DECLARED_STATUS_VS_WIRING).toBe('PASS');
    expect(
      result.mismatches.filter((m: { field: string }) => m.field === 'protocols.mcp')
    ).toHaveLength(0);
  });

  const OPENAPI_REL = 'contracts/releases/3.0.0/openapi/service-contracts.openapi.json';

  it('OPENAPI-1: fails when a v3 operation is removed from the frozen release document', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const doc = readJson(sandbox, OPENAPI_REL) as {
        paths: Record<string, Record<string, unknown>>;
      };
      delete doc.paths['/v3/document/evidence-json'];
      writeJson(sandbox, OPENAPI_REL, doc);
    });
    const result = JSON.parse(stdout);
    expect(result.OPENAPI_RELEASE_3_ARTIFACT_VALID).toBe('FAIL');
    expect(result.OPENAPI_ALL_FOUR_CORE_SERVICES_V3).toBe('FAIL');
    expect(result.per_service.document_evidence_json.openapi_present_in_frozen_release).toBe(false);
    expect(exitCode).toBe(1);
  });

  it('OPENAPI-2: fails when a v3 output schema points to a Release 2 schema identity', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const doc = readJson(sandbox, OPENAPI_REL) as {
        paths: Record<string, Record<string, Record<string, unknown>>>;
        components: { schemas: Record<string, { allOf?: Record<string, unknown>[] }> };
      };
      const op = openApiOperation(doc, 'company_evidence_graph.v3');
      const ref = (
        op.responses as Record<
          string,
          { content: { 'application/json': { schema: { $ref: string } } } }
        >
      )['200'].content['application/json'].schema.$ref;
      const schemaName = ref.slice('#/components/schemas/'.length);
      const schema = doc.components.schemas[schemaName];
      const contractBranch = schema.allOf!.find(
        (b) => (b.properties as Record<string, unknown> | undefined)?.contract
      )!;
      (
        contractBranch.properties as Record<
          string,
          { properties: Record<string, { enum: string[] }> }
        >
      ).contract.properties.service_id.enum = ['company_evidence_graph.v2'];
      writeJson(sandbox, OPENAPI_REL, doc);
    });
    const result = JSON.parse(stdout);
    expect(result.OPENAPI_V3_SCHEMA_RELEASE_PARITY).toBe('FAIL');
    expect(result.per_service.company_evidence_graph.openapi_schema_release_parity).toBe(false);
    expect(exitCode).toBe(1);
  });

  it('OPENAPI-3: fails when a v3 output schema no longer references a PCC document (legacy flat shape)', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const doc = readJson(sandbox, OPENAPI_REL) as {
        paths: Record<string, Record<string, Record<string, unknown>>>;
        components: { schemas: Record<string, { allOf?: Record<string, unknown>[] }> };
      };
      const op = openApiOperation(doc, 'web_context_verified.v3');
      const ref = (
        op.responses as Record<
          string,
          { content: { 'application/json': { schema: { $ref: string } } } }
        >
      )['200'].content['application/json'].schema.$ref;
      const schemaName = ref.slice('#/components/schemas/'.length);
      // Drop the PCCDocument $ref branch, leaving only the bare extension shape
      // -- a legacy flat "VerificationReceipt"-style output with no PCC root.
      doc.components.schemas[schemaName].allOf = doc.components.schemas[schemaName].allOf!.filter(
        (b) => !('$ref' in b)
      );
      writeJson(sandbox, OPENAPI_REL, doc);
    });
    const result = JSON.parse(stdout);
    expect(result.OPENAPI_V3_PCC_PARITY).toBe('FAIL');
    expect(result.per_service.web_context_verified.openapi_pcc_parity).toBe(false);
    expect(exitCode).toBe(1);
  });

  it('OPENAPI-4: fails when the frozen PCCDocument component declares the wrong PCC version', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const doc = readJson(sandbox, OPENAPI_REL) as {
        components: { schemas: Record<string, { pcc_version?: string }> };
      };
      doc.components.schemas.PCCDocument.pcc_version = '1.0.0';
      writeJson(sandbox, OPENAPI_REL, doc);
    });
    const result = JSON.parse(stdout);
    expect(result.OPENAPI_V3_PCC_PARITY).toBe('FAIL');
    for (const id of SERVICE_IDS) {
      expect(result.per_service[id].openapi_pcc_parity).toBe(false);
    }
    expect(exitCode).toBe(1);
  });

  it('OPENAPI-5: fails when the registry price diverges from the governed release metadata price', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'registry/services/verify_agent_output.v3.json';
      const entry = readJson(sandbox, rel);
      entry.base_price = { amount: '9.99', currency: 'USD' };
      writeJson(sandbox, rel, entry);
    });
    const result = JSON.parse(stdout);
    expect(result.OPENAPI_V3_ECONOMIC_PARITY).toBe('FAIL');
    expect(result.OPENAPI_V3_ECONOMIC_MISMATCHES).toBe(1);
    expect(exitCode).toBe(1);
  });

  it('OPENAPI-6: fails when document_evidence_json.v3 is downgraded from BUYER_AUTHORIZED to PUBLIC', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      for (const rel of [
        'registry/services/document_evidence_json.v3.json',
        'contracts/releases/3.0.0/metadata/document_evidence_json.v3.json',
      ]) {
        const entry = readJson(sandbox, rel);
        entry.authorization_classification = 'public';
        writeJson(sandbox, rel, entry);
      }
    });
    const result = JSON.parse(stdout);
    expect(result.OPENAPI_V3_AUTHORIZATION_PARITY).toBe('FAIL');
    expect(result.per_service.document_evidence_json.openapi_authorization_parity).toBe(false);
    expect(exitCode).toBe(1);
  });

  it('OPENAPI-7: fails when verify_agent_output.v3 is downgraded from BUYER_AUTHORIZED to PUBLIC', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      for (const rel of [
        'registry/services/verify_agent_output.v3.json',
        'contracts/releases/3.0.0/metadata/verify_agent_output.v3.json',
      ]) {
        const entry = readJson(sandbox, rel);
        entry.authorization_classification = 'public';
        writeJson(sandbox, rel, entry);
      }
    });
    const result = JSON.parse(stdout);
    expect(result.OPENAPI_V3_AUTHORIZATION_PARITY).toBe('FAIL');
    expect(result.per_service.verify_agent_output.openapi_authorization_parity).toBe(false);
    expect(exitCode).toBe(1);
  });

  it('OPENAPI-8: fails when a v3 candidate is declared production-active', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'registry/services/company_evidence_graph.v3.json';
      const entry = readJson(sandbox, rel);
      entry.production_enabled = true;
      writeJson(sandbox, rel, entry);
    });
    const result = JSON.parse(stdout);
    expect(result.OPENAPI_V3_CANDIDATE_STATE_PARITY).toBe('FAIL');
    expect(result.per_service.company_evidence_graph.openapi_candidate_state_parity).toBe(false);
    expect(exitCode).toBe(1);
  });

  it('OPENAPI-9: fails when the wrong service version is declared in the output schema', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const doc = readJson(sandbox, OPENAPI_REL) as {
        paths: Record<string, Record<string, Record<string, unknown>>>;
        components: { schemas: Record<string, { allOf?: Record<string, unknown>[] }> };
      };
      const op = openApiOperation(doc, 'verify_agent_output.v3');
      const ref = (
        op.responses as Record<
          string,
          { content: { 'application/json': { schema: { $ref: string } } } }
        >
      )['200'].content['application/json'].schema.$ref;
      const schemaName = ref.slice('#/components/schemas/'.length);
      const schema = doc.components.schemas[schemaName];
      const contractBranch = schema.allOf!.find(
        (b) => (b.properties as Record<string, unknown> | undefined)?.contract
      )!;
      (
        contractBranch.properties as Record<
          string,
          { properties: Record<string, { enum: string[] }> }
        >
      ).contract.properties.service_version.enum = ['v2'];
      writeJson(sandbox, OPENAPI_REL, doc);
    });
    const result = JSON.parse(stdout);
    expect(result.OPENAPI_V3_SCHEMA_RELEASE_PARITY).toBe('FAIL');
    expect(result.per_service.verify_agent_output.openapi_schema_release_parity).toBe(false);
    expect(exitCode).toBe(1);
  });

  it('OPENAPI-10: a valid, unmodified live v2 operation never creates a false failure', () => {
    const { exitCode, stdout } = runCheckerInSandbox(() => {});
    const result = JSON.parse(stdout);
    // The checker inspects only .v3 identities; the four live v2 operations
    // (which this fixture set doesn't even copy into the sandbox) are
    // structurally out of scope and must never appear in a mismatch.
    expect(
      result.mismatches.some((m: { service: string }) => String(m.service).endsWith('v2'))
    ).toBe(false);
    expect(result.OPENAPI_RELEASE_3_ARTIFACT_VALID).toBe('PASS');
    expect(exitCode).toBe(0);
  });

  it('A2A-1: fails when a v3 service id is removed from SITEBORNE_SERVICE_IDS', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'packages/protocol-a2a/src/constants.ts';
      const source = readFileSync(join(sandbox, rel), 'utf-8');
      const mutated = source.replace("'document_evidence_json.v3',\n", '');
      expect(mutated).not.toBe(source);
      writeFileSync(join(sandbox, rel), mutated);
    });
    const result = JSON.parse(stdout);
    expect(result.A2A_ALL_FOUR_CORE_SERVICES_V3).toBe('FAIL');
    expect(result.per_service.document_evidence_json.a2a_service_id_declared).toBe(false);
    expect(exitCode).toBe(1);
  });

  it('A2A-2: a valid, unmodified v1/v2 identity list never creates a false failure', () => {
    const { exitCode, stdout } = runCheckerInSandbox(() => {});
    const result = JSON.parse(stdout);
    expect(
      result.mismatches.some((m: { field: string }) => m.field === 'a2a.service_id_declared')
    ).toBe(false);
    expect(result.A2A_ALL_FOUR_CORE_SERVICES_V3).toBe('PASS');
    expect(exitCode).toBe(0);
  });

  it('A2A-3: reflects that result-authorization is not projected by the current governed shape', () => {
    const { stdout } = runCheckerInSandbox(() => {});
    const result = JSON.parse(stdout);
    expect(result.A2A_RESULT_AUTHORIZATION_PROJECTION_MODEL).toBe('NOT_PROJECTED_BY_SURFACE');
  });

  it('A2A-4: flips to REQUIRED_BY_A2A_PROJECTION once the governed entry shape declares the field', () => {
    const { stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'packages/vcm/src/projections/types.ts';
      const source = readFileSync(join(sandbox, rel), 'utf-8');
      const mutated = source.replace(
        'export interface UnsignedAgentCardX402ServiceEntry {',
        'export interface UnsignedAgentCardX402ServiceEntry {\n  readonly authorizationClassification: string;'
      );
      expect(mutated).not.toBe(source);
      writeFileSync(join(sandbox, rel), mutated);
    });
    const result = JSON.parse(stdout);
    expect(result.A2A_RESULT_AUTHORIZATION_PROJECTION_MODEL).toBe('REQUIRED_BY_A2A_PROJECTION');
  });

  it('CATALOG-1: fails CATALOG_IMPLEMENTATION_CONTRACT when the route stops calling the real repository', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'apps/edge-api/src/control-plane/routes/catalog.ts';
      const source = readFileSync(join(sandbox, rel), 'utf-8');
      const mutated = source.replace('repo.getAll()', 'Promise.resolve({ ok: true, value: [] })');
      expect(mutated).not.toBe(source);
      writeFileSync(join(sandbox, rel), mutated);
    });
    const result = JSON.parse(stdout);
    expect(result.CATALOG_IMPLEMENTATION_CONTRACT).toBe('FAIL');
    expect(exitCode).toBe(1);
  });

  it('CATALOG-2: fails CATALOG_IMPLEMENTATION_CONTRACT when the D1 schema drops a required services column', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'migrations/0001_control_plane_foundation.sql';
      const source = readFileSync(join(sandbox, rel), 'utf-8');
      const mutated = source.replace(
        /\s*protocol_status TEXT NOT NULL DEFAULT 'preproduction',/,
        ''
      );
      expect(mutated).not.toBe(source);
      writeFileSync(join(sandbox, rel), mutated);
    });
    const result = JSON.parse(stdout);
    expect(result.CATALOG_IMPLEMENTATION_CONTRACT).toBe('FAIL');
    expect(exitCode).toBe(1);
  });

  it('CATALOG-3: always reports runtime data parity as not verifiable in this repo, never PASS', () => {
    const { stdout } = runCheckerInSandbox(() => {});
    const result = JSON.parse(stdout);
    expect(result.CATALOG_RUNTIME_DATA_PARITY).toBe('NOT_VERIFIABLE_IN_THIS_REPO');
    expect(result.CATALOG_SEED_AUTHORITY).toBe('NOT_FOUND_IN_REPO');
    expect(result.EXTERNAL_CATALOG_PARITY).toBe('EXTERNALLY_VERIFIED_LATER');
  });

  it('CATALOG-4: fails CATALOG_HETEROGENEOUS_VERSION_SEMANTICS when per-service contract_release resolution is removed', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'apps/edge-api/src/control-plane/routes/catalog.ts';
      const source = readFileSync(join(sandbox, rel), 'utf-8');
      const mutated = source.replace(
        'const { contractRelease } = getGovernedMetadata(registryEntry.service_id as GovernedServiceId);',
        "const contractRelease = '1.0.0';"
      );
      expect(mutated).not.toBe(source);
      writeFileSync(join(sandbox, rel), mutated);
    });
    const result = JSON.parse(stdout);
    expect(result.CATALOG_CONTRACT_RELEASE_PROJECTION).toBe('FAIL');
    expect(result.CATALOG_HETEROGENEOUS_VERSION_SEMANTICS).toBe('FAIL');
    expect(exitCode).toBe(1);
  });

  it('CATALOG-5: fails CATALOG_PCC_VERSION_PROJECTION when per-service pcc_version resolution is removed', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'apps/edge-api/src/control-plane/routes/catalog.ts';
      const source = readFileSync(join(sandbox, rel), 'utf-8');
      const mutated = source.replace(
        'return { contract_release: contractRelease, pcc_version: registryEntry.pcc_version };',
        "return { contract_release: contractRelease, pcc_version: '1.0.0' };"
      );
      expect(mutated).not.toBe(source);
      writeFileSync(join(sandbox, rel), mutated);
    });
    const result = JSON.parse(stdout);
    expect(result.CATALOG_PCC_VERSION_PROJECTION).toBe('FAIL');
    expect(result.CATALOG_HETEROGENEOUS_VERSION_SEMANTICS).toBe('FAIL');
    expect(exitCode).toBe(1);
  });

  it('CATALOG-6: fails when the naive forbidden fix (another flat global literal) is reintroduced', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'apps/edge-api/src/control-plane/routes/catalog.ts';
      const source = readFileSync(join(sandbox, rel), 'utf-8');
      const mutated = source.replace(
        "contract_release: '1.0.0',\n    pcc_version: '1.0.0',\n    generated_at: new Date().toISOString(),\n  };\n\n  return c.json(CatalogResponseSchema.parse(response));",
        "contract_release: '3.0.0',\n    pcc_version: '2.0.0',\n    generated_at: new Date().toISOString(),\n  };\n\n  return c.json(CatalogResponseSchema.parse(response));"
      );
      expect(mutated).not.toBe(source);
      writeFileSync(join(sandbox, rel), mutated);
    });
    const result = JSON.parse(stdout);
    expect(result.CATALOG_CONTRACT_RELEASE_PROJECTION).toBe('FAIL');
    expect(result.CATALOG_PCC_VERSION_PROJECTION).toBe('FAIL');
    expect(result.CATALOG_HETEROGENEOUS_VERSION_SEMANTICS).toBe('FAIL');
    expect(exitCode).toBe(1);
  });

  it('CATALOG-7: valid heterogeneous v2/v3 per-service projection does not false-fail', () => {
    const { exitCode, stdout } = runCheckerInSandbox(() => {});
    const result = JSON.parse(stdout);
    expect(result.CATALOG_HETEROGENEOUS_VERSION_SEMANTICS).toBe('PASS');
    expect(result.CATALOG_CONTRACT_RELEASE_PROJECTION).toBe('PASS');
    expect(result.CATALOG_PCC_VERSION_PROJECTION).toBe('PASS');
    expect(exitCode).toBe(0);
  });

  it('fails OPENAPI_LIVE_V3_CANDIDATE_PROJECTED when the live route stops merging the candidate projection', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const rel = 'apps/edge-api/src/control-plane/routes/catalog.ts';
      const source = readFileSync(join(sandbox, rel), 'utf-8');
      const mutated = source.replace('...candidate.paths,\n      ', '');
      expect(mutated).not.toBe(source);
      writeFileSync(join(sandbox, rel), mutated);
    });
    const result = JSON.parse(stdout);
    expect(result.OPENAPI_LIVE_V3_CANDIDATE_PROJECTED).toBe('FAIL');
    expect(result.OPENAPI_ALL_FOUR_CORE_SERVICES_V3).toBe('FAIL');
    expect(exitCode).toBe(1);
  });
});
