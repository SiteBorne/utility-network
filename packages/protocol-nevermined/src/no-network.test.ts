import { describe, expect, it, vi } from 'vitest';
import { NEVERMINED_DECLARATIONS, resolveNeverminedConfig } from './index';

describe('credential-independent no-network proof', () => {
  it('builds config and declarations while ambient fetch is guarded', () => {
    const original = globalThis.fetch;
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network forbidden')));
    globalThis.fetch = fetchSpy as typeof fetch;
    try {
      expect(
        resolveNeverminedConfig({ NVM_API_KEY: 'fixture', NVM_ENVIRONMENT: 'sandbox' }).ok
      ).toBe(true);
      expect(Object.keys(NEVERMINED_DECLARATIONS)).toHaveLength(4);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
