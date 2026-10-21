This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Showing a change to the owner on their phone

A change to this client is reviewed on the owner's iPhone before it reaches `main`, and a cloud
session cannot run `just mobile-start` where the phone can reach it. So, whenever you change
anything the client draws or does and the session runs in the cloud:

1. Push the branch, then dispatch the **Mobile preview** workflow (`.github/workflows/mobile-preview.yml`)
   on that branch — through the GitHub MCP tools, `actions_run_trigger` with `run_workflow`,
   `workflow_id: mobile-preview.yml` and `ref` set to the branch. `minutes` defaults to 60.
2. Wait a minute or two, then read the address from the commit status the run posts on the
   branch's head commit: context **Mobile preview**, description `exp://… until HH:MM UTC`
   (`pull_request_read` with `get_status` on the branch's pull request). The job log has it too,
   but GitHub serves a job's log only after the job ends, which is when the server stops.
3. Send that address to the owner in the conversation with one line on what to look at, and say
   how long the server stays up. Dispatch again when they ask for more time or after a new push —
   a run serves the commit it started on, not later pushes.

The same works on `main` after a merge, to show what shipped. The workflow only serves the
JavaScript bundle; it deploys nothing and writes nothing to the instance.

## Proving a change before merge: tests and simulator recordings

Policy is in `docs/QUALITY.md` under "User-Interface Changes Ship On Every Platform"; here is how.

**Tests.** `just mobile-check` runs lint, typecheck and `jest --coverage` under `jest-expo`, and fails
below 90% of lines or branches of `src/`. A screen test renders through Expo Router with
`renderScreens` (`test/render.tsx`) against `test/fake-supabase.ts` and `test/fixtures.ts`; `render`
and `fireEvent` are async in `@testing-library/react-native` 14, so await both. Never put a test file
under `src/app/`: Expo Router would treat it as a route.

**Recordings.** The `Mobile recordings` workflow runs on every pull request touching `mobile/` (and by
dispatch on any branch). `e2e/setup/open.yaml` loads the client unrecorded; then each `e2e/*.yaml`
is recorded as `<flow>.mp4`, with a PNG per `takeScreenshot`, in file-name order against one
database: number the files, and put a flow that changes data after the read-only ones. Each video is
cut to its flow's own steps, so Maestro's start-up is not in it. To read a run:

```bash
gh run list -R mpodreshetnikov/Orbit -w "Mobile recordings" -b <branch> -L 1
gh run download <run-id> -R mpodreshetnikov/Orbit -n recordings -D <dir>
```

Screenshots land under `<dir>/.maestro/tests/*/<flow name>/takeScreenshot/`, videos under
`<dir>/**/recordings/`; on failure `zz-failure.png` is the last screen. Look at every picture before
sending it on. Writing flows: a list row is one accessibility element ("Vitamin D3, Просрочено · …")
and Maestro matches text whole, so match rows by prefix (`"Vitamin D3.*"`); the data is
`supabase/seed.sql`'s user `dev@example.com`, with today's doses and yesterday's (taken) generated
in the run.
