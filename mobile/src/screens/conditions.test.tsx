import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, type AlertButton } from "react-native";
import ConditionScreen from "@/screens/condition-screen";
import ConditionsScreen from "@/screens/conditions-screen";
import HealthScreen from "@/screens/health-screen";
import { db, fail, fakeSession, rpcHandlers, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "health/index": HealthScreen,
  "health/conditions/index": ConditionsScreen,
  "health/conditions/[id]": ConditionScreen,
};

function condition(id: string, name: string, extra = {}) {
  return {
    id,
    person_id: PERSON.id,
    name,
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
    mention_count: 0,
    first_mentioned_date: null,
    last_mentioned_date: null,
    ...extra,
  };
}

function mention(id: string, date: string | null, title: string, extra = {}) {
  return {
    id,
    condition_id: "anemia",
    record_id: `rec-${id}`,
    status_in_record: "active",
    source_anchor: null,
    is_llm_extracted: false,
    is_user_verified: true,
    review_decision: "pending",
    created_at: "2026-01-01T09:00:00Z",
    // Joins are seeded in place: the fake resolves none.
    medical_records: { title, record_date: date, record_type: "lab" },
    ...extra,
  };
}

function record(id: string, title: string, date: string | null) {
  return { id, person_id: PERSON.id, title, record_date: date, status: "active" };
}

/** The list function, answered from the seeded rows as the database answers it. */
function serveConditions() {
  rpcHandlers.get_person_conditions_with_history = (args) =>
    db.tables.conditions.filter((row) => row.person_id === args.p_person_id && !row.deleted_at);
  rpcHandlers["icd-lookup"] = (args) =>
    args.code === "D50.9"
      ? { code: "D50.9", name_en: "Iron deficiency anaemia", name_ru: null, found: true }
      : { code: args.code, name_en: null, name_ru: null, found: false };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({
    ...household(),
    conditions: [
      condition("anemia", "Анемия", {
        code: "D50.9",
        icd_name_en: "Iron deficiency anaemia",
        onset_date: "2025-03-01",
        notes: "Пить железо",
        mention_count: 2,
        first_mentioned_date: "2025-03-01",
        last_mentioned_date: "2026-02-10",
      }),
      condition("gastritis", "Гастрит", {
        current_status: "suspected",
        mention_count: 1,
        first_mentioned_date: "2026-01-05",
        last_mentioned_date: "2026-01-05",
      }),
      condition("pox", "Ветрянка", { current_status: "history", resolved_date: "2010-05-01" }),
    ],
    condition_records: [
      mention("m1", "2025-03-01", "Общий анализ крови", {
        source_anchor: "Железодефицитная анемия",
      }),
      mention("m2", "2026-02-10", "Ферритин", {
        status_in_record: "resolved",
        review_decision: "dismissed",
      }),
      mention("m3", null, "", {
        created_at: "2025-01-01T09:00:00Z",
        status_in_record: "resolved",
        is_llm_extracted: true,
        is_user_verified: false,
      }),
    ],
    medical_records: [
      record("rec-m1", "Общий анализ крови", "2025-03-01"),
      record("rec-m2", "Ферритин", "2026-02-10"),
      record("rec-m3", "", null),
      record("rec-old", "Старый осмотр", "2024-01-01"),
      record("rec-undated", "Без даты", null),
    ],
  });
  serveConditions();
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function answerAlert(label: string) {
  jest.spyOn(Alert, "alert").mockImplementationOnce((_title, _message, buttons) => {
    (buttons as AlertButton[]).find((button) => button.text === label)?.onPress?.();
  });
}

function pickFromSheet(index: number) {
  const offered: { options: string[]; message?: string }[] = [];
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => {
      offered.push(options);
      callback(index);
    });
  return offered;
}

describe("the conditions", () => {
  it("open from the health menu, a section per status with each condition's card", async () => {
    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByLabelText("Диагнозы"));

    expect(await screen.findByText("Активные диагнозы (1)")).toBeOnTheScreen();
    expect(screen.getByText("Подозреваемые (1)")).toBeOnTheScreen();
    expect(screen.getByText("Анамнез (1)")).toBeOnTheScreen();
    expect(screen.queryByText(/^Вылеченные/)).toBeNull();
    expect(screen.getByText("D50.9 · Iron deficiency anaemia")).toBeOnTheScreen();
    expect(screen.getByText("Начало: 01.03.2025")).toBeOnTheScreen();
    expect(screen.getByText("Вылечен: 01.05.2010")).toBeOnTheScreen();
    expect(screen.getByText("Пить железо")).toBeOnTheScreen();
    expect(screen.getByText("03.2025 — 02.2026")).toBeOnTheScreen();
    expect(screen.getByText("01.2026")).toBeOnTheScreen();
    expect(screen.getAllByText("Нет кода МКБ")).toHaveLength(2);
    expect(screen.queryByText("Нет активных диагнозов")).toBeNull();
  });

  it("explain the statuses when asked", async () => {
    await renderScreens(routes, "/health/conditions");
    await fireEvent.press(await screen.findByText("Справка по статусам"));
    expect(screen.getByText(/^Подозреваемый — /)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Справка по статусам"));
    expect(screen.queryByText(/^Подозреваемый — /)).toBeNull();
  });

  it("say when nothing is open any more", async () => {
    db.tables.conditions = db.tables.conditions.filter((row) => row.id === "pox");
    await renderScreens(routes, "/health/conditions");
    expect(await screen.findByText("Нет активных диагнозов")).toBeOnTheScreen();
  });

  it("say so when there are none", async () => {
    db.tables.conditions = [];
    await renderScreens(routes, "/health/conditions");
    expect(await screen.findByText("Нет диагнозов")).toBeOnTheScreen();
  });

  it("offer a retry when the person cannot be read", async () => {
    fail("persons");
    await renderScreens(routes, "/health/conditions");
    expect(await screen.findByText("persons is unavailable")).toBeOnTheScreen();
  });

  it("offer a retry when they cannot be read", async () => {
    fail("get_person_conditions_with_history");
    await renderScreens(routes, "/health/conditions");
    expect(await screen.findByText("get_person_conditions_with_history failed")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Анемия")).toBeOnTheScreen();
  });
});

describe("a condition", () => {
  it("shows its code, dates and every mention newest first, with the source's words", async () => {
    await renderScreens(routes, "/health/conditions");
    await fireEvent.press(await screen.findByText("Анемия"));

    expect(await screen.findByText("Официальное название МКБ-10")).toBeOnTheScreen();
    expect(screen.getByText("Пить железо")).toBeOnTheScreen();
    expect(screen.getByText("3")).toBeOnTheScreen();
    expect(screen.getByText("Последнее упоминание")).toBeOnTheScreen();
    const titles = ["Ферритин", "Общий анализ крови", "Медицинские записи"];
    expect(
      screen.getAllByText(new RegExp(`^(${titles.join("|")})$`)).map((one) => one.props.children),
    ).toEqual(titles);
    expect(screen.getByText("Отклонено")).toBeOnTheScreen();
    expect(screen.getByText("Ждёт вашего подтверждения")).toBeOnTheScreen();
    expect(screen.getByText("Железодефицитная анемия")).toBeOnTheScreen();
    expect(screen.getAllByText("Анализы")).toHaveLength(3);
  });

  it("says when nothing mentions it", async () => {
    await renderScreens(routes, "/health/conditions/pox");
    expect(await screen.findByText("История упоминаний пуста")).toBeOnTheScreen();
    expect(screen.getByText("01.05.2010")).toBeOnTheScreen();
  });

  it("says when it is not there", async () => {
    await renderScreens(routes, "/health/conditions/gone");
    expect(await screen.findByText("Диагноз не найден")).toBeOnTheScreen();
  });

  it("is not offered for deleting while records mention it", async () => {
    await renderScreens(routes, "/health/conditions/anemia");
    expect(await screen.findByText("История упоминаний")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Действия: Анемия")).toBeNull();
    expect(screen.queryByText("Добавить в историю")).toBeNull();
    expect(db.tables.conditions[0].deleted_at).toBeNull();
  });

  it("is deleted, as the web app deletes it, once nothing mentions it", async () => {
    await renderScreens(routes, "/health/conditions");
    await fireEvent.press(await screen.findByText("Ветрянка"));
    const offered = pickFromSheet(0);
    answerAlert("Удалить");
    await fireEvent.press(await screen.findByLabelText("Действия: Ветрянка"));

    expect(offered[0].options).toEqual(["Удалить диагноз", "Отмена"]);
    await waitFor(() => expect(db.tables.conditions[2].deleted_at).toMatch(/^2026-10-21T/));
    expect(await screen.findByText("Активные диагнозы (1)")).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText("Ветрянка")).toBeNull());
  });

  it("says when deleting fails", async () => {
    await renderScreens(routes, "/health/conditions/pox");
    await screen.findByText("История упоминаний пуста");
    fail("conditions");
    const alert = jest.spyOn(Alert, "alert");
    pickFromSheet(0);
    answerAlert("Удалить");
    await fireEvent.press(screen.getByLabelText("Действия: Ветрянка"));
    await waitFor(() =>
      expect(alert).toHaveBeenLastCalledWith("Что-то пошло не так", "conditions is unavailable"),
    );
  });
});
