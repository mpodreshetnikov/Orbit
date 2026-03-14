import { expect, test } from "@playwright/test";

test.describe("dev auth bypass auto-login", () => {
  test.skip(
    process.env.DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED !== "1" ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires local Supabase and DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED=1",
  );

  test("opens the app without rendering the login page", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/health(?:$|\?)/);
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
    await expect(page.getByLabel("Email")).toHaveCount(0);
  });

  test("ignores unsafe redirect targets and falls back to /health", async ({ page }) => {
    await page.goto("/login?redirect=https://evil.example/x");

    await expect(page).toHaveURL(/\/health(?:$|\?)/);
  });
});
