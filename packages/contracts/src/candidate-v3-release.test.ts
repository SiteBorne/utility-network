import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = resolve(import.meta.dirname, '../../..');
const releaseRoot = join(repoRoot, 'contracts/releases/3.0.0');
const release2Root = join(repoRoot, 'contracts/releases/2.0.0');
const serviceIds = [
  'company_evidence_graph.v3',
  'web_context_verified.v3',
  'document_evidence_json.v3',
  'verify_agent_output.v3',
] as const;

function bytes(path: string): Buffer {
  return readFileSync(path);
}

function sha256(path: string): string {
  return createHash('sha256').update(bytes(path)).digest('hex');
}

describe('RESULT-PCC-WIRE-CUTOVER-01 candidate release', () => {
  it('freezes PCC 2.0.0 and Service Contract 3.0.0 with four truthful v3 rows', () => {
    const descriptor = parse(
      bytes(join(releaseRoot, 'CONTRACT_RELEASE.yaml')).toString('utf8')
    ) as {
      release: { version: string };
      pcc_dependency: { schema_release: string; document_version: string; schema_sha256: string };
      services: Array<{
        service_id: string;
        contract_version: string;
        input_schema: string;
        input_schema_sha256: string;
        output_schema: string;
        output_schema_sha256: string;
      }>;
    };

    expect(descriptor.release.version).toBe('3.0.0');
    expect(descriptor.pcc_dependency).toMatchObject({
      schema_release: '2.0.0',
      document_version: '2.0.0',
    });
    expect(sha256(join(releaseRoot, 'schemas/proof-carrying-context.schema.json'))).toBe(
      descriptor.pcc_dependency.schema_sha256
    );
    expect(descriptor.services.map((row) => row.service_id)).toEqual(serviceIds);

    for (const row of descriptor.services) {
      expect(row.contract_version).toBe('3.0.0');
      expect(sha256(join(releaseRoot, row.input_schema))).toBe(row.input_schema_sha256);
      expect(sha256(join(releaseRoot, row.output_schema))).toBe(row.output_schema_sha256);
      const outputSchema = JSON.parse(
        bytes(join(releaseRoot, row.output_schema)).toString('utf8')
      ) as {
        allOf: Array<{
          properties?: { contract?: { properties?: { service_id?: { enum?: string[] } } } };
        }>;
      };
      const ids = outputSchema.allOf.flatMap(
        (entry) => entry.properties?.contract?.properties?.service_id?.enum ?? []
      );
      expect(ids).toContain(row.service_id);
      expect(ids.some((id) => id.endsWith('.v2'))).toBe(false);
    }
  });

  it('governs the required proof namespace and preserves immutable Release 2', () => {
    const schema = JSON.parse(
      bytes(join(releaseRoot, 'schemas/proof-carrying-context.schema.json')).toString('utf8')
    ) as {
      pcc_version: string;
      definitions: Record<string, unknown>;
      properties: { extensions: { allOf?: unknown[] } };
    };
    expect(schema.pcc_version).toBe('2.0.0');
    expect(schema.definitions.verification_proof_v1).toBeDefined();
    expect(JSON.stringify(schema.properties.extensions)).toContain(
      'net.siteborne.verification-proof.v1'
    );
    expect(sha256(join(release2Root, 'SHA256SUMS'))).toBe(
      'b552a649f624a359dd2ab409fb6265a5cb7a8317cb1439056e25bdabd37089ed'
    );
  });

  it('has a complete immutable checksum inventory, external full-PCC examples, and no placeholder hashes', () => {
    const sums = bytes(join(releaseRoot, 'SHA256SUMS')).toString('utf8').trim().split('\n');
    for (const line of sums) {
      const match = /^([0-9a-f]{64}) {2}\.\/(.+)$/.exec(line);
      expect(match, line).not.toBeNull();
      expect(sha256(join(releaseRoot, match![2]))).toBe(match![1]);
    }

    for (const serviceId of serviceIds) {
      const example = JSON.parse(
        bytes(join(releaseRoot, `examples/${serviceId}.pcc.json`)).toString('utf8')
      ) as {
        pcc_version: string;
        contract: { service_id: string; service_version: string; output_schema_hash: string };
        extensions: Record<string, unknown>;
      };
      expect(example).toMatchObject({
        pcc_version: '2.0.0',
        contract: { service_id: serviceId, service_version: 'v3' },
      });
      expect(example.extensions['net.siteborne.verification-proof.v1']).toBeDefined();
    }

    const governedText = [
      bytes(join(releaseRoot, 'CONTRACT_RELEASE.yaml')).toString('utf8'),
      ...serviceIds.map((serviceId) =>
        bytes(join(releaseRoot, `metadata/${serviceId}.json`)).toString('utf8')
      ),
    ].join('\n');
    expect(governedText).not.toMatch(/sha256:(0{64}|9{64}|4{64}|7{64})/);
  });
});
