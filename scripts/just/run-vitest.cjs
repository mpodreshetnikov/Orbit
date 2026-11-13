#!/usr/bin/env node
/**
 * Cross-platform Vitest launcher: defaults TZ to Asia/Krasnoyarsk (owner locale).
 * Avoids POSIX-only `TZ=… cmd` prefixes that break just's windows-shell (PowerShell).
 *
 * Spawns Node directly against the local Vitest CLI — no shell, cmd.exe, npx, or ComSpec.
 */
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const DEFAULT_TZ = "Asia/Krasnoyarsk";
const REPO_ROOT = path.resolve(__dirname, "../..");
/** Distinct from Vitest status codes so `if (result.error)` is not equivalent to falling through. */
const SPAWN_ERROR_EXIT = 2;

function resolveVitestCli(resolve = require.resolve) {
  const vitestRoot = path.dirname(resolve("vitest/package.json"));
  return path.join(vitestRoot, "vitest.mjs");
}

/**
 * @param {string[]} vitestArgs
 * @param {{ env?: Record<string, string | undefined>, spawn?: typeof spawnSync, execPath?: string, resolve?: typeof require.resolve }} [opts]
 * @returns {number} process exit code
 */
function runVitest(vitestArgs, opts = {}) {
  const envIn = opts.env ?? process.env;
  const spawn = opts.spawn ?? spawnSync;
  const execPath = opts.execPath ?? process.execPath;
  const env = { ...envIn, TZ: envIn.TZ || DEFAULT_TZ };
  const vitestCli = resolveVitestCli(opts.resolve ?? require.resolve);
  const result = spawn(execPath, [vitestCli, ...vitestArgs], {
    stdio: "inherit",
    env,
    cwd: REPO_ROOT,
  });
  if (result.error) {
    return SPAWN_ERROR_EXIT;
  }
  if (result.status == null) {
    return 1;
  }
  return result.status;
}

module.exports = { DEFAULT_TZ, REPO_ROOT, SPAWN_ERROR_EXIT, resolveVitestCli, runVitest };

// Stryker disable next-line all: CLI entry — unreachable when the module is imported by tests
if (require.main === module) {
  process.exit(runVitest(process.argv.slice(2)));
}
