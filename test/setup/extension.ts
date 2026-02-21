import { afterEach, beforeEach, vi } from "vitest";
import { clearChromeMock, installChromeMock } from "../factories/chrome";
import { installNoNetworkGuard } from "./no-network";

installNoNetworkGuard();

beforeEach(() => {
  installChromeMock();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearChromeMock();
});
