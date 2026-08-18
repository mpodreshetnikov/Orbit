---
id: T-0017
title: Cut budget report months at the user's local boundary instead of UTC
status: open
kind: bug
priority: p2
depth: note
created: 2026-08-13
updated: 2026-08-13
owner: TBD
tags: [money, reports, timezone]
---

# Cut budget report months at the user's local boundary instead of UTC

## Context

`money_get_budget_report` selects a month with UTC boundaries: `v_month_start_utc` and
`v_next_month_start_utc` in `supabase/db/functions/money_get_budget_report.sql` are built as
`'<date> 00:00:00+00'`, and `posted_at` is filtered against them.

The user's operations happen in Moscow time, UTC+03:00. So an operation between 00:00 and 02:59
Moscow on the first day of a month has a `posted_at` that falls in the previous UTC month, and the
report attributes it to the month before the one the bank statement shows it in.

This is not new and it is not confined to one source. Transactions imported by the browser extension
have always carried honest UTC instants (`browserExtension/src/connectors/tbank-web.ts` uses
`new Date(operationMs).toISOString()`), so they have always been subject to it. `T-0013` Milestone 3
made the CSV statement import agree with them — before that change a statement row declared Moscow
local time to be UTC, which moved it three hours the other way and hid this particular case while
creating a symmetric one at the end of the month (anything after 21:00 was reported a month early).
Now both sources agree on the instant, and the one remaining misattribution lives in the report.

Found by the automated review of PR #27, verified against the source.

## Progress

- [ ] Decide where the boundary belongs: a report timezone stored per person, a repository-wide
      constant matching the statement offset, or a parameter on the function.
- [ ] Apply it in `money_get_budget_report` and anywhere else that cuts a period from `posted_at`.
- [ ] pgTAP case: an operation at 01:00 Moscow on the first day of a month is reported in that month,
      and one at 23:30 Moscow on the last day is not reported in the next one.

## Decision Log

- Decision: tracked separately from `T-0013` rather than folded into it.
  Rationale: `T-0013` Milestone 3 is about one operation having one identity across two import
  sources, and it fixed the timestamp so both sources agree. The month boundary is a property of the
  report, predates that work, affects every extension-imported transaction already stored, and
  changing it moves numbers in reports for past months — a different change with a different blast
  radius and its own acceptance.
  Date/Author: 2026-08-13 / review of PR #27.
