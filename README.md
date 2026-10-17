# Fleet Check

Vehicle walk-arounds and AI damage checks for delivery fleets. One app for iPhone, Android and the web.

- **Fleet:** each vehicle gets photo frames that fit its body type (car to step van).
- **Walk-around:** the camera shows the outline to line up for each photo.
- **Damage check:** the AI marks every spot that could be damage, the driver takes close-ups of each one, and the AI suggests: damage, dirt, reflection or nothing. The fleet manager approves or rejects each spot; approved damage goes on the van's record. Every step records its time and real cost.
- **Companies and stations:** each company sees only its own fleet, split into stations (operating areas). People join with invite links made per station and role: one link per person, valid for 24 hours.

## Who can do what

| | App creator | Fleet owner | Fleet manager | Driver |
|---|---|---|---|---|
| Sees | every company | all stations of their companies | their station | vans of their station |
| Vans | everything | add, edit, move, remove | add, edit, remove at their station | scan |
| People | everything | stations, managers, drivers, invite links | drivers of their station, driver links | none |
| Damage | everything | approve or reject, any station | approve or reject at their station | AI check and close-ups, sends to the manager |
| AI model and test log | everything | sets the model, sees the log | sees the log | none |

- **App creator:** whoever signs up with an email listed in the GitHub variable `APP_CREATOR_EMAILS` (Settings > Secrets and variables > Actions > Variables, comma separated; `casian.colto@gmail.com` when the variable isn't set). Change it, run Deploy, then sign out and in.
- **Fleet owners** can own several companies (Account > Join or create another company) and switch between them.
- A company created before stations existed moves onto a "Main station" the first time its owner opens the app; rename it under People.
- The rules are tested on every deploy (`tests/rules.test.mjs` on the Firestore emulator) before anything goes live.
- The full access model and the checklist for new features are in [ROLES.md](ROLES.md).

## Try it with demo data

**Account > Demo company > Open the demo company** (owners and managers; also on the first screen for new accounts) makes a separate company "Demo DSP (test data)": two stations, two fleet managers, eight drivers, twelve vans, walk-arounds and damage checks waiting for review, at the van and reviewed. The people are made up and can't sign in, the photos are drawings and no AI is used. Switch back to your real company under Account; remove the demo company there when you're done.

To try the driver side yourself, make a driver link in the demo company and open it in a private browser window with another email address.

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

1. Install **Expo Go** from the App Store or Google Play and sign in to it (person icon, top right) with the Expo account that owns `fratius-org`. Expo Go only opens this app for members of that account.
2. On a computer, open the [QR code for the latest version](https://qr.expo.dev/eas-update?projectId=a73c29a2-b492-4320-822e-fb6dabc2ab99&runtimeVersion=exposdk:57.0.0&channel=main) and scan it with the iPhone camera (on Android, scan it in Expo Go). Expo Go keeps the app in its list, and you get each new version when you reopen it.
3. Create an account. Fleet owners create their company and first station. Managers and drivers open the invite link they were sent (made under **People**): it asks for their details, creates their account and shows how to put the app on the home screen.

The web app works on a phone too: open `https://fleet-check-2aa34.web.app` in Safari.

The app is built on Expo SDK 57 because that's what Expo Go in the App Store runs (57.0.9 in October 2026). Expo Go only opens one SDK, so upgrade the project only after the App Store version of Expo Go has moved to the new SDK.

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

The app uses the Firebase project in `app.json`. Start with `FLEET_TEST_MODE=1 npx expo start --clear` for **test mode** instead: no sign-in, data stays on the device, AI checks are off. Fleet, frames and the camera all work. Add `FLEET_TEST_ROLE=manager` or `driver` to see the app as that role.

Checks before pushing: `npm run typecheck`. Pushing a branch other than `main` runs the Test workflow (rules on the emulator, type checks).

## Project layout

```
src/app/            screens (expo-router): fleet, review, people, test log, account, add vehicle, vehicle, scan, walk-around, check
src/components/     shared UI
src/lib/frames.ts   vehicle classes, frame sets and outlines
src/lib/            Firebase, data, session, image upload
functions/src/      AI functions: prompts, image prep (sharp), Claude calls, cost
firestore.rules     who can read and write what (roles and stations)
tests/              rules tests for the Firestore emulator
storage.rules
.github/workflows/  deploy
```
