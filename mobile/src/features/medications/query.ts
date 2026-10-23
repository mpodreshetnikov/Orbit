import type { MedRegimen } from "@orbit-types/regimen";
import { supabase } from "@/lib/supabase";

/** A person's courses, newest first — the web app's `fetchRegimens`, unfiltered. */
export async function fetchRegimens(personId: string): Promise<MedRegimen[]> {
  const { data, error } = await supabase
    .from("med_regimens")
    .select("*")
    .eq("person_id", personId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }
  // The row's columns are the type's fields one for one; `rowToRegimen` on the web is a field copy.
  return (data ?? []) as unknown as MedRegimen[];
}

/** One course, or null when it was deleted or never visible to this account. */
export async function fetchRegimen(regimenId: string): Promise<MedRegimen | null> {
  const { data, error } = await supabase
    .from("med_regimens")
    .select("*")
    .eq("id", regimenId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data as unknown as MedRegimen | null;
}
