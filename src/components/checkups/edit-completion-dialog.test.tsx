import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditCompletionDialog } from "./edit-completion-dialog";

const hookMocks = vi.hoisted(() => ({
  useUpdateCheckupCompletion: vi.fn(),
  useDeleteCheckupCompletion: vi.fn(),
}));

const updateMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useUpdateCheckupCompletion: (...args: unknown[]) => hookMocks.useUpdateCheckupCompletion(...args),
  useDeleteCheckupCompletion: (...args: unknown[]) => hookMocks.useDeleteCheckupCompletion(...args),
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

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => <div>{open ? children : null}</div>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

function makeCompletion(overrides: Record<string, unknown> = {}) {
  return {
    id: "comp-1",
    checkup_item_id: "item-1",
    done_at: "2026-02-10",
    note: "old note",
    evidence_record_id: "rec-1",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as unknown as import("@/types").CheckupCompletion;
}

describe("EditCompletionDialog", () => {
  beforeEach(() => {
    updateMutateAsync.mockReset();
    deleteMutateAsync.mockReset();
    updateMutateAsync.mockResolvedValue(undefined);
    deleteMutateAsync.mockResolvedValue(undefined);

    hookMocks.useUpdateCheckupCompletion.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    });
    hookMocks.useDeleteCheckupCompletion.mockReturnValue({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    });
  });

  it("updates completion payload and supports unlinking evidence record", async () => {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <EditCompletionDialog
        open
        onOpenChange={onOpenChange}
        completion={makeCompletion()}
        records={
          [
            { id: "rec-1", title: "Visit", record_date: "2026-02-10" },
            { id: "rec-2", title: "Lab", record_date: "2026-02-08" },
          ] as unknown as import("@/types").MedicalRecordListItem[]
        }
        onSaved={onSaved}
      />,
    );

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("checkups.completionNote"));
    await user.type(screen.getByLabelText("checkups.completionNote"), "updated");
    await user.click(screen.getByRole("button", { name: "checkups.noRecord" }));
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: "comp-1",
        updates: {
          done_at: "2026-02-10",
          note: "updated",
          evidence_record_id: null,
        },
      });
      expect(onSaved).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("deletes completion after confirmation", async () => {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <EditCompletionDialog
        open
        onOpenChange={onOpenChange}
        completion={makeCompletion()}
        records={[] as import("@/types").MedicalRecordListItem[]}
        onSaved={onSaved}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "common.delete" }));
    await user.click(screen.getAllByRole("button", { name: "common.delete" })[1]);

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith({
        id: "comp-1",
        checkupItemId: "item-1",
      });
      expect(onSaved).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("returns null when completion is missing", () => {
    const { container } = render(
      <EditCompletionDialog open onOpenChange={vi.fn()} completion={null} records={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
