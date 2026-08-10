import { z } from "zod";
import {
  addMeasurement,
  getMeasurementCatalogEntryByCode,
  listMeasurements,
} from "../health/measurements";
import { dateRangeSchema, isoDateTimeSchema, personSelectorSchema } from "../schemas/common";
import { withPerson } from "../tool-context";
import { fail, ok, summarizeList } from "../tool-result";
import { WRITE_SCOPE } from "./scopes";
import type { McpToolServer } from "./types";

/**
 * Body measurements: weight, height, circumferences, body fat and so on.
 *
 * Distinct from observations, which are lab values pulled out of documents.
 * The descriptions say so explicitly, because the two are easy to conflate.
 */
export function registerMeasurementTools(server: McpToolServer): void {
  server.registerTool(
    "list_measurements",
    {
      title: "List measurements",
      description:
        "List a person's manually recorded body measurements (weight, height, circumferences, body fat, BMI), with the latest value and trend for each type. For lab results from medical documents use search_observations instead.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...dateRangeSchema,
        codes: z
          .array(z.string())
          .optional()
          .describe('Restrict to specific catalog codes, e.g. ["weight", "waist"].'),
        search: z.string().optional().describe("Filter by measurement name or code."),
        history_limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(10)
          .describe("Most recent points to include per measurement type."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args) => {
      const summaries = await listMeasurements(supabase, {
        personId: person.id,
        codes: args.codes,
        from: args.from,
        to: args.to,
        search: args.search,
        historyLimit: args.history_limit,
      });

      return ok(
        summarizeList(
          `measurement types for ${person.name}`,
          summaries.map(
            (summary) =>
              `${summary.name_en} (${summary.code}): ${summary.latest_value} ${summary.unit_en}` +
              ` on ${summary.latest_measured_at.slice(0, 10)}` +
              (summary.trend ? ` [${summary.trend}]` : "") +
              ` — ${summary.measurement_count} record(s)`,
          ),
          summaries.length,
        ),
        { person, measurements: summaries },
      );
    }),
  );

  server.registerTool(
    "get_measurement_history",
    {
      title: "Get measurement history",
      description:
        "Get the full time series for one body measurement type, oldest first, for answering questions about change over time.",
      inputSchema: z.object({
        ...personSelectorSchema,
        code: z.string().describe('Catalog code, e.g. "weight" or "waist".'),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args) => {
      const summaries = await listMeasurements(supabase, {
        personId: person.id,
        codes: [args.code],
        historyLimit: args.limit,
      });

      const summary = summaries[0];
      if (!summary) {
        return fail(
          `No "${args.code}" measurements recorded for ${person.name}. Use list_measurements to see which types have data, or search_catalog_entries to find the right code.`,
        );
      }

      return ok(
        `${summary.name_en} for ${person.name}: ${summary.measurement_count} record(s), latest ${summary.latest_value} ${summary.unit_en} on ${summary.latest_measured_at.slice(0, 10)}${summary.trend ? ` (${summary.trend})` : ""}.`,
        { person, measurement: summary },
      );
    }),
  );

  server.registerTool(
    "add_measurement",
    {
      title: "Add measurement",
      description:
        "Record a new body measurement value for a person. Identify the measurement type by its catalog code (use search_catalog_entries with catalog='measurement' if unsure). Defaults to now if no timestamp is given.",
      inputSchema: z.object({
        ...personSelectorSchema,
        code: z.string().describe('Catalog code of the measurement type, e.g. "weight".'),
        value: z.number().describe("The measured value, in the type's catalog unit."),
        measured_at: isoDateTimeSchema
          .optional()
          .describe("When it was measured (ISO 8601). Defaults to now."),
        notes: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    withPerson(async (supabase, person, args, auth) => {
      const catalogEntry = await getMeasurementCatalogEntryByCode(supabase, args.code);
      if (!catalogEntry) {
        return fail(
          `No measurement type with code "${args.code}". Use search_catalog_entries with catalog='measurement' to find the right code, or create it with upsert_catalog_entry.`,
        );
      }

      const created = await addMeasurement(supabase, {
        personId: person.id,
        catalogId: catalogEntry.id,
        value: args.value,
        measuredAt: args.measured_at,
        notes: args.notes ?? null,
        createdByUserId: auth.authUserId,
      });

      return ok(
        `Recorded ${created.value} ${catalogEntry.unit_en} for ${catalogEntry.name_en} (${person.name}) at ${created.measured_at}.`,
        { person, measurement: created, catalog: catalogEntry },
      );
    }, WRITE_SCOPE),
  );
}
