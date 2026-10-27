// The native packages in the App Store and Google Play app, so an update never reaches an app that lacks one.
//
// Updates (Deploy, channel "production") go to the app version ("1.0.0" in app.json). A store app of that version
// has the native code of the packages listed in store/native.json. A JavaScript update that needs a native package
// the app doesn't have would crash it, so:
//   node scripts/native.mjs --write   after raising the version in app.json: records the packages for the new builds
//   node scripts/native.mjs --check   fails if the packages or the version differ from store/native.json
//                                     (the Store build workflow runs it; Deploy runs it before sending an update)
// Expo Go isn't affected: it has every Expo package and gets its own updates on the "main" channel.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo.version;

/** A package has native code when autolinking would pick it up: an Expo module, or an android/ios folder or podspec. */
function isNative(dir) {
  if (existsSync(join(dir, 'expo-module.config.json'))) return true;
  if (existsSync(join(dir, 'android')) || existsSync(join(dir, 'ios'))) return true;
  return readdirSync(dir).some((f) => f.endsWith('.podspec'));
}

function current() {
  const out = {};
  for (const name of Object.keys(pkg.dependencies || {}).sort()) {
    const dir = join(ROOT, 'node_modules', name);
    if (!existsSync(join(dir, 'package.json'))) throw new Error(`${name} isn't installed: run npm ci first.`);
    if (isNative(dir)) out[name] = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  }
  return out;
}

const file = join(ROOT, 'store', 'native.json');
const now = { version, packages: current() };

if (process.argv.includes('--write')) {
  mkdirSync(join(ROOT, 'store'), { recursive: true });
  writeFileSync(file, JSON.stringify(now, null, 2) + '\n');
  console.log(`store/native.json: version ${version}, ${Object.keys(now.packages).length} native packages.`);
} else {
  const was = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const diff = [];
  if (!was) diff.push('store/native.json is missing');
  else {
    if (was.version !== version) diff.push(`app.json says version ${version}, store/native.json ${was.version}`);
    for (const n of new Set([...Object.keys(was.packages), ...Object.keys(now.packages)])) {
      if (was.packages[n] !== now.packages[n]) diff.push(`${n}: ${was.packages[n] || 'not in the store app'} -> ${now.packages[n] || 'removed'}`);
    }
  }
  if (diff.length) {
    console.log(diff.join('\n'));
    console.log('Native packages changed since the store builds of this version. Raise "version" in app.json, run node scripts/native.mjs --write, commit, and make new store builds.');
    process.exit(1);
  }
  console.log(`Native packages match the store app ${version}.`);
}
