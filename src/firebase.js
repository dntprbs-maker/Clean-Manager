import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey:            "AIzaSyAz-Gt2CC0_6n0MA2UhRZBsqbHKobVLDzc",
  authDomain:        "clean-manager-60bc9.firebaseapp.com",
  projectId:         "clean-manager-60bc9",
  storageBucket:     "clean-manager-60bc9.firebasestorage.app",
  messagingSenderId: "121841901396",
  appId:             "1:121841901396:web:2280750c052b2fcac7b2c1",
};

const app = initializeApp(firebaseConfig);

export const db       = getFirestore(app);
export const auth     = getAuth(app);
export const provider = new GoogleAuthProvider();
