import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildMock } = vi.hoisted(() => ({
  buildMock: vi.fn(),
}));

vi.mock("esbuild", () => ({
  build: buildMock,
}));

import { buildSourcePageWidgetInpageBundle } from "./esbuild-widget";

describe("extension esbuild widget bundling", () => {
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
    await buildSourcePageWidgetInpageBundle({ extensionDir, distDir });

    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(buildMock).toHaveBeenCalledWith({
      bundle: true,
      entryPoints: [path.join(extensionDir, "src", "source-page-widget-inpage.ts")],
      format: "iife",
      outfile: path.join(distDir, "source-page-widget.inpage.js"),
      platform: "browser",
      target: ["es2020"],
    });
  });
});
