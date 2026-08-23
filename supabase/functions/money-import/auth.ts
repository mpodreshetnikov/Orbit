import { getBearerToken, normalizeText, toIsoOrNull } from "./normalize.ts";
import type {
  AuthContext,
  GrantAuthContext,
  SessionAuthContext,
  UserAuthContext,
} from "./types.ts";

export interface MoneyImportAuthDeps {
  authenticateAllowedUser(token: string): Promise<UserAuthContext | null>;
  getSessionByToken(token: string): Promise<Record<string, unknown> | null>;
  getGrantByToken?(token: string): Promise<Record<string, unknown> | null>;
  now?: () => number;
}

export function isGrantUsable(grant: Record<string, unknown>, nowMs = Date.now()): boolean {
  if (toIsoOrNull(grant.revoked_at)) return false;

  // No expiry means the grant lives until it is revoked; that is the point of it.
  const expiresAt = toIsoOrNull(grant.expires_at);
  if (expiresAt && new Date(expiresAt).getTime() <= nowMs) return false;

  return true;
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

function asGrantAuthContext(token: string, grant: Record<string, unknown>): GrantAuthContext {
  return {
    mode: "grant",
    token,
    grant,
  };
}

export async function resolveAuth(
  req: Request,
  deps: MoneyImportAuthDeps,
  options: { allowUser: boolean; allowSession: boolean; allowGrant?: boolean },
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

  // Only create_session accepts a grant. Everything after that runs on the short-lived
  // session token it hands back, so a leaked grant cannot be used to read or write a
  // registry directly.
  if (options.allowGrant && deps.getGrantByToken) {
    const grant = await deps.getGrantByToken(token);
    if (grant && isGrantUsable(grant, (deps.now ?? (() => Date.now()))())) {
      return asGrantAuthContext(token, grant);
    }
  }

  throw new Error("Unauthorized");
}
