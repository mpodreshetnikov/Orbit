import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentGrid, AttachmentPreview } from "./attachment-preview";

const hookMocks = vi.hoisted(() => ({
  useAttachmentUrl: vi.fn(),
}));

const openMock = vi.fn();

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
  useAttachmentUrl: (...args: unknown[]) => hookMocks.useAttachmentUrl(...args),
}));

function makeAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: "att-1",
    record_id: "record-1",
    storage_path: "person/record/att-1",
    mime_type: "image/jpeg",
    original_filename: "scan.jpg",
    file_size: 123,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AttachmentPreview", () => {
  beforeEach(() => {
    openMock.mockReset();
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: openMock,
    });
  });

  it("renders loading and empty grid states", () => {
    hookMocks.useAttachmentUrl.mockReturnValue({ data: null, isLoading: true });
    const { rerender } = render(<AttachmentGrid attachments={[makeAttachment()]} isLoading />);

    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    rerender(<AttachmentGrid attachments={[]} />);
    expect(screen.getByText("records.detail.noAttachments")).toBeInTheDocument();
  });

  it("opens image lightbox and download action", async () => {
    hookMocks.useAttachmentUrl.mockReturnValue({
      data: "https://cdn.test/scan.jpg",
      isLoading: false,
    });
    const user = userEvent.setup();

    render(<AttachmentPreview attachment={makeAttachment()} />);

    await user.click(screen.getByAltText("scan.jpg"));
    expect(screen.getByText("lightbox-open")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common.download" }));
    expect(openMock).toHaveBeenCalledWith("https://cdn.test/scan.jpg", "_blank");
  });

  it("renders PDF preview with open and download actions", async () => {
    hookMocks.useAttachmentUrl.mockReturnValue({
      data: "https://cdn.test/report.pdf",
      isLoading: false,
    });
    const user = userEvent.setup();

    render(
      <AttachmentPreview
        attachment={makeAttachment({
          mime_type: "application/pdf",
          original_filename: "report.pdf",
        })}
      />,
    );

    expect(screen.getByText("PDF Document")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common.view" }));
    await user.click(screen.getByRole("button", { name: "common.download" }));

    expect(openMock).toHaveBeenCalledWith("https://cdn.test/report.pdf", "_blank");
    expect(openMock).toHaveBeenCalledTimes(2);
  });
});
