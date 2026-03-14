#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");

function resolveJustBin() {
  if (process.env.JUST_BIN) {
    return process.env.JUST_BIN;
  }
  if (process.platform === "win32") {
    const wingetJust = path.join(
      process.env.LOCALAPPDATA || "",
      "Microsoft",
      "WinGet",
      "Links",
      "just.exe",
    );
    if (wingetJust && require("fs").existsSync(wingetJust)) {
      return wingetJust;
    }
  }
  return "just";
}

const LINT_RECIPES = [
  "quality-lint-web",
  "quality-lint-extension",
  "quality-lint-scripts",
  "quality-lint-supabase-functions",
];

function resolveParallelism() {
  const raw = process.env.LINT_PARALLELISM;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  // Multiple concurrent ESLint processes OOM on Windows in this repo.
  return process.platform === "win32" ? 1 : LINT_RECIPES.length;
}

function runRecipe(recipe) {
  return new Promise((resolve) => {
    const child = spawn(resolveJustBin(), [recipe], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main() {
  const parallelism = Math.min(resolveParallelism(), LINT_RECIPES.length);
  const results = new Array(LINT_RECIPES.length).fill(0);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < LINT_RECIPES.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await runRecipe(LINT_RECIPES[currentIndex]);
      if (results[currentIndex] !== 0) {
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: parallelism }, () => worker()));
  const failed = results.findIndex((code) => code !== 0);
  process.exit(failed === -1 ? 0 : results[failed]);
}

main();
