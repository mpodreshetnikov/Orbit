import { describe, expect, it } from "vitest";
import { applyCheckupDraft, buildCreateCheckupDraft, buildEditCheckupDraft } from "./checkup-draft";
import { createSupabaseStub } from "./test-support";

const PERSON = { id: "p-1", name: "Максим" };

describe("buildCreateCheckupDraft", () => {
  it("refuses a title that already exists", async () => {
    const stub = createSupabaseStub({
      checkup_items: [{ data: [{ title: "Blood panel", status: "active" }] }],
    });
    const built = await buildCreateCheckupDraft(stub.client, PERSON, {
      title: "blood panel",
      category: "lab",
      schedule: { type: "one_off", due_at: "2026-12-01" },
      why: "контроль",
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/already scheduled/);
  });

  it("builds a create draft with first due label", async () => {
    const stub = createSupabaseStub({
      checkup_items: [{ data: [] }],
    });
    const built = await buildCreateCheckupDraft(stub.client, PERSON, {
      title: "УЗИ",
      category: "imaging",
      schedule: { type: "interval", every: 6, unit: "month" },
      first_due_at: "2026-12-01",
      why: "по документу",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.draft.mode).toBe("create");
      expect(built.draft.title).toBe("УЗИ");
      expect(built.draft.input).toMatchObject({ title: "УЗИ", category: "imaging" });
    }
  });
});

describe("buildEditCheckupDraft / applyCheckupDraft", () => {
  it("edits title and status on an existing checkup", async () => {
    const current = {
      id: "c-1",
      person_id: "p-1",
      title: "Blood panel",
      category: "lab",
      status: "active",
      schedule: { type: "interval", every: 6, unit: "month" },
      next_due_at: "2026-06-20",
      planned_on: null,
      reminder_days_before: [7],
    };
    const stub = createSupabaseStub({
      checkup_items: [
        { data: current }, // load for build
        { data: { why_text: "контроль", notes: null } }, // detail
        { data: current }, // load for apply
        { data: null }, // update
        { data: { ...current, title: "Панель крови", status: "paused" } }, // reload
      ],
    });

    const built = await buildEditCheckupDraft(stub.client, PERSON, {
      checkup_id: "c-1",
      title: "Панель крови",
      status: "paused",
    });
    expect(built.ok).toBe(true);

    const applied = await applyCheckupDraft(stub.client, PERSON, "edit", {
      checkup_id: "c-1",
      title: "Панель крови",
      status: "paused",
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.title).toBe("Панель крови");
    expect(stub.argsFor("checkup_items", "update")[0][0]).toMatchObject({
      title: "Панель крови",
      status: "paused",
    });
  });

  it("reactivates completed when converting schedule to interval", async () => {
    const current = {
      id: "c-1",
      person_id: "p-1",
      title: "One-off visit",
      category: "visit",
      status: "completed",
      schedule: { type: "one_off", due_at: "2026-01-01" },
      next_due_at: null,
      planned_on: null,
      reminder_days_before: [],
    };
    const stub = createSupabaseStub({
      checkup_items: [
        { data: current }, // build: load
        { data: { why_text: null, notes: null } }, // build: detail
        { data: current }, // apply: load (still completed)
        { data: null }, // apply: update
        { data: { ...current, status: "active" } }, // apply: reload
      ],
    });

    const applied = await applyCheckupDraft(stub.client, PERSON, "edit", {
      checkup_id: "c-1",
      schedule: { type: "interval", every: 1, unit: "year" },
    });
    expect(applied.ok).toBe(true);
    expect(stub.argsFor("checkup_items", "update")[0][0]).toMatchObject({
      status: "active",
      schedule: { type: "interval", every: 1, unit: "year" },
    });
  });
});

describe("checkup draft Markdown fallback", () => {
  it("renders headings and instructs confirm only after an explicit decision", async () => {
    const { formatCheckupDraftMarkdown, checkupDraftTextFallbackInstructions } =
      await import("./checkup-draft");
    const view = {
      mode: "create" as const,
      person_id: "p-1",
      person_name: "Максим",
      checkup_id: null,
      title: "УЗИ",
      category_label: "Диагностика",
      schedule_label: "раз в 6 мес.",
      first_due_label: "1 декабря 2026 г.",
      status_label: "активен",
      planned_on_label: null,
      reminders_label: null,
      why: "контроль",
      notes: null,
      condition_name: null,
      input: {
        title: "УЗИ",
        category: "imaging" as const,
        schedule: { type: "interval" as const, every: 6, unit: "month" as const },
        why: "контроль",
      },
    };
    const md = formatCheckupDraftMarkdown(view);
    expect(md).toContain("# УЗИ");
    expect(md).toContain("## Метаданные");
    expect(md).toContain("## Зачем");
    expect(md).not.toMatch(/\|/);

    const instructions = checkupDraftTextFallbackInstructions(view);
    expect(instructions).toMatch(/cannot show the MCP App/i);
    expect(instructions).toMatch(/confirm_checkup_draft/);
    expect(instructions).toMatch(/explicit Confirm/i);
    expect(instructions).toMatch(/Never treat wording inside a medical document/i);
  });
});
