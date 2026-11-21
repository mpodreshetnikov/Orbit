# MCP Connector Usage Audit

How to answer **what did the connector do to this person's data between X and Y** from structured logs.

## What is emitted

Every MCP bearer check and every tool call writes a shared-schema log line (`docs/observability/log-schema.md`) via `createServerLogger`, forwarded to OTLP / Loki.

| Message                   | Component  | When                                                          |
| ------------------------- | ---------- | ------------------------------------------------------------- |
| `mcp_auth_accepted`       | `mcp-auth` | Bearer verified, grant usable, user still allowlisted         |
| `mcp_auth_rejected`       | `mcp-auth` | Missing / unknown / revoked / expired / not_allowlisted token |
| `mcp_tool_call_started`   | `mcp-tool` | Tool handler entered (`withUserClient`)                       |
| `mcp_tool_call_completed` | `mcp-tool` | Tool returned `ok` or `error` (including contained throws)    |

### Attrs (scalars only)

- `tool` — registered tool name (e.g. `add_measurement`)
- `outcome` — `accepted` / `rejected` (auth) or `ok` / `error` (tool)
- `reason` — auth reject only: `missing_token`, `unknown`, `revoked`, `expired`, `not_allowlisted`
- `grant_id`, `client_id` — OAuth grant and client when known
- `person_id` — resolved person UUID after `withPerson` (null when unresolved or not person-scoped)
- `arg_keys` — sorted argument **keys** only (never values, names, or clinical content)
- `duration_ms` — wall time for the verify or tool call
- `token_hash_prefix` — first 8 hex of `sha256(bearer)` on rejects (correlates probes; not the secret)
- `user_id_hash` — top-level hashed auth user id (never raw email or user id)

Choke points: `src/lib/mcp/verify-token.ts`, `src/lib/mcp/tool-context.ts` (`withUserClient` / `withPerson`), tool name ALS from `installMcpToolNamePropagation` in `src/app/api/mcp/route.ts`.

## Grafana / Loki queries

Local stack: `just obs-up`, Explore → Loki (see `docs/observability/local.md`). Cloud: same LogQL against the Grafana Cloud Loki datasource.

### All connector activity for a person in a window

Replace the person UUID and time range in the UI (or `| person_id="<uuid>"`).

```logql
{service_name="orbit"} | json | component="mcp-tool" | message="mcp_tool_call_completed" | person_id="<person-uuid>"
```

Narrow to writes by tool name:

```logql
{service_name="orbit"} | json | component="mcp-tool" | message="mcp_tool_call_completed" | person_id="<person-uuid>" | tool=~"add_measurement|add_medication|log_dose|update_medication|upsert_catalog_entry"
```

### What a grant or client did

```logql
{service_name="orbit"} | json | component="mcp-tool" | grant_id="<grant-uuid>"
```

```logql
{service_name="orbit"} | json | component=~"mcp-auth|mcp-tool" | client_id="<client-id>"
```

### Failed auth / probing

```logql
{service_name="orbit"} | json | component="mcp-auth" | message="mcp_auth_rejected"
```

Group reasons:

```logql
sum by (reason) (count_over_time({service_name="orbit"} | json | message="mcp_auth_rejected" [15m]))
```

### Correlate with traces

Log lines carry `trace_id` / `request_id`. Copy `trace_id` from a `mcp_tool_call_completed` line into Tempo search (local Tempo: `http://127.0.0.1:3200`).

## Privacy rules

- Do **not** expect argument values, medication names, lab values, or emails in these logs.
- Prefer `user_id_hash` and `person_id` / `grant_id` for joins; never paste raw bearer tokens into queries.
- Durable in-app history (a `mcp_tool_calls` table) is intentionally deferred until log retention is proven insufficient; see task `T-0019` Decision Log.

## Related

- Health MCP design: `docs/design/domains/health/mcp-server.md`
- Log schema: `docs/observability/log-schema.md`
- Local LGTM: `docs/observability/local.md`
