import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

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

async function seedImportHistory() {
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

  const { data: otherPerson, error: otherPersonError } = await admin
    .from("persons")
    .insert({
      name: `Import History Other ${Date.now()}`,
      kind: "human",
    })
    .select("id")
    .single();

  if (otherPersonError || !otherPerson?.id) {
    throw new Error(
      `Failed to create other person: ${otherPersonError?.message ?? "missing person"}`,
    );
  }

  const createdPersonId = otherPerson.id as string;
  const selectedPersonId = selectedPerson.id as string;

  const { data: batches, error: batchInsertError } = await admin
    .from("money_import_batches")
    .insert([
      {
        source: "tbank_csv",
        payer_person_id: selectedPersonId,
        import_type: "file",
        status: "completed",
        parsed_transactions_count: 6,
        inserted_count: 4,
        skipped_count: 2,
        error_count: 0,
        completed_at: "2026-03-01T09:30:00.000Z",
      },
      {
        source: "tbank_web",
        payer_person_id: selectedPersonId,
        import_type: "web_export",
        status: "failed",
        parsed_transactions_count: 3,
        inserted_count: 1,
        skipped_count: 0,
        error_count: 2,
      },
      {
        source: "tbank_csv",
        payer_person_id: createdPersonId,
        import_type: "file",
        status: "completed",
        parsed_transactions_count: 9,
        inserted_count: 9,
        skipped_count: 0,
        error_count: 0,
      },
    ])
    .select("id, payer_person_id, status, source");

  if (batchInsertError || !batches) {
    throw new Error(`Failed to seed import batches: ${batchInsertError?.message ?? "unknown"}`);
  }

  const selectedBatchIds = batches
    .filter((batch) => batch.payer_person_id === selectedPersonId)
    .map((batch) => batch.id as string);
  const otherBatchIds = batches
    .filter((batch) => batch.payer_person_id === createdPersonId)
    .map((batch) => batch.id as string);

  return { admin, createdPersonId, selectedPersonId, selectedBatchIds, otherBatchIds };
}

async function cleanupImportHistory(seed: Awaited<ReturnType<typeof seedImportHistory>>) {
  await seed.admin
    .from("money_import_batches")
    .delete()
    .in("id", [...seed.selectedBatchIds, ...seed.otherBatchIds]);
  await seed.admin.from("persons").delete().eq("id", seed.createdPersonId);
}

test.describe("money import history flow", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );

  test("shows only selected-person history and opens an existing report", async ({ page }) => {
    const seed = await seedImportHistory();

    try {
      await devLogin(page);
      await page.goto("/money/import");
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
      }, seed.selectedPersonId);

      await page.reload();
      await page.getByRole("link", { name: "View import history" }).click();

      await expect(page).toHaveURL(/\/money\/import\/history$/);
      await expect(page.getByRole("heading", { level: 1, name: "Import history" })).toBeVisible();

      for (const batchId of seed.selectedBatchIds) {
        await expect(page.getByText(batchId)).toBeVisible();
      }
      for (const batchId of seed.otherBatchIds) {
        await expect(page.getByText(batchId)).toHaveCount(0);
      }

      await page
        .locator(`a[href="/money/import/reports/${seed.selectedBatchIds[0]}"]`)
        .first()
        .click();

      await expect(page).toHaveURL(
        new RegExp(`/money/import/reports/${seed.selectedBatchIds[0]}$`),
      );
      await expect(page.getByRole("heading", { level: 1, name: "Import results" })).toBeVisible();
    } finally {
      await cleanupImportHistory(seed);
    }
  });
});
