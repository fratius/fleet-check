// Adds settings that come from the deploy workflow, so they never need to be typed into app.json:
//   FIREBASE_WEB_CONFIG  the Firebase web app config (public identifiers, not secrets), as JSON
//   EAS_PROJECT_ID       the Expo project the phone app is published to
// Without Firebase settings the app runs in test mode: no sign-in, no AI, data stays on the device.
module.exports = ({ config }) => {
  const extra = { ...(config.extra || {}) };
  // FLEET_TEST_MODE=1 builds the app without Firebase, for testing on a computer with no backend.
  if (process.env.FLEET_TEST_MODE === '1') {
    delete extra.firebase;
    // FLEET_TEST_ROLE=manager|driver shows test mode as that role.
    if (process.env.FLEET_TEST_ROLE) extra.testRole = process.env.FLEET_TEST_ROLE;
  }
  if (process.env.FIREBASE_WEB_CONFIG && !(extra.firebase && extra.firebase.apiKey)) {
    extra.firebase = JSON.parse(process.env.FIREBASE_WEB_CONFIG);
  }
  // FLEET_EMULATORS=1 points the app at the Firebase emulators on this computer (npm run emulators):
  // sign-in, data, photos and functions all stay local, under a demo project that never touches the real one.
  if (process.env.FLEET_EMULATORS === '1') {
    extra.firebase = { ...(extra.firebase || {}), apiKey: 'demo-key', appId: '1:1:web:1', projectId: 'demo-fleet-check', authDomain: 'demo-fleet-check.firebaseapp.com', storageBucket: 'demo-fleet-check.appspot.com' };
    extra.emulators = process.env.FLEET_EMULATOR_HOST || '127.0.0.1';
  }
  const projectId = (extra.eas && extra.eas.projectId) || process.env.EAS_PROJECT_ID;
  if (projectId) {
    extra.eas = { ...(extra.eas || {}), projectId };
    config.updates = { ...(config.updates || {}), url: `https://u.expo.dev/${projectId}` };
  }
  // Which version this is (the commit and when it was built), shown in the Account tab, so the phone app and the
  // web app can be compared: Expo Go only switches to a new version the next time it starts.
  extra.build = { sha: (process.env.GITHUB_SHA || '').slice(0, 7) || 'dev', at: new Date().toISOString() };
  return { ...config, extra };
};
