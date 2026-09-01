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
  isAuthUserAllowed?(authUserId: string): Promise<boolean>;
  now?: () => number;
}

/**
 * Whether a `revoked_at` column says the credential is revoked.
 *
 * Presence, not parseability. `timestamptz` accepts `infinity` and `-infinity`, which are
 * perfectly valid values that `new Date()` cannot read -- so asking `toIsoOrNull` whether this
 * is a date answered "no" and the credential counted as live. The authority trigger forbids
 * clearing a revocation to NULL, so writing one of those in its place was the way around it: the
 * row reads as revoked everywhere a person looks, and authenticates anyway.
 */
export function isRevoked(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

/**
 * Whether the grant row itself is still live. This answers only "was it revoked or has it
 * expired" -- whether the person who issued it may still import is a separate question, asked
 * of `allowed_users` at every use. See `resolveAuth`.
 */
export function isGrantUsable(grant: Record<string, unknown>, nowMs = Date.now()): boolean {
  if (isRevoked(grant.revoked_at)) return false;

  // No expiry means the grant lives until it is revoked; that is the point of it. But a value
  // that is present and unreadable is not "no expiry" -- `infinity` reaches toIsoOrNull as null
  // the same way it does above, and reading that as "lives forever" is the generous answer where
  // the safe one costs nothing.
  if (grant.expires_at !== null && grant.expires_at !== undefined) {
    const expiresAt = toIsoOrNull(grant.expires_at);
    if (!expiresAt) return false;
    if (new Date(expiresAt).getTime() <= nowMs) return false;
  }

  return true;
}

export function isSessionUsable(session: Record<string, unknown>, nowMs = Date.now()): boolean {
  if (isRevoked(session.revoked_at)) return false;

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
  //
  // Both dependencies are required, and their absence refuses the grant rather than waving it
  // through: a caller that wires the lookup but forgets the allowlist check would otherwise
  // reopen the hole below in silence, and a green test suite would not notice.
  if (options.allowGrant && deps.getGrantByToken && deps.isAuthUserAllowed) {
    const grant = await deps.getGrantByToken(token);
    if (grant && isGrantUsable(grant, (deps.now ?? (() => Date.now()))())) {
      // A grant carries the authority of the person who issued it, so it can only be as live
      // as that person's own access. Take that access away and the grant goes with it --
      // otherwise revoking someone from `allowed_users` would leave every extension they ever
      // set up importing on their behalf, with nothing in the app able to stop it. The user
      // path re-checks the allowlist on every call; this is the same check, one hop further
      // out.
      const issuer = normalizeText(grant.created_by_auth_user_id);
      if (issuer && (await deps.isAuthUserAllowed(issuer))) {
        return asGrantAuthContext(token, grant);
      }
    }
  }

  throw new Error("Unauthorized");
}
