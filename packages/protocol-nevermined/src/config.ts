export type NeverminedEnvironment = 'sandbox' | 'live';

export type NeverminedConfigResult =
  | {
      ok: true;
      source: 'canonical' | 'deprecated_alias';
      deprecatedAliasUsed: boolean;
      environment: 'sandbox';
      /** Non-enumerable at runtime so ordinary JSON/error serialization cannot
       * accidentally disclose it. Deeper code still receives one canonical key. */
      readonly apiKey: string;
    }
  | {
      ok: false;
      code:
        | 'missing_api_key'
        | 'conflicting_api_key_aliases'
        | 'missing_environment'
        | 'invalid_environment'
        | 'live_environment_disabled';
    };

function resolved(
  apiKey: string,
  source: 'canonical' | 'deprecated_alias',
  deprecatedAliasUsed: boolean
): NeverminedConfigResult {
  const result = {
    ok: true as const,
    source,
    deprecatedAliasUsed,
    environment: 'sandbox' as const,
  } as NeverminedConfigResult;
  Object.defineProperty(result, 'apiKey', {
    value: apiKey,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return result;
}

/** Pure configuration boundary. It never reads process.env itself and never
 * returns secret values in an error. */
export function resolveNeverminedConfig(
  input: Readonly<Record<string, string | undefined>>
): NeverminedConfigResult {
  const canonical = input.NVM_API_KEY;
  const alias = input.NEVERMINED_API_KEY;
  if (!canonical && !alias) return { ok: false, code: 'missing_api_key' };
  if (canonical && alias && canonical !== alias) {
    return { ok: false, code: 'conflicting_api_key_aliases' };
  }
  const environment = input.NVM_ENVIRONMENT;
  if (environment === undefined || environment.length === 0) {
    return { ok: false, code: 'missing_environment' };
  }
  if (environment === 'live') return { ok: false, code: 'live_environment_disabled' };
  if (environment !== 'sandbox') return { ok: false, code: 'invalid_environment' };
  return resolved(
    canonical ?? alias!,
    canonical ? 'canonical' : 'deprecated_alias',
    Boolean(alias)
  );
}
