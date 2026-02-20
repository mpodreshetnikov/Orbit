# Money Import Framework (File And Extension)

## Intent

Document the end-to-end import architecture including connector parsing, extension bridge, session tokens, dedupe, and idempotent persistence.

## Current Implementation In This Repo

### Connector and parsing layers

- Web connector registry:
  - `src/lib/import/connector-types.ts`
  - `src/lib/import/connectors/tbank-csv.ts`
  - `src/lib/import/connectors/tbank-web.ts`
- Extension connector registry:
  - `browserExtension/src/connectors/registry.ts`
  - `browserExtension/src/connectors/tbank-web.ts`

### Session and apply pipeline

1. User starts import on `src/app/money/import/page.tsx`.
2. App calls `money-import` with `create_session`.
3. Session token and metadata are bridged to extension via content/background messaging.
4. Extension parses source rows and calls `apply_rows`.
5. Edge function persists batch rows and canonical records idempotently.
6. Completion state is reported and shown in batch report page.

### Persistence and reporting

- session and batch tables:
  - `money_import_sessions`
  - `money_import_batches`
  - `money_import_batch_rows`
- report view route:
  - `src/app/money/import/reports/[batchId]/page.tsx`

### Dedupe and idempotency strategy

- Session-level idempotency:
  - `create_session` returns a short-lived token backed by `money_import_sessions.token_hash`.
  - `apply_rows` validates token hash + expiry before writes.
- Transaction-level idempotency:
  - SQL function `money_upsert_transactions_batch` applies canonical rows.
  - Conflict path 1: `ON CONFLICT (source, external_id)` when external ID is present.
  - Conflict path 2: `ON CONFLICT (dedupe_hash)` when external ID is absent.
- Apply behavior:
  - each row receives explicit status output in `money_import_batch_rows`,
  - duplicate/missing-key rows are reported, not silently dropped.

### Reporting and reconciliation boundaries (current)

- In scope:
  - import session audit trail,
  - per-batch and per-row apply outcomes,
  - transaction/line-item persistence with provenance fields.
- Current limits:
  - no full double-entry accounting model,
  - no automatic cross-account settlement reconciliation,
  - connector coverage focused on current T-Bank pathways,
  - reconciliation remains user-driven through reports and transaction editing.

## Rules To Follow

1. Connector output must normalize into canonical row shape before apply.
2. Session tokens must be short-lived and revocable.
3. Import apply should be idempotent on `external_id` or `dedupe_hash`.
4. Every apply operation should emit row-level result statuses for traceability.
5. Extension and web connectors must keep source IDs aligned.

## Anti-Patterns To Avoid

- Source-specific persistence logic bypassing canonical shape.
- Long-lived reusable import tokens.
- Silent skipping without row-level report artifacts.

## Tradeoffs

- Extension-based web export broadens ingestion possibilities but adds browser runtime complexity.
- Rich row-level reporting improves auditability but increases write volume and model complexity.

## Known Gaps And Next Refactor Targets

- `money-import` edge function is large and should be decomposed into modules.
- Add broader connector coverage with the same canonical contracts.
- Strengthen automated test scenarios for import idempotency and extension bridge behavior.

## References

- `supabase/functions/money-import/index.ts`
- `browserExtension/src/background.ts`
- `src/types/import.ts`
