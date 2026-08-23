---
id: T-0022
title: Make production edge-function telemetry actually reach Grafana Cloud instead of a local address
status: open
kind: debt
priority: p2
depth: note
created: 2026-08-23
updated: 2026-08-23
owner: TBD
tags: [observability, supabase, functions, deployment]
exit: "A span emitted by a production Supabase Edge Function is visible in Grafana Cloud carrying env=prod and release set to the deployed commit, correlated by request_id to the frontend span for the same request, and a misconfigured exporter is reported rather than silently swallowed"
---

# Make production edge-function telemetry actually reach Grafana Cloud instead of a local address

## Context

Production edge functions emit telemetry to `http://127.0.0.1:4318` and nothing is listening there,
so none of it leaves the container. It has never worked; this is not a regression.

The chain is three defaults, none of which are overridden in production:

1. `supabase/functions/_shared/observability.ts:128` — `resolveMode()` returns `"cloud"` only when
   `OBS_EXPORTER_MODE === "cloud"`, otherwise `"local"`. The variable is not set on the production
   functions, so the mode is `local`.
2. `observability.ts:145-155` and `:157-168` — in `local` mode both the logs and traces endpoints
   fall back to `LOCAL_OTLP_DEFAULT_HTTP_ENDPOINT`, which is `http://127.0.0.1:4318`
   (`observability.ts:5`). Inside the Supabase edge runtime that address serves nothing.
3. `logEdgeEvent` (`observability.ts:346-348`) forwards with
   `void forwardLogEventToOtlp(event).catch(() => {})`. The fetch fails on every event and the
   failure is discarded, so the misconfiguration produces no signal of its own.

Confirmed against production on 2026-08-22: every telemetry line from `health-ocr` and
`notifications-cron` in the Supabase logs carries `"env":"local","release":"dev-local"`. Those are
the hardcoded fallbacks at `observability.ts:337-338` and `:370-371`, which — unlike the web side at
`src/lib/observability/config.ts:80`, which falls back to `prod` when `NODE_ENV === "production"` —
have no production fallback at all. So even if the exporter were pointed at Grafana Cloud today,
production data would arrive labelled as a developer's laptop and could not be correlated to a
release.

Nothing in the deployment path would set these. `scripts/just/deploy-supabase.cjs:69-73` runs
`supabase functions deploy`, `supabase db push` and `supabase/db/run-deploy.js` — there is no
`supabase secrets set` step anywhere in the repository, and `.github/workflows/main.yml:334-350`
passes only `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and `DATABASE_URL`.

The documentation asserts the opposite of what happens.
`docs/observability/grafana-cloud.md:9-16` lists `OBS_EXPORTER_MODE=cloud`, `OBS_ENV=prod`,
`OBS_RELEASE`, `OBS_OTLP_ENDPOINT` and `OBS_OTLP_HEADERS` as required for cloud, and `:38`, under
**Production Ingestion Paths**, states that Supabase functions forward via OTLP. A reader has no way
to discover that this path is inert.

The cost is concrete. Diagnosing the OCR failure of 2026-08-22 ([`T-0021`](./T-0021-ocr-failure-names-its-cause.md))
meant reading raw Supabase console logs, because the spans built for exactly that purpose —
`edge.health_ocr.request`, `edge.health_ocr.service`, `edge.health_ocr.page` — exist nowhere
durable. The `traceparent`/`x-request-id` propagation described in `docs/observability/README.md`
is implemented and correct, and yields nothing queryable in production. There is also a small
steady cost: one doomed fetch to `127.0.0.1:4318` per telemetry event, on every invocation.

Afterwards, a production incident can be investigated from Grafana rather than from the Supabase
console, and a broken exporter is visible as a failure rather than as absence of data.

Scope is the Supabase edge functions, where the defect is confirmed. The Next.js surface on Vercel
shares `OBS_EXPORTER_MODE` (`src/lib/observability/config.ts:36`) and may have the same problem, but
its environment variables were not inspected and its `env` fallback already differs — verify it
before assuming either way.

## Progress

- [ ] Confirm the current production values by listing the edge function secrets, so the fix starts
      from what is set rather than from what is inferred from log output.
- [ ] Set `OBS_EXPORTER_MODE=cloud`, `OBS_ENV=prod`, `OBS_RELEASE`, and the Grafana Cloud endpoint
      and auth headers on the production functions, per `docs/observability/grafana-cloud.md:9-16`.
- [ ] Give `OBS_RELEASE` a real value from the deploying commit rather than a hand-set string, so
      telemetry can be tied to a release. This is the piece that needs a deployment change, since
      `deploy-supabase.cjs` currently sets no secrets at all.
- [ ] Stop the exporter failing silently: report a forwarding failure at least once per cold start
      instead of discarding every one at `observability.ts:346-348`. Without this the fix regresses
      invisibly the next time an endpoint or token changes.
- [ ] Decide whether the edge `env`/`release` fallbacks (`observability.ts:337-338`, `:370-371`)
      should mirror the web side's production fallback rather than hardcoding `local`/`dev-local`,
      so a missing variable degrades to a wrong-but-honest label instead of a misleading one.
- [ ] Verify end to end: trigger one production edge request, find its span in Grafana Cloud with
      `env=prod`, and confirm the same `request_id` appears on both the frontend and edge sides —
      the check `docs/observability/grafana-cloud.md:60` already describes.
- [ ] Check whether the Vercel/Next surface has the same gap, and either fold it in or record that
      it is correctly configured.

## Decision Log

- Decision: Track this separately from [`T-0021`](./T-0021-ocr-failure-names-its-cause.md) rather
  than as part of it.
  Rationale: Both were found while diagnosing the same incident, but they fail independently and
  have different exit conditions. T-0021 is about what an error message says to a user; this is
  about whether any telemetry leaves production at all. Fixing either would leave the other
  entirely unaddressed.
  Date/Author: 2026-08-23 / Claude

- Decision: Treat the silent `.catch(() => {})` as part of the debt rather than only the unset
  variables.
  Rationale: Setting four environment variables would close the symptom, and nothing would then
  detect the next endpoint rotation or expired token — the failure mode is indistinguishable from
  "quiet week" in a dashboard. The debt is that a broken exporter is unobservable, and an
  observability component that cannot report its own failure is the wrong thing to leave in place.
  Date/Author: 2026-08-23 / Claude

- Decision: Scope to the edge functions and mark the Vercel surface as unverified rather than
  asserting it is broken.
  Rationale: The edge defect is confirmed from production log output. For the Next.js side there is
  direct evidence of neither configuration nor misconfiguration, and its `env` fallback already
  differs (`config.ts:80`), so claiming it is broken would put an unchecked assertion into the
  registry.
  Date/Author: 2026-08-23 / Claude

## Related

- [`T-0019`](./T-0019-mcp-usage-audit-trail.md) has an exit condition requiring MCP audit lines to
  be "queryable in Grafana". If the Next.js surface shares this defect, that exit cannot be met
  until this task is done — worth resolving the open question above before T-0019 starts.
