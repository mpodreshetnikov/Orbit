import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CBR_DAILY_URL = Deno.env.get("CBR_DAILY_URL") ?? "https://www.cbr.ru/scripts/XML_daily.asp";
const CBR_DYNAMIC_URL =
  Deno.env.get("CBR_DYNAMIC_URL") ?? "https://www.cbr.ru/scripts/XML_dynamic.asp";

const USD_CURRENCY = "USD";
const RUB_CURRENCY = "RUB";
const CBR_USD_CURRENCY_ID = "R01235";

interface SyncWindowInput {
  explicitStartDate?: string | null;
  explicitEndDate?: string | null;
  earliestTransactionDate?: string | null;
  latestStoredDate?: string | null;
  today: string;
}

interface MoneyFxSyncDeps {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  cbrDailyUrl?: string;
  cbrDynamicUrl?: string;
  createClientFn?: typeof createClient;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

interface SupabaseErrorLike {
  message: string;
}

interface SupabaseSingleResult<T extends Record<string, unknown>> {
  data: T | null;
  error: SupabaseErrorLike | null;
}

interface MoneyTransactionsTableQuery {
  select(columns: string): {
    order(
      column: string,
      options: { ascending: boolean },
    ): {
      limit(count: number): {
        maybeSingle(): Promise<SupabaseSingleResult<{ posted_at: string | null }>>;
      };
    };
  };
}

interface MoneyFxRatesTableQuery {
  select(columns: string): {
    eq(
      column: string,
      value: string,
    ): {
      in(
        column: string,
        values: string[],
      ): {
        order(
          orderColumn: string,
          options: { ascending: boolean },
        ): {
          limit(count: number): {
            maybeSingle(): Promise<SupabaseSingleResult<{ rate_date: string | null }>>;
          };
        };
      };
    };
  };
  upsert(
    rows: Array<{
      rate_date: string;
      base_currency: string;
      quote_currency: string;
      rate: number;
    }>,
    options: { onConflict: string },
  ): Promise<{ error: SupabaseErrorLike | null }>;
}

interface MoneyFxSyncSupabaseClient {
  from(table: "money_transactions"): MoneyTransactionsTableQuery;
  from(table: "money_fx_rates"): MoneyFxRatesTableQuery;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseDateInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function addDays(dateValue: string, days: number): string {
  const [year, month, day] = dateValue.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function determineSyncWindow(
  input: SyncWindowInput,
): { startDate: string; endDate: string } | null {
  const explicitStartDate = parseDateInput(input.explicitStartDate);
  const explicitEndDate = parseDateInput(input.explicitEndDate);

  if (explicitStartDate || explicitEndDate) {
    const startDate = explicitStartDate ?? explicitEndDate;
    const endDate = explicitEndDate ?? explicitStartDate;
    if (!startDate || !endDate || startDate > endDate) return null;
    return { startDate, endDate };
  }

  const earliestTransactionDate = parseDateInput(input.earliestTransactionDate);
  if (!earliestTransactionDate) return null;

  const latestStoredDate = parseDateInput(input.latestStoredDate);
  const suggestedStart = latestStoredDate ? addDays(latestStoredDate, 1) : earliestTransactionDate;
  const startDate = suggestedStart > input.today ? input.today : suggestedStart;
  return {
    startDate,
    endDate: input.today,
  };
}

function formatCbrQueryDate(dateValue: string): string {
  const [year, month, day] = dateValue.split("-");
  return `${day}/${month}/${year}`;
}

function buildCbrDailyUrl(urlValue: string, rateDate: string): URL {
  const url = new URL(urlValue);
  url.searchParams.set("date_req", formatCbrQueryDate(rateDate));
  return url;
}

function buildCbrDynamicUrl(urlValue: string, startDate: string, endDate: string): URL {
  const url = new URL(urlValue);
  url.searchParams.set("date_req1", formatCbrQueryDate(startDate));
  url.searchParams.set("date_req2", formatCbrQueryDate(endDate));
  url.searchParams.set("VAL_NM_RQ", CBR_USD_CURRENCY_ID);
  return url;
}

function parseCbrNumeric(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = Number(value.trim().replace(",", "."));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function parseCbrDynamicDate(value: string | null): string | null {
  if (!value) return null;
  const [day, month, year] = value.split(".");
  if (!day || !month || !year) return null;
  return `${year}-${month}-${day}`;
}

function collectXmlMatches(pattern: RegExp, input: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    matches.push(match);
  }
  return matches;
}

function extractUsdRubRateFromDailyXml(xmlText: string): number | null {
  const idMatch = xmlText.match(
    new RegExp(`<Valute\\b[^>]*ID="${CBR_USD_CURRENCY_ID}"[\\s\\S]*?<Value>([^<]+)<\\/Value>`, "i"),
  );
  if (idMatch?.[1]) {
    return parseCbrNumeric(idMatch[1]);
  }

  const charCodeMatch = xmlText.match(/<CharCode>USD<\/CharCode>[\s\S]*?<Value>([^<]+)<\/Value>/i);
  return parseCbrNumeric(charCodeMatch?.[1] ?? null);
}

function extractRecordValue(recordXml: string): number | null {
  const valueMatch = recordXml.match(/<Value>([^<]+)<\/Value>/i);
  return parseCbrNumeric(valueMatch?.[1] ?? null);
}

function extractRecordDate(recordXml: string): string | null {
  const dateMatch = recordXml.match(/\bDate="([^"]+)"/i);
  return parseCbrDynamicDate(dateMatch?.[1] ?? null);
}

function extractUsdRubRatesByDateFromDynamicXml(xmlText: string): Map<string, number> {
  const rates = new Map<string, number>();
  for (const match of collectXmlMatches(/<Record\b[\s\S]*?<\/Record>/gi, xmlText)) {
    const recordXml = match[0];
    const rateDate = extractRecordDate(recordXml);
    const rate = extractRecordValue(recordXml);
    if (!rateDate || rate === null) continue;
    rates.set(rateDate, rate);
  }
  return rates;
}

export function buildDailyFxRows(
  startDate: string,
  endDate: string,
  initialUsdRubRate: number,
  officialUsdRubRatesByDate: Map<string, number>,
): Array<{ rate_date: string; base_currency: string; quote_currency: string; rate: number }> {
  const rows: Array<{
    rate_date: string;
    base_currency: string;
    quote_currency: string;
    rate: number;
  }> = [];
  let currentUsdRubRate = initialUsdRubRate;

  for (let currentDate = startDate; currentDate <= endDate; currentDate = addDays(currentDate, 1)) {
    const officialRate = officialUsdRubRatesByDate.get(currentDate);
    if (typeof officialRate === "number" && officialRate > 0) {
      currentUsdRubRate = officialRate;
    }

    rows.push({
      rate_date: currentDate,
      base_currency: USD_CURRENCY,
      quote_currency: RUB_CURRENCY,
      rate: currentUsdRubRate,
    });
  }

  return [
    ...rows,
    ...rows.map((row) => ({
      rate_date: row.rate_date,
      base_currency: RUB_CURRENCY,
      quote_currency: USD_CURRENCY,
      rate: Number((1 / row.rate).toFixed(12)),
    })),
  ];
}

async function loadSyncBounds(
  supabase: MoneyFxSyncSupabaseClient,
  baseCurrency: string,
  quoteCurrencies: string[],
) {
  const { data: earliestTransaction, error: earliestTransactionError } = await supabase
    .from("money_transactions")
    .select("posted_at")
    .order("posted_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (earliestTransactionError) {
    throw new Error(
      `Failed to resolve earliest transaction date: ${earliestTransactionError.message}`,
    );
  }

  const { data: latestStoredRate, error: latestStoredRateError } = await supabase
    .from("money_fx_rates")
    .select("rate_date")
    .eq("base_currency", baseCurrency)
    .in("quote_currency", quoteCurrencies)
    .order("rate_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestStoredRateError) {
    throw new Error(`Failed to resolve latest stored FX date: ${latestStoredRateError.message}`);
  }

  return {
    earliestTransactionDate:
      typeof earliestTransaction?.posted_at === "string"
        ? earliestTransaction.posted_at.slice(0, 10)
        : null,
    latestStoredDate:
      typeof latestStoredRate?.rate_date === "string"
        ? latestStoredRate.rate_date.slice(0, 10)
        : null,
  };
}

export function createMoneyFxSyncHandler(deps: MoneyFxSyncDeps = {}) {
  const createClientFn = deps.createClientFn ?? createClient;
  const fetchFn = deps.fetchFn ?? fetch;
  const resolvedSupabaseUrl = deps.supabaseUrl ?? SUPABASE_URL;
  const resolvedServiceRoleKey = deps.supabaseServiceRoleKey ?? SUPABASE_SERVICE_ROLE_KEY;
  const resolvedCbrDailyUrl = deps.cbrDailyUrl ?? CBR_DAILY_URL;
  const resolvedCbrDynamicUrl = deps.cbrDynamicUrl ?? CBR_DYNAMIC_URL;

  return async function handleMoneyFxSyncRequest(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    if (!resolvedSupabaseUrl || !resolvedServiceRoleKey) {
      return jsonResponse({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const baseCurrency =
      typeof body.base_currency === "string" && body.base_currency.trim()
        ? body.base_currency.trim().toUpperCase()
        : USD_CURRENCY;
    const quoteCurrencies = Array.isArray(body.quote_currencies)
      ? body.quote_currencies
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim().toUpperCase())
      : [RUB_CURRENCY];

    if (quoteCurrencies.length === 0) {
      return jsonResponse({ error: "quote_currencies must not be empty" }, 400);
    }

    const requestedCurrencies = new Set([baseCurrency, ...quoteCurrencies]);
    if (
      requestedCurrencies.size !== 2 ||
      !requestedCurrencies.has(USD_CURRENCY) ||
      !requestedCurrencies.has(RUB_CURRENCY)
    ) {
      return jsonResponse(
        { error: "money-fx-sync currently supports only the USD/RUB currency pair" },
        400,
      );
    }

    const now = deps.now ? deps.now() : new Date();
    const today = now.toISOString().slice(0, 10);
    const supabase = createClientFn(
      resolvedSupabaseUrl,
      resolvedServiceRoleKey,
    ) as unknown as MoneyFxSyncSupabaseClient;
    const bounds = await loadSyncBounds(supabase, USD_CURRENCY, [RUB_CURRENCY]);
    const syncWindow = determineSyncWindow({
      explicitStartDate: typeof body.start_date === "string" ? body.start_date : null,
      explicitEndDate: typeof body.end_date === "string" ? body.end_date : null,
      earliestTransactionDate: bounds.earliestTransactionDate,
      latestStoredDate: body.force_full_backfill ? null : bounds.latestStoredDate,
      today,
    });

    if (!syncWindow) {
      return jsonResponse({
        ok: true,
        synced_days: 0,
        upserted_rows: 0,
        start_date: null,
        end_date: null,
        message: "No sync window resolved",
      });
    }

    const dailyResponse = await fetchFn(
      buildCbrDailyUrl(resolvedCbrDailyUrl, syncWindow.startDate),
      {
        headers: {
          Accept: "application/xml, text/xml;q=0.9, */*;q=0.1",
        },
      },
    );
    if (!dailyResponse.ok) {
      return jsonResponse(
        {
          error: `CBR daily request failed for ${syncWindow.startDate}`,
          status: dailyResponse.status,
        },
        502,
      );
    }

    const initialUsdRubRate = extractUsdRubRateFromDailyXml(await dailyResponse.text());
    if (initialUsdRubRate === null) {
      return jsonResponse(
        { error: `CBR daily response did not include a USD/RUB rate for ${syncWindow.startDate}` },
        502,
      );
    }

    const dynamicResponse = await fetchFn(
      buildCbrDynamicUrl(resolvedCbrDynamicUrl, syncWindow.startDate, syncWindow.endDate),
      {
        headers: {
          Accept: "application/xml, text/xml;q=0.9, */*;q=0.1",
        },
      },
    );
    if (!dynamicResponse.ok) {
      return jsonResponse(
        {
          error: `CBR dynamic request failed for ${syncWindow.startDate}..${syncWindow.endDate}`,
          status: dynamicResponse.status,
        },
        502,
      );
    }

    const rowsToUpsert = buildDailyFxRows(
      syncWindow.startDate,
      syncWindow.endDate,
      initialUsdRubRate,
      extractUsdRubRatesByDateFromDynamicXml(await dynamicResponse.text()),
    );

    if (rowsToUpsert.length > 0) {
      const { error: upsertError } = await supabase.from("money_fx_rates").upsert(rowsToUpsert, {
        onConflict: "rate_date,base_currency,quote_currency",
      });
      if (upsertError) {
        return jsonResponse({ error: upsertError.message }, 500);
      }
    }

    return jsonResponse({
      ok: true,
      start_date: syncWindow.startDate,
      end_date: syncWindow.endDate,
      synced_days:
        Math.floor(
          (new Date(`${syncWindow.endDate}T00:00:00.000Z`).valueOf() -
            new Date(`${syncWindow.startDate}T00:00:00.000Z`).valueOf()) /
            86_400_000,
        ) + 1,
      upserted_rows: rowsToUpsert.length,
      base_currency: USD_CURRENCY,
      quote_currencies: [RUB_CURRENCY],
      provider: "cbr",
    });
  };
}

export const handleRequest = createMoneyFxSyncHandler();
