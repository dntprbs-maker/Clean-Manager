// FCM 클라이언트 헬퍼 — 알림 권한 요청 + 토큰 발급 + Firestore 저장
import { getToken, onMessage } from "firebase/messaging";
import { doc, updateDoc, arrayUnion, arrayRemove, collection, query, where, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions, fcmVapidKey, getMessagingIfSupported } from "./firebase";

// admins 컬렉션(사장 계정, 로그인정보 포함)은 클라이언트 직접 쓰기가 Firestore 규칙으로
// 막혀있어서, 예전에 클라이언트에서 바로 fcmTokens를 갱신하려던 시도가 매번 조용히
// 실패했음(try/catch로 삼켜져 앱엔 "켜짐"으로만 보임 — 2026-07-24 확인). 서버(Admin SDK,
// 규칙 우회)를 거치는 syncAdminPushToken 콜러블 함수로만 등록/해제한다.
const callSyncAdminPushToken = httpsCallable(functions, "syncAdminPushToken");

// 이 기기 토큰을 "현재 로그인한 사람" 소유로 이전
// (다른 직원 문서에서 이 토큰 제거 → 현재 사용자에게만 등록)
// 한 기기 = 마지막 로그인한 사람만 알림 받음
async function claimToken(user, token) {
  if (user.role === "최고관리자") {
    await callSyncAdminPushToken({ uid: user.uid, token, action: "add" }).catch(() => {});
    return;
  }
  // 1) 같은 회사의 다른 직원 문서에서 이 토큰 제거
  try {
    const q = query(collection(db, "companies", user.companyId, "users"), where("fcmTokens", "array-contains", token));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d =>
      d.id === user.uid ? null : updateDoc(d.ref, { fcmTokens: arrayRemove(token) }).catch(()=>{})
    ));
  } catch { /* 무시 */ }
  // 2) staffs 컬렉션에서도 다른 사람 문서에서 제거
  try {
    const sq = query(collection(db, "staffs"), where("fcmTokens", "array-contains", token));
    const ssnap = await getDocs(sq);
    await Promise.all(ssnap.docs.map(d =>
      d.id === user.uid ? null : updateDoc(d.ref, { fcmTokens: arrayRemove(token) }).catch(()=>{})
    ));
  } catch { /* 무시 */ }
  // 3) 현재 로그인한 직원에게 등록
  await Promise.all([
    updateDoc(doc(db, "companies", user.companyId, "users", user.uid), { fcmTokens: arrayUnion(token) }).catch(()=>{}),
    updateDoc(doc(db, "staffs", user.uid), { fcmTokens: arrayUnion(token) }).catch(()=>{}),
  ]);
}

// 알림 권한 요청 → 토큰 발급 → 현재 사용자 소유로 이전
// 성공 시 { ok:true, token }, 실패 시 { ok:false, reason } 반환
export async function enablePush(user) {
  if (!user?.uid || !user?.companyId) return { ok:false, reason:"사용자 정보 없음" };
  if (!("Notification" in window))     return { ok:false, reason:"이 브라우저는 알림 미지원" };
  if (!fcmVapidKey)                     return { ok:false, reason:"VAPID 키 미설정" };
  if (!("serviceWorker" in navigator)) return { ok:false, reason:"서비스워커 미지원" };

  const messaging = await getMessagingIfSupported();
  if (!messaging) return { ok:false, reason:"FCM 미지원 환경(isSupported=false)" };

  const perm = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (perm !== "granted") return { ok:false, reason:"권한 거부됨("+perm+")" };

  try {
    const swReg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}firebase-messaging-sw.js`);
    await navigator.serviceWorker.ready;
    const token = await getToken(messaging, { vapidKey: fcmVapidKey, serviceWorkerRegistration: swReg });
    if (!token) return { ok:false, reason:"토큰 빈 값" };

    await claimToken(user, token);
    return { ok:true, token };
  } catch (e) {
    console.error("[FCM] 토큰 발급 실패:", e);
    return { ok:false, reason: e?.message || String(e) };
  }
}

// 로그아웃 시 이 기기 토큰을 모든 직원 문서에서 제거 → 로그아웃 상태에선 알림 안 옴
export async function disablePush(user) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!fcmVapidKey || !("serviceWorker" in navigator)) return;
  const messaging = await getMessagingIfSupported();
  if (!messaging) return;
  try {
    const swReg = await navigator.serviceWorker.getRegistration(`${import.meta.env.BASE_URL}firebase-messaging-sw.js`)
      || await navigator.serviceWorker.ready;
    const token = await getToken(messaging, { vapidKey: fcmVapidKey, serviceWorkerRegistration: swReg });
    if (!token) return;

    // 이 회사 users + staffs 전체에서 이 토큰 제거
    if (user?.companyId) {
      const q = query(collection(db, "companies", user.companyId, "users"), where("fcmTokens", "array-contains", token));
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map(d => updateDoc(d.ref, { fcmTokens: arrayRemove(token) }).catch(()=>{})));
    }
    const sq = query(collection(db, "staffs"), where("fcmTokens", "array-contains", token));
    const ssnap = await getDocs(sq);
    await Promise.all(ssnap.docs.map(d => updateDoc(d.ref, { fcmTokens: arrayRemove(token) }).catch(()=>{})));

    if (user?.role === "최고관리자") {
      await callSyncAdminPushToken({ uid: user.uid, token, action: "remove" }).catch(() => {});
    }
  } catch (e) { console.warn("[FCM] 로그아웃 토큰 제거 실패:", e); }
}

// 포그라운드(앱이 화면에 떠 있을 때) 메시지 수신 → 알림 표시
// 모바일 브라우저는 new Notification()을 지원하지 않으므로 서비스워커의 showNotification 사용
export async function listenForeground() {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return;
  onMessage(messaging, async payload => {
    if (Notification.permission !== "granted") return;
    const d = payload.data || {};
    const title = d.title || payload.notification?.title || "클린메니져";
    const options = {
      body: d.body || payload.notification?.body || "",
      icon: `${import.meta.env.BASE_URL}icon-192.png`,
      tag: d.eventId || undefined,
      data: d,
    };
    try {
      const reg = await navigator.serviceWorker.getRegistration(`${import.meta.env.BASE_URL}firebase-messaging-sw.js`)
        || await navigator.serviceWorker.ready;
      if (reg?.showNotification) { reg.showNotification(title, options); return; }
    } catch { /* SW 없으면 아래로 */ }
    // 데스크톱 폴백
    try { new Notification(title, options); } catch { /* 미지원 무시 */ }
  });
}
