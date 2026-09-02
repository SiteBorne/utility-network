/**
 * SUN-1222C-R3B — RED→GREEN→mutation-proof coverage for the
 * `document_evidence_json.v2` Base-mainnet `upto` client's pure guards.
 * No network access, no wallet, no live SDK call anywhere in this file —
 * see `document-mainnet-upto-client.ts`'s own doc comment for why that
 * split exists.
 */
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_MAINNET_NETWORK,
  DOCUMENT_MAINNET_SELLER_ADDRESS,
  DOCUMENT_MAINNET_USDC_ASSET,
  DOCUMENT_MAX_AUTHORIZED_ATOMIC,
  DOCUMENT_PAYMENT_SCHEME,
  DOCUMENT_SERVICE_ID,
  DocumentPaymentStateMachine,
  InvalidDocumentPaymentTransitionError,
  assertMainnetLock,
  assertSettledAmountWithinAuthorizedMax,
  decidePermit2Approval,
  validateDocumentMainnetRequirements,
  type CandidateDocumentPaymentRequirements,
} from './document-mainnet-upto-client';

function validRequirements(
  overrides: Partial<CandidateDocumentPaymentRequirements> = {}
): CandidateDocumentPaymentRequirements {
  return {
    scheme: DOCUMENT_PAYMENT_SCHEME,
    network: DOCUMENT_MAINNET_NETWORK,
    asset: DOCUMENT_MAINNET_USDC_ASSET,
    payTo: DOCUMENT_MAINNET_SELLER_ADDRESS,
    amount: DOCUMENT_MAX_AUTHORIZED_ATOMIC,
    extra: { pricing_key: 'document_evidence_json_max_job' },
    ...overrides,
  };
}

describe('validateDocumentMainnetRequirements', () => {
  it('accepts the exact expected requirements', () => {
    const result = validateDocumentMainnetRequirements(validRequirements(), {
      serviceId: DOCUMENT_SERVICE_ID,
    });
    expect(result).toEqual({ valid: true, reasons: [] });
  });

  it('accepts a below-ceiling amount (the actual expected qualification charge)', () => {
    const result = validateDocumentMainnetRequirements(validRequirements({ amount: '12000' }));
    expect(result.valid).toBe(true);
  });

  it('rejects the wrong service id', () => {
    const result = validateDocumentMainnetRequirements(validRequirements(), {
      serviceId: 'company_evidence_graph.v2',
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('wrong_service');
  });

  it('rejects the exact scheme (substitution from a different SITEBORNE service)', () => {
    const result = validateDocumentMainnetRequirements(validRequirements({ scheme: 'exact' }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('wrong_scheme');
  });

  it('rejects Base Sepolia (the testnet network used by SUN-0700B)', () => {
    const result = validateDocumentMainnetRequirements(
      validRequirements({ network: 'eip155:84532' })
    );
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('wrong_network');
  });

  it('rejects an alternate asset address', () => {
    const result = validateDocumentMainnetRequirements(
      validRequirements({ asset: '0x0000000000000000000000000000000000dEaD' })
    );
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('wrong_asset');
  });

  it('accepts a case-different but byte-equal asset address', () => {
    const result = validateDocumentMainnetRequirements(
      validRequirements({ asset: DOCUMENT_MAINNET_USDC_ASSET.toLowerCase() })
    );
    expect(result.valid).toBe(true);
  });

  it('rejects an alternate payTo address', () => {
    const result = validateDocumentMainnetRequirements(
      validRequirements({ payTo: '0x0000000000000000000000000000000000dEaD' })
    );
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('wrong_payTo');
  });

  it('rejects a different pricing key when declared in extra', () => {
    const result = validateDocumentMainnetRequirements(
      validRequirements({ extra: { pricing_key: 'company_evidence_graph_max_job' } })
    );
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('wrong_pricing_key');
  });

  it('rejects an amount above the authorized ceiling', () => {
    const result = validateDocumentMainnetRequirements(validRequirements({ amount: '190001' }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('amount_exceeds_expected_ceiling');
  });

  it('rejects a non-canonical atomic amount (leading zero)', () => {
    const result = validateDocumentMainnetRequirements(validRequirements({ amount: '012000' }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('amount_not_canonical_atomic');
  });

  it('rejects a decimal amount string', () => {
    const result = validateDocumentMainnetRequirements(validRequirements({ amount: '12000.0' }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('amount_not_canonical_atomic');
  });

  it('reports every violated field at once, not just the first', () => {
    const result = validateDocumentMainnetRequirements(
      validRequirements({ scheme: 'exact', network: 'eip155:84532', amount: '999999999' })
    );
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining(['wrong_scheme', 'wrong_network', 'amount_exceeds_expected_ceiling'])
    );
  });
});

describe('assertMainnetLock', () => {
  it('passes silently for the locked mainnet identifier', () => {
    expect(() => assertMainnetLock(DOCUMENT_MAINNET_NETWORK)).not.toThrow();
  });

  it('throws for Base Sepolia — no automatic fallback', () => {
    expect(() => assertMainnetLock('eip155:84532')).toThrow(/mainnet lock failed/);
  });

  it('throws for an unrelated chain identifier', () => {
    expect(() => assertMainnetLock('eip155:1')).toThrow(/mainnet lock failed/);
  });
});

describe('assertSettledAmountWithinAuthorizedMax', () => {
  it('allows an amount strictly below the ceiling', () => {
    expect(() => assertSettledAmountWithinAuthorizedMax('12000', '190000')).not.toThrow();
  });

  it('allows an amount exactly equal to the ceiling', () => {
    expect(() => assertSettledAmountWithinAuthorizedMax('190000', '190000')).not.toThrow();
  });

  it('throws when the settled amount exceeds the ceiling by one atomic unit', () => {
    expect(() => assertSettledAmountWithinAuthorizedMax('190001', '190000')).toThrow(
      /exceeds authorized maximum/
    );
  });

  it('throws on a non-canonical amount rather than silently coercing it', () => {
    expect(() => assertSettledAmountWithinAuthorizedMax('1.5e5', '190000')).toThrow();
  });
});

describe('decidePermit2Approval', () => {
  it('requires approval when allowance is zero', () => {
    expect(decidePermit2Approval(0n, 190000n)).toEqual({ approvalRequired: true });
  });

  it('requires approval when allowance is below the ceiling', () => {
    expect(decidePermit2Approval(50000n, 190000n)).toEqual({ approvalRequired: true });
  });

  it('does not require approval when allowance exactly equals the ceiling', () => {
    expect(decidePermit2Approval(190000n, 190000n)).toEqual({ approvalRequired: false });
  });

  it('does not require approval when allowance already exceeds the ceiling', () => {
    expect(decidePermit2Approval(1_000_000n, 190000n)).toEqual({ approvalRequired: false });
  });
});

describe('DocumentPaymentStateMachine — exactly-once discipline', () => {
  function driveToSigned(): DocumentPaymentStateMachine {
    const m = new DocumentPaymentStateMachine();
    m.transition('UNPAID_REQUEST_SENT');
    m.transition('PAYMENT_REQUIREMENTS_VALIDATED');
    m.transition('ALLOWANCE_STATUS_READ');
    m.transition('APPROVAL_SUFFICIENT');
    m.transition('PAYMENT_PREPARED');
    m.transition('SIGNED');
    return m;
  }

  it('walks the full happy path exactly once', () => {
    const m = driveToSigned();
    m.transition('PAID_POST_SUBMITTED');
    m.transition('RECONCILING');
    m.transition('COMPLETE');
    expect(m.state).toBe('COMPLETE');
    expect(m.history).toEqual([
      'START',
      'UNPAID_REQUEST_SENT',
      'PAYMENT_REQUIREMENTS_VALIDATED',
      'ALLOWANCE_STATUS_READ',
      'APPROVAL_SUFFICIENT',
      'PAYMENT_PREPARED',
      'SIGNED',
      'PAID_POST_SUBMITTED',
      'RECONCILING',
      'COMPLETE',
    ]);
  });

  it('walks the approval-required branch exactly once', () => {
    const m = new DocumentPaymentStateMachine();
    m.transition('UNPAID_REQUEST_SENT');
    m.transition('PAYMENT_REQUIREMENTS_VALIDATED');
    m.transition('ALLOWANCE_STATUS_READ');
    m.transition('APPROVAL_REQUIRED');
    m.transition('APPROVAL_SUFFICIENT');
    m.transition('PAYMENT_PREPARED');
    expect(m.state).toBe('PAYMENT_PREPARED');
  });

  it('rejects a second 402 request (UNPAID_REQUEST_SENT -> UNPAID_REQUEST_SENT)', () => {
    const m = new DocumentPaymentStateMachine();
    m.transition('UNPAID_REQUEST_SENT');
    expect(() => m.transition('UNPAID_REQUEST_SENT')).toThrow(
      InvalidDocumentPaymentTransitionError
    );
  });

  it('rejects a second signing action', () => {
    const m = driveToSigned();
    expect(() => m.transition('SIGNED')).toThrow(InvalidDocumentPaymentTransitionError);
  });

  it('rejects a second paid POST after the first has been submitted', () => {
    const m = driveToSigned();
    m.transition('PAID_POST_SUBMITTED');
    expect(() => m.transition('PAID_POST_SUBMITTED')).toThrow(
      InvalidDocumentPaymentTransitionError
    );
  });

  it('rejects skipping straight from START to SIGNED (no blind shortcut)', () => {
    const m = new DocumentPaymentStateMachine();
    expect(() => m.transition('SIGNED')).toThrow(InvalidDocumentPaymentTransitionError);
  });

  it('rejects re-submitting after entering RECONCILING (ambiguous outcome, no retry)', () => {
    const m = driveToSigned();
    m.transition('PAID_POST_SUBMITTED');
    m.transition('RECONCILING');
    expect(() => m.transition('PAID_POST_SUBMITTED')).toThrow(
      InvalidDocumentPaymentTransitionError
    );
    expect(() => m.transition('SIGNED')).toThrow(InvalidDocumentPaymentTransitionError);
  });

  it('allows FAILED_SAFE from any non-terminal state, including mid-flow', () => {
    const m = new DocumentPaymentStateMachine();
    m.transition('UNPAID_REQUEST_SENT');
    expect(() => m.transition('FAILED_SAFE')).not.toThrow();
    expect(m.state).toBe('FAILED_SAFE');
  });

  it('never allows a transition out of a terminal state', () => {
    const m = driveToSigned();
    m.transition('PAID_POST_SUBMITTED');
    m.transition('RECONCILING');
    m.transition('COMPLETE');
    expect(() => m.transition('FAILED_SAFE')).toThrow(InvalidDocumentPaymentTransitionError);
    const failed = new DocumentPaymentStateMachine();
    failed.transition('FAILED_SAFE');
    expect(() => failed.transition('UNPAID_REQUEST_SENT')).toThrow(
      InvalidDocumentPaymentTransitionError
    );
  });
});
