# Delivery And Naming

## Naming

```
.artifacts/review-screenshots/<YYYY-MM-DD>-<task-slug>/<NN>-<surface>-<state>[-<viewport>][-before].png
```

- `NN` — two-digit order, in the sequence a reviewer should look at them.
- `surface` — route or component, dash-cased: `money-transactions`, `health-structure`, `refill-snooze-dialog`.
- `state` — what is being shown: `default`, `filter-applied`, `empty`, `validation-error`, `loading`.
- `viewport` — `desktop` (1440x900) or `mobile` (390x844). Omit for element shots.
- `-before` — the pre-change state of the same route/state.

Keep before/after pairs adjacent in ordering (`00-...-before.png`, `01-...png`) so the diff is obvious.

## Delivering in the final response

Attach the images themselves — do not merely mention that files exist. Use the agent surface's file/image attachment mechanism so the reviewer sees them inline. Alongside the attachments, list one line per image:

```
screenshots:
- 01-money-transactions-default-desktop.png — /money/transactions — default list after change
- 02-money-transactions-filter-applied-desktop.png — /money/transactions — category filter applied, 3 rows match
- 03-money-transactions-empty-desktop.png — /money/transactions — empty state for a filter with no matches
- 04-money-transactions-default-mobile.png — /money/transactions — 390x844, filter bar wraps to two rows
before/after: 00-money-transactions-default-desktop-before.png vs 01-... (row height 44px -> 56px)
not-captured: none
blocked: none
```

Captions describe **what the reviewer should notice**, not what the file is. `"category filter applied, 3 rows match"` — not `"screenshot of transactions page"`.

## Delivering on a pull request

When the change lands on a PR, put the same evidence where the reviewer reads the diff:

- Embed the images in the PR description or a single review comment when the platform allows image upload.
- If image upload is unavailable to the agent, list the captured paths with their captions and say plainly that the files are local artifacts — do not commit them to the branch to make them renderable.
- One consolidated comment per round of review, not one per screenshot.

## Rules

- Never deliver a screenshot that does not show the change; recapture instead.
- Never crop out surrounding context that a reviewer needs to judge layout.
- Never commit files under `.artifacts/`.
- Never replace screenshots with a text description when a visible surface changed — the description supplements the image, it does not substitute for it.
