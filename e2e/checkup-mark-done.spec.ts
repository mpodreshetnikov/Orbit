import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const DEV_EMAIL = process.env.E2E_DEV_EMAIL_CHECKUP ?? "e2e-checkup-mark-done@example.com";
const COMPLETION_NOTE = "E2E synthetic checkup completion note";

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
      name: "E2E Checkup User",
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

async function seedActiveCheckup() {
  const { admin, personId } = await resolveDevPerson();
  const title = `E2E Checkup Mark Done ${Date.now()}`;
  const { data, error } = await admin
    .from("checkup_items")
    .insert({
      person_id: personId,
      title,
      category: "lab",
      schedule: {
        type: "one_off",
        due_at: "2026-11-20",
      },
      status: "active",
      notes: "synthetic e2e checkup — not personal medical data",
    })
    .select("id, title")
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to seed checkup item: ${error?.message ?? "unknown error"}`);
  }

  return { admin, personId, checkupId: data.id as string, title: data.title as string };
}

async function cleanupCheckup(checkupId: string) {
  const admin = createAdminClient();
  await admin.from("checkup_completions").delete().eq("checkup_item_id", checkupId);
  await admin.from("checkup_items").delete().eq("id", checkupId);
}

async function countCompletions(checkupId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("checkup_completions")
    .select("id", { count: "exact", head: true })
    .eq("checkup_item_id", checkupId);

  if (error) {
    throw new Error(`Failed to count completions: ${error.message}`);
  }

  return count ?? 0;
}

async function fetchCheckupStatus(checkupId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("checkup_items")
    .select("status")
    .eq("id", checkupId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read checkup status: ${error.message}`);
  }

  return (data?.status as string | null) ?? null;
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

test.describe("checkup mark-done happy path", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );

  test("marks an active checkup complete from the detail page", async ({ page }) => {
    const seed = await seedActiveCheckup();

    try {
      await devLogin(page);
      await setEnglishUi(page, seed.personId);
      await page.goto(`/health/checkups/${seed.checkupId}`);

      await expect(page.getByRole("heading", { level: 1, name: seed.title })).toBeVisible();
      await expect(page.getByText("No completions yet", { exact: false })).toBeVisible();

      await page.getByRole("button", { name: "Mark complete" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Mark complete" })).toBeVisible();
      await dialog.getByLabel("Note").fill(COMPLETION_NOTE);
      await dialog.getByRole("button", { name: "Mark complete" }).click();

      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(COMPLETION_NOTE, { exact: true })).toBeVisible();
      await expect(page.getByText("No completions yet", { exact: false })).toHaveCount(0);
      await expect.poll(() => countCompletions(seed.checkupId)).toBe(1);
      await expect.poll(() => fetchCheckupStatus(seed.checkupId)).toBe("completed");
    } finally {
      await cleanupCheckup(seed.checkupId);
    }
  });
});
