# Roles in Fleet Check

This is the access model of the app. Every feature follows it: before building something, decide what each
role sees and can do, then enforce it in three places (Firestore rules, Cloud Functions, screens) and test it.

## The hierarchy

1. **App creator** (the person who runs Fleet Check). Sees every company and can open and manage any of them.
   Given by the sign-in claim `creator`, set on each deploy for the emails in the GitHub variable
   `APP_CREATOR_EMAILS` (default `casian.colto@gmail.com`).
2. **Fleet owner** (member role `owner`; `admin` is its old name). Owns one or more companies (DSPs).
   Sees all stations of their company. Adds and removes stations, fleet managers, drivers and vans; moves people
   and vans between stations; picks the AI model; can review damage at any station.
3. **Fleet manager** (role `manager`). Same powers as the owner, limited to their station (operating area) and
   its drivers: adds, edits and removes vans there, invites and removes drivers there. Cannot add stations or
   managers. **Has the final word on damage**: approves or rejects every spot the AI found, adds damage it
   missed, finishes the review. Approved damage goes on the van's damage record.
4. **Driver** (role `driver`). Only scans: sees the vans of their station, does walk-arounds, runs the AI damage
   check and takes close-ups at the van, then sends the check to the manager. Cannot change vans, people or
   reviews, and doesn't see costs or the test log.

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

## Checklist for every change

- [ ] Which roles see it? Which can change it? Write it down in the PR or commit.
- [ ] Firestore rules (`firestore.rules`) allow exactly that, scoped by company and station.
- [ ] Tests in `tests/rules.test.mjs` prove each role's access, including what must fail.
- [ ] Cloud Functions check the role and station (`guard`, `needStaff`, `needStation`) before doing anything.
- [ ] Screens hide what a role can't do (`s.role`, `s.staff`, `s.runs(stationId)`), but never rely on hiding.
- [ ] New records that belong to a place carry a `stationId`.
- [ ] Test mode can show each role: `FLEET_TEST_MODE=1 FLEET_TEST_ROLE=manager|driver`.
