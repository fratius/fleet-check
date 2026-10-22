# Notes for coding agents

- Expo SDK 57, React Native 0.86, expo-router with routes in `src/app`. Typed routes and the React Compiler are on.
- Navigation: every tab is a stack (`src/app/(tabs)/(fleet,review,people,log,me)/_layout.tsx`), so the tab bar stays on every page and detail pages (van, walk-around, check, person) open inside the current tab with a header and back button. Put new detail pages in that shared folder, not at the root. Only the camera (`scan/[id]`) sits at the root, full screen. Keep `(fleet)` sorting first alphabetically: links opened from outside land in the first group.
- Install native packages with `npx expo install <pkg>` so versions match the SDK. Without network access to the Expo API, prefix `EXPO_OFFLINE=1`.
- The app must keep working in Expo Go: no custom native code, no packages that need a development build.
- Test mode: build with `FLEET_TEST_MODE=1` (drops the Firebase config) and the app stores data on the device with AI checks off. Keep that path working; it's how the app is tested without a backend.
- The Anthropic key lives only in Secret Manager (`ANTHROPIC_API_KEY`), set by the Deploy workflow from the GitHub secret. Never put keys in the repo or the app.
- Model ids and prices are in two places: `functions/src/models.ts` and `src/lib/types.ts`. Change both.
- Before pushing: `npm run typecheck` and `npx expo export -p web`.
- Expo Go only opens one SDK. Match the SDK to the Expo Go version in the iOS App Store (check its version in Expo Go's settings), not to the newest SDK on npm: iOS Expo Go can lag weeks behind a release. Upgrade with `npm install expo@~NN` then `npx expo install --fix`.
- Roles: read `ROLES.md` before any change. App creator > fleet owner > fleet manager > driver; every feature respects it, enforced in rules, functions and screens. Joining is by one-time invite links (24 hours).
- Change `firestore.rules` together with `tests/rules.test.mjs`. Deploy stops if the rules tests fail.
- Van assignments and their history are permanent (ROLES.md, "Vans, drivers and history"): written only by Cloud Functions, never edited or deleted; one van per driver and one driver per van; vans are retired, not deleted. Drivers pick up and drop off vans only where the station allows it, and only with proof: the full photo set or a video (checked on the server; videos are converted with ffmpeg-static in the functions). `tests/history.test.mjs` checks all of it on the emulators; keep it passing.
- Fleet records: FLEET_DATA.md lists what is kept about vans (built) and drivers (planned), who sees what, and what is deliberately not stored. Business data (contracts, costs, insurance terms) lives in `vehicleDetails`, never on the van document that drivers read.
