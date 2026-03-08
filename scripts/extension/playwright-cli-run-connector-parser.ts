#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { spawn } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { writeAnalysisArtifacts } from "./analyze-tbank-debug-artifact";
import {
  resolveManualAuthAssessment,
  type ManualAuthAssessment,
} from "./playwright-cli-run-connector-parser.auth";

const EXTENSION_DIST_DIR = path.resolve(process.cwd(), "browserExtension", "dist");

interface CliArgs {
  windowFrom: string;
  artifactRoot: string;
  sessionName: string;
  parseOnly: boolean;
  keepOpen: boolean;
  waitForManualSeconds: number;
  sessionId?: string;
  batchId?: string;
  sessionToken?: string;
  functionUrl?: string;
  sourceId: string;
  sourceKey: string;
  targetUrl: string;
  tabUrlPatterns: string[];
  tabUrlContains: string;
  apiUrlRegex: string;
  autoReport: boolean;
  skipBuild: boolean;
  payerPersonId?: string;
  expiresAt?: string;
}

interface SourcePreset {
  sourceKey: string;
  targetUrl: string;
  tabUrlPatterns: string[];
  tabUrlContains: string;
  apiUrlRegex: string;
}

interface ApiCapture {
  timestamp: string;
  method: string;
  status: number;
  url: string;
  sanitized_url: string;
  resource_type: string;
  content_type: string | null;
  body_preview: string | null;
}

interface TabReference {
  id: number | null;
  url: string | null;
}

function getArgValue(argv: string[], key: string): string | undefined {
  const index = argv.findIndex((token) => token === key);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function sanitizeSourceKey(sourceId: string): string {
  const normalized = sourceId.trim().toLowerCase();
  const withoutSuffix = normalized.replace(/_web$/, "").replace(/-web$/, "");
  return withoutSuffix.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "source";
}

function getSourcePreset(sourceId: string): SourcePreset {
  if (sourceId === "tbank_web") {
    return {
      sourceKey: "tbank",
      targetUrl: "https://www.tbank.ru/mybank/operations/",
      tabUrlPatterns: ["https://www.tbank.ru/*", "https://*.tbank.ru/*"],
      tabUrlContains: "/mybank/operations",
      apiUrlRegex: "https://(?:www\\.)?tbank\\.ru/api/common/v1/",
    };
  }

  return {
    sourceKey: sanitizeSourceKey(sourceId),
    targetUrl: "",
    tabUrlPatterns: [],
    tabUrlContains: "",
    apiUrlRegex: "",
  };
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): CliArgs {
  const sourceId = (getArgValue(argv, "--source") ?? "tbank_web").trim();
  const preset = getSourcePreset(sourceId);
  const defaults: CliArgs = {
    windowFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    artifactRoot: path.resolve(process.cwd(), ".tmp", "scraper-debug", preset.sourceKey),
    sessionName: "default",
    parseOnly: true,
    keepOpen: false,
    waitForManualSeconds: 0,
    sourceId,
    sourceKey: preset.sourceKey,
    targetUrl: preset.targetUrl,
    tabUrlPatterns: [...preset.tabUrlPatterns],
    tabUrlContains: preset.tabUrlContains,
    apiUrlRegex: preset.apiUrlRegex,
    autoReport: true,
    skipBuild: false,
  };

  const parsed = { ...defaults };
  let artifactRootOverridden = false;
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--window-from" && argv[index + 1]) {
      parsed.windowFrom = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--artifact-root" && argv[index + 1]) {
      parsed.artifactRoot = path.resolve(process.cwd(), argv[index + 1]);
      artifactRootOverridden = true;
      index += 1;
      continue;
    }
    if (token === "--playwright-session" && argv[index + 1]) {
      parsed.sessionName = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--full-run") {
      parsed.parseOnly = false;
      continue;
    }
    if (token === "--keep-open") {
      parsed.keepOpen = true;
      continue;
    }
    if (token === "--wait-for-manual" && argv[index + 1]) {
      const seconds = Number(argv[index + 1]);
      if (Number.isFinite(seconds) && seconds >= 0) {
        parsed.waitForManualSeconds = seconds;
      }
      index += 1;
      continue;
    }
    if (token === "--session-id" && argv[index + 1]) {
      parsed.sessionId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--batch-id" && argv[index + 1]) {
      parsed.batchId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--session-token" && argv[index + 1]) {
      parsed.sessionToken = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--function-url" && argv[index + 1]) {
      parsed.functionUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--source" && argv[index + 1]) {
      parsed.sourceId = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (token === "--source-key" && argv[index + 1]) {
      parsed.sourceKey = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (token === "--target-url" && argv[index + 1]) {
      parsed.targetUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--tab-url-pattern" && argv[index + 1]) {
      parsed.tabUrlPatterns = [...parsed.tabUrlPatterns, argv[index + 1]];
      index += 1;
      continue;
    }
    if (token === "--tab-url-patterns" && argv[index + 1]) {
      parsed.tabUrlPatterns = parseCsv(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--tab-url-contains" && argv[index + 1]) {
      parsed.tabUrlContains = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--api-url-regex" && argv[index + 1]) {
      parsed.apiUrlRegex = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--skip-auto-report") {
      parsed.autoReport = false;
      continue;
    }
    if (token === "--skip-build") {
      parsed.skipBuild = true;
      continue;
    }
    if (token === "--payer-person-id" && argv[index + 1]) {
      parsed.payerPersonId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--expires-at" && argv[index + 1]) {
      parsed.expiresAt = argv[index + 1];
      index += 1;
    }
  }

  parsed.sourceId = parsed.sourceId.trim();
  parsed.sourceKey = parsed.sourceKey.trim() || sanitizeSourceKey(parsed.sourceId);
  parsed.tabUrlPatterns = Array.from(
    new Set(
      parsed.tabUrlPatterns
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern.length > 0),
    ),
  );

  if (!artifactRootOverridden) {
    parsed.artifactRoot = path.resolve(process.cwd(), ".tmp", "scraper-debug", parsed.sourceKey);
  }

  if (!parsed.targetUrl.trim()) {
    throw new Error(
      `Missing --target-url for source '${parsed.sourceId}'. Provide source-specific target page URL.`,
    );
  }

  if (parsed.apiUrlRegex.trim()) {
    try {
      // Validate regex early for predictable failures.
      new RegExp(parsed.apiUrlRegex, "i");
    } catch {
      throw new Error(`Invalid --api-url-regex: ${parsed.apiUrlRegex}`);
    }
  }

  return parsed;
}

function formatForPath(value: Date): string {
  const iso = value.toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const keys = Array.from(new Set(Array.from(parsed.searchParams.keys()))).sort();
    const query = keys.map((key) => `${key}=<redacted>`).join("&");
    return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return url;
  }
}

async function ensureExtensionBuild(): Promise<void> {
  process.stdout.write("[debug-runner] Building extension (production) before debug run...\n");
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npxCommand, ["tsx", "scripts/extension/build.ts", "--mode=production"], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Extension build failed with exit code ${code ?? "unknown"}.`));
    });
  });

  const manifestPath = path.join(EXTENSION_DIST_DIR, "manifest.json");
  await fs.access(manifestPath).catch(() => {
    throw new Error(`Extension build is missing at ${manifestPath} after build step.`);
  });
}

async function waitForManualLogin(targetUrl: string, seconds: number): Promise<void> {
  if (seconds > 0) {
    process.stdout.write(
      `[debug-runner] Waiting ${seconds}s for manual auth/challenge completion on ${targetUrl}...\n`,
    );
    process.stdout.write(
      "[debug-runner] Agent note: ask a human to complete login/challenge in the browser; do not stop—resume after they confirm. Prefer a small --wait-for-manual (e.g. 5–10s) to quickly detect if a human is needed.\n",
    );
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return;
  }

  if (!process.stdin.isTTY) {
    process.stdout.write(
      "[debug-runner] Non-interactive terminal detected. Continuing without manual pause.\n",
    );
    return;
  }

  const ui = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await ui.question(
    `[debug-runner] Complete login/challenge on ${targetUrl}, then press Enter to continue. (Agent: ask a human to do this if needed; do not stop.)\n> `,
  );
  ui.close();
}

async function assessManualAuthRequirement(
  page: Page,
  targetUrl: string,
  tabUrlContains: string,
): Promise<ManualAuthAssessment> {
  const pageUrl = page.url();
  const assessment = await page.evaluate(() => {
    const text = (document.body?.innerText || "").slice(0, 8000).toLowerCase();
    const title = (document.title || "").toLowerCase();
    const content = `${title}\n${text}`;

    const hasOperationsFeed =
      Boolean(document.querySelector('[data-qa-type="atom-operations-feed-root"]')) ||
      Boolean(document.querySelector('[data-qa-type="atom-operations-feed-operation-root"]'));
    const hasPasswordInput =
      Boolean(document.querySelector('input[type="password"]')) ||
      Boolean(document.querySelector('input[name*="password" i]')) ||
      Boolean(document.querySelector('input[name*="парол" i]'));
    const looksLikeAuthGate =
      /sign in|log in|login/.test(content) ||
      /войти|авториз|парол/.test(content) ||
      /captcha|verify you are human|too many requests|checking your browser/.test(content) ||
      /капча|подтвердите/.test(content);

    return {
      hasOperationsFeed,
      hasPasswordInput,
      looksLikeAuthGate,
    };
  });

  return resolveManualAuthAssessment(pageUrl, targetUrl, tabUrlContains, assessment);
}

function parseExtensionId(workerUrl: string): string | null {
  const match = workerUrl.match(/^chrome-extension:\/\/([a-z]{32})\//);
  return match?.[1] ?? null;
}

async function resolveExtensionId(context: BrowserContext): Promise<string> {
  const existingWorker = context
    .serviceWorkers()
    .find((worker) => worker.url().startsWith("chrome-extension://"));
  if (existingWorker) {
    const extensionId = parseExtensionId(existingWorker.url());
    if (extensionId) return extensionId;
  }

  const worker = await context.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => null);
  if (!worker) {
    throw new Error(
      "Unable to resolve extension service worker. Verify extension loaded correctly.",
    );
  }

  const extensionId = parseExtensionId(worker.url());
  if (!extensionId) {
    throw new Error(`Failed to parse extension id from worker url: ${worker.url()}`);
  }
  return extensionId;
}

async function sendRuntimeMessage<T>(
  extensionPage: Page,
  message: Record<string, unknown>,
): Promise<T> {
  return extensionPage.evaluate(
    (payload) =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage(payload, (response) => {
          resolve(response);
        });
      }),
    message,
  ) as Promise<T>;
}

async function resolveSourceTab(
  extensionPage: Page,
  tabUrlPatterns: string[],
  tabUrlContains: string,
): Promise<TabReference> {
  return extensionPage.evaluate(
    async (input: { tabUrlPatterns: string[]; tabUrlContains: string }) => {
      const query = input.tabUrlPatterns.length > 0 ? { url: input.tabUrlPatterns } : {};
      const tabs = await chrome.tabs.query(query);
      const byContains =
        input.tabUrlContains.trim().length > 0
          ? tabs.find(
              (tab) =>
                typeof tab.url === "string" &&
                tab.url.toLowerCase().includes(input.tabUrlContains.toLowerCase()),
            )
          : undefined;
      const selected = byContains ?? tabs.find((tab) => tab.active) ?? tabs[0];
      return {
        id: selected?.id ?? null,
        url: selected?.url ?? null,
      };
    },
    { tabUrlPatterns, tabUrlContains },
  );
}

function buildSummary(
  parseOutput: Record<string, unknown> | null,
  debugRun: Record<string, unknown> | null,
  networkCaptures: ApiCapture[],
): Record<string, unknown> {
  const rows = Array.isArray(parseOutput?.rows)
    ? (parseOutput?.rows as Record<string, unknown>[])
    : [];
  const invalidPostedAt = rows.filter((row) => {
    const value = row.posted_at;
    if (typeof value !== "string" || !value.trim()) return true;
    return !Number.isFinite(new Date(value).getTime());
  }).length;
  const rowsWithoutLineItems = rows.filter((row) => {
    const lineItems = row.line_items;
    return !Array.isArray(lineItems) || lineItems.length === 0;
  }).length;

  const debug = parseOutput?.debug as Record<string, unknown> | undefined;
  const statusHistogram =
    (debug?.response_status_histogram as Record<string, number> | undefined) ?? {};
  const statusKeys = Object.keys(statusHistogram).sort();

  return {
    rows_count: rows.length,
    invalid_posted_at: invalidPostedAt,
    rows_without_line_items: rowsWithoutLineItems,
    api_vs_dom_used: {
      extraction_method: debug?.extraction_method ?? null,
      fallback_used: debug?.fallback_used ?? null,
    },
    range_coverage: {
      parsed_through_at: parseOutput?.parsedThroughAt ?? null,
      window_to: parseOutput?.windowTo ?? null,
    },
    error_signatures: (() => {
      const run = debugRun?.run as Record<string, unknown> | undefined;
      const signatures: string[] = [];
      if (typeof run?.error_message === "string" && run.error_message.trim()) {
        signatures.push(run.error_message);
      }
      return signatures;
    })(),
    api_status_codes_seen: statusKeys,
    captured_network_entries: networkCaptures.length,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const hasRealSession =
    Boolean(args.sessionId) &&
    Boolean(args.batchId) &&
    Boolean(args.sessionToken) &&
    Boolean(args.functionUrl);
  if (!args.parseOnly && !hasRealSession) {
    throw new Error(
      [
        "Full-run mode requires a real import session.",
        "Provide --session-id --batch-id --session-token --function-url from web app create_session response.",
        "Otherwise use parse-only mode (default).",
      ].join(" "),
    );
  }

  const apiUrlPattern = args.apiUrlRegex.trim() ? new RegExp(args.apiUrlRegex, "i") : null;

  if (args.skipBuild) {
    process.stdout.write("[debug-runner] Skipping extension build (--skip-build).\n");
  } else {
    await ensureExtensionBuild();
  }
  await fs.mkdir(args.artifactRoot, { recursive: true });

  const userDataDir = path.resolve(
    process.cwd(),
    ".tmp",
    "scraper-debug",
    "playwright",
    args.sessionName,
  );
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST_DIR}`,
      `--load-extension=${EXTENSION_DIST_DIR}`,
    ],
  });

  const networkCaptures: ApiCapture[] = [];
  const attachCapture = (page: Page) => {
    page.on("response", async (response) => {
      const url = response.url();
      if (apiUrlPattern && !apiUrlPattern.test(url)) return;
      const request = response.request();
      let preview: string | null = null;
      try {
        const bodyText = await response.text();
        preview =
          bodyText.length > 20_000 ? `${bodyText.slice(0, 20_000)}...<truncated>` : bodyText;
      } catch {
        preview = null;
      }

      networkCaptures.push({
        timestamp: new Date().toISOString(),
        method: request.method(),
        status: response.status(),
        url,
        sanitized_url: sanitizeUrl(url),
        resource_type: request.resourceType(),
        content_type: response.headers()["content-type"] ?? null,
        body_preview: preview,
      });
    });
  };

  for (const page of context.pages()) {
    attachCapture(page);
  }
  context.on("page", attachCapture);

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(args.targetUrl, { waitUntil: "domcontentloaded" });

  const manualAuthAssessment = await assessManualAuthRequirement(
    page,
    args.targetUrl,
    args.tabUrlContains,
  );
  process.stdout.write(
    `[debug-runner] Auth check: ${
      manualAuthAssessment.requiresManualAuth ? "manual auth required" : "manual auth not required"
    } (${manualAuthAssessment.reason})\n`,
  );
  if (manualAuthAssessment.requiresManualAuth) {
    process.stdout.write(
      "[debug-runner] Agent note: ask a human to complete login/challenge in the browser, then resume; do not stop testing. Use a short --wait-for-manual <seconds> (e.g. 5–10) to quickly see if a human is needed without waiting long.\n",
    );
  }

  if (args.waitForManualSeconds > 0) {
    await waitForManualLogin(args.targetUrl, args.waitForManualSeconds);
  } else if (manualAuthAssessment.requiresManualAuth) {
    if (!process.stdin.isTTY) {
      throw new Error(
        [
          "Manual login/challenge is required but terminal is non-interactive.",
          "Agent: ask a human to complete login in the opened browser (or open the Playwright profile once to log in), then rerun.",
          "Use a short --wait-for-manual <seconds> (e.g. 5–10) to quickly see if a human is needed without waiting long.",
        ].join(" "),
      );
    }
    await waitForManualLogin(args.targetUrl, args.waitForManualSeconds);
  }

  const extensionId = await resolveExtensionId(context);
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "domcontentloaded",
  });

  const sourceTab = await resolveSourceTab(extensionPage, args.tabUrlPatterns, args.tabUrlContains);
  if (typeof sourceTab.id !== "number") {
    throw new Error("Unable to resolve source tab id for debug run.");
  }

  const runId = `dbg_${Date.now().toString(36)}`;
  const batchId = args.batchId ?? `dbg_batch_${Date.now().toString(36)}`;
  const sessionId = args.sessionId ?? `dbg_session_${Date.now().toString(36)}`;
  const sessionToken = args.sessionToken ?? "debug-local-token";
  const functionUrl = args.functionUrl ?? "https://debug.local.invalid/money-import";

  await sendRuntimeMessage<Record<string, unknown>>(extensionPage, {
    type: "MONEY_IMPORT_START_SESSION",
    session: {
      source: args.sourceId,
      session_id: sessionId,
      batch_id: batchId,
      function_url: functionUrl,
      session_token: sessionToken,
      last_imported_at: args.windowFrom,
      payer_person_id: args.payerPersonId ?? null,
      expires_at: args.expiresAt ?? null,
    },
  });

  const runResponse = await sendRuntimeMessage<Record<string, unknown>>(extensionPage, {
    type: "MONEY_IMPORT_RUN",
    windowFrom: args.windowFrom,
    debug: {
      enabled: true,
      parse_only: args.parseOnly,
      tab_id: sourceTab.id,
      debug_run_id: runId,
    },
  });

  const debugGetResponse = await sendRuntimeMessage<{ run?: Record<string, unknown> | null }>(
    extensionPage,
    { type: "MONEY_IMPORT_DEBUG_GET_LAST_RUN" },
  );

  const parseOutput =
    ((runResponse?.result as Record<string, unknown> | undefined)?.parse_output as
      | Record<string, unknown>
      | undefined) ?? null;
  const debugRun = (debugGetResponse?.run as Record<string, unknown> | null) ?? null;
  const summary = buildSummary(parseOutput, debugRun, networkCaptures);

  const now = new Date();
  const runFolder = `${formatForPath(now)}-${runId}`;
  const artifactDir = path.join(args.artifactRoot, runFolder);
  await fs.mkdir(artifactDir, { recursive: true });

  const artifactPayload = {
    metadata: {
      created_at: now.toISOString(),
      script: "playwright-cli-run-connector-parser.ts",
      source_id: args.sourceId,
      source_key: args.sourceKey,
      target_url: args.targetUrl,
      api_url_regex: args.apiUrlRegex || null,
      tab_url_patterns: args.tabUrlPatterns,
      tab_url_contains: args.tabUrlContains,
      window_from: args.windowFrom,
      parse_only: args.parseOnly,
      extension_id: extensionId,
      source_tab_id: sourceTab.id,
      source_tab_url: sourceTab.url,
      run_id: runId,
      has_real_session: hasRealSession,
      function_url: functionUrl,
      session_id: sessionId,
      batch_id: batchId,
      auth_check: manualAuthAssessment,
    },
    run_response: runResponse,
    debug_run: debugRun,
    parse_output: parseOutput,
    network_captures: networkCaptures,
    summary,
  };

  const writeJson = async (fileName: string, data: unknown) => {
    await fs.writeFile(
      path.join(artifactDir, fileName),
      `${JSON.stringify(data, null, 2)}\n`,
      "utf8",
    );
  };

  await writeJson("artifact.json", artifactPayload);
  await writeJson("run-response.json", runResponse);
  await writeJson("debug-run.json", debugRun);
  await writeJson("parse-output.json", parseOutput);
  await writeJson("network-captures.json", networkCaptures);
  await writeJson("summary.json", summary);
  if (args.autoReport) {
    await writeAnalysisArtifacts(
      artifactPayload as Record<string, unknown>,
      artifactDir,
      artifactDir,
      {
        maxRows: Number.MAX_SAFE_INTEGER,
      },
    );
  }

  process.stdout.write(`[debug-runner] Artifacts written to: ${artifactDir}\n`);

  if (!args.keepOpen) {
    await extensionPage.close().catch(() => {});
    await context.close();
  } else {
    process.stdout.write("[debug-runner] Browser left open because --keep-open is set.\n");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
