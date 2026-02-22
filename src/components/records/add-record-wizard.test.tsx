import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddRecordWizard } from "./add-record-wizard";

const hookMocks = vi.hoisted(() => ({
  useCreateMedicalRecord: vi.fn(),
  useHardDeleteRecord: vi.fn(),
  useBackgroundOCR: vi.fn(),
  useUpdateMedicalRecord: vi.fn(),
  useStructureExtraction: vi.fn(),
  useProcessingQueueStore: vi.fn(),
}));

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
}));

const createMutateAsyncMock = vi.fn();
const updateMutateAsyncMock = vi.fn();
const deleteMutateAsyncMock = vi.fn();
const startBackgroundOCRMock = vi.fn();
const extractStructureMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/hooks", () => ({
  useCreateMedicalRecord: (...args: unknown[]) => hookMocks.useCreateMedicalRecord(...args),
  useHardDeleteRecord: (...args: unknown[]) => hookMocks.useHardDeleteRecord(...args),
  useBackgroundOCR: (...args: unknown[]) => hookMocks.useBackgroundOCR(...args),
  useUpdateMedicalRecord: (...args: unknown[]) => hookMocks.useUpdateMedicalRecord(...args),
  useStructureExtraction: (...args: unknown[]) => hookMocks.useStructureExtraction(...args),
}));

vi.mock("@/stores/processing-queue-store", () => ({
  useProcessingQueueStore: (...args: unknown[]) => hookMocks.useProcessingQueueStore(...args),
}));

vi.mock("./file-dropzone", () => ({
  FileDropzone: ({
    onFilesSelected,
    selectedFiles,
    onRemoveFile,
  }: {
    onFilesSelected: (files: File[]) => void;
    selectedFiles: File[];
    onRemoveFile: (index: number) => void;
  }) => (
    <div>
      <p>mock-files:{selectedFiles.length}</p>
      <button
        type="button"
        onClick={() =>
          onFilesSelected([new File(["pdf"], "scan.pdf", { type: "application/pdf" })])
        }
      >
        mock-add-file
      </button>
      <button type="button" onClick={() => onRemoveFile(0)} disabled={selectedFiles.length === 0}>
        mock-remove-file
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await import("react");
  const DialogContext = React.createContext(false);
  return {
    AlertDialog: ({
      open,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
      children: React.ReactNode;
    }) => <DialogContext.Provider value={Boolean(open)}>{children}</DialogContext.Provider>,
    AlertDialogContent: ({ children }: { children: React.ReactNode }) => {
      const open = React.useContext(DialogContext);
      return open ? <div>{children}</div> : null;
    },
    AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
    AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    AlertDialogCancel: ({
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
  };
});

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const TabsContext = React.createContext<{
    value: string;
    onValueChange?: (value: string) => void;
  }>({ value: "" });
  return {
    Tabs: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => <TabsContext.Provider value={{ value, onValueChange }}>{children}</TabsContext.Provider>,
    TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const ctx = React.useContext(TabsContext);
      return (
        <button
          type="button"
          onClick={() => ctx.onValueChange?.(value)}
          aria-pressed={ctx.value === value}
        >
          {children}
        </button>
      );
    },
  };
});

vi.mock("@/components/ui/progress", () => ({
  Progress: ({ value }: { value: number }) => <div>progress:{value}</div>,
}));

function makeMutationMock(mutateAsync: ReturnType<typeof vi.fn>) {
  return {
    mutateAsync,
    isPending: false,
  };
}

describe("AddRecordWizard", () => {
  beforeEach(() => {
    createMutateAsyncMock.mockReset();
    updateMutateAsyncMock.mockReset();
    deleteMutateAsyncMock.mockReset();
    startBackgroundOCRMock.mockReset();
    extractStructureMock.mockReset();
    routerMock.push.mockReset();
    routerMock.back.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    createMutateAsyncMock.mockResolvedValue({ id: "record-1" });
    updateMutateAsyncMock.mockResolvedValue(undefined);
    deleteMutateAsyncMock.mockResolvedValue(undefined);
    extractStructureMock.mockResolvedValue({ success: true });

    hookMocks.useCreateMedicalRecord.mockReturnValue(makeMutationMock(createMutateAsyncMock));
    hookMocks.useUpdateMedicalRecord.mockReturnValue(makeMutationMock(updateMutateAsyncMock));
    hookMocks.useHardDeleteRecord.mockReturnValue(makeMutationMock(deleteMutateAsyncMock));
    hookMocks.useBackgroundOCR.mockReturnValue({
      startBackgroundOCR: startBackgroundOCRMock,
    });
    hookMocks.useStructureExtraction.mockReturnValue({
      extractStructure: extractStructureMock,
    });
    hookMocks.useProcessingQueueStore.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        jobs: {},
      }),
    );
  });

  it("starts upload processing and renders queued actions", async () => {
    const user = userEvent.setup();
    render(<AddRecordWizard personId="person-1" personName="Alex" />);

    await user.click(screen.getByRole("button", { name: "mock-add-file" }));
    await user.click(screen.getByRole("button", { name: "records.wizard.startProcessing" }));

    await waitFor(() => {
      expect(createMutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          person_id: "person-1",
          status: "draft",
          record_type: "other",
        }),
      );
      expect(startBackgroundOCRMock).toHaveBeenCalledWith(
        expect.objectContaining({
          recordId: "record-1",
          personId: "person-1",
          personName: "Alex",
          files: [expect.objectContaining({ name: "scan.pdf" })],
        }),
      );
    });

    expect(screen.getByText("records.wizard.recordQueued")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "records.wizard.viewDrafts" }));
    expect(routerMock.push).toHaveBeenCalledWith("/health?tab=draft");

    await user.click(screen.getByRole("button", { name: "records.wizard.addAnother" }));
    expect(screen.getByText("mock-files:0")).toBeInTheDocument();
  });

  it("submits pasted text path and navigates directly to record", async () => {
    const user = userEvent.setup();
    render(<AddRecordWizard personId="person-1" personName="Alex" />);

    await user.click(screen.getByRole("button", { name: "records.wizard.pasteText" }));
    await user.type(screen.getByPlaceholderText("records.wizard.pasteTextPlaceholder"), "CBC data");
    await user.click(screen.getByRole("button", { name: "records.wizard.proceedToReview" }));

    await waitFor(() => {
      expect(createMutateAsyncMock).toHaveBeenCalled();
      expect(updateMutateAsyncMock).toHaveBeenCalledWith({
        id: "record-1",
        updates: { ocr_text: "CBC data" },
      });
      expect(extractStructureMock).toHaveBeenCalledWith({ recordId: "record-1" });
      expect(routerMock.push).toHaveBeenCalledWith("/health/records/record-1");
    });
  });

  it("shows upload errors and supports discard confirmation on back", async () => {
    createMutateAsyncMock.mockRejectedValueOnce(new Error("create failed"));
    const user = userEvent.setup();
    render(<AddRecordWizard personId="person-1" personName="Alex" />);

    await user.click(screen.getByRole("button", { name: "mock-add-file" }));
    await user.click(screen.getByRole("button", { name: "records.wizard.startProcessing" }));

    expect(await screen.findByText("create failed")).toBeInTheDocument();
    expect(startBackgroundOCRMock).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button")[0]);
    expect(screen.getByText("records.confirm.discardTitle")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common.confirm" }));

    await waitFor(() => {
      expect(routerMock.back).toHaveBeenCalled();
    });
  });
});
