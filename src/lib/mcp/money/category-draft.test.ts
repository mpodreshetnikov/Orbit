import { beforeEach, describe, expect, it, vi } from "vitest";

const listed = vi.hoisted(() => ({
  listMoneyCategories: vi.fn(),
}));

vi.mock("./transactions", async () => {
  const actual = await vi.importActual<typeof import("./transactions")>("./transactions");
  return {
    ...actual,
    listMoneyCategories: listed.listMoneyCategories,
  };
});

import {
  applyCategoryDraft,
  buildCreateCategoryDraft,
  buildDeleteCategoryDraft,
  buildRecategorizeDraft,
  buildRenameCategoryDraft,
  categoryDraftSummaryText,
} from "./category-draft";

const PERSON = { id: "p-1", name: "Максим" };
const CANON = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  parent_id: null,
  canonical_category_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  category_kind: "canonical" as const,
  system_key: "food",
  sort_order: 1,
  depth: 0,
  name_en: "Food",
  name_ru: "Еда",
  slug: "food",
  archived_at: null,
};
const CUSTOM = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  parent_id: null,
  canonical_category_id: CANON.id,
  category_kind: "custom" as const,
  system_key: null,
  sort_order: 10,
  depth: 1,
  name_en: "Coffee",
  name_ru: "Кофе",
  slug: "coffee",
  archived_at: null,
};

function createClient(handlers: {
  categories?: unknown[];
  lineCount?: number;
  ruleCount?: number;
  line?: Record<string, unknown> | null;
  tx?: Record<string, unknown> | null;
  insert?: { data: unknown; error: null | { message: string } };
  update?: { data: unknown; error: null | { message: string } };
  deleteError?: { message: string } | null;
}) {
  const categories = handlers.categories ?? [CANON, CUSTOM];
  return {
    from(table: string) {
      if (table === "money_categories") {
        return {
          select() {
            return {
              order() {
                return {
                  order: async () => ({ data: categories, error: null }),
                };
              },
              single: async () =>
                handlers.update ?? {
                  data: {
                    id: CUSTOM.id,
                    name_ru: "Латте",
                    name_en: "Latte",
                    category_kind: "custom",
                  },
                  error: null,
                },
            };
          },
          insert() {
            return {
              select() {
                return {
                  single: async () =>
                    handlers.insert ?? {
                      data: {
                        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                        name_ru: "Пекарня",
                        name_en: "Bakery",
                      },
                      error: null,
                    },
                };
              },
            };
          },
          update() {
            return {
              eq() {
                return {
                  select() {
                    return {
                      single: async () =>
                        handlers.update ?? {
                          data: {
                            id: CUSTOM.id,
                            name_ru: "Латте",
                            name_en: "Latte",
                            category_kind: "custom",
                          },
                          error: null,
                        },
                    };
                  },
                };
              },
            };
          },
          delete() {
            return {
              eq: async () => ({ error: handlers.deleteError ?? null }),
            };
          },
        };
      }
      if (table === "money_line_items") {
        return {
          select(_cols?: string, opts?: { count?: string; head?: boolean }) {
            if (opts?.head) {
              return {
                eq: async () => ({ count: handlers.lineCount ?? 0, error: null }),
              };
            }
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data:
                      handlers.line === undefined
                        ? {
                            id: "llllllll-llll-4lll-8lll-llllllllllll",
                            title: "Латте",
                            category_id: CUSTOM.id,
                            transaction_id: "tttttttt-tttt-4ttt-8ttt-tttttttttttt",
                          }
                        : handlers.line,
                    error: null,
                  }),
                };
              },
            };
          },
          update() {
            return {
              eq() {
                return {
                  select() {
                    return {
                      single: async () => ({
                        data: { id: "llllllll-llll-4lll-8lll-llllllllllll", title: "Латте" },
                        error: null,
                      }),
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "money_category_rules") {
        return {
          select() {
            return {
              eq: async () => ({ count: handlers.ruleCount ?? 0, error: null }),
            };
          },
        };
      }
      if (table === "money_transactions") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data:
                      handlers.tx === undefined
                        ? {
                            id: "tttttttt-tttt-4ttt-8ttt-tttttttttttt",
                            payer_person_id: PERSON.id,
                            merchant_name: "Кофейня",
                          }
                        : handlers.tx,
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  listed.listMoneyCategories.mockResolvedValue([CANON, CUSTOM]);
});

describe("category-draft money", () => {
  it("builds a create draft under a canonical branch and derives slug", async () => {
    const built = await buildCreateCategoryDraft(createClient({}), PERSON, {
      name_en: "Bakery",
      name_ru: "Пекарня",
      canonical_category_id: CANON.id,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.mode).toBe("create");
    expect(built.draft.input).toMatchObject({
      name_en: "Bakery",
      name_ru: "Пекарня",
      slug: "bakery",
      canonical_category_id: CANON.id,
    });
    expect(categoryDraftSummaryText(built.draft)).toContain("create category");
  });

  it("refuses renaming a canonical category", async () => {
    const built = await buildRenameCategoryDraft(createClient({}), PERSON, {
      category_id: CANON.id,
      name_en: "Nope",
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/Canonical/i);
  });

  it("shows parent and canonical moves in the rename summary", async () => {
    const sibling = {
      ...CUSTOM,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      name_en: "Tea",
      name_ru: "Чай",
      slug: "tea",
      depth: 1,
    };
    const built = await buildRenameCategoryDraft(
      createClient({ categories: [CANON, CUSTOM, sibling] }),
      PERSON,
      {
        category_id: CUSTOM.id,
        parent_id: sibling.id,
      },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.summary_lines.some((line) => line.includes("родитель"))).toBe(true);
    expect(built.draft.summary_lines.join("\n")).toMatch(/Чай/);
  });

  it("refuses delete when line items still use the category", async () => {
    const built = await buildDeleteCategoryDraft(createClient({ lineCount: 3 }), PERSON, {
      category_id: CUSTOM.id,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toMatch(/3 line item/);
  });

  it("builds a recategorize draft only for the person's line", async () => {
    const ok = await buildRecategorizeDraft(createClient({}), PERSON, {
      line_item_id: "llllllll-llll-4lll-8lll-llllllllllll",
      category_id: CANON.id,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.draft.mode).toBe("recategorize");

    const wrong = await buildRecategorizeDraft(
      createClient({
        tx: {
          id: "tttttttt-tttt-4ttt-8ttt-tttttttttttt",
          payer_person_id: "other",
          merchant_name: "X",
        },
      }),
      PERSON,
      {
        line_item_id: "llllllll-llll-4lll-8lll-llllllllllll",
        category_id: CANON.id,
      },
    );
    expect(wrong.ok).toBe(false);
  });

  it("apply create inserts a custom category", async () => {
    const result = await applyCategoryDraft(createClient({}), PERSON, "create", {
      name_en: "Bakery",
      name_ru: "Пекарня",
      canonical_category_id: CANON.id,
    });
    expect(result.ok).toBe(true);
  });
});
