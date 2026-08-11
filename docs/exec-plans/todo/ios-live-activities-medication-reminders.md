# iOS Live Activities For Medication Reminders

## Purpose And Intent

Today a medication reminder in this app is an ordinary push notification. It arrives, it sits in
Notification Center, and on Android it carries a "Confirm" button. On an iPhone it carries no
buttons at all — Apple's web push implementation silently drops them — so the only way to record a
dose is to tap the notification, wait for the web app to open, find the medication and press a
button there. There is also nothing persistently visible: once the notification is swiped away or
buried under other notifications, the pending dose is invisible until the next reminder fires.

After this change, an iPhone user sees a pill-shaped **Live Activity** for a pending dose: a compact
card pinned to the top of the Lock Screen, a small pill glyph in the Dynamic Island, and — when the
Dynamic Island is long-pressed or the Lock Screen card is shown — two buttons, "Taken" and
"Snooze 1 hour". Pressing either one records the dose without ever opening the app, and the card
disappears (or reappears an hour later). The card stays visible the whole time the dose is pending,
rather than scrolling away like a notification.

You can see it working by installing the iOS build on a physical iPhone, creating a medication
regimen whose next dose is a minute away, locking the phone, and watching the pill card appear at
the top of the Lock Screen. Pressing "Taken" on the card makes it vanish, and the dose shows as
taken at `/health/medications` in the browser a moment later.

## Feasibility: What iOS Actually Allows

This section exists because the whole plan hinges on one constraint, and a reader who does not know
it will make wrong choices.

**Live Activities cannot be created from a website, a PWA, or a service worker.** They are produced
by ActivityKit, a native iOS framework, and rendered by a SwiftUI widget extension that must be
compiled into a signed iOS app bundle. There is no web API for them, no Safari flag, and no
declarative-push variant that reaches them. The app in this repository is a Next.js PWA; as it
stands it can never draw anything in the Dynamic Island. Delivering this feature therefore requires
shipping a native iOS application, and the bulk of this plan is about doing that with the least
possible duplication of the existing product.

Three further iOS facts shape the design:

- **iOS ignores web push notification actions.** The `actions` array the service worker passes to
  `showNotification` is honoured on Android and desktop but not on iOS, where only the default tap
  is available. This is why the current "Confirm" button is invisible on iPhone. It also means no
  amount of work on `public/sw.js` can produce a snooze button on iOS.
- **A Live Activity is not permanent.** The system keeps it active for at most eight hours, then
  ends it and removes it from the Dynamic Island; the card lingers on the Lock Screen for up to four
  more hours (twelve total) before disappearing. "Hangs there until I turn it off" therefore means
  "the server re-starts or refreshes it before the limit", not "one activity lives forever". For a
  medication reminder that resolves within a few hours this limit is never reached in practice, but
  the lifecycle code must not assume otherwise.
- **Starting an activity while the app is closed requires push-to-start.** Since iOS 17.2 the server
  can start a Live Activity by sending an APNs push of type `liveactivity` with `"event": "start"`
  to a device-specific _push-to-start token_. Without it, an activity can only be created while the
  app itself is running, which is useless for a reminder that fires at 8am while the phone is in a
  pocket.

Practical prerequisites that follow: a **paid Apple Developer Program membership** (the Push
Notifications capability is not available to free personal teams, and push-to-start is a push), a
**Mac with Xcode**, and a **physical iPhone** for testing — the Simulator can render a Live Activity
started locally but cannot receive APNs pushes. Dynamic Island rendering needs an iPhone 14 Pro or
later; on older iPhones running iOS 16.1+ the same activity appears on the Lock Screen only, which
is a graceful degradation, not a failure.

## Terms

- **PWA** — the web app in this repository, installed to the iPhone Home Screen from Safari. It is
  what exists today.
- **ActivityKit** — the native iOS framework that creates and updates Live Activities.
- **Live Activity** — the persistent card ActivityKit draws on the Lock Screen and in the Dynamic
  Island. It has no free-form UI: you declare a SwiftUI layout in advance and feed it a small,
  `Codable` state struct.
- **Widget extension** — a second build target inside the iOS app that contains the SwiftUI layout
  for the Live Activity. Extensions cannot be added to a project from the command line in practice;
  this step is done once in Xcode.
- **App Intent** — the mechanism (iOS 17+) that lets a button inside a Live Activity run a piece of
  Swift code in the app's process, in the background, without launching the UI. This is how "Taken"
  works without opening the app.
- **APNs** — Apple Push Notification service. The server posts an HTTP/2 request to
  `api.push.apple.com`, authenticated with a short-lived ES256 JWT signed by a `.p8` key downloaded
  from the Apple Developer portal.
- **Push-to-start token** — a per-device token, obtained by the app from
  `Activity<Attributes>.pushToStartTokenUpdates`, that lets the server create a _new_ Live Activity
  remotely. Distinct from the per-activity **update token**, which lets the server change or end an
  activity that already exists.
- **Capacitor** — a wrapper that packages an existing web app as a native iOS/Android app, running
  the web UI inside a `WKWebView` and exposing native code to JavaScript through plugins. It is how
  this plan avoids rewriting the product in Swift.
- **Dose event** — this repository's word for one scheduled intake, stored in
  `public.med_dose_events`. A **regimen** (`public.med_regimens`) is the course that generates them.
- **Digest** — a row in `public.notification_digests` describing a notification that is due to be
  delivered. The cron job turns digests into pushes.

## Orientation: What Exists Today

Reminders flow through four places. Read them before starting; the plan adds to this pipeline rather
than replacing it.

- `supabase/functions/notifications-cron/` is a Supabase Edge Function (Deno) that runs on a
  schedule. `window.ts` decides which digests are due, `digest.ts` groups them into per-user
  batches, and `push.ts` sends them as Web Push messages to every row of
  `public.push_subscriptions`. Medication digests are batched per person by the
  `type === "medication" || type === "medication_snoozed"` branches in both files.
- `public/sw.js` is the service worker that receives those pushes and draws the notification. Its
  `NOTIFICATION_TYPE_HANDLERS.medication` entry builds the title, the localized body ("Aspirin —
  2 tablets", with correct Russian plurals), the `pills-128x128.png` badge, and the single `confirm`
  action. Its `onActionClick` posts to `/api/notifications/medication-action`.
- `src/app/api/notifications/medication-action/route.ts` authenticates the browser session and calls
  the `mark_dose_taken` or `mark_dose_skipped` Postgres function once per dose event id.
- Postgres holds the state machine. `public.snooze_dose(p_dose_event_id, p_auth_user_id,
p_minutes_from_now int DEFAULT 15)` — most recently redefined in
  `supabase/migrations/20260203103000_notification_for_not_linked_persons.sql` — moves a dose's
  `actual_at` forward, sets its status to `snoozed`, and inserts a fresh `medication_snoozed` digest
  so the reminder comes back. `public.user_preferences.overdue_reminder_interval_minutes`
  (default 30) drives the existing re-nag behaviour for overdue doses.

Two details worth knowing because they will surprise you:

- The service worker deliberately exposes **only one** action. The comment above `getActions` says
  multiple actions trigger an Android bug where only the last one fires. Adding a snooze button on
  Android must therefore be verified on a real Android device, not assumed.
- `public/sw.js` uses `/icons/icon-192x192.png` as its default icon, but `public/icons/` contains
  only `icon-512x512.png` and `pills-128x128.png`. The default icon 404s today. Medication
  notifications are unaffected because their handler overrides the icon.

## Architecture Decision

The product is a large Next.js application (health records, medications, money, a browser extension,
an MCP server). Rewriting it in Swift to gain one widget is not sensible, and maintaining a second
Swift client that duplicates the medication domain would put the dose state machine in two places.

**This plan wraps the existing web app in a Capacitor iOS shell and adds one native widget
extension.** The web UI is unchanged and continues to be served from the same deployment; the only
Swift in the repository is the Live Activity layout, the two App Intents behind its buttons, and a
thin plugin that hands tokens between the web layer and the native layer. Android keeps using the
PWA and its existing web push, which already works there.

The alternative considered and rejected is a standalone SwiftUI companion app that talks to Supabase
directly. It would be cleaner Swift but would need its own auth, its own medication list UI, and its
own copy of the dose display logic, and it would drift from the web app on every change.

## Milestones

### M1 — Snooze, one hour, everywhere it already can work

Scope: no native code at all. This milestone makes snoozing a first-class action in the existing
system and changes the default delay to one hour, so that the native work later has a correct
backend to call and so the Android and desktop experience improves immediately.

What will exist at the end that does not exist now: a `snooze` action on medication notifications
(Android/desktop), an authenticated HTTP endpoint that snoozes a dose, a one-hour default instead of
fifteen minutes, and a user-visible preference controlling it.

Work:

- Add a migration under `supabase/migrations/` that redefines `public.snooze_dose` with
  `p_minutes_from_now int DEFAULT 60`. Copy the existing body verbatim from
  `supabase/migrations/20260203103000_notification_for_not_linked_persons.sql` (lines 626-708) and
  change only the default, so the person-prefix behaviour added by that migration is preserved.
  Update the `COMMENT ON FUNCTION` text to say sixty minutes.
- In the same migration, add `medication_snooze_minutes int NOT NULL DEFAULT 60` to
  `public.user_preferences`, with a `CHECK (medication_snooze_minutes BETWEEN 5 AND 1440)`.
- Extend `src/types/notifications.ts`: add `medication_snooze_minutes: number` to `UserPreferences`
  and `medication_snooze_minutes?: number | null` to `UpdateUserPreferencesInput`.
- Create `src/app/api/notifications/medication-snooze/route.ts`, modelled line-for-line on
  `medication-action/route.ts` (same `withServerSpan`, same `createServerLogger`, same auth guard,
  same 204 response). It accepts `{ dose_event_ids: string[], minutes?: number }`, resolves
  `minutes` from the request, else from the caller's `medication_snooze_minutes`, else 60, and calls
  `supabase.rpc("snooze_dose", { p_dose_event_id: id, p_auth_user_id: user.id, p_minutes_from_now:
minutes })` for each id.
- In `public/sw.js`, extend `NOTIFICATION_TYPE_HANDLERS.medication.getActions` to return both
  `confirm` and `snooze`, add `snooze` labels to `MEDICATION_ACTION_LABELS` ("Snooze 1h" /
  "Отложить на час"), and extend `onActionClick` so `snooze` posts to the new endpoint. Keep the
  existing `confirm` path untouched.
- Add the preference control to the notification section of `src/app/settings/page.tsx`, with
  strings in `src/messages/en.json` and `src/messages/ru.json`.

Acceptance: run `just db-reset` then `just db-test`; a new pgTAP case under `supabase/tests/functions/`
asserting that `snooze_dose` called with two arguments moves `actual_at` about sixty minutes forward
passes. Run `just test-unit-web`; the service-worker test in `src/lib/service-worker-notifications.test.ts`
(which reads `public/sw.js` as text) is extended to assert both action ids are present. With
`just dev-ready` running, trigger `POST /api/notifications/run-cron` from a signed-in browser on an
Android device, receive a medication notification with two buttons, press "Snooze 1h", and observe
in the database that the dose's `status` is `snoozed` and its `actual_at` is an hour out.

Known risk to resolve inside this milestone: the Android multi-action bug referenced in `sw.js`. If a
real device shows that only the last action fires, keep two actions on desktop and fall back to a
single `snooze` action on Android by inspecting `self.navigator.userAgent` inside `getActions`, and
record the finding in `Surprises & Discoveries`.

### M2 — An iOS shell that runs the existing app on a real iPhone

Scope: a Capacitor project that produces an installable iOS app showing the current web UI. No Live
Activity yet. This milestone exists to get signing, provisioning and device installation out of the
way before any interesting code is written.

Work, from the repository root on a Mac with Xcode installed:

    npm install --save @capacitor/core @capacitor/ios
    npm install --save-dev @capacitor/cli
    npx cap init "Family Superapp" com.example.familysuperapp --web-dir=public
    npx cap add ios

Replace `com.example.familysuperapp` with a bundle identifier registered to the Apple Developer
account that will sign the build; it is used verbatim in the APNs topic later and cannot be changed
casually.

The app must load the deployed web app rather than a bundled copy, so that shipping web changes does
not require a new App Store build. In `capacitor.config.ts`, set `server.url` to the production
origin and `server.cleartext` to false. Document in the config file's comments that a local build
against `just dev-ready` is done by pointing `server.url` at the machine's LAN address.

Add `ios/` to the repository but add `ios/App/Pods/`, `ios/App/App/public/`, `DerivedData/` and
`*.xcuserstate` to `.gitignore`. Add a short `docs/design/domains/health/ios-app.md` describing how
to open, sign and run the project, and link it from `docs/SETUP.md`.

Acceptance: `npx cap open ios`, select a physical iPhone, press Run, and the app launches showing the
same login screen as the browser. Sign in and reach `/health/medications`. Running `just quality`
still passes — the new `ios/` directory must be excluded from ESLint and Prettier via
`eslint.config.mjs` and `.prettierignore`.

### M3 — A pill in the Dynamic Island, started locally

Scope: the widget extension and its SwiftUI layout, started by hand from the app so the visual design
can be iterated without involving push.

In Xcode, add a Widget Extension target named `MedicationActivity` with "Include Live Activity"
checked, deployment target iOS 17.0 (17 rather than 16.1, because the interactive buttons in M5
require App Intents). Add `NSSupportsLiveActivities` set to `YES` to the main app target's
`Info.plist`. Create an App Group shared by both targets — it is needed in M5 to pass the auth token
— named `group.<bundle id>`.

Define the shared model in a Swift file that is a member of _both_ targets:

    struct MedicationAttributes: ActivityAttributes {
        struct ContentState: Codable, Hashable {
            var medicationName: String
            var amountLabel: String     // already localized server-side, e.g. "2 таблетки"
            var personPrefix: String?   // nil when the dose is the user's own
            var dueAt: Date
        }
        var doseEventIds: [String]
    }

Deliberate decision: the _body text is localized on the server_, not in Swift. `public/sw.js` already
contains the full plural table for medication units in English and Russian; duplicating it in Swift
would guarantee drift. The server sends a finished string.

The Lock Screen layout is a single row: the pill glyph, the medication name in headline weight, the
amount in secondary text, the person prefix as a small caption when present, and a relative time.
The Dynamic Island expanded layout mirrors it; the compact leading view is the pill glyph alone,
the compact trailing view is the amount, and the minimal view is the pill glyph. Add a `pill`
SF Symbol rather than importing `pills-128x128.png`, so the glyph adapts to tint and size.

Add a temporary debug button to the app that calls `Activity.request(...)` with sample content so
the layout can be checked on device.

Acceptance: on a physical iPhone 14 Pro or later, pressing the debug button shows the card on the
Lock Screen and a pill glyph in the Dynamic Island; long-pressing the island expands to the full
layout. On an older iPhone the Lock Screen card appears and nothing breaks. Screenshots of all four
presentations (minimal, compact, expanded, Lock Screen) go into the plan's `Progress` notes.

### M4 — The server starts the activity while the phone is locked

Scope: push-to-start, end to end, with no buttons yet. This is the milestone that makes the feature
real: a dose becomes due and the card appears without anyone touching the phone.

Native side: a small Capacitor plugin, `ios/App/App/LiveActivityPlugin.swift`, exposing one method
to JavaScript. On call it iterates `Activity<MedicationAttributes>.pushToStartTokenUpdates`, hex-
encodes each token, and hands it back to the web layer. The web layer registers it exactly the way
`src/hooks/use-ensure-push-subscription.ts` registers a Web Push subscription today — add a sibling
hook `src/hooks/use-ensure-live-activity-token.ts` that posts to a new
`src/app/api/notifications/live-activity-token/route.ts`.

Database: a migration adding

    public.live_activity_tokens (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null references auth.users(id) on delete cascade,
      push_to_start_token text not null,
      bundle_id text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (auth_user_id, push_to_start_token)
    )

with RLS enabled and policies mirroring `public.push_subscriptions`. Token rotation is handled by
upserting on every app launch and deleting rows APNs rejects with 410 Gone, exactly as the Web Push
code already prunes dead subscriptions.

Edge function: add `supabase/functions/notifications-cron/apns.ts`. It builds an ES256 JWT from the
`.p8` key using Deno's WebCrypto (`crypto.subtle.importKey("pkcs8", …, { name: "ECDSA", namedCurve:
"P-256" })`), caches it for the fifty-minute APNs window, and POSTs to
`https://api.push.apple.com/3/device/<token>` with headers `apns-push-type: liveactivity`,
`apns-topic: <bundleId>.push-type.liveactivity`, `apns-priority: 10`, and a body of the shape

    { "aps": {
        "timestamp": 1765000000,
        "event": "start",
        "content-state": { "medicationName": "...", "amountLabel": "...", "dueAt": ... },
        "attributes-type": "MedicationAttributes",
        "attributes": { "doseEventIds": ["..."] },
        "alert": { "title": "...", "body": "..." }
      } }

The `.p8` key, key id, team id and bundle id are new function secrets: `APNS_KEY_P8`,
`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`. Document them in `docs/SETUP.md` and add them to
`.env.observability.example`'s sibling env documentation — never commit the key itself; the
pre-push secrets hook (`just secrets-preflight`) will catch it if anyone tries.

Wire it into `push.ts`: for each user who has at least one `live_activity_tokens` row, medication
digests are delivered as a push-to-start instead of a Web Push, so the same dose does not produce
both a card and a banner. Non-medication digests, and users with no token, keep the current path
untouched.

Acceptance: `just test-unit-functions` passes, including new Deno tests for the JWT builder (assert
header and claims decode correctly and the signature verifies against the public key) and for the
routing decision in `push.ts` (assert a user with a live-activity token gets no medication Web Push).
On a real device: create a dose due in two minutes, lock the phone, and watch the card appear on the
Lock Screen by itself.

### M5 — Buttons on the card

Scope: "Taken" and "Snooze 1 hour" inside the Live Activity, running without opening the app.

Two App Intents conforming to `LiveActivityIntent`, in a file shared by both targets:
`MarkDoseTakenIntent` and `SnoozeDoseIntent`, each carrying the dose event ids as a parameter. The
widget's SwiftUI layout renders them with `Button(intent:)` in both the Lock Screen and the expanded
Dynamic Island presentations.

The intents need credentials. The plan takes the shortest safe path: when the web app boots inside
the Capacitor shell it calls the plugin with the Supabase session (`supabase.auth.getSession()` gives
an access token and a refresh token), the plugin writes them to the Keychain with the App Group
access group, and the intent reads them from there. If the access token is expired the intent first
POSTs to `<SUPABASE_URL>/auth/v1/token?grant_type=refresh_token`, stores the new pair, and retries.
With a valid bearer token the intent calls the Supabase RPC endpoints directly —
`POST <SUPABASE_URL>/rest/v1/rpc/mark_dose_taken` and `.../rpc/snooze_dose` — rather than the
Next.js routes, because the Next.js routes authenticate by cookie and the native process has no
cookie jar.

Note for the implementer: the two RPCs already exist and are `SECURITY DEFINER` with RLS-safe
bodies, so calling them with a user bearer token is equivalent to what
`/api/notifications/medication-action` does today. The minutes argument comes from the content state,
which the server fills from the user's `medication_snooze_minutes` preference added in M1.

On success the intent ends the activity with `activity.end(dismissalPolicy: .immediate)` for "Taken",
and for "Snooze" ends it with a short final state ("Snoozed until 15:30") that dismisses after a few
seconds — the fresh card is started by the cron an hour later through the M4 path.

Acceptance: on a locked device, pressing "Taken" on the card makes it disappear within a second and
the dose reads `taken` in the database; pressing "Snooze 1 hour" dismisses it and a new card appears
an hour later. Test with the app force-quit beforehand, which is the case that actually matters.

### M6 — Lifecycle, edge cases and cleanup

Scope: everything that turns a demo into something trustworthy.

- **Resolution elsewhere.** When a dose is marked taken in the web UI, any live card for it must
  disappear. Send an `event: "end"` APNs push using the per-activity update token; store that token
  alongside the push-to-start token, keyed by dose event id, when the app reports it from
  `activity.pushTokenUpdates`.
- **The eight-hour ceiling.** Have the cron end and restart an activity that is approaching the
  limit, or accept that an unresolved dose stops being visible after eight hours and falls back to
  the existing overdue Web Push nagging driven by `overdue_reminder_interval_minutes`. Choose the
  fallback unless testing shows it is unsatisfying; record the choice in the `Decision Log`.
- **Rate limiting.** APNs silently drops Live Activity pushes sent too frequently. The cron must not
  send more than one update per activity per minute; add a guard and a log line.
- **Multiple doses at once.** The existing digest logic already batches several medications for one
  person into one notification. The `ContentState` must therefore support a summary form ("3
  medications") with the individual names in the expanded presentation, and `doseEventIds` stays an
  array so both buttons act on all of them, matching the current `medication-action` semantics.
- **Multiple recipients.** `notification_routing` means a dose can notify a partner as well as the
  owner. Each recipient has their own push-to-start token, so each gets their own card, and the
  first to press "Taken" ends the others via the resolution path above.
- **Remove the M3 debug button.**
- **Observability.** Every APNs call gets a log line through the existing
  `createServerLogger`/`withServerSpan` conventions described in
  `docs/design/common/error-handling-and-observability.md`, with the APNs response status and
  `apns-id`. A 410 deletes the token row.

Acceptance: `just ci-verify-local` passes. A manual matrix run on device covers: dose taken from the
card, dose snoozed from the card, dose taken in the browser while the card is visible, two doses at
once, and a dose left unresolved past the eight-hour mark.

## What This Does Not Deliver

Stated plainly so nobody is surprised:

- Android gets no Live Activity. It gets the improved two-button notification from M1. The nearest
  Android equivalent — an ongoing foreground-service notification — is a separate piece of work and
  is not in scope.
- iPhone users who do not install the native app keep the current PWA behaviour, including the
  missing buttons. There is no way to fix that within the web platform.
- The app must be distributed. For family use that means TestFlight, whose builds expire after
  ninety days and must be re-uploaded, or ad-hoc distribution with a provisioning profile that must
  be renewed yearly. Neither is free of maintenance.

## Progress

- [ ] M1 — snooze action, one-hour default, `medication_snooze_minutes` preference
- [ ] M1 — Android multi-action behaviour verified on a real device
- [ ] M2 — Capacitor iOS shell installs and runs on a physical iPhone
- [ ] M3 — widget extension renders all four Live Activity presentations
- [ ] M4 — `live_activity_tokens` table, token registration, APNs JWT signer
- [ ] M4 — push-to-start delivers a card to a locked phone
- [ ] M4 — medication Web Push suppressed for devices with a live-activity token
- [ ] M5 — `MarkDoseTakenIntent` and `SnoozeDoseIntent` work with the app force-quit
- [ ] M6 — end-on-resolution, rate limiting, batching, multi-recipient, 410 pruning
- [ ] M6 — `just ci-verify-local` green and the on-device matrix run recorded here

## Surprises & Discoveries

- `public/sw.js` exposes only one notification action on purpose: its comment reports an Android bug
  where, with several actions, only the last one fires. Any multi-action change must be verified on
  hardware.
- `public/sw.js` sets `DEFAULT_ICON` to `/icons/icon-192x192.png`, which does not exist in
  `public/icons/`. Medication notifications override the icon so they are unaffected, but other
  notification types render without one. Worth fixing opportunistically in M1.
- `snooze_dose` exists in two migrations; the later one
  (`20260203103000_notification_for_not_linked_persons.sql`) is authoritative and adds the person
  prefix. Copy from that one.

## Decision Log

- **Capacitor shell over a standalone Swift app.** Keeps one implementation of the medication domain
  and one UI. The cost is a `WKWebView`-based app rather than a native one, which is acceptable
  because the native surface being added is a widget, not a screen.
- **iOS 17 deployment target, not 16.1.** Interactive buttons in a Live Activity require App Intents,
  which are iOS 17. Supporting 16.1 would mean a read-only card, which does not meet the request.
- **Localization on the server, not in Swift.** `public/sw.js` already owns the unit plural tables for
  English and Russian. The `ContentState` carries finished strings so the tables are never duplicated.
- **App Intents call Supabase RPCs directly, not the Next.js API routes.** The Next.js routes
  authenticate by cookie; the native process has no cookies. The RPCs are already the routes' only
  real work.
- **Default snooze of sixty minutes, overridable per user.** Requested explicitly. The current
  `snooze_dose` default of fifteen minutes stays reachable by passing the argument.
- **Web Push and Live Activity are mutually exclusive per user for medication digests.** Otherwise
  every dose produces two alerts on the same phone.

## Outcomes & Retrospective

Not started. Fill in at completion: what shipped, what was cut, how long the Apple provisioning
detour actually took, and whether the eight-hour ceiling ever mattered in practice.
