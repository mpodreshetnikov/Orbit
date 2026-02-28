# Local Setup (Self-Hosted LGTM)

## Start / Stop

1. Start stack:

   `just obs-up`

2. Stop stack:

   `just obs-down`

3. Start full local app with auto observability:

   `just dev-ready-local`

4. Stop full local app with auto observability cleanup:

   `just dev-local-stop`

Disable lifecycle auto-start/stop:

- `OBS_AUTO=0 just dev-ready-local`
- `OBS_AUTO=0 just dev-local-stop`

## Local Endpoints

- Grafana UI: `http://127.0.0.1:3300`
- Tempo API: `http://127.0.0.1:3200`
- Tempo MCP endpoint: `http://127.0.0.1:3200/api/mcp`
- OTLP gRPC ingest: `http://127.0.0.1:4317`
- OTLP HTTP ingest: `http://127.0.0.1:4318`
- App logs relay: `POST /api/observability/relay`
- App traces relay: `POST /api/observability/relay/traces`

Default Grafana credentials in local LGTM image:

- user: `admin`
- password: `admin`

## Smoke Validation

Run:

`node scripts/observability/smoke-otlp.mjs`

This emits:

- one OTLP log record (`obs-smoke-log`)
- one OTLP trace span (`obs-smoke-trace`)

It prints `trace_id` and `span_id` for lookup.

### Query in Grafana

1. Open Explore and pick Loki datasource.
2. Run LogQL:

   `{service_name="orbit"} |= "obs-smoke-log"`

3. Open Tempo and search by `trace_id` from smoke output.

## Frontend -> Edge -> RPC Correlation Check

Run one web flow that calls edge functions and/or Supabase RPC (for example OCR, structure extraction, ICD lookup, or money import), then:

1. In Loki, search for one known operation log:

   `{service_name="orbit"} | json | message=~"edge_function_request_started|supabase_rpc_started"`

2. Capture `trace_id` and `request_id` from that log line.
3. In Tempo, open the same `trace_id` and verify spans like:
   - `web.edge_function.<operation>`
   - `web.supabase.rpc.<rpc_name>`
   - `edge.<function>.*`
4. Confirm the same `trace_id` appears in:
   - frontend structured logs,
   - edge function structured logs,
   - trace spans.

If one surface is missing, validate outbound headers include `traceparent` and `x-request-id`.

## Troubleshooting

- Port collision (`3300`, `3200`, `4317`, `4318`): stop conflicting services or remap ports in `docker-compose.observability.yml`.
- OTLP protocol mismatch: use OTLP HTTP endpoint `4318` for `/v1/logs` and `/v1/traces`.
- Logs accepted but not queryable: ensure required labels/attributes are present (`app`, `component`, `env`, `release`).
- CORS/CSP from browser/extension: send client telemetry to `/api/observability/relay` instead of direct collector calls.
