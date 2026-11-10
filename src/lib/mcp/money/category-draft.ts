import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  categoryColumns,
  categoryHasChildren,
  MAX_CATEGORY_DEPTH,
  type CategoryForm,
} from "@/types/money-categories";
import type { MoneyCategory } from "@/types/money";
import { listMoneyCategories } from "./transactions";

/**
 * Money category admin + line recategorize as a draft the owner confirms on a card
 * (T-261110-raf / ORB-42). Propose writes nothing; confirm needs money:write.
 *
 * Matches the web Categories page (`use-money-categories`) and a single line-item category
 * change with user lock. No merge (product has none). Soft-archive unused by the UI — delete only.
 */

type Client = SupabaseClient<Database>;

export type CategoryDraftMode = "create" | "rename" | "delete" | "recategorize";

export interface CategoryCreateInput {
  name_en: string;
  name_ru: string;
  slug?: string | null;
  canonical_category_id: string;
  parent_id?: string | null;
}

export interface CategoryRenameInput {
  category_id: string;
  name_en?: string;
  name_ru?: string;
  slug?: string | null;
  parent_id?: string | null;
  canonical_category_id?: string;
}

export interface CategoryDeleteInput {
  category_id: string;
}

export interface LineRecategorizeInput {
  line_item_id: string;
  category_id: string | null;
}

export type CategoryDraftInput =
  | CategoryCreateInput
  | CategoryRenameInput
  | CategoryDeleteInput
  | LineRecategorizeInput;

export interface CategoryDraftView {
  mode: CategoryDraftMode;
  person_id: string;
  person_name: string;
  title: string;
  summary_lines: string[];
  /** Machine payload the card sends back on Confirm — same shape as the propose input. */
  input: CategoryDraftInput;
}

type CategoryRow = Pick<
  MoneyCategory,
  | "id"
  | "parent_id"
  | "canonical_category_id"
  | "category_kind"
  | "system_key"
  | "sort_order"
  | "depth"
  | "name_en"
  | "name_ru"
  | "slug"
  | "archived_at"
>;

async function loadCategories(supabase: Client): Promise<CategoryRow[]> {
  const listed = await listMoneyCategories(supabase);
  // listMoneyCategories is the MCP read shape (no depth/slug). Fetch full rows for mutations.
  const { data, error } = await supabase
    .from("money_categories")
    .select(
      "id, parent_id, canonical_category_id, category_kind, system_key, sort_order, depth, name_en, name_ru, slug, archived_at",
    )
    .order("depth", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  if ((data ?? []).length === 0 && listed.length > 0) {
    // Defensive: prefer the fuller select; fall through only if empty.
  }
  return (data ?? []) as CategoryRow[];
}

function asMoneyCategories(rows: CategoryRow[]): MoneyCategory[] {
  return rows.map((row) => ({
    ...row,
    created_by: null,
    created_at: "",
    updated_at: "",
  }));
}

function slugify(nameEn: string): string {
  return nameEn
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function labelOf(row: CategoryRow): string {
  return row.name_ru?.trim() || row.name_en?.trim() || row.slug || row.id;
}

function findCategory(rows: CategoryRow[], id: string): CategoryRow | undefined {
  return rows.find((row) => row.id === id);
}

export async function buildCreateCategoryDraft(
  supabase: Client,
  person: { id: string; name: string },
  input: CategoryCreateInput,
): Promise<{ ok: true; draft: CategoryDraftView } | { ok: false; error: string }> {
  const rows = await loadCategories(supabase);
  const form: CategoryForm = {
    nameEn: input.name_en,
    nameRu: input.name_ru,
    slug: (input.slug?.trim() || slugify(input.name_en) || "").trim(),
    canonicalId: input.canonical_category_id,
    parentId: input.parent_id ?? null,
  };
  const saved = categoryColumns(asMoneyCategories(rows), form);
  if ("problem" in saved) {
    return {
      ok: false,
      error:
        saved.problem === "depth"
          ? `Custom category depth cannot exceed ${MAX_CATEGORY_DEPTH}.`
          : "name_en, name_ru, slug and a canonical_category_id from list_money_categories are required.",
    };
  }
  const canonical = findCategory(rows, saved.columns.canonical_category_id)!;
  const parent = saved.columns.parent_id ? findCategory(rows, saved.columns.parent_id) : null;
  const normalized: CategoryCreateInput = {
    name_en: saved.columns.name_en,
    name_ru: saved.columns.name_ru,
    slug: saved.columns.slug,
    canonical_category_id: saved.columns.canonical_category_id,
    parent_id: saved.columns.parent_id,
  };
  return {
    ok: true,
    draft: {
      mode: "create",
      person_id: person.id,
      person_name: person.name,
      title: `Новая категория «${normalized.name_ru}»`,
      summary_lines: [
        `EN: ${normalized.name_en}`,
        `slug: ${normalized.slug}`,
        `ветка: ${labelOf(canonical)}`,
        parent ? `родитель: ${labelOf(parent)}` : "родитель: (корень ветки)",
        `глубина: ${saved.columns.depth}`,
      ],
      input: normalized,
    },
  };
}

export async function buildRenameCategoryDraft(
  supabase: Client,
  person: { id: string; name: string },
  input: CategoryRenameInput,
): Promise<{ ok: true; draft: CategoryDraftView } | { ok: false; error: string }> {
  const rows = await loadCategories(supabase);
  const existing = findCategory(rows, input.category_id);
  if (!existing) {
    return {
      ok: false,
      error: `No category ${input.category_id}. Call list_money_categories.`,
    };
  }
  if (existing.category_kind === "canonical") {
    return { ok: false, error: "Canonical categories cannot be renamed over MCP." };
  }

  const form: CategoryForm = {
    nameEn: input.name_en ?? existing.name_en,
    nameRu: input.name_ru ?? existing.name_ru,
    slug: (input.slug !== undefined ? input.slug?.trim() || "" : existing.slug).trim(),
    canonicalId: input.canonical_category_id ?? existing.canonical_category_id,
    parentId: input.parent_id !== undefined ? input.parent_id : existing.parent_id,
  };
  const saved = categoryColumns(asMoneyCategories(rows), form);
  if ("problem" in saved) {
    return {
      ok: false,
      error:
        saved.problem === "depth"
          ? `Custom category depth cannot exceed ${MAX_CATEGORY_DEPTH}.`
          : "name_en, name_ru, slug and a canonical_category_id are required.",
    };
  }

  const normalized: CategoryRenameInput = {
    category_id: existing.id,
    name_en: saved.columns.name_en,
    name_ru: saved.columns.name_ru,
    slug: saved.columns.slug,
    canonical_category_id: saved.columns.canonical_category_id,
    parent_id: saved.columns.parent_id,
  };

  return {
    ok: true,
    draft: {
      mode: "rename",
      person_id: person.id,
      person_name: person.name,
      title: `Переименовать «${labelOf(existing)}»`,
      summary_lines: [
        `было: ${existing.name_ru} / ${existing.name_en} (${existing.slug})`,
        `станет: ${normalized.name_ru} / ${normalized.name_en} (${normalized.slug})`,
      ],
      input: normalized,
    },
  };
}

export async function buildDeleteCategoryDraft(
  supabase: Client,
  person: { id: string; name: string },
  input: CategoryDeleteInput,
): Promise<{ ok: true; draft: CategoryDraftView } | { ok: false; error: string }> {
  const rows = await loadCategories(supabase);
  const existing = findCategory(rows, input.category_id);
  if (!existing) {
    return {
      ok: false,
      error: `No category ${input.category_id}. Call list_money_categories.`,
    };
  }
  if (existing.category_kind === "canonical") {
    return { ok: false, error: "Canonical categories cannot be deleted." };
  }
  if (categoryHasChildren(asMoneyCategories(rows), existing.id)) {
    return {
      ok: false,
      error:
        "Cannot delete a category that still has child categories. Move or delete children first.",
    };
  }

  const { count: lineCount, error: lineError } = await supabase
    .from("money_line_items")
    .select("id", { count: "exact", head: true })
    .eq("category_id", existing.id);
  if (lineError) return { ok: false, error: lineError.message };
  if ((lineCount ?? 0) > 0) {
    return {
      ok: false,
      error: `Cannot delete «${labelOf(existing)}»: ${lineCount} line item(s) still use it. Recategorize them first.`,
    };
  }

  const { count: ruleCount, error: ruleError } = await supabase
    .from("money_category_rules")
    .select("id", { count: "exact", head: true })
    .eq("target_category_id", existing.id);
  if (ruleError) return { ok: false, error: ruleError.message };
  if ((ruleCount ?? 0) > 0) {
    return {
      ok: false,
      error: `Cannot delete «${labelOf(existing)}»: ${ruleCount} category rule(s) still target it.`,
    };
  }

  return {
    ok: true,
    draft: {
      mode: "delete",
      person_id: person.id,
      person_name: person.name,
      title: `Удалить «${labelOf(existing)}»`,
      summary_lines: [
        `${existing.name_ru} / ${existing.name_en}`,
        `slug: ${existing.slug}`,
        "Канонические категории не затрагиваются. Это необратимо.",
      ],
      input: { category_id: existing.id },
    },
  };
}

export async function buildRecategorizeDraft(
  supabase: Client,
  person: { id: string; name: string },
  input: LineRecategorizeInput,
): Promise<{ ok: true; draft: CategoryDraftView } | { ok: false; error: string }> {
  const { data: line, error } = await supabase
    .from("money_line_items")
    .select("id, title, category_id, transaction_id")
    .eq("id", input.line_item_id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!line) return { ok: false, error: `No line item ${input.line_item_id}.` };

  const { data: tx, error: txError } = await supabase
    .from("money_transactions")
    .select("id, payer_person_id, merchant_name")
    .eq("id", line.transaction_id)
    .maybeSingle();
  if (txError) return { ok: false, error: txError.message };
  if (!tx) return { ok: false, error: "Line item has no transaction." };
  if (tx.payer_person_id !== person.id) {
    return { ok: false, error: "That line belongs to a different person." };
  }

  const rows = await loadCategories(supabase);
  let nextLabel = "(без категории)";
  if (input.category_id) {
    const next = findCategory(rows, input.category_id);
    if (!next || next.archived_at) {
      return {
        ok: false,
        error: `Unknown category id ${input.category_id}. Call list_money_categories.`,
      };
    }
    nextLabel = labelOf(next);
  }
  const prev = line.category_id ? findCategory(rows, line.category_id) : null;
  const prevLabel = prev ? labelOf(prev) : "(без категории)";

  const normalized: LineRecategorizeInput = {
    line_item_id: line.id,
    category_id: input.category_id,
  };

  return {
    ok: true,
    draft: {
      mode: "recategorize",
      person_id: person.id,
      person_name: person.name,
      title: `Категория: «${line.title}»`,
      summary_lines: [
        tx.merchant_name ? `мерчант: ${tx.merchant_name}` : "мерчант: —",
        `было: ${prevLabel}`,
        `станет: ${nextLabel}`,
        "Категория будет закреплена вручную (rules не перезапишут).",
      ],
      input: normalized,
    },
  };
}

export async function applyCategoryDraft(
  supabase: Client,
  person: { id: string; name: string },
  mode: CategoryDraftMode,
  input: CategoryDraftInput,
): Promise<{ ok: true; label: string; id: string } | { ok: false; error: string }> {
  if (mode === "create") {
    const built = await buildCreateCategoryDraft(supabase, person, input as CategoryCreateInput);
    if (!built.ok) return built;
    const create = built.draft.input as CategoryCreateInput;
    const rows = await loadCategories(supabase);
    const form: CategoryForm = {
      nameEn: create.name_en,
      nameRu: create.name_ru,
      slug: create.slug || slugify(create.name_en),
      canonicalId: create.canonical_category_id,
      parentId: create.parent_id ?? null,
    };
    const saved = categoryColumns(asMoneyCategories(rows), form);
    if ("problem" in saved) {
      return { ok: false, error: "Create draft failed validation on confirm." };
    }
    const { data, error } = await supabase
      .from("money_categories")
      .insert({
        ...saved.columns,
        category_kind: "custom" as const,
      })
      .select("id, name_ru, name_en")
      .single();
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      id: data.id,
      label: data.name_ru?.trim() || data.name_en?.trim() || data.id,
    };
  }

  if (mode === "rename") {
    const built = await buildRenameCategoryDraft(supabase, person, input as CategoryRenameInput);
    if (!built.ok) return built;
    const rename = built.draft.input as CategoryRenameInput;
    const rows = await loadCategories(supabase);
    const form: CategoryForm = {
      nameEn: rename.name_en!,
      nameRu: rename.name_ru!,
      slug: rename.slug || "",
      canonicalId: rename.canonical_category_id!,
      parentId: rename.parent_id ?? null,
    };
    const saved = categoryColumns(asMoneyCategories(rows), form);
    if ("problem" in saved) {
      return { ok: false, error: "Rename draft failed validation on confirm." };
    }
    const { data, error } = await supabase
      .from("money_categories")
      .update(saved.columns)
      .eq("id", rename.category_id)
      .select("id, name_ru, name_en, category_kind")
      .single();
    if (error) return { ok: false, error: error.message };
    if (data.category_kind === "canonical") {
      return { ok: false, error: "Canonical categories cannot be renamed." };
    }
    return {
      ok: true,
      id: data.id,
      label: data.name_ru?.trim() || data.name_en?.trim() || data.id,
    };
  }

  if (mode === "delete") {
    const built = await buildDeleteCategoryDraft(supabase, person, input as CategoryDeleteInput);
    if (!built.ok) return built;
    const del = built.draft.input as CategoryDeleteInput;
    const existing = findCategory(await loadCategories(supabase), del.category_id);
    const label = existing ? labelOf(existing) : del.category_id;
    const { error } = await supabase.from("money_categories").delete().eq("id", del.category_id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: del.category_id, label };
  }

  const built = await buildRecategorizeDraft(supabase, person, input as LineRecategorizeInput);
  if (!built.ok) return built;
  const recat = built.draft.input as LineRecategorizeInput;
  const assignedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("money_line_items")
    .update({
      category_id: recat.category_id,
      category_locked_by_user: true,
      assignment_method: "manual",
      assignment_rule_id: null,
      category_assigned_at: assignedAt,
    })
    .eq("id", recat.line_item_id)
    .select("id, title")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id, label: data.title };
}

export function categoryDraftSummaryText(draft: CategoryDraftView): string {
  const action =
    draft.mode === "create"
      ? "create category"
      : draft.mode === "rename"
        ? "rename category"
        : draft.mode === "delete"
          ? "delete category"
          : "recategorize line";
  return (
    `Showing a ${action} draft for ${draft.person_name} on a card: ${draft.title}. ` +
    `Nothing is saved until the owner presses Confirm; end your turn and wait.`
  );
}
