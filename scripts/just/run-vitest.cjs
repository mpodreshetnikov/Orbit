#!/usr/bin/env node
/**
 * Cross-platform Vitest launcher: defaults TZ to Asia/Krasnoyarsk (owner locale).
 * Avoids POSIX-only `TZ=… cmd` prefixes that break just's windows-shell (PowerShell).
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function resolveNpxBin() {
  const nodeDir = path.dirname(process.execPath);
  if (process.platform === "win32") {
    const npxCmd = path.join(nodeDir, "npx.cmd");
    return fs.existsSync(npxCmd) ? npxCmd : "npx.cmd";
  }
  const npxBin = path.join(nodeDir, "npx");
  return fs.existsSync(npxBin) ? npxBin : "npx";
}

const env = { ...process.env, TZ: process.env.TZ || "Asia/Krasnoyarsk" };
const args = ["vitest", ...process.argv.slice(2)];
const npx = resolveNpxBin();

const result =
  process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", npx, ...args], {
        stdio: "inherit",
        env,
      })
    : spawnSync(npx, args, { stdio: "inherit", env });

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
