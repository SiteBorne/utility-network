import { createSiteborneMcpHonoApp, type CreateSiteborneMcpOptions } from '@siteborne/protocol-mcp';
import { PREPRODUCTION_NETWORK } from '@siteborne/protocol-x402';
import { getDefaultAsset } from '@x402/evm';
import type { Context } from 'hono';
import type { Env } from '../control-plane/config/env';

const MCP_ALLOWED_HOSTS = [
  'utility.siteborne.net',
  'localhost',
  '127.0.0.1',
  '[::1]',
  'test.local',
] as const;

/**
 * Credential-independent MCP endpoint. Each HTTP request receives a fresh
 * official SDK handler/server. Service tools use protocol-mcp's closed
 * default boundary, which returns payment_required and cannot execute a
 * useful service for free. A seller address enables quote construction
 * only; it does not enable paid execution, settlement, or production.
 */
export async function mcpRoute(context: Context<{ Bindings: Env }>): Promise<Response> {
  const options: CreateSiteborneMcpOptions = {
    health: { production_ready: false, production_enabled: false },
    allowedHosts: [...MCP_ALLOWED_HOSTS],
    allowedOrigins: [...MCP_ALLOWED_HOSTS],
  };

  if (context.env?.SELLER_WALLET_ADDRESS) {
    // SUN-1000 checkpoint 1O-A: now sourced from the same canonical
    // network constant and the official @x402/evm asset table as every
    // other first-party payment declaration (paid-services.ts,
    // discovery.ts) -- this file previously hand-typed both values
    // independently, and its asset address had drifted by one hex
    // character from the real, accepted Base Sepolia USDC contract
    // address every live-proof test uses
    // (...dCF7c here vs the correct ...dCF7e).
    options.quote = {
      network: PREPRODUCTION_NETWORK,
      asset: getDefaultAsset(PREPRODUCTION_NETWORK).address,
      payee: context.env.SELLER_WALLET_ADDRESS,
    };
  }

  return createSiteborneMcpHonoApp(options).fetch(context.req.raw);
}
