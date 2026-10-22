import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import SettingsScreen from "@/screens/settings-screen";
import TodayScreen from "@/screens/today-screen";
import { db, fail, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { dose, household, NOW, PERSON, USER_ID, VITAMIN_D } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = { "today/index": TodayScreen, "today/settings": SettingsScreen };

const ANNA = { id: "person-2", name: "Anna", kind: "human", auth_user_id: null, species: null };
const REX = { id: "person-3", name: "Rex", kind: "pet", auth_user_id: null, species: "Собака" };

beforeEach(async () => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  await AsyncStorage.clear();
  const base = household();
  seed({
    ...base,
    persons: [{ ...PERSON, species: null }, ANNA, REX],
    med_regimens: [...base.med_regimens, { ...VITAMIN_D, id: "anna-vitd", person_id: ANNA.id }],
    med_dose_events: [
      ...base.med_dose_events,
      dose("anna-0800", { ...VITAMIN_D, id: "anna-vitd", person_id: ANNA.id }, NOW.toISOString()),
    ],
    user_preferences: [
      {
        auth_user_id: USER_ID,
        checkup_notification_time: "08:30:00",
        checkup_notification_timezone: "Europe/Moscow",
      },
    ],
    notification_routing: [
      {
        id: "nr-1",
        recipient_user_id: USER_ID,
        person_id: REX.id,
        enabled: true,
        custom_prefix: "Пёс",
        created_at: "2026-10-01T00:00:00Z",
      },
    ],
  });
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the settings", () => {
  it("open from today's header and switch the phone to another person", async () => {
    await renderScreens(routes, "/today");
    await fireEvent.press(await screen.findByLabelText("Настройки"));
    expect(await screen.findByText("ВЫБРАТЬ ПЕРСОНУ")).toBeOnTheScreen();
    expect(screen.getByText("Собака")).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByText("Anna")[0]!);
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(`orbit.person.${USER_ID}`)).toBe(ANNA.id),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("button").find((button) => button.props.accessibilityState?.selected),
      ).toHaveTextContent("Anna"),
    );
  });

  it("falls back to the account's own person when the chosen one left the household", async () => {
    await AsyncStorage.setItem(`orbit.person.${USER_ID}`, "gone");
    await renderScreens(routes, "/today/settings");
    await waitFor(() =>
      expect(
        screen.getAllByRole("button").find((button) => button.props.accessibilityState?.selected),
      ).toHaveTextContent("Max"),
    );
  });

  it("saves when the checkup reminder comes", async () => {
    await renderScreens(routes, "/today/settings");
    expect(await screen.findByDisplayValue("08:30")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("Europe/Moscow")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Время уведомлений"), "7:5");
    await fireEvent.changeText(screen.getByLabelText("Часовой пояс"), " ");
    await fireEvent.press(screen.getAllByText("Сохранить")[0]!);
    await waitFor(() =>
      expect(db.tables.user_preferences).toEqual([
        expect.objectContaining({
          auth_user_id: USER_ID,
          checkup_notification_time: "07:05",
          checkup_notification_timezone: null,
        }),
      ]),
    );
    expect(await screen.findByDisplayValue("07:05")).toBeOnTheScreen();
  });

  it("starts with the device's time zone when none is kept", async () => {
    seed({ ...db.tables, user_preferences: [] });
    await renderScreens(routes, "/today/settings");
    expect(await screen.findByDisplayValue("09:00")).toBeOnTheScreen();
    expect(
      screen.getByDisplayValue(Intl.DateTimeFormat().resolvedOptions().timeZone),
    ).toBeOnTheScreen();
  });

  it("routes each person's reminders, with a prefix for someone else", async () => {
    await renderScreens(routes, "/today/settings");
    const max = await screen.findByLabelText("Уведомления: Max");
    expect(max.props.value).toBe(true);
    expect(screen.getByLabelText("Уведомления: Anna").props.value).toBe(false);
    expect(screen.getByLabelText("Уведомления: Rex").props.value).toBe(true);
    expect(screen.queryByLabelText("Префикс заголовка: Max")).toBeNull();
    expect(screen.getByLabelText("Префикс заголовка: Anna").props.editable).toBe(false);

    await fireEvent(screen.getByLabelText("Уведомления: Anna"), "valueChange", true);
    await waitFor(() =>
      expect(db.tables.notification_routing).toContainEqual(
        expect.objectContaining({ person_id: ANNA.id, enabled: true, custom_prefix: null }),
      ),
    );
    // Anna's choice is a row of her own: Rex's stays as it was.
    expect(db.tables.notification_routing).toContainEqual(
      expect.objectContaining({ person_id: REX.id, custom_prefix: "Пёс" }),
    );

    await fireEvent.changeText(screen.getByLabelText("Префикс заголовка: Rex"), " Рекс ");
    await fireEvent(screen.getByLabelText("Префикс заголовка: Rex"), "endEditing");
    await waitFor(() =>
      expect(db.tables.notification_routing).toContainEqual(
        expect.objectContaining({ person_id: REX.id, enabled: true, custom_prefix: "Рекс" }),
      ),
    );

    await fireEvent(max, "valueChange", false);
    await waitFor(() =>
      expect(db.tables.notification_routing).toContainEqual(
        expect.objectContaining({ person_id: PERSON.id, enabled: false, custom_prefix: null }),
      ),
    );
  });

  it("says when a save fails, and when the settings cannot load", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await renderScreens(routes, "/today/settings");
    fail("user_preferences");
    await fireEvent.press((await screen.findAllByText("Сохранить"))[0]!);
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "user_preferences is unavailable"),
    );
    await renderScreens(routes, "/today/settings");
    expect(await screen.findByText("user_preferences is unavailable")).toBeOnTheScreen();
  });

  it("signs out", async () => {
    await renderScreens(routes, "/today/settings");
    await fireEvent.press(await screen.findByText("Выйти"));
    await waitFor(() => expect(screen.queryByText("ВЫБРАТЬ ПЕРСОНУ")).toBeNull());
  });
});
