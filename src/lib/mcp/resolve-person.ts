import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Turns whatever the model supplied into a concrete person id.
 *
 * Almost every health tool is person-scoped (this app tracks family members and
 * pets), but forcing the model to call `list_persons` before every single
 * operation is miserable. So: an explicit id wins; a name is matched
 * case-insensitively; and if neither is given but there is exactly one person
 * on the account, that one is used.
 *
 * When the input is genuinely ambiguous the result is a candidate list rather
 * than an error, so the model can ask the user which person they meant instead
 * of guessing.
 */

export interface PersonRef {
  id: string;
  name: string;
  kind: string;
}

export type PersonResolution =
  | { status: "ok"; person: PersonRef }
  | { status: "ambiguous"; message: string; candidates: PersonRef[] }
  | { status: "not_found"; message: string; candidates: PersonRef[] };

function describe(people: PersonRef[]): string {
  return people.map((p) => `${p.name} (${p.kind}, id ${p.id})`).join("; ");
}

export async function listPeople(supabase: SupabaseClient<Database>): Promise<PersonRef[]> {
  const { data, error } = await supabase
    .from("persons")
    .select("id, name, kind")
    .order("kind", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list persons: ${error.message}`);
  }

  return (data ?? []) as PersonRef[];
}

export async function resolvePerson(
  supabase: SupabaseClient<Database>,
  args: { person_id?: string; person_name?: string },
): Promise<PersonResolution> {
  const people = await listPeople(supabase);

  if (people.length === 0) {
    return {
      status: "not_found",
      message:
        "This account has no people set up yet. Add a person in the app before recording health data.",
      candidates: [],
    };
  }

  if (args.person_id) {
    const match = people.find((person) => person.id === args.person_id);
    if (!match) {
      return {
        status: "not_found",
        message: `No person with id ${args.person_id}. Known people: ${describe(people)}`,
        candidates: people,
      };
    }
    return { status: "ok", person: match };
  }

  if (args.person_name?.trim()) {
    const needle = args.person_name.trim().toLowerCase();
    const exact = people.filter((person) => person.name.toLowerCase() === needle);
    const matches =
      exact.length > 0
        ? exact
        : people.filter((person) => person.name.toLowerCase().includes(needle));

    if (matches.length === 1) {
      return { status: "ok", person: matches[0] };
    }
    if (matches.length === 0) {
      return {
        status: "not_found",
        message: `No person matching "${args.person_name}". Known people: ${describe(people)}`,
        candidates: people,
      };
    }
    return {
      status: "ambiguous",
      message: `"${args.person_name}" matches more than one person: ${describe(matches)}. Ask which one is meant, then pass person_id.`,
      candidates: matches,
    };
  }

  if (people.length === 1) {
    return { status: "ok", person: people[0] };
  }

  return {
    status: "ambiguous",
    message: `Several people are tracked on this account: ${describe(people)}. Ask which one is meant, then pass person_id or person_name.`,
    candidates: people,
  };
}
