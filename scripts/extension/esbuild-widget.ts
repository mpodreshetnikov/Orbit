import path from "node:path";
import { build } from "esbuild";

export async function buildSourcePageWidgetInpageBundle(input: {
  extensionDir: string;
  distDir: string;
}): Promise<void> {
  await build({
    entryPoints: [path.join(input.extensionDir, "src", "source-page-widget-inpage.ts")],
    outfile: path.join(input.distDir, "source-page-widget.inpage.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
  });
}
