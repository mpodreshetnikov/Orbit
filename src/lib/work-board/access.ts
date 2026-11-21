/** Strict ACL for the live work board (Lead 2026-11-21): Maxim only, not full allowed_users. */
export const WORK_BOARD_ALLOWED_EMAIL = "mpodreshetnikov@gmail.com";

export type WorkBoardAccess = "not-found" | "unauthenticated" | "forbidden" | "allow";

export function isWorkBoardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.ORBIT_WORK_BOARD_ENABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isWorkBoardEmailAllowed(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  return email.trim().toLowerCase() === WORK_BOARD_ALLOWED_EMAIL;
}

export function resolveWorkBoardAccess(input: {
  email: string | null | undefined;
  env?: NodeJS.ProcessEnv;
}): WorkBoardAccess {
  if (!isWorkBoardEnabled(input.env)) {
    return "not-found";
  }
  if (!input.email) {
    return "unauthenticated";
  }
  if (!isWorkBoardEmailAllowed(input.email)) {
    return "forbidden";
  }
  return "allow";
}
