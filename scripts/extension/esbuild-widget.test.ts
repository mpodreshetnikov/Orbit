import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildMock } = vi.hoisted(() => ({
  buildMock: vi.fn(),
}));

vi.mock("esbuild", () => ({
  build: buildMock,
}));

import { buildClassicScriptBundles, EXTENSION_CLASSIC_SCRIPTS } from "./esbuild-widget";

describe("extension classic script bundling", () => {
  const rootDir = path.join("repo-root");
  const extensionDir = path.join(rootDir, "browserExtension");
  const distDir = path.join(extensionDir, "dist");

  beforeEach(() => {
    buildMock.mockReset();
    buildMock.mockResolvedValue({
      errors: [],
      warnings: [],
      outputFiles: undefined,
      metafile: undefined,
      mangleCache: undefined,
    });
  });

  it("bundles the in-page widget through the esbuild API with browser settings", async () => {
    await buildClassicScriptBundles({ extensionDir, distDir });

    expect(buildMock).toHaveBeenCalledWith({
      bundle: true,
      entryPoints: [path.join(extensionDir, "src", "source-page-widget-inpage.ts")],
      format: "iife",
      outfile: path.join(distDir, "source-page-widget.inpage.js"),
      platform: "browser",
      target: ["es2020"],
    });
  });

  it("bundles the content script the same way", async () => {
    await buildClassicScriptBundles({ extensionDir, distDir });

    // Without this the content script ships as tsc's module output, whose top-level import is a
    // syntax error in a classic script -- so it never runs and the app cannot see the extension.
    expect(buildMock).toHaveBeenCalledWith({
      bundle: true,
      entryPoints: [path.join(extensionDir, "src", "content-script.ts")],
      format: "iife",
      outfile: path.join(distDir, "content-script.js"),
      platform: "browser",
      target: ["es2020"],
    });
  });

  it("builds every declared classic script and nothing else", async () => {
    await buildClassicScriptBundles({ extensionDir, distDir });
    expect(buildMock).toHaveBeenCalledTimes(EXTENSION_CLASSIC_SCRIPTS.length);
  });
});
