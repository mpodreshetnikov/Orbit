import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MedicalRecordListItem } from "@/types";
import { RecordCard } from "./record-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({
    children,
    onClick,
  }: {
    asChild?: boolean;
    onClick?: (event: React.MouseEvent) => void;
    children: React.ReactNode;
  }) => <div onClick={onClick}>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

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
    llm_summary: null,
    llm_keywords: null,
    llm_suggested_checkup_completions: null,
    attachment_count: 2,
    ...overrides,
  } as MedicalRecordListItem;
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

    await user.click(screen.getByText("CBC Report"));
    expect(onView).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "records.actions.view" }));
    await user.click(screen.getByRole("button", { name: "records.actions.remove" }));

    expect(onView.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: "record-1" }));
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
    await user.click(screen.getByRole("button", { name: "records.actions.activate" }));
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
    await user.click(screen.getByRole("button", { name: "records.actions.restore" }));
    await user.click(screen.getByRole("button", { name: "records.actions.delete" }));

    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ status: "removed" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ status: "removed" }));
  });
});
