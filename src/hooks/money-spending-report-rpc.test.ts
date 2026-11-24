import { describe, expect, it } from "vitest";
import {
  spendingReportMerchantQueryKey,
  spendingReportMerchantRpcArgs,
} from "./money-spending-report-rpc";

describe("spendingReportMerchantRpcArgs", () => {
  it("sends explicit nulls when filters are omitted", () => {
    expect(spendingReportMerchantRpcArgs({})).toEqual({
      p_brand_id: null,
      p_merchant_name: null,
    });
  });

  it("passes through brand and merchant names", () => {
    expect(spendingReportMerchantRpcArgs({ brandId: "b-1", merchantName: "Cafe" })).toEqual({
      p_brand_id: "b-1",
      p_merchant_name: "Cafe",
    });
  });

  it("coerces undefined filter values to null", () => {
    expect(spendingReportMerchantRpcArgs({ brandId: undefined, merchantName: undefined })).toEqual({
      p_brand_id: null,
      p_merchant_name: null,
    });
    expect(spendingReportMerchantRpcArgs({ brandId: null, merchantName: null })).toEqual({
      p_brand_id: null,
      p_merchant_name: null,
    });
  });
});

describe("spendingReportMerchantQueryKey", () => {
  it("returns a stable two-slot key with null defaults", () => {
    expect(spendingReportMerchantQueryKey({})).toEqual([null, null]);
    expect(spendingReportMerchantQueryKey({ brandId: "b-1", merchantName: "Cafe" })).toEqual([
      "b-1",
      "Cafe",
    ]);
  });
});
