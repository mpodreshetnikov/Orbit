---
name: full-stack-traceability
description: Implement and extend end-to-end observability for user and system operations across frontend, Next.js API/backend, Supabase Edge Functions, and Postgres. Use when building/refactoring features, fixing bugs, or adding workflows that require structured logs, OTLP traces, correlation IDs, and verified visibility in local/cloud Grafana and MCP.
---

# Full Stack Traceability

## Overview

Use this skill to make operations explainable during incidents and bug investigations.
Instrument every operation path from user action to DB mutation, with structured logs and OTLP traces that are queryable in local, cloud, and MCP workflows.

## Non-Negotiable Requirements

- Use the shared log schema and naming rules from `docs/observability/log-schema.md`.
- Emit structured logs at every contact point involved in an operation: frontend, API/backend, Supabase function, DB mutation boundary and eny external services.
- Emit OTLP traces for backend operations and async workflows.
- Propagate correlation fields (`trace_id`, `span_id`, `request_id`) across boundaries.
- Ensure browser/extension telemetry goes through `/api/observability/relay`.
- Keep logs and traces queryable in both local LGTM and Grafana Cloud, and reachable through MCP (`grafana-local`, `grafana-cloud`, `tempo-local` where applicable).
- Never log secrets or raw PII.

## Workflow

1. Map the operation path before coding
- List each hop for the target workflow: UI interaction -> API route -> Supabase function/RPC -> DB writes/read models.
- Define one stable operation name (`operation_name`) reused in logs and span names.

2. Instrument frontend user interactions
- Use `createClientTelemetryLogger` from `src/lib/observability/client-logger.ts`.
- Log user intent, major state transitions, success, and failure for each user-triggered workflow.
- Include operation metadata in `attrs` (`operation_name`, route/page, entity IDs when safe).
- For API calls, include `traceparent` or trace context so backend logs/traces can correlate.
- Follow the minimum event set in `references/touchpoint-coverage-matrix.md`.

3. Instrument API/backend spans and logs
- Wrap operation handlers with `withServerSpan` from `src/lib/observability/server-otel.ts`.
- Emit start/success/failure logs via `createServerLogger` from `src/lib/observability/server-logger.ts`.
- Preserve `request_id`; ensure log events include active `trace_id` and `span_id`.
- Add structured error logs with `error.name`, `error.message`, and safe `attrs`.

4. Instrument Supabase Edge Functions
- Use `createEdgeLogEvent` and `logEdgeEvent` from `supabase/functions/_shared/observability.ts`.
- Emit start/success/failure logs with consistent `component` and operation metadata.
- Propagate incoming correlation IDs when available, generate fallback IDs otherwise.

5. Add DB traceability for state-changing operations
- For important mutations, persist investigation anchors (for example: `operation_name`, `request_id`, `trace_id`, batch/job id, actor reference).
- Prefer append-only audit/event records over ad-hoc text logs.
- Ensure DB artifacts and pgTAP tests cover any new traceability objects.

6. Verify observability across local, cloud, and MCP
- Run local stack and validate both logs and traces for the operation.
- Validate cloud ingestion for the same operation path.
- Run MCP queries to confirm investigators can retrieve the same evidence without UI-only steps.
- Use `references/verification-local-cloud-mcp.md` as the execution checklist.

## References

- `references/touchpoint-coverage-matrix.md`: required events and traceability anchors per layer.
- `references/instrumentation-recipes.md`: concrete project-specific logging/tracing patterns.
- `references/verification-local-cloud-mcp.md`: command and query checklist for local/cloud/MCP validation.
