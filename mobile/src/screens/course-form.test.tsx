import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert } from "react-native";
import * as courseForm from "@/features/medications/form";
const { formProblem, initialCourseForm, parseAmount, slotTime, timeOnDay } = courseForm;
import CourseFormScreen from "@/screens/course-form-screen";
import MedicationScreen from "@/screens/medication-screen";
import MedicationsScreen from "@/screens/medications-screen";
import { calls, db, fail, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "medications/index": MedicationsScreen,
  "medications/new": CourseFormScreen,
  "medications/[id]/index": MedicationScreen,
  "medications/[id]/edit": CourseFormScreen,
};

/** Answer the next action sheets, in order, with the options labelled so; keep what each offered. */
function chooseInSheets(...labels: string[]) {
  const offered: string[][] = [];
  const spy = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions");
  for (const label of labels) {
    spy.mockImplementationOnce((options, callback) => {
      offered.push(options.options);
      callback(options.options.indexOf(label));
    });
  }
  return offered;
}

/** Set a compact picker, as the system does when a day or a time is chosen in it. */
async function pick(testID: string, date: Date) {
  await fireEvent(screen.getByTestId(testID), "change", {
    nativeEvent: { timestamp: date.getTime() },
  });
}

async function openNewForm(kind: "Разово" | "Регулярно") {
  await renderScreens(routes, "/medications");
  chooseInSheets(kind);
  await fireEvent.press(await screen.findByLabelText("Добавить лекарство"));
  return screen.findByLabelText("Название");
}

const save = () => fireEvent.press(screen.getByText("Сохранить"));
const courseNamed = (name: string) =>
  db.tables.med_regimens.find((row) => row.custom_name === name);

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({ ...household(), user_preferences: [] });
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("a new regular course", () => {
  it("saves what the web form saves, generates its doses, and opens it", async () => {
    await fireEvent.changeText(await openNewForm("Регулярно"), " Омега-3 ");
    await fireEvent.press(screen.getByText("2"));
    await fireEvent.changeText(screen.getByLabelText("Дозировка одной единицы"), "1000");
    await fireEvent(screen.getByLabelText("Учитывать запас"), "valueChange", true);
    await fireEvent.changeText(screen.getByLabelText("Сейчас"), "60");
    await fireEvent.changeText(screen.getByLabelText("Напомнить, когда меньше"), "10");
    await fireEvent.changeText(screen.getByLabelText("Заметки"), "с рыбой");
    await save();

    await waitFor(() => expect(screen.queryByLabelText("Название")).toBeNull());
    // The new course is open, with the stock it was given.
    expect(await screen.findByText(/^Сейчас: 60/)).toBeOnTheScreen();
    const course = courseNamed("Омега-3");
    expect(course).toMatchObject({
      person_id: PERSON.id,
      status: "active",
      intake_unit: "pill",
      schedule: { mode: "daily_times", times: ["09:00", "20:00"], amounts: [1, 1] },
      duration: { type: "endless", start_date: expect.any(String) },
      inventory: { enabled: true, current_amount: 60, refill_threshold_amount: 10 },
      notes: "с рыбой",
      dose_definition: {
        intake: { amount: 1, unit: "pill" },
        unit_strength: [{ name: "Омега-3", amount: 1000, unit: "milligram" }],
      },
    });
    expect(calls.rpc.map((call) => call.name)).toEqual([
      "clear_future_med_dose_events_for_person",
      "generate_med_dose_events_for_horizon_for_person",
    ]);
    expect(calls.rpc[1].args).toMatchObject({ p_person_id: PERSON.id, p_horizon_days: 7 });
    expect(db.tables.user_preferences).toEqual([
      expect.objectContaining({ auth_user_id: USER_ID, checkup_notification_timezone: "UTC" }),
    ]);
  });

  it("refuses to save without a name, and says why", async () => {
    await openNewForm("Регулярно");
    await save();
    expect(await screen.findByText("Укажите название")).toBeOnTheScreen();
    expect(db.tables.med_regimens).toHaveLength(3);
  });

  it("edits every part of the schedule the web form does", async () => {
    await fireEvent.changeText(await openNewForm("Регулярно"), "Железо");
    const offered = chooseInSheets(
      "мл",
      "мкг",
      "Каждые x дней",
      "Дата окончания",
      "Своё (напр. с едой)",
    );
    await fireEvent.press(screen.getByLabelText("Единица: таблетка"));
    await fireEvent.press(screen.getByLabelText("Единица дозировки: мг"));
    await fireEvent.press(screen.getByLabelText("Частота: Ежедневно"));
    expect(offered[2]).toEqual([
      "Ежедневно",
      "Каждые x часов",
      "Каждые x дней",
      "Конкретные дни недели",
      "Отмена",
    ]);
    await fireEvent.changeText(screen.getByLabelText("дней"), "2");
    await fireEvent.press(screen.getByText("Добавить время"));
    await pick("slot-time-1", new Date(2026, 9, 21, 22, 30));
    await fireEvent.changeText(screen.getByLabelText("Количество на приём 2"), "2,5");
    await fireEvent.press(screen.getByText("Добавить время"));
    await fireEvent.press(screen.getByLabelText("Удалить: 12:00"));
    await pick("start-date", new Date(2026, 9, 25, 12));
    await fireEvent.press(screen.getByLabelText("Конец: Без конца"));
    await pick("end-date", new Date(2026, 11, 1, 12));
    await fireEvent.press(screen.getByLabelText("Когда принимать: Неважно"));
    await fireEvent.changeText(screen.getByLabelText("Своё (напр. с едой)"), "с апельсином");
    await save();

    await waitFor(() => expect(courseNamed("Железо")).toBeDefined());
    expect(courseNamed("Железо")).toMatchObject({
      intake_unit: "ml",
      dose_definition: { intake: { amount: 1, unit: "ml" } },
      schedule: {
        mode: "interval_days",
        interval: { every: 2 },
        times: ["09:00", "22:30"],
        amounts: [1, 2.5],
      },
      duration: { type: "until_date", start_date: "2026-10-25", end_date: "2026-12-01" },
      intake_advice_type: "custom",
      intake_advice_text: "с апельсином",
      inventory: null,
    });
  });

  it("asks for a time once per slot, and for at least one day", async () => {
    await fireEvent.changeText(await openNewForm("Регулярно"), "Цинк");
    await fireEvent.press(screen.getByText("Добавить время"));
    await pick("slot-time-1", new Date(2026, 9, 21, 9, 0));
    await save();
    expect(await screen.findByText(/Два приёма не могут быть/)).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByLabelText("Удалить: 09:00")[1]);
    chooseInSheets("X дней с начала");
    await fireEvent.press(screen.getByLabelText("Конец: Без конца"));
    await fireEvent.changeText(screen.getByLabelText("Принимать (дней)"), "");
    await save();
    expect(await screen.findByText("Укажите количество дней (не менее 1).")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("Принимать (дней)"), "10");
    await save();
    await waitFor(() => expect(courseNamed("Цинк")).toBeDefined());
    expect(courseNamed("Цинк")?.duration).toMatchObject({ type: "for_days", days: 10 });
  });

  it("keeps the form and says what went wrong when the save fails", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    fail("generate_med_dose_events_for_horizon_for_person");
    await fireEvent.changeText(await openNewForm("Регулярно"), "Цинк");
    await save();
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", expect.any(String)),
    );
    expect(screen.getByLabelText("Название")).toBeOnTheScreen();
  });

  it("goes back without saving on cancel", async () => {
    await fireEvent.changeText(await openNewForm("Регулярно"), "Цинк");
    await fireEvent.press(screen.getByText("Отмена"));
    await waitFor(() => expect(screen.queryByLabelText("Название")).toBeNull());
    expect(courseNamed("Цинк")).toBeUndefined();
  });
});

describe("a one-off intake", () => {
  it("goes into the course of the name picked under the field", async () => {
    await fireEvent.changeText(await openNewForm("Разово"), "маг");
    await fireEvent.press(screen.getAllByText("Магний").at(-1)!);
    await fireEvent.changeText(screen.getByLabelText("Количество (единиц)"), "2");
    await save();

    await waitFor(() => expect(screen.queryByLabelText("Название")).toBeNull());
    await waitFor(() => expect(calls.rpc.map((call) => call.name)).toEqual(["mark_dose_taken"]));
    const intake = db.tables.med_dose_events.at(-1);
    expect(intake).toMatchObject({
      regimen_id: "reg-mg",
      person_id: PERSON.id,
      planned_intake: { intake: { amount: 2, unit: "pill" } },
      status: "taken",
    });
    expect(Math.abs(Date.parse(intake?.scheduled_at as string) - NOW.getTime())).toBeLessThan(
      5_000,
    );
    expect(db.tables.med_regimens).toHaveLength(3);
  });

  it("becomes a course of its own under a new name", async () => {
    await fireEvent.changeText(await openNewForm("Разово"), "Ибупрофен");
    await pick("scheduled-at", new Date(2026, 9, 21, 10, 15));
    await save();

    await waitFor(() => expect(courseNamed("Ибупрофен")).toBeDefined());
    const course = courseNamed("Ибупрофен");
    expect(course).toMatchObject({
      schedule: { mode: "one_off", due_at: new Date(2026, 9, 21, 10, 15).toISOString() },
      inventory: null,
      notes: null,
    });
    await waitFor(() =>
      expect(db.tables.med_dose_events.at(-1)).toMatchObject({
        regimen_id: course?.id,
        status: "taken",
      }),
    );
  });
});

describe("editing a course", () => {
  it("opens on the course, saves the change, and regenerates its doses", async () => {
    await renderScreens(routes, "/medications/reg-omep");
    chooseInSheets("Редактировать");
    await fireEvent.press(await screen.findByLabelText("Действия: Омепразол"));

    expect(await screen.findByDisplayValue("Омепразол")).toBeOnTheScreen();
    expect(screen.getByLabelText("Частота: Каждые x часов")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("12")).toBeOnTheScreen();
    expect(screen.getByLabelText("Когда принимать: Перед едой")).toBeOnTheScreen();
    chooseInSheets("Конкретные дни недели");
    await fireEvent.press(screen.getByLabelText("Частота: Каждые x часов"));
    await fireEvent.press(screen.getByText("Пн"));
    await fireEvent.press(screen.getByText("Сб"));
    await save();

    await waitFor(() =>
      expect(db.tables.med_regimens.find((row) => row.id === "reg-omep")?.schedule).toEqual({
        mode: "days_of_week",
        days_of_week: [2, 3, 4, 5, 6],
        times: ["09:00"],
      }),
    );
    expect(calls.rpc.map((call) => call.name)).toContain(
      "generate_med_dose_events_for_horizon_for_person",
    );
    await waitFor(() => expect(screen.queryByLabelText("Название")).toBeNull());
  });

  it("says when the course is gone", async () => {
    await renderScreens(routes, "/medications/missing/edit");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });
});

describe("the form's helpers", () => {
  it("reads typed amounts and slot times", () => {
    expect(parseAmount(" 2,5 ")).toBe(2.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("x")).toBeNull();
    expect(slotTime(timeOnDay("7:05", NOW))).toBe("07:05");
    expect(slotTime(timeOnDay("", NOW))).toBe("00:00");
    const once = { ...initialCourseForm(null, "one_time", NOW), name: "Б", scheduledAt: null };
    expect([formProblem(once, false), formProblem(once, true)?.field]).toEqual([
      null,
      "scheduledAt",
    ]);
  });
});
