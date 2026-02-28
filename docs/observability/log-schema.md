# Shared Log Schema

All runtimes (web, api, extension, supabase-function) use the same JSON log schema.

## Required Fields

- `timestamp` (ISO-8601)
- `level` (`debug` | `info` | `warn` | `error`)
- `message`
- `app` (`web` | `api` | `extension` | `supabase-function`)
- `component`
- `env` (`local` | `staging` | `prod`)
- `release` (git SHA/version string)
- `trace_id` (32-char lowercase hex)
- `request_id`

## Optional Fields

- `span_id` (16-char lowercase hex)
- `session_id`
- `user_id_hash` (hashed identifier only)
- `error` object:
  - `name`
  - `message`
  - `stack` (optional)
  - `code` (optional)
  - `cause` (optional)
- `attrs` object with scalar values only (`string`, `number`, `boolean`, `null`)

## Correlation Rules

- Generate or propagate `trace_id`, `span_id`, `request_id` at ingress.
- When `traceparent` exists, parse and reuse its IDs.
- Every emitted log in a request/operation should carry the same `trace_id`.

## Naming Rules

- Use snake_case keys.
- Keep `message` stable and short; put variable details in `attrs`.
- Do not create per-feature key variants for core fields.

## PII and Secrets Policy

- Never log raw emails, phone numbers, tokens, passwords, cookies, or Authorization headers.
- Use `user_id_hash` instead of raw user identifiers where needed.
- Relay endpoint rejects payloads containing forbidden secret/PII field names.
