#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const functionsDir = path.join(repoRoot, "supabase", "functions");
const denoImage = process.env.SUPABASE_FUNCTIONS_DENO_IMAGE || "denoland/deno:2.1.4";
const denoConfigPath = "supabase/functions/deno.json";
const lockPath = "supabase/functions/deno.lock";

function collectTypeScriptFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(entryPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

const files = collectTypeScriptFiles(functionsDir)
  .sort((a, b) => a.localeCompare(b))
  .map((absolutePath) => path.relative(repoRoot, absolutePath).split(path.sep).join("/"));

if (files.length === 0) {
  console.error("No TypeScript files were found under supabase/functions.");
  process.exit(1);
}

console.log(`Refreshing ${lockPath} using ${denoImage}...`);

const dockerArgs = [
  "run",
  "--rm",
  "-v",
  `${repoRoot}:/work`,
  "-w",
  "/work",
  denoImage,
  "deno",
  "cache",
  "--config",
  denoConfigPath,
  "--lock",
  lockPath,
  ...files,
];

const refreshResult = spawnSync("docker", dockerArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  windowsHide: true,
});

if (refreshResult.error) {
  console.error(`Failed to run docker: ${refreshResult.error.message}`);
  process.exit(1);
}

if ((refreshResult.status ?? 1) !== 0) {
  process.exit(refreshResult.status ?? 1);
}

const verifyScriptPath = path.join(repoRoot, "scripts", "just", "check-supabase-functions-lock.cjs");
const verifyResult = spawnSync(process.execPath, [verifyScriptPath], {
  cwd: repoRoot,
  stdio: "inherit",
  windowsHide: true,
});

if ((verifyResult.status ?? 1) !== 0) {
  process.exit(verifyResult.status ?? 1);
}

console.log("Supabase functions lockfile refresh completed.");
