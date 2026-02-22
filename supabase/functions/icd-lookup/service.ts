import type { WhoIcdClient } from "./who-client.ts";

export interface IcdLookupResponse {
  code: string;
  name_en: string | null;
  name_ru: string | null;
  found: boolean;
}

export interface IcdLookupServiceDeps {
  whoClient: WhoIcdClient;
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
  try {
    const body = asRecord(bodyInput);
    if (typeof body.search === "string" && body.search.trim().length > 0) {
      const maxResults = asNumber(body.maxResults, 10);
      const results = await deps.whoClient.searchIcdCodes(body.search, maxResults);
      return {
        status: 200,
        payload: { results },
      };
    }

    const code = typeof body.code === "string" ? body.code : "";
    if (!code) {
      throw new Error("Missing code parameter");
    }

    const name_en = await deps.whoClient.lookupIcdCode(code, "en");
    const response: IcdLookupResponse = {
      code,
      name_en,
      name_ru: null,
      found: name_en !== null,
    };

    return {
      status: 200,
      payload: response as unknown as Record<string, unknown>,
    };
  } catch (error) {
    return {
      status: 400,
      payload: {
        error: error instanceof Error ? error.message : "Unknown error",
        found: false,
      },
    };
  }
}
