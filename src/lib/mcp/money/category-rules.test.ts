import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRuleDraft,
  buildApplyRulesDraft,
  buildCreateRuleDraft,
  buildDeleteRuleDraft,
  buildUpdateRuleDraft,
  listMoneyCategoryRules,
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
});
