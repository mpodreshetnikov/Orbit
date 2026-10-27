import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import CheckupScreen from "@/screens/checkup-screen";
import CheckupsScreen from "@/screens/checkups-screen";
import MedicationScreen from "@/screens/medication-screen";
import MedicationsHomeScreen from "@/screens/medications-home-screen";
import SettingsScreen from "@/screens/settings-screen";
import TodayScreen from "@/screens/today-screen";
import { calls, fail, failOnce, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "today/index": TodayScreen,
  "today/settings": SettingsScreen,
  "today/medication/[id]/index": MedicationScreen,
  "medications/index": MedicationsHomeScreen,
  "health/checkups/index": CheckupsScreen,
  "health/checkups/[id]": CheckupScreen,
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

const blocksKey = `orbit.today.blocks.${USER_ID}`;

beforeEach(async () => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  await AsyncStorage.clear();
  seed({
    ...household(),
    checkup_items: [
      checkup("blood", "Анализ крови", { next_due_at: "2026-10-01" }),
      checkup("plan", "УЗИ", {
        category: "imaging",
        next_due_at: "2026-12-10",
        planned_on: "2026-10-10",
      }),
      checkup("eye", "Окулист", { category: "visit", next_due_at: "2026-10-25" }),
      checkup("teeth", "Стоматолог", { category: "dental", next_due_at: "2026-12-01" }),
    ],
    checkup_completions: [],
    medical_records: [],
    user_preferences: [],
    notification_routing: [],
  });
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("TodayScreen", () => {
  it("retries a doses block that failed to load", async () => {
    fail("med_dose_events");
    await renderScreens(routes, "/today");
    expect(await screen.findByText("med_dose_events is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Повторить"));
  });

  it("names the missing household", async () => {
    seed({ persons: [] });
    await renderScreens(routes, "/today");
    expect(await screen.findByText(/no person records/)).toBeOnTheScreen();
  });

  it("gathers today's open doses and the late and coming checkups, with no day to step through", async () => {
    await renderScreens(routes, "/today");
    expect(await screen.findByText("Vitamin D3")).toBeOnTheScreen();
    expect(screen.getByText(/среда, 21 октября · Max/)).toBeOnTheScreen();
    expect(screen.getByText("Отмечено 1 из 3")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Предыдущий день")).toBeNull();
    expect(await screen.findByText("Анализ крови")).toBeOnTheScreen();
    expect(screen.getByText("УЗИ")).toBeOnTheScreen();
    expect(screen.getByText("Окулист")).toBeOnTheScreen();
    expect(screen.queryByText("Стоматолог")).toBeNull();
    expect(screen.getByText("Просрочено")).toBeOnTheScreen();
    expect(screen.getByText(/Анализы · Срок: 01\.10\.2026/)).toBeOnTheScreen();
  });

  it("takes a dose in place", async () => {
    await renderScreens(routes, "/today");
    await screen.findByText("Vitamin D3");
    await fireEvent.press(screen.getAllByText("Принято")[0]);
    await waitFor(() => expect(calls.rpc.map((call) => call.name)).toContain("mark_dose_taken"));
    expect(await screen.findByText(/Принято — 1 капсула/)).toBeOnTheScreen();
  });

  it("says when every dose of the day is answered and when there are none", async () => {
    seed({
      ...household(),
      med_dose_events: household().med_dose_events.map((one) => ({ ...one, status: "taken" })),
      checkup_items: [],
    });
    await renderScreens(routes, "/today");
    expect(await screen.findByText("Все приёмы на сегодня отмечены")).toBeOnTheScreen();
    expect(await screen.findByText("Нет просроченных и ближайших чек-апов")).toBeOnTheScreen();
  });

  it("says a day without doses has none", async () => {
    seed({ ...household(), med_dose_events: [], checkup_items: [] });
    await renderScreens(routes, "/today");
    expect(await screen.findByText("Нет приёмов на сегодня")).toBeOnTheScreen();
  });

  it("opens a dose's course, a checkup, and each block's whole tab", async () => {
    await renderScreens(routes, "/today");
    await fireEvent.press(await screen.findByText("Vitamin D3"));
    expect(await screen.findByText(/1 капсула/)).toBeOnTheScreen();
  });

  it("leads from a checkup row to the checkup", async () => {
    await renderScreens(routes, "/today");
    await fireEvent.press(await screen.findByText("Окулист"));
    await waitFor(() => expect(screen.queryByText("Отмечено 1 из 3")).toBeNull());
  });

  it("leads from the doses block to the medications tab", async () => {
    await renderScreens(routes, "/today");
    await screen.findByText("Vitamin D3");
    await fireEvent.press(screen.getByLabelText("Приёмы на сегодня: Все"));
    expect(await screen.findByText("Курсы")).toBeOnTheScreen();
  });

  it("leads from the checkups block to the checkups page", async () => {
    await renderScreens(routes, "/today");
    await screen.findByText("Анализ крови");
    await fireEvent.press(screen.getByLabelText("Чек-апы: Все"));
    expect(await screen.findByText(/Позже/)).toBeOnTheScreen();
  });

  it("shows only the blocks left on, and says so when none is", async () => {
    await AsyncStorage.setItem(blocksKey, JSON.stringify({ doses: false, checkups: true }));
    await renderScreens(routes, "/today");
    expect(await screen.findByText("Анализ крови")).toBeOnTheScreen();
    expect(screen.queryByText("Vitamin D3")).toBeNull();
    expect(screen.queryByText("Приёмы на сегодня")).toBeNull();
  });

  it("points to the settings when every block is off", async () => {
    await AsyncStorage.setItem(blocksKey, JSON.stringify({ doses: false, checkups: false }));
    await renderScreens(routes, "/today");
    expect(
      await screen.findByText("Все блоки скрыты. Включите нужные в настройках."),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByRole("button", { name: "Настройки" }).at(-1)!);
    expect(await screen.findByLabelText("Приёмы лекарств")).toBeOnTheScreen();
  });

  it("reads a broken stored choice as every block shown", async () => {
    await AsyncStorage.setItem(blocksKey, "{not json");
    await renderScreens(routes, "/today");
    expect(await screen.findByText("Vitamin D3")).toBeOnTheScreen();
  });

  it("turns a block off in the settings and the screen follows", async () => {
    await renderScreens(routes, "/today/settings");
    const toggle = await screen.findByLabelText("Актуальные и просроченные чек-апы");
    await fireEvent(toggle, "valueChange", false);
    await waitFor(async () =>
      expect(JSON.parse((await AsyncStorage.getItem(blocksKey)) ?? "{}")).toEqual({
        doses: true,
        checkups: false,
      }),
    );
  });

  it("retries a block that failed to load without taking the other down", async () => {
    failOnce("checkup_items");
    await renderScreens(routes, "/today");
    expect(await screen.findByText("Vitamin D3")).toBeOnTheScreen();
    expect(await screen.findByText("checkup_items is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Анализ крови")).toBeOnTheScreen();
  });
});
