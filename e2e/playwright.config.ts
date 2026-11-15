import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const parsedBaseUrl = new URL(baseURL);
const webHost = parsedBaseUrl.hostname;
const webPort = parsedBaseUrl.port || "3000";

export default defineConfig({
  testDir: ".",
  // Repo-root path (config lives in e2e/); matches /.gitignore and the CI upload path.
  outputDir: "../test-results",
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
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev --hostname ${webHost} --port ${webPort}`,
    cwd: process.cwd(),
    // Hit /login: with auto-login off it returns 200. Root (/) can 307 into
    // DEV_AUTH_BYPASS_AUTO_LOGIN and hang Playwright's readiness poll.
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      DEV_AUTH_BYPASS_ENABLED: process.env.DEV_AUTH_BYPASS_ENABLED ?? "1",
      NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED: process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED ?? "1",
      // Keep manual-login e2e deterministic; auto-login is covered by its own skipped-unless-enabled spec.
      DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED: "0",
      NEXT_PUBLIC_DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED: "0",
    },
  },
});
