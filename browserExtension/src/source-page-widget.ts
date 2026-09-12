import { shouldShowMoneyImportSourcePageWidget } from "./money-import-sources.js";
import {
  resolveWidgetLocale,
  widgetPhaseLabel,
  widgetText,
  type WidgetLocale,
} from "./core/widget-strings.js";

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
  /** Set on a session the sweep runs: whose run it is. Absent on a session a person started. */
  run_origin?: string;
};

/**
 * What the widget is for in this tab. A person's own import (`manual`) is the widget as it was:
 * a Run button and the progress after it. A run the sweep started shows differently: in the tab
 * the run works in (`run_tab`) it says whose run this is and asks the person not to close the
 * tab; in any other tab of the same bank (`other_tab`) it only says a run is on elsewhere. Before
 * a requested run has begun, the tab Update opened shows `waiting`: sign in, and wait.
 */
type WidgetMode = "manual" | "run_tab" | "other_tab" | "waiting";

/** What the worker says besides the session: which tab this is, and what it is waiting for. */
type WidgetSessionExtras = {
  is_run_tab?: unknown;
  pending_request?: unknown;
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
  title: HTMLElement;
  progressLabelText: HTMLElement;
  host: HTMLDivElement;
  statusText: HTMLDivElement;
  sessionText: HTMLDivElement;
  parsedCountText: HTMLDivElement;
  estimateText: HTMLDivElement;
  progressText: HTMLSpanElement;
  progressTrack: HTMLDivElement;
  progressWrap: HTMLDivElement;
  runButton: HTMLButtonElement;
  retryButton: HTMLButtonElement;
  errorText: HTMLDivElement;
  successText: HTMLDivElement;
}

interface WidgetState {
  session: WidgetSession | null;
  /** This tab is the one the session's run works in. */
  isRunTab: boolean;
  /** A run the person asked for, not yet begun: the source it is for. */
  pendingRequest: { source_id: string } | null;
  /**
   * The sweep's run has ended, windows and all. A window's own "done" is not that: the next
   * window follows in the same tab, and the tab is protected until the last one is through.
   */
  finished: boolean;
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
/** A tab of a sweep's run asks the worker this often, to learn of a run that ended silently. */
const UNATTENDED_REFRESH_MS = 5_000;
/**
 * Answers with no session before the widget of a sweep's run stands down. Between two windows
 * of one run the session is cleared and set again within a second; one empty answer is that
 * moment, three in a row is a run that died with its worker.
 */
const EMPTY_ANSWERS_BEFORE_STANDING_DOWN = 3;

function resolveMode(state: WidgetState): WidgetMode {
  const origin = readMessageText(state.session ?? {}, "run_origin");
  if (state.session && (origin === "auto" || origin === "requested")) {
    return state.isRunTab ? "run_tab" : "other_tab";
  }
  if (state.session) return "manual";
  return "waiting";
}

function readPendingRequest(value: unknown): { source_id: string } | null {
  if (!value || typeof value !== "object") return null;
  const sourceId = readMessageText(value as Record<string, unknown>, "source_id");
  return sourceId ? { source_id: sourceId } : null;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
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

function formatReceiptRequestCountSuffix(
  locale: WidgetLocale,
  receiptRequestCount: number | null,
): string {
  return typeof receiptRequestCount === "number"
    ? ` | ${widgetText(locale, "receiptRequests")}: ${receiptRequestCount}`
    : "";
}

function formatFullModeEstimateText(locale: WidgetLocale, state: WidgetState): string {
  const requestCountSuffix = formatReceiptRequestCountSuffix(
    locale,
    state.estimatedReceiptRequestCount,
  );
  const estimatedRemainingMs =
    typeof state.estimatedRemainingMs === "number" ? state.estimatedRemainingMs : null;
  const estimateUpdatedAtMs =
    typeof state.estimateUpdatedAtMs === "number" ? state.estimateUpdatedAtMs : null;

  if (state.batchId && !state.running) {
    return widgetText(locale, "fullModeCompleted");
  }

  if (state.running && estimatedRemainingMs !== null && estimateUpdatedAtMs !== null) {
    const elapsedMs = Date.now() - estimateUpdatedAtMs;
    const remainingMs = Math.max(0, estimatedRemainingMs - elapsedMs);
    if (remainingMs > 0) {
      return `${widgetText(locale, "fullModeEta")}: ${formatDurationTimer(remainingMs)}${requestCountSuffix}`;
    }
    return widgetText(locale, "fullModeWaiting") + requestCountSuffix;
  }

  return widgetText(locale, "fullModePending");
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
  const progressLabelText = document.createElement("span");
  progressLabel.appendChild(progressLabelText);
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
  actions.appendChild(runButton);

  const retryButton = document.createElement("button");
  retryButton.className = "button retry";
  retryButton.type = "button";
  retryButton.dataset.testid = "money-import-overlay-retry-button";
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
    title,
    progressLabelText,
    host,
    statusText,
    sessionText,
    parsedCountText,
    estimateText,
    progressText,
    progressTrack: progressFill,
    progressWrap,
    runButton,
    retryButton,
    errorText,
    successText,
  };
}

function defaultDeps(): SourcePageWidgetDeps {
  const runtimeSendMessage: RuntimeSendMessage = (message, callback) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      // No session in reach here, so the browser's language is the best guess available.
      const locale = resolveWidgetLocale(null, navigator.language);
      callback?.({ ok: false, error: widgetText(locale, "runtimeUnavailable") });
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
  let emptyAnswers = 0;
  let state: WidgetState = {
    session: null,
    isRunTab: false,
    pendingRequest: null,
    finished: false,
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

    // Resolved on every render rather than once: the session, and with it the language the
    // app is showing, can arrive after the widget is already on the page.
    const locale = resolveWidgetLocale(state.session, navigator.language);
    const mode = resolveMode(state);
    const origin = readMessageText(state.session ?? {}, "run_origin");
    elements.title.textContent = widgetText(
      locale,
      mode === "manual" ? "title" : "titleUnattended",
    );
    elements.progressLabelText.textContent = `${widgetText(locale, "progress")} `;
    elements.retryButton.textContent = widgetText(locale, "retry");

    const sessionId =
      readMessageText(state.session ?? {}, "session_id") ?? widgetText(locale, "noActiveSession");
    elements.sessionText.textContent = `${widgetText(locale, "session")}: ${sessionId}`;
    elements.sessionText.style.display = mode === "waiting" ? "none" : "block";

    if (mode === "other_tab") {
      elements.statusText.textContent = widgetText(locale, "statusOtherTab");
    } else if (mode !== "manual" && state.finished && state.error) {
      elements.statusText.textContent = widgetText(locale, "statusFailed");
    } else if (mode !== "manual" && state.finished) {
      // A tab that was waiting has no session to name an origin; only a request waits.
      elements.statusText.textContent = widgetText(
        locale,
        origin === "auto" ? "statusDoneAuto" : "statusDoneRequested",
      );
    } else if (mode === "waiting") {
      elements.statusText.textContent = widgetText(locale, "statusWaitingSignIn");
    } else if (mode === "run_tab") {
      // Whatever a window said of itself: the tab is the run's until the run says it is over.
      elements.statusText.textContent = widgetText(
        locale,
        origin === "requested" ? "statusOwnTabRequested" : "statusOwnTabAuto",
      );
    } else if (state.running) {
      elements.statusText.textContent = widgetText(locale, "statusRunning");
    } else if (state.batchId && state.phase === "review_ready") {
      elements.statusText.textContent = widgetText(locale, "statusReviewReady");
    } else if (state.batchId) {
      elements.statusText.textContent = widgetText(locale, "statusCompleted");
    } else {
      elements.statusText.textContent = widgetText(locale, "statusReady");
    }

    const parsedCountText =
      typeof state.parsedTransactionsCount === "number"
        ? `${widgetText(locale, "parsedTransactions")}: ${state.parsedTransactionsCount}`
        : `${widgetText(locale, "parsedTransactions")}: -`;
    elements.parsedCountText.textContent = parsedCountText;

    const parseStrategy = readMessageText(state.session ?? {}, "parse_strategy");
    if (parseStrategy === "full") {
      elements.estimateText.textContent = formatFullModeEstimateText(locale, state);
      elements.estimateText.style.display = "block";
    } else {
      elements.estimateText.style.display = "none";
      elements.estimateText.textContent = "";
    }

    const phaseText = widgetPhaseLabel(locale, state.phase);
    elements.progressText.textContent = `${phaseText} ${state.progressPercent}%`;
    elements.progressTrack.style.width = `${state.progressPercent}%`;
    elements.progressWrap.style.display = mode === "waiting" ? "none" : "block";
    elements.parsedCountText.style.display = mode === "waiting" ? "none" : "block";

    // A run nobody started here is not a run anybody starts or retries from here.
    elements.runButton.style.display = mode === "manual" ? "" : "none";
    elements.runButton.disabled = state.running;
    elements.runButton.textContent = state.running
      ? widgetText(locale, "running")
      : widgetText(locale, "run");

    if (state.error) {
      elements.errorText.style.display = "block";
      elements.errorText.textContent = state.error;
      elements.retryButton.style.display = mode === "manual" ? "inline-flex" : "none";
    } else {
      elements.errorText.style.display = "none";
      elements.errorText.textContent = "";
      elements.retryButton.style.display = "none";
    }

    if (state.batchId) {
      elements.successText.style.display = "block";
      elements.successText.textContent = `${widgetText(locale, "batch")}: ${state.batchId}`;
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
            error:
              readMessageText(response ?? {}, "error") ??
              widgetText(resolveWidgetLocale(state.session, navigator.language), "statusFailed"),
          };
          render();
          return;
        }
      },
    );
  };

  const applySession = (session: WidgetSession | null, extras: WidgetSessionExtras = {}) => {
    const pendingRequest = readPendingRequest(extras.pending_request);
    if (!shouldShowMoneyImportSourcePageWidget(session)) {
      // The tab of a sweep's run that has said nothing of its end: an empty answer may be the
      // moment between two windows, so the widget stands down only after a few in a row.
      if (state.session && resolveMode(state) !== "manual" && !state.finished && !pendingRequest) {
        emptyAnswers += 1;
        if (emptyAnswers < EMPTY_ANSWERS_BEFORE_STANDING_DOWN) return;
      }
      // No session, but a request the person made from the attention page that has not run
      // yet: the widget stays, and says what to do. A run that has told this tab how it ended
      // keeps its last word on the page. Otherwise there is nothing to show.
      state = { ...state, session: null, isRunTab: false, pendingRequest };
      if (!pendingRequest && !state.finished && mounted) {
        unmount();
        return;
      }
      render();
      return;
    }
    emptyAnswers = 0;
    const sameRun = session !== null && state.session?.session_id === session.session_id;
    state = {
      ...state,
      session,
      isRunTab: extras.is_run_tab === true,
      pendingRequest: null,
      // A new session is a new run, or the next window of one: what the last one said of its
      // end no longer holds.
      finished: sameRun ? state.finished : false,
    };
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
      applySession(nextSession, {
        is_run_tab: message.is_run_tab,
        pending_request: message.pending_request,
      });
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
      // A sweep's window is done; the run is not, until it says so. The tab stays protected.
      const unattended = resolveMode(state) !== "manual";
      state = {
        ...state,
        running: unattended ? state.running : false,
        error: null,
        phase: readMessageText(message, "phase") ?? "completed",
        progressPercent: 100,
        batchId: readMessageText(message, "batch_id"),
        estimatedRemainingMs: 0,
      };
      render();
      return;
    }

    if (type === "MONEY_IMPORT_RUN_FINISHED") {
      const ok = message.ok === true;
      state = {
        ...state,
        finished: true,
        running: false,
        error: ok
          ? null
          : (readMessageText(message, "error") ??
            widgetText(resolveWidgetLocale(state.session, navigator.language), "statusFailed")),
        phase: ok ? "completed" : state.phase,
        progressPercent: ok ? 100 : state.progressPercent,
        estimatedRemainingMs: ok ? 0 : state.estimatedRemainingMs,
      };
      render();
      return;
    }

    if (type === "MONEY_IMPORT_ERROR") {
      state = {
        ...state,
        running: false,
        error:
          readMessageText(message, "error") ??
          widgetText(resolveWidgetLocale(state.session, navigator.language), "statusFailed"),
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
        applySession(nextSession, {
          is_run_tab: response?.is_run_tab,
          pending_request: response?.pending_request,
        });
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

  /**
   * The tab a run works in is asked about before it closes, while the run is on. The browser
   * shows the question only in a tab the person has touched -- the sweep's own tab has never
   * been touched and closes silently, which is what its own closing needs.
   */
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!state.running || resolveMode(state) !== "run_tab") return;
    event.preventDefault();
    event.returnValue = "";
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
    window.addEventListener("beforeunload", onBeforeUnload);

    runtimeListener = (message) => handleRuntimeMessage(message);
    deps.addRuntimeListener(runtimeListener);
    startKeepAlive();
    let ticks = 0;
    renderIntervalId = window.setInterval(() => {
      ticks += 1;
      render();
      // An onlooker's tab and a waiting tab hear no broadcasts, and the run's own tab would
      // wait forever on a run that died with its worker: each asks the worker instead, until
      // the run has said how it ended.
      if (
        resolveMode(state) !== "manual" &&
        !state.finished &&
        ticks % (UNATTENDED_REFRESH_MS / 1000) === 0
      ) {
        requestSession();
      }
    }, 1000);
    mounted = true;
    requestSession();
    render();
  };

  const unmount = () => {
    if (!mounted) return;
    window.removeEventListener("beforeunload", onBeforeUnload);
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
