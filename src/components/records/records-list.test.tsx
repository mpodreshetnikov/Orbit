import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedicalRecordListItem } from "@/types";
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

vi.mock("./record-card-view", () => ({
  RecordCard: ({
    record,
    onView,
    onRemove,
  }: {
    record: MedicalRecordListItem;
    onView: (record: MedicalRecordListItem) => void;
    onRemove: (record: MedicalRecordListItem) => void;
  }) => (
    <div data-testid={`record-card-${record.id}`}>
      <span>{record.title}</span>
      <button type="button" onClick={() => onView(record)}>
        view-{record.id}
      </button>
      <button type="button" onClick={() => onRemove(record)}>
        remove-{record.id}
      </button>
    </div>
  ),
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
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
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

function baseRecord(overrides: Partial<MedicalRecordListItem> = {}): MedicalRecordListItem {
  return {
    id: "record-1",
    person_id: "person-1",
    title: "CBC",
    status: "active",
    record_type: "lab",
    record_date: "2026-01-01",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
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

  it("renders active empty without add button and opens a record", async () => {
    const user = userEvent.setup();
    hookMocks.useMedicalRecords.mockReturnValue({
      data: [baseRecord()],
      isLoading: false,
      error: null,
    });
    render(<RecordsList personId="person-1" personName="Ada" />);
    expect(screen.queryByText("health.addRecord")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "view-record-1" }));
    expect(routerMock.push).toHaveBeenCalledWith("/health/records/record-1");
  });

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
    await user.click(screen.getByRole("button", { name: "remove-record-1" }));
    await user.click(screen.getByRole("button", { name: "common.remove" }));
    expect(mutate).toHaveBeenCalledWith("record-1");
  });
});
