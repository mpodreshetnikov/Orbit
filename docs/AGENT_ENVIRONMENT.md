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
On each event the bridge runs whatever `.claude/settings.json` here registers for it, with
`CLAUDE_PROJECT_DIR` pointing at this checkout. A hook added here later needs no change to the setup
script.

## Setup

In the Orbit project's settings, open the cloud environment (the gear beside it) and add this to
its **Setup script**. New sessions pick it up; a running one does not.

```sh
mkdir -p ~/.claude
cat > ~/.claude/settings.json <<'JSON'
{"hooks": {
  "SessionStart": [{"hooks": [{"type": "command", "timeout": 60, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "UserPromptSubmit": [{"hooks": [{"type": "command", "timeout": 60, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "PreToolUse": [{"hooks": [{"type": "command", "timeout": 60, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "PostToolUse": [{"hooks": [{"type": "command", "timeout": 60, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "PostToolUseFailure": [{"hooks": [{"type": "command", "timeout": 60, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}],
  "Stop": [{"hooks": [{"type": "command", "timeout": 60, "command": "f=/home/user/Orbit/scripts/just/project-hooks-bridge.cjs; [ -f \"$f\" ] && exec node \"$f\"; exit 0"}]}]
}}
JSON
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
