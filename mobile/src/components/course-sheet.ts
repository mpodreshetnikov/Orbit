import type { MedRegimen } from "@orbit-types/regimen";
import { ActionSheetIOS, Alert } from "react-native";
import type { SheetChoice } from "@/components/dose-sheet";
import { t } from "@/lib/i18n";
import type { CourseChange } from "@/lib/queries";

/** What the sheet hands back: the form, a change to the course, or an amount to add to its stock. */
export type CourseSheetActions = {
  edit: () => void;
  change: (change: CourseChange) => void;
  refill: (amount: number) => void;
};

/** How long the system sheet takes to slide away. */
const SHEET_DISMISS_MS = 400;

/** "+5", "-3", "2,5": the refill field reads what a person types, comma or point. */
export function parseStockAmount(typed: string): number | null {
  const amount = Number(typed.trim().replace(",", ".").replace(/^\+/, ""));
  return Number.isFinite(amount) && amount !== 0 ? amount : null;
}

/** Ask before a change the web page also asks about, and run it on the confirming button. */
function confirm(message: string, label: string, run: () => void, destructive = false) {
  Alert.alert(message, undefined, [
    { text: t("common.cancel"), style: "cancel" },
    { text: label, style: destructive ? "destructive" : "default", onPress: run },
  ]);
}

/**
 * The refill dialog as the system's own prompt: a signed amount, positive to add to the stock and
 * negative to write some off.
 */
function askRefill(course: MedRegimen, refill: (amount: number) => void) {
  Alert.prompt(
    t("medications.refillButton"),
    `${course.custom_name} — ${t("medications.refillAmountDescription")}\n${t("medications.refillAmountHelp")}`,
    [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("medications.refillButton"),
        onPress: (typed?: string) => {
          const amount = parseStockAmount(typed ?? "");
          if (amount != null) refill(amount);
        },
      },
    ],
    "plain-text",
    "1",
    "numbers-and-punctuation",
  );
}

/**
 * The web course page's toolbar in one system sheet: edit, refill when the course keeps stock,
 * archive or bring back from the archive, and delete, each change confirmed with the web page's own
 * question.
 */
export function showCourseSheet(course: MedRegimen, actions: CourseSheetActions) {
  const choices: SheetChoice[] = [{ label: t("common.edit"), run: actions.edit }];
  if (course.inventory?.enabled) {
    choices.push({
      label: t("medications.refillButton"),
      run: () => askRefill(course, actions.refill),
    });
  }
  choices.push(
    course.status === "archived"
      ? {
          label: t("medications.unarchiveMedication"),
          run: () =>
            confirm(t("medications.unarchiveMedicationConfirm"), t("common.confirm"), () =>
              actions.change("unarchive"),
            ),
        }
      : {
          label: t("medications.archiveMedication"),
          run: () =>
            confirm(
              t("medications.archiveMedicationConfirm"),
              t("medications.archiveMedication"),
              () => actions.change("archive"),
            ),
        },
  );
  choices.push({
    label: t("medications.deleteMedication"),
    run: () =>
      confirm(
        t("medications.deleteMedicationConfirm"),
        t("common.delete"),
        () => actions.change("delete"),
        true,
      ),
  });
  const options = [...choices.map((choice) => choice.label), t("common.cancel")];
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: course.custom_name,
      options,
      cancelButtonIndex: options.length - 1,
      destructiveButtonIndex: choices.length - 1,
    },
    // iOS will not present the next alert while the sheet is still sliding away, and drops it
    // without a word: the refill prompt and the confirmations wait for the sheet to be gone.
    (index) => {
      const choice = choices[index];
      if (choice) setTimeout(choice.run, SHEET_DISMISS_MS);
    },
  );
}
