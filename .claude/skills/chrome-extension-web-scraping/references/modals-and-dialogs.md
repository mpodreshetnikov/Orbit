# Scraping Modals and Detail Panels

Content that appears in modals, side panels, or expandable detail views often has to be opened before it’s in the DOM.

## Flow

1. **Trigger** the detail view (e.g. click a row, click “Details”).
2. **Wait** for the panel/dialog to appear. Options:
   - Poll for a known selector (e.g. `[data-qa-type="detail-panel"]`) with a short interval and timeout.
   - Use a fixed short delay (e.g. 200–400 ms) if the UI is fast and consistent.
3. **Read** the DOM inside the modal/panel (query within the modal root, not the whole document, to avoid mixing with list content).
4. **Close** the modal if needed (Escape key, or click a close button) so the next row can be opened without stacking or focus issues.
5. **Match** the detail data back to the list row (e.g. by amount + title, or by an id from the URL or DOM).

## Waiting for an element

- **MutationObserver** on `document.body` (childList + subtree) and resolve when the selector appears; clear observer and timeout on first match.
- **Timeout**: always set a max wait (e.g. 3–5 s) so a missing or broken UI doesn’t hang the scraper.

## Closing the modal

- Prefer a **close control**: `[aria-label="Close"]`, `[data-qa-type*="close"]`, or a visible “X” button. Click it, then optionally wait for the element to be removed from the DOM.
- Fallback: dispatch `keydown` with `key: "Escape"` and `bubbles: true` on `document`.

## Nested content (e.g. “View all” in detail)

- If the detail shows only a preview and “View all” opens another overlay, click “View all”, wait for the new dialog, then scrape from that dialog. Close it before moving to the next row.
- Reuse the same “wait for selector” and “close” helpers for consistency.

## Matching detail to list row

- Build a **signature** from detail (e.g. title + amount + date) and compare to the list row’s signature to avoid applying detail to the wrong row.
- When the page provides an operation id in the URL or DOM, use it as the primary key and match list rows by that id when available.
