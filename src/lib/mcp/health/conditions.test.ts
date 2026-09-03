import { describe, expect, it } from "vitest";
import { getCondition } from "./conditions";
import { createSupabaseStub } from "./test-support";

function mention(overrides: Record<string, unknown> = {}) {
  return {
    id: "cr-1",
    record_id: "r-1",
    status_in_record: "resolved",
    source_anchor: "Витамин В12\t704.00\tпг/мл\t187.00–883.00",
    confidence: 0.9,
    is_user_verified: false,
    is_llm_extracted: true,
    supporting_obs_code: "vitamin_b12",
    review_decision: "pending",
    medical_records: { id: "r-1", title: "Lab", record_date: "2026-03-06", record_type: "lab" },
    ...overrides,
  };
}

const activeCondition = {
  id: "cond-1",
  person_id: "p-1",
  name: "Дефицит витамина B12",
  code: "E53.8",
  icd_name_en: null,
  icd_name_ru: null,
  current_status: "active",
  onset_date: null,
  resolved_date: null,
  notes: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

function stubFor(mentions: Record<string, unknown>[]) {
  return createSupabaseStub({
    conditions: [{ data: activeCondition }],
    condition_records: [{ data: mentions }],
    get_checkups_for_condition: [{ data: [] }],
  });
}

describe("getCondition", () => {
  it("marks a machine closure nobody confirmed, so it cannot be read as a resolution", async () => {
    // Without the flag an assistant sees status_in_record "resolved" and reports the condition as
    // resolved, while current_status says active and the chart is right. Two fields disagreeing
    // with nothing naming the reason is worse than either alone.
    const stub = stubFor([mention()]);
    const detail = await getCondition(stub.client, "cond-1");

    expect(detail.mentions).toHaveLength(1);
    expect(detail.mentions[0].awaiting_confirmation).toBe(true);
    expect(String(detail.mentions[0].not_applied_reason)).toContain("NOT changed");
    expect(detail.condition?.current_status).toBe("active");
  });

  it("leaves a confirmed closure unmarked", async () => {
    const stub = stubFor([mention({ is_user_verified: true, review_decision: "confirmed" })]);
    const detail = await getCondition(stub.client, "cond-1");

    expect(detail.mentions[0].awaiting_confirmation).toBe(false);
    expect(detail.mentions[0].not_applied_reason).toBeUndefined();
  });

  it("leaves a closure a person wrote themselves unmarked", async () => {
    const stub = stubFor([mention({ is_llm_extracted: false })]);
    const detail = await getCondition(stub.client, "cond-1");

    expect(detail.mentions[0].awaiting_confirmation).toBe(false);
  });

  it("leaves an unverified mention that is not a closure unmarked", async () => {
    // `active` and `suspected` apply unreviewed by design, so there is nothing to warn about.
    const stub = stubFor([mention({ status_in_record: "active", supporting_obs_code: null })]);
    const detail = await getCondition(stub.client, "cond-1");

    expect(detail.mentions[0].awaiting_confirmation).toBe(false);
  });

  it("reads the columns the rule needs", async () => {
    // The flag is derived from three columns; selecting two of them would make every row look
    // confirmed, and the tests above would still pass on their fixtures.
    const stub = stubFor([mention()]);
    await getCondition(stub.client, "cond-1");

    const select = stub.argsFor("condition_records", "select")[0][0] as string;
    expect(select).toContain("status_in_record");
    expect(select).toContain("is_llm_extracted");
    expect(select).toContain("is_user_verified");
    // Carried so a reader can say which measurement a proposal rests on, and whether anyone ruled.
    expect(select).toContain("supporting_obs_code");
    expect(select).toContain("review_decision");
  });
});
