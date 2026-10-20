/** What the instance handed back at the end of a Google sign-in. */
export type OAuthCallback = { code: string } | { error: string };

/**
 * Read the authorisation code, or the reason there is none, out of the URL the sign-in sheet closed
 * on.
 *
 * The client signs in with PKCE, so the instance redirects with `?code=` and the session is minted by
 * exchanging that code with the verifier this app kept — a code intercepted on the way back is
 * useless without it. GoTrue reports a refusal (the allowlist turning someone away, the user
 * cancelling at Google) as `error_description` in the query or, for some errors, in the fragment,
 * so both are read. Kept apart from the screen so it can be tested without a React Native runtime.
 */
export function parseOAuthCallback(url: string): OAuthCallback {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `The sign-in returned an address that is not a URL: ${url}` };
  }
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const error =
    parsed.searchParams.get("error_description") ??
    fragment.get("error_description") ??
    parsed.searchParams.get("error") ??
    fragment.get("error");
  if (error) {
    return { error };
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    return { error: "The sign-in finished without an authorisation code." };
  }
  return { code };
}
