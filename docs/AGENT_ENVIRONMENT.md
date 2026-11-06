# Agent environment

What a cloud environment that runs agents on Orbit must carry, why, and how a session proves it does.
An agent session that fails the check below changes nothing in this repository.

## Why

Orbit's rules for agents are partly mechanical: the task-claim check reports an edit no in-progress
task stands behind, the size hook warns before a branch outgrows review, caveman mode switches on at
session start where the harness can fire it, and git hooks run the claim check on commit and the
registry / size gates on push.

Two cloud surfaces need that machinery wired differently:

| Surface                                                     | How hooks load                                                                                                                                                     | Git hooks                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Claude Code (`CLAUDE_CODE_REMOTE=true`)                     | `~/.claude/settings.json` → [`project-hooks-bridge.cjs`](../scripts/just/project-hooks-bridge.cjs) → [`.claude/settings.json`](../.claude/settings.json)           | Global `~/.git-hooks` dispatcher → `.githooks/pre-commit`       |
| Cursor Cloud (`CURSOR_AGENT=1` / `CURSOR_CODE_REMOTE=true`) | [`.cursor/hooks.json`](../.cursor/hooks.json) → [`cursor-hooks-bridge.cjs`](../scripts/just/cursor-hooks-bridge.cjs) → same Claude settings via the project bridge | Cursor's `~/.cursor/agent-hooks/<id>/` dispatcher → `.githooks` |

A Claude cloud session holding several repositories (every Orbit project thread with Orbit and
`orbit-tasks` side by side) starts in the parent directory and loads hooks from neither repository.
T-260902-jxe found that by its absence: 21 merges into `main` against two claims. The Claude block
below fixed that path.

Cursor Cloud already loads project `.cursor/hooks.json`, but until T-261106-kp8 that file only ran
telegram notify. Cursor also rewrites each checkout's `core.hooksPath` to
`~/.cursor/agent-hooks/<base64(abs-root)>/`; without a `pre-push` symlink and with
`.cursor-original-hooks-path` still pointing at `.git/hooks` samples, Orbit's and the registry's
tracked `.githooks` never ran.

## Claude Code setup

In the Orbit project's settings, open the cloud environment (the gear beside it) and keep this in
its **Setup script** / install path. New sessions pick it up; a running one does not.

```sh
# Claude Code hooks: every event routed through Orbit's bridge.
mkdir -p ~/.claude
cat > ~/.claude/settings.json <<'JSON'
{"hooks": {
  "SessionStart": [{"hooks": [{"type": "command", "timeout": 600, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "SessionEnd": [{"hooks": [{"type": "command", "timeout": 600, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "UserPromptSubmit": [{"hooks": [{"type": "command", "timeout": 600, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "PreToolUse": [{"hooks": [{"type": "command", "timeout": 600, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "PermissionRequest": [{"hooks": [{"type": "command", "timeout": 600, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "PostToolUse": [{"hooks": [{"type": "command", "timeout": 600, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "PostToolUseFailure": [{"hooks": [{"type": "command", "timeout": 600, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "Notification": [{"hooks": [{"type": "command", "timeout": 600, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "Stop": [{"hooks": [{"type": "command", "timeout": 600, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "SubagentStop": [{"hooks": [{"type": "command", "timeout": 600, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "PreCompact": [{"hooks": [{"type": "command", "timeout": 600, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}]
}}
JSON

# Git: a repository's own .githooks/pre-commit, for commits made without Claude Code's hooks.
mkdir -p ~/.git-hooks
printf '#!/bin/sh\nh="$(git rev-parse --show-toplevel)/.githooks/pre-commit"\n[ -x "$h" ] && exec "$h" "$@"\nexit 0\n' > ~/.git-hooks/pre-commit
chmod +x ~/.git-hooks/pre-commit
git config --global core.hooksPath ~/.git-hooks
```

The path assumes the clone at `/home/user/Orbit`, where Claude cloud sessions put it. If the bridge
file is missing, each entry exits quietly, so the block is safe in an environment that does not
clone Orbit. This Claude path is unchanged by the Cursor work.

## Cursor Cloud setup

Cursor loads [`.cursor/hooks.json`](../.cursor/hooks.json) from this repository. That file routes
`afterFileEdit`, shell / tool events, and (where available) `sessionStart` through
[`cursor-hooks-bridge.cjs`](../scripts/just/cursor-hooks-bridge.cjs), which reuses the Claude hook
scripts via `project-hooks-bridge.cjs`. Telegram notify on `afterAgentResponse` / `stop` stays.

Cursor Cloud also owns each checkout's `core.hooksPath`. After Cursor has created
`~/.cursor/agent-hooks/<id>/`, the environment **start** (or install) script must run:

```sh
# Resolve Orbit (and the registry when present) the way the cloud install script does.
ORBIT_ROOT="${ORBIT_ROOT:-/agent/repos/Orbit}"
REGISTRY_ROOT="${REGISTRY_ROOT:-/agent/repos/orbit-tasks}"

node "$ORBIT_ROOT/scripts/just/cursor-agent-git-hooks.cjs" "$ORBIT_ROOT"
if [ -d "$REGISTRY_ROOT/.githooks" ]; then
  node "$ORBIT_ROOT/scripts/just/cursor-agent-git-hooks.cjs" "$REGISTRY_ROOT"
fi
```

That creates the missing `pre-push` symlink onto Cursor's `.dispatcher` and points
`.cursor-original-hooks-path` at each repository's `.githooks`, so Orbit's pre-commit claim/size
advisory and the registry's push validator run under Cursor the same way they do under a normal
`core.hooksPath=.githooks` checkout.

Add this call to the environment **install** and **start** scripts (after Cursor has created the
agent-hooks directories on start):

```sh
bash /agent/repos/Orbit/scripts/cloud/configure-cursor-agent-hooks.sh
# or, from the Orbit checkout:
# bash scripts/cloud/configure-cursor-agent-hooks.sh
```

### Cursor event gaps

| Event                                                                                                                | Managed Cursor Cloud    | Notes                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `afterFileEdit`, `beforeShellExecution` / `afterShellExecution`, `preToolUse` / `postToolUse` / `postToolUseFailure` | Yes                     | Task-claim + PR-size via the adapter                                                                                                                                                                                  |
| `sessionStart` / caveman                                                                                             | **No** on managed Cloud | Cursor defers it while early turns can be read-only; wired in `.cursor/hooks.json` for desktop / self-hosted pools. Documented gap: caveman does not auto-enable on managed Cloud the way Claude `SessionStart` does. |
| `sessionEnd`, MCP before/after, Tab hooks, `workspaceOpen`                                                           | No                      | Not required for the safety gates                                                                                                                                                                                     |

## The check

```sh
node scripts/just/agent-env-check.cjs
```

- Claude cloud (`CLAUDE_CODE_REMOTE=true`): passes only when `~/.claude/settings.json` routes every
  event this repository registers through an existing `project-hooks-bridge.cjs`.
- Cursor cloud (`CURSOR_AGENT=1` or `CURSOR_CODE_REMOTE=true`): passes only when `.cursor/hooks.json`
  routes the required events through `cursor-hooks-bridge.cjs` **and** the agent-hooks git chain
  points at `.githooks` with a `pre-push` entry.
- Otherwise it passes and says it is not a cloud session.

A refusal prints `REFUSED`, names what is missing, and exits 1. It is enforced in three places:

- [`CLAUDE.md`](../CLAUDE.md) / [`AGENTS.md`](../AGENTS.md): run the check before the first change;
  stop on refusal.
- `just tasks-claim` (`scripts/just/tasks-claim-here.cjs`) refuses to claim a task.
- The registry's own `tasks-claim` runs the same check against the checkout it arms.

What the refusal asks for is this setup, made by the person who owns the environment. A session that
rewrites `~/.claude/settings.json` or `~/.cursor/agent-hooks` itself to pass the check has hidden the
problem from the next session, not fixed it.
