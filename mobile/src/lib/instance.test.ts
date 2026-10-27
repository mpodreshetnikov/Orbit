import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import {
  buildInstance,
  currentInstance,
  discoverInstance,
  loadInstance,
  saveInstance,
} from "@/lib/instance";
import { InstanceConfigError } from "@/lib/instance-config";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const FRIEND = {
  address: "https://friend.example.com",
  supabaseUrl: "https://friend.example.com",
  supabaseAnonKey: "friend-key",
};

/** A server that answers the discovery request with `body` and `status`. */
function server(body: unknown, status = 200) {
  return jest.fn<Fetch>(
    async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
          if (body instanceof Error) throw body;
          return body;
        },
      }) as Response,
  );
}

async function problemOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(InstanceConfigError);
    return (error as InstanceConfigError).problem;
  }
  throw new Error("expected a refusal");
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("discoverInstance", () => {
  it("asks the typed host for its data API and key", async () => {
    const fetchImpl = server({
      supabaseUrl: "https://friend.example.com",
      supabaseAnonKey: "friend-key",
    });
    expect(await discoverInstance(" friend.example.com/ ", fetchImpl)).toEqual(FRIEND);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://friend.example.com/.well-known/orbit-instance",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("says when the host cannot be reached", async () => {
    const fetchImpl = jest.fn<Fetch>(async () => {
      throw new TypeError("Network request failed");
    });
    expect(await problemOf(discoverInstance("friend.example.com", fetchImpl))).toBe("unreachable");
  });

  it("says when the host is not an Orbit server", async () => {
    expect(await problemOf(discoverInstance("example.com", server({}, 404)))).toBe("notOrbit");
    expect(await problemOf(discoverInstance("example.com", server(new SyntaxError("html"))))).toBe(
      "notOrbit",
    );
  });

  it("refuses a configuration that would talk in clear text", async () => {
    const fetchImpl = server({ supabaseUrl: "http://evil.example.com", supabaseAnonKey: "k" });
    expect(await problemOf(discoverInstance("friend.example.com", fetchImpl))).toBe("badConfig");
  });

  it("refuses an address before asking anybody", async () => {
    const fetchImpl = server({});
    expect(await problemOf(discoverInstance("http://friend.example.com", fetchImpl))).toBe(
      "notHttps",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the chosen instance", () => {
  it("starts on the build's own instance when the phone has chosen none", async () => {
    expect(await loadInstance()).toEqual({
      address: "https://orbit.test",
      supabaseUrl: "https://orbit.test",
      supabaseAnonKey: "anon-key",
    });
  });

  it("keeps the phone's choice across starts", async () => {
    await saveInstance(FRIEND);
    expect(currentInstance()).toEqual(FRIEND);
    expect(await loadInstance()).toEqual(FRIEND);
  });

  it("falls back to the build's when the stored choice is broken", async () => {
    await AsyncStorage.setItem("orbit.instance", "{not json");
    expect((await loadInstance())?.address).toBe("https://orbit.test");
    await AsyncStorage.setItem("orbit.instance", JSON.stringify({ ...FRIEND, supabaseUrl: "x" }));
    expect((await loadInstance())?.address).toBe("https://orbit.test");
  });

  it("names none in a release build, so the app asks", async () => {
    const config = Constants.expoConfig as { extra?: unknown };
    const extra = config.extra;
    config.extra = {};
    try {
      expect(buildInstance()).toBeNull();
      expect(await loadInstance()).toBeNull();
    } finally {
      config.extra = extra;
    }
  });
});
