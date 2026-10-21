import { jest } from "@jest/globals";

// Shared setup for the client's tests: the native modules the screens reach are mocked here once,
// so a test states what it is about rather than restating the platform.
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
