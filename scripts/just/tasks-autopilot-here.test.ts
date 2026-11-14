import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { REPO_ROOT, main } from "./tasks-autopilot-here.cjs";

describe("tasks-autopilot-here main", () => {
  it("exits 1 and prints how to link when the registry is unreachable", () => {
    const error = vi.fn();
    const spawn = vi.fn();
    const code = main(["--dry-run"], {
      locateRegistry: () => null,
      spawn: spawn as never,
      error: error as never,
    });
    expect(code).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).toMatch(/registry is not reachable/);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/ORBIT_TASKS_REGISTRY/);
  });

  it("spawns the registry autopilot with argv and inherits its status", () => {
    const registryRoot = "/tmp/orbit-tasks-fixture";
    const spawn = vi.fn(() => ({ status: 0 }));
    const code = main(["--wip-limit", "5"], {
      locateRegistry: (root) => {
        expect(root).toBe(REPO_ROOT);
        return registryRoot;
      },
      spawn: spawn as never,
      execPath: "/usr/bin/node",
      error: vi.fn() as never,
    });
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledOnce();
    const call = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { stdio: string; cwd: string },
    ];
    expect(call[0]).toBe("/usr/bin/node");
    expect(call[1]).toEqual([
      path.join(registryRoot, "scripts", "just", "tasks-autopilot.cjs"),
      "--wip-limit",
      "5",
    ]);
    expect(call[2]).toEqual({ stdio: "inherit", cwd: registryRoot });
  });

  it("returns 1 when spawn reports a null status", () => {
    const spawn = vi.fn(() => ({ status: null }));
    expect(
      main([], {
        locateRegistry: () => "/tmp/orbit-tasks-fixture",
        spawn: spawn as never,
      }),
    ).toBe(1);
  });

  it("returns a non-zero spawn status unchanged", () => {
    const spawn = vi.fn(() => ({ status: 7 }));
    expect(
      main([], {
        locateRegistry: () => "/tmp/orbit-tasks-fixture",
        spawn: spawn as never,
      }),
    ).toBe(7);
  });
});
