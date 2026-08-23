import { createClient } from "@supabase/supabase-js";
import { assertEquals } from "std/assert/assert-equals";
import { buildDailyFxRows, createMoneyFxSyncHandler, determineSyncWindow } from "./handler.ts";

Deno.test(
  "determineSyncWindow backfills from earliest transaction and then refreshes current day",
  () => {
    assertEquals(
      determineSyncWindow({
        earliestTransactionDate: "2026-11-03",
        latestStoredDate: null,
        today: "2026-11-10",
      }),
      {
        startDate: "2026-11-03",
        endDate: "2026-11-10",
      },
    );

    assertEquals(
      determineSyncWindow({
        earliestTransactionDate: "2026-11-03",
        latestStoredDate: "2026-11-09",
        today: "2026-11-10",
      }),
      {
        startDate: "2026-11-10",
        endDate: "2026-11-10",
      },
    );
  },
);

Deno.test("buildDailyFxRows carries forward official rates and emits reciprocal rows", () => {
  assertEquals(buildDailyFxRows("2026-11-08", "2026-11-10", 100, new Map([["2026-11-10", 101]])), [
    { rate_date: "2026-11-08", base_currency: "USD", quote_currency: "RUB", rate: 100 },
    { rate_date: "2026-11-09", base_currency: "USD", quote_currency: "RUB", rate: 100 },
    { rate_date: "2026-11-10", base_currency: "USD", quote_currency: "RUB", rate: 101 },
    { rate_date: "2026-11-08", base_currency: "RUB", quote_currency: "USD", rate: 0.01 },
    { rate_date: "2026-11-09", base_currency: "RUB", quote_currency: "USD", rate: 0.01 },
    {
      rate_date: "2026-11-10",
      base_currency: "RUB",
      quote_currency: "USD",
      rate: 0.009900990099,
    },
  ]);
});

Deno.test(
  "money-fx-sync handler upserts rates for the resolved date window from CBR XML",
  async () => {
    const upsertCalls: Array<unknown[]> = [];
    const fetchCalls: string[] = [];
    const handler = createMoneyFxSyncHandler({
      supabaseUrl: "http://localhost:54321",
      supabaseServiceRoleKey: "service-role-key",
      fetchFn: (input) => {
        const url = String(input);
        fetchCalls.push(url);
        if (url.includes("XML_daily.asp")) {
          return Promise.resolve(
            new Response(
              `<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="10.11.2026"><Valute ID="R01235"><CharCode>USD</CharCode><Value>100,0000</Value></Valute></ValCurs>`,
              { status: 200, headers: { "Content-Type": "application/xml" } },
            ),
          );
        }

        if (url.includes("XML_dynamic.asp")) {
          return Promise.resolve(
            new Response(
              `<?xml version="1.0" encoding="windows-1251"?><ValCurs ID="R01235" DateRange1="10.11.2026" DateRange2="10.11.2026"></ValCurs>`,
              { status: 200, headers: { "Content-Type": "application/xml" } },
            ),
          );
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      createClientFn: (() => ({
        from: (table: string) => {
          if (table === "money_transactions") {
            return {
              select: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => ({
                      data: { posted_at: "2026-11-03T09:00:00.000Z" },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }

          if (table === "money_fx_rates") {
            return {
              select: () => ({
                eq: () => ({
                  in: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: () => ({
                          data: { rate_date: "2026-11-09" },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
              upsert: (...args: unknown[]) => {
                upsertCalls.push(args);
                return { error: null };
              },
            };
          }

          throw new Error(`Unexpected table: ${table}`);
        },
      })) as unknown as typeof createClient,
      now: () => new Date("2026-11-10T00:00:00.000Z"),
      syncToken: "fx-sync-token",
    });

    const response = await handler(
      new Request("http://localhost/functions/v1/money-fx-sync", {
        method: "POST",
        headers: {
          Authorization: "Bearer fx-sync-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(fetchCalls.length, 2);
    assertEquals(upsertCalls.length, 1);
    assertEquals(upsertCalls[0]?.[0], [
      { rate_date: "2026-11-10", base_currency: "USD", quote_currency: "RUB", rate: 100 },
      { rate_date: "2026-11-10", base_currency: "RUB", quote_currency: "USD", rate: 0.01 },
    ]);
  },
);

function createAuthOnlyHandler(syncToken?: string) {
  return createMoneyFxSyncHandler({
    supabaseUrl: "http://localhost:54321",
    supabaseServiceRoleKey: "service-role-key",
    syncToken,
    fetchFn: () => {
      throw new Error("fetch must not run for a rejected request");
    },
    createClientFn: (() => {
      throw new Error("database must not be touched for a rejected request");
    }) as unknown as typeof createClient,
  });
}

Deno.test("money-fx-sync rejects a request without an authorization header", async () => {
  const handler = createAuthOnlyHandler("fx-sync-token");
  const response = await handler(
    new Request("http://localhost/functions/v1/money-fx-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "Unauthorized" });
});

Deno.test("money-fx-sync rejects a wrong token", async () => {
  const handler = createAuthOnlyHandler("fx-sync-token");
  const response = await handler(
    new Request("http://localhost/functions/v1/money-fx-sync", {
      method: "POST",
      headers: {
        Authorization: "Bearer not-the-token",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
  );

  assertEquals(response.status, 401);
});

Deno.test("money-fx-sync refuses to run when no token is configured", async () => {
  const handler = createAuthOnlyHandler(undefined);
  const response = await handler(
    new Request("http://localhost/functions/v1/money-fx-sync", {
      method: "POST",
      headers: {
        Authorization: "Bearer anything",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
  );

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "Missing MONEY_FX_SYNC_TOKEN" });
});
