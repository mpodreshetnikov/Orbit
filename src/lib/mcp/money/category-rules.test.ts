import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRuleDraft,
  buildApplyRulesDraft,
  buildCreateRuleDraft,
  buildDeleteRuleDraft,
  buildUpdateRuleDraft,
  invalidRegexFilterMessage,
  listMoneyCategoryRules,
  ruleDraftSummaryText,
} from "./category-rules";

const PERSON = { id: "p-1", name: "Максим" };
const RULE_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";
const TX_ID = "33333333-3333-4333-8333-333333333333";
const CAT_ID = "44444444-4444-4444-8444-444444444444";

function ruleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    person_id: PERSON.id,
    name: "Coffee shops",
    description: null,
    enabled: true,
    sort_order: 1,
    rule_kind: "direct",
    target_category_id: CAT_ID,
    match_mode: "all",
    scope_filter: "all_line_items",
    filters: [{ field: "merchant_name", operator: "contains", value: "COFFEE" }],
    config: {},
    stop_processing: false,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

type TableResult = { data: unknown; error: { message: string } | null; count?: number | null };

function mockClient(handlers: {
  from?: (table: string) => unknown;
  rpc?: (name: string, args: Record<string, unknown>) => Promise<TableResult>;
}) {
  return {
    from: handlers.from ?? vi.fn(),
    rpc: handlers.rpc ?? vi.fn(),
  } as never;
}

describe("listMoneyCategoryRules", () => {
  it("maps rows via rowToMoneyCategoryRule", async () => {
    const orderCreated = vi.fn().mockResolvedValue({ data: [ruleRow()], error: null });
    const orderSort = vi.fn(() => ({ order: orderCreated }));
    const eq = vi.fn(() => ({ order: orderSort }));
    const select = vi.fn(() => ({ eq }));
    const supabase = mockClient({
      from: vi.fn(() => ({ select })),
    });

    const rules = await listMoneyCategoryRules(supabase, PERSON.id);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: RULE_ID, name: "Coffee shops", rule_kind: "direct" });
    expect(eq).toHaveBeenCalledWith("person_id", PERSON.id);
  });
});

describe("rule CRUD drafts", () => {
  it("buildCreateRuleDraft defaults sort_order and summarizes", async () => {
    const orderCreated = vi.fn().mockResolvedValue({ data: [ruleRow()], error: null });
    const orderSort = vi.fn(() => ({ order: orderCreated }));
    const eqPerson = vi.fn(() => ({ order: orderSort }));
    const selectRules = vi.fn(() => ({ eq: eqPerson }));
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { name_ru: "Еда", name_en: "Food", slug: "food" },
      error: null,
    });
    const eqCat = vi.fn(() => ({ maybeSingle }));
    const selectCat = vi.fn(() => ({ eq: eqCat }));
    const from = vi.fn((table: string) => {
      if (table === "money_category_rules") return { select: selectRules };
      if (table === "money_categories") return { select: selectCat };
      throw new Error(table);
    });

    const built = await buildCreateRuleDraft(mockClient({ from }), PERSON, {
      name: " Groceries ",
      rule_kind: "direct",
      target_category_id: CAT_ID,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.mode).toBe("rule_create");
    expect(built.draft.input).toMatchObject({ name: "Groceries", sort_order: 2 });
    expect(built.draft.summary_lines.join("\n")).toContain("Еда");
  });

  it("refuses direct create without target_category_id", async () => {
    const built = await buildCreateRuleDraft(mockClient({}), PERSON, {
      name: "X",
      rule_kind: "direct",
    });
    expect(built.ok).toBe(false);
  });

  it("refuses source_category_map (not in DB money_rule_kind)", async () => {
    const built = await buildCreateRuleDraft(mockClient({}), PERSON, {
      name: "Mapped",
      // @ts-expect-error intentional unsupported kind
      rule_kind: "source_category_map",
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/unsupported rule_kind|Unknown or unsupported/i);
  });

  it("rejects invalid regex filters on create (same as ruleFormProblem)", async () => {
    expect(
      invalidRegexFilterMessage([
        { field: "merchant_name", operator: "regex", value: "(unclosed" },
      ]),
    ).toMatch(/Invalid regex/i);

    const built = await buildCreateRuleDraft(mockClient({}), PERSON, {
      name: "Broken",
      rule_kind: "mcc_map",
      filters: [{ field: "merchant_name", operator: "regex", value: "(unclosed" }],
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/Invalid regex/i);
  });

  it("rejects invalid regex filters on update/confirm path", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: ruleRow(), error: null });
    const eqPerson = vi.fn(() => ({ maybeSingle }));
    const eqId = vi.fn(() => ({ eq: eqPerson }));
    const select = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn(() => ({ select }));

    const built = await buildUpdateRuleDraft(mockClient({ from }), PERSON, {
      rule_id: RULE_ID,
      filters: [{ field: "title", operator: "regex", value: "[a-" }],
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/Invalid regex/i);

    const confirmed = await applyRuleDraft(mockClient({ from }), PERSON, "rule_update", {
      rule_id: RULE_ID,
      filters: [{ field: "title", operator: "regex", value: "[a-" }],
    });
    expect(confirmed.ok).toBe(false);
    if (confirmed.ok) return;
    expect(confirmed.error).toMatch(/Invalid regex/i);
  });

  it("summarizes filter predicates and config on create", async () => {
    const orderCreated = vi.fn().mockResolvedValue({ data: [], error: null });
    const orderSort = vi.fn(() => ({ order: orderCreated }));
    const eqPerson = vi.fn(() => ({ order: orderSort }));
    const selectRules = vi.fn(() => ({ eq: eqPerson }));
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { name_ru: "Еда", name_en: "Food", slug: "food" },
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "money_category_rules") return { select: selectRules };
      if (table === "money_categories") {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) };
      }
      throw new Error(table);
    });

    const built = await buildCreateRuleDraft(mockClient({ from }), PERSON, {
      name: "Coffee",
      rule_kind: "direct",
      target_category_id: CAT_ID,
      filters: [{ field: "merchant_name", operator: "contains", value: "COFFEE" }],
      config: { note: "seed" },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const text = built.draft.summary_lines.join("\n");
    expect(text).toContain("merchant_name contains");
    expect(text).toContain("COFFEE");
    expect(text).toContain("config.note: seed");
  });

  it("buildUpdateRuleDraft / delete require ownership", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqPerson = vi.fn(() => ({ maybeSingle }));
    const eqId = vi.fn(() => ({ eq: eqPerson }));
    const select = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn(() => ({ select }));

    const update = await buildUpdateRuleDraft(mockClient({ from }), PERSON, {
      rule_id: RULE_ID,
      name: "Nope",
    });
    expect(update.ok).toBe(false);

    const del = await buildDeleteRuleDraft(mockClient({ from }), PERSON, { rule_id: RULE_ID });
    expect(del.ok).toBe(false);
  });

  it("applyRuleDraft inserts on rule_create after revalidation", async () => {
    const orderCreated = vi.fn().mockResolvedValue({ data: [], error: null });
    const orderSort = vi.fn(() => ({ order: orderCreated }));
    const eqPerson = vi.fn(() => ({ order: orderSort }));
    const selectList = vi.fn(() => ({ eq: eqPerson }));
    const single = vi.fn().mockResolvedValue({
      data: { id: RULE_ID, name: "Coffee shops" },
      error: null,
    });
    const selectInsert = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select: selectInsert }));
    const from = vi.fn((table: string) => {
      if (table !== "money_category_rules") throw new Error(table);
      return { select: selectList, insert };
    });

    const applied = await applyRuleDraft(mockClient({ from }), PERSON, "rule_create", {
      name: "Coffee shops",
      rule_kind: "mcc_map",
      sort_order: 1,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.label).toBe("Coffee shops");
    expect(insert).toHaveBeenCalled();
  });

  it("applyRuleDraft updates and deletes", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: ruleRow(), error: null });
    const eqPerson = vi.fn(() => ({ maybeSingle }));
    const eqId = vi.fn(() => ({ eq: eqPerson }));
    const select = vi.fn(() => ({ eq: eqId }));
    const updateSingle = vi.fn().mockResolvedValue({
      data: { id: RULE_ID, name: "Renamed shops" },
      error: null,
    });
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({ single: updateSingle })),
        })),
      })),
    }));
    const del = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    }));
    const from = vi.fn((table: string) => {
      if (table !== "money_category_rules") throw new Error(table);
      return { select, update, delete: del };
    });

    const updated = await applyRuleDraft(mockClient({ from }), PERSON, "rule_update", {
      rule_id: RULE_ID,
      name: "Renamed shops",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.label).toBe("Renamed shops");
    expect(update).toHaveBeenCalled();

    const deleted = await applyRuleDraft(mockClient({ from }), PERSON, "rule_delete", {
      rule_id: RULE_ID,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.label).toBe("Coffee shops");
    expect(del).toHaveBeenCalled();
  });

  it("applyRuleDraft surfaces insert/update/delete errors", async () => {
    const orderCreated = vi.fn().mockResolvedValue({ data: [], error: null });
    const orderSort = vi.fn(() => ({ order: orderCreated }));
    const eqPersonList = vi.fn(() => ({ order: orderSort }));
    const selectList = vi.fn(() => ({ eq: eqPersonList }));
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: null, error: { message: "insert failed" } }),
      })),
    }));

    const maybeSingle = vi.fn().mockResolvedValue({ data: ruleRow(), error: null });
    const eqPerson = vi.fn(() => ({ maybeSingle }));
    const eqId = vi.fn(() => ({ eq: eqPerson }));
    const selectOwned = vi.fn(() => ({ eq: eqId }));
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "update failed" },
            }),
          })),
        })),
      })),
    }));
    const del = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: { message: "delete failed" } }),
      })),
    }));

    const createFail = await applyRuleDraft(
      mockClient({
        from: vi.fn((table: string) => {
          if (table !== "money_category_rules") throw new Error(table);
          return { select: selectList, insert };
        }),
      }),
      PERSON,
      "rule_create",
      { name: "X", rule_kind: "mcc_map", sort_order: 1 },
    );
    expect(createFail.ok).toBe(false);
    if (createFail.ok) return;
    expect(createFail.error).toMatch(/insert failed/);

    const updateFail = await applyRuleDraft(
      mockClient({
        from: vi.fn((table: string) => {
          if (table !== "money_category_rules") throw new Error(table);
          return { select: selectOwned, update };
        }),
      }),
      PERSON,
      "rule_update",
      { rule_id: RULE_ID, name: "Nope" },
    );
    expect(updateFail.ok).toBe(false);
    if (updateFail.ok) return;
    expect(updateFail.error).toMatch(/update failed/);

    const deleteFail = await applyRuleDraft(
      mockClient({
        from: vi.fn((table: string) => {
          if (table !== "money_category_rules") throw new Error(table);
          return { select: selectOwned, delete: del };
        }),
      }),
      PERSON,
      "rule_delete",
      { rule_id: RULE_ID },
    );
    expect(deleteFail.ok).toBe(false);
    if (deleteFail.ok) return;
    expect(deleteFail.error).toMatch(/delete failed/);
  });

  it("summarizes values/min-max/null filter predicates on update", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: ruleRow({
        filters: [{ field: "merchant_name", operator: "contains", value: "OLD" }],
      }),
      error: null,
    });
    const eqPerson = vi.fn(() => ({ maybeSingle }));
    const eqId = vi.fn(() => ({ eq: eqPerson }));
    const select = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn(() => ({ select }));

    const invalidMode = await buildUpdateRuleDraft(mockClient({ from }), PERSON, {
      rule_id: RULE_ID,
      // @ts-expect-error intentional invalid
      match_mode: "sometimes",
    });
    expect(invalidMode.ok).toBe(false);
    if (invalidMode.ok) return;
    expect(invalidMode.error).toMatch(/Invalid match_mode/);

    const invalidScope = await buildUpdateRuleDraft(mockClient({ from }), PERSON, {
      rule_id: RULE_ID,
      // @ts-expect-error intentional invalid
      scope_filter: "nope",
    });
    expect(invalidScope.ok).toBe(false);
    if (invalidScope.ok) return;
    expect(invalidScope.error).toMatch(/Invalid scope_filter/);

    const built = await buildUpdateRuleDraft(mockClient({ from }), PERSON, {
      rule_id: RULE_ID,
      rule_kind: "llm_categorization",
      target_category_id: null,
      filters: [
        { field: "mcc", operator: "in_set", values: ["5411", "5814"] },
        { field: "amount", operator: "range", min: 10, max: 100 },
        { field: "title", operator: "is_empty", value: null },
        { field: "merchant_name", operator: "contains", value: "COFFEE" },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const text = built.draft.summary_lines.join("\n");
    expect(text).toContain("mcc in_set [5411, 5814]");
    expect(text).toContain("amount range 10…100");
    expect(text).toMatch(/title is_empty(?!\s)/);
    expect(text).toContain("merchant_name contains");
    expect(text).toContain("LLM-правило");
  });
});

describe("rule apply preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires exactly one target shape", async () => {
    const built = await buildApplyRulesDraft(mockClient({}), PERSON, {});
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/exactly one/i);
  });

  it("paginates date-range scope past PostgREST max_rows so total matches apply", async () => {
    const pageSize = 1000;
    const txPage1 = Array.from({ length: pageSize }, (_, i) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
    }));
    const txPage2 = Array.from({ length: 50 }, (_, i) => ({
      id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, "0")}`,
    }));
    let txRangeCalls = 0;
    const txRanges: Array<{ from: number; to: number }> = [];

    const llmCount = vi.fn().mockResolvedValue({ count: 0, error: null });
    const from = vi.fn((table: string) => {
      if (table === "money_transactions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              gte: vi.fn(() => ({
                lt: vi.fn(() => ({
                  order: vi.fn(() => ({
                    range: vi.fn(async (fromIdx: number, toIdx: number) => {
                      txRangeCalls += 1;
                      txRanges.push({ from: fromIdx, to: toIdx });
                      if (fromIdx === 0) return { data: txPage1, error: null };
                      if (fromIdx === pageSize) return { data: txPage2, error: null };
                      return { data: [], error: null };
                    }),
                  })),
                })),
              })),
            })),
          })),
        };
      }
      if (table === "money_line_items") {
        return {
          select: vi.fn(() => ({
            in: vi.fn((_col: string, chunk: string[]) => ({
              order: vi.fn(() => ({
                range: vi.fn(async (fromIdx: number, toIdx: number) => {
                  if (fromIdx > 0) return { data: [], error: null };
                  // One line per tx in this chunk page.
                  const data = chunk
                    .slice(0, Math.min(chunk.length, toIdx - fromIdx + 1))
                    .map((txId) => ({ id: txId.replace(/^./, "c") }));
                  return { data, error: null };
                }),
              })),
            })),
          })),
        };
      }
      if (table === "money_category_rules") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: llmCount,
                in: llmCount,
              })),
            })),
          })),
        };
      }
      if (table === "money_categories") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { name_ru: "Еда", name_en: "Food", slug: "food" },
                error: null,
              }),
            })),
          })),
        };
      }
      throw new Error(table);
    });

    const rpc = vi
      .fn()
      .mockImplementation(async (_name: string, args: Record<string, unknown>) => ({
        data: {
          line_item_id: args.p_line_item_id,
          line_item_title: "x",
          merchant_name: null,
          starting_category_id: null,
          final_category_id: CAT_ID,
        },
        error: null,
      }));

    const built = await buildApplyRulesDraft(mockClient({ from, rpc }), PERSON, {
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(txRangeCalls).toBeGreaterThanOrEqual(2);
    expect(txRanges[0]).toEqual({ from: 0, to: 999 });
    expect(built.draft.summary_lines.join("\n")).toMatch(/1050 line item/);
    expect(built.draft.summary_lines.join("\n")).toMatch(/превью: 40 строк/);
    expect(built.draft.summary_lines.join("\n")).toMatch(/из 1050/);
  });

  it("rejects rule_ids so preview cannot subset what apply cannot (P1)", async () => {
    const built = await buildApplyRulesDraft(mockClient({}), PERSON, {
      line_item_ids: [LINE_ID],
      rule_ids: [RULE_ID],
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/rule_ids is not supported/i);
    expect(built.error).toMatch(/p_rule_ids=NULL|all enabled/i);
  });

  it("rejects force_overwrite_locked=true because preview hardcodes force=false (P2)", async () => {
    const built = await buildApplyRulesDraft(mockClient({}), PERSON, {
      line_item_ids: [LINE_ID],
      force_overwrite_locked: true,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/force_overwrite_locked=true is not supported/i);
  });

  it("confirm apply also rejects rule_ids (preview/confirm parity)", async () => {
    const applied = await applyRuleDraft(mockClient({}), PERSON, "rule_apply", {
      line_item_ids: [LINE_ID],
      rule_ids: [RULE_ID],
    });
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.error).toMatch(/rule_ids is not supported/i);
  });

  it("previews line changes via money_preview_category_rule_pipeline", async () => {
    const lines = vi.fn().mockResolvedValue({
      data: [{ id: LINE_ID, transaction_id: TX_ID }],
      error: null,
    });
    const txs = vi.fn().mockResolvedValue({
      data: [{ id: TX_ID, payer_person_id: PERSON.id }],
      error: null,
    });
    const llmCount = vi.fn().mockResolvedValue({ count: 1, error: null });
    const cat = vi.fn().mockResolvedValue({
      data: { name_ru: "Еда", name_en: "Food", slug: "food" },
      error: null,
    });

    const from = vi.fn((table: string) => {
      if (table === "money_line_items") {
        return {
          select: vi.fn(() => ({
            in: lines,
          })),
        };
      }
      if (table === "money_transactions") {
        return {
          select: vi.fn(() => ({
            in: txs,
          })),
        };
      }
      if (table === "money_category_rules") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: llmCount,
                in: llmCount,
              })),
            })),
          })),
        };
      }
      if (table === "money_categories") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: cat })),
          })),
        };
      }
      throw new Error(table);
    });

    const rpc = vi.fn().mockResolvedValue({
      data: {
        line_item_id: LINE_ID,
        line_item_title: "Латте",
        merchant_name: "COFFEE",
        starting_category_id: null,
        final_category_id: CAT_ID,
      },
      error: null,
    });

    const built = await buildApplyRulesDraft(mockClient({ from, rpc }), PERSON, {
      line_item_ids: [LINE_ID],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.mode).toBe("rule_apply");
    expect(built.draft.summary_lines.join("\n")).toMatch(/изменится: 1/);
    expect(built.draft.summary_lines.join("\n")).toMatch(/Латте/);
    expect(built.draft.summary_lines.join("\n")).toMatch(/LLM/);
    expect(rpc).toHaveBeenCalledWith(
      "money_preview_category_rule_pipeline",
      expect.objectContaining({ p_line_item_id: LINE_ID, p_person_id: PERSON.id }),
    );
  });

  it("confirm apply uses money_apply_category_rule_pipeline for line ids", async () => {
    const lines = vi.fn().mockResolvedValue({
      data: [{ id: LINE_ID, transaction_id: TX_ID }],
      error: null,
    });
    const txs = vi.fn().mockResolvedValue({
      data: [{ id: TX_ID, payer_person_id: PERSON.id }],
      error: null,
    });
    const llmCount = vi.fn().mockResolvedValue({ count: 0, error: null });
    const from = vi.fn((table: string) => {
      if (table === "money_line_items") return { select: vi.fn(() => ({ in: lines })) };
      if (table === "money_transactions") return { select: vi.fn(() => ({ in: txs })) };
      if (table === "money_category_rules") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: llmCount,
                in: llmCount,
              })),
            })),
          })),
        };
      }
      throw new Error(table);
    });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          line_item_id: LINE_ID,
          starting_category_id: CAT_ID,
          final_category_id: CAT_ID,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { runs: [{}] }, error: null });

    const applied = await applyRuleDraft(mockClient({ from, rpc }), PERSON, "rule_apply", {
      line_item_ids: [LINE_ID],
    });
    expect(applied.ok).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith(
      "money_apply_category_rule_pipeline",
      expect.objectContaining({
        p_line_item_ids: [LINE_ID],
        p_person_id: PERSON.id,
      }),
    );
  });

  it("refuses missing line_item_ids", async () => {
    const lines = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "money_line_items") return { select: vi.fn(() => ({ in: lines })) };
      throw new Error(table);
    });

    const built = await buildApplyRulesDraft(mockClient({ from }), PERSON, {
      line_item_ids: [LINE_ID],
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/missing/i);
  });

  it("refuses line_item_ids for another person", async () => {
    const lines = vi.fn().mockResolvedValue({
      data: [{ id: LINE_ID, transaction_id: TX_ID }],
      error: null,
    });
    const txs = vi.fn().mockResolvedValue({
      data: [{ id: TX_ID, payer_person_id: "other-person" }],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "money_line_items") return { select: vi.fn(() => ({ in: lines })) };
      if (table === "money_transactions") return { select: vi.fn(() => ({ in: txs })) };
      throw new Error(table);
    });

    const built = await buildApplyRulesDraft(mockClient({ from }), PERSON, {
      line_item_ids: [LINE_ID],
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/another person/i);
  });

  it("surfaces line/tx query errors", async () => {
    const lineErr = await buildApplyRulesDraft(
      mockClient({
        from: vi.fn((table: string) => {
          if (table === "money_line_items") {
            return {
              select: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({ data: null, error: { message: "line boom" } }),
              })),
            };
          }
          throw new Error(table);
        }),
      }),
      PERSON,
      { line_item_ids: [LINE_ID] },
    );
    expect(lineErr.ok).toBe(false);
    if (lineErr.ok) return;
    expect(lineErr.error).toMatch(/line boom/);

    const txErr = await buildApplyRulesDraft(
      mockClient({
        from: vi.fn((table: string) => {
          if (table === "money_line_items") {
            return {
              select: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: LINE_ID, transaction_id: TX_ID }],
                  error: null,
                }),
              })),
            };
          }
          if (table === "money_transactions") {
            return {
              select: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({ data: null, error: { message: "tx boom" } }),
              })),
            };
          }
          throw new Error(table);
        }),
      }),
      PERSON,
      { line_item_ids: [LINE_ID] },
    );
    expect(txErr.ok).toBe(false);
    if (txErr.ok) return;
    expect(txErr.error).toMatch(/tx boom/);
  });

  it("resolves scope from transaction_id including merchant label", async () => {
    const llmCount = vi.fn().mockResolvedValue({ count: 0, error: null });
    const cat = vi.fn().mockResolvedValue({
      data: { name_ru: "Еда", name_en: "Food", slug: "food" },
      error: null,
    });
    const txMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: TX_ID, payer_person_id: PERSON.id, merchant_name: "COFFEE HOUSE" },
      error: null,
    });
    const lineRange = vi.fn().mockResolvedValue({
      data: [{ id: LINE_ID }],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "money_transactions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: txMaybeSingle })),
          })),
        };
      }
      if (table === "money_line_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({ range: lineRange })),
            })),
          })),
        };
      }
      if (table === "money_category_rules") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: llmCount,
                in: llmCount,
              })),
            })),
          })),
        };
      }
      if (table === "money_categories") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: cat })),
          })),
        };
      }
      throw new Error(table);
    });
    const rpc = vi.fn().mockResolvedValue({
      data: {
        line_item_id: LINE_ID,
        line_item_title: "Латте",
        merchant_name: "COFFEE HOUSE",
        starting_category_id: null,
        final_category_id: CAT_ID,
      },
      error: null,
    });

    const built = await buildApplyRulesDraft(mockClient({ from, rpc }), PERSON, {
      transaction_id: TX_ID,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.summary_lines.join("\n")).toMatch(/COFFEE HOUSE/);
    expect("transaction_id" in built.draft.input && built.draft.input.transaction_id).toBe(TX_ID);

    const missing = await buildApplyRulesDraft(
      mockClient({
        from: vi.fn((table: string) => {
          if (table === "money_transactions") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            };
          }
          throw new Error(table);
        }),
      }),
      PERSON,
      { transaction_id: TX_ID },
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error).toMatch(/No transaction/);

    const foreign = await buildApplyRulesDraft(
      mockClient({
        from: vi.fn((table: string) => {
          if (table === "money_transactions") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: TX_ID, payer_person_id: "other", merchant_name: null },
                    error: null,
                  }),
                })),
              })),
            };
          }
          throw new Error(table);
        }),
      }),
      PERSON,
      { transaction_id: TX_ID },
    );
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error).toMatch(/different person/);

    const emptyLines = await buildApplyRulesDraft(
      mockClient({
        from: vi.fn((table: string) => {
          if (table === "money_transactions") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: TX_ID, payer_person_id: PERSON.id, merchant_name: null },
                    error: null,
                  }),
                })),
              })),
            };
          }
          if (table === "money_line_items") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    range: vi.fn().mockResolvedValue({ data: [], error: null }),
                  })),
                })),
              })),
            };
          }
          throw new Error(table);
        }),
      }),
      PERSON,
      { transaction_id: TX_ID },
    );
    expect(emptyLines.ok).toBe(false);
    if (emptyLines.ok) return;
    expect(emptyLines.error).toMatch(/no line items/i);
  });

  it("rejects malformed or inverted from/to dates", async () => {
    const bad = await buildApplyRulesDraft(mockClient({}), PERSON, {
      from: "01-01-2026",
      to: "2026-01-31",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toMatch(/YYYY-MM-DD/);

    const inverted = await buildApplyRulesDraft(mockClient({}), PERSON, {
      from: "2026-02-01",
      to: "2026-01-01",
    });
    expect(inverted.ok).toBe(false);
    if (inverted.ok) return;
    expect(inverted.error).toMatch(/on or before/);
  });

  it("confirm apply uses transaction RPC", async () => {
    const llmCount = vi.fn().mockResolvedValue({ count: 0, error: null });
    const txMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: TX_ID, payer_person_id: PERSON.id, merchant_name: "Shop" },
      error: null,
    });
    const lineRange = vi.fn().mockResolvedValue({
      data: [{ id: LINE_ID }],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "money_transactions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: txMaybeSingle })),
          })),
        };
      }
      if (table === "money_line_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({ range: lineRange })),
            })),
          })),
        };
      }
      if (table === "money_category_rules") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: llmCount,
                in: llmCount,
              })),
            })),
          })),
        };
      }
      if (table === "money_categories") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { name_ru: "Еда", name_en: "Food", slug: "food" },
                error: null,
              }),
            })),
          })),
        };
      }
      throw new Error(table);
    });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          line_item_id: LINE_ID,
          starting_category_id: null,
          final_category_id: CAT_ID,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { runs: [{}, {}] }, error: null });

    const applied = await applyRuleDraft(mockClient({ from, rpc }), PERSON, "rule_apply", {
      transaction_id: TX_ID,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.label).toMatch(/2 run/);
    expect(rpc).toHaveBeenLastCalledWith(
      "money_apply_category_rule_pipeline_for_transaction",
      expect.objectContaining({
        p_transaction_id: TX_ID,
        p_person_id: PERSON.id,
        p_force_overwrite_locked: false,
      }),
    );
  });

  it("confirm apply uses date-range RPC and surfaces apply RPC errors", async () => {
    const llmCount = vi.fn().mockResolvedValue({ count: 1, error: null });
    const txRange = vi.fn().mockResolvedValue({
      data: [{ id: TX_ID }],
      error: null,
    });
    const lineRange = vi.fn().mockResolvedValue({
      data: [{ id: LINE_ID }],
      error: null,
    });
    const cat = vi.fn().mockResolvedValue({
      data: { name_ru: null, name_en: null, slug: "food" },
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "money_transactions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              gte: vi.fn(() => ({
                lt: vi.fn(() => ({
                  order: vi.fn(() => ({ range: txRange })),
                })),
              })),
            })),
          })),
        };
      }
      if (table === "money_line_items") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              order: vi.fn(() => ({ range: lineRange })),
            })),
          })),
        };
      }
      if (table === "money_category_rules") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: llmCount,
                in: llmCount,
              })),
            })),
          })),
        };
      }
      if (table === "money_categories") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: cat })),
          })),
        };
      }
      throw new Error(table);
    });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          line_item_id: LINE_ID,
          line_item_title: null,
          merchant_name: null,
          starting_category_id: CAT_ID,
          final_category_id: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { runs: null }, error: null });

    const applied = await applyRuleDraft(mockClient({ from, rpc }), PERSON, "rule_apply", {
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.label).toMatch(/0 run/);
    expect(rpc).toHaveBeenLastCalledWith(
      "money_apply_category_rule_pipeline_for_date_range",
      expect.objectContaining({
        p_person_id: PERSON.id,
        p_from: "2026-01-01",
        p_to: "2026-01-31",
      }),
    );

    const preview = await buildApplyRulesDraft(
      mockClient({
        from,
        rpc: vi.fn().mockResolvedValue({
          data: {
            line_item_id: LINE_ID,
            line_item_title: null,
            merchant_name: null,
            starting_category_id: CAT_ID,
            final_category_id: null,
          },
          error: null,
        }),
      }),
      PERSON,
      { from: "2026-01-01", to: "2026-01-31" },
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.draft.summary_lines.join("\n")).toMatch(/LLM-правил/);
    expect(preview.draft.summary_lines.join("\n")).toMatch(/food|без категории/);

    const rangeFail = await applyRuleDraft(
      mockClient({
        from,
        rpc: vi
          .fn()
          .mockResolvedValueOnce({
            data: {
              line_item_id: LINE_ID,
              starting_category_id: CAT_ID,
              final_category_id: null,
            },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: { message: "range apply boom" } }),
      }),
      PERSON,
      "rule_apply",
      { from: "2026-01-01", to: "2026-01-31" },
    );
    expect(rangeFail.ok).toBe(false);
    if (rangeFail.ok) return;
    expect(rangeFail.error).toMatch(/range apply boom/);

    const lineFail = await applyRuleDraft(
      mockClient({
        from: vi.fn((table: string) => {
          if (table === "money_line_items") {
            return {
              select: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: LINE_ID, transaction_id: TX_ID }],
                  error: null,
                }),
              })),
            };
          }
          if (table === "money_transactions") {
            return {
              select: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: TX_ID, payer_person_id: PERSON.id }],
                  error: null,
                }),
              })),
            };
          }
          if (table === "money_category_rules") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
                  })),
                })),
              })),
            };
          }
          throw new Error(table);
        }),
        rpc: vi
          .fn()
          .mockResolvedValueOnce({
            data: {
              line_item_id: LINE_ID,
              starting_category_id: CAT_ID,
              final_category_id: CAT_ID,
            },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: { message: "line apply boom" } }),
      }),
      PERSON,
      "rule_apply",
      { line_item_ids: [LINE_ID] },
    );
    expect(lineFail.ok).toBe(false);
    if (lineFail.ok) return;
    expect(lineFail.error).toMatch(/line apply boom/);
  });

  it("surfaces empty date-range scope and transaction load errors", async () => {
    const empty = await buildApplyRulesDraft(
      mockClient({
        from: vi.fn((table: string) => {
          if (table === "money_transactions") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    lt: vi.fn(() => ({
                      order: vi.fn(() => ({
                        range: vi.fn().mockResolvedValue({ data: [], error: null }),
                      })),
                    })),
                  })),
                })),
              })),
            };
          }
          if (table === "money_category_rules") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
                  })),
                })),
              })),
            };
          }
          throw new Error(table);
        }),
        rpc: vi.fn(),
      }),
      PERSON,
      { from: "2026-01-01", to: "2026-01-31" },
    );
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.draft.summary_lines.join("\n")).toMatch(/0 line item/);
    expect(empty.draft.summary_lines.join("\n")).toMatch(/нет строк/);

    const txErr = await buildApplyRulesDraft(
      mockClient({
        from: vi.fn((table: string) => {
          if (table === "money_transactions") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: "tx load boom" },
                  }),
                })),
              })),
            };
          }
          throw new Error(table);
        }),
      }),
      PERSON,
      { transaction_id: TX_ID },
    );
    expect(txErr.ok).toBe(false);
    if (txErr.ok) return;
    expect(txErr.error).toMatch(/tx load boom/);
  });
});

describe("rule create validation and summary text", () => {
  it("rejects empty name / invalid match_mode / scope and summarizes disabled filters", async () => {
    const emptyName = await buildCreateRuleDraft(mockClient({}), PERSON, {
      name: "   ",
      rule_kind: "mcc_map",
    });
    expect(emptyName.ok).toBe(false);
    if (emptyName.ok) return;
    expect(emptyName.error).toMatch(/name is required/);

    const badMatch = await buildCreateRuleDraft(mockClient({}), PERSON, {
      name: "X",
      rule_kind: "mcc_map",
      // @ts-expect-error intentional
      match_mode: "sometimes",
    });
    expect(badMatch.ok).toBe(false);

    const badScope = await buildCreateRuleDraft(mockClient({}), PERSON, {
      name: "X",
      rule_kind: "mcc_map",
      // @ts-expect-error intentional
      scope_filter: "nope",
    });
    expect(badScope.ok).toBe(false);

    const orderCreated = vi.fn().mockResolvedValue({ data: [], error: null });
    const orderSort = vi.fn(() => ({ order: orderCreated }));
    const eqPerson = vi.fn(() => ({ order: orderSort }));
    const select = vi.fn(() => ({ eq: eqPerson }));
    const cat = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = vi.fn((table: string) => {
      if (table === "money_category_rules") return { select };
      if (table === "money_categories") {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: cat })) })) };
      }
      throw new Error(table);
    });

    const manyFilters = Array.from({ length: 13 }, (_, i) => ({
      field: "merchant_name",
      operator: "contains" as const,
      value: `shop-${i}`,
    }));
    const built = await buildCreateRuleDraft(mockClient({ from }), PERSON, {
      name: "LLM catch-all",
      rule_kind: "llm_categorization",
      enabled: false,
      stop_processing: true,
      filters: manyFilters,
      config: { model: "x", nested: { a: 1 } },
      target_category_id: null,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const text = built.draft.summary_lines.join("\n");
    expect(text).toContain("выключено");
    expect(text).toContain("stop_processing: да");
    expect(text).toMatch(/…и ещё 1/);
    expect(text).toContain("config.model: x");
    expect(text).toContain("LLM-правило");

    expect(invalidRegexFilterMessage([{ field: "x", operator: "regex", value: 12 as never }])).toBe(
      null,
    );
    expect(invalidRegexFilterMessage([{ field: "x", operator: "regex", value: "   " }])).toBe(null);
    expect(invalidRegexFilterMessage(undefined)).toBe(null);

    expect(
      ruleDraftSummaryText({
        mode: "rule_create",
        person_id: PERSON.id,
        person_name: PERSON.name,
        title: "t",
        summary_lines: [],
        input: { name: "n", rule_kind: "direct", target_category_id: CAT_ID },
      }),
    ).toContain("create category rule");
    expect(
      ruleDraftSummaryText({
        mode: "rule_update",
        person_id: PERSON.id,
        person_name: PERSON.name,
        title: "t",
        summary_lines: [],
        input: { rule_id: RULE_ID },
      }),
    ).toContain("update category rule");
    expect(
      ruleDraftSummaryText({
        mode: "rule_delete",
        person_id: PERSON.id,
        person_name: PERSON.name,
        title: "t",
        summary_lines: [],
        input: { rule_id: RULE_ID },
      }),
    ).toContain("delete category rule");
    expect(
      ruleDraftSummaryText({
        mode: "rule_apply",
        person_id: PERSON.id,
        person_name: PERSON.name,
        title: "t",
        summary_lines: [],
        input: { line_item_ids: [LINE_ID] },
      }),
    ).toContain("apply category rules");
  });

  it("throws when listing rules fails", async () => {
    const orderCreated = vi.fn().mockResolvedValue({ data: null, error: { message: "list boom" } });
    const orderSort = vi.fn(() => ({ order: orderCreated }));
    const eq = vi.fn(() => ({ order: orderSort }));
    const select = vi.fn(() => ({ eq }));
    await expect(
      listMoneyCategoryRules(mockClient({ from: vi.fn(() => ({ select })) }), PERSON.id),
    ).rejects.toThrow(/list boom/);
  });
});
