import { afterEach, vi } from "vitest";
import { installNoNetworkGuard } from "./no-network";

installNoNetworkGuard();

afterEach(() => {
  vi.restoreAllMocks();
});
