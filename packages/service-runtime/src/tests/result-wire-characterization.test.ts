/**
 * Characterization of the CURRENT successful result surface for all four v2
 * services, frozen BEFORE the internal finalized-result artifact was added
 * (goldens generated at commit 327278c4). Proves the released wire body —
 * the flat VerificationReceipt — and every other externally observable field
 * of the service result are byte-identical after the internal refactor. The
 * internal `finalized` artifact is deliberately excluded: it is not wire.
 *
 * Regenerate only at a governed wire cutover: UPDATE_WIRE_GOLDEN=1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FIXED_TIME, FOUR_V2_SERVICES, runScenario } from './four-service-scenarios';
import type { ServiceId } from '../types';

const GOLDEN_DIR = fileURLToPath(
  new URL('../../fixtures/result-wire-characterization/', import.meta.url)
);

const realVersion = process.version;
const realPlatform = process.platform;
beforeAll(() => {
  // Fixture HTTP clients stamp extraction times from the wall clock.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_TIME);
  // provenance.execution_environment is part of the signed draft.
  Object.defineProperty(process, 'version', {
    value: 'v0.0.0-characterization',
    configurable: true,
  });
  Object.defineProperty(process, 'platform', { value: 'characterization', configurable: true });
});
afterAll(() => {
  vi.useRealTimers();
  Object.defineProperty(process, 'version', { value: realVersion, configurable: true });
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
});

async function run(serviceId: ServiceId) {
  const { result } = await runScenario(serviceId);
  const { finalized: _finalized, ...wireSurface } = result;
  void _finalized;
  return JSON.parse(JSON.stringify(wireSurface));
}

const SERVICES: ServiceId[] = FOUR_V2_SERVICES;

describe('current successful result surface is unchanged by the internal finalized artifact', () => {
  it.each(SERVICES)(
    '%s: result (incl. flat receipt wire body) equals the pre-change golden',
    async (serviceId) => {
      const actual = await run(serviceId);
      const goldenPath = `${GOLDEN_DIR}${serviceId}.json`;
      if (process.env.UPDATE_WIRE_GOLDEN === '1') {
        writeFileSync(goldenPath, JSON.stringify(actual, null, 2) + '\n');
      }
      const golden = JSON.parse(readFileSync(goldenPath, 'utf-8'));
      expect(actual.result_class).toBe('success');
      expect(actual).toEqual(golden);
    }
  );
});
