# SITEBORNE MCP Server

<!-- mcp-name: net.siteborne/utility -->

Local stdio shim for the credential-independent SITEBORNE Utility Network MCP
server. It exposes exactly six tools over MCP `2026-07-28`. The four service
tools do not provide free production execution: without the accepted
paid-service boundary they return `payment_required`. Production remains
disabled.

This package is prepared for local pack/install verification only. It has not
been published to npm or the MCP Registry.

Client configuration after a future npm publication:

```json
{
  "mcpServers": {
    "siteborne": {
      "command": "npx",
      "args": ["-y", "@siteborne/mcp-server@0.1.0"]
    }
  }
}
```
