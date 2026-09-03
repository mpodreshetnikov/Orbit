#!/usr/bin/env node

// `just tasks-claim <id>` from this checkout: find the registry and run its claim command with this
// checkout as the marker target. The command itself lives in the registry (scripts/just/tasks-claim.cjs
// in orbit-tasks), because it edits and publishes registry files; this is only the way to reach it
// from here without knowing where the registry is checked out.

const path = require("path");
const { spawnSync } = require("child_process");

const { locateRegistry } = require("./task-claim-hook.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function main(argv) {
  const registryRoot = locateRegistry(REPO_ROOT);
  if (!registryRoot) {
    console.error(
      "tasks-claim: the task registry is not reachable from this checkout. Link it (orbit-tasks: " +
        "`just install-into <orbit>`) or point ORBIT_TASKS_REGISTRY at a clone of it.",
    );
    return 1;
  }
  const result = spawnSync(
    process.execPath,
    [path.join(registryRoot, "scripts", "just", "tasks-claim.cjs"), ...argv, `--repo=${REPO_ROOT}`],
    { stdio: "inherit", cwd: registryRoot },
  );
  return result.status ?? 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
