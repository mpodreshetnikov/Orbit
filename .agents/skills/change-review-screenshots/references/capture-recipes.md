# Capture Recipes (playwright-cli)

All recipes assume the local stack is running with bypass (`dev start bypass`) and the web app is on `http://127.0.0.1:3000`.

Set the output directory once per task:

```
.artifacts/review-screenshots/<YYYY-MM-DD>-<task-slug>/
```

## Web route (desktop)

```bash
playwright-cli open http://127.0.0.1:3000
playwright-cli resize 1440 900
playwright-cli goto http://127.0.0.1:3000/money/transactions
playwright-cli snapshot                       # find refs before interacting
playwright-cli screenshot --filename=.artifacts/review-screenshots/2026-08-03-money-filters/01-money-transactions-default-desktop.png
```

## Auth-gated route

In `just dev start bypass` mode, auto-login is on: navigating to a protected route redirects through `/auth/dev-login` and signs you in as the default local user. **Go straight to the target route** — do not route through `/login`, which redirects away in this mode (`src/lib/supabase-middleware.ts`, `docs/SETUP.md`).

```bash
playwright-cli goto http://127.0.0.1:3000/health
playwright-cli snapshot                       # confirm the page rendered, not a redirect chain
playwright-cli screenshot --filename=.../02-health-overview-desktop.png
```

To capture as a different local user, hit dev-login directly:

```bash
playwright-cli goto "http://127.0.0.1:3000/auth/dev-login?email=someone@example.com&next=/health"
```

Only when auto-login is off (bypass without `DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED`, or a task that verifies the real auth flow) does `/login` render sign-in controls worth snapshotting.

Save the session so later captures skip the login step:

```bash
playwright-cli state-save .artifacts/review-screenshots/auth.json
playwright-cli state-load .artifacts/review-screenshots/auth.json
```

## Interaction / state-specific shot

Drive the UI into the state the change affects, then shoot:

```bash
playwright-cli click e14            # open filter panel
playwright-cli fill e21 "groceries"
playwright-cli press Enter
playwright-cli screenshot --filename=.../03-money-transactions-filter-applied-desktop.png
```

For a dialog, modal, or single component, screenshot the element instead of the page:

```bash
playwright-cli screenshot e7 --filename=.../04-refill-snooze-dialog.png
```

## Empty / error / validation state

Force the state deliberately — submit an invalid value, filter to a query with no rows, or navigate to a record that does not exist — and capture it:

```bash
playwright-cli fill e21 "zzz-no-such-category"
playwright-cli press Enter
playwright-cli screenshot --filename=.../05-money-transactions-empty-desktop.png
```

## Mobile viewport

```bash
playwright-cli resize 390 844
playwright-cli reload
playwright-cli screenshot --filename=.../06-money-transactions-default-mobile.png
playwright-cli resize 1440 900        # restore before further desktop shots
```

## Before / after pair

Only when the old state is cheap to reach and the working tree is clean enough to restore safely:

```bash
git stash push --include-untracked
# recapture the same route/state with the -before suffix
playwright-cli screenshot --filename=.../00-money-transactions-default-desktop-before.png
git stash pop
```

Confirm `git status` is back to the pre-stash state before continuing. If the stash cannot be restored cleanly, stop and report it — never leave the tree in a stashed state.

## Browser extension UI

Rebuild first — the browser loads the built output from `browserExtension/dist`:

```bash
just extension-build-production
```

Capture through your own `playwright-cli` session, which loads the extension via the `--load-extension` / `--disable-extensions-except` launch args in `.playwright/cli.config.json` (update the absolute paths there to your checkout):

```bash
playwright-cli open http://127.0.0.1:3000/money/import
playwright-cli screenshot --filename=.../08-money-import-extension-connected-desktop.png
# popup: the manifest pins a stable extension id via its `key`
playwright-cli goto chrome-extension://<extension-id>/popup.html
playwright-cli screenshot --filename=.../09-extension-popup.png
```

Find `<extension-id>` from `chrome://extensions` in the same session, or from the service-worker URL in `playwright-cli tab-list`.

**The live debug runners are not screenshot sources.** `extension-debug-live` / `extension-debug-live-full` launch their own persistent Chromium context (`scripts/extension/playwright-cli-run-connector-parser.ts`), which `playwright-cli` cannot attach to, and both justfile wrappers close it on completion (they do not pass `--keep-open`). Use their written artifacts — `report.md`, `rows-preview.csv`, `diagnostics.json` — as evidence for scraper behavior, and `playwright-cli` for anything that has to be shown as an image. If an auth gate appears during a debug run, ask the human to pass it and continue.

## Grafana dashboard

```bash
just obs-up                                    # local LGTM stack, Grafana UI on http://127.0.0.1:3300
playwright-cli open http://127.0.0.1:3300      # skip if a session is already open
playwright-cli resize 1440 900
playwright-cli screenshot --filename=.../07-grafana-<dashboard>-panels.png
```

Credentials for the local Grafana image are in `docs/observability/local.md`.

## Close the session

```bash
playwright-cli close
```
