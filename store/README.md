# Fratius in the App Store and Google Play

The phone app is the same code as the web app, built by EAS (Expo's build servers) as **Fratius**,
`com.fratius.app`, version 1.0.0. The texts for the store pages, the privacy answers and the review notes are in
[listing.md](listing.md). **For the App Store, follow [APP-STORE.md](APP-STORE.md) step by step**; this page is
the overview, with Google Play.

## What's ready in the code

- Name, bundle ID and package `com.fratius.app`, iPhone only (no iPad layout), permission texts (camera, photos;
  videos are recorded in the app at 720p without sound) in all 32 languages (`locales/ios`), the iPhone privacy
  manifest, no export-controlled encryption. `eas.json`: `production` builds for the stores,
  `preview` for the Android test version on fratius.com/android (below). Build numbers are counted by EAS.
- **Account deletion in the app** (Account tab, and on the first screen for people without a company), and the
  page for Google Play: https://fratius.com/delete-account
- **Privacy policy of the app**: https://fratius.com/app-privacy, linked in the app (Account tab, sign-in screen).
- **Notifications in the store app** through Expo's push service (they need the keys of step 4).
- **Photos and videos deleted on the 15th for the month before, never while the van is with its driver, damage after 90 days**, as the privacy policy says.
- **Updates without a new store version**: every Deploy also sends the update to the store app ("production"
  channel), as long as no native package changed (`scripts/native.mjs`; Deploy warns when one did: then raise the
  version in `app.json`, run `node scripts/native.mjs --write` and make new store builds).

- **The store apps sell nothing.** Sign-up with the card and 30 days free, plans and payment (Stripe) happen on
  fratius.com and in the web app only; once payments are live the store apps only join companies. The iPhone and Android apps show no prices, plans, payment buttons or links to them
  (Apple 3.1.3(c) enterprise services; Google Play "consumption-only"): trial and plan texts are web-only
  (`Platform.OS === 'web'`). Keep it that way, or the review will ask for in-app purchases.

## Android test version (until Fratius is in Google Play)

For the pilot DSPs (product owner, 10 Nov 2026): the Android app as a file from **https://fratius.com/android**,
installed from the browser. The page isn't linked from the website or in the sitemap (`noindex`); send the address
to the test DSPs. Anyone with the address can download the file, but it's no use without an account in a company.

- It is the same app as the store builds (`eas.json` profile `preview`: an `.apk`, `STORE_BUILD=1`, channel
  `production`), so it gets every Deploy's update on its next start, like the App Store app. Sign-up with the card,
  custom offer links and payment stay on the web; the test version, like the store apps, shows no prices or plans.
- A new **app version** (a new native package or SDK, when Deploy warns "Store app not updated") needs a new file:
  raise the version, `node scripts/native.mjs --write`, then build it (below). The app asks
  `fratius.com/downloads/android.json` for the newest version and shows **A new version of the app is ready** with
  **Download** above the tab bar (`src/lib/apk.ts`, `components/apkstrip.tsx`); the Account tab shows "Android test
  version". Installed over the old one, the person stays signed in and keeps what waits to be sent.
- **Building it**: Actions > **Store build** > Run workflow, profile `preview` (always Android). It waits for EAS,
  then starts Deploy, which puts the file on the website (`scripts/website-apk.sh`, in the "Web app" job). Every
  Deploy takes the newest finished `preview` build from EAS; if that can't be downloaded it keeps the file the
  website already serves.
- **Before the first build, once**: the Android upload key, kept by EAS (from a computer with Node.js, in a copy of
  this repository): `npx eas-cli@latest credentials -p android` > `production` > Keystore > **Set up a new
  keystore**. It's the same key Google Play will use as the upload key. Then the notification key of step 4
  (Android), so push notifications reach the test version.
- **When Fratius is in Google Play**: tell the testers to check that nothing waits to be sent, uninstall the test
  version, and install Fratius from Google Play (Google re-signs the Play app with its own key, so it can't install
  over the file's version). Then delete `website/android.html`, the "Android test app for the website" steps in
  `deploy.yml` with `scripts/website-apk.sh`, the `/downloads` and `/android` headers in `firebase.json`, and
  `src/lib/apk*.ts` with `components/apkstrip.tsx`. Until the code is removed nothing shows in the app: without
  `android.json` on the website there is no newer version to offer.

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
