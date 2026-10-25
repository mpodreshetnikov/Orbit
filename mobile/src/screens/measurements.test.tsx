import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { ActionSheetIOS, Alert } from "react-native";
import { chartDomain, plot } from "@/components/charts";
import { byCategory, formatMoment, trendPercent } from "@/features/measurements/format";
import HealthScreen from "@/screens/health-screen";
import MeasurementFormScreen from "@/screens/measurement-form-screen";
import MeasurementScreen from "@/screens/measurement-screen";
import MeasurementVisibilityScreen from "@/screens/measurement-visibility-screen";
import MeasurementsScreen from "@/screens/measurements-screen";
import { db, fail, failOnce, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "health/index": HealthScreen,
  "health/measurements/index": MeasurementsScreen,
  "health/measurements/[code]": MeasurementScreen,
  "health/measurements/form": MeasurementFormScreen,
  "health/measurements/visibility": MeasurementVisibilityScreen,
};

const catalogEntry = (
  id: string,
  code: string,
  name: string,
  unit: string,
  category: string,
  sort = 0,
) => ({
  id,
  code,
  name_ru: name,
  name_en: code,
  unit_ru: unit,
  unit_en: unit,
  category,
  sort_order: sort,
});

const WEIGHT = catalogEntry("cat-weight", "weight", "Вес", "кг", "basic", 1);
const WAIST = catalogEntry("cat-waist", "waist", "Талия", "см", "body", 1);
const HEIGHT = catalogEntry("cat-height", "height", "Рост", "см", "basic", 2);
const BMI = catalogEntry("cat-bmi", "bmi", "ИМТ", "", "vital", 1);

function entry(id: string, catalog: typeof WEIGHT, value: number, day: number, notes?: string) {
  return {
    id,
    person_id: PERSON.id,
    catalog_id: catalog.id,
    value,
    measured_at: new Date(2026, 9, day, 8, 30).toISOString(),
    notes: notes ?? null,
    created_by_user_id: USER_ID,
    created_at: new Date(2026, 9, day, 8, 30).toISOString(),
    // The fake does not resolve joins; the list's joined catalogue is seeded in place.
    measurement_catalog: catalog,
  };
}

function seedMeasurements(hidden: Record<string, string[]> = {}) {
  seed({
    ...household(),
    measurement_catalog: [WEIGHT, WAIST, HEIGHT, BMI],
    measurements: [
      entry("w1", WEIGHT, 82, 1),
      entry("w2", WEIGHT, 80.5, 15, "после отпуска"),
      entry("t0", WAIST, 88, 5),
      entry("t1", WAIST, 90, 10),
      entry("b1", BMI, 24.5, 12),
    ],
    user_preferences: [{ auth_user_id: USER_ID, hidden_measurement_codes: hidden }],
  });
}

/** Answer the next action sheet with the option labelled so; keep what it offered. */
function chooseInSheet(label: string) {
  const offered: string[][] = [];
  jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementationOnce((options, cb) => {
    offered.push(options.options);
    cb(options.options.indexOf(label));
  });
  return offered;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seedMeasurements();
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the health tab", () => {
  it("opens the measurements from its menu", async () => {
    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByLabelText("Измерения"));
    expect(await screen.findByText("Вес")).toBeOnTheScreen();
  });
});

describe("the measurements list", () => {
  it("groups the person's measurements by category with the latest value", async () => {
    await renderScreens(routes, "/health/measurements");

    expect(await screen.findByText("ОСНОВНЫЕ")).toBeOnTheScreen();
    expect(screen.getByText("ТЕЛО")).toBeOnTheScreen();
    expect(screen.getByText("СОСТАВ ТЕЛА")).toBeOnTheScreen();
    expect(screen.getByText("80.5")).toBeOnTheScreen();
    expect(screen.getByText("15.10.2026")).toBeOnTheScreen();
    expect(screen.getAllByText("2 измерений")).toHaveLength(2);
    // A type with no entries is not on the list.
    expect(screen.queryByText("Рост")).toBeNull();
  });

  it("leaves out the types hidden for the person on the web's list", async () => {
    db.tables.user_preferences = [
      {
        auth_user_id: USER_ID,
        hidden_measurement_codes: { [PERSON.id]: [WAIST.code], someone: [WEIGHT.code] },
      },
    ];
    await renderScreens(routes, "/health/measurements");
    expect(await screen.findByText("Вес")).toBeOnTheScreen();
    expect(screen.queryByText(WAIST.name_ru)).toBeNull();
  });

  it("says so when the person has nothing recorded", async () => {
    db.tables.measurements = [];
    await renderScreens(routes, "/health/measurements");
    expect(await screen.findByText("Измерений пока нет")).toBeOnTheScreen();
  });

  it("leaves hidden types out and counts them under the list", async () => {
    seedMeasurements({ [PERSON.id]: ["waist"] });
    await renderScreens(routes, "/health/measurements");

    expect(await screen.findByText("Вес")).toBeOnTheScreen();
    expect(screen.queryByText("Талия")).toBeNull();
    await fireEvent.press(screen.getByText("Скрыто: 1"));
    expect(await screen.findByText(/^Снимите галочку/)).toBeOnTheScreen();
  });

  it("says when everything is hidden", async () => {
    seedMeasurements({ [PERSON.id]: ["waist", "weight", "bmi"] });
    await renderScreens(routes, "/health/measurements");
    expect(await screen.findByText("Все измерения скрыты")).toBeOnTheScreen();
  });

  it("offers a retry when the person cannot be read", async () => {
    fail("persons");
    await renderScreens(routes, "/health/measurements");
    expect(await screen.findByText("persons is unavailable")).toBeOnTheScreen();
  });

  it("offers a retry when the measurements cannot be read", async () => {
    fail("measurements");
    await renderScreens(routes, "/health/measurements");
    expect(await screen.findByText("measurements is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Вес")).toBeOnTheScreen();
  });
});

describe("a measurement's page", () => {
  it("shows the summary, the trend and the history newest first", async () => {
    await renderScreens(routes, "/health/measurements/weight");

    expect(await screen.findByText("Последнее значение")).toBeOnTheScreen();
    expect(screen.getByText("-1.8%")).toBeOnTheScreen();
    expect(screen.getByText("Основные")).toBeOnTheScreen();
    const rows = screen.getAllByLabelText(/^\d\d\.10\.2026, 08:30/);
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      "15.10.2026, 08:30 80.50",
      "01.10.2026, 08:30 82",
    ]);
    expect(within(rows[0]).getByText("после отпуска")).toBeOnTheScreen();
  });

  it("marks a single value as having no trend and says when a type is hidden", async () => {
    seedMeasurements({ [PERSON.id]: ["bmi"] });
    await renderScreens(routes, "/health/measurements/bmi");
    expect(await screen.findByText("Скрыто")).toBeOnTheScreen();
    expect(screen.getByText("—")).toBeOnTheScreen();
    expect(screen.getByLabelText("12.10.2026, 08:30 24.50")).toBeOnTheScreen();
  });

  it("marks a rise and draws the chart once it has a width", async () => {
    await renderScreens(routes, "/health/measurements/waist");
    expect(await screen.findByText("+2.3%")).toBeOnTheScreen();
    await fireEvent(screen.getByTestId("chart"), "layout", {
      nativeEvent: { layout: { width: 300, height: 200 } },
    });
    expect(screen.getByText("90.2")).toBeOnTheScreen();
    expect(screen.getByText("05.10.2026")).toBeOnTheScreen();
  });

  it("says when the person cannot be read rather than waiting", async () => {
    fail("persons");
    await renderScreens(routes, "/health/measurements/weight");
    expect(await screen.findByText("persons is unavailable")).toBeOnTheScreen();
  });

  it("says there is nothing for an unknown type", async () => {
    await renderScreens(routes, "/health/measurements/unknown");
    expect(await screen.findByText("Измерений пока нет")).toBeOnTheScreen();
  });

  it("deletes an entry after asking", async () => {
    await renderScreens(routes, "/health/measurements/weight");
    const alert = jest.spyOn(Alert, "alert");
    chooseInSheet("Удалить");
    await fireEvent.press(await screen.findByLabelText("15.10.2026, 08:30 80.50"));

    await waitFor(() => expect(alert).toHaveBeenCalled());
    const [title, , buttons] = alert.mock.calls[0];
    expect(title).toBe("Удалить измерение");
    buttons?.find((button) => button.style === "destructive")?.onPress?.();

    await waitFor(() =>
      expect(db.tables.measurements.map((row) => row.id)).toEqual(["w1", "t0", "t1", "b1"]),
    );
    expect(await screen.findByText("82")).toBeOnTheScreen();
  });

  it("corrects an entry in the form", async () => {
    await renderScreens(routes, "/health/measurements/weight");
    chooseInSheet("Редактировать");
    await fireEvent.press(await screen.findByLabelText("01.10.2026, 08:30 82"));

    const value = await screen.findByLabelText("Значение");
    expect(value.props.value).toBe("82");
    expect(screen.getByText("Вес")).toBeOnTheScreen();
    await fireEvent.changeText(value, "81,2");
    await fireEvent.changeText(screen.getByLabelText("Заметки (необязательно)"), " утром ");
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() =>
      expect(db.tables.measurements.find((row) => row.id === "w1")).toMatchObject({
        value: 81.2,
        notes: "утром",
      }),
    );
  });
});

describe("recording a measurement", () => {
  it("records a value of the page's type, with the last one shown for reference", async () => {
    await renderScreens(routes, "/health/measurements/weight");
    await fireEvent.press(await screen.findByLabelText("Добавить измерение"));

    expect(await screen.findByText(/Последняя запись: 80.50 кг · 15.10.2026/)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Значение"), "79.9");
    await fireEvent(screen.getByTestId("measured-at"), "change", {
      nativeEvent: { timestamp: new Date(2026, 9, 20, 7, 0).getTime() },
    });
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() => expect(db.tables.measurements).toHaveLength(6));
    expect(db.tables.measurements[5]).toMatchObject({
      person_id: PERSON.id,
      catalog_id: WEIGHT.id,
      created_by_user_id: USER_ID,
      value: 79.9,
      measured_at: new Date(2026, 9, 20, 7, 0).toISOString(),
      notes: null,
    });
  });

  it("picks the type from the catalogue when opened from the list", async () => {
    await renderScreens(routes, "/health/measurements");
    await fireEvent.press(await screen.findByLabelText("Добавить измерение"));
    await screen.findByText("Выберите тип измерения...");

    const offered = chooseInSheet("Рост, см · Основные");
    await fireEvent.press(screen.getByLabelText(/^Тип измерения/));
    expect(offered[0].slice(0, 3)).toEqual([
      "Вес, кг · Основные",
      "Рост, см · Основные",
      "Талия, см · Тело",
    ]);
    expect(await screen.findByText("Нет предыдущего значения")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Значение"), "182");
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() =>
      expect(db.tables.measurements.at(-1)).toMatchObject({ catalog_id: HEIGHT.id, value: 182 }),
    );
    // Back on the list; the fake does not join the new row's catalogue entry, so it is not drawn.
    await waitFor(() => expect(screen.queryByLabelText("Значение")).toBeNull());
  });

  it("keeps what the person typed when the entry refetches mid-edit", async () => {
    const { client } = await renderScreens(
      routes,
      "/health/measurements/form?code=weight&entry=w1",
    );
    const value = await screen.findByLabelText("Значение");
    await fireEvent.changeText(value, "79");
    db.tables.measurements = db.tables.measurements.map((row) =>
      row.id === "w1" ? { ...row, notes: "сервер" } : row,
    );
    await client.invalidateQueries({ queryKey: ["measurements"] });
    await waitFor(() =>
      expect(JSON.stringify(client.getQueryData(["measurements", PERSON.id]))).toContain("сервер"),
    );
    expect(screen.getByLabelText("Значение").props.value).toBe("79");
  });

  it("says when the measurements cannot be read, and retries", async () => {
    fail("measurements");
    await renderScreens(routes, "/health/measurements/form?code=weight&entry=w1");
    expect(await screen.findByText("measurements is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect((await screen.findByLabelText("Значение")).props.value).toBe("82");
  });

  it("says when the entry to correct is gone", async () => {
    await renderScreens(routes, "/health/measurements/form?code=weight&entry=gone");
    expect(await screen.findByText("Измерений пока нет")).toBeOnTheScreen();
  });

  it("saves nothing without a type and a value", async () => {
    await renderScreens(routes, "/health/measurements/form");
    await screen.findByText("Выберите тип измерения...");
    await fireEvent.press(screen.getByText("Сохранить"));
    expect(screen.getAllByText("Выберите тип измерения...")).toHaveLength(2);
    expect(db.tables.measurements).toHaveLength(5);
  });

  it("stays open and buzzes when the write fails", async () => {
    await renderScreens(routes, "/health/measurements/form?code=weight");
    await fireEvent.changeText(await screen.findByLabelText("Значение"), "80");
    fail("measurements");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() => expect(screen.getByLabelText("Значение")).toBeOnTheScreen());
    expect(db.tables.measurements).toHaveLength(5);
  });
});

describe("choosing measurements", () => {
  it("hides and shows types, each change building on the last", async () => {
    await renderScreens(routes, "/health/measurements/visibility");
    await fireEvent(await screen.findByLabelText("Вес"), "valueChange", false);
    // The whole row toggles, not only its switch.
    await fireEvent.press(screen.getByText("Талия"));

    await waitFor(() =>
      expect(db.tables.user_preferences[0].hidden_measurement_codes).toEqual({
        [PERSON.id]: ["weight", "waist"],
      }),
    );
    await fireEvent(screen.getByLabelText("Вес"), "valueChange", true);
    await waitFor(() =>
      expect(db.tables.user_preferences[0].hidden_measurement_codes).toEqual({
        [PERSON.id]: ["waist"],
      }),
    );
  });

  it("offers no switch until the stored choices have loaded", async () => {
    fail("user_preferences");
    await renderScreens(routes, "/health/measurements/visibility");
    expect(await screen.findByText("user_preferences is unavailable")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Вес")).toBeNull();
  });

  it("puts the switch back when the preference cannot be saved", async () => {
    await renderScreens(routes, "/health/measurements/visibility");
    const weight = await screen.findByLabelText("Вес");
    failOnce("user_preferences");
    await fireEvent(weight, "valueChange", false);
    await waitFor(() => expect(screen.getByLabelText("Вес").props.value).toBe(true));
  });
});

describe("the measurement helpers", () => {
  it("places values in the box, lowest at the bottom", () => {
    expect(plot([1, 3], 100, 50, 0)).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 0 },
    ]);
    expect(plot([5], 100, 50, 10)).toEqual([{ x: 50, y: 40 }]);
  });

  it("pads the chart's range and keeps it above zero", () => {
    expect(chartDomain([80, 90])).toEqual([79, 91]);
    expect(chartDomain([0.5])).toEqual([0, 1.5]);
  });

  it("measures the trend in percent", () => {
    expect(trendPercent([{ value: 100 }, { value: 110 }])).toEqual({ trend: "up", percent: 10 });
    expect(trendPercent([{ value: 100 }])).toBeNull();
  });

  it("formats a moment and drops empty categories", () => {
    expect(formatMoment(new Date(2026, 0, 2, 3, 4).toISOString())).toBe("02.01.2026, 03:04");
    expect(byCategory([{ category: "vital" as const }]).map((s) => s.category)).toEqual(["vital"]);
  });
});
