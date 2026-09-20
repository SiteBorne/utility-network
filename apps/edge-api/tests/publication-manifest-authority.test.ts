import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MANIFEST_PATH = join(REPO, 'governance', 'NETWORK_SITE_PUBLICATION_MANIFEST.json');
const SITE = join(REPO, 'apps', 'network-site');
const UTILITY_PCC_ID = 'https://utility.siteborne.net/schemas/proof-carrying-context.schema.json';

type PublicationArtifact = {
  canonical_url: string;
  source_path: string;
  publication_path: string;
  content_type: string;
  raw_byte_sha256: string;
  size: number;
  authority_source: string;
  contract_version: string;
  schema_id?: string;
  identity_rule: 'raw_bytes' | 'frozen_identifier_identity_only';
};

type PublicationManifest = {
  version: 1;
  hash_domain: 'RAW_BYTES';
  artifacts: PublicationArtifact[];
};

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('network-site publication manifest authority', () => {
  it('maps exactly 22 siteborne.net artifacts without treating the frozen utility PCC id as a second target', () => {
    expect(existsSync(MANIFEST_PATH), MANIFEST_PATH).toBe(true);
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PublicationManifest;

    expect(manifest.version).toBe(1);
    expect(manifest.hash_domain).toBe('RAW_BYTES');
    expect(manifest.artifacts).toHaveLength(22);
    expect(manifest.artifacts.map(({ canonical_url }) => canonical_url)).toEqual(
      [...manifest.artifacts.map(({ canonical_url }) => canonical_url)].sort()
    );
    expect(new Set(manifest.artifacts.map(({ canonical_url }) => canonical_url)).size).toBe(22);
    expect(
      manifest.artifacts.every(({ canonical_url }) =>
        canonical_url.startsWith('https://siteborne.net/')
      )
    ).toBe(true);
    expect(manifest.artifacts.some(({ canonical_url }) => canonical_url === UTILITY_PCC_ID)).toBe(
      false
    );

    const pcc = manifest.artifacts.find(
      ({ canonical_url }) =>
        canonical_url === 'https://siteborne.net/schemas/proof-carrying-context.schema.json'
    );
    expect(pcc).toMatchObject({
      schema_id: UTILITY_PCC_ID,
      identity_rule: 'frozen_identifier_identity_only',
    });
  });

  it('binds every URL to one byte-exact source, publication path, content type, and authority', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PublicationManifest;
    const publicationPaths = new Set<string>();

    for (const artifact of manifest.artifacts) {
      expect(publicationPaths.has(artifact.publication_path), artifact.canonical_url).toBe(false);
      publicationPaths.add(artifact.publication_path);
      expect(artifact.authority_source.length, artifact.canonical_url).toBeGreaterThan(0);
      expect(artifact.contract_version, artifact.canonical_url).toBe('2.0.0');

      const source = readFileSync(join(REPO, artifact.source_path));
      const published = readFileSync(join(REPO, artifact.publication_path));
      expect(published.equals(source), artifact.canonical_url).toBe(true);
      expect(artifact.raw_byte_sha256, artifact.canonical_url).toBe(sha256(published));
      expect(artifact.size, artifact.canonical_url).toBe(published.length);

      if (artifact.publication_path.endsWith('.json')) {
        expect(artifact.content_type, artifact.canonical_url).toBe(
          'application/schema+json; charset=utf-8'
        );
        expect(() => JSON.parse(published.toString('utf8')), artifact.canonical_url).not.toThrow();
      } else if (artifact.publication_path.endsWith('.txt')) {
        expect(artifact.content_type, artifact.canonical_url).toBe('text/plain; charset=utf-8');
      } else {
        expect(artifact.content_type, artifact.canonical_url).toBe('text/html; charset=utf-8');
      }
    }

    expect(publicationPaths.has('apps/network-site/index.html')).toBe(true);
    expect(publicationPaths.has('apps/network-site/_headers')).toBe(false);
    expect(publicationPaths.has('apps/network-site/_redirects')).toBe(false);
  });

  it('governs schema content types and prevents canonical metadata from falling back to index.html', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PublicationManifest;
    const headers = readFileSync(join(SITE, '_headers'), 'utf8');
    expect(headers).toMatch(
      /\/schemas\/\*\s+Content-Type: application\/schema\+json; charset=utf-8/
    );
    expect(headers).toMatch(/\/docs\/a2a\s+Content-Type: text\/html; charset=utf-8/);
    expect(headers).toMatch(
      /\/extensions\/a2a\/x402\/v1\s+Content-Type: text\/html; charset=utf-8/
    );

    for (const artifact of manifest.artifacts) {
      const pathname = new URL(artifact.canonical_url).pathname;
      const expectedPublicationPath =
        pathname === '/' ? 'apps/network-site/index.html' : `apps/network-site${pathname}`;
      expect(artifact.publication_path, artifact.canonical_url).toBe(expectedPublicationPath);
      if (pathname !== '/') {
        expect(artifact.publication_path, artifact.canonical_url).not.toBe(
          'apps/network-site/index.html'
        );
      }
    }
  });
});
