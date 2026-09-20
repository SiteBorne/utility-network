#!/usr/bin/env -S npx tsx
/**
 * Deterministic authority manifest for the siteborne.net static publication.
 *
 * The manifest describes deployable files only. A schema `$id` is retained as
 * identity metadata and does not create a second publication target on another
 * hostname. In particular, the frozen utility-origin PCC `$id` remains in the
 * schema bytes but is not added as a utility.siteborne.net artifact.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE = join(ROOT, 'apps', 'network-site');
const MANIFEST_PATH = join(ROOT, 'governance', 'NETWORK_SITE_PUBLICATION_MANIFEST.json');
const CANONICAL_ORIGIN = 'https://siteborne.net';
const UTILITY_PCC_ID = 'https://utility.siteborne.net/schemas/proof-carrying-context.schema.json';
const CHECK = process.argv.includes('--check');

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

function walk(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    })
    .sort();
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const release = (
  parse(readFileSync(join(ROOT, 'contracts', 'CONTRACT_RELEASE.yaml'), 'utf8')) as {
    release: { version: string };
  }
).release.version;

const artifacts: PublicationArtifact[] = walk(SITE)
  .filter((file) => !['_headers', '_redirects'].includes(relative(SITE, file)))
  .map((file) => {
    const relativePath = relative(SITE, file);
    const publicationPath = `apps/network-site/${relativePath}`;
    const isSchema = relativePath.startsWith('schemas/') && relativePath.endsWith('.json');
    const isSecurity = relativePath === '.well-known/security.txt';
    const canonicalPath =
      relativePath === 'index.html'
        ? '/'
        : relativePath.endsWith('/index.html')
          ? `/${relativePath.slice(0, -'/index.html'.length)}`
          : `/${relativePath}`;
    const bytes = readFileSync(file);
    const schema = isSchema ? (JSON.parse(bytes.toString('utf8')) as { $id?: string }) : undefined;
    const sourcePath = isSchema ? `contracts/releases/${release}/${relativePath}` : publicationPath;
    const isFrozenPcc = schema?.$id === UTILITY_PCC_ID;

    return {
      canonical_url: `${CANONICAL_ORIGIN}${canonicalPath}`,
      source_path: sourcePath,
      publication_path: publicationPath,
      content_type: isSchema
        ? 'application/schema+json; charset=utf-8'
        : isSecurity
          ? 'text/plain; charset=utf-8'
          : 'text/html; charset=utf-8',
      raw_byte_sha256: sha256(bytes),
      size: bytes.length,
      authority_source: isSchema ? 'contracts/CONTRACT_RELEASE.yaml' : publicationPath,
      contract_version: release,
      ...(schema?.$id ? { schema_id: schema.$id } : {}),
      identity_rule: isFrozenPcc ? 'frozen_identifier_identity_only' : 'raw_bytes',
    };
  })
  .sort((left, right) => left.canonical_url.localeCompare(right.canonical_url));

const manifest = `${JSON.stringify(
  {
    version: 1,
    hash_domain: 'RAW_BYTES',
    artifacts,
  },
  null,
  2
)}\n`;

if (artifacts.length !== 22) {
  throw new Error(
    `publication manifest must contain exactly 22 artifacts, found ${artifacts.length}`
  );
}
if (artifacts.some(({ canonical_url }) => canonical_url === UTILITY_PCC_ID)) {
  throw new Error('frozen utility PCC $id must not become a second publication target');
}

if (CHECK) {
  if (!existsSync(MANIFEST_PATH)) throw new Error(`${MANIFEST_PATH}: missing`);
  const existing = readFileSync(MANIFEST_PATH, 'utf8');
  if (existing !== manifest) throw new Error(`${MANIFEST_PATH}: differs from generated manifest`);
  console.log(
    `[publication:manifest:check] ${artifacts.length} artifacts, raw-byte manifest sha256 ${sha256(manifest)}.`
  );
} else {
  writeFileSync(MANIFEST_PATH, manifest);
  console.log(
    `[publication:manifest:generate] wrote ${artifacts.length} artifacts to ${relative(ROOT, MANIFEST_PATH)}, sha256 ${sha256(manifest)}.`
  );
}
