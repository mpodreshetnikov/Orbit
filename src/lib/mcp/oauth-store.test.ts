import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "./crypto";
import {
  claimGrantForRotation,
  consumeAuthorizationCode,
  countClients,
  createAuthorizationCode,
  findGrantByAccessToken,
  findGrantByRefreshToken,
  getClient,
  isGrantUserAllowed,
  issueGrant,
  linkCodeToGrant,
  listGrantsForUser,
  pruneUnusedClients,
  registerClient,
  revokeGrant,
  revokeGrantByToken,
  revokeGrantChain,
  touchGrant,
} from "./oauth-store";

/**
 * These cover the module that owns every OAuth token in the system. Each
 * exported function takes its Supabase client as a parameter, so the tests pass
 * a stub rather than mocking the module.
 *
 * The stub records the full call chain per table and resolves terminals from a
 * FIFO queue, which lets a test assert both "what query was built" and "what
 * happens for this result".
 */

type Result = { data?: unknown; error?: { message: string } | null; count?: number };

interface Recorded {
  table: string;
  method: string;
  args: unknown[];
}

function makeClient(queues: Record<string, Result[]>) {
  const calls: Recorded[] = [];

  function builderFor(table: string) {
    const next = (): Result => queues[table]?.shift() ?? { data: null, error: null };

    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };

    const settle =
      (method: string) =>
      async (...args: unknown[]) => {
        calls.push({ table, method, args });
        const r = next();
        return { data: r.data ?? null, error: r.error ?? null, count: r.count };
      };

    const builder: Record<string, unknown> = {
      select: record("select"),
      insert: record("insert"),
      update: record("update"),
      upsert: record("upsert"),
      delete: record("delete"),
      eq: record("eq"),
      neq: record("neq"),
      is: record("is"),
      gt: record("gt"),
      lt: record("lt"),
      in: record("in"),
      or: record("or"),
      order: record("order"),
      limit: record("limit"),
      single: settle("single"),
      maybeSingle: settle("maybeSingle"),
      // Awaiting the builder directly is a terminal too.
      then: (resolve: (value: unknown) => unknown) => {
        const r = next();
        return Promise.resolve(
          resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count }),
        );
      },
    };

    return builder;
  }

  const client = {
    from: vi.fn((table: string) => builderFor(table)),
  } as unknown as SupabaseClient;

  const argsFor = (table: string, method: string) =>
    calls.filter((c) => c.table === table && c.method === method).map((c) => c.args);

  return { client, calls, argsFor };
}

const CLIENTS = "mcp_oauth_clients";
const CODES = "mcp_oauth_authorization_codes";
const GRANTS = "mcp_oauth_grants";

beforeEach(() => {
  vi.useRealTimers();
});

describe("countClients", () => {
  it("returns the count", async () => {
    const { client } = makeClient({ [CLIENTS]: [{ count: 7 }] });
    await expect(countClients(client)).resolves.toBe(7);
  });

  it("treats a null count as zero", async () => {
    const { client } = makeClient({ [CLIENTS]: [{ count: undefined }] });
    await expect(countClients(client)).resolves.toBe(0);
  });

  it("surfaces a query error", async () => {
    const { client } = makeClient({ [CLIENTS]: [{ error: { message: "boom" } }] });
    await expect(countClients(client)).rejects.toThrow(/Failed to count OAuth clients: boom/);
  });
});

describe("pruneUnusedClients", () => {
  it("deletes only registrations with no grant attached", async () => {
    const { client, argsFor } = makeClient({
      [CLIENTS]: [
        {
          data: [
            { client_id: "abandoned-1", mcp_oauth_grants: [] },
            { client_id: "in-use", mcp_oauth_grants: [{ id: "g-1" }] },
            { client_id: "abandoned-2", mcp_oauth_grants: [] },
          ],
        },
        { data: null },
      ],
    });

    await expect(pruneUnusedClients(client)).resolves.toBe(2);
    // A connector someone actually completed the flow with is never removed.
    expect(argsFor(CLIENTS, "in")).toEqual([["client_id", ["abandoned-1", "abandoned-2"]]]);
  });

  it("does nothing when every stale registration is in use", async () => {
    const { client, argsFor } = makeClient({
      [CLIENTS]: [{ data: [{ client_id: "in-use", mcp_oauth_grants: [{ id: "g-1" }] }] }],
    });

    await expect(pruneUnusedClients(client)).resolves.toBe(0);
    expect(argsFor(CLIENTS, "delete")).toHaveLength(0);
  });

  it("tolerates a missing grants array", async () => {
    const { client } = makeClient({
      [CLIENTS]: [{ data: [{ client_id: "c-1" }] }, { data: null }],
    });

    await expect(pruneUnusedClients(client)).resolves.toBe(1);
  });

  it("swallows a query error, since pruning must never fail a registration", async () => {
    const { client } = makeClient({ [CLIENTS]: [{ error: { message: "boom" } }] });
    await expect(pruneUnusedClients(client)).resolves.toBe(0);
  });

  it("uses the requested age cutoff", async () => {
    const { client, argsFor } = makeClient({ [CLIENTS]: [{ data: [] }] });
    await pruneUnusedClients(client, 60_000);

    const [[column, cutoff]] = argsFor(CLIENTS, "lt");
    expect(column).toBe("created_at");
    expect(Date.now() - Date.parse(cutoff as string)).toBeGreaterThanOrEqual(59_000);
  });
});

describe("registerClient", () => {
  const input = {
    clientName: "Claude",
    redirectUris: ["https://claude.ai/cb"],
    scope: "health:read health:write",
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code"],
    responseTypes: ["code"],
  };

  it("inserts a client with a generated id", async () => {
    const { client, argsFor } = makeClient({
      [CLIENTS]: [{ count: 0 }, { data: { client_id: "mcp_generated" } }],
    });

    await expect(registerClient(input, client)).resolves.toMatchObject({
      client_id: "mcp_generated",
    });

    const [[row]] = argsFor(CLIENTS, "insert") as [[Record<string, unknown>]];
    expect(row.client_id).toMatch(/^mcp_[0-9a-f]{32}$/);
    expect(row.redirect_uris).toEqual(["https://claude.ai/cb"]);
    // Optional metadata defaults to null rather than undefined.
    expect(row.client_uri).toBeNull();
    expect(row.software_id).toBeNull();
  });

  it("passes optional metadata through when supplied", async () => {
    const { client, argsFor } = makeClient({
      [CLIENTS]: [{ count: 0 }, { data: { client_id: "mcp_generated" } }],
    });

    await registerClient(
      {
        ...input,
        clientUri: "https://claude.ai",
        softwareId: "claude",
        logoUri: "https://l/i.png",
      },
      client,
    );

    const [[row]] = argsFor(CLIENTS, "insert") as [[Record<string, unknown>]];
    expect(row).toMatchObject({
      client_uri: "https://claude.ai",
      software_id: "claude",
      logo_uri: "https://l/i.png",
    });
  });

  it("prunes and proceeds when the cap is hit but stale rows can be reclaimed", async () => {
    const { client } = makeClient({
      [CLIENTS]: [
        { count: 50 }, // at the cap
        { data: [{ client_id: "abandoned", mcp_oauth_grants: [] }] }, // prune candidates
        { data: null }, // delete
        { count: 49 }, // re-count after pruning
        { data: { client_id: "mcp_generated" } },
      ],
    });

    await expect(registerClient(input, client)).resolves.toMatchObject({
      client_id: "mcp_generated",
    });
  });

  it("refuses only when the cap still holds after pruning", async () => {
    const { client } = makeClient({
      [CLIENTS]: [{ count: 50 }, { data: [] }, { count: 50 }],
    });

    await expect(registerClient(input, client)).rejects.toThrow(/cap of 50 in-use registrations/);
  });

  it("surfaces an insert error", async () => {
    const { client } = makeClient({
      [CLIENTS]: [{ count: 0 }, { error: { message: "duplicate" } }],
    });

    await expect(registerClient(input, client)).rejects.toThrow(/duplicate/);
  });

  it("surfaces a silent no-row insert", async () => {
    const { client } = makeClient({ [CLIENTS]: [{ count: 0 }, { data: null }] });
    await expect(registerClient(input, client)).rejects.toThrow(/no row returned/);
  });
});

describe("getClient", () => {
  it("looks up an enabled client by id", async () => {
    const { client, argsFor } = makeClient({ [CLIENTS]: [{ data: { client_id: "mcp_abc" } }] });

    await expect(getClient("mcp_abc", client)).resolves.toMatchObject({ client_id: "mcp_abc" });
    expect(argsFor(CLIENTS, "eq")).toEqual([["client_id", "mcp_abc"]]);
    // A disabled client must not resolve.
    expect(argsFor(CLIENTS, "is")).toEqual([["disabled_at", null]]);
  });

  it("returns null when there is no match", async () => {
    const { client } = makeClient({ [CLIENTS]: [{ data: null }] });
    await expect(getClient("nope", client)).resolves.toBeNull();
  });

  it("surfaces a query error", async () => {
    const { client } = makeClient({ [CLIENTS]: [{ error: { message: "boom" } }] });
    await expect(getClient("mcp_abc", client)).rejects.toThrow(/Failed to load OAuth client/);
  });
});

describe("createAuthorizationCode", () => {
  const input = {
    clientId: "mcp_abc",
    authUserId: "user-1",
    userEmail: "u@example.com",
    redirectUri: "https://claude.ai/cb",
    scope: "health:read",
    codeChallenge: "challenge",
    resource: null,
  };

  it("stores only the hash of the code it returns", async () => {
    const { client, argsFor } = makeClient({ [CODES]: [{ data: null }] });

    const code = await createAuthorizationCode(input, client);
    const [[row]] = argsFor(CODES, "insert") as [[Record<string, unknown>]];

    expect(row.code_hash).toBe(sha256Hex(code));
    // The plaintext code must never reach the database.
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.code_challenge_method).toBe("S256");
  });

  it("expires the code within a minute", async () => {
    const { client, argsFor } = makeClient({ [CODES]: [{ data: null }] });
    await createAuthorizationCode(input, client);

    const [[row]] = argsFor(CODES, "insert") as [[Record<string, unknown>]];
    const ttl = Date.parse(row.expires_at as string) - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it("surfaces an insert error", async () => {
    const { client } = makeClient({ [CODES]: [{ error: { message: "boom" } }] });
    await expect(createAuthorizationCode(input, client)).rejects.toThrow(
      /Failed to create authorization code/,
    );
  });
});

describe("consumeAuthorizationCode", () => {
  it("claims an unused code and returns it", async () => {
    const { client, argsFor } = makeClient({
      [CODES]: [{ data: { id: "code-1", client_id: "mcp_abc" } }],
    });

    const result = await consumeAuthorizationCode("the-code", client);

    expect(result).toMatchObject({ status: "ok", row: { id: "code-1" } });
    // The single-use guard must live in the UPDATE, not a prior read.
    expect(argsFor(CODES, "is")).toEqual([["consumed_at", null]]);
    expect(argsFor(CODES, "eq")).toEqual([["code_hash", sha256Hex("the-code")]]);
  });

  it("reports replay when the code exists but was already consumed", async () => {
    const { client } = makeClient({
      [CODES]: [
        { data: null },
        { data: { id: "code-1", consumed_at: "2026-01-01T00:00:00Z", issued_grant_id: "grant-1" } },
      ],
    });

    await expect(consumeAuthorizationCode("the-code", client)).resolves.toEqual({
      status: "replayed",
      issuedGrantId: "grant-1",
    });
  });

  it("reports replay with a null grant id when nothing was linked", async () => {
    const { client } = makeClient({
      [CODES]: [
        { data: null },
        { data: { id: "code-1", consumed_at: "2026-01-01T00:00:00Z", issued_grant_id: null } },
      ],
    });

    await expect(consumeAuthorizationCode("the-code", client)).resolves.toEqual({
      status: "replayed",
      issuedGrantId: null,
    });
  });

  it("reports not_found for an unknown code", async () => {
    const { client } = makeClient({ [CODES]: [{ data: null }, { data: null }] });
    await expect(consumeAuthorizationCode("nope", client)).resolves.toEqual({
      status: "not_found",
    });
  });

  it("reports not_found for a code that exists but expired unconsumed", async () => {
    // Present in the table, never consumed: the UPDATE missed it on expiry.
    const { client } = makeClient({
      [CODES]: [{ data: null }, { data: { id: "code-1", consumed_at: null } }],
    });

    await expect(consumeAuthorizationCode("stale", client)).resolves.toEqual({
      status: "not_found",
    });
  });

  it("surfaces an update error", async () => {
    const { client } = makeClient({ [CODES]: [{ error: { message: "boom" } }] });
    await expect(consumeAuthorizationCode("x", client)).rejects.toThrow(
      /Failed to consume authorization code/,
    );
  });
});

describe("linkCodeToGrant", () => {
  it("records which grant a code produced", async () => {
    const { client, argsFor } = makeClient({ [CODES]: [{ data: null }] });
    await linkCodeToGrant("code-1", "grant-1", client);

    expect(argsFor(CODES, "update")).toEqual([[{ issued_grant_id: "grant-1" }]]);
    expect(argsFor(CODES, "eq")).toEqual([["id", "code-1"]]);
  });
});

describe("issueGrant", () => {
  const input = {
    clientId: "mcp_abc",
    authUserId: "user-1",
    userEmail: "u@example.com",
    scope: "health:read health:write",
  };

  it("stores hashes and returns the plaintext pair once", async () => {
    const { client, argsFor } = makeClient({ [GRANTS]: [{ data: { id: "grant-1" } }] });

    const tokens = await issueGrant(input, client);
    const [[row]] = argsFor(GRANTS, "insert") as [[Record<string, unknown>]];

    expect(row.access_token_hash).toBe(sha256Hex(tokens.accessToken));
    expect(row.refresh_token_hash).toBe(sha256Hex(tokens.refreshToken));
    // Neither plaintext token may be persisted.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(tokens.accessToken);
    expect(serialized).not.toContain(tokens.refreshToken);
    expect(tokens.grantId).toBe("grant-1");
    expect(tokens.accessToken).not.toBe(tokens.refreshToken);
  });

  it("gives the refresh token a longer life than the access token", async () => {
    const { client, argsFor } = makeClient({ [GRANTS]: [{ data: { id: "grant-1" } }] });
    await issueGrant(input, client);

    const [[row]] = argsFor(GRANTS, "insert") as [[Record<string, unknown>]];
    expect(Date.parse(row.refresh_token_expires_at as string)).toBeGreaterThan(
      Date.parse(row.access_token_expires_at as string),
    );
  });

  it("records the grant it rotated from", async () => {
    const { client, argsFor } = makeClient({ [GRANTS]: [{ data: { id: "grant-2" } }] });
    await issueGrant({ ...input, rotatedFrom: "grant-1" }, client);

    const [[row]] = argsFor(GRANTS, "insert") as [[Record<string, unknown>]];
    expect(row.rotated_from).toBe("grant-1");
  });

  it("defaults rotated_from to null for a fresh grant", async () => {
    const { client, argsFor } = makeClient({ [GRANTS]: [{ data: { id: "grant-1" } }] });
    await issueGrant(input, client);

    const [[row]] = argsFor(GRANTS, "insert") as [[Record<string, unknown>]];
    expect(row.rotated_from).toBeNull();
  });

  it("surfaces an insert error", async () => {
    const { client } = makeClient({ [GRANTS]: [{ error: { message: "boom" } }] });
    await expect(issueGrant(input, client)).rejects.toThrow(/Failed to issue OAuth grant/);
  });
});

describe("grant lookup", () => {
  it("finds a grant by the hash of its access token", async () => {
    const { client, argsFor } = makeClient({ [GRANTS]: [{ data: { id: "grant-1" } }] });

    await expect(findGrantByAccessToken("access-1", client)).resolves.toMatchObject({
      id: "grant-1",
    });
    expect(argsFor(GRANTS, "eq")).toEqual([["access_token_hash", sha256Hex("access-1")]]);
  });

  it("returns null for an unknown access token", async () => {
    const { client } = makeClient({ [GRANTS]: [{ data: null }] });
    await expect(findGrantByAccessToken("nope", client)).resolves.toBeNull();
  });

  it("finds a grant by the hash of its refresh token", async () => {
    const { client, argsFor } = makeClient({ [GRANTS]: [{ data: { id: "grant-1" } }] });

    await expect(findGrantByRefreshToken("refresh-1", client)).resolves.toMatchObject({
      id: "grant-1",
    });
    expect(argsFor(GRANTS, "eq")).toEqual([["refresh_token_hash", sha256Hex("refresh-1")]]);
  });

  it("returns null for an unknown refresh token", async () => {
    const { client } = makeClient({ [GRANTS]: [{ data: null }] });
    await expect(findGrantByRefreshToken("nope", client)).resolves.toBeNull();
  });

  it.each([
    ["access", findGrantByAccessToken],
    ["refresh", findGrantByRefreshToken],
  ])("surfaces a %s lookup error", async (_label, fn) => {
    const { client } = makeClient({ [GRANTS]: [{ error: { message: "boom" } }] });
    await expect(fn("x", client)).rejects.toThrow(/Failed to look up OAuth grant/);
  });
});

describe("claimGrantForRotation", () => {
  it("claims an unrevoked grant and returns it", async () => {
    const { client, argsFor } = makeClient({ [GRANTS]: [{ data: { id: "grant-1" } }] });

    await expect(claimGrantForRotation("grant-1", client)).resolves.toMatchObject({
      id: "grant-1",
    });
    // The guard must be in the UPDATE so concurrent refreshes cannot both win.
    expect(argsFor(GRANTS, "is")).toEqual([["revoked_at", null]]);
  });

  it("returns null when another request already claimed it", async () => {
    const { client } = makeClient({ [GRANTS]: [{ data: null }] });
    await expect(claimGrantForRotation("grant-1", client)).resolves.toBeNull();
  });

  it("surfaces a claim error", async () => {
    const { client } = makeClient({ [GRANTS]: [{ error: { message: "boom" } }] });
    await expect(claimGrantForRotation("grant-1", client)).rejects.toThrow(
      /Failed to claim OAuth grant for rotation/,
    );
  });
});

describe("revocation", () => {
  it("revokes a single grant", async () => {
    const { client, argsFor } = makeClient({ [GRANTS]: [{ data: null }] });
    await revokeGrant("grant-1", client);

    expect(argsFor(GRANTS, "eq")).toEqual([["id", "grant-1"]]);
    expect(argsFor(GRANTS, "is")).toEqual([["revoked_at", null]]);
  });

  it("surfaces a revoke error", async () => {
    const { client } = makeClient({ [GRANTS]: [{ error: { message: "boom" } }] });
    await expect(revokeGrant("grant-1", client)).rejects.toThrow(/Failed to revoke OAuth grant/);
  });

  it("revokes descendants too, so a leaked token's whole family dies", async () => {
    const { client, argsFor } = makeClient({
      [GRANTS]: [
        { data: null }, // revoke grant-1
        { data: [{ id: "grant-2" }] }, // children of grant-1
        { data: null }, // revoke grant-2
        { data: [] }, // children of grant-2
      ],
    });

    await revokeGrantChain("grant-1", client);

    expect(argsFor(GRANTS, "eq")).toEqual(
      expect.arrayContaining([
        ["id", "grant-1"],
        ["rotated_from", "grant-1"],
        ["id", "grant-2"],
      ]),
    );
  });

  it("stops cleanly when a grant has no descendants", async () => {
    const { client } = makeClient({ [GRANTS]: [{ data: null }, { data: null }] });
    await expect(revokeGrantChain("grant-1", client)).resolves.toBeUndefined();
  });

  it("revokes by either token form", async () => {
    const { client, argsFor } = makeClient({
      [GRANTS]: [{ data: { id: "grant-1" } }, { data: null }, { data: [] }],
    });

    await revokeGrantByToken("some-token", client);

    // Matched against both hashes, since RFC 7009 does not say which was sent.
    const [[filter]] = argsFor(GRANTS, "or");
    expect(filter).toContain(sha256Hex("some-token"));
    expect(filter).toContain("access_token_hash");
    expect(filter).toContain("refresh_token_hash");
  });

  it("is a no-op for an unknown token, so it cannot be used to probe", async () => {
    const { client, argsFor } = makeClient({ [GRANTS]: [{ data: null }] });

    await expect(revokeGrantByToken("nope", client)).resolves.toBeUndefined();
    expect(argsFor(GRANTS, "update")).toHaveLength(0);
  });
});

describe("touchGrant", () => {
  it("stamps last use", async () => {
    const { client, argsFor } = makeClient({ [GRANTS]: [{ data: null }] });
    await touchGrant("grant-1", client);

    const [[patch]] = argsFor(GRANTS, "update") as [[Record<string, unknown>]];
    expect(typeof patch.last_used_at).toBe("string");
  });
});

describe("isGrantUserAllowed", () => {
  const grant = { auth_user_id: "user-1", user_email: "u@example.com" };

  it("matches on either user id or email", async () => {
    const { client, argsFor } = makeClient({ allowed_users: [{ data: { id: "a-1" } }] });

    await expect(isGrantUserAllowed(grant, client)).resolves.toBe(true);
    const [[filter]] = argsFor("allowed_users", "or");
    expect(filter).toBe("auth_user_id.eq.user-1,email.eq.u@example.com");
  });

  it("is false when the user has been removed from the allowlist", async () => {
    const { client } = makeClient({ allowed_users: [{ data: null }] });
    await expect(isGrantUserAllowed(grant, client)).resolves.toBe(false);
  });

  it("surfaces a lookup error rather than silently denying", async () => {
    const { client } = makeClient({ allowed_users: [{ error: { message: "boom" } }] });
    await expect(isGrantUserAllowed(grant, client)).rejects.toThrow(
      /Failed to check allowlist membership/,
    );
  });
});

describe("listGrantsForUser", () => {
  it("flattens the client name onto each grant", async () => {
    const { client } = makeClient({
      [GRANTS]: [
        {
          data: [
            { id: "grant-1", mcp_oauth_clients: { client_name: "Claude" } },
            { id: "grant-2", mcp_oauth_clients: null },
          ],
        },
      ],
    });

    const grants = await listGrantsForUser("user-1", client);

    expect(grants[0]).toMatchObject({ id: "grant-1", client_name: "Claude" });
    expect(grants[1]).toMatchObject({ id: "grant-2", client_name: null });
  });

  it("returns an empty list when there are no grants", async () => {
    const { client } = makeClient({ [GRANTS]: [{ data: null }] });
    await expect(listGrantsForUser("user-1", client)).resolves.toEqual([]);
  });

  it("excludes revoked grants", async () => {
    const { client, argsFor } = makeClient({ [GRANTS]: [{ data: [] }] });
    await listGrantsForUser("user-1", client);

    expect(argsFor(GRANTS, "is")).toEqual([["revoked_at", null]]);
    expect(argsFor(GRANTS, "eq")).toEqual([["auth_user_id", "user-1"]]);
  });

  it("surfaces a query error", async () => {
    const { client } = makeClient({ [GRANTS]: [{ error: { message: "boom" } }] });
    await expect(listGrantsForUser("user-1", client)).rejects.toThrow(
      /Failed to list OAuth grants/,
    );
  });
});
