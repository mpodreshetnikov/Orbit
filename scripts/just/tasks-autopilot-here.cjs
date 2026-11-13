#!/usr/bin/env node

// `just tasks-autopilot` from this checkout: find the registry and run its autopilot report.
// The command lives in orbit-tasks (scripts/just/tasks-autopilot.cjs); this only reaches it.

const path = require("path");
const { spawnSync } = require("child_process");

const { locateRegistry } = require("./task-claim-hook.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function main(argv) {
  const registryRoot = locateRegistry(REPO_ROOT);
  if (!registryRoot) {
    console.error(
      "tasks-autopilot: the task registry is not reachable from this checkout. Link it (orbit-tasks: " +
        "`just install-into <orbit>`) or point ORBIT_TASKS_REGISTRY at a clone of it.",
    );
    return 1;
  }
  const result = spawnSync(
    process.execPath,
    [path.join(registryRoot, "scripts", "just", "tasks-autopilot.cjs"), ...argv],
    { stdio: "inherit", cwd: registryRoot },
  );
  return result.status ?? 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
