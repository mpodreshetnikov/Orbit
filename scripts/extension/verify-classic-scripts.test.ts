import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  findEsmStatements,
  listClassicScripts,
  verifyClassicScripts,
} from "./verify-classic-scripts";

async function makeDist(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "classic-scripts-"));
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content, "utf8");
  }
  return dir;
}

const MANIFEST = JSON.stringify({
  content_scripts: [{ matches: ["https://example.com/*"], js: ["content-script.js"] }],
});

describe("findEsmStatements", () => {
  it("catches the statement that actually shipped", () => {
    // The real first line of content-script.js in release 0.1.6.
    const found = findEsmStatements('import { createContentBridge } from "./core/content-bridge";');
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(1);
  });

  it("catches a bare side-effect import and an export", () => {
    expect(findEsmStatements('import "./polyfill.js";')).toHaveLength(1);
    expect(findEsmStatements("export const x = 1;")).toHaveLength(1);
  });

  it("leaves a bundled IIFE alone", () => {
    const bundled = [
      '"use strict";',
      "(() => {",
      '  var WEBAPP_SOURCE = "orbit-webapp";',
      "})();",
    ].join("\n");
    expect(findEsmStatements(bundled)).toEqual([]);
  });

  it("does not flag the word import inside code or comments", () => {
    // `import` as part of an identifier, a string, or a dynamic import is not a top-level
    // statement and does not stop a classic script from running.
    const source = [
      "// this file used to import the bridge",
      'const importantThing = "import x from y";',
      "const mod = await import('./lazy.js');",
    ].join("\n");
    expect(findEsmStatements(source)).toEqual([]);
  });
});

describe("verifyClassicScripts", () => {
  it("passes a dist whose classic scripts are bundled", async () => {
    const dir = await makeDist({
      "manifest.json": MANIFEST,
      "content-script.js": '"use strict";\n(() => { console.log("hi"); })();',
      "source-page-widget.inpage.js": '"use strict";\n(() => {})();',
    });
    await expect(verifyClassicScripts(dir)).resolves.toEqual([]);
  });

  it("reports a content script left as module output", async () => {
    const dir = await makeDist({
      "manifest.json": MANIFEST,
      "content-script.js": 'import { createContentBridge } from "./core/content-bridge";',
      "source-page-widget.inpage.js": '"use strict";\n(() => {})();',
    });
    const problems = await verifyClassicScripts(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe("content-script.js");
  });

  it("reports a file the manifest names but the build did not produce", async () => {
    const dir = await makeDist({
      "manifest.json": MANIFEST,
      "source-page-widget.inpage.js": '"use strict";\n(() => {})();',
    });
    const problems = await verifyClassicScripts(dir);
    expect(problems.map((p) => p.file)).toContain("content-script.js");
  });

  it("takes the list from the manifest, so a newly added content script is covered", async () => {
    const dir = await makeDist({
      "manifest.json": JSON.stringify({
        content_scripts: [{ js: ["content-script.js"] }, { js: ["another.js"] }],
      }),
    });
    await expect(listClassicScripts(dir)).resolves.toEqual([
      "content-script.js",
      "another.js",
      "source-page-widget.inpage.js",
    ]);
  });
});
