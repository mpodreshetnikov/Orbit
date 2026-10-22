import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, Linking, type AlertButton } from "react-native";
import ConditionFormScreen, { icdNameFor } from "@/screens/condition-form-screen";
import ConditionHistoryScreen, { dayOf } from "@/screens/condition-history-screen";
import ConditionScreen from "@/screens/condition-screen";
import ConditionsScreen from "@/screens/conditions-screen";
import HealthScreen from "@/screens/health-screen";
import {
  calls,
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
  "health/conditions/index": ConditionsScreen,
  "health/conditions/[id]": ConditionScreen,
  "health/conditions/edit": ConditionFormScreen,
  "health/conditions/history": ConditionHistoryScreen,
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

/** Answer the next sheet with the option labelled so. */
function pickOption(label: string) {
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => callback(options.options.indexOf(label)));
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
    const offered = pickFromSheet(1);
    await fireEvent.press(await screen.findByLabelText("Действия: Анемия"));
    expect(offered[0].options).toEqual(["Редактировать", "Отмена"]);
    expect(offered[0].message).toMatch(/^Сначала удалите/);
    expect(db.tables.conditions[0].deleted_at).toBeNull();
  });

  it("is deleted, as the web app deletes it, once nothing mentions it", async () => {
    await renderScreens(routes, "/health/conditions");
    await fireEvent.press(await screen.findByText("Ветрянка"));
    const offered = pickFromSheet(1);
    answerAlert("Удалить");
    await fireEvent.press(await screen.findByLabelText("Действия: Ветрянка"));

    expect(offered[0].options).toEqual(["Редактировать", "Удалить диагноз", "Отмена"]);
    await waitFor(() => expect(db.tables.conditions[2].deleted_at).toMatch(/^2026-10-21T/));
    expect(await screen.findByText("Активные диагнозы (1)")).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText("Ветрянка")).toBeNull());
  });

  it("says when deleting fails", async () => {
    await renderScreens(routes, "/health/conditions/pox");
    await screen.findByText("История упоминаний пуста");
    fail("conditions");
    const alert = jest.spyOn(Alert, "alert");
    pickFromSheet(1);
    answerAlert("Удалить");
    await fireEvent.press(screen.getByLabelText("Действия: Ветрянка"));
    await waitFor(() =>
      expect(alert).toHaveBeenLastCalledWith("Что-то пошло не так", "conditions is unavailable"),
    );
  });
});

describe("editing a condition", () => {
  it("opens from the condition and saves the name, the checked code and the notes", async () => {
    await renderScreens(routes, "/health/conditions/gastritis");
    pickFromSheet(0);
    await fireEvent.press(await screen.findByLabelText("Действия: Гастрит"));

    await fireEvent.changeText(await screen.findByLabelText("Название диагноза"), " Анемия ");
    await fireEvent.changeText(screen.getByLabelText("Код МКБ-10"), "d50.9");
    expect(await screen.findByText("Iron deficiency anaemia")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Заметки"), "  ");
    const search = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await fireEvent.press(screen.getByText("Найти код МКБ-10 в Google"));
    expect(search).toHaveBeenCalledWith(
      "https://www.google.com/search?q=%D0%90%D0%BD%D0%B5%D0%BC%D0%B8%D1%8F%20ICD-10%20code",
    );
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() =>
      expect(db.tables.conditions[1]).toMatchObject({
        name: "Анемия",
        code: "D50.9",
        icd_name_en: "Iron deficiency anaemia",
        notes: null,
      }),
    );
    expect(await screen.findByText("Официальное название МКБ-10")).toBeOnTheScreen();
  });

  it("says when a code is not found, and keeps no name for it", async () => {
    await renderScreens(routes, "/health/conditions/anemia");
    pickFromSheet(0);
    await fireEvent.press(await screen.findByLabelText("Действия: Анемия"));
    await fireEvent.changeText(await screen.findByLabelText("Код МКБ-10"), "zz");
    expect(await screen.findByText("Код не найден")).toBeOnTheScreen();
    expect(calls.rpc.at(-1)).toEqual({ name: "icd-lookup", args: { code: "ZZ" } });
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.conditions[0]).toMatchObject({ code: "ZZ", icd_name_en: null }),
    );
  });

  it("needs a name, and says when saving fails", async () => {
    await renderScreens(routes, "/health/conditions/edit?id=anemia");
    await fireEvent.changeText(await screen.findByLabelText("Название диагноза"), "");
    expect(screen.getByText("Обязательное поле")).toBeOnTheScreen();
    expect(screen.queryByText("Найти код МКБ-10 в Google")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Название диагноза"), "Анемия");
    fail("conditions");
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "conditions is unavailable"),
    );
  });

  it("says when the condition cannot be read for editing, and retries", async () => {
    failOnce("conditions");
    await renderScreens(routes, "/health/conditions/edit?id=pox");
    expect(await screen.findByText("conditions is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByDisplayValue("Ветрянка")).toBeOnTheScreen();
  });

  it("says when the condition is not there", async () => {
    await renderScreens(routes, "/health/conditions/edit?id=gone");
    expect(await screen.findByText("Диагноз не найден")).toBeOnTheScreen();
  });
});

describe("icdNameFor", () => {
  const saved = { code: "D50.9", icd_name_en: "Iron deficiency anaemia" };

  it("keeps nothing without a code", () => {
    expect(icdNameFor("", undefined, saved)).toBeNull();
  });

  it("keeps the saved name for the saved code until the lookup answers", () => {
    expect(icdNameFor("D50.9", undefined, saved)).toBe("Iron deficiency anaemia");
    expect(icdNameFor("D50", undefined, saved)).toBeNull();
  });
});

describe("adding to a condition's history", () => {
  async function openForm(id: string) {
    await renderScreens(routes, `/health/conditions/${id}`);
    await fireEvent.press(await screen.findByText("Добавить в историю"));
    await screen.findByLabelText(/^Статус в этой записи/);
  }

  it("writes a manual entry of the day, and the newest word sets the status", async () => {
    await openForm("anemia");
    pickOption("Вылечен");
    await fireEvent.press(screen.getByLabelText("Статус в этой записи: Активный"));
    await fireEvent(screen.getByTestId("history-date"), "change", {
      nativeEvent: { timestamp: new Date(2026, 9, 20, 7, 0).getTime() },
    });
    await fireEvent.changeText(screen.getByLabelText("Заметка"), " Ферритин в норме ");
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() => expect(db.tables.conditions[0].current_status).toBe("resolved"));
    expect(db.tables.medical_records.at(-1)).toMatchObject({
      person_id: PERSON.id,
      title: "Ручная запись (Анемия)",
      record_date: "2026-10-20",
      record_type: "other",
      status: "active",
      notes: "Ферритин в норме",
      created_by_user_id: USER_ID,
    });
    expect(db.tables.condition_records.at(-1)).toMatchObject({
      condition_id: "anemia",
      record_id: db.tables.medical_records.at(-1)?.id,
      status_in_record: "resolved",
      source_anchor: "Ферритин в норме",
      is_user_verified: true,
      review_decision: "confirmed",
    });
    expect(await screen.findByText("История упоминаний")).toBeOnTheScreen();
  });

  it("links to an older record without changing the status", async () => {
    await openForm("anemia");
    pickOption("Старый осмотр · 01.01.2024");
    await fireEvent.press(
      screen.getByLabelText("Привязать к медицинской записи: Нет (только ручная запись)"),
    );
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() =>
      expect(db.tables.condition_records.at(-1)).toMatchObject({
        record_id: "rec-old",
        status_in_record: "active",
        source_anchor: null,
      }),
    );
    expect(db.tables.medical_records).toHaveLength(5);
    expect(db.tables.conditions[0].current_status).toBe("active");
  });

  it("leaves the status alone for an undated record", async () => {
    await openForm("pox");
    pickOption("Без даты");
    await fireEvent.press(
      screen.getByLabelText("Привязать к медицинской записи: Нет (только ручная запись)"),
    );
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() => expect(db.tables.condition_records.at(-1)?.record_id).toBe("rec-undated"));
    expect(db.tables.conditions[2].current_status).toBe("history");
  });

  it("says when saving fails", async () => {
    await openForm("pox");
    fail("condition_records");
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "condition_records is unavailable"),
    );
  });

  it("says when the condition is not there", async () => {
    await renderScreens(routes, "/health/conditions/history?id=gone");
    expect(await screen.findByText("Диагноз не найден")).toBeOnTheScreen();
  });

  it("dates an entry by the phone's own day", () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
