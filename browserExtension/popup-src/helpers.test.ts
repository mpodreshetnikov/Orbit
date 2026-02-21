import { describe, expect, it } from "vitest";
import { formatSession, toIsoFromInput } from "./helpers";

describe("popup helpers", () => {
  it("formats null session state", () => {
    expect(formatSession(null)).toBe("No active session");
  });

  it("formats session json", () => {
    expect(formatSession({ id: 1 })).toContain('"id": 1');
  });

  it("parses datetime-local input", () => {
    expect(toIsoFromInput("2026-02-10T10:20")).toBe(new Date("2026-02-10T10:20").toISOString());
    expect(toIsoFromInput("")).toBeNull();
    expect(toIsoFromInput("not-a-date")).toBeNull();
  });
});
