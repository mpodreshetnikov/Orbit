import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

describe("GET /api/extension-release/latest/download", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    createClientMock.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  it("redirects to the latest published extension zip", async () => {
    const download = vi.fn().mockResolvedValue({
      data: new Blob(
        [
          JSON.stringify({
            version: "1.2.4",
            published_at: "2026-03-14T12:00:00.000Z",
            extension_id: "abc123",
            sha256: "deadbeef",
            download_url:
              "https://project.supabase.co/storage/v1/object/public/extension-releases/releases/1.2.4/orbit-extension-1.2.4.zip",
          }),
        ],
        { type: "application/json" },
      ),
      error: null,
    });
    createClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({ download })),
      },
    });

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://project.supabase.co/storage/v1/object/public/extension-releases/releases/1.2.4/orbit-extension-1.2.4.zip",
    );
  });

  it("returns 404 when no release metadata is published yet", async () => {
    const download = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Object not found" },
    });
    createClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({ download })),
      },
    });

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Extension release metadata is not published yet.",
    });
  });

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    }
    if (originalAnonKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
    }
  });
});
