# Orbit

A self-hosted personal superapp for tracking **health** and **money** for yourself, your family, and your pets.

It is built as a single Next.js application on top of Supabase, with an accompanying browser extension for importing bank data and an MCP connector that exposes the Health domain to AI agents.

> This is a personal project, published so the architecture and workflows can be read and reused. It is designed to be run by its owner: application access is gated by an explicit allowlist, and there is no multi-tenant sign-up flow.

## Features

- **Health** — medical records, lab observations, findings, conditions, medications and doses, body measurements, and checkups. Uploaded documents are run through an OCR and LLM extraction pipeline that turns scans into structured, queryable data.
- **Money** — accounts, transactions, categories with a canonical rule pipeline, budgets, and an audit trail. Bank data is ingested through a browser extension rather than a third-party aggregator.
- **MCP connector** — the Health domain is exposed over the Model Context Protocol with an in-app OAuth 2.1 server, so an agent can query your records with scoped access.
- **PWA** — installable, with push notifications delivered through a service worker.

## Runtime surfaces

| Surface           | Stack                                          |
| ----------------- | ---------------------------------------------- |
| Web app           | Next.js (App Router), React Query, Tailwind    |
| Database          | Supabase Postgres — RLS-first, pg_cron, pg_net |
| Edge Functions    | Deno — OCR, LLM structuring, import, cron      |
| Browser extension | Chrome MV3 — bank web-export ingestion         |
| Observability     | OpenTelemetry → Grafana LGTM stack             |

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full map of domains, layers, and boundaries.

## Getting started

Prerequisites: `just`, Node.js 22, Deno 2.x, the Supabase CLI, and Docker.

```bash
just install-dependencies   # install dependencies
just git-hooks-install      # enable hooks, including the pre-push secret scan
just dev                    # start local Supabase, apply schema, seed, and run the dev stack
```

`just dev` is long-running and holds the foreground; tear it down with `just dev stop`.

Full environment variable reference and first-run instructions are in [`docs/SETUP.md`](./docs/SETUP.md).

`just --list --unsorted` is the source of truth for available commands; [`AGENTS.md`](./AGENTS.md) maps the canonical command IDs used in plans and PRs.

## Development

```bash
just quality      # format, lint, typecheck
just test-unit    # all unit lanes (web, extension, node, functions)
just test-e2e     # Playwright end-to-end flows
```

The quality operating model — which checks run at which stage, and the final gate before handoff — is defined in [`docs/QUALITY.md`](./docs/QUALITY.md).

## Documentation

| Document                                         | Contents                                            |
| ------------------------------------------------ | --------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Runtime surfaces, domain and layer boundaries       |
| [`docs/DESIGN.md`](./docs/DESIGN.md)             | Design patterns and deep design notes               |
| [`docs/SETUP.md`](./docs/SETUP.md)               | Local setup and environment variables               |
| [`docs/QUALITY.md`](./docs/QUALITY.md)           | Quality gates and scoring model                     |
| [`docs/SECURITY.md`](./docs/SECURITY.md)         | Access model, RLS expectations, secret handling     |
| [`docs/RUNBOOK.md`](./docs/RUNBOOK.md)           | Operations and debugging procedures                 |
| [`docs/tasks/INDEX.md`](./docs/tasks/INDEX.md)   | Task registry — open work, decisions, and tech debt |
| [`mcp/README.md`](./mcp/README.md)               | MCP server configuration and IDE sync               |

## Security

Access is allowlist-gated via `public.allowed_users`, enforced in middleware and backed by row-level security on every data table. Secrets are never committed — a gitleaks scan runs as a pre-push hook and as the first job in CI.

If you find a security issue, please open an issue without including sensitive details, and see [`docs/SECURITY.md`](./docs/SECURITY.md) for the security model.

## License

[MIT](./LICENSE)
