import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useConditionDetail: vi.fn(),
  useUpdateCondition: vi.fn(),
  useDeleteCondition: vi.fn(),
  useIcdLookup: vi.fn(),
  useMedicalRecords: vi.fn(),
  useCheckupsForCondition: vi.fn(),
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

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("@/hooks", () => ({
  useConditionDetail: (...args: unknown[]) => hookMocks.useConditionDetail(...args),
  useUpdateCondition: (...args: unknown[]) => hookMocks.useUpdateCondition(...args),
  useDeleteCondition: (...args: unknown[]) => hookMocks.useDeleteCondition(...args),
  useIcdLookup: (...args: unknown[]) => hookMocks.useIcdLookup(...args),
  useMedicalRecords: (...args: unknown[]) => hookMocks.useMedicalRecords(...args),
  useCheckupsForCondition: (...args: unknown[]) => hookMocks.useCheckupsForCondition(...args),
}));

vi.mock("@/components/conditions", () => ({
  ConditionStatusBadge: ({ status }: { status: string }) => <span>status:{status}</span>,
  ConditionAddHistoryDialog: ({ open, onSaved }: { open: boolean; onSaved?: () => void }) =>
    open ? (
      <div>
        condition-history-dialog
        <button type="button" onClick={onSaved}>
          history-saved
        </button>
      </div>
    ) : null,
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

function resolvedParams(id: string): Promise<{ id: string }> {
  return {
    status: "fulfilled",
    value: { id },
    then: (resolve: (value: { id: string }) => void) => resolve({ id }),
  } as unknown as Promise<{ id: string }>;
}

function makeCondition(overrides: Record<string, unknown> = {}) {
  return {
    id: "cond-1",
    person_id: "person-1",
    name: "Asthma",
    icd_name_en: "Asthma official",
    icd_name_ru: null,
    code: "J45",
    current_status: "active",
    onset_date: "2025-01-01",
    resolved_date: null,
    notes: "baseline note",
    created_at: "2025-01-01T08:00:00.000Z",
    updated_at: "2025-01-02T08:00:00.000Z",
    deleted_at: null,
    mention_count: 1,
    first_mentioned_date: "2025-01-01",
    last_mentioned_date: "2025-01-01",
    history: [
      {
        id: "hist-1",
        record_id: "rec-1",
        status_in_record: "active",
        source_anchor: "anchor text",
        confidence: null,
        is_llm_extracted: false,
        is_user_verified: true,
        created_at: "2025-01-01T08:00:00.000Z",
        record_title: "Visit note",
        record_date: "2025-01-01",
        record_type: "visit",
      },
    ],
    ...overrides,
  };
}

describe("ConditionDetailPage", () => {
  beforeEach(() => {
    routerMock.back.mockReset();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    updateMutateAsync.mockReset();
    deleteMutateAsync.mockReset();
    updateMutateAsync.mockResolvedValue(undefined);
    deleteMutateAsync.mockResolvedValue(undefined);

    hookMocks.useUpdateCondition.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    });
    hookMocks.useDeleteCondition.mockReturnValue({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    });
    hookMocks.useIcdLookup.mockReturnValue({
      data: { found: true, name_en: "Asthma official" },
      isLoading: false,
    });
    hookMocks.useMedicalRecords.mockReturnValue({
      data: [{ id: "rec-1", title: "Visit note", record_date: "2025-01-01" }],
    });
    hookMocks.useCheckupsForCondition.mockReturnValue({
      data: [{ id: "chk-1", title: "Pulmo follow-up", next_due_at: "2025-03-10" }],
    });
  });

  it("renders loading and not-found/error states", async () => {
    const Page = (await import("./page")).default;

    hookMocks.useConditionDetail.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });
    const loadingView = render(<Page params={resolvedParams("cond-1")} />);
    expect(loadingView.container.querySelector(".animate-pulse")).toBeTruthy();
    loadingView.unmount();

    hookMocks.useConditionDetail.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error("not found"),
      refetch: vi.fn(),
    });
    render(<Page params={resolvedParams("cond-1")} />);

    expect(screen.getByText("conditions.conditionNotFound")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "common.back" }));
    expect(routerMock.back).toHaveBeenCalled();
  });

  it("renders condition details, linked checkups, and saves edits", async () => {
    const refetch = vi.fn();
    hookMocks.useConditionDetail.mockReturnValue({
      data: makeCondition(),
      isLoading: false,
      error: null,
      refetch,
    });

    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("cond-1")} />);

    expect(screen.getByText("Asthma")).toBeInTheDocument();
    expect(screen.getByText("Visit note")).toBeInTheDocument();
    expect(screen.getByText("Pulmo follow-up")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "common.edit" }));
    await user.clear(screen.getByLabelText("conditions.name"));
    await user.type(screen.getByLabelText("conditions.name"), "Updated asthma");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: "cond-1",
        updates: expect.objectContaining({
          name: "Updated asthma",
          code: "J45",
          icd_name_en: "Asthma official",
        }),
      });
    });

    await user.click(screen.getByRole("button", { name: "conditions.addToHistory" }));
    expect(screen.getByText("condition-history-dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "history-saved" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("handles delete flow when condition can be deleted", async () => {
    hookMocks.useConditionDetail.mockReturnValue({
      data: makeCondition({ mention_count: 0, history: [] }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    hookMocks.useCheckupsForCondition.mockReturnValue({ data: [] });

    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("cond-1")} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "conditions.deleteCondition" }));
    await user.click(screen.getAllByRole("button", { name: "conditions.deleteCondition" })[1]);

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith({
        id: "cond-1",
        personId: "person-1",
      });
      expect(routerMock.push).toHaveBeenCalledWith("/health/conditions");
    });
  });
});
