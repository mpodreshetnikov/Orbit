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
        "add_measurement",
        "add_medication",
        "get_checkup",
        "get_condition",
        "get_measurement_history",
        "get_medical_record",
        "get_medication",
        "get_observation_history",
        "get_person",
        "list_catalog_entries",
        "list_checkups",
        "list_conditions",
        "list_measurements",
        "list_medication_doses",
        "list_medications",
        "list_persons",
        "log_dose",
        "search_catalog_entries",
        "search_findings",
        "get_finding_history",
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
    "add_measurement",
    "add_medication",
    "log_dose",
    "update_medication",
    "upsert_catalog_entry",
  ];

  it("marks read tools read-only", () => {
    for (const tool of tools) {
      if (WRITE_TOOLS.includes(tool.name)) continue;
      expect(tool.config.annotations?.readOnlyHint, `${tool.name} should be read-only`).toBe(true);
    }
  });

  it("marks write tools as mutating but not destructive", () => {
    for (const name of WRITE_TOOLS) {
      const tool = byName.get(name);
      expect(tool, `${name} should be registered`).toBeDefined();
      expect(tool!.config.annotations?.readOnlyHint, `${name} must not claim to be read-only`).toBe(
        false,
      );
      // Nothing in this surface deletes data; the client should not warn as if
      // it might.
      expect(tool!.config.annotations?.destructiveHint).toBe(false);
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
    for (const tool of tools) {
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
