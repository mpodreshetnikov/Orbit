# Agent environment

What a cloud environment that runs agents on Orbit must carry, why, and how a session proves it does.
An agent session that fails the check below changes nothing in this repository.

## Why

Orbit's rules for agents are partly mechanical: Claude Code hooks registered in
[`.claude/settings.json`](../.claude/settings.json). The task-claim check reports an edit no
in-progress task stands behind, the size hook warns before a branch outgrows review, and caveman mode
is switched on at session start. Claude Code reads that file from the directory a session starts in.

A cloud session holding several repositories, which is every thread of the Orbit project with Orbit
and `orbit-tasks` side by side, starts in the parent directory and loads hooks from neither
repository. In those sessions every hook was silent, and nothing said so. T-260902-jxe in the
registry found this by its absence: 21 merges into `main` against two claims made through
`tasks-claim`.

What such a session does read is `~/.claude/settings.json` inside its container. The environment's
setup script writes that file, registering
[`scripts/just/project-hooks-bridge.cjs`](../scripts/just/project-hooks-bridge.cjs) once per event.
On each event the bridge runs whatever `.claude/settings.json` here registers for it, the way
Claude Code would, with `CLAUDE_PROJECT_DIR` pointing at this checkout. The block routes every common
hook event, so a hook added here later needs no change to it; one on an event the block leaves out
is caught by the check below, which refuses until the block routes it too.

The same block points git at a dispatcher that runs a repository's own `.githooks/pre-commit`, so
the commit-time claim check also reaches commits made without Claude Code's hooks. It forwards
`pre-commit` only: `pre-push` needs `just`, which a cloud container may not have.

## Setup

In the Orbit project's settings, open the cloud environment (the gear beside it) and add this to
its **Setup script**. New sessions pick it up; a running one does not.

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

The path assumes the clone at `/home/user/Orbit`, where cloud sessions put it. If the bridge file is
missing, each entry exits quietly, so the block is safe in an environment that does not clone Orbit.

## The check

```sh
node scripts/just/agent-env-check.cjs
```

In a cloud session (`CLAUDE_CODE_REMOTE=true`) it passes only when `~/.claude/settings.json` routes
every event this repository registers a hook on through an existing bridge. Otherwise it prints
`REFUSED`, names the missing events, and exits 1. Outside the cloud it passes and says why.

A refusal is enforced in three places, so skipping one does not get past it:

- [`CLAUDE.md`](../CLAUDE.md), which Claude Code loads in every session that holds this checkout,
  multi-repository ones included, makes the check the first step and stopping the answer to a
  refusal.
- `just tasks-claim` (`scripts/just/tasks-claim-here.cjs`) refuses to claim a task, and work here
  starts with a claim (`AGENTS.md`, "No Work Without A Task").
- The registry's own `tasks-claim` runs the same check against the checkout it arms, so calling it
  directly does not go around the launcher.

What the refusal asks for is this setup, made by the person who owns the environment. A session
that writes `~/.claude/settings.json` itself to pass the check has hidden the problem from the next
session, not fixed it.
