# Error Handling And Observability

## Intent

Define consistent failure handling and operational visibility expectations across app, edge, and database workflows.

## Current Implementation In This Repo

- UI-level error feedback uses toasts and status labels in hooks/components.
- Health pipeline errors persist status and message (`ocr_failed`, `ocr_error`).
- API routes often return structured error payloads with status codes.
- Cron and function triage is documented in `docs/RUNBOOK.md`.

## Rules To Follow

1. Preserve structured errors for API/edge responses.
2. Persist workflow state transitions needed for user recovery.
3. Ensure error messages support next-step actions.
4. Add runbook references for new operational failure modes.
5. For critical workflows, include manual verification queries/commands.
6. **Always add debug information**: Include contextual IDs (record, batch, user, session), operation names, and error context in logs and error payloads. See [`docs/RUNBOOK.md`](../../RUNBOOK.md#debug-information).

## Debug Information (Always Add)

Add debug information as much as possible to support triage and incident recovery:

- **Errors**: Never swallow errors. Log with context (IDs, operation name) and include `cause` when rethrowing.
- **Entry/exit**: Log significant operations at start and completion with relevant IDs.
- **State changes**: Log workflow state transitions so logs can be correlated with DB state.
- **API/edge responses**: Include `message`, `code`, and optional `details` (IDs, validation errors) in error payloads.
- **Secrets**: Never log secrets, tokens, or PII beyond necessary identifiers (e.g. record ID, not full record).

## Anti-Patterns To Avoid

- Swallowing errors without logs, status updates, or user feedback.
- Returning ambiguous HTTP 500 responses for expected validation errors.
- Introducing workflow states not documented in types and UI.

## Tradeoffs

- Rich client messaging improves supportability but can expose internal noise if not curated.
- Lightweight logging is simple but less powerful than centralized structured telemetry.

## Known Gaps And Next Refactor Targets

- No consolidated metrics pipeline for quality scoring of runtime failures.
- Some large files contain mixed concerns (happy path, retries, UI rendering).

## References

- `src/hooks/use-background-ocr.ts`
- `src/hooks/use-structure-extraction.ts`
- `src/app/api/notifications/run-cron/route.ts`
- [`docs/RUNBOOK.md`](../../RUNBOOK.md)
