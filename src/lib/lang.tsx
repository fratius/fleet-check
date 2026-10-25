import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { doc, setDoc } from 'firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { fb } from './firebase';
import { LANGS, applyDict, supported, type Dict } from './i18n';

/**
 * Which language the app shows, and its texts. The phone's language when the app has it (else English), unless the
 * person picked one in the Account tab: that choice is kept on this phone and on their profile (users/{uid}.lang),
 * so it follows them to their other phones and the server writes their notifications in it. Changing the language
 * redraws every screen (the app restarts at its first page).
 */

const PICK = 'fc.lang';
const build = () => (Constants.expoConfig?.extra as { build?: { sha?: string } } | undefined)?.build?.sha || 'dev';
const projectId = () => (Constants.expoConfig?.extra as { firebase?: { projectId?: string } } | undefined)?.firebase?.projectId;

/** The phone's language, if the app has it. */
export function deviceLang(): string {
  try {
    for (const l of getLocales()) {
      const c = supported(l.languageTag) || supported(l.languageCode);
      if (c) return c;
    }
  } catch { /* no locale info */ }
  return 'en';
}

/** The texts of a language: from the web app's folder (on the phone, from the web app's address), kept on the phone. */
async function fetchDict(code: string): Promise<Dict | null> {
  if (code === 'en') return {};
  const key = `fc.i18n.${code}`;
  let cached: { v: string; d: Dict } | null = null;
  try { cached = JSON.parse((await AsyncStorage.getItem(key)) || 'null'); } catch { cached = null; }
  if (cached && cached.v === build()) return cached.d;
  const base = Platform.OS === 'web' ? '' : projectId() ? `https://${projectId()}.web.app` : null;
  const get = async () => {
    if (base == null) return null;
    const r = await fetch(`${base}/i18n/${code}.json?v=${encodeURIComponent(build())}`);
    if (!r.ok) return null;
    const d = (await r.json()) as Dict;
    AsyncStorage.setItem(key, JSON.stringify({ v: build(), d })).catch(() => {});
    return d;
  };
  // An older copy is used at once and replaced for the next start; without one, wait for the download.
  if (cached) { get().catch(() => {}); return cached.d; }
  try { return await get(); } catch { return null; }
}

interface LangCtx {
  /** The language shown. */
  code: string;
  /** What the person picked, or null to follow the phone. */
  picked: string | null;
  device: string;
  /** Picks a language (null: the phone's). Saved on this phone and on the person's profile. */
  choose(code: string | null): Promise<void>;
  /**
   * After sign-in: the language on the person's profile wins over this phone's; and the server learns which language
   * the person sees (appLang), for their notifications.
   */
  fromProfile(uid: string, profile: { lang?: unknown; appLang?: unknown }): void;
}
const Ctx = createContext<LangCtx | null>(null);
export const useLang = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLang outside LanguageProvider');
  return c;
};

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const device = deviceLang();
  const [state, setState] = useState<{ code: string; picked: string | null } | null>(null);

  const show = useCallback(async (code: string, picked: string | null) => {
    const d = await fetchDict(code);
    const shown = d ? code : 'en';
    applyDict(shown, d || {});
    const f = fb();
    if (f) f.auth.languageCode = shown; // password emails in the same language
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.lang = shown;
      document.documentElement.dir = LANGS.find((l) => l.code === shown)?.rtl ? 'rtl' : 'ltr';
    }
    setState({ code: shown, picked });
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      let picked: string | null = null;
      try { picked = supported(await AsyncStorage.getItem(PICK)); } catch { picked = null; }
      // Don't keep the app waiting for long on a slow connection: English until the texts arrive.
      const timer = setTimeout(() => { if (live) setState((s) => s || { code: 'en', picked }); }, 4000);
      await show(picked || device, picked);
      clearTimeout(timer);
    })();
    return () => { live = false; };
  }, [show, device]);

  const choose = useCallback(async (code: string | null) => {
    const c = code ? supported(code) : null;
    try { if (c) await AsyncStorage.setItem(PICK, c); else await AsyncStorage.removeItem(PICK); } catch { /* storage blocked */ }
    const f = fb();
    const uid = f?.auth.currentUser?.uid;
    if (f && uid) await setDoc(doc(f.db, 'users', uid), { lang: c, appLang: c || device }, { merge: true }).catch(() => {});
    await show(c || device, c);
  }, [show, device]);

  const fromProfile = useCallback((uid: string, profile: { lang?: unknown; appLang?: unknown }) => {
    const c = supported(typeof profile.lang === 'string' ? profile.lang : null);
    setState((s) => {
      if (!s) return s;
      if (c && c !== s.picked) {
        AsyncStorage.setItem(PICK, c).catch(() => {});
        show(c, c).catch(() => {});
      } else if (profile.appLang !== s.code) {
        const f = fb();
        if (f) setDoc(doc(f.db, 'users', uid), { appLang: s.code }, { merge: true }).catch(() => {});
      }
      return s;
    });
  }, [show]);

  if (!state) return null;
  return (
    <Ctx.Provider value={{ code: state.code, picked: state.picked, device, choose, fromProfile }}>
      {/* Every screen is drawn again in the new language. */}
      <React.Fragment key={state.code}>{children}</React.Fragment>
    </Ctx.Provider>
  );
}
