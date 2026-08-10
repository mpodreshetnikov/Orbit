import { z } from "zod";
import { listPeople } from "../resolve-person";
import { ok, summarizeList } from "../tool-result";
import { withPerson, withUserClient } from "../tool-context";
import { personSelectorSchema } from "../schemas/common";
import type { McpToolServer } from "./types";

/**
 * Person tools. Everything else in this server is person-scoped, so these are
 * usually the first call in a conversation.
 */
export function registerPersonTools(server: McpToolServer): void {
  server.registerTool(
    "list_persons",
    {
      title: "List people",
      description:
        "List every person and pet tracked in the health app, with their ids. Call this first when you need a person_id, or when a request is ambiguous about who it refers to.",
      inputSchema: z.object({
        kind: z.enum(["human", "pet"]).optional().describe("Restrict to humans or pets."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withUserClient<{ kind?: "human" | "pet" }>(async (supabase, args) => {
      const people = await listPeople(supabase);
      const filtered = args.kind ? people.filter((person) => person.kind === args.kind) : people;

      return ok(
        summarizeList(
          "people",
          filtered.map((person) => `${person.name} — ${person.kind} (id ${person.id})`),
          filtered.length,
        ),
        { persons: filtered },
      );
    }),
  );

  server.registerTool(
    "get_person",
    {
      title: "Get person",
      description:
        "Get one person's profile: kind (human or pet), species and breed for pets, sex, birthday and notes.",
      inputSchema: z.object({ ...personSelectorSchema }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person) => {
      const { data, error } = await supabase
        .from("persons")
        .select("id, name, kind, species, breed, sex, birthday, notes, created_at")
        .eq("id", person.id)
        .single();

      if (error) {
        throw new Error(`Failed to load person: ${error.message}`);
      }

      return ok(`${data.name} (${data.kind}${data.species ? `, ${data.species}` : ""})`, {
        person: data,
      });
    }),
  );
}
