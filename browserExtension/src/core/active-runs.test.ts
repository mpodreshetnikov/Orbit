import { describe, expect, it } from "vitest";
import { createActiveRunRegistry } from "./active-runs.js";

describe("active run registry", () => {
  it("holds a session for one run at a time and tells listeners the count", () => {
    const registry = createActiveRunRegistry();
    const counts: number[] = [];
    const unsubscribe = registry.onChange((size) => counts.push(size));

    expect(registry.begin("s1")).toBe(true);
    expect(registry.begin("s1")).toBe(false);
    expect(registry.begin("s2")).toBe(true);
    expect(registry.has("s1")).toBe(true);
    expect(registry.size()).toBe(2);

    registry.end("s1");
    // Ending what was never begun is not a change.
    registry.end("s1");
    unsubscribe();
    registry.end("s2");

    expect(registry.has("s1")).toBe(false);
    expect(registry.size()).toBe(0);
    expect(counts).toEqual([1, 2, 1]);
  });

  it("gives an update the registry only when nothing runs, and keeps runs out until released", () => {
    const registry = createActiveRunRegistry();
    registry.begin("s1");
    expect(registry.holdForUpdate()).toBeNull();
    registry.end("s1");

    const release = registry.holdForUpdate();
    expect(release).not.toBeNull();
    expect(registry.isHeldForUpdate()).toBe(true);
    expect(registry.holdForUpdate()).toBeNull();
    expect(registry.begin("s2")).toBe(false);

    release!();
    release!();
    expect(registry.isHeldForUpdate()).toBe(false);
    expect(registry.begin("s2")).toBe(true);
  });
});
