import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileDropzone } from "./file-dropzone";

const hookMocks = vi.hoisted(() => ({
  useIsMobile: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, number>): string =>
      values?.count != null ? `${key}:${values.count}` : key,
}));

vi.mock("@/hooks", () => ({
  useIsMobile: (...args: unknown[]) => hookMocks.useIsMobile(...args),
}));

vi.mock("./camera-capture", () => ({
  CameraCapture: ({
    open,
    onCapture,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCapture: (file: File) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => onCapture(new File(["photo"], "captured.jpg", { type: "image/jpeg" }))}
      >
        mock-camera-capture
      </button>
    ) : null,
}));

describe("FileDropzone", () => {
  beforeEach(() => {
    hookMocks.useIsMobile.mockReset();
    hookMocks.useIsMobile.mockReturnValue(false);
  });

  it("accepts valid files and lets the user remove selected files", async () => {
    const onFilesSelected = vi.fn();
    const onRemoveFile = vi.fn();

    const selected = new File(["data"], "existing.pdf", { type: "application/pdf" });
    const { container } = render(
      <FileDropzone
        onFilesSelected={onFilesSelected}
        selectedFiles={[selected]}
        onRemoveFile={onRemoveFile}
      />,
    );

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const newFile = new File(["img"], "scan.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [newFile] } });

    expect(onFilesSelected).toHaveBeenCalledWith([newFile]);
    expect(screen.getByText("existing.pdf")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "" }));
    expect(onRemoveFile).toHaveBeenCalledWith(0);
  });

  it("shows validation errors for invalid type and max files reached", () => {
    const onFilesSelected = vi.fn();
    const { container, rerender } = render(
      <FileDropzone onFilesSelected={onFilesSelected} selectedFiles={[]} onRemoveFile={vi.fn()} />,
    );

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const badType = new File(["data"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [badType] } });

    expect(onFilesSelected).not.toHaveBeenCalled();
    expect(screen.getByText("Invalid file type: notes.txt")).toBeInTheDocument();

    rerender(
      <FileDropzone
        onFilesSelected={onFilesSelected}
        selectedFiles={[new File(["a"], "a.pdf", { type: "application/pdf" })]}
        onRemoveFile={vi.fn()}
        maxFiles={1}
      />,
    );

    const fullInput = container.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(fullInput, {
      target: { files: [new File(["img"], "another.png", { type: "image/png" })] },
    });

    expect(screen.getByText("records.add.maxFilesReached")).toBeInTheDocument();
  });

  it("supports desktop camera capture and mobile-specific hint text", async () => {
    const onFilesSelected = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <FileDropzone onFilesSelected={onFilesSelected} selectedFiles={[]} onRemoveFile={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "records.camera.takePhoto" }));
    await user.click(screen.getByRole("button", { name: "mock-camera-capture" }));

    expect(onFilesSelected).toHaveBeenCalledWith([
      expect.objectContaining({ name: "captured.jpg" }),
    ]);

    hookMocks.useIsMobile.mockReturnValue(true);
    rerender(
      <FileDropzone onFilesSelected={onFilesSelected} selectedFiles={[]} onRemoveFile={vi.fn()} />,
    );

    expect(
      screen.queryByRole("button", { name: "records.camera.takePhoto" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("records.add.dropzoneMobile")).toBeInTheDocument();
  });
});
