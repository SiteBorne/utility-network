/**
 * SUN-0900B checkpoint 2B — differential PAYG unit-economics probe.
 *
 * Purpose: close ONLY the remaining `actual < price` economic-mapping
 * uncertainty for the already-accepted, already-registered
 * `web_context_verified.v1` plan (9000 atomic USDC price). This is a
 * controlled_sandbox_capability_probe, not a SITEBORNE service
 * transaction: it never goes through `createX402ServiceRoute`, never
 * executes `web_context_verified.v1`, never builds a PCC or a SITEBORNE
 * logical job, and never touches `document_evidence_json.v1`. It calls
 * the installed SDK's raw facilitator API directly
 * (`payments.facilitator.verifyPermissions`/`settlePermissions`) against
 * a `buildPaymentRequired(...)` object, bypassing SITEBORNE's HTTP route
 * entirely.
 *
 * Gated by its own env var — deliberately NOT `RUN_LIVE_NEVERMINED` (that
 * flag gates the SITEBORNE payment-flow route test suite; this is a
 * narrower, distinct, one-time capability probe against the raw SDK):
 *
 *   describe.skipIf(process.env.NEVERMINED_PROBE_PAYG_DIFFERENTIAL !== '1')
 *
 * Requires: NVM_API_KEY (builder — facilitator verify/settle),
 * NVM_SUBSCRIBER_API_KEY (subscriber — delegation/token).
 *
 * Experiment: verify with maxAmount=9000 (the plan's own known/control
 * ceiling), then settle with maxAmount=1000 (deliberately less than the
 * plan's registered price) — exactly once, no retry. Read-only external
 * reconciliation (seller key) afterward determines the real outcome;
 * the actual on-chain Base Sepolia transaction is inspected separately,
 * outside this file, via a public block explorer.
 *
 * RESULT (this checkpoint's single authorized run,
 * tx 0x59a8bd0b7567e7cf3cc2489c539e41083ba424bd87d1b2920d539eebcd9669d7):
 * the on-chain gross transfer was 9000, not the requested 1000 — the
 * plan's registered price dominated the settle-time maxAmount.
 * Classification PAYG_SETTLES_PLAN_PRICE. Do not rerun this probe; see
 * docs/reports/SUN-0900B-checkpoint-2b-unit-economics-report.md.
 *
 * `controlled_sandbox_self_test`: independent_customer=false, revenue=false,
 * open_market_purchase=false, production_ready=false, production_enabled=false.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Payments, PaymentsError, buildPaymentRequired } from '@nevermined-io/payments';
import { reconcileNeverminedDelegation } from '@siteborne/protocol-nevermined';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../migrations', import.meta.url));

function runMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.reduce(async (prev, file) => {
    await prev;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter(Boolean)) {
      await db.exec(stmt);
    }
  }, Promise.resolve());
}

// Frozen, authoritative, already-accepted web registration (SUN-0900B
// checkpoint 1) — reused verbatim, never re-registered.
const AGENT_ID = '37714377069519076502259354421538507339628407587207707299869594618861814144272';
const PLAN_ID = '94523930722525068656272128894334430057768353189467518442660086462546695282012';
const ENDPOINT = '/v1/nevermined/web/context';
const NETWORK = 'eip155:84532';

describe.skipIf(process.env.NEVERMINED_PROBE_PAYG_DIFFERENTIAL !== '1')(
  'SUN-0900B checkpoint 2B — differential PAYG settlement-unit probe (verify=9000, settle=1000)',
  () => {
    // A D1 instance is spun up only so this file can log its
    // (unmodified) baseline sanity — the probe itself writes NOTHING to
    // it. No payment_attempts row, no job, no result is ever created
    // here.
    let mf: Miniflare;
    let db: D1Database;

    beforeAll(async () => {
      mf = new Miniflare({
        modules: true,
        script: `export default { async fetch() { return new Response('OK'); } }`,
        d1Databases: ['DB'],
      });
      db = await mf.getD1Database('DB');
      await runMigrations(db);
    }, 30_000);

    afterAll(async () => {
      await mf.dispose();
    });

    it('verify(maxAmount=9000) succeeds, settle(maxAmount=1000) is called exactly once, response evidence captured', async () => {
      const apiKey = process.env.NVM_API_KEY;
      const subscriberApiKey = process.env.NVM_SUBSCRIBER_API_KEY;
      if (!apiKey) throw new Error('NVM_API_KEY must be set (builder credential)');
      if (!subscriberApiKey) throw new Error('NVM_SUBSCRIBER_API_KEY must be set');

      // Confirm the D1 instance is genuinely untouched by this probe —
      // zero payment_attempts rows, before and after.
      const before = await db.prepare('SELECT COUNT(*) as n FROM payment_attempts').first<{
        n: number;
      }>();
      expect(before?.n).toBe(0);

      const builder = Payments.getInstance({ nvmApiKey: apiKey });
      const subscriber = Payments.getInstance({ nvmApiKey: subscriberApiKey });

      // ---------------------------------------------------------------
      // Delegation: reconcile read-only FIRST (subscriber key). Reuse an
      // exact, active, sufficiently-funded delegation if one exists;
      // never reuse a historically-exhausted one; create at most ONE.
      // ---------------------------------------------------------------
      const nowIso = new Date().toISOString();
      const delegationPolicy = {
        provider: 'erc4337' as const,
        currency: 'usdc',
        activeStatuses: ['active'],
        minRemainingBudgetCents: 1,
        notExpiredAsOfIso: nowIso,
      };
      const delegationListClient = {
        listDelegations: async () => {
          const result = await subscriber.delegation.listDelegations({ accessible: true });
          return {
            delegations: result.delegations.map((d) => ({
              delegationId: d.delegationId,
              provider: d.provider,
              status: d.status,
              currency: d.currency,
              spendingLimitCents: d.spendingLimitCents,
              remainingBudgetCents: d.remainingBudgetCents,
              amountSpentCents: d.amountSpentCents,
              expiresAt: d.expiresAt,
            })),
          };
        },
      };
      const delegationReconciliation = await reconcileNeverminedDelegation(
        delegationListClient,
        delegationPolicy
      );
      // eslint-disable-next-line no-console
      console.log('Probe delegation reconciliation (sanitized):', {
        state: delegationReconciliation.state,
      });

      let delegationId: string;
      if (delegationReconciliation.state === 'exact_existing') {
        delegationId = delegationReconciliation.delegationId;
        // eslint-disable-next-line no-console
        console.log('Reusing existing usable delegation — no new delegation created.');
      } else if (delegationReconciliation.state === 'no_match') {
        let created: Awaited<ReturnType<typeof subscriber.delegation.createDelegation>>;
        try {
          created = await subscriber.delegation.createDelegation({
            provider: 'erc4337',
            spendingLimitCents: 1, // smallest representable ceiling — >= the plan's own $0.009 price
            durationSecs: 3_600,
            currency: 'usdc',
            planId: PLAN_ID,
          });
        } catch (e) {
          if (e instanceof PaymentsError) {
            // eslint-disable-next-line no-console
            console.error('Probe createDelegation failure (sanitized):', {
              code: e.code,
              message: e.message,
            });
          }
          throw e;
        }
        delegationId = created.delegationId;
        // eslint-disable-next-line no-console
        console.log('New bounded delegation created (id only, sanitized).');
      } else {
        throw new Error(
          `probe: delegation reconciliation did not resolve to 'exact_existing' or 'no_match' (got "${delegationReconciliation.state}") — refusing to create another delegation.`
        );
      }
      expect(delegationId).toBeTruthy();

      const delegationReadBack = await reconcileNeverminedDelegation(
        delegationListClient,
        { ...delegationPolicy, notExpiredAsOfIso: new Date().toISOString() },
        { backoffScheduleMs: [0, 2_000, 5_000, 10_000] }
      );
      if (
        delegationReadBack.state !== 'exact_existing' ||
        delegationReadBack.delegationId !== delegationId
      ) {
        throw new Error(
          `probe: delegation ${delegationId} did not read back as exact_existing (got "${delegationReadBack.state}") — preserving created state, not creating another.`
        );
      }

      // ---------------------------------------------------------------
      // Ephemeral x402 token, bound to this delegation. Never logged,
      // never persisted.
      // ---------------------------------------------------------------
      const tokenResult = await subscriber.x402.getX402AccessToken(PLAN_ID, AGENT_ID, {
        delegationConfig: { delegationId },
      });
      const accessToken = tokenResult.accessToken;
      expect(accessToken).toBeTruthy();

      const paymentRequired = buildPaymentRequired(PLAN_ID, {
        endpoint: ENDPOINT,
        agentId: AGENT_ID,
        httpVerb: 'POST',
        network: NETWORK,
      });

      // ---------------------------------------------------------------
      // Controlled maximum verify — the plan's own known/control amount.
      // ---------------------------------------------------------------
      const verification = await builder.facilitator.verifyPermissions({
        paymentRequired,
        x402AccessToken: accessToken,
        maxAmount: 9000n,
      });
      // eslint-disable-next-line no-console
      console.log('Probe verify result (sanitized):', {
        isValid: verification.isValid,
        invalidReason: verification.invalidReason,
      });
      expect(verification.isValid).toBe(true);

      // ---------------------------------------------------------------
      // Deliberate differential settlement: 1000, strictly less than the
      // plan's registered 9000 price and the just-verified 9000 ceiling.
      // Exactly once. No retry, regardless of outcome.
      // ---------------------------------------------------------------
      const settlement = await builder.facilitator.settlePermissions({
        paymentRequired,
        x402AccessToken: accessToken,
        maxAmount: 1000n,
      });
      // eslint-disable-next-line no-console
      console.log('Probe settle response (sanitized):', {
        success: settlement.success,
        errorReason: settlement.errorReason,
        transaction: settlement.transaction,
        creditsRedeemed: settlement.creditsRedeemed,
        remainingBalance: settlement.remainingBalance,
      });

      // ---------------------------------------------------------------
      // Read-only external reconciliation (seller key) — the
      // authoritative outcome, independent of the immediate response
      // shape (which has previously been observed ambiguous/incomplete
      // for a genuinely successful settlement).
      // ---------------------------------------------------------------
      async function sellerGet(path: string): Promise<unknown> {
        const url = new URL(path, 'https://api.sandbox.nevermined.app/');
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Nevermined-Version': '1.1',
          },
        });
        if (!res.ok) throw new Error(`probe_reconciliation_http_${res.status}`);
        return res.json();
      }
      const delegationRead = (await sellerGet(
        `/api/v1/delegation/${encodeURIComponent(delegationId)}`
      )) as Record<string, unknown>;
      const transactionsRead = (await sellerGet(
        `/api/v1/delegation/${encodeURIComponent(delegationId)}/transactions`
      )) as { transactions?: Array<Record<string, unknown>> };
      const transactions = transactionsRead.transactions ?? [];
      const succeeded = transactions.filter((t) => t.status === 'succeeded');

      // eslint-disable-next-line no-console
      console.log('Probe external reconciliation (sanitized):', {
        delegation_status: delegationRead.status,
        transaction_count: transactions.length,
        succeeded_count: succeeded.length,
        transactions: succeeded.map((t) => ({
          providerTransactionId: t.providerTransactionId,
          amountCents: t.amountCents,
          status: t.status,
          createdAt: t.createdAt,
        })),
      });

      if (succeeded.length === 0) {
        // eslint-disable-next-line no-console
        console.log('PROBE CLASSIFICATION: NOT_SETTLED — no succeeded transaction found.');
      } else if (succeeded.length > 1) {
        // eslint-disable-next-line no-console
        console.log(
          'PROBE CLASSIFICATION: EXTERNAL_INCONSISTENCY — more than one succeeded transaction for this probe delegation.'
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          'PROBE CLASSIFICATION: exactly one succeeded transaction. Public reference (sanitized):',
          { providerTransactionId: succeeded[0]!.providerTransactionId }
        );
      }

      expect(succeeded.length).toBeLessThanOrEqual(1);

      // Confirm, again, that this probe wrote nothing to D1.
      const after = await db.prepare('SELECT COUNT(*) as n FROM payment_attempts').first<{
        n: number;
      }>();
      expect(after?.n).toBe(0);

      // eslint-disable-next-line no-console
      console.log(
        'PROBE COMPLETE. delegation_creations<=1 tokens=1 verify=1 settle=1 payment_attempts_rows=0 jobs=0'
      );
    }, 150_000);
  }
);
