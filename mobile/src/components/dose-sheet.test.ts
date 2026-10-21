import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ActionSheetIOS, type ActionSheetIOSOptions } from "react-native";
import { showDoseSheet } from "@/components/dose-sheet";
import type { DayDose, DoseStatus } from "@/features/doses/model";

function dose(status: DoseStatus): DayDose {
  return {
    id: "d1",
    regimen_id: "r1",
    actual_at: "2026-10-21T08:00:00Z",
    taken_at: null,
    status,
    planned_intake: null,
    regimen: null,
  };
}

/** Open the sheet, answer it with `label` (or cancel), and return what it offered. */
function answer(status: DoseStatus, label: string | null, options = {}) {
  const act = jest.fn();
  const seen: { sheet?: ActionSheetIOSOptions } = {};
  jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation((sheet, callback) => {
    seen.sheet = sheet;
    callback(label === null ? sheet.options.length - 1 : sheet.options.indexOf(label));
  });
  showDoseSheet(dose(status), act, options);
  return { act, offered: seen.sheet };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("showDoseSheet", () => {
  it("offers undo, destructively, and the other answer for a taken dose", () => {
    const { act, offered } = answer("taken", "Отметить как пропуск");
    expect(offered?.options).toEqual(["Отменить приём", "Отметить как пропуск", "Отмена"]);
    expect(offered?.destructiveButtonIndex).toBe(0);
    expect(offered?.title).toBe("—");
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }), "skip");
  });

  it("offers taken for a skipped dose", () => {
    expect(answer("skipped", "Отметить как принято").act).toHaveBeenCalledWith(
      expect.anything(),
      "take",
    );
    expect(answer("skipped", "Отменить приём").act).toHaveBeenCalledWith(expect.anything(), "undo");
  });

  it("offers both answers for an open or missed dose", () => {
    expect(answer("missed", "Отметить как пропуск").act).toHaveBeenCalledWith(
      expect.anything(),
      "skip",
    );
    const { act, offered } = answer("scheduled", "Отметить как принято");
    expect(offered?.destructiveButtonIndex).toBeUndefined();
    expect(act).toHaveBeenCalledWith(expect.anything(), "take");
  });

  it("does nothing on cancel", () => {
    expect(answer("scheduled", null).act).not.toHaveBeenCalled();
  });

  it("offers only a screen's own choices for a day still ahead", () => {
    const run = jest.fn();
    const { offered } = answer("scheduled", "Открыть", {
      actionable: false,
      extra: [{ label: "Открыть", run }],
    });
    expect(offered?.options).toEqual(["Открыть", "Отмена"]);
    expect(run).toHaveBeenCalled();
  });

  it("shows no sheet when there is nothing to offer", () => {
    const spy = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions");
    showDoseSheet(dose("scheduled"), jest.fn(), { actionable: false });
    showDoseSheet(dose("cancelled"), jest.fn());
    expect(spy).not.toHaveBeenCalled();
  });
});
