import { describe, expect, it, vi } from "vitest";
import {
  materializeConditionProposals,
  ProposalMaterializationError,
} from "./materialize-proposals";
import { AUTHORITATIVE_STATUS_FILTER } from "./unverified-closure";
import type { ConditionRecordWithDetails } from "@/types";

type Row = Record<string, unknown> | null;

/**
 * A Supabase stub narrow enough to be read: it records what was written and answers the two
 * lookups this path makes.
 */
function createSupabaseStub(options: {
  byCode?: Row;
  byName?: Row;
  createdId?: string | null;
  linkError?: string;
}) {
  const inserted: Record<string, unknown>[] = [];
  const updated: Array<{ id: unknown; patch: Record<string, unknown> }> = [];
  const statusUpdates: Array<Record<string, unknown>> = [];
  const lookups: string[] = [];
  const recomputeFilters: string[] = [];

  const client = {
    from(table: string) {
      if (table === "conditions") {
        return {
          select: () => ({
            eq: () => ({
              eq: (column: string, _value: unknown) => {
                lookups.push(`code:${column}`);
                return {
                  is: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: options.byCode ?? null, error: null }),
                    }),
                  }),
                };
              },
              ilike: () => {
                lookups.push("name");
                return {
                  is: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: options.byName ?? null, error: null }),
                    }),
                  }),
                };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              statusUpdates.push(patch);
              return { error: null };
            },
          }),
          insert: (payload: Record<string, unknown>) => {
            inserted.push(payload);
            return {
              select: () => ({
                single: async () => ({
                  data:
                    options.createdId === null ? null : { id: options.createdId ?? "created-1" },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      if (table === "condition_records") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async (_column: string, id: unknown) => {
              updated.push({ id, patch });
              return { error: options.linkError ? { message: options.linkError } : null };
            },
          }),
          // The status recompute reads the condition's most recent authoritative mention.
          select: () => ({
            eq: () => ({
              or: (filter: string) => {
                recomputeFilters.push(filter);
                return {
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { status_in_record: "resolved" },
                        error: null,
                      }),
                    }),
                  }),
                };
              },
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, inserted, updated, statusUpdates, lookups, recomputeFilters };
}

function proposal(overrides: Partial<ConditionRecordWithDetails> = {}): ConditionRecordWithDetails {
  return {
    id: "mention-1",
    condition_id: null,
    record_id: "record-1",
    status_in_record: "active",
    source_anchor: "line",
    confidence: 0.9,
    is_llm_extracted: true,
    is_user_verified: false,
    supporting_obs_code: null,
    review_decision: "pending",
    created_at: "2026-08-31T00:00:00.000Z",
    is_proposal: true,
    condition_name: "Asthma",
    condition_icd_name_en: null,
    condition_icd_name_ru: null,
    condition_code: "J45",
    condition_current_status: "active",
    condition_onset_date: null,
    condition_resolved_date: null,
    condition_notes: null,
    ...overrides,
  };
}

const foundIcd = async (code: string) => ({ code, found: true, name_en: "EN", name_ru: "RU" });

describe("materializeConditionProposals", () => {
  it("creates a condition and points the mention at it", async () => {
    const stub = createSupabaseStub({ createdId: "cond-new" });

    const outcome = await materializeConditionProposals([proposal()], {
      supabase: stub.client,
      personId: "person-1",
      lookupIcd: foundIcd,
    });

    expect(outcome).toEqual({ materialized: 1, skipped: 0 });
    // Provenance the chart could not state before: model-read, person-approved.
    expect(stub.inserted[0]).toMatchObject({
      person_id: "person-1",
      name: "Asthma",
      code: "J45",
      is_llm_extracted: true,
      is_user_verified: true,
    });
    expect(stub.updated[0]).toEqual({
      id: "mention-1",
      patch: {
        condition_id: "cond-new",
        proposed_name: null,
        proposed_icd_code: null,
        is_user_verified: true,
        // Approving the record is the ruling, so the row does not stay `pending` behind it.
        review_decision: "confirmed",
      },
    });
  });

  it("reuses an existing condition rather than adding a second row for it", async () => {
    const stub = createSupabaseStub({ byCode: { id: "cond-existing" } });

    const outcome = await materializeConditionProposals([proposal()], {
      supabase: stub.client,
      personId: "person-1",
      lookupIcd: foundIcd,
    });

    expect(outcome.materialized).toBe(1);
    expect(stub.inserted).toHaveLength(0);
    expect(stub.updated[0].patch.condition_id).toBe("cond-existing");
  });

  it("falls back to matching by name when the code is unknown", async () => {
    const stub = createSupabaseStub({ byName: { id: "cond-by-name" } });

    await materializeConditionProposals([proposal({ condition_code: "NOPE" })], {
      supabase: stub.client,
      personId: "person-1",
      // An unverified code must not be stored, and must not be matched on either.
      lookupIcd: async (code) => ({ code, found: false, name_en: null, name_ru: null }),
    });

    expect(stub.updated[0].patch.condition_id).toBe("cond-by-name");
    expect(stub.inserted).toHaveLength(0);
  });

  it("leaves mentions that are already materialised alone", async () => {
    const stub = createSupabaseStub({ createdId: "cond-new" });

    const outcome = await materializeConditionProposals(
      [proposal({ is_proposal: false, condition_id: "cond-1" })],
      { supabase: stub.client, personId: "person-1", lookupIcd: foundIcd },
    );

    expect(outcome).toEqual({ materialized: 0, skipped: 0 });
    expect(stub.updated).toHaveLength(0);
  });

  it("reports a proposal it could not turn into anything instead of dropping it", async () => {
    const stub = createSupabaseStub({ createdId: null });

    const outcome = await materializeConditionProposals(
      [proposal({ condition_name: "   " }), proposal({ id: "mention-2" })],
      { supabase: stub.client, personId: "person-1", lookupIcd: foundIcd },
    );

    // One had no name to create from, the other's insert came back empty.
    expect(outcome).toEqual({ materialized: 0, skipped: 2 });
    expect(stub.updated).toHaveLength(0);
  });

  it("creates the condition without official names when the catalogue is unreachable", async () => {
    const stub = createSupabaseStub({ createdId: "cond-new" });
    const lookupIcd = vi.fn(async () => null);

    await materializeConditionProposals([proposal()], {
      supabase: stub.client,
      personId: "person-1",
      lookupIcd,
    });

    expect(lookupIcd).toHaveBeenCalledWith("J45");
    // An unverified code is not written to the chart as if it were checked.
    expect(stub.inserted[0]).toMatchObject({ code: null, icd_name_en: null });
  });

  it("brings the reused condition's status in line with the approved mention", async () => {
    const stub = createSupabaseStub({ byCode: { id: "cond-existing" } });

    await materializeConditionProposals([proposal({ status_in_record: "resolved" })], {
      supabase: stub.client,
      personId: "person-1",
      lookupIcd: foundIcd,
    });

    // Nothing in the database recomputes this; without it an approved "resolved" proposal leaves
    // the chart still showing the condition as active.
    expect(stub.statusUpdates).toEqual([{ current_status: "resolved" }]);
  });

  it("throws when the link is refused rather than reporting it as materialised", async () => {
    const stub = createSupabaseStub({
      createdId: "cond-new",
      linkError: "duplicate key value violates unique constraint",
    });

    await expect(
      materializeConditionProposals([proposal()], {
        supabase: stub.client,
        personId: "person-1",
        lookupIcd: foundIcd,
      }),
    ).rejects.toBeInstanceOf(ProposalMaterializationError);
  });

  it("recomputes through the closure guard, after marking the approved mention verified", async () => {
    // The order is the whole argument for guarding this path: materialisation sets
    // is_user_verified on the row it is approving *before* recomputing, so that row passes the
    // filter on its own merit. What the filter keeps out is an unverified machine closure sitting
    // in some other draft with a newer date, which would otherwise be read as the newest word and
    // take the condition off the active chart on an approval that never mentioned it.
    const stub = createSupabaseStub({ byCode: { id: "cond-existing" } });

    await materializeConditionProposals([proposal({ status_in_record: "active" })], {
      supabase: stub.client,
      personId: "person-1",
      lookupIcd: foundIcd,
    });

    expect(stub.updated[0].patch).toMatchObject({ is_user_verified: true });
    expect(stub.recomputeFilters).toEqual([AUTHORITATIVE_STATUS_FILTER]);
  });
});
