# Scraping Virtualized or Infinite Lists

Many feeds render only visible rows (virtualized list) or load more on scroll (infinite scroll). To get a full set of items:

## Strategy

1. **Identify the scrollable container** — Often a div with `overflow: auto` or `overflow-y: scroll` and a fixed height. If not obvious, use the main feed container or `window`/`document.body`.
2. **Scroll to the end** repeatedly (e.g. set `scrollTop = scrollHeight - clientHeight` or call `scrollIntoView` on the last item or feed root).
3. **Wait** between scrolls (e.g. 200–500 ms) so the page can render new nodes.
4. **Re-query** the list (e.g. same `querySelectorAll`), parse visible items, and merge into a **map keyed by a unique id** (so the same item isn’t counted twice when DOM is reused).
5. **Stop** when:
   - No new items appear for N consecutive passes, or
   - You’ve reached a boundary (e.g. oldest date), or
   - A maximum pass count is reached (safety).

## Ordering

- Virtualized lists often use `position: absolute` with `top: Npx`. Sort nodes by vertical position (e.g. `getBoundingClientRect().top + window.scrollY` or the `top` style) before assigning section headers or dates to rows.
- If the list is flat in the DOM, sort by a visible order (e.g. index or position) so the final array order is consistent.

## Example loop (pseudocode)

```ts
const rowByKey = new Map();
let idlePasses = 0;
const maxIdlePasses = 5;

for (let pass = 0; pass < maxPasses; pass++) {
  const beforeSize = rowByKey.size;
  const nodes = document.querySelectorAll("[data-qa-type='feed-item']");
  sortByPosition(nodes);
  for (const node of nodes) {
    const row = parseRow(node);
    if (row) rowByKey.set(row.uniqueKey, row);
  }
  if (rowByKey.size === beforeSize) idlePasses++; else idlePasses = 0;
  if (idlePasses >= maxIdlePasses) break;
  scrollContainer.scrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
  await wait(300);
}
return Array.from(rowByKey.values());
```

## Finding the scrollable element

- Walk up from the feed root with `getComputedStyle(el)`: if `overflowY` is `auto` or `scroll` and `scrollHeight > clientHeight`, that element is scrollable.
- Fallback: use `window` and `window.scrollTo(0, document.body.scrollHeight)` if the whole page scrolls.
