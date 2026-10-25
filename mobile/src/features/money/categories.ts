import type { categoryColumns } from "@orbit-types/money-categories";
import { supabase } from "@/lib/supabase";

export type CategoryColumns = Extract<
  ReturnType<typeof categoryColumns>,
  { columns: unknown }
>["columns"];

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** Add a custom category, change one by `id`, or delete it when `columns` is null. */
export async function saveCategory(id: string | undefined, columns: CategoryColumns | null) {
  const table = supabase.from("money_categories");
  if (!columns) check(await table.delete().eq("id", id!));
  else if (id) check(await table.update(columns).eq("id", id));
  else check(await table.insert({ ...columns, category_kind: "custom" }));
}
