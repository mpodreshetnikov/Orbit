import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckupCompletion, CheckupItem } from "@/types";

const hookMocks = vi.hoisted(() => ({
  useCheckupItem: vi.fn(),
  useCheckupCompletions: vi.fn(),
  useUpdateCheckupItem: vi.fn(),
  useDeleteCheckupItem: vi.fn(),
  useMedicalRecords: vi.fn(),
}));

const routerMock = {
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

const updateMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();
const refetchMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (!values) return key;
    return Object.entries(values).reduce(
      (message, [valueKey, value]) => message.replaceAll(`{${valueKey}}`, String(value)),
      key,
    );
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("@/hooks", () => ({
  useCheckupItem: (...args: unknown[]) => hookMocks.useCheckupItem(...args),
  useCheckupCompletions: (...args: unknown[]) => hookMocks.useCheckupCompletions(...args),
  useUpdateCheckupItem: (...args: unknown[]) => hookMocks.useUpdateCheckupItem(...args),
  useDeleteCheckupItem: (...args: unknown[]) => hookMocks.useDeleteCheckupItem(...args),
  useMedicalRecords: (...args: unknown[]) => hookMocks.useMedicalRecords(...args),
}));

vi.mock("@/components/checkups", () => ({
  MarkCompleteDialog: ({ open }: { open: boolean }) =>
    open ? <div>mark-complete-dialog</div> : null,
  EditCompletionDialog: ({ open }: { open: boolean }) =>
    open ? <div>edit-completion-dialog</div> : null,
  PlanDialog: ({ open }: { open: boolean }) => (open ? <div>plan-dialog</div> : null),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function resolvedParams(id: string): Promise<{ id: string }> {
  return {
    status: "fulfilled",
    value: { id },
    then: (resolve: (value: { id: string }) => void) => resolve({ id }),
  } as unknown as Promise<{ id: string }>;
}

function checkup(overrides: Partial<CheckupItem> = {}): CheckupItem {
  return {
    id: "checkup-1",
    person_id: "person-1",
    title: "Blood panel",
    category: "lab",
    schedule: { type: "interval", every: 6, unit: "month", next_due_from: "completion" },
    next_due_at: "2026-08-01",
    status: "active",
    reminder_days_before: [7, 1],
    planned_on: "2026-03-01",
    why_text: "Routine monitoring",
    why_links: [{ type: "condition", id: "cond-1", label: "Hypertension" }],
    notes: "Bring previous reports",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function completion(overrides: Partial<CheckupCompletion> = {}): CheckupCompletion {
  return {
    id: "completion-1",
    checkup_item_id: "checkup-1",
    done_at: "2026-02-01T00:00:00.000Z",
    note: "Completed at clinic",
    evidence_record_id: "record-1",
    created_at: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("CheckupDetailPage", () => {
  beforeEach(() => {
    routerMock.back.mockReset();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    refetchMock.mockReset();
    updateMutateAsync.mockReset();
    deleteMutateAsync.mockReset();
    updateMutateAsync.mockResolvedValue(undefined);
    deleteMutateAsync.mockResolvedValue(undefined);

    hookMocks.useCheckupItem.mockReturnValue({
      data: checkup(),
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    hookMocks.useCheckupCompletions.mockReturnValue({ data: [] });
    hookMocks.useUpdateCheckupItem.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    });
    hookMocks.useDeleteCheckupItem.mockReturnValue({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    });
    hookMocks.useMedicalRecords.mockReturnValue({ data: [] });
  });

  it("renders loading and error states", async () => {
    hookMocks.useCheckupItem.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: refetchMock,
    });
    const Page = (await import("./page")).default;
    const loading = render(<Page params={resolvedParams("checkup-1")} />);
    expect(loading.container.querySelector(".animate-pulse")).toBeTruthy();
    loading.unmount();

    hookMocks.useCheckupItem.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error("fail"),
      refetch: refetchMock,
    });
    render(<Page params={resolvedParams("checkup-1")} />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
  });

  it("executes active-item actions including pause/archive/remove-plan/delete", async () => {
    const user = userEvent.setup();
    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("checkup-1")} />);

    expect(screen.getByText("Blood panel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "checkups.pause" }));
    await user.click(screen.getByRole("button", { name: "checkups.archive" }));
    await user.click(screen.getByRole("button", { name: "checkups.removePlannedDate" }));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: "checkup-1",
        updates: { status: "paused" },
      });
    });
    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: "checkup-1",
      updates: { status: "archived" },
    });
    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: "checkup-1",
      updates: { planned_on: null },
    });

    await user.click(screen.getByRole("button", { name: "checkups.deleteCheckup" }));
    await user.click(screen.getAllByRole("button", { name: "checkups.deleteCheckup" }).at(-1)!);

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith({ id: "checkup-1", personId: "person-1" });
      expect(routerMock.push).toHaveBeenCalledWith("/health/checkups");
    });
  });

  it("renders paused one-off item branches and completion history actions", async () => {
    const user = userEvent.setup();
    hookMocks.useCheckupItem.mockReturnValue({
      data: checkup({
        status: "paused",
        schedule: { type: "one_off", due_at: "2026-09-01" },
        planned_on: null,
      }),
      isLoading: false,
      error: null,
      refetch: refetchMock,
    });
    hookMocks.useCheckupCompletions.mockReturnValue({ data: [completion()] });

    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("checkup-1")} />);

    expect(screen.getByText("checkups.oneOff: 01 Sep 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "checkups.resume" })).toBeInTheDocument();
    expect(screen.getByText("checkups.evidence")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "checkups.resume" }));
    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: "checkup-1",
      updates: { status: "active" },
    });

    await user.click(screen.getByRole("button", { name: "common.edit" }));
    expect(screen.getByText("edit-completion-dialog")).toBeInTheDocument();
  });
});
