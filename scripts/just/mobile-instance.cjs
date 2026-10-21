#!/usr/bin/env node
/**
 * Point the iOS client at an Orbit instance by its address alone.
 *
 * Asks the instance for its public settings (`/.well-known/orbit-instance`) and writes them to
 * `mobile/.env.local`, which Expo reads when the dev server starts. Run by `just mobile-start
 * <domain>`; once the file exists, a bare `just mobile-start` reuses it, and this only checks that it
 * is there.
 */

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, "..", "..", "mobile", ".env.local");
// Covers the connection, the headers and the body: an instance that stalls must not hang the start.
const TIMEOUT_MS = 15000;

/** Accept `orbit.example.com` or `https://orbit.example.com[/]`, and return the bare origin. */
function instanceOrigin(input) {
  const raw = String(input ?? "").trim();
  if (raw === "") throw new Error("Name the instance: just mobile-start orbit.example.com");
  const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.protocol !== "https:") throw new Error(`The instance must be https: ${raw}`);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Give the instance's address only, with no path: ${raw}`);
  }
  return url.origin;
}

/** The env file for what the instance answered, refusing anything that is not its own settings. */
function envFileFor(settings) {
  const { supabaseUrl, supabaseAnonKey } = settings ?? {};
  for (const [name, value] of [
    ["supabaseUrl", supabaseUrl],
    ["supabaseAnonKey", supabaseAnonKey],
  ]) {
    if (typeof value !== "string" || !/^[A-Za-z0-9._~:/-]+$/.test(value)) {
      throw new Error(`The instance answered without a usable ${name}.`);
    }
  }
  return [
    "# Written by `just mobile-start <domain>` from the instance's /.well-known/orbit-instance.",
    `EXPO_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
    `EXPO_PUBLIC_SUPABASE_ANON_KEY=${supabaseAnonKey}`,
    "",
  ].join("\n");
}

async function main() {
  if (!process.argv[2] && fs.existsSync(ENV_FILE)) return;
  const origin = instanceOrigin(process.argv[2]);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let settings;
  try {
    const response = await fetch(`${origin}/.well-known/orbit-instance`, { signal });
    if (!response.ok) {
      throw new Error(`${origin} answered ${response.status}; is it an Orbit instance?`);
    }
    settings = await response.json();
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error(`${origin} did not answer within ${TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  }
  fs.writeFileSync(ENV_FILE, envFileFor(settings));
  console.log(`mobile/.env.local now points at ${origin}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { envFileFor, instanceOrigin };
