import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddRecordWizard } from "./add-record-wizard";

const hookMocks = vi.hoisted(() => ({
  useCreateMedicalRecord: vi.fn(),
  useHardDeleteRecord: vi.fn(),
  useBackgroundOCR: vi.fn(),
  useUploadAttachment: vi.fn(),
  useDeleteAttachment: vi.fn(),
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
const uploadAttachmentMutateAsyncMock = vi.fn();
const deleteAttachmentMutateAsyncMock = vi.fn();
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
  useUploadAttachment: (...args: unknown[]) => hookMocks.useUploadAttachment(...args),
  useDeleteAttachment: (...args: unknown[]) => hookMocks.useDeleteAttachment(...args),
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
    fileUploadStates,
  }: {
    onFilesSelected: (files: File[]) => void;
    selectedFiles: File[];
    onRemoveFile: (index: number) => void;
    fileUploadStates?: Array<{ status: string; error?: string }>;
  }) => (
    <div>
      <p>mock-files:{selectedFiles.length}</p>
      <p>mock-statuses:{fileUploadStates?.map((state) => state.status).join(",") ?? ""}</p>
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
    uploadAttachmentMutateAsyncMock.mockReset();
    deleteAttachmentMutateAsyncMock.mockReset();
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
    uploadAttachmentMutateAsyncMock.mockResolvedValue({
      id: "attachment-1",
      record_id: "record-1",
      storage_path: "person-1/record-1/scan.pdf",
      mime_type: "application/pdf",
      original_filename: "scan.pdf",
      file_size: 1234,
      sort_order: 0,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    deleteAttachmentMutateAsyncMock.mockResolvedValue(undefined);
    extractStructureMock.mockResolvedValue({ success: true });

    hookMocks.useCreateMedicalRecord.mockReturnValue(makeMutationMock(createMutateAsyncMock));
    hookMocks.useUpdateMedicalRecord.mockReturnValue(makeMutationMock(updateMutateAsyncMock));
    hookMocks.useHardDeleteRecord.mockReturnValue(makeMutationMock(deleteMutateAsyncMock));
    hookMocks.useUploadAttachment.mockReturnValue(
      makeMutationMock(uploadAttachmentMutateAsyncMock),
    );
    hookMocks.useDeleteAttachment.mockReturnValue(
      makeMutationMock(deleteAttachmentMutateAsyncMock),
    );
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

    const startButton = screen.getByRole("button", { name: "records.wizard.startProcessing" });
    await waitFor(() => {
      expect(uploadAttachmentMutateAsyncMock).toHaveBeenCalledTimes(1);
      expect(startButton).toBeEnabled();
    });

    await user.click(startButton);

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
          files: [],
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

    expect(await screen.findByText("create failed")).toBeInTheDocument();
    expect(startBackgroundOCRMock).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button")[0]);
    expect(screen.getByText("records.confirm.discardTitle")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common.confirm" }));

    await waitFor(() => {
      expect(routerMock.back).toHaveBeenCalled();
    });
  });

  it("disables start until file upload finishes and shows per-file upload status", async () => {
    const uploadDeferred: { resolve: (value: unknown) => void } = {
      resolve: () => {},
    };
    uploadAttachmentMutateAsyncMock.mockReturnValue(
      new Promise((resolve) => {
        uploadDeferred.resolve = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<AddRecordWizard personId="person-1" personName="Alex" />);

    await user.click(screen.getByRole("button", { name: "mock-add-file" }));

    expect(screen.getByText("mock-statuses:uploading")).toBeInTheDocument();
    const startButton = screen.getByRole("button", { name: "records.wizard.startProcessing" });
    expect(startButton).toBeDisabled();

    uploadDeferred.resolve({
      id: "attachment-1",
      record_id: "record-1",
      storage_path: "person-1/record-1/scan.pdf",
      mime_type: "application/pdf",
      original_filename: "scan.pdf",
      file_size: 1234,
      sort_order: 0,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    await waitFor(() => {
      expect(screen.getByText("mock-statuses:uploaded")).toBeInTheDocument();
      expect(startButton).toBeEnabled();
    });
  });

  it("keeps start disabled when at least one upload fails", async () => {
    uploadAttachmentMutateAsyncMock.mockRejectedValueOnce(new Error("upload failed"));
    const user = userEvent.setup();
    render(<AddRecordWizard personId="person-1" personName="Alex" />);

    await user.click(screen.getByRole("button", { name: "mock-add-file" }));

    await waitFor(() => {
      expect(screen.getByText("mock-statuses:failed")).toBeInTheDocument();
      expect(screen.getByText("upload failed")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "records.wizard.startProcessing" })).toBeDisabled();
  });
});
