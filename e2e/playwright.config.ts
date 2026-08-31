import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const parsedBaseUrl = new URL(baseURL);
const webHost = parsedBaseUrl.hostname;
const webPort = parsedBaseUrl.port || "3000";

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  // The suite runs against `next dev`, which is not stable under parallel browser workers here.
  workers: 1,
  expect: {
    timeout: 15_000,
  },
  reporter: "list",
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    headless: true,
    // Normally unset: Playwright uses the browser it downloaded for its own version. A host
    // that ships a Chromium of a different build — an agent container with a pre-installed
    // one, where `playwright install` is refused — sets this rather than having the suite fail
    // on a missing `chrome-headless-shell`. CI leaves it unset and is unaffected.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev --hostname ${webHost} --port ${webPort}`,
    cwd: process.cwd(),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      DEV_AUTH_BYPASS_ENABLED: process.env.DEV_AUTH_BYPASS_ENABLED ?? "1",
      NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED: process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED ?? "1",
    },
  },
});
