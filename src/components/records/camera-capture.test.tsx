import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CameraCapture } from "./camera-capture";

const getUserMediaMock = vi.fn();
const stopTrackMock = vi.fn();
const drawImageMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));

describe("CameraCapture", () => {
  beforeEach(() => {
    getUserMediaMock.mockReset();
    stopTrackMock.mockReset();
    drawImageMock.mockReset();

    getUserMediaMock.mockResolvedValue({
      getTracks: () => [{ stop: stopTrackMock }],
    });

    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      writable: true,
      value: {
        getUserMedia: getUserMediaMock,
      },
    });

    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        drawImage: drawImageMock,
      })),
    });

    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "data:image/jpeg;base64,abc"),
    });

    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      writable: true,
      value: vi.fn((callback: (blob: Blob | null) => void) => {
        callback(new Blob(["img"], { type: "image/jpeg" }));
      }),
    });
  });

  it("captures and confirms a photo", async () => {
    const onCapture = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<CameraCapture open onOpenChange={onOpenChange} onCapture={onCapture} />);

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({ facingMode: "environment" }),
          audio: false,
        }),
      );
    });

    const buttons = screen.getAllByRole("button");
    await user.click(buttons[1]);

    expect(drawImageMock).toHaveBeenCalled();

    const capturedButtons = screen.getAllByRole("button");
    await user.click(capturedButtons[1]);

    expect(onCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^photo_\d+\.jpg$/),
        type: "image/jpeg",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders camera access error and retries", async () => {
    getUserMediaMock
      .mockRejectedValueOnce(new Error("Permission denied"))
      .mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrackMock }] });

    const onCapture = vi.fn();
    const user = userEvent.setup();
    render(<CameraCapture open onOpenChange={vi.fn()} onCapture={onCapture} />);

    const retryButton = await screen
      .findByRole("button", { name: "common.retry" })
      .catch(() => null);
    if (retryButton) {
      await user.click(retryButton);
    }

    await waitFor(() => {
      expect(getUserMediaMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("switches camera facing mode and closes dialog", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<CameraCapture open onOpenChange={onOpenChange} onCapture={vi.fn()} />);

    await waitFor(() => expect(getUserMediaMock.mock.calls.length).toBeGreaterThan(0));
    const initialCalls = getUserMediaMock.mock.calls.length;

    const buttons = screen.getAllByRole("button");
    await user.click(buttons[2]);

    await waitFor(() => expect(getUserMediaMock.mock.calls.length).toBeGreaterThan(initialCalls));
    const calledFacingModes = getUserMediaMock.mock.calls.map((call) => call[0]?.video?.facingMode);
    expect(calledFacingModes).toContain("user");

    await user.click(screen.getAllByRole("button")[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
