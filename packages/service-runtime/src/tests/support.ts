/**
 * Shared test support for service-runtime suites. Builds real fake
 * dependencies (deterministic clock, counting HTTP client, in-memory
 * artifact/service audit sinks) injected through public constructor/
 * execute() surfaces — no test in this package performs a real network
 * call or spawns a subprocess by default.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createTestClock,
  createTestServiceAuditSink,
  createTestArtifactStore,
  buildServiceContext,
} from '../context';
import { createFixtureSigner } from '../pcc/test-signer';
import type { ServiceExecutionContext, ServiceId } from '../types';
import type { InjectedHttpClient } from '@siteborne/provider-adapters';

const PROVIDER_ADAPTERS_FIXTURES_DIR = fileURLToPath(
  new URL('../../../provider-adapters/fixtures', import.meta.url)
);

export function loadAdapterFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(`${PROVIDER_ADAPTERS_FIXTURES_DIR}/${relativePath}`, 'utf-8'));
}

export interface CountingHttpClient extends InjectedHttpClient {
  readonly callCount: number;
}

export function jsonHttpClient(body: unknown, init: { status?: number } = {}): CountingHttpClient {
  let calls = 0;
  return {
    async fetch() {
      calls++;
      return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    get callCount() {
      return calls;
    },
  };
}

export function textHttpClient(
  body: string,
  mediaType = 'text/html',
  init: { status?: number } = {}
): CountingHttpClient {
  let calls = 0;
  return {
    async fetch() {
      calls++;
      return new Response(body, {
        status: init.status ?? 200,
        headers: { 'content-type': mediaType },
      });
    },
    get callCount() {
      return calls;
    },
  };
}

export async function buildTestServiceContext(
  serviceId: ServiceId,
  overrides: Partial<ServiceExecutionContext> = {}
): Promise<ServiceExecutionContext> {
  return buildServiceContext(serviceId, {
    clock: createTestClock(),
    artifact_store: createTestArtifactStore(),
    audit: createTestServiceAuditSink(),
    execution_mode: 'fixture',
    ...overrides,
  });
}

export { createFixtureSigner };
