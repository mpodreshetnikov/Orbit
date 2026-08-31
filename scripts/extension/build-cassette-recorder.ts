#!/usr/bin/env node
/**
 * Bundles the console cassette recorder into one paste-ready file.
 *
 * The output is meant to be handed to whoever can sign in to the bank — a single file they
 * paste into the page's console — so it must carry the scrubber with it rather than import it.
 * Keeping the source in `scripts/extension/` and generating the snippet means the recorder and
 * the scrubber that guards the committed cassettes can never drift apart.
 *
 *   node --experimental-strip-types scripts/extension/build-cassette-recorder.ts [outfile]
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { build } from "esbuild";

export async function buildCassetteRecorderSnippet(input: {
  scriptsDir: string;
  outfile: string;
}): Promise<void> {
  await build({
    entryPoints: [path.join(input.scriptsDir, "cassette-console-recorder.browser.ts")],
    outfile: input.outfile,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    banner: {
      js: [
        "/* Orbit cassette recorder — paste into the console of a signed-in bank page.",
        " * Reads this page's own operations, scrubs identifiers in the browser, downloads",
        " * cassette.json. Sends nothing anywhere. Source: scripts/extension/cassette-console-recorder.ts",
        " */",
      ].join("\n"),
    },
  });
}

const isEntryPoint = process.argv[1]?.endsWith("build-cassette-recorder.ts");
if (isEntryPoint) {
  // `new URL(...).pathname` yields "/C:/..." on Windows, which path handling then turns into
  // "\\C:\\..." and esbuild cannot open. The other extension build scripts convert for the same
  // reason.
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const outfile = path.resolve(
    process.argv[2] ?? path.join(scriptsDir, "..", "..", ".tmp", "cassette-recorder.js"),
  );
  buildCassetteRecorderSnippet({ scriptsDir, outfile })
    .then(() => console.info(`cassette recorder snippet written to ${outfile}`))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
