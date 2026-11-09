import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert } from "react-native";
import CompleteCheckupScreen from "@/screens/checkup-sheets";
import CheckupsScreen from "@/screens/checkups-screen";
import HealthScreen from "@/screens/health-screen";
import { db, fail, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "health/index": HealthScreen,
  "health/checkups/index": CheckupsScreen,
  "health/checkups/complete": CompleteCheckupScreen,
};

function checkup(id: string, title: string, extra = {}) {
  return {
    id,
    person_id: PERSON.id,
    title,
    category: "lab",
    schedule: { type: "interval", every: 1, unit: "year" },
    next_due_at: null,
    status: "active",
    reminder_days_before: [7],
    planned_on: null,
    why_text: null,
    why_links: [],
    notes: null,
    created_at: "2026-01-01T09:00:00Z",
    updated_at: "2026-01-01T09:00:00Z",
    ...extra,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({
    ...household(),
    checkup_items: [
      checkup("blood", "Анализ крови", { next_due_at: "2026-10-01", planned_on: "2026-10-15" }),
      checkup("plan", "УЗИ", {
        category: "imaging",
        next_due_at: "2026-12-10",
        planned_on: "2026-10-10",
      }),
      checkup("eye", "Окулист", { category: "visit", next_due_at: "2026-10-25" }),
      checkup("teeth", "Стоматолог", { category: "dental", next_due_at: "2026-12-01" }),
      checkup("flu", "Прививка от гриппа", {
        category: "vaccination",
        status: "paused",
        next_due_at: "2026-11-01",
      }),
    ],
    checkup_completions: [],
    medical_records: [
      {
        id: "rec-1",
        person_id: PERSON.id,
        title: "Анализы",
        record_date: "2026-10-20",
        status: "active",
      },
      { id: "rec-2", person_id: PERSON.id, title: "Справка", record_date: null, status: "active" },
    ],
  });
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** Answer the next sheet with the option labelled so. */
function pickOption(label: string) {
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => callback(options.options.indexOf(label)));
}

describe("the checkups", () => {
  it("open from the health menu, overdue first, then this week, later and the rest", async () => {
    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByLabelText("Чек-апы"));

    expect(await screen.findByText("Просрочено (2)")).toBeOnTheScreen();
    expect(screen.getByText("Предстоящие (1)")).toBeOnTheScreen();
    expect(screen.getByText("Позже (1)")).toBeOnTheScreen();
    expect(screen.getByText("Неактивные 1")).toBeOnTheScreen();
    expect(screen.getByText("План просрочен")).toBeOnTheScreen();
    expect(screen.getByText("Следующий срок: 01.10.2026")).toBeOnTheScreen();
    expect(screen.getByText("Запланировано на: 15.10.2026")).toBeOnTheScreen();
    // A paused checkup is not marked done from its card.
    expect(screen.getAllByText("Отметить выполненным")).toHaveLength(4);
    expect(screen.queryByText("Запланировать")).toBeNull();
  });

  it("show one group alone from its chip", async () => {
    await renderScreens(routes, "/health/checkups");
    await fireEvent.press(await screen.findByText("Предстоящие 1"));
    expect(screen.getByText("Окулист")).toBeOnTheScreen();
    expect(screen.queryByText("Анализ крови")).toBeNull();
    await fireEvent.press(screen.getByText("Неактивные 1"));
    expect(screen.getByText("Прививка от гриппа")).toBeOnTheScreen();
    expect(screen.getByText("Приостановлен")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Просрочено 2"));
    expect(screen.getByText("УЗИ")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Все"));
    expect(screen.getAllByText("Стоматолог")).toHaveLength(2);
  });

  it("narrow to a category, and say when nothing is left", async () => {
    await renderScreens(routes, "/health/checkups");
    // Category Choice is in the list header and is tappable while checkups are still
    // pending (ListEmptyComponent shows ActivityIndicator). Wait for the filtered row
    // rather than asserting synchronously after the sheet pick.
    // (Comment-only bump: re-trigger Mobile recordings after Omega-3 tunnel flake.)
    pickOption("Визит");
    await fireEvent.press(await screen.findByLabelText("Категория: Все типы"));
    expect(await screen.findByText("Окулист")).toBeOnTheScreen();
    expect(screen.queryByText("Анализ крови")).toBeNull();
    await fireEvent.press(screen.getByText("Просрочено"));
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });

  it("leaves the category alone when the sheet is cancelled", async () => {
    await renderScreens(routes, "/health/checkups");
    jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation((opts, cb) => {
      cb(opts.cancelButtonIndex ?? opts.options.length - 1);
    });
    await fireEvent.press(await screen.findByLabelText("Категория: Все типы"));
    expect(screen.getByLabelText("Категория: Все типы")).toBeOnTheScreen();
  });

  it("say so when there are none", async () => {
    db.tables.checkup_items = [];
    await renderScreens(routes, "/health/checkups");
    expect(await screen.findByText("Нет чек-апов")).toBeOnTheScreen();
  });

  it("offer a retry when the person cannot be read", async () => {
    fail("persons");
    await renderScreens(routes, "/health/checkups");
    expect(await screen.findByText("persons is unavailable")).toBeOnTheScreen();
  });

  it("offer a retry when they cannot be read", async () => {
    fail("checkup_items");
    await renderScreens(routes, "/health/checkups");
    expect(await screen.findByText("checkup_items is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Окулист")).toBeOnTheScreen();
  });
});

describe("marking a checkup done", () => {
  it("records the day, the note and the record, and clears the plan", async () => {
    await renderScreens(routes, "/health/checkups");
    await fireEvent.press((await screen.findAllByText("Отметить выполненным"))[0]);
    await fireEvent(await screen.findByTestId("done-at"), "change", {
      nativeEvent: { timestamp: new Date(2026, 9, 18, 9, 0).getTime() },
    });
    await fireEvent.changeText(screen.getByLabelText("Заметка"), " Всё в норме ");
    pickOption("Анализы · 20.10.2026");
    await fireEvent.press(screen.getByLabelText("Прикрепить запись: Нет"));
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() => expect(db.tables.checkup_items[0].planned_on).toBeNull());
    expect(db.tables.checkup_completions).toEqual([
      expect.objectContaining({
        checkup_item_id: "blood",
        done_at: "2026-10-18",
        note: "Всё в норме",
        evidence_record_id: "rec-1",
      }),
    ]);
    await waitFor(() => expect(screen.queryByText("Запланировано на: 15.10.2026")).toBeNull());
  });

  it("writes no plan for a checkup without one, and says when saving fails", async () => {
    await renderScreens(routes, "/health/checkups");
    await fireEvent.press((await screen.findAllByText("Отметить выполненным"))[2]);
    await screen.findByText("Дата выполнения");
    fail("checkup_completions");
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Что-то пошло не так",
        "checkup_completions is unavailable",
      ),
    );
    db.failing.clear();
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.checkup_completions).toEqual([
        expect.objectContaining({ checkup_item_id: "eye", note: null, evidence_record_id: null }),
      ]),
    );
    expect(db.tables.checkup_items[2].planned_on).toBeNull();
  });

  it("puts the plan back when the completion cannot be saved, so a retry records it once", async () => {
    await renderScreens(routes, "/health/checkups");
    await fireEvent.press((await screen.findAllByText("Отметить выполненным"))[0]);
    await screen.findByText("Дата выполнения");
    fail("checkup_completions");
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(db.tables.checkup_items[0].planned_on).toBe("2026-10-15");
    expect(db.tables.checkup_completions).toEqual([]);
    db.failing.clear();
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() => expect(db.tables.checkup_completions).toHaveLength(1));
    expect(db.tables.checkup_items[0].planned_on).toBeNull();
  });
});

describe("a checkup no longer active", () => {
  it("cannot be done from a link", async () => {
    await renderScreens(routes, "/health/checkups/complete?id=flu");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });

  it("is refused when it stopped being active while the sheet was open", async () => {
    await renderScreens(routes, "/health/checkups/complete?id=eye");
    await screen.findByText("Дата выполнения");
    db.tables.checkup_items[2].status = "paused";
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "Ничего не найдено"),
    );
    expect(db.tables.checkup_completions).toEqual([]);
  });
});

describe("a checkup sheet opened directly", () => {
  it("offers a retry when the person cannot be read", async () => {
    fail("persons");
    await renderScreens(routes, "/health/checkups/complete?id=eye");
    expect(await screen.findByText("persons is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Дата выполнения")).toBeOnTheScreen();
  });

  it("offers a retry when the checkups cannot be read", async () => {
    fail("checkup_items");
    await renderScreens(routes, "/health/checkups/complete?id=eye");
    expect(await screen.findByText("checkup_items is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Дата выполнения")).toBeOnTheScreen();
  });
});
