import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MoneyImportAttentionPage from "./page";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

let selectedPersonIdState: string | null = "person-1";
vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

type Reply = Record<string, unknown>;

/**
 * Plays the extension's content script: answers the page's window messages with the replies
 * the test hands it, echoing the request id the way the real bridge does.
 */
function installExtension(options: {
  answersPing: boolean;
  /** One answer per ping, in order; the last one repeats. Overrides `answersPing` when set. */
  pingReplies?: boolean[];
  /** Per attention request, a promise its reply waits for; `null` = reply at once. */
  attentionGates?: Array<Promise<void> | null>;
  /** One reply per attention request, in order; the last one repeats. `null` = no answer. */
  attention?: Reply | Array<Reply | null>;
  runRequest?: Reply;
  settings?: Reply;
  /** When set, the settings reply waits for this promise. */
  settingsGate?: Promise<void>;
}) {
  const posted: Array<Record<string, unknown>> = [];
  let attentionCalls = 0;
  let pingCalls = 0;
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
      const replies = options.pingReplies;
      const answers = replies
        ? replies[Math.min(pingCalls, replies.length - 1)]
        : options.answersPing;
      pingCalls += 1;
      if (answers) reply({ type: "MONEY_IMPORT_PONG" });
      return;
    }
    if (data.type === "MONEY_IMPORT_GET_ATTENTION" && options.attention !== undefined) {
      const replies = Array.isArray(options.attention) ? options.attention : [options.attention];
      const chosen = replies[Math.min(attentionCalls, replies.length - 1)];
      const gate = options.attentionGates?.[attentionCalls] ?? null;
      attentionCalls += 1;
      if (!chosen) return;
      const send = () => reply({ type: "MONEY_IMPORT_ATTENTION", ...chosen });
      if (gate) void gate.then(send);
      else send();
      return;
    }
    if (data.type === "MONEY_IMPORT_REQUEST_RUN" && options.runRequest) {
      reply({ type: "MONEY_IMPORT_RUN_REQUEST_ACK", ...options.runRequest });
      return;
    }
    if (data.type === "MONEY_IMPORT_SET_ATTENTION_SETTINGS" && options.settings) {
      const settings = options.settings;
      const send = () => reply({ type: "MONEY_IMPORT_ATTENTION_SETTINGS_ACK", ...settings });
      if (options.settingsGate) void options.settingsGate.then(send);
      else send();
    }
  });
  return { posted, spy, attentionCalls: () => attentionCalls };
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
    selectedPersonIdState = "person-1";
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
    const requested: Reply = {
      ...STALE_ATTENTION,
      sources: [{ ...(STALE_ATTENTION.sources as Reply[])[0], run_requested: true }],
    };
    const extension = installExtension({
      answersPing: true,
      // The refresh after the ack finds the extension holding the request.
      attention: [STALE_ATTENTION, requested],
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

  it("names a key held for someone else instead of offering their sources", async () => {
    selectedPersonIdState = "person-2";
    installExtension({ answersPing: true, attention: STALE_ATTENTION });
    render(<MoneyImportAttentionPage />);

    await screen.findByTestId("money-import-attention-other-person");
    expect(screen.queryByTestId("money-import-attention-tbank_web")).toBeNull();
    expect(screen.queryByText("money.importAttentionUpdate")).toBeNull();
  });

  it("keeps the last answer and keeps asking when one refresh goes unanswered", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const requested: Reply = {
      ...STALE_ATTENTION,
      sources: [{ ...(STALE_ATTENTION.sources as Reply[])[0], run_requested: true }],
    };
    const settled: Reply = {
      ...STALE_ATTENTION,
      stale_count: 0,
      sources: [
        {
          ...(STALE_ATTENTION.sources as Reply[])[0],
          stale: false,
          run_requested: false,
          last_ok_at: "2026-09-03T12:00:00.000Z",
        },
      ],
    };
    // First answer: a run is pending. Second: silence (a slow wake). Third: the run landed.
    const extension = installExtension({
      answersPing: true,
      attention: [requested, null, settled],
    });
    render(<MoneyImportAttentionPage />);
    await screen.findByText("money.importAttentionRequested");

    // The unanswered refresh: the list stays, a note says the answer is the previous one.
    await vi.advanceTimersByTimeAsync(20_000 + 3_000);
    await waitFor(() => expect(screen.getByTestId("money-import-attention-missed")).toBeTruthy());
    expect(screen.getByTestId("money-import-attention-tbank_web")).toBeTruthy();
    expect(screen.getByText("money.importAttentionRequested")).toBeTruthy();

    // Still asking: the next answer says the run finished, and "requested" goes away.
    await vi.advanceTimersByTimeAsync(20_000 + 3_000);
    await waitFor(() => expect(screen.queryByText("money.importAttentionRequested")).toBeNull());
    expect(screen.queryByTestId("money-import-attention-missed")).toBeNull();
    expect(extension.attentionCalls()).toBeGreaterThanOrEqual(3);
    vi.useRealTimers();
  });

  it("keeps asking through a ping that goes unanswered after a good answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const requested: Reply = {
      ...STALE_ATTENTION,
      sources: [{ ...(STALE_ATTENTION.sources as Reply[])[0], run_requested: true }],
    };
    const settled: Reply = {
      ...STALE_ATTENTION,
      stale_count: 0,
      sources: [
        {
          ...(STALE_ATTENTION.sources as Reply[])[0],
          stale: false,
          run_requested: false,
          last_ok_at: "2026-09-03T12:00:00.000Z",
        },
      ],
    };
    // First ping answered; the second (a slow wake) not; the third answered again.
    installExtension({
      answersPing: true,
      pingReplies: [true, false, true],
      attention: [requested, settled],
    });
    render(<MoneyImportAttentionPage />);
    await screen.findByText("money.importAttentionRequested");

    await vi.advanceTimersByTimeAsync(20_000 + 1_000);
    await waitFor(() => expect(screen.getByTestId("money-import-attention-missed")).toBeTruthy());
    expect(screen.getByTestId("money-import-attention-tbank_web")).toBeTruthy();

    await vi.advanceTimersByTimeAsync(20_000 + 1_000);
    await waitFor(() => expect(screen.queryByText("money.importAttentionRequested")).toBeNull());
    vi.useRealTimers();
  });

  it("shows the newest answer when an older refresh lands last", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fresh: Reply = {
      ...STALE_ATTENTION,
      stale_count: 0,
      sources: [
        {
          ...(STALE_ATTENTION.sources as Reply[])[0],
          stale: false,
          last_ok_at: "2026-09-03T12:00:00.000Z",
        },
      ],
    };
    // The first answer (stale) is held back; Refresh asks again and gets "fresh" at once.
    installExtension({
      answersPing: true,
      attention: [STALE_ATTENTION, fresh],
      attentionGates: [firstGate, null],
    });
    render(<MoneyImportAttentionPage />);
    await screen.findByText("money.importExtensionChecking");

    fireEvent.click(screen.getByText("common.refresh"));
    const card = await screen.findByTestId("money-import-attention-tbank_web");
    expect(card.getAttribute("data-stale")).toBe("false");

    // The older answer arrives last and changes nothing.
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("money-import-attention-tbank_web").getAttribute("data-stale")).toBe(
      "false",
    );
  });

  it("drops its own 'requested' once the extension reports the request settled", async () => {
    const settled: Reply = {
      ...STALE_ATTENTION,
      sources: [{ ...(STALE_ATTENTION.sources as Reply[])[0], run_requested: false }],
    };
    installExtension({
      answersPing: true,
      attention: [STALE_ATTENTION, settled],
      runRequest: { ok: true, source_id: "tbank_web", error: null },
    });
    render(<MoneyImportAttentionPage />);
    await screen.findByTestId("money-import-attention-tbank_web");

    fireEvent.click(screen.getByText("money.importAttentionUpdate"));

    // The ack shows "requested"; the refresh it triggers says the extension holds no request.
    await waitFor(() => expect(screen.queryByText("money.importAttentionRequested")).toBeNull());
  });

  it("keeps an edit made while a save was in flight", async () => {
    let releaseSave!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    installExtension({
      answersPing: true,
      attention: { ...STALE_ATTENTION, sources: [] },
      settings: { ok: true, stale_after_ms: 3 * DAY_MS },
      settingsGate: gate,
    });
    render(<MoneyImportAttentionPage />);
    const input = (await screen.findByLabelText(
      "money.importAttentionThresholdLabel",
    )) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(screen.getByText("common.save"));
    // Typing on while the extension has not answered yet.
    fireEvent.change(input, { target: { value: "5" } });
    releaseSave();

    await waitFor(() =>
      expect(screen.getByText('money.importAttentionThresholdSaved:{"days":3}')).toBeTruthy(),
    );
    // The refresh after the save reports one day; the field still shows the newer edit.
    await waitFor(() => expect(input.value).toBe("5"));
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
