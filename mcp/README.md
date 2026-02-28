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
- Grafana MCP generation is opt-in per target:
  - `MCP_GRAFANA_LOCAL_ENABLED=1` generates `grafana-local`.
  - `MCP_GRAFANA_CLOUD_ENABLED=1` generates `grafana-cloud`.
- Both Grafana MCP servers run `grafana/mcp-grafana` over stdio; only URL/token/org env values differ per target.
- Tempo MCP generation is opt-in:
  - `MCP_TEMPO_LOCAL_ENABLED=1` generates `tempo-local` pointing to local Tempo MCP endpoint.

## IDE Install Flow

1. Copy `mcp/.env.example` to `mcp/.env`.
2. Fill required values in `mcp/.env`.
3. Run `mcp-sync` from `AGENTS.md`.
4. Open IDE MCP settings.
5. Confirm generated MCP servers are available.
6. If the IDE supports OAuth and prompts for login, complete OAuth in the IDE.

### Grafana MCP (Option A: Two Stdio Servers, Recommended)

1. Configure local target in `mcp/.env`:
   - `MCP_GRAFANA_LOCAL_ENABLED=1`
   - `GRAFANA_LOCAL_URL=http://localhost:3300` (or your local Grafana port)
   - `GRAFANA_LOCAL_SERVICE_ACCOUNT_TOKEN=<token>`
   - optional `GRAFANA_LOCAL_ORG_ID=<org-id>`
2. Configure cloud target in `mcp/.env`:
   - `MCP_GRAFANA_CLOUD_ENABLED=1`
   - `GRAFANA_CLOUD_URL=https://<stack>.grafana.net`
   - `GRAFANA_CLOUD_SERVICE_ACCOUNT_TOKEN=<token>`
   - optional `GRAFANA_CLOUD_ORG_ID=<org-id>`
3. Re-run `mcp-sync` to regenerate client MCP configs.
4. Confirm your client sees separate servers: `grafana-local` and `grafana-cloud`.

### Tempo MCP (Local HTTP Server)

1. Configure local target in `mcp/.env`:
   - `MCP_TEMPO_LOCAL_ENABLED=1`
2. Ensure local Tempo MCP endpoint is reachable:
   - `http://localhost:3200/api/mcp`
3. Re-run `mcp-sync` to regenerate client MCP configs.
4. Confirm your client sees `tempo-local`.

### Create Grafana MCP Tokens via API

Grafana MCP token generation commands are local-only.

1. Set local API auth + service account settings in `mcp/.env` (or pass CLI flags):
   - default: `GRAFANA_LOCAL_API_AUTH_MODE=basic`, `GRAFANA_LOCAL_ADMIN_USER=admin`, `GRAFANA_LOCAL_ADMIN_PASSWORD=admin`
   - service account defaults: `GRAFANA_LOCAL_SERVICE_ACCOUNT_NAME=mcp-local`, `GRAFANA_LOCAL_SERVICE_ACCOUNT_ROLE=Viewer`
   - optional override: use bearer mode via `GRAFANA_LOCAL_BOOTSTRAP_TOKEN`
2. Create token:
   - `just mcp-grafana-token-create [service_account_id] [token_name]`
3. Optional metadata-only check:
   - `just mcp-grafana-token-list [service_account_id]`

The helper script calls:

- `GET /api/serviceaccounts/:id/tokens` to list token metadata.
- `POST /api/serviceaccounts/:id/tokens` to create a token.

`POST` returns the token `key` (secret) once at creation time. `GET` does not return token secrets.

Auth behavior:

- In `auto` mode the script prefers bearer token auth when a bootstrap token is present.
- Otherwise it falls back to basic auth.
- Basic auth defaults to `admin/admin` unless overridden.
- If service account id is omitted, the script looks for `mcp-local` and creates it automatically when missing.

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
