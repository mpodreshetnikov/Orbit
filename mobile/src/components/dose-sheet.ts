import { ActionSheetIOS } from "react-native";
import { doseName, isOpen, type DayDose } from "@/features/doses/model";
import { t } from "@/lib/i18n";
import type { DoseAction } from "@/lib/queries";

export type SheetChoice = { label: string; run: () => void };

/**
 * The system action sheet for one dose: what can be done to it from where it stands.
 *
 * The web app's per-dose menu, in the same order: a settled dose can be undone or switched to the
 * other answer, and an open or missed one can be answered either way. `actionable` is false for a
 * day still ahead, which the web app also refuses to answer; `extra` adds a screen's own choices,
 * such as opening the course.
 */
export function showDoseSheet(
  dose: DayDose,
  act: (dose: DayDose, action: DoseAction) => void,
  { actionable = true, extra = [] }: { actionable?: boolean; extra?: SheetChoice[] } = {},
) {
  const answers: SheetChoice[] = [];
  let destructive = -1;
  if (dose.status === "taken" || dose.status === "skipped") {
    destructive = 0;
    answers.push({ label: t("medications.undoIntake"), run: () => act(dose, "undo") });
    answers.push(
      dose.status === "taken"
        ? { label: t("medications.markAsSkipped"), run: () => act(dose, "skip") }
        : { label: t("medications.markAsTaken"), run: () => act(dose, "take") },
    );
  } else if (actionable && (isOpen(dose.status) || dose.status === "missed")) {
    answers.push({ label: t("medications.markAsTaken"), run: () => act(dose, "take") });
    answers.push({ label: t("medications.markAsSkipped"), run: () => act(dose, "skip") });
  }
  const choices = [...answers, ...extra];
  if (choices.length === 0) {
    return;
  }
  const options = [...choices.map((choice) => choice.label), t("common.cancel")];
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: doseName(dose),
      options,
      cancelButtonIndex: options.length - 1,
      destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
    },
    (index) => choices[index]?.run(),
  );
}
