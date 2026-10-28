import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const DEV_EMAIL = process.env.E2E_DEV_EMAIL_MONEY_REPORTS ?? "e2e-money-reports@example.com";

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

async function setEnglishUi(page: Page, personId: string) {
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

async function seedMoneyReportsFlow() {
  const admin = createAdminClient();

  const { data: selectedPerson, error: selectedPersonError } = await admin
    .from("persons")
    .select("id")
    .not("auth_user_id", "is", null)
    .limit(1)
    .single();

  if (selectedPersonError || !selectedPerson?.id) {
    throw new Error(
      `Failed to resolve selected person: ${selectedPersonError?.message ?? "missing person"}`,
    );
  }

  const { data: foodCategory, error: foodCategoryError } = await admin
    .from("money_categories")
    .select("id, name_en")
    .eq("system_key", "food")
    .limit(1)
    .single();

  if (foodCategoryError || !foodCategory?.id) {
    throw new Error(
      `Failed to resolve food category: ${foodCategoryError?.message ?? "missing category"}`,
    );
  }

  const personId = selectedPerson.id as string;
  const foodCategoryId = foodCategory.id as string;
  const foodName = foodCategory.name_en as string;
  const accountId = crypto.randomUUID();
  const childCategoryId = crypto.randomUUID();
  const incomeTransactionId = crypto.randomUUID();
  const groceriesTransactionId = crypto.randomUUID();
  const coffeeTransactionId = crypto.randomUUID();
  const transferOtherId = crypto.randomUUID();
  const transferSelfId = crypto.randomUUID();
  const groceriesLineItemId = crypto.randomUUID();
  const coffeeLineItemId = crypto.randomUUID();
  const childSlug = `e2e-money-report-child-${Date.now()}`;
  const aliasValue = `To Self Draft ${Date.now()}`;

  const { error: accountInsertError } = await admin.from("money_accounts").insert({
    id: accountId,
    owner_person_id: personId,
    source: "manual",
    account_kind: "debit",
    account_label: "E2E Budget Wallet",
    currency: "RUB",
  });

  if (accountInsertError) {
    throw new Error(`Failed to seed money account: ${accountInsertError.message}`);
  }

  const { error: categoryInsertError } = await admin.from("money_categories").insert({
    id: childCategoryId,
    parent_id: foodCategoryId,
    canonical_category_id: foodCategoryId,
    category_kind: "custom",
    depth: 2,
    name_ru: "E2E Бюджет Еда",
    name_en: "E2E Budget Food",
    slug: childSlug,
  });

  if (categoryInsertError) {
    throw new Error(`Failed to seed child category: ${categoryInsertError.message}`);
  }

  const { error: fxRateInsertError } = await admin.from("money_fx_rates").insert({
    rate_date: "2026-11-01",
    base_currency: "USD",
    quote_currency: "RUB",
    rate: 100,
  });

  if (fxRateInsertError) {
    throw new Error(`Failed to seed FX rates: ${fxRateInsertError.message}`);
  }

  const { error: transactionInsertError } = await admin.from("money_transactions").insert([
    {
      id: incomeTransactionId,
      payer_person_id: personId,
      account_id: accountId,
      source: "manual",
      posted_at: "2026-11-03T09:00:00.000Z",
      created_at: "2026-11-03T09:00:00.000Z",
      amount: 2000,
      currency: "RUB",
      transaction_type: "income",
      status: "posted",
      merchant_name: "E2E Salary",
      is_transfer: false,
      dedupe_hash: `e2e-money-report-${incomeTransactionId}`,
    },
    {
      id: groceriesTransactionId,
      payer_person_id: personId,
      account_id: accountId,
      source: "manual",
      posted_at: "2026-11-05T09:00:00.000Z",
      created_at: "2026-11-05T09:00:00.000Z",
      amount: -300,
      currency: "RUB",
      transaction_type: "expense",
      status: "posted",
      merchant_name: "E2E Groceries",
      is_transfer: false,
      dedupe_hash: `e2e-money-report-${groceriesTransactionId}`,
    },
    {
      id: coffeeTransactionId,
      payer_person_id: personId,
      account_id: accountId,
      source: "manual",
      posted_at: "2026-11-06T09:00:00.000Z",
      created_at: "2026-11-06T09:00:00.000Z",
      amount: -200,
      currency: "RUB",
      transaction_type: "expense",
      status: "posted",
      merchant_name: "E2E Coffee",
      is_transfer: false,
      dedupe_hash: `e2e-money-report-${coffeeTransactionId}`,
    },
    {
      id: transferOtherId,
      payer_person_id: personId,
      account_id: accountId,
      source: "manual",
      posted_at: "2026-11-07T09:00:00.000Z",
      created_at: "2026-11-07T09:00:00.000Z",
      amount: -400,
      currency: "RUB",
      transaction_type: "transfer",
      status: "pending",
      source_comment: "Transfer to spouse",
      merchant_name: "E2E Transfer To Other",
      is_transfer: true,
      dedupe_hash: `e2e-money-report-${transferOtherId}`,
    },
    {
      id: transferSelfId,
      payer_person_id: personId,
      account_id: accountId,
      source: "manual",
      posted_at: "2026-11-08T09:00:00.000Z",
      created_at: "2026-11-08T09:00:00.000Z",
      amount: -250,
      currency: "RUB",
      transaction_type: "transfer",
      status: "posted",
      source_comment: aliasValue,
      merchant_name: "E2E Transfer To Self",
      is_transfer: true,
      dedupe_hash: `e2e-money-report-${transferSelfId}`,
    },
  ]);

  if (transactionInsertError) {
    throw new Error(`Failed to seed transactions: ${transactionInsertError.message}`);
  }

  const { error: lineItemInsertError } = await admin.from("money_line_items").insert([
    {
      id: groceriesLineItemId,
      transaction_id: groceriesTransactionId,
      title: "Groceries",
      amount: -300,
      category_id: childCategoryId,
    },
    {
      id: coffeeLineItemId,
      transaction_id: coffeeTransactionId,
      title: "Coffee beans",
      amount: -200,
      category_id: childCategoryId,
    },
  ]);

  if (lineItemInsertError) {
    throw new Error(`Failed to seed line items: ${lineItemInsertError.message}`);
  }

  return {
    admin,
    personId,
    foodCategoryId,
    foodName,
    childCategoryId,
    childSlug,
    aliasValue,
    ids: {
      accountId,
      childCategoryId,
      incomeTransactionId,
      groceriesTransactionId,
      coffeeTransactionId,
      transferOtherId,
      transferSelfId,
      groceriesLineItemId,
      coffeeLineItemId,
    },
  };
}

async function cleanupMoneyReportsFlow(seed: Awaited<ReturnType<typeof seedMoneyReportsFlow>>) {
  await seed.admin
    .from("money_transfer_self_aliases")
    .delete()
    .eq("person_id", seed.personId)
    .eq("alias", seed.aliasValue);
  await seed.admin
    .from("money_line_items")
    .delete()
    .in("id", [seed.ids.groceriesLineItemId, seed.ids.coffeeLineItemId]);
  await seed.admin
    .from("money_transactions")
    .delete()
    .in("id", [
      seed.ids.incomeTransactionId,
      seed.ids.groceriesTransactionId,
      seed.ids.coffeeTransactionId,
      seed.ids.transferOtherId,
      seed.ids.transferSelfId,
    ]);
  await seed.admin.from("money_categories").delete().eq("id", seed.ids.childCategoryId);
  await seed.admin.from("money_accounts").delete().eq("id", seed.ids.accountId);
  await seed.admin
    .from("money_fx_rates")
    .delete()
    .eq("rate_date", "2026-11-01")
    .eq("base_currency", "USD")
    .eq("quote_currency", "RUB");
}

test.describe("money spending report flow", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );

  test("loads the month's report, opens and filters a category, and leaves out self transfers once aliased", async ({
    page,
  }) => {
    const seed = await seedMoneyReportsFlow();

    try {
      await devLogin(page);
      await setEnglishUi(page, seed.personId);
      await page.goto("/money/reports?period=month&start=2026-11-01");

      await expect(page.getByRole("heading", { level: 1, name: "Report" })).toBeVisible();
      // 300 + 200 on the child category, a pending transfer to someone else and one to oneself.
      await expect(page.getByTestId("spending-total-expense")).toContainText("RUB 1,150");
      await expect(page.getByTestId("spending-total-income")).toContainText("RUB 2,000");
      await expect(page.getByTestId(`spending-row-${seed.childCategoryId}`)).toHaveCount(0);

      const food = page.getByTestId(`spending-row-${seed.foodCategoryId}`);
      await food.getByRole("button", { name: `Expand “${seed.foodName}”` }).click();
      const child = page.getByTestId(`spending-row-${seed.childCategoryId}`);
      await expect(child).toContainText("RUB 500");

      await child.getByRole("button", { name: "Report for “E2E Budget Food” only" }).click();
      await expect(page).toHaveURL(new RegExp(`category=${seed.childCategoryId}`));
      await expect(page.getByText("Category: E2E Budget Food")).toBeVisible();
      await expect(page.getByTestId("spending-total-expense")).toContainText("RUB 500");

      await page.goto("/money/accounts");
      await page.getByPlaceholder("Add alias, for example Podreshetnikov M").fill(seed.aliasValue);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText(seed.aliasValue, { exact: true })).toBeVisible();

      await page.goto("/money/reports?period=month&start=2026-11-01");
      await expect(page.getByTestId("spending-total-expense")).toContainText("RUB 900");
    } finally {
      await cleanupMoneyReportsFlow(seed);
    }
  });
});
