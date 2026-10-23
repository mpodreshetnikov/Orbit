import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, type AlertButton } from "react-native";
import CheckupScreen, { reminderDays, scheduleSummary } from "@/screens/checkup-screen";
import CompleteCheckupScreen, { PlanCheckupScreen } from "@/screens/checkup-sheets";
import CheckupsScreen from "@/screens/checkups-screen";
import ConditionScreen from "@/screens/condition-screen";
import { db, fail, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "health/checkups/index": CheckupsScreen,
  "health/checkups/[id]": CheckupScreen,
  "health/checkups/complete": CompleteCheckupScreen,
  "health/checkups/plan": PlanCheckupScreen,
  "health/conditions/[id]": ConditionScreen,
};

function checkup(id: string, title: string, extra = {}) {
  return {
    id,
    person_id: PERSON.id,
    title,
    category: "lab",
    schedule: { type: "interval", every: 3, unit: "month" },
    next_due_at: null,
    status: "active",
    reminder_days_before: [1, 7, 3],
    planned_on: null,
    why_text: null,
    why_links: [],
    notes: null,
    created_at: "2026-01-01T09:00:00Z",
    updated_at: "2026-01-01T09:00:00Z",
    ...extra,
  };
}

function completion(id: string, day: string, extra = {}) {
  return {
    id,
    checkup_item_id: "blood",
    done_at: day,
    note: null,
    evidence_record_id: null,
    created_at: `${day}T09:00:00Z`,
    ...extra,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({
    ...household(),
    checkup_items: [
      checkup("blood", "Анализ крови", {
        next_due_at: "2026-10-01",
        why_text: "Контроль ферритина",
        why_links: [{ type: "condition", id: "anemia", label: "Анемия" }],
        notes: "Натощак",
      }),
      checkup("once", "Флюорография", {
        category: "imaging",
        status: "paused",
        schedule: { type: "one_off", due_at: "2026-11-15" },
        next_due_at: "2026-11-15",
        reminder_days_before: [],
      }),
    ],
    checkup_completions: [
      completion("c2", "2026-06-01"),
      completion("c1", "2026-09-01", { note: "Норма", evidence_record_id: "rec-1" }),
    ],
    conditions: [
      {
        id: "anemia",
        person_id: PERSON.id,
        name: "Анемия",
        code: null,
        icd_name_en: null,
        current_status: "active",
        notes: null,
        deleted_at: null,
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
    ],
    condition_records: [],
    medical_records: [
      {
        id: "rec-1",
        person_id: PERSON.id,
        title: "Анализы",
        record_date: "2026-09-01",
        status: "active",
      },
    ],
  });
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function pickOption(label: string) {
  const offered: string[][] = [];
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => {
      offered.push(options.options);
      callback(options.options.indexOf(label));
    });
  return offered;
}

function answerAlert(label: string) {
  jest.spyOn(Alert, "alert").mockImplementationOnce((_title, _message, buttons) => {
    (buttons as AlertButton[]).find((button) => button.text === label)?.onPress?.();
  });
}

describe("a checkup", () => {
  it("opens from the list with its schedule, reason, links and completions newest first", async () => {
    await renderScreens(routes, "/health/checkups");
    await fireEvent.press(await screen.findByText("Анализ крови"));

    expect(await screen.findByText("Каждые 3 месяца")).toBeOnTheScreen();
    expect(screen.getByText("Напоминания: 7, 3, 1 дней до срока")).toBeOnTheScreen();
    expect(screen.getByText("Контроль ферритина")).toBeOnTheScreen();
    expect(screen.getByText("Натощак")).toBeOnTheScreen();
    expect(screen.getByText("Анемия")).toBeOnTheScreen();
    expect(screen.getAllByText("Просрочено").length).toBeGreaterThan(0);
    expect(await screen.findByText("Норма")).toBeOnTheScreen();
    const days = screen.getAllByText(/^01\.0[69]\.2026$/).map((one) => one.props.children);
    expect(days).toEqual(["01.09.2026", "01.06.2026"]);
    expect(screen.getByText("Доказательство")).toBeOnTheScreen();
  });

  it("shows a paused one-off without its actions, and resumes it from the sheet", async () => {
    await renderScreens(routes, "/health/checkups/once");
    expect(await screen.findByText("Разовая: 15.11.2026")).toBeOnTheScreen();
    expect(screen.getByText("только в день срока (всегда)")).toBeOnTheScreen();
    expect(await screen.findByText("Выполнений пока нет")).toBeOnTheScreen();
    expect(screen.queryByText("Отметить выполненным")).toBeNull();

    const offered = pickOption("Возобновить");
    await fireEvent.press(screen.getByLabelText("Действия: Флюорография"));
    expect(offered[0]).toEqual([
      "Редактировать",
      "Возобновить",
      "В архив",
      "Удалить чек-ап",
      "Отмена",
    ]);
    await waitFor(() => expect(db.tables.checkup_items[1].status).toBe("active"));
    expect(await screen.findByText("Отметить выполненным")).toBeOnTheScreen();
  });

  it("pauses from the sheet, and says when that fails", async () => {
    await renderScreens(routes, "/health/checkups/blood");
    await screen.findByText("Каждые 3 месяца");
    fail("checkup_items");
    const alert = jest.spyOn(Alert, "alert");
    pickOption("Приостановить");
    await fireEvent.press(screen.getByLabelText("Действия: Анализ крови"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "checkup_items is unavailable"),
    );
    db.failing.clear();
    pickOption("Приостановить");
    await fireEvent.press(screen.getByLabelText("Действия: Анализ крови"));
    await waitFor(() => expect(db.tables.checkup_items[0].status).toBe("paused"));
  });

  it("is deleted once confirmed, and the list no longer has it", async () => {
    await renderScreens(routes, "/health/checkups");
    await fireEvent.press(await screen.findByText("Флюорография"));
    pickOption("Удалить чек-ап");
    answerAlert("Удалить чек-ап");
    await fireEvent.press(await screen.findByLabelText("Действия: Флюорография"));
    await waitFor(() => expect(db.tables.checkup_items).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Флюорография")).toBeNull());
    expect(screen.getByText("Анализ крови")).toBeOnTheScreen();
  });

  it("is marked done and planned from its own buttons", async () => {
    await renderScreens(routes, "/health/checkups/blood");
    await fireEvent.press(await screen.findByText("Отметить выполненным"));
    await fireEvent.press(await screen.findByText("Сохранить"));
    await waitFor(() => expect(db.tables.checkup_completions).toHaveLength(3));

    await fireEvent.press(await screen.findByText("Запланировать"));
    await fireEvent.press(await screen.findByText("Сохранить"));
    await waitFor(() => expect(db.tables.checkup_items[0].planned_on).toBe("2026-10-21"));
  });

  it("says when it is not there", async () => {
    await renderScreens(routes, "/health/checkups/gone");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });

  it("offers a retry when it cannot be read", async () => {
    fail("checkup_items");
    await renderScreens(routes, "/health/checkups/blood");
    expect(await screen.findByText("checkup_items is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Каждые 3 месяца")).toBeOnTheScreen();
  });

  it("offers a retry when its completions cannot be read", async () => {
    fail("checkup_completions");
    await renderScreens(routes, "/health/checkups/blood");
    expect(await screen.findByText("checkup_completions is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Норма")).toBeOnTheScreen();
  });

  it("goes to a linked condition, whose page lists it back", async () => {
    await renderScreens(routes, "/health/checkups/blood");
    await fireEvent.press(await screen.findByText("Анемия"));
    expect(await screen.findByText("Чек-апы по этому диагнозу")).toBeOnTheScreen();
    await fireEvent.press(await screen.findByText("Анализ крови"));
    expect(await screen.findByText("Каждые 3 месяца")).toBeOnTheScreen();
  });
});

describe("a completion", () => {
  it("is corrected from its row", async () => {
    await renderScreens(routes, "/health/checkups/blood");
    await fireEvent.press(await screen.findByText("Норма"));
    const note = await screen.findByLabelText("Заметка");
    expect(note.props.value).toBe("Норма");
    expect(screen.getByLabelText("Прикрепить запись: Анализы · 01.09.2026")).toBeOnTheScreen();
    await fireEvent.changeText(note, "Ферритин 40");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.checkup_completions[1]).toMatchObject({
        done_at: "2026-09-01",
        note: "Ферритин 40",
        evidence_record_id: "rec-1",
      }),
    );
  });

  it("is deleted once confirmed", async () => {
    await renderScreens(routes, "/health/checkups/blood");
    await fireEvent.press(await screen.findByText("01.06.2026"));
    answerAlert("Удалить");
    await fireEvent.press(await screen.findByText("Удалить"));
    await waitFor(() => expect(db.tables.checkup_completions.map((row) => row.id)).toEqual(["c1"]));
  });

  it("is corrected on a checkup no longer active", async () => {
    db.tables.checkup_items[0].status = "completed";
    await renderScreens(routes, "/health/checkups/complete?id=blood&completion=c1");
    expect((await screen.findByLabelText("Заметка")).props.value).toBe("Норма");
  });

  it("says when it is not there", async () => {
    await renderScreens(routes, "/health/checkups/complete?id=blood&completion=gone");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });
});

describe("the checkup helpers", () => {
  it("say the schedule in words", () => {
    expect(scheduleSummary({ type: "interval", every: 1, unit: "year" })).toBe("Каждый год");
    expect(scheduleSummary({ type: "interval", every: 2, unit: "week" })).toBe("Каждые 2 недели");
  });

  it("list the reminder days furthest first, or none", () => {
    expect(reminderDays([1, 14, -1])).toBe("14, 1");
    expect(reminderDays([])).toBeNull();
  });
});
