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
  useRuleOnProposedClosure: vi.fn(),
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
const ruleMutateAsync = vi.fn();

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
  useRuleOnProposedClosure: (...args: unknown[]) => hookMocks.useRuleOnProposedClosure(...args),
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
    ruleMutateAsync.mockReset();
    ruleMutateAsync.mockResolvedValue(undefined);
    hookMocks.useRuleOnProposedClosure.mockReturnValue({
      ruleOnClosure: ruleMutateAsync,
      rulingOnId: null,
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

  describe("ruling on a proposed closure", () => {
    const pendingClosure = {
      id: "hist-pending",
      record_id: "rec-2",
      status_in_record: "resolved",
      source_anchor: "Витамин В12\t704.00\tпг/мл\t187.00–883.00",
      confidence: 0.9,
      is_llm_extracted: true,
      is_user_verified: false,
      supporting_obs_code: "vitamin_b12",
      review_decision: "pending",
      created_at: "2026-03-06T08:00:00.000Z",
      record_title: "Lab",
      record_date: "2026-03-06",
      record_type: "lab",
      supporting_observation: {
        obs_name: "Витамин B12",
        value_numeric: 704,
        value_text: null,
        unit: "пг/мл",
        ref_range_low: 187,
        ref_range_high: 883,
        status: "normal",
      },
    };

    const refetchMock = vi.fn();

    async function renderWith(history: Record<string, unknown>[]) {
      refetchMock.mockClear();
      hookMocks.useConditionDetail.mockReturnValue({
        data: makeCondition({ history, mention_count: history.length }),
        isLoading: false,
        error: null,
        refetch: refetchMock,
      });
      const Page = (await import("./page")).default;
      render(<Page params={resolvedParams("cond-1")} />);
    }

    it("shows the measurement the proposal rests on, read back rather than asserted", async () => {
      await renderWith([pendingClosure]);

      expect(screen.getByText("conditions.awaitingReview")).toBeInTheDocument();
      expect(screen.getByText("Витамин B12")).toBeInTheDocument();
      expect(screen.getByText("704 пг/мл")).toBeInTheDocument();
      expect(screen.getByText("(187–883)")).toBeInTheDocument();
    });

    it("says so when the measurement it cited is no longer on the record", async () => {
      // The reviewer corrected, recoded or deleted it. Saying "the evidence is gone" is the whole
      // reason the citation is stored, and it is not the same as having nothing to show.
      await renderWith([{ ...pendingClosure, supporting_observation: null }]);

      expect(screen.getByText("conditions.measurementGone")).toBeInTheDocument();
      expect(screen.queryByText("Витамин B12")).not.toBeInTheDocument();
    });

    it("confirming verifies the mention, which is what lets it reach the chart", async () => {
      await renderWith([pendingClosure]);

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: /conditions.confirmClosure/ }));

      await waitFor(() => {
        expect(ruleMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "hist-pending",
            record_id: "rec-2",
            condition_id: "cond-1",
            supporting_obs_code: "vitamin_b12",
          }),
          "confirmed",
        );
      });
    });

    it("dismissing records the decision and neither verifies nor deletes the row", async () => {
      await renderWith([pendingClosure]);

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "conditions.dismissClosure" }));

      await waitFor(() => {
        expect(ruleMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ id: "hist-pending" }),
          "dismissed",
        );
      });
    });

    it("offers no ruling on a mention nobody needs to rule on", async () => {
      await renderWith([
        { ...pendingClosure, is_user_verified: true, review_decision: "confirmed" },
      ]);

      expect(screen.queryByRole("button", { name: /conditions.confirmClosure/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "conditions.dismissClosure" })).toBeNull();
    });

    it("re-reads the page when a ruling is refused, so the stale evidence stops showing", async () => {
      // The guard itself lives in useRuleOnProposedClosure and is tested there. What this page owes
      // is not to keep displaying a measurement the record no longer supports.
      ruleMutateAsync.mockResolvedValueOnce(false);
      await renderWith([pendingClosure]);

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: /conditions.confirmClosure/ }));

      await waitFor(() => expect(refetchMock).toHaveBeenCalled());
    });

    it("offers no ruling once a person has dismissed it", async () => {
      // Still a suppressed closure forever, but no longer waiting on anyone.
      await renderWith([{ ...pendingClosure, review_decision: "dismissed" }]);

      expect(screen.queryByRole("button", { name: /conditions.confirmClosure/ })).toBeNull();
      expect(screen.queryByText("conditions.awaitingReview")).toBeNull();
    });

    it("shows a dismissed proposal as dismissed rather than as untouched", async () => {
      await renderWith([{ ...pendingClosure, review_decision: "dismissed" }]);

      expect(screen.getByText("conditions.dismissed")).toBeInTheDocument();
    });
  });
});
