/**
 * Firebase 초기화 모듈
 * Firestore DB 인스턴스를 생성하여 앱 전체에서 사용할 수 있도록 export
 */
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Vite 환경변수로 Firebase 설정값 주입
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// Firebase 앱 초기화
const app = initializeApp(firebaseConfig);

// Firestore DB 인스턴스 export (App.jsx에서 import해서 사용)
export const db = getFirestore(app);
