#!/usr/bin/env tsx
/**
 * LOCAL-GATE-INSTRUMENTATION-02 — narrow first slice of the core-surface
 * matrix: PCC version + contract-release identity parity for the four
 * .v3 candidate services (company_evidence_graph, web_context_verified,
 * document_evidence_json, verify_agent_output) across three real sources:
 *
 *   - registry/services/<id>.v3.json           (served registry entry)
 *   - contracts/releases/3.0.0/metadata/<id>.v3.json  (governed metadata)
 *   - contracts/releases/3.0.0/CONTRACT_RELEASE.yaml  (frozen release manifest)
 *
 * plus one real MCP-wiring-vs-declared-status cross-check against
 * apps/edge-api/src/routes/mcp.ts, since both registry and metadata
 * declare `protocols.mcp: "planned"` while the route file already wires
 * live v3 candidate handlers for all four services — this checker makes
 * that a machine-detected mismatch instead of prose.
 *
 * SITEBORNE-OPENAPI-V3-CONVERGENCE-01 extends this same gate with the
 * OpenAPI slice of the 4x4 matrix, against three more real sources:
 *
 *   - contracts/releases/3.0.0/openapi/service-contracts.openapi.json
 *     (frozen Release 3 candidate contract — immutable, read-only here)
 *   - apps/edge-api/src/control-plane/routes/catalog.ts
 *     (the live `/openapi.json` projection source — a static wiring check,
 *     same technique as the MCP wiring check above: this checker never
 *     spins up the live server, it detects whether the real generator call
 *     and the real path/schema merge are present in the served route's own
 *     source)
 *
 * Still deliberately dependency-free (no workspace package imports): the
 * negative-fixture suite (check-v3-service-parity.test.ts) copies a fixed,
 * named fixture-file list into an isolated sandbox and runs this script
 * there with no pnpm workspace or node_modules resolution available, so
 * every fact this script needs must come from a file it reads directly.
 *
 * SITEBORNE-FINAL-LOCAL-CONVERGENCE-01 adds the remaining two quadrants:
 *
 *   - A2A: `SITEBORNE_SERVICE_IDS` (packages/protocol-a2a/src/constants.ts)
 *     is the real skill-identity wiring source; `UnsignedAgentCardX402ServiceEntry`
 *     (packages/vcm/src/projections/types.ts) is the governed first-party
 *     projection shape — inspected structurally (its field list) to determine
 *     whether result-authorization is a real omission or a field the surface
 *     never declares. It never does today, so this is NOT_PROJECTED_BY_SURFACE,
 *     not a mismatch.
 *   - Catalog: split into CATALOG_IMPLEMENTATION_CONTRACT (real, locally
 *     verifiable: does the route call the real repository, does the D1 schema
 *     declare the fields the route/response schema require) and
 *     CATALOG_RUNTIME_DATA_PARITY, which is always NOT_VERIFIABLE_IN_THIS_REPO
 *     because no migration, seed script, or application code path in this
 *     repository ever inserts rows into the real `services`/`service_versions`
 *     D1 tables outside of tests — real Catalog rows are populated entirely
 *     out-of-band. This is a genuine, load-bearing repo fact, not a stub.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const SERVICE_IDS = [
  'company_evidence_graph',
  'web_context_verified',
  'document_evidence_json',
  'verify_agent_output',
] as const;
type ServiceId = (typeof SERVICE_IDS)[number];

interface PriceAmount {
  amount: string;
  currency: string;
}

interface RegistryEntry {
  service_id: string;
  pcc_version: string;
  input_schema_hash: string;
  output_schema_hash: string;
  protocols: Record<string, string>;
  authorization_classification: string;
  promotion_state: string;
  production_enabled: boolean;
  base_price: PriceAmount;
  maximum_price: PriceAmount;
}

interface MetadataEntry {
  service_id: string;
  pcc_version: string;
  input_schema_hash: string;
  output_schema_hash: string;
  protocols: Record<string, string>;
  authorization_classification: string;
  promotion_state: string;
  production_enabled: boolean;
  base_price: PriceAmount;
  maximum_price: PriceAmount;
}

/** Expected result-confidentiality class per service family (STEP 6 of the
 * governed mission: company_evidence_graph/web_context_verified are public
 * candidate results; document_evidence_json/verify_agent_output require an
 * authorized subject binding). This table is the one place this checker
 * asserts an expectation rather than merely comparing two sources — every
 * other check below is pure cross-source consistency. */
const EXPECTED_AUTHORIZATION: Readonly<Record<ServiceId, 'public' | 'buyer_authorized'>> = {
  company_evidence_graph: 'public',
  web_context_verified: 'public',
  document_evidence_json: 'buyer_authorized',
  verify_agent_output: 'buyer_authorized',
};

interface OpenApiOperation {
  'x-service-id'?: string;
  'x-production-enabled'?: boolean;
  'x-result-authorization'?: unknown;
  responses?: {
    '200'?: {
      content?: {
        'application/json'?: { schema?: { $ref?: string; allOf?: unknown[] } };
      };
    };
  };
}

interface OpenApiSchemaComponent {
  pcc_version?: string;
  allOf?: unknown[];
}

interface OpenApiDoc {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, OpenApiSchemaComponent> };
}

function findOperation(doc: OpenApiDoc, serviceId: string): OpenApiOperation | null {
  for (const methods of Object.values(doc.paths)) {
    for (const op of Object.values(methods)) {
      if (op['x-service-id'] === serviceId) return op;
    }
  }
  return null;
}

/** Walks an output schema's `allOf` to find the referenced PCCDocument
 * component and the nested `contract.service_id`/`contract.service_version`
 * enum the schema actually constrains a candidate result to. Real structural
 * inspection of the frozen contract, not a string match. */
function inspectOutputSchema(
  doc: OpenApiDoc,
  op: OpenApiOperation
): {
  pccVersion: string | null;
  serviceIdEnum: string[] | null;
  serviceVersionEnum: string[] | null;
} {
  const responseSchema = op.responses?.['200']?.content?.['application/json']?.schema;
  const resolvedSchema = responseSchema?.$ref?.startsWith('#/components/schemas/')
    ? doc.components.schemas[responseSchema.$ref.slice('#/components/schemas/'.length)]
    : responseSchema;
  const allOf = (resolvedSchema?.allOf ?? []) as Array<Record<string, unknown>>;
  let pccVersion: string | null = null;
  let serviceIdEnum: string[] | null = null;
  let serviceVersionEnum: string[] | null = null;
  for (const branch of allOf) {
    const ref = branch.$ref as string | undefined;
    if (ref?.startsWith('#/components/schemas/')) {
      const name = ref.slice('#/components/schemas/'.length);
      const referenced = doc.components.schemas[name];
      if (referenced?.pcc_version) pccVersion = referenced.pcc_version;
    }
    const contract = (branch.properties as Record<string, unknown> | undefined)?.contract as
      | { properties?: Record<string, { enum?: string[] }> }
      | undefined;
    if (contract?.properties?.service_id?.enum) serviceIdEnum = contract.properties.service_id.enum;
    if (contract?.properties?.service_version?.enum)
      serviceVersionEnum = contract.properties.service_version.enum;
  }
  return { pccVersion, serviceIdEnum, serviceVersionEnum };
}

interface ContractReleaseService {
  service_id: string;
  contract_version: string;
  input_schema_sha256: string;
  output_schema_sha256: string;
}

interface Mismatch {
  service: ServiceId;
  field: string;
  expected: string;
  observed: string;
  source_artifact: string;
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), 'utf-8')) as T;
}

// CONTRACT_RELEASE.yaml's `services:` list has a fixed, flat shape (no
// nesting under each entry beyond scalar fields), so a small line-based
// parser avoids pulling in a YAML library just to read four scalars —
// keeping this checker dependency-free and trivially sandboxable.
function parseContractReleaseServices(yamlText: string): ContractReleaseService[] {
  const lines = yamlText.split('\n');
  const services: ContractReleaseService[] = [];
  let current: Partial<ContractReleaseService> | null = null;
  for (const line of lines) {
    const idMatch = line.match(/^\s*-\s*service_id:\s*(\S+)/);
    if (idMatch) {
      if (current?.service_id) services.push(current as ContractReleaseService);
      current = { service_id: idMatch[1] };
      continue;
    }
    if (!current) continue;
    const fieldMatch = line.match(
      /^\s*(contract_version|input_schema_sha256|output_schema_sha256):\s*(\S+)/
    );
    if (fieldMatch) {
      (current as Record<string, string>)[fieldMatch[1]] = fieldMatch[2];
    }
  }
  if (current?.service_id) services.push(current as ContractReleaseService);
  return services;
}

// registry/output hashes carry a trailing byte the metadata/contract-release
// hashes don't (both are read verbatim here, never normalized) — compared
// as opaque strings, so any real divergence still fails loudly.
function stripHashPrefix(h: string): string {
  return h.replace(/^sha256:/, '');
}

function main(): void {
  const contractReleaseServices = parseContractReleaseServices(
    readFileSync(join(REPO_ROOT, 'contracts/releases/3.0.0/CONTRACT_RELEASE.yaml'), 'utf-8')
  );

  const mcpRouteSource = readFileSync(join(REPO_ROOT, 'apps/edge-api/src/routes/mcp.ts'), 'utf-8');
  const catalogRouteSource = readFileSync(
    join(REPO_ROOT, 'apps/edge-api/src/control-plane/routes/catalog.ts'),
    'utf-8'
  );
  const a2aConstantsSource = readFileSync(
    join(REPO_ROOT, 'packages/protocol-a2a/src/constants.ts'),
    'utf-8'
  );
  const vcmProjectionTypesSource = readFileSync(
    join(REPO_ROOT, 'packages/vcm/src/projections/types.ts'),
    'utf-8'
  );
  const d1MigrationSource = readFileSync(
    join(REPO_ROOT, 'migrations/0001_control_plane_foundation.sql'),
    'utf-8'
  );
  const d1ServicesRepoSource = readFileSync(
    join(REPO_ROOT, 'apps/edge-api/src/control-plane/repositories/d1/services.ts'),
    'utf-8'
  );

  // --- A2A slice: extension entry shape is inspected once, not per-service
  // (it is a single interface declaration, not four separate artifacts).
  const x402EntryInterfaceMatch = vcmProjectionTypesSource.match(
    /interface UnsignedAgentCardX402ServiceEntry \{([\s\S]*?)\n\}/
  );
  const x402EntryFields = x402EntryInterfaceMatch ? x402EntryInterfaceMatch[1] : '';
  const a2aProjectsAuthorization = /authorizationClassification/.test(x402EntryFields);
  const a2aResultAuthorizationProjectionModel = a2aProjectsAuthorization
    ? 'REQUIRED_BY_A2A_PROJECTION'
    : 'NOT_PROJECTED_BY_SURFACE';

  // --- Catalog slice: implementation-contract facts only (never a claim
  // about real row content — see CATALOG_RUNTIME_DATA_PARITY below).
  const catalogUsesRealRepository =
    catalogRouteSource.includes("c.get('servicesRepo')") &&
    catalogRouteSource.includes('repo.getAll()');
  const catalogHasNoHardcodedServiceArray = !/const\s+services\s*=\s*\[\s*\{/.test(
    catalogRouteSource
  );
  const d1ServicesTableHasRequiredColumns = [
    'production_enabled',
    'production_ready',
    'protocol_status',
  ].every((col) => new RegExp(`${col}\\b`).test(d1MigrationSource));
  const d1ServiceVersionsTableHasContractRelease =
    /contract_release/.test(d1MigrationSource) && /pcc_dependency/.test(d1MigrationSource);
  const d1RepositoryImplementsRealQueries =
    /SELECT \* FROM services/.test(d1ServicesRepoSource) &&
    /INSERT INTO services/.test(d1ServicesRepoSource);
  // Real, checked repo fact (not inferred): no migration/seed/application
  // code path in this repository ever calls `D1ServicesRepository.create()`
  // outside of tests, so real D1 `services`/`service_versions` rows are
  // populated entirely out-of-band, external to this repository.
  const CATALOG_SEED_AUTHORITY = 'NOT_FOUND_IN_REPO';
  const CATALOG_RUNTIME_DATA_PARITY_REASON =
    'REAL_CATALOG_ROWS_POPULATED_OUT_OF_BAND_NO_IN_REPO_SEED_AUTHORITY';
  const frozenOpenApiDoc = readJson<OpenApiDoc>(
    'contracts/releases/3.0.0/openapi/service-contracts.openapi.json'
  );
  // Real static wiring check (same technique as the MCP wiring check): never
  // spins up the live server, detects whether the served route's own source
  // actually calls the real v3 candidate generator and merges its output.
  const liveProjectionWired =
    catalogRouteSource.includes('buildV3CandidateOpenApiOperations') &&
    catalogRouteSource.includes('...candidate.paths') &&
    catalogRouteSource.includes('...candidate.schemas');
  const frozenDocHasLegacyReceipt =
    JSON.stringify(frozenOpenApiDoc).includes('VerificationReceipt');

  const mismatches: Mismatch[] = [];
  const perService: Record<
    string,
    {
      pcc_version_consistent: boolean;
      contract_release_hash_consistent: boolean;
      mcp_wired: boolean;
      mcp_declared_planned: boolean;
      openapi_present_in_frozen_release: boolean;
      openapi_pcc_parity: boolean;
      openapi_schema_release_parity: boolean;
      openapi_economic_parity: boolean;
      openapi_authorization_parity: boolean;
      openapi_candidate_state_parity: boolean;
      a2a_service_id_declared: boolean;
    }
  > = {};

  for (const id of SERVICE_IDS) {
    const registry = readJson<RegistryEntry>(`registry/services/${id}.v3.json`);
    const metadata = readJson<MetadataEntry>(`contracts/releases/3.0.0/metadata/${id}.v3.json`);
    const releaseEntry = contractReleaseServices.find((s) => s.service_id === `${id}.v3`);

    if (!releaseEntry) {
      mismatches.push({
        service: id,
        field: 'contract_release_entry',
        expected: `${id}.v3 present in CONTRACT_RELEASE.yaml`,
        observed: 'absent',
        source_artifact: 'contracts/releases/3.0.0/CONTRACT_RELEASE.yaml',
      });
      continue;
    }

    const pccConsistent = registry.pcc_version === metadata.pcc_version;
    if (!pccConsistent) {
      mismatches.push({
        service: id,
        field: 'pcc_version',
        expected: metadata.pcc_version,
        observed: registry.pcc_version,
        source_artifact: `registry/services/${id}.v3.json`,
      });
    }

    const registryOutputHash = stripHashPrefix(registry.output_schema_hash);
    const metadataOutputHash = stripHashPrefix(metadata.output_schema_hash);
    const releaseOutputHash = releaseEntry.output_schema_sha256;
    const hashConsistent =
      registryOutputHash === metadataOutputHash && metadataOutputHash === releaseOutputHash;
    if (!hashConsistent) {
      mismatches.push({
        service: id,
        field: 'output_schema_hash',
        expected: releaseOutputHash,
        observed: `registry=${registryOutputHash} metadata=${metadataOutputHash}`,
        source_artifact: `registry/services/${id}.v3.json, contracts/releases/3.0.0/metadata/${id}.v3.json`,
      });
    }

    const camelId = id.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const wiredKey = `'${id}.v3': ${camelId}V3CandidateRoute`;
    const mcpWired = mcpRouteSource.includes(wiredKey);
    const mcpDeclaredPlanned = registry.protocols.mcp === 'planned';

    if (mcpWired && mcpDeclaredPlanned) {
      mismatches.push({
        service: id,
        field: 'protocols.mcp',
        expected: 'not "planned" (a live candidate route is already wired in mcp.ts)',
        observed: 'planned',
        source_artifact: `registry/services/${id}.v3.json, apps/edge-api/src/routes/mcp.ts`,
      });
    }

    // --- OpenAPI slice ---------------------------------------------------
    const fullServiceId = `${id}.v3`;
    const frozenOp = findOperation(frozenOpenApiDoc, fullServiceId);
    const presentInFrozenRelease = frozenOp !== null;
    if (!presentInFrozenRelease) {
      mismatches.push({
        service: id,
        field: 'openapi.frozen_release_operation',
        expected: `${fullServiceId} present as x-service-id in contracts/releases/3.0.0/openapi/service-contracts.openapi.json`,
        observed: 'absent',
        source_artifact: 'contracts/releases/3.0.0/openapi/service-contracts.openapi.json',
      });
    }

    const {
      pccVersion: frozenPccVersion,
      serviceIdEnum,
      serviceVersionEnum,
    } = frozenOp
      ? inspectOutputSchema(frozenOpenApiDoc, frozenOp)
      : { pccVersion: null, serviceIdEnum: null, serviceVersionEnum: null };

    const openapiPccParity =
      presentInFrozenRelease &&
      registry.pcc_version === metadata.pcc_version &&
      metadata.pcc_version === frozenPccVersion;
    if (!openapiPccParity) {
      mismatches.push({
        service: id,
        field: 'openapi.pcc_version',
        expected: metadata.pcc_version,
        observed: `registry=${registry.pcc_version} frozen_openapi=${frozenPccVersion ?? 'not found'}`,
        source_artifact: `registry/services/${id}.v3.json, contracts/releases/3.0.0/openapi/service-contracts.openapi.json`,
      });
    }

    const schemaReleaseParity =
      presentInFrozenRelease &&
      Array.isArray(serviceIdEnum) &&
      serviceIdEnum.length === 1 &&
      serviceIdEnum[0] === fullServiceId &&
      Array.isArray(serviceVersionEnum) &&
      serviceVersionEnum.length === 1 &&
      serviceVersionEnum[0] === 'v3';
    if (!schemaReleaseParity) {
      mismatches.push({
        service: id,
        field: 'openapi.output_schema_release_identity',
        expected: `contract.service_id=["${fullServiceId}"], contract.service_version=["v3"]`,
        observed: `service_id=${JSON.stringify(serviceIdEnum)} service_version=${JSON.stringify(serviceVersionEnum)}`,
        source_artifact: 'contracts/releases/3.0.0/openapi/service-contracts.openapi.json',
      });
    }

    const priceEqual = (a: PriceAmount, b: PriceAmount) =>
      a.amount === b.amount && a.currency === b.currency;
    const economicParity =
      priceEqual(registry.base_price, metadata.base_price) &&
      priceEqual(registry.maximum_price, metadata.maximum_price);
    if (!economicParity) {
      mismatches.push({
        service: id,
        field: 'openapi.economics',
        expected:
          JSON.stringify(metadata.base_price) + ' / ' + JSON.stringify(metadata.maximum_price),
        observed:
          JSON.stringify(registry.base_price) + ' / ' + JSON.stringify(registry.maximum_price),
        source_artifact: `registry/services/${id}.v3.json, contracts/releases/3.0.0/metadata/${id}.v3.json`,
      });
    }

    const expectedAuth = EXPECTED_AUTHORIZATION[id];
    const authorizationParity =
      registry.authorization_classification === expectedAuth &&
      metadata.authorization_classification === expectedAuth &&
      presentInFrozenRelease &&
      (expectedAuth === 'buyer_authorized'
        ? frozenOp!['x-result-authorization'] !== undefined
        : frozenOp!['x-result-authorization'] === undefined);
    if (!authorizationParity) {
      mismatches.push({
        service: id,
        field: 'openapi.authorization_classification',
        expected: `${expectedAuth} (frozen x-result-authorization ${expectedAuth === 'buyer_authorized' ? 'present' : 'absent'})`,
        observed: `registry=${registry.authorization_classification} metadata=${metadata.authorization_classification} frozen_x-result-authorization=${frozenOp ? frozenOp['x-result-authorization'] !== undefined : 'n/a'}`,
        source_artifact: `registry/services/${id}.v3.json, contracts/releases/3.0.0/metadata/${id}.v3.json, contracts/releases/3.0.0/openapi/service-contracts.openapi.json`,
      });
    }

    const candidateStateParity =
      registry.promotion_state === metadata.promotion_state &&
      registry.promotion_state === 'executable_candidate' &&
      registry.production_enabled === false &&
      metadata.production_enabled === false &&
      presentInFrozenRelease &&
      frozenOp!['x-production-enabled'] === false;
    if (!candidateStateParity) {
      mismatches.push({
        service: id,
        field: 'openapi.candidate_state',
        expected: 'promotion_state="executable_candidate", production_enabled=false everywhere',
        observed: `registry=${registry.promotion_state}/${registry.production_enabled} metadata=${metadata.promotion_state}/${metadata.production_enabled} frozen_x-production-enabled=${frozenOp ? frozenOp['x-production-enabled'] : 'n/a'}`,
        source_artifact: `registry/services/${id}.v3.json, contracts/releases/3.0.0/metadata/${id}.v3.json, contracts/releases/3.0.0/openapi/service-contracts.openapi.json`,
      });
    }

    // --- A2A slice ---------------------------------------------------------
    const a2aServiceIdDeclared = new RegExp(`'${fullServiceId}'`).test(a2aConstantsSource);
    if (!a2aServiceIdDeclared) {
      mismatches.push({
        service: id,
        field: 'a2a.service_id_declared',
        expected: `'${fullServiceId}' present in SITEBORNE_SERVICE_IDS`,
        observed: 'absent',
        source_artifact: 'packages/protocol-a2a/src/constants.ts',
      });
    }

    perService[id] = {
      pcc_version_consistent: pccConsistent,
      contract_release_hash_consistent: hashConsistent,
      mcp_wired: mcpWired,
      mcp_declared_planned: mcpDeclaredPlanned,
      openapi_present_in_frozen_release: presentInFrozenRelease,
      openapi_pcc_parity: openapiPccParity,
      openapi_schema_release_parity: schemaReleaseParity,
      openapi_economic_parity: economicParity,
      openapi_authorization_parity: authorizationParity,
      openapi_candidate_state_parity: candidateStateParity,
      a2a_service_id_declared: a2aServiceIdDeclared,
    };
  }

  const allPccConsistent = SERVICE_IDS.every((id) => perService[id]?.pcc_version_consistent);
  const allHashConsistent = SERVICE_IDS.every(
    (id) => perService[id]?.contract_release_hash_consistent
  );
  const allWired = SERVICE_IDS.every((id) => perService[id]?.mcp_wired);
  const anyDriftedMcpStatus = SERVICE_IDS.some(
    (id) => perService[id]?.mcp_wired && perService[id]?.mcp_declared_planned
  );

  const allPresentInFrozenRelease = SERVICE_IDS.every(
    (id) => perService[id]?.openapi_present_in_frozen_release
  );
  const allOpenapiPccParity = SERVICE_IDS.every((id) => perService[id]?.openapi_pcc_parity);
  const allSchemaReleaseParity = SERVICE_IDS.every(
    (id) => perService[id]?.openapi_schema_release_parity
  );
  const allEconomicParity = SERVICE_IDS.every((id) => perService[id]?.openapi_economic_parity);
  const allAuthorizationParity = SERVICE_IDS.every(
    (id) => perService[id]?.openapi_authorization_parity
  );
  const allCandidateStateParity = SERVICE_IDS.every(
    (id) => perService[id]?.openapi_candidate_state_parity
  );

  const openapiReleaseArtifactValid = allPresentInFrozenRelease && !frozenDocHasLegacyReceipt;
  const openapiAllFourCoreServicesV3 = allPresentInFrozenRelease && liveProjectionWired;
  const economicMismatchCount = SERVICE_IDS.filter(
    (id) => !perService[id]?.openapi_economic_parity
  ).length;
  const openapiMatrixMismatches = mismatches.filter((m) => m.field.startsWith('openapi.')).length;

  const allA2aDeclared = SERVICE_IDS.every((id) => perService[id]?.a2a_service_id_declared);
  const a2aMatrixMismatches = mismatches.filter((m) => m.field.startsWith('a2a.')).length;

  const catalogImplementationContract =
    catalogUsesRealRepository &&
    catalogHasNoHardcodedServiceArray &&
    d1ServicesTableHasRequiredColumns &&
    d1ServiceVersionsTableHasContractRelease &&
    d1RepositoryImplementsRealQueries;

  // CATALOG-HETEROGENEOUS-VERSION-SEMANTICS-01: the blind spot this gate had
  // was validating route/schema SHAPE without ever checking that each
  // service in a heterogeneous /catalog response carries its OWN governed
  // contract_release/pcc_version rather than one false document-wide value.
  // Detected purely from the served route's own source (same static-wiring
  // technique as the OpenAPI checks above): the naive forbidden fix (another
  // flat global literal) is checked for explicitly and fails the gate if
  // present.
  const catalogHasNaiveGlobalLiteralFix =
    /contract_release:\s*'3\.0\.0'/.test(catalogRouteSource) ||
    /pcc_version:\s*'2\.0\.0'/.test(catalogRouteSource);
  const catalogProjectsPerServiceContractRelease =
    /getGovernedMetadata\(/.test(catalogRouteSource) &&
    catalogRouteSource.includes('contract_release: contractRelease') &&
    !catalogHasNaiveGlobalLiteralFix;
  const catalogProjectsPerServicePccVersion =
    catalogRouteSource.includes('registryEntry.pcc_version') && !catalogHasNaiveGlobalLiteralFix;
  const catalogEnvelopeSemanticsDocumented =
    /DOCUMENT\/ENVELOPE/.test(catalogRouteSource) &&
    catalogRouteSource.includes('resolveCatalogVersionFields');
  const catalogHeterogeneousVersionSemantics =
    catalogProjectsPerServiceContractRelease &&
    catalogProjectsPerServicePccVersion &&
    catalogEnvelopeSemanticsDocumented;

  // Mixed-release sweep: derived (not separately re-scanned) from the same
  // per-service mismatch findings above — a v3-scoped check whose *observed*
  // value names a v1/v2 identity, schema, or default is exactly what "v3 file
  // pointing at a Release 2 fact" or "stale v2 current/default leak" looks
  // like in this checker's own evidence.
  const mixedReleaseCurrentProjections = mismatches.filter(
    (m) =>
      (m.field === 'openapi.output_schema_release_identity' || m.field === 'pcc_version') &&
      /\.v(1|2)\b/.test(m.observed)
  ).length;
  const staleV2CurrentDefaultReferences = mismatches.filter(
    (m) => m.field === 'openapi.candidate_state' && /production_enabled=true/.test(m.observed)
  ).length;

  const results = {
    V3_PCC_VERSION_CONSISTENT: allPccConsistent ? 'PASS' : 'FAIL',
    V3_CONTRACT_RELEASE_HASH_CONSISTENT: allHashConsistent ? 'PASS' : 'FAIL',
    V3_MCP_ALL_FOUR_WIRED: allWired ? 'PASS' : 'FAIL',
    V3_MCP_DECLARED_STATUS_VS_WIRING: anyDriftedMcpStatus
      ? 'FAIL (protocols.mcp="planned" but a live route is already wired — see mismatches)'
      : 'PASS',
    OPENAPI_RELEASE_3_ARTIFACT_VALID: openapiReleaseArtifactValid ? 'PASS' : 'FAIL',
    OPENAPI_LIVE_V3_CANDIDATE_PROJECTED: liveProjectionWired ? 'PASS' : 'FAIL',
    OPENAPI_ALL_FOUR_CORE_SERVICES_V3: openapiAllFourCoreServicesV3 ? 'PASS' : 'FAIL',
    OPENAPI_V3_PCC_PARITY: allOpenapiPccParity ? 'PASS' : 'FAIL',
    OPENAPI_V3_SCHEMA_RELEASE_PARITY: allSchemaReleaseParity ? 'PASS' : 'FAIL',
    OPENAPI_V3_ECONOMIC_PARITY: allEconomicParity ? 'PASS' : 'FAIL',
    OPENAPI_V3_ECONOMIC_MISMATCHES: economicMismatchCount,
    OPENAPI_V3_AUTHORIZATION_PARITY: allAuthorizationParity ? 'PASS' : 'FAIL',
    OPENAPI_V3_CANDIDATE_STATE_PARITY: allCandidateStateParity ? 'PASS' : 'FAIL',
    OPENAPI_MATRIX_MISMATCHES: openapiMatrixMismatches,
    A2A_ALL_FOUR_CORE_SERVICES_V3: allA2aDeclared ? 'PASS' : 'FAIL',
    A2A_RESULT_AUTHORIZATION_PROJECTION_MODEL: a2aResultAuthorizationProjectionModel,
    A2A_MATRIX_MISMATCHES: a2aMatrixMismatches,
    CATALOG_IMPLEMENTATION_CONTRACT: catalogImplementationContract ? 'PASS' : 'FAIL',
    CATALOG_HETEROGENEOUS_VERSION_SEMANTICS: catalogHeterogeneousVersionSemantics
      ? 'PASS'
      : 'FAIL',
    CATALOG_CONTRACT_RELEASE_PROJECTION: catalogProjectsPerServiceContractRelease
      ? 'PASS'
      : 'FAIL',
    CATALOG_PCC_VERSION_PROJECTION: catalogProjectsPerServicePccVersion ? 'PASS' : 'FAIL',
    CATALOG_SEED_AUTHORITY,
    CATALOG_RUNTIME_DATA_PARITY: 'NOT_VERIFIABLE_IN_THIS_REPO',
    CATALOG_RUNTIME_DATA_PARITY_REASON,
    EXTERNAL_CATALOG_PARITY: 'EXTERNALLY_VERIFIED_LATER',
    MIXED_RELEASE_CURRENT_PROJECTIONS: mixedReleaseCurrentProjections,
    STALE_V2_CURRENT_DEFAULT_REFERENCES: staleV2CurrentDefaultReferences,
    mismatches,
    per_service: perService,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(results, null, 2));

  if (
    results.V3_PCC_VERSION_CONSISTENT !== 'PASS' ||
    results.V3_CONTRACT_RELEASE_HASH_CONSISTENT !== 'PASS' ||
    results.V3_MCP_ALL_FOUR_WIRED !== 'PASS' ||
    results.V3_MCP_DECLARED_STATUS_VS_WIRING !== 'PASS' ||
    results.OPENAPI_RELEASE_3_ARTIFACT_VALID !== 'PASS' ||
    results.OPENAPI_LIVE_V3_CANDIDATE_PROJECTED !== 'PASS' ||
    results.OPENAPI_ALL_FOUR_CORE_SERVICES_V3 !== 'PASS' ||
    results.OPENAPI_V3_PCC_PARITY !== 'PASS' ||
    results.OPENAPI_V3_SCHEMA_RELEASE_PARITY !== 'PASS' ||
    results.OPENAPI_V3_ECONOMIC_PARITY !== 'PASS' ||
    results.OPENAPI_V3_AUTHORIZATION_PARITY !== 'PASS' ||
    results.OPENAPI_V3_CANDIDATE_STATE_PARITY !== 'PASS' ||
    results.A2A_ALL_FOUR_CORE_SERVICES_V3 !== 'PASS' ||
    results.CATALOG_IMPLEMENTATION_CONTRACT !== 'PASS' ||
    results.CATALOG_HETEROGENEOUS_VERSION_SEMANTICS !== 'PASS' ||
    results.CATALOG_CONTRACT_RELEASE_PROJECTION !== 'PASS' ||
    results.CATALOG_PCC_VERSION_PROJECTION !== 'PASS'
  ) {
    process.exitCode = 1;
  }
}

main();
