import { afterEach, describe, expect, it } from "vitest";
import {
  WORK_BOARD_ALLOWED_EMAIL,
  isWorkBoardEmailAllowed,
  isWorkBoardEnabled,
  resolveWorkBoardAccess,
} from "./access";

const ORIGINAL_FLAG = process.env.ORBIT_WORK_BOARD_ENABLED;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.ORBIT_WORK_BOARD_ENABLED;
  } else {
    process.env.ORBIT_WORK_BOARD_ENABLED = ORIGINAL_FLAG;
  }
});

describe("isWorkBoardEnabled", () => {
  it("defaults off", () => {
    delete process.env.ORBIT_WORK_BOARD_ENABLED;
    expect(isWorkBoardEnabled()).toBe(false);
  });

  it("turns on only for explicit 1/true", () => {
    process.env.ORBIT_WORK_BOARD_ENABLED = "1";
    expect(isWorkBoardEnabled()).toBe(true);
    process.env.ORBIT_WORK_BOARD_ENABLED = "true";
    expect(isWorkBoardEnabled()).toBe(true);
    process.env.ORBIT_WORK_BOARD_ENABLED = "0";
    expect(isWorkBoardEnabled()).toBe(false);
  });
});

describe("isWorkBoardEmailAllowed", () => {
  it("allows only the strict Maxim email", () => {
    expect(isWorkBoardEmailAllowed(WORK_BOARD_ALLOWED_EMAIL)).toBe(true);
    expect(isWorkBoardEmailAllowed("mpodreshetnikov@gmail.com")).toBe(true);
    expect(isWorkBoardEmailAllowed("MPodreshetnikov@gmail.com")).toBe(true);
    expect(isWorkBoardEmailAllowed("other@example.com")).toBe(false);
    expect(isWorkBoardEmailAllowed(null)).toBe(false);
    expect(isWorkBoardEmailAllowed(undefined)).toBe(false);
  });
});

describe("resolveWorkBoardAccess", () => {
  it("returns not-found when flag is off", () => {
    delete process.env.ORBIT_WORK_BOARD_ENABLED;
    expect(resolveWorkBoardAccess({ email: WORK_BOARD_ALLOWED_EMAIL })).toBe("not-found");
  });

  it("returns unauthenticated / forbidden / allow when enabled", () => {
    process.env.ORBIT_WORK_BOARD_ENABLED = "1";
    expect(resolveWorkBoardAccess({ email: null })).toBe("unauthenticated");
    expect(resolveWorkBoardAccess({ email: "other@example.com" })).toBe("forbidden");
    expect(resolveWorkBoardAccess({ email: WORK_BOARD_ALLOWED_EMAIL })).toBe("allow");
  });
});
