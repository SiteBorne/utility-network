import { describe, expect, it } from 'vitest';
import { evaluateNeverminedLiveGuard } from './index';

describe('future Nevermined live guard', () => {
  it('admits only explicit flag plus matching sandbox config and key classification', () => {
    expect(
      evaluateNeverminedLiveGuard({
        runLiveNevermined: '1',
        environment: 'sandbox',
        apiKeyEnvironment: 'sandbox',
      })
    ).toEqual({ allowed: true });
  });

  it.each([
    [
      { runLiveNevermined: undefined, environment: 'sandbox', apiKeyEnvironment: 'sandbox' },
      'flag_disabled',
    ],
    [
      { runLiveNevermined: '0', environment: 'sandbox', apiKeyEnvironment: 'sandbox' },
      'flag_disabled',
    ],
    [
      { runLiveNevermined: '1', environment: 'live', apiKeyEnvironment: 'live' },
      'live_environment_disabled',
    ],
    [
      { runLiveNevermined: '1', environment: 'sandbox', apiKeyEnvironment: 'live' },
      'key_environment_mismatch',
    ],
    [
      { runLiveNevermined: '1', environment: 'sandbox', apiKeyEnvironment: 'unknown' },
      'key_environment_mismatch',
    ],
  ] as const)('rejects unsafe live activation without secret detail', (input, code) => {
    expect(evaluateNeverminedLiveGuard(input)).toEqual({ allowed: false, code });
  });
});
