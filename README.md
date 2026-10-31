# Fratius

Vehicle walk-arounds and AI damage checks for delivery fleets. One app for iPhone, Android and the web.
(The repository keeps its old name, fleet-check.)

- **Fleet:** each vehicle gets photo frames that fit its body type (car to step van).
- **Walk-around:** the camera shows the outline to line up for each photo.
- **Damage check:** the AI marks every spot that could be damage, the driver takes close-ups of each one, and the AI suggests: damage, dirt, reflection or nothing. The fleet manager approves or rejects each spot; approved damage goes on the van's record. Every step records its time and real cost, which only the app creator sees.
- **Companies and stations:** each company sees only its own fleet, split into stations (operating areas). People join with invite links made per station and role: one link per person, valid for 24 hours.

## Who can do what

| | App creator | Fleet owner | Fleet manager | Driver |
|---|---|---|---|---|
| Sees | every company | all stations of their companies | their station | vans of their station |
| Vans | everything | add, edit, move, retire, give to drivers | add, edit, retire, give to drivers at their station | scan; pick up and drop off where the station allows it |
| Van records | everything | facts, contract, insurance, deadlines, **costs** | the same for their station, without costs | the van's facts and breakdown and accident numbers |
| Driver records | everything | licence and checks, employment, briefings, incidents | the same for their station | their own, read only |
| Tours and numbers (Data tab) | everything | every station, Excel download | their station, Excel download | their own tours |
| People | everything | stations, managers, drivers, invite links | drivers of their station, driver links | none |
| History | everything | every van and driver | their station | their own vans |
| Damage | everything | approve or reject, any station | approve or reject at their station | AI check and close-ups, sends to the manager |
| AI model | everything | sets the model | sees which one | none |
| AI speed, cost, test log | only the app creator | none | none | none |

- **App creator:** whoever signs up with an email listed in the GitHub variable `APP_CREATOR_EMAILS` (Settings > Secrets and variables > Actions > Variables, comma separated; `casian.colto@gmail.com` when the variable isn't set). Change it, run Deploy, then sign out and in.
- **Fleet owners** can own several companies (Account > Join or create another company) and switch between them.
- A company created before stations existed moves onto a "Main station" the first time its owner opens the app; rename it under People.
- The rules are tested on every deploy (`tests/rules.test.mjs` on the Firestore emulator) before anything goes live.
- The full access model and the checklist for new features are in [ROLES.md](ROLES.md).

## Vans, drivers and history

- **Fleet** shows which vans are free and which have a driver, and who. Open a van to give it to a driver or make it free; open a person (People) to give them a van. One van per driver, one driver per van.
- **History is kept for good:** each van lists every driver it had, each person every van they had, with the dates, who handed it over and why it ended. Nobody can edit or delete it, not even the owner. Vans are retired, not deleted; people who leave keep their history.
- **Damage on each van:** the van page shows the van in 3D with a dot on each damage; tap a dot for when it happened, who had the van, the before and after photos and comments. The damage list below has the full details, newest first. When a check finds damage the van already has, the manager links it in the review so it stays one damage.
- **Drivers can pick up and drop off vans themselves** where a station allows it (People > station > Who hands out the vans). Picking up and dropping off both need proof: a video walking around the van, or the full photo set. Both are linked from the history.
- **Videos** instead of photos: Start scanning asks "photos or a video?", so anyone who can scan a van can film a walk-around video of it, and drivers can pick up and drop off with one. On phones the app records them itself (720p, no sound, small uploads); the server makes the copy that plays on every phone (only repackaged for the app's own recordings; converted to 720p with normal colours for videos from a camera app or the web). The Review tab tells managers when a drop-off has no video or photos, and managers can add a missing video afterwards.
- **A driver given a van is told and asked for the pick-up video or photos**: a phone notification (store app or web app, after turning notifications on in Account) and a card on their Vans tab. Managers see it in Review if they're still missing after 2 hours.
- **Van records** (FLEET_DATA.md): each van's VIN, registration, fuel, tank, size, breakdown and accident numbers (everyone at the station), and its contract, insurance, mileage against the allowance and deadlines (owners and managers). What it costs only owners see. Deadlines (main inspection, safety check, service, tyres, tax, insurance, contract end) show on the van, in the fleet list and as Due soon in Review.
- **Fill in from a document**: on a van's Details or a driver's Record, photograph the registration certificate, a lease or insurance contract, an inspection report, a service invoice, a driving licence... The AI says what it is and fills the right sections; you check and save. The photo isn't kept; costs are only read for owners; from a licence only the classes and expiry.
- **Driver records** (FLEET_DATA.md): licence classes and expiry, licence checks (the date and who checked, as proof; the interval is set by the owner), employment, briefings, emergency contact, notes, and incidents (accidents, fines, complaints). Overdue checks, expiring licences and safety briefings show in Review. Drivers read their own.
- **Tours from dashboard photos** (the owner turns them on in Account): drivers photograph the dashboard at the start and end of each tour; the AI reads the odometer, fuel or battery and warning lights, the driver confirms. The server works out kilometres and fuel per tour and keeps each van's odometer up to date. Warning lights and tours without their photos show in Review.
- **Data tab** (owners and managers): drivers, tours and vans as sortable tables for a period, with totals; fuel compared with other drivers on the same van model; damage and incidents per driver; who was driving a van at a given moment; download for Excel.
- **View the app as someone else** (app creator only): Account > View the app as. Pick fleet owner, fleet manager or driver (and a station) to see the open company exactly as they do; the server applies the same access. A strip above the tab bar shows who you're viewing as, with Back to me.

## Try it with demo data

**Account > Demo company > Open the demo company** (owners and managers; also on the first screen for new accounts) makes a separate company "Demo DSP (test data)": two stations, fleet managers, drivers, twelve vans with a month of driver history, walk-arounds and damage checks waiting for review, at the van and reviewed. At the first station drivers pick up their vans themselves; at the second the manager hands them out. The photos are drawings and no AI is used. Switch back to your real company under Account; remove the demo company there when you're done.

Two of the made-up people can sign in: a driver and a fleet manager. Their email and password are on the Demo card under Account. Use them in a private browser window to see the app as they do. **Start the demo over** makes everything new, including those logins.

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
2. On a computer, open the [QR code for the latest version](https://qr.expo.dev/eas-update?projectId=a73c29a2-b492-4320-822e-fb6dabc2ab99&runtimeVersion=exposdk:58.0.0&channel=main) and scan it with the iPhone camera (on Android, scan it in Expo Go). Expo Go keeps the app in its list, and you get each new version when you reopen it.
3. Create an account. Fleet owners create their company and first station. Managers and drivers open the invite link they were sent (made under **People**): it asks for their details, creates their account and shows how to put the app on the home screen.

The web app works on a phone too: open `https://fleet-check-2aa34.web.app` in Safari.

The app is built on Expo SDK 58 because that's what Expo Go in the App Store runs (58.0.5, from late October 2026). Expo Go only opens one SDK, so upgrade the project only after the App Store version of Expo Go has moved to the new SDK, and update Expo Go on every phone when the project moves: an older Expo Go can't open the new version, and the new Expo Go can't open the old one.

- **Photos and videos are deleted on the 15th of each month for the month before**, never while the van is still with the driver who had it, the ones that show damage after 90 days (approved in a check, or marked as damage by a manager on a walk-around or video); the records stay. **People delete their own account** in the Account tab.

## App Store and Google Play

The store app is built by the **Store build** workflow (Actions tab) on EAS, as Fratius, `com.fratius.app`. The steps for the developer accounts, signing and submitting, and the texts for the store pages, are in [store/README.md](store/README.md) and [store/listing.md](store/listing.md). Every Deploy also updates the store app, as long as no native package changed since its builds (`scripts/native.mjs`).

## The website (fratius.com)

The marketing website lives in `website/` and goes live with every Deploy, next to the app, as a second Firebase Hosting site (`fratius-web.web.app`; set the `WEBSITE_SITE` variable to use another name). To put it on fratius.com: in the Firebase console open **Hosting**, pick the `fratius-web` site, click **Add custom domain**, enter `fratius.com` (and `www.fratius.com`, redirecting to it), and add the DNS records it shows at the domain registrar. The request form ("Start your 30 days") stores requests in Firestore (`siteRequests`, read in the Firebase console) and emails them to info@fratius.com once the `SMTP_URL` secret is set, for example `smtps://info%40fratius.com:APP-PASSWORD@smtp.gmail.com:465` for Google Workspace (an app password, not the account password).

## What the AI costs

Prices per million tokens, input and output: Haiku 5.5 $0.10 and $0.50, Sonnet 5.5 $2 and $10, Opus 5.5 $4 and $20. The server sizes each photo to the most detail Claude takes, 4,784 image tokens, so one photo costs about:

| Model in the app | Per photo | Finding spots on 14 photos | Whole check, with close-ups of 5 spots |
|---|---|---|---|
| Fast (Haiku 5.5), the default | $0.0006 | $0.008 | $0.014 |
| Balanced (Sonnet 5.5) | $0.011 | $0.15 | $0.27 |
| Best (Opus 5.5) | $0.022 | $0.31 | $0.54 |

Fast is the default model since 2026-10-25; the fleet owner can pick another in **Account**. The fuel card check always reads the card with Haiku first and, when it isn't a clear match, again with Sonnet (Opus on Best) before a driver is stopped. These are estimates. Every run stores the token counts the API reported and the cost, and the **Test log** tab (app creator only) adds them up per model.

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

Checks before pushing: `npm run typecheck`. Pushing a branch other than `main` runs the Test workflow (rules on the emulator, the van history flow end to end, type checks).

**Everything on your computer, no real data:** `npm run emulators` (needs Java 21) starts the Firebase emulators for sign-in, data, photos and functions, under a demo project that never touches the real one. In a second terminal, `npm run web:emulators` opens the web app against them. Put any text in `functions/.secret.local` as `ANTHROPIC_API_KEY=...` and `WEBPUSH_KEYS={}` first (AI checks need a real key and phone notifications a real key pair; nothing else does).

## Project layout

```
src/app/            screens (expo-router). Every tab is its own stack, so the tab bar stays on every page:
  (tabs)/(fleet)/   fleet list, add vehicle            (tabs)/(review|people|log|me)/  the other tabs
  (tabs)/(fleet,review,people,table,log,me)/  van, walk-around, check, person: open inside whichever tab you're in
  scan/[id].tsx     the camera, full screen over the tabs
src/components/     shared UI
src/lib/frames.ts   vehicle classes, frame sets and outlines
src/lib/            Firebase, data, session, image upload
functions/src/      AI functions: prompts, image prep (sharp), Claude calls, cost
firestore.rules     who can read and write what (roles and stations)
tests/              rules tests for the Firestore emulator
storage.rules
.github/workflows/  deploy
```
