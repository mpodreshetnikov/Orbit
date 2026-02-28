# Verification: Local, Cloud, MCP

Use this checklist after instrumentation work.

## 1. Local Validation

1. Start observability stack: `obs-up`
2. Start app stack: `dev-ready`
3. Trigger the instrumented user workflow end-to-end.
4. Confirm logs in local Grafana/Loki (query by `app`, `component`, and message).
5. Confirm traces in local Tempo (search by `trace_id` found in logs).

Optional smoke sanity:

- `node scripts/observability/smoke-otlp.mjs`

## 2. Cloud Validation

1. Confirm cloud env vars are configured (`OBS_EXPORTER_MODE=cloud` and OTLP envs).
2. Trigger the same workflow in deployed environment.
3. In Grafana Cloud:
- Query logs by operation/component.
- Open trace via `trace_id`.
- Confirm frontend + backend + edge evidence is correlatable.

Reference:

- `docs/observability/grafana-cloud.md`

## 3. MCP Validation

1. Configure MCP env (`mcp/.env`) for:
- `grafana-local`
- `grafana-cloud`
- `tempo-local` (if local trace search through MCP is needed)
2. Run `mcp-sync`.
3. Use MCP query tools to retrieve logs for the operation in both local and cloud servers.
4. Retrieve trace evidence from Tempo by `trace_id`.

References:

- `docs/observability/mcp.md`
- `mcp/README.md`

## 4. Completion Criteria

Instrumentation is complete only if all are true:

- Frontend user interaction logs exist for the workflow.
- API/backend spans and logs exist and share correlation IDs.
- Supabase function logs exist for affected functions.
- DB mutation traceability anchor exists for key state changes.
- Evidence is queryable in local + cloud and reproducible via MCP.
