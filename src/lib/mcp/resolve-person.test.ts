import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { resolvePerson } from "./resolve-person";

const PEOPLE = [
  { id: "p-1", name: "Maria", kind: "human" },
  { id: "p-2", name: "Marina", kind: "human" },
  { id: "p-3", name: "Rex", kind: "pet" },
];

function supabaseWith(people: Array<{ id: string; name: string; kind: string }>) {
  const order2 = vi.fn().mockResolvedValue({ data: people, error: null });
  const order1 = vi.fn().mockReturnValue({ order: order2 });
  const select = vi.fn().mockReturnValue({ order: order1 });
  return {
    client: { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient<Database>,
    select,
  };
}

describe("resolvePerson", () => {
  it("uses an explicit person_id", async () => {
    const { client } = supabaseWith(PEOPLE);
    const result = await resolvePerson(client, { person_id: "p-3" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.person.name).toBe("Rex");
  });

  it("reports an unknown person_id with the list of real ones", async () => {
    const { client } = supabaseWith(PEOPLE);
    const result = await resolvePerson(client, { person_id: "nope" });

    expect(result.status).toBe("not_found");
    expect(result.status === "not_found" && result.candidates).toHaveLength(3);
  });

  it("matches a name case-insensitively", async () => {
    const { client } = supabaseWith(PEOPLE);
    const result = await resolvePerson(client, { person_name: "rex" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.person.id).toBe("p-3");
  });

  it("prefers an exact name match over a substring match", async () => {
    const { client } = supabaseWith(PEOPLE);
    // "Maria" is also a substring of "Marina"; the exact match must win rather
    // than the call becoming ambiguous.
    const result = await resolvePerson(client, { person_name: "Maria" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.person.id).toBe("p-1");
  });

  it("asks for clarification when a name matches several people", async () => {
    const { client } = supabaseWith(PEOPLE);
    const result = await resolvePerson(client, { person_name: "mar" });

    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    expect(result.candidates.map((p) => p.id)).toEqual(["p-1", "p-2"]);
    expect(result.message).toContain("person_id");
  });

  it("defaults to the only person when the account has one", async () => {
    const { client } = supabaseWith([PEOPLE[0]]);
    const result = await resolvePerson(client, {});

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.person.id).toBe("p-1");
  });

  it("asks which person is meant when several exist and none was named", async () => {
    const { client } = supabaseWith(PEOPLE);
    const result = await resolvePerson(client, {});

    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    expect(result.candidates).toHaveLength(3);
  });

  it("explains the empty case rather than returning a bare error", async () => {
    const { client } = supabaseWith([]);
    const result = await resolvePerson(client, {});

    expect(result.status).toBe("not_found");
    expect(result.status === "not_found" && result.message).toContain("no people");
  });

  it("reports a name that matches nobody", async () => {
    const { client } = supabaseWith(PEOPLE);
    const result = await resolvePerson(client, { person_name: "Zoltan" });

    expect(result.status).toBe("not_found");
  });
});
