import crypto from "node:crypto";
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

  return data.id as string;
}

async function seedTbankAccount(personId: string) {
  const admin = createAdminClient();
  const accountId = crypto.randomUUID();
  const { error } = await admin.from("money_accounts").insert({
    id: accountId,
    owner_person_id: personId,
    source: "tbank",
    account_kind: "debit",
    account_label: "E2E T-Bank Account",
    currency: "RUB",
  });

  if (error) {
    throw new Error(`Failed to seed T-Bank account: ${error.message}`);
  }

  return { admin, accountId };
}

async function cleanupTbankAccount(seed: Awaited<ReturnType<typeof seedTbankAccount>>) {
  await seed.admin.from("money_accounts").delete().eq("id", seed.accountId);
}

async function setSelectedPerson(page: Page, personId: string) {
  await page.goto("/money/import");
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
  await page.reload();
}

async function forceProductionExtensionFlow(page: Page, installedVersion?: string) {
  await page.addInitScript(
    (input: { installedVersion?: string }) => {
      (
        window as Window & {
          __ORBIT_APP_ENV_KIND__?: "development" | "production";
        }
      ).__ORBIT_APP_ENV_KIND__ = "production";

      if (!input.installedVersion) {
        return;
      }

      const originalPostMessage = window.postMessage.bind(window);
      window.postMessage = ((message: unknown, targetOrigin: string, transfer?: Transferable[]) => {
        const payload = message as { source?: string; type?: string };
        if (payload?.source === "orbit-webapp" && payload?.type === "MONEY_IMPORT_PING") {
          window.setTimeout(() => {
            window.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  source: "orbit-extension",
                  type: "MONEY_IMPORT_PONG",
                  extension_id: "abc123",
                  extension_version: input.installedVersion,
                },
              }),
            );
          }, 0);
          return;
        }

        originalPostMessage(message, targetOrigin, transfer ?? []);
      }) as typeof window.postMessage;
    },
    { installedVersion },
  );
}

test.describe("money import extension release flow", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );

  test("shows production install instructions and latest download when the extension is inactive", async ({
    page,
  }) => {
    const personId = await resolveSelectedPersonId();
    await forceProductionExtensionFlow(page);

    await page.route("**/api/extension-release/latest", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: "0.1.1",
          published_at: "2026-03-14T12:00:00.000Z",
          extension_id: "abc123",
          sha256: "deadbeef",
          download_url: "https://downloads.example.test/orbit-extension-0.1.1.zip",
        }),
      });
    });

    await devLogin(page);
    await setSelectedPerson(page, personId);
    await page.getByRole("button", { name: /T-Bank Web/ }).click();

    await expect(
      page.getByText("Download the latest production extension package and install it in Chrome."),
    ).toBeVisible();
    const downloadLink = page.getByRole("link", { name: "Download latest extension" });
    await expect(downloadLink).toBeVisible();
    await expect(downloadLink).toHaveAttribute(
      "href",
      "https://downloads.example.test/orbit-extension-0.1.1.zip",
    );
    await expect(page.getByText("Download the latest ZIP package from this page.")).toBeVisible();
    await expect(
      page.getByText(
        "In Chrome open Extensions, enable Developer mode, then extract the ZIP and click Load unpacked.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Select the extracted extension folder, reload this page, then click Retry check.",
      ),
    ).toBeVisible();
  });

  test("warns about an outdated installed extension but still allows starting import", async ({
    page,
  }) => {
    const personId = await resolveSelectedPersonId();
    const seed = await seedTbankAccount(personId);

    try {
      await forceProductionExtensionFlow(page, "0.1.0");

      await page.route("**/api/extension-release/latest", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            version: "0.1.1",
            published_at: "2026-03-14T12:00:00.000Z",
            extension_id: "abc123",
            sha256: "deadbeef",
            download_url: "https://downloads.example.test/orbit-extension-0.1.1.zip",
          }),
        });
      });

      await page.route("**/functions/v1/money-import", async (route) => {
        const payload = route.request().postDataJSON() as { action?: string };

        if (payload.action === "get_import_context") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              last_imported_at: "2026-02-20T12:00:00.000Z",
              requires_history_prompt: false,
              stale_threshold_days: 365,
              recommended_mode: "auto",
              window_from: "2026-02-20T12:00:00.000Z",
              window_to: "2026-03-08T00:00:00.000Z",
            }),
          });
          return;
        }

        await route.abort();
      });

      await devLogin(page);
      await setSelectedPerson(page, personId);
      await page.getByRole("button", { name: /T-Bank Web/ }).click();

      await expect(
        page.getByText("A newer extension build is available. Download it before the next import."),
      ).toBeVisible();
      await expect(page.getByText(/Installed extension version: 0\.1\.0/)).toBeVisible();
      await expect(page.getByText(/Latest available version: 0\.1\.1/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Download latest extension" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Start import" })).toBeEnabled();
    } finally {
      await cleanupTbankAccount(seed);
    }
  });
});
