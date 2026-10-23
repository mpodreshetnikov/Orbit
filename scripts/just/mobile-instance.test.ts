import { describe, expect, it } from "vitest";
import * as mobileInstance from "./mobile-instance.cjs";

const { envFileFor, instanceOrigin } = mobileInstance;

describe("instanceOrigin", () => {
  it("accepts a bare domain", () => {
    expect(instanceOrigin("orbit.example.com")).toBe("https://orbit.example.com");
  });

  it("accepts a full https address with a trailing slash", () => {
    expect(instanceOrigin("https://orbit.example.com/")).toBe("https://orbit.example.com");
  });

  it("refuses plain http", () => {
    expect(() => instanceOrigin("http://orbit.example.com")).toThrow(/https/);
  });

  it("refuses an address with a path", () => {
    expect(() => instanceOrigin("orbit.example.com/login")).toThrow(/no path/);
  });

  it("asks for an instance when given none", () => {
    expect(() => instanceOrigin("")).toThrow(/Name the instance/);
  });
});

describe("envFileFor", () => {
  it("writes both settings Expo reads", () => {
    const file = envFileFor({ supabaseUrl: "https://orbit.example.com", supabaseAnonKey: "a.b-c" });
    expect(file).toContain("EXPO_PUBLIC_SUPABASE_URL=https://orbit.example.com\n");
    expect(file).toContain("EXPO_PUBLIC_SUPABASE_ANON_KEY=a.b-c\n");
  });

  it("refuses a value that could smuggle another line into the file", () => {
    expect(() =>
      envFileFor({ supabaseUrl: "https://orbit.example.com", supabaseAnonKey: "k\nEVIL=1" }),
    ).toThrow(/supabaseAnonKey/);
  });

  it("refuses an answer that is not an instance's settings", () => {
    expect(() => envFileFor({ error: "nope" })).toThrow(/supabaseUrl/);
  });
});
