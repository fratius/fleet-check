# Roles in Fleet Check

This is the access model of the app. Every feature follows it: before building something, decide what each
role sees and can do, then enforce it in three places (Firestore rules, Cloud Functions, screens) and test it.

## The hierarchy

1. **App creator** (the person who runs Fleet Check). Sees every company and can open and manage any of them.
   Given by the sign-in claim `creator`, set on each deploy for the emails in the GitHub variable
   `APP_CREATOR_EMAILS` (default `casian.colto@gmail.com`).
   **View as:** in the Account tab the app creator (and nobody else) can view the open company as a fleet owner,
   a fleet manager or a driver of one station (`users/{uid}.viewAs = {org, role, st}`). The rules, Storage rules
   and Cloud Functions then treat them exactly as that role in that company and nowhere else; their app creator
   access is off until they switch back. It only takes access away, and the field means nothing without the
   `creator` claim (the rules also refuse it from anyone else). What they do while viewing is real and saved under
   their own name (walk-arounds, pick-ups in the permanent history, reviews, invites); try things in the demo
   company. As a driver they aren't a real member, so nobody can give them a van; they can pick one up where the
   station allows it.
   **AI speed, AI cost and the Test log are theirs only** (not owners, managers or drivers, and not the app creator
   while viewing as someone): the speed and cost of each damage check are kept in `orgs/{org}/checkUsage`, type scans
   (which carry cost) in `orgs/{org}/scans`, both readable only by the app creator; the functions leave them out of
   their answers for everyone else. Older checks had them inside; the Deploy workflow moves them out.
2. **Fleet owner** (member role `owner`; `admin` is its old name). Owns one or more companies (DSPs).
   Sees all stations of their company. Adds and removes stations, fleet managers, drivers and vans; moves people
   and vans between stations; picks the AI model; can review damage at any station. Turns dashboard photos on or
   off and sets how often licences are checked. **The only role that sees what vans cost.**
3. **Fleet manager** (role `manager`). Same powers as the owner, limited to their station (operating area) and
   its drivers: adds, edits and removes vans there, invites and removes drivers there. Cannot add stations or
   managers. **Has the final word on damage**: approves or rejects every spot the AI found, adds damage it
   missed, finishes the review. Approved damage goes on the van's damage record.
4. **Driver** (role `driver`). Scans: sees the vans of their station, does walk-arounds, runs the AI damage
   check and takes close-ups at the van, then sends the check to the manager. Where the station allows it, picks
   up and drops off vans themselves (see below). Where the owner turned dashboard photos on, photographs the
   dashboard at the start and end of each tour. Reads their own record, tours and incidents. Cannot change vans,
   people, records or reviews.

## How it is built

- A company has stations (`orgs/{org}/stations`). Every van, walk-around and damage check has a `stationId`.
- Membership is `orgs/{org}/members/{uid}` with `role` and `stationIds`. People can belong to several companies
  (`users/{uid}.orgIds`).
- Managers and drivers only query their stations: `where('stationId', 'in', stationIds)`. Owners and the app
  creator read everything.
- Damage checks are written by the server. From the app, only owners and managers of the station can write the
  `review` and `status` of a check.
- **Joining is by invite link only.** Owners make links for managers and drivers; managers make links for drivers
  of their station. One link is for one person, works once, and expires 24 hours after it was made. Several can
  be made at once. The link opens the join page, which asks for the person's details (name, mobile, Transporter
  ID for drivers), creates their account, then shows how to put the app on the home screen. Links are made and
  used by Cloud Functions (`createInvite`, `peekInvite`, `acceptInvite`); the app can only list and cancel them.

## Vans, drivers and history (permanent: do not change)

These rules were set by the product owner and must stay as they are. A change that would break one of them needs
the product owner's explicit decision first.

- **A van has at most one driver at a time, and a driver has at most one van.** Vans go to drivers (or fleet
  managers) of the van's station. Fleet owners don't hold vans.
- **Every assignment is a record** in `orgs/{org}/assignments`: van, driver, station, `start`, `end` (null while it
  lasts), who started and who ended it, why it ended (`endReason`), and the pick-up and drop-off photos
  (`startWalkId`, `endWalkId`) when the driver picked the van up themselves.
- **History is permanent.** Assignments are written only by Cloud Functions, never by the app, and never edited
  or deleted; the only change is closing an open one. They are the history of every van (which drivers it had)
  and of every driver (which vans they had).
- **Nothing that belongs to the history is deleted.** Vans are retired, never deleted (`retireVan`; they can be
  brought back). Walk-arounds, damage checks and companies can't be deleted from the app. Removing a person
  (`removePerson`) ends their assignment and frees the van; their history, walk-arounds and checks stay.
- **Who changes it, all on the server:** owners and managers of the station give a van to someone or make it
  free (`assignVan`); retire or bring back a van (`retireVan`). Only owners move vans between stations
  (`moveVan`) and change people's roles and stations (`changePerson`); both end assignments that no longer fit.
  Owners remove anyone, managers remove drivers of their station (`removePerson`).
- **Who sees it:** owners see all history; managers the history at their stations; drivers only their own
  assignments (the van they have and the vans they had), never other drivers' history.
- **Fleet shows free and assigned vans:** owners and managers see which vans are free, which have a driver and
  who, and the retired ones. Drivers see the van they have.

### Drivers pick up and drop off vans themselves (per station)

For DSPs that assign vans in Amazon's tools and just tell drivers which van to take.

- **Off by default.** The owner (any station) or a fleet manager (their station) switches it on under People
  (`setSelfAssign`, which records who changed it and when). Where it's off, only staff hand out vans.
- **Pick up and drop off need proof: the photos or a video.** Either every photo of the van's walk-around, taken
  with the camera by that driver, none skipped, uploaded in the last two hours, of that van, used for one handover
  only (marked `handover` on the walk-around by the server); **or one video** walking around the van, recorded by
  that driver, 8 seconds to 5 minutes long, recorded and uploaded in the last two hours, used once. The server
  checks it (`pickUpVan`, `dropOffVan`) before anything changes. A drop-off always needs one of the two.
- **Videos:** uploaded as recorded to `videos/{uploader}/{id}/original.*` in Storage (only into your own folder);
  the server writes the video record (`orgs/{org}/videos`) and makes a 720p playback copy (`processVideo`). Owners
  and the station's managers watch every video of their station's vans; drivers watch their own. Nobody edits or
  deletes them.
- **Walk-around videos** (`addVanVideo`): anyone who can scan a van (its station's drivers and managers, owners)
  can film it instead of taking the photos, at any time and whatever the station's pick-up setting. Same checks as
  a handover video. It is kept with the van and notes the driver who had it then; it doesn't pick up or drop off
  anything.
- **A missing video or photos can be added later** (`addHandoverVideo`, `addHandoverPhotos`): by the station's
  owner or managers for any handover of the station, or by the driver for their own. One per end of a handover. It
  points to the handover (the photos' walk-around is marked `handover`); the handover itself doesn't change.
- **A van given by a manager or owner asks the driver for pick-up proof** (any station): the assignment is marked
  `pickupRequested`, the driver is told on their phone (if they turned notifications on) and in the app (a card on
  the Vans tab and the van's page, a badge on the tab), and adds the pick-up video or photos as above. That's the
  normal pick-up, not "added later". A manager who takes a van themselves isn't asked.
- **Phone notifications** (web push): only for the web app (Chrome on Android; on iPhone only from the home screen,
  iOS 16.4 or later), not Expo Go. Each person turns them on per phone in the Account tab
  (`users/{uid}/push/{id}`, only theirs, only real push services). The key pair is the `WEBPUSH_KEYS` secret, made
  once by the Deploy workflow; the public half is in `config/push`. For now only "a van was given to you" is sent.
- **Managers are told when handover proof is missing:** the Review tab lists (and its badge counts) vans given to
  a driver more than 2 hours ago without the pick-up video or photos; and at pick-up-yourself stations, handovers
  of the last 7 days that ended without the driver's drop-off (taken over, or ended by a manager) and vans a driver
  has had for more than 14 hours. This part is in the app only.
- A driver who has a van drops it off before picking up another.
- A van another driver still has (they didn't drop it off) can be taken over after a confirmation; their
  assignment ends as "taken over" with the new driver's photos.
- Pick-ups and drop-offs are ordinary assignments in the same permanent history, marked as done by the driver.

### Tests that guard these rules

- `tests/rules.test.mjs`: what each role can read and write, including that nobody writes history.
- `tests/history.test.mjs`: the whole flow on the emulators (sign-in, rules, functions, storage): assigning,
  reading history per role, pick-up and drop-off with photos, takeover, retiring, moving and removing, driver
  records and licence checks, tours from dashboard photos, the damage log, moving costs, and the demo logins.
  Deploy stops if either fails.

## Van and driver records (FLEET_DATA.md)

| Record | Owner | Manager (own station) | Driver | Written by |
|---|---|---|---|---|
| Van facts (on the van) | read, write | read, write | read | the app |
| Van business record `vehicleDetails` | read, write | read, write | no | the app; odometer also the server |
| Van costs `vehicleCosts` | read, write | **no** | no | the app |
| Driver record `driverRecords/{uid}` | read, write | read, write | their own, read only | the app; licence checks only the server |
| Incidents `incidents` | read, add, correct | read, add, correct | their own, read only | the app; never deleted |
| Tours `tours`, readings `readings` | read | read | their own | the server only |
| Damage log `damageLog` | read | read | the ones they're in | the server only |
| What the AI read first `dashReads` | no | no | no | the server; app creator reads |

- **The van's facts** (VIN, registration, fuel, tank, size, breakdown and accident numbers) are on the van:
  everyone at its station reads them; owners and the station's managers change them.
- **The business side** (contract, insurance terms, deadlines, odometer, fuel card, notes) is in
  `orgs/{org}/vehicleDetails/{vehicleId}`: only owners and the van's station managers. It carries the van's
  station, which must match the van; `moveVan` moves it with the van. The rules refuse money fields in it.
- **Costs** (monthly rate, purchase price, price per extra km, insurance premium and deductible) are in
  `orgs/{org}/vehicleCosts/{vehicleId}`: owners only (and the app creator; not while viewing as a manager).
  Older records had them in `vehicleDetails`; the Deploy workflow moves them (`functions/scripts/move-costs.cjs`).
- **Driver records** carry the driver's station; `changePerson` moves the record with the driver. Licence checks
  are added only by `recordLicenceCheck` (owners and the driver's station managers, never for themselves) and are
  never changed. Nobody deletes a record.
- **Tours** need the company setting `dashScans` (owner). The driver who has the van (or whose tour on it is still
  open) starts and ends their tours; the station's staff can end a tour a driver left open. `readDashboard` and
  `saveReading` check all of it; the odometer can't go down and big jumps need a confirmation.
- Deadlines (vans and drivers), warning lights and tours without their photos show to owners and managers only:
  on the van or person, in the fleet list, and in Review.

## The damage record of a van

- Each van page shows the van in 3D with a numbered dot on every approved damage, and the damage list under it,
  newest first. The dot is placed from where the damage is in the walk-around photo (the frame outline tells
  which part of the van the photo shows); damage a manager added by hand is placed from its panel name (rough,
  shown with a dashed dot).
- **One damage is one record.** The first check that finds it starts it; when a later check finds it again, the
  manager links it in the review ("Same as #N", which the app suggests from the position). Without the link it
  counts as new damage.
- **When:** between the last walk-around of the van without it and the walk-around it was found in.
  **Who:** the drivers who had the van in that time, from the assignment history. That's who had the van, not
  proof; the before and after photos (the same part of the van in both walk-arounds) are the proof.
- **Who sees what:** everyone at the station sees the damage, where it is and the photos. Owners and the
  station's managers also see who had the van and the comments. Drivers only see whether they had the van then.
- **Comments** on a damage: owners and the station's managers write them (`orgs/{org}/damageNotes`); they are
  kept for good, nobody edits or deletes them.

## Checklist for every change

- [ ] Which roles see it? Which can change it? Write it down in the PR or commit.
- [ ] Firestore rules (`firestore.rules`) allow exactly that, scoped by company and station.
- [ ] Tests in `tests/rules.test.mjs` prove each role's access, including what must fail.
- [ ] Cloud Functions check the role and station (`guard`, `needStaff`, `needStation`) before doing anything.
- [ ] Screens hide what a role can't do (`s.role`, `s.staff`, `s.runs(stationId)`), but never rely on hiding.
- [ ] New records that belong to a place carry a `stationId`.
- [ ] Nothing breaks the van and driver history rules above: no deletes of history, vans, walk-arounds or
      checks; assignments only through Cloud Functions; one van per driver and one driver per van.
- [ ] Test mode can show each role: `FLEET_TEST_MODE=1 FLEET_TEST_ROLE=manager|driver`.
