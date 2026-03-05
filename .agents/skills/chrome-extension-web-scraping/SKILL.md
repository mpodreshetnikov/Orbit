---
name: chrome-extension-web-scraping
description: Scrape and extract data from web pages using a Chrome extension (Manifest V3). Use when building or extending content scripts, injected scripts, DOM extraction, virtualized lists, modals, connector-style scrapers, scraping cascade/fallback, poison-pill detection, or undocumented API discovery. Prefer undocumented APIs over DOM when available. Use Playwright CLI (playwright-cli skill) to investigate the scrape target (including sign-in and API discovery) before production implementation.
---

# Web Scraping with Chrome Extension

Use this skill when implementing or extending page scraping inside a Chrome extension: DOM extraction, content scripts, injected functions via `chrome.scripting`, handling virtualized lists and modals, and respecting permissions and ethics.

**Prefer undocumented APIs over DOM parsing** when the target page loads data via XHR/fetch: use the page’s API from the extension (injected fetch with cookies) as the first strategy in your cascade; use DOM as fallback.

## Investigate the Target Before Production

Before implementing or changing a connector, **investigate the scrape target** using **Playwright CLI**. Use the **playwright-cli skill** for commands and workflows (open, goto, snapshot, network, run-code, state-save). Do not go straight to extension code.

1. **Open the target URL** in Playwright (`playwright-cli open <url>`), take a snapshot, and inspect DOM for selectors and structure.
2. **Sign-in:** Many sites (banking, dashboards) require the user to be signed in. **Ask the user to sign in during investigation** if the page shows a login form or “Sign in to continue.” After they log in in the Playwright window, continue (e.g. `playwright-cli state-save auth.json` if you want to reuse auth), then trigger the actions that load the data.
3. **Discover APIs:** Trigger the actions that load the data (e.g. open list, scroll, open detail). Use `playwright-cli network` or `playwright-cli run-code` to capture XHR/fetch requests and identify API URL, method, params, and that cookies are required. Prefer implementing that API in the extension first; use DOM as fallback.
4. **Document:** Note in special discovery document API details (for API-first connector) and/or DOM selectors and flow (for DOM fallback). Then implement the extension connector with cascade: API → DOM using this document.

See [references/investigation-with-playwright.md](references/investigation-with-playwright.md).

## When To Use

- **Investigating a new scrape target** — use Playwright CLI (playwright-cli skill) to open the page, have the user sign in if required, discover XHR/fetch APIs and DOM structure, then implement the extension connector.
- Adding or changing scrapers that run inside a Chrome extension (content scripts or injected scripts).
- Designing DOM selectors and extraction logic for third-party or first-party pages.
- Handling infinite scroll, virtualized lists, or modals/dialogs during scraping.
- Defining extension permissions (host_permissions, scripting) for scraping targets.
- Deciding between content scripts and `chrome.scripting.executeScript` for extraction.
- Integrating API-call parsing into a connector (injected fetch first, DOM fallback).

## Architecture Overview

1. **Background (service worker)** — Orchestrates: which tab to scrape, when to inject, and what to do with results. Uses `chrome.tabs` and `chrome.scripting`.
2. **Content script** (optional) — Runs in page context; can communicate with background via `chrome.runtime.sendMessage`. Use when you need long-lived page access or two-way messaging.
3. **Injected function** — Code passed to `chrome.scripting.executeScript` runs in the **page’s JavaScript context** (same as the page). It can use `document`, `window`, and page globals. It cannot use Chrome extension APIs. Return only [JSON-serializable](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-ScriptInjection) values.

For one-off extraction where the user has already opened the target page, **injected scripts** are usually best: full DOM and page JS, no content script required on every load.

## Core Flow: Inject and Extract

```ts
// In background (or a connector module):
const [result] = await chrome.scripting.executeScript({
  target: { tabId: activeTab.id },
  func: extractDataInPage,
  args: [{ option: "value" }], // must be JSON-serializable
});

const data = result?.result; // extraction result
```

- `func` is a **function** that will be serialized and run in the page. It must be self-contained (no closure over extension code). All inputs come from `args`.
- `args` are passed as arguments to `func`. Only values that can be serialized to JSON (no functions, no DOM nodes).
- Return value of `func` must be JSON-serializable (plain objects, arrays, primitives).

## Permissions and Hosts

- **`scripting`** — Required for `chrome.scripting.executeScript`.
- **`activeTab`** — Optional; allows scripting on the current tab without listing the host in `host_permissions` when the user invokes the extension (e.g. via action).
- **`host_permissions`** — List every origin the extension will inject into or read from (e.g. `"https://www.example.com/*"`). Required for scripting on specific sites without user gesture.

See [references/manifest-permissions.md](references/manifest-permissions.md).

## DOM Extraction Patterns

- Prefer **stable selectors**: `data-*` attributes, semantic roles, stable class names. Avoid fragile class names that minifiers change.
- **Normalize text**: trim, collapse whitespace, replace `\u00a0` with space before parsing.
- **Parse numbers/dates** in a defensive way: validate and fall back to `null`; handle locale (e.g. comma vs dot decimals, local date formats).
- **Deduplicate** by a stable key (e.g. external_id or a hash of meaningful fields) when the same item can appear in list and detail or after scroll.

See [references/dom-extraction-patterns.md](references/dom-extraction-patterns.md).

## Virtualized / Infinite Lists

Many feeds render only visible items (virtualized lists). To scrape the full list:

1. **Scroll** the scrollable container (or window) to the end repeatedly.
2. **Wait** between scrolls (e.g. 200–500 ms) so the page can render new nodes.
3. **Re-query** the DOM each pass and merge new items into a map keyed by a unique id.
4. **Stop** when no new items appear for N passes or when a date/range boundary is reached.

Use a single scrollable root (e.g. a feed container) and set `scrollTop` or call `scrollIntoView` consistently. See [references/virtualized-lists.md](references/virtualized-lists.md).

## Modals and Detail Panels

To scrape content that appears in modals or side panels (e.g. “transaction detail”):

1. **Trigger** the detail view (e.g. click a row).
2. **Wait** for the panel/dialog to appear (poll for a selector or use a short delay).
3. **Query** the detail DOM (e.g. `document.querySelector('[data-qa-type="detail-panel"]')`), extract fields, then close the modal if needed (e.g. Escape or close button).
4. **Match** detail data back to the list row by a stable key (amount + title, or id).

Avoid leaving many modals open; close after reading to reduce memory and avoid overlay stacking issues. See [references/modals-and-dialogs.md](references/modals-and-dialogs.md).

## Tab and Load Readiness

- Use **`chrome.tabs.update(tabId, { url })`** then wait for the tab to finish loading before injecting.
- Wait for load: listen to **`chrome.tabs.onUpdated`** with `changeInfo.status === "complete"`, or use a timeout and retries. Do not inject on `document_idle` only; for SPA navigations, the feed may load later — prefer waiting for a known DOM node or a short delay after `complete`.

See [references/tab-and-load.md](references/tab-and-load.md).

## Scraping Cascade and Fallback

Implement **multiple extraction strategies** with automatic fallback. **Prefer undocumented APIs over DOM** when available (discover them during Playwright investigation). Order:

1. **Page API (first)** — If the target loads data via XHR/fetch (found during investigation), call that API from the page context (injected `fetch(..., { credentials: 'include' })`) as the **first** strategy. More reliable and stable than DOM.
2. **List-only DOM** — Parse the visible feed/list in the DOM; no clicks, no modals. Fallback when no API or API fails.
3. **With detail panels** — Same list plus open each row’s detail (click → wait for panel → scrape → close) when you need fields only in the detail view.

Track which method succeeded (`method: 'api' | 'list_only' | 'with_detail'`) for debugging and tuning. See [references/scraping-cascade-fallback.md](references/scraping-cascade-fallback.md).

## Poison Pill Detection

Before treating extraction as success, **detect blocking conditions** so the UI can show a clear message instead of “No data”:

- **Paywall** — “Subscribe to continue”, “article limit reached”; short content from known paywall domains.
- **CAPTCHA / bot check** — “Verify you are human”, “captcha”.
- **Rate limit** — “Too many requests”, HTTP 429.
- **Cloudflare / DDoS** — “Checking your browser”, “please wait”.
- **Login required** — “Sign in to continue”, “log in required”.

Run detection on a small page text snapshot (e.g. first 3–5k chars of `document.body.innerText`) returned from an inject, or after extraction if content is suspiciously empty. Return a structured failure (`{ blocked: true, reason: 'paywall' }`) and map to user-facing copy. See [references/poison-pill-detection.md](references/poison-pill-detection.md).

## Undocumented APIs (Preferred Over DOM)

**Prefer using the page’s own XHR/fetch APIs over DOM parsing** when the target loads data via network requests. Discover APIs during **Playwright investigation** (e.g. `playwright-cli network` or `run-code` to capture requests after triggering the data load). Then integrate into the extension:

- **In the connector:** Inject a function that runs in the page and calls `fetch(apiUrl, { credentials: 'include' })` with the discovered URL and params; return the parsed JSON. The background receives the result from `executeScript`. Try this as the **first** strategy in the cascade; fall back to DOM if the API returns 403, empty, or errors.
- **Investigation via Playwright:** Open the target in Playwright, have the user sign in if required, trigger the action that loads the data (e.g. open list, scroll), then inspect network (or use `run-code` to collect request URLs/methods/params). Document the API and implement the injected fetch in the connector.

See [references/undocumented-apis.md](references/undocumented-apis.md) and [references/investigation-with-playwright.md](references/investigation-with-playwright.md).

## Error Handling and Robustness

- If **no active tab** or tab is not the expected origin, throw a clear error (“Open Example.com in this tab and try again”).
- If **injection returns null** or missing structure, throw (“Unable to extract data from this page”).
- **Timeouts**: use timeouts for “wait for element” and for total extraction; fail cleanly instead of hanging.
- **Partial results**: when possible, return what was collected and report failures (e.g. “N items extracted, M rows failed detail”).
- **Poison pills**: when detection runs, return a structured error (e.g. `reason: 'login_required'`) so the UI can prompt the user to sign in and retry.

## Ethics and Compliance

- **Terms of Service**: Check the site’s ToS and robots.txt. Prefer official APIs when available.
- **Rate and load**: avoid tight loops; use delays between scrolls and requests so the page and server are not overloaded.
- **User consent**: scraping should be user-initiated (e.g. “Import” in an open tab the user chose). Do not scrape in the background without user action on that page.
- **Data minimization**: extract only what the feature needs; do not log or store unnecessary PII.
- **Cache**: avoid redundant requests or re-scrapes when the same data was recently fetched (e.g. session or short-lived cache by URL/params).
- **Identify**: in store listing or docs, identify the extension and its purpose; when calling discovered APIs, the request comes from the user’s browser (no need to spoof User-Agent).
- **Stop on blocking**: if you detect explicit blocking (CAPTCHA, rate limit, login), stop and report; do not retry in a tight loop.

See [references/ethics-and-tos.md](references/ethics-and-tos.md).

## References

- [references/investigation-with-playwright.md](references/investigation-with-playwright.md) — Use Playwright CLI (playwright-cli skill) to investigate target before production; sign-in and API discovery.
- [references/manifest-permissions.md](references/manifest-permissions.md) — Manifest V3 permissions and host_permissions for scraping.
- [references/content-vs-scripting.md](references/content-vs-scripting.md) — When to use content scripts vs executeScript.
- [references/dom-extraction-patterns.md](references/dom-extraction-patterns.md) — Selectors, normalization, parsing, deduplication.
- [references/virtualized-lists.md](references/virtualized-lists.md) — Scrolling and merging items from virtualized feeds.
- [references/modals-and-dialogs.md](references/modals-and-dialogs.md) — Opening detail views and scraping modal content.
- [references/tab-and-load.md](references/tab-and-load.md) — Tab selection and waiting for page load.
- [references/scraping-cascade-fallback.md](references/scraping-cascade-fallback.md) — API-first cascade, then DOM fallback.
- [references/poison-pill-detection.md](references/poison-pill-detection.md) — Detecting paywalls, CAPTCHA, login, rate limits.
- [references/undocumented-apis.md](references/undocumented-apis.md) — Discovering APIs via Playwright, integrating fetch into the extension.
- [references/ethics-and-tos.md](references/ethics-and-tos.md) — ToS, rate limiting, consent, cache, and blocking signals.
