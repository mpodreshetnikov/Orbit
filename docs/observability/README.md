# Observability

This repo uses one telemetry model across environments:

- Local backend: `grafana/otel-lgtm` (logs + traces).
- Cloud backend: Grafana Cloud OTLP.
- Same log schema and correlation fields in all environments.
- Browser and extension telemetry route through server relays so cloud ingest secrets are never exposed client-side.

## Correlation Model

Every operation should carry these fields end-to-end:

- `trace_id`
- `span_id`
- `request_id`

Headers used for propagation:

- `traceparent`
- `x-request-id`

Frontend-origin spans and request IDs are propagated into:

- Supabase Edge Functions (`/functions/v1/*`)
- Supabase REST RPC calls (`/rest/v1/rpc/<name>`)

Edge Functions continue the incoming trace where provided, or create a deterministic new trace context when missing/malformed.

## Minimal Commands

- `obs-up` starts local Grafana LGTM stack.
- `obs-down` stops local Grafana LGTM stack.

Local app lifecycle integration:

- `dev-ready` starts observability automatically (default).
- `dev-stop` stops observability automatically (default).
- Set `OBS_AUTO=0` to disable automatic obs startup/shutdown for local lifecycle commands.

## Key Files

- Compose stack: `docker-compose.observability.yml`
- Env template: `.env.observability.example`
- Logs relay endpoint: `src/app/api/observability/relay/route.ts`
- Traces relay endpoint: `src/app/api/observability/relay/traces/route.ts`
- Shared schema/helpers: `shared/lib/observability/*`
- Next tracing bootstrap: `src/instrumentation.ts`
- Browser tracing helper: `src/lib/observability/client-tracer.ts`
- Frontend edge fetch instrumentation: `src/lib/observability/edge-function-fetch.ts`
- Edge function observability core: `supabase/functions/_shared/observability.ts`

See:

- [Local Setup](./local.md)
- [Grafana Cloud Setup](./grafana-cloud.md)
- [Log Schema](./log-schema.md)
- [MCP Setup](./mcp.md)

## Troubleshooting Checklist

- Port already in use (`3300`, `4317`, `4318`).
- OTLP endpoint mismatch (HTTP vs gRPC path/protocol).
- Browser/extension CORS or CSP failures.
- Missing/invalid cloud auth token in `OBS_OTLP_HEADERS`.
- Logs accepted but not queryable due to label/attribute mapping.
- Browser/extension accidentally configured to send directly to cloud ingest using secrets (must use relay).
- Missing `traceparent`/`x-request-id` headers on outgoing frontend requests.
- Trace visible in Tempo but logs missing correlation fields (`trace_id`, `request_id`) on one side of the workflow.
