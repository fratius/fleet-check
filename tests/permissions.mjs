// The permission table (blind test, 26 Nov 2026, cause 2): who may call each server action and who may write each
// collection from the app, as ROLES.md says. Two tests hold it:
// - tests/permissions.test.mjs (Node, no emulators): every exported server action and every collection the rules
//   let the app write has a line here (and no line is left over), each level is actually checked in the code, and the
//   rules tests refuse a write to every collection at least once. A new action or rule without a line fails.
// - tests/history.test.mjs ("the permission table"): calls every action, on the emulators, as each person who must be
//   refused (someone outside the company, a driver, a fleet manager, the owner, a manager or driver of the other
//   station, another driver of the same station) and expects "permission-denied" every time.
//
// Levels (who may, at the least):
//   creator  only the app creator (sweeps run by hand, demo companies, launch offers)
//   self     any signed-in person, about their own account (no company to be refused from)
//   owner    the company's fleet owner (and the app creator)
//   staff    fleet managers (their station) and owners
//   member   anyone in the company, drivers included (their station)
// Flags:
//   station  the action is about one station's van, walk-around, check, person or handover: a manager or driver of
//            another station is refused (the code calls needStation or staffAt)
//   own      a driver only for their own: the walk-arounds and checks of their own photos (needPhotoTaker), their own
//            handover (else staff of the station); another driver of the same station is refused
//   via      helper functions where the action's checks live (searched together with the action's own code)
//   probe    the call (orgId added) that reaches the station check with a real target of station 1 (w = the world
//            the history test built, me = the caller's account id); without it, only outsiders and lower roles are
//            tried (the other refusals of those actions are in their own tests)
//
// Levels follow ROLES.md; a change to who may do something changes this table, ROLES.md and the code together.

export const ACTIONS = {
  // Only the app creator
  closeupSweepNow: { level: 'creator' },
  routineSweepNow: { level: 'creator' },
  appointmentSweepNow: { level: 'creator' },
  serviceSweepNow: { level: 'creator' },
  cleanMediaNow: { level: 'creator' },
  cardLaterSweepNow: { level: 'creator' },
  setLaunchOffer: { level: 'creator' },
  saveOffer: { level: 'creator' },
  createDemoCompany: { level: 'creator' },

  // About one's own account
  peekInvite: { level: 'self' },
  acceptInvite: { level: 'self' },
  requestToJoin: { level: 'self' },
  withdrawJoinRequest: { level: 'self' },
  createCompany: { level: 'self' },
  deleteAccount: { level: 'self' },
  billingConfig: { level: 'self' },

  // Fleet owners
  setupStations: { level: 'owner' },
  moveVan: { level: 'owner' },
  changePerson: { level: 'owner' },
  deleteDemoCompany: { level: 'owner' },
  billingStart: { level: 'owner' },
  billingConfirm: { level: 'owner' },
  billingTrial: { level: 'owner' },
  billingPortal: { level: 'owner' },
  changePlan: { level: 'owner' },

  // Fleet managers (their station) and owners
  identifyVehicle: { level: 'staff', station: true, probe: (w) => ({ stationId: w.s1, paths: [`orgs/${w.org}/scans/probe/1.jpg`] }) },
  compareWalk: { level: 'staff', station: true, probe: (w) => ({ walkId: w.walk1 }) },
  createInvite: { level: 'staff', station: true, probe: (w) => ({ role: 'driver', stationId: w.s1, count: 1 }) },
  decideJoinRequest: { level: 'staff', station: true, probe: (w) => ({ uid: w.asker, approve: false }) },
  assignVan: { level: 'staff', station: true, probe: (w) => ({ vehicleId: w.van1, driverId: w.d1 }) },
  retireVan: { level: 'staff', station: true, probe: (w) => ({ vehicleId: w.van1 }) },
  removePerson: { level: 'staff', station: true, probe: (w) => ({ uid: w.d2 }) },
  setSelfAssign: { level: 'staff', station: true, probe: (w) => ({ stationId: w.s1, on: false }) },
  recordLicenceCheck: { level: 'staff' },
  logReview: { level: 'staff', station: true, probe: (w) => ({ checkId: w.check1 }) },
  syncDamageLog: { level: 'staff' },
  readDocument: { level: 'staff', station: true },
  readFleetFile: { level: 'staff' },
  addVans: { level: 'staff' },
  routine: { level: 'staff', station: true },
  service: { level: 'staff', station: true },
  appointment: { level: 'staff', station: true },
  markDamage: { level: 'staff', station: true },
  driverLink: { level: 'staff' },

  // Everyone in the company, drivers included, at their station
  findDamage: { level: 'member', station: true, own: true, probe: (w) => ({ walkId: w.walk1 }) },
  checkSpot: { level: 'member', station: true, own: true, probe: (w) => ({ checkId: w.check1, spot: 0, closeups: [`orgs/${w.org}/checks/${w.check1}/probe.jpg`] }) },
  submitCheck: { level: 'member', station: true, own: true, probe: (w) => ({ checkId: w.check1 }) },
  // The photos or video are checked before the van (pick-ups and drop-offs have their own tests of the station).
  pickUpVan: { level: 'member', station: true, via: ['selfService'] },
  dropOffVan: { level: 'member', station: true, via: ['selfService'] },
  addHandoverVideo: { level: 'member', station: true, own: true, probe: (w) => ({ assignmentId: w.assign1, kind: 'pickup', videoId: 'probe' }) },
  addHandoverPhotos: { level: 'member', station: true, own: true, probe: (w) => ({ assignmentId: w.assign1, kind: 'pickup', walkId: w.walk1 }) },
  addVanVideo: { level: 'member', station: true, probe: (w) => ({ vehicleId: w.van1, videoId: 'probe' }) },
  processVideo: { level: 'member', station: true },
  readDashboard: { level: 'member', station: true, via: ['readingContext'] },
  saveReading: { level: 'member', station: true, via: ['readingContext'] },
  purchase: { level: 'member', station: true, via: ['buyStart'], probe: (w, me) => ({ action: 'start', kind: 'fuel', vehicleId: w.van1, path: `orgs/${w.org}/buys/${me}/probe.jpg` }) },
  routineDone: { level: 'member', station: true },
};

// Collections the rules let the app write, and who may (the rules decide; tests/rules.test.mjs proves each refusal).
export const WRITES = {
  users: 'self: their own profile, never the server-only fields',
  push: 'self: their own phone notification addresses',
  invites: 'owner: cancels an invite',
  orgs: 'self creates a company (no live payments); owner changes it',
  stations: 'owner',
  members: 'self: the first owner of a new company, and their own language and settings',
  vehicles: 'staff of the station',
  vehicleDetails: 'staff of the station',
  vehicleCosts: 'owner',
  driverRecords: 'staff of the station',
  incidents: 'staff of the station',
  walkarounds: 'member of the station, as themselves',
  checks: 'staff of the station: the review only, locked once finished except to reopen it',
  damageNotes: 'staff of the station',
  scans: 'staff',
};

export const LEVELS = ['creator', 'self', 'owner', 'staff', 'member'];
