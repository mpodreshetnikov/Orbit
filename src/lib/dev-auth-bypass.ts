const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_DEV_AUTH_BYPASS_EMAIL = "dev@example.com";

function isNonProductionRuntime(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function isDevAuthBypassEnabled(): boolean {
  return isNonProductionRuntime() && process.env.DEV_AUTH_BYPASS_ENABLED === "1";
}

export function getDevAuthBypassAutoLoginEmail(): string | null {
  if (!isDevAuthBypassEnabled() || process.env.DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED !== "1") {
    return null;
  }

  const candidate = (process.env.DEV_AUTH_BYPASS_DEFAULT_EMAIL || DEFAULT_DEV_AUTH_BYPASS_EMAIL)
    .trim()
    .toLowerCase();

  if (!EMAIL_REGEX.test(candidate)) {
    return null;
  }

  return candidate;
}
