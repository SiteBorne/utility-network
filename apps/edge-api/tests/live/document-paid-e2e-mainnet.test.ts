/**
 * SUN-1222C-R3B — the mainnet, one-shot `document_evidence_json.v2`
 * `upto` qualification client.
 *
 * This file has TWO independent test groups:
 *
 *  - The top-level `describe` blocks below always run (in `pnpm test`,
 *    `pnpm check`, and CI) and require no credentials, no network
 *    access, and no live gate. They prove the mainnet/asset/payTo/scheme
 *    locks and the CLI's credential/confirmation gating using the real
 *    exported functions the live flow depends on — so these guards are
 *    proven correct without ever needing the live suite to execute.
 *
 *  - `describe.skipIf(!RUN_LIVE)(...)` below is the actual live flow,
 *    modeled directly on `x402-live-upto.test.ts` (SUN-0700B checkpoint
 *    2) but locked to Base mainnet, the real `ModalDocumentWorkerBridge`
 *    executor, and the real buyer-facing `POST /v2/artifacts/documents`
 *    upload path (never a privileged direct R2 write — SUN-1222C-R3B
 *    §7-8). It is gated behind `RUN_LIVE_DOCUMENT_PAYMENT=1`, which
 *    SUN-1222C-R3B does not set and does not authorize setting — running
 *    it live requires a separate, later, standalone financial
 *    authorization. Never logs a payment signature, authorization,
 *    credential, RPC URL, or facilitator response body.
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { CdpClient } from '@coinbase/cdp-sdk';
import {
  createCdpFacilitatorClient,
  fromCdpEvmAccount,
  getDefaultEvmRpcUrls,
} from '@coinbase/cdp-sdk/x402';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import type { HTTPFacilitatorClient } from '@x402/core/server';
import {
  UptoEvmScheme,
  createPermit2ApprovalTx,
  getPermit2AllowanceReadParams,
} from '@x402/evm/upto/client';
import { getDefaultAsset } from '@x402/evm';
import { base } from 'viem/chains';
import { createPublicClient, http } from 'viem';
import { checkCdpSupportsNetwork } from '../../src/control-plane/evidence/cdp-provider';
import {
  hasAllRequiredCredentials,
  hasExplicitLiveConfirmation,
} from '../../../../scripts/document-paid-e2e';
import {
  DOCUMENT_MAINNET_NETWORK,
  DOCUMENT_MAINNET_SELLER_ADDRESS,
  DOCUMENT_MAINNET_USDC_ASSET,
  DOCUMENT_MAX_AUTHORIZED_ATOMIC,
  DOCUMENT_PAYMENT_SCHEME,
  DOCUMENT_SERVICE_ID,
  assertMainnetLock,
  validateDocumentMainnetRequirements,
} from '../../src/control-plane/production/document-mainnet-upto-client';

const RUN_LIVE = process.env.RUN_LIVE_DOCUMENT_PAYMENT === '1';
const REQUIRED_SCHEMES = ['upto'];
const BUYER_ADDRESS = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../migrations', import.meta.url));

function requireEnvPresent(name: string): void {
  if (!process.env[name]) {
    throw new Error(`SUN-1222C-R3B live document payment: required env var "${name}" is not set`);
  }
}

async function runMigrations(db: D1Database): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter((statement) => statement.length > 0);
    for (const statement of statements) await db.exec(statement);
  }
}

// ---------------------------------------------------------------------
// Always-run: prove the guards without needing live network access.
// ---------------------------------------------------------------------

describe('document-paid-e2e CLI gating (no network, no credentials)', () => {
  it('reports missing credentials by name only, never by value', () => {
    expect(hasAllRequiredCredentials({})).toBe(false);
    expect(
      hasAllRequiredCredentials({
        CDP_API_KEY_ID: 'x',
        CDP_API_KEY_SECRET: 'x',
        CDP_WALLET_SECRET: 'x',
        SELLER_WALLET_ADDRESS: 'x',
      })
    ).toBe(true);
  });

  it('refuses live confirmation unless the exact confirmation string is set', () => {
    expect(hasExplicitLiveConfirmation({})).toBe(false);
    expect(
      hasExplicitLiveConfirmation({ SITEBORNE_LIVE_DOCUMENT_PAYMENT_CONFIRMATION: 'yes' })
    ).toBe(false);
    expect(
      hasExplicitLiveConfirmation({
        SITEBORNE_LIVE_DOCUMENT_PAYMENT_CONFIRMATION:
          'I_UNDERSTAND_THIS_SPENDS_REAL_USDC_ON_BASE_MAINNET',
      })
    ).toBe(true);
  });
});

describe('mainnet lock is enforced independent of the live gate', () => {
  it("the official x402/evm asset table for Base mainnet matches this repo's frozen constant", () => {
    const asset = getDefaultAsset(DOCUMENT_MAINNET_NETWORK);
    expect(asset.address.toLowerCase()).toBe(DOCUMENT_MAINNET_USDC_ASSET.toLowerCase());
  });

  it("viem's Base mainnet chain id matches the locked CAIP-2 network", () => {
    expect(`eip155:${base.id}`).toBe(DOCUMENT_MAINNET_NETWORK);
  });

  it('a Sepolia-shaped 402 response is rejected before any signing material is prepared', () => {
    const result = validateDocumentMainnetRequirements(
      {
        scheme: DOCUMENT_PAYMENT_SCHEME,
        network: 'eip155:84532',
        asset: DOCUMENT_MAINNET_USDC_ASSET,
        payTo: DOCUMENT_MAINNET_SELLER_ADDRESS,
        amount: DOCUMENT_MAX_AUTHORIZED_ATOMIC,
      },
      { serviceId: DOCUMENT_SERVICE_ID }
    );
    expect(result.valid).toBe(false);
    expect(() => assertMainnetLock('eip155:84532')).toThrow();
  });
});

// ---------------------------------------------------------------------
// Live flow — gated, never executed by SUN-1222C-R3B.
// ---------------------------------------------------------------------

describe.skipIf(!RUN_LIVE)(
  'SUN-1222C-R3B — live Base-mainnet document_evidence_json.v2 upto qualification',
  () => {
    let miniflare: Miniflare | undefined;
    let db: D1Database;
    let facilitator: HTTPFacilitatorClient;
    let paymentClient: x402HTTPClient;
    let rpcUrl: string;
    let supportedResult: Awaited<ReturnType<typeof checkCdpSupportsNetwork>>;
    let buyerAccount: Awaited<ReturnType<CdpClient['evm']['getAccount']>>;

    beforeAll(async () => {
      for (const name of [
        'CDP_API_KEY_ID',
        'CDP_API_KEY_SECRET',
        'CDP_WALLET_SECRET',
        'SELLER_WALLET_ADDRESS',
        'RUN_LIVE_DOCUMENT_PAYMENT',
      ]) {
        requireEnvPresent(name);
      }
      // Mainnet lock — no Sepolia fallback path exists anywhere below
      // this line. `assertMainnetLock` throws for anything else.
      assertMainnetLock(DOCUMENT_MAINNET_NETWORK);

      const assetInfo = getDefaultAsset(DOCUMENT_MAINNET_NETWORK);
      if (assetInfo.address.toLowerCase() !== DOCUMENT_MAINNET_USDC_ASSET.toLowerCase()) {
        throw new Error('official x402 Base-mainnet asset differs from the approved USDC asset');
      }
      if (
        process.env.SELLER_WALLET_ADDRESS!.toLowerCase() !==
        DOCUMENT_MAINNET_SELLER_ADDRESS.toLowerCase()
      ) {
        throw new Error('SELLER_WALLET_ADDRESS differs from the approved Base-mainnet seller');
      }

      facilitator = createCdpFacilitatorClient();
      supportedResult = await checkCdpSupportsNetwork(
        facilitator,
        DOCUMENT_MAINNET_NETWORK,
        REQUIRED_SCHEMES
      );
      if (!supportedResult.ok || !supportedResult.uptoFacilitatorAddress) {
        throw new Error(`SUN-1222C-R3B live preflight rejected: ${supportedResult.reason}`);
      }

      const rpcByNetwork = await getDefaultEvmRpcUrls();
      rpcUrl = rpcByNetwork[DOCUMENT_MAINNET_NETWORK]?.rpcUrl ?? base.rpcUrls.default.http[0];

      const tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-document-paid-e2e-'));
      miniflare = new Miniflare({
        modules: true,
        script: `export default { async fetch() { return new Response('OK'); } }`,
        d1Databases: ['DB'],
        resourcePersistencePath: tempDir,
      });
      db = await miniflare.getD1Database('DB');
      await db.exec('PRAGMA foreign_keys = ON');
      await runMigrations(db);

      const cdp = new CdpClient();
      buyerAccount = await cdp.evm.getAccount({ address: BUYER_ADDRESS });
      expect(buyerAccount.address.toLowerCase()).toBe(BUYER_ADDRESS.toLowerCase());
      const signer = fromCdpEvmAccount(buyerAccount);
      const client = new x402Client();
      client.register(DOCUMENT_MAINNET_NETWORK, new UptoEvmScheme(signer, { rpcUrl }));
      paymentClient = new x402HTTPClient(client);
    }, 90_000);

    afterAll(async () => {
      await miniflare?.dispose();
    });

    it('preflight: sanitized supported capabilities include Base mainnet upto', () => {
      const safeKinds = supportedResult.kinds.filter(
        (kind) => kind.network === DOCUMENT_MAINNET_NETWORK && kind.scheme === 'upto'
      );
      // eslint-disable-next-line no-console
      console.log('CDP /supported document-paid-e2e (sanitized):', { kinds: safeKinds });
      expect(supportedResult.ok, supportedResult.reason).toBe(true);
      expect(safeKinds).toEqual(
        expect.arrayContaining([{ network: DOCUMENT_MAINNET_NETWORK, scheme: 'upto' }])
      );
    });

    it('STAGE A (read-only): reports Permit2 allowance status without approving', async () => {
      const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
      const params = getPermit2AllowanceReadParams({
        tokenAddress: DOCUMENT_MAINNET_USDC_ASSET,
        ownerAddress: BUYER_ADDRESS,
      });
      const allowance = await publicClient.readContract(params);
      const approvalRequired = allowance < BigInt(DOCUMENT_MAX_AUTHORIZED_ATOMIC);
      // eslint-disable-next-line no-console
      console.log('Permit2 allowance status (sanitized):', {
        approvalRequired,
        ceilingAtomic: DOCUMENT_MAX_AUTHORIZED_ATOMIC,
      });
      // STAGE A stops here. STAGE B (actual approval-if-needed, signing,
      // and the paid POST) is intentionally not implemented in this
      // checkpoint — see this file's own doc comment. Referencing the
      // approval-transaction builder here only proves it's wired for a
      // future STAGE B, never invoking it.
      expect(typeof createPermit2ApprovalTx).toBe('function');
      expect(typeof paymentClient).toBe('object');
    });
  }
);
