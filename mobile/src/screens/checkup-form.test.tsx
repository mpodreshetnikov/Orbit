import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert } from "react-native";
import CheckupFormScreen from "@/screens/checkup-form-screen";
import CheckupScreen from "@/screens/checkup-screen";
import CheckupsScreen from "@/screens/checkups-screen";
import { db, fail, fakeSession, rpcHandlers, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "health/checkups/index": CheckupsScreen,
  "health/checkups/[id]": CheckupScreen,
  "health/checkups/form": CheckupFormScreen,
};

const EYES = {
  id: "eyes",
  person_id: PERSON.id,
  title: "Окулист",
  category: "visit",
  schedule: { type: "one_off", due_at: "2026-12-01" },
  next_due_at: "2026-12-01",
  status: "active",
  reminder_days_before: [7],
  planned_on: null,
  why_text: null,
  why_links: [],
  notes: null,
  created_at: "2026-01-01T09:00:00Z",
  updated_at: "2026-01-01T09:00:00Z",
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({
    ...household(),
    checkup_items: [EYES],
    conditions: [{ id: "anemia", person_id: PERSON.id, name: "Анемия", deleted_at: null }],
  });
  rpcHandlers.get_person_conditions_with_history = () => db.tables.conditions;
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function pickOption(label: string) {
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => callback(options.options.indexOf(label)));
}

async function openNew() {
  await renderScreens(routes, "/health/checkups");
  await fireEvent.press(await screen.findByLabelText("Добавить чек-ап"));
  await screen.findByLabelText("Название");
}

describe("a new checkup", () => {
  it("is saved with its yearly schedule, start, reminders, reason and condition", async () => {
    await openNew();
    await fireEvent.changeText(screen.getByLabelText("Название"), " Анализ крови ");
    pickOption("Анализы");
    await fireEvent.press(screen.getByLabelText("Категория: Визит"));
    pickOption("Каждый год");
    await fireEvent.press(screen.getByLabelText("Частота: Каждые 6 мес."));
    pickOption("Зима (1 декабря)");
    await fireEvent.press(screen.getByLabelText("Первый срок: От сегодня"));
    pickOption("Целевой (запланированной) даты");
    await fireEvent.press(
      screen.getByLabelText("После выполнения следующий срок считать от: Даты выполнения"),
    );
    await fireEvent.changeText(screen.getByLabelText("Напоминание 1: дней до срока"), "3");
    await fireEvent.press(screen.getByText("Добавить напоминание"));
    await fireEvent.press(screen.getByText("Добавить напоминание"));
    await fireEvent.press(screen.getByLabelText("Удалить 3"));
    await fireEvent.changeText(screen.getByLabelText("Причина"), "Контроль ферритина");
    await fireEvent.press(await screen.findByText("Анемия"));
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() => expect(db.tables.checkup_items).toHaveLength(2));
    expect(db.tables.checkup_items[1]).toMatchObject({
      person_id: PERSON.id,
      title: "Анализ крови",
      category: "lab",
      schedule: {
        type: "interval",
        every: 1,
        unit: "year",
        anchor_date: "2026-12-01",
        next_due_from: "target",
      },
      reminder_days_before: [3, 1],
      why_text: "Контроль ферритина",
      why_links: [{ type: "condition", id: "anemia", label: "Анемия" }],
    });
    expect(await screen.findByText("Анализ крови")).toBeOnTheScreen();
  });

  it("needs a title", async () => {
    await openNew();
    await fireEvent.press(screen.getByText("Сохранить"));
    expect(screen.getByText("Укажите название")).toBeOnTheScreen();
    expect(db.tables.checkup_items).toHaveLength(1);
  });

  it("is saved as a one-off on its day", async () => {
    await openNew();
    await fireEvent.changeText(screen.getByLabelText("Название"), "Флюорография");
    await fireEvent.press(screen.getByText("Разовая"));
    await fireEvent(screen.getByTestId("due-at"), "change", {
      nativeEvent: { timestamp: new Date(2026, 11, 5, 9, 0).getTime() },
    });
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.checkup_items[1]?.schedule).toEqual({
        type: "one_off",
        due_at: "2026-12-05",
      }),
    );
  });

  it("takes a custom interval from a day of its own", async () => {
    await openNew();
    await fireEvent.changeText(screen.getByLabelText("Название"), "Давление");
    pickOption("Другая...");
    await fireEvent.press(screen.getByLabelText("Частота: Каждые 6 мес."));
    await fireEvent.changeText(screen.getByLabelText("Каждые"), "2");
    pickOption("недель");
    await fireEvent.press(screen.getByLabelText("Каждые: мес."));
    pickOption("Своя дата");
    await fireEvent.press(screen.getByLabelText("Первый срок: От сегодня"));
    await fireEvent(screen.getByTestId("anchor-date"), "change", {
      nativeEvent: { timestamp: new Date(2026, 10, 2, 9, 0).getTime() },
    });
    await fireEvent.changeText(screen.getByLabelText("Напоминание 1: дней до срока"), "");
    await fireEvent.press(screen.getByText("Повторяющийся"));
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.checkup_items[1]).toMatchObject({
        schedule: { type: "interval", every: 2, unit: "week", anchor_date: "2026-11-02" },
        reminder_days_before: [0],
      }),
    );
  });

  it("says when saving fails, and when there are no conditions to link", async () => {
    db.tables.conditions = [];
    await openNew();
    expect(await screen.findByText(/^У этого пациента пока нет диагнозов/)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Название"), "Окулист");
    fail("checkup_items");
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "checkup_items is unavailable"),
    );
  });
});

describe("editing a checkup", () => {
  it("opens from its sheet on what it holds and saves the change", async () => {
    await renderScreens(routes, "/health/checkups/eyes");
    pickOption("Редактировать");
    await fireEvent.press(await screen.findByLabelText("Действия: Окулист"));
    const title = await screen.findByLabelText("Название");
    expect(title.props.value).toBe("Окулист");
    await fireEvent.changeText(title, "Окулист, контроль");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.checkup_items[0]).toMatchObject({
        title: "Окулист, контроль",
        schedule: { type: "one_off", due_at: "2026-12-01" },
      }),
    );
    expect(await screen.findByText("Разовая: 01.12.2026")).toBeOnTheScreen();
  });

  it("says when the checkup is not there", async () => {
    await renderScreens(routes, "/health/checkups/form?id=gone");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });

  it("offers a retry when the person cannot be read", async () => {
    fail("persons");
    await renderScreens(routes, "/health/checkups/form?id=eyes");
    expect(await screen.findByText("persons is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect((await screen.findByLabelText("Название")).props.value).toBe("Окулист");
  });
});
