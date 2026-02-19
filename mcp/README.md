# MCP Setup

This folder is the canonical source for MCP server definitions.

- Canonical server list: `mcp/servers.canonical.json`
- Local MCP env file: `mcp/.env` (gitignored)
- MCP env template: `mcp/.env.example`
- Sync command ID: `mcp-sync` from `AGENTS.md`

## Auth Policy

- PAT is the default mode for generated configs (`MCP_GITHUB_AUTH_MODE=pat`).
- OAuth is preferred when your IDE/agent supports native OAuth flow.
- To prefer OAuth generation, set `MCP_GITHUB_AUTH_MODE=oauth` in `mcp/.env`.

## IDE Install Flow

1. Copy `mcp/.env.example` to `mcp/.env`.
2. Fill required values in `mcp/.env`.
3. Run `mcp-sync` from `AGENTS.md`.
4. Open IDE MCP settings.
5. Confirm generated MCP servers are available.
6. If the IDE supports OAuth and prompts for login, complete OAuth in the IDE.

## Extension Install Flow (Codex and similar)

1. Complete the same steps as IDE flow (env + sync).
2. Open the generated local config that matches your client:
   - Claude Code: `.mcp.json`
   - Cursor: `.cursor/mcp.json`
   - Codex project config: `.codex/config.toml`
3. Copy the relevant MCP server block from generated config.
4. Paste it into the extension/client native MCP settings file.
   - Example global Codex file on Windows: `C:\Users\<you>\.codex\config.toml`
5. Reload/restart the extension and verify MCP server availability.

## Notes

- Generated client configs are local-only and gitignored.
- Never commit secrets or tokens.
- CI runs secret preflight scans on pushed commit ranges.
