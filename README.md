# Fleet Check

Vehicle walk-arounds and AI damage checks for delivery fleets. One app for iPhone, Android and the web.

- **Fleet:** each vehicle gets photo frames that fit its body type (car to step van).
- **Walk-around:** the camera shows the outline to line up for each photo.
- **Damage check:** the AI marks every spot that could be damage, the driver takes close-ups of each one, and the AI decides: damage, dirt, reflection or nothing. Every step records its time and real cost.
- **Companies:** each company sees only its own fleet. Fleet managers invite drivers with a 6-letter code.

## Set it up (about 30 minutes, once)

You need four accounts: GitHub (this repo), Firebase (Google), Anthropic and Expo. Keys go into GitHub secrets only. Never paste them into a chat, an issue or a file.

### 1. Firebase project

At [console.firebase.google.com](https://console.firebase.google.com):

1. **Create a project.** Google Analytics isn't needed.
2. **Upgrade to Blaze** (pay as you go), bottom left. The AI functions and photo storage need it. Testing stays within the free allowance apart from small storage costs. Set a budget alert at, say, $10.
3. **Build > Authentication > Get started > Email/Password > Enable.**
4. **Build > Firestore Database > Create database.** Location `europe-west3 (Frankfurt)`, start in production mode.
5. **Build > Storage > Get started.** Same location, production mode.
6. **Build > Hosting > Get started.** Click through. You don't need to run the commands it shows.

### 2. Let GitHub deploy to Firebase

1. In Firebase: **Project settings (gear) > Service accounts > Generate new private key.** A JSON file downloads.
2. Open [Google Cloud IAM](https://console.cloud.google.com/iam-admin/iam) for the same project. Find the account named `firebase-adminsdk-…`, click the pencil, **Add another role > Owner**, Save. The default roles can't deploy functions. Owner is broad, so keep this project for Fleet Check only.
3. In this GitHub repo: **Settings > Secrets and variables > Actions > New repository secret.** Name `FIREBASE_SERVICE_ACCOUNT`, value: the whole JSON file. Then delete the file from your computer.

### 3. Anthropic key (the AI)

1. At [console.anthropic.com](https://console.anthropic.com): **API keys > Create key**. Add some credit under Billing and set a monthly spend limit.
2. GitHub secret `ANTHROPIC_API_KEY` with the key.

### 4. Expo (the phone app)

1. Sign up at [expo.dev](https://expo.dev) (free).
2. **Account settings > Access tokens > Create.**
3. GitHub secret `EXPO_TOKEN` with the token.

### 5. Deploy

**Actions > Deploy > Run workflow.** It also runs on every push to `main`. It takes 5 to 10 minutes. Open the finished run: the **Summary** shows the web link and two QR codes.

### 6. Open it on your phone

1. Install **Expo Go** from the App Store or Google Play.
2. Scan the **Always the latest version** QR code with the iPhone camera (on Android, scan it in Expo Go). Expo Go keeps it in its list, and you get each new version when you reopen it.
3. Create an account. The first person creates the company and becomes its fleet manager. The invite code for drivers is on the **Account** tab.

The web app is at `https://<your-project-id>.web.app`, with the same login and data.

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
  "Check for damage"           ──call───▶ Functions (europe-west3) ──▶ Claude API
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
