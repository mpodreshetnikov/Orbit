# Grafana Cloud Setup

This project uses env-only switching between local and cloud telemetry backends.

## Required Environment Variables

Use `.env.observability.example` as template.

- `OBS_EXPORTER_MODE=cloud`
- `OBS_OTLP_ENDPOINT` or explicit:
  - `OBS_OTLP_LOGS_ENDPOINT`
  - `OBS_OTLP_TRACES_ENDPOINT`
- `OBS_OTLP_HEADERS`
  - typically `Authorization=Basic <base64(instance_id:token)>`
- `OBS_ENV=prod` (or `staging`)
- `OBS_RELEASE=<git-sha-or-version>`

Optional hints:

- `OBS_GRAFANA_CLOUD_URL`
- `OBS_GRAFANA_CLOUD_OTLP_ENDPOINT`
- `OBS_GRAFANA_CLOUD_OTLP_HEADERS`

## Secret Handling Rules

- Never commit OTLP tokens or cloud auth headers.
- Never expose cloud OTLP secrets to browser or extension runtime.
- Browser and extension send telemetry only to `POST /api/observability/relay`.
- Relay forwards to cloud using server-side env vars.

## Production Ingestion Paths

- Node backend traces: exported by server OTel bootstrap (`src/instrumentation.ts`).
- Browser / extension logs: forwarded through relay endpoint.
- Supabase functions: structured logs include correlation fields and can be forwarded by platform log pipeline.

## Validation

1. Deploy with cloud env vars set.
2. Trigger one API action and one client action.
3. In Grafana Cloud:
   - Query logs in Loki using `app`/`component` fields.
   - Open trace by `trace_id` and verify related logs contain the same `trace_id`.
