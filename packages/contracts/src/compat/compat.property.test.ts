import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { parse as parseYaml } from 'yaml';

const repoRoot = join(__dirname, '..', '..', '..', '..');
// SUN-1000 checkpoint 1K-A: previously hard-coded to '1.0.0' — the only
// release that had ever existed. That made this suite (an independent
// mirror of `packages/contracts/scripts/compat.ts`'s own logic, run as
// part of the ordinary `pnpm test`) permanently compare the current
// active state against 1.0.0 specifically, rather than whichever
// release is actually current — the same class of landmine already
// fixed in `compat.ts` itself. Derived from the active descriptor's own
// declared version instead, so this suite tracks whatever the currently
// accepted release genuinely is.
const activeReleaseDescriptorPath = join(repoRoot, 'contracts', 'CONTRACT_RELEASE.yaml');
const activeVersion = (
  parseYaml(readFileSync(activeReleaseDescriptorPath, 'utf-8')) as { release: { version: string } }
).release.version;
const baselinePath = join(repoRoot, 'contracts', 'releases', activeVersion);

function sha256File(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function loadBaselineManifest(): Map<string, string> {
  const sumsPath = join(baselinePath, 'SHA256SUMS');
  const content = readFileSync(sumsPath, 'utf-8');
  const map = new Map<string, string>();
  for (const line of content.trim().split('\n')) {
    const [hash, filepath] = line.split(/\s+/);
    if (hash && filepath) {
      map.set(filepath.replace(/^\.\//, ''), hash);
    }
  }
  return map;
}

describe('Contract Compatibility Property Tests', () => {
  const baselineManifest = loadBaselineManifest();

  it('all baseline files exist in current contracts', () => {
    for (const [relPath] of baselineManifest) {
      if (relPath === 'SHA256SUMS' || relPath === 'COMPATIBILITY_REPORT.json') continue;

      let currentPath: string;
      if (relPath.startsWith('schemas/')) {
        currentPath = join(repoRoot, relPath);
      } else if (relPath.startsWith('openapi/')) {
        currentPath = join(repoRoot, 'packages', 'contracts', 'generated', relPath);
      } else if (relPath.startsWith('metadata/')) {
        currentPath = join(repoRoot, 'registry', 'services', relPath.replace('metadata/', ''));
      } else if (relPath.startsWith('manifests/')) {
        currentPath = join(repoRoot, 'schemas', relPath.replace('manifests/', ''));
      } else if (relPath === 'CONTRACT_RELEASE.yaml') {
        currentPath = join(repoRoot, 'contracts', 'CONTRACT_RELEASE.yaml');
      } else {
        currentPath = join(repoRoot, relPath);
      }

      expect(existsSync(currentPath)).toBe(true);
    }
  });

  it('all baseline file hashes match current contracts', () => {
    for (const [relPath, expectedHash] of baselineManifest) {
      if (relPath === 'SHA256SUMS' || relPath === 'COMPATIBILITY_REPORT.json') continue;

      let currentPath: string;
      if (relPath.startsWith('schemas/')) {
        currentPath = join(repoRoot, relPath);
      } else if (relPath.startsWith('openapi/')) {
        currentPath = join(repoRoot, 'packages', 'contracts', 'generated', relPath);
      } else if (relPath.startsWith('metadata/')) {
        currentPath = join(repoRoot, 'registry', 'services', relPath.replace('metadata/', ''));
      } else if (relPath.startsWith('manifests/')) {
        currentPath = join(repoRoot, 'schemas', relPath.replace('manifests/', ''));
      } else if (relPath === 'CONTRACT_RELEASE.yaml') {
        currentPath = join(repoRoot, 'contracts', 'CONTRACT_RELEASE.yaml');
      } else {
        currentPath = join(repoRoot, relPath);
      }

      const actualHash = sha256File(currentPath);
      expect(actualHash).toBe(expectedHash);
    }
  });

  it('PCC schema hash matches declared dependency', () => {
    // SUN-1000 checkpoint 1M: updated from the 1.0.1 hash as part of this
    // checkpoint's own governed PCC schema minor release (1.0.1 -> 1.1.0,
    // service_id enum gains 4 .v2 members, classified minor-compatible per
    // packages/pcc-schema/policy/COMPATIBILITY.md, not the service-contract
    // taxonomy) -- the same legitimate "routine maintenance a real,
    // intentional version bump requires" category already established at
    // checkpoint 1K-A for the sibling contract-release version pin below.
    const pccPath = join(repoRoot, 'schemas', 'proof-carrying-context.schema.json');
    const hash = sha256File(pccPath);
    expect(hash).toBe('d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0');
  });

  it('service metadata records have correct schema hashes', () => {
    const services = [
      {
        id: 'company_evidence_graph.v1',
        input: '8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7',
        output: '5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b',
      },
      {
        id: 'web_context_verified.v1',
        input: 'd3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
        output: '7d4882e997ec3a3bd97b746de36ed99dfe430d59b4d1c8adc7d9fa83a274b4e0',
      },
      {
        id: 'document_evidence_json.v1',
        input: '19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba',
        output: 'df91ed115ae0e29d8f4c211d95462ddd96e9714bc5f5e0ce0b820b370e0d5dde',
      },
      {
        id: 'verify_agent_output.v1',
        input: '66d459905cd1a18b57ccb3fc40043a4e4c1a77bc7dba40676fcaf674cacb0f34',
        output: 'a9a462b89b290ecba1aa62ec6d2fd030572f326ed79f498a43690244b38ad679',
      },
    ];

    for (const svc of services) {
      const metaPath = join(repoRoot, 'registry', 'services', `${svc.id}.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.input_schema_hash).toBe(`sha256:${svc.input}`);
      expect(meta.output_schema_hash).toBe(`sha256:${svc.output}`);
      expect(meta.pcc_version).toBe('1.0.0');
      expect(meta.production_enabled).toBe(false);
    }
  });

  it('no extra files in baseline beyond manifest (excluding COMPATIBILITY_REPORT.json)', () => {
    const manifestFiles = new Set(baselineManifest.keys());
    manifestFiles.delete('SHA256SUMS');
    manifestFiles.delete('COMPATIBILITY_REPORT.json');

    const baselineFiles = new Set<string>();
    function walk(dir: string, base: string) {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relative(base, fullPath);
        if (entry.isDirectory()) {
          walk(fullPath, base);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.json') ||
            entry.name.endsWith('.yaml') ||
            entry.name.endsWith('.yml'))
        ) {
          baselineFiles.add(relPath);
        }
      }
    }
    walk(baselinePath, baselinePath);

    for (const file of baselineFiles) {
      if (!manifestFiles.has(file) && file !== 'COMPATIBILITY_REPORT.json') {
        throw new Error(`Extra file in baseline not in manifest: ${file}`);
      }
    }
  });

  it('service contract release version is 2.0.0', () => {
    // SUN-1000 checkpoint 1M: updated from 1.0.1 as part of this
    // checkpoint's own governed major release (defect B / checkpoint
    // 1K-B's CONTRACT_2_AND_SERVICE_V2_REQUIRED decision, implemented per
    // checkpoint 1L's frozen migration plan) — exactly the routine
    // maintenance any real, intentional version bump requires (not a
    // hard-coded landmine like the ones fixed elsewhere in this
    // checkpoint: those broke ordinary, version-unrelated `pnpm check`
    // runs; this assertion is meant to change precisely when, and only
    // when, a human deliberately changes the active release version).
    const releasePath = join(repoRoot, 'contracts', 'CONTRACT_RELEASE.yaml');
    const content = readFileSync(releasePath, 'utf-8');
    expect(content).toContain("version: '2.0.0'");
    expect(content).toContain("status: 'normative'");
  });

  it('all service IDs end with .v2', () => {
    // SUN-1000 checkpoint 1M: the active descriptor now describes the v2
    // service-major identities (checkpoint 1L PREPRODUCTION_V2_REPLACEMENT
    // decision — v1 remains permanently frozen at contracts/releases/
    // 1.0.0 and 1.0.1, unaffected by this active-descriptor change).
    const releasePath = join(repoRoot, 'contracts', 'CONTRACT_RELEASE.yaml');
    const content = readFileSync(releasePath, 'utf-8');
    const services = content.match(/service_id: '([^']+)'/g) || [];
    for (const svc of services) {
      expect(svc).toMatch(/\.v2'$/);
    }
  });

  it('production_enabled is false in all metadata', () => {
    const services = [
      'company_evidence_graph.v1',
      'web_context_verified.v1',
      'document_evidence_json.v1',
      'verify_agent_output.v1',
    ];
    for (const svc of services) {
      const metaPath = join(repoRoot, 'registry', 'services', `${svc}.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.production_enabled).toBe(false);
    }
  });

  it('compatibility policy version is contract-compatibility-v1', () => {
    const policyPath = join(repoRoot, 'governance', 'CONTRACT_COMPATIBILITY.yaml');
    const content = readFileSync(policyPath, 'utf-8');
    expect(content).toContain("policy_version: 'contract-compatibility-v1'");
  });

  it('strict mode is enabled in compatibility config', () => {
    const releasePath = join(repoRoot, 'contracts', 'CONTRACT_RELEASE.yaml');
    const content = readFileSync(releasePath, 'utf-8');
    expect(content).toContain('strict_mode: true');
  });
});
