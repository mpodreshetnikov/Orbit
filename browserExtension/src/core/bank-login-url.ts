/**
 * Whether a bank URL is the sign-in screen rather than the account. The patterns are the ones
 * the connectors use when a run lands on the login screen (tbank-web, alfa-web); here they let
 * the widget in a tab that waits for a requested run tell "sign in first" from "signed in,
 * the run is coming", and guard the tab against closing only in the second case.
 */
export function looksLikeBankLoginUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  const normalized = url.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("/auth/login") ||
    /\/login(?:[/?#]|$)/.test(normalized) ||
    normalized.includes("redirectto=") ||
    normalized.includes("private.auth.alfabank.ru") ||
    normalized.includes("/phone_auth") ||
    normalized.includes("/passport/") ||
    normalized.includes("/cerberus")
  );
}
