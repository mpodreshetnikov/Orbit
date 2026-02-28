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
  command_env?: string;
  args?: string[];
  url?: string;
  url_env?: string;
  env?: string[];
  optional_env?: string[];
  env_map?: Record<string, string>;
  optional_env_map?: Record<string, string>;
  http_headers_env_map?: Record<string, string>;
  optional_http_headers_env_map?: Record<string, string>;
  enabled_env?: string;
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
type StdioEnvBindings = {
  required: Record<string, string>;
  optional: Record<string, string>;
};
type HttpHeaderBindings = {
  required: Record<string, string>;
  optional: Record<string, string>;
};

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const canonicalPath = path.join(repoRoot, "mcp", "servers.canonical.json");
const mcpEnvPath = path.join(repoRoot, "mcp", ".env");

function assertValidServer(name: string, server: CanonicalServer): void {
  if (server.enabled_env && server.enabled_env.trim().length === 0) {
    throw new Error(`Server "${name}" has empty "enabled_env".`);
  }

  if (server.transport === "stdio") {
    if (!server.command && !server.command_env) {
      throw new Error(`Server "${name}" uses stdio but is missing "command" or "command_env".`);
    }
    if (server.command_env && server.command_env.trim().length === 0) {
      throw new Error(`Server "${name}" has empty "command_env".`);
    }
    assertValidEnvList(name, "env", server.env);
    assertValidEnvList(name, "optional_env", server.optional_env);
    assertValidEnvMap(name, "env_map", server.env_map);
    assertValidEnvMap(name, "optional_env_map", server.optional_env_map);
    assertNoBindingOverlap(name, server);
    return;
  }

  if (!server.url && !server.url_env) {
    throw new Error(`Server "${name}" uses http but is missing "url" or "url_env".`);
  }

  if (server.url_env && server.url_env.trim().length === 0) {
    throw new Error(`Server "${name}" has empty "url_env".`);
  }

  if (server.auth_kind && server.auth_kind !== "bearer") {
    throw new Error(`Server "${name}" has unsupported "auth_kind": "${server.auth_kind}".`);
  }

  assertValidEnvMap(name, "http_headers_env_map", server.http_headers_env_map);
  assertValidEnvMap(name, "optional_http_headers_env_map", server.optional_http_headers_env_map);
  assertNoHttpHeaderBindingOverlap(name, server);

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

  const httpHeaderBindings = getHttpHeaderBindings(server);
  const hasAuthorizationBinding =
    "Authorization" in httpHeaderBindings.required ||
    "Authorization" in httpHeaderBindings.optional;
  if (server.auth_kind === "bearer" && hasAuthorizationBinding) {
    throw new Error(
      `Server "${name}" configures bearer auth and maps "Authorization" in HTTP headers. ` +
        `Remove one of these configurations.`,
    );
  }
}

function assertValidEnvList(
  serverName: string,
  fieldName: "env" | "optional_env",
  value: string[] | undefined,
): void {
  for (const envVarName of value ?? []) {
    if (envVarName.trim().length === 0) {
      throw new Error(`Server "${serverName}" has an empty env var name in "${fieldName}".`);
    }
  }
}

function assertValidEnvMap(
  serverName: string,
  fieldName:
    | "env_map"
    | "optional_env_map"
    | "http_headers_env_map"
    | "optional_http_headers_env_map",
  value: Record<string, string> | undefined,
): void {
  for (const [targetEnvVar, sourceEnvVar] of Object.entries(value ?? {})) {
    if (targetEnvVar.trim().length === 0) {
      throw new Error(`Server "${serverName}" has an empty target env var in "${fieldName}".`);
    }
    if (sourceEnvVar.trim().length === 0) {
      throw new Error(
        `Server "${serverName}" has an empty source env var for target "${targetEnvVar}" in "${fieldName}".`,
      );
    }
  }
}

function getHttpHeaderBindings(server: CanonicalServer): HttpHeaderBindings {
  const required: Record<string, string> = {};
  const optional: Record<string, string> = {};

  for (const [headerName, sourceEnvVar] of Object.entries(server.http_headers_env_map ?? {})) {
    required[headerName] = sourceEnvVar;
  }
  for (const [headerName, sourceEnvVar] of Object.entries(
    server.optional_http_headers_env_map ?? {},
  )) {
    optional[headerName] = sourceEnvVar;
  }

  return { required, optional };
}

function getStdioEnvBindings(server: CanonicalServer): StdioEnvBindings {
  const required: Record<string, string> = {};
  const optional: Record<string, string> = {};

  for (const envVarName of server.env ?? []) {
    required[envVarName] = envVarName;
  }
  for (const [targetEnvVar, sourceEnvVar] of Object.entries(server.env_map ?? {})) {
    required[targetEnvVar] = sourceEnvVar;
  }

  for (const envVarName of server.optional_env ?? []) {
    optional[envVarName] = envVarName;
  }
  for (const [targetEnvVar, sourceEnvVar] of Object.entries(server.optional_env_map ?? {})) {
    optional[targetEnvVar] = sourceEnvVar;
  }

  return { required, optional };
}

function assertNoBindingOverlap(serverName: string, server: CanonicalServer): void {
  const bindings = getStdioEnvBindings(server);
  for (const requiredTargetEnvVar of Object.keys(bindings.required)) {
    if (requiredTargetEnvVar in bindings.optional) {
      throw new Error(
        `Server "${serverName}" defines "${requiredTargetEnvVar}" as both required and optional env.`,
      );
    }
  }
}

function assertNoHttpHeaderBindingOverlap(serverName: string, server: CanonicalServer): void {
  const bindings = getHttpHeaderBindings(server);
  for (const requiredHeaderName of Object.keys(bindings.required)) {
    if (requiredHeaderName in bindings.optional) {
      throw new Error(
        `Server "${serverName}" defines "${requiredHeaderName}" as both required and optional HTTP header env binding.`,
      );
    }
  }
}

function isServerEnabled(server: CanonicalServer, envMap: Record<string, string>): boolean {
  if (!server.enabled_env) {
    return true;
  }

  const value = envValue(envMap, server.enabled_env)?.toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
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

function resolveHttpUrl(
  name: string,
  server: CanonicalServer,
  envMap: Record<string, string>,
): string {
  if (server.url_env) {
    const resolvedUrl = envValue(envMap, server.url_env);
    if (!resolvedUrl) {
      throw new Error(
        `Server "${name}" requires env var "${server.url_env}" for HTTP URL generation.`,
      );
    }

    return resolvedUrl;
  }

  if (server.url) {
    return server.url;
  }

  throw new Error(`Server "${name}" uses http but no URL could be resolved.`);
}

function resolveHttpHeaderValues(
  name: string,
  server: CanonicalServer,
  envMap: Record<string, string>,
): Record<string, string> {
  const bindings = getHttpHeaderBindings(server);
  const resolved: Record<string, string> = {};

  for (const [headerName, sourceEnvVar] of Object.entries(bindings.required)) {
    const value = envValue(envMap, sourceEnvVar);
    if (!value) {
      throw new Error(
        `Server "${name}" requires env var "${sourceEnvVar}" for HTTP header ` +
          `"${headerName}" generation.`,
      );
    }
    resolved[headerName] = normalizeHttpHeaderValue(headerName, value);
  }

  for (const [headerName, sourceEnvVar] of Object.entries(bindings.optional)) {
    const value = envValue(envMap, sourceEnvVar);
    if (value) {
      resolved[headerName] = normalizeHttpHeaderValue(headerName, value);
    }
  }

  return resolved;
}

function normalizeHttpHeaderValue(headerName: string, value: string): string {
  const normalizedValue = value.trim().replace(/^["']([\s\S]*)["']$/, "$1");

  if (headerName.toLowerCase() !== "authorization") {
    return normalizedValue;
  }

  const authPrefix = /^authorization\s*:\s*/i;
  return normalizedValue.replace(authPrefix, "");
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
  const bindings = getStdioEnvBindings(server);
  const resolved: Record<string, string> = {};

  for (const [targetEnvVar, sourceEnvVar] of Object.entries(bindings.required)) {
    const value = envValue(envMap, sourceEnvVar);
    if (!value) {
      throw new Error(
        `Server "${name}" requires env var "${sourceEnvVar}" for stdio config generation ` +
          `(target "${targetEnvVar}").`,
      );
    }
    resolved[targetEnvVar] = value;
  }

  for (const [targetEnvVar, sourceEnvVar] of Object.entries(bindings.optional)) {
    const value = envValue(envMap, sourceEnvVar);
    if (value) {
      resolved[targetEnvVar] = value;
    }
  }

  return resolved;
}

function resolveStdioCommand(
  name: string,
  server: CanonicalServer,
  envMap: Record<string, string>,
): string {
  if (server.command_env) {
    const envCommand = envValue(envMap, server.command_env);
    if (envCommand) {
      return envCommand;
    }
  }

  if (server.command) {
    return server.command;
  }

  if (server.command_env) {
    throw new Error(
      `Server "${name}" requires env var "${server.command_env}" for stdio command generation.`,
    );
  }

  throw new Error(`Server "${name}" uses stdio but no command could be resolved.`);
}

function buildClaudeConfig(canonical: CanonicalConfig, envMap: Record<string, string>): string {
  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const [name, server] of Object.entries(sortObject(canonical.servers))) {
    if (!isServerEnabled(server, envMap)) {
      continue;
    }

    if (server.transport === "stdio") {
      const command = resolveStdioCommand(name, server, envMap);
      const resolvedEnv = resolveStdioEnvValues(name, server, envMap);
      mcpServers[name] = {
        command,
        ...(server.args && server.args.length > 0 ? { args: server.args } : {}),
        ...(Object.keys(resolvedEnv).length > 0 ? { env: resolvedEnv } : {}),
      };
      continue;
    }

    const auth = resolveHttpAuth(name, server, envMap);
    const url = resolveHttpUrl(name, server, envMap);
    const headers = resolveHttpHeaderValues(name, server, envMap);
    if (auth.mode === "pat") {
      headers.Authorization = `Bearer ${auth.token}`;
    }

    mcpServers[name] = {
      type: "http",
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }

  return stringifyJson({ mcpServers });
}

function buildCursorConfig(canonical: CanonicalConfig, envMap: Record<string, string>): string {
  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const [name, server] of Object.entries(sortObject(canonical.servers))) {
    if (!isServerEnabled(server, envMap)) {
      continue;
    }

    if (server.transport === "stdio") {
      const command = resolveStdioCommand(name, server, envMap);
      const resolvedEnv = resolveStdioEnvValues(name, server, envMap);
      mcpServers[name] = {
        command,
        ...(server.args && server.args.length > 0 ? { args: server.args } : {}),
        ...(Object.keys(resolvedEnv).length > 0 ? { env: resolvedEnv } : {}),
      };
      continue;
    }

    const auth = resolveHttpAuth(name, server, envMap);
    const url = resolveHttpUrl(name, server, envMap);
    const headers = resolveHttpHeaderValues(name, server, envMap);
    if (auth.mode === "pat") {
      headers.Authorization = `Bearer ${auth.token}`;
    }

    mcpServers[name] = {
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }

  return stringifyJson({ mcpServers });
}

function buildCodexToml(canonical: CanonicalConfig, envMap: Record<string, string>): string {
  const lines: string[] = [];
  const sortedServers = sortObject(canonical.servers);

  for (const [name, server] of Object.entries(sortedServers)) {
    if (!isServerEnabled(server, envMap)) {
      continue;
    }

    lines.push(`[mcp_servers.${name}]`);

    if (server.transport === "stdio") {
      const command = resolveStdioCommand(name, server, envMap);
      lines.push(`command = "${tomlEscape(command)}"`);

      if (server.args && server.args.length > 0) {
        lines.push(`args = ${tomlArray(server.args)}`);
      }

      const resolvedEnv = resolveStdioEnvValues(name, server, envMap);
      if (Object.keys(resolvedEnv).length > 0) {
        lines.push(`env = ${tomlInlineMap(resolvedEnv)}`);
      }
    } else {
      const url = resolveHttpUrl(name, server, envMap);
      lines.push(`url = "${tomlEscape(url)}"`);
      const auth = resolveHttpAuth(name, server, envMap);
      const headers = resolveHttpHeaderValues(name, server, envMap);
      if (auth.mode === "pat") {
        headers.Authorization = `Bearer ${auth.token}`;
      }
      if (Object.keys(headers).length > 0) {
        lines.push(`http_headers = ${tomlInlineMap(headers)}`);
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
