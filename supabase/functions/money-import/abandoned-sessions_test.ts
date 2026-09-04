// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { closeAbandonedSessions, SESSION_EXPIRED_REASON } from "./abandoned-sessions.ts";
import type { MoneyImportRepository } from "./repository.ts";

interface Recorded {
  scans: Array<{ source: string; payerPersonId: string; nowIso: string }>;
  sessionUpdates: Array<{ sessionId: string; patch: Record<string, unknown> }>;
  batchUpdates: Array<{ batchId: string; patch: Record<string, unknown> }>;
  events: Array<{ level: string; message: string; attrs?: Record<string, unknown> }>;
}

function createHarness(options: {
  expired?: Record<string, unknown>[] | (() => Promise<Record<string, unknown>[]>);
  batches?: Record<string, Record<string, unknown>>;
  failSessionUpdate?: string;
  withoutScan?: boolean;
}) {
  const recorded: Recorded = { scans: [], sessionUpdates: [], batchUpdates: [], events: [] };
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
    updateImportSession: async (sessionId: string, patch: Record<string, unknown>) => {
      if (options.failSessionUpdate === sessionId) throw new Error("storage said no");
      recorded.sessionUpdates.push({ sessionId, patch });
    },
    getImportBatch: async (batchId: string) => options.batches?.[batchId] ?? null,
    updateImportBatch: async (batchId: string, patch: Record<string, unknown>) => {
      recorded.batchUpdates.push({ batchId, patch });
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
    assertEquals(recorded.sessionUpdates, [
      {
        sessionId: "session-dead",
        patch: {
          status: "failed",
          revoked_at: "2026-09-04T06:00:00.000Z",
          updated_at: "2026-09-04T06:00:00.000Z",
          meta: { parse_strategy: "full", failure_reason: SESSION_EXPIRED_REASON },
        },
      },
    ]);
    // The batch ended when its session did, not when somebody noticed.
    assertEquals(recorded.batchUpdates, [
      {
        batchId: "batch-dead",
        patch: {
          status: "failed",
          completed_at: "2026-09-03T09:38:16.275Z",
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

    assertEquals(result, { sessions: 3, batches: 0 });
    assertEquals(
      recorded.sessionUpdates.map((update) => [update.sessionId, update.patch.status]),
      [
        ["session-preview", "failed"],
        ["session-applied", "failed"],
        ["session-bare", "failed"],
      ],
    );
    assertEquals(recorded.batchUpdates, []);
  },
);

Deno.test(
  "closeAbandonedSessions does nothing without a scan, and survives one that fails",
  async () => {
    const without = createHarness({ withoutScan: true });
    assertEquals(await closeAbandonedSessions(without.deps, scope), { sessions: 0, batches: 0 });
    assertEquals(without.recorded.sessionUpdates, []);

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

Deno.test("closeAbandonedSessions closes the rest when one session refuses", async () => {
  const { deps, recorded } = createHarness({
    expired: [
      { id: "session-stubborn", batch_id: "batch-1", expires_at: "2026-09-03T09:00:00.000Z" },
      { id: "session-plain", batch_id: "batch-2", expires_at: "2026-09-03T09:10:00.000Z" },
    ],
    batches: {
      "batch-1": { id: "batch-1", status: "running" },
      "batch-2": { id: "batch-2", status: "running" },
    },
    failSessionUpdate: "session-stubborn",
  });

  const result = await closeAbandonedSessions(deps, scope);

  assertEquals(result, { sessions: 1, batches: 1 });
  assertEquals(
    recorded.batchUpdates.map((update) => update.batchId),
    ["batch-2"],
  );
  assertEquals(
    recorded.events.map((event) => [event.level, event.message]),
    [
      ["warn", "money_import_abandoned_session_close_failed"],
      ["info", "money_import_abandoned_session_closed"],
    ],
  );
});
