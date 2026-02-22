import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkCompleteDialog } from "./mark-complete-dialog";

const hookMocks = vi.hoisted(() => ({
  useCompleteCheckupItem: vi.fn(),
  useUpdateCheckupItem: vi.fn(),
}));

const completeMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useCompleteCheckupItem: (...args: unknown[]) => hookMocks.useCompleteCheckupItem(...args),
  useUpdateCheckupItem: (...args: unknown[]) => hookMocks.useUpdateCheckupItem(...args),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => <div>{open ? children : null}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    title: "Blood pressure check",
    planned_on: "2026-02-10",
    ...overrides,
  } as unknown as import("@/types").CheckupItem;
}

describe("MarkCompleteDialog", () => {
  beforeEach(() => {
    completeMutateAsync.mockReset();
    updateMutateAsync.mockReset();
    completeMutateAsync.mockResolvedValue(undefined);
    updateMutateAsync.mockResolvedValue(undefined);

    hookMocks.useCompleteCheckupItem.mockReturnValue({
      mutateAsync: completeMutateAsync,
      isPending: false,
    });
    hookMocks.useUpdateCheckupItem.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    });
  });

  it("submits completion with selected evidence record and clears planned date", async () => {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    render(
      <MarkCompleteDialog
        open
        onOpenChange={onOpenChange}
        item={makeItem()}
        records={
          [
            { id: "rec-1", title: "Visit note", record_date: "2026-02-09" },
            { id: "rec-2", title: "Lab note", record_date: "2026-02-08" },
          ] as unknown as import("@/types").MedicalRecordListItem[]
        }
        onSaved={onSaved}
      />,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("checkups.completionNote"), "done note");
    await user.click(screen.getByRole("button", { name: /Visit note/ }));
    await user.click(screen.getByRole("button", { name: "checkups.markComplete" }));

    await waitFor(() => {
      expect(completeMutateAsync).toHaveBeenCalledWith({
        checkup_item_id: "item-1",
        done_at: expect.any(String),
        note: "done note",
        evidence_record_id: "rec-1",
      });
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: "item-1",
        updates: { planned_on: null },
      });
      expect(onSaved).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("skips planned_on update when item has no planned date", async () => {
    render(
      <MarkCompleteDialog
        open
        onOpenChange={vi.fn()}
        item={makeItem({ planned_on: null })}
        records={[] as import("@/types").MedicalRecordListItem[]}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "checkups.markComplete" }));
    await waitFor(() => {
      expect(completeMutateAsync).toHaveBeenCalled();
      expect(updateMutateAsync).not.toHaveBeenCalled();
    });
  });

  it("returns null when item is missing", () => {
    const { container } = render(
      <MarkCompleteDialog open onOpenChange={vi.fn()} item={null} records={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
