# Ethics and Compliance for Extension Scraping

Guidelines to keep scraping responsible and compliant. Aligned with [journalism web-scraping ethical considerations](https://skills.sh/jamditis/claude-skills-journalism/web-scraping).

## Terms of Service and robots.txt

- **Check the site’s ToS** for clauses about automated access, scraping, or use of data. When in doubt, treat “no scraping” or “no automation” as a hard constraint.
- **Always check robots.txt** before scraping a site. Browser extensions act as the user’s browser, but it’s good practice to avoid paths or patterns disallowed for crawlers when your use case is similar (bulk harvesting).
- **Prefer official APIs** when the site offers them (e.g. OAuth + REST API). Use scraping only when no API exists or the user explicitly needs data from the live UI (e.g. “import my bank transactions from the website I’m viewing”).

## Rate limits and delays

- **Respect rate limits** and add delays between scrolls, detail-panel opens, and any API or page requests. 200–500 ms between actions is a reasonable minimum.
- **Don’t hammer the page**: avoid tight loops; use exponential backoff on retries if you implement them.
- **Limit scope**: cap the number of items or pages (e.g. max rows, max scroll passes) so a single run doesn’t run indefinitely.
- **User-initiated**: run scraping only when the user explicitly starts it (e.g. “Import” on a known tab). Don’t scrape in the background on tabs the user didn’t choose for that action.

## User consent and transparency

- **Don’t scrape personal data without consent.** Scraping should be **user-initiated** and, where possible, on a **page the user has open** (e.g. “Import from this page”). Avoid silently scraping many tabs or sites.
- **Explain** in the UI or docs what data is read (e.g. “We read transaction list and details from this page to import into your account”). Don’t collect or send data beyond what the feature needs.

## Cache and redundant requests

- **Cache responses** (or extraction results) when appropriate to avoid redundant requests. Use a short-lived cache keyed by URL/params or session so repeated “Import” on the same page doesn’t re-scrape unnecessarily.

## Identify and blocking signals

- **Identify yourself** with a descriptive extension name and purpose in the store listing and docs. Requests from the extension use the user’s browser context; no need to spoof User-Agent.
- **Stop if you receive explicit blocking signals**: when poison-pill detection finds CAPTCHA, rate limit (e.g. 429), or “access denied”, stop and report to the user instead of retrying in a tight loop.

## Data minimization

- **Extract only what’s needed** for the feature (e.g. date, amount, merchant, id). Don’t log or store full HTML, unnecessary PII, or unrelated fields.
- **Storage and transmission**: if you send extracted data to a backend, use secure channels and avoid retaining raw page content longer than necessary. Prefer hashes or minimal identifiers for deduplication when possible.

## Security

- **host_permissions**: request only the origins you actually scrape. Avoid `<all_urls>` unless the extension’s purpose requires it.
- **Injected code**: the function passed to `executeScript` runs in the page context. Don’t inject secrets or tokens; pass only non-sensitive configuration (e.g. date range). Receive results in the background and process them there.
