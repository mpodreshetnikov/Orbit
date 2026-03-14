import { describe, expect, it } from "vitest";
import {
  buildSnapshotSql,
  type ExportSnapshot,
  type SnapshotTable,
} from "./export-local-tbank-import-snapshot";

function table(
  name: string,
  mode: SnapshotTable["mode"],
  columns: SnapshotTable["columns"],
  rows: SnapshotTable["rows"],
  deleteValues: Array<string | number> = [],
): SnapshotTable {
  return {
    name,
    mode,
    columns,
    rows,
    deleteBy:
      deleteValues.length > 0
        ? {
            column: "id",
            values: deleteValues,
          }
        : undefined,
  };
}

describe("export-local-tbank-import-snapshot", () => {
  it("builds idempotent SQL for a saved import snapshot", () => {
    const snapshot: ExportSnapshot = {
      generatedAt: "2026-03-13T14:20:00.000Z",
      sourceId: "tbank_web",
      batchId: "batch-1",
      tables: [
        table(
          "money_accounts",
          "upsert",
          [
            { name: "id", dataType: "uuid" },
            { name: "account_label", dataType: "text" },
          ],
          [{ id: "account-1", account_label: "O'Brien card" }],
        ),
        table(
          "money_import_sessions",
          "insert",
          [
            { name: "id", dataType: "uuid" },
            { name: "batch_id", dataType: "uuid" },
            { name: "status", dataType: "text" },
          ],
          [{ id: "session-1", batch_id: "batch-1", status: "completed" }],
          ["session-1"],
        ),
        table(
          "money_import_batches",
          "insert",
          [
            { name: "id", dataType: "uuid" },
            { name: "session_id", dataType: "uuid" },
            { name: "meta", dataType: "jsonb" },
          ],
          [
            {
              id: "batch-1",
              session_id: "session-1",
              meta: { imported: 1, notes: ["saved"] },
            },
          ],
          ["batch-1"],
        ),
        table(
          "money_transactions",
          "insert",
          [
            { name: "id", dataType: "uuid" },
            { name: "merchant_name", dataType: "text" },
            { name: "raw_payload", dataType: "jsonb" },
            { name: "amount", dataType: "numeric" },
            { name: "is_transfer", dataType: "boolean" },
          ],
          [
            {
              id: "tx-1",
              merchant_name: "Samokat",
              raw_payload: { nested: { ok: true } },
              amount: -123.45,
              is_transfer: false,
            },
          ],
          ["tx-1"],
        ),
      ],
      sessionBatchLinks: [{ sessionId: "session-1", batchId: "batch-1" }],
    };

    const sql = buildSnapshotSql(snapshot);

    expect(sql).toContain("-- Generated snapshot for local TBank import batch batch-1");
    expect(sql).toContain(`DELETE FROM public."money_import_batches" WHERE "id" IN ('batch-1');`);
    expect(sql).toContain(`INSERT INTO public."money_accounts" ("id", "account_label")`);
    expect(sql).toContain(`'O''Brien card'`);
    expect(sql).toContain(
      `ON CONFLICT ("id") DO UPDATE SET "account_label" = EXCLUDED."account_label";`,
    );
    expect(sql).toContain(
      `INSERT INTO public."money_import_sessions" ("id", "batch_id", "status")`,
    );
    expect(sql).toContain(`('session-1', NULL, 'completed')`);
    expect(sql).toContain(`'{"imported":1,"notes":["saved"]}'::jsonb`);
    expect(sql).toContain(`'{"nested":{"ok":true}}'::jsonb`);
    expect(sql).toContain(`UPDATE public."money_import_sessions"`);
    expect(sql).toContain(`SET "batch_id" = 'batch-1' WHERE "id" = 'session-1';`);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  });
});
