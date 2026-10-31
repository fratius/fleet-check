# Publishing Fratius on the App Store, step by step

Checked against Apple's and Expo's documentation on 31 October 2026. Texts to paste are in
[listing.md](listing.md); the ready-made screenshots are in `fratius-store-screenshots.zip` (and can be made again,
see listing.md).

## What's ready in the app

- Name **Fratius**, bundle ID **com.fratius.app**, version **1.0.0**, iPhone only, built with Expo SDK 58 (EAS uses
  Xcode 26, which Apple has required since 28 April 2026; the app needs iOS 16.4 or later).
- Privacy manifest (the reasons for the "required reason" APIs, no tracking), no export-controlled encryption (so
  App Store Connect doesn't ask about it for each build).
- Permission texts (camera, photos, microphone) in all 32 languages, so the App Store lists the languages and
  drivers see the dialogs in theirs.
- Delete account in the app (Apple 5.1.1(v)), privacy policy linked in the app and at https://fratius.com/app-privacy.
- Notifications through Expo's push service (the key is made in step 3).

## Before you start

- **Your Apple Developer account is an individual account.** On the App Store the seller is shown as
  **Casian Dan Colto**, not "Fratius". That's normal and fine.
- **The D-U-N-S number won't turn it into an organisation account.** Apple only accepts legal entities (for
  example a GmbH or UG) as organisations; "sole proprietors and single-person businesses enroll as individuals",
  and trade names aren't accepted. As a sole trader (Einzelunternehmen, also as e.K.) you stay an individual. If
  you found a GmbH or UG later, enroll it as an organisation and move the app there with App Store Connect's
  **app transfer** (the app, its ratings and its users stay; notifications then need the new team's key). So
  don't wait for it: publish now.
- You need: your Apple ID (Account Holder, two-factor on), your iPhone, about an hour at a computer (Mac or
  Windows) for step 3, and a document showing your business name and address (your Gewerbeanmeldung) for step 1.
- Costs: nothing beyond the Apple membership. Expo's free plan includes a limited number of builds a month in a
  slower queue, enough for a release (a build can wait an hour or more in busy times).

## Step 1. Trader status for the EU (start today, Apple's check can take days)

Without it, the app isn't shown in the EU App Stores (Digital Services Act).

1. https://appstoreconnect.apple.com > **Business** (top) > **Agreements** tab > section **Compliance** >
   **Digital Services Act** > **Complete Compliance Requirements**.
2. Choose **This is a trader account.**
3. Enter the contact details to publish: Högerstrasse 15, 85646 Anzing, Germany; +49 176 31086313;
   info@fratius.com. They appear on the App Store page in the EU (they're already in your Impressum).
4. Confirm the email and the phone number with the codes Apple sends.
5. Upload your **Gewerbeanmeldung** (or another current document with your business name and address).
6. **Confirm.** Status "In Review" until Apple has checked it.

While you're in **Business > Agreements**: if a new Apple Developer Program License Agreement is waiting, accept
it, or nothing can be uploaded. The **Free Apps** agreement is active by default; Fratius is free, so you need no
paid-apps agreement, tax or bank details.

## Step 2. App Store Connect API key (once)

Lets the GitHub workflow build and upload new versions later without a computer.

1. App Store Connect > **Users and Access** > **Integrations** > **App Store Connect API** > **Team Keys** > **+**.
2. Name `GitHub`, access **Admin** > **Generate**.
3. **Download API Key** (a `.p8` file, downloadable only once) and note the **Key ID** and, above the list, the
   **Issuer ID**.
4. Your **Team ID**: https://developer.apple.com/account > **Membership details**.
5. GitHub > repository fleet-check > **Settings > Secrets and variables > Actions > New repository secret**, four
   times:

   | Name | Value |
   |---|---|
   | `ASC_API_KEY_P8` | open the .p8 file in a text editor and paste everything, including the BEGIN and END lines |
   | `ASC_KEY_ID` | the Key ID |
   | `ASC_ISSUER_ID` | the Issuer ID |
   | `APPLE_TEAM_ID` | the Team ID |

   Leave the variable `APPLE_TEAM_TYPE` unset (individual is the default).

## Step 3. The first build and upload, once from a computer (about an hour, mostly waiting)

Apple's certificate for signing the app can only be made the first time with your Apple login, which needs you
at the keyboard. After this, everything runs from GitHub.

1. Install **Node.js LTS** from https://nodejs.org and **Git** from https://git-scm.com (on a Mac, Git comes
   with the developer tools: type `git` in Terminal and accept the install).
2. Open Terminal (Mac) or PowerShell (Windows) and run:

   ```
   git clone https://github.com/fratius/fleet-check.git
   cd fleet-check
   npm ci
   npx eas-cli@latest login
   ```

   Log in with your Expo account (the one you use on expo.dev, a member of **fratius-org**).
3. Start the iPhone build:

   ```
   npx eas-cli@latest build --platform ios --profile production
   ```

   Answer:
   - "Do you want to log in to your Apple account?" **Yes**: your Apple ID, password, then the code on your iPhone.
   - Team: your own (individual) team.
   - "Generate a new Apple Distribution Certificate?" **Yes**.
   - "Generate a new Apple Provisioning Profile?" **Yes**.
   - "Would you like to set up Push Notifications for your project?" **Yes**, and "Generate a new Apple Push
     Notifications service key?" **Yes**.
   - Anything about the build number or remote versions: accept what it suggests (Enter). EAS counts the build
     numbers from now on.

   EAS registers com.fratius.app at Apple and starts the build on Expo's servers. When it shows the build link
   you can wait (15 to 40 minutes, longer in the free queue) or close the window; the build carries on, and its
   page on expo.dev shows when it's done.
4. When the build is finished, upload it:

   ```
   npx eas-cli@latest submit --platform ios --latest
   ```

   - Log in to Apple again if asked.
   - It creates the app **Fratius** in App Store Connect (if the name is taken, it stops: create the app by hand
     in App Store Connect under another name, for example "Fratius Fleet", with bundle ID com.fratius.app, and
     send me its Apple ID number).
   - "Generate a new App Store Connect API Key?" **Yes** (EAS keeps it for later uploads).
   - The build goes to App Store Connect and appears in **TestFlight** after Apple has processed it (5 to 30
     minutes; you get an email).
5. Send me the app's **Apple ID** (App Store Connect > the app > **App Information** > General Information >
   Apple ID, a number like 6740000000). I add it to `eas.json`; from then on **Actions > Store build** builds and,
   with "Send to TestFlight" ticked, uploads new versions by itself.

## Step 4. Test on your iPhone with TestFlight (no Apple review needed)

1. App Store Connect > the app > **TestFlight** > **Internal Testing** > **+** > a group "Team", add yourself
   (and anyone with an App Store Connect login).
2. Install **TestFlight** from the App Store on the iPhone, open the invitation email, **Install**.
3. Check before you submit:
   - Sign in, **Open a demo company** (or your real company).
   - Notifications: on the iPhone sign in as the demo **driver** (Account > Demo company shows the login), Account
     > **Notifications** > turn on. In the web app, signed in as yourself, give that driver another van: the
     notification arrives, and tapping it opens the van.
   - Record a pick-up **video** (720p, no sound) and take the walk-around **photos**; mark a video as damage.
   - Airplane mode: give a van or rename it; turn the connection back on: it goes through once.
   - **Delete account** with a throwaway login.
   - The permission dialogs appear in your phone's language.

## Step 5. A login for Apple's reviewers

Apple needs to sign in. In the web app (https://fleet-check-2aa34.web.app) or the TestFlight app:
**Create account** with `review@fratius.com` (no mailbox needed; an alias of info@fratius.com is nicer) and a
password you only use for this, then **Open a demo company**. Keep the email and password for step 7.

If a reviewer deletes this account (they sometimes try), sign up again with the same address and open a demo
company again.

## Step 6. Screenshots

From `fratius-store-screenshots.zip`: folder `ios-6.9/en` for English, `ios-6.9/de` for German, in their numbered
order. If App Store Connect asks for the 6.3" size separately, take `ios-6.3/...`. No iPad screenshots: the app is
iPhone only.

## Step 7. The App Store page (App Store Connect > Apps > Fratius)

Texts: [listing.md](listing.md). Fill in English first, then pick **German** in the language menu at the top
right of the page and fill in the German texts and screenshots.

**App Information** (left, under General):
- Name `Fratius`, Subtitle `Van handovers & damage checks` (German: `Fahrzeugübergabe & Schäden`).
- Category: **Business**, secondary **Productivity**.
- Content Rights: **No**, it doesn't contain, show or access third-party content.
- Age Rating > **Set Up Age Rating** (Apple's questionnaire since 2026):
  - In-app controls and capabilities: none apply (no parental controls or age assurance, no unrestricted web
    access, no public user-generated content, no messaging or chat, no advertising).
  - Social media: **No**.
  - Every content question (profanity, horror, mature themes, medical, alcohol and drugs, sexual content,
    violence, gambling, contests): **None**.
  - Age categories: **Not Applicable**. Result: **4+**.
- App Store Regulations and Permits: Digital Services Act > **Trader** (from step 1).

**Pricing and Availability**:
- Price **Free**.
- Availability: Germany and the other EU countries (all 27), plus Switzerland, Norway, the UK and any others you
  want. The EU countries only go live once the trader status is verified.

**App Privacy**:
- Privacy Policy URL `https://fratius.com/app-privacy`.
- **Get Started** > "Do you or your third-party partners collect data from this app?" **Yes**, then tick exactly
  the types in the table "Apple App Privacy" in listing.md. For each: used for **App Functionality** only,
  **linked to the user's identity**, **not used for tracking**. **Publish**.

**Version 1.0 (iOS App)**:
- Screenshots (step 6), Promotional Text, Description, Keywords, Support URL `https://fratius.com`, Marketing
  URL `https://fratius.com`.
- **Build**: **+** > choose the build from step 3. No encryption question comes up (the app declares it).
- Copyright `2026 Casian Dan Colto`.
- **App Review Information**: tick **Sign-in required**, enter the login from step 5; contact Casian Dan Colto,
  +49 176 31086313, info@fratius.com; Notes: paste the review notes from listing.md.
- **Version Release**: **Manually release this version** (you decide the day after approval).

## Step 8. Submit

**Add for Review** (top right) > check the summary > **Submit to App Review**. A first review usually takes one or
two days; you get emails at each step.

If Apple asks questions:
- "Your app is designed for a specific business" (guideline 3.2): answer with the five answers in listing.md.
  The point: any delivery company can sign up and create its company in the app.
- Login problems (2.1): check that the review login still works and still has its demo company.
- Anything else: send me the message from **App Review** (Resolution Center) and I'll prepare the answer or the
  fix.

## Step 9. After approval

1. **Release This Version** in App Store Connect. The app is in the App Store within a few hours.
2. Send me the App Store link: I put it on fratius.com (the "App Store" button) and into the invite pages.
3. Updates: every Deploy also updates the installed apps (the "production" channel), as long as no native package
   changed. A change that needs a new store version: Actions > **Store build** (platform ios, "Send to
   TestFlight") and submit the new version in App Store Connect like in steps 7 and 8.
