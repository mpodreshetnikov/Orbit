type DebugLevel = "debug" | "info" | "warn" | "error";
type DebugStatus = "running" | "ok" | "error";

export type ImportDebugAttrs = Record<string, boolean | number | string | null>;

const FORBIDDEN_KEY = /(password|secret|token|authorization|cookie|set-cookie|email|phone)/i;

export interface ImportDebugRunContext {
  debug_run_id: string;
  session_id: string | null;
  batch_id: string | null;
  source: string | null;
  tab_id: number | null;
  window_from: string | null;
  started_at: string;
  finished_at: string | null;
  status: DebugStatus;
  error_message: string | null;
  trace_id: string;
  request_id: string;
}

export interface ImportDebugEvent {
  timestamp: string;
  level: DebugLevel;
  event: string;
  debug_run_id: string;
  trace_id: string;
  request_id: string;
  session_id: string | null;
  batch_id: string | null;
  source: string | null;
  tab_id: number | null;
  window_from: string | null;
  attrs?: ImportDebugAttrs;
}

export interface ImportDebugRunSummary {
  run: ImportDebugRunContext;
  events: ImportDebugEvent[];
  event_count: number;
}

export interface ImportDebugStartInput {
  debug_run_id?: string;
  session_id?: string | null;
  batch_id?: string | null;
  source?: string | null;
  tab_id?: number | null;
  window_from?: string | null;
}

export interface ImportDebugAppendInput {
  level?: DebugLevel;
  event: string;
  attrs?: Record<string, unknown>;
}

export interface ImportDebugStore {
  startRun(input: ImportDebugStartInput): ImportDebugRunContext;
  append(runId: string, input: ImportDebugAppendInput): void;
  finish(runId: string, status: "ok" | "error", errorMessage?: string | null): void;
  getLastRunSummary(): ImportDebugRunSummary | null;
  clearRuns(): void;
}

interface InternalRunState {
  run: ImportDebugRunContext;
  events: ImportDebugEvent[];
}

function randomHex(bytes: number): string {
  const array = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(array)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function toScalar(value: unknown): boolean | number | string | null {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null;
}

function sanitizeAttrs(attrs: Record<string, unknown> | undefined): ImportDebugAttrs | undefined {
  if (!attrs) return undefined;
  const result: ImportDebugAttrs = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    const scalar = toScalar(value);
    if (scalar !== null) {
      result[key] = scalar;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function createImportDebugStore(maxRuns = 20): ImportDebugStore {
  const runs = new Map<string, InternalRunState>();
  const order: string[] = [];

  const touch = (runId: string) => {
    order.push(runId);
    while (order.length > maxRuns) {
      const dropped = order.shift();
      if (dropped) runs.delete(dropped);
    }
  };

  return {
    startRun(input) {
      const now = new Date().toISOString();
      const runId = (input.debug_run_id || `dbg_${randomHex(8)}`).trim();
      const run: ImportDebugRunContext = {
        debug_run_id: runId,
        session_id: input.session_id ?? null,
        batch_id: input.batch_id ?? null,
        source: input.source ?? null,
        tab_id: input.tab_id ?? null,
        window_from: input.window_from ?? null,
        started_at: now,
        finished_at: null,
        status: "running",
        error_message: null,
        trace_id: randomHex(16),
        request_id: `ext_${randomHex(8)}`,
      };

      runs.set(runId, { run, events: [] });
      touch(runId);
      return run;
    },
    append(runId, input) {
      const state = runs.get(runId);
      if (!state) return;
      const event: ImportDebugEvent = {
        timestamp: new Date().toISOString(),
        level: input.level ?? "info",
        event: input.event,
        debug_run_id: runId,
        trace_id: state.run.trace_id,
        request_id: state.run.request_id,
        session_id: state.run.session_id,
        batch_id: state.run.batch_id,
        source: state.run.source,
        tab_id: state.run.tab_id,
        window_from: state.run.window_from,
        attrs: sanitizeAttrs(input.attrs),
      };
      state.events.push(event);
    },
    finish(runId, status, errorMessage) {
      const state = runs.get(runId);
      if (!state) return;
      state.run.status = status;
      state.run.finished_at = new Date().toISOString();
      state.run.error_message = errorMessage ?? null;
    },
    getLastRunSummary() {
      const runId = order[order.length - 1];
      if (!runId) return null;
      const state = runs.get(runId);
      if (!state) return null;
      return {
        run: state.run,
        events: state.events,
        event_count: state.events.length,
      };
    },
    clearRuns() {
      runs.clear();
      order.length = 0;
    },
  };
}
