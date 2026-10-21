# Working in this repository

[`AGENTS.md`](./AGENTS.md) is the map: commands, where knowledge lives, and the rules that gate work
here. Read it before changing anything.

## Before anything else

Run `node scripts/just/agent-env-check.cjs` before the first change to this repository in a session.

If it prints `REFUSED`, this session does not run this repository's hooks, and the gates they carry
are silent. Change nothing here. Tell the person what the check printed and that the fix is the
setup-script block in [`docs/AGENT_ENVIRONMENT.md`](./docs/AGENT_ENVIRONMENT.md), then stop. Do not
write `~/.claude/settings.json` yourself to pass it: the environment has to carry the hooks, not one
session.
