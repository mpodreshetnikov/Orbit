import { z } from "zod";

/** Building blocks shared by the tool input schemas. */

export const uuidSchema = z.string().uuid();

/**
 * Every person-scoped tool accepts either an id or a name. Both are optional:
 * with a single person on the account, neither is needed. See resolve-person.ts.
 */
export const personSelectorSchema = {
  person_id: uuidSchema.optional().describe("Exact person id. Use this when you already know it."),
  person_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Person's name, matched case-insensitively. Ignored when person_id is given. If the account tracks only one person, both may be omitted.",
    ),
};

export const paginationSchema = {
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum rows to return (1-100)."),
  offset: z.number().int().min(0).default(0).describe("Rows to skip, for paging."),
};

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD");

export const isoDateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Expected an ISO 8601 timestamp");

export const dateRangeSchema = {
  from: isoDateSchema
    .optional()
    .describe("Only include entries on or after this date (YYYY-MM-DD)."),
  to: isoDateSchema
    .optional()
    .describe("Only include entries on or before this date (YYYY-MM-DD)."),
};
