# Manifest Permissions for Web Scraping

Chrome Manifest V3 permissions that affect scraping from extension background or content scripts.

## Required for injection

| Permission | Purpose |
|------------|--------|
| `scripting` | Use `chrome.scripting.executeScript` to inject and run functions in a tab. |

## Host access

| Permission | Purpose |
|------------|--------|
| `host_permissions` | Allow the extension to run scripts and access page DOM on specific origins. List each base URL you scrape (e.g. `"https://www.example.com/*"`). Without this, injection on that origin fails unless the user just clicked the extension (then `activeTab` can suffice). |

## Optional

| Permission | Purpose |
|------------|--------|
| `activeTab` | Temporary access to the current tab when the user invokes the extension (e.g. toolbar click). Use when you only scrape the tab the user has open and don’t want to declare all possible hosts. |
| `tabs` | Query and update tabs (`chrome.tabs.query`, `chrome.tabs.update`, tab URL). Needed when the scraper picks “current tab” or navigates. |
| `storage` | Persist session or config (e.g. last scrape time, user preferences). |

## Example (manifest.json)

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "tabs", "activeTab", "scripting"],
  "host_permissions": [
    "https://www.example.com/*",
    "https://*.example.com/*"
  ],
  "background": { "service_worker": "background.js", "type": "module" }
}
```

- Omit `host_permissions` for a given site if you rely only on `activeTab` and the user always invokes the extension from that tab.
- For programmatic scraping (e.g. opening tabs and injecting without a user click on that tab), you must list that origin in `host_permissions`.

## Content scripts (optional)

If you use a content script instead of (or in addition to) `executeScript`:

```json
"content_scripts": [
  {
    "matches": ["https://www.example.com/*"],
    "js": ["content-script.js"],
    "run_at": "document_idle"
  }
]
```

- `matches` must cover the pages where the content script runs.
- For scraping that runs only on user action, injection via `scripting` with `host_permissions` is often simpler than declaring content scripts on many URLs.
