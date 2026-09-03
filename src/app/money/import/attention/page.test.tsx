import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MoneyImportAttentionPage from "./page";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const DAY_MS = 24 * 60 * 60 * 1000;

type Reply = Record<string, unknown>;

/**
 * Plays the extension's content script: answers the page's window messages with the replies
 * the test hands it, echoing the request id the way the real bridge does.
 */
function installExtension(options: {
  answersPing: boolean;
  attention?: Reply;
  runRequest?: Reply;
  settings?: Reply;
}) {
  const posted: Array<Record<string, unknown>> = [];
  const spy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
    const data = message as Record<string, unknown>;
    if (data.source !== "orbit-webapp") return;
    posted.push(data);
    const reply = (payload: Reply) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "orbit-extension", request_id: data.request_id, ...payload },
        }),
      );
    };
    if (data.type === "MONEY_IMPORT_PING") {
      if (options.answersPing) reply({ type: "MONEY_IMPORT_PONG" });
      return;
    }
    if (data.type === "MONEY_IMPORT_GET_ATTENTION" && options.attention) {
      reply({ type: "MONEY_IMPORT_ATTENTION", ...options.attention });
      return;
    }
    if (data.type === "MONEY_IMPORT_REQUEST_RUN" && options.runRequest) {
      reply({ type: "MONEY_IMPORT_RUN_REQUEST_ACK", ...options.runRequest });
      return;
    }
    if (data.type === "MONEY_IMPORT_SET_ATTENTION_SETTINGS" && options.settings) {
      reply({ type: "MONEY_IMPORT_ATTENTION_SETTINGS_ACK", ...options.settings });
    }
  });
  return { posted, spy };
}

const STALE_ATTENTION: Reply = {
  ok: true,
  grant: {
    person_id: "person-1",
    allowed_sources: ["tbank_web"],
    received_at: "2026-08-31T10:00:00.000Z",
  },
  stale_after_ms: DAY_MS,
  stale_count: 1,
  sources: [
    {
      source_id: "tbank_web",
      last_ok_at: "2026-09-01T09:30:00.000Z",
      since: "2026-09-01T09:30:00.000Z",
      stale: true,
      stale_for_ms: 2 * DAY_MS + 3600 * 1000,
      run_requested: false,
    },
  ],
};

describe("MoneyImportAttentionPage", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says the extension is missing when the ping goes unanswered", async () => {
    installExtension({ answersPing: false });
    render(<MoneyImportAttentionPage />);
    await waitFor(
      () => expect(screen.getByText("money.importAutoStatusExtensionInactive")).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(screen.queryByTestId("money-import-attention-settings")).toBeNull();
  });

  it("lists a stale source by its bank name and asks the extension to open the bank on Update", async () => {
    const extension = installExtension({
      answersPing: true,
      attention: STALE_ATTENTION,
      runRequest: { ok: true, source_id: "tbank_web", error: null },
    });
    render(<MoneyImportAttentionPage />);

    const card = await screen.findByTestId("money-import-attention-tbank_web");
    expect(card.getAttribute("data-stale")).toBe("true");
    expect(screen.getByText("money.accountSourceTbank")).toBeTruthy();
    expect(
      screen.getByText('money.importAttentionStale:{"days":2,"date":"01.09.2026 09:30"}'),
    ).toBeTruthy();
    // The threshold the extension keeps is what the settings show.
    expect(
      (screen.getByLabelText("money.importAttentionThresholdLabel") as HTMLInputElement).value,
    ).toBe("1");

    fireEvent.click(screen.getByText("money.importAttentionUpdate"));

    await waitFor(() => expect(screen.getByText("money.importAttentionRequested")).toBeTruthy());
    const runRequest = extension.posted.find((m) => m.type === "MONEY_IMPORT_REQUEST_RUN");
    expect(runRequest?.source_id).toBe("tbank_web");
  });

  it("shows why the bank could not be opened", async () => {
    installExtension({
      answersPing: true,
      attention: STALE_ATTENTION,
      runRequest: { ok: false, error: "No import grant" },
    });
    render(<MoneyImportAttentionPage />);
    await screen.findByTestId("money-import-attention-tbank_web");

    fireEvent.click(screen.getByText("money.importAttentionUpdate"));

    await waitFor(() =>
      expect(
        screen.getByText('money.importAttentionRequestFailed:{"error":"No import grant"}'),
      ).toBeTruthy(),
    );
  });

  it("stores the threshold in days and says what was kept", async () => {
    const extension = installExtension({
      answersPing: true,
      attention: { ...STALE_ATTENTION, stale_count: 0, sources: [] },
      settings: { ok: true, stale_after_ms: 3 * DAY_MS },
    });
    render(<MoneyImportAttentionPage />);
    const input = (await screen.findByLabelText(
      "money.importAttentionThresholdLabel",
    )) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() =>
      expect(screen.getByText('money.importAttentionThresholdSaved:{"days":3}')).toBeTruthy(),
    );
    const settings = extension.posted.find((m) => m.type === "MONEY_IMPORT_SET_ATTENTION_SETTINGS");
    expect(settings?.stale_after_ms).toBe(3 * DAY_MS);
  });

  it("refuses a threshold that is not a whole number of days", async () => {
    installExtension({ answersPing: true, attention: { ...STALE_ATTENTION, sources: [] } });
    render(<MoneyImportAttentionPage />);
    const input = await screen.findByLabelText("money.importAttentionThresholdLabel");

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() =>
      expect(screen.getByText("money.importAttentionThresholdInvalid")).toBeTruthy(),
    );
  });
});
