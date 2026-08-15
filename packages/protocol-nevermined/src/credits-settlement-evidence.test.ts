import { describe, expect, it } from 'vitest';
import {
  buildNeverminedCreditsSettlementEvidence,
  validateNeverminedCreditsSettlementEvidence,
  type NeverminedCreditsSettlementEvidenceInput,
} from './credits-settlement-evidence';

const PAYMENT_IDENTIFIER = 'pay_' + '1'.repeat(28);
const PLAN_ID = '64977106381472769302826211192910538031161833107493020584806963732279386695975';
const TX = '0x' + 'a'.repeat(64);

function validInput(
  overrides: Partial<NeverminedCreditsSettlementEvidenceInput> = {}
): NeverminedCreditsSettlementEvidenceInput {
  return {
    payment_identifier: PAYMENT_IDENTIFIER,
    plan_id: PLAN_ID,
    starting_balance: '0',
    credits_acquired: '190000',
    credits_redeemed: '12000',
    usage_value_atomic: '12000',
    remaining_balance: '178000',
    cash_movement_atomic: '190000',
    transaction: TX,
    observed_at: '2026-08-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('Nevermined dynamic-credit settlement evidence', () => {
  it('separately binds the zero-balance acquisition cash, credit burn, usage value, and remaining pool', async () => {
    const evidence = await buildNeverminedCreditsSettlementEvidence(validInput());

    expect(evidence).toMatchObject({
      kind: 'nevermined_credits_settlement',
      starting_balance: '0',
      credits_acquired: '190000',
      credits_redeemed: '12000',
      usage_value_atomic: '12000',
      remaining_balance: '178000',
      cash_movement_atomic: '190000',
      transaction: TX,
    });
    expect(evidence.evidence_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      await validateNeverminedCreditsSettlementEvidence(evidence, {
        payment_identifier: PAYMENT_IDENTIFIER,
        plan_id: PLAN_ID,
        authorized_maximum: '190000',
        actual_usage: '12000',
        expected_starting_balance: '0',
        expected_acquisition: '190000',
      })
    ).toEqual({ valid: true });
  });

  it.each([
    [
      'FULL_BUNDLE_TOPUP',
      {
        starting_balance: '178000',
        credits_acquired: '190000',
        credits_redeemed: '190000',
        usage_value_atomic: '190000',
        remaining_balance: '178000',
        cash_movement_atomic: '190000',
      },
    ],
    [
      'DEFICIT_ONLY_TOPUP',
      {
        starting_balance: '178000',
        credits_acquired: '12000',
        credits_redeemed: '190000',
        usage_value_atomic: '190000',
        remaining_balance: '0',
        cash_movement_atomic: '12000',
      },
    ],
  ] as const)('validates an exact positive-insufficient %s equation', async (_policy, fields) => {
    const evidence = await buildNeverminedCreditsSettlementEvidence(validInput(fields));
    expect(
      await validateNeverminedCreditsSettlementEvidence(evidence, {
        payment_identifier: PAYMENT_IDENTIFIER,
        plan_id: PLAN_ID,
        authorized_maximum: '190000',
        actual_usage: '190000',
        expected_starting_balance: '178000',
        expected_acquisition: fields.credits_acquired,
      })
    ).toEqual({ valid: true });
  });

  it('rejects a partial-balance observation whose cash and acquired credits disagree', async () => {
    const evidence = await buildNeverminedCreditsSettlementEvidence(
      validInput({
        starting_balance: '178000',
        credits_acquired: '12000',
        credits_redeemed: '190000',
        usage_value_atomic: '190000',
        remaining_balance: '0',
        cash_movement_atomic: '190000',
      })
    );
    expect(
      await validateNeverminedCreditsSettlementEvidence(evidence, {
        payment_identifier: PAYMENT_IDENTIFIER,
        plan_id: PLAN_ID,
        authorized_maximum: '190000',
        actual_usage: '190000',
        expected_starting_balance: '178000',
        expected_acquisition: '12000',
      })
    ).toEqual({ valid: false, reason: 'CASH_ACQUISITION_MISMATCH' });
  });

  it.each([
    ['credits_redeemed', '11999', 'CREDITS_REDEEMED_MISMATCH'],
    ['usage_value_atomic', '11999', 'USAGE_VALUE_MISMATCH'],
    ['remaining_balance', '177999', 'CREDIT_BALANCE_EQUATION_MISMATCH'],
    ['cash_movement_atomic', '12000', 'CASH_ACQUISITION_MISMATCH'],
    ['credits_acquired', '189999', 'CREDITS_ACQUIRED_MISMATCH'],
  ] as const)('fails closed when %s is changed', async (field, value, reason) => {
    const evidence = await buildNeverminedCreditsSettlementEvidence(validInput());
    expect(
      await validateNeverminedCreditsSettlementEvidence(
        { ...evidence, [field]: value },
        {
          payment_identifier: PAYMENT_IDENTIFIER,
          plan_id: PLAN_ID,
          authorized_maximum: '190000',
          actual_usage: '12000',
          expected_starting_balance: '0',
          expected_acquisition: '190000',
        }
      )
    ).toEqual({ valid: false, reason });
  });

  it.each(['1.2', '-1', '01', 'NaN', '', '9007199254740993.0'])(
    'rejects malformed atomic values: %s',
    async (value) => {
      await expect(
        buildNeverminedCreditsSettlementEvidence(validInput({ credits_redeemed: value }))
      ).rejects.toThrow(/invalid_nevermined_credits_settlement_evidence/);
    }
  );

  it('detects a mutated evidence hash independently of the economic checks', async () => {
    const evidence = await buildNeverminedCreditsSettlementEvidence(validInput());
    expect(
      await validateNeverminedCreditsSettlementEvidence(
        { ...evidence, evidence_hash: 'sha256:' + '0'.repeat(64) },
        {
          payment_identifier: PAYMENT_IDENTIFIER,
          plan_id: PLAN_ID,
          authorized_maximum: '190000',
          actual_usage: '12000',
          expected_starting_balance: '0',
          expected_acquisition: '190000',
        }
      )
    ).toEqual({ valid: false, reason: 'EVIDENCE_HASH_MISMATCH' });
  });
});
