---
name: change-review-screenshots
description: Mandatory before handoff on every task that changes a user-visible surface. Use this skill to capture screenshots of the delivered change (feature, fix, refactor with visual impact) and deliver them with the final response so the reviewer can judge the result without running the app. Covers web UI, browser extension UI, Grafana dashboards, and generated report artifacts.
---

# Change Review Screenshots

**Every finished task ships visual evidence.** The reviewer must be able to see what changed by looking at the final response, without starting the stack or replaying the flow.

## When To Use (mandatory)

Use this skill at the end of any task whose change set touches a visible surface:

| Changed paths                                                       | Surface to capture                                  |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| `src/app/**`, `src/components/**`, `src/**/*.tsx`, `tailwind.config.ts` | Web UI route(s) affected                         |
| `browserExtension/**`                                                 | Extension popup / injected UI / import flow         |
| `observability/**` dashboards                                         | Grafana dashboard panels                            |
| `scripts/**` producing `report.md` / CSV / diagnostics artifacts      | Rendered report output                              |
| `supabase/**`, `shared/**` when the change alters what a page renders | The page that renders the changed data              |

If unsure whether a change is visible, treat it as visible and capture it.

## When Screenshots Do Not Apply

Backend-only, DB-only, tooling, CI, or docs changes with no rendered result do not need screenshots — but the handoff **must still say so explicitly**, in one line, with the reason:

> `screenshots: none — change is DB-function-only (supabase/db/functions), no rendered surface affected.`

Silence is never acceptable. Either images or an explicit reason.

## Required Workflow

1. **Determine surfaces.** Run `git diff --name-only` (plus `git status --porcelain`) against the task base and map changed paths through the table above to concrete routes/views.
2. **Start the local stack.** Use bypass unless the task verifies real auth: `dev start bypass` (see the `e2e-user-behaviour-validation` skill for auth details). Long-running — start it in the background.
3. **Capture the after-state** for every affected surface with `playwright-cli`, following [references/capture-recipes.md](references/capture-recipes.md).
4. **Capture the before-state** when the task is a visual fix or a change to existing UI and the old state is cheap to reach (stash the change, shoot, restore). Best effort — skip it for brand-new surfaces, and never leave the working tree dirty or stashed.
5. **Cover the states the change touches**, not just the happy path: at minimum the primary state, plus any empty / error / validation / loading state the change introduced or altered.
6. **Add a mobile viewport shot** (`390x844`) whenever layout, responsive rules, or mobile-specific input behavior changed.
7. **Verify every image.** Open each captured file and confirm it actually shows the change (right route, rendered content, no blank page, no auth wall, no dev overlay). A screenshot that does not show the change is worse than none — recapture it.
8. **Deliver** per [references/delivery-and-naming.md](references/delivery-and-naming.md): attach the images in the final response, one caption per image, plus paths.

## Storage

- Write to `.artifacts/review-screenshots/<YYYY-MM-DD>-<task-slug>/`.
- Naming: `<NN>-<surface>-<state>[-<viewport>].png`, e.g. `01-money-transactions-filters-applied-desktop.png`.
- This directory is gitignored. **Never commit screenshots** and never add them to a migration, test, or source directory.

## Blockers

- **Auth gate or human-only step:** ask the human to pass it and continue — do not drop the capture step.
- **Stack will not start:** report the exact command ID that failed and its error; still deliver whatever surface could be captured.
- Report an unmet capture as `blocked` only after attempting a fix, and always with a concrete external reason.

## Final Report Contract

Include this block in the final task response:

- `screenshots`: one line per image — `path — surface/route — state`.
- `before/after`: pairs captured, or `none` with reason.
- `not-captured`: affected surfaces without an image, each with a reason.
- `blocked`: capture steps still blocked, with the external blocker reason.
