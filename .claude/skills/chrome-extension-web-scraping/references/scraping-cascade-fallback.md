# Scraping Cascade and Fallback Strategies

Implement multiple extraction strategies with automatic fallback. **Prefer undocumented APIs over DOM** when the target loads data via XHR/fetch (discover during Playwright investigation). Try API first, then DOM (list-only, then with detail panels). Inspired by [journalism web-scraping patterns](https://skills.sh/jamditis/claude-skills-journalism/web-scraping).

## Why cascade in an extension

- **API over DOM**: If you discovered an API during investigation (see [investigation-with-playwright.md](investigation-with-playwright.md)), use it first; fall back to DOM when the API fails or isn’t available.
- **DOM changes**: Selectors break after site redesigns; a fallback selector or parsing path can still succeed.
- **Progressive enhancement**: List-only DOM is faster; if the feature needs detail (e.g. line items, MCC), fall back to opening detail panels.
- **Debugging**: Track which method succeeded (`method: 'api' | 'list_only' | 'with_detail_panels'`) so you can log or show it and tune strategy order.

## Pattern: try strategies in order (API first)

```ts
type ExtractResult = { rows: Row[]; method: string };

async function extractWithCascade(tabId: number, options: Options): Promise<ExtractResult> {
  const strategies: Array<() => Promise<ExtractResult | null>> = [
    () => tryPageApi(tabId, options),      // first: use discovered API
    () => tryListOnly(tabId, options),     // fallback: DOM list only
    () => tryWithDetailPanels(tabId, options),
  ];

  for (const tryStrategy of strategies) {
    const result = await tryStrategy();
    if (result && result.rows.length > 0) return result;
  }

  throw new Error("All extraction strategies failed.");
}
```

- **Page API (first)**: Inject a function that calls `fetch(apiUrl, { credentials: 'include' })` with the URL/params discovered during investigation; return parsed JSON. Use when the target loads data via XHR/fetch (see [undocumented-apis.md](undocumented-apis.md)).
- **List-only**: Inject a function that parses the visible feed/list in the DOM. No clicks, no modals. Fallback when no API or API failed.
- **With detail panels**: Same list parsing, then open each row’s detail (click), wait for panel, scrape, close. Use when you need fields only present in the detail view.

## When to stop trying

- **Success**: A strategy returns a result that passes minimal validation (e.g. non-empty rows, required fields present).
- **Poison pill**: If the first strategy detects a paywall/CAPTCHA/login (see [poison-pill-detection.md](poison-pill-detection.md)), you can short-circuit and return a structured failure instead of trying heavier strategies.
- **Resource limits**: Cap total time or number of detail-panel opens so the cascade doesn’t run too long.

## Tracking the method

Include `method` (or `extraction_method`) in the connector output or in telemetry so you can:
- Prefer the lightest strategy that works in production.
- Detect when the primary strategy starts failing and the fallback is always used (signal to update selectors).
