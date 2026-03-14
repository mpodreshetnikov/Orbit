import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const DEV_EMAIL =
  process.env.E2E_DEV_EMAIL_MONEY_TRANSACTIONS ?? "e2e-money-transactions@example.com";

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

async function seedTransactionsFlow() {
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
    .select("id")
    .eq("system_key", "food")
    .limit(1)
    .single();

  if (foodCategoryError || !foodCategory?.id) {
    throw new Error(
      `Failed to resolve canonical food category: ${foodCategoryError?.message ?? "missing category"}`,
    );
  }

  const primaryAccountId = crypto.randomUUID();
  const secondaryAccountId = crypto.randomUUID();
  const primaryExpenseId = crypto.randomUUID();
  const primaryIncomeId = crypto.randomUUID();
  const secondaryExpenseId = crypto.randomUUID();
  const primaryExpenseLineId = crypto.randomUUID();
  const primaryIncomeLineId = crypto.randomUUID();
  const secondaryExpenseLineId = crypto.randomUUID();

  const personId = selectedPerson.id as string;
  const categoryId = foodCategory.id as string;

  const { error: accountInsertError } = await admin.from("money_accounts").insert([
    {
      id: primaryAccountId,
      owner_person_id: personId,
      source: "manual",
      account_kind: "debit",
      account_label: "E2E Wallet",
      currency: "RUB",
    },
    {
      id: secondaryAccountId,
      owner_person_id: personId,
      source: "manual",
      account_kind: "debit",
      account_label: "E2E Savings",
      currency: "RUB",
    },
  ]);

  if (accountInsertError) {
    throw new Error(`Failed to seed money accounts: ${accountInsertError.message}`);
  }

  const { error: transactionInsertError } = await admin.from("money_transactions").insert([
    {
      id: primaryExpenseId,
      payer_person_id: personId,
      account_id: primaryAccountId,
      source: "manual",
      posted_at: "2026-03-10T10:00:00.000Z",
      created_at: "2026-03-10T10:00:00.000Z",
      amount: -100,
      currency: "RUB",
      transaction_type: "expense",
      status: "posted",
      merchant_name: "E2E Grocer",
      comment: "Primary expense",
      is_transfer: false,
      dedupe_hash: `e2e-money-transactions-${primaryExpenseId}`,
    },
    {
      id: primaryIncomeId,
      payer_person_id: personId,
      account_id: primaryAccountId,
      source: "manual",
      posted_at: "2026-03-09T10:00:00.000Z",
      created_at: "2026-03-09T10:00:00.000Z",
      amount: 250,
      currency: "RUB",
      transaction_type: "income",
      status: "posted",
      merchant_name: "E2E Payroll",
      comment: "Primary income",
      is_transfer: false,
      dedupe_hash: `e2e-money-transactions-${primaryIncomeId}`,
    },
    {
      id: secondaryExpenseId,
      payer_person_id: personId,
      account_id: secondaryAccountId,
      source: "manual",
      posted_at: "2026-03-08T10:00:00.000Z",
      created_at: "2026-03-08T10:00:00.000Z",
      amount: -50,
      currency: "RUB",
      transaction_type: "expense",
      status: "pending",
      merchant_name: "E2E Side Expense",
      comment: "Secondary expense",
      is_transfer: false,
      dedupe_hash: `e2e-money-transactions-${secondaryExpenseId}`,
    },
  ]);

  if (transactionInsertError) {
    throw new Error(`Failed to seed money transactions: ${transactionInsertError.message}`);
  }

  const { error: lineItemInsertError } = await admin.from("money_line_items").insert([
    {
      id: primaryExpenseLineId,
      transaction_id: primaryExpenseId,
      title: "Vegetables",
      amount: -100,
      category_id: categoryId,
    },
    {
      id: primaryIncomeLineId,
      transaction_id: primaryIncomeId,
      title: "Salary",
      amount: 250,
    },
    {
      id: secondaryExpenseLineId,
      transaction_id: secondaryExpenseId,
      title: "Snacks",
      amount: -50,
      category_id: categoryId,
    },
  ]);

  if (lineItemInsertError) {
    throw new Error(`Failed to seed money line items: ${lineItemInsertError.message}`);
  }

  return {
    admin,
    personId,
    accountIds: [primaryAccountId, secondaryAccountId],
    transactionIds: [primaryExpenseId, primaryIncomeId, secondaryExpenseId],
    lineItemIds: [primaryExpenseLineId, primaryIncomeLineId, secondaryExpenseLineId],
  };
}

async function cleanupTransactionsFlow(seed: Awaited<ReturnType<typeof seedTransactionsFlow>>) {
  await seed.admin.from("money_line_items").delete().in("id", seed.lineItemIds);
  await seed.admin.from("money_transactions").delete().in("id", seed.transactionIds);
  await seed.admin.from("money_accounts").delete().in("id", seed.accountIds);
}

test.describe("money transactions hidden filters", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );

  test("applies hidden filters and shows filtered totals", async ({ page }) => {
    const seed = await seedTransactionsFlow();

    try {
      await devLogin(page);
      await page.evaluate((personId) => {
        window.localStorage.setItem(
          "app.settings",
          JSON.stringify({
            state: {
              language: "en",
              selectedPersonId: personId,
            },
            version: 0,
          }),
        );
      }, seed.personId);

      await page.goto("/money/transactions");

      await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
      await expect(page.getByRole("button", { name: "E2E Wallet" })).toHaveCount(0);

      await page.getByRole("button", { name: /Filter/ }).click();
      await page.getByRole("checkbox", { name: "E2E Wallet" }).click();
      await page.getByRole("checkbox", { name: "Posted" }).click();
      await page.getByRole("button", { name: "Apply" }).click();

      const positiveSummary = page.getByText("Positive total").locator("..");
      const negativeSummary = page.getByText("Negative total").locator("..");

      await expect(page.getByText("Positive total")).toBeVisible();
      await expect(positiveSummary.getByText("RUB 250.00")).toBeVisible();
      await expect(negativeSummary.getByText("-RUB 100.00")).toBeVisible();
      await expect(page.getByText("E2E Grocer")).toBeVisible();
      await expect(page.getByText("E2E Payroll")).toBeVisible();
      await expect(page.getByText("E2E Side Expense")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Filter 2/ })).toBeVisible();
      await expect(page).toHaveURL(/accounts=/);
      await expect(page).toHaveURL(/statuses=posted/);

      const summary = page.getByTestId("transaction-search-summary");
      const transactionList = page.getByTestId("transaction-list");

      await expect(summary).toHaveAttribute("data-collapsed", "false");
      await transactionList.evaluate((node) => {
        node.scrollTop = 64;
        node.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await expect(summary).toHaveAttribute("data-collapsed", "true");
    } finally {
      await cleanupTransactionsFlow(seed);
    }
  });
});
