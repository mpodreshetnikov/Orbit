# Touchpoint Coverage Matrix

Use this matrix as a completion gate for any operation you instrument.
Mark each row as done, n/a, or follow-up with reason.

## 1. Frontend (User Contact)

Required for any workflow triggered by user interaction.

| Event Phase | Required Signal | Minimum Fields |
| --- | --- | --- |
| User intent (click/submit/action) | Structured log | `message`, `component`, `operation_name`, `session_id`, route/screen |
| Request start | Structured log | `operation_name`, `target` (API/RPC), `request_id` (if generated client-side) |
| Request success | Structured log | `operation_name`, outcome/status, relevant entity IDs (safe only) |
| Request failure | Structured log | `operation_name`, error fields, status/result code |

Rules:
- Use stable message names (snake_case).
- Put variable details in `attrs`.
- Never log raw PII/secrets.

## 2. API / Next Backend

| Event Phase | Required Signal | Minimum Fields |
| --- | --- | --- |
| Handler entry | Span + structured log | span name = `operation_name`, `request_id`, `trace_id` |
| Key branch/state transition | Structured log | `operation_name`, branch/outcome attributes |
| External call / DB/RPC call | Span child or log | target, result status, latency when available |
| Handler exit success | Structured log | `operation_name`, status, elapsed summary |
| Handler exit failure | Structured error log + span status error | error object + safe attrs |

## 3. Supabase Edge Functions

| Event Phase | Required Signal | Minimum Fields |
| --- | --- | --- |
| Function start | Structured log | function/component, `request_id`, `trace_id`, operation metadata |
| Important step(s) | Structured log | step name and result attributes |
| Function completion | Structured log | success/failure status |

Rules:
- Reuse incoming `trace_id`/`request_id` if present.
- Generate fallback IDs when absent.

## 4. Database (Mutation Traceability)

When DB state changes are part of the operation, keep a durable traceability anchor in DB state.

| Mutation Type | Required Traceability |
| --- | --- |
| User-initiated write | Store `operation_name` + request/trace reference in event/audit row or metadata |
| Batch/import/cron write | Store batch/job id + request/trace reference |
| High-risk business transition | Add explicit audit/event row with actor + before/after summary |

Rules:
- Prefer append-only event/audit rows for investigation history.
- Avoid free-text blobs as the only evidence source.
