import { describe, expect, it } from "vitest";
import {
  REPORT_PAYLOAD_KEYS,
  REPORT_ROW_COLUMNS,
  REPORT_ROW_SELECT,
  readReportRows,
} from "./import-report-rows";
import { projectReportRow } from "../../../test/utils/web/import-report-rows";

describe("REPORT_ROW_SELECT", () => {
  it("asks for the columns and the payload keys by path, never for everything", () => {
    const fields = REPORT_ROW_SELECT.split(",");
    expect(fields).not.toContain("*");
    expect(fields).not.toContain("payload");
    for (const column of REPORT_ROW_COLUMNS) expect(fields).toContain(column);
    for (const key of REPORT_PAYLOAD_KEYS) expect(fields).toContain(`p_${key}:payload->${key}`);
    expect(fields).toContain("raw_extraction_method:payload->raw_payload->extraction_method");
    expect(fields).toContain(
      "raw_receipt_status:payload->raw_payload->enrichment->shopping_receipt->status",
    );
    expect(fields).not.toContain("raw_payload");
  });
});

describe("readReportRows", () => {
  it("rebuilds the payload from the aliased fields, markers nested where the page reads them", () => {
    const rows = readReportRows([
      {
        id: "row-1",
        batch_id: "batch-1",
        parent_row_id: null,
        row_kind: "transaction",
        source_row_index: 0,
        source_line_index: null,
        status: "inserted",
        message: null,
        transaction_id: "tx-1",
        line_item_id: null,
        receipt_request_key: null,
        receipt_enrichment_status: "applied",
        created_at: "2026-09-14T01:00:00Z",
        p_posted_at: "2026-09-11T10:00:00Z",
        p_amount: -125,
        p_currency: "RUB",
        p_merchant_name: "Store A",
        p_source_brand: { name: "Store" },
        p_receipt_line_items_skipped: null,
        p_title: null,
        raw_extraction_method: "dom",
        raw_source: null,
        raw_receipt_status: "rate_limited",
        raw_receipt_line_items_skipped: true,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "row-1",
      source_row_index: 0,
      receipt_enrichment_status: "applied",
      payload: {
        posted_at: "2026-09-11T10:00:00Z",
        amount: -125,
        currency: "RUB",
        merchant_name: "Store A",
        source_brand: { name: "Store" },
        raw_payload: {
          extraction_method: "dom",
          enrichment: { shopping_receipt: { status: "rate_limited", line_items_skipped: true } },
        },
      },
    });
    expect(rows[0]!.payload).not.toHaveProperty("title");
    expect(rows[0]!.payload).not.toHaveProperty("receipt_line_items_skipped");
    expect(rows[0]!.payload!.raw_payload).not.toHaveProperty("source");
  });

  it("leaves the payload empty when the row carried none, and ignores what is not a row", () => {
    const rows = readReportRows([{ id: "row-2", row_kind: "line_item" }, null, "text"]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "row-2", parent_row_id: null, payload: {} });
    expect(readReportRows(null)).toEqual([]);
  });

  it("is the inverse of projecting a full row, for what the page reads", () => {
    const full = {
      id: "row-3",
      batch_id: "batch-1",
      parent_row_id: null,
      row_kind: "transaction" as const,
      source_row_index: 2,
      source_line_index: null,
      status: "skipped" as const,
      message: "duplicate",
      transaction_id: null,
      line_item_id: null,
      created_at: "2026-09-14T01:00:00Z",
      payload: {
        posted_at: "2026-09-12T10:00:00Z",
        amount: 10,
        currency: "RUB",
        merchant_name: "Store B",
        raw_payload: {
          source: "dom_fallback",
          enrichment: { shopping_receipt: { status: "skipped_after_budget" } },
          everything_else: { the: "page never reads" },
        },
        line_items: [{ title: "repeated" }],
      },
    };

    const [row] = readReportRows([projectReportRow(full)]);

    expect(row).toMatchObject({
      id: "row-3",
      status: "skipped",
      message: "duplicate",
      payload: {
        posted_at: "2026-09-12T10:00:00Z",
        amount: 10,
        merchant_name: "Store B",
        raw_payload: {
          source: "dom_fallback",
          enrichment: { shopping_receipt: { status: "skipped_after_budget" } },
        },
      },
    });
    expect(row!.payload).not.toHaveProperty("line_items");
    expect(row!.payload!.raw_payload).not.toHaveProperty("everything_else");
  });
});
