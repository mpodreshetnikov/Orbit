import { buildIcd10CandidateCodes, looksLikeIcdCodeQuery } from "./query-utils.ts";

export interface IcdSearchResult {
  code: string;
  name: string;
}

export interface WhoTokenCache {
  current: { token: string; expiresAtMs: number } | null;
}

export interface WhoIcdClient {
  getAccessToken(): Promise<string>;
  lookupIcdCode(code: string, lang: "en" | "ru"): Promise<string | null>;
  searchIcdCodes(query: string, maxResults?: number): Promise<IcdSearchResult[]>;
}

export interface CreateWhoIcdClientDeps {
  fetchFn: typeof fetch;
  clientId?: string;
  clientSecret?: string;
  now?: () => number;
  cache?: WhoTokenCache;
  log?: Pick<Console, "log" | "error">;
}

interface WhoSearchEntity {
  theCode?: string;
  title?: string | { "@value"?: string };
  matchingPVs?: Array<{ propertyId?: string; label?: string }>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isIcd10Format(code: string): boolean {
  return /^[A-Z][0-9]{2}(\.[0-9]+)?$/i.test(code);
}

export function createWhoIcdClient(deps: CreateWhoIcdClientDeps): WhoIcdClient {
  const now = deps.now ?? (() => Date.now());
  const cache = deps.cache ?? { current: null };
  const log = deps.log ?? console;

  async function getAccessToken(): Promise<string> {
    const cached = cache.current;
    if (cached && cached.expiresAtMs > now()) {
      return cached.token;
    }

    if (!deps.clientId || !deps.clientSecret) {
      throw new Error(
        "WHO ICD API credentials not configured. Set WHO_ICD_CLIENT_ID and WHO_ICD_CLIENT_SECRET.",
      );
    }

    const tokenRes = await deps.fetchFn("https://icdaccessmanagement.who.int/connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: deps.clientId,
        client_secret: deps.clientSecret,
        scope: "icdapi_access",
      }),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      log.error("WHO ICD token error:", errorText);
      throw new Error(`Failed to get WHO ICD access token: ${tokenRes.status}`);
    }

    const payload = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
    const token = payload.access_token;
    const expiresInSec = payload.expires_in;
    if (!token || typeof expiresInSec !== "number") {
      throw new Error("WHO ICD token response malformed");
    }

    cache.current = {
      token,
      expiresAtMs: now() + Math.max(1, expiresInSec - 60) * 1000,
    };
    return token;
  }

  async function lookupIcdCode(code: string, lang: "en" | "ru"): Promise<string | null> {
    const token = await getAccessToken();
    const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const baseUrl = `https://id.who.int/icd/release/10/2019/${normalizedCode}`;
    const requestHeaders = {
      Authorization: `Bearer ${token}`,
      "Accept-Language": lang,
      "API-Version": "v2",
      Accept: "application/json",
    };

    try {
      const res = await deps.fetchFn(baseUrl, { headers: requestHeaders });
      if (res.ok) {
        const body = (await res.json()) as { title?: { "@value"?: string } };
        return body.title?.["@value"] ?? null;
      }

      if (res.status !== 404) {
        log.error(`WHO ICD API error for ${code} (${lang}):`, res.status);
        return null;
      }

      const codeWithDot = code.toUpperCase();
      const retryUrl = `https://id.who.int/icd/release/10/2019/${encodeURIComponent(codeWithDot)}`;
      const retryRes = await deps.fetchFn(retryUrl, { headers: requestHeaders });
      if (!retryRes.ok) {
        log.log(`ICD code ${code} not found in ${lang}`);
        return null;
      }

      const retryBody = (await retryRes.json()) as { title?: { "@value"?: string } };
      return retryBody.title?.["@value"] ?? null;
    } catch (error) {
      log.error(`Error looking up ICD code ${code} (${lang}):`, error);
      return null;
    }
  }

  async function searchIcd10Release(query: string, maxResults: number): Promise<IcdSearchResult[]> {
    const results: IcdSearchResult[] = [];
    const candidates = buildIcd10CandidateCodes(query, 15);
    if (candidates.length === 0) {
      log.log(`Query "${query}" doesn't look like an ICD-10 code`);
      return results;
    }

    log.log(`Trying ${candidates.length} codes for query "${query}"`);
    const fetched = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const name = await lookupIcdCode(candidate, "en");
          return name ? { code: candidate, name } : null;
        } catch {
          return null;
        }
      }),
    );

    for (const item of fetched) {
      if (item && results.length < maxResults) {
        results.push(item);
      }
    }
    log.log(`Code lookup found ${results.length} results for "${query}"`);
    return results;
  }

  async function searchIcdCodes(query: string, maxResults = 10): Promise<IcdSearchResult[]> {
    const token = await getAccessToken();
    const trimmed = query.trim();

    if (looksLikeIcdCodeQuery(trimmed)) {
      log.log("Query looks like a code, using code lookup strategy");
      return await searchIcd10Release(trimmed, maxResults);
    }

    const url = new URL("https://id.who.int/icd/entity/search");
    url.searchParams.set("q", trimmed);
    url.searchParams.set("useFlexisearch", "true");
    url.searchParams.set("flatResults", "true");
    url.searchParams.set("highlightingEnabled", "false");
    log.log("ICD search URL:", url.toString());

    try {
      const res = await deps.fetchFn(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          "Accept-Language": "en",
          "API-Version": "v2",
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        log.error(`WHO ICD search error: ${res.status}`);
        return [];
      }

      const body = (await res.json()) as {
        guessType?: string;
        destinationEntities?: WhoSearchEntity[];
      };
      log.log("WHO ICD search guessType:", body.guessType);
      const entities = body.destinationEntities ?? [];
      log.log("Found entities:", entities.length);
      if (entities.length > 0 && entities[0]) {
        log.log("First entity sample:", JSON.stringify(entities[0]).slice(0, 800));
      }

      const results: IcdSearchResult[] = [];
      for (const entity of entities.slice(0, maxResults * 3)) {
        let code = entity.theCode ?? "";
        let name =
          typeof entity.title === "string" ? entity.title : (entity.title?.["@value"] ?? "");

        if (Array.isArray(entity.matchingPVs)) {
          for (const pv of entity.matchingPVs) {
            if (pv.propertyId === "Title" && pv.label && !name) {
              name = pv.label;
            }
            if (pv.label) {
              const match = pv.label.match(/\b([A-Z][0-9]{2}(?:\.[0-9]+)?)\b/);
              if (match && !isIcd10Format(code)) {
                code = match[1];
              }
            }
          }
        }

        if (!isIcd10Format(code)) continue;
        if (!name) name = code;
        const normalizedCode = code.toUpperCase();
        if (!results.find((r) => r.code === normalizedCode)) {
          log.log(`Found ICD-10 code: ${normalizedCode} - ${name.slice(0, 50)}`);
          results.push({ code: normalizedCode, name });
        }
        if (results.length >= maxResults) break;
      }

      if (results.length > 0) return results;
      log.log("No ICD-10 codes found in entity search");
      return [];
    } catch (error) {
      log.error(`Error searching ICD codes: ${getErrorMessage(error)}`);
      return [];
    }
  }

  return {
    getAccessToken,
    lookupIcdCode,
    searchIcdCodes,
  };
}
