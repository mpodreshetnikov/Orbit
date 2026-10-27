import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS } from "react-native";
import MedicationScreen from "@/screens/medication-screen";
import MedicationsHomeScreen from "@/screens/medications-home-screen";
import { calls, fail, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { dose, household, MAGNESIUM, NOW, USER_ID, VITAMIN_D } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "medications/index": MedicationsHomeScreen,
  "medications/[id]/index": MedicationScreen,
};

/** Answer the next action sheet with the option labelled `label`. */
function chooseInSheet(label: string) {
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => callback(options.options.indexOf(label)));
}

function rpcNames() {
  return calls.rpc.map((call) => call.name);
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

describe("DosesScreen", () => {
  it("lists the open doses by time, the passed one overdue, and folds the settled ones", async () => {
    await renderScreens(routes, "/medications");
    expect(await screen.findByText("Vitamin D3")).toBeOnTheScreen();
    expect(screen.getByText(/Просрочено/)).toBeOnTheScreen();
    expect(screen.getByText(/С едой/)).toBeOnTheScreen();
    expect(screen.getByText("21:00")).toBeOnTheScreen();
    expect(screen.getByText(/Приёмы на сегодня · Max/)).toBeOnTheScreen();
    expect(screen.getByText(/Выполнено сегодня \(1\)/)).toBeOnTheScreen();
    expect(screen.queryByText(/Принято — 1 таблетка/)).toBeNull();
  });

  it("takes a dose at the moment of the tap and shows it taken in place", async () => {
    await renderScreens(routes, "/medications");
    await screen.findByText("Vitamin D3");
    await fireEvent.press(screen.getAllByText("Принято")[0]);
    await waitFor(() => expect(rpcNames()).toContain("mark_dose_taken"));
    expect(calls.rpc[0]?.args).toEqual({
      p_dose_event_id: "d-vitd-0800",
      p_taken_at: expect.stringMatching(/^2026-10-21T12:00/),
    });
    expect(await screen.findByText(/Принято — 1 капсула/)).toBeOnTheScreen();
  });

  it("skips a dose with the cross", async () => {
    await renderScreens(routes, "/medications");
    await screen.findByText("Vitamin D3");
    await fireEvent.press(screen.getAllByLabelText("Пропущено")[0]);
    await waitFor(() => expect(rpcNames()).toEqual(["mark_dose_skipped"]));
  });

  it("puts the row back when the server refuses", async () => {
    fail("mark_dose_taken");
    await renderScreens(routes, "/medications");
    await screen.findByText("Vitamin D3");
    await fireEvent.press(screen.getAllByText("Принято")[0]);
    await waitFor(() => expect(rpcNames()).toContain("mark_dose_taken"));
    await waitFor(() => expect(screen.queryByText(/Принято — 1 капсула/)).toBeNull());
  });

  it("confirms every open dose of a slot at once", async () => {
    seed({
      ...household(),
      med_dose_events: [
        dose("a", VITAMIN_D, new Date(2026, 9, 21, 18).toISOString()),
        dose("b", MAGNESIUM, new Date(2026, 9, 21, 18).toISOString()),
      ],
    });
    await renderScreens(routes, "/medications");
    await fireEvent.press(await screen.findByText("Подтвердить все"));
    await waitFor(() => expect(rpcNames()).toEqual(["mark_dose_taken", "mark_dose_taken"]));
    // The settle delay ends and both move to the folded section.
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    expect(await screen.findByText(/Выполнено сегодня \(2\)/)).toBeOnTheScreen();
  });

  it("undoes a settled dose from its menu", async () => {
    await renderScreens(routes, "/medications");
    await fireEvent.press(await screen.findByText(/Выполнено сегодня/));
    expect(await screen.findByText(/Принято — 1 таблетка/)).toBeOnTheScreen();
    chooseInSheet("Отменить приём");
    await fireEvent.press(screen.getByLabelText("Действия"));
    await waitFor(() => expect(rpcNames()).toEqual(["undo_dose_intake"]));
  });

  it("opens the course from a settled dose's menu", async () => {
    await renderScreens(routes, "/medications");
    await fireEvent.press(await screen.findByText(/Выполнено сегодня/));
    chooseInSheet("Лекарства");
    await fireEvent(await screen.findByText(/Принято — 1 таблетка/), "longPress");
    expect(await screen.findByText("Ежедневно в 08:00, 21:00")).toBeOnTheScreen();
  });

  it("opens the course from a dose's name", async () => {
    await renderScreens(routes, "/medications");
    await fireEvent.press(await screen.findByText("Vitamin D3"));
    expect(await screen.findByText("После завтрака")).toBeOnTheScreen();
  });

  it("steps back a day, shows that day's settled doses unfolded, and returns", async () => {
    await renderScreens(routes, "/medications");
    await screen.findByText("Vitamin D3");
    await fireEvent.press(screen.getByLabelText("Предыдущий день"));
    expect(await screen.findByText(/Приёмы на вторник, 20 октября/)).toBeOnTheScreen();
    expect(await screen.findByText("Пропущено")).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByText("Сегодня").at(-1)!);
    expect(await screen.findByText(/Приёмы на сегодня/)).toBeOnTheScreen();
  });

  it("shows a coming day's plan and takes no answers for it", async () => {
    seed({
      ...household(),
      med_dose_events: [dose("t", VITAMIN_D, new Date(2026, 9, 22, 8).toISOString())],
    });
    await renderScreens(routes, "/medications");
    await screen.findByText(/Нет приёмов на сегодня/);
    await fireEvent.press(screen.getByLabelText("Следующий день"));
    expect(await screen.findByText("Vitamin D3")).toBeOnTheScreen();
    expect(screen.queryByText("Принято")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Следующий день"));
    expect(await screen.findByText("Нет запланированных приёмов на этот день")).toBeOnTheScreen();
  });

  it("says a past day had nothing", async () => {
    seed({ ...household(), med_dose_events: [] });
    await renderScreens(routes, "/medications");
    await fireEvent.press(await screen.findByLabelText("Предыдущий день"));
    expect(await screen.findByText("Нет приёмов в этот день")).toBeOnTheScreen();
  });

  it("shows the error and retries", async () => {
    fail("med_dose_events");
    await renderScreens(routes, "/medications");
    expect(await screen.findByText("med_dose_events is unavailable")).toBeOnTheScreen();
    seed(household());
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Vitamin D3")).toBeOnTheScreen();
  });

  it("keeps the switch to the courses when the doses fail", async () => {
    fail("med_dose_events");
    await renderScreens(routes, "/medications");
    expect(await screen.findByText("med_dose_events is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("tab", { name: "Курсы" }));
    expect(await screen.findByText("Омепразол")).toBeOnTheScreen();
  });

  it("keeps the switch back to the doses when the courses fail", async () => {
    fail("med_regimens");
    await renderScreens(routes, "/medications");
    await fireEvent.press(await screen.findByRole("tab", { name: "Курсы" }));
    expect(await screen.findByText("med_regimens is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("tab", { name: "Приёмы" }));
    expect(await screen.findByText(/Приёмы на сегодня · Max/)).toBeOnTheScreen();
  });

  it("switches the tab to the courses and back", async () => {
    await renderScreens(routes, "/medications");
    await screen.findByText("Vitamin D3");
    await fireEvent.press(screen.getByRole("tab", { name: "Курсы" }));
    expect(await screen.findByText("Омепразол")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("tab", { name: "Приёмы" }));
    expect(await screen.findByText(/Приёмы на сегодня · Max/)).toBeOnTheScreen();
  });

  it("names the missing household", async () => {
    seed({ persons: [] });
    await renderScreens(routes, "/medications");
    expect(await screen.findByText(/no person records/)).toBeOnTheScreen();
  });

  it("moves to the next day at midnight", async () => {
    await renderScreens(routes, "/medications");
    await screen.findByText("Vitamin D3");
    await act(async () => {
      jest.advanceTimersByTime(13 * 60 * 60 * 1000);
    });
    expect(await screen.findByText(/Нет приёмов на сегодня/)).toBeOnTheScreen();
  });
});
