import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";
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

export const db            = getFirestore(app);
export const auth          = getAuth(app);
export const provider      = new GoogleAuthProvider();
export const secondaryAuth = getAuth(secondaryApp);
export const functions     = getFunctions(app);
export const storage       = getStorage(app); // AI 상담 분석 등 Cloud Functions 호출용

// FCM 푸시 알림 — 브라우저 지원 시에만 messaging 인스턴스 생성
export const fcmVapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
export const getMessagingIfSupported = async () => {
  try {
    if (await isSupported()) return getMessaging(app);
  } catch { /* 미지원 환경 */ }
  return null;
};
