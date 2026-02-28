# Grafana MCP Setup

This repo supports Grafana MCP through canonical MCP config sync.

## Enable Grafana MCP in Repo Config (Two Servers)

1. Copy `mcp/.env.example` to `mcp/.env`.
2. Configure local MCP server:
   - `MCP_GRAFANA_LOCAL_ENABLED=1`
   - `GRAFANA_LOCAL_URL=http://localhost:3300` (or your local Grafana port)
   - `GRAFANA_LOCAL_SERVICE_ACCOUNT_TOKEN=<token>`
   - optional `GRAFANA_LOCAL_ORG_ID=<org-id>`
3. Configure cloud MCP server:
   - `MCP_GRAFANA_CLOUD_ENABLED=1`
   - `GRAFANA_CLOUD_URL=https://<stack>.grafana.net`
   - `GRAFANA_CLOUD_SERVICE_ACCOUNT_TOKEN=<token>`
   - optional `GRAFANA_CLOUD_ORG_ID=<org-id>`
4. Run:

   `just mcp-sync`

This generates local client MCP files (`.mcp.json`, `.cursor/mcp.json`, `.codex/config.toml`) with separate `grafana-local` and `grafana-cloud` servers.

## Enable Tempo MCP (Local)

1. In `mcp/.env`:
   - `MCP_TEMPO_LOCAL_ENABLED=1`
2. Ensure local Tempo endpoint is reachable:
   - `http://localhost:3200/api/mcp`
3. Run:

   `just mcp-sync`

This adds `tempo-local` to generated client MCP files.

## Pattern

Use Option A: two stdio MCP entries. Each entry runs its own `grafana/mcp-grafana` process with different env values. The implementation is the same for local and cloud; only URL/token/org values differ.

## Create Grafana API Tokens for MCP

Script:

`npx tsx scripts/mcp/create-grafana-mcp-token.ts --help`

Recommended command IDs:

- `just mcp-grafana-token-create [service_account_id] [token_name]`
- `just mcp-grafana-token-list [service_account_id]`

Token generation scope:

- This helper supports local Grafana token generation only.

Auth defaults:

- Local helper default is basic auth (`admin/admin` in local LGTM image).
- You can override with script flags: `--auth-mode basic|bearer`, `--username`, `--password`, `--bootstrap-token`.
- If `service_account_id` is omitted, the script looks up `mcp-local` and auto-creates it when missing.

The script uses Grafana API token endpoints:

- `GET /api/serviceaccounts/:id/tokens` to list metadata
- `POST /api/serviceaccounts/:id/tokens` to create token and return secret key

Token secret handling rule:

- Treat the returned token key as one-time visible.
- Store it securely immediately.
- Do not expect `GET /api/serviceaccounts/:id/tokens` to return token secret values later.

## Required Permissions (Minimum for Loki Queries)

- `datasources:read`
- `datasources:query`
- Scope to Loki datasource UID where possible.

## Smoke Query Example

Use MCP Loki query tool (for example `query_loki_logs`) with:

- Query: `{app="api"} |= "medication_action"`
- Time range: last 15 minutes

For local smoke script output:

- Query: `{service_name="orbit"} |= "obs-smoke-log"`

Then open Tempo and search by emitted `trace_id`.
