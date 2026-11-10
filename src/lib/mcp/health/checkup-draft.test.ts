import { describe, expect, it } from "vitest";
import { applyCheckupDraft, buildCreateCheckupDraft, buildEditCheckupDraft } from "./checkup-draft";
import { createSupabaseStub } from "./test-support";

const PERSON = { id: "p-1", name: "Максим" };

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    person_id: "p-1",
    title: "Blood panel",
    category: "lab",
    status: "active",
    schedule: { type: "interval", every: 6, unit: "month" },
    next_due_at: "2026-06-20",
    planned_on: null,
    reminder_days_before: [7],
    ...overrides,
  };
}

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

  it("builds a create draft; omitted reminders preview DB default [7]", async () => {
    const stub = createSupabaseStub({ checkup_items: [{ data: [] }] });
    const built = await buildCreateCheckupDraft(stub.client, PERSON, {
      title: "УЗИ",
      category: "imaging",
      schedule: { type: "interval", every: 6, unit: "month" },
      first_due_at: "2026-12-01",
      why: "по документу",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.draft).toMatchObject({ mode: "create", title: "УЗИ", reminders_label: "7д" });
      expect(built.draft.input).toMatchObject({ title: "УЗИ", category: "imaging" });
      expect(built.draft.input).not.toHaveProperty("reminder_days_before");
    }
  });

  it("puts empty reminders and owner notes on the initial create insert (no post-update)", async () => {
    const empty = {
      title: "УЗИ",
      category: "imaging" as const,
      schedule: { type: "one_off" as const, due_at: "2026-12-01" },
      why: "без напоминаний",
      notes: "взять направление",
      reminder_days_before: [] as number[],
    };
    const stub = createSupabaseStub({
      checkup_items: [
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [{ id: "new-1", title: "УЗИ", next_due_at: "2026-12-01" }] },
        { data: [] },
        { data: [] },
        { data: [{ id: "new-2", title: "ОАК", next_due_at: "2026-12-01" }] },
      ],
    });
    const built = await buildCreateCheckupDraft(stub.client, PERSON, empty);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.draft.reminders_label).toBe("нет");
      expect(built.draft.input.reminder_days_before).toEqual([]);
    }
    expect((await applyCheckupDraft(stub.client, PERSON, "create", empty)).ok).toBe(true);
    expect(stub.argsFor("checkup_items", "insert")[0][0]).toEqual([
      expect.objectContaining({
        title: "УЗИ",
        notes: "взять направление",
        reminder_days_before: [],
      }),
    ]);
    expect(stub.argsFor("checkup_items", "update")).toEqual([]);

    expect(
      (
        await applyCheckupDraft(stub.client, PERSON, "create", {
          title: "ОАК",
          category: "lab",
          schedule: { type: "one_off", due_at: "2026-12-01" },
          why: "clear",
          reminder_days_before: null,
        })
      ).ok,
    ).toBe(true);
    expect(stub.argsFor("checkup_items", "insert")[1][0]).toEqual([
      expect.objectContaining({ title: "ОАК", reminder_days_before: [] }),
    ]);
    expect(stub.argsFor("checkup_items", "update")).toEqual([]);
  });
});

describe("buildEditCheckupDraft / applyCheckupDraft", () => {
  it("edits title and status on an existing checkup", async () => {
    const current = item();
    const stub = createSupabaseStub({
      checkup_items: [
        { data: current },
        { data: { why_text: "контроль", notes: null } },
        { data: current },
        { data: null },
        { data: { ...current, title: "Панель крови", status: "paused" } },
      ],
    });
    expect(
      (
        await buildEditCheckupDraft(stub.client, PERSON, {
          checkup_id: "c-1",
          title: "Панель крови",
          status: "paused",
        })
      ).ok,
    ).toBe(true);
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

  it("previews reactivation + proposed due; apply writes active", async () => {
    const current = item({
      title: "One-off visit",
      category: "visit",
      status: "completed",
      schedule: { type: "one_off", due_at: "2026-01-01" },
      next_due_at: null,
      reminder_days_before: [],
    });
    const preview = createSupabaseStub({
      checkup_items: [{ data: current }, { data: { why_text: null, notes: null } }],
      checkup_completions: [{ count: 0 }],
    });
    const built = await buildEditCheckupDraft(preview.client, PERSON, {
      checkup_id: "c-1",
      schedule: { type: "interval", every: 1, unit: "year", first_due_at: "2027-01-01" },
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.draft.status_label).toBe("активен");
      expect(built.draft.first_due_label).toMatch(/2027/);
    }

    const applyStub = createSupabaseStub({
      checkup_items: [
        { data: current },
        { data: { why_text: null, notes: null } },
        { data: current },
        { data: null },
        { data: { ...current, status: "active" } },
      ],
      checkup_completions: [{ data: null }],
    });
    expect(
      (
        await applyCheckupDraft(applyStub.client, PERSON, "edit", {
          checkup_id: "c-1",
          schedule: { type: "interval", every: 1, unit: "year" },
        })
      ).ok,
    ).toBe(true);
    expect(applyStub.argsFor("checkup_items", "update")[0][0]).toMatchObject({
      status: "active",
      schedule: { type: "interval", every: 1, unit: "year" },
    });
  });

  it("edit preview: explicit clear vs omitted why/notes; proposed first_due not stale", async () => {
    const current = item({
      schedule: { type: "interval", every: 6, unit: "month", anchor_date: "2025-12-20" },
    });
    const clearStub = createSupabaseStub({
      checkup_items: [
        { data: current },
        { data: { why_text: "старый why", notes: "старые notes" } },
      ],
    });
    const cleared = await buildEditCheckupDraft(clearStub.client, PERSON, {
      checkup_id: "c-1",
      why_text: null,
      notes: "",
    });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.draft.why).toBeNull();
      expect(cleared.draft.notes).toBeNull();
      expect(cleared.draft.input).toMatchObject({ why_text: null, notes: null });
    }

    const keepStub = createSupabaseStub({
      checkup_items: [
        { data: current },
        { data: { why_text: "контроль", notes: "с собой направление" } },
      ],
    });
    const kept = await buildEditCheckupDraft(keepStub.client, PERSON, {
      checkup_id: "c-1",
      title: "Панель крови",
    });
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.draft).toMatchObject({ why: "контроль", notes: "с собой направление" });
      expect(kept.draft.input).not.toHaveProperty("why_text");
      expect(kept.draft.input).not.toHaveProperty("notes");
    }

    const dueStub = createSupabaseStub({
      checkup_items: [{ data: current }, { data: { why_text: null, notes: null } }],
      checkup_completions: [{ count: 0 }],
    });
    const due = await buildEditCheckupDraft(dueStub.client, PERSON, {
      checkup_id: "c-1",
      schedule: { type: "interval", every: 3, unit: "month", first_due_at: "2026-09-01" },
    });
    expect(due.ok).toBe(true);
    if (due.ok) {
      expect(due.draft.first_due_label).toMatch(/сентября 2026|1 сентября/);
      expect(due.draft.first_due_label).not.toMatch(/июня 2026|20 июня/);
    }
  });

  it("target next_due walks from anchor, not last completion", async () => {
    // Anchor 2026-01-01, every 3 months, done 2026-08-20 → DB stores 2026-10-01 (not Nov 20).
    const current = item({
      schedule: {
        type: "interval",
        every: 6,
        unit: "month",
        anchor_date: "2026-01-01",
        next_due_from: "target",
      },
      next_due_at: "2026-07-01",
    });
    const stub = createSupabaseStub({
      checkup_items: [{ data: current }, { data: { why_text: null, notes: null } }],
      checkup_completions: [{ data: { done_at: "2026-08-20" } }],
    });
    const built = await buildEditCheckupDraft(stub.client, PERSON, {
      checkup_id: "c-1",
      schedule: { type: "interval", every: 3, unit: "month", next_due_from: "target" },
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.draft.first_due_label).toMatch(/1 октября 2026|октября 2026/);
      expect(built.draft.first_due_label).not.toMatch(/ноября 2026|20 ноября/);
    }
  });

  it("one-off due change without completions previews active (DB trigger override)", async () => {
    const current = item({
      status: "paused",
      schedule: { type: "one_off", due_at: "2026-01-01" },
      next_due_at: "2026-01-01",
    });
    const stub = createSupabaseStub({
      checkup_items: [{ data: current }, { data: { why_text: null, notes: null } }],
      checkup_completions: [{ count: 0 }],
    });
    const built = await buildEditCheckupDraft(stub.client, PERSON, {
      checkup_id: "c-1",
      schedule: { type: "one_off", due_at: "2026-12-15" },
      status: "paused",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.draft.status_label).toBe("активен");
      expect(built.draft.first_due_label).toMatch(/15 декабря 2026|декабря 2026/);
    }
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
