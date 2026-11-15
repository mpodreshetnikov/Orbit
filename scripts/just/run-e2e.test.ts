import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REQUIRED_PARSER_MODE,
  applyE2EDefaultEnv,
  applyE2EEnv,
  parseSupabaseEnv,
} from "./run-e2e.cjs";

const MANAGED_KEYS = [
  "HEALTH_STRUCTURE_PARSER_MODE",
  "OPENROUTER_API_KEY",
  "DEV_AUTH_BYPASS_ENABLED",
  "NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED",
  "E2E_BASE_URL",
  "API_URL",
  "ANON_KEY",
  "SERVICE_ROLE_KEY",
  "JWT_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_JWT_SECRET",
  "MCP_SERVER_ENABLED",
  "MCP_OAUTH_SIGNING_SECRET",
] as const;

const saved: Partial<Record<(typeof MANAGED_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of MANAGED_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    const previous = saved[key];
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
});

describe("parseSupabaseEnv", () => {
  it('parses trimmed KEY="value" lines and rejects unanchored noise', () => {
    expect(
      parseSupabaseEnv(
        [
          '  API_URL="http://127.0.0.1:54321"  ',
          'prefixJWT_SECRET="not-a-pair"',
          'JWT_SECRET="super-secret" trailing',
          "not-a-pair",
          'ANON_KEY="anon"',
        ].join("\n"),
      ),
    ).toEqual({
      API_URL: "http://127.0.0.1:54321",
      ANON_KEY: "anon",
    });
  });
});

describe("applyE2EDefaultEnv", () => {
  it("pins extraction-stub mode, auth bypass, and IPv4 e2e base URL when unset", () => {
    applyE2EDefaultEnv();
    expect(process.env.HEALTH_STRUCTURE_PARSER_MODE).toBe(REQUIRED_PARSER_MODE);
    expect(REQUIRED_PARSER_MODE).toBe("e2e_stub");
    expect(process.env.OPENROUTER_API_KEY).toBe("e2e-local-disabled");
    expect(process.env.DEV_AUTH_BYPASS_ENABLED).toBe("1");
    expect(process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED).toBe("1");
    expect(process.env.E2E_BASE_URL).toBe("http://127.0.0.1:3100");
  });

  it("preserves explicit defaults already set by the caller", () => {
    process.env.HEALTH_STRUCTURE_PARSER_MODE = "e2e_stub";
    process.env.OPENROUTER_API_KEY = "keep-openrouter";
    process.env.DEV_AUTH_BYPASS_ENABLED = "0";
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED = "0";
    process.env.E2E_BASE_URL = "http://127.0.0.1:3999";

    applyE2EDefaultEnv();

    expect(process.env.OPENROUTER_API_KEY).toBe("keep-openrouter");
    expect(process.env.DEV_AUTH_BYPASS_ENABLED).toBe("0");
    expect(process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED).toBe("0");
    expect(process.env.E2E_BASE_URL).toBe("http://127.0.0.1:3999");
  });

  it("refuses a non-stub parser mode", () => {
    process.env.HEALTH_STRUCTURE_PARSER_MODE = "live";
    expect(() => applyE2EDefaultEnv()).toThrow(
      /HEALTH_STRUCTURE_PARSER_MODE must be 'e2e_stub' for e2e extraction tests/,
    );
  });
});

describe("applyE2EEnv", () => {
  it("maps supabase status aliases and enables MCP JWT/signing defaults when unset", () => {
    applyE2EEnv({
      API_URL: "http://127.0.0.1:54321",
      ANON_KEY: "anon-from-status",
      SERVICE_ROLE_KEY: "service-from-status",
      JWT_SECRET: "jwt-from-status",
    });

    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-from-status");
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe("service-from-status");
    expect(process.env.SUPABASE_JWT_SECRET).toBe("jwt-from-status");
    expect(process.env.MCP_SERVER_ENABLED).toBe("1");
    expect(process.env.MCP_OAUTH_SIGNING_SECRET).toBe("e2e-local-mcp-oauth-signing-secret-min-32b");
  });

  it("does not overwrite explicit MCP, JWT, or supabase aliases already set", () => {
    process.env.SUPABASE_JWT_SECRET = "already-set-jwt";
    process.env.MCP_SERVER_ENABLED = "0";
    process.env.MCP_OAUTH_SIGNING_SECRET = "already-set-signing";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://explicit.example";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "explicit-service";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "explicit-anon";

    applyE2EEnv({
      API_URL: "http://127.0.0.1:54321",
      ANON_KEY: "anon-from-status",
      SERVICE_ROLE_KEY: "service-from-status",
      JWT_SECRET: "jwt-from-status",
    });

    expect(process.env.SUPABASE_JWT_SECRET).toBe("already-set-jwt");
    expect(process.env.MCP_SERVER_ENABLED).toBe("0");
    expect(process.env.MCP_OAUTH_SIGNING_SECRET).toBe("already-set-signing");
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://explicit.example");
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe("explicit-service");
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("explicit-anon");
  });

  it("leaves supabase aliases unset when status output does not provide them", () => {
    applyE2EEnv({});
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeUndefined();
    expect(process.env.SUPABASE_JWT_SECRET).toBeUndefined();
  });
});
