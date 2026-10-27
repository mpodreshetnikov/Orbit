import { jest } from "@jest/globals";

// Shared setup for the client's tests: the native modules the screens reach are mocked here once,
// so a test states what it is about rather than restating the platform.
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// The instance a development build is pointed at. A test of the first start without one replaces it.
jest.mock("expo-constants", () => {
  const actual = jest.requireActual<{ default: { expoConfig?: object } }>("expo-constants");
  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual.default,
      expoConfig: {
        ...actual.default.expoConfig,
        extra: { supabaseUrl: "https://orbit.test", supabaseAnonKey: "anon-key" },
      },
    },
  };
});
