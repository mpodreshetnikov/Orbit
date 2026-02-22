import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useCreateMedicalRecord: vi.fn(),
  useUpdateMedicalRecord: vi.fn(),
  useUploadMultipleAttachments: vi.fn(),
  useHardDeleteRecord: vi.fn(),
}));

const routerMock = {
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/hooks", () => ({
  useCreateMedicalRecord: (...args: unknown[]) => hookMocks.useCreateMedicalRecord(...args),
  useUpdateMedicalRecord: (...args: unknown[]) => hookMocks.useUpdateMedicalRecord(...args),
  useUploadMultipleAttachments: (...args: unknown[]) =>
    hookMocks.useUploadMultipleAttachments(...args),
  useHardDeleteRecord: (...args: unknown[]) => hookMocks.useHardDeleteRecord(...args),
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
      <button
        type="button"
        onClick={() => onFilesSelected([new File(["x"], "report.txt", { type: "text/plain" })])}
      >
        add-file
      </button>
      <button type="button" onClick={() => onRemoveFile(0)}>
        remove-file
      </button>
      <span>files:{selectedFiles.length}</span>
    </div>
  ),
}));

function mutationMock<T = unknown>(resolved?: T) {
  return {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(resolved),
  };
}

describe("AddRecordForm", () => {
  beforeEach(() => {
    routerMock.back.mockReset();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    hookMocks.useCreateMedicalRecord.mockReturnValue(mutationMock({ id: "record-1" }));
    hookMocks.useUpdateMedicalRecord.mockReturnValue(mutationMock());
    hookMocks.useUploadMultipleAttachments.mockReturnValue(mutationMock());
    hookMocks.useHardDeleteRecord.mockReturnValue(mutationMock());
  });

  it("navigates back immediately when there are no unsaved changes", async () => {
    const { AddRecordForm } = await import("./add-record-form");
    render(<AddRecordForm personId="person-1" personName="Alex" />);

    await userEvent.setup().click(screen.getByRole("button", { name: "common.cancel" }));
    expect(routerMock.back).toHaveBeenCalledTimes(1);
  });

  it("saves draft, then opens discard confirmation and deletes created draft", async () => {
    const deleteMutation = mutationMock();
    hookMocks.useHardDeleteRecord.mockReturnValue(deleteMutation);

    const { AddRecordForm } = await import("./add-record-form");
    render(<AddRecordForm personId="person-1" personName="Alex" />);

    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText("records.add.recordTitlePlaceholder"),
      "CBC report",
    );
    await user.click(screen.getByRole("button", { name: "records.add.saveDraft" }));

    await waitFor(() =>
      expect(hookMocks.useCreateMedicalRecord().mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          person_id: "person-1",
          title: "CBC report",
          status: "draft",
        }),
      ),
    );
    expect(routerMock.push).toHaveBeenCalledWith("/health/records/record-1");

    await user.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(await screen.findByText("records.confirm.discardTitle")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common.confirm" }));

    await waitFor(() => {
      expect(deleteMutation.mutateAsync).toHaveBeenCalledWith("record-1");
      expect(routerMock.back).toHaveBeenCalled();
    });
  });

  it("saves and activates record with uploaded attachments", async () => {
    const createMutation = mutationMock({ id: "record-1" });
    const uploadMutation = mutationMock();
    const updateMutation = mutationMock();
    hookMocks.useCreateMedicalRecord.mockReturnValue(createMutation);
    hookMocks.useUploadMultipleAttachments.mockReturnValue(uploadMutation);
    hookMocks.useUpdateMedicalRecord.mockReturnValue(updateMutation);

    const { AddRecordForm } = await import("./add-record-form");
    render(<AddRecordForm personId="person-1" personName="Alex" />);

    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText("records.add.recordTitlePlaceholder"),
      "MRI report",
    );
    await user.click(screen.getByRole("button", { name: "add-file" }));
    expect(screen.getByText("files:1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "records.add.saveAndActivate" }));

    await waitFor(() => {
      expect(uploadMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          recordId: "record-1",
          personId: "person-1",
        }),
      );
      expect(updateMutation.mutateAsync).toHaveBeenCalledWith({
        id: "record-1",
        updates: { status: "active" },
      });
    });
    expect(routerMock.push).toHaveBeenCalledWith("/health");
  });

  it("keeps created draft when upload fails during save", async () => {
    const createMutation = mutationMock({ id: "record-1" });
    const uploadMutation = {
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockRejectedValue(new Error("upload failed")),
    };
    const updateMutation = mutationMock();
    hookMocks.useCreateMedicalRecord.mockReturnValue(createMutation);
    hookMocks.useUploadMultipleAttachments.mockReturnValue(uploadMutation);
    hookMocks.useUpdateMedicalRecord.mockReturnValue(updateMutation);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { AddRecordForm } = await import("./add-record-form");
    render(<AddRecordForm personId="person-1" personName="Alex" />);

    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText("records.add.recordTitlePlaceholder"),
      "Failed upload",
    );
    await user.click(screen.getByRole("button", { name: "add-file" }));
    await user.click(screen.getByRole("button", { name: "records.add.saveAndActivate" }));

    await waitFor(() => {
      expect(uploadMutation.mutateAsync).toHaveBeenCalled();
      expect(updateMutation.mutateAsync).not.toHaveBeenCalled();
      expect(routerMock.push).not.toHaveBeenCalledWith("/health");
      expect(errorSpy).toHaveBeenCalled();
    });

    errorSpy.mockRestore();
  });
});
