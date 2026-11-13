#!/usr/bin/env node
/**
 * Cross-platform Vitest launcher: defaults TZ to Asia/Krasnoyarsk (owner locale).
 * Avoids POSIX-only `TZ=… cmd` prefixes that break just's windows-shell (PowerShell).
 *
 * Spawns Node directly against the local Vitest CLI — no shell, cmd.exe, npx, or ComSpec.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const env = { ...process.env, TZ: process.env.TZ || "Asia/Krasnoyarsk" };
const vitestRoot = path.dirname(require.resolve("vitest/package.json"));
const vitestCli = path.join(vitestRoot, "vitest.mjs");
const result = spawnSync(process.execPath, [vitestCli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  cwd: path.resolve(__dirname, "../.."),
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
