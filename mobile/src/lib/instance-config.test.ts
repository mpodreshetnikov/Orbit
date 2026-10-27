import { describe, expect, it } from "@jest/globals";
import {
  InstanceConfigError,
  normalizeAddress,
  resolveInstanceConfig,
} from "@/lib/instance-config";

const valid = {
  supabaseUrl: "https://project.supabase.co",
  supabaseAnonKey: "anon-key",
};

describe("resolveInstanceConfig", () => {
  it("returns the origin and key when the build was configured", () => {
    expect(resolveInstanceConfig(valid)).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabaseAnonKey: "anon-key",
    });
  });

  it("strips a trailing slash by returning the origin", () => {
    expect(
      resolveInstanceConfig({ ...valid, supabaseUrl: "https://project.supabase.co/" }),
    ).toEqual({ supabaseUrl: "https://project.supabase.co", supabaseAnonKey: "anon-key" });
  });

  it.each([undefined, null, "a string"])("rejects config that is not an object: %s", (extra) => {
    expect(() => resolveInstanceConfig(extra)).toThrow(InstanceConfigError);
  });

  it.each([
    { ...valid, supabaseUrl: "" },
    { ...valid, supabaseUrl: undefined },
    { ...valid, supabaseAnonKey: "" },
    { ...valid, supabaseAnonKey: 42 },
  ])("rejects a missing or non-string value: %o", (extra) => {
    expect(() => resolveInstanceConfig(extra)).toThrow(/is not set|is not a URL/);
  });

  it("rejects plaintext http to a public host, which would leak the access token", () => {
    expect(() =>
      resolveInstanceConfig({ ...valid, supabaseUrl: "http://project.supabase.co" }),
    ).toThrow(/must be https/);
  });

  it("allows http to localhost, which has no certificate to present", () => {
    expect(resolveInstanceConfig({ ...valid, supabaseUrl: "http://localhost:54321" })).toEqual({
      supabaseUrl: "http://localhost:54321",
      supabaseAnonKey: "anon-key",
    });
  });

  it.each([
    "https://project.supabase.co/rest/v1",
    "https://project.supabase.co/?key=value",
    "https://project.supabase.co/#fragment",
  ])("rejects a URL carrying more than an origin: %s", (supabaseUrl) => {
    expect(() => resolveInstanceConfig({ ...valid, supabaseUrl })).toThrow(/bare origin/);
  });

  it("rejects something that is not a URL at all", () => {
    expect(() => resolveInstanceConfig({ ...valid, supabaseUrl: "not a url" })).toThrow(
      /is not a URL/,
    );
  });
});

describe("normalizeAddress", () => {
  it.each([
    ["orbit.example.com", "https://orbit.example.com"],
    ["  https://orbit.example.com/  ", "https://orbit.example.com"],
    ["ORBIT.example.com:8443", "https://orbit.example.com:8443"],
    ["http://localhost:3000", "http://localhost:3000"],
  ])("reads %s as %s", (input, origin) => {
    expect(normalizeAddress(input)).toBe(origin);
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["https://", "invalid"],
    ["http://orbit.example.com", "notHttps"],
    ["ftp://orbit.example.com", "notHttps"],
    ["orbit.example.com/app", "hasPath"],
    ["orbit.example.com?x=1", "hasPath"],
  ])("refuses %j as %s", (input, problem) => {
    expect(() => normalizeAddress(input)).toThrow(
      expect.objectContaining({ problem }) as unknown as Error,
    );
  });
});
