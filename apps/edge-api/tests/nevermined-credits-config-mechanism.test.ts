/**
 * SUN-0900B checkpoint 2C — dedicated dynamic-credits mechanism audit.
 *
 * Credential-free, zero network, zero `RUN_LIVE_*`. Exercises the
 * installed `@nevermined-io/payments@1.10.0` SDK's own pure,
 * side-effect-free `PlanCreditsConfig` builder methods directly —
 * `payments.plans.getFixedCreditsConfig`,
 * `payments.plans.getPayAsYouGoCreditsConfig`,
 * `payments.plans.getDynamicCreditsConfig` — to lock in their exact
 * serialized shapes as a regression guard (a future SDK upgrade that
 * silently changes these defaults would break this file, not surface
 * as a live-only surprise) and to document, precisely, the structural
 * relationship this checkpoint discovered between the PAYG helper
 * (already experimentally disproven for `actual < price` monetary
 * settlement — see
 * docs/reports/SUN-0900B-checkpoint-2b-unit-economics-report.md) and
 * the dedicated dynamic-credits helper (not yet live-tested).
 *
 * `Payments.getInstance({ nvmApiKey })` only checks the key is a
 * non-empty string — no format validation, no network call at
 * construction — so a dummy local placeholder is used here. These
 * particular `plans.*` config-builder methods are synchronous, pure
 * serialization with no `fetch` inside (confirmed by reading
 * `dist/plans.js`); only the actual `registerPlan`/`registerCreditsPlan`
 * calls this file never makes would touch the network.
 */
import { describe, expect, it } from 'vitest';
import { Payments, PlanRedemptionType } from '@nevermined-io/payments';

/** A syntactically valid but entirely fake, unsigned JWT — the SDK's
 * constructor only locally decodes the JWT structure (`jose`'s
 * `decodeJwt`, which never verifies a signature) to read the `sub`
 * claim; it never makes a network call to validate the key. No real
 * credential material is used or needed for the pure, local,
 * side-effect-free config-builder methods this file exercises. */
function fakeUnsignedJwt(): string {
  const base64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = base64url({ alg: 'none', typ: 'JWT' });
  const payload = base64url({ sub: '0x0000000000000000000000000000000000000000' });
  return `${header}.${payload}.`;
}

const payments = Payments.getInstance({ nvmApiKey: fakeUnsignedJwt() });

describe('SUN-0900B checkpoint 2C — installed SDK credits-config helper shapes', () => {
  it('getFixedCreditsConfig(creditsGranted, creditsPerRequest=1n) serializes as isRedemptionAmountFixed=true, amount=creditsGranted, min=max=creditsPerRequest', () => {
    expect(payments.plans.getFixedCreditsConfig(100n)).toEqual({
      isRedemptionAmountFixed: true,
      redemptionType: PlanRedemptionType.ONLY_SUBSCRIBER,
      onchainMirror: false,
      durationSecs: 0n,
      amount: 100n,
      minAmount: 1n,
      maxAmount: 1n,
    });
    expect(payments.plans.getFixedCreditsConfig(100n, 5n)).toMatchObject({
      amount: 100n,
      minAmount: 5n,
      maxAmount: 5n,
    });
  });

  it('getPayAsYouGoCreditsConfig() takes no arguments and always serializes to the same fixed 1/1/1 shape', () => {
    expect(payments.plans.getPayAsYouGoCreditsConfig()).toEqual({
      isRedemptionAmountFixed: false,
      redemptionType: PlanRedemptionType.ONLY_SUBSCRIBER,
      onchainMirror: false,
      durationSecs: 0n,
      amount: 1n,
      minAmount: 1n,
      maxAmount: 1n,
    });
  });

  it('getDynamicCreditsConfig has the installed 3-parameter signature (creditsGranted, minCreditsPerRequest=1n, maxCreditsPerRequest=1n) — NOT the 2-parameter (min, max) shape shown by current public docs; the installed implementation is authoritative', () => {
    expect(payments.plans.getDynamicCreditsConfig(190n, 12n, 190n)).toEqual({
      isRedemptionAmountFixed: false,
      redemptionType: PlanRedemptionType.ONLY_SUBSCRIBER,
      onchainMirror: false,
      durationSecs: 0n,
      amount: 190n,
      minAmount: 12n,
      maxAmount: 190n,
    });
  });

  it('getPayAsYouGoCreditsConfig() is byte-identical to getDynamicCreditsConfig(1n, 1n, 1n) — PAYG is structurally a degenerate, single-credit case of the dynamic helper, not a distinct mechanism', () => {
    expect(payments.plans.getPayAsYouGoCreditsConfig()).toEqual(
      payments.plans.getDynamicCreditsConfig(1n, 1n, 1n)
    );
  });

  it('a real dynamic document plan would set creditsGranted/min/max to distinct values, unlike the already-disproven PAYG shape', () => {
    const proposedDocumentDynamicCreditsConfig = payments.plans.getDynamicCreditsConfig(
      190_000n,
      1n,
      190_000n
    );
    expect(proposedDocumentDynamicCreditsConfig.amount).not.toBe(
      proposedDocumentDynamicCreditsConfig.minAmount
    );
    expect(proposedDocumentDynamicCreditsConfig).not.toEqual(
      payments.plans.getPayAsYouGoCreditsConfig()
    );
  });

  it('documents the client-side registerCreditsPlan guard (real installed behavior, not SITEBORNE code): registerCreditsPlan throws synchronously, before any network call, when minAmount exceeds maxAmount', async () => {
    const invalidCreditsConfig = {
      ...payments.plans.getDynamicCreditsConfig(190_000n, 1n, 190_000n),
      minAmount: 200_000n,
    };
    await expect(
      payments.plans.registerCreditsPlan(
        { name: 'checkpoint-2c-should-never-actually-register' },
        payments.plans.getFreePriceConfig(),
        invalidCreditsConfig
      )
    ).rejects.toThrow(/minAmount can not be more than.*maxAmount/i);
  });

  it('registerCreditsPlan requires durationSecs=0 (non-expirable) for credits plans — also a synchronous, pre-network guard', async () => {
    const invalidCreditsConfig = {
      ...payments.plans.getDynamicCreditsConfig(190_000n, 1n, 190_000n),
      durationSecs: 3600n,
    };
    await expect(
      payments.plans.registerCreditsPlan(
        { name: 'checkpoint-2c-should-never-actually-register' },
        payments.plans.getFreePriceConfig(),
        invalidCreditsConfig
      )
    ).rejects.toThrow(/durationSecs must be 0/i);
  });
});
