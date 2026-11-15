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
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev --hostname ${webHost} --port ${webPort}`,
    cwd: process.cwd(),
    // `/` (and `/login`) 307 into a DEV_AUTH_BYPASS loop; Playwright's readiness
    // probe follows redirects until it times out. `/api/mcp` answers 401/404 without
    // a browser session and is enough to know Next is accepting connections.
    url: `${baseURL.replace(/\/$/, "")}/api/mcp`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      DEV_AUTH_BYPASS_ENABLED: process.env.DEV_AUTH_BYPASS_ENABLED ?? "1",
      NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED: process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED ?? "1",
      MCP_SERVER_ENABLED: process.env.MCP_SERVER_ENABLED ?? "1",
      MCP_OAUTH_SIGNING_SECRET:
        process.env.MCP_OAUTH_SIGNING_SECRET ?? "e2e-local-mcp-oauth-signing-secret-min-32b",
      SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET ?? process.env.JWT_SECRET ?? "",
    },
  },
});
