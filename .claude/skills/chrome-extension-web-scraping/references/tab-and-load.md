# Tab Selection and Page Load

Ensuring you scrape the right tab and only after the page is ready.

## Choosing the tab

- **User’s current tab**: `chrome.tabs.query({ active: true, lastFocusedWindow: true })` → take the first result. Check `tab.url` against the expected origin/path before injecting.
- **Navigate first**: If the correct page isn’t open, use `chrome.tabs.update(tabId, { url: targetUrl })` and then wait for load before calling `executeScript`.

## Waiting for load

- **Tab status**: Listen to `chrome.tabs.onUpdated(tabId, changeInfo)` and when `changeInfo.status === "complete"`, the main document has loaded. Note: SPAs may still be loading data after that.
- **Practical approach**: After `status === "complete"`, either:
  - Wait for a **known DOM node** (e.g. the feed container) with a short polling loop and timeout, or
  - Use a **short delay** (e.g. 1–2 s) if the target page consistently renders the list by then.
- **Timeout**: Always cap the wait (e.g. 15–30 s); on timeout, fail with a clear message (“Page did not load in time” or “Feed not found”).

## Example: wait for tab load (background)

```ts
function waitForTabLoad(tabId: number, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = (id: number, changeInfo: { status?: string }) => {
      if (id !== tabId) return;
      if (changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Page load timeout."));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      }
    }).catch(() => {});
  });
}
```

Use after `chrome.tabs.update(tabId, { url })` before calling `chrome.scripting.executeScript`.
