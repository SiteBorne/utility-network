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
    const pccPath = join(repoRoot, 'schemas', 'proof-carrying-context.schema.json');
    const hash = sha256File(pccPath);
    expect(hash).toBe('f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5');
  });

  it('service metadata records have correct schema hashes', () => {
    const services = [
      {
        id: 'company_evidence_graph.v1',
        input: '8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7',
        output: 'a82474212615119aa510db7c3bb04e0d9fbf1a32eb740bc8821e10443818d112',
      },
      {
        id: 'web_context_verified.v1',
        input: 'd3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
        output: '138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
      },
      {
        id: 'document_evidence_json.v1',
        input: '19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba',
        output: 'dfe39d56227803c9e743e7b67da4853a16f76a1a4f3de66b2eb43213b92377ed',
      },
      {
        id: 'verify_agent_output.v1',
        input: '66d459905cd1a18b57ccb3fc40043a4e4c1a77bc7dba40676fcaf674cacb0f34',
        output: 'f78bb719bc6ee9adb57d76c0181dfb9f466ec9220e9c98766204dbba97f99475',
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

  it('service contract release version is 1.0.1', () => {
    // SUN-1000 checkpoint 1K-A: updated from 1.0.0 as part of this
    // checkpoint's own governed patch release — exactly the routine
    // maintenance any real, intentional version bump requires (not a
    // hard-coded landmine like the ones fixed elsewhere in this
    // checkpoint: those broke ordinary, version-unrelated `pnpm check`
    // runs; this assertion is meant to change precisely when, and only
    // when, a human deliberately changes the active release version).
    const releasePath = join(repoRoot, 'contracts', 'CONTRACT_RELEASE.yaml');
    const content = readFileSync(releasePath, 'utf-8');
    expect(content).toContain("version: '1.0.1'");
    expect(content).toContain("status: 'normative'");
  });

  it('all service IDs end with .v1', () => {
    const releasePath = join(repoRoot, 'contracts', 'CONTRACT_RELEASE.yaml');
    const content = readFileSync(releasePath, 'utf-8');
    const services = content.match(/service_id: '([^']+)'/g) || [];
    for (const svc of services) {
      expect(svc).toMatch(/\.v1'$/);
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
