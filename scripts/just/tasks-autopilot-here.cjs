#!/usr/bin/env node

// `just tasks-autopilot` from this checkout: find the registry and run its autopilot report.
// The command lives in orbit-tasks (scripts/just/tasks-autopilot.cjs); this only reaches it.

"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const { locateRegistry: defaultLocateRegistry } = require("./task-claim-hook.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * @param {string[]} argv
 * @param {{
 *   locateRegistry?: (repoRoot: string) => string | null,
 *   spawn?: typeof spawnSync,
 *   execPath?: string,
 *   repoRoot?: string,
 *   error?: (...args: unknown[]) => void,
 * }} [opts]
 * @returns {number}
 */
function main(argv, opts = {}) {
  const locate = opts.locateRegistry ?? defaultLocateRegistry;
  const spawn = opts.spawn ?? spawnSync;
  const execPath = opts.execPath ?? process.execPath;
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const error = opts.error ?? console.error.bind(console);

  const registryRoot = locate(repoRoot);
  if (!registryRoot) {
    error(
      "tasks-autopilot: the task registry is not reachable from this checkout. Link it (orbit-tasks: " +
        "`just install-into <orbit>`) or point ORBIT_TASKS_REGISTRY at a clone of it.",
    );
    return 1;
  }
  const result = spawn(
    execPath,
    [path.join(registryRoot, "scripts", "just", "tasks-autopilot.cjs"), ...argv],
    { stdio: "inherit", cwd: registryRoot },
  );
  return result.status ?? 1;
}

module.exports = { REPO_ROOT, main };

// Stryker disable next-line all: CLI entry — unreachable when the module is imported by tests
if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
