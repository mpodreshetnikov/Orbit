#!/usr/bin/env node
/**
 * Cross-platform Vitest launcher: defaults TZ to Asia/Krasnoyarsk (owner locale).
 * Avoids POSIX-only `TZ=… cmd` prefixes that break just's windows-shell (PowerShell).
 *
 * Spawns PATH-resolved `npx` / `npx.cmd` only (never absolute paths from process.execPath
 * or ComSpec) so CodeQL does not flag shell commands built from environment values.
 */
const { spawnSync } = require("child_process");

const env = { ...process.env, TZ: process.env.TZ || "Asia/Krasnoyarsk" };
const vitestArgs = process.argv.slice(2);

const result =
  process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "npx.cmd", "vitest", ...vitestArgs], {
        stdio: "inherit",
        env,
      })
    : spawnSync("npx", ["vitest", ...vitestArgs], { stdio: "inherit", env });

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
