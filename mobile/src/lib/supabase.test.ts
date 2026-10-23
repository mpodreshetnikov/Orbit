import { describe, expect, it, jest } from "@jest/globals";
import { AppState, type AppStateStatus } from "react-native";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: { supabaseUrl: "https://orbit.example.com", supabaseAnonKey: "anon-key" },
    },
  },
}));

describe("the Supabase client", () => {
  it("talks to the configured instance and refreshes only in the foreground", () => {
    let onChange: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      onChange = listener as (state: AppStateStatus) => void;
      return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabase } = require("@/lib/supabase") as typeof import("@/lib/supabase");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { instanceConfig } = require("@/lib/instance") as typeof import("@/lib/instance");

    expect(instanceConfig().supabaseUrl).toBe("https://orbit.example.com");
    expect(instanceConfig()).toBe(instanceConfig());
    const start = jest.spyOn(supabase.auth, "startAutoRefresh").mockResolvedValue();
    const stop = jest.spyOn(supabase.auth, "stopAutoRefresh").mockResolvedValue();
    onChange?.("active");
    onChange?.("background");
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
