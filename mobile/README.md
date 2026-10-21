# Orbit for iOS

A native client, not a web view. It draws its own screens and reaches an Orbit instance over the
Supabase data API, which is what lets the back-swipe, the list scrolling and the keyboard behave the
way the system does rather than the way a browser can imitate.

Tracked as `T-261018-l19` in the task registry. Today it ships `M1`: sign in, and today's medication
doses for one person.

## Running it on a phone

No Apple Developer account, no Mac and no build are needed for this loop — Expo Go runs the
JavaScript bundle from your machine.

Expo Go from the App Store runs one Expo SDK, and it reaches the store weeks after that SDK is
published on npm. Stay on the SDK the store's Expo Go runs (57 as of 2026-10-21; its App Store
release notes name it), not on `expo@latest`: a newer project opens only to "Project is incompatible
with this version of Expo Go".

1. Install **Expo Go** from the App Store on the iPhone, and put the phone on the same network as
   the computer.
2. Install the dependencies once:

   ```sh
   just mobile-install
   ```

3. Start it, naming the instance the first time:

   ```sh
   just mobile-start orbit.example.com
   ```

   That asks the instance for its public settings (`/.well-known/orbit-instance`: the data API's
   address and its anon key, both of which every browser opening Orbit already receives) and saves
   them to `mobile/.env.local`, which is git-ignored. After that a bare `just mobile-start` reuses
   them. To write the file by hand instead, it holds `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

   The URL must be `https` and a bare origin; the app refuses anything else and says why.

   A local Supabase stack is **not** reachable this way from a phone: `localhost` on the device is
   the device, and the computer's LAN address is plain `http`, which the app rejects so that an
   access token is never sent in clear text. Loopback is accepted only for a host that runs the
   bundle itself (`expo start --web`, or a simulator on a Mac). Pointing a phone at a local stack
   needs an https tunnel, which is not set up yet — use the deployed instance.

4. Scan the QR code with the iPhone's camera, then **Войти через Google** with the same account as
   the web app. The sheet returns to Expo Go on an `exp://` address, which the instance accepts only
   once it runs a `deploy/orbit` that lists it in `ADDITIONAL_REDIRECT_URLS` — before that, Google
   signs you in and the instance refuses the redirect.

**Without a computer:** dispatch _Actions → Mobile preview → Run workflow_ on any branch. A GitHub
runner serves that branch behind an anonymous ngrok tunnel for an hour and posts an `exp://` address
to open in Expo Go. It needs the `MOBILE_PREVIEW_INSTANCE` repository variable (the instance's
domain). Expo's own signed tunnel, which needs the `EXPO_TOKEN` secret, arrives with SDK 58.

Hot reload is live: save a file and the phone updates. That loop is the reason this is Expo rather
than SwiftUI — see the Decision Log in `T-261018-l19`.

## Checks

```sh
just mobile-check     # lint, typecheck and unit tests
just test-unit-mobile # the unit tests alone
```

`just check` does **not** cover this directory: the typecheck needs `mobile/node_modules`, which the
repository's own install does not create. CI runs `mobile-check` inside `Quality Gates`, which
`main protection` requires, whenever anything here changes — including a change to
`supabase/db/database.types.ts`, since `@db` resolves onto it.

Only the pure modules are unit-tested — the instance configuration, the day boundary, and the
mapping from database rows to what a screen shows. Those hold the decisions; the screens lay the
result out. Anything needing a React Native runtime is verified by using the app on the phone,
which is also the acceptance the milestone asks for.

## What is not here yet

- Marking a dose taken (`M2`), measurements (`M3`), document capture (`M4`), recording a spend
  (`M5`).
- A TestFlight build (`M6`). It needs an App Store Connect invitation from somebody holding an Apple
  Developer Program membership; `T-261018-l19` records why, and what that person is taking on.
- Choosing an instance at run time (`M7`, for `T-261017-5or`). Until then a build is tied to one
  instance by the two environment variables above.
- The session is stored through `AsyncStorage` rather than encrypted at rest. Deliberate and
  temporary, with the reasoning in `src/lib/supabase.ts`: it must be fixed before `M6` puts a build
  on anybody else's phone.
- Unit labels. Amounts show as bare numbers, because the web app's unit words come from an ICU
  message catalogue this app does not load yet. A number beside a medication's own name reads
  correctly; an English word in a Russian interface would not.
