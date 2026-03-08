#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { chromium, type Page } from "@playwright/test";

interface CliArgs {
  artifactRoot: string;
  sessionName: string;
  waitSeconds: number;
  sourceId: string;
  sourceKey: string;
  targetUrl: string;
  apiUrlRegex: string;
}

interface SourcePreset {
  sourceKey: string;
  targetUrl: string;
  apiUrlRegex: string;
}

interface ApiCaptureEntry {
  timestamp: string;
  method: string;
  status: number;
  url: string;
  sanitized_url: string;
  resource_type: string;
  content_type: string | null;
  body_preview: string | null;
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
      apiUrlRegex: "https://(?:www\\.)?tbank\\.ru/api/common/v1/",
    };
  }

  return {
    sourceKey: sanitizeSourceKey(sourceId),
    targetUrl: "",
    apiUrlRegex: "",
  };
}

function parseArgs(argv: string[]): CliArgs {
  const sourceId = (getArgValue(argv, "--source") ?? "tbank_web").trim();
  const preset = getSourcePreset(sourceId);
  const parsed: CliArgs = {
    artifactRoot: path.resolve(process.cwd(), ".tmp", "scraper-debug", preset.sourceKey),
    sessionName: "api-capture",
    waitSeconds: 0,
    sourceId,
    sourceKey: preset.sourceKey,
    targetUrl: preset.targetUrl,
    apiUrlRegex: preset.apiUrlRegex,
  };
  let artifactRootOverridden = false;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
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
    if (token === "--wait-for-manual" && argv[index + 1]) {
      const seconds = Number(argv[index + 1]);
      if (Number.isFinite(seconds) && seconds >= 0) {
        parsed.waitSeconds = seconds;
      }
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
    if (token === "--api-url-regex" && argv[index + 1]) {
      parsed.apiUrlRegex = argv[index + 1];
      index += 1;
    }
  }

  parsed.sourceId = parsed.sourceId.trim();
  parsed.sourceKey = parsed.sourceKey.trim() || sanitizeSourceKey(parsed.sourceId);
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
      new RegExp(parsed.apiUrlRegex, "i");
    } catch {
      throw new Error(`Invalid --api-url-regex: ${parsed.apiUrlRegex}`);
    }
  }

  return parsed;
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

function formatForPath(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

async function waitForStop(targetUrl: string, seconds: number): Promise<void> {
  if (seconds > 0) {
    process.stdout.write(
      `[api-capture] Capturing for ${seconds}s on ${targetUrl}. Interact with the page to generate API traffic...\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return;
  }

  if (!process.stdin.isTTY) {
    process.stdout.write(
      "[api-capture] Non-interactive terminal detected. Capturing for default 15 seconds.\n",
    );
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    return;
  }

  const ui = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await ui.question(
    `[api-capture] Perform login/challenge and interact with ${targetUrl}. Press Enter to stop capture...`,
  );
  ui.close();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const apiUrlPattern = args.apiUrlRegex.trim() ? new RegExp(args.apiUrlRegex, "i") : null;
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
  });

  const captures: ApiCaptureEntry[] = [];
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

      captures.push({
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
  await waitForStop(args.targetUrl, args.waitSeconds);

  const now = new Date();
  const artifactDir = path.join(args.artifactRoot, `${formatForPath(now)}-api-capture`);
  await fs.mkdir(artifactDir, { recursive: true });

  const statusHistogram: Record<string, number> = {};
  for (const capture of captures) {
    const key = String(capture.status);
    statusHistogram[key] = (statusHistogram[key] ?? 0) + 1;
  }

  const payload = {
    metadata: {
      created_at: now.toISOString(),
      script: "playwright-cli-capture-tbank-apis.ts",
      source_id: args.sourceId,
      source_key: args.sourceKey,
      session: args.sessionName,
      target_url: args.targetUrl,
      api_url_regex: args.apiUrlRegex || null,
      total_captures: captures.length,
    },
    status_histogram: statusHistogram,
    captures,
  };

  await fs.writeFile(
    path.join(artifactDir, "api-captures.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`[api-capture] Captured ${captures.length} API responses.\n`);
  process.stdout.write(`[api-capture] Artifacts written to: ${artifactDir}\n`);

  await context.close();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
