import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

type ApiAuthMode = "auto" | "basic" | "bearer";
type ResolvedAuth =
  | {
      mode: "basic";
      username: string;
      password: string;
    }
  | {
      mode: "bearer";
      token: string;
    };

type CliOptions = {
  authMode?: ApiAuthMode;
  target?: "local";
  grafanaUrl?: string;
  bootstrapToken?: string;
  username?: string;
  password?: string;
  serviceAccountId?: string;
  serviceAccountName?: string;
  serviceAccountRole?: string;
  tokenName?: string;
  secondsToLive?: string;
  orgId?: string;
  listOnly: boolean;
  help: boolean;
};

type ResolvedOptions = {
  grafanaUrl: string;
  auth: ResolvedAuth;
  serviceAccountId?: number;
  serviceAccountName: string;
  serviceAccountRole: string;
  tokenName: string;
  secondsToLive?: number;
  orgId?: string;
  listOnly: boolean;
};

type OrgContext = {
  id: number;
  name?: string;
};

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const mcpEnvPath = path.join(repoRoot, "mcp", ".env");

function usage(): string {
  return [
    "Usage:",
    "  npx tsx scripts/mcp/create-grafana-mcp-token.ts [options]",
    "",
    "Options:",
    "  --target local                   Optional. Only local Grafana token generation is supported.",
    "  --auth-mode <auto|basic|bearer>  Auth mode for Grafana API calls (default: auto).",
    "  --grafana-url <url>              Grafana base URL (http://localhost:3300 or https://<stack>.grafana.net).",
    "  --bootstrap-token <token>        Existing token used to call Grafana API.",
    "  --username <user>                Basic auth username for Grafana API (local default: admin).",
    "  --password <pass>                Basic auth password for Grafana API (local default: admin).",
    "  --service-account-id <id>        Optional service account id. If omitted, the script uses/creates mcp-local.",
    "  --service-account-name <name>    Service account name used when id is omitted (default: mcp-local).",
    "  --service-account-role <role>    Role when auto-creating a service account (default: Viewer).",
    "  --token-name <name>              Token name (default: mcp-grafana-local-<timestamp>).",
    "  --seconds-to-live <seconds>      Optional token TTL in seconds.",
    "  --org-id <id>                    Optional X-Grafana-Org-Id header value.",
    "  --list-only                      Only list token metadata; do not create a token.",
    "  --help                           Show this help text.",
    "",
    "Environment fallbacks:",
    "  Global: GRAFANA_URL, GRAFANA_API_AUTH_MODE, GRAFANA_BOOTSTRAP_TOKEN, GRAFANA_ADMIN_USER, GRAFANA_ADMIN_PASSWORD, GRAFANA_SERVICE_ACCOUNT_ID, GRAFANA_SERVICE_ACCOUNT_NAME, GRAFANA_SERVICE_ACCOUNT_ROLE, GRAFANA_ORG_ID",
    "  Local:  GRAFANA_LOCAL_URL, GRAFANA_LOCAL_API_AUTH_MODE, GRAFANA_LOCAL_BOOTSTRAP_TOKEN, GRAFANA_LOCAL_ADMIN_USER, GRAFANA_LOCAL_ADMIN_PASSWORD, GRAFANA_LOCAL_SERVICE_ACCOUNT_ID, GRAFANA_LOCAL_SERVICE_ACCOUNT_NAME, GRAFANA_LOCAL_SERVICE_ACCOUNT_ROLE, GRAFANA_LOCAL_ORG_ID",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    listOnly: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--target":
        if (next !== "local") {
          throw new Error('Only "--target local" is supported.');
        }
        options.target = "local";
        index += 1;
        break;
      case "--auth-mode":
        if (next !== "auto" && next !== "basic" && next !== "bearer") {
          throw new Error('Expected "--auth-mode auto|basic|bearer".');
        }
        options.authMode = next;
        index += 1;
        break;
      case "--grafana-url":
        if (!next) {
          throw new Error('Missing value for "--grafana-url".');
        }
        options.grafanaUrl = next;
        index += 1;
        break;
      case "--bootstrap-token":
        if (!next) {
          throw new Error('Missing value for "--bootstrap-token".');
        }
        options.bootstrapToken = next;
        index += 1;
        break;
      case "--username":
        if (!next) {
          throw new Error('Missing value for "--username".');
        }
        options.username = next;
        index += 1;
        break;
      case "--password":
        if (!next) {
          throw new Error('Missing value for "--password".');
        }
        options.password = next;
        index += 1;
        break;
      case "--service-account-id":
        if (!next) {
          throw new Error('Missing value for "--service-account-id".');
        }
        options.serviceAccountId = next;
        index += 1;
        break;
      case "--service-account-name":
        if (!next) {
          throw new Error('Missing value for "--service-account-name".');
        }
        options.serviceAccountName = next;
        index += 1;
        break;
      case "--service-account-role":
        if (!next) {
          throw new Error('Missing value for "--service-account-role".');
        }
        options.serviceAccountRole = next;
        index += 1;
        break;
      case "--token-name":
        if (!next) {
          throw new Error('Missing value for "--token-name".');
        }
        options.tokenName = next;
        index += 1;
        break;
      case "--seconds-to-live":
        if (!next) {
          throw new Error('Missing value for "--seconds-to-live".');
        }
        options.secondsToLive = next;
        index += 1;
        break;
      case "--org-id":
        if (!next) {
          throw new Error('Missing value for "--org-id".');
        }
        options.orgId = next;
        index += 1;
        break;
      case "--list-only":
        options.listOnly = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument "${arg}".\n\n${usage()}`);
    }
  }

  return options;
}

function getProcessEnvMap(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
}

async function loadMcpEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = parseEnv(raw);
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      env[key] = String(value);
    }

    return env;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {};
    }
    throw error;
  }
}

function envValue(envMap: Record<string, string>, key: string): string | undefined {
  const value = envMap[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireValue(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing required value for ${label}.`);
  }
  return value;
}

function parsePositiveInt(raw: string | undefined, label: string): number {
  const value = requireValue(raw, label);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer. Received "${value}".`);
  }
  return parsed;
}

function parseOptionalPositiveInt(raw: string | undefined, label: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer. Received "${raw}".`);
  }
  return parsed;
}

function sanitizeUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  return parsed.toString().replace(/\/+$/, "");
}

function parseAuthMode(raw: string | undefined): ApiAuthMode {
  const mode = (raw ?? "auto").trim().toLowerCase();
  if (mode === "auto" || mode === "basic" || mode === "bearer") {
    return mode;
  }
  throw new Error(`Invalid auth mode "${raw}". Expected "auto", "basic", or "bearer".`);
}

function nowTokenSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function localEnv(envMap: Record<string, string>, suffix: string): string | undefined {
  return envValue(envMap, `GRAFANA_LOCAL_${suffix}`);
}

function resolveOptions(cli: CliOptions, envMap: Record<string, string>): ResolvedOptions {
  const grafanaUrl = requireValue(
    cli.grafanaUrl ??
      localEnv(envMap, "URL") ??
      envValue(envMap, "GRAFANA_URL") ??
      "http://localhost:3300",
    "Grafana URL (--grafana-url or GRAFANA_URL)",
  );
  const authMode = parseAuthMode(
    cli.authMode ?? localEnv(envMap, "API_AUTH_MODE") ?? envValue(envMap, "GRAFANA_API_AUTH_MODE"),
  );

  const bootstrapToken =
    cli.bootstrapToken ??
    localEnv(envMap, "BOOTSTRAP_TOKEN") ??
    envValue(envMap, "GRAFANA_BOOTSTRAP_TOKEN");
  const basicUsername =
    cli.username ??
    localEnv(envMap, "ADMIN_USER") ??
    envValue(envMap, "GRAFANA_ADMIN_USER") ??
    "admin";
  const basicPassword =
    cli.password ??
    localEnv(envMap, "ADMIN_PASSWORD") ??
    envValue(envMap, "GRAFANA_ADMIN_PASSWORD") ??
    "admin";

  let auth: ResolvedAuth;
  if (authMode === "bearer") {
    auth = {
      mode: "bearer",
      token: requireValue(
        bootstrapToken,
        "Grafana bootstrap token (--bootstrap-token or GRAFANA_BOOTSTRAP_TOKEN)",
      ),
    };
  } else if (authMode === "basic") {
    auth = {
      mode: "basic",
      username: requireValue(
        basicUsername,
        "basic auth username (--username or GRAFANA_ADMIN_USER)",
      ),
      password: requireValue(
        basicPassword,
        "basic auth password (--password or GRAFANA_ADMIN_PASSWORD)",
      ),
    };
  } else if (bootstrapToken) {
    auth = { mode: "bearer", token: bootstrapToken };
  } else if (basicUsername && basicPassword) {
    auth = { mode: "basic", username: basicUsername, password: basicPassword };
  } else {
    throw new Error(
      'No Grafana API auth available. Provide "--bootstrap-token" (bearer) or "--username/--password" (basic).',
    );
  }

  const serviceAccountId = parseOptionalPositiveInt(
    cli.serviceAccountId ??
      localEnv(envMap, "SERVICE_ACCOUNT_ID") ??
      envValue(envMap, "GRAFANA_SERVICE_ACCOUNT_ID"),
    "service account id (--service-account-id or GRAFANA_SERVICE_ACCOUNT_ID)",
  );
  const serviceAccountName =
    cli.serviceAccountName ??
    localEnv(envMap, "SERVICE_ACCOUNT_NAME") ??
    envValue(envMap, "GRAFANA_SERVICE_ACCOUNT_NAME") ??
    "mcp-local";
  const serviceAccountRole =
    cli.serviceAccountRole ??
    localEnv(envMap, "SERVICE_ACCOUNT_ROLE") ??
    envValue(envMap, "GRAFANA_SERVICE_ACCOUNT_ROLE") ??
    "Viewer";
  const secondsToLiveRaw =
    cli.secondsToLive ??
    localEnv(envMap, "MCP_TOKEN_SECONDS_TO_LIVE") ??
    envValue(envMap, "GRAFANA_MCP_TOKEN_SECONDS_TO_LIVE");
  const secondsToLive = secondsToLiveRaw
    ? parsePositiveInt(secondsToLiveRaw, "seconds to live (--seconds-to-live)")
    : undefined;
  const tokenName =
    cli.tokenName ??
    localEnv(envMap, "MCP_TOKEN_NAME") ??
    envValue(envMap, "GRAFANA_MCP_TOKEN_NAME") ??
    `mcp-grafana-local-${nowTokenSuffix()}`;
  const orgId = cli.orgId ?? localEnv(envMap, "ORG_ID") ?? envValue(envMap, "GRAFANA_ORG_ID");

  return {
    grafanaUrl: sanitizeUrl(grafanaUrl),
    auth,
    serviceAccountId,
    serviceAccountName,
    serviceAccountRole,
    tokenName,
    secondsToLive,
    orgId,
    listOnly: cli.listOnly,
  };
}

async function grafanaApiRequest(
  resolved: ResolvedOptions,
  method: "GET" | "POST",
  apiPath: string,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (resolved.auth.mode === "bearer") {
    headers.Authorization = `Bearer ${resolved.auth.token}`;
  } else {
    const encoded = Buffer.from(`${resolved.auth.username}:${resolved.auth.password}`).toString(
      "base64",
    );
    headers.Authorization = `Basic ${encoded}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (resolved.orgId) {
    headers["X-Grafana-Org-Id"] = resolved.orgId;
  }

  const response = await fetch(`${resolved.grafanaUrl}${apiPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const rawBody = await response.text();
  const parsedBody = rawBody.length > 0 ? tryParseJson(rawBody) : null;

  if (!response.ok) {
    const detail = parsedBody === null ? rawBody : JSON.stringify(parsedBody);
    throw new Error(`Grafana API ${method} ${apiPath} failed (${response.status}): ${detail}`);
  }

  return parsedBody;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

async function findServiceAccountIdByName(
  resolved: ResolvedOptions,
  serviceAccountName: string,
): Promise<number | undefined> {
  const apiPath =
    `/api/serviceaccounts/search?query=${encodeURIComponent(serviceAccountName)}` + "&perpage=1000";
  const response = await grafanaApiRequest(resolved, "GET", apiPath);
  const responseRecord = asRecord(response);
  const serviceAccounts = asArray(responseRecord?.serviceAccounts) ?? [];

  for (const serviceAccount of serviceAccounts) {
    const serviceAccountRecord = asRecord(serviceAccount);
    if (!serviceAccountRecord) {
      continue;
    }
    if (serviceAccountRecord.name !== serviceAccountName) {
      continue;
    }
    const id = toPositiveInt(serviceAccountRecord.id);
    if (id) {
      return id;
    }
  }

  return undefined;
}

async function createServiceAccount(
  resolved: ResolvedOptions,
  serviceAccountName: string,
  serviceAccountRole: string,
): Promise<number> {
  const createPayload = {
    name: serviceAccountName,
    role: serviceAccountRole,
  };
  const response = await grafanaApiRequest(resolved, "POST", "/api/serviceaccounts", createPayload);
  const responseRecord = asRecord(response);
  const id = toPositiveInt(responseRecord?.id);
  if (!id) {
    throw new Error(
      `Grafana create-service-account response did not include a valid "id" for "${serviceAccountName}".`,
    );
  }
  return id;
}

async function ensureServiceAccountId(resolved: ResolvedOptions): Promise<number> {
  if (resolved.serviceAccountId) {
    return resolved.serviceAccountId;
  }

  const existingId = await findServiceAccountIdByName(resolved, resolved.serviceAccountName);
  if (existingId) {
    console.log(
      `Using existing service account "${resolved.serviceAccountName}" (id: ${existingId}).`,
    );
    return existingId;
  }

  const createdId = await createServiceAccount(
    resolved,
    resolved.serviceAccountName,
    resolved.serviceAccountRole,
  );
  console.log(
    `Created service account "${resolved.serviceAccountName}" with role "${resolved.serviceAccountRole}" (id: ${createdId}).`,
  );
  return createdId;
}

async function resolveOrgContext(resolved: ResolvedOptions): Promise<OrgContext | undefined> {
  const response = await grafanaApiRequest(resolved, "GET", "/api/org");
  const responseRecord = asRecord(response);
  const id = toPositiveInt(responseRecord?.id);
  if (!id) {
    return undefined;
  }

  const name = typeof responseRecord?.name === "string" ? responseRecord.name : undefined;
  return { id, name };
}

function printJson(label: string, value: unknown): void {
  console.log(`${label}:`);
  console.log(JSON.stringify(value, null, 2));
}

function buildRegeneratedTokenName(baseTokenName: string): string {
  return `${baseTokenName}-${nowTokenSuffix()}`;
}

async function createTokenWithRetry(
  resolved: ResolvedOptions,
  apiPath: string,
): Promise<{ response: unknown; tokenName: string; regenerated: boolean }> {
  const tryCreate = async (tokenName: string): Promise<unknown> => {
    const createPayload: Record<string, unknown> = { name: tokenName };
    if (resolved.secondsToLive) {
      createPayload.secondsToLive = resolved.secondsToLive;
    }
    return grafanaApiRequest(resolved, "POST", apiPath, createPayload);
  };

  try {
    const response = await tryCreate(resolved.tokenName);
    return { response, tokenName: resolved.tokenName, regenerated: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("serviceaccounts.ErrTokenAlreadyExists")) {
      throw error;
    }

    const regeneratedTokenName = buildRegeneratedTokenName(resolved.tokenName);
    console.log(
      `Token name "${resolved.tokenName}" already exists. Retrying with "${regeneratedTokenName}".`,
    );
    const response = await tryCreate(regeneratedTokenName);
    return { response, tokenName: regeneratedTokenName, regenerated: true };
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(usage());
    return;
  }

  const mcpEnv = await loadMcpEnvFile(mcpEnvPath);
  const envMap = {
    ...mcpEnv,
    ...getProcessEnvMap(),
  };
  const resolved = resolveOptions(cli, envMap);
  const serviceAccountId = await ensureServiceAccountId(resolved);
  const apiPath = `/api/serviceaccounts/${serviceAccountId}/tokens`;
  const orgContext = await resolveOrgContext(resolved);

  console.log(`Target Grafana URL: ${resolved.grafanaUrl}`);
  console.log("Target profile: local");
  console.log(`Auth mode: ${resolved.auth.mode}`);
  if (orgContext) {
    const orgNameSuffix = orgContext.name ? ` (${orgContext.name})` : "";
    console.log(`Org id: ${orgContext.id}${orgNameSuffix}`);
  } else if (resolved.orgId) {
    console.log(`Org id: ${resolved.orgId}`);
  }
  console.log(`Service account id: ${serviceAccountId}`);

  const existingTokens = await grafanaApiRequest(resolved, "GET", apiPath);
  printJson("Existing token metadata", existingTokens);

  if (resolved.listOnly) {
    console.log("List-only mode enabled. Skipping token creation.");
    return;
  }

  const created = await createTokenWithRetry(resolved, apiPath);
  const createdToken = created.response;
  if (created.regenerated) {
    console.log(`Created token using regenerated name: ${created.tokenName}`);
  }
  printJson("Create token response", createdToken);

  const createdTokenRecord = asRecord(createdToken);
  const tokenKey = typeof createdTokenRecord?.key === "string" ? createdTokenRecord.key : undefined;
  if (!tokenKey) {
    throw new Error(
      'Grafana create-token response did not include "key". Treat token keys as one-time visible secrets.',
    );
  }

  console.log("");
  console.log("Token key (one-time visible value):");
  console.log(tokenKey);
  console.log("");
  console.log("Store this token now and then set it in mcp/.env for the local MCP server.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`create-grafana-mcp-token failed: ${message}`);
  process.exit(1);
});
