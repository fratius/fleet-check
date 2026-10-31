# Fratius in the App Store and Google Play

The phone app is the same code as the web app, built by EAS (Expo's build servers) as **Fratius**,
`com.fratius.app`, version 1.0.0. The texts for the store pages, the privacy answers and the review notes are in
[listing.md](listing.md). **For the App Store, follow [APP-STORE.md](APP-STORE.md) step by step**; this page is
the overview, with Google Play.

## What's ready in the code

- Name, bundle ID and package `com.fratius.app`, iPhone only (no iPad layout), permission texts (camera, photos;
  videos are recorded in the app at 720p without sound) in all 32 languages (`locales/ios`), the iPhone privacy
  manifest, no export-controlled encryption. `eas.json`: `production` builds for the stores,
  `preview` for an Android file to install directly. Build numbers are counted by EAS.
- **Account deletion in the app** (Account tab, and on the first screen for people without a company), and the
  page for Google Play: https://fratius.com/delete-account
- **Privacy policy of the app**: https://fratius.com/app-privacy, linked in the app (Account tab, sign-in screen).
- **Notifications in the store app** through Expo's push service (they need the keys of step 4).
- **Photos and videos kept 30 days, damage 90**, as the privacy policy says.
- **Updates without a new store version**: every Deploy also sends the update to the store app ("production"
  channel), as long as no native package changed (`scripts/native.mjs`; Deploy warns when one did: then raise the
  version in `app.json`, run `node scripts/native.mjs --write` and make new store builds).

## Steps (yours)

### 1. Developer accounts
- **Apple**: Apple Developer Program, an **individual** account (the App Store shows Casian Dan Colto as the
  seller). Apple accepts only legal entities (GmbH, UG...) as organisations, not sole traders, so a D-U-N-S number
  alone doesn't change it; a company founded later can take the app over by app transfer. Note the **Team ID**
  (developer.apple.com > Membership).
- **Google Play**: an organisation account needs the company's **D-U-N-S number** (free from Dun & Bradstreet,
  upik.de in Germany); use exactly the name and address the D-U-N-S record has. A personal account would instead
  need a closed test with 12 testers for 14 days before the app can go public.
- Both stores ask for the EU trader status: as a business, declare it; the store page then shows your address,
  phone and email.

### 2. App Store Connect API key (so the iPhone app is built and signed from GitHub)
App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys > **+**, role **Admin**.
Download the `.p8` file (only once possible), note the **Key ID** and the **Issuer ID**. In GitHub
(Settings > Secrets and variables > Actions) add the secrets:

| Secret | Value |
|---|---|
| `ASC_API_KEY_P8` | the whole content of the .p8 file |
| `ASC_KEY_ID` | Key ID |
| `ASC_ISSUER_ID` | Issuer ID |
| `APPLE_TEAM_ID` | Team ID |

and, if the Apple account is an organisation, the **variable** `APPLE_TEAM_TYPE` = `COMPANY_OR_ORGANIZATION`
(individual is the default).

### 3. The first builds (signing is set up once)
GitHub > Actions > **Store build** > Run workflow (platform `all`, profile `production`). The summary links to each
build on expo.dev (15 to 40 minutes).

If the first build stops at the signing ("credentials"), make it once from any computer with Node.js, which asks
the questions interactively and stores the answers on expo.dev for every later build:

```
npx eas-cli@latest login            # the Expo account of fratius-org
npx eas-cli@latest build -p ios     # signs in to Apple, creates certificate and profile
npx eas-cli@latest build -p android # creates the Android upload key, kept by EAS
```

(Run them in a copy of this repository: `git clone https://github.com/fratius/fleet-check && cd fleet-check && npm ci`.
They use the `production` profile of `eas.json`.) After that the GitHub workflow builds both without questions.

### 4. Notification keys (once)
- **iPhone**: EAS creates the push key when it sets up the iPhone signing (say yes when asked about push
  notifications), or later with `npx eas-cli credentials` > iOS > Push Notifications.
- **Android**: Firebase console > Project settings > Service accounts > **Generate new private key** (a JSON
  file). Upload it on expo.dev > fratius-org > fleet-check > Credentials > Android > `com.fratius.app` >
  **FCM V1 service account key**. The Store build workflow already adds the Android app to the Firebase project
  and builds with its `google-services.json`.

### 5. The store pages
Texts, categories, age rating, privacy answers and review notes: [listing.md](listing.md). Screenshots: take them
on a phone in the demo company (Account > Demo company), see listing.md.

### 6. Send for review
- **iPhone**: on the build's page on expo.dev, **Submit to store** (or `npx eas-cli submit -p ios`). It appears in
  App Store Connect > TestFlight after processing; test it there, then add it to the version and submit for
  review.
- **Android**: the first upload to Google Play is by hand: download the `.aab` from the build's page and upload it
  in the Play Console (Testing > Internal testing > Create release). Later ones can go through `eas submit` with a
  Google service account.
