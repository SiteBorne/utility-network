import {
  ALL_BAZAAR_SERVICE_IDS,
  SITEBORNE_SUPPORTED_X402_SCHEMES,
  SUPPORTED_X402_VERSION,
} from '@siteborne/protocol-x402';
import { describe, expect, it } from 'vitest';
import { deriveCurrentProtocolAuthorityInputs } from './current-authority-inputs';
import { makeFixtureModel, makeFixtureService } from './test-fixtures';

const SOURCE_COMMIT = 'a'.repeat(40);

describe('deriveCurrentProtocolAuthorityInputs', () => {
  it('derives current x402 protocol capability from the typed x402 authority', () => {
    const inputs = deriveCurrentProtocolAuthorityInputs(
      makeCompleteServiceSet().services,
      SOURCE_COMMIT
    );

    expect(inputs.x402ProtocolCapability.protocolVersion).toBe(SUPPORTED_X402_VERSION);
    expect(inputs.x402ProtocolCapability.supportedSchemes).toEqual({
      exact: SITEBORNE_SUPPORTED_X402_SCHEMES.exact,
      upto: SITEBORNE_SUPPORTED_X402_SCHEMES.upto,
    });
    expect(inputs.x402ProtocolCapability.provenance).toMatchObject({
      sourcePackage: '@siteborne/protocol-x402',
      sourceRegistrationId: 'SUPPORTED_X402_VERSION+SITEBORNE_SUPPORTED_X402_SCHEMES',
      runtimeSourceCommit: SOURCE_COMMIT,
      derivationMethod: 'typed_export',
    });
  });

  it('records local Bazaar projection support without claiming external publication', () => {
    const inputs = deriveCurrentProtocolAuthorityInputs(
      makeCompleteServiceSet().services,
      SOURCE_COMMIT
    );

    expect(inputs.bazaarProjectionSupport.projectionSupported).toBe(true);
    expect(inputs.bazaarProjectionSupport.serviceIds).toEqual(ALL_BAZAAR_SERVICE_IDS);
    expect(inputs.bazaarProjectionSupport).not.toHaveProperty('externalPublication');
  });

  it('rejects a typed Bazaar projection id absent from the canonical service set', () => {
    expect(() =>
      deriveCurrentProtocolAuthorityInputs(makeFixtureModel().services, SOURCE_COMMIT)
    ).toThrowError(expect.objectContaining({ code: 'UNKNOWN_BAZAAR_SERVICE' }));
  });
});

function makeCompleteServiceSet() {
  return makeFixtureModel(
    ALL_BAZAAR_SERVICE_IDS.map((serviceId) => {
      const [family, generation] = serviceId.split('.');
      return makeFixtureService({
        id: { family: family as never, generation: generation as never },
      });
    })
  );
}
