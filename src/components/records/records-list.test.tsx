import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedicalRecordFilters, MedicalRecordListItem } from "@/types";
import { RecordsList } from "./records-list-view";

const hookMocks = vi.hoisted(() => ({
  useMedicalRecords: vi.fn(),
  useSoftDeleteRecord: vi.fn(),
  useRestoreRecord: vi.fn(),
  useHardDeleteRecord: vi.fn(),
  useUpdateMedicalRecord: vi.fn(),
}));

const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

let searchParamsState = new URLSearchParams();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => searchParamsState,
  usePathname: () => "/health/records",
}));

vi.mock("@/hooks", () => ({
  useMedicalRecords: (...args: unknown[]) => hookMocks.useMedicalRecords(...args),
  useSoftDeleteRecord: (...args: unknown[]) => hookMocks.useSoftDeleteRecord(...args),
  useRestoreRecord: (...args: unknown[]) => hookMocks.useRestoreRecord(...args),
  useHardDeleteRecord: (...args: unknown[]) => hookMocks.useHardDeleteRecord(...args),
  useUpdateMedicalRecord: (...args: unknown[]) => hookMocks.useUpdateMedicalRecord(...args),
}));

function baseRecord(overrides: Partial<MedicalRecordListItem> = {}): MedicalRecordListItem {
  return {
    id: "record-1",
    person_id: "person-1",
    created_by_user_id: "user-1",
    title: "CBC",
    notes: null,
    status: "active",
    removed_at: null,
    record_type: "lab",
    record_date: "2026-01-01",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ocr_text: null,
    ocr_error: null,
    structure_error: null,
    llm_summary: null,
    llm_keywords: null,
    llm_suggested_checkup_completions: null,
    attachment_count: 0,
    ...overrides,
  };
}

describe("RecordsList Decision B", () => {
  beforeEach(() => {
    searchParamsState = new URLSearchParams();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    hookMocks.useSoftDeleteRecord.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    hookMocks.useRestoreRecord.mockReturnValue({ mutate: vi.fn() });
    hookMocks.useHardDeleteRecord.mockReturnValue({ mutate: vi.fn() });
    hookMocks.useUpdateMedicalRecord.mockReturnValue({ mutate: vi.fn() });
    hookMocks.useMedicalRecords.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
  });

  it("has no upload CTA and uses not-processed tab copy", () => {
    render(<RecordsList personId="person-1" personName="Ada" />);
    expect(screen.queryByText("health.addRecord")).not.toBeInTheDocument();
    expect(screen.getByText("records.statusFilter.notProcessed")).toBeInTheDocument();
    expect(screen.getByText("health.noRecordsViaAssistant")).toBeInTheDocument();
  });

  it("opens an existing record from the active list", async () => {
    const user = userEvent.setup();
    hookMocks.useMedicalRecords.mockReturnValue({
      data: [baseRecord()],
      isLoading: false,
      error: null,
    });
    render(<RecordsList personId="person-1" personName="Ada" />);
    expect(screen.queryByText("health.addRecord")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "health.noRecords" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("heading", { name: "CBC" }));
    expect(routerMock.push).toHaveBeenCalledWith("/health/records/record-1");
  });

  it.each([
    ["active", "active", "health.noRecords", "file-text"],
    ["draft", "drafts", "records.noDrafts", "file-stack"],
    ["processing", "notProcessed", "records.noNotProcessed", "circle-slash"],
    ["removed", "removed", "common.noResults", "file-text"],
  ])("selects the %s tab and identifies its empty state", (tab, label, title, icon) => {
    searchParamsState = new URLSearchParams(`tab=${tab}`);
    render(<RecordsList personId="person-1" personName="Ada" />);

    const selected = screen.getByRole("button", { name: `records.statusFilter.${label}` });
    expect(selected).toHaveClass("bg-secondary");
    for (const other of screen.getAllByRole("button", { name: /^records.statusFilter\./ })) {
      if (other !== selected) expect(other).not.toHaveClass("bg-secondary");
    }
    const empty = screen.getByRole("heading", { name: title }).parentElement;
    expect(empty?.querySelectorAll("svg")).toHaveLength(1);
    expect(empty?.querySelector("svg")).toHaveClass(`lucide-${icon}`);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it.each([
    ["active", "?person=ada"],
    ["drafts", "?person=ada&tab=draft&showDrafts=true"],
    ["notProcessed", "?person=ada&tab=processing&showDrafts=true"],
    ["removed", "?person=ada&tab=removed&showDrafts=true"],
  ])("writes the %s tab to the URL and preserves unrelated parameters", async (label, query) => {
    searchParamsState = new URLSearchParams("person=ada&tab=removed&showDrafts=true");
    render(<RecordsList personId="person-1" personName="Ada" />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: `records.statusFilter.${label}` }));

    expect(routerMock.push).toHaveBeenCalledExactlyOnceWith(`/health/records${query}`);
  });

  it("returns to the plain records URL when only tab filters are present", async () => {
    searchParamsState = new URLSearchParams("tab=removed&showDrafts=true");
    render(<RecordsList personId="person-1" personName="Ada" />);

    expect(screen.getByRole("heading", { name: "common.noResults" })).toBeVisible();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "records.statusFilter.active" }));

    expect(routerMock.push).toHaveBeenCalledExactlyOnceWith("/health/records");
  });

  it("lists the selected person's records and accents other tabs with pending work", () => {
    hookMocks.useMedicalRecords.mockImplementation((filters?: MedicalRecordFilters) => {
      const { status, person_id: personId } = filters ?? {};
      const data =
        personId === "person-1" && status
          ? [baseRecord({ title: `Ada ${status}`, status })]
          : personId === "person-2" && status === "processing"
            ? [baseRecord({ title: "Lin OCR", status: "ocr_processing" })]
            : undefined;
      return { data, isLoading: false, error: null };
    });
    const { rerender } = render(<RecordsList personId="person-1" personName="Ada" />);
    const drafts = () => screen.getByRole("button", { name: /records.statusFilter.drafts/ });
    const unprocessed = () =>
      screen.getByRole("button", { name: /records.statusFilter.notProcessed/ });

    expect(screen.getByRole("heading", { name: "Ada active" })).toBeVisible();
    expect(drafts()).toHaveClass("text-primary");
    expect(unprocessed()).toHaveClass("text-primary");
    expect(within(drafts()).getByText("1")).toBeVisible();
    expect(within(unprocessed()).getByText("1")).toBeVisible();

    searchParamsState = new URLSearchParams("tab=draft");
    rerender(<RecordsList personId="person-1" personName="Ada" />);
    expect(screen.getByRole("heading", { name: "Ada draft" })).toBeVisible();
    expect(drafts()).not.toHaveClass("text-primary");
    expect(within(drafts()).queryByText("1")).not.toBeInTheDocument();
    expect(unprocessed()).toHaveClass("text-primary");

    searchParamsState = new URLSearchParams("tab=processing");
    rerender(<RecordsList personId="person-1" personName="Ada" />);
    expect(screen.getByRole("heading", { name: "Ada processing" })).toBeVisible();
    expect(unprocessed()).not.toHaveClass("text-primary");
    expect(within(unprocessed()).queryByText("1")).not.toBeInTheDocument();
    expect(drafts()).toHaveClass("text-primary");

    rerender(<RecordsList personId="person-2" personName="Lin" />);
    expect(screen.getByRole("heading", { name: "Lin OCR" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /Ada/ })).not.toBeInTheDocument();
    expect(drafts()).not.toHaveClass("text-primary");
    expect(unprocessed()).not.toHaveClass("text-primary");
  });

  it("debounces search and never displays results for a superseded query", () => {
    vi.useFakeTimers();
    try {
      hookMocks.useMedicalRecords.mockImplementation((filters?: MedicalRecordFilters) => ({
        data: filters?.status === "active" && filters.search === "CBC" ? [baseRecord()] : [],
        isLoading: false,
        error: null,
      }));
      render(<RecordsList personId="person-1" personName="Ada" />);
      const search = screen.getByRole("textbox");
      expect(screen.queryByRole("button", { name: "records.clearSearch" })).not.toBeInTheDocument();

      fireEvent.change(search, { target: { value: "CBC" } });
      act(() => vi.advanceTimersByTime(200));
      fireEvent.change(search, { target: { value: "CMP" } });
      act(() => vi.advanceTimersByTime(100));
      expect(screen.queryByRole("heading", { name: "CBC" })).not.toBeInTheDocument();

      fireEvent.change(search, { target: { value: " CBC " } });
      act(() => vi.advanceTimersByTime(299));
      expect(screen.queryByRole("heading", { name: "CBC" })).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole("heading", { name: "CBC" })).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: "records.clearSearch" }));
      expect(search).toHaveValue("");
      act(() => vi.advanceTimersByTime(300));
      expect(screen.queryByRole("heading", { name: "CBC" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("queries only the selected record type and resets the filter", async () => {
    hookMocks.useMedicalRecords.mockImplementation((filters?: MedicalRecordFilters) => ({
      data: filters?.status === "active" && !filters.record_type ? [baseRecord()] : [],
      isLoading: false,
      error: null,
    }));
    render(<RecordsList personId="person-1" personName="Ada" />);
    const user = userEvent.setup();

    expect(screen.getByRole("heading", { name: "CBC" })).toBeVisible();
    screen.getByRole("combobox").focus();
    await user.keyboard("{ArrowDown}");
    await user.click(screen.getByRole("option", { name: "records.types.imaging" }));
    expect(screen.getByRole("combobox")).toHaveTextContent("records.types.imaging");
    expect(screen.queryByRole("heading", { name: "CBC" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "common.noResults" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "common.clear" }));
    expect(screen.getByRole("combobox")).toHaveTextContent("records.allTypes");
    expect(screen.getByRole("heading", { name: "CBC" })).toBeVisible();
    expect(routerMock.replace).toHaveBeenCalledWith("/health/records");
  });

  it.each([
    { data: undefined, isLoading: false, error: null, message: null },
    { data: [baseRecord()], isLoading: true, error: null, message: null },
    { data: [], isLoading: true, error: null, message: null },
    {
      data: [baseRecord()],
      isLoading: false,
      error: new Error("Records unavailable"),
      message: "Records unavailable",
    },
    {
      data: [],
      isLoading: false,
      error: new Error("Records unavailable"),
      message: "Records unavailable",
    },
  ])("keeps results and empty state hidden while the query is unavailable ($#)", (query) => {
    hookMocks.useMedicalRecords.mockReturnValue(query);
    render(<RecordsList personId="person-1" personName="Ada" />);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "health.noRecords" })).not.toBeInTheDocument();
    if (query.message) expect(screen.getByText(query.message)).toBeVisible();
  });

  it("shows loading placeholders until records arrive", () => {
    hookMocks.useMedicalRecords.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container, rerender } = render(<RecordsList personId="person-1" personName="Ada" />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(6);

    hookMocks.useMedicalRecords.mockReturnValue({
      data: [baseRecord()],
      isLoading: false,
      error: null,
    });
    rerender(<RecordsList personId="person-1" personName="Ada" />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "CBC" })).toBeVisible();
  });

  it.each([
    {
      tab: "draft",
      status: "draft" as const,
      action: "activate",
      hook: hookMocks.useUpdateMedicalRecord,
      payload: { id: "record-1", updates: { status: "active" } },
    },
    {
      tab: "removed",
      status: "removed" as const,
      action: "restore",
      hook: hookMocks.useRestoreRecord,
      payload: "record-1",
    },
    {
      tab: "removed",
      status: "removed" as const,
      action: "delete",
      hook: hookMocks.useHardDeleteRecord,
      payload: "record-1",
    },
  ])(
    "can $action the selected record on the $tab tab",
    async ({ tab, status, action, hook, payload }) => {
      const mutate = vi.fn();
      hook.mockReturnValue({ mutate });
      hookMocks.useMedicalRecords.mockReturnValue({
        data: [baseRecord({ status })],
        isLoading: false,
        error: null,
      });
      const user = userEvent.setup();
      const { rerender } = render(<RecordsList personId="person-1" personName="Ada" />);
      await user.click(screen.getByRole("button", { name: "common.actions" }));
      expect(
        screen.queryByRole("menuitem", { name: `records.actions.${action}` }),
      ).not.toBeInTheDocument();
      await user.keyboard("{Escape}");

      searchParamsState = new URLSearchParams(`tab=${tab}`);
      rerender(<RecordsList personId="person-1" personName="Ada" />);
      await user.click(screen.getByRole("button", { name: "common.actions" }));
      await user.click(screen.getByRole("menuitem", { name: `records.actions.${action}` }));

      expect(mutate).toHaveBeenCalledExactlyOnceWith(payload);
      expect(routerMock.push).not.toHaveBeenCalled();
    },
  );

  it("soft-removes from the list", async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    hookMocks.useSoftDeleteRecord.mockReturnValue({ mutate, isPending: false });
    hookMocks.useMedicalRecords.mockReturnValue({
      data: [baseRecord()],
      isLoading: false,
      error: null,
    });
    render(<RecordsList personId="person-1" personName="Ada" />);
    await user.click(screen.getByRole("button", { name: "common.actions" }));
    await user.click(screen.getByRole("menuitem", { name: "records.actions.remove" }));
    const confirmRemove = screen.getByRole("button", { name: "common.remove" });
    expect(confirmRemove).toBeVisible();
    expect(mutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "common.actions" }));
    await user.click(screen.getByRole("menuitem", { name: "records.actions.remove" }));
    await user.click(screen.getByRole("button", { name: "common.remove" }));

    expect(mutate).toHaveBeenCalledWith("record-1");
    expect(confirmRemove).not.toBeInTheDocument();
  });
});
