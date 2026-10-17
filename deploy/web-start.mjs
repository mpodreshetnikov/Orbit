// Starts the self-hosted web app (deploy/web.Dockerfile). The image is built once, with the
// placeholders below where the instance's own values go, so the same image runs on every server:
// before Next starts, this writes the values from the container's environment into the compiled
// files. A container is recreated whenever its environment changes, so it fills them exactly once.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Keep in step with the build stage of deploy/web.Dockerfile.
const PLACEHOLDER_URL = "https://orbit-public-url.invalid";
const PLACEHOLDER_HOST = "orbit-public-url.invalid";
const VALUES = [
  ["NEXT_PUBLIC_SUPABASE_URL", PLACEHOLDER_URL, true],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "orbit-public-anon-key", true],
  ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "orbit-public-vapid-key", true],
  ["NEXT_PUBLIC_EXTENSION_ID", "orbit-public-extension-id", false],
];
// The values are written into JavaScript and JSON string literals, so only characters that mean
// nothing there are allowed: URLs, JWTs, base64url keys and extension ids all fit.
const SAFE = /^[A-Za-z0-9._~:/-]*$/;

const root = new URL(".", import.meta.url).pathname;
const stamp = join(root, ".next", "orbit-public-env.json");

function fail(message) {
  console.error(`orbit-web: ${message}`);
  process.exit(1);
}

function wanted() {
  const replacements = [];
  for (const [name, placeholder, required] of VALUES) {
    const value = process.env[name] ?? "";
    if (required && !value) fail(`${name} is not set`);
    if (!SAFE.test(value))
      fail(`${name} contains characters that cannot go into the app: ${value}`);
    replacements.push([placeholder, value]);
  }
  // Next's image optimizer config (next.config.ts) names the bare host, without scheme or port.
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname;
  replacements.push([PLACEHOLDER_HOST, host]);
  // Static chunks are cached by URL, and filling them in keeps their names, so their URLs carry
  // this instead (deploymentId in next.config.ts): new values, new URLs.
  const id = createHash("sha256").update(JSON.stringify(replacements)).digest("hex").slice(0, 16);
  replacements.push(["orbit-public-deployment-id", id]);
  return replacements;
}

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "cache") yield* files(path);
    } else if (/\.(js|mjs|cjs|json|html|rsc|body|meta|txt|map)$/.test(entry.name)) {
      yield path;
    }
  }
}

function fill(replacements) {
  let changed = 0;
  for (const path of [join(root, "server.js"), ...files(join(root, ".next"))]) {
    const before = readFileSync(path, "utf8");
    if (!before.includes("orbit-public-")) continue;
    let after = before;
    for (const [placeholder, value] of replacements) after = after.replaceAll(placeholder, value);
    writeFileSync(path, after);
    changed += 1;
  }
  return changed;
}

const replacements = wanted();
const summary = JSON.stringify(replacements);
if (existsSync(stamp)) {
  // Only a restart of the same container gets here, and its environment cannot have changed.
  if (readFileSync(stamp, "utf8") !== summary) {
    fail(
      "this container was filled with other values; recreate it: deploy/orbit compose up -d --force-recreate web",
    );
  }
} else {
  const changed = fill(replacements);
  if (changed === 0)
    fail("no placeholders found: the image was not built by deploy/web.Dockerfile");
  writeFileSync(stamp, summary);
  console.log(`orbit-web: wrote this instance's address and keys into ${changed} files`);
}

await import(join(root, "server.js"));
