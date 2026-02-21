import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

type Transport = "stdio" | "http";
type AuthKind = "bearer";
type AuthMode = "pat" | "oauth";

type CanonicalServer = {
  transport: Transport;
  command?: string;
  args?: string[];
  url?: string;
  env?: string[];
  auth_kind?: AuthKind;
  auth_mode_env?: string;
  default_auth_mode?: AuthMode;
  token_env?: string;
  oauth_supported?: boolean;
};

type CanonicalConfig = {
  servers: Record<string, CanonicalServer>;
};

type ResolvedHttpAuth = { mode: "none" } | { mode: "oauth" } | { mode: "pat"; token: string };

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const canonicalPath = path.join(repoRoot, "mcp", "servers.canonical.json");
const mcpEnvPath = path.join(repoRoot, "mcp", ".env");

function assertValidServer(name: string, server: CanonicalServer): void {
  if (server.transport === "stdio") {
    if (!server.command) {
      throw new Error(`Server "${name}" uses stdio but is missing "command".`);
    }
    return;
  }

  if (!server.url) {
    throw new Error(`Server "${name}" uses http but is missing "url".`);
  }

  if (server.auth_kind && server.auth_kind !== "bearer") {
    throw new Error(`Server "${name}" has unsupported "auth_kind": "${server.auth_kind}".`);
  }

  if ((server.auth_mode_env || server.default_auth_mode || server.token_env) && !server.auth_kind) {
    throw new Error(`Server "${name}" has auth mode fields but no "auth_kind" configured.`);
  }

  if (
    server.default_auth_mode &&
    server.default_auth_mode !== "pat" &&
    server.default_auth_mode !== "oauth"
  ) {
    throw new Error(
      `Server "${name}" has invalid "default_auth_mode": "${server.default_auth_mode}".`,
    );
  }

  if (
    server.auth_kind === "bearer" &&
    server.default_auth_mode !== "oauth" &&
    !server.token_env &&
    (!server.env || server.env.length !== 1)
  ) {
    throw new Error(
      `Server "${name}" uses bearer auth and needs "token_env" (or one legacy env var).`,
    );
  }

  if (
    server.auth_kind === "bearer" &&
    server.token_env &&
    (!server.auth_mode_env || !server.default_auth_mode)
  ) {
    throw new Error(
      `Server "${name}" uses bearer auth and must define both "auth_mode_env" and "default_auth_mode".`,
    );
  }

  if (server.auth_kind !== "bearer" && server.env && server.env.length > 1) {
    throw new Error(
      `Server "${name}" uses http and defines multiple env vars. ` +
        `Only one token env var is currently supported for Codex output.`,
    );
  }
}

function sortObject<T>(obj: Record<string, T>): Record<string, T> {
  const sortedEntries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(sortedEntries);
}

function stringifyJson(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
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

function getLegacyHttpTokenEnv(server: CanonicalServer): string | undefined {
  return server.env && server.env.length === 1 ? server.env[0] : undefined;
}

function resolveHttpAuth(
  name: string,
  server: CanonicalServer,
  envMap: Record<string, string>,
): ResolvedHttpAuth {
  if (server.auth_kind !== "bearer") {
    const legacyTokenEnv = getLegacyHttpTokenEnv(server);
    if (!legacyTokenEnv) {
      return { mode: "none" };
    }

    const legacyToken = envValue(envMap, legacyTokenEnv);
    if (!legacyToken) {
      throw new Error(`Server "${name}" requires env var "${legacyTokenEnv}" for token auth.`);
    }

    return { mode: "pat", token: legacyToken };
  }

  const modeEnvVar = server.auth_mode_env as string;
  const defaultMode = (server.default_auth_mode as AuthMode) ?? "pat";
  const configuredMode = envValue(envMap, modeEnvVar);
  const mode = (configuredMode ?? defaultMode).toLowerCase();

  if (mode !== "pat" && mode !== "oauth") {
    throw new Error(
      `Server "${name}" has invalid auth mode "${mode}". ` +
        `Expected "pat" or "oauth" from env "${modeEnvVar}".`,
    );
  }

  if (mode === "oauth") {
    if (server.oauth_supported === false) {
      throw new Error(`Server "${name}" received auth mode "oauth" but does not support OAuth.`);
    }
    return { mode: "oauth" };
  }

  const tokenEnvVar = server.token_env ?? getLegacyHttpTokenEnv(server);
  if (!tokenEnvVar) {
    throw new Error(`Server "${name}" uses PAT auth but no token env var is configured.`);
  }

  const token = envValue(envMap, tokenEnvVar);
  if (!token) {
    throw new Error(
      `Server "${name}" uses PAT auth but env var "${tokenEnvVar}" is missing or empty.`,
    );
  }

  return { mode: "pat", token };
}

function tomlEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function tomlArray(values: string[]): string {
  return `[${values.map((value) => `"${tomlEscape(value)}"`).join(", ")}]`;
}

function tomlInlineMap(values: Record<string, string>): string {
  const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  return `{ ${entries.map(([key, value]) => `${key} = "${tomlEscape(value)}"`).join(", ")} }`;
}

function resolveStdioEnvValues(
  name: string,
  server: CanonicalServer,
  envMap: Record<string, string>,
): Record<string, string> {
  const envVars = server.env ?? [];
  const resolved: Record<string, string> = {};

  for (const envVarName of envVars) {
    const value = envValue(envMap, envVarName);
    if (!value) {
      throw new Error(
        `Server "${name}" requires env var "${envVarName}" for stdio config generation.`,
      );
    }
    resolved[envVarName] = value;
  }

  return resolved;
}

function buildClaudeConfig(canonical: CanonicalConfig, envMap: Record<string, string>): string {
  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const [name, server] of Object.entries(sortObject(canonical.servers))) {
    if (server.transport === "stdio") {
      mcpServers[name] = {
        command: server.command,
        ...(server.args && server.args.length > 0 ? { args: server.args } : {}),
      };
      continue;
    }

    const auth = resolveHttpAuth(name, server, envMap);
    mcpServers[name] = {
      type: "http",
      url: server.url,
      ...(auth.mode === "pat"
        ? {
            headers: {
              Authorization: `Bearer ${auth.token}`,
            },
          }
        : {}),
    };
  }

  return stringifyJson({ mcpServers });
}

function buildCursorConfig(canonical: CanonicalConfig, envMap: Record<string, string>): string {
  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const [name, server] of Object.entries(sortObject(canonical.servers))) {
    if (server.transport === "stdio") {
      mcpServers[name] = {
        command: server.command,
        ...(server.args && server.args.length > 0 ? { args: server.args } : {}),
      };
      continue;
    }

    const auth = resolveHttpAuth(name, server, envMap);
    mcpServers[name] = {
      url: server.url,
      ...(auth.mode === "pat"
        ? {
            headers: {
              Authorization: `Bearer ${auth.token}`,
            },
          }
        : {}),
    };
  }

  return stringifyJson({ mcpServers });
}

function buildCodexToml(canonical: CanonicalConfig, envMap: Record<string, string>): string {
  const lines: string[] = [];
  const sortedServers = sortObject(canonical.servers);

  for (const [name, server] of Object.entries(sortedServers)) {
    lines.push(`[mcp_servers.${name}]`);

    if (server.transport === "stdio") {
      lines.push(`command = "${tomlEscape(server.command as string)}"`);

      if (server.args && server.args.length > 0) {
        lines.push(`args = ${tomlArray(server.args)}`);
      }

      const resolvedEnv = resolveStdioEnvValues(name, server, envMap);
      if (Object.keys(resolvedEnv).length > 0) {
        lines.push(`env = ${tomlInlineMap(resolvedEnv)}`);
      }
    } else {
      lines.push(`url = "${tomlEscape(server.url as string)}"`);
      const auth = resolveHttpAuth(name, server, envMap);
      if (auth.mode === "pat") {
        lines.push(`http_headers = ${tomlInlineMap({ Authorization: `Bearer ${auth.token}` })}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

async function writeFileEnsured(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function main(): Promise<void> {
  const canonicalRaw = await fs.readFile(canonicalPath, "utf8");
  const canonical = JSON.parse(canonicalRaw) as CanonicalConfig;
  const mcpLocalEnv = await loadMcpEnvFile(mcpEnvPath);
  const mergedEnv = {
    ...getProcessEnvMap(),
    ...mcpLocalEnv,
  };

  if (!canonical.servers || typeof canonical.servers !== "object") {
    throw new Error('Invalid canonical config: expected top-level "servers" object.');
  }

  for (const [name, server] of Object.entries(canonical.servers)) {
    assertValidServer(name, server);
  }

  const claudeConfig = buildClaudeConfig(canonical, mergedEnv);
  const cursorConfig = buildCursorConfig(canonical, mergedEnv);
  const codexToml = buildCodexToml(canonical, mergedEnv);

  await Promise.all([
    writeFileEnsured(path.join(repoRoot, ".mcp.json"), claudeConfig),
    writeFileEnsured(path.join(repoRoot, ".cursor", "mcp.json"), cursorConfig),
    writeFileEnsured(path.join(repoRoot, ".codex", "config.toml"), codexToml),
  ]);

  console.log("Synced MCP configs from mcp/servers.canonical.json");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sync:mcp failed: ${message}`);
  process.exit(1);
});
