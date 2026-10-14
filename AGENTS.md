# Notes for coding agents

- Expo SDK 57, React Native 0.86, expo-router with routes in `src/app`. Typed routes and the React Compiler are on.
- Install native packages with `npx expo install <pkg>` so versions match the SDK. Without network access to the Expo API, prefix `EXPO_OFFLINE=1`.
- The app must keep working in Expo Go: no custom native code, no packages that need a development build.
- Test mode: with no Firebase config (`FIREBASE_WEB_CONFIG` unset) the app stores data on the device and AI checks are off. Keep that path working; it's how the app is tested without a backend.
- The Anthropic key lives only in Secret Manager (`ANTHROPIC_API_KEY`), set by the Deploy workflow from the GitHub secret. Never put keys in the repo or the app.
- Model ids and prices are in two places: `functions/src/models.ts` and `src/lib/types.ts`. Change both.
- Before pushing: `npm run typecheck` and `npx expo export -p web`.
