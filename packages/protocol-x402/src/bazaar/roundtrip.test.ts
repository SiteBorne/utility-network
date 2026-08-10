/**
 * Directive §20: a pure local test simulating an unknown buyer program
 * that has never hardcoded SITEBORNE-specific service knowledge —
 * generated Bazaar declaration -> parse -> inspect service -> inspect
 * input schema -> inspect payment requirements -> choose a supported
 * payment option -> construct a structurally valid request. No payment,
 * no network. Parameterized over the registry so every service is
 * exercised without per-service hardcoding in the test itself.
 */
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { extractDiscoveryInfoFromExtension } from '@x402/extensions/bazaar';
import { isPaymentPayload, isPaymentRequirements } from '@x402/core/schemas';
import { buildSiteborneDiscoveryDeclaration, BAZAAR_EXTENSION_KEY } from './discovery';
import { ALL_BAZAAR_SERVICE_IDS } from './registry-source';

const NOW = '2026-08-10T00:00:00.000Z';

describe('machine-discovery round trip (an unknown buyer program, no SITEBORNE-specific hardcoding)', () => {
  for (const serviceId of ALL_BAZAAR_SERVICE_IDS) {
    it(`${serviceId}: a generic client can discover the schema, choose a payment option, and build a structurally valid request from the declaration alone`, async () => {
      // Step 1: the server generates a discovery declaration (this is the
      // one SITEBORNE-side step; everything after this models a buyer
      // program that has never seen protocol-x402's internals).
      const declaration = await buildSiteborneDiscoveryDeclaration({
        serviceId,
        nowIso: NOW,
        expiresInSeconds: 300,
        maxTimeoutSeconds: 120,
      });

      // Step 2: parse the declaration using only the *official*
      // extraction function — a generic buyer client would do exactly
      // this, not reach into SITEBORNE's own types.
      const bazaarExtension = declaration.extensions[BAZAAR_EXTENSION_KEY] as {
        info: unknown;
        schema: unknown;
      };
      const info = extractDiscoveryInfoFromExtension(
        bazaarExtension as Parameters<typeof extractDiscoveryInfoFromExtension>[0]
      ) as {
        input: { type: string; method?: string; bodyType?: string; body: Record<string, unknown> };
        output?: { type: string; example?: unknown };
      };
      expect(info.input.type).toBe('http');
      expect(info.input.bodyType).toBe('json');

      // Step 3: inspect the input schema embedded in the extension's own
      // validation schema (not a separate SITEBORNE-only channel) and
      // confirm the declared example body validates against it.
      const schema = (
        bazaarExtension.schema as { properties: { input: { properties: { body: object } } } }
      ).properties.input.properties.body;
      const ajv = new Ajv2020({ strict: false });
      const validate = ajv.compile(schema);
      expect(validate(info.input.body), JSON.stringify(validate.errors)).toBe(true);

      // Step 4: inspect the payment requirements and choose a supported
      // one — a generic client filters `accepts[]` by scheme/network it
      // understands; here it simply takes the (only) one offered. Prove
      // the chosen requirement is a wire-valid `PaymentRequirements`
      // using @x402/core's *own* schema — a generic buyer relies on the
      // official wire contract, never a SITEBORNE-internal type.
      const chosen = declaration.accepts[0];
      expect(['exact', 'upto']).toContain(chosen.scheme);
      expect(chosen.network).toMatch(/^eip155:/);
      expect(isPaymentRequirements(chosen)).toBe(true);

      // Step 5: construct a structurally valid PaymentPayload by echoing
      // the exact offered requirement back — this is what a real buyer
      // does (it never re-derives SITEBORNE's internal quote binding,
      // which it has no way to know); prove the result is a wire-valid
      // `PaymentPayload` per @x402/core's own schema. No payment is made
      // and no facilitator is called anywhere in this test.
      const payload = {
        x402Version: declaration.x402Version,
        resource: { url: declaration.resourceUrl },
        accepted: chosen,
        payload: { synthetic_signature: `synthetic:${serviceId}` },
      };
      expect(isPaymentPayload(payload)).toBe(true);
    });
  }
});
