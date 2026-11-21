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

### OTLP / Loki shape

`eventToOtlpLogRecord` (`src/lib/observability/otlp-logs.ts`) exports:

- **body** — plain-text message (`mcp_tool_call_completed`, …); filter with `|= "…"`, not `| json | message=…`
- **top-level attributes** — `component`, `request_id`, `user_id_hash`, `app`, `env`, `release`
- **custom attrs** — prefixed `attrs.*` (`attrs.person_id`, `attrs.tool`, `attrs.grant_id`, `attrs.client_id`, `attrs.outcome`, `attrs.reason`, …)

One tool invocation reuses a single `request_id` on both start and completed lines.

### Attrs (scalars only)

- `tool` — registered tool name (e.g. `add_measurement`)
- `outcome` — `accepted` / `rejected` (auth) or `ok` / `error` (tool)
- `reason` — auth reject only: `missing_token`, `unknown`, `revoked`, `expired`, `not_allowlisted`
- `grant_id`, `client_id` — OAuth grant and client when known
- `person_id` — resolved person UUID (`withPerson`, args `person_id`, or person-owned row load); null when unresolved / not person-scoped
- `arg_keys` — sorted argument **keys** only (never values, names, or clinical content)
- `duration_ms` — wall time for the verify or tool call
- `token_hash_prefix` — first 8 hex of `sha256(bearer)` on rejects (correlates probes; not the secret)
- `user_id_hash` — top-level hashed auth user id (never raw email or user id)

Choke points: `src/lib/mcp/verify-token.ts`, `src/lib/mcp/tool-context.ts` (`withUserClient` / `withPerson`), tool name ALS from `installMcpToolNamePropagation` in `src/app/api/mcp/route.ts`.

## Grafana / Loki queries

Local stack: `just obs-up`, Explore → Loki (see `docs/observability/local.md`). Cloud: same LogQL against the Grafana Cloud Loki datasource.

After `| json`, dotted OTLP keys appear as fields named `attrs.person_id` (etc.). Use body match for the message.

### All connector activity for a person in a window

Replace the person UUID and time range in the UI.

```logql
{service_name="orbit"} |= "mcp_tool_call_completed" | json | component="mcp-tool" | attrs.person_id="<person-uuid>"
```

Narrow to writes by tool name:

```logql
{service_name="orbit"} |= "mcp_tool_call_completed" | json | component="mcp-tool" | attrs.person_id="<person-uuid>" | attrs.tool=~"add_measurement|add_medication|log_dose|update_medication|upsert_catalog_entry"
```

### What a grant or client did

```logql
{service_name="orbit"} |= "mcp_tool_call_" | json | component="mcp-tool" | attrs.grant_id="<grant-uuid>"
```

```logql
{service_name="orbit"} |~ "mcp_(auth_|tool_call_)" | json | component=~"mcp-auth|mcp-tool" | attrs.client_id="<client-id>"
```

### Failed auth / probing

```logql
{service_name="orbit"} |= "mcp_auth_rejected" | json | component="mcp-auth"
```

Group reasons (field name is the OTLP attribute `attrs.reason`):

```logql
sum by (`attrs.reason`) (
  count_over_time({service_name="orbit"} |= "mcp_auth_rejected" | json | component="mcp-auth" [15m])
)
```

### Correlate start + completed for one invocation

Copy `request_id` from either line (same value on both):

```logql
{service_name="orbit"} |~ "mcp_tool_call_(started|completed)" | json | component="mcp-tool" | request_id="<request-id>"
```

Also copy `trace_id` into Tempo search when a span is present (local Tempo: `http://127.0.0.1:3200`).

## Privacy rules

- Do **not** expect argument values, medication names, lab values, or emails in these logs.
- Prefer `user_id_hash` and `attrs.person_id` / `attrs.grant_id` for joins; never paste raw bearer tokens into queries.
- Durable in-app history (a `mcp_tool_calls` table) is intentionally deferred until log retention is proven insufficient; see task `T-0019` Decision Log.

## Related

- Health MCP design: `docs/design/domains/health/mcp-server.md`
- Log schema: `docs/observability/log-schema.md`
- Local LGTM: `docs/observability/local.md`
