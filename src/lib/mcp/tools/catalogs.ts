import { z } from "zod";
import {
  addCatalogSynonyms,
  createCatalogEntries,
  getCatalogSpec,
  listCatalogEntries,
  searchCatalogEntries,
  upsertCatalogEntry,
  type CatalogKind,
} from "../health/catalogs";
import { paginationSchema, uuidSchema } from "../schemas/common";
import { withUserClient } from "../tool-context";
import { WRITE_SCOPE } from "./scopes";
import { ok, summarizeList } from "../tool-result";
import type { McpToolServer } from "./types";

const catalogKindSchema = z
  .enum(["observation", "measurement", "finding_type", "body_site"])
  .describe(
    "Which reference catalog: 'observation' = lab analytes, 'measurement' = body measurement types, 'finding_type' = imaging/exam finding types, 'body_site' = anatomical sites.",
  );

const acceptedUnitsSchema = z
  .record(z.string().min(1), z.object({ factor_to_canonical: z.number().positive() }).strict())
  .describe(
    'Printed units values arrive in, each with the factor that converts to canonical_unit, e.g. {"ng/mL": {"factor_to_canonical": 2.5}} for 25(OH) vitamin D kept in nmol/L. canonical_unit itself is added with factor 1. Russian spellings (нг/мл, ммоль/л) are folded onto the Latin ones, so list the Latin form. Passing it replaces the entry\'s list.',
  );

const catalogEntrySchema = z.discriminatedUnion("catalog", [
  z.object({
    catalog: z.literal("observation"),
    obs_code: z.string().min(1).describe("Unique analyte code."),
    name_en: z.string().min(1),
    name_ru: z.string().min(1),
    canonical_unit: z.string().min(1).describe("Unit values are normalized to."),
    accepted_units: acceptedUnitsSchema.optional(),
    synonyms_en: z.array(z.string()).optional(),
    synonyms_ru: z.array(z.string()).optional(),
    default_ref_low: z.number().nullable().optional(),
    default_ref_high: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  z.object({
    catalog: z.literal("measurement"),
    code: z.string().min(1).describe("Unique measurement type code."),
    name_en: z.string().min(1),
    name_ru: z.string().min(1),
    unit_en: z.string().min(1),
    unit_ru: z.string().min(1),
    category: z.enum(["basic", "body", "limbs", "vital"]),
    sort_order: z.number().int().optional(),
  }),
  z.object({
    catalog: z.literal("finding_type"),
    finding_code: z.string().min(1),
    name_en: z.string().min(1),
    name_ru: z.string().min(1),
    synonyms_en: z.array(z.string()).optional(),
    synonyms_ru: z.array(z.string()).optional(),
    notes: z.string().nullable().optional(),
  }),
  z.object({
    catalog: z.literal("body_site"),
    site_code: z.string().min(1),
    name_en: z.string().min(1),
    name_ru: z.string().min(1),
    parent_site_code: z.string().nullable().optional(),
    synonyms_en: z.array(z.string()).optional(),
    synonyms_ru: z.array(z.string()).optional(),
    notes: z.string().nullable().optional(),
  }),
]);

type CatalogEntryInput = Record<string, unknown> & { catalog: CatalogKind };

/**
 * An entry's values as the table takes them. A conversion table that leaves out the canonical unit
 * would make a value printed in that very unit look unconvertible, so it is always there.
 */
function entryValues(entry: CatalogEntryInput): Record<string, unknown> {
  const { catalog: _catalog, ...values } = entry;
  const accepted = values.accepted_units as Record<string, unknown> | undefined;
  if (
    accepted &&
    typeof values.canonical_unit === "string" &&
    !(values.canonical_unit in accepted)
  ) {
    values.accepted_units = { [values.canonical_unit]: { factor_to_canonical: 1 }, ...accepted };
  }
  return values;
}

/**
 * The four reference catalogs. Their codes are what every other tool refers to,
 * so searching them is often the step before a real query or a write.
 *
 * Deleting entries is deliberately not offered: catalog rows are foreign-key
 * targets for live measurements, observations and findings.
 */
export function registerCatalogTools(server: McpToolServer): void {
  function describeRow(kind: CatalogKind, row: Record<string, unknown>): string {
    const spec = getCatalogSpec(kind);
    const code = row[spec.codeColumn] as string;
    const unit =
      kind === "observation"
        ? ` [${row.canonical_unit as string}]`
        : kind === "measurement"
          ? ` [${row.unit_en as string}]`
          : "";
    return `${code}: ${row.name_en as string} / ${row.name_ru as string}${unit}`;
  }

  server.registerTool(
    "list_catalog_entries",
    {
      title: "List catalog entries",
      description:
        "List entries from one of the four reference catalogs. Use this to see what codes exist before recording data or searching by code.",
      inputSchema: z.object({
        catalog: catalogKindSchema,
        ...paginationSchema,
        category: z
          .enum(["basic", "body", "limbs", "vital"])
          .optional()
          .describe("Only for catalog='measurement': restrict to one category."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withUserClient<{
      catalog: CatalogKind;
      limit: number;
      offset: number;
      category?: string;
    }>(async (supabase, args) => {
      const entries = await listCatalogEntries(supabase, {
        kind: args.catalog,
        limit: args.limit,
        offset: args.offset,
        category: args.category,
      });

      return ok(
        summarizeList(
          getCatalogSpec(args.catalog).label,
          entries.map((entry) => describeRow(args.catalog, entry)),
          entries.length,
        ),
        { catalog: args.catalog, entries, limit: args.limit, offset: args.offset },
      );
    }),
  );

  server.registerTool(
    "search_catalog_entries",
    {
      title: "Search catalog",
      description:
        "Search a reference catalog by code, English or Russian name, or synonym. Use this to turn a term the user said into the code the other tools need.",
      inputSchema: z.object({
        catalog: catalogKindSchema,
        query: z.string().min(1).describe("Search text; matches code, names and synonyms."),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withUserClient<{ catalog: CatalogKind; query: string; limit: number }>(
      async (supabase, args) => {
        const entries = await searchCatalogEntries(supabase, {
          kind: args.catalog,
          query: args.query,
          limit: args.limit,
        });

        return ok(
          summarizeList(
            `${getCatalogSpec(args.catalog).label} matching "${args.query}"`,
            entries.map((entry) => describeRow(args.catalog, entry)),
            entries.length,
          ),
          { catalog: args.catalog, entries },
        );
      },
    ),
  );

  server.registerTool(
    "upsert_catalog_entry",
    {
      title: "Create or update catalog entry",
      description:
        "Create a new reference catalog entry, or update an existing one. Pass `id` to update a specific row; otherwise the entry is matched on its code and created if absent. Each catalog takes a different field set. Updating replaces the synonym lists you pass, so to add a wording to an existing entry use add_catalog_synonyms instead, and to create several new entries use create_catalog_entries.",
      inputSchema: z.object({
        id: uuidSchema
          .optional()
          .describe("Update this exact row. Omit to create-or-update by code."),
        entry: catalogEntrySchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withUserClient<{ id?: string; entry: CatalogEntryInput }>(async (supabase, args) => {
      const catalog = args.entry.catalog;
      const saved = await upsertCatalogEntry(supabase, {
        kind: catalog,
        id: args.id,
        values: entryValues(args.entry),
      });

      const spec = getCatalogSpec(catalog);
      return ok(
        `Saved ${spec.label} entry ${saved[spec.codeColumn] as string} (${saved.name_en as string}).`,
        { catalog, entry: saved },
      );
    }, WRITE_SCOPE),
  );

  server.registerTool(
    "create_catalog_entries",
    {
      title: "Create catalog entries",
      description:
        "Create up to 50 new entries in one call, for instance every analyte a document showed the catalogue lacks. An entry whose code already exists is left exactly as it is and listed back; grow it with add_catalog_synonyms. For observations, give accepted_units so values printed in other units convert, and put the document's wording in synonyms_ru.",
      inputSchema: z.object({
        entries: z.array(catalogEntrySchema).min(1).max(50),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withUserClient<{ entries: CatalogEntryInput[] }>(async (supabase, args) => {
      const kinds = [...new Set(args.entries.map((entry) => entry.catalog))];
      const lines: string[] = [];
      const created: Array<Record<string, unknown>> = [];
      const existing: Array<{ catalog: CatalogKind; code: string }> = [];
      for (const kind of kinds) {
        const spec = getCatalogSpec(kind);
        const result = await createCatalogEntries(supabase, {
          kind,
          entries: args.entries.filter((entry) => entry.catalog === kind).map(entryValues),
        });
        created.push(...result.created);
        existing.push(...result.existing.map((code) => ({ catalog: kind, code })));
        if (result.created.length > 0) {
          lines.push(
            `Created ${result.created.length} ${spec.label} entr${result.created.length === 1 ? "y" : "ies"}: ${result.created.map((row) => row[spec.codeColumn] as string).join(", ")}.`,
          );
        }
        if (result.existing.length > 0) {
          lines.push(
            `Already in the ${spec.label} catalog, left unchanged (add wordings with add_catalog_synonyms): ${result.existing.join(", ")}.`,
          );
        }
      }
      return ok(lines.join("\n"), { created, existing });
    }, WRITE_SCOPE),
  );

  server.registerTool(
    "add_catalog_synonyms",
    {
      title: "Add catalog synonyms",
      description:
        "Add wordings to existing entries' synonyms, up to 50 entries in one call, and see exactly what changed. Nothing already there is removed. A wording another entry already answers to is refused and named, because the server would otherwise have to choose between them when it codes a document; fix the entry that should not have it with upsert_catalog_entry.",
      inputSchema: z.object({
        catalog: z
          .enum(["observation", "finding_type", "body_site"])
          .describe("Which catalog; measurement types have no synonyms."),
        items: z
          .array(
            z.object({
              code: z
                .string()
                .min(1)
                .describe("The entry's code (obs_code, finding_code or site_code)."),
              synonyms_ru: z.array(z.string().min(1)).optional(),
              synonyms_en: z.array(z.string().min(1)).optional(),
            }),
          )
          .min(1)
          .max(50),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withUserClient<{
      catalog: CatalogKind;
      items: Array<{ code: string; synonyms_ru?: string[]; synonyms_en?: string[] }>;
    }>(async (supabase, args) => {
      const changes = await addCatalogSynonyms(supabase, { kind: args.catalog, items: args.items });
      const lines = changes.map((change) => {
        if (change.missing) return `- ${change.code}: no such entry; nothing added.`;
        const parts = [
          change.added.length > 0 ? `added ${change.added.join(", ")}` : "nothing added",
          ...(change.already_present.length > 0
            ? [`already there: ${change.already_present.join(", ")}`]
            : []),
          ...(change.refused.length > 0
            ? [
                `refused: ${change.refused.map((item) => `${item.synonym} (belongs to ${item.owner})`).join(", ")}`,
              ]
            : []),
        ];
        return `- ${change.code}: ${parts.join("; ")}.`;
      });
      return ok(
        [`Synonyms in the ${getCatalogSpec(args.catalog).label} catalog:`, ...lines].join("\n"),
        {
          catalog: args.catalog,
          changes,
        },
      );
    }, WRITE_SCOPE),
  );
}
