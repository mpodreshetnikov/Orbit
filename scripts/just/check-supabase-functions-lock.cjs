#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const lockPath = path.join(repoRoot, "supabase", "functions", "deno.lock");
const expectedVersion = "4";

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(lockPath)) {
  fail(
    "Missing supabase/functions/deno.lock. Run `just supabase-functions-lock-refresh` to regenerate it.",
  );
}

let parsedLock;
try {
  parsedLock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
} catch (error) {
  fail(`Failed to parse supabase/functions/deno.lock: ${error instanceof Error ? error.message : String(error)}`);
}

const actualVersion = String(parsedLock.version ?? "");
if (actualVersion !== expectedVersion) {
  fail(
    [
      `Unsupported supabase/functions/deno.lock version '${actualVersion || "unknown"}'.`,
      `Expected version '${expectedVersion}' for the local Supabase Edge Runtime compatibility lane.`,
      "Run `just supabase-functions-lock-refresh` to regenerate a compatible lockfile.",
    ].join(" "),
  );
}

console.log(`Supabase functions lockfile version ${actualVersion} is compatible.`);
