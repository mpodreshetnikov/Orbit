import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

/**
 * Exercises the catalogue write tools. The data layer is mocked, so these assert what a tool hands
 * it and what it tells the agent back.
 */

const catalogs = vi.hoisted(() => ({
  listCatalogEntries: vi.fn(),
  searchCatalogEntries: vi.fn(),
  upsertCatalogEntry: vi.fn(),
  createCatalogEntries: vi.fn(),
  addCatalogSynonyms: vi.fn(),
  getCatalogSpec: (kind: string) =>
    ({
      observation: { codeColumn: "obs_code", label: "lab analyte types" },
      finding_type: { codeColumn: "finding_code", label: "finding types" },
    })[kind],
}));

vi.mock("../health/catalogs", () => catalogs);
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

async function handlers(): Promise<Map<string, Handler>> {
  const { registerCatalogTools } = await import("./catalogs");
  const map = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: Handler) => {
      map.set(name, handler);
      return {} as never;
    }),
  } as unknown as McpToolServer;
  registerCatalogTools(server);
  return map;
}

const WBC = {
  catalog: "observation",
  obs_code: "wbc",
  name_en: "White blood cells",
  name_ru: "Лейкоциты",
  canonical_unit: "10^9/L",
  synonyms_ru: ["лейкоциты", "wbc"],
};

describe("catalog write tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a batch, adds the canonical unit to its conversions and lists what existed", async () => {
    catalogs.createCatalogEntries.mockResolvedValue({
      created: [{ obs_code: "vitamin_d_25oh" }],
      existing: ["wbc"],
    });

    const result = await (await handlers()).get("create_catalog_entries")!(
      {
        entries: [
          WBC,
          {
            ...WBC,
            obs_code: "vitamin_d_25oh",
            canonical_unit: "nmol/L",
            accepted_units: { "ng/mL": { factor_to_canonical: 2.5 } },
          },
        ],
      },
      CTX,
    );

    const call = catalogs.createCatalogEntries.mock.calls[0][1];
    expect(call.kind).toBe("observation");
    expect(call.entries[0]).not.toHaveProperty("catalog");
    expect(call.entries[0]).not.toHaveProperty("accepted_units");
    expect(call.entries[1].accepted_units).toEqual({
      "nmol/L": { factor_to_canonical: 1 },
      "ng/mL": { factor_to_canonical: 2.5 },
    });
    expect(result.content[0].text).toContain("Created 1 lab analyte types entry: vitamin_d_25oh.");
    expect(result.content[0].text).toContain(
      "left unchanged (add wordings with add_catalog_synonyms): wbc",
    );
  });

  it("reports added, present and refused synonyms per entry", async () => {
    catalogs.addCatalogSynonyms.mockResolvedValue([
      {
        code: "alt",
        missing: false,
        added: ["аланинаминотрансфераза"],
        already_present: ["алт"],
        refused: [{ synonym: "pdw", owner: "pdw_pct" }],
      },
      { code: "nope", missing: true, added: [], already_present: [], refused: [] },
    ]);

    const result = await (await handlers()).get("add_catalog_synonyms")!(
      { catalog: "observation", items: [{ code: "alt", synonyms_ru: ["x"] }] },
      CTX,
    );

    expect(result.content[0].text).toBe(
      [
        "Synonyms in the lab analyte types catalog:",
        "- alt: added аланинаминотрансфераза; already there: алт; refused: pdw (belongs to pdw_pct).",
        "- nope: no such entry; nothing added.",
      ].join("\n"),
    );
  });
});
