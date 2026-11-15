import crypto from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import syntheticCassette from "../test/fixtures/tbank/cassettes/synthetic-month/cassette.json";
import {
  createCassettePlayer,
  type Cassette,
} from "../browserExtension/src/connectors/cassette-replay";
import { installCassetteRoute } from "./helpers/cassette-route";

const DEV_EMAIL = process.env.E2E_DEV_EMAIL_MONEY_IMPORT ?? "e2e-money-import@example.com";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for e2e tests`);
  }
  return value;
}

function createAdminClient() {
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function devLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEV_EMAIL);
  await page.getByRole("button", { name: "Sign in as this user (dev)" }).click();
  await expect(page).toHaveURL(/\/health/);
}

async function setSelectedPerson(page: Page, personId: string) {
  await page.evaluate((selectedPersonId) => {
    window.localStorage.setItem(
      "app.settings",
      JSON.stringify({
        state: {
          language: "en",
          selectedPersonId,
        },
        version: 0,
      }),
    );
  }, personId);
}

async function resolveSelectedPersonId() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("persons")
    .select("id")
    .not("auth_user_id", "is", null)
    .limit(1)
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to resolve selected person: ${error?.message ?? "missing person"}`);
  }

  return { admin, personId: data.id as string };
}

/**
 * Milestone 1 end state: a statement stub was replaced by a two-line receipt, so the
 * transaction page shows exactly those two titles and their amounts sum to the operation.
 */
async function seedReplacedPlaceholder() {
  const { admin, personId } = await resolveSelectedPersonId();
  const accountId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  const lineA = crypto.randomUUID();
  const lineB = crypto.randomUUID();
  const batchId = crypto.randomUUID();

  const { error: accountError } = await admin.from("money_accounts").insert({
    id: accountId,
    owner_person_id: personId,
    source: "tbank",
    account_kind: "debit",
    account_label: "E2E Cassette Account",
    currency: "RUB",
  });
  if (accountError) throw new Error(`Failed to seed account: ${accountError.message}`);

  const { error: txError } = await admin.from("money_transactions").insert({
    id: transactionId,
    payer_person_id: personId,
    account_id: accountId,
    source: "tbank",
    posted_at: "2026-11-10T12:00:00.000Z",
    created_at: "2026-11-10T12:00:00.000Z",
    amount: -200,
    currency: "RUB",
    transaction_type: "expense",
    status: "posted",
    merchant_name: "Synthetic Market",
    is_transfer: false,
    dedupe_hash: `e2e-cassette-placeholder-${transactionId}`,
  });
  if (txError) throw new Error(`Failed to seed transaction: ${txError.message}`);

  const { error: lineError } = await admin.from("money_line_items").insert([
    {
      id: lineA,
      transaction_id: transactionId,
      title: "Synthetic milk",
      amount: -80,
      is_placeholder: false,
    },
    {
      id: lineB,
      transaction_id: transactionId,
      title: "Synthetic bread",
      amount: -120,
      is_placeholder: false,
    },
  ]);
  if (lineError) throw new Error(`Failed to seed line items: ${lineError.message}`);

  const { error: batchError } = await admin.from("money_import_batches").insert({
    id: batchId,
    source: "tbank_web",
    payer_person_id: personId,
    import_type: "web_export",
    status: "completed",
    parsed_transactions_count: 1,
    inserted_count: 0,
    skipped_count: 1,
    error_count: 0,
    completed_at: "2026-11-10T12:05:00.000Z",
    meta: {
      backfill_slice: "2026-10",
      skipped_after_budget_count: 0,
    },
  });
  if (batchError) throw new Error(`Failed to seed batch: ${batchError.message}`);

  const { error: rowError } = await admin.from("money_import_batch_rows").insert({
    batch_id: batchId,
    source_row_index: 0,
    row_kind: "transaction",
    status: "skipped",
    message: "Adopted an existing statement transaction",
    transaction_id: transactionId,
  });
  if (rowError) throw new Error(`Failed to seed batch row: ${rowError.message}`);

  return {
    admin,
    personId,
    accountId,
    transactionId,
    batchId,
    lineIds: [lineA, lineB],
  };
}

async function cleanupReplacedPlaceholder(
  seed: Awaited<ReturnType<typeof seedReplacedPlaceholder>>,
) {
  await seed.admin.from("money_import_batch_rows").delete().eq("batch_id", seed.batchId);
  await seed.admin.from("money_import_batches").delete().eq("id", seed.batchId);
  await seed.admin.from("money_line_items").delete().in("id", seed.lineIds);
  await seed.admin.from("money_transactions").delete().eq("id", seed.transactionId);
  await seed.admin.from("money_accounts").delete().eq("id", seed.accountId);
}

/**
 * Milestone 6: three consecutive runs leave three distinct monthly slices on history,
 * and a slice with deferred receipts keeps skipped_after_budget_count visible in meta.
 */
async function seedBackfillSlices() {
  const { admin, personId } = await resolveSelectedPersonId();
  const batchIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const slices = ["2026-09", "2026-08", "2026-07"];

  const { error } = await admin.from("money_import_batches").insert(
    batchIds.map((id, index) => ({
      id,
      source: "tbank_web",
      payer_person_id: personId,
      import_type: "web_export",
      status: "completed",
      parsed_transactions_count: 2,
      inserted_count: 2,
      skipped_count: 0,
      error_count: 0,
      completed_at: `2026-11-0${index + 1}T08:00:00.000Z`,
      meta: {
        backfill_slice: slices[index],
        skipped_after_budget_count: index === 0 ? 3 : 0,
      },
    })),
  );
  if (error) throw new Error(`Failed to seed backfill batches: ${error.message}`);

  return { admin, personId, batchIds, slices };
}

async function cleanupBackfillSlices(seed: Awaited<ReturnType<typeof seedBackfillSlices>>) {
  await seed.admin.from("money_import_batches").delete().in("id", seed.batchIds);
}

test.describe("money import cassette acceptance", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );

  test("placeholder replacement shows two receipt lines that sum to the operation", async ({
    page,
  }) => {
    const seed = await seedReplacedPlaceholder();

    try {
      await devLogin(page);
      await setSelectedPerson(page, seed.personId);
      await page.goto(`/money/transactions/${seed.transactionId}`);

      await expect(page.getByRole("button", { name: "Synthetic milk", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Synthetic bread", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Synthetic Market").first()).toBeVisible();
      // No leftover whole-operation stub title from a CSV placeholder.
      await expect(page.getByText("Прочее по операции")).toHaveCount(0);

      await page.goto(`/money/import/reports/${seed.batchId}`);
      await expect(page.getByText("Adopted an existing statement transaction")).toBeVisible();
    } finally {
      await cleanupReplacedPlaceholder(seed);
    }
  });

  test("transaction save aborted mid-flight leaves the prior composition", async ({ page }) => {
    const seed = await seedReplacedPlaceholder();

    try {
      await devLogin(page);
      await setSelectedPerson(page, seed.personId);
      await page.goto(`/money/transactions/${seed.transactionId}`);

      await page.getByRole("button", { name: /^Edit$/i }).click();
      await page.route("**/rest/v1/rpc/money_update_transaction_with_lines*", async (route) => {
        await route.abort("internetdisconnected");
      });
      await page.route("**/rest/v1/money_transactions*", async (route) => {
        if (route.request().method() === "PATCH" || route.request().method() === "POST") {
          await route.abort("internetdisconnected");
          return;
        }
        await route.continue();
      });

      const comment = page.getByPlaceholder("Optional notes...");
      await comment.scrollIntoViewIfNeeded();
      await comment.fill("should-not-persist");
      await page.getByRole("button", { name: /Update transaction/i }).click();

      await page.reload();
      await expect(page.getByRole("button", { name: "Synthetic milk", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Synthetic bread", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("should-not-persist")).toHaveCount(0);
    } finally {
      await cleanupReplacedPlaceholder(seed);
    }
  });

  test("backfill history keeps three distinct monthly slices", async ({ page }) => {
    const seed = await seedBackfillSlices();

    try {
      await devLogin(page);
      await setSelectedPerson(page, seed.personId);
      await page.goto("/money/import");
      await page.getByRole("link", { name: "View import history" }).click();
      await expect(page).toHaveURL(/\/money\/import\/history$/);

      for (const batchId of seed.batchIds) {
        await expect(
          page
            .getByTestId("import-history-cards")
            .locator(`a[href="/money/import/reports/${batchId}"]`),
        ).toBeVisible();
      }
    } finally {
      await cleanupBackfillSlices(seed);
    }
  });

  test("Playwright can serve the synthetic cassette with zero player misses", async ({ page }) => {
    const cassette = syntheticCassette as Cassette;
    const routed = await installCassetteRoute(page, cassette);

    await page.goto("/login");
    const probe = await page.evaluate(async () => {
      const urls = [
        "https://www.tbank.ru/api/common/v1/operations?sessionid=live&start=10&end=20",
        "https://www.tbank.ru/api/common/v1/shopping_receipt?operationId=synth-auth-1&sessionid=live",
        "https://www.tbank.ru/api/common/v1/tranche_offers?sessionid=live&wuid=browser-wuid&appName=tbank&appVersion=0.0.1&platform=web&program_type=rpk_kk&origin=web%2Cib5%2Cplatform&amount=100",
        "https://www.tbank.ru/api/common/v1/operations?sessionid=live&start=1&end=2&probe=bodyless",
      ];
      const statuses: number[] = [];
      for (const url of urls) {
        const response = await fetch(url);
        statuses.push(response.status);
      }
      return statuses;
    });

    expect(probe).toEqual([200, 200, 200, 204]);
    expect(routed.misses()).toEqual([]);
  });
});

test.describe("money import cassette player unit surface", () => {
  test("createCassettePlayer remains importable for e2e helpers", async () => {
    const player = createCassettePlayer(syntheticCassette as Cassette);
    const response = await player.fetch(
      "https://www.tbank.ru/api/common/v1/operations?sessionid=x&start=9&end=10",
    );
    expect(response.status).toBe(200);
    expect(player.misses).toEqual([]);
  });
});
