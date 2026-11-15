# Process control (Maxim ↔ Igor)

Registry: `T-261113-o9b` / Project ORB-47. Decisions D5–D16 (2026-11-10).

## What is enforced in-repo

| Gate                                     | Where                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Participant allowlist on `owner` / claim | `orbit-tasks` `participants.cjs` + `tasks-claim` / `validateOwner`      |
| Claim hard-fail for agent/cloud          | Orbit `task-claim-hook.cjs` + `.githooks/pre-commit`                    |
| Dual-repo hooks/skills fail-closed       | Orbit `agent-env-check.cjs` (`checkDualRepo`)                           |
| Human authorship + no agent trailers     | Orbit `human-authorship.cjs`, `.githooks/commit-msg`, CI Quality Gates  |
| Complex-task Spec + second approve       | Orbit `spec-approve.cjs` (task file holds Spec; no `docs/tasks/specs/`) |
| Agents never merge                       | `docs/QUALITY.md`, steward skill (D10)                                  |
| Coverage floor 80% L/B                   | `src-coverage-threshold` / function threshold (separate PR when split)  |

## D5 — GitHub settings (prep only; not applied in this change)

Maxim decided: `Kot-kAkos` is Igor; give him **write** on Orbit; close direct pushes to `main`
for everyone (including Maxim) — PR-only.

**Do not change collaborators/rulesets in the same agent run as the code.** After Lead/Maxim
accept the in-repo gates:

1. Orbit (public): add collaborator `Kot-kAkos` with write; set ruleset / branch protection so
   `main` rejects direct pushes (required status checks already include Quality Gates / Secret
   Scan / CodeQL — canonical detail in `docs/QUALITY.md` **Main protection (required checks)**;
   CodeQL is GitHub default setup, not a workflow under `.github/workflows/`). Required approving
   review count stays 0 for simple agent PRs; second-person approve for complex work is the
   `spec-approve` / task-file PR path, not a blanket `required_approving_review_count: 1`.
2. orbit-tasks (private): Igor already has write. No Pro/org rulesets (D6) — cards stay
   straight to `main`; rules/scripts via PR; gate = local `pre-push`.

## D14 — Igor email

Login `Kot-kAkos` is on the allowlist. Claim / authorship mailbox:
**`workupnow@yandex.ru`** (filled at onboarding 2026-11-15). GitHub noreply for authorship:
`59914044+Kot-kAkos@users.noreply.github.com`. Keep both twins in sync:
`scripts/just/participants.cjs` (Orbit) and the same path in `orbit-tasks`.

## D12

Do not re-enable orbit-tasks Actions CI (`T-0028`) until private-repo minutes are confirmed by a
manual workflow run.
