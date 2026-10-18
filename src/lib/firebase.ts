import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { Platform } from 'react-native';

/** Region of the Cloud Functions: Iowa, next to the US Firestore database and Storage bucket. */
export const REGION = 'us-central1';

function readConfig(): FirebaseOptions | null {
  const extra = (Constants.expoConfig?.extra || {}) as { firebase?: FirebaseOptions };
  const c = extra.firebase;
  return c && c.apiKey && c.projectId && c.appId ? c : null;
}

export interface FB {
  app: FirebaseApp;
  auth: FirebaseAuth.Auth;
  db: Firestore;
  storage: FirebaseStorage;
  functions: Functions;
}

let cached: FB | null | undefined;

/** Firebase services, or null when the app has no Firebase config yet (local test mode). */
export function fb(): FB | null {
  if (cached !== undefined) return cached;
  const config = readConfig();
  if (!config) return (cached = null);
  const app = getApps().length ? getApp() : initializeApp(config);
  let auth: FirebaseAuth.Auth;
  if (Platform.OS === 'web') {
    auth = FirebaseAuth.getAuth(app);
  } else {
    // The React Native build of firebase/auth exports getReactNativePersistence; the web typings don't list it.
    const rnPersistence = (FirebaseAuth as unknown as { getReactNativePersistence?: (s: unknown) => FirebaseAuth.Persistence }).getReactNativePersistence;
    try {
      auth = FirebaseAuth.initializeAuth(app, rnPersistence ? { persistence: rnPersistence(AsyncStorage) } : undefined);
    } catch {
      auth = FirebaseAuth.getAuth(app);
    }
  }
  cached = { app, auth, db: getFirestore(app), storage: getStorage(app), functions: getFunctions(app, REGION) };
  // Local emulators (FLEET_EMULATORS=1, see README): the ports in firebase.json.
  const host = (Constants.expoConfig?.extra as { emulators?: string } | undefined)?.emulators;
  if (host) {
    FirebaseAuth.connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(cached.db, host, 8080);
    connectStorageEmulator(cached.storage, host, 9199);
    connectFunctionsEmulator(cached.functions, host, 5001);
  }
  return cached;
}
