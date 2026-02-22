import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OcrReviewStep } from "./ocr-review-step";

const hookMocks = vi.hoisted(() => ({
  useAttachmentUrls: vi.fn(),
  useStructureExtraction: vi.fn(),
  useUpdateMedicalRecord: vi.fn(),
}));

const extractStructureMock = vi.fn();
const updateMutateAsyncMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock for tests
    <img {...props} alt={props.alt} />
  ),
}));

vi.mock("yet-another-react-lightbox", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>lightbox-open</div> : null),
}));

vi.mock("yet-another-react-lightbox/plugins/zoom", () => ({
  default: {},
}));

vi.mock("yet-another-react-lightbox/plugins/download", () => ({
  default: {},
}));

vi.mock("@/hooks", () => ({
  useAttachmentUrls: (...args: unknown[]) => hookMocks.useAttachmentUrls(...args),
  useStructureExtraction: (...args: unknown[]) => hookMocks.useStructureExtraction(...args),
  useUpdateMedicalRecord: (...args: unknown[]) => hookMocks.useUpdateMedicalRecord(...args),
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
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));

describe("OcrReviewStep", () => {
  beforeEach(() => {
    extractStructureMock.mockReset();
    updateMutateAsyncMock.mockReset();

    extractStructureMock.mockResolvedValue({ success: true });
    updateMutateAsyncMock.mockResolvedValue(undefined);

    hookMocks.useAttachmentUrls.mockReturnValue({
      data: {
        "att-1": "https://example.test/file-1.jpg",
        "att-2": "https://example.test/file-2.pdf",
      },
      isLoading: false,
    });
    hookMocks.useStructureExtraction.mockReturnValue({
      extractStructure: extractStructureMock,
      isExtracting: false,
    });
    hookMocks.useUpdateMedicalRecord.mockReturnValue({
      mutateAsync: updateMutateAsyncMock,
      isPending: false,
    });
  });

  it("renders empty attachments state and opens fullscreen OCR editor", async () => {
    const user = userEvent.setup();
    render(
      <OcrReviewStep
        recordId="record-1"
        ocrText="raw ocr text"
        attachments={[]}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByText("records.detail.noAttachments")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "records.ocr.openText" })[0]);
    const fullscreenText = document.getElementById("fullscreen-ocr-text") as HTMLTextAreaElement;
    expect(fullscreenText).toBeInTheDocument();

    await user.clear(fullscreenText);
    await user.type(fullscreenText, "edited fullscreen text");
    await user.click(screen.getByRole("button", { name: "records.ocr.saveAndClose" }));
  });

  it("updates OCR text before extraction and completes on success", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(
      <OcrReviewStep
        recordId="record-1"
        ocrText="initial text"
        attachments={[
          {
            id: "att-1",
            record_id: "record-1",
            storage_path: "person/record/file-1.jpg",
            mime_type: "image/jpeg",
            original_filename: "scan.jpg",
            file_size: 123,
            sort_order: 0,
            created_at: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "att-2",
            record_id: "record-1",
            storage_path: "person/record/file-2.pdf",
            mime_type: "application/pdf",
            original_filename: "report.pdf",
            file_size: 456,
            sort_order: 1,
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ]}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByAltText("scan.jpg")).toBeInTheDocument();
    await user.click(screen.getByAltText("scan.jpg"));
    expect(screen.getByText("lightbox-open")).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText("records.ocr.noTextExtracted");
    await user.clear(textarea);
    await user.type(textarea, "normalized text");
    await user.click(screen.getAllByRole("button", { name: "records.ocr.confirmAndExtract" })[0]);

    await waitFor(() => {
      expect(updateMutateAsyncMock).toHaveBeenCalledWith({
        id: "record-1",
        updates: { ocr_text: "normalized text" },
      });
      expect(extractStructureMock).toHaveBeenCalledWith({ recordId: "record-1" });
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("skips OCR update when text is unchanged and keeps user on failed extraction", async () => {
    extractStructureMock.mockResolvedValueOnce({ success: false });
    const onComplete = vi.fn();
    const user = userEvent.setup();

    render(
      <OcrReviewStep
        recordId="record-1"
        ocrText="same text"
        attachments={[]}
        onComplete={onComplete}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "records.ocr.confirmAndExtract" })[0]);

    await waitFor(() => {
      expect(updateMutateAsyncMock).not.toHaveBeenCalled();
      expect(extractStructureMock).toHaveBeenCalledWith({ recordId: "record-1" });
    });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
