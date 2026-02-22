#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const COVERAGE_CHECK_SCRIPTS = [
  ["node", ["scripts/just/src-coverage-threshold.cjs"]],
  ["node", ["scripts/just/supabase-function-coverage-threshold.cjs"]],
  ["node", ["scripts/just/coverage-ratchet.cjs"]],
  ["node", ["scripts/just/db-coverage-report.cjs", "--strict-changed"]],
];

function runScript([cmd, args]) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: process.env,
      cwd: REPO_ROOT,
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main() {
  const results = await Promise.all(COVERAGE_CHECK_SCRIPTS.map(runScript));
  const failed = results.findIndex((code) => code !== 0);
  process.exit(failed === -1 ? 0 : results[failed]);
}

main();
