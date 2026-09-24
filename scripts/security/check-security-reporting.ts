#!/usr/bin/env tsx
/**
 * LOCAL-GATE-01 Section 7 — security reporting cross-surface parity checker.
 *
 * Verifies that every CURRENT first-party projection of the security.txt
 * policy (SECURITY.md, the edge-api route source, the static network-site
 * artifact) agrees on contact/policy/languages/expiry, that the retired
 * contact does not leak onto any current surface, and that no unexpected
 * ("invented") contact address has appeared. HISTORICAL_IMMUTABLE surfaces
 * (docs/reports/**) and EXTERNAL_REPO_SURFACE paths (other git worktrees
 * under .claude/worktrees/**) are recognized but deliberately not migrated
 * or scored against current-surface convergence.
 *
 * siteborne.com is the canonical Policy URL host but has no source in this
 * repository, so its own security.txt cannot be verified here — that gate
 * is reported as NOT_VERIFIABLE_IN_THIS_REPO, never PASS and never
 * GENUINELY_NOT_APPLICABLE (it remains a real future cutover requirement).
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const CANONICAL_CONTACT_ADDRESS = 'security@alerts.siteborne.net';
const CANONICAL_CONTACT = `mailto:${CANONICAL_CONTACT_ADDRESS}`;
const STALE_CONTACT = 'security@siteborne.net';
const CANONICAL_POLICY = 'https://siteborne.com/security';
const CANONICAL_EXPIRES = '2027-08-31T23:59:59Z';
const CANONICAL_LANGUAGES = 'en';

type Classification = 'CURRENT_PROJECTION' | 'HISTORICAL_IMMUTABLE' | 'EXTERNAL_REPO_SURFACE';

interface SurfaceResult {
  path: string;
  classification: Classification;
  hasStaleContact: boolean;
}

function classify(path: string): Classification {
  const p = path.replace(/^\.\//, '');
  if (p.startsWith('.claude/worktrees/')) return 'EXTERNAL_REPO_SURFACE';
  if (p.startsWith('docs/reports/')) return 'HISTORICAL_IMMUTABLE';
  return 'CURRENT_PROJECTION';
}

function grepStaleContact(): string[] {
  try {
    const out = execSync(
      `grep -rl "${STALE_CONTACT}" --include="*.md" --include="*.ts" --include="*.txt" --include="*.json" --include="*.yaml" . 2>/dev/null | grep -v node_modules | grep -v "/dist/"`,
      { cwd: REPO_ROOT, encoding: 'utf-8' }
    );
    return out.split('\n').filter(Boolean);
  } catch (e) {
    // grep exits 1 when no matches are found — that is success, not an error.
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1) return [];
    throw e;
  }
}

function main(): void {
  const hits = grepStaleContact().map((p) => p.replace(/^\.\//, ''));
  const surfaces: SurfaceResult[] = hits.map((path) => ({
    path,
    classification: classify(path),
    hasStaleContact: true,
  }));

  // Files whose only reference to the stale contact is an intentional
  // negative-assertion fixture/self-reference, not a leaked live projection.
  const KNOWN_FIXTURE_REFERENCES = new Set([
    'apps/edge-api/tests/security-txt.test.ts',
    'scripts/security/check-security-reporting.ts',
    'scripts/security/check-security-reporting.test.ts',
  ]);

  const currentProjectionsWithStaleContact = surfaces.filter(
    (s) => s.classification === 'CURRENT_PROJECTION' && !KNOWN_FIXTURE_REFERENCES.has(s.path)
  );

  const currentSurfaceFiles = [
    'SECURITY.md',
    'apps/edge-api/src/routes/security-txt.ts',
    'apps/network-site/.well-known/security.txt',
  ];
  const missing = currentSurfaceFiles.filter((f) => !existsSync(join(REPO_ROOT, f)));

  const contents = Object.fromEntries(
    currentSurfaceFiles
      .filter((f) => existsSync(join(REPO_ROOT, f)))
      .map((f) => [f, readFileSync(join(REPO_ROOT, f), 'utf-8')])
  );

  // SECURITY.md is a prose policy pointer, not an RFC 9116 document: it only
  // needs the bare contact address, not the mailto:/Expires/Policy fields.
  const RFC9116_SURFACES = [
    'apps/edge-api/src/routes/security-txt.ts',
    'apps/network-site/.well-known/security.txt',
  ];

  const rfc9116SurfacesOk = RFC9116_SURFACES.every((f) => {
    const body = contents[f];
    return (
      body !== undefined &&
      body.includes(CANONICAL_CONTACT) &&
      body.includes(CANONICAL_EXPIRES) &&
      body.includes(CANONICAL_POLICY) &&
      body.includes(`Preferred-Languages: ${CANONICAL_LANGUAGES}`)
    );
  });

  const securityMdOk = contents['SECURITY.md']?.includes(CANONICAL_CONTACT_ADDRESS) ?? false;

  const canonicalConfigOk = missing.length === 0 && rfc9116SurfacesOk && securityMdOk;

  const crossSurfaceConvergence =
    canonicalConfigOk && currentProjectionsWithStaleContact.length === 0;

  // A conservative "invented contact" scan: any mailto: address inside the
  // current security.txt/route surfaces other than the canonical one.
  const inventedContacts = new Set<string>();
  for (const [file, body] of Object.entries(contents)) {
    const matches = body.match(/mailto:[^\s"'`]+/g) ?? [];
    for (const m of matches) {
      if (m !== CANONICAL_CONTACT) inventedContacts.add(`${file}:${m}`);
    }
  }

  const results = {
    SECURITY_REPORTING_CANONICAL_CONFIG:
      missing.length > 0 ? 'FAIL' : canonicalConfigOk ? 'PASS' : 'FAIL',
    SECURITY_CONTACT_CROSS_SURFACE_CONVERGENCE: crossSurfaceConvergence ? 'PASS' : 'FAIL',
    STALE_SECURITY_CONTACTS:
      currentProjectionsWithStaleContact.length === 0
        ? 'PASS'
        : `FAIL (${currentProjectionsWithStaleContact.map((s) => s.path).join(', ')})`,
    INVENTED_SECURITY_CONTACTS:
      inventedContacts.size === 0 ? 'PASS' : `FAIL (${[...inventedContacts].join(', ')})`,
    SECURITY_REPORTING_GENERATED_DRIFT:
      'DERIVED_FROM_EXISTING_EVIDENCE (see: pnpm publication:manifest:check)',
    SITEBORNE_COM_SECURITY_TXT_SOURCE_VALID: 'NOT_VERIFIABLE_IN_THIS_REPO',
    missing_current_surfaces: missing,
    historical_immutable_hits: surfaces
      .filter((s) => s.classification === 'HISTORICAL_IMMUTABLE')
      .map((s) => s.path),
    external_repo_surface_hits: surfaces
      .filter((s) => s.classification === 'EXTERNAL_REPO_SURFACE')
      .map((s) => s.path),
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(results, null, 2));

  const blocking = [
    results.SECURITY_REPORTING_CANONICAL_CONFIG,
    results.SECURITY_CONTACT_CROSS_SURFACE_CONVERGENCE,
  ];
  if (
    blocking.some((v) => v !== 'PASS') ||
    results.STALE_SECURITY_CONTACTS !== 'PASS' ||
    results.INVENTED_SECURITY_CONTACTS !== 'PASS'
  ) {
    process.exitCode = 1;
  }
}

main();
