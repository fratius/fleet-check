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

### 4. Deploy

**Actions > Deploy > Run workflow.** It also runs on every push to `main` and takes 5 to 10 minutes. The run's **Summary** shows the web link: `https://fleet-check-2aa34.web.app`.

### 5. Open it on your phone

The phone app is published by Expo on every push to `main` (`.eas/workflows/publish-update.yml`, through the GitHub connection on the Expo project, so no Expo token is needed). Progress is under **Workflows** on the project page at expo.dev.

1. Install **Expo Go** from the App Store or Google Play.
2. On a computer, open the [QR code for the latest version](https://qr.expo.dev/eas-update?projectId=a73c29a2-b492-4320-822e-fb6dabc2ab99&runtimeVersion=exposdk:57.0.0&channel=main) and scan it with the iPhone camera (on Android, scan it in Expo Go). Expo Go keeps the app in its list, and you get each new version when you reopen it.
3. Create an account. The first person creates the company and becomes its fleet manager. The invite code for drivers is on the **Account** tab.

Sign-up only works after step 4 has run once, because that deploys the database rules.

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

Without Firebase settings the app runs in **test mode**: no sign-in, data stays on the device, AI checks are off. Fleet, frames and the camera all work. To use the real backend locally, export `FIREBASE_WEB_CONFIG` with the web app config JSON from Firebase project settings and start with `npx expo start --clear` (the config is baked in when the app is bundled).

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
