// Adds settings that come from the deploy workflow, so they never need to be typed into app.json:
//   FIREBASE_WEB_CONFIG  the Firebase web app config (public identifiers, not secrets), as JSON
//   EAS_PROJECT_ID       the Expo project the phone app is published to
// Without them the app runs in test mode on the phone: no sign-in, no AI, data stays on the device.
module.exports = ({ config }) => {
  const extra = { ...(config.extra || {}) };
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
