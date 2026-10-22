import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, type AlertButton } from "react-native";
import { parseStockAmount } from "@/components/course-sheet";
import { clampOverdueInterval } from "@/features/medications/actions";
import HistoryScreen from "@/screens/history-screen";
import MedicationScreen from "@/screens/medication-screen";
import MedicationsScreen from "@/screens/medications-screen";
import {
  calls,
  db,
  fail,
  fakeSession,
  rpcHandlers,
  seed,
  setSession,
} from "../../test/fake-supabase";
import { household, NOW, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "medications/index": MedicationsScreen,
  "medications/[id]/index": MedicationScreen,
  "medications/[id]/history": HistoryScreen,
};

/** Answer the next action sheet with the option labelled `label`, and keep what it offered. */
function chooseInSheet(label: string) {
  const offered: string[][] = [];
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => {
      offered.push(options.options);
      callback(options.options.indexOf(label));
    });
  return offered;
}

/** Press `label` on the next alert, and keep its title. */
function answerAlert(label: string) {
  const titles: string[] = [];
  jest.spyOn(Alert, "alert").mockImplementationOnce((title, _message, buttons) => {
    titles.push(title);
    (buttons as AlertButton[]).find((button) => button.text === label)?.onPress?.();
  });
  return titles;
}

/** Type `value` into the next prompt and press its confirming button; `null` cancels it. */
function answerPrompt(value: string | null) {
  const defaults: (string | undefined)[] = [];
  jest
    .spyOn(Alert, "prompt")
    .mockImplementationOnce((_title, _message, buttons, _type, defaultValue) => {
      defaults.push(defaultValue);
      const [cancel, confirm] = buttons as AlertButton[];
      if (value === null) cancel.onPress?.();
      else (confirm.onPress as (text: string) => void)(value);
    });
  return defaults;
}

async function openCourseMenu(name: string) {
  await fireEvent.press(await screen.findByLabelText(`Действия: ${name}`));
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed(household());
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("a course's menu", () => {
  it("archives the course, drops the doses still ahead of it, and goes back to the list", async () => {
    const tomorrow = new Date(NOW.getTime() + 86_400_000).toISOString();
    db.tables.med_dose_events.push({
      ...db.tables.med_dose_events[0],
      id: "d-vitd-tomorrow",
      scheduled_at: tomorrow,
    });
    await renderScreens(routes, "/medications");
    await fireEvent.press(await screen.findByText("Vitamin D3"));
    const offered = chooseInSheet("В архив");
    const asked = answerAlert("В архив");
    await openCourseMenu("Vitamin D3");

    expect(offered[0]).toEqual([
      "Редактировать",
      "Пополнить",
      "В архив",
      "Удалить лекарство",
      "Отмена",
    ]);
    await waitFor(() => expect(asked[0]).toMatch(/^Отправить лекарство в архив\?/));
    await waitFor(() =>
      expect(db.tables.med_regimens.find((row) => row.id === "reg-vitd")?.status).toBe("archived"),
    );
    expect(db.tables.med_dose_events.map((row) => row.id)).not.toContain("d-vitd-tomorrow");
    // The overdue dose of this morning stays: only what is still ahead goes.
    expect(db.tables.med_dose_events.map((row) => row.id)).toContain("d-vitd-0800");
    expect(await screen.findByText("Магний")).toBeOnTheScreen();
  });

  it("brings an archived course back and stays on it", async () => {
    db.tables.med_regimens[1].status = "archived";
    await renderScreens(routes, "/medications/reg-mg");
    const offered = chooseInSheet("Вернуть из архива");
    answerAlert("Подтвердить");
    await openCourseMenu("Магний");

    // Магний keeps no stock, so there is nothing to refill.
    expect(offered[0]).toEqual([
      "Редактировать",
      "Вернуть из архива",
      "Удалить лекарство",
      "Отмена",
    ]);
    await waitFor(() =>
      expect(db.tables.med_regimens.find((row) => row.id === "reg-mg")?.status).toBe("active"),
    );
    expect(await screen.findByText("Активно")).toBeOnTheScreen();
  });

  it("deletes the course and its doses softly", async () => {
    await renderScreens(routes, "/medications");
    await fireEvent.press(await screen.findByText("Магний"));
    chooseInSheet("Удалить лекарство");
    answerAlert("Удалить");
    await openCourseMenu("Магний");

    await waitFor(() =>
      expect(db.tables.med_regimens.find((row) => row.id === "reg-mg")?.deleted_at).toBeTruthy(),
    );
    const doses = db.tables.med_dose_events.filter((row) => row.regimen_id === "reg-mg");
    expect(doses.every((row) => row.deleted_at)).toBe(true);
    expect(await screen.findByText("Vitamin D3")).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText("Магний")).toBeNull());
  });

  it("does nothing when the question is cancelled", async () => {
    await renderScreens(routes, "/medications/reg-mg");
    chooseInSheet("Удалить лекарство");
    answerAlert("Отмена");
    await openCourseMenu("Магний");
    expect(db.tables.med_regimens.find((row) => row.id === "reg-mg")?.deleted_at).toBeNull();
  });

  it("refills the stock, or writes some off", async () => {
    await renderScreens(routes, "/medications/reg-vitd");
    chooseInSheet("Пополнить");
    const shown = answerPrompt("+5");
    await openCourseMenu("Vitamin D3");
    await waitFor(() => expect(shown[0]).toBe("1"));
    await waitFor(() =>
      expect(calls.rpc).toContainEqual({
        name: "update_regimen_inventory",
        args: { p_regimen_id: "reg-vitd", p_type: "refill", p_amount: 5 },
      }),
    );

    chooseInSheet("Пополнить");
    answerPrompt("-2,5");
    await openCourseMenu("Vitamin D3");
    await waitFor(() =>
      expect(calls.rpc).toContainEqual({
        name: "update_regimen_inventory",
        args: { p_regimen_id: "reg-vitd", p_type: "correction", p_amount: -2.5 },
      }),
    );
  });

  it("refills nothing when the amount is not a number or the prompt is cancelled", async () => {
    await renderScreens(routes, "/medications/reg-vitd");
    chooseInSheet("Пополнить");
    answerPrompt("много");
    await openCourseMenu("Vitamin D3");
    chooseInSheet("Пополнить");
    answerPrompt(null);
    await openCourseMenu("Vitamin D3");
    expect(calls.rpc.filter((call) => call.name === "update_regimen_inventory")).toEqual([]);
  });

  it("keeps the course when the server refuses a refill", async () => {
    fail("update_regimen_inventory");
    await renderScreens(routes, "/medications/reg-vitd");
    chooseInSheet("Пополнить");
    answerPrompt("3");
    await openCourseMenu("Vitamin D3");
    await waitFor(() =>
      expect(calls.rpc.map((call) => call.name)).toContain("update_regimen_inventory"),
    );
    expect(screen.getByText(/Сейчас: 3 капсулы/)).toBeOnTheScreen();
  });
});

describe("the low-stock reminder", () => {
  it("is put off until the day picked", async () => {
    await renderScreens(routes, "/medications/reg-vitd");
    expect(await screen.findByText(/Если вы уже ждёте доставку/)).toBeOnTheScreen();
    expect(screen.queryByText("Снять отложение")).toBeNull();
    await fireEvent(screen.getByTestId("refill-snooze-date"), "change", {
      nativeEvent: { timestamp: new Date(2026, 9, 28, 12).getTime() },
    });
    await fireEvent.press(screen.getByText("Отложить напоминание"));
    await waitFor(() =>
      expect(calls.rpc).toContainEqual({
        name: "set_medication_refill_snooze",
        args: { p_regimen_id: "reg-vitd", p_snooze_until: "2026-10-28" },
      }),
    );
  });

  it("says until when it is put off, and can be brought back", async () => {
    rpcHandlers.get_medication_refill_snooze = () => "2026-10-30";
    await renderScreens(routes, "/medications/reg-vitd");
    expect(await screen.findByText(/отложено до: 30 окт/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Снять отложение"));
    await waitFor(() =>
      expect(calls.rpc).toContainEqual({
        name: "set_medication_refill_snooze",
        args: { p_regimen_id: "reg-vitd", p_snooze_until: null },
      }),
    );
  });

  it("counts a day already past as not put off", async () => {
    rpcHandlers.get_medication_refill_snooze = () => "2026-10-01";
    await renderScreens(routes, "/medications/reg-vitd");
    expect(await screen.findByText(/Если вы уже ждёте доставку/)).toBeOnTheScreen();
  });

  it("is not offered while the stock is fine", async () => {
    await renderScreens(routes, "/medications/reg-mg");
    await screen.findByText(/Дата окончания/);
    expect(screen.queryByText("Отложить напоминание")).toBeNull();
  });
});

describe("the reminder settings", () => {
  it("shows the interval in force and saves a new one", async () => {
    await renderScreens(routes, "/medications");
    await screen.findByText("Магний");
    const shown = answerPrompt("45");
    await fireEvent.press(screen.getByLabelText("Настройки"));
    expect(shown[0]).toBe("30");
    await waitFor(() =>
      expect(db.tables.user_preferences).toEqual([
        expect.objectContaining({ auth_user_id: USER_ID, overdue_reminder_interval_minutes: 45 }),
      ]),
    );
  });

  it("reads the account's own interval and ignores what is not a number", async () => {
    db.tables.user_preferences = [{ auth_user_id: USER_ID, overdue_reminder_interval_minutes: 90 }];
    await renderScreens(routes, "/medications");
    await screen.findByText("Магний");
    await waitFor(() => expect(screen.getByLabelText("Настройки")).toBeOnTheScreen());
    const shown = answerPrompt("0");
    await waitFor(async () => {
      await fireEvent.press(screen.getByLabelText("Настройки"));
      expect(shown.at(-1)).toBe("90");
    });
    expect(db.tables.user_preferences[0].overdue_reminder_interval_minutes).toBe(90);
  });
});

describe("helpers", () => {
  it("reads a signed amount, comma or point", () => {
    expect(parseStockAmount("+5")).toBe(5);
    expect(parseStockAmount(" -2,5 ")).toBe(-2.5);
    expect(parseStockAmount("0")).toBeNull();
    expect(parseStockAmount("")).toBeNull();
    expect(parseStockAmount("x")).toBeNull();
  });

  it("keeps the interval between a minute and a day", () => {
    expect(clampOverdueInterval(0)).toBe(1);
    expect(clampOverdueInterval(5000)).toBe(1440);
    expect(clampOverdueInterval(29.6)).toBe(30);
  });
});
