/**
 * SUN-1201 checkpoint G — DETERMINISTIC POST-SETTLEMENT WORKER-RUNTIME
 * PROOF. A test-only Worker entrypoint, structurally separate from the
 * real production entrypoint (`index.ts`) and the real production
 * `wrangler.toml`, whose ONLY purpose is to let
 * `scripts/test-worker-runtime.mts` drive `verify_agent_output` through
 * real post-settlement execution inside real `workerd` -- the one proof
 * SUN-1200 checkpoint F's own harness could not safely produce, because
 * that harness's `wrangler dev` instance is wired with the real
 * production CDP facilitator client and real seller wallet.
 *
 * THE PRODUCTION WORKER NEVER IMPORTS THIS FILE. `index.ts` -- the file
 * `wrangler.toml`'s `main` field actually points at -- has no import of
 * `worker-runtime-test-entrypoint.ts` anywhere, so esbuild's real
 * `wrangler deploy`/`wrangler deploy --dry-run` bundle for the real
 * Worker never includes this module's code at all (proven, not merely
 * asserted, by `scripts/test-worker-runtime.mts`'s bundle-isolation
 * check: it greps a fresh `wrangler deploy --dry-run` output of the REAL
 * `wrangler.toml` for this file's own distinctive marker string and
 * requires zero matches).
 *
 * This entrypoint calls the exact same, real, unmodified
 * `buildPaidServicesApp` (`control-plane/routes/paid-services.ts`) the
 * real production Worker calls -- same Hono app construction, same
 * route mounting, same `x402-service.ts`, same Profile 1 pre-economic
 * gate (`checkSchemaProfile1`), same `verify_agent_output` service
 * (`schema_valid` via the real `checkSchemaProfile1`/
 * `validateAgainstProfile1`), same `verifyAndSign`/SchemaVerifier
 * output-validation path. The ONLY difference from production: this
 * file hard-codes `evidenceMode: 'fixture'` and a
 * `FixturePaymentEvidenceProvider` instance directly in source code --
 * never read from any `env` binding, query parameter, header, cookie,
 * or D1/KV/R2 value, so there is no request-controlled, environment-
 * controlled, or storage-controlled way to select it. A deployed
 * production Worker (built from `index.ts`/`wrangler.toml`) has no
 * knowledge this file exists.
 *
 * `FixturePaymentEvidenceProvider` produces exclusively
 * `synthetic_fixture`-trust-class evidence
 * (`@siteborne/protocol-x402`'s own doc comment) -- no network call, no
 * facilitator, no credential, ever. `PAID_ROUTES_ENABLED`/D1 binding are
 * still required exactly as in production (this entrypoint does not
 * relax that gate); `wrangler.worker-runtime-test.toml` supplies them
 * pointed at the harness's own isolated `--persist-to` state.
 */
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { FixturePaymentEvidenceProvider, REGISTRY_SERVICES } from '@siteborne/protocol-x402';
import type { NeverminedFacilitatorClient } from '@siteborne/protocol-nevermined';
import {
  buildPaidServicesApp,
  buildNeverminedV2PaidServicesApp,
} from './control-plane/routes/paid-services';
import { NeverminedPaymentEvidenceProvider } from './control-plane/evidence/nevermined-provider';
import { createX402ServiceRoute } from './control-plane/routes/x402-service';
import { buildVerifyAgentOutputV2CdpProductionRouteConfig } from './control-plane/production/verify-agent-output-v2-cdp-composition';
import { D1ServicesRepository } from './control-plane/repositories/d1/services';
import { mcpRoute } from './routes/mcp';
import type { Env } from './control-plane/config/env';

// `scripts/test-worker-runtime.mts`'s bundle-isolation check searches a
// fresh `wrangler deploy --dry-run` of the REAL `wrangler.toml` for this
// module's own source chunk (esbuild emits a `// apps/edge-api/src/
// worker-runtime-test-entrypoint.ts` comment for every real source file
// it actually bundles) and requires zero matches -- not merely absence
// of a hand-picked marker string, but absence of this file's own
// bundled module chunk entirely.
const WORKER_RUNTIME_TEST_ENTRYPOINT_MARKER = 'SUN-1201-WORKER-RUNTIME-TEST-ENTRYPOINT-b7f2c4';

let cachedApp: Awaited<ReturnType<typeof buildPaidServicesApp>> | undefined;
let cachedDb: D1Database | undefined;

const app = new Hono<{ Bindings: Env }>();

// Public MCP uses the exact production route implementation. This test-only
// Worker adds no MCP service boundary: paid tools therefore retain the real
// closed default (`payment_required`) and cannot reach any fixture/payment
// provider mounted below for the paid-route workerd scenarios.
app.all('/mcp', mcpRoute);

/**
 * SUN-1204 checkpoint J, Track B — a deterministic
 * `NeverminedFacilitatorClient` for `NeverminedPaymentEvidenceProvider.fixture()`,
 * the SAME "only injectable client path" the real production code already
 * defines (`control-plane/evidence/nevermined-provider.ts`) specifically
 * for testability -- `providerKind` is unconditionally `'fixture'` for
 * this path, so `resolvePaymentEvidenceProvider`'s own production-mode
 * gate rejects it exactly like CDP's `FixturePaymentEvidenceProvider`.
 * The real production entrypoint (`index.ts`) never calls `.fixture()`,
 * only `.authenticated()` (which requires a real sandbox API key + the
 * explicit `RUN_LIVE_NEVERMINED`/environment live-guard) -- this seam is
 * not new, not invented for this checkpoint, and already structurally
 * unreachable from production by the existing code's own design.
 */
function successNeverminedClient(): NeverminedFacilitatorClient {
  let verifyCount = 0;
  let settleCount = 0;
  return {
    async verifyPermissions() {
      verifyCount += 1;
      return {
        isValid: true,
        payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',
        network: 'eip155:84532',
        agentRequestId: `fixture-request-${verifyCount}`,
      };
    },
    async settlePermissions(input) {
      settleCount += 1;
      return {
        success: true,
        payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',
        transaction: `fixture:settlement:${settleCount}`,
        network: 'eip155:84532',
        creditsRedeemed: input.actualAmount,
        remainingBalance: '999000',
      };
    },
  };
}

/** N4/N5 (§7): a deterministic client that always explicitly DENIES
 * verification -- mounted at a distinct, test-only-only path prefix
 * (`/v2/nevermined-deny/*`, never a real production path; production only
 * ever mounts `/v2/nevermined/*`) rather than any request-controlled
 * selector, so the harness can prove denial without any magic
 * header/value reaching the real route logic. */
function denyingNeverminedClient(): NeverminedFacilitatorClient {
  return {
    async verifyPermissions() {
      return {
        isValid: false,
        invalidReason: 'fixture_explicit_denial',
      };
    },
    async settlePermissions() {
      throw new Error('settlePermissions must never be reached after an explicit denial');
    },
  };
}

let cachedNeverminedApp: Awaited<ReturnType<typeof buildNeverminedV2PaidServicesApp>> | undefined;
let cachedNeverminedDb: D1Database | undefined;
let cachedNeverminedDenyApp:
  | Awaited<ReturnType<typeof buildNeverminedV2PaidServicesApp>>
  | undefined;
let cachedNeverminedDenyDb: D1Database | undefined;

app.all('/v2/nevermined-deny/*', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: 'configuration_error', message: 'no D1 binding configured' }, 500);
  }
  if (!cachedNeverminedDenyApp || cachedNeverminedDenyDb !== c.env.DB) {
    cachedNeverminedDenyApp = await buildNeverminedV2PaidServicesApp({
      db: c.env.DB,
      evidenceMode: 'fixture',
      evidenceProvider: NeverminedPaymentEvidenceProvider.fixture(denyingNeverminedClient()),
    });
    cachedNeverminedDenyDb = c.env.DB;
  }
  // Rewrite /v2/nevermined-deny/* -> /v2/nevermined/* for the inner app,
  // which only ever registers the real production path shape.
  const url = new URL(c.req.raw.url);
  url.pathname = url.pathname.replace('/v2/nevermined-deny/', '/v2/nevermined/');
  return cachedNeverminedDenyApp.request(new Request(url, c.req.raw));
});

app.all('/v2/nevermined/*', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: 'configuration_error', message: 'no D1 binding configured' }, 500);
  }
  if (!cachedNeverminedApp || cachedNeverminedDb !== c.env.DB) {
    cachedNeverminedApp = await buildNeverminedV2PaidServicesApp({
      db: c.env.DB,
      evidenceMode: 'fixture',
      evidenceProvider: NeverminedPaymentEvidenceProvider.fixture(successNeverminedClient()),
    });
    cachedNeverminedDb = c.env.DB;
  }
  return cachedNeverminedApp.request(c.req.raw);
});

/**
 * SUN-1214 checkpoint T — real-workerd proof for the new production
 * composition (`verify_agent_output.v2` / CDP), mounted at a distinct,
 * test-only-only path prefix (`/v2/verify-production/*`, never a real
 * production path -- production only ever mounts the generic
 * `/v2/*` family above, which this test entrypoint's own `/v2/*` handler
 * still serves via the unrelated `buildPaidServicesApp`/fixture-registry
 * path). This proves the REAL production composition module
 * (`buildVerifyAgentOutputV2CdpProductionRouteConfig`), not a fixture
 * stand-in for it.
 *
 * The signing key below is generated once, in memory, at module load --
 * never written to disk, never committed, never read from any env
 * binding or wrangler config. This is the same secure-handling standard
 * this project has used for every other test-only credential (compare
 * `successNeverminedClient`'s fixture wallet address, which is likewise
 * hardcoded test-only material, never a real one). `PRODUCTION_ENABLED`/
 * `PAYMENT_ENVIRONMENT`/etc. are read from `c.env`, exactly as the real
 * production composition module would -- this
 * `wrangler.worker-runtime-test.toml` config declares none of them, so
 * they resolve to `undefined`, and `resolveProductionAuthorizationInput`
 * correctly resolves to preproduction, matching every other scenario in
 * this harness.
 */
async function testSigningPrivateKeyHex(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
const TEST_SIGNING_KEY_ID = 'kid_workerdtest0123456789abc';
let cachedTestSigningKeyHex: string | undefined;

let cachedVerifyProductionApp: Hono | undefined;
let cachedVerifyProductionDb: D1Database | undefined;

app.all('/v2/verify-production/*', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: 'configuration_error', message: 'no D1 binding configured' }, 500);
  }
  if (!cachedVerifyProductionApp || cachedVerifyProductionDb !== c.env.DB) {
    if (!cachedTestSigningKeyHex) {
      cachedTestSigningKeyHex = await testSigningPrivateKeyHex();
    }
    // The FK from jobs.service_id -> services(id) requires a row for
    // verify_agent_output.v2 to exist before job creation can succeed.
    // The real production entrypoint has no equivalent seeding step
    // today (paid routes are structurally disabled before reaching this
    // point) -- this mirrors paid-services.ts's own private
    // seedServices() helper exactly (not exported, so reimplemented
    // here at the same idempotent granularity, for this one service
    // only) rather than modifying that frozen file to export it.
    const servicesRepo = new D1ServicesRepository(c.env.DB);
    const entry = REGISTRY_SERVICES['verify_agent_output.v2'];
    await servicesRepo
      .create({
        service_id: 'verify_agent_output.v2',
        version: entry.service_version,
        title: entry.title,
        description: entry.description,
        input_schema: entry.input_schema_uri,
        output_schema: entry.output_schema_uri,
        price_usd: entry.maximum_price.amount,
        production_enabled: false,
        production_ready: false,
        protocol_status: 'preproduction',
      })
      .catch(() => {
        /* idempotent: a prior request in this same isolated D1 instance
         * already seeded this row. */
      });

    const config = await buildVerifyAgentOutputV2CdpProductionRouteConfig(
      {
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: cachedTestSigningKeyHex,
        PAID_RECEIPT_SIGNING_KEY_ID: TEST_SIGNING_KEY_ID,
        SELLER_WALLET_ADDRESS: c.env.SELLER_WALLET_ADDRESS,
        CDP_API_KEY_ID: c.env.CDP_API_KEY_ID,
        CDP_API_KEY_SECRET: c.env.CDP_API_KEY_SECRET,
        PAYMENT_ENVIRONMENT: c.env.PAYMENT_ENVIRONMENT,
        PRODUCTION_ENABLED: c.env.PRODUCTION_ENABLED,
        HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: c.env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP,
        PRODUCTION_CDP_CREDENTIALS_APPROVED: c.env.PRODUCTION_CDP_CREDENTIALS_APPROVED,
      },
      c.env.DB
    );
    if ('unavailable' in config) {
      return c.json({ error: 'configuration_error', message: config.reason }, 500);
    }

    const subApp = new Hono();
    createX402ServiceRoute(subApp, config);
    cachedVerifyProductionApp = subApp;
    cachedVerifyProductionDb = c.env.DB;
  }
  // Rewrite /v2/verify-production/* -> /v2/verify/agent-output for the
  // inner app, which only ever registers the real production path shape.
  const url = new URL(c.req.raw.url);
  url.pathname = url.pathname.replace('/v2/verify-production/', '/v2/verify/');
  return cachedVerifyProductionApp.request(new Request(url, c.req.raw));
});

app.all('/v1/*', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: 'configuration_error', message: 'no D1 binding configured' }, 500);
  }
  if (!cachedApp || cachedDb !== c.env.DB) {
    cachedApp = await buildPaidServicesApp({
      db: c.env.DB,
      evidenceMode: 'fixture',
      evidenceProvider: new FixturePaymentEvidenceProvider(),
    });
    cachedDb = c.env.DB;
  }
  return cachedApp.request(c.req.raw);
});

app.all('/v2/*', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: 'configuration_error', message: 'no D1 binding configured' }, 500);
  }
  if (!cachedApp || cachedDb !== c.env.DB) {
    cachedApp = await buildPaidServicesApp({
      db: c.env.DB,
      evidenceMode: 'fixture',
      evidenceProvider: new FixturePaymentEvidenceProvider(),
    });
    cachedDb = c.env.DB;
  }
  return cachedApp.request(c.req.raw);
});

app.get('/', (c) => c.json({ marker: WORKER_RUNTIME_TEST_ENTRYPOINT_MARKER, ok: true }));

export default app;
