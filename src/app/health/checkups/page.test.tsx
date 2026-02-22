import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckupItem } from "@/types";
import CheckupsPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useCheckupItems: vi.fn(),
  useMedicalRecords: vi.fn(),
}));

let selectedPersonIdState: string | null = "person-1";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  useCheckupItems: (...args: unknown[]) => hookMocks.useCheckupItems(...args),
  useMedicalRecords: (...args: unknown[]) => hookMocks.useMedicalRecords(...args),
}));

vi.mock("@/components/checkups", () => ({
  CheckupCard: ({
    item,
    onMarkComplete,
    onPlan,
    selectionMode,
    selected,
    onToggleSelect,
  }: {
    item: CheckupItem;
    onMarkComplete: (item: CheckupItem) => void;
    onPlan: (item: CheckupItem) => void;
    selectionMode?: boolean;
    selected?: boolean;
    onToggleSelect?: (item: CheckupItem) => void;
  }) => (
    <div data-testid={`checkup-${item.id}`}>
      <span>{item.title}</span>
      <button type="button" onClick={() => onMarkComplete(item)}>
        mark-{item.id}
      </button>
      <button type="button" onClick={() => onPlan(item)}>
        plan-{item.id}
      </button>
      {selectionMode && (
        <button type="button" onClick={() => onToggleSelect?.(item)}>
          toggle-{item.id}-{selected ? "on" : "off"}
        </button>
      )}
    </div>
  ),
  MarkCompleteDialog: ({ open, item }: { open?: boolean; item?: CheckupItem | null }) =>
    open ? <div>{`mark-dialog-${item?.id}`}</div> : null,
  PlanDialog: ({
    open,
    items,
    onSaved,
    onOpenChange,
  }: {
    open?: boolean;
    items: CheckupItem[];
    onSaved?: () => void;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <div>
        <span>{`plan-dialog-${items.length}`}</span>
        <button type="button" onClick={() => onSaved?.()}>
          plan-save
        </button>
        <button type="button" onClick={() => onOpenChange?.(false)}>
          plan-close
        </button>
      </div>
    ) : null,
}));

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function makeCheckup(id: string, overrides: Partial<CheckupItem> = {}): CheckupItem {
  return {
    id,
    person_id: "person-1",
    title: `Checkup ${id}`,
    category: "lab",
    schedule: { type: "interval", every: 1, unit: "year" },
    next_due_at: dateOffset(1),
    status: "active",
    reminder_days_before: [],
    planned_on: null,
    why_text: null,
    why_links: [],
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("CheckupsPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    hookMocks.useMedicalRecords.mockReturnValue({ data: [] });
  });

  it("renders person prompt when no person is selected", () => {
    selectedPersonIdState = null;
    hookMocks.useCheckupItems.mockReturnValue({ data: [], isLoading: false });

    render(<CheckupsPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("renders loading and empty states", () => {
    hookMocks.useCheckupItems.mockReturnValue({ data: [], isLoading: true });
    const view = render(<CheckupsPage />);
    expect(screen.getByText("checkups.navTitle")).toBeInTheDocument();
    view.unmount();

    hookMocks.useCheckupItems.mockReturnValue({ data: [], isLoading: false });
    render(<CheckupsPage />);
    expect(screen.getByText("checkups.noItems")).toBeInTheDocument();
    expect(screen.getByText("checkups.noItemsHint")).toBeInTheDocument();
  });

  it("renders grouped sections and opens mark/plan dialogs", async () => {
    hookMocks.useCheckupItems.mockReturnValue({
      isLoading: false,
      data: [
        makeCheckup("overdue", { next_due_at: dateOffset(-3), status: "active" }),
        makeCheckup("upcoming", { next_due_at: dateOffset(2), status: "active" }),
        makeCheckup("later", { next_due_at: dateOffset(20), status: "active" }),
        makeCheckup("inactive", { status: "paused", next_due_at: null }),
      ],
    });

    render(<CheckupsPage />);
    const user = userEvent.setup();

    expect(screen.getAllByText("checkups.overdue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("checkups.upcoming").length).toBeGreaterThan(0);
    expect(screen.getAllByText("checkups.later").length).toBeGreaterThan(0);
    expect(screen.getAllByText("checkups.inactive").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "mark-overdue" }));
    expect(screen.getByText("mark-dialog-overdue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "plan-upcoming" }));
    expect(screen.getByText("plan-dialog-1")).toBeInTheDocument();
  });

  it("supports selection mode and plan selected flow", async () => {
    hookMocks.useCheckupItems.mockReturnValue({
      isLoading: false,
      data: [
        makeCheckup("item-1", { status: "active", next_due_at: dateOffset(1) }),
        makeCheckup("item-2", { status: "active", next_due_at: dateOffset(2) }),
      ],
    });

    render(<CheckupsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "checkups.selectToPlan" }));
    expect(screen.getByRole("button", { name: "toggle-item-1-off" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "toggle-item-1-off" }));
    await user.click(screen.getByRole("button", { name: /checkups.planSelected/ }));
    expect(screen.getByText("plan-dialog-1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "plan-save" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "checkups.selectToPlan" })).toBeInTheDocument();
    });
  });
});
