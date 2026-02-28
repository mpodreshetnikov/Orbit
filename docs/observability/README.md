# Observability

This repo uses one telemetry model across environments:

- Local backend: `grafana/otel-lgtm` (logs + traces).
- Cloud backend: Grafana Cloud OTLP.
- Same log schema and correlation fields in all environments.
- Browser and extension telemetry route through server relay (`/api/observability/relay`) so cloud ingest secrets are never exposed client-side.

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
- Relay endpoint: `src/app/api/observability/relay/route.ts`
- Shared schema/helpers: `shared/lib/observability/*`
- Next tracing bootstrap: `src/instrumentation.ts`

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
