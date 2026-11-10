import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import type { FindingSummary } from "@orbit-types/finding";
import CompleteCheckupScreen from "@/screens/checkup-sheets";
import CheckupScreen from "@/screens/checkup-screen";
import CheckupsScreen from "@/screens/checkups-screen";
import ConditionsScreen from "@/screens/conditions-screen";
import FindingsScreen from "@/screens/findings-screen";
import HealthScreen, { findingSparkValues } from "@/screens/health-screen";
import MeasurementsScreen from "@/screens/measurements-screen";
import ObservationsScreen from "@/screens/observations-screen";
import RecordsScreen from "@/screens/records-screen";
import {
  db,
  fail,
  failOnce,
  fakeSession,
  rpcHandlers,
  seed,
  setSession,
} from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "health/index": HealthScreen,
  "health/records/index": RecordsScreen,
  "health/conditions/index": ConditionsScreen,
  "health/findings/index": FindingsScreen,
  "health/checkups/index": CheckupsScreen,
  "health/checkups/[id]": CheckupScreen,
  "health/checkups/complete": CompleteCheckupScreen,
  "health/observations/index": ObservationsScreen,
  "health/measurements/index": MeasurementsScreen,
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({
    ...household(),
    medical_records: [
      {
        id: "r-blood",
        person_id: PERSON.id,
        created_by_user_id: USER_ID,
        record_type: "lab",
        record_date: "2026-10-15",
        title: "Общий анализ крови",
        notes: null,
        status: "active",
        removed_at: null,
        created_at: "2026-10-15T10:00:00Z",
        updated_at: "2026-10-15T10:00:00Z",
      },
    ],
    conditions: [
      {
        id: "anemia",
        person_id: PERSON.id,
        name: "Анемия",
        icd_name_en: null,
        icd_name_ru: null,
        code: null,
        current_status: "active",
        onset_date: null,
        resolved_date: null,
        notes: null,
        created_at: "2025-03-01T09:00:00Z",
        updated_at: "2025-03-01T09:00:00Z",
        deleted_at: null,
        mention_count: 3,
        first_mentioned_date: "2025-03-01",
        last_mentioned_date: "2026-02-10",
      },
      {
        id: "gastritis",
        person_id: PERSON.id,
        name: "Гастрит",
        icd_name_en: null,
        icd_name_ru: null,
        code: null,
        current_status: "suspected",
        onset_date: null,
        resolved_date: null,
        notes: null,
        created_at: "2026-01-05T09:00:00Z",
        updated_at: "2026-01-05T09:00:00Z",
        deleted_at: null,
        mention_count: 1,
        first_mentioned_date: "2026-01-05",
        last_mentioned_date: "2026-01-05",
      },
    ],
    checkup_items: [
      {
        id: "blood",
        person_id: PERSON.id,
        title: "Анализ крови",
        category: "lab",
        schedule: { type: "interval", every: 1, unit: "year" },
        next_due_at: "2026-09-01",
        status: "active",
        reminder_days_before: [7],
        planned_on: null,
        why_text: null,
        why_links: [],
        notes: null,
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
    ],
    checkup_completions: [],
    record_findings: [
      {
        id: "c1",
        record_id: "r-blood",
        finding_type_id: "type-cyst",
        finding_code: "cyst",
        finding_type_text: "Cyst",
        body_site_id: null,
        site_code: "kidney_left",
        body_site_text: "Left kidney",
        size_mm: 12,
        count: null,
        resolution_status: "observed",
        severity: "mild",
        laterality: "left",
        morphology: null,
        description: null,
        histology: null,
        source_anchor: "",
        created_at: "2025-01-10T09:00:00Z",
        medical_records: { person_id: PERSON.id, record_date: "2025-01-10", status: "active" },
        finding_type_catalog: { name_ru: "Киста", name_en: "Cyst" },
        body_site_catalog: { name_ru: "Левая почка", name_en: "Left kidney" },
      },
      {
        id: "c2",
        record_id: "r-blood",
        finding_type_id: "type-cyst",
        finding_code: "cyst",
        finding_type_text: "Cyst",
        body_site_id: null,
        site_code: "kidney_left",
        body_site_text: "Left kidney",
        size_mm: 14,
        count: 2,
        resolution_status: "observed",
        severity: "moderate",
        laterality: "left",
        morphology: null,
        description: null,
        histology: null,
        source_anchor: "",
        created_at: "2026-02-10T09:00:00Z",
        medical_records: { person_id: PERSON.id, record_date: "2026-02-10", status: "active" },
        finding_type_catalog: { name_ru: "Киста", name_en: "Cyst" },
        body_site_catalog: { name_ru: "Левая почка", name_en: "Left kidney" },
      },
    ],
  });
  // seed() clears rpc handlers — register after it.
  rpcHandlers.get_person_conditions_with_history = (args) =>
    db.tables.conditions.filter((row) => row.person_id === args.p_person_id && !row.deleted_at);
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the health dashboard", () => {
  it("shows documents search, condition and finding tiles, and checkups with mark-done", async () => {
    await renderScreens(routes, "/health");

    expect(await screen.findByLabelText("Поиск документов")).toBeOnTheScreen();
    expect(await screen.findByText("Общий анализ крови")).toBeOnTheScreen();
    expect(screen.getByText("2 открытых")).toBeOnTheScreen();
    expect(screen.getByText("Анемия")).toBeOnTheScreen();
    expect(screen.getByText("1 активная")).toBeOnTheScreen();
    expect(screen.getByText("Киста")).toBeOnTheScreen();
    expect(screen.getByText("Анализ крови")).toBeOnTheScreen();
    expect(screen.getByText("1 просрочен")).toBeOnTheScreen();
    expect(screen.getByText("Отметить выполненным")).toBeOnTheScreen();
    expect(screen.getByText("Анализы и измерения")).toBeOnTheScreen();
    expect(screen.queryByText("Каталог")).toBeNull();
  });

  it("opens the keep lists from the dashboard tiles", async () => {
    await renderScreens(routes, "/health");

    await fireEvent.press(await screen.findByLabelText("Диагнозы"));
    expect(await screen.findByText("Активные диагнозы (1)")).toBeOnTheScreen();
  });

  it("opens documents, findings, checkups and mark-done from the hub", async () => {
    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByText("Все документы"));
    expect(await screen.findByText("Все типы")).toBeOnTheScreen();

    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByLabelText("Находки"));
    expect(await screen.findByText("Активные находки (1)")).toBeOnTheScreen();

    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByLabelText("Чек-апы"));
    expect(await screen.findByText("Анализ крови")).toBeOnTheScreen();

    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByText("Отметить выполненным"));
    expect(await screen.findByLabelText("Заметка")).toBeOnTheScreen();

    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByText("Все"));
    expect(await screen.findByText("Просрочено")).toBeOnTheScreen();
  });

  it("opens secondary chart lists from the hub", async () => {
    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByLabelText("Анализы"));
    expect(await screen.findByText("Показателей пока нет")).toBeOnTheScreen();

    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByLabelText("Измерения"));
    expect(await screen.findByText("Измерений пока нет")).toBeOnTheScreen();
  });

  it("filters the documents hero and retries a failed checkup strip", async () => {
    await renderScreens(routes, "/health");
    await fireEvent.changeText(await screen.findByLabelText("Поиск документов"), "нет такого");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
    await fireEvent(screen.getByLabelText("Поиск документов"), "submitEditing");

    failOnce("checkup_items");
    await renderScreens(routes, "/health");
    expect(await screen.findByText("checkup_items is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Анализ крови")).toBeOnTheScreen();
  });

  it("retries when the person query fails on the documents hero", async () => {
    failOnce("persons");
    await renderScreens(routes, "/health");
    expect(await screen.findByText("persons is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Общий анализ крови")).toBeOnTheScreen();
  });

  it("says when there are no checkups yet", async () => {
    db.tables.checkup_items = [];
    await renderScreens(routes, "/health");
    expect(await screen.findByText("Нет чек-апов")).toBeOnTheScreen();
  });

  it("keeps later checkups visible instead of claiming there are none", async () => {
    db.tables.checkup_items = [
      {
        id: "teeth",
        person_id: PERSON.id,
        title: "Стоматолог",
        category: "dental",
        schedule: { type: "interval", every: 1, unit: "year" },
        next_due_at: "2026-12-01",
        status: "active",
        reminder_days_before: [7],
        planned_on: null,
        why_text: null,
        why_links: [],
        notes: null,
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
    ];
    await renderScreens(routes, "/health");
    expect(await screen.findByText("Стоматолог")).toBeOnTheScreen();
    expect(screen.queryByText("Нет чек-апов")).toBeNull();
  });

  it("says when checkups exist but none are imminent or later-dated", async () => {
    db.tables.checkup_items = [
      {
        id: "flu",
        person_id: PERSON.id,
        title: "Прививка",
        category: "vaccination",
        schedule: { type: "interval", every: 1, unit: "year" },
        next_due_at: "2026-11-01",
        status: "paused",
        reminder_days_before: [7],
        planned_on: null,
        why_text: null,
        why_links: [],
        notes: null,
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
    ];
    await renderScreens(routes, "/health");
    expect(await screen.findByText("Нет просроченных и ближайших чек-апов")).toBeOnTheScreen();
    expect(screen.queryByText("Нет чек-апов")).toBeNull();
  });

  it("keeps mark-done beside a long checkup title and shows several compact rows", async () => {
    db.tables.checkup_items = [
      {
        id: "long",
        person_id: PERSON.id,
        title: "Очень длинный ежегодный осмотр с уточнением специализации",
        category: "visit",
        schedule: { type: "interval", every: 1, unit: "year" },
        next_due_at: "2026-09-15",
        status: "active",
        reminder_days_before: [7],
        planned_on: null,
        why_text: null,
        why_links: [],
        notes: null,
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
      {
        id: "blood2",
        person_id: PERSON.id,
        title: "Анализ крови",
        category: "lab",
        schedule: { type: "interval", every: 1, unit: "year" },
        next_due_at: "2026-10-01",
        status: "active",
        reminder_days_before: [7],
        planned_on: null,
        why_text: null,
        why_links: [],
        notes: null,
        created_at: "2026-01-02T09:00:00Z",
        updated_at: "2026-01-02T09:00:00Z",
      },
      {
        id: "flu2",
        person_id: PERSON.id,
        title: "Прививка от гриппа",
        category: "vaccination",
        schedule: { type: "interval", every: 1, unit: "year" },
        next_due_at: "2026-10-20",
        status: "active",
        reminder_days_before: [7],
        planned_on: null,
        why_text: null,
        why_links: [],
        notes: null,
        created_at: "2026-01-03T09:00:00Z",
        updated_at: "2026-01-03T09:00:00Z",
      },
    ];
    await renderScreens(routes, "/health");
    expect(
      await screen.findByText("Очень длинный ежегодный осмотр с уточнением специализации"),
    ).toBeOnTheScreen();
    expect(screen.getByText("Анализ крови")).toBeOnTheScreen();
    expect(screen.getByText("Прививка от гриппа")).toBeOnTheScreen();
    expect(screen.getAllByText("Отметить выполненным")).toHaveLength(3);
    expect(
      screen.getByLabelText("Отметить выполненным: Очень длинный ежегодный осмотр с уточнением специализации"),
    ).toBeOnTheScreen();
  });

  it("passes the document search into the records list", async () => {
    db.tables.medical_records.push({
      id: "r-mri",
      person_id: PERSON.id,
      created_by_user_id: USER_ID,
      record_type: "imaging",
      record_date: "2026-08-20",
      title: "МРТ колена",
      notes: null,
      status: "active",
      removed_at: null,
      created_at: "2026-08-20T10:00:00Z",
      updated_at: "2026-08-20T10:00:00Z",
    });
    await renderScreens(routes, "/health");
    // Title is «Общий анализ крови» — genitive «крови», not nominative «кровь».
    await fireEvent.changeText(await screen.findByLabelText("Поиск документов"), "крови");
    await fireEvent(screen.getByLabelText("Поиск документов"), "submitEditing");
    expect(await screen.findByText("Общий анализ крови")).toBeOnTheScreen();
    expect(screen.queryByText("МРТ колена")).toBeNull();
  });

  it("shows failed overview queries instead of zero counts", async () => {
    fail("get_person_conditions_with_history");
    failOnce("record_findings");
    await renderScreens(routes, "/health");
    expect(await screen.findByText("get_person_conditions_with_history failed")).toBeOnTheScreen();
    expect(await screen.findByText("record_findings is unavailable")).toBeOnTheScreen();
    expect(screen.queryByText("0 открытых")).toBeNull();
    expect(screen.queryByText("0 активных")).toBeNull();
    db.failing.delete("get_person_conditions_with_history");
    const retries = screen.getAllByText("Повторить");
    await fireEvent.press(retries[0]);
    await fireEvent.press(retries[1]);
    expect(await screen.findByText("2 открытых")).toBeOnTheScreen();
  });

  it("skips a measurement type the person has hidden", async () => {
    const weight = {
      id: "cat-weight",
      code: "weight",
      name_ru: "Вес",
      name_en: "weight",
      unit_ru: "кг",
      unit_en: "kg",
      category: "basic",
      sort_order: 1,
    };
    const waist = {
      id: "cat-waist",
      code: "waist",
      name_ru: "Талия",
      name_en: "waist",
      unit_ru: "см",
      unit_en: "cm",
      category: "body",
      sort_order: 1,
    };
    db.tables.measurement_catalog = [waist, weight];
    db.tables.measurements = [
      {
        id: "t1",
        person_id: PERSON.id,
        catalog_id: waist.id,
        value: 90,
        measured_at: "2026-10-10T08:30:00Z",
        notes: null,
        created_by_user_id: USER_ID,
        created_at: "2026-10-10T08:30:00Z",
        measurement_catalog: waist,
      },
      {
        id: "w1",
        person_id: PERSON.id,
        catalog_id: weight.id,
        value: 80,
        measured_at: "2026-10-15T08:30:00Z",
        notes: null,
        created_by_user_id: USER_ID,
        created_at: "2026-10-15T08:30:00Z",
        measurement_catalog: weight,
      },
    ];
    db.tables.user_preferences = [
      { auth_user_id: USER_ID, hidden_measurement_codes: { [PERSON.id]: ["waist"] } },
    ];
    await renderScreens(routes, "/health");
    expect(await screen.findByText("Вес")).toBeOnTheScreen();
    expect(screen.queryByText("Талия")).toBeNull();
  });
});

describe("findingSparkValues", () => {
  it("plots size history oldest-first so growth reads left to right", () => {
    const finding = {
      history: [
        { size_mm: 14, created_at: "2026-02-10T09:00:00Z" },
        { size_mm: 12, created_at: "2025-01-10T09:00:00Z" },
      ],
    } as FindingSummary;
    expect(findingSparkValues(finding)).toEqual([12, 14]);
  });
});
