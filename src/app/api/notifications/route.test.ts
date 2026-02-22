import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

describe("GET /api/notifications", () => {
  beforeEach(() => {
    createServerSupabaseClientMock.mockReset();
  });

  function mockAuthenticatedSupabase(options?: {
    queryError?: string;
    rows?: Array<Record<string, unknown>>;
    routedPersons?: Array<{ person_id: string }>;
  }) {
    const order = vi.fn().mockResolvedValue({
      data: options?.rows ?? [],
      error: options?.queryError ? { message: options.queryError } : null,
    });
    const lte = vi.fn().mockReturnValue({ order });
    const gte = vi.fn().mockReturnValue({ lte });
    const isFilter = vi.fn().mockReturnValue({ gte });
    const eq = vi.fn().mockReturnValue({ is: isFilter });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const rpc = vi.fn().mockResolvedValue({
      data: options?.routedPersons ?? [],
      error: null,
    });

    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from,
      rpc,
    });

    return { from, select, eq, isFilter, gte, lte, order, rpc };
  }

  it("returns 401 when user is unauthenticated", async () => {
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("unauthorized"),
        }),
      },
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/notifications", { method: "GET" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 500 when digest query fails", async () => {
    mockAuthenticatedSupabase({ queryError: "db failed" });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/notifications", { method: "GET" }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "db failed" });
  });

  it("filters notifications by routed person ids", async () => {
    mockAuthenticatedSupabase({
      rows: [
        {
          id: "digest-allowed",
          type: "medication",
          scheduled_at: "2026-02-01T10:00:00.000Z",
          person_id: "person-1",
          payload_json: {
            title: "Allowed",
            body: "Body",
            url: "/health",
            person_name: "John",
            title_prefix: "Care",
            tag: "tag-a",
          },
        },
        {
          id: "digest-denied",
          type: "medication",
          scheduled_at: "2026-02-01T11:00:00.000Z",
          person_id: "person-2",
          payload_json: { title: "Denied", body: "Body" },
        },
        {
          id: "digest-global",
          type: "checkup",
          scheduled_at: "2026-02-01T12:00:00.000Z",
          person_id: null,
          payload_json: { title: "Global", body: "Body", url: "/settings" },
        },
      ],
      routedPersons: [{ person_id: "person-1" }],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/notifications?from=2026-02-01T00:00:00.000Z&to=2026-02-02T00:00:00.000Z",
        {
          method: "GET",
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      notifications: [
        {
          id: "digest-allowed",
          type: "medication",
          title: "Allowed",
          body: "Body",
          url: "/health",
          scheduledAt: "2026-02-01T10:00:00.000Z",
          person_id: "person-1",
          person_name: "John",
          title_prefix: "Care",
          tag: "tag-a",
        },
        {
          id: "digest-global",
          type: "checkup",
          title: "Global",
          body: "Body",
          url: "/settings",
          scheduledAt: "2026-02-01T12:00:00.000Z",
          person_id: null,
          person_name: null,
          title_prefix: null,
          tag: null,
        },
      ],
    });
  });

  it("uses request query window when from/to are passed", async () => {
    const { gte, lte } = mockAuthenticatedSupabase({
      rows: [],
      routedPersons: [],
    });

    const { GET } = await import("./route");
    await GET(
      new Request(
        "http://localhost/api/notifications?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z",
        {
          method: "GET",
        },
      ),
    );

    expect(gte).toHaveBeenCalledWith("scheduled_at", "2026-01-01T00:00:00.000Z");
    expect(lte).toHaveBeenCalledWith("scheduled_at", "2026-01-02T00:00:00.000Z");
  });

  it("uses default day window when from/to are missing", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-03-10T15:30:00.000Z");
      vi.setSystemTime(now);
      const { gte, lte } = mockAuthenticatedSupabase({
        rows: [],
        routedPersons: [],
      });

      const { GET } = await import("./route");
      await GET(new Request("http://localhost/api/notifications", { method: "GET" }));

      const expectedStart = new Date(now);
      expectedStart.setHours(0, 0, 0, 0);
      const expectedEnd = new Date(now);
      expectedEnd.setDate(expectedEnd.getDate() + 1);

      expect(gte).toHaveBeenCalledWith("scheduled_at", expectedStart.toISOString());
      expect(lte).toHaveBeenCalledWith("scheduled_at", expectedEnd.toISOString());
    } finally {
      vi.useRealTimers();
    }
  });
});
