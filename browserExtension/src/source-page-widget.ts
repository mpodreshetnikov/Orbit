type RuntimeSendMessage = (
  message: Record<string, unknown>,
  callback?: (response: Record<string, unknown> | undefined) => void,
) => void;

type RuntimeMessageListener = (message: Record<string, unknown>) => void;

interface SourcePageWidgetDeps {
  runtimeSendMessage: RuntimeSendMessage;
  addRuntimeListener: (listener: RuntimeMessageListener) => void;
  removeRuntimeListener: (listener: RuntimeMessageListener) => void;
  runtimeConnect: () => {
    postMessage: (message: Record<string, unknown>) => void;
    disconnect: () => void;
  } | null;
}

type WidgetSession = Record<string, unknown> & {
  session_id?: string;
  source?: string;
  app_origin?: string;
  show_source_page_widget?: boolean;
};

type WidgetActiveRun = Record<string, unknown> & {
  running?: boolean;
  phase?: string;
  progress_percent?: number;
  parsed_transactions_count?: number;
  batch_id?: string;
  error?: string;
};

interface WidgetElements {
  host: HTMLDivElement;
  statusText: HTMLDivElement;
  sessionText: HTMLDivElement;
  parsedCountText: HTMLDivElement;
  estimateText: HTMLDivElement;
  progressText: HTMLSpanElement;
  progressTrack: HTMLDivElement;
  runButton: HTMLButtonElement;
  retryButton: HTMLButtonElement;
  errorText: HTMLDivElement;
  successText: HTMLDivElement;
}

interface WidgetState {
  session: WidgetSession | null;
  running: boolean;
  error: string | null;
  progressPercent: number;
  parsedTransactionsCount: number | null;
  phase: string | null;
  batchId: string | null;
  estimatedTotalMs: number | null;
  estimatedRemainingMs: number | null;
  estimatedReceiptRequestCount: number | null;
  estimateUpdatedAtMs: number | null;
}

const ROOT_ID = "orbit-money-import-widget-root";
const KEEPALIVE_PING_MS = 20_000;

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function formatPhase(phase: string | null): string {
  if (!phase) return "Idle";
  if (phase === "starting") return "Starting import";
  if (phase === "parse_preparing_tab") return "Preparing T-Bank tab";
  if (phase === "parse_loading_operations_page") return "Opening operations page";
  if (phase === "parse_extracting_page_data") return "Starting page extraction";
  if (phase === "parse_discovering_endpoints") return "Discovering bank endpoints";
  if (phase === "parse_fetching_ranges") return "Loading transaction ranges";
  if (phase === "parse_enriching_operations") return "Loading transaction details";
  if (phase === "parse_using_dom_fallback") return "Using page fallback";
  if (phase === "parse_dom_rows_ready") return "Fallback rows ready";
  if (phase === "parse_mapping_rows") return "Mapping parsed rows";
  if (phase === "parse_completed") return "Parsing completed";
  if (phase === "preview_rows_started") return "Preparing preview";
  if (phase === "complete_session_started") return "Finalizing import";
  if (phase === "parse_only_completed") return "Parse-only completed";
  if (phase === "review_ready") return "Preview ready for review";
  if (phase === "completed") return "Import completed";
  return phase.replace(/_/g, " ");
}

function readMessageText(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readFiniteNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function shouldShowWidgetForSession(session: WidgetSession | null): boolean {
  return session?.source === "tbank_web" && session?.show_source_page_widget === true;
}

function formatDurationTimer(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatReceiptRequestCountSuffix(receiptRequestCount: number | null): string {
  return typeof receiptRequestCount === "number"
    ? ` | Receipt detail requests: ${receiptRequestCount}`
    : "";
}

function formatFullModeEstimateText(state: WidgetState): string {
  const requestCountSuffix = formatReceiptRequestCountSuffix(state.estimatedReceiptRequestCount);
  const estimatedRemainingMs =
    typeof state.estimatedRemainingMs === "number" ? state.estimatedRemainingMs : null;
  const estimateUpdatedAtMs =
    typeof state.estimateUpdatedAtMs === "number" ? state.estimateUpdatedAtMs : null;

  if (state.batchId && !state.running) {
    return "Full mode ETA: completed";
  }

  if (state.running && estimatedRemainingMs !== null && estimateUpdatedAtMs !== null) {
    const elapsedMs = Date.now() - estimateUpdatedAtMs;
    const remainingMs = Math.max(0, estimatedRemainingMs - elapsedMs);
    if (remainingMs > 0) {
      return `Full mode ETA: ${formatDurationTimer(remainingMs)}${requestCountSuffix}`;
    }
    return (
      "Full mode status: waiting for T-Bank cooldown or pending detail response" +
      requestCountSuffix
    );
  }

  return "Full mode ETA appears after T-Bank counts transactions in the selected range";
}

function createStyleElement(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .panel {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 360px;
      background: #001f3f;
      color: #ffffff;
      border: 2px solid #ffd60a;
      border-radius: 14px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45);
      z-index: 2147483647;
      padding: 14px;
    }
    .title {
      margin: 0 0 10px;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.3;
    }
    .meta {
      margin: 0 0 6px;
      font-size: 12px;
      opacity: 0.9;
      word-break: break-word;
    }
    .status {
      margin: 0 0 10px;
      font-size: 13px;
      font-weight: 600;
    }
    .progress-wrap {
      margin: 0 0 10px;
    }
    .progress-label {
      font-size: 12px;
      margin: 0 0 5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .progress-track {
      position: relative;
      height: 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.24);
      overflow: hidden;
    }
    .progress-fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0%;
      background: linear-gradient(90deg, #00e5ff 0%, #76ff03 100%);
      transition: width 180ms ease;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .button {
      appearance: none;
      border: 0;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 80ms ease;
    }
    .button:active {
      transform: scale(0.98);
    }
    .run {
      flex: 1;
      min-width: 170px;
      background: #ffd60a;
      color: #101010;
    }
    .retry {
      display: none;
      background: #ff5a5f;
      color: #ffffff;
    }
    .error {
      margin-top: 8px;
      color: #ffd7d9;
      font-size: 12px;
      display: none;
      white-space: pre-wrap;
    }
    .success {
      margin-top: 8px;
      color: #9cffc8;
      font-size: 12px;
      display: none;
      white-space: pre-wrap;
    }
  `;
  return style;
}

function createElements(): WidgetElements {
  const host = document.createElement("div");
  host.id = ROOT_ID;

  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.appendChild(createStyleElement());

  const panel = document.createElement("section");
  panel.className = "panel";

  const title = document.createElement("h2");
  title.className = "title";
  title.textContent = "Money import";
  panel.appendChild(title);

  const sessionText = document.createElement("div");
  sessionText.className = "meta";
  panel.appendChild(sessionText);

  const statusText = document.createElement("div");
  statusText.className = "status";
  panel.appendChild(statusText);

  const parsedCountText = document.createElement("div");
  parsedCountText.className = "meta";
  panel.appendChild(parsedCountText);

  const estimateText = document.createElement("div");
  estimateText.className = "meta";
  panel.appendChild(estimateText);

  const progressWrap = document.createElement("div");
  progressWrap.className = "progress-wrap";
  const progressLabel = document.createElement("div");
  progressLabel.className = "progress-label";
  progressLabel.textContent = "Progress";
  const progressText = document.createElement("span");
  progressLabel.appendChild(progressText);
  progressWrap.appendChild(progressLabel);
  const progressTrack = document.createElement("div");
  progressTrack.className = "progress-track";
  const progressFill = document.createElement("div");
  progressFill.className = "progress-fill";
  progressTrack.appendChild(progressFill);
  progressWrap.appendChild(progressTrack);
  panel.appendChild(progressWrap);

  const actions = document.createElement("div");
  actions.className = "actions";

  const runButton = document.createElement("button");
  runButton.className = "button run";
  runButton.type = "button";
  runButton.dataset.testid = "money-import-overlay-run-button";
  runButton.textContent = "Run import";
  actions.appendChild(runButton);

  const retryButton = document.createElement("button");
  retryButton.className = "button retry";
  retryButton.type = "button";
  retryButton.dataset.testid = "money-import-overlay-retry-button";
  retryButton.textContent = "Retry";
  actions.appendChild(retryButton);

  panel.appendChild(actions);

  const errorText = document.createElement("div");
  errorText.className = "error";
  panel.appendChild(errorText);

  const successText = document.createElement("div");
  successText.className = "success";
  panel.appendChild(successText);

  shadowRoot.appendChild(panel);

  return {
    host,
    statusText,
    sessionText,
    parsedCountText,
    estimateText,
    progressText,
    progressTrack: progressFill,
    runButton,
    retryButton,
    errorText,
    successText,
  };
}

function defaultDeps(): SourcePageWidgetDeps {
  const runtimeSendMessage: RuntimeSendMessage = (message, callback) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      callback?.({ ok: false, error: "Extension runtime is unavailable" });
      return;
    }
    if (callback) {
      chrome.runtime.sendMessage(message, callback);
      return;
    }
    void chrome.runtime.sendMessage(message);
  };

  return {
    runtimeSendMessage,
    addRuntimeListener: (listener) => {
      if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
      chrome.runtime.onMessage.addListener(listener);
    },
    removeRuntimeListener: (listener) => {
      if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
      chrome.runtime.onMessage.removeListener(listener);
    },
    runtimeConnect: () => {
      if (typeof chrome === "undefined" || !chrome.runtime?.connect) return null;
      return chrome.runtime.connect({ name: "money-import-source-widget" });
    },
  };
}

export function createSourcePageWidget(customDeps?: Partial<SourcePageWidgetDeps>) {
  const deps = {
    ...defaultDeps(),
    ...(customDeps ?? {}),
  } satisfies SourcePageWidgetDeps;

  let elements: WidgetElements | null = null;
  let mounted = false;
  let runtimeListener: RuntimeMessageListener | null = null;
  let renderIntervalId: number | null = null;
  let keepAliveIntervalId: number | null = null;
  let keepAlivePort: ReturnType<SourcePageWidgetDeps["runtimeConnect"]> | null = null;
  let state: WidgetState = {
    session: null,
    running: false,
    error: null,
    progressPercent: 0,
    parsedTransactionsCount: null,
    phase: null,
    batchId: null,
    estimatedTotalMs: null,
    estimatedRemainingMs: null,
    estimatedReceiptRequestCount: null,
    estimateUpdatedAtMs: null,
  };

  const render = () => {
    if (!elements) return;

    const sessionId = readMessageText(state.session ?? {}, "session_id") ?? "no active session";
    elements.sessionText.textContent = `Session: ${sessionId}`;

    if (state.running) {
      elements.statusText.textContent = "Import is running";
    } else if (state.error) {
      elements.statusText.textContent = "Import failed";
    } else if (state.batchId && state.phase === "review_ready") {
      elements.statusText.textContent = "Preview ready for review";
    } else if (state.batchId) {
      elements.statusText.textContent = "Import completed";
    } else {
      elements.statusText.textContent = "Ready to run";
    }

    const parsedCountText =
      typeof state.parsedTransactionsCount === "number"
        ? `Parsed transactions: ${state.parsedTransactionsCount}`
        : "Parsed transactions: -";
    elements.parsedCountText.textContent = parsedCountText;

    const parseStrategy = readMessageText(state.session ?? {}, "parse_strategy");
    if (parseStrategy === "full") {
      elements.estimateText.textContent = formatFullModeEstimateText(state);
      elements.estimateText.style.display = "block";
    } else {
      elements.estimateText.style.display = "none";
      elements.estimateText.textContent = "";
    }

    const phaseText = formatPhase(state.phase);
    elements.progressText.textContent = `${phaseText} ${state.progressPercent}%`;
    elements.progressTrack.style.width = `${state.progressPercent}%`;

    elements.runButton.disabled = state.running;
    elements.runButton.textContent = state.running ? "Import running..." : "Run import";

    if (state.error) {
      elements.errorText.style.display = "block";
      elements.errorText.textContent = state.error;
      elements.retryButton.style.display = "inline-flex";
    } else {
      elements.errorText.style.display = "none";
      elements.errorText.textContent = "";
      elements.retryButton.style.display = "none";
    }

    if (state.batchId) {
      elements.successText.style.display = "block";
      elements.successText.textContent = `Batch: ${state.batchId}`;
    } else {
      elements.successText.style.display = "none";
      elements.successText.textContent = "";
    }
  };

  const startImport = () => {
    state = {
      ...state,
      running: true,
      error: null,
      phase: "starting",
      progressPercent: Math.max(state.progressPercent, 2),
      batchId: null,
      estimatedTotalMs: null,
      estimatedRemainingMs: null,
      estimatedReceiptRequestCount: null,
      estimateUpdatedAtMs: null,
    };
    render();

    deps.runtimeSendMessage(
      {
        type: "MONEY_IMPORT_RUN",
        origin: "source_page_overlay",
      },
      (response) => {
        const ok = Boolean(response?.ok);
        if (!ok) {
          state = {
            ...state,
            running: false,
            error: readMessageText(response ?? {}, "error") ?? "Import failed",
          };
          render();
          return;
        }
      },
    );
  };

  const applySession = (session: WidgetSession | null) => {
    if (!shouldShowWidgetForSession(session)) {
      state = {
        ...state,
        session: null,
      };
      if (mounted) {
        unmount();
      }
      return;
    }
    state = { ...state, session };
    render();
  };

  const applyActiveRun = (activeRun: WidgetActiveRun | null) => {
    if (!activeRun) return;
    state = {
      ...state,
      running: typeof activeRun.running === "boolean" ? activeRun.running : state.running,
      error: readMessageText(activeRun, "error") ?? null,
      progressPercent:
        typeof activeRun.progress_percent === "number"
          ? clampProgress(activeRun.progress_percent)
          : state.progressPercent,
      parsedTransactionsCount:
        typeof activeRun.parsed_transactions_count === "number"
          ? activeRun.parsed_transactions_count
          : state.parsedTransactionsCount,
      estimatedTotalMs: readFiniteNumber(activeRun, "estimated_total_ms") ?? state.estimatedTotalMs,
      estimatedRemainingMs:
        readFiniteNumber(activeRun, "estimated_remaining_ms") ?? state.estimatedRemainingMs,
      estimatedReceiptRequestCount:
        readFiniteNumber(activeRun, "estimated_receipt_request_count") ??
        state.estimatedReceiptRequestCount,
      estimateUpdatedAtMs: (() => {
        const rawEstimateUpdatedAt = readMessageText(activeRun, "estimate_updated_at");
        if (!rawEstimateUpdatedAt) return state.estimateUpdatedAtMs;
        const parsed = new Date(rawEstimateUpdatedAt).getTime();
        return Number.isFinite(parsed) ? parsed : state.estimateUpdatedAtMs;
      })(),
      phase: readMessageText(activeRun, "phase") ?? state.phase,
      batchId: readMessageText(activeRun, "batch_id") ?? state.batchId,
    };
    render();
  };

  const handleRuntimeMessage = (message: Record<string, unknown>) => {
    const type = readMessageText(message, "type");
    if (!type) return;

    if (type === "MONEY_IMPORT_SESSION_UPDATED") {
      const nextSession =
        message.session && typeof message.session === "object"
          ? (message.session as WidgetSession)
          : null;
      applySession(nextSession);
      return;
    }

    if (type === "MONEY_IMPORT_PROGRESS") {
      const progress =
        typeof message.progress_percent === "number"
          ? clampProgress(message.progress_percent)
          : state.progressPercent;
      state = {
        ...state,
        running: true,
        error: null,
        phase: readMessageText(message, "phase") ?? state.phase,
        progressPercent: progress,
        parsedTransactionsCount:
          typeof message.parsed_transactions_count === "number"
            ? message.parsed_transactions_count
            : state.parsedTransactionsCount,
        estimatedTotalMs: readFiniteNumber(message, "estimated_total_ms") ?? state.estimatedTotalMs,
        estimatedRemainingMs:
          readFiniteNumber(message, "estimated_remaining_ms") ?? state.estimatedRemainingMs,
        estimatedReceiptRequestCount:
          readFiniteNumber(message, "estimated_receipt_request_count") ??
          state.estimatedReceiptRequestCount,
        estimateUpdatedAtMs: (() => {
          const rawEstimateUpdatedAt = readMessageText(message, "estimate_updated_at");
          if (!rawEstimateUpdatedAt) return state.estimateUpdatedAtMs;
          const parsed = new Date(rawEstimateUpdatedAt).getTime();
          return Number.isFinite(parsed) ? parsed : state.estimateUpdatedAtMs;
        })(),
      };
      render();
      return;
    }

    if (type === "MONEY_IMPORT_DONE") {
      state = {
        ...state,
        running: false,
        error: null,
        phase: readMessageText(message, "phase") ?? "completed",
        progressPercent: 100,
        batchId: readMessageText(message, "batch_id"),
        estimatedRemainingMs: 0,
      };
      render();
      return;
    }

    if (type === "MONEY_IMPORT_ERROR") {
      state = {
        ...state,
        running: false,
        error: readMessageText(message, "error") ?? "Import failed",
      };
      render();
    }
  };

  const requestSession = () => {
    deps.runtimeSendMessage(
      {
        type: "MONEY_IMPORT_GET_SESSION",
      },
      (response) => {
        const nextSession =
          response?.session && typeof response.session === "object"
            ? (response.session as WidgetSession)
            : null;
        applySession(nextSession);
        const activeRun =
          response?.active_run && typeof response.active_run === "object"
            ? (response.active_run as WidgetActiveRun)
            : null;
        applyActiveRun(activeRun);
      },
    );
  };

  const startKeepAlive = () => {
    keepAlivePort = deps.runtimeConnect();
    if (!keepAlivePort) return;

    const sendKeepAlive = () => {
      keepAlivePort?.postMessage({
        type: "MONEY_IMPORT_KEEPALIVE",
      });
    };

    sendKeepAlive();
    keepAliveIntervalId = window.setInterval(sendKeepAlive, KEEPALIVE_PING_MS);
  };

  const stopKeepAlive = () => {
    if (keepAliveIntervalId !== null) {
      window.clearInterval(keepAliveIntervalId);
    }
    keepAliveIntervalId = null;
    keepAlivePort?.disconnect();
    keepAlivePort = null;
  };

  const mount = () => {
    if (mounted) {
      render();
      return;
    }

    elements = createElements();
    document.body.appendChild(elements.host);
    elements.runButton.addEventListener("click", startImport);
    elements.retryButton.addEventListener("click", startImport);

    runtimeListener = (message) => handleRuntimeMessage(message);
    deps.addRuntimeListener(runtimeListener);
    startKeepAlive();
    renderIntervalId = window.setInterval(() => {
      render();
    }, 1000);
    mounted = true;
    requestSession();
    render();
  };

  const unmount = () => {
    if (!mounted) return;
    if (runtimeListener) {
      deps.removeRuntimeListener(runtimeListener);
    }
    runtimeListener = null;
    if (renderIntervalId !== null) {
      window.clearInterval(renderIntervalId);
    }
    renderIntervalId = null;
    stopKeepAlive();
    elements?.host.remove();
    elements = null;
    mounted = false;
  };

  return {
    mount,
    unmount,
    handleRuntimeMessage,
  };
}

declare global {
  interface Window {
    __orbitSourcePageWidget?: ReturnType<typeof createSourcePageWidget>;
  }
}

function autoMountWidget(): void {
  if (typeof window === "undefined") return;
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;

  if (!window.__orbitSourcePageWidget) {
    window.__orbitSourcePageWidget = createSourcePageWidget();
  }
  window.__orbitSourcePageWidget.mount();
}

autoMountWidget();
