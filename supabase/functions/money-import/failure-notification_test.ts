import { assertEquals } from "std/assert/assert-equals";
import {
  buildFailedRunNotification,
  MONEY_IMPORT_FAILED_NOTIFICATION_TYPE,
  shouldNotifyFailedRun,
} from "./failure-notification.ts";

function sweepSession(meta: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "session-1",
    status: "running",
    source: "tbank_web",
    created_by_auth_user_id: "user-1",
    meta: { unattended: true, run_origin: "auto", window_kind: "incremental", ...meta },
  };
}

Deno.test("shouldNotifyFailedRun notifies for the sweep's own catch-up window", () => {
  assertEquals(
    shouldNotifyFailedRun({ session: sweepSession(), batchStatus: "running", reason: null }),
    true,
  );
});

Deno.test("shouldNotifyFailedRun reads a session without origin or window as automatic", () => {
  assertEquals(
    shouldNotifyFailedRun({
      session: { ...sweepSession(), meta: { unattended: true } },
      batchStatus: null,
      reason: null,
    }),
    true,
  );
});

Deno.test("shouldNotifyFailedRun stays quiet where nobody needs telling", () => {
  const quiet: Array<[string, Parameters<typeof shouldNotifyFailedRun>[0]]> = [
    [
      "manual import",
      { session: { ...sweepSession(), meta: {} }, batchStatus: null, reason: null },
    ],
    [
      "requested by the person",
      { session: sweepSession({ run_origin: "requested" }), batchStatus: null, reason: null },
    ],
    [
      "history slice",
      { session: sweepSession({ window_kind: "backfill" }), batchStatus: null, reason: null },
    ],
    [
      "given back to a person's import",
      { session: sweepSession(), batchStatus: null, reason: "superseded" },
    ],
    ["batch already applied", { session: sweepSession(), batchStatus: "completed", reason: null }],
    [
      "session already closed",
      { session: { ...sweepSession(), status: "failed" }, batchStatus: null, reason: null },
    ],
    [
      "no recipient",
      {
        session: { ...sweepSession(), created_by_auth_user_id: null },
        batchStatus: null,
        reason: null,
      },
    ],
  ];
  for (const [label, input] of quiet) {
    assertEquals(shouldNotifyFailedRun(input), false, label);
  }
});

Deno.test("buildFailedRunNotification addresses the grant holder and opens the import", () => {
  const row = buildFailedRunNotification(sweepSession(), "2026-10-26T06:00:00.000Z");
  assertEquals(row.auth_user_id, "user-1");
  assertEquals(row.person_id, null);
  assertEquals(row.type, MONEY_IMPORT_FAILED_NOTIFICATION_TYPE);
  assertEquals(row.scheduled_at, "2026-10-26T06:00:00.000Z");
  const payload = row.payload_json as Record<string, unknown>;
  assertEquals(payload.url, "/money/import");
  assertEquals(payload.source, "tbank_web");
  assertEquals(String(payload.body).startsWith("T-Bank:"), true);
});
