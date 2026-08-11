import { describe, expect, it } from 'vitest';
import { resolveNeverminedConfig } from './index';

describe('Nevermined configuration migration boundary', () => {
  it('accepts the canonical NVM_API_KEY without disclosing it', () => {
    const result = resolveNeverminedConfig({
      NVM_API_KEY: 'canonical-secret',
      NVM_ENVIRONMENT: 'sandbox',
    });
    expect(result).toMatchObject({ ok: true, source: 'canonical', environment: 'sandbox' });
    if (!result.ok) throw new Error('expected resolved config');
    expect(result.apiKey).toBe('canonical-secret');
    expect(JSON.stringify(result)).not.toContain('canonical-secret');
  });

  it('maps only NEVERMINED_API_KEY to the canonical field with deprecation classification', () => {
    expect(
      resolveNeverminedConfig({ NEVERMINED_API_KEY: 'legacy-secret', NVM_ENVIRONMENT: 'sandbox' })
    ).toMatchObject({ ok: true, source: 'deprecated_alias', deprecatedAliasUsed: true });
  });

  it('accepts identical canonical and alias values', () => {
    expect(
      resolveNeverminedConfig({
        NVM_API_KEY: 'same',
        NEVERMINED_API_KEY: 'same',
        NVM_ENVIRONMENT: 'sandbox',
      })
    ).toMatchObject({ ok: true, source: 'canonical', deprecatedAliasUsed: true });
  });

  it('fails closed on differing values without revealing either', () => {
    const result = resolveNeverminedConfig({
      NVM_API_KEY: 'first-secret',
      NEVERMINED_API_KEY: 'second-secret',
      NVM_ENVIRONMENT: 'sandbox',
    });
    expect(result).toEqual({ ok: false, code: 'conflicting_api_key_aliases' });
    expect(JSON.stringify(result)).not.toContain('first-secret');
    expect(JSON.stringify(result)).not.toContain('second-secret');
  });

  it.each(['live', 'production', 'testnet', ''])(
    'rejects environment %j at this stage',
    (environment) => {
      expect(
        resolveNeverminedConfig({ NVM_API_KEY: 'secret', NVM_ENVIRONMENT: environment })
      ).toMatchObject({ ok: false });
    }
  );

  it('does not recognize duplicate environment aliases', () => {
    expect(
      resolveNeverminedConfig({ NVM_API_KEY: 'secret', NVM_ENV: 'sandbox' } as Record<
        string,
        string
      >)
    ).toEqual({ ok: false, code: 'missing_environment' });
  });
});
