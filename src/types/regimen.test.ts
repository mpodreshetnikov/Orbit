import { describe, expect, it } from "vitest";
import { getEffectiveStatus } from "./regimen";
import type { MedDuration, MedRegimenStatus } from "./regimen";

function regimen(
  status: MedRegimenStatus,
  duration?: MedDuration,
): { status: MedRegimenStatus; duration?: MedDuration } {
  return { status, duration };
}

describe("getEffectiveStatus", () => {
  const today = "2026-03-05";

  it("returns non-active status as-is", () => {
    expect(getEffectiveStatus(regimen("paused"), { today })).toBe("paused");
    expect(getEffectiveStatus(regimen("completed"), { today })).toBe("completed");
    expect(getEffectiveStatus(regimen("archived"), { today })).toBe("archived");
  });

  it("returns active when no duration or endless", () => {
    expect(getEffectiveStatus(regimen("active"), { today })).toBe("active");
    expect(
      getEffectiveStatus(regimen("active", { type: "endless", start_date: "2026-01-01" }), {
        today,
      }),
    ).toBe("active");
  });

  it("returns completed when until_date end_date is in the past", () => {
    expect(
      getEffectiveStatus(
        regimen("active", { type: "until_date", end_date: "2026-03-01", start_date: "2026-01-01" }),
        { today },
      ),
    ).toBe("completed");
    expect(
      getEffectiveStatus(
        regimen("active", { type: "until_date", end_date: "2026-03-04", start_date: "2026-01-01" }),
        { today },
      ),
    ).toBe("completed");
  });

  it("returns active when until_date end_date is today or in the future", () => {
    expect(
      getEffectiveStatus(
        regimen("active", { type: "until_date", end_date: "2026-03-05", start_date: "2026-01-01" }),
        { today },
      ),
    ).toBe("active");
    expect(
      getEffectiveStatus(
        regimen("active", { type: "until_date", end_date: "2026-03-10", start_date: "2026-01-01" }),
        { today },
      ),
    ).toBe("active");
  });

  it("returns completed when for_days end is in the past", () => {
    // start 2026-03-01 + 3 days => end 2026-03-04
    expect(
      getEffectiveStatus(
        regimen("active", { type: "for_days", days: 3, start_date: "2026-03-01" }),
        { today },
      ),
    ).toBe("completed");
  });

  it("returns active when for_days end is today or in the future", () => {
    // start 2026-03-01 + 7 days => end 2026-03-08
    expect(
      getEffectiveStatus(
        regimen("active", { type: "for_days", days: 7, start_date: "2026-03-01" }),
        { today },
      ),
    ).toBe("active");
    // end exactly today: start 2026-03-01 + 4 days => 2026-03-05
    expect(
      getEffectiveStatus(
        regimen("active", { type: "for_days", days: 4, start_date: "2026-03-01" }),
        { today },
      ),
    ).toBe("active");
  });
});
