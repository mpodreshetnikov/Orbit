# Discovering and Using Undocumented APIs

**Prefer undocumented APIs over DOM parsing** when the target page loads data via XHR/fetch: structured JSON, fewer breakages when the UI changes. Discover APIs during investigation (e.g. with Playwright CLI), then integrate them into the extension as the **first** strategy in the cascade; use DOM as fallback. Pattern inspired by [journalism web-scraping: undocumented APIs](https://skills.sh/jamditis/claude-skills-journalism/web-scraping) and [“Finding Undocumented APIs,” Inspect Element](https://inspectelement.com/).

## Investigating APIs through Playwright

Before implementing the extension connector, **investigate** the target with **Playwright CLI** and the [playwright-cli skill](../../playwright-cli/SKILL.md):

1. **Open the target URL:** `playwright-cli open https://example.com/operations`
2. **Sign-in if required:** Many sites need the user to be logged in. **Ask the user to sign in** in the Playwright window; after login, continue (optionally `playwright-cli state-save auth.json`).
3. **Trigger the action** that loads the data (e.g. navigate to list, scroll, open a detail).
4. **Capture requests:**
   - **playwright-cli network** — inspect captured XHR/fetch in the session.
   - **playwright-cli run-code** — run a script that listens to `page.on('request')` (or `response`), filters by `resourceType === 'xhr' || 'fetch'`, and returns an array of `{ url, method, postData? }` (and optionally a sample response) so you can document the API.
5. **Document:** URL, method, query params, body shape, and that cookies are required. Use this to implement the injected fetch in the connector.

See [investigation-with-playwright.md](investigation-with-playwright.md) for the full investigation workflow.

## Finding undocumented APIs (manual / DevTools)

If not using Playwright for investigation:

1. **Open DevTools** on the target page (F12 or right-click → Inspect).
2. **Network tab** → filter by **Fetch/XHR** (or “XHR” only) to see API calls.
3. **Trigger the action** that loads the data you need (e.g. open operations list, scroll, open a detail).
4. **Inspect the request**: URL, method (GET/POST), query params, request body, headers (especially auth/cookies).
5. **Copy as cURL** (right-click request → Copy → Copy as cURL) for replay or conversion.
6. **Strip down**: Remove unnecessary headers/cookies to find the minimal set required (often Cookie or Authorization). Test with different parameter values (e.g. date range, limit).

## Integrating API calls into the extension

**Recommended: Injected function that fetches.** Run the API call in the **page context** so the user’s cookies are sent automatically:

1. In the **connector** (background), call `chrome.scripting.executeScript` with a **func** that receives the API URL and params (from your investigation) and runs inside the tab.
2. The injected function calls `fetch(apiUrl, { credentials: 'include' })` (and adds query params or body as discovered), then returns `await response.json()` (or a serializable subset). The return value must be JSON-serializable.
3. The connector receives `result?.result` from `executeScript`, normalizes it to your connector output shape (e.g. rows, windowTo, parsedThroughAt), and returns. If the API fails (403, empty, network error), **fall back to DOM** in your cascade (see [scraping-cascade-fallback.md](scraping-cascade-fallback.md)).

```ts
// Injected function (runs in page; pass apiUrl and params via args):
async function fetchOperationsFromApi(apiUrl: string, params: Record<string, string>) {
  const url = new URL(apiUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  return data; // must be JSON-serializable
}
```

**Cascade order:** In the connector’s `parse()`, try the API first (inject the fetch function). If it returns null or invalid data, call the DOM-based extraction (list-only or with detail panels) as fallback.

## Caveats

- **Auth**: APIs often require the user to be logged in (session cookie). Only call when the user has that tab open and has signed in.
- **Expiring tokens**: Some sites use short-lived tokens in headers. If you copy a token from DevTools, it may expire; prefer using `credentials: 'include'` from the page context so the browser sends current cookies.
- **CORS**: If the API is on the same origin as the page, fetch from the page context has no CORS issue. Calling from the background to a different origin may hit CORS unless the API allows your extension origin (rare); so prefer injection for fetch.
- **Rate limits**: Same as DOM scraping: add delays and respect response headers (e.g. Retry-After on 429).

## When to prefer API over DOM (default)

**Prefer API over DOM** whenever the target loads the data via XHR/fetch and you can call it from the page context with cookies. Reasons:

- List/data is loaded via XHR and the response is clean JSON.
- DOM is fragile (frequent redesigns); the API is often more stable.
- You may get fields that aren’t visible in the current UI but are present in the API response.

Always implement a **DOM fallback** in the cascade: when the API is undocumented it may change or return 403/empty, so the connector should fall back to DOM extraction (list-only or with detail panels) if the API strategy fails.
