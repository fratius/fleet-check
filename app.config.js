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
  const projectId = (extra.eas && extra.eas.projectId) || process.env.EAS_PROJECT_ID;
  if (projectId) {
    extra.eas = { ...(extra.eas || {}), projectId };
    config.updates = { ...(config.updates || {}), url: `https://u.expo.dev/${projectId}` };
  }
  return { ...config, extra };
};
