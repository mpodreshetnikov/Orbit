# Investigating the Scrape Target with Playwright CLI

**Before** implementing or changing extension scraping, **investigate the target page** using Playwright CLI and the [playwright-cli skill](../../playwright-cli/SKILL.md). This reveals DOM structure, required sign-in, and any XHR/fetch APIs you can use instead of DOM parsing.

## Why investigate first

- **Undocumented APIs are preferred over DOM parsing** when available: structured JSON, fewer breakages on UI changes. Investigation shows whether the page loads data via XHR/fetch.
- **Many sites require sign-in.** Discovering this during investigation lets you ask the user to sign in once (e.g. in the Playwright session) and then capture API requests or DOM after auth.
- **Stable selectors and flow:** Snapshots and interaction in Playwright show the real DOM (data-qa-type, roles, structure) and the order of actions (scroll, click row, wait for panel) before you encode them in the extension.

## Workflow

1. **Open the target URL** with Playwright CLI (use the playwright-cli skill for commands):
   ```bash
   playwright-cli open https://example.com/operations
   ```

2. **Sign-in when required.** Many targets (banking, dashboards) require the user to be logged in. **Ask the user to sign in during investigation** if the page shows a login form or “Sign in to continue”:
   - Leave the browser open; ask the user to complete login in the Playwright window (or use a persistent profile with saved auth).
   - After login, save state for reuse if useful: `playwright-cli state-save auth.json`.
   - Then continue: take a snapshot and trigger the actions that load the data you need.

3. **Capture DOM structure:** Take a snapshot after the data is visible:
   ```bash
   playwright-cli snapshot --filename=target-page.yaml
   ```
   Inspect the snapshot for stable selectors (e.g. `data-qa-type`, `role`, semantic tags). Note the scrollable container and list item selectors for virtualized lists, and any detail panel / modal selectors.

4. **Discover API calls:** Trigger the action that loads the data (e.g. open the list, scroll, open a detail). Then inspect network traffic:
   - **playwright-cli network** — inspect captured requests in the CLI session.
   - Or use **playwright-cli run-code** to record requests in code and return URLs/params/response sample to the agent. Example pattern:
     ```bash
     playwright-cli run-code "async page => {
       const requests = [];
       page.on('request', req => { if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') requests.push({ url: req.url(), method: req.method() }); });
       await page.reload();
       await page.waitForTimeout(3000);
       return requests.slice(-20);
     }"
     ```
   - Identify the request(s) that return the list or detail data (e.g. by URL path or response shape). Note URL, method, query params, and whether cookies are required.

5. **Document findings:** Record (for implementation):
   - Preferred path: **API** — URL, method, params, and that auth (cookies) is required; then implement API-first in the extension (injected fetch with `credentials: 'include'`).
   - Fallback: **DOM** — selectors for list, scroll container, detail panel, and any sign-in gate (for poison-pill detection).

## Integrating into the extension

- If you found an API: implement an **injected function** that calls `fetch(apiUrl, { credentials: 'include' })` with the discovered params; use it as the **first strategy** in the connector cascade (see [scraping-cascade-fallback.md](scraping-cascade-fallback.md) and [undocumented-apis.md](undocumented-apis.md)).
- If the page requires sign-in: the extension runs in the user’s browser, so the user must be logged in in that tab. Add **poison-pill detection** for “login required” and prompt the user to sign in and retry (see [poison-pill-detection.md](poison-pill-detection.md)).
- Use the DOM selectors and flow (scroll, click, wait for panel) from the investigation as the **DOM fallback** in the cascade.

## Playwright skill reference

Use the **playwright-cli** skill for the exact commands: `playwright-cli open`, `playwright-cli goto`, `playwright-cli snapshot`, `playwright-cli network`, `playwright-cli run-code`, `playwright-cli state-save` / `state-load`, and interaction commands (click, fill, etc.). See [playwright-cli SKILL](../../playwright-cli/SKILL.md) in this repo.
