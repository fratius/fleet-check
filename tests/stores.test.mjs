// A5 (driver sign-up, 2026-11-24): "Get Fratius" offers the phone's own app: the App Store on an iPhone, the Android
// app on an Android phone, both on a computer.
// Run: node --import ./tests/alias.mjs --test tests/stores.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { APP_STORE, ANDROID_TEST, androidUrl, appTarget } from '../src/lib/stores.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const MAC = IPAD;
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

test('A5: an iPhone (and an iPad, which says it is a Mac with a touch screen) gets the App Store', () => {
  assert.equal(appTarget(IPHONE, 5), 'ios');
  assert.equal(appTarget(IPAD, 5), 'ios');
});
test('A5: an Android phone gets the Android app', () => assert.equal(appTarget(ANDROID, 5), 'android'));
test('A5: a computer gets both', () => {
  assert.equal(appTarget(MAC, 0), 'both');
  assert.equal(appTarget(WINDOWS, 0), 'both');
});
test('A5: the links are the App Store page and, until Google Play, the Android download on fratius.com', () => {
  assert.match(APP_STORE, /^https:\/\/apps\.apple\.com\/app\/id\d+$/);
  assert.equal(androidUrl(), ANDROID_TEST);
  assert.equal(ANDROID_TEST, 'https://fratius.com/android');
});
test('the app, the website and the welcome email point at the same stores', async () => {
  const { readFileSync } = await import('node:fs');
  const site = readFileSync(new URL('../website/index.html', import.meta.url), 'utf8');
  const mail = readFileSync(new URL('../functions/src/joinmail.ts', import.meta.url), 'utf8');
  assert.ok(site.includes(`appStore: '${APP_STORE}'`), 'website CONFIG.stores.appStore');
  assert.ok(mail.includes(`APP_STORE = '${APP_STORE}'`), 'functions/src/joinmail.ts');
  assert.ok(mail.includes(`ANDROID_TEST = '${ANDROID_TEST}'`), 'functions/src/joinmail.ts');
  assert.match(site, /googlePlay: null/, 'when Google Play is set on the website, set GOOGLE_PLAY in src/lib/stores.ts and joinmail.ts too');
});
