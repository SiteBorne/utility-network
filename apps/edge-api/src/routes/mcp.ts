import { createSiteborneMcpHonoApp, type CreateSiteborneMcpOptions } from '@siteborne/protocol-mcp';
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
    options.quote = {
      network: 'eip155:84532',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7c',
      payee: context.env.SELLER_WALLET_ADDRESS,
    };
  }

  return createSiteborneMcpHonoApp(options).fetch(context.req.raw);
}
