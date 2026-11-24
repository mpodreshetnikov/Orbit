import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MedicalRecordListItem } from "@/types";
import { RecordCard } from "./record-card-view";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/date-locale", async () => {
  const { ru } = await import("date-fns/locale");
  return { useDateFnsLocale: () => ru };
});

function makeRecord(overrides: Partial<MedicalRecordListItem> = {}): MedicalRecordListItem {
  return {
    id: "record-1",
    person_id: "person-1",
    created_by_user_id: "user-1",
    record_type: "lab",
    record_date: "2026-02-10",
    title: "CBC Report",
    notes: "follow-up notes",
    status: "active",
    removed_at: null,
    created_at: "2026-02-10T00:00:00.000Z",
    updated_at: "2026-02-10T00:00:00.000Z",
    ocr_text: null,
    ocr_error: null,
    structure_error: null,
    llm_summary: null,
    llm_keywords: null,
    llm_suggested_checkup_completions: null,
    attachment_count: 2,
    ...overrides,
  };
}

function openActions(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "common.actions" }));
}

describe("RecordCard", () => {
  it("handles active-record actions and card click", async () => {
    const onView = vi.fn();
    const onRemove = vi.fn();
    const user = userEvent.setup();

    render(
      <RecordCard
        record={makeRecord()}
        onView={onView}
        onRemove={onRemove}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("CBC Report")).toBeInTheDocument();
    expect(screen.getByText("records.types.lab")).toBeInTheDocument();
    expect(screen.getByText("follow-up notes")).toBeInTheDocument();
    expect(screen.getByText("фев. 10, 2026")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();

    await user.click(screen.getByText("CBC Report"));
    expect(onView).toHaveBeenCalledTimes(1);

    await openActions(user);
    expect(onView).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("menuitem", { name: "records.actions.view" }));
    await openActions(user);
    await user.click(screen.getByRole("menuitem", { name: "records.actions.remove" }));

    expect(onView.mock.calls).toEqual([[makeRecord()], [makeRecord()]]);
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: "record-1" }));
  });

  it.each([
    { status: "active", faded: false, mutedBorder: false },
    { status: "removed", faded: true, mutedBorder: false },
    { status: "ocr_failed", faded: false, mutedBorder: true },
  ] as const)(
    "styles $status records and omits absent attachment and note metadata",
    ({ status, faded, mutedBorder }) => {
      const { container } = render(
        <RecordCard
          record={makeRecord({ status, attachment_count: 0, notes: null })}
          onView={vi.fn()}
          onRemove={vi.fn()}
        />,
      );

      expect(container.firstElementChild?.classList.contains("opacity-60")).toBe(faded);
      expect(container.firstElementChild?.classList.contains("border-muted-foreground/30")).toBe(
        mutedBorder,
      );
      expect(screen.queryByText("0")).not.toBeInTheDocument();
      expect(screen.queryByRole("paragraph")).not.toBeInTheDocument();
    },
  );

  it.each([
    { status: "active" as const, provideActions: true },
    { status: "draft" as const, provideActions: false },
    { status: "removed" as const, provideActions: false },
  ])("hides inapplicable actions for $status records", async ({ status, provideActions }) => {
    render(
      <RecordCard
        record={makeRecord({ status })}
        onView={vi.fn()}
        onRemove={vi.fn()}
        onActivate={provideActions ? vi.fn() : undefined}
        onRestore={provideActions ? vi.fn() : undefined}
        onDelete={provideActions ? vi.fn() : undefined}
      />,
    );
    await openActions(userEvent.setup());

    const menu = within(screen.getByRole("menu"));
    for (const action of ["activate", "restore", "delete"]) {
      expect(
        menu.queryByRole("menuitem", { name: `records.actions.${action}` }),
      ).not.toBeInTheDocument();
    }
  });

  it("handles draft and removed state actions", async () => {
    const onActivate = vi.fn();
    const onRestore = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <RecordCard
        record={makeRecord({ status: "draft", attachment_count: 0 })}
        onView={vi.fn()}
        onRemove={vi.fn()}
        onActivate={onActivate}
      />,
    );

    expect(screen.getByText("records.status.draft")).toBeInTheDocument();
    await openActions(user);
    await user.click(screen.getByRole("menuitem", { name: "records.actions.activate" }));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));

    rerender(
      <RecordCard
        record={makeRecord({ status: "removed" })}
        onView={vi.fn()}
        onRemove={vi.fn()}
        onRestore={onRestore}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText("records.status.removed")).toBeInTheDocument();
    await openActions(user);
    await user.click(screen.getByRole("menuitem", { name: "records.actions.restore" }));
    await openActions(user);
    await user.click(screen.getByRole("menuitem", { name: "records.actions.delete" }));

    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ status: "removed" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ status: "removed" }));
  });

  it("keeps soft-remove for ocr_failed", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    const record = makeRecord({ status: "ocr_failed" });
    render(<RecordCard record={record} onView={vi.fn()} onRemove={onRemove} />);

    expect(screen.getByText("records.status.notProcessed")).toBeInTheDocument();
    await openActions(user);
    await user.click(screen.getByRole("menuitem", { name: "records.actions.remove" }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(record);
  });

  it.each(["ocr_processing", "processing"] as const)("hides soft-remove for %s", async (status) => {
    render(<RecordCard record={makeRecord({ status })} onView={vi.fn()} onRemove={vi.fn()} />);
    await openActions(userEvent.setup());
    expect(
      screen.queryByRole("menuitem", { name: "records.actions.remove" }),
    ).not.toBeInTheDocument();
  });
});
