/**
 * Governed metadata for the NEW internal finalized-result artifact.
 *
 * Values are build-time embedded (a Worker cannot read repository files) but
 * are each pinned to a governed authority, and
 * tests/internal-result-artifact.test.ts re-derives every one from that authority so
 * drift fails the build:
 *
 *   contract_release  <- contracts/releases/<release>/CONTRACT_RELEASE.yaml
 *   policy_hash       <- hashPolicy(governance/VERIFICATION_POLICY.yaml)
 *   pcc schema        <- CONTRACT_RELEASE.yaml pcc_dependency
 *                        + contracts/releases/<release>/schemas/proof-carrying-context.schema.json bytes
 *   input/output schema <- CONTRACT_RELEASE.yaml services[] entry
 *                        + the governed service input/output schema bytes
 *
 * The legacy externally released receipt still carries the ServiceExecutionContext
 * defaults until the governed wire cutover; this module never feeds that receipt.
 */
import type { ServiceId } from '../types';

export interface GovernedResultMetadata {
  readonly serviceId: ServiceId;
  readonly contractRelease: string;
  readonly policyHash: string;
  readonly pccSchemaRelease: string;
  readonly pccSchemaHash: string;
  readonly inputSchemaHash: string;
  readonly outputSchemaHash: string;
}

/** hashPolicy(loadPolicy()) of governance/VERIFICATION_POLICY.yaml. */
export const GOVERNED_POLICY_HASH =
  'sha256:def2b52c0b6c5598cb7e95d4d79b3dfe472bb9375edf2330fe8e2ca710de1401';

const V1_RELEASE = {
  contractRelease: '1.0.1',
  pccSchemaRelease: '1.0.1',
  pccSchemaHash: 'sha256:f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5',
} as const;

const V2_RELEASE = {
  contractRelease: '2.0.0',
  pccSchemaRelease: '1.1.0',
  pccSchemaHash: 'sha256:d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0',
} as const;

const V3_RELEASE = {
  contractRelease: '3.0.0',
  pccSchemaRelease: '2.0.0',
  pccSchemaHash: 'sha256:9a93214ebd851f2f7dfa86cd9cec4b81d83d5e78aa857f380fd579ada27c00a5',
} as const;

const OUTPUT_SCHEMA_HASHES: Readonly<Record<ServiceId, string>> = {
  'company_evidence_graph.v1':
    'sha256:a82474212615119aa510db7c3bb04e0d9fbf1a32eb740bc8821e10443818d112',
  'web_context_verified.v1':
    'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
  'document_evidence_json.v1':
    'sha256:dfe39d56227803c9e743e7b67da4853a16f76a1a4f3de66b2eb43213b92377ed',
  'verify_agent_output.v1':
    'sha256:f78bb719bc6ee9adb57d76c0181dfb9f466ec9220e9c98766204dbba97f99475',
  'company_evidence_graph.v2':
    'sha256:5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b',
  'web_context_verified.v2':
    'sha256:7d4882e997ec3a3bd97b746de36ed99dfe430d59b4d1c8adc7d9fa83a274b4e0',
  'document_evidence_json.v2':
    'sha256:df91ed115ae0e29d8f4c211d95462ddd96e9714bc5f5e0ce0b820b370e0d5dde',
  'verify_agent_output.v2':
    'sha256:a9a462b89b290ecba1aa62ec6d2fd030572f326ed79f498a43690244b38ad679',
  'company_evidence_graph.v3':
    'sha256:3567477e8ac4e76a57c6baec7cc6e2fa1aa502fca3087ed3753d2e99de036ae1',
  'web_context_verified.v3':
    'sha256:34e9ca4c55b071cfaa2f182ecac5d2513a8ec6a4f3c0a6d0cf0b7027eeab1319',
  'document_evidence_json.v3':
    'sha256:058e6d50796d7adffc5deedd5b96679dcff78d98b77c022c06430885546aeff7',
  'verify_agent_output.v3':
    'sha256:7a164cc8bbd34c95608fcc6e420a36d29844ddfbc6c029439e9f4262cedf8a73',
};

/** Input schemas are byte-identical across releases 1.0.1 and 2.0.0. */
const INPUT_SCHEMA_HASHES: Readonly<Record<string, string>> = {
  company_evidence_graph: 'sha256:8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7',
  web_context_verified: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
  document_evidence_json: 'sha256:19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba',
  verify_agent_output: 'sha256:66d459905cd1a18b57ccb3fc40043a4e4c1a77bc7dba40676fcaf674cacb0f34',
};

export function getGovernedMetadata(serviceId: ServiceId): GovernedResultMetadata {
  const outputSchemaHash = OUTPUT_SCHEMA_HASHES[serviceId];
  if (!outputSchemaHash) throw new Error(`no_governed_metadata_for_service:${serviceId}`);
  const inputSchemaHash = INPUT_SCHEMA_HASHES[serviceId.replace(/\.v[123]$/, '')];
  if (!inputSchemaHash) throw new Error(`no_governed_input_schema_for_service:${serviceId}`);
  const release = serviceId.endsWith('.v3')
    ? V3_RELEASE
    : serviceId.endsWith('.v2')
      ? V2_RELEASE
      : V1_RELEASE;
  return Object.freeze({
    serviceId,
    ...release,
    policyHash: GOVERNED_POLICY_HASH,
    inputSchemaHash,
    outputSchemaHash,
  });
}

/** True for a hash made of a single repeated hex digit (0000…, 2222…, 9999…). */
export function isPlaceholderHash(hash: string): boolean {
  const match = /^sha256:([0-9a-f])\1{63}$/.exec(hash);
  return match !== null;
}
