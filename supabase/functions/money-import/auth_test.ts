// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { isSessionUsable, resolveAuth } from "./auth.ts";
import type { UserAuthContext } from "./types.ts";

async function assertThrowsWithMessage(
  run: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof Error)) {
    throw new Error("Expected an Error to be thrown");
  }
  assertEquals(caught.message, expectedMessage);
}

const userContext: UserAuthContext = {
  mode: "user",
  token: "token",
  userId: "user-1",
  email: "user@example.com",
};

Deno.test("resolveAuth fails when Authorization header is missing", async () => {
  await assertThrowsWithMessage(
    () =>
      resolveAuth(
        new Request("http://localhost"),
        {
          authenticateAllowedUser: async () => null,
          getSessionByToken: async () => null,
        },
        { allowUser: true, allowSession: true },
      ),
    "Missing Authorization header",
  );
});

Deno.test("resolveAuth returns user auth context when allowlisted user exists", async () => {
  const auth = await resolveAuth(
    new Request("http://localhost", { headers: { Authorization: "Bearer token" } }),
    {
      authenticateAllowedUser: async () => userContext,
      getSessionByToken: async () => null,
    },
    { allowUser: true, allowSession: false },
  );
  assertEquals(auth, userContext);
});

Deno.test("resolveAuth falls back to session auth when user auth is unavailable", async () => {
  const session = {
    id: "session-1",
    status: "running",
    revoked_at: null,
    expires_at: "2026-01-01T00:10:00.000Z",
  };

  const auth = await resolveAuth(
    new Request("http://localhost", { headers: { Authorization: "Bearer session-token" } }),
    {
      authenticateAllowedUser: async () => null,
      getSessionByToken: async () => session,
      now: () => new Date("2026-01-01T00:00:00.000Z").getTime(),
    },
    { allowUser: true, allowSession: true },
  );

  assertEquals(auth.mode, "session");
  if (auth.mode !== "session") {
    throw new Error("Expected session auth context");
  }
  assertEquals(auth.session, session);
});

Deno.test("resolveAuth rejects unusable session and throws Unauthorized", async () => {
  await assertThrowsWithMessage(
    () =>
      resolveAuth(
        new Request("http://localhost", { headers: { Authorization: "Bearer session-token" } }),
        {
          authenticateAllowedUser: async () => null,
          getSessionByToken: async () => ({
            status: "running",
            revoked_at: null,
            expires_at: "2026-01-01T00:00:00.000Z",
          }),
          now: () => new Date("2026-01-01T00:00:00.000Z").getTime(),
        },
        { allowUser: false, allowSession: true },
      ),
    "Unauthorized",
  );
});

Deno.test("isSessionUsable handles revoked, missing expiry, status and valid states", () => {
  const nowMs = new Date("2026-01-01T00:00:00.000Z").getTime();

  assertEquals(
    isSessionUsable(
      {
        status: "running",
        revoked_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-01-01T00:10:00.000Z",
      },
      nowMs,
    ),
    false,
  );

  assertEquals(
    isSessionUsable(
      {
        status: "running",
        revoked_at: null,
        expires_at: null,
      },
      nowMs,
    ),
    false,
  );

  assertEquals(
    isSessionUsable(
      {
        status: "done",
        revoked_at: null,
        expires_at: "2026-01-01T00:10:00.000Z",
      },
      nowMs,
    ),
    false,
  );

  assertEquals(
    isSessionUsable(
      {
        status: "created",
        revoked_at: null,
        expires_at: "2026-01-01T00:10:00.000Z",
      },
      nowMs,
    ),
    true,
  );
});
