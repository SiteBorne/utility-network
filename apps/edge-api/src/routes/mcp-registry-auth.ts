import { Hono } from 'hono';

// SUN-1100 checkpoint 2: MCP Registry HTTP domain authentication
// (https://modelcontextprotocol.io/registry/authentication#http-authentication).
// Serves the public proof line at `/.well-known/mcp-registry-auth`, proving
// control of this domain to the registry so the canonical, already-declared
// (README.md "Protocols" section) `net.siteborne/utility` namespace can be
// claimed. This is a PUBLIC proof containing only the Ed25519 PUBLIC key --
// never the private key, which is generated and held entirely outside this
// repository and outside Cloudflare (per the registry's own spec, the
// private key only ever signs the `mcp-publisher login http` challenge
// locally; it is never transmitted to or stored by this Worker).
export const mcpRegistryAuthRoute = new Hono();

// The one-line proof format the registry's HTTP auth verifier expects:
// "v=MCPv1; k=ed25519; p=<base64 public key>". Content, not configuration --
// intentionally a plain constant (like the JWKS public key), not a secret.
const MCP_REGISTRY_AUTH_PROOF =
  'v=MCPv1; k=ed25519; p=83bYRFZWmy6sMovDCYprMgmpxAfo51V1JoWiaHFbzTs=';

mcpRegistryAuthRoute.get('/', (c) => {
  return c.text(`${MCP_REGISTRY_AUTH_PROOF}\n`);
});
