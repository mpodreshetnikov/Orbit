import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedicalRecordListItem } from "@/types";
import { RecordsList } from "./records-list";

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

const softDeleteMutate = vi.fn();
const restoreMutate = vi.fn();
const hardDeleteMutate = vi.fn();
const updateMutate = vi.fn();

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

vi.mock("./record-card", () => ({
  RecordCard: ({
    record,
    onView,
    onRemove,
    onRestore,
    onDelete,
    onActivate,
  }: {
    record: MedicalRecordListItem;
    onView: (record: MedicalRecordListItem) => void;
    onRemove: (record: MedicalRecordListItem) => void;
    onRestore?: (record: MedicalRecordListItem) => void;
    onDelete?: (record: MedicalRecordListItem) => void;
    onActivate?: (record: MedicalRecordListItem) => void;
  }) => (
    <div data-testid={`record-card-${record.id}`}>
      <span>{record.title}</span>
      <button type="button" onClick={() => onView(record)}>
        view-{record.id}
      </button>
      <button type="button" onClick={() => onRemove(record)}>
        remove-{record.id}
      </button>
      {onRestore && (
        <button type="button" onClick={() => onRestore(record)}>
          restore-{record.id}
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={() => onDelete(record)}>
          delete-{record.id}
        </button>
      )}
      {onActivate && (
        <button type="button" onClick={() => onActivate(record)}>
          activate-{record.id}
        </button>
      )}
    </div>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

function makeRecord(
  id: string,
  overrides: Partial<MedicalRecordListItem> = {},
): MedicalRecordListItem {
  return {
    id,
    person_id: "person-1",
    created_by_user_id: "user-1",
    record_type: "lab",
    record_date: "2026-01-01",
    title: `Record ${id}`,
    notes: null,
    status: "active",
    removed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ocr_text: null,
    ocr_error: null,
    llm_summary: null,
    llm_keywords: null,
    llm_suggested_checkup_completions: null,
    attachment_count: 0,
    ...overrides,
  };
}

function setupMedicalRecords(options: {
  active?: MedicalRecordListItem[];
  draft?: MedicalRecordListItem[];
  removed?: MedicalRecordListItem[];
  processing?: MedicalRecordListItem[];
  isLoading?: boolean;
  error?: Error | null;
}) {
  const {
    active = [],
    draft = [],
    removed = [],
    processing = [],
    isLoading = false,
    error = null,
  } = options;

  hookMocks.useMedicalRecords.mockImplementation(
    (filters: { person_id?: string; status?: string }) => {
      if (filters.person_id === "") return { data: [], isLoading: false, error: null };
      if (filters.status === "draft") return { data: draft, isLoading: false, error: null };
      if (filters.status === "removed") return { data: removed, isLoading: false, error: null };
      if (filters.status === "processing") {
        return { data: processing, isLoading: false, error: null };
      }
      return { data: active, isLoading, error };
    },
  );
}

describe("RecordsList", () => {
  beforeEach(() => {
    searchParamsState = new URLSearchParams();

    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    softDeleteMutate.mockReset();
    restoreMutate.mockReset();
    hardDeleteMutate.mockReset();
    updateMutate.mockReset();

    hookMocks.useSoftDeleteRecord.mockReturnValue({ mutate: softDeleteMutate, isPending: false });
    hookMocks.useRestoreRecord.mockReturnValue({ mutate: restoreMutate, isPending: false });
    hookMocks.useHardDeleteRecord.mockReturnValue({ mutate: hardDeleteMutate, isPending: false });
    hookMocks.useUpdateMedicalRecord.mockReturnValue({ mutate: updateMutate, isPending: false });
  });

  it("renders loading state for active records", () => {
    setupMedicalRecords({ isLoading: true });
    render(<RecordsList personId="person-1" personName="Alex" />);

    expect(screen.getByRole("heading", { name: /health.title/i })).toBeInTheDocument();
    expect(screen.getByText("records.statusFilter.active")).toBeInTheDocument();
    expect(screen.getByText("records.statusFilter.processing")).toBeInTheDocument();
  });

  it("renders error state when records request fails", () => {
    setupMedicalRecords({ error: new Error("boom") });
    render(<RecordsList personId="person-1" personName="Alex" />);

    expect(screen.getByText("common.error")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("handles view and soft-delete confirmation for active records", async () => {
    setupMedicalRecords({
      active: [makeRecord("record-1", { title: "CBC" })],
      draft: [makeRecord("record-draft", { status: "draft" })],
      processing: [makeRecord("record-proc", { status: "processing" })],
    });

    render(<RecordsList personId="person-1" personName="Alex" />);
    const user = userEvent.setup();

    expect(screen.getByText("CBC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "view-record-1" }));
    expect(routerMock.push).toHaveBeenCalledWith("/health/records/record-1");

    await user.click(screen.getByRole("button", { name: "remove-record-1" }));
    expect(screen.getByText("records.confirm.removeTitle")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common.remove" }));

    expect(softDeleteMutate).toHaveBeenCalledWith("record-1");
  });

  it("handles restore and permanent delete actions in removed tab", async () => {
    searchParamsState = new URLSearchParams("tab=removed");
    setupMedicalRecords({
      removed: [makeRecord("record-2", { status: "removed", removed_at: "2026-01-02T00:00:00Z" })],
    });

    render(<RecordsList personId="person-1" personName="Alex" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "restore-record-2" }));
    expect(restoreMutate).toHaveBeenCalledWith("record-2");

    await user.click(screen.getByRole("button", { name: "delete-record-2" }));
    expect(screen.getByText("records.confirm.deleteTitle")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common.delete" }));

    expect(hardDeleteMutate).toHaveBeenCalledWith("record-2");
  });

  it("handles draft activation and clear filters", async () => {
    searchParamsState = new URLSearchParams("tab=draft");
    setupMedicalRecords({
      draft: [makeRecord("record-3", { status: "draft", title: "Draft record" })],
    });

    render(<RecordsList personId="person-1" personName="Alex" />);
    const user = userEvent.setup();

    expect(screen.getByText("Draft record")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "activate-record-3" }));
    expect(screen.getByText("records.confirm.activateTitle")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "records.actions.activate" }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: "record-3",
      updates: { status: "active" },
    });

    await user.click(screen.getByRole("button", { name: "common.clear" }));
    expect(routerMock.replace).toHaveBeenCalledWith("/health/records");
  });

  it("renders active empty state and routes to create page", async () => {
    setupMedicalRecords({ active: [], draft: [], processing: [] });
    render(<RecordsList personId="person-1" personName="Alex" />);
    const user = userEvent.setup();

    expect(screen.getByText("health.noRecords")).toBeInTheDocument();
    const addButtons = screen.getAllByRole("button", { name: "health.addRecord" });
    await user.click(addButtons[0]);

    expect(routerMock.push).toHaveBeenCalledWith("/health/records/new");
  });
});
