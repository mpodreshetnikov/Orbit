import { describe, expect, it, vi, beforeEach } from "vitest";
import { currentMcpPersonId, runWithMcpToolAuditScope } from "../audit";
import { getIngestableRecord } from "./ingestable-record";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function clientWith(result: {
  data: unknown;
  error: { message: string } | null;
}): SupabaseClient<Database> {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from } as unknown as SupabaseClient<Database>;
}

describe("getIngestableRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the row and notes person_id on the MCP audit scope", async () => {
    const row = {
      id: "rec-1",
      person_id: "person-owned",
      status: "structure_review",
      title: "Lab",
      attachments: [],
    };
    const client = clientWith({ data: row, error: null });

    await runWithMcpToolAuditScope(async () => {
      await expect(getIngestableRecord(client, "rec-1")).resolves.toMatchObject({
        id: "rec-1",
        person_id: "person-owned",
      });
      expect(currentMcpPersonId()).toBe("person-owned");
    });
  });

  it("returns null without noting a person", async () => {
    const client = clientWith({ data: null, error: null });
    await runWithMcpToolAuditScope(async () => {
      await expect(getIngestableRecord(client, "missing")).resolves.toBeNull();
      expect(currentMcpPersonId()).toBeUndefined();
    });
  });

  it("surfaces a query error", async () => {
    const client = clientWith({ data: null, error: { message: "boom" } });
    await expect(getIngestableRecord(client, "rec-1")).rejects.toThrow(/Failed to load the record/);
  });
});
