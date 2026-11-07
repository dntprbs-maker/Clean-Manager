import { initializeApp } from "firebase/app";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const secondaryApp = initializeApp(firebaseConfig, "Secondary");

// 로컬(IndexedDB) 캐시 활성화 — 재접속 시 캐시된 데이터를 즉시 보여주고 서버 동기화는 백그라운드에서 처리해
// 모바일 네트워크에서도 첫 화면이 빨리 뜬다. 시크릿 모드 등 IndexedDB 미지원 환경에서는 일반 모드로 폴백.
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
})();
export const auth          = getAuth(app);
export const provider      = new GoogleAuthProvider();
export const secondaryAuth = getAuth(secondaryApp);
export const functions     = getFunctions(app, "asia-northeast3"); // Cloud Functions 배포 리전과 일치시켜야 함 (기본값 us-central1이라 안 맞으면 CORS/404로 실패)
export const storage       = getStorage(app); // AI 상담 분석 등 Cloud Functions 호출용

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectFirestoreEmulator(db, '127.0.0.1', Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080));
  connectAuthEmulator(auth, `http://127.0.0.1:${Number(import.meta.env.VITE_AUTH_EMULATOR_PORT || 9099)}`, { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', Number(import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT || 5001));
  connectStorageEmulator(storage, '127.0.0.1', Number(import.meta.env.VITE_STORAGE_EMULATOR_PORT || 9199));
}

// FCM 푸시 알림 — 브라우저 지원 시에만 messaging 인스턴스 생성
export const fcmVapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
export const getMessagingIfSupported = async () => {
  try {
    if (await isSupported()) return getMessaging(app);
  } catch { /* 미지원 환경 */ }
  return null;
};
