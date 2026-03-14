#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import {
  getMoneyImportSourcePreset,
  normalizeMoneyImportSourceIdInput,
  sanitizeMoneyImportSourceKey,
} from "./money-import-sources";
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
  parseStrategy: "fast" | "full";
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

const IN_PAGE_ROUTER_FALLBACK_SOURCE = String.raw`(async (payload) => {
  const globalWindow = window;
  if (!globalWindow.__moneyImportDebugHarness) {
    const moduleUrl = (relativePath) => new URL(relativePath, window.location.href).toString();
    await Promise.all([
      import(moduleUrl("./connectors/tbank-web.js")),
      import(moduleUrl("./connectors/alfa-web.js")),
    ]);
    const [
      { runImportSession, tryCompleteSessionAsFailed },
      { createImportDebugStore },
      { createSessionStore },
      { getConnector },
    ] = await Promise.all([
      import(moduleUrl("./core/import-runner.js")),
      import(moduleUrl("./core/import-debug.js")),
      import(moduleUrl("./core/session-store.js")),
      import(moduleUrl("./connectors/registry.js")),
    ]);

    const callEdge = async (functionUrl, token, edgePayload) => {
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(edgePayload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const responseError =
          typeof data.error === "string" && data.error.trim().length > 0 ? data.error : null;
        throw Object.assign(
          new Error(
            responseError
              ? "Edge request failed (" + String(edgePayload.action ?? "unknown") + ") status " + response.status + ": " + responseError
              : "Edge request failed (" + String(edgePayload.action ?? "unknown") + ") status " + response.status,
          ),
          {
            code: "EDGE_HTTP_ERROR",
            action: typeof edgePayload.action === "string" ? edgePayload.action : "unknown",
            function_host: (() => {
              try {
                return new URL(functionUrl).host;
              } catch {
                return null;
              }
            })(),
            function_path: (() => {
              try {
                return new URL(functionUrl).pathname;
              } catch {
                return null;
              }
            })(),
            http_status: response.status,
            response_error: responseError,
            transport: "http",
          },
        );
      }
      return data;
    };

    const sessionStore = createSessionStore(chrome.storage.local);
    const debugStore = createImportDebugStore();
    const importRunnerDeps = {
      getConnector,
      callEdge,
      broadcastToAppTabs: async () => undefined,
      nowIso: () => new Date().toISOString(),
    };

    globalWindow.__moneyImportDebugHarness = {
      handleMessage: async (message) => {
        if (message.type === "MONEY_IMPORT_START_SESSION") {
          const session =
            message.session && typeof message.session === "object" ? message.session : null;
          await sessionStore.setSession(session);
          return { ok: true };
        }

        if (message.type === "MONEY_IMPORT_RUN") {
          const session = await sessionStore.getSession();
          if (!session) {
            throw new Error("No active import session");
          }

          const debugEnabled = Boolean(
            message.debug &&
              typeof message.debug === "object" &&
              message.debug.enabled,
          );
          const debug = debugEnabled
            ? debugStore.startRun({
                debug_run_id:
                  message.debug && typeof message.debug === "object"
                    ? message.debug.debug_run_id
                    : undefined,
                session_id: typeof session.session_id === "string" ? session.session_id : null,
                batch_id: typeof session.batch_id === "string" ? session.batch_id : null,
                source: typeof session.source === "string" ? session.source : null,
                tab_id:
                  message.debug && typeof message.debug === "object"
                    ? (message.debug.tab_id ?? null)
                    : null,
                window_from:
                  typeof message.windowFrom === "string"
                    ? message.windowFrom
                    : typeof session.last_imported_at === "string"
                      ? session.last_imported_at
                      : null,
              })
            : null;

          const emit = (event, attrs) => {
            if (!debug) return;
            debugStore.append(debug.debug_run_id, { event, attrs });
          };

          try {
            const result = await runImportSession(
              session,
              typeof message.windowFrom === "string" ? message.windowFrom : undefined,
              importRunnerDeps,
              {
                enabled: Boolean(debug),
                parseOnly: Boolean(
                  message.debug &&
                    typeof message.debug === "object" &&
                    message.debug.parse_only,
                ),
                tabId:
                  message.debug && typeof message.debug === "object"
                    ? message.debug.tab_id ?? undefined
                    : undefined,
                debugRunId: debug ? debug.debug_run_id : undefined,
                emit,
              },
            );
            if (debug) {
              debugStore.finish(debug.debug_run_id, "ok");
            }
            await sessionStore.setSession(null);
            return {
              ok: true,
              result,
              debug_run_id: debug ? debug.debug_run_id : null,
            };
          } catch (error) {
            const messageText = error instanceof Error ? error.message : "Unknown import error";
            if (
              !(
                message.debug &&
                typeof message.debug === "object" &&
                message.debug.parse_only
              )
            ) {
              await tryCompleteSessionAsFailed(session, callEdge);
            }
            await sessionStore.setSession(null);
            if (debug) {
              emit("run_failed", { error_message: messageText });
              debugStore.finish(debug.debug_run_id, "error", messageText);
            }
            throw error;
          }
        }

        if (message.type === "MONEY_IMPORT_DEBUG_GET_LAST_RUN") {
          return {
            ok: true,
            run: debugStore.getLastRunSummary(),
          };
        }

        throw new Error("Unsupported fallback message type: " + String(message.type));
      },
    };
  }

  return globalWindow.__moneyImportDebugHarness.handleMessage(payload);
})`;

function getArgValue(argv: string[], key: string): string | undefined {
  const index = argv.findIndex((token) => token === key);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): CliArgs {
  const sourceId = normalizeMoneyImportSourceIdInput(getArgValue(argv, "--source") ?? "tbank_web");
  const preset = getMoneyImportSourcePreset(sourceId);
  const defaults: CliArgs = {
    windowFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    artifactRoot: path.resolve(process.cwd(), ".tmp", "scraper-debug", preset.sourceKey),
    sessionName: preset.sourceKey,
    parseOnly: true,
    parseStrategy: "fast",
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
    if (token === "--parse-strategy" && argv[index + 1]) {
      const parseStrategyInput = argv[index + 1].trim().toLowerCase();
      if (parseStrategyInput === "fast" || parseStrategyInput === "full") {
        parsed.parseStrategy = parseStrategyInput;
      }
      index += 1;
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
      parsed.sourceId = normalizeMoneyImportSourceIdInput(argv[index + 1]);
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

  parsed.sourceId = normalizeMoneyImportSourceIdInput(parsed.sourceId);
  parsed.sourceKey = parsed.sourceKey.trim() || sanitizeMoneyImportSourceKey(parsed.sourceId);
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

function deriveExtensionIdFromKey(key: string): string | null {
  const normalizedKey = key.trim();
  if (!normalizedKey) return null;

  try {
    const derBytes = Buffer.from(normalizedKey, "base64");
    const hash = createHash("sha256").update(derBytes).digest();
    const alphabet = "abcdefghijklmnop";
    return Array.from(hash.subarray(0, 16))
      .flatMap((byte) => [alphabet[(byte >> 4) & 0x0f], alphabet[byte & 0x0f]])
      .join("");
  } catch {
    return null;
  }
}

async function deriveExtensionIdFromManifest(): Promise<string | null> {
  try {
    const manifestRaw = await fs.readFile(path.join(EXTENSION_DIST_DIR, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw) as { key?: unknown };
    return typeof manifest.key === "string" ? deriveExtensionIdFromKey(manifest.key) : null;
  } catch {
    return null;
  }
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

function findExtensionWorker(context: BrowserContext, extensionId?: string): Worker | null {
  return (
    context.serviceWorkers().find((worker) => {
      if (!worker.url().startsWith("chrome-extension://")) return false;
      if (!extensionId) return true;
      return parseExtensionId(worker.url()) === extensionId;
    }) ?? null
  );
}

async function waitForExtensionWorker(
  context: BrowserContext,
  extensionId?: string,
  timeoutMs = 15000,
): Promise<Worker> {
  const existing = findExtensionWorker(context, extensionId);
  if (existing) return existing;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(250, deadline - Date.now());
    const worker = await context
      .waitForEvent("serviceworker", { timeout: Math.min(1000, remaining) })
      .catch(() => null);
    if (worker && worker.url().startsWith("chrome-extension://")) {
      if (!extensionId || parseExtensionId(worker.url()) === extensionId) {
        return worker;
      }
    }
    const nextExisting = findExtensionWorker(context, extensionId);
    if (nextExisting) return nextExisting;
  }

  throw new Error("Unable to resolve extension service worker. Verify extension loaded correctly.");
}

async function refreshExtensionRuntime(context: BrowserContext): Promise<string> {
  const resolvedExtensionId = await resolveExtensionId(context).catch(() => null);
  const manifestExtensionId = await deriveExtensionIdFromManifest();
  const extensionId = resolvedExtensionId ?? manifestExtensionId;
  if (!extensionId) {
    throw new Error("Unable to resolve extension id. Verify extension build and manifest key.");
  }

  await waitForExtensionWorker(context, extensionId).catch(() => null);
  process.stdout.write(`[debug-runner] Extension runtime ready (${extensionId}).\n`);
  return extensionId;
}

async function sendRuntimeMessage<T>(
  extensionPage: Page,
  message: Record<string, unknown>,
): Promise<T> {
  const runtimeResponse = (await extensionPage.evaluate(
    (payload) =>
      new Promise<{
        ok: boolean;
        response?: unknown;
        timedOut?: boolean;
        lastError?: string | null;
      }>((resolve) => {
        const timer = window.setTimeout(() => {
          resolve({
            ok: false,
            timedOut: true,
            lastError: chrome.runtime.lastError?.message ?? null,
          });
        }, 5000);

        chrome.runtime.sendMessage(payload, (response) => {
          window.clearTimeout(timer);
          resolve({
            ok: true,
            response,
            lastError: chrome.runtime.lastError?.message ?? null,
          });
        });
      }),
    message,
  )) as {
    ok: boolean;
    response?: T;
    timedOut?: boolean;
    lastError?: string | null;
  };

  if (runtimeResponse.ok && !runtimeResponse.lastError) {
    return runtimeResponse.response as T;
  }

  process.stdout.write(
    `[debug-runner] Runtime messaging unavailable for ${String(message.type)}; falling back to in-page router execution.\n`,
  );

  return extensionPage.evaluate(
    ({ payload, source }) => {
      const factory = (0, eval)(source) as (message: Record<string, unknown>) => Promise<T>;
      return factory(payload);
    },
    { payload: message, source: IN_PAGE_ROUTER_FALLBACK_SOURCE },
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
    ignoreDefaultArgs: ["--disable-extensions"],
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

  const extensionId = await refreshExtensionRuntime(context);

  const sourcePage = await context.newPage();
  await sourcePage.goto(args.targetUrl, { waitUntil: "domcontentloaded" });
  await sourcePage.bringToFront().catch(() => undefined);

  const manualAuthAssessment = await assessManualAuthRequirement(
    sourcePage,
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

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "domcontentloaded",
  });

  const sourceTab = await resolveSourceTab(extensionPage, args.tabUrlPatterns, args.tabUrlContains);
  if (typeof sourceTab.id !== "number") {
    throw new Error("Unable to resolve source tab id for debug run.");
  }
  await sourcePage.bringToFront().catch(() => undefined);

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
      parse_strategy: args.parseStrategy,
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
      parse_strategy: args.parseStrategy,
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
  const analysisArtifacts = args.autoReport
    ? await writeAnalysisArtifacts(
        artifactPayload as Record<string, unknown>,
        artifactDir,
        artifactDir,
        {
          maxRows: Number.MAX_SAFE_INTEGER,
        },
      )
    : null;

  process.stdout.write(`[debug-runner] Artifacts written to: ${artifactDir}\n`);
  if (analysisArtifacts?.diagnostics.categories.includes("AUTH_BLOCKED")) {
    process.stdout.write(
      [
        "[debug-runner] Manual authorization is required.",
        "Ask a human to authorize in the opened T-Bank browser, then rerun.",
        "Use --wait-for-manual 5 or --wait-for-manual 10 so the runner pauses for auth instead of continuing immediately.",
      ].join(" "),
    );
    process.stdout.write("\n");
  }

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
