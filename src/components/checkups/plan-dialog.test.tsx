import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanDialog } from "./plan-dialog";

const hookMocks = vi.hoisted(() => ({
  useUpdateCheckupItem: vi.fn(),
}));

const mutateAsyncMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
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
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    person_id: "person-1",
    title: "Blood panel",
    category: "lab",
    schedule: { type: "interval", every: 1, unit: "year" },
    next_due_at: "2026-01-01",
    status: "active",
    reminder_days_before: [7],
    planned_on: null,
    why_text: null,
    why_links: [],
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as unknown as import("@/types").CheckupItem;
}

describe("PlanDialog", () => {
  beforeEach(() => {
    mutateAsyncMock.mockReset();
    mutateAsyncMock.mockResolvedValue(undefined);
    hookMocks.useUpdateCheckupItem.mockReturnValue({
      mutateAsync: mutateAsyncMock,
      isPending: false,
    });
  });

  it("returns null when there are no items", () => {
    const { container } = render(
      <PlanDialog open onOpenChange={vi.fn()} items={[]} onSaved={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("saves planned date for a single item and closes", async () => {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<PlanDialog open onOpenChange={onOpenChange} items={[makeItem()]} onSaved={onSaved} />);

    await user.clear(screen.getByLabelText("checkups.plannedOn"));
    await user.type(screen.getByLabelText("checkups.plannedOn"), "2026-02-20");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        id: "item-1",
        updates: { planned_on: "2026-02-20" },
      });
      expect(onSaved).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("removes planned date for batch items", async () => {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(
      <PlanDialog
        open
        onOpenChange={onOpenChange}
        items={[
          makeItem({ id: "item-1", planned_on: "2026-01-10" }),
          makeItem({ id: "item-2", planned_on: null }),
        ]}
        onSaved={onSaved}
      />,
    );

    await user.click(screen.getByRole("button", { name: "checkups.removePlannedDate" }));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenNthCalledWith(1, {
        id: "item-1",
        updates: { planned_on: null },
      });
      expect(mutateAsyncMock).toHaveBeenNthCalledWith(2, {
        id: "item-2",
        updates: { planned_on: null },
      });
      expect(onSaved).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
