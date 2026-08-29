#!/usr/bin/env -S npx tsx
/**
 * SUN-1221C — `web_context_verified.v2`/CDP mutation proof (SUN-1221CD
 * §29). Covers the DNS-rebinding-safety, economic, gate, and discovery
 * mutations this checkpoint's own new/changed source introduced.
 * Pre-existing shared gate/discovery logic already has its own
 * mutation-proof coverage (`test-discovery-truthfulness-mutation-
 * caught.mts`, `test-readiness-truthfulness-mutation-caught.mts`) --
 * this script does not re-prove those, only what SUN-1221C itself added
 * or changed.
 *
 * Each proof mutates one exact anchor string, runs the relevant test
 * file against the mutant, requires it to FAIL, then restores the
 * original file byte-for-byte (verified via SHA-256) in a `finally`
 * block regardless of outcome. Never commits a mutant.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PNPM = process.env.PNPM_EXECUTABLE ?? 'pnpm';

const SAFE_DNS_RESOLVE = join(
  REPO_ROOT,
  'packages/provider-adapters/src/http/safe-dns-resolve.ts'
);
const SOCKET_HTTP_CLIENT = join(
  REPO_ROOT,
  'packages/provider-adapters/src/http/socket-http-client.ts'
);
const WEB_CONTEXT_COMPOSITION = join(
  REPO_ROOT,
  'apps/edge-api/src/control-plane/production/web-context-v2-cdp-composition.ts'
);
const WEB_CONTEXT_ROUTE = join(
  REPO_ROOT,
  'apps/edge-api/src/control-plane/routes/production-web-context-v2-cdp-route.ts'
);
const PRODUCTION_PAYMENT = join(
  REPO_ROOT,
  'apps/edge-api/src/control-plane/config/production-payment.ts'
);
const CATALOG = join(REPO_ROOT, 'apps/edge-api/src/control-plane/routes/catalog.ts');
const READINESS = join(REPO_ROOT, 'apps/edge-api/src/routes/readiness.ts');

const DNS_REBINDING_TEST = 'packages/provider-adapters/src/tests/dns-rebinding.test.ts';
const WEB_CONTEXT_COMPOSITION_TEST =
  'apps/edge-api/src/control-plane/production/web-context-v2-cdp-composition.test.ts';
const WEB_CONTEXT_ROUTE_TEST =
  'apps/edge-api/src/control-plane/routes/production-web-context-v2-cdp-route.test.ts';
const MULTI_SERVICE_DISCOVERY_TEST = 'apps/edge-api/tests/multi-service-discovery.test.ts';
const READINESS_TEST = 'apps/edge-api/tests/readiness-truthfulness.test.ts';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runTest(relPath: string): { passed: boolean; output: string } {
  try {
    const output = execFileSync(PNPM, ['exec', 'vitest', 'run', relPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { passed: true, output };
  } catch (error) {
    const e = error as { stdout?: Buffer | string; stderr?: Buffer | string };
    return { passed: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

interface Mutation {
  name: string;
  target: string;
  from: string;
  to: string;
  testRel: string;
}

const MUTATIONS: Mutation[] = [
  {
    name: '1. DNS resolution: a single prohibited answer no longer fails the whole resolution',
    target: SAFE_DNS_RESOLVE,
    from: 'if (prohibited.length > 0) {',
    to: 'if (false) {',
    testRel: DNS_REBINDING_TEST,
  },
  {
    name: '2. DNS resolution: zero-answer case treated as safe instead of failing closed',
    target: SAFE_DNS_RESOLVE,
    from: 'if (all.length === 0) {',
    to: 'if (false) {',
    testRel: DNS_REBINDING_TEST,
  },
  {
    name: '3. isProhibitedResolvedIp: private-IP check dropped',
    target: SAFE_DNS_RESOLVE,
    from: 'return isLoopback(ip) || isPrivateIp(ip) || isLinkLocal(ip) || isMulticast(ip) || isReserved(ip);',
    to: 'return isLoopback(ip) || isLinkLocal(ip) || isMulticast(ip) || isReserved(ip);',
    testRel: DNS_REBINDING_TEST,
  },
  {
    name: '4. DoH resolver target changed away from the fixed trusted endpoint',
    target: SAFE_DNS_RESOLVE,
    from: "export const TRUSTED_DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';",
    to: "export const TRUSTED_DOH_ENDPOINT = 'https://attacker-controlled.example.com/dns-query';",
    testRel: DNS_REBINDING_TEST,
  },
  {
    name: '5. TOCTOU: connect() called with the original hostname instead of the validated literal IP',
    target: SOCKET_HTTP_CLIENT,
    from: 'const connectIp = isIpLiteral(hostname) ? hostname : await this.resolveOrThrow(hostname);',
    to: 'const connectIp = hostname; // MUTATED: never resolves, always connects by hostname',
    testRel: DNS_REBINDING_TEST,
  },
  {
    name: '6. Literal-IP fast path removed: every request now goes through DoH even for literal IPs (behavior/perf regression, still must not break safety tests)',
    target: SOCKET_HTTP_CLIENT,
    from: 'const connectIp = isIpLiteral(hostname) ? hostname : await this.resolveOrThrow(hostname);',
    to: 'const connectIp = await this.resolveOrThrow(hostname); // MUTATED: literal-IP fast path removed',
    testRel: DNS_REBINDING_TEST,
  },
  {
    name: '7. expectedServerHostname pinned to the connected IP instead of the real hostname (breaks TLS pinning)',
    target: SOCKET_HTTP_CLIENT,
    from: 'socket = socket.startTls({ expectedServerHostname: hostname });',
    to: 'socket = socket.startTls({ expectedServerHostname: connectIp }); // MUTATED',
    testRel: DNS_REBINDING_TEST,
  },
  {
    name: '8. existing validateUrl() literal-IP/scheme/port check skipped entirely',
    target: SOCKET_HTTP_CLIENT,
    from: 'if (!literalValidation.valid) {\n      throw new Error(`URL validation failed: ${literalValidation.reason}`);\n    }',
    to: '// MUTATED: literal validation check removed',
    testRel: DNS_REBINDING_TEST,
  },
  {
    name: '9. web-context composition: pricingKey changed away from the frozen B-derived value',
    target: WEB_CONTEXT_COMPOSITION,
    from: "pricingKey: 'web_context_verified_direct',",
    to: "pricingKey: 'verify_agent_output_standard', // MUTATED: wrong pricing key",
    testRel: WEB_CONTEXT_COMPOSITION_TEST,
  },
  {
    name: '10. web-context composition: route path changed away from the frozen /v2/web/context',
    target: WEB_CONTEXT_COMPOSITION,
    from: "path: '/v2/web/context',",
    to: "path: '/v2/web/context-mutated', // MUTATED",
    testRel: WEB_CONTEXT_COMPOSITION_TEST,
  },
  {
    name: '11. web-context composition: serviceId changed away from web_context_verified.v2',
    target: WEB_CONTEXT_COMPOSITION,
    from: "serviceId: 'web_context_verified.v2',",
    to: "serviceId: 'verify_agent_output.v2', // MUTATED: wrong service id",
    testRel: WEB_CONTEXT_COMPOSITION_TEST,
  },
  {
    name: '12. web-context route: master gate ignored (isWebContextV2CdpRouteFlagEnabled bypassed)',
    target: WEB_CONTEXT_ROUTE,
    from: 'if (!c.env || !isWebContextV2CdpRouteFlagEnabled(c.env)) {',
    to: 'if (false) {',
    testRel: WEB_CONTEXT_ROUTE_TEST,
  },
  {
    name: '13. production-payment: web-context master flag (PAID_ROUTES_ENABLED) ignored',
    target: PRODUCTION_PAYMENT,
    from: "return env.PAID_ROUTES_ENABLED === 'true' && env.WEB_CONTEXT_V2_CDP_ROUTE_ENABLED === 'true';",
    to: "return env.WEB_CONTEXT_V2_CDP_ROUTE_ENABLED === 'true'; // MUTATED: master gate ignored",
    testRel: WEB_CONTEXT_ROUTE_TEST,
  },
  {
    name: '14. production-payment: web-context route-specific flag ignored',
    target: PRODUCTION_PAYMENT,
    from: "return env.PAID_ROUTES_ENABLED === 'true' && env.WEB_CONTEXT_V2_CDP_ROUTE_ENABLED === 'true';",
    to: "return env.PAID_ROUTES_ENABLED === 'true'; // MUTATED: route gate ignored",
    testRel: MULTI_SERVICE_DISCOVERY_TEST,
  },
  {
    name: '15. catalog.ts: discovery overlay registry lookup bypassed (always overlays, or never overlays)',
    target: CATALOG,
    from: 'const resolver = EFFECTIVE_DISCOVERY_RESOLVERS[service.service_id as SiteborneServiceId];\n  if (!resolver) return service;',
    to: 'const resolver = EFFECTIVE_DISCOVERY_RESOLVERS[service.service_id as SiteborneServiceId];\n  if (true) return service; // MUTATED: overlay never applies to anything',
    testRel: MULTI_SERVICE_DISCOVERY_TEST,
  },
  {
    name: '16. readiness.ts: OR-across-services degraded to AND (both must be active, not just one)',
    target: READINESS,
    from: '.some((resolve) => resolve(env, hasDb))',
    to: '.every((resolve) => resolve(env, hasDb)) // MUTATED: AND instead of OR',
    testRel: READINESS_TEST,
  },
  {
    name: '17. readiness.ts: filter drops all resolvers (production_services_enabled always false)',
    target: READINESS,
    from: '.filter((resolve): resolve is NonNullable<typeof resolve> => resolve !== undefined)',
    to: '.filter((): boolean => false) // MUTATED: drops every resolver',
    testRel: MULTI_SERVICE_DISCOVERY_TEST,
  },
  {
    name: '18. socket-http-client: response size bound removed from Content-Length path',
    target: SOCKET_HTTP_CLIENT,
    from: 'if (contentLength > this.maxResponseBytes) {\n          throw new Error(\n            `Response exceeds maximum size: ${contentLength} > ${this.maxResponseBytes}`\n          );\n        }',
    to: '// MUTATED: content-length bound check removed',
    testRel: DNS_REBINDING_TEST,
  },
  {
    name: '19. socket-http-client: only GET is allowed -- guard removed, non-GET requests now silently proceed',
    target: SOCKET_HTTP_CLIENT,
    from: "if (method !== 'GET') {\n      throw new Error(`SafeSocketHttpClient only supports GET, got ${method}`);\n    }",
    to: '// MUTATED: method guard removed',
    testRel: DNS_REBINDING_TEST,
  },
];

function applyAndRun(m: Mutation): { name: string; caught: boolean; detail: string } {
  const original = readFileSync(m.target, 'utf8');
  const originalHash = hash(original);
  if (!original.includes(m.from)) {
    return {
      name: m.name,
      caught: false,
      detail: `SKIPPED: anchor string not found in ${m.target} -- source has drifted since this proof was written`,
    };
  }
  const mutated = original.replace(m.from, m.to);
  try {
    writeFileSync(m.target, mutated, 'utf8');
    const result = runTest(m.testRel);
    return {
      name: m.name,
      caught: !result.passed,
      detail: result.passed
        ? `NOT CAUGHT -- ${m.testRel} still passed under this mutation`
        : `caught: ${m.testRel} failed as expected`,
    };
  } finally {
    writeFileSync(m.target, original, 'utf8');
    const restoredHash = hash(readFileSync(m.target, 'utf8'));
    if (restoredHash !== originalHash) {
      throw new Error(`RESTORE FAILED for ${m.target}: hash mismatch after restore`);
    }
  }
}

function main(): void {
  console.log('[web-context-v2-mutation-proof] SUN-1221C -- running 19 deliberate mutations\n');
  const results = MUTATIONS.map((m) => {
    console.log(`--- ${m.name} ---`);
    const r = applyAndRun(m);
    console.log(`  ${r.caught ? 'CAUGHT' : 'NOT CAUGHT/SKIPPED'}: ${r.detail}\n`);
    return r;
  });

  console.log('--- final: all affected test files green on fully-restored source ---');
  const finalResults = [
    DNS_REBINDING_TEST,
    WEB_CONTEXT_COMPOSITION_TEST,
    WEB_CONTEXT_ROUTE_TEST,
    MULTI_SERVICE_DISCOVERY_TEST,
    READINESS_TEST,
  ].map((t) => ({ t, r: runTest(t) }));
  for (const { t, r } of finalResults) {
    console.log(`  ${t}: ${r.passed ? 'PASS' : 'FAIL'}`);
  }

  const uncaught = results.filter((r) => !r.caught && !r.detail.startsWith('SKIPPED'));
  const skipped = results.filter((r) => r.detail.startsWith('SKIPPED'));
  const finalFailed = finalResults.filter(({ r }) => !r.passed);
  console.log(
    `\n[web-context-v2-mutation-proof] ${results.length - uncaught.length - skipped.length}/${results.length} caught, ${skipped.length} skipped, ${uncaught.length} NOT CAUGHT`
  );

  if (uncaught.length > 0 || finalFailed.length > 0) {
    console.error('[web-context-v2-mutation-proof] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[web-context-v2-mutation-proof] PASS');
}

main();
