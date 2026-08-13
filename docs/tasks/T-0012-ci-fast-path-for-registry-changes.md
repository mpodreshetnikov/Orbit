---
id: T-0012
title: Skip the heavy CI lanes when only the task registry changed
status: done
kind: chore
priority: p2
depth: note
created: 2026-08-13
updated: 2026-08-13
owner: TBD
tags: [ci, tooling, tasks]
---

# Skip the heavy CI lanes when only the task registry changed

## Context

After `T-0011` moved all work tracking into `docs/tasks/`, editing a task became a routine act — a
status change, a Progress line, a Decision Log entry. Every one of those pushes triggered the full
`Quality Gates` job: a Next production build, the extension build, the unit suite, and the coverage
ratchet, plus installing Deno and the Supabase CLI and reclaiming 20–30 GB of runner disk. None of
that can observe a change to a Markdown file under `docs/tasks/`.

`scripts/just/change-impact.cjs` already classified changed files for the workflow, and already
computed a `docsOnly` flag — which `.github/workflows/main.yml` never read. This task adds a
narrower `tasksOnly` flag and actually wires it up.

The fast path runs `quality-tasks`: `tasks-check`, `agent-skills-check`, and
`quality-format-check`. It skips the disk cleanup, the Deno and Supabase CLI installs, the build,
Playwright, e2e, the unit suite and the coverage check.

## Progress

- [x] (2026-08-13) `tasksOnly` added to `change-impact.cjs`, emitted in the `env` and
      `github-output` formats, with six unit tests covering the directory boundary, the mixed-change
      case, the empty diff, and its relationship to `docsOnly`.
- [x] (2026-08-13) `quality-tasks` recipe added to the `justfile` and registered in `AGENTS.md`.
- [x] (2026-08-13) `.github/workflows/main.yml` reordered so impact detection precedes toolchain
      setup, and the heavy steps gated on `tasksOnly != 'true'`.
- [x] (2026-08-13) `docs/QUALITY.md` change-type matrix gained a task-registry row.

## Decision Log

- Decision: Include `quality-format-check` in the fast path, rather than running only
  `tasks-check` as literally requested.
  Rationale: Prettier does format `docs/**`, so a task file genuinely can fail
  `quality-format-check` — running only the registry validator would let a malformed task file
  through to `main` and break the next unrelated pull request's format gate. The check costs a few
  seconds against a warm `npm ci`, so the fast path keeps almost all of its benefit. `lint` and
  `typecheck` are excluded because neither reads any file under `docs/tasks/`.
  Date/Author: 2026-08-13.

- Decision: Add a narrow `tasksOnly` flag instead of switching the workflow onto the existing
  unused `docsOnly` flag.
  Rationale: `docsOnly` is much wider — it matches `.agents/skills/**`, every `docs/**` file, and
  any `.md` anywhere in the tree, including files that sit next to code. Skill files in particular
  feed `agent-skills-check` and are consumed by agents, so treating them as inert is a bigger claim
  than this change needs to make. `docsOnly` remains computed and available if the fast path is
  deliberately widened later.
  Date/Author: 2026-08-13.

- Decision: Gate steps inside the existing `Quality Gates` job instead of adding a separate
  lightweight job.
  Rationale: A branch protection rule that requires a status check named `Quality Gates` is only
  satisfied when a check by that name reports. Moving registry-only changes into a different job
  would leave the required check permanently pending, blocking exactly the pull requests this change
  is meant to make cheap. Keeping one job with conditional steps keeps the reported check name
  stable regardless of which path runs.
  Date/Author: 2026-08-13.

- Decision: Move impact detection ahead of the Deno and Supabase CLI setup steps.
  Rationale: Those two actions are among the slowest fixed costs in the job, and both are useless on
  the fast path. `change-impact.cjs` uses only Node built-ins and `git`, so it runs before `npm ci`
  and can gate them. `npm ci` itself stays unconditional because the fast path needs Prettier.
  Date/Author: 2026-08-13.

- Decision: Leave the `Detect extension release policy` step unconditional.
  Rationale: Its outputs feed the `extension-release-bundle` and `publish-extension-release` jobs
  through `needs.quality-gates.outputs`. Skipping it makes those outputs empty rather than absent,
  which silently changes the release jobs' conditions. It is a single script over a git diff, so
  the saving would not have justified the risk to the release path.
  Date/Author: 2026-08-13.
