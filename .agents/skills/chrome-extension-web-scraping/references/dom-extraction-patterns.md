# DOM Extraction Patterns

Reliable patterns for reading and normalizing data from the DOM in injected or content scripts.

## Selectors

- Prefer **stable** selectors: `[data-qa-type="..."]`, `[data-testid="..."]`, `[role="..."]`, or semantic elements (`article`, `table`, `thead`). Avoid class names that look minified or change with builds.
- Use **specific** selectors so small DOM changes don’t break extraction (e.g. a wrapper with a stable attribute, then children).
- If the page has **virtualized** or dynamically inserted nodes, re-query after scroll/wait; don’t assume the first query has all items.

## Text normalization

- **Trim and collapse whitespace**: replace `\u00a0` with space, then `/\s+/g` → single space, then trim.
- **Empty**: treat `""` or only-whitespace as null/empty; don’t pass empty strings as meaningful values.

```ts
function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
}
```

## Numbers and amounts

- Parse with a small helper: strip currency symbols and spaces, handle minus/plus, replace comma as decimal separator if needed, then `Number(...)`. Validate with `Number.isFinite()`.
- Return `null` on parse failure; use a single type (e.g. number) in the output contract.

## Dates and times

- Prefer **ISO 8601** for output (`toISOString()`). If the page shows relative labels (“Today”, “Yesterday”), resolve to a concrete date using the current date and a small mapping (e.g. “сегодня” → today’s date).
- If only time is visible (e.g. “14:30”), combine with a date from context (e.g. section header “15 января”) to produce a full timestamp.

## Deduplication

- Build a **stable key** per item (e.g. `external_id`, or a hash of title + amount + date + optional subtitle).
- Use a `Map<key, item>` while iterating so the same logical item (e.g. list row + detail panel) is only stored once. Prefer `external_id` when the page provides it.

## Sensitive or masked text

- Some sites put amounts or card numbers in elements with special handling (e.g. “show on hover” or masked). If your selector lands on a wrapper, try `textContent` on the wrapper or a child marked as sensitive; avoid relying on `innerText` when layout is complex.

## Structure of extracted rows

- Keep a **raw_payload** (or similar) object for debugging and future parsing: store a few original strings or sub-objects. Normalize the main fields (amount, date, id) into a canonical shape so the rest of the app doesn’t depend on page structure.
