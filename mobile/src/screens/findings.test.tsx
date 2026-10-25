import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert } from "react-native";
import FindingScreen from "@/screens/finding-screen";
import FindingsScreen from "@/screens/findings-screen";
import HealthScreen from "@/screens/health-screen";
import { db, fail, failOnce, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "health/index": HealthScreen,
  "health/findings/index": FindingsScreen,
  "health/findings/[key]": FindingScreen,
};

function finding(id: string, code: string | null, text: string, date: string, extra = {}) {
  return {
    id,
    record_id: "rec-1",
    finding_type_id: code ? `type-${code}` : null,
    finding_code: code,
    finding_type_text: text,
    body_site_id: null,
    site_code: "kidney_left",
    body_site_text: "Left kidney",
    size_mm: null,
    count: null,
    resolution_status: "observed",
    severity: "mild",
    laterality: "left",
    morphology: null,
    description: null,
    histology: null,
    source_anchor: "",
    created_at: `${date}T09:00:00Z`,
    // Joins are seeded in place: the fake resolves none.
    medical_records: { person_id: PERSON.id, record_date: date, status: "active" },
    finding_type_catalog: code ? { name_ru: "Киста", name_en: "Cyst" } : null,
    body_site_catalog: { name_ru: "Левая почка", name_en: "Left kidney" },
    ...extra,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({
    ...household(),
    record_findings: [
      finding("c1", "cyst", "Cyst", "2025-01-10", { size_mm: 12, source_anchor: "киста 12 мм" }),
      finding("c2", "cyst", "Cyst", "2026-02-10", {
        size_mm: 14,
        count: 2,
        severity: "moderate",
        description: "Простая киста",
      }),
      finding("p1", null, "Polyp", "2025-06-01", {
        site_code: null,
        body_site_text: null,
        laterality: "none",
      }),
      finding("p2", null, "Polyp", "2026-01-01", {
        site_code: null,
        body_site_text: null,
        laterality: "none",
        resolution_status: "resolved",
        severity: "unknown",
      }),
    ],
    medical_records: [
      {
        id: "rec-1",
        person_id: PERSON.id,
        title: "УЗИ",
        record_date: "2026-02-10",
        status: "active",
      },
      { id: "rec-2", person_id: PERSON.id, title: "Осмотр", record_date: null, status: "active" },
      { id: "rec-3", person_id: PERSON.id, title: "Черновик", record_date: null, status: "draft" },
    ],
  });
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the findings", () => {
  it("opens from the health menu, active ones first and resolved ones after", async () => {
    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByLabelText("Находки"));

    expect(await screen.findByText("Активные находки (1)")).toBeOnTheScreen();
    expect(screen.getByText("Устранённые находки (1)")).toBeOnTheScreen();
    expect(screen.getByText("Слева Левая почка")).toBeOnTheScreen();
    expect(screen.getByText("14 мм")).toBeOnTheScreen();
    expect(screen.getByText("Умеренная")).toBeOnTheScreen();
    expect(screen.getByText("Polyp")).toBeOnTheScreen();
    expect(screen.getByText("Устранена")).toBeOnTheScreen();
  });

  it("says so when there are none", async () => {
    db.tables.record_findings = [];
    await renderScreens(routes, "/health/findings");
    expect(await screen.findByText("Нет находок")).toBeOnTheScreen();
  });

  it("offers a retry when the person cannot be read", async () => {
    fail("persons");
    await renderScreens(routes, "/health/findings");
    expect(await screen.findByText("persons is unavailable")).toBeOnTheScreen();
  });

  it("offers a retry when they cannot be read", async () => {
    fail("record_findings");
    await renderScreens(routes, "/health/findings");
    expect(await screen.findByText("record_findings is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Киста")).toBeOnTheScreen();
  });
});

describe("a finding's history", () => {
  it("shows the latest size, each sighting newest first, and the source's words", async () => {
    await renderScreens(routes, "/health/findings");
    await fireEvent.press(await screen.findByText("Киста"));

    expect(await screen.findByText("Последний размер")).toBeOnTheScreen();
    expect(screen.getAllByText("Слева").length).toBeGreaterThan(0);
    expect(screen.getByText("x2")).toBeOnTheScreen();
    expect(screen.getByText("Простая киста")).toBeOnTheScreen();
    expect(screen.getByText("“киста 12 мм”")).toBeOnTheScreen();
    const dates = screen.getAllByText(/^10\.0[12]\.20(25|26)$/).map((one) => one.props.children);
    expect(dates).toEqual(["10.02.2026", "10.01.2025"]);
  });

  it("marks a finding resolved on a record picked from the sheet", async () => {
    await renderScreens(routes, "/health/findings/cyst%3A%3Akidney_left");
    const offered: string[][] = [];
    jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementationOnce((options, callback) => {
        offered.push(options.options);
        callback(1);
      });
    await fireEvent.press(await screen.findByText("Отметить как устранённую"));

    expect(offered[0]).toEqual(["УЗИ · 10.02.2026", "Осмотр", "Отмена"]);
    await waitFor(() =>
      expect(db.tables.record_findings.at(-1)).toMatchObject({
        record_id: "rec-2",
        finding_code: "cyst",
        site_code: "kidney_left",
        resolution_status: "resolved",
        laterality: "left",
      }),
    );
  });

  it("says when marking it fails, and does nothing on cancel", async () => {
    await renderScreens(routes, "/health/findings/cyst%3A%3Akidney_left");
    const alert = jest.spyOn(Alert, "alert");
    const sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions");
    sheet.mockImplementationOnce((_options, callback) => callback(2));
    await fireEvent.press(await screen.findByText("Отметить как устранённую"));
    expect(db.tables.record_findings).toHaveLength(4);

    fail("record_findings");
    sheet.mockImplementationOnce((_options, callback) => callback(0));
    await fireEvent.press(screen.getByText("Отметить как устранённую"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "record_findings is unavailable"),
    );
  });

  it("shows a resolved finding without the button to resolve it", async () => {
    await renderScreens(routes, "/health/findings/polyp%3A%3Aunknown");
    expect(await screen.findByText("Н/Д")).toBeOnTheScreen();
    expect(screen.getAllByText("Устранена")).toHaveLength(2);
    expect(screen.getAllByText("Не указан").length).toBeGreaterThan(0);
    expect(screen.queryByText("Отметить как устранённую")).toBeNull();
  });

  it("dates a sighting by the finding's own date when it has one", async () => {
    db.tables.record_findings[0].finding_date = "2024-11-05";
    await renderScreens(routes, "/health/findings/cyst%3A%3Akidney_left");
    expect(await screen.findByText("05.11.2024")).toBeOnTheScreen();
    expect(screen.queryByText("10.01.2025")).toBeNull();
  });

  it("says when the person cannot be read on a finding's own page, and retries", async () => {
    failOnce("persons");
    await renderScreens(routes, "/health/findings/cyst%3A%3Akidney_left");
    expect(await screen.findByText("persons is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Последний размер")).toBeOnTheScreen();
  });

  it("offers no resolving while the records cannot be read, and retries them", async () => {
    failOnce("medical_records");
    await renderScreens(routes, "/health/findings/cyst%3A%3Akidney_left");
    expect(await screen.findByText("medical_records is unavailable")).toBeOnTheScreen();
    expect(screen.queryByText("Отметить как устранённую")).toBeNull();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Отметить как устранённую")).toBeOnTheScreen();
  });

  it("says when the finding is not there", async () => {
    await renderScreens(routes, "/health/findings/gone");
    expect(await screen.findByText("Находка не найдена")).toBeOnTheScreen();
  });
});
