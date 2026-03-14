import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const DEV_EMAIL = process.env.E2E_DEV_EMAIL_MONEY_CATEGORIES ?? "e2e-money-categories@example.com";

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

async function cleanupCategoryBySlug(slug: string) {
  const admin = createAdminClient();
  await admin.from("money_categories").delete().eq("slug", slug);
}

async function countCategoryBySlug(slug: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("money_categories")
    .select("id", { count: "exact", head: true })
    .eq("slug", slug);

  if (error) {
    throw new Error(`Failed to count money categories: ${error.message}`);
  }

  return count ?? 0;
}

async function devLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEV_EMAIL);
  await page.getByRole("button", { name: "Sign in as this user (dev)" }).click();
  await expect(page).toHaveURL(/\/health/);
}

async function setEnglishUi(page: Page) {
  await page.evaluate(() => {
    window.localStorage.setItem(
      "app.settings",
      JSON.stringify({
        state: {
          language: "en",
        },
        version: 0,
      }),
    );
  });
}

test.describe("money categories canonical branch flow", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );

  test("creates a custom root category inside a canonical branch and rejects empty branch saves", async ({
    page,
  }) => {
    const createdSlug = `e2e-canonical-${Date.now()}`;
    const createdName = `E2E Canonical ${Date.now()}`;
    const invalidSlug = `e2e-invalid-${Date.now()}`;

    try {
      await devLogin(page);
      await setEnglishUi(page);
      await page.goto("/money/categories");

      await expect(page.getByRole("heading", { level: 1, name: "Categories" })).toBeVisible();
      await expect(page.getByText("Food", { exact: true })).toBeVisible();
      await expect(page.getByText("Canonical", { exact: true }).first()).toBeVisible();

      await page.getByRole("button", { name: "Add category" }).first().click();

      const createDialog = page.getByRole("dialog");
      await expect(createDialog.getByText("Add category", { exact: true })).toBeVisible();
      await createDialog.locator("input").nth(0).fill(createdName);
      await createDialog.locator("input").nth(1).fill("E2E Canonical RU");
      await createDialog.locator("input").nth(2).fill(createdSlug);

      await createDialog.getByRole("combobox").nth(0).click();
      const foodOption = page.getByRole("option", { name: "Food", exact: true });
      await expect(foodOption).toBeAttached();
      await foodOption.evaluate((option) => {
        option.scrollIntoView({ block: "center" });
        (option as HTMLElement).click();
      });
      await expect(createDialog.getByRole("combobox").nth(0)).toContainText("Food");
      await createDialog.getByRole("button", { name: "Save", exact: true }).click();

      await expect(createDialog).not.toBeVisible();
      await expect.poll(() => countCategoryBySlug(createdSlug)).toBe(1);
      await page.reload();
      await page
        .getByRole("button", { name: /Food Canonical .* canonical-food Add category/ })
        .first()
        .click();
      await expect(page.getByText(createdName, { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Add category" }).first().click();

      const invalidDialog = page.getByRole("dialog");
      await invalidDialog.locator("input").nth(0).fill("E2E Missing Branch");
      await invalidDialog.locator("input").nth(1).fill("E2E Missing Branch RU");
      await invalidDialog.locator("input").nth(2).fill(invalidSlug);
      await invalidDialog.getByRole("button", { name: "Save", exact: true }).click();

      await expect(
        page.getByText("Please fill all category fields.", { exact: true }),
      ).toBeVisible();
      await invalidDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    } finally {
      await cleanupCategoryBySlug(createdSlug);
      await cleanupCategoryBySlug(invalidSlug);
    }
  });
});
