import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registerHealthTools } from "./index";
import type { McpToolServer } from "./types";

interface Registered {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: z.ZodTypeAny;
    annotations?: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
    };
  };
}

function collectTools(): Registered[] {
  const tools: Registered[] = [];
  const server = {
    registerTool: vi.fn((name: string, config: Registered["config"]) => {
      tools.push({ name, config });
      return {} as never;
    }),
  } as unknown as McpToolServer;

  registerHealthTools(server);
  return tools;
}

/**
 * These assertions guard the shape of the agent-facing surface. A tool with no
 * description, or a write tool mislabelled as read-only, degrades quietly --
 * the server still starts and the model just uses it badly.
 */
describe("registerHealthTools", () => {
  const tools = collectTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  it("covers every capability the connector promises", () => {
    expect([...byName.keys()].sort()).toEqual(
      [
        "activate_medical_record",
        "add_measurement",
        "add_medication",
        "create_medical_record",
        "dismiss_condition_closure",
        "get_checkup",
        "get_condition",
        "get_measurement_history",
        "get_medical_record",
        "get_medication",
        "get_observation_history",
        "get_person",
        "get_upload_links",
        "list_catalog_entries",
        "list_checkups",
        "list_conditions",
        "list_measurements",
        "list_medication_doses",
        "list_medications",
        "list_pending_records",
        "list_persons",
        "log_dose",
        "search_catalog_entries",
        "add_catalog_synonyms",
        "create_catalog_entries",
        "search_findings",
        "get_finding_history",
        "get_ingest_candidates",
        "ingest_medical_document",
        "propose_reconciliation",
        "remove_medical_record",
        "search_medical_records",
        "search_observations",
        "upsert_catalog_entry",
        "update_medication",
      ].sort(),
    );
  });

  it("registers each name exactly once", () => {
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("names tools in snake_case", () => {
    for (const tool of tools) {
      expect(tool.name, `${tool.name} should be snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("gives every tool a title, a description and an input schema", () => {
    for (const tool of tools) {
      expect(tool.config.title, `${tool.name} needs a title`).toBeTruthy();
      expect(tool.config.description, `${tool.name} needs a description`).toBeTruthy();
      expect(
        (tool.config.description ?? "").length,
        `${tool.name}'s description is too terse to guide tool choice`,
      ).toBeGreaterThan(40);
      expect(tool.config.inputSchema, `${tool.name} needs an inputSchema`).toBeDefined();
    }
  });

  const WRITE_TOOLS = [
    "activate_medical_record",
    "add_catalog_synonyms",
    "add_measurement",
    "create_catalog_entries",
    "add_medication",
    "create_medical_record",
    "dismiss_condition_closure",
    "get_upload_links",
    "ingest_medical_document",
    "log_dose",
    "propose_reconciliation",
    "remove_medical_record",
    "update_medication",
    "upsert_catalog_entry",
  ];

  it("marks read tools read-only", () => {
    for (const tool of tools) {
      if (WRITE_TOOLS.includes(tool.name)) continue;
      expect(tool.config.annotations?.readOnlyHint, `${tool.name} should be read-only`).toBe(true);
    }
  });

  it("marks write tools as mutating, and destructive only where they delete", () => {
    for (const name of WRITE_TOOLS) {
      const tool = byName.get(name);
      expect(tool, `${name} should be registered`).toBeDefined();
      expect(tool!.config.annotations?.readOnlyHint, `${name} must not claim to be read-only`).toBe(
        false,
      );
      // Only approval deletes data (the observations nobody matched), so only it warns.
      expect(tool!.config.annotations?.destructiveHint).toBe(name === "activate_medical_record");
    }
  });

  // Registration and dispatch are separate concerns, so a tool can be
  // annotated as a write while forgetting to require the write scope. That
  // combination is exactly the bug the consent screen would be lying about.
  it("keeps the write annotation and the write scope in lockstep", async () => {
    const { MCP_SCOPE_WRITE } = await import("../config");
    const scopeChecked: string[] = [];

    const server = {
      registerTool: vi.fn(async (name: string, _config: unknown, handler: unknown) => {
        const call = handler as (
          args: unknown,
          ctx: unknown,
        ) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
        // Dispatch with a read-only grant and see which tools refuse.
        const result = await call(
          {},
          {
            http: {
              authInfo: {
                scopes: ["health:read"],
                extra: {
                  grantId: "g",
                  authUserId: "11111111-1111-1111-1111-111111111111",
                  userEmail: "u@example.com",
                },
              },
            },
          },
        );
        if (result?.isError && result.content[0]?.text?.includes(MCP_SCOPE_WRITE)) {
          scopeChecked.push(name);
        }
        return {} as never;
      }),
    } as unknown as McpToolServer;

    registerHealthTools(server);
    await Promise.all(vi.mocked(server.registerTool).mock.results.map((r) => r.value));

    expect(scopeChecked.sort()).toEqual([...WRITE_TOOLS].sort());
  });

  it("does not expose any deletion tool", () => {
    // remove_medical_record is the app's own Remove: it sets an unapproved record aside, and the
    // owner can restore it. Nothing here erases a row.
    for (const tool of tools.filter((t) => t.name !== "remove_medical_record")) {
      expect(tool.name).not.toMatch(/delete|remove|destroy/);
    }
  });

  it("lets person-scoped tools accept either an id or a name", () => {
    const personScoped = [
      "list_measurements",
      "get_measurement_history",
      "add_measurement",
      "search_observations",
      "list_conditions",
      "search_findings",
      "list_checkups",
      "list_medications",
    ];

    for (const name of personScoped) {
      const schema = byName.get(name)?.config.inputSchema as z.ZodObject<z.ZodRawShape>;
      const keys = Object.keys(schema.shape);
      expect(keys, `${name} should accept person_id`).toContain("person_id");
      expect(keys, `${name} should accept person_name`).toContain("person_name");
    }
  });

  it("accepts a minimal call on person-scoped tools, so a single-person account needs no id", () => {
    const schema = byName.get("list_measurements")?.config.inputSchema as z.ZodTypeAny;
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("validates measurement input", () => {
    const schema = byName.get("add_measurement")?.config.inputSchema as z.ZodTypeAny;

    expect(schema.safeParse({ code: "weight", value: 78.4 }).success).toBe(true);
    expect(schema.safeParse({ code: "weight" }).success).toBe(false);
    expect(schema.safeParse({ code: "weight", value: "78.4" }).success).toBe(false);
    expect(
      schema.safeParse({ code: "weight", value: 78.4, measured_at: "not-a-date" }).success,
    ).toBe(false);
  });

  it("requires a confidence on every extracted row, so a left-out one is not stored as zero", () => {
    const schema = byName.get("ingest_medical_document")?.config.inputSchema as z.ZodTypeAny;
    const observation = {
      obs_name_text: "Витамин В12",
      value: "704",
      source_anchor: "Витамин В12 704",
    };
    const call = (row: Record<string, unknown>) => ({
      record_id: "5f0c3a52-2b8e-4c1d-9a7f-3e6b1d2c4a90",
      source_text: "Витамин В12 704 пг/мл",
      classification: {
        record_type: "lab",
        title: "Витамины",
        record_date: "2025-10-27",
        summary: "",
        keywords: [],
      },
      extraction: { observations: [row], findings: [], conditions: [], asserted_absences: [] },
      reconciliation: { nothing_to_reconcile: true },
    });

    expect(schema.safeParse(call({ ...observation, confidence: 0.9 })).success).toBe(true);
    expect(schema.safeParse(call(observation)).success).toBe(false);
  });

  it("validates a medication's schedule against the real union", () => {
    const schema = byName.get("add_medication")?.config.inputSchema as z.ZodTypeAny;

    const base = {
      custom_name: "Ferrous sulfate",
      intake_unit: "pill",
      dose_definition: { intake: { amount: 1, unit: "pill" } },
      duration: { type: "endless" },
    };

    expect(
      schema.safeParse({ ...base, schedule: { mode: "daily_times", times: ["08:00", "20:00"] } })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ ...base, schedule: { mode: "interval_hours", interval: { every: 8 } } })
        .success,
    ).toBe(true);
    // A mode that does not exist must be rejected rather than written as jsonb.
    expect(schema.safeParse({ ...base, schedule: { mode: "whenever" } }).success).toBe(false);
    // Times must be real 24-hour clock values.
    expect(
      schema.safeParse({ ...base, schedule: { mode: "daily_times", times: ["8am"] } }).success,
    ).toBe(false);
  });

  it("refuses an argument a tool does not declare", () => {
    // `status` and `include_drafts` were accepted and ignored, and the agent took the default
    // answer for the one it asked.
    const schema = byName.get("search_medical_records")?.config.inputSchema as z.ZodTypeAny;
    expect(schema.safeParse({ include_incomplete: true }).success).toBe(true);
    const refused = schema.safeParse({ status: "draft" });
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain("status");
  });

  it("takes an observation's unit conversions as factors only", () => {
    const schema = byName.get("upsert_catalog_entry")?.config.inputSchema as z.ZodTypeAny;
    const entry = {
      catalog: "observation",
      obs_code: "vitamin_d_25oh",
      name_en: "25(OH) Vitamin D",
      name_ru: "25(OH) витамин D",
      canonical_unit: "nmol/L",
    };
    expect(
      schema.safeParse({
        entry: { ...entry, accepted_units: { "ng/mL": { factor_to_canonical: 2.5 } } },
      }).success,
    ).toBe(true);
    // A formula is a string the server evaluates; it is not something to take from a chat.
    expect(
      schema.safeParse({
        entry: { ...entry, accepted_units: { "ng/mL": { formula_to_canonical: "x * 2.5" } } },
      }).success,
    ).toBe(false);
  });

  it("gives each catalog its own field set on the write tool", () => {
    const schema = byName.get("upsert_catalog_entry")?.config.inputSchema as z.ZodTypeAny;

    expect(
      schema.safeParse({
        entry: {
          catalog: "measurement",
          code: "grip_strength",
          name_en: "Grip strength",
          name_ru: "Сила хвата",
          unit_en: "kg",
          unit_ru: "кг",
          category: "limbs",
        },
      }).success,
    ).toBe(true);

    // Measurement fields must not satisfy the observation variant.
    expect(
      schema.safeParse({
        entry: { catalog: "observation", code: "x", name_en: "X", name_ru: "X" },
      }).success,
    ).toBe(false);

    expect(
      schema.safeParse({
        entry: {
          catalog: "observation",
          obs_code: "ferritin",
          name_en: "Ferritin",
          name_ru: "Ферритин",
          canonical_unit: "ng/mL",
        },
      }).success,
    ).toBe(true);
  });
});
