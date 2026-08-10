import { z } from "zod";
import {
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
        "Create a new reference catalog entry, or update an existing one. Pass `id` to update a specific row; otherwise the entry is matched on its code and created if absent. Each catalog takes a different field set.",
      inputSchema: z.object({
        id: uuidSchema
          .optional()
          .describe("Update this exact row. Omit to create-or-update by code."),
        entry: z.discriminatedUnion("catalog", [
          z.object({
            catalog: z.literal("observation"),
            obs_code: z.string().min(1).describe("Unique analyte code."),
            name_en: z.string().min(1),
            name_ru: z.string().min(1),
            canonical_unit: z.string().min(1).describe("Unit values are normalized to."),
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
        ]),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withUserClient<{ id?: string; entry: Record<string, unknown> & { catalog: CatalogKind } }>(
      async (supabase, args) => {
        const { catalog, ...values } = args.entry;

        const saved = await upsertCatalogEntry(supabase, {
          kind: catalog,
          id: args.id,
          values,
        });

        const spec = getCatalogSpec(catalog);
        return ok(
          `Saved ${spec.label} entry ${saved[spec.codeColumn] as string} (${saved.name_en as string}).`,
          { catalog, entry: saved },
        );
      },
      WRITE_SCOPE,
    ),
  );
}
