# Poison Pill Detection

Detect paywalls, anti-bot pages, login gates, and other blocking conditions **before** treating extraction as successful. Fail fast with a clear reason so the UI can show “Sign in required” or “Article limit reached” instead of “No data.” Pattern adapted from [journalism web-scraping methodology](https://skills.sh/jamditis/claude-skills-journalism/web-scraping).

## When to run detection

- **Before extraction**: After the tab has loaded, run a lightweight check (e.g. inject a function that returns `document.body.innerText.slice(0, 5000)` or checks for known selectors). Run poison-pill detection on that snippet in the background.
- **After extraction**: If the extracted content is suspiciously empty or short (e.g. &lt; 100 chars from a page that should have a long article or many rows), run detection on the full page text or on the URL.

## What to detect

| Type | Typical signals | Action |
|------|-----------------|--------|
| **Paywall** | “Subscribe to continue”, “article limit reached”, “become a member”, short body from known paywall domain | Return structured error: `{ blocked: true, reason: 'paywall' }` |
| **CAPTCHA / bot check** | “Verify you are human”, “captcha”, “robot verification” | Same; optionally prompt user to complete in tab and retry |
| **Rate limit** | “Too many requests”, “429”, “slow down” in body or status | Back off; show “Try again later” |
| **Cloudflare / DDoS** | “Checking your browser”, “Cloudflare”, “please wait while we verify” | Same as CAPTCHA |
| **Login required** | “Sign in to continue”, “log in required”, “create an account” | Prompt user to log in and retry |
| **Not found** | HTTP 404 or “page not found” in content | Return not-found; don’t treat as success |

## Implementation options

**Option A — Injected sniff:** The injected extraction function returns both data and a small page snapshot (e.g. `bodyTextSample: document.body.innerText.slice(0, 3000)`). Background runs regex/pattern checks on `bodyTextSample` and known paywall domains (from URL). If a poison pill is detected, discard the data and return a structured failure.

**Option B — Separate inject:** Run a first injection that only does detection (query a few selectors or return `document.body.innerText.slice(0, 5000)`), then in background run the detector. If clear, run the real extraction inject.

## Pattern / regex examples

```ts
const POISON_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'paywall', pattern: /subscribe to continue|article limit reached|become a member|sign up to read/i },
  { type: 'captcha', pattern: /verify you are human|captcha|robot verification|prove you're not a robot/i },
  { type: 'rate_limit', pattern: /too many requests|rate limit exceeded|slow down|\b429\b/i },
  { type: 'cloudflare', pattern: /checking your browser|cloudflare|ddos protection|please wait while we verify/i },
  { type: 'login_required', pattern: /sign in to continue|log in required|create an account/i },
];

function detectPoisonPill(url: string, bodyText: string, statusCode?: number): { detected: boolean; type?: string } {
  if (statusCode === 429) return { detected: true, type: 'rate_limit' };
  if (statusCode === 404) return { detected: true, type: 'not_found' };
  const lower = bodyText.toLowerCase();
  for (const { type, pattern } of POISON_PATTERNS) {
    if (pattern.test(lower)) return { detected: true, type };
  }
  return { detected: false };
}
```

## Known paywall domains

Maintain a small set of domains where short content is suspicious (e.g. nytimes.com, wsj.com). If `url` matches and extracted content length is below a threshold, treat as paywall unless you have a positive signal that the full content was returned.

## UX

- Map `reason` to user-facing messages: “This page requires a subscription”, “Please complete the security check”, “Sign in to this site and try again”, “Too many requests; try again later.”
- When appropriate, offer “Open page” so the user can log in or solve CAPTCHA and then retry the import.
