#!/usr/bin/env -S npx tsx
/**
 * PRODUCTION-ECONOMICS-DISCOVERY-01 -- canonical-URL publication artifacts.
 *
 * Public metadata (Agent Card, MCP `_meta`, OpenAPI, x402 extension) projects
 * schema URLs of the form `https://siteborne.net/schemas/...` -- the schemas'
 * own `$id`s. Those URLs must map to a real, byte-exact publication artifact,
 * or a metadata consumer following them gets a dead link.
 *
 * This script derives `apps/network-site/schemas/**` from the ACTIVE frozen
 * contract release (contracts/CONTRACT_RELEASE.yaml) -- never hand-edited --
 * and (--check) fails on any missing, extra, or drifted file. It also proves
 * each registry entry's declared `input_schema_hash`/`output_schema_hash` is
 * the hash of the bytes that would be published at its URI.
 *
 * It creates only local source artifacts: it deploys nothing, touches no DNS,
 * Pages project, or Worker, and makes no network request.
 *
 *   tsx scripts/generate-network-site-publication.mts          # write
 *   tsx scripts/generate-network-site-publication.mts --check  # verify only
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHECK = process.argv.includes('--check');
const SITE = join(ROOT, 'apps', 'network-site');
const SCHEMA_OUT = join(SITE, 'schemas');
const CANONICAL_SCHEMA_ORIGIN = 'https://siteborne.net';

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const release = (
  parse(readFileSync(join(ROOT, 'contracts', 'CONTRACT_RELEASE.yaml'), 'utf-8')) as {
    release: { version: string };
  }
).release.version;
const SCHEMA_SRC = join(ROOT, 'contracts', 'releases', release, 'schemas');

const problems: string[] = [];
const expected = new Map<string, Buffer>();
for (const file of walk(SCHEMA_SRC).filter((f) => f.endsWith('.json'))) {
  const rel = relative(SCHEMA_SRC, file);
  const bytes = readFileSync(file);
  const id = (JSON.parse(bytes.toString('utf-8')) as { $id?: string }).$id;
  // The frozen proof-carrying-context schema declares its `$id` on the utility
  // origin (every other schema uses the canonical origin). `$id` is frozen
  // contract content, so the path is required to match and either origin is
  // accepted; the utility-origin host is recorded as a documented future
  // publication target by the canonical-url-projection test.
  const acceptedIds = [
    `${CANONICAL_SCHEMA_ORIGIN}/schemas/${rel}`,
    `https://utility.siteborne.net/schemas/${rel}`,
  ];
  if (!id || !acceptedIds.includes(id)) {
    problems.push(`${rel}: $id "${id}" does not match its publication path /schemas/${rel}`);
  }
  expected.set(rel, bytes);
}

// Registry hash integrity: the declared hash must be the hash of the bytes
// published at the declared URI.
for (const file of readdirSync(join(ROOT, 'registry', 'services')).filter((f) =>
  f.endsWith('.json')
)) {
  const entry = JSON.parse(
    readFileSync(join(ROOT, 'registry', 'services', file), 'utf-8')
  ) as Record<string, string>;
  for (const kind of ['input', 'output'] as const) {
    const uri = entry[`${kind}_schema_uri`];
    const declared = entry[`${kind}_schema_hash`];
    if (!uri.startsWith(`${CANONICAL_SCHEMA_ORIGIN}/schemas/`)) {
      problems.push(`${file}: ${kind}_schema_uri ${uri} is outside the canonical schema origin`);
      continue;
    }
    const rel = uri.slice(`${CANONICAL_SCHEMA_ORIGIN}/schemas/`.length);
    const bytes = expected.get(rel);
    if (!bytes) {
      problems.push(
        `${file}: ${kind}_schema_uri ${uri} has no source schema in contract release ${release}`
      );
      continue;
    }
    const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (actual !== declared) {
      problems.push(`${file}: ${kind}_schema_hash ${declared} !== published bytes ${actual}`);
    }
  }
}

const actualFiles = new Map(
  walk(SCHEMA_OUT).map((f) => [relative(SCHEMA_OUT, f), readFileSync(f)] as const)
);
for (const [rel, bytes] of expected) {
  const current = actualFiles.get(rel);
  if (!current) problems.push(`schemas/${rel}: missing from apps/network-site`);
  else if (!current.equals(bytes))
    problems.push(`schemas/${rel}: differs from contract release ${release}`);
}
for (const rel of actualFiles.keys()) {
  if (!expected.has(rel))
    problems.push(`schemas/${rel}: not present in contract release ${release}`);
}

for (const required of ['docs/a2a', 'extensions/a2a/x402/v1', 'index.html']) {
  if (!existsSync(join(SITE, required)))
    problems.push(`${required}: required publication page is missing`);
}

if (CHECK) {
  if (problems.length > 0) {
    console.error('[publication:check] network-site publication drift:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `[publication:check] apps/network-site matches contract release ${release}: ${expected.size} schemas, registry hashes verified.`
  );
} else {
  const blocking = problems.filter(
    (p) =>
      !p.includes('missing from apps/network-site') &&
      !p.includes('differs from contract release') &&
      !p.includes('not present in contract release')
  );
  if (blocking.length > 0) {
    console.error('[publication:generate] cannot generate:');
    for (const p of blocking) console.error(`  - ${p}`);
    process.exit(1);
  }
  rmSync(SCHEMA_OUT, { recursive: true, force: true });
  for (const [rel, bytes] of expected) {
    const target = join(SCHEMA_OUT, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  console.log(
    `[publication:generate] wrote ${expected.size} schemas from contract release ${release} to apps/network-site/schemas.`
  );
}
