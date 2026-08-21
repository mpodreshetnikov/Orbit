---
id: T-0019
title: Make MCP connector use auditable — log every tool call and every rejected token
status: open
kind: debt
priority: p1
depth: note
created: 2026-08-19
updated: 2026-08-21
owner: TBD
tags: [mcp, observability, security, audit]
exit: "Every MCP tool call and every rejected bearer token emits a structured log line carrying tool, outcome, grant, client, person and duration, queryable in Grafana, and `docs/observability/` documents how to answer 'what did the connector do to this person's data' for a given window"
---

# Make MCP connector use auditable — log every tool call and every rejected token

## Context

The MCP server is a remote, agent-driven write path into a family's health data — 24 tools, five of
which write (`add_measurement`, `add_medication`, `log_dose`, `update_medication`,
`upsert_catalog_entry`). It emits no telemetry at all. `src/app/api/mcp/route.ts` and everything
under `src/lib/mcp/**` contain no `createServerLogger`, no span, and no audit write; `grep -rn
"createServerLogger" src` finds three API routes, none of them this one.

The only trace a call leaves today is `mcp_oauth_grants.last_used_at`, stamped best-effort in
`src/lib/mcp/verify-token.ts:66` via `touchGrant`. It is a single overwritten timestamp: it says a
connection was used, never which tool ran, for which person, with what outcome, or how often. A
rejected token — expired, revoked, or belonging to a de-allowlisted user — leaves nothing at all,
so a stream of failed attempts against the endpoint is invisible.

The cost is not hypothetical. On 2026-08-19 an agent created a duplicate `Атаракс` medication
through this connector (`T-0018`). Reconstructing what had happened meant reading `created_at`
columns on the affected rows and inferring the rest; nothing recorded which tool ran or what it was
asked. Any question of the form "what did the assistant change in my health data last night" is
currently unanswerable, and so is "has anyone been probing this endpoint".

Everything needed already exists. `createServerLogger` in
`src/lib/observability/server-logger.ts` emits the shared schema in `docs/observability/log-schema.md`
and forwards to OTLP; `src/app/api/notifications/medication-action/route.ts` is a worked example of
the entry/exit/error shape `docs/design/common/error-handling-and-observability.md` asks for. The
instrumentation point is a single choke point: `withUserClient` in `src/lib/mcp/tool-context.ts`
wraps every tool (`withPerson` delegates to it), so one wrapper carries all 24, and
`verifyMcpBearerToken` is the matching choke point for auth outcomes.

Two constraints shape the design. Health data must not land in logs: record tool name, outcome,
duration, grant id, client id, person id, affected row ids and argument _shape_, never argument
values, names or clinical content — `docs/design/common/error-handling-and-observability.md` states
the rule and the schema offers `user_id_hash` for identity. And the wrapper already contains
failures deliberately (a throw becomes an `isError` result); logging must observe that path rather
than change it.

Open question for whoever picks this up: whether logs alone are enough, or writes also deserve a
durable `mcp_tool_calls` audit table. Logs answer "what happened last night" and are cheap; a table
survives log retention and can be shown to the user in the connector settings, next to the revoke
work in `T-0010`. Recommendation: start with logs, and decide on the table once there is a real
retention window to compare against.

## Progress

- [ ] Instrument `withUserClient` in `src/lib/mcp/tool-context.ts` so every tool call logs start and
      outcome (`ok`, `isError`, or thrown) with tool name, duration, grant/client id, resolved
      person id and argument shape — no argument values.
- [ ] Log auth outcomes in `src/lib/mcp/verify-token.ts`: token accepted, expired, revoked, unknown,
      or user no longer allowlisted.
- [ ] Confirm the lines validate against `docs/observability/log-schema.md` and are queryable in
      local Grafana per `docs/observability/local.md`.
- [ ] Document in `docs/observability/` (and reference from
      `docs/design/domains/health/mcp-server.md`) how to answer "what did the connector do to this
      person's data between X and Y".
- [ ] Decide, and record here, whether a durable `mcp_tool_calls` audit table is warranted beyond
      the log retention window.

## Decision Log

- Decision: Track this as `debt` rather than folding it into `T-0018`.
  Rationale: `T-0018`'s exit is that a one-off intake reaches the right course; this one's is that
  connector use is auditable. Satisfying either leaves the other untouched, which is the test for
  separate tasks. `T-0010` (revoking connectors from settings) is the closest neighbour and is
  adjacent rather than overlapping — it governs who may connect, this governs what a connection did.
  Date/Author: 2026-08-19, raised by the repository owner after `T-0018`.
