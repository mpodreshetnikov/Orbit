import type { WhoIcdClient } from "./who-client.ts";
import type { EdgeTelemetry } from "../_shared/observability.ts";

export interface IcdLookupResponse {
  code: string;
  name_en: string | null;
  name_ru: string | null;
  found: boolean;
}

export interface IcdLookupServiceDeps {
  whoClient: WhoIcdClient;
  telemetry?: EdgeTelemetry;
}

type ServiceResult = {
  status: number;
  payload: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function runIcdLookupService(
  bodyInput: unknown,
  deps: IcdLookupServiceDeps,
): Promise<ServiceResult> {
  const telemetry = deps.telemetry;
  const serviceSpan = telemetry?.startSpan("edge.icd_lookup.service");
  try {
    const body = asRecord(bodyInput);
    if (typeof body.search === "string" && body.search.trim().length > 0) {
      const maxResults = asNumber(body.maxResults, 10);
      const searchSpan = telemetry?.startSpan("edge.icd_lookup.search", {
        attrs: {
          query_length: body.search.length,
          max_results: maxResults,
        },
      });
      const results = await deps.whoClient.searchIcdCodes(body.search, maxResults);
      await searchSpan?.end({
        status: "ok",
        attrs: {
          result_count: results.length,
        },
      });
      await serviceSpan?.end({ status: "ok" });
      return {
        status: 200,
        payload: { results },
      };
    }

    const code = typeof body.code === "string" ? body.code : "";
    if (!code) {
      throw new Error("Missing code parameter");
    }

    const lookupSpan = telemetry?.startSpan("edge.icd_lookup.lookup", {
      attrs: {
        code,
      },
    });
    const name_en = await deps.whoClient.lookupIcdCode(code, "en");
    await lookupSpan?.end({
      status: "ok",
      attrs: {
        found: name_en !== null,
      },
    });
    const response: IcdLookupResponse = {
      code,
      name_en,
      name_ru: null,
      found: name_en !== null,
    };

    await serviceSpan?.end({ status: "ok" });
    return {
      status: 200,
      payload: response as unknown as Record<string, unknown>,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    telemetry?.error("icd_lookup_service_failed", {
      error_message: message,
    });
    await serviceSpan?.end({
      status: "error",
      statusMessage: message,
    });
    return {
      status: 400,
      payload: {
        error: message,
        found: false,
      },
    };
  }
}
