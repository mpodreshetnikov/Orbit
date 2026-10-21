import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS } from "react-native";
import HistoryScreen from "@/screens/history-screen";
import MedicationScreen from "@/screens/medication-screen";
import MedicationsScreen from "@/screens/medications-screen";
import { calls, fail, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "medications/index": MedicationsScreen,
  "medications/[id]/index": MedicationScreen,
  "medications/[id]/history": HistoryScreen,
};

/** Answer the next action sheet with the option labelled `label`. */
function chooseInSheet(label: string) {
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => callback(options.options.indexOf(label)));
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed(household());
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("MedicationsScreen", () => {
  it("lists every course newest first, with status, schedule and stock, finished ones last", async () => {
    await renderScreens(routes, "/medications");
    const names = (await screen.findAllByText(/Vitamin D3|Магний|Омепразол/)).map(
      (node) => node.props.children,
    );
    expect(names).toEqual(["Магний", "Vitamin D3", "Омепразол"]);
    expect(screen.getByText("Мало осталось")).toBeOnTheScreen();
    expect(screen.getByText(/3 капсулы\s+осталось/)).toBeOnTheScreen();
    expect(screen.getByText("Каждые 12 часов · 2 капсулы")).toBeOnTheScreen();
  });

  it("filters by status", async () => {
    await renderScreens(routes, "/medications");
    await screen.findByText("Магний");
    // The chip comes before the course badges that carry the same word.
    await fireEvent.press(screen.getAllByText("Приостановлено")[0]);
    await waitFor(() => expect(screen.queryByText("Магний")).toBeNull());
    expect(screen.getByText("Омепразол")).toBeOnTheScreen();
  });

  it("says when there are no courses at all", async () => {
    seed({ persons: household().persons, med_regimens: [] });
    await renderScreens(routes, "/medications");
    expect(await screen.findByText("Лекарств пока нет")).toBeOnTheScreen();
  });

  it("says nothing matched a filter", async () => {
    await renderScreens(routes, "/medications");
    await screen.findByText("Магний");
    await fireEvent.press(screen.getByText("В архиве"));
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });

  it("shows the error with a retry", async () => {
    fail("med_regimens");
    await renderScreens(routes, "/medications");
    expect(await screen.findByText("med_regimens is unavailable")).toBeOnTheScreen();
    seed(household());
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Магний")).toBeOnTheScreen();
  });

  it("opens a course, then its full history", async () => {
    await renderScreens(routes, "/medications");
    await fireEvent.press(await screen.findByText("Vitamin D3"));
    expect(await screen.findByText("Ежедневно в 08:00")).toBeOnTheScreen();
    expect(screen.getByText("После завтрака")).toBeOnTheScreen();
    expect(screen.getByText(/Сейчас: 3 капсулы \(Пополнить запас ≤ 5 капсул\)/)).toBeOnTheScreen();
    expect(screen.getByText("Без конца")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(/История приёмов · 1/));
    expect(await screen.findByText(/Не указано/)).toBeOnTheScreen();
  });
});

describe("MedicationScreen", () => {
  it("shows dates of a bounded course and its intakes", async () => {
    await renderScreens(routes, "/medications/reg-mg");
    expect(await screen.findByText(/Дата окончания: 31 дек/)).toBeOnTheScreen();
    expect(screen.getByText(/Принято — 1 таблетка/)).toBeOnTheScreen();
    expect(screen.getByText("Пропущено")).toBeOnTheScreen();
  });

  it("undoes an intake from its menu, and answers a passed one", async () => {
    await renderScreens(routes, "/medications/reg-mg");
    await screen.findByText(/Принято — 1 таблетка/);
    chooseInSheet("Отменить приём");
    await fireEvent.press(screen.getAllByLabelText("Действия")[0]);
    await waitFor(() => expect(calls.rpc.map((call) => call.name)).toEqual(["undo_dose_intake"]));
  });

  it("leaves out what a course does not say", async () => {
    seed({
      ...household(),
      med_regimens: [
        {
          ...household().med_regimens[2],
          schedule: null,
          duration: null,
          intake_advice_type: "none",
          inventory: { enabled: true, refill_threshold_amount: null },
        },
      ],
    });
    await renderScreens(routes, "/medications/reg-omep");
    expect(await screen.findByText("Сейчас: —")).toBeOnTheScreen();
    expect(screen.queryByText(/Начало/)).toBeNull();
  });

  it("says when a course has no intakes yet", async () => {
    seed({ ...household(), med_dose_events: [] });
    await renderScreens(routes, "/medications/reg-omep");
    expect(await screen.findByText("Приёмов пока нет")).toBeOnTheScreen();
  });

  it("says when the course is gone", async () => {
    await renderScreens(routes, "/medications/missing");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });

  it("shows the error with a retry", async () => {
    fail("med_regimens");
    await renderScreens(routes, "/medications/reg-mg");
    expect(await screen.findByText("med_regimens is unavailable")).toBeOnTheScreen();
  });
});

describe("HistoryScreen", () => {
  it("groups intakes by day under the course's name", async () => {
    await renderScreens(routes, "/medications/reg-mg/history");
    expect(await screen.findByText(/среда, 21 октября/)).toBeOnTheScreen();
    expect(screen.getByText(/вторник, 20 октября/)).toBeOnTheScreen();
    expect(screen.getAllByText("Магний").length).toBeGreaterThan(0);
  });

  it("answers an intake from its menu", async () => {
    await renderScreens(routes, "/medications/reg-mg/history");
    await screen.findByText(/вторник, 20 октября/);
    chooseInSheet("Отметить как принято");
    await fireEvent(screen.getByText("Пропущено"), "longPress");
    await waitFor(() => expect(calls.rpc.map((call) => call.name)).toEqual(["mark_dose_taken"]));
  });

  it("says when there is nothing yet", async () => {
    seed({ ...household(), med_dose_events: [] });
    await renderScreens(routes, "/medications/reg-mg/history");
    expect(await screen.findByText("Приёмов пока нет")).toBeOnTheScreen();
  });

  it("shows the error with a retry", async () => {
    fail("med_dose_events");
    await renderScreens(routes, "/medications/reg-mg/history");
    expect(await screen.findByText("med_dose_events is unavailable")).toBeOnTheScreen();
    expect(calls.rpc).toEqual([]);
  });
});
