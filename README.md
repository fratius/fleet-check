# Fleet Check

Vehicle walk-arounds and AI damage checks for delivery fleets. One app for iPhone, Android and the web.

- **Fleet:** each vehicle gets photo frames that fit its body type (car to step van).
- **Walk-around:** the camera shows the outline to line up for each photo.
- **Damage check:** the AI marks every spot that could be damage, the driver takes close-ups of each one, and the AI decides: damage, dirt, reflection or nothing. Every step records its time and real cost.
- **Companies:** each company sees only its own fleet. Fleet managers invite drivers with a 6-letter code.

## Set it up (once)

You need four accounts: GitHub (this repo), Firebase (Google), Anthropic and Expo. Keys go into GitHub secrets only. Never paste them into a chat, an issue or a file. The Firebase web config and the Expo project ID in `app.json` are public identifiers, not secrets.

### 1. Firebase project

At [console.firebase.google.com](https://console.firebase.google.com), in project `fleet-check-2aa34`:

1. **Upgrade to Blaze** (pay as you go). The AI functions and photo storage need it. Set a budget alert at, say, $10.
2. **Build > Authentication > Get started > Email/Password > Enable.**
3. **Build > Firestore Database** and **Build > Storage**: created, in the US. The functions run in `us-central1` to sit next to them. If you ever move the data to Europe, change `REGION` in `src/lib/firebase.ts` and `functions/src/index.ts`.
4. **Build > Hosting > Get started.** Click through. You don't need to run the commands it shows.

### 2. Let GitHub deploy to Firebase

1. In Firebase: **Project settings (gear) > Service accounts > Generate new private key.** A JSON file downloads.
2. Open [Google Cloud IAM for fleet-check-2aa34](https://console.cloud.google.com/iam-admin/iam?project=fleet-check-2aa34). Find the account named `firebase-adminsdk-…`, click the pencil, **Add another role > Owner**, Save. The default roles can't deploy functions. Owner is broad, so keep this project for Fleet Check only.
3. In this GitHub repo: **Settings > Secrets and variables > Actions > New repository secret.** Name `FIREBASE_SERVICE_ACCOUNT`, value: the whole JSON file. Then delete the file from your computer.

### 3. Anthropic key (the AI)

1. At [console.anthropic.com](https://console.anthropic.com): **API keys > Create key**. Add some credit under Billing and set a monthly spend limit.
2. GitHub secret `ANTHROPIC_API_KEY` with the key.

### 4. Expo token (the phone app)

1. Signed in at expo.dev, open [Access tokens](https://expo.dev/settings/access-tokens) and click **Create token**. Any name works.
2. GitHub secret `EXPO_TOKEN` with the token.

### 5. Deploy

**Actions > Deploy > Run workflow.** It also runs on every push to `main` and takes 5 to 10 minutes. The run's **Summary** shows the web link (`https://fleet-check-2aa34.web.app`) and the QR codes for the phone.

### 6. Open it on your phone

1. Install **Expo Go** from the App Store or Google Play, or update it if you have it. The app is built on Expo SDK 58, and Expo Go from the App Store only opens the newest SDK.
2. On a computer, open the [QR code for the latest version](https://qr.expo.dev/eas-update?projectId=a73c29a2-b492-4320-822e-fb6dabc2ab99&runtimeVersion=exposdk:58.0.0&channel=main) and scan it with the iPhone camera (on Android, scan it in Expo Go). Expo Go keeps the app in its list, and you get each new version when you reopen it.
3. Create an account. The first person creates the company and becomes its fleet manager. The invite code for drivers is on the **Account** tab.

The web app works on a phone too: open `https://fleet-check-2aa34.web.app` in Safari.

When Expo releases a new SDK, Expo Go moves to it and stops opening this app until the project is upgraded.

## What the AI costs

Prices per million tokens, input and output: Haiku 5.5 $0.10 and $0.50, Sonnet 5.5 $2 and $10, Opus 5.5 $4 and $20. The server sizes each photo to the most detail Claude takes, 4,784 image tokens, so one photo costs about:

| Model in the app | Per photo | Finding spots on 14 photos | Whole check, with close-ups of 5 spots |
|---|---|---|---|
| Fast (Haiku 5.5) | $0.0006 | $0.008 | $0.014 |
| Balanced (Sonnet 5.5) | $0.011 | $0.15 | $0.27 |
| Best (Opus 5.5) | $0.022 | $0.31 | $0.54 |

These are estimates. Every run stores the token counts the API reported and the cost, and the **Test log** tab adds them up per model.

## How it works

```
Phone or web (Expo, React Native)        Firebase
  camera with frame outlines   ──photos──▶ Storage   orgs/{company}/…
  fleet, walk-arounds, checks  ◀─sync───▶ Firestore orgs/{company}/…
  "Check for damage"           ──call───▶ Functions (us-central1) ──▶ Claude API
```

- The API key stays on the server (Secret Manager). The app calls three functions: `identifyVehicle`, `findDamage` and `checkSpot`.
- `findDamage` sends the walk-around photos in batches of up to 10, marks up to 8 spots and saves a cropped photo of each spot with a yellow box.
- `checkSpot` sends that crop with the driver's close-ups (straight on, then a low angle) and stores the verdict, with the damage boxed on the close-up.
- Prompts are in `functions/src/prompts.ts`. Models and prices are in `functions/src/models.ts` and `src/lib/types.ts`.

## Run it on a computer

```bash
npm install
npx expo start          # press w for the web, or scan the QR code with Expo Go on the same Wi-Fi
```

The app uses the Firebase project in `app.json`. Start with `FLEET_TEST_MODE=1 npx expo start --clear` for **test mode** instead: no sign-in, data stays on the device, AI checks are off. Fleet, frames and the camera all work.

Checks before pushing: `npm run typecheck`.

## Project layout

```
src/app/            screens (expo-router): fleet, add vehicle, test log, account, vehicle, scan, walk-around, check
src/components/     shared UI
src/lib/frames.ts   vehicle classes, frame sets and outlines
src/lib/            Firebase, data, session, image upload
functions/src/      AI functions: prompts, image prep (sharp), Claude calls, cost
firestore.rules     who can read and write what
storage.rules
.github/workflows/  deploy
```
