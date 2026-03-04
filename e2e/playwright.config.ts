import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const parsedBaseUrl = new URL(baseURL);
const webHost = parsedBaseUrl.hostname;
const webPort = parsedBaseUrl.port || "3000";

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: "list",
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    headless: true,
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
