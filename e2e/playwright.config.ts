import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const parsedBaseUrl = new URL(baseURL);
const webHost = parsedBaseUrl.hostname;
const webPort = parsedBaseUrl.port || "3000";

// Single readiness URL for the B1–B8 package (and thereafter):
// `/` and `/login` can 307 into DEV_AUTH_BYPASS_AUTO_LOGIN and hang Playwright's
// readiness poll when local `.env.local` enables auto-login. `/api/mcp` answers
// 401/404 without a browser session and is enough to know Next is accepting
// connections — works for UI specs and the MCP draft→confirm e2e alike.
const readinessURL = `${baseURL.replace(/\/$/, "")}/api/mcp`;

export default defineConfig({
  testDir: ".",
  // Repo-root path (config lives in e2e/); matches /.gitignore and the CI upload path (B1).
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
  // E2E_REUSE_SERVER skips spawning next when a local stack is already up (B4 local workflow).
  webServer: process.env.E2E_REUSE_SERVER
    ? undefined
    : {
        command: `npx next dev --hostname ${webHost} --port ${webPort}`,
        cwd: process.cwd(),
        url: readinessURL,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          ...process.env,
          DEV_AUTH_BYPASS_ENABLED: process.env.DEV_AUTH_BYPASS_ENABLED ?? "1",
          NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED:
            process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED ?? "1",
          // Keep manual-login e2e deterministic; auto-login hangs readiness on / and /login.
          DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED: "0",
          NEXT_PUBLIC_DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED: "0",
          // MCP env for draft→confirm e2e (B3); unused by UI specs.
          MCP_SERVER_ENABLED: process.env.MCP_SERVER_ENABLED ?? "1",
          MCP_OAUTH_SIGNING_SECRET:
            process.env.MCP_OAUTH_SIGNING_SECRET ??
            "e2e-local-mcp-oauth-signing-secret-min-32b",
          SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET ?? process.env.JWT_SECRET ?? "",
        },
      },
});
