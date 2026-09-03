import fs from "node:fs/promises";
import path from "node:path";

/**
 * Proves that every script the browser will load as a classic script actually is one.
 *
 * This exists because the failure it catches is silent in every other way. `content-script.js`
 * shipped for months as `tsc`'s module output, whose first line is a top-level `import`. In a
 * classic script that is a syntax error, so the file never ran: no bridge, no reply to the page's
 * ping, and an installed extension that the app reported as absent. Nothing failed loudly --
 * the build succeeded, the zip was well formed, the manifest was correct, and the only symptom
 * was a feature that quietly did not exist.
 *
 * A file is classic if the manifest lists it in `content_scripts[].js` or if it is injected with
 * `chrome.scripting.executeScript`, neither of which offers a module option in MV3.
 */

/** Matched at the start of a line: `import x from "y"`, `import "y"`, `export ...`. */
const ESM_STATEMENT = /^[ \t]*(?:import[ \t{*"'`]|export[ \t{*])/m;

export interface ClassicScriptProblem {
  file: string;
  line: number;
  statement: string;
}

export function findEsmStatements(source: string): ClassicScriptProblem[] {
  const problems: ClassicScriptProblem[] = [];
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    if (ESM_STATEMENT.test(line)) {
      problems.push({ file: "", line: index + 1, statement: line.trim() });
    }
  });
  return problems;
}

/**
 * Every classic script in a built extension directory, taken from the manifest rather than from a
 * list kept here: a content script added to the manifest and not to a list nobody remembers would
 * be exactly the same bug again.
 */
export async function listClassicScripts(distDir: string): Promise<string[]> {
  const manifestRaw = await fs.readFile(path.join(distDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as {
    content_scripts?: Array<{ js?: string[] }>;
  };

  const fromManifest = (manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []);
  // Injected by `background.ts` through executeScript, which has the same limitation and no
  // manifest entry to read it from.
  const injected = ["source-page-widget.inpage.js"];
  return Array.from(new Set([...fromManifest, ...injected]));
}

export async function verifyClassicScripts(distDir: string): Promise<ClassicScriptProblem[]> {
  const problems: ClassicScriptProblem[] = [];
  for (const file of await listClassicScripts(distDir)) {
    const full = path.join(distDir, file);
    let source: string;
    try {
      source = await fs.readFile(full, "utf8");
    } catch {
      problems.push({ file, line: 0, statement: "the manifest names this file and it is missing" });
      continue;
    }
    for (const problem of findEsmStatements(source)) {
      problems.push({ ...problem, file });
    }
  }
  return problems;
}

export function formatClassicScriptProblems(problems: ClassicScriptProblem[]): string {
  const lines = problems.map((p) =>
    p.line === 0 ? `  ${p.file}: ${p.statement}` : `  ${p.file}:${p.line}  ${p.statement}`,
  );
  return [
    "These are loaded as classic scripts and cannot contain module syntax.",
    "A top-level import here is a syntax error, so the file never runs and the feature it",
    "carries goes missing without any error anywhere:",
    "",
    ...lines,
    "",
    "Bundle them: add the entry to EXTENSION_CLASSIC_SCRIPTS in scripts/extension/esbuild-widget.ts.",
  ].join("\n");
}
