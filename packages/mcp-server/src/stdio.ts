import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createSiteborneMcpServer } from '@siteborne/protocol-mcp';

serveStdio(
  () =>
    createSiteborneMcpServer({
      health: { production_ready: false, production_enabled: false },
    }),
  {
    legacy: 'reject',
    onerror(error) {
      console.error('SITEBORNE MCP stdio error:', error.message);
    },
  }
);
