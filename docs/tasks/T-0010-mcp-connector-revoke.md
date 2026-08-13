---
id: T-0010
title: Let users revoke connected MCP clients from settings
status: open
kind: debt
priority: p2
depth: note
created: 2026-08-09
updated: 2026-08-09
owner: TBD
tags: [mcp, oauth, security, settings]
exit: "`/settings` lists connected MCP clients with a revoke action, and revoking makes the next tool call return 401"
---

# Let users revoke connected MCP clients from settings

## Context

MCP grants are revocable only through the `mcp_oauth_grants` row, not through Supabase Auth. That
means "sign out everywhere" does not end a connector session: a user who believes they have signed
out of everything still has live bearer tokens against their health data. There is no user-facing
revoke UI at all.

This is security-relevant rather than merely inconvenient, because the grant is what an assistant
holds to read a person's medical history. The MCP server and its grant model are described in
`T-0003` and in `docs/design/domains/health/mcp-server.md`.

Migrated from the former `docs/exec-plans/tech-debt-tracker.md` on 2026-08-13.

## Progress

- [ ] List connected MCP clients on `/settings`.
- [ ] Add a revoke action that deletes or revokes the grant.
- [ ] Confirm the next tool call from a revoked client returns 401.

## Decision Log

- Decision: Classify this as `debt` at `p2` rather than as a `bug`.
  Rationale: The grant model works as designed and tokens are hashed at rest, so nothing is
  currently leaking; the gap is that the design gives the user no way to exercise revocation. That
  is a missing capability with a security consequence, which is what debt with an explicit exit
  condition is for. It should be reconsidered as `p1` if the app is ever used by someone other than
  its author.
  Date/Author: 2026-08-13, task registry migration.
