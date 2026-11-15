import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const DEV_EMAIL = process.env.E2E_DEV_EMAIL_MEDICATION_LIST ?? "e2e-medication-list@example.com";

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
  let devUser = users.data.users.find((user) => user.email === DEV_EMAIL);

  if (!devUser?.id) {
    const { data, error } = await admin.auth.admin.createUser({
      email: DEV_EMAIL,
      email_confirm: true,
    });
    if (error || !data.user?.id) {
      throw new Error(`Could not create dev auth user for ${DEV_EMAIL}: ${error?.message}`);
    }
    devUser = data.user;
  }

  const { error: allowlistError } = await admin
    .from("allowed_users")
    .upsert({ auth_user_id: devUser.id, email: DEV_EMAIL }, { onConflict: "email" });

  if (allowlistError) {
    throw new Error(`Could not allowlist ${DEV_EMAIL}: ${allowlistError.message}`);
  }

  const { data: person, error } = await admin
    .from("persons")
    .select("id")
    .eq("auth_user_id", devUser.id)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not resolve person for ${DEV_EMAIL}: ${error.message}`);
  }

  if (person?.id) {
    return { admin, personId: person.id as string };
  }

  const { data: createdPerson, error: createPersonError } = await admin
    .from("persons")
    .insert({
      auth_user_id: devUser.id,
      kind: "human",
      name: "E2E Medication List User",
    })
    .select("id")
    .single();

  if (createPersonError || !createdPerson?.id) {
    throw new Error(
      `Could not create person for ${DEV_EMAIL}: ${createPersonError?.message ?? "missing"}`,
    );
  }

  return { admin, personId: createdPerson.id as string };
}

async function seedListRegimen() {
  const { admin, personId } = await resolveDevPerson();
  const customName = `E2E Med List Smoke ${Date.now()}`;
  const { data, error } = await admin
    .from("med_regimens")
    .insert({
      person_id: personId,
      custom_name: customName,
      status: "active",
      intake_unit: "pill",
      dose_definition: { intake: { amount: 1, unit: "pill" }, active: [] },
      intake_advice_type: "none",
      intake_advice_text: null,
      schedule: { mode: "daily_times", times: ["08:00"], amounts: [1] },
      duration: { type: "endless", start_date: "2026-01-01" },
      reminder_prefs: null,
      inventory: null,
      notes: "synthetic e2e medication list smoke — not personal medical data",
    })
    .select("id, custom_name")
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to seed regimen: ${error?.message ?? "unknown error"}`);
  }

  return {
    admin,
    personId,
    regimenId: data.id as string,
    customName: data.custom_name as string,
  };
}

async function cleanupRegimen(regimenId: string) {
  const admin = createAdminClient();
  await admin.from("med_regimens").delete().eq("id", regimenId);
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

async function devLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEV_EMAIL);
  await page.getByRole("button", { name: "Sign in as this user (dev)" }).click();
  await expect(page).toHaveURL(/\/health/);
}

test.describe("medication list smoke", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );

  test("shows a seeded regimen on the medications list page", async ({ page }) => {
    const seed = await seedListRegimen();

    try {
      await devLogin(page);
      await setEnglishUi(page, seed.personId);
      await page.goto("/health/medications");

      await expect(page.getByRole("heading", { level: 1, name: "Medications" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "All medications" })).toBeVisible();
      await expect(page.getByText(seed.customName, { exact: true })).toBeVisible();

      const search = page.getByPlaceholder("Search");
      await search.fill(seed.customName);
      await expect(page.getByText(seed.customName, { exact: true })).toBeVisible();
      await expect(page.getByText("No results found", { exact: false })).toHaveCount(0);

      await page.getByRole("link", { name: new RegExp(seed.customName) }).click();
      await expect(page).toHaveURL(new RegExp(`/health/medications/${seed.regimenId}$`));
      await expect(page.getByRole("heading", { level: 1, name: seed.customName })).toBeVisible();
    } finally {
      await cleanupRegimen(seed.regimenId);
    }
  });
});
