import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsDebugPage from "./page";

const fetchMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string): string =>
      key,
}));

describe("NotificationsDebugPage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    (globalThis.fetch as unknown) = fetchMock;
  });

  it("runs notifications cron and handles success and error responses", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, processed: 3, details: { tag: "ok" } }),
    } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "failed", details: { tag: "bad" } }),
    } as Response);

    render(<NotificationsDebugPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "runCron" }));
    expect(await screen.findByText(/runCronSuccess/)).toBeInTheDocument();
    expect(screen.getByText(/3 users processed/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "runCron" }));
    expect(await screen.findByText(/runCronError/)).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/notifications/run-cron", { method: "POST" });
    });
  });

  it("runs medication cron and handles network exception branch", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        usersProcessed: 2,
        eventsGenerated: 6,
        refillDigestsCreated: 1,
      }),
    } as Response);
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    render(<NotificationsDebugPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "runMedicationCron" }));
    expect(await screen.findByText("runMedicationCronSuccess")).toBeInTheDocument();
    expect(screen.getByText(/Users processed: 2\./)).toBeInTheDocument();
    expect(screen.getByText(/Events generated: 6\./)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "runMedicationCron" }));
    expect(await screen.findByText(/runMedicationCronError/)).toBeInTheDocument();
    expect(screen.getByText(/network down/)).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/medications/run-cron", { method: "POST" });
    });
  });
});
