import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const DEV_EMAIL = process.env.E2E_DEV_EMAIL ?? "dev@example.com";
const E2E_FORCE_STRUCTURE_FAIL_MARKER = "[E2E_FORCE_STRUCTURE_FAIL]";

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

async function createOcrReviewRecord() {
  const admin = createAdminClient();
  const { data: person, error: personError } = await admin
    .from("persons")
    .select("id, auth_user_id")
    .not("auth_user_id", "is", null)
    .limit(1)
    .single();

  if (personError || !person?.id || !person.auth_user_id) {
    throw new Error(`Failed to resolve test person: ${personError?.message ?? "missing person"}`);
  }

  const { data: record, error: recordError } = await admin
    .from("medical_records")
    .insert({
      person_id: person.id,
      created_by_user_id: person.auth_user_id,
      record_type: "other",
      record_date: "2026-03-04",
      title: `E2E extraction ${Date.now()}`,
      status: "ocr_review",
      ocr_text: "Hemoglobin 142 g/L",
      notes: "e2e extraction flow",
    })
    .select("id")
    .single();

  if (recordError || !record?.id) {
    throw new Error(`Failed to create test record: ${recordError?.message ?? "unknown error"}`);
  }

  return record.id as string;
}

async function deleteRecord(recordId: string) {
  const admin = createAdminClient();
  await admin.from("medical_records").delete().eq("id", recordId);
}

async function fetchRecordStatus(recordId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("medical_records")
    .select("status")
    .eq("id", recordId)
    .single();
  if (error) return null;
  return (data?.status as string | null) ?? null;
}

async function devLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEV_EMAIL);
  await page.getByRole("button", { name: "Sign in as this user (dev)" }).click();
  await expect(page).toHaveURL(/\/health/);
}

test.describe("health structure extraction flow", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.HEALTH_STRUCTURE_PARSER_MODE !== "e2e_stub",
    "Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and HEALTH_STRUCTURE_PARSER_MODE=e2e_stub",
  );

  test("submits structure extraction from OCR review via real backend with telemetry headers", async ({
    page,
  }) => {
    const recordId = await createOcrReviewRecord();

    try {
      await devLogin(page);
      await page.goto(`/health/records/${recordId}`);
      await expect(page.getByRole("heading", { level: 1, name: "Extracted Text" })).toBeVisible();

      const structureRequestPromise = page.waitForRequest(
        (request) =>
          request.method() === "POST" && request.url().includes("/functions/v1/health-structure"),
      );
      await page.getByRole("button", { name: "Confirm & Extract Data" }).click();
      const structureRequest = await structureRequestPromise;

      const headers = structureRequest.headers();
      await expect(headers.traceparent ?? "").toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/);
      await expect(headers["x-request-id"] ?? "").toMatch(/^req_[a-f0-9]{16}$/);
      await expect.poll(() => fetchRecordStatus(recordId)).toBe("structure_review");
    } finally {
      await deleteRecord(recordId);
    }
  });

  test("shows structure extraction failure and returns record to OCR review", async ({ page }) => {
    const recordId = await createOcrReviewRecord();
    const admin = createAdminClient();
    await admin
      .from("medical_records")
      .update({ ocr_text: `Force failure ${E2E_FORCE_STRUCTURE_FAIL_MARKER}` })
      .eq("id", recordId);

    try {
      await devLogin(page);
      await page.goto(`/health/records/${recordId}`);
      await expect(page.getByRole("heading", { level: 1, name: "Extracted Text" })).toBeVisible();

      await page.getByRole("button", { name: "Confirm & Extract Data" }).click();

      await expect(page.getByText("Structure Extraction Failed", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Extracted Text" })).toBeVisible();
      await expect.poll(() => fetchRecordStatus(recordId)).toBe("ocr_review");
    } finally {
      await deleteRecord(recordId);
    }
  });
});
