import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

/**
 * `measured_at` is a `timestamptz`, so these tools have both halves of the
 * timezone contract to keep: a wall clock handed in is read in the caller's
 * zone rather than the server's, and a time handed back is quoted in a named
 * zone rather than in UTC (T-0027).
 */
const measurements = vi.hoisted(() => ({
  listMeasurements: vi.fn(),
  getMeasurementCatalogEntryByCode: vi.fn(),
  addMeasurement: vi.fn(),
}));
const regen = vi.hoisted(() => ({
  regenerateDoseEvents: vi.fn(),
  resolveTimezone: vi.fn(),
  readTimezonePreference: vi.fn(),
}));
const person = vi.hoisted(() => ({ resolvePerson: vi.fn(), listPeople: vi.fn() }));

vi.mock("../health/measurements", () => measurements);
vi.mock("@/lib/medications/regenerate-dose-events", () => regen);
vi.mock("../resolve-person", () => person);
vi.mock("../supabase-user-client", () => ({
  createUserScopedSupabaseClient: vi.fn(() => ({}) as never),
}));

type Handler = (
  args: unknown,
  ctx: unknown,
) => Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

function ctx(scopes = ["health:read", "health:write"]) {
  return {
    http: {
      authInfo: {
        scopes,
        extra: {
          grantId: "g-1",
          authUserId: "11111111-1111-1111-1111-111111111111",
          userEmail: "u@example.com",
        },
      },
    },
  };
}

const PERSON = { id: "p-1", name: "Maria", kind: "human" };
const CATALOG = { id: "c-1", code: "weight", name_en: "Weight", unit_en: "kg" };

const SUMMARY = {
  code: "weight",
  name_en: "Weight",
  unit_en: "kg",
  latest_value: 70,
  // 2026-08-24T20:00Z is already the 25th in Bangkok.
  latest_measured_at: "2026-08-24T20:00:00+00:00",
  measurement_count: 2,
  trend: null,
  history: [
    { id: "m-1", value: 70, measured_at: "2026-08-24T20:00:00+00:00", notes: null },
    { id: "m-0", value: 71, measured_at: "2026-08-10T06:00:00+00:00", notes: null },
  ],
};

async function handlers(): Promise<Map<string, Handler>> {
  const { registerMeasurementTools } = await import("./measurements");
  const map = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _c: unknown, handler: Handler) => {
      map.set(name, handler);
      return {} as never;
    }),
  } as unknown as McpToolServer;
  registerMeasurementTools(server);
  return map;
}

beforeEach(() => {
  vi.clearAllMocks();
  person.resolvePerson.mockResolvedValue({ status: "ok", person: PERSON });
  regen.readTimezonePreference.mockResolvedValue("Asia/Bangkok");
  measurements.listMeasurements.mockResolvedValue([SUMMARY]);
  measurements.getMeasurementCatalogEntryByCode.mockResolvedValue(CATALOG);
  measurements.addMeasurement.mockImplementation(
    async (_client: unknown, params: { value: number; measuredAt?: string }) => ({
      id: "m-2",
      value: params.value,
      measured_at: params.measuredAt ?? "2026-08-24T15:00:00+00:00",
    }),
  );
});

describe("list_measurements", () => {
  it("dates the latest value by the local day, not the UTC one", async () => {
    const result = await (await handlers()).get("list_measurements")!({}, ctx());

    // `.slice(0, 10)` on the stored instant would say the 24th, which is the
    // day before the person weighed themselves.
    expect(result.content[0].text).toContain("on 2026-08-25");
    expect(result.content[0].text).toContain("Asia/Bangkok");
  });

  it("bounds the requested range by local days rather than UTC ones", async () => {
    await (await handlers()).get("list_measurements")!(
      { from: "2026-08-24", to: "2026-08-24" },
      ctx(),
    );

    const [, params] = measurements.listMeasurements.mock.calls[0] as [
      unknown,
      { from: string; to: string },
    ];
    expect(params.from).toBe("2026-08-23T17:00:00.000Z");
    expect(params.to).toBe("2026-08-24T16:59:59.999Z");
  });

  it("carries the zone and the local readings in the payload", async () => {
    const result = await (await handlers()).get("list_measurements")!({}, ctx());

    expect(result.structuredContent).toMatchObject({ timezone: "Asia/Bangkok" });
    const [summary] = result.structuredContent?.measurements as Array<Record<string, unknown>>;
    expect(summary).toMatchObject({
      latest_measured_at: "2026-08-24T20:00:00+00:00",
      latest_measured_at_local: "2026-08-25T03:00:00+07:00",
    });
    expect((summary.history as Array<Record<string, unknown>>)[0]).toMatchObject({
      measured_at_local: "2026-08-25T03:00:00+07:00",
    });
  });

  it("reads the saved zone without persisting one", async () => {
    await (await handlers()).get("list_measurements")!({}, ctx());

    expect(regen.readTimezonePreference).toHaveBeenCalled();
    // Persisting would re-time the household's medication reminders, which is
    // not something asking about weight may do.
    expect(regen.resolveTimezone).not.toHaveBeenCalled();
  });

  it("refuses a zone it cannot resolve rather than answering in UTC", async () => {
    const result = await (await handlers()).get("list_measurements")!(
      { timezone: "Mars/Olympus" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(measurements.listMeasurements).not.toHaveBeenCalled();
  });
});

describe("get_measurement_history", () => {
  it("dates the latest value in the named zone", async () => {
    const result = await (await handlers()).get("get_measurement_history")!(
      { code: "weight", limit: 100 },
      ctx(),
    );

    expect(result.content[0].text).toContain("on 2026-08-25");
    expect(result.content[0].text).toContain("Asia/Bangkok");
  });

  it("reports a type with no data instead of an empty series", async () => {
    measurements.listMeasurements.mockResolvedValue([]);

    const result = await (await handlers()).get("get_measurement_history")!(
      { code: "waist", limit: 100 },
      ctx(),
    );

    expect(result.isError).toBe(true);
  });
});

describe("add_measurement", () => {
  it("reads an offset-less time in the caller's zone, not the server's", async () => {
    const result = await (await handlers()).get("add_measurement")!(
      { code: "weight", value: 70, measured_at: "2026-08-24T22:00", timezone: "Asia/Bangkok" },
      ctx(),
    );

    // Production runs in UTC. Passing this string through to a timestamptz
    // column stored it as 22:00 UTC — seven hours late, and on the wrong local
    // day for anything measured late in the evening.
    const [, params] = measurements.addMeasurement.mock.calls[0] as [
      unknown,
      { measuredAt?: string },
    ];
    expect(params.measuredAt).toBe("2026-08-24T15:00:00.000Z");
    expect(result.content[0].text).toContain("2026-08-24 22:00 +07:00");
  });

  it("takes an offset-bearing time at face value", async () => {
    await (await handlers()).get("add_measurement")!(
      { code: "weight", value: 70, measured_at: "2026-08-24T22:00:00+07:00" },
      ctx(),
    );

    const [, params] = measurements.addMeasurement.mock.calls[0] as [
      unknown,
      { measuredAt?: string },
    ];
    expect(params.measuredAt).toBe("2026-08-24T15:00:00.000Z");
  });

  it("leaves the timestamp to the database when none was given", async () => {
    await (await handlers()).get("add_measurement")!({ code: "weight", value: 70 }, ctx());

    const [, params] = measurements.addMeasurement.mock.calls[0] as [
      unknown,
      { measuredAt?: string },
    ];
    expect(params.measuredAt).toBeUndefined();
  });

  it("refuses input that is not a timestamp instead of storing a guess", async () => {
    // `new Date("0")` is a valid date in the year 2000.
    const result = await (await handlers()).get("add_measurement")!(
      { code: "weight", value: 70, measured_at: "0" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(measurements.addMeasurement).not.toHaveBeenCalled();
  });

  it("refuses a local time that does not exist in the zone", async () => {
    const result = await (await handlers()).get("add_measurement")!(
      {
        code: "weight",
        value: 70,
        measured_at: "2026-03-29T02:30",
        timezone: "Europe/Berlin",
      },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(measurements.addMeasurement).not.toHaveBeenCalled();
  });

  it("refuses on a read-only grant, before writing anything", async () => {
    const result = await (await handlers()).get("add_measurement")!(
      { code: "weight", value: 70 },
      ctx(["health:read"]),
    );

    expect(result.isError).toBe(true);
    expect(measurements.addMeasurement).not.toHaveBeenCalled();
  });
});
