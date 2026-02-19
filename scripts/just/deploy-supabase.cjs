#!/usr/bin/env node

const { spawnSync } = require("child_process");
const NPX_BIN = process.platform === "win32" ? "npx.cmd" : "npx";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for argument --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function run(cmd, cmdArgs, envOverride = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    env: { ...process.env, ...envOverride },
  });

  if (typeof result.status === "number") {
    return result.status;
  }

  if (result.error) {
    console.error(result.error.message);
  }
  return 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target || "unknown";
  const projectRef = args["project-ref"];
  const databaseUrl = args["database-url"];

  if (!projectRef) {
    throw new Error("Missing --project-ref");
  }
  if (!databaseUrl) {
    throw new Error("Missing --database-url");
  }

  if (target !== "ci") {
    console.error(`WARNING: This command mutates remote Supabase state (target=${target}).`);
  }

  const steps = [
    [NPX_BIN, ["supabase", "functions", "deploy", "--project-ref", projectRef]],
    [NPX_BIN, ["supabase", "db", "push", "--yes", "--db-url", databaseUrl]],
    ["node", ["supabase/db/run-deploy.js"], { DATABASE_URL: databaseUrl }],
  ];

  for (const [cmd, cmdArgs, envOverride] of steps) {
    const code = run(cmd, cmdArgs, envOverride || {});
    if (code !== 0) {
      process.exit(code);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
