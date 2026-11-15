#!/usr/bin/env node

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

/** Lint lanes run in parallel by `quality-lint-parallel` (T-261115-csy adds boundaries). */
const LINT_RECIPES = [
  "quality-lint-web",
  "quality-lint-extension",
  "quality-lint-scripts",
  "quality-lint-supabase-functions",
  "quality-lint-boundaries",
  "test-smell-lint",
];

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {(path: string) => boolean} [existsSync]
 * @returns {string}
 */
function resolveJustBin(
  env = process.env,
  platform = process.platform,
  existsSync = fs.existsSync,
) {
  if (env.JUST_BIN) {
    return env.JUST_BIN;
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData) {
      return "just";
    }
    const wingetJust = path.join(localAppData, "Microsoft", "WinGet", "Links", "just.exe");
    if (existsSync(wingetJust)) {
      return wingetJust;
    }
  }
  return "just";
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {number} [recipeCount]
 * @returns {number}
 */
function resolveParallelism(
  env = process.env,
  platform = process.platform,
  recipeCount = LINT_RECIPES.length,
) {
  const parsed = Number.parseInt(String(env.LINT_PARALLELISM ?? ""), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed, recipeCount);
  }
  // Multiple concurrent ESLint processes OOM on Windows in this repo.
  return platform === "win32" ? 1 : recipeCount;
}

/**
 * @param {string} recipe
 * @param {{
 *   spawnFn?: typeof spawn,
 *   justBin?: string,
 *   env?: Record<string, string | undefined>,
 * }} [opts]
 * @returns {Promise<number>}
 */
function runRecipe(
  recipe,
  { spawnFn = spawn, justBin = resolveJustBin(), env = process.env } = {},
) {
  return new Promise((resolve) => {
    const child = spawnFn(justBin, [recipe], {
      stdio: "inherit",
      env,
    });
    child.on("close", (code) => {
      resolve(code === null || code === undefined ? 1 : code);
    });
    child.on("error", () => resolve(1));
  });
}

/**
 * @param {{
 *   recipes?: string[],
 *   parallelism?: number,
 *   runOne?: (recipe: string) => Promise<number>,
 *   captureResults?: number[],
 * }} [opts]
 * @returns {Promise<number>}
 */
async function runLintParallel({
  recipes = LINT_RECIPES,
  parallelism = resolveParallelism(),
  runOne = runRecipe,
  captureResults,
} = {}) {
  const workerCount = Math.min(parallelism, recipes.length);
  const results = recipes.map(() => 0);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < recipes.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await runOne(recipes[currentIndex]);
      if (results[currentIndex] !== 0) {
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (captureResults) {
    captureResults.push(...results);
  }
  const failed = results.findIndex((code) => code !== 0);
  return failed === -1 ? 0 : results[failed];
}

async function main() {
  const code = await runLintParallel();
  process.exit(code);
}

if (require.main === module) {
  main();
}

module.exports = {
  LINT_RECIPES,
  resolveJustBin,
  resolveParallelism,
  runRecipe,
  runLintParallel,
  main,
};
