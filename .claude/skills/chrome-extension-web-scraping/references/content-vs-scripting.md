# Content Scripts vs chrome.scripting.executeScript

Two ways to run code in a page: **content scripts** (declared in manifest) and **injected scripts** (via `chrome.scripting.executeScript`).

## Content script

- **Declared** in `manifest.json` under `content_scripts` with `matches` and `js` (and optionally `run_at`).
- **Runs** automatically on every page that matches `matches`.
- **Context**: Isolated world. It shares the DOM with the page but **not** the page’s JavaScript globals. It can use `document`, `window` (DOM), and Chrome APIs like `chrome.runtime.sendMessage`.
- **Use when**: You need long-lived presence on the page, two-way messaging with the background, or to run on many pages without a user gesture.

## Injected script (executeScript)

- **Invoked** from the background (or an offscreen document) via `chrome.scripting.executeScript({ target: { tabId }, func, args })`.
- **Runs** only when you call it (e.g. after user clicks “Import” or when background decides to scrape).
- **Context**: **Main world** (same as the page). It can use `document`, `window`, and any page JavaScript. It **cannot** use Chrome extension APIs. The `func` and its return value must be JSON-serializable (no functions, no DOM nodes in return).
- **Use when**: You need to scrape the page’s DOM (and possibly rely on page JS), run only on user action, or avoid loading a content script on every page load.

## Comparison

| Aspect | Content script | Injected (executeScript) |
|--------|----------------|---------------------------|
| When it runs | Every load of matched URLs | On demand |
| Page JS / globals | No (isolated) | Yes (main world) |
| Chrome APIs | Yes | No |
| Return value to background | Via messaging | Direct return from `func` (serializable) |
| Best for | UI overlay, messaging, always-on | One-off scraping, DOM + page JS |

## Recommendation for scrapers

- **Prefer injected scripts** for scraping: full access to page DOM and JS, no content script on every load, and you can pass options (e.g. date range) via `args` and get a single serializable result.
- Use a **content script** when the extension must react to page events or show UI (e.g. “Import” button injected into the page), and have the content script message the background; the background can then call `executeScript` with the actual extraction function.
