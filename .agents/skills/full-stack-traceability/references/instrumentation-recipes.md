# Instrumentation Recipes

Project-specific implementation recipes for structured logs + OTLP traces.

## 1. Frontend Logging Recipe

Use `createClientTelemetryLogger`:

- File: `src/lib/observability/client-logger.ts`
- Current provider example: `src/components/providers/index.tsx`

Pattern:

```ts
const telemetry = createClientTelemetryLogger({
  app: "web",
  component: "feature-x",
});

telemetry.info("web_feature_x_action_started", {
  operation_name: "feature_x_action",
  ui_surface: "feature_x_panel",
});
```

For API calls initiated in frontend:

- Create correlation context via `telemetry.correlation()`.
- Forward `traceparent` to backend request headers when possible.
- Emit both success and failure logs with the same `operation_name`.

## 2. API / Backend Logging + Tracing Recipe

Use:

- `withServerSpan` from `src/lib/observability/server-otel.ts`
- `createServerLogger` from `src/lib/observability/server-logger.ts`

Pattern:

```ts
return withServerSpan("feature_x_action", async () => {
  const logger = createServerLogger({ component: "feature-x-route" });
  logger.info("api_feature_x_started", { operation_name: "feature_x_action" });
  // business logic
  logger.info("api_feature_x_completed", { operation_name: "feature_x_action" });
});
```

Error path:

- Log `logger.error(...)` with structured `error` and safe attrs.
- Re-throw or return structured error payload; do not swallow errors.

## 3. Supabase Edge Function Recipe

Use:

- `createEdgeLogEvent` and `logEdgeEvent` from `supabase/functions/_shared/observability.ts`

Pattern:

```ts
logEdgeEvent(
  createEdgeLogEvent("info", "edge_feature_x_started", {
    component: "edge-feature-x",
    requestId,
    traceId,
    attrs: { operation_name: "feature_x_action" },
  }),
);
```

Recommendations:

- Parse and propagate correlation headers where available.
- Emit start, significant step, completion, and failure logs.

## 4. DB Traceability Recipe

Prefer durable records over ephemeral text logs:

- Add or reuse append-only audit/event tables for key transitions.
- Store references useful for investigation:
  - `operation_name`
  - `request_id`
  - `trace_id`
  - `job_id`/`batch_id` for async flows
  - actor reference (`user_id_hash` equivalent if needed)

For schema changes:

- Add migration + `supabase/db` parity updates.
- Add pgTAP tests for new behavior.

## 5. Log Quality Rules

Always apply:

- Schema and required fields: `docs/observability/log-schema.md`
- PII/secrets restrictions: `docs/observability/log-schema.md`
- Error/debug expectations: `docs/design/common/error-handling-and-observability.md`
