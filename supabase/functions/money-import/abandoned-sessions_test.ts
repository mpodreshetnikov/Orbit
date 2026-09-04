// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { closeAbandonedSessions, SESSION_EXPIRED_REASON } from "./abandoned-sessions.ts";
import type { MoneyImportRepository } from "./repository.ts";

interface Recorded {
  scans: Array<{ source: string; payerPersonId: string; nowIso: string }>;
  sessionCloses: Array<{ sessionId: string; nowIso: string; patch: Record<string, unknown> }>;
  batchCloses: Array<{ batchId: string; patch: Record<string, unknown> }>;
  events: Array<{ level: string; message: string; attrs?: Record<string, unknown> }>;
}

function createHarness(options: {
  expired?: Record<string, unknown>[] | (() => Promise<Record<string, unknown>[]>);
  /** Batch rows by id; the status decides whether a conditional close finds the row open. */
  batches?: Record<string, Record<string, unknown>>;
  /** Whether the conditional session close still finds the row open and expired. */
  sessionStillOpen?: (sessionId: string) => boolean;
  failSessionClose?: string;
  withoutScan?: boolean;
}) {
  const recorded: Recorded = { scans: [], sessionCloses: [], batchCloses: [], events: [] };
  const repository = {
    ...(options.withoutScan
      ? {}
      : {
          listExpiredOpenSessions: async (
            source: string,
            payerPersonId: string,
            nowIso: string,
          ) => {
            recorded.scans.push({ source, payerPersonId, nowIso });
            const expired = options.expired ?? [];
            return typeof expired === "function" ? await expired() : expired;
          },
        }),
    getImportBatch: async (batchId: string) => options.batches?.[batchId] ?? null,
    closeOpenBatch: async (batchId: string, patch: Record<string, unknown>) => {
      recorded.batchCloses.push({ batchId, patch });
      const status = options.batches?.[batchId]?.status;
      return status === "running" || status === "created";
    },
    closeExpiredOpenSession: async (
      sessionId: string,
      nowIso: string,
      patch: Record<string, unknown>,
    ) => {
      if (options.failSessionClose === sessionId) throw new Error("storage said no");
      recorded.sessionCloses.push({ sessionId, nowIso, patch });
      return options.sessionStillOpen?.(sessionId) ?? true;
    },
  } as unknown as MoneyImportRepository;
  const telemetry = {
    info: (message: string, attrs?: Record<string, unknown>) =>
      recorded.events.push({ level: "info", message, attrs }),
    warn: (message: string, attrs?: Record<string, unknown>) =>
      recorded.events.push({ level: "warn", message, attrs }),
    error: (message: string, attrs?: Record<string, unknown>) =>
      recorded.events.push({ level: "error", message, attrs }),
    startSpan: () => ({ end: async () => {} }),
  } as unknown as NonNullable<Parameters<typeof closeAbandonedSessions>[0]["telemetry"]>;
  const deps = { repository, telemetry, now: () => new Date("2026-09-04T06:00:00.000Z") };
  return { deps, recorded };
}

const scope = { source: "tbank_web", payerPersonId: "person-1" };

Deno.test(
  "closeAbandonedSessions closes the expired session and the batch it was running",
  async () => {
    const { deps, recorded } = createHarness({
      expired: [
        {
          id: "session-dead",
          batch_id: "batch-dead",
          expires_at: "2026-09-03T09:38:16.275Z",
          meta: { parse_strategy: "full" },
        },
      ],
      batches: {
        "batch-dead": { id: "batch-dead", status: "running", meta: { parse_strategy: "full" } },
      },
    });

    const result = await closeAbandonedSessions(deps, scope);

    assertEquals(result, { sessions: 1, batches: 1 });
    assertEquals(recorded.scans, [
      { source: "tbank_web", payerPersonId: "person-1", nowIso: "2026-09-04T06:00:00.000Z" },
    ]);
    // The batch ended when its session did, not when somebody noticed.
    assertEquals(recorded.batchCloses, [
      {
        batchId: "batch-dead",
        patch: {
          status: "failed",
          completed_at: "2026-09-03T09:38:16.275Z",
          meta: { parse_strategy: "full", failure_reason: SESSION_EXPIRED_REASON },
        },
      },
    ]);
    assertEquals(recorded.sessionCloses, [
      {
        sessionId: "session-dead",
        nowIso: "2026-09-04T06:00:00.000Z",
        patch: {
          status: "failed",
          revoked_at: "2026-09-04T06:00:00.000Z",
          updated_at: "2026-09-04T06:00:00.000Z",
          meta: { parse_strategy: "full", failure_reason: SESSION_EXPIRED_REASON },
        },
      },
    ]);
    assertEquals(
      recorded.events.map((event) => event.message),
      ["money_import_abandoned_session_closed"],
    );
  },
);

Deno.test(
  "closeAbandonedSessions leaves a pending preview to the person, and a finished batch alone",
  async () => {
    const { deps, recorded } = createHarness({
      expired: [
        {
          id: "session-preview",
          batch_id: "batch-preview",
          expires_at: "2026-09-03T09:27:12.381Z",
        },
        {
          id: "session-applied",
          batch_id: "batch-applied",
          expires_at: "2026-09-03T09:26:46.853Z",
        },
        { id: "session-bare", batch_id: null, expires_at: "2026-09-03T09:00:00.000Z" },
      ],
      batches: {
        "batch-preview": { id: "batch-preview", status: "pending" },
        "batch-applied": { id: "batch-applied", status: "completed" },
      },
    });

    const result = await closeAbandonedSessions(deps, scope);

    // The conditional write finds neither batch open, so neither counts as closed.
    assertEquals(result, { sessions: 3, batches: 0 });
    assertEquals(
      recorded.sessionCloses.map((close) => [close.sessionId, close.patch.status]),
      [
        ["session-preview", "failed"],
        ["session-applied", "failed"],
        ["session-bare", "failed"],
      ],
    );
    assertEquals(
      recorded.events.map((event) => event.attrs?.batch_closed),
      [false, false, false],
    );
  },
);

Deno.test(
  "closeAbandonedSessions does not count a session that completed while it looked",
  async () => {
    // A request that passed auth just before the expiry finished the import between the scan and
    // the write: the conditional close finds the row completed, and the scan says nothing.
    const { deps, recorded } = createHarness({
      expired: [
        { id: "session-racing", batch_id: "batch-racing", expires_at: "2026-09-04T05:59:59.000Z" },
      ],
      batches: { "batch-racing": { id: "batch-racing", status: "completed" } },
      sessionStillOpen: () => false,
    });

    const result = await closeAbandonedSessions(deps, scope);

    assertEquals(result, { sessions: 0, batches: 0 });
    assertEquals(recorded.sessionCloses.length, 1);
    assertEquals(recorded.events, []);
  },
);

Deno.test(
  "closeAbandonedSessions does nothing without a scan, and survives one that fails",
  async () => {
    const without = createHarness({ withoutScan: true });
    assertEquals(await closeAbandonedSessions(without.deps, scope), { sessions: 0, batches: 0 });
    assertEquals(without.recorded.sessionCloses, []);

    const failing = createHarness({
      expired: async () => {
        throw new Error("relation is being vacuumed");
      },
    });
    assertEquals(await closeAbandonedSessions(failing.deps, scope), { sessions: 0, batches: 0 });
    assertEquals(
      failing.recorded.events.map((event) => [event.level, event.message]),
      [["warn", "money_import_abandoned_session_scan_failed"]],
    );
  },
);

Deno.test(
  "closeAbandonedSessions closes the rest when one session refuses, and its batch first",
  async () => {
    const { deps, recorded } = createHarness({
      expired: [
        { id: "session-stubborn", batch_id: "batch-1", expires_at: "2026-09-03T09:00:00.000Z" },
        { id: "session-plain", batch_id: "batch-2", expires_at: "2026-09-03T09:10:00.000Z" },
      ],
      batches: {
        "batch-1": { id: "batch-1", status: "running" },
        "batch-2": { id: "batch-2", status: "running" },
      },
      failSessionClose: "session-stubborn",
    });

    const result = await closeAbandonedSessions(deps, scope);

    // The stubborn session stays open, so the next scan takes it again; its batch is closed
    // already, and a conditional close will not close it twice.
    assertEquals(result, { sessions: 1, batches: 2 });
    assertEquals(
      recorded.batchCloses.map((close) => close.batchId),
      ["batch-1", "batch-2"],
    );
    assertEquals(
      recorded.sessionCloses.map((close) => close.sessionId),
      ["session-plain"],
    );
    assertEquals(
      recorded.events.map((event) => [event.level, event.message]),
      [
        ["warn", "money_import_abandoned_session_close_failed"],
        ["info", "money_import_abandoned_session_closed"],
      ],
    );
  },
);
