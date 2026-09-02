import path from "node:path";
import { build } from "esbuild";

/**
 * Scripts the browser loads as classic scripts, not modules, and which therefore have to arrive
 * as one self-contained file.
 *
 * `tsc` emits ES modules, which is right for `background.js` -- the manifest declares it
 * `"type": "module"` and the browser resolves its imports. Nothing else here gets that treatment:
 * a `content_scripts` entry and a `chrome.scripting.executeScript` file are both classic scripts,
 * where a top-level `import` is a syntax error and the file simply never runs. There is no
 * `"type": "module"` to reach for -- MV3 does not offer one for either -- so they are bundled.
 */
export const EXTENSION_CLASSIC_SCRIPTS = [
  { entry: "content-script.ts", outfile: "content-script.js" },
  { entry: "source-page-widget-inpage.ts", outfile: "source-page-widget.inpage.js" },
] as const;

export async function buildClassicScriptBundles(input: {
  extensionDir: string;
  distDir: string;
}): Promise<void> {
  for (const script of EXTENSION_CLASSIC_SCRIPTS) {
    await build({
      entryPoints: [path.join(input.extensionDir, "src", script.entry)],
      // Written after `tsc` has run, so this overwrites the module build of the same name.
      outfile: path.join(input.distDir, script.outfile),
      bundle: true,
      format: "iife",
      platform: "browser",
      target: ["es2020"],
    });
  }
}
