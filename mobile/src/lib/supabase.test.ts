import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";

type Modules = {
  supabase: typeof import("@/lib/supabase");
  instance: typeof import("@/lib/instance");
};

/** A fresh copy of the client and the instance it reads, as a cold start has them. */
function load(): Modules {
  let modules: Modules | undefined;
  jest.isolateModules(() => {
    modules = {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      supabase: require("@/lib/supabase"),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      instance: require("@/lib/instance"),
    };
  });
  return modules!;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("the Supabase client", () => {
  it("talks to the build's instance and refreshes only in the foreground", () => {
    let onChange: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      onChange = listener as (state: AppStateStatus) => void;
      return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
    });
    const { supabase } = load().supabase;

    expect(supabase.storage).toBe(supabase.storage);
    const start = jest.spyOn(supabase.auth, "startAutoRefresh").mockResolvedValue();
    const stop = jest.spyOn(supabase.auth, "stopAutoRefresh").mockResolvedValue();
    onChange?.("active");
    onChange?.("background");
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("moves to a chosen server, keeping each server's session apart", async () => {
    const modules = load();
    const before = modules.supabase.supabase.auth;
    await modules.instance.saveInstance({
      address: "https://friend.example.com",
      supabaseUrl: "https://friend.example.com",
      supabaseAnonKey: "friend-key",
    });
    expect(modules.supabase.supabase.auth).not.toBe(before);
    expect(modules.supabase.supabase.auth).toBe(modules.supabase.supabase.auth);
  });

  it("refuses to talk to nobody, and leaves the refresh loop alone", () => {
    let onChange: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      onChange = listener as (state: AppStateStatus) => void;
      return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
    });
    const modules = load();
    jest.spyOn(modules.instance, "currentInstance").mockReturnValue(null);
    expect(() => modules.supabase.supabase.auth).toThrow("No Orbit server");
    expect(() => onChange?.("active")).not.toThrow();
  });
});
