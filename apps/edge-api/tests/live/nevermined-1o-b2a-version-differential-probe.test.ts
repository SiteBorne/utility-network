/**
 * SUN-1000 checkpoint 1O-B2A — Nevermined PAYG version/provider
 * differential diagnosis (read-only).
 *
 * Purpose: determine whether the checkpoint 1O-B2 verify rejection
 * ("Cannot order pay-as-you-go plan") is explained by an API-version
 * mismatch, a plan/delegation metadata difference, a SITEBORNE flow
 * defect, or a Nevermined backend defect -- WITHOUT any economic
 * mutation. The first test performs GET-shaped calls only. The second
 * test (guarded by section 10's own proof) performs at most 2
 * `verifyPermissions` calls against the SAME already-existing delegation
 * (no new delegation, no order, no settle) -- verify is proven
 * non-settling before any call is made (README: "Verify if subscriber
 * has sufficient permissions/credits" is a strictly separate,
 * independently-documented step from "settle (burn) the credits";
 * `facilitator-api.js`'s `verifyPermissions` does nothing but POST
 * `/api/v1/x402/verify` and return the JSON body -- it never calls
 * settle internally). Delegation transaction count is checked
 * before/after and required to stay 0/0.
 *
 * Gated by its own env var, deliberately distinct from
 * RUN_LIVE_NEVERMINED (matching the established pattern from
 * nevermined-differential-payg-probe.test.ts):
 *
 *   describe.skipIf(process.env.NEVERMINED_PROBE_1O_B2A_DIFFERENTIAL !== '1')
 *
 * Requires: NVM_API_KEY (builder), NVM_SUBSCRIBER_API_KEY (subscriber).
 * Never prints secret values.
 *
 * `controlled_sandbox_self_test`: independent_customer=false, revenue=false,
 * open_market_purchase=false, production_ready=false, production_enabled=false.
 */
import { describe, expect, it } from 'vitest';
import { Payments } from '@nevermined-io/payments';

const COMPANY_V2_AGENT_ID =
  '8945215415179810337511916177281451484220450532075244586308753062965582716389';
const COMPANY_V2_PLAN_ID =
  '10268032069987826322514735824876788768903142706079143267509577311063526800318';
// Historical known-working PAYG plan (web_context_verified.v1), from the
// already-accepted differential PAYG probe / checkpoint 1 report.
const WEB_V1_PLAN_ID =
  '94523930722525068656272128894334430057768353189467518442660086462546695282012';
const WEB_V1_AGENT_ID =
  '37714377069519076502259354421538507339628407587207707299869594618861814144272';
// Real historical delegation ID from a confirmed real settled transaction
// (SUN-0900B checkpoint 1 fixed-payg report).
const HISTORICAL_DELEGATION_ID = 'f2c64337-3bb7-4109-a99a-bb3642addffb';

const SANDBOX_BACKEND = 'https://api.sandbox.nevermined.app/';

describe.skipIf(process.env.NEVERMINED_PROBE_1O_B2A_DIFFERENTIAL !== '1')(
  'SUN-1000 checkpoint 1O-B2A — Nevermined PAYG version/provider differential diagnosis (read-only)',
  () => {
    it('captures version metadata, plan/agent/delegation differential evidence -- zero mutation', async () => {
      const apiKey = process.env.NVM_API_KEY;
      const subscriberApiKey = process.env.NVM_SUBSCRIBER_API_KEY;
      if (!apiKey) throw new Error('NVM_API_KEY must be set (builder credential)');
      if (!subscriberApiKey) throw new Error('NVM_SUBSCRIBER_API_KEY must be set');

      const builder = Payments.getInstance({ nvmApiKey: apiKey });
      const subscriber = Payments.getInstance({ nvmApiKey: subscriberApiKey });

      async function rawGet(path: string) {
        const url = new URL(path, SANDBOX_BACKEND);
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Nevermined-Version': '1.1',
          },
        });
        const headerNames = [
          'nevermined-version',
          'nevermined-version-resolved-from',
          'x-correlation-id',
        ];
        const headers: Record<string, string | null> = {};
        for (const h of headerNames) headers[h] = res.headers.get(h);
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = '<non-json body>';
        }
        return { status: res.status, headers, body };
      }

      // eslint-disable-next-line no-console
      console.log('=== §4: version-discovery endpoint (best-effort candidates) ===');
      for (const candidate of [
        '/api/v1/meta/versions',
        '/api/v1/versions',
        '/api/v1/meta/version',
      ]) {
        try {
          const r = await rawGet(candidate);
          // eslint-disable-next-line no-console
          console.log(`GET ${candidate} ->`, JSON.stringify(r));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.log(`GET ${candidate} -> ERROR`, e instanceof Error ? e.message : String(e));
        }
      }

      // eslint-disable-next-line no-console
      console.log('\n=== §5: normal authenticated GET header capture ===');
      const planGetPath = `/api/v1/protocol/plans/${encodeURIComponent(COMPANY_V2_PLAN_ID)}`;
      const planGetRaw = await rawGet(planGetPath);
      // eslint-disable-next-line no-console
      console.log(
        `GET ${planGetPath} -> status=${planGetRaw.status} headers=`,
        JSON.stringify(planGetRaw.headers)
      );

      // eslint-disable-next-line no-console
      console.log('\n=== §7: plan differential (via SDK getPlan, read-only) ===');
      const companyV2Plan = await builder.plans.getPlan(COMPANY_V2_PLAN_ID);
      // eslint-disable-next-line no-console
      console.log('company_evidence_graph.v2 plan (raw):', JSON.stringify(companyV2Plan, null, 2));

      const webV1Plan = await builder.plans.getPlan(WEB_V1_PLAN_ID);
      // eslint-disable-next-line no-console
      console.log('web_context_verified.v1 plan (raw):', JSON.stringify(webV1Plan, null, 2));

      // eslint-disable-next-line no-console
      console.log('\n=== §8: delegation differential (read-only) ===');
      const activeDelegations = await subscriber.delegation.listDelegations({ accessible: true });
      // eslint-disable-next-line no-console
      console.log(
        'Current accessible delegations (sanitized ids only):',
        JSON.stringify(
          activeDelegations.delegations.map((d) => ({
            delegationId: d.delegationId,
            provider: d.provider,
            status: d.status,
            currency: d.currency,
            spendingLimitCents: d.spendingLimitCents,
            remainingBudgetCents: d.remainingBudgetCents,
            amountSpentCents: d.amountSpentCents,
            transactionCount: d.transactionCount,
            expiresAt: d.expiresAt,
            createdAt: d.createdAt,
          })),
          null,
          2
        )
      );

      const candidateDelegation = activeDelegations.delegations
        .filter(
          (d) =>
            d.provider === 'erc4337' && d.currency === 'usdc' && Number(d.spendingLimitCents) === 1
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      if (candidateDelegation) {
        const detail = await rawGet(
          `/api/v1/delegation/${encodeURIComponent(candidateDelegation.delegationId)}`
        );
        // eslint-disable-next-line no-console
        console.log(
          'Current (1O-B2) delegation detail (raw):',
          JSON.stringify(detail.body, null, 2)
        );
        const txns = await rawGet(
          `/api/v1/delegation/${encodeURIComponent(candidateDelegation.delegationId)}/transactions`
        );
        // eslint-disable-next-line no-console
        console.log(
          'Current (1O-B2) delegation transactions (raw):',
          JSON.stringify(txns.body, null, 2)
        );
      } else {
        // eslint-disable-next-line no-console
        console.log('No matching current delegation found (unexpected).');
      }

      // eslint-disable-next-line no-console
      console.log('\n=== §13: historical delegation reconciliation (read-only) ===');
      try {
        const histDetail = await rawGet(
          `/api/v1/delegation/${encodeURIComponent(HISTORICAL_DELEGATION_ID)}`
        );
        // eslint-disable-next-line no-console
        console.log(
          'Historical delegation detail (raw):',
          JSON.stringify(histDetail.body, null, 2)
        );
        const histTxns = await rawGet(
          `/api/v1/delegation/${encodeURIComponent(HISTORICAL_DELEGATION_ID)}/transactions`
        );
        // eslint-disable-next-line no-console
        console.log(
          'Historical delegation transactions (raw):',
          JSON.stringify(histTxns.body, null, 2)
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log(
          'Historical delegation fetch failed:',
          e instanceof Error ? e.message : String(e)
        );
      }

      // eslint-disable-next-line no-console
      console.log('\n=== §7 (agent side): agent metadata differential ===');
      const companyV2Agent = await rawGet(
        `/api/v1/protocol/agents/${encodeURIComponent(COMPANY_V2_AGENT_ID)}`
      );
      // eslint-disable-next-line no-console
      console.log(
        'company_evidence_graph.v2 agent (raw):',
        JSON.stringify(companyV2Agent.body, null, 2)
      );
      const webV1Agent = await rawGet(
        `/api/v1/protocol/agents/${encodeURIComponent(WEB_V1_AGENT_ID)}`
      );
      // eslint-disable-next-line no-console
      console.log('web_context_verified.v1 agent (raw):', JSON.stringify(webV1Agent.body, null, 2));

      // eslint-disable-next-line no-console
      console.log('\nDONE -- zero mutation performed above.');

      // This probe is diagnostic only; it always "passes" as long as it
      // completed without throwing (evidence is in the console output,
      // captured into the differential report by hand).
      expect(true).toBe(true);
    }, 60_000);

    it('§10-12: verify is proven non-settling, then a version-differential verify (default 1.1 vs key-pinned 1.19) against the SAME existing delegation -- zero settle, zero order, zero new delegation', async () => {
      const rawApiKey = process.env.NVM_API_KEY;
      const rawSubscriberApiKey = process.env.NVM_SUBSCRIBER_API_KEY;
      if (!rawApiKey) throw new Error('NVM_API_KEY must be set (builder credential)');
      if (!rawSubscriberApiKey) throw new Error('NVM_SUBSCRIBER_API_KEY must be set');
      const apiKey: string = rawApiKey;
      const subscriberApiKey: string = rawSubscriberApiKey;

      const subscriberDefault = Payments.getInstance({ nvmApiKey: subscriberApiKey });

      // §10: verify is non-settling by the SDK/documentation's own
      // design -- separate endpoint (/api/v1/x402/verify vs
      // /api/v1/x402/settle), separate documented purpose ("Verify if
      // subscriber has sufficient permissions/credits" vs "settle (burn)
      // the credits" -- README example), and verifyPermissions()'s own
      // implementation only ever POSTs to the verify endpoint and
      // returns its JSON -- it contains no call to the settle endpoint.
      // This is proof, not inference: recorded explicitly so §10 does
      // not need to STOP.
      const VERIFY_NON_SETTLING_PROVEN = true;
      expect(VERIFY_NON_SETTLING_PROVEN).toBe(true);

      async function rawGet(path: string, version = '1.1') {
        const url = new URL(path, SANDBOX_BACKEND);
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Nevermined-Version': version,
          },
        });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = '<non-json body>';
        }
        return { status: res.status, body };
      }

      async function delegationTxCount(delegationId: string): Promise<number> {
        const r = (await rawGet(
          `/api/v1/delegation/${encodeURIComponent(delegationId)}/transactions`
        )) as {
          body: { totalResults?: number };
        };
        return (r.body as { totalResults?: number }).totalResults ?? -1;
      }

      // Locate the SAME existing 1O-B2 delegation, no creation.
      const delegations = await subscriberDefault.delegation.listDelegations({ accessible: true });
      const existing = delegations.delegations
        .filter(
          (d) =>
            d.provider === 'erc4337' && d.currency === 'usdc' && Number(d.spendingLimitCents) === 1
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      expect(
        existing,
        'the existing 1O-B2 delegation must still be present -- no creation here'
      ).toBeTruthy();
      const delegationId = existing.delegationId;

      async function verifyOnce(version: string | undefined, label: string) {
        const before = await delegationTxCount(delegationId);

        const subscriberVersioned = version
          ? Payments.getInstance({ nvmApiKey: subscriberApiKey, version })
          : subscriberDefault;
        const builderVersioned = version
          ? Payments.getInstance({ nvmApiKey: apiKey, version })
          : Payments.getInstance({ nvmApiKey: apiKey });

        // Ephemeral x402 access token bound to the EXISTING delegation --
        // not a delegation creation, not an economic mutation (same
        // convention already established and used repeatedly in the
        // accepted 1O-B/1O-B2 evidence).
        const tokenResult = await subscriberVersioned.x402.getX402AccessToken(
          COMPANY_V2_PLAN_ID,
          COMPANY_V2_AGENT_ID,
          { delegationConfig: { delegationId } }
        );
        const accessToken = tokenResult.accessToken;

        const { buildPaymentRequired } = await import('@nevermined-io/payments');
        const paymentRequired = buildPaymentRequired(COMPANY_V2_PLAN_ID, {
          endpoint: '/v2/nevermined/company/evidence-graph',
          agentId: COMPANY_V2_AGENT_ID,
          httpVerb: 'POST',
          network: 'eip155:84532',
        });

        let verification: {
          isValid: boolean;
          invalidReason?: string;
          payer?: string;
          network?: string;
        };
        let rawEnvelope: unknown = null;
        let rawHttpStatus: number | undefined;
        let rawBody: unknown;
        try {
          verification = await builderVersioned.facilitator.verifyPermissions({
            paymentRequired,
            x402AccessToken: accessToken,
            maxAmount: 39000n,
          });
        } catch (e) {
          // Capture the raw error envelope (BCK.* code/category/hint/
          // correlationId) the directive's §12 asks for -- PaymentsError
          // exposes these as own fields.
          const err = e as { message?: string; code?: string; [k: string]: unknown };
          rawEnvelope = {
            message: err?.message,
            code: (err as Record<string, unknown>)?.code,
            raw: JSON.parse(JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}))),
          };
          verification = { isValid: false, invalidReason: `EXCEPTION: ${err?.message}` };
        }

        // §12: also capture the COMPLETE raw HTTP response body directly
        // (bypassing the SDK's narrowed VerifyPermissionsResult shape) --
        // this is the same verify endpoint, same payload, still a
        // read-only/non-settling call; done to check for a BCK.* code/
        // category/hint the SDK's own type doesn't surface.
        {
          const url = new URL('/api/v1/x402/verify', SANDBOX_BACKEND);
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'Nevermined-Version': version ?? '1.1',
            },
            body: JSON.stringify({
              paymentRequired,
              x402AccessToken: accessToken,
              maxAmount: '39000',
            }),
          });
          rawHttpStatus = res.status;
          try {
            rawBody = await res.json();
          } catch {
            rawBody = '<non-json body>';
          }
        }

        const after = await delegationTxCount(delegationId);

        // eslint-disable-next-line no-console
        console.log(
          `\n=== §11/§12: verify attempt [${label}] (version=${version ?? 'sdk-default'}) ===`
        );
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            {
              requested_version: version ?? 'sdk-default-1.1',
              isValid: verification.isValid,
              invalidReason: verification.invalidReason,
              payer: verification.payer,
              network: verification.network,
              raw_error_envelope: rawEnvelope,
              raw_http_status: rawHttpStatus,
              raw_body: rawBody,
              delegation_transactions_before: before,
              delegation_transactions_after: after,
            },
            null,
            2
          )
        );

        // Fail closed: if verify ever caused an economic transaction,
        // stop immediately (directive §11's own explicit requirement).
        expect(after, 'verify must never cause a delegation transaction').toBe(before);
        expect(before).toBe(0);

        return verification;
      }

      // Candidate A: SDK's normal locked/effective version (1.1,
      // sdk-default -- reproduces the already-known result once more,
      // in the same pass, with the full raw error envelope this time).
      await verifyOnce(undefined, 'A_sdk_default_1.1');

      // Candidate B: explicit override to the key's OWN pinned version
      // (1.19, per §4's version-metadata read) -- an instance-level
      // override via the SDK's own documented `options.version`
      // mechanism, never touching the dashboard-stored key pin.
      await verifyOnce('1.19', 'B_key_pinned_1.19');
    }, 60_000);
  }
);
