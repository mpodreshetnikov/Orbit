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
  const results = await Promise.all(LINT_RECIPES.map(runRecipe));
  const failed = results.findIndex((code) => code !== 0);
  process.exit(failed === -1 ? 0 : results[failed]);
}

main();
