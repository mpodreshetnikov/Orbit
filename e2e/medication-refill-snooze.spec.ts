import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const DEV_EMAIL = process.env.E2E_DEV_EMAIL ?? "dev@example.com";

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

async function resolveDevPerson() {
  const admin = createAdminClient();
  const users = await admin.auth.admin.listUsers();
  const devUser = users.data.users.find((user) => user.email === DEV_EMAIL);

  if (!devUser?.id) {
    throw new Error(`Could not find dev auth user for ${DEV_EMAIL}`);
  }

  const { data: person, error } = await admin
    .from("persons")
    .select("id")
    .eq("auth_user_id", devUser.id)
    .limit(1)
    .single();

  if (error || !person?.id) {
    throw new Error(`Could not resolve person for ${DEV_EMAIL}: ${error?.message ?? "missing"}`);
  }

  return { admin, personId: person.id };
}

async function createLowStockRegimen() {
  const { admin, personId } = await resolveDevPerson();
  const { data, error } = await admin
    .from("med_regimens")
    .insert({
      person_id: personId,
      custom_name: `E2E Refill Snooze ${Date.now()}`,
      status: "active",
      intake_unit: "pill",
      dose_definition: { intake: { amount: 1, unit: "pill" }, active: [] },
      intake_advice_type: "none",
      intake_advice_text: null,
      schedule: { mode: "daily_times", times: ["09:00"], amounts: [1] },
      duration: { type: "endless", start_date: "2026-01-01" },
      reminder_prefs: null,
      inventory: {
        enabled: true,
        current_amount: 1,
        refill_threshold_amount: 2,
        unit: "pill",
        auto_decrement_on_taken: true,
      },
      notes: "e2e refill snooze flow",
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to create low-stock regimen: ${error?.message ?? "unknown error"}`);
  }

  return data.id as string;
}

async function deleteRegimen(regimenId: string) {
  const admin = createAdminClient();
  await admin.from("medication_refill_snoozes").delete().eq("regimen_id", regimenId);
  await admin.from("med_regimens").delete().eq("id", regimenId);
}

async function countSnoozes(regimenId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("medication_refill_snoozes")
    .select("id", { count: "exact", head: true })
    .eq("regimen_id", regimenId);

  if (error) {
    throw new Error(`Failed to count snoozes: ${error.message}`);
  }

  return count ?? 0;
}

async function devLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEV_EMAIL);
  await page.getByRole("button", { name: "Sign in as this user (dev)" }).click();
  await expect(page).toHaveURL(/\/health/);
}

test.describe("medication refill reminder snooze", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );

  test("saves and clears a low-stock reminder snooze from the regimen detail page", async ({
    page,
  }) => {
    const regimenId = await createLowStockRegimen();

    try {
      await devLogin(page);
      await page.goto(`/health/medications/${regimenId}`);

      await expect(page.getByText("Waiting for a delivery?", { exact: false })).toBeVisible();

      await page.getByRole("button", { name: "Snooze reminder" }).click();
      await expect(page.getByText("Low-stock reminder snoozed until", { exact: false })).toBeVisible();
      await expect.poll(() => countSnoozes(regimenId)).toBe(1);

      await page.getByRole("button", { name: "Clear snooze" }).click();
      await expect(page.getByText("Waiting for a delivery?", { exact: false })).toBeVisible();
      await expect.poll(() => countSnoozes(regimenId)).toBe(0);
    } finally {
      await deleteRegimen(regimenId);
    }
  });
});
