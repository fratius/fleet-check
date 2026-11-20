# What Fratius must do: the map the blind tester works from

This is what the app must do, written as what a person sees and does. It is the only description of the app the
blind tester gets (qa/TESTER.md): no code, no file names, no database names. It is also the rubric its report is
graded against, so every line has an id the report cites.

- **MUST**: the product owner's rule. Anything that breaks it is a finding.
- **SHOULD**: how it is meant to work. Report it when it doesn't.
- **LIMIT**: a known limit of the app or of the test system. Don't report it.

Where these lines come from: ROLES.md, FLEET_DATA.md and the product owner's decisions up to 20 Nov 2026.

**How this file changes** (checked by the Test workflow, `qa/guard.mjs`): a pull request that changes the app may
**add** lines for what it adds, written as the product owner asked for it. Changing or removing an existing line is
a decision about what the app must do, so it goes in a pull request of its own that changes nothing else.

## 0. The test system

- LIMIT 0.1 The tester uses the **web app** in a phone-sized Chrome against a test copy of the backend. The App Store
  and Google Play apps (their own camera screen, phone notifications, Expo Go) are not covered.
- LIMIT 0.2 **The AI answers are made up** on the test system: van type, damage spots, dashboard, documents, cards and
  receipts get plausible fake answers. Judge the flow around them (what is asked, saved, shown and to whom), never
  whether the AI was right.
- LIMIT 0.3 The camera is Chrome's fake camera (a moving test picture). The app's photo check may call those photos
  dark or blurred; the driver can still use them.
- LIMIT 0.4 No emails and no phone notifications leave the test system. Payments aren't set up there: plan and card
  screens may be missing or say so.
- LIMIT 0.5 Trial and demo companies have a daily AI allowance. When it's used up the app says so: that's correct.
- The tester can switch the browser's connection off and on (qa/TESTER.md, "No signal").

## 1. Who is who, and who sees what

- MUST 1.1 Four roles, from the top: **app creator** (runs Fratius, sees every company), **fleet owner** (one or more
  companies, all their stations), **fleet manager** (one station of one company), **driver** (one station).
- MUST 1.2 Nobody sees anything of a company they don't belong to: its vans, people, history, photos, records,
  numbers. Not through the screens, and not by opening a page's address directly. Only the app creator sees every
  company.
- MUST 1.3 A fleet manager sees only their own station: its vans, its drivers, its walk-arounds and checks, its
  history. Nothing of the company's other stations.
- MUST 1.4 A driver sees the vans of their station and **only their own** history, tours, refuels, record and
  incidents. Never another driver's history or record.
- MUST 1.5 A driver can't change vans, people, records or reviews, can't approve anyone or any damage, can't buy
  parts and can't allow their own refuel. Buttons for those aren't shown to a driver, and opening such a page by its
  address doesn't let them do it either.
- MUST 1.6 **What vans cost** (lease or monthly rate, purchase price, insurance premium) is seen by fleet owners only.
  Not managers, not drivers.
- MUST 1.7 Receipt amounts (fuel, wash, parts) are seen by owners and by the managers of that station, not by other
  drivers.
- MUST 1.8 AI speed, AI cost and the Test log tab are the app creator's only. Owners, managers and drivers never see
  AI prices or the Test log.
- MUST 1.9 Only the app creator picks a company's AI model and opens a demo company. Owners don't see either option.
- SHOULD 1.10 Tabs by role: Fleet, Review, People, Data (owners and managers), Test log (app creator), Account.
  Drivers see their vans and Account, not People management or Data.

## 2. Joining a company

- MUST 2.1 Nobody gets into a company without an owner's or a manager's action: a one-time invite they sent, or their
  approval of a sign-up.
- MUST 2.2 **Drivers join with the company's one driver link.** Owners and managers can see and share it (People).
  Only owners can make a new one, and then the old link stops working at once.
- MUST 2.3 Opening the driver link: the driver picks their station from the company's stations, gives first and last
  name (mobile number and Transporter ID optional), and makes an account or uses an existing one. That is a
  **request**: until it's approved they see nothing of the company, only "Waiting for approval".
- MUST 2.4 Owners decide requests for every station; a manager only for their own station; drivers never.
- SHOULD 2.5 The approver sees the name, the email and what else was given, and is warned when someone in the company
  already has the same Transporter ID.
- SHOULD 2.6 A rejected person can ask again after 24 hours, not before. The person can take a waiting request back.
- MUST 2.7 **Fleet managers join with one-time invite links** made by owners: one person, one use, valid 24 hours.
  A link used once doesn't work a second time, for anyone. Up to 20 can be made at once.
- SHOULD 2.8 Opening a manager invite shows who invited you, to which company, role and station, before you join.
- SHOULD 2.9 A new account without a link sees only "I have an invite link" or "Create a company".

## 3. Vans and the permanent history

- MUST 3.1 **One driver per van, one van per driver.** Giving a van to a driver who already has one, or giving a
  van that someone already has, is refused or first ends the other one, with a clear message. Never two at once.
- MUST 3.2 Vans go to drivers (or fleet managers) of the **van's own station**. Owners don't hold vans (the app
  creator's own sign-in is the one exception, see 13.3).
- SHOULD 3.3 Assigning works both ways: from the van ("Give to a driver") and from the person.
- MUST 3.4 **Every handover stays in the history for good**: which drivers a van had, which vans a driver had, when,
  who gave and who ended it, and from what km to what km where dashboard photos exist. Nobody can edit or delete a
  handover, a walk-around, a damage check or a company from the app.
- MUST 3.5 **Vans are retired, never deleted**, and can be brought back. A retired van keeps its history.
- MUST 3.6 Removing a person ends their handover and frees the van; their name stays on the history, their
  walk-arounds and checks stay.
- MUST 3.7 Only owners move vans between stations and change people's roles and stations. A move ends a handover that
  no longer fits (a driver of station A doesn't keep a van now at station B).
- SHOULD 3.8 Fleet shows which vans are free, which have a driver and who, and the retired ones. Vans are called by
  their **number plate**, never only by their model.
- SHOULD 3.9 The van page shows the km, fuel or battery and range from the latest dashboard photo, warning lights in
  a red box or "No warning lights"; "No km yet" in the fleet list without a photo.

## 4. Drivers pick up and drop off vans themselves

- MUST 4.1 **Off by default**, switched per station (People) by an owner or that station's manager. Where it's off, a
  driver can't pick up or drop off a van themselves.
- MUST 4.2 **Pick-up and drop-off need proof**: the full walk-around photo set (every photo, none skipped, taken with
  the camera) or one video of 8 seconds to 5 minutes. No proof, no handover. The same proof can't be used twice.
- MUST 4.3 A driver who has a van drops it off before picking up another.
- SHOULD 4.4 A van another driver still has can be taken over after a confirmation; the other driver's handover ends
  as taken over.
- SHOULD 4.5 A van given by a manager or owner asks the driver for pick-up photos or a video (a card on the driver's
  Vans tab). Managers see in Review when that proof is still missing after 2 hours.
- SHOULD 4.6 A missing video or photos can be added later: by the station's staff for any handover there, by a
  driver only for their own.

## 5. Walk-around and the AI damage check

- SHOULD 5.1 One "Start scanning" button asks "Scan with photos or a video?". Only the photo walk-around has the AI
  damage check.
- SHOULD 5.2 The camera guides each photo with an outline of the van; after each photo the app warns when it's too
  dark, too bright, has glare or is blurred, and offers a retake. The driver can still keep it (a pick-up must never
  get stuck).
- SHOULD 5.3 The AI check marks spots on the photos; for each spot the driver takes close-ups (straight on, low
  angle), then sends the check to the manager.
- MUST 5.4 **The AI only suggests.** No damage goes on a van's record until a fleet manager or owner approves it.
- MUST 5.5 **Uploads never ask anyone to take a photo or video again.** Photos are kept on the phone first and go up by
  themselves, also after the connection comes back or the app was closed.

## 6. Review and the damage record

- MUST 6.1 The fleet manager (or an owner) **has the final word**: approves or rejects every spot, can add damage the
  AI missed, finishes the review. A driver can't.
- SHOULD 6.2 Approved damage shows on the van's damage record (numbered dots on the van, tap for when, who had the
  van, before and after photos). One damage is one record ("Same as #N").
- SHOULD 6.3 Review lists what needs a decision: checks to review, missing handover proof, drivers waiting at the
  pump, warning lights, deadlines due soon, sign-up requests. The tab's badge counts what needs action.
- SHOULD 6.4 Owners and the station's managers can mark a walk-around or video as damage, and take the mark off.

## 7. Refuel, wash and parts

- SHOULD 7.1 Refuel and Wash buttons for drivers with a van of their station and for staff; "Buy parts" for owners
  and managers only. No Refuel on electric vans.
- SHOULD 7.2 Refuel: dashboard photo first, then (if the van has a fuel card) a photo of the card, then the receipt.
  The numbers are confirmed at the end.
- MUST 7.3 When the card isn't the van's, the driver sees "Stop. Don't start the pump", can call the station's
  managers, and waits. A manager allows or refuses; **nobody allows their own** (owners may).
- MUST 7.4 Flags (more litres than the tank holds, wrong fuel, another card, coffee on the receipt...) inform the
  manager and **never block** the driver.
- MUST 7.5 Every attempt stays on record: finished, refused, cancelled and never finished. Nothing is deleted.
- MUST 7.6 Fuel card photos are never kept; only the last 4 digits show.

## 8. Tours from dashboard photos

- SHOULD 8.1 Off until the owner turns dashboard photos on (Account). Then the driver photographs the dashboard at the
  start and end of each tour; the app reads km, fuel or battery, range and warning lights, the driver confirms.
- MUST 8.2 The odometer can't go down; a big jump needs a confirmation.
- SHOULD 8.3 Drivers see their own numbers only.

## 9. Records

- SHOULD 9.1 Van details (registration, contract, insurance, deadlines such as HU and UVV) for owners and the station's
  managers; the facts everyone at the station may see (VIN, fuel, size) on the van.
- MUST 9.2 Costs only for owners (1.6). A manager can't see or save money fields.
- SHOULD 9.3 "Fill in from a document": photos of a document fill the record's fields; **nothing is saved until "Save
  N details"**; every field can be corrected first.
- MUST 9.4 Driver records: licence classes and expiry, licence checks, briefings, emergency contact. Drivers read only
  their own. Nobody records a licence check for themselves. Licence numbers, birth dates and home addresses are not
  stored anywhere.
- MUST 9.5 Incidents (accidents, fines, complaints): managers add and correct them, **nobody deletes them**.

## 10. Data tab

- SHOULD 10.1 Owners and managers: Drivers, Tours, Vans and "Fuel, wash" tables for 7 / 30 / 90 days or this year,
  per station, sortable, with a totals row, and "Download for Excel".
- MUST 10.2 A manager's tables hold only their station. Owners alone see € a month and € per km per van.
- SHOULD 10.3 "Who was driving?": van + day + time gives the driver from the history.

## 11. Without a connection

- MUST 11.1 **Nothing is done twice because of a bad connection.** A change made offline (giving a van, renaming it,
  an incident, a walk-around) waits on the phone, shows as waiting, and goes through **once** when the connection is
  back. The same action isn't offered again while one is waiting.
- SHOULD 11.2 The app opens without a connection, showing what this phone last saw, with a "No connection" strip.
- MUST 11.3 The "No connection" strip never shows on a working connection.
- SHOULD 11.4 A change that conflicts with one someone else made meanwhile stops with its reason instead of
  overwriting it (for example a van given away offline that someone else gave meanwhile).

## 12. Languages

- SHOULD 12.1 32 languages. The app starts in the browser's language if it has it, else English. Account → Language
  changes it, and the choice follows the person to another phone.
- SHOULD 12.2 Every text of the app is translated. Names, plates, what people typed and what the AI wrote stay as they
  are. German legal names (HU, UVV, Betriebsrat, Fahrzeugschein) stay German in every language.
- SHOULD 12.3 Arabic and Persian: the web app is right to left.
- SHOULD 12.4 Long words (German, Romanian, Hungarian) don't overflow buttons, tabs or tables.
- LIMIT 12.5 The translations are AI-made and haven't been checked by native speakers: report broken sentences,
  placeholders like `{name}` shown as text, or English left in a translated screen; not word choice.

## 13. Account

- MUST 13.1 Everyone deletes their own account (Account tab), after entering the password again. The company keeps
  its records with the person's name. The only owner of a company with other people hands it over first; an owner
  who is the only member closes the company. The app creator can't delete their account in the app.
- SHOULD 13.2 Account shows the version (commit and build time).
- MUST 13.3 **View as** (app creator only): view the open company as a fleet owner, fleet manager or driver of one
  station, and then see and do exactly what that role can, nothing more. Switching back restores everything. What
  they do while viewing is real. The app creator's own sign-in (and nobody else's) can be given a van and allow
  their own stopped refuel as a fleet manager, to try both sides.
- SHOULD 13.4 Signing out with changes still waiting on the phone says so first.

## 14. Everywhere

- MUST 14.1 **What failed is said as it is.** On a working connection no screen blames the connection; a refusal says
  why. No raw error codes or JSON on screen.
- MUST 14.2 No blank or stuck screens, no crash, no endless spinner. Back always works; reloading any page keeps you
  where you were (or on a page that makes sense).
- MUST 14.3 Opening the address of something you may not see (another company's van, another station's driver) shows
  a refusal or "not found", never the data.
- MUST 14.4 Tapping a button twice, or in two tabs at once, does the thing once.
- SHOULD 14.5 Everything works on a phone-sized screen (390 × 844) without sideways scrolling, and on a desktop.
- SHOULD 14.6 Every action that takes a while shows that it's working, and the result.
