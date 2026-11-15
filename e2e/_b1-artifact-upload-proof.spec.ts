import { test, expect } from "@playwright/test";

/**
 * Temporary controlled failure for T-261115-w75 / B1.
 * Proves CI uploads test-results/ (trace/screenshot/video) on e2e failure.
 * Removed after the artifact is confirmed on the Actions run.
 */
test("B1 controlled failure for CI artifact upload proof", async ({ page }) => {
  await page.setContent("<html><body><p>synthetic-b1-ci-proof</p></body></html>");
  await expect(page.getByText("this-marker-must-not-exist-b1-ci")).toBeVisible({
    timeout: 1_000,
  });
});
