import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /.well-known/orbit-instance", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves the public address and anon key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://orbit.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      supabaseUrl: "https://orbit.example.com",
      supabaseAnonKey: "anon-key",
    });
  });

  it("says so rather than serving half a configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://orbit.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const response = GET();

    expect(response.status).toBe(503);
  });
});
