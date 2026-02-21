import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { installNoNetworkGuard } from "./no-network";

installNoNetworkGuard();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
