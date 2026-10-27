import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ExpoRoot } from "expo-router";
import { getMockContext } from "expo-router/testing-library";
import * as Fonts from "@expo-google-fonts/geist";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as ReactNative from "react-native";
import { queryClient } from "@/lib/queries";
import { calls, fakeSession, seed, setSession, supabase } from "../test/fake-supabase";
import { household, NOW, USER_ID } from "../test/fixtures";

jest.mock("@/lib/supabase", () => jest.requireActual("../test/fake-supabase"));
jest.mock("@expo-google-fonts/geist", () => ({ useFonts: jest.fn(() => [true]) }));
jest.mock("expo-web-browser", () => ({
  ...jest.requireActual<object>("expo-web-browser"),
  openAuthSessionAsync: jest.fn(),
}));

process.env.EXPO_ROUTER_IMPORT_MODE = "sync";

/** The whole app, from `src/app` as it ships: root layout, tabs, stacks and every route file. */
async function renderApp(location: string) {
  await render(<ExpoRoot context={getMockContext("./src/app")} location={location} />);
}

beforeEach(async () => {
  await AsyncStorage.removeItem("orbit.instance");
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  queryClient.clear();
  seed(household());
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete process.env.EXPO_PUBLIC_TEST_SIGNIN_EMAIL;
  delete process.env.EXPO_PUBLIC_TEST_SIGNIN_PASSWORD;
});

describe("the app", () => {
  it("sends a signed-out start to the sign-in screen", async () => {
    setSession(null);
    await renderApp("/");
    expect(await screen.findByText("Войти через Google")).toBeOnTheScreen();
  });

  it("signs in with Google and lands on today's doses", async () => {
    setSession(null);
    jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
      type: "success",
      url: "exp://127.0.0.1:8081/--/auth/callback?code=abc",
    });
    await renderApp("/sign-in");
    await fireEvent.press(await screen.findByText("Войти через Google"));
    // Both tabs are mounted, so the course shows in today's list and in the medications list.
    expect((await screen.findAllByText("Vitamin D3")).length).toBeGreaterThan(0);
  });

  it("stays on sign-in, silently, when the Google sheet is closed", async () => {
    setSession(null);
    jest
      .mocked(WebBrowser.openAuthSessionAsync)
      .mockResolvedValue({ type: WebBrowser.WebBrowserResultType.CANCEL });
    await renderApp("/sign-in");
    await fireEvent.press(await screen.findByText("Войти через Google"));
    await waitFor(() => expect(screen.getByText("Войти через Google")).toBeOnTheScreen());
  });

  it("opens on today's doses when already signed in", async () => {
    setSession(fakeSession(USER_ID));
    await renderApp("/");
    expect((await screen.findAllByText("Vitamin D3")).length).toBeGreaterThan(0);
    // Every tab is mounted: only the money tab's feed is asked of a function.
    expect(calls.rpc.filter((call) => !call.name.startsWith("money_"))).toEqual([]);
  });

  it("says why the sign-in could not start", async () => {
    setSession(null);
    jest
      .spyOn(supabase.auth, "signInWithOAuth")
      .mockResolvedValueOnce({ data: { url: "" }, error: { message: "Provider disabled" } });
    await renderApp("/sign-in");
    await fireEvent.press(await screen.findByText("Войти через Google"));
    expect(await screen.findByText("Provider disabled")).toBeOnTheScreen();
  });

  it("says what Google answered when it refused", async () => {
    setSession(null);
    jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
      type: "success",
      url: "exp://127.0.0.1:8081/--/auth/callback?error=access_denied&error_description=Not+allowed",
    });
    await renderApp("/sign-in");
    await fireEvent.press(await screen.findByText("Войти через Google"));
    expect(await screen.findByText(/Not allowed/)).toBeOnTheScreen();
  });

  it("says why the code could not be exchanged", async () => {
    setSession(null);
    jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
      type: "success",
      url: "exp://127.0.0.1:8081/--/auth/callback?code=abc",
    });
    jest
      .spyOn(supabase.auth, "exchangeCodeForSession")
      .mockResolvedValueOnce({ error: { message: "Code expired" } });
    await renderApp("/sign-in");
    await fireEvent.press(await screen.findByText("Войти через Google"));
    expect(await screen.findByText("Code expired")).toBeOnTheScreen();
  });

  it("signs a recordings bundle straight in as the test user", async () => {
    setSession(null);
    process.env.EXPO_PUBLIC_TEST_SIGNIN_EMAIL = "dev@example.com";
    process.env.EXPO_PUBLIC_TEST_SIGNIN_PASSWORD = "local-only";
    await renderApp("/sign-in");
    expect((await screen.findAllByText("Vitamin D3")).length).toBeGreaterThan(0);
  });

  it("draws nothing until its font has loaded", async () => {
    jest.mocked(Fonts.useFonts).mockReturnValueOnce([false, null]);
    setSession(fakeSession(USER_ID));
    await renderApp("/");
    expect(screen.queryByText("Войти через Google")).toBeNull();
  });

  it("draws in the dark palette when the phone is dark", async () => {
    jest.spyOn(ReactNative, "useColorScheme").mockReturnValue("dark");
    setSession(null);
    await renderApp("/sign-in");
    expect(await screen.findByText("Войти через Google")).toBeOnTheScreen();
  });

  it("signs out back to the sign-in screen", async () => {
    setSession(fakeSession(USER_ID));
    await renderApp("/today");
    await fireEvent.press((await screen.findAllByLabelText("Настройки"))[0]!);
    await fireEvent.press(await screen.findByText("Выйти"));
    expect(await screen.findByText("Войти через Google")).toBeOnTheScreen();
  });
});

/** A server at `friend.example.com` that answers as an Orbit instance. */
function friendServer() {
  return jest.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      supabaseUrl: "https://friend.example.com",
      supabaseAnonKey: "friend-key",
    }),
  } as Response);
}

/** Answer the next alert with the button labelled `label`. */
function answerAlert(label: string) {
  jest.spyOn(ReactNative.Alert, "alert").mockImplementationOnce((_title, _message, buttons) => {
    buttons?.find((button) => button.text === label)?.onPress?.();
  });
}

describe("the server", () => {
  it("is asked for on the first start of a build that names none, then signs in there", async () => {
    const config = Constants.expoConfig as { extra?: unknown };
    const extra = config.extra;
    config.extra = {};
    try {
      setSession(null);
      const fetchMock = friendServer();
      await renderApp("/");
      expect(await screen.findByText("Сервер Orbit")).toBeOnTheScreen();
      expect(screen.queryByText("Отмена")).toBeNull();
      await fireEvent.changeText(screen.getByTestId("server-address"), "friend.example.com");
      await fireEvent.press(screen.getByText("Подключиться"));
      expect(await screen.findByText("Войти через Google")).toBeOnTheScreen();
      expect(screen.getByText("Сервер: friend.example.com")).toBeOnTheScreen();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://friend.example.com/.well-known/orbit-instance",
        expect.anything(),
      );
      expect(await AsyncStorage.getItem("orbit.instance")).toContain("friend-key");
    } finally {
      config.extra = extra;
    }
  });

  it("sends a sign-in without a server to the server screen", async () => {
    const config = Constants.expoConfig as { extra?: unknown };
    const extra = config.extra;
    config.extra = {};
    try {
      setSession(null);
      await renderApp("/sign-in");
      expect(await screen.findByText("Сервер Orbit")).toBeOnTheScreen();
    } finally {
      config.extra = extra;
    }
  });

  it("says why an address was refused", async () => {
    setSession(null);
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network request failed"));
    await renderApp("/server");
    await fireEvent.changeText(await screen.findByTestId("server-address"), "http://x.example.com");
    await fireEvent.press(screen.getByText("Подключиться"));
    expect(await screen.findByText("Адрес должен начинаться с https://.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("server-address"), "nowhere.example.com");
    await fireEvent(screen.getByTestId("server-address"), "submitEditing");
    expect(await screen.findByText(/Не удалось связаться с сервером/)).toBeOnTheScreen();
  });

  it("changes from the sign-in screen after a warning, signed out of the old one", async () => {
    setSession(null);
    friendServer();
    await renderApp("/sign-in");
    expect(await screen.findByText("Сервер: orbit.test")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Сменить сервер"));
    const input = await screen.findByTestId("server-address");
    expect(input.props.value).toBe("orbit.test");
    await fireEvent.changeText(input, "friend.example.com");
    answerAlert("Сменить сервер");
    await fireEvent.press(screen.getByText("Подключиться"));
    expect(await screen.findByText("Сервер: friend.example.com")).toBeOnTheScreen();
  });

  it("stays put when the change is cancelled, or the address is the same one", async () => {
    setSession(fakeSession(USER_ID));
    friendServer().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ supabaseUrl: "https://orbit.test", supabaseAnonKey: "anon-key" }),
    } as Response);
    await renderApp("/today");
    await fireEvent.press((await screen.findAllByLabelText("Настройки"))[0]!);
    expect(await screen.findByText("orbit.test")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Сменить сервер"));
    await fireEvent.press(await screen.findByText("Подключиться"));
    expect(await screen.findByText("orbit.test")).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Сменить сервер"));
    await fireEvent.changeText(await screen.findByTestId("server-address"), "friend.example.com");
    answerAlert("Отмена");
    await fireEvent.press(screen.getByText("Подключиться"));
    await fireEvent.press(await screen.findByText("Отмена"));
    expect(await screen.findByText("orbit.test")).toBeOnTheScreen();
    expect(await AsyncStorage.getItem("orbit.instance")).toBeNull();
  });
});
