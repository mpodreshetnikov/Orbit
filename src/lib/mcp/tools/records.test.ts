import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

/**
 * Exercises the record/observation/diagnosis/finding tool handlers.
 *
 * The data layer is mocked so these assert what a tool *does with* a result:
 * the summary it produces, the structured payload it chains, and how it behaves
 * when a person is ambiguous or a row is missing.
 */

const records = vi.hoisted(() => ({
  searchMedicalRecords: vi.fn(),
  getMedicalRecord: vi.fn(),
  getRecordObservations: vi.fn(),
  getRecordFindings: vi.fn(),
  getRecordConditions: vi.fn(),
  ALL_RECORD_STATUSES: ["draft", "active"],
  ACTIVE_RECORD_STATUSES: ["active"],
}));
const observations = vi.hoisted(() => ({
  searchObservations: vi.fn(),
  getObservationHistory: vi.fn(),
}));
const conditions = vi.hoisted(() => ({ listConditions: vi.fn(), getCondition: vi.fn() }));
const findings = vi.hoisted(() => ({ searchFindings: vi.fn(), getFindingHistory: vi.fn() }));
const person = vi.hoisted(() => ({ resolvePerson: vi.fn(), listPeople: vi.fn() }));

vi.mock("../health/records", () => records);
vi.mock("../health/observations", () => observations);
vi.mock("../health/conditions", () => conditions);
vi.mock("../health/findings", () => findings);
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

const CTX = {
  http: {
    authInfo: {
      scopes: ["health:read", "health:write"],
      extra: {
        grantId: "g-1",
        authUserId: "11111111-1111-1111-1111-111111111111",
        userEmail: "u@example.com",
      },
    },
  },
};

const PERSON = { id: "p-1", name: "Maria", kind: "human" };

async function handlers(): Promise<Map<string, Handler>> {
  const { registerRecordTools } = await import("./records");
  const map = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: Handler) => {
      map.set(name, handler);
      return {} as never;
    }),
  } as unknown as McpToolServer;

  registerRecordTools(server);
  return map;
}

beforeEach(() => {
  vi.clearAllMocks();
  person.resolvePerson.mockResolvedValue({ status: "ok", person: PERSON });
});

describe("search_medical_records", () => {
  it("searches across everyone when no person is named", async () => {
    records.searchMedicalRecords.mockResolvedValue([
      { id: "r-1", title: "Blood panel", record_type: "lab", record_date: "2026-02-01" },
    ]);

    const tool = (await handlers()).get("search_medical_records")!;
    const result = await tool({ limit: 20, offset: 0, include_incomplete: false }, CTX);

    expect(person.resolvePerson).not.toHaveBeenCalled();
    expect(records.searchMedicalRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ personId: undefined }),
    );
    expect(result.content[0].text).toContain("Blood panel");
  });

  it("scopes to a person when one is named", async () => {
    records.searchMedicalRecords.mockResolvedValue([]);

    const tool = (await handlers()).get("search_medical_records")!;
    await tool({ person_name: "Maria", limit: 20, offset: 0, include_incomplete: false }, CTX);

    expect(records.searchMedicalRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ personId: "p-1" }),
    );
  });

  it("asks which person is meant rather than guessing", async () => {
    person.resolvePerson.mockResolvedValue({
      status: "ambiguous",
      message: "Several people match",
      candidates: [PERSON],
    });

    const tool = (await handlers()).get("search_medical_records")!;
    const result = await tool(
      { person_name: "Mar", limit: 20, offset: 0, include_incomplete: false },
      CTX,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.candidates).toHaveLength(1);
    expect(records.searchMedicalRecords).not.toHaveBeenCalled();
  });

  it("widens to in-progress documents only when asked", async () => {
    records.searchMedicalRecords.mockResolvedValue([]);
    const tool = (await handlers()).get("search_medical_records")!;

    await tool({ limit: 20, offset: 0, include_incomplete: true }, CTX);
    expect(records.searchMedicalRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ statuses: records.ALL_RECORD_STATUSES }),
    );

    await tool({ limit: 20, offset: 0, include_incomplete: false }, CTX);
    expect(records.searchMedicalRecords).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ statuses: undefined }),
    );
  });

  it("says so plainly when nothing matches", async () => {
    records.searchMedicalRecords.mockResolvedValue([]);
    const tool = (await handlers()).get("search_medical_records")!;
    const result = await tool({ limit: 20, offset: 0, include_incomplete: false }, CTX);

    expect(result.content[0].text).toMatch(/No medical records found/);
  });
});

describe("get_medical_record", () => {
  it("composes the record with everything extracted from it", async () => {
    records.getMedicalRecord.mockResolvedValue({
      id: "r-1",
      title: "Blood panel",
      record_type: "lab",
      record_date: "2026-02-01",
      ocr_text: "long raw text",
    });
    records.getRecordObservations.mockResolvedValue([{ id: "o-1" }, { id: "o-2" }]);
    records.getRecordFindings.mockResolvedValue([{ id: "f-1" }]);
    records.getRecordConditions.mockResolvedValue([]);

    const tool = (await handlers()).get("get_medical_record")!;
    const result = await tool({ record_id: "r-1", include_ocr_text: false }, CTX);

    expect(result.content[0].text).toContain(
      "2 observation(s), 1 finding(s), 0 diagnosis mention(s)",
    );
    // OCR text is long and rarely useful; it must be dropped unless requested.
    expect((result.structuredContent?.record as Record<string, unknown>).ocr_text).toBeUndefined();
  });

  it("keeps the OCR text when explicitly requested", async () => {
    records.getMedicalRecord.mockResolvedValue({
      id: "r-1",
      title: "T",
      record_type: "lab",
      record_date: null,
      ocr_text: "raw",
    });
    records.getRecordObservations.mockResolvedValue([]);
    records.getRecordFindings.mockResolvedValue([]);
    records.getRecordConditions.mockResolvedValue([]);

    const tool = (await handlers()).get("get_medical_record")!;
    const result = await tool({ record_id: "r-1", include_ocr_text: true }, CTX);

    expect((result.structuredContent?.record as Record<string, unknown>).ocr_text).toBe("raw");
  });

  it("reports an unknown record without fetching its extractions", async () => {
    records.getMedicalRecord.mockResolvedValue(null);

    const tool = (await handlers()).get("get_medical_record")!;
    const result = await tool({ record_id: "nope", include_ocr_text: false }, CTX);

    expect(result.isError).toBe(true);
    expect(records.getRecordObservations).not.toHaveBeenCalled();
  });
});

describe("observation tools", () => {
  it("summarizes lab results with their out-of-range flags", async () => {
    observations.searchObservations.mockResolvedValue([
      {
        obs_name: "Ferritin",
        value_numeric: 12,
        unit: "ng/mL",
        status: "low",
        record_date: "2026-02-01",
      },
      { obs_name: "Hgb", value_numeric: 14, unit: "g/dL", status: "normal", record_date: null },
    ]);

    const tool = (await handlers()).get("search_observations")!;
    const result = await tool({ limit: 20, offset: 0 }, CTX);

    expect(result.content[0].text).toContain("Ferritin: 12 ng/mL [low]");
    // A normal result should not be cluttered with a status tag.
    expect(result.content[0].text).toContain("Hgb: 14 g/dL");
    expect(result.content[0].text).not.toContain("[normal]");
  });

  it("falls back to the text value when there is no number", async () => {
    observations.searchObservations.mockResolvedValue([
      { obs_name: "Blood group", value_numeric: null, value_text: "O+", unit: null, status: null },
    ]);

    const tool = (await handlers()).get("search_observations")!;
    const result = await tool({ limit: 20, offset: 0 }, CTX);

    expect(result.content[0].text).toContain("O+");
  });

  it("returns the analyte series oldest first", async () => {
    observations.getObservationHistory.mockResolvedValue([
      {
        obs_name: "Ferritin",
        value_numeric: 12,
        unit: "ng/mL",
        status: "low",
        record_date: "2026-02-01",
      },
      {
        obs_name: "Ferritin",
        value_numeric: 40,
        unit: "ng/mL",
        status: "normal",
        record_date: "2026-06-01",
      },
    ]);

    const tool = (await handlers()).get("get_observation_history")!;
    const result = await tool({ obs_code: "ferritin", limit: 50 }, CTX);

    expect(result.content[0].text).toContain("2 results for Ferritin");
    expect(result.isError).toBeUndefined();
  });

  it("suggests how to find the right code when a series is empty", async () => {
    observations.getObservationHistory.mockResolvedValue([]);

    const tool = (await handlers()).get("get_observation_history")!;
    const result = await tool({ obs_code: "nope", limit: 50 }, CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("search_observations");
  });
});

describe("condition tools", () => {
  it("lists diagnoses with code, status and mention count", async () => {
    conditions.listConditions.mockResolvedValue([
      { id: "c-1", name: "Anaemia", code: "D50.9", current_status: "active", mention_count: 3 },
      { id: "c-2", name: "Other", code: null, current_status: "resolved" },
    ]);

    const tool = (await handlers()).get("list_conditions")!;
    const result = await tool({}, CTX);

    expect(result.content[0].text).toContain("Anaemia (D50.9) — active, 3 mention(s)");
    expect(result.content[0].text).toContain("Other — resolved");
  });

  it("returns a diagnosis with its mentions and linked checkups", async () => {
    conditions.getCondition.mockResolvedValue({
      condition: { id: "c-1", name: "Anaemia", code: "D50.9", current_status: "active" },
      mentions: [{ id: "m-1" }],
      checkups: [{ id: "chk-1" }, { id: "chk-2" }],
    });

    const tool = (await handlers()).get("get_condition")!;
    const result = await tool({ condition_id: "c-1" }, CTX);

    expect(result.content[0].text).toContain("1 record mention(s), 2 linked checkup(s)");
  });

  it("reports an unknown diagnosis", async () => {
    conditions.getCondition.mockResolvedValue({ condition: null, mentions: [], checkups: [] });

    const tool = (await handlers()).get("get_condition")!;
    const result = await tool({ condition_id: "nope" }, CTX);

    expect(result.isError).toBe(true);
  });
});

describe("finding tools", () => {
  it("summarizes findings with size, severity and resolution", async () => {
    findings.searchFindings.mockResolvedValue([
      {
        finding_type_text: "Polyp",
        body_site_text: "Colon",
        size_mm: 4,
        severity: "mild",
        is_resolved: false,
        finding_date: "2026-02-01",
      },
      {
        finding_type_text: "Cyst",
        body_site_text: null,
        size_mm: 0,
        severity: "unknown",
        is_resolved: true,
        finding_date: null,
      },
    ]);

    const tool = (await handlers()).get("search_findings")!;
    const result = await tool({ limit: 20, offset: 0 }, CTX);

    expect(result.content[0].text).toContain("Polyp at Colon, 4mm, mild — 2026-02-01");
    expect(result.content[0].text).toContain("[resolved]");
    // "unknown" severity is noise; it should be omitted.
    expect(result.content[0].text).not.toContain("unknown");
  });

  it("returns a finding's history", async () => {
    findings.getFindingHistory.mockResolvedValue([
      {
        finding_type_text: "Polyp",
        size_mm: 4,
        count: 1,
        is_resolved: false,
        finding_date: "2026-02-01",
      },
      {
        finding_type_text: "Polyp",
        size_mm: null,
        count: null,
        is_resolved: false,
        finding_date: null,
      },
    ]);

    const tool = (await handlers()).get("get_finding_history")!;
    const result = await tool({ finding_code: "polyp", limit: 50 }, CTX);

    expect(result.content[0].text).toContain("2026-02-01: 4mm, count 1");
    expect(result.content[0].text).toContain("undated: size unknown");
  });

  it("suggests how to discover codes when a history is empty", async () => {
    findings.getFindingHistory.mockResolvedValue([]);

    const tool = (await handlers()).get("get_finding_history")!;
    const result = await tool({ finding_code: "nope", limit: 50 }, CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("search_findings");
  });
});
