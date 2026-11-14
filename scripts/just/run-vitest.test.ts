import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TZ,
  REPO_ROOT,
  SPAWN_ERROR_EXIT,
  resolveVitestCli,
  runVitest,
} from "./run-vitest.cjs";

function resolvePkg(id: string) {
  return id === "vitest/package.json" ? "/pkg/vitest/package.json" : id;
}

describe("runVitest", () => {
  it("defaults TZ to Asia/Krasnoyarsk when unset", () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    const code = runVitest(["run", "--help"], {
      env: {},
      spawn: spawn as never,
      execPath: "/usr/bin/node",
      resolve: resolvePkg as never,
    });
    expect(code).toBe(0);
    const call = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: { TZ: string }; cwd: string; stdio: string },
    ];
    expect(call[0]).toBe("/usr/bin/node");
    expect(call[1][0]).toBe("/pkg/vitest/vitest.mjs");
    expect(call[1].slice(1)).toEqual(["run", "--help"]);
    expect(call[2].env.TZ).toBe(DEFAULT_TZ);
    expect(call[2].cwd).toBe(REPO_ROOT);
    expect(call[2].stdio).toBe("inherit");
  });

  it("preserves an explicit TZ", () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    runVitest([], {
      env: { TZ: "UTC" },
      spawn: spawn as never,
      resolve: resolvePkg as never,
    });
    const call = spawn.mock.calls[0] as unknown as [string, string[], { env: { TZ: string } }];
    expect(call[2].env.TZ).toBe("UTC");
  });

  it("returns SPAWN_ERROR_EXIT when spawn reports an error (not status fallthrough)", () => {
    const spawn = vi.fn(() => ({ error: new Error("boom"), status: null }));
    expect(runVitest([], { env: {}, spawn: spawn as never, resolve: resolvePkg as never })).toBe(
      SPAWN_ERROR_EXIT,
    );
    expect(SPAWN_ERROR_EXIT).toBe(2);
  });

  it("returns numeric status when present", () => {
    const spawn = vi.fn(() => ({ status: 7 }));
    expect(runVitest([], { env: {}, spawn: spawn as never, resolve: resolvePkg as never })).toBe(7);
  });

  it("returns 1 when status is null without error", () => {
    const spawn = vi.fn(() => ({ status: null }));
    expect(runVitest([], { env: {}, spawn: spawn as never, resolve: resolvePkg as never })).toBe(1);
  });

  it("resolveVitestCli joins vitest.mjs beside package.json", () => {
    expect(resolveVitestCli(resolvePkg as never)).toBe("/pkg/vitest/vitest.mjs");
  });
});
