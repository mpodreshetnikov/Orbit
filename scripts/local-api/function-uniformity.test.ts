import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FUNCTIONS_ROOT = path.resolve(__dirname, "..", "..", "supabase", "functions");

/** Directories the platform does not deploy: a leading underscore means shared code. */
function deployedFunctionNames(): string[] {
  return fs
    .readdirSync(FUNCTIONS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

describe("edge function shape", () => {
  it("finds the functions to check", () => {
    // A glob that matched nothing would make every assertion below vacuous, and this suite
    // would then report success while checking no function at all.
    expect(deployedFunctionNames().length).toBeGreaterThan(0);
  });

  it.each(deployedFunctionNames())("%s serves a handleRequest exported from handler.ts", (name) => {
    // The local API lane routes every function through one server by importing
    // `<name>/handler.ts` and calling its `handleRequest`. That works because every function
    // here is written the same way, which is an assumption about a convention rather than
    // about code — exactly the kind that breaks silently. A new function written any other
    // way must fail here, where the message says what is wrong, rather than as a 404 in an
    // acceptance test three layers away.
    const dir = path.join(FUNCTIONS_ROOT, name);
    const index = fs.readFileSync(path.join(dir, "index.ts"), "utf8");
    expect(index, `${name}/index.ts must serve ./handler.ts`).toMatch(
      /import\s*\{\s*handleRequest\s*\}\s*from\s*"\.\/handler\.ts"/,
    );
    expect(index, `${name}/index.ts must call Deno.serve(handleRequest)`).toMatch(
      /Deno\.serve\(\s*handleRequest\s*\)/,
    );

    const handler = fs.readFileSync(path.join(dir, "handler.ts"), "utf8");
    expect(handler, `${name}/handler.ts must export handleRequest`).toMatch(
      /export\s+(const|function|async function)\s+handleRequest\b/,
    );
  });

  it("keeps the local server out of everything that deploys", () => {
    // `supabase functions deploy` walks this directory and deploys what it finds. The local
    // server is not a function and must never be published as one; it is kept out by both of
    // the rules the CLI uses, not just one.
    const localDir = path.join(FUNCTIONS_ROOT, "_local");
    expect(fs.existsSync(localDir), "the local server directory is missing").toBe(true);
    expect(path.basename(localDir).startsWith("_")).toBe(true);
    expect(fs.existsSync(path.join(localDir, "index.ts"))).toBe(false);
    expect(deployedFunctionNames()).not.toContain("_local");
  });
});
