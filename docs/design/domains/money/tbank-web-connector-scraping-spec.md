# T-Bank Web Connector Scraping Spec

## Scope

- Source ID: `tbank_web`
- Target page: `https://www.tbank.ru/mybank/operations/`
- Goal: extract all operations from `windowFrom` onward with maximum available detail:
  - core operation payload,
  - receipt line items,
  - operation comment/message,
  - additional detail payloads available from operation detail view APIs.

## Investigation Evidence (Live)

- Investigation date: `2026-03-05`
- Method: Playwright CLI on a real authenticated account session.
- Confirmed list API:
  - `GET /api/common/v1/operations`
  - Required query params observed: `sessionid`, `start`, `end`, `appName`, `appVersion`, `origin`.
- Confirmed receipt API:
  - `GET /api/common/v1/shopping_receipt`
  - Query params: `operationId` (authorization/operation id), `sessionid`.
- Confirmed extra detail API from operation dialog:
  - `GET /api/common/v1/tranche_offers`
  - Query params observed: `sessionid`, `amount`, `appName`, `appVersion`, `platform`, `program_type`, `origin`, `wuid`.
- No stable standalone per-operation detail endpoint was observed in this session beyond list payload + receipt + tranche offers.

## Data Model Expectations

- Operation list payload contains:
  - `id`, `authorizationId`, `operationId`, `type`, `status`, `group`,
  - `description`, optional `message` (user comment),
  - `mcc`, `mccString`,
  - `amount`, `accountAmount` with currency metadata,
  - `operationTime`, `debitingTime`,
  - `hasShoppingReceipt`, `documents`,
  - `merchant`, `categoryInfo`, `loyaltyBonus`, `tags`, `additionalInfo`.
- Receipt payload contains:
  - `payload.receipt.items[]` with at least `name`, `price`, `sum`, `quantity`.

## Scraping Strategy

1. API-first extraction (primary):
   - Discover latest operations API URL from performance resource entries.
   - Preserve all existing query params from discovered URL.
   - Replace only date range params (`start`, `end`) with connector chunk windows.
   - Build backward chunk ranges from `now` down to `windowFrom` (default chunk = 14 days).
2. Per-operation enrichment:
   - Fetch `shopping_receipt` when operation indicates receipt availability.
   - Fetch `tranche_offers` when a base endpoint is discoverable in resources.
3. DOM fallback:
   - Parse visible operation cards when API path fails.
   - Return canonical minimal rows with `all_details_captured=false`.

## Canonical Mapping Rules

- `posted_at`: `operation.operationTime.milliseconds` fallback to `debitingTime` then `operationDateTime`.
- `amount`: from `accountAmount.value` fallback `amount.value`; sign from `type` (`Debit` negative, `Credit` positive).
- `comment`: prefer `operation.message`, fallback to available detail payload comments.
- `line_items`: from receipt items; fallback to a single synthetic item with transaction amount.
- `raw_payload` must include:
  - `operation`,
  - `shopping_receipt` (nullable),
  - `tranche_offers` (nullable),
  - any other discovered detail payloads,
  - metadata fields (`connector_source`, `extraction_method`, `all_details_captured`, `account_hint`).

## Blocking / Poison Pills

- Treat as blocked with clear message:
  - unauthorized/login screen,
  - CAPTCHA/human verification/rate limiting screen.

## Notes

- Session-specific params (`sessionid`, `wuid`) are ephemeral and must always be discovered at runtime.
- Keep source contract unchanged for importer (`sourceId=tbank_web`, canonical row schema).

## Local Debug Commands (CLI-first)

Use command IDs from `AGENTS.md`:

- Generic source-parameterized flow (recommended for new connectors):
  - `just extension-debug-live <source_id>`
  - `just extension-debug-live-full <source_id>`
  - `just extension-debug-analyze <source_id> [artifact_path]`
  - `just extension-debug-report <source_id> [artifact_path]`
  - `extension-debug-live` auto-generates machine diagnostics and human-readable report artifacts.
- Live extension debug run for T-Bank:
  - `just extension-debug-live tbank_web`
  - Runner auto-checks auth state on target page:
    - If authenticated session is present, it continues parsing automatically.
    - If login/challenge is detected, interactive run prompts for manual completion.
    - In non-interactive mode, it fails fast with an actionable auth-required error.
  - Optional flags:
    - `--window-from <ISO datetime>`
    - `--playwright-session <name>`
    - `--wait-for-manual <seconds>` (auto-continue after timeout)
    - `--full-run` (disable parse-only mode; parse-only is default)
- Analyze latest or explicit artifact:
  - `just extension-debug-analyze tbank_web`
  - `just extension-debug-analyze tbank_web .tmp/scraper-debug/tbank/<timestamp>-<run_id>`
- Generate human-readable validation report:
  - `just extension-debug-report tbank_web`
  - `just extension-debug-report tbank_web .tmp/scraper-debug/tbank/<timestamp>-<run_id>`
- Agent/self-verification loop (after one successful login persisted in Playwright profile):
  - `just extension-debug-live tbank_web`
  - `just extension-debug-analyze tbank_web`
  - `just extension-debug-report tbank_web`
- Standalone API capture helper:
  - `npx tsx scripts/extension/playwright-cli-capture-tbank-apis.ts --source tbank_web --playwright-session <name>`

## Debug Artifact Contract

- Artifact root: `.tmp/scraper-debug/<normalized_source>/<timestamp>-<run_id>/` (for T-Bank: `.tmp/scraper-debug/tbank/...`)
- The live runner writes:
  - `artifact.json` (full bundle)
  - `run-response.json` (background message response)
  - `debug-run.json` (event stream + run summary)
  - `parse-output.json` (connector parse payload)
  - `network-captures.json` (`/api/common/v1/*` responses)
  - `summary.json` (quick local metrics)
- Analyzer writes:
  - `diagnostics.json` with machine-readable gates and category codes:
    - `AUTH_BLOCKED`
    - `API_DISCOVERY_MISSED`
    - `API_4XX_5XX`
    - `DOM_SELECTOR_DRIFT`
    - `MAPPING_DROP`
  - `report.md` with readable parsing summary, row-level issue table, and row preview
  - `rows-preview.csv` with flattened row preview for spreadsheet/manual validation
