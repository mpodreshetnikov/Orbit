import { expect, test, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const DEV_EMAIL =
  process.env.E2E_DEV_EMAIL_MONEY_RULES_REPLAY ?? "e2e-money-rules-replay@example.com";

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

async function ensureReplayUser() {
  const admin = createAdminClient();
  const { data: createUserData, error: createUserError } = await admin.auth.admin.createUser({
    email: DEV_EMAIL,
    email_confirm: true,
  });

  if (
    createUserError &&
    !createUserError.message.toLowerCase().includes("already") &&
    !createUserError.message.toLowerCase().includes("registered") &&
    !createUserError.message.toLowerCase().includes("exists")
  ) {
    throw new Error(`Failed to create replay auth user: ${createUserError.message}`);
  }

  let userId = createUserData.user?.id ?? null;
  if (!userId) {
    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });

    if (usersError) {
      throw new Error(`Failed to look up replay auth user: ${usersError.message}`);
    }

    userId =
      usersData.users.find((user) => (user.email ?? "").toLowerCase() === DEV_EMAIL.toLowerCase())
        ?.id ?? null;
  }

  if (!userId) {
    throw new Error("Failed to resolve replay auth user id");
  }

  const { error: allowlistError } = await admin
    .from("allowed_users")
    .upsert({ email: DEV_EMAIL, auth_user_id: userId }, { onConflict: "email" });

  if (allowlistError) {
    throw new Error(`Failed to allowlist replay auth user: ${allowlistError.message}`);
  }

  const { data: existingPerson, error: existingPersonError } = await admin
    .from("persons")
    .select("id")
    .eq("auth_user_id", userId)
    .limit(1)
    .maybeSingle();

  if (existingPersonError) {
    throw new Error(`Failed to look up replay person: ${existingPersonError.message}`);
  }

  if (existingPerson?.id) {
    return {
      admin,
      userId,
      personId: existingPerson.id as string,
      createdPerson: false,
    };
  }

  const personId = crypto.randomUUID();
  const { error: personInsertError } = await admin.from("persons").insert({
    id: personId,
    name: "E2E Replay User",
    kind: "human",
    auth_user_id: userId,
  });

  if (personInsertError) {
    throw new Error(`Failed to create replay person: ${personInsertError.message}`);
  }

  return {
    admin,
    userId,
    personId,
    createdPerson: true,
  };
}

async function deleteReplayUser(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error && !error.message.toLowerCase().includes("not found")) {
    throw new Error(`Failed to delete replay auth user: ${error.message}`);
  }
}

async function cleanupReplayIdentity(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  personId: string,
  createdPerson: boolean,
) {
  if (createdPerson) {
    const { error: deletePersonError } = await admin.from("persons").delete().eq("id", personId);
    if (deletePersonError) {
      throw new Error(`Failed to delete replay person: ${deletePersonError.message}`);
    }
  }

  await deleteReplayUser(admin, userId);
}

async function seedReplayReviewFlow() {
  const { admin, userId, personId, createdPerson } = await ensureReplayUser();

  const { data: foodCategory, error: foodCategoryError } = await admin
    .from("money_categories")
    .select("id")
    .eq("system_key", "food")
    .limit(1)
    .single();

  if (foodCategoryError || !foodCategory?.id) {
    throw new Error(
      `Failed to resolve food category: ${foodCategoryError?.message ?? "missing category"}`,
    );
  }

  const accountId = crypto.randomUUID();
  const mappedTransactionId = crypto.randomUUID();
  const unmappedTransactionId = crypto.randomUUID();
  const mappedLineItemId = crypto.randomUUID();
  const unmappedLineItemId = crypto.randomUUID();
  const ruleId = crypto.randomUUID();
  const dedupePrefix = `e2e-money-rules-replay-${Date.now()}`;

  const { error: accountInsertError } = await admin.from("money_accounts").insert({
    id: accountId,
    owner_person_id: personId,
    source: "manual",
    account_kind: "debit",
    account_label: "E2E Replay Wallet",
    currency: "RUB",
  });

  if (accountInsertError) {
    throw new Error(`Failed to seed replay account: ${accountInsertError.message}`);
  }

  const { error: transactionInsertError } = await admin.from("money_transactions").insert([
    {
      id: mappedTransactionId,
      payer_person_id: personId,
      account_id: accountId,
      source: "manual",
      posted_at: "2099-01-03T09:00:00.000Z",
      created_at: "2099-01-03T09:00:00.000Z",
      amount: -260,
      currency: "RUB",
      transaction_type: "expense",
      status: "posted",
      merchant_name: "E2E Coffee Merchant",
      is_transfer: false,
      dedupe_hash: `${dedupePrefix}-mapped`,
    },
    {
      id: unmappedTransactionId,
      payer_person_id: personId,
      account_id: accountId,
      source: "manual",
      posted_at: "2099-01-04T09:00:00.000Z",
      created_at: "2099-01-04T09:00:00.000Z",
      amount: -410,
      currency: "RUB",
      transaction_type: "expense",
      status: "posted",
      merchant_name: "E2E Unknown Merchant",
      is_transfer: false,
      dedupe_hash: `${dedupePrefix}-unmapped`,
    },
  ]);

  if (transactionInsertError) {
    throw new Error(`Failed to seed replay transactions: ${transactionInsertError.message}`);
  }

  const { error: lineItemInsertError } = await admin.from("money_line_items").insert([
    {
      id: mappedLineItemId,
      transaction_id: mappedTransactionId,
      title: "E2E Latte",
      amount: -260,
      assignment_method: "import",
      category_locked_by_user: false,
    },
    {
      id: unmappedLineItemId,
      transaction_id: unmappedTransactionId,
      title: "E2E Mystery Item",
      amount: -410,
      assignment_method: "import",
      category_locked_by_user: false,
    },
  ]);

  if (lineItemInsertError) {
    throw new Error(`Failed to seed replay line items: ${lineItemInsertError.message}`);
  }

  const { error: ruleInsertError } = await admin.from("money_category_rules").insert({
    id: ruleId,
    person_id: personId,
    name: "E2E Replay Latte Rule",
    enabled: true,
    sort_order: 1,
    rule_kind: "direct",
    target_category_id: foodCategory.id,
    match_mode: "all",
    scope_filter: "all_line_items",
    filters: [{ field: "line_item_title", operator: "contains", value: "e2e latte" }],
    config: {},
    stop_processing: true,
  });

  if (ruleInsertError) {
    throw new Error(`Failed to seed replay rule: ${ruleInsertError.message}`);
  }

  return {
    admin,
    userId,
    personId,
    createdPerson,
    ids: {
      accountId,
      mappedTransactionId,
      unmappedTransactionId,
      mappedLineItemId,
      unmappedLineItemId,
      ruleId,
    },
  };
}

async function cleanupReplayReviewFlow(seed: Awaited<ReturnType<typeof seedReplayReviewFlow>>) {
  await seed.admin.from("money_category_rules").delete().eq("id", seed.ids.ruleId);
  await seed.admin
    .from("money_line_items")
    .delete()
    .in("id", [seed.ids.mappedLineItemId, seed.ids.unmappedLineItemId]);
  await seed.admin
    .from("money_transactions")
    .delete()
    .in("id", [seed.ids.mappedTransactionId, seed.ids.unmappedTransactionId]);
  await seed.admin.from("money_accounts").delete().eq("id", seed.ids.accountId);
  await cleanupReplayIdentity(seed.admin, seed.userId, seed.personId, seed.createdPerson);
}

async function selectMappedCategory(page: Page, report: Locator) {
  await report.getByRole("combobox", { name: "Mapped category" }).click();
  await page.getByRole("option", { name: /^Food\b/ }).click();
}

test.describe("money rules replay review report", () => {
  test.describe.configure({ timeout: 180_000 });

  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );

  test("shows detailed line-item context and filters mapped versus unmapped replay runs", async ({
    page,
  }) => {
    const seed = await seedReplayReviewFlow();

    try {
      await devLogin(page);
      await setEnglishUi(page, seed.personId);
      await page.goto("/money/rules/replay-review");

      await expect(
        page.getByRole("heading", { level: 1, name: "Replay and review" }),
      ).toBeVisible();

      await page.getByLabel("From date").fill("2099-01-01");
      await page.getByLabel("To date").fill("2099-01-10");
      await page.getByRole("button", { name: "Replay date range" }).click();

      const report = page.getByTestId("money-rule-report");
      await expect(report).toContainText("Detailed run report");
      await expect(report).toContainText("Results: 2");
      await expect(report).toContainText("Line item title: E2E Latte");
      await expect(report).toContainText("Merchant: E2E Coffee Merchant");
      await expect(report).toContainText("Line item title: E2E Mystery Item");
      await expect(report).toContainText("Merchant: E2E Unknown Merchant");

      await report.getByRole("checkbox", { name: "Only unmapped items" }).click();
      await expect(report).toContainText("Results: 1");
      await expect(report).toContainText("E2E Mystery Item");
      await expect(report.getByText("E2E Latte", { exact: true })).toHaveCount(0);

      await report.getByRole("checkbox", { name: "Only unmapped items" }).click();
      await selectMappedCategory(page, report);
      await expect(report).toContainText("Results: 1");
      await expect(report).toContainText("E2E Latte");
      await expect(report).toContainText("E2E Coffee Merchant");
      await expect(report.getByText("E2E Mystery Item", { exact: true })).toHaveCount(0);
    } finally {
      await cleanupReplayReviewFlow(seed);
    }
  });
});
