import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, within } from "@testing-library/react-native";
import { chartDomain } from "@/components/charts";
import { formatDay } from "@/features/measurements/format";
import {
  chartPoints,
  rangeText,
  shownValue,
  statusTone,
  summaryRange,
} from "@/features/observations/format";
import HealthScreen from "@/screens/health-screen";
import ObservationScreen from "@/screens/observation-screen";
import ObservationsScreen from "@/screens/observations-screen";
import { db, fail, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "health/index": HealthScreen,
  "health/observations/index": ObservationsScreen,
  "health/observations/[code]": ObservationScreen,
};

const HGB = {
  name_ru: "Гемоглобин",
  name_en: "Hemoglobin",
  canonical_unit: "г/л",
  default_ref_low: 130,
  default_ref_high: 170,
};

function result(
  id: string,
  code: string | null,
  name: string,
  value: number | null,
  date: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    record_id: `rec-${id}`,
    obs_code: code,
    obs_name: name,
    catalog_id: null,
    value_numeric: value,
    value_text: null,
    value_canonical: null,
    unit: "г/л",
    unit_canonical: null,
    ref_range_low: null,
    ref_range_high: null,
    ref_range_low_canonical: null,
    ref_range_high_canonical: null,
    status: "normal",
    created_at: `${date}T09:00:00Z`,
    is_applied: true,
    // Joins are seeded in place: the fake resolves none.
    medical_records: { person_id: PERSON.id, record_date: date, status: "active" },
    observation_catalog: null,
    ...extra,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({
    ...household(),
    record_observations: [
      result("h1", "hgb", "Hb", 150, "2026-03-01", { observation_catalog: HGB }),
      result("h2", "hgb", "Hb", 120, "2026-09-01", {
        observation_catalog: HGB,
        status: "low",
        ref_range_low: 130,
        ref_range_high: 170,
      }),
      result("g1", "glucose", "glucose", 5.1, "2026-08-01", { unit: "ммоль/л" }),
      result("t1", null, "Цвет мочи", null, "2026-07-01", { value_text: "жёлтый", unit: null }),
      // Not applied, and from a draft record: neither is part of the history.
      result("x1", "hgb", "Hb", 99, "2026-10-01", { is_applied: false }),
      result("x2", "ldl", "LDL", 3, "2026-10-01", {
        medical_records: { person_id: PERSON.id, record_date: "2026-10-01", status: "draft" },
      }),
    ],
  });
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the lab values", () => {
  it("opens from the health menu with out-of-range values first", async () => {
    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByLabelText("Анализы"));

    const names = await screen.findAllByText(/^(Гемоглобин|glucose|Цвет мочи)$/);
    expect(names.map((name) => name.props.children)).toEqual([
      "Гемоглобин",
      "glucose",
      "Цвет мочи",
    ]);
    expect(screen.getByText("Ниже нормы")).toBeOnTheScreen();
    expect(screen.getByText("hgb")).toBeOnTheScreen();
    expect(screen.getByText("жёлтый")).toBeOnTheScreen();
    expect(screen.queryByText("LDL")).toBeNull();
  });

  it("says so when there are none", async () => {
    db.tables.record_observations = [];
    await renderScreens(routes, "/health/observations");
    expect(await screen.findByText("Показателей пока нет")).toBeOnTheScreen();
  });

  it("offers a retry when they cannot be read", async () => {
    fail("record_observations");
    await renderScreens(routes, "/health/observations");
    expect(await screen.findByText("record_observations is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Гемоглобин")).toBeOnTheScreen();
  });
});

describe("a lab value's history", () => {
  it("shows the latest result against its range, the trend and every result", async () => {
    await renderScreens(routes, "/health/observations");
    await fireEvent.press(await screen.findByText("Гемоглобин"));

    expect(await screen.findByText("Вне нормы")).toBeOnTheScreen();
    expect(screen.getByText("130–170")).toBeOnTheScreen();
    expect(screen.getByText("-20.0%")).toBeOnTheScreen();
    const rows = screen.getAllByLabelText(/^01\.0[39]\.2026/);
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      "01.09.2026 120",
      "01.03.2026 150",
    ]);
    expect(within(rows[0]).getByText("Норма: 130–170")).toBeOnTheScreen();
    await fireEvent(screen.getByTestId("chart"), "layout", {
      nativeEvent: { layout: { width: 300, height: 200 } },
    });
    expect(screen.getAllByText("01.03.2026")).toHaveLength(2);
  });

  it("shows a text result without a chart", async () => {
    await renderScreens(routes, "/health/observations/цвет мочи");
    expect(await screen.findByLabelText("01.07.2026 жёлтый")).toBeOnTheScreen();
    expect(screen.queryByTestId("chart")).toBeNull();
  });

  it("says there is nothing for an unknown value", async () => {
    await renderScreens(routes, "/health/observations/unknown");
    expect(await screen.findByText("Показателей пока нет")).toBeOnTheScreen();
  });
});

describe("the observation helpers", () => {
  it("formats values, ranges and status colours", () => {
    expect(shownValue(null, null)).toBe("—");
    expect(rangeText(1, null)).toBe("—");
    expect(rangeText(3.8850000000000002, 5)).toBe("3.885–5");
    expect([statusTone("normal"), statusTone("high"), statusTone("critical_low")]).toEqual([
      "success",
      "rising",
      "destructive",
    ]);
  });
});

describe("the observation chart and range", () => {
  const point = (id: string, date: string, value: number | null, text: string | null = null) => ({
    id,
    record_id: "r",
    record_date: date,
    value_numeric: value,
    value_text: text,
    value_canonical: null,
    unit: "u",
    unit_canonical: null,
    ref_range_low: null,
    ref_range_high: null,
    ref_range_low_canonical: null,
    ref_range_high_canonical: null,
    status: null,
    created_at: date,
  });

  it("keeps each charted value with its own date, leaving text-only results out", () => {
    expect(
      chartPoints([
        point("a", "2026-01-01", 1),
        point("b", "2026-02-01", 2),
        point("c", "2026-03-01", null, "neg"),
      ]),
    ).toEqual([
      { value: 1, date: "2026-01-01" },
      { value: 2, date: "2026-02-01" },
    ]);
  });

  it("judges a converted value against its converted range", () => {
    expect(
      summaryRange({
        latest_ref_low: 200,
        latest_ref_high: 900,
        latest_ref_low_canonical: 148,
        latest_ref_high_canonical: 664,
        default_ref_low: 100,
        default_ref_high: 500,
      } as Parameters<typeof summaryRange>[0]),
    ).toEqual([148, 664]);
  });

  it("lets a negative range go below zero", () => {
    expect(chartDomain([-2, -1])).toEqual([-2.1, -0.9]);
    expect(chartDomain([-1, 2])[0]).toBeLessThan(-1);
  });

  it("shows a date-only value as that day", () => {
    expect(formatDay("2026-09-01")).toBe("01.09.2026");
  });
});
