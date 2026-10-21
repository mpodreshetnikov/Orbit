import type { MedRegimen } from "@orbit-types/regimen";
import { describe, expect, it } from "@jest/globals";
import { displayStatus, filterRegimens } from "@/features/medications/list";

function course(id: string, name: string, extra: Partial<MedRegimen> = {}): MedRegimen {
  return {
    id,
    custom_name: name,
    status: "active",
    schedule: { mode: "daily_times", times: ["09:00"] },
    duration: { type: "endless" },
    ...extra,
  } as MedRegimen;
}

const TODAY = "2026-10-21";

describe("displayStatus", () => {
  it("shows a one-off intake as completed", () => {
    expect(
      displayStatus(
        course("a", "А", { schedule: { mode: "one_off", due_at: "2026-10-01" } }),
        TODAY,
      ),
    ).toBe("completed");
  });

  it("shows an active course past its end date as completed", () => {
    const ended = course("a", "А", { duration: { type: "until_date", end_date: "2026-10-01" } });
    expect(displayStatus(ended, TODAY)).toBe("completed");
  });
});

describe("filterRegimens", () => {
  const list = [
    course("1", "Омепразол", { status: "completed" }),
    course("2", "Магний"),
    course("3", "Мелатонин", { status: "paused" }),
  ];

  it("lists finished courses after the running ones", () => {
    expect(
      filterRegimens(list, { status: "all", query: "", today: TODAY }).map((one) => one.id),
    ).toEqual(["2", "3", "1"]);
  });

  it("filters by status", () => {
    expect(
      filterRegimens(list, { status: "paused", query: "", today: TODAY }).map((one) => one.id),
    ).toEqual(["3"]);
  });

  it("searches names without regard to case", () => {
    expect(
      filterRegimens(list, { status: "all", query: " ма", today: TODAY }).map((one) => one.id),
    ).toEqual(["2"]);
  });
});
