/**
 * MCP draft→confirm happy path (T-261115-hve / B3).
 *
 * Covers the real product contract over `/api/mcp`: `propose_spend` writes nothing, then
 * `confirm_spend_draft` persists the draft's `input` under a money:write grant. Synthetic seed
 * only (dedicated e2e user, account, OAuth client/grant). Does not drive the MCP Apps HTML card
 * host protocol — that stays unit-tested in `src/lib/mcp/apps/spend-draft.test.ts`.
 *
 * Runner must enable MCP (`MCP_SERVER_ENABLED=1`) and map `JWT_SECRET` → `SUPABASE_JWT_SECRET`
 * (see `scripts/just/run-e2e.cjs`).
 */
import { createHash, randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEV_EMAIL = process.env.E2E_DEV_EMAIL_MCP_SPEND ?? "e2e-mcp-spend-draft@example.com";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const MONEY_SCOPES = "money:read money:write";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for e2e tests`);
  }
  return value;
}

function createAdminClient(): SupabaseClient {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Handler may answer as JSON or as a single SSE frame; normalize both. */
async function readJsonRpc(response: {
  text: () => Promise<string>;
}): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.startsWith("event:") || text.includes("\ndata:") || text.startsWith("data:")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    if (!line) {
      throw new Error(`SSE response missing data line: ${text.slice(0, 200)}`);
    }
    return JSON.parse(line.slice("data:".length).trim()) as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function callMcpTool(
  request: APIRequestContext,
  token: string,
  name: string,
  args: Record<string, unknown>,
  id: number,
): Promise<Record<string, unknown>> {
  const response = await request.post("/api/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    },
    data: {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });

  expect(response.status(), `tools/call ${name} HTTP status`).toBe(200);
  return readJsonRpc(response);
}

type Seed = {
  admin: SupabaseClient;
  userId: string;
  personId: string;
  accountId: string;
  clientId: string;
  grantId: string;
  accessToken: string;
  merchant: string;
};

async function seedMcpSpendDraft(admin: SupabaseClient): Promise<Seed> {
  const users = await admin.auth.admin.listUsers();
  let user = users.data.users.find((u) => u.email === DEV_EMAIL);

  if (!user?.id) {
    const { data, error } = await admin.auth.admin.createUser({
      email: DEV_EMAIL,
      email_confirm: true,
    });
    if (error || !data.user?.id) {
      throw new Error(`Could not create MCP e2e auth user: ${error?.message ?? "missing user"}`);
    }
    user = data.user;
  }

  const { error: allowlistError } = await admin
    .from("allowed_users")
    .upsert({ auth_user_id: user.id, email: DEV_EMAIL }, { onConflict: "email" });
  if (allowlistError) {
    throw new Error(`Could not allowlist ${DEV_EMAIL}: ${allowlistError.message}`);
  }

  const { data: existingPerson, error: personLookupError } = await admin
    .from("persons")
    .select("id")
    .eq("auth_user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (personLookupError) {
    throw new Error(`Could not resolve person: ${personLookupError.message}`);
  }

  let personId = existingPerson?.id as string | undefined;
  if (!personId) {
    const { data: createdPerson, error: createPersonError } = await admin
      .from("persons")
      .insert({
        auth_user_id: user.id,
        kind: "human",
        name: "E2E MCP Spend User",
      })
      .select("id")
      .single();
    if (createPersonError || !createdPerson?.id) {
      throw new Error(`Could not create person: ${createPersonError?.message ?? "missing"}`);
    }
    personId = createdPerson.id as string;
  }

  const accountId = crypto.randomUUID();
  const { error: accountError } = await admin.from("money_accounts").insert({
    id: accountId,
    owner_person_id: personId,
    source: "manual",
    account_kind: "debit",
    account_label: "E2E MCP Wallet",
    currency: "RUB",
  });
  if (accountError) {
    throw new Error(`Could not seed money account: ${accountError.message}`);
  }

  const clientId = `mcp_e2e_spend_${Date.now()}`;
  const { error: clientError } = await admin.from("mcp_oauth_clients").insert({
    client_id: clientId,
    client_name: "E2E MCP Spend Draft",
    redirect_uris: ["http://127.0.0.1/e2e/mcp-callback"],
    scope: MONEY_SCOPES,
  });
  if (clientError) {
    throw new Error(`Could not seed MCP OAuth client: ${clientError.message}`);
  }

  const accessToken = randomToken();
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data: grant, error: grantError } = await admin
    .from("mcp_oauth_grants")
    .insert({
      client_id: clientId,
      auth_user_id: user.id,
      user_email: DEV_EMAIL,
      scope: MONEY_SCOPES,
      access_token_hash: sha256Hex(accessToken),
      access_token_expires_at: expiresAt,
      refresh_token_hash: sha256Hex(refreshToken),
      refresh_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (grantError || !grant?.id) {
    throw new Error(`Could not seed MCP OAuth grant: ${grantError?.message ?? "missing grant"}`);
  }

  return {
    admin,
    userId: user.id,
    personId,
    accountId,
    clientId,
    grantId: grant.id as string,
    accessToken,
    merchant: `E2E MCP Cafe ${Date.now()}`,
  };
}

async function cleanupSeed(seed: Seed, transactionId: string | null) {
  if (transactionId) {
    await seed.admin.from("money_line_items").delete().eq("transaction_id", transactionId);
    await seed.admin.from("money_transactions").delete().eq("id", transactionId);
  }
  await seed.admin.from("money_transactions").delete().eq("account_id", seed.accountId);
  await seed.admin.from("money_accounts").delete().eq("id", seed.accountId);
  await seed.admin.from("mcp_oauth_grants").delete().eq("id", seed.grantId);
  await seed.admin.from("mcp_oauth_clients").delete().eq("client_id", seed.clientId);
}

test.describe("MCP spend draft→confirm", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );

  test("propose_spend writes nothing; confirm_spend_draft persists the draft", async ({
    request,
  }) => {
    const admin = createAdminClient();
    const seed = await seedMcpSpendDraft(admin);
    let transactionId: string | null = null;

    try {
      const proposeArgs = {
        person_id: seed.personId,
        account_id: seed.accountId,
        posted_at: "2026-11-15T10:00:00.000Z",
        amount: -175.5,
        currency: "RUB",
        transaction_type: "expense",
        merchant_name: seed.merchant,
        comment: "e2e mcp draft confirm",
        line_items: [{ title: "E2E Latte", amount: -175.5 }],
      };

      const proposeMessage = await callMcpTool(
        request,
        seed.accessToken,
        "propose_spend",
        proposeArgs,
        1,
      );
      const proposeResult = proposeMessage.result as
        | {
            isError?: boolean;
            content?: Array<{ type?: string; text?: string }>;
            structuredContent?: {
              spend_draft?: { mode?: string; input?: Record<string, unknown> };
            };
          }
        | undefined;
      expect(proposeMessage.error, JSON.stringify(proposeMessage)).toBeUndefined();
      expect(proposeResult?.isError).toBeFalsy();
      expect(proposeResult?.content?.[0]?.text ?? "").toMatch(/confirm_spend_draft/i);
      expect(proposeResult?.structuredContent?.spend_draft?.mode).toBe("create");
      const draftInput = proposeResult?.structuredContent?.spend_draft?.input;
      expect(draftInput).toMatchObject({
        account_id: seed.accountId,
        amount: -175.5,
        merchant_name: seed.merchant,
      });

      const { count: beforeCount, error: beforeError } = await admin
        .from("money_transactions")
        .select("id", { count: "exact", head: true })
        .eq("account_id", seed.accountId)
        .eq("merchant_name", seed.merchant);
      if (beforeError) {
        throw new Error(`pre-confirm count failed: ${beforeError.message}`);
      }
      expect(beforeCount ?? 0).toBe(0);

      const confirmMessage = await callMcpTool(
        request,
        seed.accessToken,
        "confirm_spend_draft",
        {
          person_id: seed.personId,
          mode: "create",
          draft: draftInput,
        },
        2,
      );
      const confirmResult = confirmMessage.result as
        | {
            isError?: boolean;
            content?: Array<{ type?: string; text?: string }>;
            structuredContent?: { transaction_id?: string; mode?: string };
          }
        | undefined;
      expect(confirmMessage.error, JSON.stringify(confirmMessage)).toBeUndefined();
      expect(confirmResult?.isError).toBeFalsy();
      expect(confirmResult?.structuredContent?.mode).toBe("create");
      transactionId = confirmResult?.structuredContent?.transaction_id ?? null;
      expect(transactionId).toBeTruthy();
      expect(confirmResult?.content?.[0]?.text ?? "").toContain(transactionId!);

      const { data: saved, error: savedError } = await admin
        .from("money_transactions")
        .select("id, amount, merchant_name, comment, account_id, payer_person_id, source")
        .eq("id", transactionId!)
        .single();
      if (savedError || !saved) {
        throw new Error(`saved transaction missing: ${savedError?.message ?? "no row"}`);
      }
      expect(saved).toMatchObject({
        id: transactionId,
        amount: -175.5,
        merchant_name: seed.merchant,
        comment: "e2e mcp draft confirm",
        account_id: seed.accountId,
        payer_person_id: seed.personId,
        source: "manual",
      });
    } finally {
      await cleanupSeed(seed, transactionId);
    }
  });
});
