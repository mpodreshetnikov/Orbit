import { describe, expect, it, vi } from "vitest";
import { createActiveRunRegistry } from "./active-runs.js";
import { applyUpdateWhenIdle } from "./update-deferral.js";

describe("update deferral", () => {
  it("reloads at once when nothing is running", () => {
    const reload = vi.fn();
    applyUpdateWhenIdle(createActiveRunRegistry(), reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("waits for the last running import to end, then reloads once", () => {
    const registry = createActiveRunRegistry();
    const reload = vi.fn();
    registry.begin("s1");
    registry.begin("s2");
    applyUpdateWhenIdle(registry, reload);
    expect(reload).not.toHaveBeenCalled();

    registry.end("s1");
    expect(reload).not.toHaveBeenCalled();

    registry.end("s2");
    expect(reload).toHaveBeenCalledTimes(1);

    registry.begin("s3");
    registry.end("s3");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
