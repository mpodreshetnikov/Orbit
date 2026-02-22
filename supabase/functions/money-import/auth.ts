import { getBearerToken, normalizeText, toIsoOrNull } from "./normalize.ts";
import type { AuthContext, SessionAuthContext, UserAuthContext } from "./types.ts";

export interface MoneyImportAuthDeps {
  authenticateAllowedUser(token: string): Promise<UserAuthContext | null>;
  getSessionByToken(token: string): Promise<Record<string, unknown> | null>;
  now?: () => number;
}

export function isSessionUsable(session: Record<string, unknown>, nowMs = Date.now()): boolean {
  const revokedAt = toIsoOrNull(session.revoked_at);
  if (revokedAt) return false;

  const expiresAt = toIsoOrNull(session.expires_at);
  if (!expiresAt) return false;
  if (new Date(expiresAt).getTime() <= nowMs) return false;

  const status = normalizeText(session.status) ?? "";
  return status === "created" || status === "running";
}

function asSessionAuthContext(token: string, session: Record<string, unknown>): SessionAuthContext {
  return {
    mode: "session",
    token,
    session,
  };
}

export async function resolveAuth(
  req: Request,
  deps: MoneyImportAuthDeps,
  options: { allowUser: boolean; allowSession: boolean },
): Promise<AuthContext> {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing Authorization header");

  if (options.allowUser) {
    const user = await deps.authenticateAllowedUser(token);
    if (user) return user;
  }

  if (options.allowSession) {
    const session = await deps.getSessionByToken(token);
    if (session && isSessionUsable(session, (deps.now ?? (() => Date.now()))())) {
      return asSessionAuthContext(token, session);
    }
  }

  throw new Error("Unauthorized");
}
